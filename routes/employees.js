const express  = require('express');
const bcrypt   = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const db       = require('../db');
const { authenticate, adminOnly } = require('../middleware/auth');

const router = express.Router();

router.get('/', authenticate, (req, res) => {
  const employees = db.prepare('SELECT * FROM employees ORDER BY name').all();
  res.json(employees);
});

router.post('/', authenticate, adminOnly, (req, res) => {
  const { name, email, phone, department, password } = req.body;
  if (!name || !email) return res.status(400).json({ error: 'Name and email required' });
  const emailLower = email.toLowerCase().trim();
  const existingEmp  = db.prepare('SELECT id FROM employees WHERE email = ?').get(emailLower);
  if (existingEmp) return res.status(409).json({ error: 'Employee already exists' });
  const empId = uuidv4();
  let userId = null;
  if (password) {
    const existingUser = db.prepare('SELECT id FROM users WHERE email = ?').get(emailLower);
    if (!existingUser) {
      userId = uuidv4();
      db.prepare('INSERT INTO users (id, name, email, password, role) VALUES (?, ?, ?, ?, ?)').run(userId, name, emailLower, bcrypt.hashSync(password, 10), 'employee');
    } else { userId = existingUser.id; }
  }
  db.prepare('INSERT INTO employees (id, name, email, phone, department, user_id) VALUES (?,?,?,?,?,?)').run(empId, name, emailLower, phone || '', department || '', userId);
  res.status(201).json(db.prepare('SELECT * FROM employees WHERE id = ?').get(empId));
});

router.put('/:id', authenticate, adminOnly, (req, res) => {
  const { name, email, phone, department } = req.body;
  db.prepare('UPDATE employees SET name=?, email=?, phone=?, department=? WHERE id=?').run(name, email, phone || '', department || '', req.params.id);
  res.json({ message: 'Updated' });
});

router.delete('/:id', authenticate, adminOnly, (req, res) => {
  const emp = db.prepare('SELECT * FROM employees WHERE id = ?').get(req.params.id);
  if (!emp) return res.status(404).json({ error: 'Not found' });
  if (emp.user_id) db.prepare('DELETE FROM users WHERE id = ?').run(emp.user_id);
  db.prepare('DELETE FROM employees WHERE id = ?').run(req.params.id);
  res.json({ message: 'Deleted' });
});

module.exports = router;
