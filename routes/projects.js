const express    = require('express');
const router     = express.Router();
const { v4: uuidv4 } = require('uuid');
const db         = require('../db');
const { authenticate } = require('../middleware/auth');

/* ─── GET /all-names  (must be BEFORE /:id routes) ─────────────── */
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

/* ─── GET /stats-by-name/:name  (freeform project names) ───────── */
router.get('/stats-by-name/:name', authenticate, (req, res) => {
  try {
    const name     = req.params.name;
    const expenses = db.prepare('SELECT * FROM expenses WHERE project_name = ? ORDER BY date DESC').all(name);
    const total    = expenses.reduce((s,e) => s + (e.total||0), 0);
    const count    = expenses.length;
    const pendingReimb = expenses
      .filter(e => e.is_reimbursement && e.status === 'pending')
      .reduce((s,e) => s + e.total, 0);
    const byCategory = {};
    expenses.forEach(e => { byCategory[e.category] = (byCategory[e.category]||0) + e.total; });
    res.json({ name, total, count, pendingReimb, byCategory, expenses });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* ─── GET /  (all projects) ─────────────────────────────────────── */
router.get('/', authenticate, (req, res) => {
  try {
    const projects = db.prepare('SELECT * FROM projects ORDER BY created_at DESC').all();
    res.json(projects);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* ─── GET /:id/stats  (must be BEFORE /:id) ─────────────────────── */
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

/* ─── GET /:id ───────────────────────────────────────────────────── */
router.get('/:id', authenticate, (req, res) => {
  try {
    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    const expenses = db.prepare('SELECT * FROM expenses WHERE project_name = ?').all(project.name);
    const total = expenses.reduce((s,e) => s + (e.total||0), 0);
    res.json({ project, expenses, total });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* ─── POST /  (create) ──────────────────────────────────────────── */
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

/* ─── PUT /:id ───────────────────────────────────────────────────── */
router.put('/:id', authenticate, (req, res) => {
  try {
    const { name, description } = req.body;
    db.prepare('UPDATE projects SET name=?, description=? WHERE id=?').run(name, description, req.params.id);
    res.json(db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* ─── DELETE /:id ───────────────────────────────────────────────── */
router.delete('/:id', authenticate, (req, res) => {
  try {
    db.prepare('DELETE FROM projects WHERE id = ?').run(req.params.id);
    res.json({ message: 'Project deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
