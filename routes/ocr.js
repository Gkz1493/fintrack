const express    = require('express');
const multer     = require('multer');
const path       = require('path');
const fs         = require('fs');
const { v4: uuidv4 } = require('uuid');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

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

  // ── Vendor ────────────────────────────────────────────────────────────────────
  // Skip document-header lines; first real company name is the vendor
  const skipVendor = /^(tax\s*invoice|delivery\s*challan|invoice\s*cum|receipt|gstin|gst\s*no|phone|e[\-\s]?mail|state|place|contact|dated|invoice\s*no|bill\s*no|buyer|consignee|ship\s*to|sold\s*to|^to:|^from:|si\s*no|sl\s*no|description|amount|total|cgst|sgst|igst|taxable|hsn|sac|rate|qty|quantity|per\s|nos\b|pcs\b|kgs\b|printed|dispatch|reference|signature|authoris|bank|account|ifsc|pan\s*no|cin\b)/i;

  let vendor = '';
  for (const line of lines.slice(0, 18)) {
    if (line.length < 3) continue;
    if (skipVendor.test(line)) continue;
    if (/^\d/.test(line)) continue;
    if (!/[a-zA-Z]{3,}/.test(line)) continue;
    vendor = line.replace(/[^a-zA-Z0-9\s&.'()\-]/g, '').trim();
    if (vendor.length >= 3) break;
  }

  // ── Invoice number ────────────────────────────────────────────────────────────
  let invoiceNo = '';
  const invPatterns = [
    /(?:invoice\s*no\.?|invoice\s*number|bill\s*no\.?|receipt\s*no\.)\s*[:#]?\s*([A-Z0-9\/_\-<>]{3,40})/i,
    /(?:invoice|receipt|bill|booking|order|txn|ref|ticket)[\s#:no.]*([A-Z0-9\/_\-]{4,25})/i,
    /(?:^|\s)(GST\/\d+\/[\d\-A-Za-z<>]+)/m,
    /#\s*([A-Z0-9\-]{4,20})/i,
  ];
  for (const p of invPatterns) {
    const m = text.match(p);
    if (m) {
      invoiceNo = (m[1] || m[0]).trim().replace(/<[^>]*>/g, '').trim();
      if (invoiceNo.length >= 3) break;
    }
  }

  // ── Date ──────────────────────────────────────────────────────────────────────
  let date = new Date().toISOString().slice(0, 10);
  const MON = { jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12 };

  const datePatterns = [
    // 2026-03-04
    { re: /(\d{4})[\-\/](\d{1,2})[\-\/](\d{1,2})/, fn: m => `${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}` },
    // 04-03-2026
    { re: /(\d{1,2})[\-\/](\d{1,2})[\-\/](\d{4})/, fn: m => `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}` },
    // 4-Mar-26  OR  4-Mar-2026  (Indian invoice format)
    { re: /(\d{1,2})[\-\s](Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*[\-\s](\d{2,4})/i,
      fn: m => {
        let yr = parseInt(m[3]);
        if (yr < 100) yr += 2000;
        return `${yr}-${String(MON[m[2].slice(0,3).toLowerCase()]).padStart(2,'0')}-${m[1].padStart(2,'0')}`;
      }
    },
    // 4 March 2026
    { re: /(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s+(\d{4})/i,
      fn: m => `${m[3]}-${String(MON[m[2].slice(0,3).toLowerCase()]).padStart(2,'0')}-${m[1].padStart(2,'0')}`
    },
  ];
  for (const { re, fn } of datePatterns) {
    const m = text.match(re);
    if (m) { try { date = fn(m); } catch(e){} break; }
  }

  // ── Amounts ───────────────────────────────────────────────────────────────────
  // PRIORITY: ₹ / Rs / INR amounts → take the LARGEST (grand total is usually largest)
  let total = 0;
  const rupeeHits = [...text.matchAll(/(?:₹|Rs\.?|INR)\s*([\d,]+(?:\.\d{1,2})?)/g)]
    .map(m => parseFloat(m[1].replace(/,/g,'')))
    .filter(n => n > 0);
  if (rupeeHits.length > 0) total = Math.max(...rupeeHits);

  // Tier 2: "Total" / "Grand Total" keyword + number
  if (total === 0) {
    const tp = [
      /(?:grand\s*total|net\s*payable|amount\s*paid|amount\s*due|total\s*payable|net\s*total|total\s*bill)[\s:\u20b9Rs₹]*([\d,]+\.?\d{0,2})/i,
      /(?:^|\n)\s*total[\s:\u20b9Rs₹]*([\d,]+\.?\d{0,2})/im,
    ];
    for (const p of tp) {
      const m = text.match(p);
      if (m) { const v = parseFloat(m[1].replace(/,/g,'')); if (v > 0) { total = v; break; } }
    }
  }

  // Tier 3: largest standalone number — but EXCLUDE unit suffixes (NOS, PCS, KGS) and % rates
  if (total === 0) {
    const nums = [...text.matchAll(/\b([\d,]+(?:\.\d{2})?)\b(?!\s*(?:%|NOS|nos|Nos|PCS|pcs|KGS?|kgs?|units?|Nos\b))/g)]
      .map(m => parseFloat(m[1].replace(/,/g,'')))
      .filter(n => n >= 10 && n < 10_000_000);
    if (nums.length) total = Math.max(...nums);
  }

  // ── GST (CGST + SGST + IGST) ──────────────────────────────────────────────────
  // Per-line: for each line containing cgst/sgst/igst, grab LAST number (the amount, not the %)
  let gst = 0;
  const taxLines = lines.filter(l => /\b(cgst|sgst|igst|utgst)\b/i.test(l));
  if (taxLines.length > 0) {
    for (const tl of taxLines) {
      const nums = [...tl.matchAll(/([\d,]+(?:\.\d{1,2})?)/g)]
        .map(m => parseFloat(m[1].replace(/,/g,'')))
        .filter(n => n > 0 && n < total * 0.8);  // exclude values >= 80% of total (likely the subtotal column)
      if (nums.length) gst += nums[nums.length - 1]; // last number = amount column
    }
  } else {
    // fallback single GST pattern
    const m = text.match(/(?:gst|tax)[\s:@\u20b9Rs₹%]*(\d[\d,]*\.?\d{0,2})/i);
    if (m) gst = parseFloat(m[1].replace(/,/g,''));
  }

  const amount = (total > 0 && gst > 0 && gst < total) ? +(total - gst).toFixed(2) : total;

  // ── Description ───────────────────────────────────────────────────────────────
  let description = '';

  // Look for "Description of Goods" table items
  const descSection = text.match(/description\s+of\s+goods[\s\S]{0,30}\n([\s\S]*?)(?:\n\s*(?:total|cgst|sgst|igst|amount))/i);
  if (descSection) {
    const itemLines = descSection[1].split('\n')
      .map(l => l.trim())
      .filter(l => l.length > 3 && /[a-zA-Z]{3,}/.test(l) && !/^\d+$/.test(l) && !/^(hsn|sac|quantity|rate|per|nos|pcs)/i.test(l));
    if (itemLines.length) description = itemLines.slice(0,3).join(', ');
  }

  if (!description) {
    const m = text.match(/(?:description|particulars|item|service|for)[\s:]+([^\n]{5,80})/i);
    if (m) description = m[1].trim();
  }

  // Fallback: first non-header line with alphabetic content
  if (!description) {
    const skip = /^(tax\s*invoice|delivery|invoice|receipt|bill|total|amount|gst|tax|challan|gstin|state|contact|phone|email|printed|buyer|consignee|dispatch|reference|bank|dated|no\.|from|to\s)/i;
    const c = lines.slice(1, 10).find(l => /[a-zA-Z]{4,}/.test(l) && l.length > 4 && l.length < 100 && !skip.test(l));
    if (c) description = c;
  }

  // ── Category ──────────────────────────────────────────────────────────────────
  let suggestedCategory = 'other';
  if (/rapido|ola|uber|cab|taxi|auto\s*ride|flight|train|bus|fuel|petrol|diesel|toll|transport|porter|logistics/i.test(text))
    suggestedCategory = 'travel';
  else if (/food|restaurant|cafe|coffee|lunch|dinner|swiggy|zomato|pizza|burger|meal|canteen|bisleri|aqua/i.test(text))
    suggestedCategory = 'consumables';
  else if (/stationery|office supply|amazon|flipkart|laptop|printer|keyboard|mouse|tools?|hardware|cnc|hardcut|boring|machining|turning|lathe|drill|cutting|tooling/i.test(text))
    suggestedCategory = 'consumables';
  else if (/electricity|power|water\s*supply|rent|internet|broadband|telephone|mobile\s*bill|utility/i.test(text))
    suggestedCategory = 'overhead';
  else if (/advance|deposit|prepaid|token|booking\s*amount/i.test(text))
    suggestedCategory = 'advance';

  return {
    vendor:      vendor || lines[0]?.replace(/[^a-zA-Z0-9\s&.'()\-]/g,'').trim() || 'Unknown Vendor',
    invoice_no:  invoiceNo,
    date,
    amount:      amount > 0 ? amount.toFixed(2) : (total > 0 ? total.toFixed(2) : ''),
    gst:         gst.toFixed(2),
    total:       total > 0 ? total.toFixed(2) : '',
    description: description.slice(0, 200),
    suggestedCategory,
    source:      'tesseract',
  };
}

router.post('/', authenticate, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No image uploaded' });
  const imagePath = req.file.path;
  try {
    const rawText = await runOCR(imagePath);
    if (rawText) {
      console.log('[OCR raw]', rawText.slice(0, 500));  // debug log
      res.json(parseOCRText(rawText));
    } else {
      res.json({
        vendor:'', invoice_no:'', date: new Date().toISOString().slice(0,10),
        amount:'', gst:'0.00', total:'', description:'',
        suggestedCategory:'other', source:'manual',
        message:'Could not read text from image. Please fill in manually.',
      });
    }
  } catch (err) {
    console.error('[OCR Route]', err.message);
    res.status(500).json({ error: err.message });
  } finally {
    try { fs.unlinkSync(imagePath); } catch(e){}
  }
});

module.exports = router;
