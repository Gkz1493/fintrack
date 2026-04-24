const express  = require('express');
const multer   = require('multer');
const path     = require('path');
const fs       = require('fs');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// ── multer — accept images AND pdf ───────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(process.env.RAILWAY_VOLUME_MOUNT_PATH || '/tmp', 'uploads');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname),
});
const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif|webp|pdf/i;
    cb(null, allowed.test(path.extname(file.originalname)));
  },
});

// ── shared invoice-extraction prompt ─────────────────────────────────────────
const EXTRACT_PROMPT = `You are an expert at reading Indian invoices, bills, and receipts.
Extract the following fields and return ONLY a valid JSON object — no markdown fences, no explanation.

Fields:
- vendor: the seller/merchant company name (string)
- invoice_no: invoice number, bill number, or receipt number (string)
- date: document date in YYYY-MM-DD format (string)
- amount: base amount BEFORE taxes — if not shown, compute total minus all GST (number)
- gst: total GST = CGST + SGST combined, or IGST alone (number, 0 if none)
- total: final payable amount INCLUDING all taxes — look for "Grand Total", "Net Payable", "TOTAL:-", "Total Amount", "Amount Payable" (number)
- description: brief description of goods or services (string)
- suggestedCategory: EXACTLY one of: consumables, travel, advance, overhead, other
  consumables = food, groceries, stationery, office supplies, printing
  travel = transport, fuel, cab, flight, hotel, toll, parking
  advance = advance payment, deposit, prepayment
  overhead = rent, utilities, equipment, machinery, valves, hardware, professional services, repairs, software
  other = anything else

Use null for any field you cannot find. Return ONLY the JSON.`;

// ── Claude Vision (for images) ────────────────────────────────────────────────
async function extractImageWithClaude(imagePath) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  try {
    const base64Image = fs.readFileSync(imagePath).toString('base64');
    const ext = path.extname(imagePath).toLowerCase();
    const mediaTypeMap = { '.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.gif':'image/gif','.webp':'image/webp' };
    const mediaType = mediaTypeMap[ext] || 'image/jpeg';

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-3-5-haiku-20241022',
        max_tokens: 1024,
        messages: [{ role: 'user', content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64Image } },
          { type: 'text', text: EXTRACT_PROMPT },
        ]}],
      }),
    });
    if (!response.ok) { console.error('Claude Vision error:', response.status); return null; }
    const data = await response.json();
    return parseClaudeResponse(data.content[0].text, 'claude-vision');
  } catch (err) {
    console.error('Claude Vision error:', err.message);
    return null;
  }
}

// ── Claude Text (for PDFs — text extracted first, then sent as text) ──────────
async function extractPdfWithClaude(pdfPath) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  try {
    // 1. Extract raw text from the PDF
    const pdfParse = require('pdf-parse');
    const buffer = fs.readFileSync(pdfPath);
    const pdfData = await pdfParse(buffer);
    const rawText = pdfData.text.trim();

    if (!rawText || rawText.length < 20) {
      console.log('PDF text too short, cannot extract');
      return null;
    }
    console.log('PDF text extracted, length:', rawText.length);

    // 2. Send as plain text to Claude Haiku
    if (!apiKey) {
      // No API key — fall back to regex parsing of extracted text
      return parsePlainText(rawText, 'tesseract');
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-3-5-haiku-20241022',
        max_tokens: 1024,
        messages: [{ role: 'user', content:
          EXTRACT_PROMPT + '\n\nHere is the raw text extracted from the PDF invoice:\n\n' + rawText,
        }],
      }),
    });
    if (!response.ok) { console.error('Claude PDF text error:', response.status); return parsePlainText(rawText, 'tesseract'); }
    const data = await response.json();
    return parseClaudeResponse(data.content[0].text, 'claude-pdf');
  } catch (err) {
    console.error('PDF extraction error:', err.message);
    return null;
  }
}

// ── Parse Claude JSON response ────────────────────────────────────────────────
function parseClaudeResponse(text, source) {
  try {
    const cleaned = text.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/,'').trim();
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) { console.error('No JSON in Claude response'); return null; }
    const parsed = JSON.parse(match[0]);
    const validCats = ['consumables','travel','advance','overhead','other'];
    if (!validCats.includes(parsed.suggestedCategory)) parsed.suggestedCategory = 'other';
    return { ...parsed, source };
  } catch (err) {
    console.error('JSON parse error:', err.message);
    return null;
  }
}

