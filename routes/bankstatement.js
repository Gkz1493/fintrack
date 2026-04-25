const express = require('express');
const router  = express.Router();
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const XLSX    = require('xlsx');
const db      = require('../db');
const { authenticate } = require('../middleware/auth');

// ── Storage setup ────────────────────────────────────────────────────────────
const UPLOAD_DIR = path.join(
  process.env.RAILWAY_VOLUME_MOUNT_PATH || path.join(__dirname, '..', 'data'),
  'bankref'
);
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename:    (_req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, unique + path.extname(file.originalname));
  }
});
const upload = multer({ storage });

// ── Helper: parse SBI Excel / CSV ────────────────────────────────────────────
function parseSBIStatement(buffer, mimetype, originalname) {
  const ext = path.extname(originalname).toLowerCase();
  let rows = [];

  if (ext === '.csv') {
    const wb = XLSX.read(buffer, { type: 'buffer', raw: false });
    const ws = wb.Sheets[wb.SheetNames[0]];
    rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  } else {
    const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
    const ws = wb.Sheets[wb.SheetNames[0]];
    rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  }

  // Find header row (contains "Date" or "Txn Date")
  let headerIdx = -1;
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const r = rows[i].map(c => String(c).toLowerCase().trim());
    if (r.some(c => c.includes('date')) && r.some(c => c.includes('amount') || c.includes('debit') || c.includes('credit'))) {
      headerIdx = i;
      break;
    }
  }

  if (headerIdx === -1) {
    // Fallback: treat first row as header
    headerIdx = 0;
  }

  const headers = rows[headerIdx].map(c => String(c).toLowerCase().trim());

  // Column index helpers
  const col = (keywords) => {
    for (const kw of keywords) {
      const idx = headers.findIndex(h => h.includes(kw));
      if (idx !== -1) return idx;
    }
    return -1;
  };

  const dateCol    = col(['date']);
  const descCol    = col(['description', 'narration', 'particulars', 'remarks', 'detail']);
  const debitCol   = col(['debit', 'withdrawal', 'dr']);
  const creditCol  = col(['credit', 'deposit', 'cr']);
  const amtCol     = col(['amount']);
  const utrCol     = col(['utr', 'ref no', 'reference', 'chq', 'cheque']);
  const balCol     = col(['balance']);

  const entries = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    const rawDate = row[dateCol] || '';
    if (!rawDate) continue; // skip empty rows

    // Parse date
    let dateStr = '';
    if (rawDate instanceof Date) {
      dateStr = rawDate.toISOString().split('T')[0];
    } else {
      const s = String(rawDate).trim();
      // Try DD/MM/YYYY or DD-MM-YYYY or MM/DD/YYYY
      const dm = s.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})$/);
      if (dm) {
        const d = dm[1].padStart(2,'0'), mo = dm[2].padStart(2,'0');
        let yr = dm[3]; if (yr.length === 2) yr = '20' + yr;
        dateStr = yr + '-' + mo + '-' + d;
      } else {
        dateStr = s;
      }
    }

    // Amount: prefer debit/credit split, fallback to single amount
    let amount = 0;
    let type   = '';
    if (debitCol !== -1 && creditCol !== -1) {
      const deb = parseFloat(String(row[debitCol]).replace(/,/g,'')) || 0;
      const cre = parseFloat(String(row[creditCol]).replace(/,/g,'')) || 0;
      if (deb > 0)       { amount = deb; type = 'debit'; }
      else if (cre > 0)  { amount = cre; type = 'credit'; }
    } else if (amtCol !== -1) {
      amount = parseFloat(String(row[amtCol]).replace(/,/g,'')) || 0;
    }

    const vendor = descCol !== -1 ? String(row[descCol]).trim() : '';
    const utr    = utrCol  !== -1 ? String(row[utrCol]).trim()  : '';

    if (!dateStr && !vendor && amount === 0) continue;

    entries.push({
      date:       dateStr,
      vendor:     vendor,
      amount:     amount,
      type:       type,
      invoice_no: '',
      utr_number: utr,
      remark:     '',
      reference_files: '[]',
    });
  }
  return entries;
}

