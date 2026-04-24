const express  = require('express');
const multer   = require('multer');
const path     = require('path');
const fs       = require('fs');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// ── multer storage ────────────────────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(process.env.RAILWAY_VOLUME_MOUNT_PATH || '/tmp', 'uploads');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname),
});
const upload = multer({ storage });

// ── Claude Vision extraction ──────────────────────────────────────────────────
async function extractWithClaude(imagePath) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) { console.log('No ANTHROPIC_API_KEY'); return null; }

  try {
    const base64Image = fs.readFileSync(imagePath).toString('base64');
    const ext = path.extname(imagePath).toLowerCase();
    const mediaTypeMap = {
      '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
      '.png': 'image/png',  '.gif': 'image/gif', '.webp': 'image/webp',
    };
    const mediaType = mediaTypeMap[ext] || 'image/jpeg';

    const prompt = `You are an expert at reading Indian invoices, bills, and receipts.
Extract the following fields and return ONLY a valid JSON object — no markdown, no explanation, just raw JSON.

Fields to extract:
- vendor: the seller/merchant company name (string)
- invoice_no: invoice number, bill number, or receipt number (string)
- date: document date in YYYY-MM-DD format (string)
- amount: base amount BEFORE taxes — if not explicitly shown, calculate as total minus all GST (number)
- gst: total GST = CGST + SGST, or IGST alone (number, 0 if not applicable)
- total: the final payable amount INCLUDING all taxes — look for "Grand Total", "Net Payable", "Total Amount", "Amount Payable" (number)
- description: brief description of goods or services purchased (string)
- suggestedCategory: classify into EXACTLY one of these IDs: consumables, travel, advance, overhead, other
  - consumables = food, groceries, stationery, office supplies, printing
  - travel = transport, fuel, cab, flight, hotel, toll, parking
  - advance = advance payment, deposit, prepayment
  - overhead = rent, utilities, equipment, software, professional services, repairs
  - other = anything that does not fit the above

Use null for any field you cannot find. Return ONLY the JSON object.`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64Image } },
            { type: 'text', text: prompt },
          ],
        }],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('Claude API error:', response.status, errText);
      return null;
    }

    const data = await response.json();
    const text = data.content[0].text.trim();
    // Strip markdown code fences if present
    const cleaned = text.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/, '').trim();
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) { console.error('No JSON in Claude response:', text); return null; }

    const parsed = JSON.parse(match[0]);

    // Normalise category to known IDs
    const validCats = ['consumables', 'travel', 'advance', 'overhead', 'other'];
    if (!validCats.includes(parsed.suggestedCategory)) {
      parsed.suggestedCategory = 'other';
    }

    return { ...parsed, source: 'claude-vision' };
  } catch (err) {
    console.error('Claude Vision error:', err.message);
    return null;
  }
}

// ── Tesseract OCR fallback ────────────────────────────────────────────────────
async function runTesseract(imagePath) {
  try {
    const Tesseract = require('tesseract.js');
    const { data: { text } } = await Tesseract.recognize(imagePath, 'eng');
    return text;
  } catch (err) {
    console.error('Tesseract error:', err.message);
    return '';
  }
}

