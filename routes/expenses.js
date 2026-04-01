const express  = require('express');
const multer   = require('multer');
const path     = require('path');
const fs       = require('fs');
const { v4: uuidv4 } = require('uuid');
const db       = require('../db');
const { authenticate, adminOnly } = require('../middleware/auth');

const router = express.Router();

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
    const projId   = await getOrCreateDriveFolder(drive, projectName  || 'Uncategorized', rootId);
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

router.get('/', authenticate, (req, res) => {
  let query = 'SELECT * FROM expenses';
  const params = [];
  if (req.user.role !== 'admin') {
    query += ' WHERE uploaded_by_id = ?';
    params.push(req.user.id);
  }
  const { project, category, status, employee, search } = req.query;
  const where = [];
  const whereParams = [];
  if (project)   { where.push('project_name = ?');        whereParams.push(project); }
  if (category)  { where.push('category = ?');             whereParams.push(category); }
  if (status)    { where.push('status = ?');               whereParams.push(status); }
  if (employee)  { where.push('reimburse_to_name = ?');    whereParams.push(employee); }
  if (search)    { where.push('(vendor LIKE ? OR description LIKE ? OR project_name LIKE ?)');
                   whereParams.push(`%${search}%`, `%${search}%`, `%${search}%`); }
  if (where.length > 0) {
    query += (req.user.role !== 'admin' ? ' AND ' : ' WHERE ') + where.join(' AND ');
    params.push(...whereParams);
  }
  query += ' ORDER BY created_at DESC';
  res.json(db.prepare(query).all(...params));
});

router.get('/stats', authenticate, (req, res) => {
  const all = db.prepare('SELECT * FROM expenses').all();
  /* --- cashflow in: sum all fund_releases from project_details --- */
  let cashflowIn = 0;
  try {
    db.prepare('SELECT fund_allocated FROM project_details').all().forEach(pd => {
      cashflowIn += Number(pd.fund_allocated) || 0;
    });
  } catch(e) {}
  const cashflowOut     = all.reduce((s,e)=>s+e.total,0);
  const pendingApproval = all.filter(e=>e.status==='pending').length;
  const projectCount    = new Set(all.map(e=>e.project_name).filter(Boolean)).size;
  const stats = {
    total: cashflowOut, cashflowIn, cashflowOut,
    availableBalance: cashflowIn - cashflowOut,
    pendingReimb: all.filter(e=>e.is_reimbursement&&e.status==='pending').reduce((s,e)=>s+e.total,0),
    count: all.length, pending: pendingApproval, pendingApproval, projectCount,
    byProject:{}, byCategory:{}, byEmployee:{}
  };
  all.forEach(e => {
    stats.byProject[e.project_name]=(stats.byProject[e.project_name]||0)+e.total;
    stats.byCategory[e.category]=(stats.byCategory[e.category]||0)+e.total;
    if(e.reimburse_to_name){if(!stats.byEmployee[e.reimburse_to_name])stats.byEmployee[e.reimburse_to_name]={pending:0,paid:0};if(e.status==='pending')stats.byEmployee[e.reimburse_to_name].pending+=e.total;if(e.status==='paid')stats.byEmployee[e.reimburse_to_name].paid+=e.total;}
  });
  res.json(stats);
});

/* GET /reimburse-names — unique reimburse-to names from expenses */
router.get('/reimburse-names', authenticate, (req, res) => {
  const names = db.prepare(
    "SELECT DISTINCT reimburse_to_name FROM expenses WHERE reimburse_to_name IS NOT NULL AND reimburse_to_name != '' ORDER BY reimburse_to_name"
  ).all().map(e => e.reimburse_to_name);
  res.json(names);
});