// ── Routes ───────────────────────────────────────────────────────────────────

// POST /api/bankstatement/parse  — parse uploaded file, return rows (not saved)
router.post('/parse', authenticate, upload.single('statement'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  try {
    const buffer = fs.readFileSync(req.file.path);
    const entries = parseSBIStatement(buffer, req.file.mimetype, req.file.originalname);
    // Clean up temp upload
    fs.unlinkSync(req.file.path);
    res.json({ entries, statementName: req.file.originalname });
  } catch (err) {
    console.error('bankstatement parse error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/bankstatement/save  — save array of entries to DB
router.post('/save', authenticate, express.json(), (req, res) => {
  const { entries = [], statementName = '' } = req.body;
  const insert = db.prepare(`
    INSERT INTO bank_statement_entries
      (date, vendor, amount, type, invoice_no, utr_number, remark, reference_files, statement_name)
    VALUES (?,?,?,?,?,?,?,?,?)
  `);
  const insertMany = db.transaction((rows) => {
    for (const e of rows) {
      insert.run(
        e.date || '',
        e.vendor || '',
        parseFloat(e.amount) || 0,
        e.type || '',
        e.invoice_no || '',
        e.utr_number || '',
        e.remark || '',
        JSON.stringify(e.reference_files || []),
        statementName
      );
    }
  });
  insertMany(entries);
  res.json({ saved: entries.length });
});

// GET /api/bankstatement/entries — fetch all entries (newest first)
router.get('/entries', authenticate, (req, res) => {
  const rows = db.prepare(
    'SELECT * FROM bank_statement_entries ORDER BY id DESC'
  ).all();
  const parsed = rows.map(r => ({
    ...r,
    reference_files: JSON.parse(r.reference_files || '[]'),
  }));
  res.json(parsed);
});

// PATCH /api/bankstatement/entries/:id — update a row
router.patch('/entries/:id', authenticate, express.json(), (req, res) => {
  const { id } = req.params;
  const { date, vendor, amount, type, invoice_no, utr_number, remark } = req.body;
  db.prepare(`
    UPDATE bank_statement_entries
    SET date=?, vendor=?, amount=?, type=?, invoice_no=?, utr_number=?, remark=?
    WHERE id=?
  `).run(date, vendor, parseFloat(amount)||0, type, invoice_no, utr_number, remark, id);
  res.json({ ok: true });
});

// DELETE /api/bankstatement/entries/:id — delete a row
router.delete('/entries/:id', authenticate, (req, res) => {
  db.prepare('DELETE FROM bank_statement_entries WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// POST /api/bankstatement/reference/:id — upload reference files for a row
router.post('/reference/:id', authenticate, upload.array('files', 20), (req, res) => {
  const { id } = req.params;
  const row = db.prepare('SELECT reference_files FROM bank_statement_entries WHERE id=?').get(id);
  if (!row) return res.status(404).json({ error: 'Entry not found' });

  const existing = JSON.parse(row.reference_files || '[]');
  const newFiles = (req.files || []).map(f => ({ name: f.originalname, file: f.filename }));
  const combined = [...existing, ...newFiles];

  db.prepare('UPDATE bank_statement_entries SET reference_files=? WHERE id=?')
    .run(JSON.stringify(combined), id);
  res.json({ reference_files: combined });
});

// GET /api/bankstatement/reffile/:filename — serve a reference file
router.get('/reffile/:filename', authenticate, (req, res) => {
  const fp = path.join(UPLOAD_DIR, req.params.filename);
  if (!fs.existsSync(fp)) return res.status(404).json({ error: 'File not found' });
  res.sendFile(fp);
});

// GET /api/bankstatement/export — export as Excel
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

  // Column widths
  ws['!cols'] = [
    { wch: 14 }, { wch: 35 }, { wch: 14 }, { wch: 10 },
    { wch: 20 }, { wch: 22 }, { wch: 30 },
  ];

  XLSX.utils.book_append_sheet(wb, ws, 'Bank Statement');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

  res.setHeader('Content-Disposition', 'attachment; filename="bank_statement.xlsx"');
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buf);
});

module.exports = router;