// ── Tesseract fallback (images only) ─────────────────────────────────────────
async function runTesseract(imagePath) {
  try {
    const Tesseract = require('tesseract.js');
    const { data: { text } } = await Tesseract.recognize(imagePath, 'eng');
    return text;
  } catch (err) { console.error('Tesseract error:', err.message); return ''; }
}

// ── Shared plain-text parser (regex, used when no API key) ───────────────────
function parsePlainText(text, source) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const vendor = lines.find(l => l.length > 2) || null;

  let invoice_no = null;
  for (const line of lines) {
    const m = line.match(/(?:invoice|bill|receipt|ref)\s*(?:no|num|number|#)?[\s:.-]*([A-Z0-9\/\-]+)/i);
    if (m && m[1].length >= 2) { invoice_no = m[1]; break; }
  }

  const monthMap = {jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12};
  let date = null;
  for (const line of lines) {
    let m = line.match(/(\d{1,2})[\-\/](jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[\-\/](\d{2,4})/i);
    if (m) { const y=m[3].length===2?'20'+m[3]:m[3]; date=y+'-'+String(monthMap[m[2].toLowerCase()]).padStart(2,'0')+'-'+m[1].padStart(2,'0'); break; }
    m = line.match(/(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})/);
    if (m) { const y=m[3].length===2?'20'+m[3]:m[3]; date=y+'-'+m[2].padStart(2,'0')+'-'+m[1].padStart(2,'0'); break; }
  }

  let gst = 0;
  for (const line of lines) {
    if (/CGST|SGST|IGST/i.test(line)) {
      const m = line.match(/(\d[\d,]*\.?\d*)/);
      if (m) gst += parseFloat(m[1].replace(/,/g,''));
    }
  }

  const skipLine = /\b(HSN|SAC|GSTIN|CIN|PAN|QTY|NOS|PCS|SL\.?NO|SR\.?NO|S\.NO)\b/i;
  let total = null;
  const totalKw = /\b(grand\s*total|net\s*payable|total\s*amount|amount\s*payable|total\s*due|invoice\s*total|bill\s*amount|total[\s:-]+|TOTAL\s*:-)\b/i;
  for (const line of lines) {
    if (skipLine.test(line)) continue;
    if (totalKw.test(line)) {
      const nums = [...line.matchAll(/(\d[\d,]*\.\d{1,2}|\d{1,6}(?:,\d{3})*)/g)];
      if (nums.length) { total = parseFloat(nums[nums.length-1][1].replace(/,/g,'')); break; }
    }
  }
  if (!total) {
    const amounts = [];
    for (const line of lines) {
      if (skipLine.test(line)) continue;
      const hits = [...line.matchAll(/(?:Rs\.?|INR|\u20b9)\s*(\d[\d,]*(?:\.\d{1,2})?)|\b(\d{1,6}(?:,\d{3})*\.\d{2})\b/g)];
      hits.forEach(m => { const n=parseFloat((m[1]||m[2]||'').replace(/,/g,'')); if(n>0&&n<10000000) amounts.push(n); });
    }
    if (amounts.length) total = Math.max(...amounts);
  }
  const amount = (total&&gst)?+(total-gst).toFixed(2):total;
  return { vendor, invoice_no, date, amount:amount||null, gst:gst||null, total, description:null, suggestedCategory:'other', source };
}

// ── POST /api/ocr ─────────────────────────────────────────────────────────────
router.post('/', authenticate, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const filePath = req.file.path;
  const ext = path.extname(filePath).toLowerCase();
  const isPdf = ext === '.pdf';

  try {
    let result = null;

    if (isPdf) {
      // ── PDF path ──────────────────────────────────────────────────────────
      console.log('OCR: PDF detected, extracting text');
      result = await extractPdfWithClaude(filePath);
    } else {
      // ── Image path ────────────────────────────────────────────────────────
      result = await extractImageWithClaude(filePath);
      if (!result) {
        console.log('OCR: Claude Vision failed, falling back to Tesseract');
        const text = await runTesseract(filePath);
        if (text) result = parsePlainText(text, 'tesseract');
      }
    }

    if (result) {
      console.log('OCR success — vendor:', result.vendor, '| total:', result.total, '| source:', result.source);
      return res.json(result);
    }

    return res.json({ vendor:null, invoice_no:null, date:null, amount:null, gst:null, total:null, description:null, suggestedCategory:'other', source:'manual' });
  } catch (err) {
    console.error('OCR route error:', err);
    return res.status(500).json({ error: 'OCR processing failed', details: err.message });
  } finally {
    try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch (e) {}
  }
});

module.exports = router;
