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
  filename:    (_req, file,  cb) => {
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
  const m1 = raw.match(/^(\d{2})[\/\-](\d{2})[\/\-](\d{4})$/);
  if (m1) return m1[3] + '-' + m1[2] + '-' + m1[1];
  const months = { jan:'01',feb:'02',mar:'03',apr:'04',may:'05',jun:'06',
                   jul:'07',aug:'08',sep:'09',oct:'10',nov:'11',dec:'12' };
  const m2 = raw.match(/^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})$/);
  if (m2) return m2[3] + '-' + (months[m2[2].toLowerCase()] || '01') + '-' + m2[1].padStart(2,'0');
  return raw;
}

// ── Helper: parse SBI Excel / CSV ─────────────────────────────────────────────
function parseSBIStatement(buffer, originalname) {
  const wb   = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const ws   = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

  let headerIdx = -1;
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const r = rows[i].map(c => String(c).toLowerCase().trim());
    if (r.some(c => c.includes('date')) &&
        r.some(c => c.includes('amount') || c.includes('debit') || c.includes('credit') ||
                    c.includes('withdrawal') || c.includes('deposit'))) {
      headerIdx = i; break;
    }
  }
  if (headerIdx === -1) headerIdx = 0;

  const headers  = rows[headerIdx].map(c => String(c).toLowerCase().trim());
  const col      = (kws) => { for (const k of kws) { const i = headers.findIndex(h => h.includes(k)); if (i !== -1) return i; } return -1; };
  const dateCol  = col(['date']);
  const descCol  = col(['description','narration','particulars','remarks','detail']);
  const debitCol = col(['debit','withdrawal','dr']);
  const creditCol= col(['credit','deposit','cr']);
  const amtCol   = col(['amount']);
  const utrCol   = col(['utr','ref no','reference','chq','cheque']);

  const entries = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row     = rows[i];
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
      if (deb > 0)      { amount = deb; type = 'debit';  }
      else if (cre > 0) { amount = cre; type = 'credit'; }
    } else if (amtCol !== -1) {
      amount = parseFloat(String(row[amtCol]).replace(/,/g,'')) || 0;
    }

    entries.push({
      date:            dateStr,
      vendor:          descCol !== -1 ? String(row[descCol]).trim() : '',
      amount,
      type,
      invoice_no:      '',
      utr_number:      utrCol !== -1 ? String(row[utrCol]).trim() : '',
      remark:          '',
      reference_files: '[]',
    });
  }
  return entries;
}

