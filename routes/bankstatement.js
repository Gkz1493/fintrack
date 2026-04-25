const express = require('express');
const router  = express.Router();
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const XLSX    = require('xlsx');
const db      = require('../db');
const { authenticate } = require('../middleware/auth');

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

const upload = multer({
  storage,
  fileFilter: (_req, file, cb) => {
    const ok = /\.(xlsx|xls|csv|pdf)$/i.test(file.originalname);
    cb(null, ok);
  }
});

// ——— normalizeDate: handles all SBI date formats ———
// Supports: "1 Apr 2026", "01-Apr-2026", "01/04/2026", "01-04-2026", "01-Apr-26"
function normalizeDate(raw) {
  if (!raw) return '';
  const s = String(raw).trim();
  if (!s) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  const MON = {jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12};

  // "1 Apr 2026", "01 Apr 2026", "01-Apr-2026", "01/Apr/2026"
  let m = s.match(/^(\d{1,2})[-\s\/]([A-Za-z]{3})[-\s\/](\d{2,4})$/);
  if (m) {
    const mn = MON[m[2].toLowerCase()];
    let yr = parseInt(m[3]);
    if (yr < 100) yr += 2000;
    if (mn) return `${yr}-${String(mn).padStart(2,'0')}-${m[1].padStart(2,'0')}`;
  }

  // "01/03/2026" or "01-03-2026" (DD/MM/YYYY)
  m = s.match(/^(\d{2})[\/-](\d{2})[\/-](\d{4})$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;

  // Generic fallback
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0,10);
  return '';
}

function parseAmt(s) {
  if (!s && s !== 0) return 0;
  const n = parseFloat(String(s).replace(/,/g,''));
  return isNaN(n) ? 0 : n;
}

function isPureAmt(s) {
  return /^\d{1,3}(?:,\d{2,3})*\.\d{2}$/.test(s.trim());
}

function extractAmts(s) {
  return (s.match(/\d{1,3}(?:,\d{2,3})*\.\d{2}/g) || []).map(parseAmt);
}

