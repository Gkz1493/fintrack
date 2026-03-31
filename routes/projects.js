const express = require('express');
const router  = express.Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { authenticate } = require('../middleware/auth');

// GET all projects
router.get('/', authenticate, (req, res) => {
  try {
    const projects = db.prepare('SELECT * FROM projects ORDER BY created_at DESC').all();
    res.json(projects);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET single project with expenses
router.get('/:id', authenticate, (req, res) => {
  try {
    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    const expenses = db.prepare('SELECT * FROM expenses WHERE project_id = ?').all(req.params.id);
    const total = expenses.reduce((s, e) => s + (e.total || 0), 0);
    res.json({ project, expenses, total });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST create project
router.post('/', authenticate, (req, res) => {
  try {
    const { name, description } = req.body;
    if (!name) return res.status(400).json({ error: 'Project name is required' });
    const id = uuidv4();
    db.prepare('INSERT INTO projects (id, name, description, created_by) VALUES (?, ?, ?, ?)')
      .run(id, name, description || '', req.user.id);
    res.status(201).json(db.prepare('SELECT * FROM projects WHERE id = ?').get(id));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT update project
router.put('/:id', authenticate, (req, res) => {
  try {
    const { name, description } = req.body;
    db.prepare('UPDATE projects SET name = ?, description = ? WHERE id = ?')
      .run(name, description, req.params.id);
    res.json(db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE project
router.delete('/:id', authenticate, (req, res) => {
  try {
    db.prepare('DELETE FROM expenses WHERE project_id = ?').run(req.params.id);
    db.prepare('DELETE FROM projects WHERE id = ?').run(req.params.id);
    res.json({ message: 'Project deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
