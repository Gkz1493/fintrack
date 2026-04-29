const express = require('express');
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const db      = require('../db');
const { authenticate, adminOnly } = require('../middleware/auth');

const router = express.Router();

// Multer setup for PDF uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = /\.(pdf|xlsx|csv)$/i.test(file.originalname);
    cb(ok ? null : new Error('Only PDF/XLSX/CSV allowed'), ok);
  }
});

// âââ Helper: extract UTR number âââââââââââââââââââââââââââââââââââââââââââââââ
function extractUTR(narration) {
  if (!narration) return '';
  const s = String(narration);
  const utrNoM = s.match(/UTR\s*NO[:\s]+([A-Z]{2,6}\d{6,}[A-Z0-9]*)/i);
  if (utrNoM) return utrNoM[1];
  const fbM = s.match(/\b([A-Z]{2,6}\d{6,}[A-Z0-9]*)\b/);
  if (fbM) return fbM[1];
  return '';
}

// âââ Helper: clean vendor name ââââââââââââââââââââââââââââââââââââââââââââââââ
function cleanVendor(narration) {
  if (!narration) return '';
  let s = String(narration).trim();
  const utrVendorM = s.match(/UTR\s*NO[:\s]+[A-Z0-9]+-\s*(.+?)\s*$/i);
  if (utrVendorM && utrVendorM[1].trim()) {
    return utrVendorM[1].trim().replace(/^[-\s]+|[-\s]+$/g, '');
  }
  s = s.replace(/^TO\s+TRANSFER[-\s]*/i, '');
  s = s.replace(/^TRANSFER[-\s]*/i, '');
  s = s.replace(/^BY\s+TRANSFER[-\s]*/i, '');
  s = s.replace(/\/UTR\s*NO[:\s]+[A-Z0-9]+/i, '');
  s = s.replace(/\s{2,}/g, ' ').trim();
  return s || narration.trim();
}

// âââ GET all bank statement entries ââââââââââââââââââââââââââââââââââââââââââ
router.get('/entries', authenticate, async (req, res) => {
  try {
    const entries = await db.all('SELECT * FROM bank_statement_entries ORDER BY id DESC');
    res.json(entries);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// âââ POST upload & parse SBI statement âââââââââââââââââââââââââââââââââââââââ
router.post('/upload', authenticate, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const statementName = req.file.originalname;

    // Parse based on file type
    const ext = path.extname(statementName).toLowerCase();
    let entries = [];

    if (ext === '.pdf') {
      // Use pdf-parse to extract text
      let pdfParse;
      try { pdfParse = require('pdf-parse'); } catch (e) { return res.status(500).json({ error: 'pdf-parse not installed' }); }
      const data = await pdfParse(req.file.buffer);
      const lines = data.text.split('\n').map(l => l.trim()).filter(Boolean);
      // Parse SBI statement lines (date, narration, debit/credit, balance)
      entries = parseSBILines(lines, statementName);
    } else if (ext === '.xlsx' || ext === '.csv') {
      const XLSX = require('xlsx');
      const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1 });
      entries = parseSBIRows(rows, statementName);
    }

    res.json({ entries, statementName });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// âââ POST save parsed entries to DB âââââââââââââââââââââââââââââââââââââââââ
router.post('/save', authenticate, async (req, res) => {
  try {
    const { entries, statementName } = req.body;
    if (!entries || !Array.isArray(entries)) return res.status(400).json({ error: 'entries required' });

    const saved = [];
    for (const e of entries) {
      const result = await db.query(
        'INSERT INTO bank_statement_entries (date, vendor, amount, type, invoice_no, utr_number, remark, reference_files, statement_name) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *',
        [e.date || '', e.vendor || '', parseFloat(e.amount) || 0, e.type || '', e.invoice_no || '', e.utr_number || '', e.remark || '', JSON.stringify(e.reference_files || []), statementName || '']
      );
      saved.push(result.rows[0]);
    }
    res.json({ saved: saved.length, entries: saved });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// âââ PUT update a bank statement entry (âââââââââââââââââââââââââââââââââââââââââââ
router.put('/entries/:id', authenticate, async (req, res) => {
  try {
    const { date, vendor, amount, type, invoice_no, utr_number, remark } = req.body;
    await db.run('UPDATE bank_statement_entries SET date=?,vendor=?,amount=?,type=?,invoice_no=?,utr_number=?,remark=? WHERE id=?',
      [date, vendor, amount, type||'', invoice_no||'', utr_number||'', remark||'', req.params.id]);
    res.json({ message: 'Updated' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// âââ DELETE a bank statement entry âââââââââââââââââââââââââââââââââââââââââââ
router.delete('/entries/:id', authenticate, adminOnly, async (req, res) => {
  try {
    await db.run('DELETE FROM bank_statement_entries WHERE id = ?', [req.params.id]);
    res.json({ message: 'Deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// âââ DELETE all entries for a statement âââââââââââââââââââââââââââââââââââââââ
router.delete('/statement/:name', authenticate, adminOnly, async (req, res) => {
  try {
    await db.run('DELETE FROM bank_statement_entries WHERE statement_name = ?', [req.params.name]);
    res.json({ message: 'Deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// âââ SBI PDF line parser ââââââââââââââââââââââââââââââââââââââââââââââââââââââ
function parseSBILines(lines, statementName) {
  const entries = [];
  const dateRe = /^\d{2}\/\d{2}\/\d{4}$/;
  for (let i = 0; i < lines.length; i++) {
    if (dateRe.test(lines[i])) {
      const date = lines[i];
      const narration = lines[i + 1] || '';
      const amount = parseFloat((lines[i + 2] || '0').replace(/,/g, '')) || 0;
      entries.push({
        date: date.split('/').reverse().join('-'),
        vendor: cleanVendor(narration),
        amount,
        utr_number: extractUTR(narration),
        type: '',
        invoice_no: '',
        remark: '',
        reference_files: [],
        statement_name: statementName
      });
      i += 2;
    }
  }
  return entries;
}

function parseSBIRows(rows, statementName) {
  const entries = [];
  for (const row of rows) {
    if (!row[0] || typeof row[0] !== 'string') continue;
    const dateMatch = String(row[0]).match(/\d{2}\/\d{2}\/\d{4}/);
    if (!dateMatch) continue;
    const narration = String(row[1] || '');
    const debit = parseFloat(String(row[4] || '0').replace(/,/g, '')) || 0;
    if (!debit) continue;
    entries.push({
      date: dateMatch[0].split('/').reverse().join('-'),
      vendor: cleanVendor(narration),
      amount: debit,
      utr_number: extractUTR(narration),
      type: '',
      invoice_no: '',
      remark: '',
      reference_files: [],
      statement_name: statementName
    });
  }
  return entries;
}

module.exports = router;
