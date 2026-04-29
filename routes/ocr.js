const express  = require('express');
const multer   = require('multer');
const path     = require('path');
const fs       = require('fs');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// ── Startup: confirm whether Anthropic key is available ───────────────────────
console.log('[OCR] ANTHROPIC_API_KEY:', process.env.ANTHROPIC_API_KEY ? 'SET ✓' : 'NOT SET — will use Tesseract/regex fallback');

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

// ── Resize image with sharp (keeps Claude under its size limit) ───────────────
async function prepareImageForClaude(imagePath) {
  const rawBuffer = fs.readFileSync(imagePath);
  const fileSizeMB = rawBuffer.length / (1024 * 1024);
  console.log(`[OCR] Image file size: ${fileSizeMB.toFixed(2)} MB`);

  // Always convert to JPEG + resize to max 1500px — ensures Claude accepts it
  try {
    const sharp = require('sharp');
    const resized = await sharp(rawBuffer)
      .rotate()                          // auto-rotate from EXIF (fixes sideways photos)
      .resize({ width: 1500, height: 1500, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toBuffer();
    const sizeMB = resized.length / (1024 * 1024);
    console.log(`[OCR] Resized to: ${sizeMB.toFixed(2)} MB (JPEG)`);
    return { buffer: resized, mediaType: 'image/jpeg' };
  } catch (sharpErr) {
    console.warn('[OCR] sharp not available, sending raw:', sharpErr.message);
    // Fallback: send raw but only if under 4MB base64 (~3MB file)
    if (rawBuffer.length > 3 * 1024 * 1024) {
      console.error('[OCR] Image too large for Claude without sharp resize — skipping Claude');
      return null;
    }
    const ext = path.extname(imagePath).toLowerCase();
    const mediaTypeMap = { '.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.gif':'image/gif','.webp':'image/webp' };
    return { buffer: rawBuffer, mediaType: mediaTypeMap[ext] || 'image/jpeg' };
  }
}

// ── Claude Vision (for images) ────────────────────────────────────────────────
async function extractImageWithClaude(imagePath) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  try {
    const prepared = await prepareImageForClaude(imagePath);
    if (!prepared) return null;

    const { buffer, mediaType } = prepared;
    const base64Image = buffer.toString('base64');

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

    if (!response.ok) {
      const errBody = await response.text().catch(() => '(no body)');
      console.error(`Claude Vision error: ${response.status} — ${errBody}`);
      return null;
    }

    const data = await response.json();
    if (!data.content?.[0]?.text) {
      console.error('Claude Vision: empty content in response', JSON.stringify(data));
      return null;
    }
    return parseClaudeResponse(data.content[0].text, 'claude-vision');
  } catch (err) {
    console.error('Claude Vision error:', err.message);
    return null;
  }
}

// ── Claude PDF extraction — 3-tier strategy ───────────────────────────────────
// Tier 1 (text-based PDF):  pdf-parse → extract text → Claude text API
// Tier 2 (scanned PDF):     Claude native PDF beta  → direct PDF reading
// Tier 3 (no API key):      pdf-parse text → regex parser
async function extractPdfWithClaude(pdfPath) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const pdfBuffer = fs.readFileSync(pdfPath);
  const fileSizeMB = pdfBuffer.length / (1024 * 1024);
  console.log(`[OCR] PDF size: ${fileSizeMB.toFixed(2)} MB`);

  // ── Step 1: Try extracting text with pdf-parse ──────────────────────────────
  let rawText = '';
  try {
    const pdfParse = require('pdf-parse');
    const pdfData  = await pdfParse(pdfBuffer);
    rawText = (pdfData.text || '').trim();
    console.log(`[OCR] PDF text chars extracted: ${rawText.length}`);
  } catch (e) {
    console.warn('[OCR] pdf-parse failed:', e.message);
  }

  // ── No API key → regex on whatever text we have ─────────────────────────────
  if (!apiKey) {
    if (rawText.length >= 20) return parsePlainText(rawText, 'regex');
    console.log('[OCR] No API key and no extractable text — cannot process this PDF');
    return null;
  }

  // ── Tier 1: Good text extracted → send as text to Claude ───────────────────
  if (rawText.length >= 50) {
    console.log('[OCR] PDF has text content — sending to Claude as text');
    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-3-5-haiku-20241022',
          max_tokens: 1024,
          messages: [{ role: 'user', content:
            EXTRACT_PROMPT + '\n\nHere is the raw text extracted from the PDF invoice:\n\n' + rawText.slice(0, 8000),
          }],
        }),
      });
      if (response.ok) {
        const data = await response.json();
        if (data.content?.[0]?.text) {
          console.log('[OCR] Claude PDF text extraction succeeded');
          return parseClaudeResponse(data.content[0].text, 'claude-pdf-text');
        }
      } else {
        const errBody = await response.text().catch(() => '');
        console.warn(`[OCR] Claude PDF text API: ${response.status} — ${errBody}`);
      }
    } catch (e) {
      console.warn('[OCR] Claude PDF text call failed:', e.message);
    }
    // Claude text failed but we have text — fall back to regex
    return parsePlainText(rawText, 'regex');
  }

  // ── Tier 2: Scanned PDF (little/no text) → Claude native PDF beta ──────────
  console.log('[OCR] PDF appears scanned (little text) — trying Claude native PDF reader');
  if (fileSizeMB > 20) {
    console.error('[OCR] PDF too large for Claude native read (>20MB) — aborting');
    return null;
  }
  try {
    const base64Pdf = pdfBuffer.toString('base64');
    const response  = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'pdfs-2024-09-25',   // enable native PDF support
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-3-5-haiku-20241022',
        max_tokens: 1024,
        messages: [{ role: 'user', content: [
          { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64Pdf } },
          { type: 'text', text: EXTRACT_PROMPT },
        ]}],
      }),
    });
    if (response.ok) {
      const data = await response.json();
      if (data.content?.[0]?.text) {
        console.log('[OCR] Claude native PDF read succeeded');
        return parseClaudeResponse(data.content[0].text, 'claude-pdf-native');
      }
    } else {
      const errBody = await response.text().catch(() => '');
      console.error(`[OCR] Claude native PDF error: ${response.status} — ${errBody}`);
    }
  } catch (e) {
    console.error('[OCR] Claude native PDF call failed:', e.message);
  }

  // ── Tier 3: Everything failed — best-effort regex on whatever text we have ──
  if (rawText.length > 0) return parsePlainText(rawText, 'regex');
  return null;
}

