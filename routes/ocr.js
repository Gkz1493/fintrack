const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(process.env.RAILWAY_VOLUME_MOUNT_PATH || '/tmp', 'uploads');
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + '-' + file.originalname);
  }
});
const upload = multer({ storage });

async function extractWithClaude(imagePath) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) { console.log('No ANTHROPIC_API_KEY, skipping Claude Vision'); return null; }
  try {
    const base64Image = fs.readFileSync(imagePath).toString('base64');
    const ext = path.extname(imagePath).toLowerCase();
    const mediaTypeMap = { '.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.gif':'image/gif','.webp':'image/webp' };
    const mediaType = mediaTypeMap[ext] || 'image/jpeg';
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        messages: [{ role: 'user', content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64Image } },
          { type: 'text', text: 'You are an invoice data extractor. Read this invoice and return ONLY a JSON object with these keys: vendor (string), invoice_no (string), date (YYYY-MM-DD), amount (number, excluding GST), gst (number, CGST+SGST combined), total (number), description (string), suggestedCategory (one of: Food & Beverage, Travel, Office Supplies, Equipment, Services, Utilities, Marketing, Other). Use null for missing fields. No explanation, only JSON.' }
        ]}]
      })
    });
    if (!response.ok) { console.error('Claude API error:', response.status); return null; }
    const data = await response.json();
    const text = data.content[0].text;
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) { console.error('No JSON in Claude response'); return null; }
    return { ...JSON.parse(match[0]), source: 'claude-vision' };
  } catch (err) {
    console.error('Claude Vision error:', err.message);
    return null;
  }
}

async function runTesseract(imagePath) {
  try {
    const Tesseract = require('tesseract.js');
    const { data: { text } } = await Tesseract.recognize(imagePath, 'eng');
    return text;
  } catch (err) { console.error('Tesseract error:', err.message); return ''; }
}

function parseTesseractText(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const vendor = lines[0] || null;
  let invoice_no = null;
  for (const line of lines) {
    const m = line.match(/(?:invoice|bill|receipt)\s*(?:no|num|number|#)?[\s:.-]*([A-Z0-9\/\-]+)/i);
    if (m) { invoice_no = m[1]; break; }
  }
  const monthMap = { jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12 };
  let date = null;
  for (const line of lines) {
    let m = line.match(/(\d{1,2})[-\/\s](jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[-\/\s](\d{2,4})/i);
    if (m) {
      const day = m[1].padStart(2,'0'), month = String(monthMap[m[2].toLowerCase()]).padStart(2,'0');
      let year = m[3]; if (year.length===2) year='20'+year;
      date = year+'-'+month+'-'+day; break;
    }
    m = line.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
    if (m) {
      const day = m[1].padStart(2,'0'), month = m[2].padStart(2,'0');
      let year = m[3]; if (year.length===2) year='20'+year;
      date = year+'-'+month+'-'+day; break;
    }
  }
  let total = null, amounts = [];
  for (const line of lines) {
    if (/NOS|PCS|QTY|QUANTITY|HSN|SAC/i.test(line)) continue;
    const matches = line.match(/(?:Rs\.?|INR|\u20b9)?\s*(\d[\d,]*\.?\d*)/g);
    if (matches) matches.forEach(m => { const n = parseFloat(m.replace(/[^0-9.]/g,'')); if(n>0) amounts.push(n); });
  }
  if (amounts.length > 0) total = Math.max(...amounts);
  let gst = 0;
  for (const line of lines) {
    if (/CGST|SGST/i.test(line)) { const m = line.match(/(\d[\d,]*\.?\d*)/); if(m) gst += parseFloat(m[1].replace(/,/g,'')); }
  }
  const amount = (total && gst) ? total - gst : total;
  return { vendor, invoice_no, date, amount: amount||null, gst: gst||null, total, description: null, suggestedCategory: 'Other', source: 'tesseract' };
}

router.post('/', authenticate, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const imagePath = req.file.path;
  try {
    const claudeResult = await extractWithClaude(imagePath);
    if (claudeResult) { console.log('OCR: Claude Vision succeeded'); return res.json(claudeResult); }
    console.log('OCR: Falling back to Tesseract');
    const ocrText = await runTesseract(imagePath);
    if (ocrText) return res.json(parseTesseractText(ocrText));
    return res.json({ vendor:null, invoice_no:null, date:null, amount:null, gst:null, total:null, description:null, suggestedCategory:'Other', source:'manual' });
  } catch (err) {
    console.error('OCR route error:', err);
    return res.status(500).json({ error: 'OCR processing failed', details: err.message });
  } finally {
    try { if (fs.existsSync(imagePath)) fs.unlinkSync(imagePath); } catch(e) { console.error('Cleanup error:', e.message); }
  }
});

module.exports = router;
