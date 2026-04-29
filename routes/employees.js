const express  = require('express');
const bcrypt   = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const db       = require('../db');
const { authenticate, adminOnly } = require('../middleware/auth');

const router = express.Router();

// GET all employees
router.get('/', authenticate, async (req, res) => {
  try {
    const employees = await db.all('SELECT * FROM employees ORDER BY name');
    res.json(employees);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST create employee + user account
router.post('/', authenticate, adminOnly, async (req, res) => {
  try {
    const { name, email, phone, department, password } = req.body;
    if (!name || !email) return res.status(400).json({ error: 'Name and email required' });

    const emailLower = email.toLowerCase().trim();
    const existingEmp = await db.get('SELECT id FROM employees WHERE email = ?', [emailLower]);
    if (existingEmp) return res.status(409).json({ error: 'Employee already exists' });

    const empId = uuidv4();
    let userId = null;

    if (password) {
      const existingUser = await db.get('SELECT id FROM users WHERE email = ?', [emailLower]);
      if (!existingUser) {
        userId = uuidv4();
        await db.run('INSERT INTO users (id, name, email, password, role) VALUES (?, ?, ?, ?, ?)',
          [userId, name, emailLower, bcrypt.hashSync(password, 10), 'employee']);
      } else {
        userId = existingUser.id;
      }
    }

    await db.run('INSERT INTO employees (id, name, email, phone, department, user_id) VALUES (?,?,?,?,?,?)',
      [empId, name, emailLower, phone || '', department || '', userId]);

    const emp = await db.get('SELECT * FROM employees WHERE id = ?', [empId]);
    res.status(201).json(emp);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT update employee
router.put('/:id', authenticate, adminOnly, async (req, res) => {
  try {
    const { name, email, phone, department } = req.body;
    await db.run('UPDATE employees SET name=?, email=?, phone=?, department=? WHERE id=?',
      [name, email, phone || '', department || '', req.params.id]);
    res.json({ message: 'Updated' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE employee
router.delete('/:id', authenticate, adminOnly, async (req, res) => {
  try {
    const emp = await db.get('SELECT * FROM employees WHERE id = ?', [req.params.id]);
    if (!emp) return res.status(404).json({ error: 'Not found' });
    if (emp.user_id) {
      await db.run('DELETE FROM users WHERE id = ?', [emp.user_id]);
    }
    await db.run('DELETE FROM employees WHERE id = ?', [req.params.id]);
    res.json({ message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