// ── Parse Claude JSON response ────────────────────────────────────────────────
function parseClaudeResponse(text, source) {
  try {
    // Strip all markdown code fences (opening and closing, with or without language tag)
    const cleaned = text
      .replace(/```(?:json)?\s*/gi, '')
      .replace(/```/g, '')
      .trim();
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) { console.error('No JSON in Claude response; raw text:', text.slice(0, 200)); return null; }
    const parsed = JSON.parse(match[0]);
    const validCats = ['consumables','travel','advance','overhead','other'];
    if (!validCats.includes(parsed.suggestedCategory)) parsed.suggestedCategory = 'other';
    // Coerce numeric fields that Claude might return as strings
    if (parsed.amount  != null) parsed.amount  = parseFloat(parsed.amount)  || null;
    if (parsed.gst     != null) parsed.gst     = parseFloat(parsed.gst)     || 0;
    if (parsed.total   != null) parsed.total   = parseFloat(parsed.total)   || null;
    return { ...parsed, source };
  } catch (err) {
    console.error('JSON parse error:', err.message, '| raw:', text ? text.slice(0, 200) : '(empty)');
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

  // Skip generic document-type header words to find the actual merchant name
  const headerWords = /^(tax\s*invoice|gst\s*invoice|invoice|receipt|bill|cash\s*memo|retail\s*invoice|credit\s*note|debit\s*note|quotation|purchase\s*order|delivery\s*note|original|duplicate|triplicate|original\s*for\s*recipient|subject\s*to|www\.|http)/i;
  const vendor = lines.find(l =>
    l.length > 3 &&
    !headerWords.test(l) &&
    !/^\d+$/.test(l) &&         // not a bare number
    !/^[\d\s\W]+$/.test(l)      // not only digits/symbols
  ) || lines.find(l => l.length > 2) || null;

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
        console.log('OCR: Claude Vision failed or key not set, falling back to Tesseract');
        const text = await runTesseract(filePath);
        // Always produce a result — parsePlainText with empty string returns all-null fields
        result = parsePlainText(text || '', 'tesseract');
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
