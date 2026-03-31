const express = require('express');
const router = express.Router();
const { db } = require('../db');
const { authenticateToken } = require('./auth');

// GET all projects
router.get('/', authenticateToken, (req, res) => {
  try {
    const projects = db.prepare('SELECT * FROM projects ORDER BY created_at DESC').all();
    res.json(projects);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET single project with expense total
router.get('/:id', authenticateToken, (req, res) => {
  try {
    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    const expenses = db.prepare('SELECT * FROM expenses WHERE project_id = ?').all(req.params.id);
    const total = expenses.reduce((s, e) => s + e.amount, 0);
    res.json({ project, expenses, total });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST create project
router.post('/', authenticateToken, (req, res) => {
  try {
    const { name, description, budget, client_name } = req.body;
    if (!name) return res.status(400).json({ error: 'Project name is required' });
    const id = require('uuid').v4();
    db.prepare(
      'INSERT INTO projects (id, name, description, budget, client_name) VALUES (?, ?, ?, ?, ?)'
    ).run(id, name, description || '', budget || 0, client_name || '');
    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
    res.status(201).json(project);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT update project
router.put('/:id', authenticateToken, (req, res) => {
  try {
    const { name, description, budget, client_name, status } = req.body;
    db.prepare(
      'UPDATE projects SET name = ?, description = ?, budget = ?, client_name = ?, status = ? WHERE id = ?'
    ).run(name, description, budget, client_name, status, req.params.id);
    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
    res.json(project);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE project
router.delete('/:id', authenticateToken, (req, res) => {
  try {
    db.prepare('DELETE FROM expenses WHERE project_id = ?').run(req.params.id);
    db.prepare('DELETE FROM projects WHERE id = ?').run(req.params.id);
    res.json({ message: 'Project deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
