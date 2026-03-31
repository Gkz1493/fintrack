const express = require('express');
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const { v4: uuidv4 } = require('uuid');
const { authenticate } = require('../middleware/auth');

const router  = express.Router();

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '..', 'uploads', 'ocr_temp');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => cb(null, `ocr_${uuidv4()}${path.extname(file.originalname)}`),
});
const upload = multer({ storage, limits: { fileSize: 15 * 1024 * 1024 } });

async function runOCR(imagePath) {
  try {
    const { createWorker } = require('tesseract.js');
    const worker = await createWorker('eng', 1, { cachePath: '/tmp', logger: () => {} });
    const { data: { text } } = await worker.recognize(imagePath);
    await worker.terminate();
    return text && text.trim().length > 3 ? text : null;
  } catch (err) {
    console.error('[Tesseract OCR]', err.message);
    return null;
  }
}

function parseOCRText(rawText) {
  if (!rawText) return null;
  const lines = rawText.split('\n').map(l => l.trim()).filter(Boolean);
  const text  = rawText;

  // ── Vendor ──────────────────────────────────────────────────────────────────
  let vendor = '';
  for (const line of lines.slice(0, 5)) {
    if (/[a-zA-Z]{3,}/.test(line) && !/^(date|time|bill|invoice|receipt|order|#|to\s)/i.test(line)) {
      vendor = line.replace(/[^a-zA-Z0-9\s&.'()\-]/g, '').trim();
      if (vendor.length >= 3) break;
    }
  }
  // If first line starts with "To " (like "To Ramesh kanishka"), strip the "To "
  if (!vendor) {
    const toLine = lines.slice(0,5).find(l => /^to\s+[a-zA-Z]/i.test(l));
    if (toLine) vendor = toLine.replace(/^to\s+/i, '').replace(/[^a-zA-Z0-9\s&.'()\-]/g, '').trim();
  }

  // ── Invoice number ───────────────────────────────────────────────────────────
  let invoiceNo = '';
  const invPatterns = [
    /(?:invoice|receipt|bill|booking|order|txn|transaction|ref|ticket)[\s#:no.]*([A-Z0-9\/_\-]{4,25})/i,
    /\b(?:no|num|id)[\s:.#]*([A-Z0-9_\-]{5,20})\b/i,
    /#\s*([A-Z0-9\-]{4,20})/i,
  ];
  for (const p of invPatterns) { const m = text.match(p); if (m?.[1]) { invoiceNo = m[1].trim(); break; } }

  // ── Date ────────────────────────────────────────────────────────────────────
  let date = new Date().toISOString().slice(0, 10);
  const MONTHS = { jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12 };
  const datePatterns = [
    { re: /(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/, fn: m => `${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}` },
    { re: /(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})/, fn: m => `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}` },
    { re: /(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s+(\d{4})/i,
      fn: m => `${m[3]}-${String(MONTHS[m[2].slice(0,3).toLowerCase()]).padStart(2,'0')}-${m[1].padStart(2,'0')}` },
  ];
  for (const { re, fn } of datePatterns) { const m = text.match(re); if (m) { try { date = fn(m); } catch(e){} break; } }

  // ── Amounts ──────────────────────────────────────────────────────────────────
  let total = 0;
  // Tier 1: explicit total keywords
  const totalPatterns = [
    /(?:total amount|grand total|net payable|amount paid|amount due|total payable|to pay|net total|final amount|total bill)[\s:\u20b9Rs₹]*(\d[\d,]*\.?\d{0,2})/i,
    /(?:^|\n)\s*total[\s:\u20b9Rs₹]*(\d[\d,]*\.?\d{0,2})/im,
    /(?:^|\n)\s*amount[\s:\u20b9Rs₹]*(\d[\d,]*\.?\d{0,2})/im,
    /(?:^|\n)\s*(?:bill|sub.?total|subtotal)[\s:\u20b9Rs₹]*(\d[\d,]*\.?\d{0,2})/im,
  ];
  for (const p of totalPatterns) {
    const m = text.match(p);
    if (m) { total = parseFloat(m[1].replace(/,/g,'')); if (total > 0) break; }
  }
  // Tier 2: currency symbol prefix (₹50, Rs.100, INR 250)
  if (total === 0) {
    const hits = [...text.matchAll(/(?:₹|Rs\.?|INR)\s*(\d[\d,]*(?:\.\d{1,2})?)/g)];
    if (hits.length > 0) {
      const amounts = hits.map(m => parseFloat(m[1].replace(/,/g,''))).filter(n => n > 0);
      if (amounts.length) total = Math.max(...amounts);
    }
  }
  // Tier 3: Indian price suffix (50/-, 250.00/-)
  if (total === 0) {
    const m = text.match(/(\d[\d,]*(?:\.\d{1,2})?)\s*\/-/);
    if (m) total = parseFloat(m[1].replace(/,/g,''));
  }
  // Tier 4: last/largest standalone number on the bill as fallback
  if (total === 0) {
    const nums = [...text.matchAll(/\b(\d{1,6}(?:\.\d{2})?)\b/g)]
      .map(m => parseFloat(m[1]))
      .filter(n => n >= 1 && n < 1000000);
    if (nums.length) total = nums[nums.length - 1]; // last number = often the total
  }

  // ── GST ──────────────────────────────────────────────────────────────────────
  let gst = 0;
  const taxPatterns = [/(?:gst|igst|sgst|cgst|service tax|tax)[\s:@\u20b9Rs₹%]*(\d[\d,]*\.?\d{0,2})/i];
  for (const p of taxPatterns) { const m = text.match(p); if (m) { gst = parseFloat(m[1].replace(/,/g,'')); break; } }

  const amount = (total > 0 && gst > 0) ? +(total - gst).toFixed(2) : total;

  // ── Description ──────────────────────────────────────────────────────────────
  let description = '';
  const descPatterns = [/(?:description|particulars|item|service|for)[\s:]+([^\n]{5,80})/i];
  for (const p of descPatterns) { const m = text.match(p); if (m) { description = m[1].trim(); break; } }
  if (!description && lines.length > 1) {
    const c = lines.slice(1,5).find(l => /[a-zA-Z]{4,}/.test(l) && l.length > 4 && l.length < 80 && !/^(date|invoice|receipt|bill|total|amount|gst)/i.test(l));
    if (c) description = c;
  }

  // ── Category ─────────────────────────────────────────────────────────────────
  let suggestedCategory = 'other';
  if (/rapido|ola|uber|cab|taxi|auto|ride|flight|train|bus|fuel|petrol|diesel|toll|transport|porter/i.test(text)) suggestedCategory = 'travel';
  else if (/food|restaurant|cafe|coffee|lunch|dinner|swiggy|zomato|pizza|burger|meal|water|bisleri|aqua/i.test(text)) suggestedCategory = 'consumables';
  else if (/stationery|office|amazon|flipkart|laptop|printer|keyboard|mouse|supply/i.test(text)) suggestedCategory = 'consumables';
  else if (/electricity|power|water supply|rent|internet|broadband|telephone|mobile|utility|bill/i.test(text)) suggestedCategory = 'overhead';
  else if (/advance|deposit|prepaid|token|booking amount/i.test(text)) suggestedCategory = 'advance';

  return {
    vendor: vendor || lines[0]?.replace(/[^a-zA-Z0-9\s&.'()\-]/g,'').trim() || 'Unknown Vendor',
    invoice_no: invoiceNo,
    date,
    amount: amount > 0 ? amount.toFixed(2) : total > 0 ? total.toFixed(2) : '',
    gst: gst.toFixed(2),
    total: total > 0 ? total.toFixed(2) : '',
    description: description.slice(0, 200),
    suggestedCategory,
    source: 'tesseract',
  };
}

router.post('/', authenticate, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No image uploaded' });
  const imagePath = req.file.path;
  try {
    const rawText = await runOCR(imagePath);
    if (rawText) {
      res.json(parseOCRText(rawText));
    } else {
      res.json({ vendor:'', invoice_no:'', date: new Date().toISOString().slice(0,10), amount:'', gst:'0.00', total:'', description:'', suggestedCategory:'other', source:'manual', message:'Could not read text from image. Please fill in manually.' });
    }
  } catch (err) {
    console.error('[OCR Route]', err.message);
    res.status(500).json({ error: err.message });
  } finally {
    try { fs.unlinkSync(imagePath); } catch(e){}
  }
});

module.exports = router;
