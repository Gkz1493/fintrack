const express  = require('express');
const multer   = require('multer');
const path     = require('path');
const fs       = require('fs');
const { v4: uuidv4 } = require('uuid');
const db       = require('../db');
const { authenticate, adminOnly } = require('../middleware/auth');

const router = express.Router();

// âââ Multer config ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '..', 'uploads', 'temp');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    cb(null, `${uuidv4()}${path.extname(file.originalname)}`);
  },
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });

// âââ Google Drive helper ââââââââââââââââââââââââââââââââââââââââââââââââââââââ
let driveClient = null;
const folderCache = new Map();

async function getDriveClient() {
  if (driveClient) return driveClient;
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_KEY) return null;
  try {
    const { google } = require('googleapis');
    const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
    const auth = new google.auth.GoogleAuth({ credentials, scopes: ['https://www.googleapis.com/auth/drive'] });
    driveClient = google.drive({ version: 'v3', auth });
    return driveClient;
  } catch (e) {
    console.warn('Google Drive not configured:', e.message);
    return null;
  }
}

async function getOrCreateDriveFolder(drive, name, parentId) {
  const key = `${parentId}:${name}`;
  if (folderCache.has(key)) return folderCache.get(key);
  const res = await drive.files.list({
    q: `name='${name}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: 'files(id)',
  });
  if (res.data.files.length > 0) {
    folderCache.set(key, res.data.files[0].id);
    return res.data.files[0].id;
  }
  const folder = await drive.files.create({
    requestBody: { name, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] },
    fields: 'id',
  });
  folderCache.set(key, folder.data.id);
  return folder.data.id;
}

async function uploadToDrive(localPath, filename, projectName, category) {
  const drive = await getDriveClient();
  if (!drive || !process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID) return { url: null, fileId: null };
  try {
    const rootId   = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID;
    const projId   = await getOrCreateDriveFolder(drive, projectName || 'Uncategorized', rootId);
    const catLabel = category ? category.charAt(0).toUpperCase() + category.slice(1) : 'Other';
    const catId    = await getOrCreateDriveFolder(drive, catLabel, projId);

    const mimeType = filename.match(/\.(png|jpg|jpeg)$/i) ? 'image/jpeg' : 'application/octet-stream';
    const res = await drive.files.create({
      requestBody: { name: filename, parents: [catId] },
      media: { mimeType, body: fs.createReadStream(localPath) },
      fields: 'id, webViewLink',
    });
    await drive.permissions.create({
      fileId: res.data.id,
      requestBody: { role: 'reader', type: 'anyone' },
    });
    return { url: res.data.webViewLink, fileId: res.data.id };
  } catch (e) {
    console.warn('Drive upload failed:', e.message);
    return { url: null, fileId: null };
  }
}

// âââ GET /api/expenses ââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
router.get('/', authenticate, async (req, res) => {
  try {
    let query = 'SELECT * FROM expenses';
    const params = [];
    const where = [];

    if (req.user.role !== 'admin') {
      where.push('uploaded_by_id = ?');
      params.push(req.user.id);
    }

    const { project, category, status, employee, search } = req.query;
    if (project)  { where.push('project_name = ?');     params.push(project); }
    if (category) { where.push('category = ?');          params.push(category); }
    if (status)   { where.push('status = ?');            params.push(status); }
    if (employee) { where.push('reimburse_to_name = ?'); params.push(employee); }
    if (search)   {
      where.push('(vendor ILIKE ? OR description ILIKE ? OR project_name ILIKE ?)');
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    if (where.length > 0) query += ' WHERE ' + where.join(' AND ');
    query += ' ORDER BY created_at DESC';

    const expenses = await db.all(query, params);
    res.json(expenses);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// âââ GET /api/expenses/stats ââââââââââââââââââââââââââââââââââââââââââââââââââ
router.get('/stats', authenticate, async (req, res) => {
  try {
    const all = await db.all('SELECT * FROM expenses');
    const stats = {
      total:        all.reduce((s, e) => s + parseFloat(e.total || 0), 0),
      pendingReimb: all.filter(e => e.is_reimbursement && e.status === 'pending').reduce((s, e) => s + parseFloat(e.total || 0), 0),
      count:        all.length,
      pending:      all.filter(e => e.status === 'pending').length,
      byProject:    {},
      byCategory:   {},
      byEmployee:   {},
    };
    all.forEach(e => {
      const total = parseFloat(e.total || 0);
      stats.byProject[e.project_name]  = (stats.byProject[e.project_name]  || 0) + total;
      stats.byCategory[e.category]     = (stats.byCategory[e.category]     || 0) + total;
      if (e.reimburse_to_name) {
        if (!stats.byEmployee[e.reimburse_to_name]) stats.byEmployee[e.reimburse_to_name] = { pending: 0, paid: 0 };
        if (e.status === 'pending') stats.byEmployee[e.reimburse_to_name].pending += total;
        if (e.status === 'paid')    stats.byEmployee[e.reimburse_to_name].paid    += total;
      }
    });
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// âââ GET /api/expenses/export/excel ââââââââââââââââââââââââââââââââââââââââââ
router.get('/export/excel', authenticate, async (req, res) => {
  try {
    const XLSX = require('xlsx');
    let expenses;
    if (req.user.role === 'admin') {
      expenses = await db.all('SELECT * FROM expenses ORDER BY created_at DESC');
    } else {
      expenses = await db.all('SELECT * FROM expenses WHERE uploaded_by_id = ? ORDER BY created_at DESC', [req.user.id]);
    }

    const rows = expenses.map(e => ({
      Date:           e.date,
      Vendor:         e.vendor,
      'Invoice No':   e.invoice_no,
      Description:    e.description,
      Category:       e.category,
      Project:        e.project_name,
      Amount:         parseFloat(e.amount || 0),
      GST:            parseFloat(e.gst || 0),
      Total:          parseFloat(e.total || 0),
      'Reimburse To': e.reimburse_to_name || '',
      'Uploaded By':  e.uploaded_by_name,
      Status:         e.status,
      'Drive Link':   e.drive_url || '',
    }));

    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Expenses');

    const projects = [...new Set(expenses.map(e => e.project_name))];
    const summary = projects.map(p => {
      const proj = expenses.filter(e => e.project_name === p);
      return { Project: p, 'Total Expenses': proj.reduce((s, e) => s + parseFloat(e.total || 0), 0), 'Bill Count': proj.length };
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summary), 'Summary');

    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Disposition', 'attachment; filename=FinTrack_Expenses.xlsx');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buffer);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// âââ GET /api/expenses/export/pdf ââââââââââââââââââââââââââââââââââââââââââââ
router.get('/export/pdf', authenticate, async (req, res) => {
  try {
    const { jsPDF } = require('jspdf');
    require('jspdf-autotable');

    let expenses;
    if (req.user.role === 'admin') {
      expenses = await db.all('SELECT * FROM expenses ORDER BY created_at DESC');
    } else {
      expenses = await db.all('SELECT * FROM expenses WHERE uploaded_by_id = ? ORDER BY created_at DESC', [req.user.id]);
    }

    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    doc.setFontSize(18);
    doc.text('FinTrack â Expense Report', 14, 20);
    doc.setFontSize(10);
    const grandTotal = expenses.reduce((s, e) => s + parseFloat(e.total || 0), 0);
    doc.text(`Generated: ${new Date().toLocaleString()}  |  Total: â¹${grandTotal.toLocaleString('en-IN')}`, 14, 28);

    doc.autoTable({
      startY: 34,
      head: [['Date', 'Vendor', 'Category', 'Project', 'Amount', 'GST', 'Total', 'Reimburse To', 'Status']],
      body: expenses.map(e => [
        e.date, e.vendor, e.category, e.project_name || '',
        `â¹${e.amount}`, `â¹${e.gst}`, `â¹${e.total}`,
        e.reimburse_to_name || 'â', e.status,
      ]),
      styles: { fontSize: 8 },
      headStyles: { fillColor: [99, 102, 241] },
      alternateRowStyles: { fillColor: [248, 249, 255] },
    });

    const pdfBuffer = Buffer.from(doc.output('arraybuffer'));
    res.setHeader('Content-Disposition', 'attachment; filename=FinTrack_Expenses.pdf');
    res.setHeader('Content-Type', 'application/pdf');
    res.send(pdfBuffer);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// âââ POST /api/expenses âââââââââââââââââââââââââââââââââââââââââââââââââââââââ
router.get('/reimburse-names', authenticate, async (req, res) => {  try {    const rows = await db.all('SELECT name FROM employees ORDER BY name');    res.json(rows.map(r => r.name));  } catch (err) { res.status(500).json({ error: err.message }); }});router.post('/', authenticate, upload.single('file'), async (req, res) => {
  try {
    const {
      vendor, invoice_no, amount, gst, total, description,
      date, category, project_name, is_reimbursement,
      reimburse_to_id, reimburse_to_name, advance_paid,
    } = req.body;

    if (!vendor || !total || !date || !category) {
      return res.status(400).json({ error: 'vendor, total, date, category are required' });
    }

    const id = uuidv4();
    let filePath = null;
    let driveUrl = null;
    let driveFileId = null;

    if (req.file) {
      const safeProj = (project_name || 'Uncategorized').replace(/[^a-zA-Z0-9 _-]/g, '');
      const safeCat  = (category || 'other').replace(/[^a-zA-Z0-9]/g, '');
      const destDir  = path.join(__dirname, '..', 'uploads', safeProj, safeCat);
      fs.mkdirSync(destDir, { recursive: true });

      const ext      = path.extname(req.file.originalname) || path.extname(req.file.filename);
      const newName  = `${date}_${vendor.replace(/[^a-zA-Z0-9]/g, '_').slice(0,30)}_${id.slice(0,8)}${ext}`;
      const destPath = path.join(destDir, newName);
      fs.renameSync(req.file.path, destPath);
      filePath = `/uploads/${safeProj}/${safeCat}/${newName}`;

      const drive = await uploadToDrive(destPath, newName, project_name, category);
      driveUrl    = drive.url;
      driveFileId = drive.fileId;
    }

    const project = await db.get('SELECT id FROM projects WHERE name = ?', [project_name]);

    await db.run(`
      INSERT INTO expenses (id, vendor, invoice_no, amount, gst, total, description, date,
        category, project_id, project_name, is_reimbursement, reimburse_to_id, reimburse_to_name,
        uploaded_by_id, uploaded_by_name, file_path, drive_url, drive_file_id, advance_paid)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `, [
      id, vendor, invoice_no || '',
      parseFloat(amount) || 0, parseFloat(gst) || 0, parseFloat(total) || 0,
      description || '', date, category,
      project?.id || null, project_name || '',
      is_reimbursement === 'true' || is_reimbursement === true ? 1 : 0,
      reimburse_to_id || null, reimburse_to_name || null,
      req.user.id, req.user.name,
      filePath, driveUrl, driveFileId,
      parseFloat(advance_paid) || 0,
    ]);

    const created = await db.get('SELECT * FROM expenses WHERE id = ?', [id]);
    res.status(201).json(created);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// âââ PUT /api/expenses/:id  (update expense) âââââââââââââââââââââââââââââââââ
router.put('/:id', authenticate, adminOnly, async (req, res) => {
  try {
    const { vendor, invoice_no, amount, gst, total, description, date, category,
            project_name, is_reimbursement, reimburse_to_id, reimburse_to_name,
            status, advance_paid } = req.body;

    const project = await db.get('SELECT id FROM projects WHERE name = ?', [project_name]);

    await db.run(`
      UPDATE expenses SET vendor=?, invoice_no=?, amount=?, gst=?, total=?, description=?,
        date=?, category=?, project_id=?, project_name=?, is_reimbursement=?,
        reimburse_to_id=?, reimburse_to_name=?, status=?, advance_paid=?
      WHERE id=?
    `, [
      vendor, invoice_no || '',
      parseFloat(amount) || 0, parseFloat(gst) || 0, parseFloat(total) || 0,
      description || '', date, category,
      project?.id || null, project_name || '',
      is_reimbursement ? 1 : 0,
      reimburse_to_id || null, reimburse_to_name || null,
      status || 'pending',
      parseFloat(advance_paid) || 0,
      req.params.id,
    ]);

    const updated = await db.get('SELECT * FROM expenses WHERE id = ?', [req.params.id]);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// âââ PUT /api/expenses/:id/status  (admin only) âââââââââââââââââââââââââââââââ
router.put('/:id/status', authenticate, adminOnly, async (req, res) => {
  try {
    const { status } = req.body;
    if (!['pending', 'approved', 'paid', 'rejected'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }
    await db.run('UPDATE expenses SET status = ? WHERE id = ?', [status, req.params.id]);
    res.json({ message: 'Status updated' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// âââ PUT /api/expenses/reimburse-all/:employeeName  (admin) ââââââââââââââââââ
router.put('/reimburse-all/:employeeName', authenticate, adminOnly, async (req, res) => {
  try {
    const result = await db.run(
      "UPDATE expenses SET status = 'paid' WHERE reimburse_to_name = ? AND status = 'pending'",
      [req.params.employeeName]
    );
    res.json({ updated: result.rowCount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// âââ PUT /api/expenses/:id/advance âââââââââââââââââââââââââââââââââââââââââââ
router.put('/:id/advance', authenticate, adminOnly, async (req, res) => {
  try {
    const { advance_paid } = req.body;
    await db.run('UPDATE expenses SET advance_paid = ? WHERE id = ?',
      [parseFloat(advance_paid) || 0, req.params.id]);
    const updated = await db.get('SELECT * FROM expenses WHERE id = ?', [req.params.id]);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// âââ DELETE /api/expenses/:id  (admin only) âââââââââââââââââââââââââââââââââââ
router.delete('/:id', authenticate, adminOnly, async (req, res) => {
  try {
    const expense = await db.get('SELECT * FROM expenses WHERE id = ?', [req.params.id]);
    if (!expense) return res.status(404).json({ error: 'Not found' });
    if (expense.file_path) {
      const localPath = path.join(__dirname, '..', expense.file_path);
      if (fs.existsSync(localPath)) fs.unlinkSync(localPath);
    }
    await db.run('DELETE FROM expenses WHERE id = ?', [req.params.id]);
    res.json({ message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
