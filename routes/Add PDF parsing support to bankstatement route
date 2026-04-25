const express = require('express');
const router  = express.Router();
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const XLSX    = require('xlsx');
const db      = require('../db');
const { authenticate } = require('../middleware/auth');

// ── Storage setup ──────────────────────────────────────────────────────────────
const UPLOAD_DIR = path.join(
  process.env.RAILWAY_VOLUME_MOUNT_PATH || path.join(__dirname, '..', 'data'),
  'bankref'
);
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, unique + path.extname(file.originalname));
  }
});

const upload = multer({
  storage,
  fileFilter: (_req, file, cb) => {
    const ok = /\.(xlsx|xls|csv|pdf)$/i.test(file.originalname);
    cb(null, ok);
  }
});

// ── Helper: normalize date to YYYY-MM-DD ──────────────────────────────────────
function normalizeDate(raw) {
  if (!raw) return '';
  raw = String(raw).trim();
  // DD/MM/YYYY or DD-MM-YYYY
  const m1 = raw.match(/^(\d{2})[\/-](\d{2})[\/-](\d{4})$/);
  if (m1) return m1[3] + '-' + m1[2] + '-' + m1[1];
  // DD Mon YYYY  e.g. "05 Apr 2024"
  const months = { jan:'01',feb:'02',mar:'03',apr:'04',may:'05',jun:'06',
                   jul:'07',aug:'08',sep:'09',oct:'10',nov:'11',dec:'12' };
  const m2 = raw.match(/^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})$/);
  if (m2) return m2[3] + '-' + (months[m2[2].toLowerCase()] || '01') + '-' + m2[1].padStart(2,'0');
  return raw;
}

// ── Helper: parse SBI Excel / CSV ─────────────────────────────────────────────
function parseSBIStatement(buffer, originalname) {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

  let headerIdx = -1;
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const r = rows[i].map(c => String(c).toLowerCase().trim());
    if (r.some(c => c.includes('date')) &&
        r.some(c => c.includes('amount') || c.includes('debit') || c.includes('credit') || c.includes('withdrawal') || c.includes('deposit'))) {
      headerIdx = i; break;
    }
  }
  if (headerIdx === -1) headerIdx = 0;

  const headers = rows[headerIdx].map(c => String(c).toLowerCase().trim());
  const col = (kws) => { for (const k of kws) { const i = headers.findIndex(h => h.includes(k)); if (i !== -1) return i; } return -1; };

  const dateCol   = col(['date']);
  const descCol   = col(['description','narration','particulars','remarks','detail']);
  const debitCol  = col(['debit','withdrawal','dr']);
  const creditCol = col(['credit','deposit','cr']);
  const amtCol    = col(['amount']);
  const utrCol    = col(['utr','ref no','reference','chq','cheque']);

  const entries = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    const rawDate = row[dateCol] || '';
    if (!rawDate) continue;
    let dateStr = rawDate instanceof Date
      ? rawDate.toISOString().split('T')[0]
      : normalizeDate(String(rawDate));
    if (!dateStr) continue;

    let amount = 0, type = '';
    if (debitCol !== -1 && creditCol !== -1) {
      const deb = parseFloat(String(row[debitCol]).replace(/,/g,'')) || 0;
      const cre = parseFloat(String(row[creditCol]).replace(/,/g,'')) || 0;
      if (deb > 0) { amount = deb; type = 'debit'; }
      else if (cre > 0) { amount = cre; type = 'credit'; }
    } else if (amtCol !== -1) {
      amount = parseFloat(String(row[amtCol]).replace(/,/g,'')) || 0;
    }

    entries.push({
      date:       dateStr,
      vendor:     descCol !== -1 ? String(row[descCol]).trim() : '',
      amount,
      type,
      invoice_no: '',
      utr_number: utrCol !== -1 ? String(row[utrCol]).trim() : '',
      remark:     '',
      reference_files: '[]',
    });
  }
  return entries;
}

// ── Helper: parse SBI PDF statement ───────────────────────────────────────────
async function parseSBIPDF(filePath) {
  const pdfParse = require('pdf-parse');
  const dataBuffer = fs.readFileSync(filePath);
  const data = await pdfParse(dataBuffer);
  const lines = data.text.split('\n').map(l => l.trim()).filter(l => l.length > 0);

  // Find header row
  let headerIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].toLowerCase();
    if (l.includes('date') &&
        (l.includes('withdrawal') || l.includes('deposit') || l.includes('debit') || l.includes('credit') || l.includes('narration'))) {
      headerIdx = i; break;
    }
  }
  if (headerIdx === -1) return [];

  const dateRe = /^(\d{2}[\/-]\d{2}[\/-]\d{4}|\d{1,2}\s+[A-Za-z]{3}\s+\d{4})/;
  const amtRe  = /[\d,]+\.\d{2}/g;

  const entries = [];
  let prevBalance = null;

  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    const dateMatch = line.match(dateRe);
    if (!dateMatch) continue;

    const date = normalizeDate(dateMatch[1]);

    // Extract all decimal amounts from line
    const amtReLocal = /[\d,]+\.\d{2}/g;
    const amounts = [];
    let m;
    while ((m = amtReLocal.exec(line)) !== null) {
      amounts.push(parseFloat(m[0].replace(/,/g, '')));
    }
    if (amounts.length === 0) continue;

    // Last amount = closing balance; second-to-last = transaction amount
    const balance  = amounts[amounts.length - 1];
    const txnAmt   = amounts.length >= 2 ? amounts[amounts.length - 2] : amounts[0];

    // Determine debit/credit from balance movement
    let type = '';
    if (prevBalance !== null) {
      if (balance < prevBalance - 0.01) type = 'debit';
      else if (balance > prevBalance + 0.01) type = 'credit';
    }
    prevBalance = balance;

    // Extract vendor: strip leading dates, then text before first amount
    let rest = line.slice(dateMatch[0].length).trim();
    // SBI often has a second date (value date) right after txn date
    rest = rest.replace(/^(\d{2}[\/-]\d{2}[\/-]\d{4}|\d{1,2}\s+[A-Za-z]{3}\s+\d{4})\s*/, '').trim();
    const firstAmtPos = rest.search(/[\d,]+\.\d{2}/);
    let vendor = firstAmtPos > 0 ? rest.slice(0, firstAmtPos).trim() : rest;
    // Strip trailing short branch code (1-6 digits)
    vendor = vendor.replace(/\s+\d{1,6}\s*$/, '').trim();

    // Extract UTR/ref number (12-22 digit number)
    const utrMatch = line.match(/\b(\d{12,22})\b/);
    const utr_number = utrMatch ? utrMatch[1] : '';

    if (date && txnAmt > 0) {
      entries.push({ date, vendor, amount: txnAmt, type, invoice_no: '', utr_number, remark: '', reference_files: '[]' });
    }
  }
  return entries;
}

