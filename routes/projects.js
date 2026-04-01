const express    = require('express');
const router     = express.Router();
const { v4: uuidv4 } = require('uuid');
const db         = require('../db');
const { authenticate } = require('../middleware/auth');

/* Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂ GET /all-names  (must be BEFORE /:id routes) Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂ */
router.get('/all-names', authenticate, (req, res) => {
  try {
    const fromDb  = db.prepare('SELECT name FROM projects ORDER BY name').all().map(p => p.name);
    const fromExp = db.prepare(
      "SELECT DISTINCT project_name FROM expenses WHERE project_name IS NOT NULL AND project_name != '' ORDER BY project_name"
    ).all().map(e => e.project_name);
    const names = [...new Set([...fromDb, ...fromExp])].filter(Boolean).sort((a,b) => a.localeCompare(b));
    res.json(names);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂ GET /stats-by-name/:name  (freeform project names) Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂ */
router.get('/stats-by-name/:name', authenticate, (req, res) => {
  try {
    const name     = req.params.name;
    const expenses = db.prepare('SELECT * FROM expenses WHERE project_name = ? ORDER BY date DESC').all(name);
    const total    = expenses.reduce((s,e) => s + (e.total||0), 0);
    const count    = expenses.length;
    const pendingReimb = expenses
      .filter(e => e.is_reimbursement && e.status === 'pending')
      .reduce((s,e) => s + e.total, 0);
    const pendingApproval = expenses.filter(e => e.status === 'pending').length;
    const byCategory = {};
    expenses.forEach(e => { byCategory[e.category] = (byCategory[e.category]||0) + e.total; });
    /* --- fund data from project_details --- */
    let cashflowIn = 0, fundAllocated = 0;
    try {
      const detail = db.prepare('SELECT fund_releases, fund_allocated FROM project_details WHERE project_name = ?').get(name);
      if (detail) {
        fundAllocated = Number(detail.fund_allocated || 0);
        cashflowIn    = fundAllocated;
      }
    } catch(e) {}
    const availableBalance = fundAllocated - total;
    res.json({ name, total, count, pendingReimb, pendingApproval, byCategory, expenses, cashflowIn, fundAllocated, availableBalance });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂ GET /  (all projects) Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂ */
router.get('/', authenticate, (req, res) => {
  try {
    const projects = db.prepare('SELECT * FROM projects ORDER BY created_at DESC').all();
    res.json(projects);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂ GET /:id/stats  (must be BEFORE /:id) Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂ */
router.get('/:id/stats', authenticate, (req, res) => {
  try {
    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    const expenses = db.prepare(
      'SELECT * FROM expenses WHERE project_name = ? ORDER BY date DESC'
    ).all(project.name);
    const total    = expenses.reduce((s,e) => s + (e.total||0), 0);
    const count    = expenses.length;
    const pendingReimb = expenses
      .filter(e => e.is_reimbursement && e.status === 'pending')
      .reduce((s,e) => s + e.total, 0);
    const byCategory = {};
    expenses.forEach(e => { byCategory[e.category] = (byCategory[e.category]||0) + e.total; });
    res.json({ total, count, pendingReimb, byCategory, expenses });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂ GET /:id Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂ */
router.get('/:id', authenticate, (req, res) => {
  try {
    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    const expenses = db.prepare('SELECT * FROM expenses WHERE project_name = ?').all(project.name);
    const total = expenses.reduce((s,e) => s + (e.total||0), 0);
    res.json({ project, expenses, total });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂ POST /  (create) Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂ */
router.post('/', authenticate, (req, res) => {
  try {
    const { name, description } = req.body;
    if (!name) return res.status(400).json({ error: 'Project name is required' });
    const existing = db.prepare('SELECT id FROM projects WHERE name = ?').get(name);
    if (existing) return res.json(existing);          // idempotent
    const id = uuidv4();
    db.prepare('INSERT INTO projects (id, name, description, created_by) VALUES (?,?,?,?)')
      .run(id, name, description||'', req.user.id);
    res.status(201).json(db.prepare('SELECT * FROM projects WHERE id = ?').get(id));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂ PUT /:id Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂ */
router.put('/:id', authenticate, (req, res) => {
  try {
    const { name, description } = req.body;
    db.prepare('UPDATE projects SET name=?, description=? WHERE id=?').run(name, description, req.params.id);
    res.json(db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂ DELETE /:id Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂ */
router.delete('/:id', authenticate, (req, res) => {
  try {
    db.prepare('DELETE FROM projects WHERE id = ?').run(req.params.id);
    res.json({ message: 'Project deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});


/* --- GET /details/:name ------------------------------------ */
router.get('/details/:name', authenticate, (req, res) => {
  try {
    const row = db.prepare('SELECT * FROM project_details WHERE project_name = ?').get(req.params.name);
    if (!row) return res.json(null);
    try { row.fund_releases = JSON.parse(row.fund_releases || '[]'); } catch(e) { row.fund_releases = []; }
    res.json(row);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* --- POST /details  (upsert) ------------------------------ */
router.post('/details', authenticate, (req, res) => {
  try {
    const { project_name, client_name, mobile, email, address, fund_allocated, fund_releases, drive_folder_url } = req.body;
    if (!project_name) return res.status(400).json({ error: 'project_name required' });
    const relJson = JSON.stringify(Array.isArray(fund_releases) ? fund_releases : []);
    const crypto = require('crypto');
    const newId = crypto.randomBytes(8).toString('hex');
    db.prepare(`
      INSERT INTO project_details (id, project_name, client_name, mobile, email, address, fund_allocated, fund_releases, drive_folder_url, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(project_name) DO UPDATE SET
        client_name      = excluded.client_name,
        mobile           = excluded.mobile,
        email            = excluded.email,
        address          = excluded.address,
        fund_allocated   = excluded.fund_allocated,
        fund_releases    = excluded.fund_releases,
        drive_folder_url = excluded.drive_folder_url,
        updated_at       = datetime('now')
    `).run(newId, project_name, client_name||null, mobile||null, email||null, address||null, Number(fund_allocated)||0, relJson, drive_folder_url||null);
    const row = db.prepare('SELECT * FROM project_details WHERE project_name = ?').get(project_name);
    try { row.fund_releases = JSON.parse(row.fund_releases || '[]'); } catch(e) { row.fund_releases = []; }
    res.json(row);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
