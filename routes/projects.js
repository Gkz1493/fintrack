const express = require('express');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const db = require('../db');
const { authenticate, adminOnly } = require('../middleware/auth');

const router = express.Router();

// GET all project names (array of strings)
router.get('/all-names', authenticate, async (req, res) => {
  try {
    const rows = await db.all('SELECT name FROM projects ORDER BY name');
    res.json(rows.map(r => r.name));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET project stats by name
router.get('/stats-by-name/:name', authenticate, async (req, res) => {
  try {
    const name = req.params.name;
    const project = await db.get('SELECT * FROM projects WHERE name = ?', [name]);
    if (!project) return res.status(404).json({ error: 'Not found' });
    const expenses = await db.all('SELECT * FROM expenses WHERE project_id = ? OR project_name = ?', [project.id, name]);
    const byCategory = {};
    expenses.forEach(e => { byCategory[e.category] = (byCategory[e.category] || 0) + parseFloat(e.total || 0); });
    res.json({
      name, total: expenses.reduce((s, e) => s + parseFloat(e.total || 0), 0),
      count: expenses.length,
      pendingReimb: expenses.filter(e => e.is_reimbursement && e.status === 'pending').reduce((s, e) => s + parseFloat(e.total || 0), 0),
      pendingApproval: expenses.filter(e => e.status === 'pending').length,
      byCategory, expenses,
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET project details (client, fund_allocated, etc.)
router.get('/details/:name', authenticate, async (req, res) => {
  try {
    const detail = await db.get('SELECT * FROM project_details WHERE project_name = ?', [req.params.name]);
    res.json(detail || null);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST/PUT project details upsert
router.post('/details/:name', authenticate, adminOnly, async (req, res) => {
  try {
    const name = req.params.name;
    const { client_name, mobile, email, address, fund_allocated, drive_folder_url } = req.body;
    const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
    const existing = await db.get('SELECT id FROM project_details WHERE project_name = ?', [name]);
    if (existing) {
      await db.run('UPDATE project_details SET client_name=?,mobile=?,email=?,address=?,fund_allocated=?,drive_folder_url=?,updated_at=? WHERE project_name=?',
        [client_name||null,mobile||null,email||null,address||null,fund_allocated||0,drive_folder_url||null,now,name]);
    } else {
      const id = crypto.randomBytes(8).toString('hex');
      await db.run('INSERT INTO project_details (id,project_name,client_name,mobile,email,address,fund_allocated,drive_folder_url,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
        [id,name,client_name||null,mobile||null,email||null,address||null,fund_allocated||0,drive_folder_url||null,now,now]);
    }
    res.json(await db.get('SELECT * FROM project_details WHERE project_name = ?', [name]));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET reimburse-names (employees list for reimbursement dropdown)
router.get('/reimburse-names', authenticate, async (req, res) => {
  try {
    const emps = await db.all('SELECT id, name FROM employees ORDER BY name');
    res.json(emps);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET all projects
router.get('/', authenticate, async (req, res) => {
  try {
    const projects = await db.all('SELECT * FROM projects ORDER BY name');
    res.json(projects);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET project by ID stats
router.get('/:id/stats', authenticate, async (req, res) => {
  try {
    const project = await db.get('SELECT * FROM projects WHERE id = ?', [req.params.id]);
    if (!project) return res.status(404).json({ error: 'Not found' });
    const expenses = await db.all('SELECT * FROM expenses WHERE project_id = ? OR project_name = ?', [req.params.id, project.name]);
    const byCategory = {};
    expenses.forEach(e => { byCategory[e.category] = (byCategory[e.category] || 0) + parseFloat(e.total || 0); });
    res.json({ project, total: expenses.reduce((s,e)=>s+parseFloat(e.total||0),0), count: expenses.length, byCategory, expenses });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST create project
router.post('/', authenticate, adminOnly, async (req, res) => {
  try {
    const { name, description } = req.body;
    if (!name) return res.status(400).json({ error: 'Name required' });
    const exists = await db.get('SELECT id FROM projects WHERE name = ?', [name]);
    if (exists) return res.status(409).json({ error: 'Project already exists' });
    const id = uuidv4();
    await db.run('INSERT INTO projects (id, name, description, created_by) VALUES (?, ?, ?, ?)', [id, name, description || '', req.user.id]);
    res.status(201).json(await db.get('SELECT * FROM projects WHERE id = ?', [id]));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT update project
router.put('/:id', authenticate, adminOnly, async (req, res) => {
  try {
    const { name, description } = req.body;
    await db.run('UPDATE projects SET name = ?, description = ? WHERE id = ?', [name, description || '', req.params.id]);
    res.json({ message: 'Updated' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE project
router.delete('/:id', authenticate, adminOnly, async (req, res) => {
  try {
    await db.run('DELETE FROM projects WHERE id = ?', [req.params.id]);
    res.json({ message: 'Deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