// ── Routes ─────────────────────────────────────────────────────────────────────

// POST /api/bankstatement/parse
router.post('/parse', authenticate, upload.single('statement'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const ext = path.extname(req.file.originalname).toLowerCase();
  try {
    let entries;
    if (ext === '.pdf') {
      entries = await parseSBIPDF(req.file.path);
    } else {
      const buffer = fs.readFileSync(req.file.path);
      entries = parseSBIStatement(buffer, req.file.originalname);
    }
    fs.unlink(req.file.path, () => {});
    res.json({ entries, statementName: req.file.originalname });
  } catch (err) {
    console.error('bankstatement parse error:', err);
    fs.unlink(req.file.path, () => {});
    res.status(500).json({ error: err.message });
  }
});

// POST /api/bankstatement/save
router.post('/save', authenticate, express.json(), (req, res) => {
  const { entries = [], statementName = '' } = req.body;
  const insert = db.prepare(`
    INSERT INTO bank_statement_entries
      (date, vendor, amount, type, invoice_no, utr_number, remark, reference_files, statement_name)
    VALUES (?,?,?,?,?,?,?,?,?)
  `);
  const insertMany = db.transaction((rows) => {
    for (const e of rows) {
      insert.run(e.date||'', e.vendor||'', parseFloat(e.amount)||0, e.type||'',
                 e.invoice_no||'', e.utr_number||'', e.remark||'',
                 JSON.stringify(e.reference_files||[]), statementName);
    }
  });
  insertMany(entries);
  res.json({ saved: entries.length });
});

// GET /api/bankstatement/entries
router.get('/entries', authenticate, (req, res) => {
  const rows = db.prepare('SELECT * FROM bank_statement_entries ORDER BY id DESC').all();
  res.json(rows.map(r => ({ ...r, reference_files: JSON.parse(r.reference_files || '[]') })));
});

// PATCH /api/bankstatement/entries/:id
router.patch('/entries/:id', authenticate, express.json(), (req, res) => {
  const { date, vendor, amount, type, invoice_no, utr_number, remark } = req.body;
  db.prepare(`UPDATE bank_statement_entries
    SET date=?, vendor=?, amount=?, type=?, invoice_no=?, utr_number=?, remark=? WHERE id=?`)
    .run(date, vendor, parseFloat(amount)||0, type, invoice_no, utr_number, remark, req.params.id);
  res.json({ ok: true });
});

// DELETE /api/bankstatement/entries/:id
router.delete('/entries/:id', authenticate, (req, res) => {
  db.prepare('DELETE FROM bank_statement_entries WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// POST /api/bankstatement/reference/:id
router.post('/reference/:id', authenticate, upload.array('files', 20), (req, res) => {
  const row = db.prepare('SELECT reference_files FROM bank_statement_entries WHERE id=?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Entry not found' });
  const existing = JSON.parse(row.reference_files || '[]');
  const newFiles = (req.files || []).map(f => ({ name: f.originalname, file: f.filename }));
  const combined = [...existing, ...newFiles];
  db.prepare('UPDATE bank_statement_entries SET reference_files=? WHERE id=?')
    .run(JSON.stringify(combined), req.params.id);
  res.json({ reference_files: combined });
});

// GET /api/bankstatement/reffile/:filename
router.get('/reffile/:filename', authenticate, (req, res) => {
  const fp = path.join(UPLOAD_DIR, req.params.filename);
  if (!fs.existsSync(fp)) return res.status(404).json({ error: 'File not found' });
  res.sendFile(fp);
});

// GET /api/bankstatement/export
router.get('/export', authenticate, (req, res) => {
  const rows = db.prepare('SELECT * FROM bank_statement_entries ORDER BY id ASC').all();
  const data = rows.map(r => ({
    'DATE': r.date, 'VENDOR': r.vendor, 'AMOUNT': r.amount, 'TYPE': r.type,
    'INVOICE NUMBER': r.invoice_no, 'UTR NUMBER': r.utr_number, 'REMARK': r.remark,
  }));
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(data);
  ws['!cols'] = [14,35,14,10,20,22,30].map(w => ({ wch: w }));
  XLSX.utils.book_append_sheet(wb, ws, 'Bank Statement');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Disposition', 'attachment; filename="bank_statement.xlsx"');
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buf);
});

module.exports = router;