// ── Helper: parse SBI PDF statement ───────────────────────────────────────────
async function parseSBIPDF(filePath) {
  const pdfParse  = require('pdf-parse');
  const dataBuffer = fs.readFileSync(filePath);
  const data       = await pdfParse(dataBuffer);
  const rawLines   = data.text.split('\n').map(l => l.trim()).filter(Boolean);

  // Indian-format amount  e.g. 1,40,000.00
  const AMOUNT_RE   = /\b\d{1,3}(?:,\d{2,3})*\.\d{2}\b/g;
  // Date at start of a line
  const DATE_RE     = /^(\d{2}[\/\-]\d{2}[\/\-]\d{4}|\d{1,2}\s+[A-Za-z]{3}\s+\d{4})/;
  // Date anywhere (for stripping from narration)
  const DATE_ANY_RE = /\b\d{2}[\/\-]\d{2}[\/\-]\d{4}\b|\b\d{1,2}\s+[A-Za-z]{3}\s+\d{4}\b/g;
  // SBI UTR / reference  e.g. SBIN126062267679, UTIB0001234567890
  const UTR_RE      = /\b([A-Z]{3,5}\d{9,})\b/;

  function extractAmounts(text) {
    const re = new RegExp(AMOUNT_RE.source, 'g');
    const out = []; let m;
    while ((m = re.exec(text)) !== null) out.push(parseFloat(m[0].replace(/,/g, '')));
    return out;
  }

  function toISO(str) {
    str = String(str).trim();
    const m1 = str.match(/^(\d{2})[\/\-](\d{2})[\/\-](\d{4})$/);
    if (m1) return `${m1[3]}-${m1[2]}-${m1[1]}`;
    const months = {jan:'01',feb:'02',mar:'03',apr:'04',may:'05',jun:'06',
                    jul:'07',aug:'08',sep:'09',oct:'10',nov:'11',dec:'12'};
    const m2 = str.match(/^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})$/);
    if (m2) { const mo = months[m2[2].toLowerCase()]; return mo ? `${m2[3]}-${mo}-${m2[1].padStart(2,'0')}` : str; }
    return str;
  }

  // ── Find header row & opening balance ────────────────────────────────────
  let startIdx   = 0;
  let prevBalance = null;

  for (let i = 0; i < rawLines.length; i++) {
    const l = rawLines[i].toLowerCase();
    // Grab opening balance so first transaction type is computed correctly
    if (l.includes('opening balance')) {
      const amts = extractAmounts(rawLines[i]);
      if (amts.length > 0) prevBalance = amts[amts.length - 1];
      startIdx = i + 1;
      break;
    }
    // Detect column header row
    if (/txn\s*date|transaction\s*date/i.test(rawLines[i]) &&
        (l.includes('debit') || l.includes('credit') || l.includes('balance') || l.includes('withdrawal'))) {
      startIdx = i + 1;
    }
  }

  const entries = [];
  let i = startIdx;

  while (i < rawLines.length) {
    const line = rawLines[i];

    // Skip footer / header repeats
    if (/closing balance|total debit|total credit|generated on|statement of account|page \d|txn date|value date/i.test(line)) {
      i++; continue;
    }

    const dateMatch = line.match(DATE_RE);
    if (!dateMatch) { i++; continue; }

    const rawDate = dateMatch[1];
    const isoDate = toISO(rawDate);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) { i++; continue; }

    // ── Collect lines for this transaction ───────────────────────────────
    // SBI PDFs often have: TxnDate | ValueDate | Narration | Ref | Debit | Credit | Balance
    // each on its own line — we collect up to 8 lines then stop at next new date
    const group = [line];
    let j = i + 1;
    while (j < rawLines.length && j <= i + 8) {
      const next = rawLines[j];
      if (/closing balance|generated on|statement of account/i.test(next)) break;
      const nextDateMatch = next.match(DATE_RE);
      if (nextDateMatch) {
        const nextISO = toISO(nextDateMatch[1]);
        // Same date = value date column → skip it and keep collecting
        if (nextISO === isoDate) { j++; continue; }
        // Different date = new transaction → stop
        break;
      }
      group.push(next);
      j++;
    }
    i = j;

    const combined = group.join(' ');
    const amts     = extractAmounts(combined);
    if (amts.length === 0) continue;

    const balance = amts[amts.length - 1];

    // ── Transaction amount via balance movement (most reliable for SBI) ──
    let txnAmt = 0, type = '';
    if (prevBalance !== null) {
      const diff = Math.round((prevBalance - balance) * 100) / 100;
      if      (diff >  0.01) { txnAmt =  diff; type = 'debit';  }
      else if (diff < -0.01) { txnAmt = -diff; type = 'credit'; }
    }
    // Fallback: largest non-zero, non-balance amount
    if (txnAmt === 0 && amts.length >= 2) {
      const candidates = amts.slice(0, -1).filter(a => a > 0.01);
      if (candidates.length > 0) txnAmt = Math.max(...candidates);
    }
    prevBalance = balance;

    // ── Extract UTR ───────────────────────────────────────────────────────
    const utrMatch  = combined.match(UTR_RE);
    const utr_number = utrMatch ? utrMatch[1] : '';

    // ── Build narration: strip all dates and amounts ───────────────────────
    let narration = combined
      .replace(DATE_ANY_RE, '')
      .replace(new RegExp(AMOUNT_RE.source, 'g'), '')
      .replace(/\s+/g, ' ').trim();

    // ── Clean vendor name ─────────────────────────────────────────────────
    let vendor = narration
      .replace(utr_number, '')
      .replace(/\b(TO TRANSFER|BY TRANSFER|TRANSFER|UPI|NEFT|IMPS|RTGS|SBI|TO |BY )\b/gi, ' ')
      .replace(/[/\\|]+/g, ' ')
      .replace(/\s+/g, ' ').trim()
      .substring(0, 80);

    entries.push({
      date:            isoDate,
      vendor:          vendor || narration.substring(0, 80),
      amount:          txnAmt,
      type,
      invoice_no:      '',
      utr_number,
      remark:          '',
      reference_files: '[]'
    });
  }

  return entries;
}

// ── Routes ────────────────────────────────────────────────────────────────────

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
              SET date=?, vendor=?, amount=?, type=?, invoice_no=?, utr_number=?, remark=?
              WHERE id=?`)
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
    'DATE':           r.date,
    'VENDOR':         r.vendor,
    'AMOUNT':         r.amount,
    'TYPE':           r.type,
    'INVOICE NUMBER': r.invoice_no,
    'UTR NUMBER':     r.utr_number,
    'REMARK':         r.remark,
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