function parseTesseractText(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

  // ── Vendor: first non-trivial line ───────────────────────────────────────
  const vendor = lines.find(l => l.length > 2) || null;

  // ── Invoice number ───────────────────────────────────────────────────────
  let invoice_no = null;
  for (const line of lines) {
    const m = line.match(/(?:invoice|bill|receipt|ref)\s*(?:no|num|number|#)?[\s:.-]*([A-Z0-9\/\-]+)/i);
    if (m && m[1].length >= 2) { invoice_no = m[1]; break; }
  }

  // ── Date ─────────────────────────────────────────────────────────────────
  const monthMap = { jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12 };
  let date = null;
  for (const line of lines) {
    let m = line.match(/(\d{1,2})[\-\/\s](jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[\-\/\s](\d{2,4})/i);
    if (m) {
      const day = m[1].padStart(2,'0'), month = String(monthMap[m[2].toLowerCase()]).padStart(2,'0');
      const year = m[3].length === 2 ? '20'+m[3] : m[3];
      date = year+'-'+month+'-'+day; break;
    }
    m = line.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
    if (m) {
      const day = m[1].padStart(2,'0'), month = m[2].padStart(2,'0');
      const year = m[3].length === 2 ? '20'+m[3] : m[3];
      date = year+'-'+month+'-'+day; break;
    }
  }

  // ── GST (CGST + SGST / IGST) ─────────────────────────────────────────────
  let gst = 0;
  for (const line of lines) {
    if (/CGST|SGST|IGST/i.test(line)) {
      const m = line.match(/(\d[\d,]*\.?\d*)/);
      if (m) gst += parseFloat(m[1].replace(/,/g, ''));
    }
  }

  // ── Amount / Total — priority: labelled "total" lines ────────────────────
  // Avoid HSN codes (pure integers with 6+ digits), quantities, serial numbers
  const skipLine = /\b(HSN|SAC|GSTIN|CIN|PAN|QTY|NOS|PCS|SL\.?NO|SR\.?NO|S\.NO)\b/i;

  let total = null;

  // 1) Look for explicit "total" keywords first
  const totalKeywords = /\b(grand\s*total|net\s*payable|total\s*amount|amount\s*payable|total\s*due|invoice\s*total|bill\s*amount|total\s*bill|payable\s*amount)\b/i;
  for (const line of lines) {
    if (skipLine.test(line)) continue;
    if (totalKeywords.test(line)) {
      // grab rightmost/last number on this line
      const nums = [...line.matchAll(/(\d[\d,]*\.\d{1,2}|\d{1,6}(?:,\d{3})*)/g)];
      if (nums.length) {
        const candidate = parseFloat(nums[nums.length - 1][1].replace(/,/g, ''));
        if (candidate > 0) { total = candidate; break; }
      }
    }
  }

  // 2) Fallback: collect reasonable currency amounts (must have decimal or ₹/Rs prefix)
  if (!total) {
    const amounts = [];
    for (const line of lines) {
      if (skipLine.test(line)) continue;
      // Only pick numbers that look like money: have decimals, or are preceded by ₹/Rs
      const moneyMatches = [...line.matchAll(/(?:Rs\.?|INR|\u20b9)\s*(\d[\d,]*(?:\.\d{1,2})?)|\b(\d{1,6}(?:,\d{3})*\.\d{2})\b/g)];
      moneyMatches.forEach(m => {
        const raw = (m[1] || m[2] || '').replace(/,/g, '');
        const n = parseFloat(raw);
        if (n > 0 && n < 10000000) amounts.push(n); // cap 1 Cr
      });
    }
    if (amounts.length) total = Math.max(...amounts);
  }

  // Derive base amount
  const amount = (total !== null && gst > 0) ? +(total - gst).toFixed(2) : total;

  return {
    vendor,
    invoice_no,
    date,
    amount: amount || null,
    gst: gst || null,
    total,
    description: null,
    suggestedCategory: 'other',
    source: 'tesseract',
  };
}

// ── POST /api/ocr ─────────────────────────────────────────────────────────────
router.post('/', authenticate, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const imagePath = req.file.path;
  try {
    const claudeResult = await extractWithClaude(imagePath);
    if (claudeResult) {
      console.log('OCR: Claude Vision succeeded, vendor=', claudeResult.vendor, 'total=', claudeResult.total);
      return res.json(claudeResult);
    }

    console.log('OCR: Falling back to Tesseract');
    const ocrText = await runTesseract(imagePath);
    if (ocrText) return res.json(parseTesseractText(ocrText));

    return res.json({
      vendor: null, invoice_no: null, date: null,
      amount: null, gst: null, total: null,
      description: null, suggestedCategory: 'other', source: 'manual',
    });
  } catch (err) {
    console.error('OCR route error:', err);
    return res.status(500).json({ error: 'OCR processing failed', details: err.message });
  } finally {
    try { if (fs.existsSync(imagePath)) fs.unlinkSync(imagePath); } catch (e) {}
  }
});

module.exports = router;