router.post('/', authenticate, upload.single('file'), async (req, res) => {
  try {
    const { vendor,invoice_no,amount,gst,total,description,date,category,project_name,is_reimbursement,reimburse_to_id,reimburse_to_name } = req.body;
    if (!vendor||!total||!date||!category) return res.status(400).json({error:'vendor,total,date,category required'});
    const id=uuidv4(); let filePath=null,driveUrl=null,driveFileId=null;
    if (req.file) {
      const safeProj=(project_name||'Uncategorized').replace(/[^a-zA-Z0-9 _-]/g,'');
      const safeCat=(category||'other').replace(/[^a-zA-Z0-9]/g,'');
      const destDir=path.join(__dirname,'..','uploads',safeProj,safeCat);
      fs.mkdirSync(destDir,{recursive:true});
      const ext=path.extname(req.file.originalname)||path.extname(req.file.filename);
      const newName=`${date}_${vendor.replace(/[^a-zA-Z0-9]/g,'_').slice(0,30)}_${id.slice(0,8)}${ext}`;
      const destPath=path.join(destDir,newName);
      fs.renameSync(req.file.path,destPath);
      filePath=`/uploads/${safeProj}/${safeCat}/${newName}`;
      const drive=await uploadToDrive(destPath,newName,project_name,category);
      driveUrl=drive.url; driveFileId=drive.fileId;
    }
    const project=db.prepare('SELECT id FROM projects WHERE name=?').get(project_name);
    db.prepare('INSERT INTO expenses(id,vendor,invoice_no,amount,gst,total,description,date,category,project_id,project_name,is_reimbursement,reimburse_to_id,reimburse_to_name,uploaded_by_id,uploaded_by_name,file_path,drive_url,drive_file_id)VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,vendor,invoice_no||'',parseFloat(amount)||0,parseFloat(gst)||0,parseFloat(total)||0,description||'',date,category,project?.id||null,project_name||'',is_reimbursement==='true'||is_reimbursement===true?1:0,reimburse_to_id||null,reimburse_to_name||null,req.user.id,req.user.name,filePath,driveUrl,driveFileId);
    res.status(201).json(db.prepare('SELECT * FROM expenses WHERE id=?').get(id));
  } catch(err){console.error(err);res.status(500).json({error:err.message});}
});

router.put('/:id/status',authenticate,adminOnly,(req,res)=>{
  const{status}=req.body;
  if(!['pending','approved','paid','rejected'].includes(status))return res.status(400).json({error:'Invalid status'});
  db.prepare('UPDATE expenses SET status=? WHERE id=?').run(status,req.params.id);
  res.json({message:'Status updated'});
});

router.put('/reimburse-all/:employeeName',authenticate,adminOnly,(req,res)=>{
  const result=db.prepare("UPDATE expenses SET status='paid' WHERE reimburse_to_name=? AND status='pending'").run(req.params.employeeName);
  res.json({updated:result.changes});
});

router.delete('/:id',authenticate,adminOnly,(req,res)=>{
  const expense=db.prepare('SELECT * FROM expenses WHERE id=?').get(req.params.id);
  if(!expense)return res.status(404).json({error:'Not found'});
  if(expense.file_path){const localPath=path.join(__dirname,'..', expense.file_path);if(fs.existsSync(localPath))fs.unlinkSync(localPath);}
  db.prepare('DELETE FROM expenses WHERE id=?').run(req.params.id);
  res.json({message:'Deleted'});
});

router.get('/export/excel',authenticate,(req,res)=>{
  const XLSX=require('xlsx');
  const expenses=req.user.role==='admin'?db.prepare('SELECT * FROM expenses ORDER BY created_at DESC').all():db.prepare('SELECT * FROM expenses WHERE uploaded_by_id=? ORDER BY created_at DESC').all(req.user.id);
  const rows=expenses.map(e=>({'Date':e.date,'Vendor':e.vendor,'Invoice No':e.invoice_no,'Description':e.description,'Category':e.category,'Project':e.project_name,'Amount':e.amount,'GST':e.gst,'Total':e.total,'Reimburse To':e.reimburse_to_name||'','Uploaded By':e.uploaded_by_name,'Status':e.status,'Drive Link':e.drive_url||''}));
  const ws=XLSX.utils.json_to_sheet(rows);const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'Expenses');
  const summary=[...new Set(expenses.map(e=>e.project_name))].map(p=>{const proj=expenses.filter(e=>e.project_name===p);return{Project:p,'Total Expenses':proj.reduce((s,e)=>s+e.total,0),'Bill Count':proj.length};});
  XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(summary),'Summary');
  const buffer=XLSX.write(wb,{type:'buffer',bookType:'xlsx'});
  res.setHeader('Content-Disposition','attachment; filename=FinTrack_Expenses.xlsx');
  res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buffer);
});

router.get('/export/pdf',authenticate,(req,res)=>{
  const{jsPDF}=require('jspdf');require('jspdf-autotable');
  const expenses=req.user.role==='admin'?db.prepare('SELECT * FROM expenses ORDER BY created_at DESC').all():db.prepare('SELECT * FROM expenses WHERE uploaded_by_id=? ORDER BY created_at DESC').all(req.user.id);
  const doc=new jsPDF({orientation:'landscape',unit:'mm',format:'a4'});
  doc.setFontSize(18);doc.text('FinTrack — Expense Report',14,20);
  doc.setFontSize(10);doc.text(`Generated: ${new Date().toLocaleString()}  |  Total: ₹${expenses.reduce((s,e)=>s+e.total,0).toLocaleString('en-IN')}`,14,28);
  doc.autoTable({startY:34,head:[['Date','Vendor','Category','Project','Amount','GST','Total','Reimburse To','Status']],body:expenses.map(e=>[e.date,e.vendor,e.category,e.project_name||'',`₹${e.amount}`,`₹${e.gst}`,`₹${e.total}`,e.reimburse_to_name||'—',e.status]),styles:{fontSize:8},headStyles:{fillColor:[99,102,241]},alternateRowStyles:{fillColor:[248,249,255]}});
  const pdfBuffer=Buffer.from(doc.output('arraybuffer'));
  res.setHeader('Content-Disposition','attachment; filename=FinTrack_Expenses.pdf');
  res.setHeader('Content-Type','application/pdf');
  res.send(pdfBuffer);
});

module.exports = router;