// Date pattern: matches "1 Apr 2026", "01-Apr-2026", "01/04/2026", "01-04-2026"
const DATE_PAT = /^(\d{1,2}[-\s\/](?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[-\s\/]\d{2,4}|\d{2}[\/-]\d{2}[\/-]\d{4})/i;

function startsWithDate(s) { return DATE_PAT.test(s); }
function extractLeadingDate(s) { const m = s.match(DATE_PAT); return m ? m[1] : null; }
function stripLeadingDate(s) {
  return s.replace(/^(\d{1,2}[-\s\/](?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[-\s\/]\d{2,4}|\d{2}[\/-]\d{2}[\/-]\d{4})\s*/i,'');
}

function cleanVendor(narration) {
  if (!narration) return '';
  let v = narration
    .replace(/\b([A-Z]{2,6}\d{6,}[A-Z0-9]*|[A-Z][A-Z0-9]{9,})\b/g,' ')
    .replace(/\b(NEFT|IMPS|RTGS|UPI|INB|BY|TO|VIA)\b/gi,' ')
    .replace(/[\|\/\\]/g,' ')
    .replace(/\s{2,}/g,' ')
    .trim();
  if (v.length > 60) v = v.substring(0,60).trim();
  return v || narration.substring(0,50);
}

// ——— Excel/CSV Parser ———
function parseSBIStatement(buffer, originalname) {
  const ext = path.extname(originalname).toLowerCase();
  let rows;

  if (ext === '.csv') {
    const text = buffer.toString('utf8');
    rows = text.split('\n').map(l => l.split(',').map(c => c.trim().replace(/^"|"$/g,'')));
  } else {
    const wb = XLSX.read(buffer, { type:'buffer', cellDates:false });
    const ws = wb.Sheets[wb.SheetNames[0]];
    rows = XLSX.utils.sheet_to_json(ws, { header:1, defval:'', raw:false });
  }

  console.log('[SBI Excel] total rows:', rows.length);
  if (rows.length > 0) console.log('[SBI Excel] row0:', JSON.stringify(rows[0]).substring(0,200));
  if (rows.length > 1) console.log('[SBI Excel] row1:', JSON.stringify(rows[1]).substring(0,200));
  if (rows.length > 5) console.log('[SBI Excel] row5:', JSON.stringify(rows[5]).substring(0,200));

  let headerIdx = -1;
  const col = { date:-1, desc:-1, ref:-1, debit:-1, credit:-1, balance:-1 };

  for (let i = 0; i < Math.min(rows.length, 30); i++) {
    const row = rows[i].map(c => String(c).toLowerCase().trim());
    console.log('[SBI Excel] scanning row', i, ':', row.slice(0,8).join(' | '));
    if (row.some(c => c === 'txn date' || c === 'date' || c.includes('value date') || c.includes('tran date'))) {
      headerIdx = i;
      row.forEach((c, idx) => {
        if ((c === 'txn date' || c === 'date' || c.includes('tran date')) && col.date === -1) col.date = idx;
        else if (c.includes('description') || c.includes('narration') || c === 'particulars') col.desc = idx;
        else if (c.includes('ref no') || c.includes('chq') || c.includes('reference')) col.ref = idx;
        else if (c === 'debit' || c.includes('withdrawal') || c.includes('dr')) col.debit = idx;
        else if (c === 'credit' || c.includes('deposit') || c.includes('cr')) col.credit = idx;
        else if (c.includes('balance')) col.balance = idx;
      });
      if (col.date === -1) {
        row.forEach((c,idx) => { if (c.includes('value date') && col.date===-1) col.date=idx; });
      }
      console.log('[SBI Excel] header at row', i, 'col map:', JSON.stringify(col));
      break;
    }
  }

  if (headerIdx === -1) {
    console.log('[SBI Excel] no header row found, returning 0 entries');
    return [];
  }

  const entries = [];
  let prevBalance = null;

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.every(c => !String(c).trim())) continue;

    const dateRaw = col.date >= 0 ? String(row[col.date] || '').trim() : '';
    if (!dateRaw || /opening|closing|balance/i.test(dateRaw)) continue;

    let dateStr = dateRaw;
    if (/^\d{5}$/.test(dateStr)) {
      try {
        const d = XLSX.SSF.parse_date_code(parseInt(dateStr));
        const months=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        if (d) dateStr = `${d.d} ${months[d.m-1]} ${d.y}`;
      } catch(e) {}
    }

    const date = normalizeDate(dateStr);
    if (!date) { console.log('[SBI Excel] could not parse date:', dateRaw); continue; }

    const desc    = col.desc   >= 0 ? String(row[col.desc]   || '').trim() : '';
    const refRaw  = col.ref    >= 0 ? String(row[col.ref]    || '').trim() : '';
    const debit   = col.debit  >= 0 ? parseAmt(row[col.debit])  : 0;
    const credit  = col.credit >= 0 ? parseAmt(row[col.credit]) : 0;
    const balance = col.balance>= 0 ? parseAmt(row[col.balance]): 0;

    let txnAmt = debit || credit;
    if (!txnAmt && prevBalance !== null && balance > 0) {
      txnAmt = Math.abs(prevBalance - balance);
    }
    if (balance > 0) prevBalance = balance;
    if (!txnAmt) continue;

    const combined = desc + ' ' + refRaw;
    const utrM = combined.match(/\b([A-Z]{2,6}\d{6,}[A-Z0-9]*|[A-Z][A-Z0-9]{9,})\b/);
    const utr = utrM ? utrM[1] : (refRaw || '');
    const vendor = cleanVendor(desc);
    entries.push({ date, vendor, amount:txnAmt, utr });
  }

  console.log('[SBI Excel] parsed', entries.length, 'entries');
  return entries;
}

