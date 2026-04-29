const express  = require('express');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const db       = require('../db');
const { authenticate, adminOnly, SECRET } = require('../middleware/auth');

const router = express.Router();

// ── POST /api/auth/login ──────────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

    const user = await db.get('SELECT * FROM users WHERE email = ?', [email.toLowerCase().trim()]);
    if (!user) return res.status(401).json({ error: 'Invalid email or password' });

    const valid = bcrypt.compareSync(password, user.password);
    if (!valid) return res.status(401).json({ error: 'Invalid email or password' });

    const token = jwt.sign({ id: user.id, role: user.role }, SECRET, { expiresIn: '30d' });
    const { password: _, ...userSafe } = user;
    res.json({ token, user: userSafe });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/auth/me ──────────────────────────────────────────────────────────
router.get('/me', authenticate, (req, res) => {
  res.json(req.user);
});

// ── POST /api/auth/register (admin only) ─────────────────────────────────────
router.post('/register', authenticate, adminOnly, async (req, res) => {
  try {
    const { name, email, password, role = 'employee' } = req.body;
    if (!name || !email || !password) return res.status(400).json({ error: 'Name, email, password required' });

    const emailLower = email.toLowerCase().trim();
    const existing = await db.get('SELECT id FROM users WHERE email = ?', [emailLower]);
    if (existing) return res.status(409).json({ error: 'Email already registered' });

    const id = uuidv4();
    const hashed = bcrypt.hashSync(password, 10);
    await db.run('INSERT INTO users (id, name, email, password, role) VALUES (?, ?, ?, ?, ?)',
      [id, name, emailLower, hashed, role]);

    const empExists = await db.get('SELECT id FROM employees WHERE email = ?', [emailLower]);
    if (!empExists) {
      await db.run('INSERT INTO employees (id, name, email, user_id) VALUES (?, ?, ?, ?)',
        [uuidv4(), name, emailLower, id]);
    }

    res.status(201).json({ message: 'User created', id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PUT /api/auth/password ─────────────────────────────────────────────────────
router.put('/password', authenticate, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Both passwords required' });

    const user = await db.get('SELECT * FROM users WHERE id = ?', [req.user.id]);
    if (!bcrypt.compareSync(currentPassword, user.password)) {
      return res.status(401).json({ error: 'Current password incorrect' });
    }

    await db.run('UPDATE users SET password = ? WHERE id = ?',
      [bcrypt.hashSync(newPassword, 10), req.user.id]);
    res.json({ message: 'Password updated' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/auth/users (admin only) ─────────────────────────────────────────
router.get('/users', authenticate, adminOnly, async (req, res) => {
  try {
    const users = await db.all('SELECT id, name, email, role, created_at FROM users ORDER BY created_at DESC');
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
