/**
 * OCR Route — uses Google Cloud Vision API to extract text from bill/receipt images.
 * Falls back to returning empty fields if Vision API is not configured.
 */
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

async function callVisionAPI(imagePath) {
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_KEY) return null;
  try {
    const { google } = require('googleapis');
    const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/cloud-platform'],
    });
    const authClient = await auth.getClient();
    const imageContent = fs.readFileSync(imagePath).toString('base64');
    const res = await authClient.request({
      url: 'https://vision.googleapis.com/v1/images:annotate',
      method: 'POST',
      data: {
        requests: [{
          image: { content: imageContent },
          features: [{ type: 'DOCUMENT_TEXT_DETECTION', maxResults: 1 }],
        }],
      },
    });
    return res.data?.responses?.[0]?.fullTextAnnotation?.text || null;
  } catch (err) {
    console.error('[Vision API]', err.message);
    return null;
  }
}

function parseOCRText(rawText) {
  if (!rawText) return null;
  const lines = rawText.split('\n').map(l => l.trim()).filter(Boolean);
  const text  = rawText;
  let vendor = '';
  for (const line of lines.slice(0, 5)) {
    if (/[a-zA-Z]{3,}/.test(line) && !/^(date|time|bill|invoice|receipt|order|#)/i.test(line)) {
      vendor = line.replace(/[^a-zA-Z0-9\s&.'()\-]/g, '').trim();
      if (vendor.length >= 3) break;
    }
  }
  let invoiceNo = '';
  const invPatterns = [
    /(?:invoice|receipt|bill|booking|order|txn|transaction|ref|ticket)[\s#:no.]*([A-Z0-9\/_\-]{4,25})/i,
    /\b(?:no|num|id)[\s:.#]*([A-Z0-9_\-]{5,20})\b/i,
    /#\s*([A-Z0-9\-]{4,20})/i,
  ];
  for (const p of invPatterns) { const m = text.match(p); if (m && m[1]) { invoiceNo = m[1].trim(); break; } }
  let date = new Date().toISOString().slice(0, 10);
  const MONTHS = { jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12 };
  const datePatterns = [
    { re: /(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/, fn: m => `${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}` },
    { re: /(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})/, fn: m => `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}` },
    { re: /(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s+(\d{4})/i,
      fn: m => `${m[3]}-${String(MONTHS[m[2].slice(0,3).toLowerCase()]).padStart(2,'0')}-${m[1].padStart(2,'0')}` },
  ];
  for (const { re, fn } of datePatterns) { const m = text.match(re); if (m) { try { date = fn(m); } catch(e){} break; } }
  let total = 0;
  const totalPatterns = [
    /(?:total amount|grand total|net payable|amount paid|amount due|total payable|to pay|net total|final amount)[\s:\u20b9Rs]*([\d,]+\.?\d{0,2})/i,
    /(?:^|\n)total[\s:\u20b9Rs]*([\d,]+\.?\d{0,2})/im,
  ];
  for (const p of totalPatterns) { const m = text.match(p); if (m) { total = parseFloat(m[1].replace(/,/g,'')); break; } }
  let gst = 0;
  const taxPatterns = [ /(?:gst|igst|sgst|cgst|service tax|tax amount)[\s:@\u20b9Rs%]*([\d,]+\.?\d{0,2})/i ];
  for (const p of taxPatterns) { const m = text.match(p); if (m) { gst = parseFloat(m[1].replace(/,/g,'')); break; } }
  let amount = total > 0 && gst > 0 ? total - gst : total;
  let description = '';
  const descPatterns = [ /(?:description|particulars|item|service|for)[\s:]+([^\n]{5,80})/i ];
  for (const p of descPatterns) { const m = text.match(p); if (m) { description = m[1].trim(); break; } }
  if (!description && lines.length > 2) { const c = lines.slice(1,4).find(l => /[a-zA-Z]{4,}/.test(l) && l.length > 5 && l.length < 80); if (c) description = c; }
  let suggestedCategory = 'other';
  if (/rapido|ola|uber|cab|taxi|auto|ride|flight|train|bus|fuel|petrol|diesel|toll|transport/i.test(text)) suggestedCategory = 'travel';
  else if (/food|restaurant|cafe|coffee|lunch|dinner|swiggy|zomato|pizza|burger|meal/i.test(text)) suggestedCategory = 'consumables';
  else if (/stationery|office supply|amazon|flipkart|laptop|printer|keyboard|mouse/i.test(text)) suggestedCategory = 'consumables';
  else if (/electricity|power|water|rent|internet|broadband|telephone|mobile|utility/i.test(text)) suggestedCategory = 'overhead';
  else if (/advance|deposit|prepaid|token|booking amount/i.test(text)) suggestedCategory = 'advance';
  return { vendor: vendor || 'Unknown Vendor', invoice_no: invoiceNo, date, amount: amount > 0 ? amount.toFixed(2) : total.toFixed(2), gst: gst.toFixed(2), total: total.toFixed(2), description: description.slice(0,200), suggestedCategory, source: 'google_vision' };
}

router.post('/', authenticate, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No image uploaded' });
  const imagePath = req.file.path;
  let result = null;
  try {
    const rawText = await callVisionAPI(imagePath);
    if (rawText) {
      result = parseOCRText(rawText);
    } else {
      result = { vendor:'', invoice_no:'', date: new Date().toISOString().slice(0,10), amount:'', gst:'0.00', total:'', description:'', suggestedCategory:'other', source:'manual', message:'Google Vision API not configured. Please fill in details manually.' };
    }
  } catch (err) {
    console.error('[OCR]', err.message);
    result = { error: err.message, source: 'error' };
  } finally {
    try { fs.unlinkSync(imagePath); } catch(e){}
  }
  res.json(result);
});

module.exports = router;