// ——— PDF Parser ———
async function parseSBIPDF(filePath) {
  const pdfParse = require('pdf-parse');
  const buf = fs.readFileSync(filePath);
  const data = await pdfParse(buf);
  const lines = data.text.split('\n').map(l => l.trim()).filter(l => l.length > 0);

  console.log('[SBI PDF] total lines:', lines.length);
  // Log first 20 lines for debugging
  lines.slice(0,20).forEach((l,i) => console.log(`[SBI PDF] line${i}: ${JSON.stringify(l)}`));

  const UTR_RE = /\b([A-Z]{2,6}\d{6,}[A-Z0-9]*|[A-Z][A-Z0-9]{9,})\b/g;

  let prevBalance = null;
  for (let i = 0; i < lines.length; i++) {
    if (/opening\s+balance/i.test(lines[i])) {
      const inlineAmts = extractAmts(lines[i]);
      if (inlineAmts.length > 0) { prevBalance = inlineAmts[inlineAmts.length-1]; break; }
      for (let j = i+1; j < Math.min(i+5, lines.length); j++) {
        if (isPureAmt(lines[j])) { prevBalance = parseAmt(lines[j]); break; }
      }
      break;
    }
  }
  console.log('[SBI PDF] opening balance:', prevBalance);

  const txnStarts = [];
  for (let i = 0; i < lines.length; i++) {
    if (startsWithDate(lines[i])) txnStarts.push(i);
  }
  console.log('[SBI PDF] txn starts count:', txnStarts.length);
  if (txnStarts.length > 0) {
    txnStarts.slice(0,5).forEach(idx => console.log(`[SBI PDF] txnStart[${idx}]: ${JSON.stringify(lines[idx])}`));
  }

  const entries = [];

  for (let t = 0; t < txnStarts.length; t++) {
    const si = txnStarts[t];
    const ei = t+1 < txnStarts.length ? txnStarts[t+1] : lines.length;
    const block = lines.slice(si, Math.min(ei, si+15));

    const txnDateStr = extractLeadingDate(block[0]);
    if (!txnDateStr) continue;
    const txnDate = normalizeDate(txnDateStr);
    if (!txnDate) continue;

    let rest = stripLeadingDate(block[0]);
    if (startsWithDate(rest)) rest = stripLeadingDate(rest);

    const narParts = [];
    const amounts = [];

    if (rest) {
      if (isPureAmt(rest)) {
        amounts.push(parseAmt(rest));
      } else {
        const inAmts = extractAmts(rest);
        const stripped = rest.replace(/\d{1,3}(?:,\d{2,3})*\.\d{2}/g,'').trim();
        if (inAmts.length > 0 && stripped === '') {
          amounts.push(...inAmts);
        } else {
          narParts.push(rest);
        }
      }
    }

    let seenContent = narParts.length > 0 || amounts.length > 0;
    for (let li = 1; li < block.length; li++) {
      const line = block[li];
      if (startsWithDate(line)) {
        if (!seenContent) { seenContent = true; continue; }
        break;
      }
      if (/this is a computer|generated statement|page \d|statement of account/i.test(line)) break;
      if (isPureAmt(line)) {
        amounts.push(parseAmt(line));
        seenContent = true;
      } else if (line) {
        const lineAmts = extractAmts(line);
        const lineStripped = line.replace(/\d{1,3}(?:,\d{2,3})*\.\d{2}/g,'').trim();
        if (lineAmts.length > 0 && lineStripped === '') {
          amounts.push(...lineAmts);
        } else {
          narParts.push(line);
        }
        seenContent = true;
      }
    }

    if (amounts.length === 0) continue;

    const balance = amounts[amounts.length-1];
    let txnAmt = 0;
    if (prevBalance !== null) {
      txnAmt = Math.abs(prevBalance - balance);
    } else {
      for (let a = 0; a < amounts.length-1; a++) {
        if (amounts[a] > 0) { txnAmt = amounts[a]; break; }
      }
    }
    prevBalance = balance;

    const narration = narParts.join(' ').replace(/\s{2,}/g,' ').trim();
    const utrMatches = [...narration.matchAll(UTR_RE)];
    const utr = utrMatches.length > 0 ? utrMatches[0][1] : '';
    const vendor = cleanVendor(narration);

    entries.push({ date:txnDate, vendor, amount:txnAmt, utr });
  }

  console.log('[SBI PDF] parsed', entries.length, 'entries');
  return entries;
}

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

router.get('/entries', authenticate, (req, res) => {
  const rows = db.prepare('SELECT * FROM bank_statement_entries ORDER BY id DESC').all();
  res.json(rows.map(r => ({ ...r, reference_files: JSON.parse(r.reference_files || '[]') })));
});

router.patch('/entries/:id', authenticate, express.json(), (req, res) => {
  const { date, vendor, amount, type, invoice_no, utr_number, remark } = req.body;
  db.prepare(`UPDATE bank_statement_entries
              SET date=?, vendor=?, amount=?, type=?, invoice_no=?, utr_number=?, remark=?
              WHERE id=?`)
    .run(date, vendor, parseFloat(amount)||0, type, invoice_no, utr_number, remark, req.params.id);
  res.json({ ok: true });
});

router.delete('/entries/:id', authenticate, (req, res) => {
  db.prepare('DELETE FROM bank_statement_entries WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

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

router.get('/reffile/:filename', authenticate, (req, res) => {
  const fp = path.join(UPLOAD_DIR, req.params.filename);
  if (!fs.existsSync(fp)) return res.status(404).json({ error: 'File not found' });
  res.sendFile(fp);
});

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


// ── DEBUG: returns raw extracted text so we can see the format ─────────────────
router.post('/debug', authenticate, upload.single('statement'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });
  const ext = path.extname(req.file.originalname).toLowerCase();
  try {
    if (ext === '.pdf') {
      const pdfParse = require('pdf-parse');
      const buf = fs.readFileSync(req.file.path);
      const data = await pdfParse(buf);
      const lines = data.text.split('\n').map((l,i) => i + ': ' + JSON.stringify(l));
      fs.unlink(req.file.path, () => {});
      res.json({ format: 'pdf', lines: lines.slice(0, 60) });
    } else {
      const buf = fs.readFileSync(req.file.path);
      const wb = XLSX.read(buf, { type: 'buffer', cellDates: true });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
      fs.unlink(req.file.path, () => {});
      res.json({ format: 'excel', rows: rows.slice(0, 15).map((r,i) => ({ row: i, data: r.map(c => String(c).substring(0,40)) })) });
    }
  } catch(e) {
    fs.unlink(req.file.path, () => {});
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
