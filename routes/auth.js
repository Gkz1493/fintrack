const express  = require('express');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const db       = require('../db');
const { authenticate, adminOnly, SECRET } = require('../middleware/auth');

const router = express.Router();

// ── POST /api/auth/login ──────────────────────────────────────────────────────
router.post('/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase().trim());
  if (!user) return res.status(401).json({ error: 'Invalid email or password' });

  const valid = bcrypt.compareSync(password, user.password);
  if (!valid) return res.status(401).json({ error: 'Invalid email or password' });

  const token = jwt.sign({ id: user.id, role: user.role }, SECRET, { expiresIn: '30d' });
  const { password: _, ...userSafe } = user;
  res.json({ token, user: userSafe });
});

// ── GET /api/auth/me ──────────────────────────────────────────────────────────
router.get('/me', authenticate, (req, res) => {
  res.json(req.user);
});

// ── POST /api/auth/register  (admin only) ─────────────────────────────────────
router.post('/register', authenticate, adminOnly, (req, res) => {
  const { name, email, password, role = 'employee' } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: 'Name, email, password required' });

  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase().trim());
  if (existing) return res.status(409).json({ error: 'Email already registered' });

  const id = uuidv4();
  const hashed = bcrypt.hashSync(password, 10);
  db.prepare('INSERT INTO users (id, name, email, password, role) VALUES (?, ?, ?, ?, ?)').run(
    id, name, email.toLowerCase().trim(), hashed, role
  );

  // Also add to employees table
  const empExists = db.prepare('SELECT id FROM employees WHERE email = ?').get(email.toLowerCase().trim());
  if (!empExists) {
    db.prepare('INSERT INTO employees (id, name, email, user_id) VALUES (?, ?, ?, ?)').run(
      uuidv4(), name, email.toLowerCase().trim(), id
    );
  }

  res.status(201).json({ message: 'User created', id });
});

// ── PUT /api/auth/password ─────────────────────────────────────────────────────
router.put('/password', authenticate, (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Both passwords required' });

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!bcrypt.compareSync(currentPassword, user.password)) {
    return res.status(401).json({ error: 'Current password incorrect' });
  }

  db.prepare('UPDATE users SET password = ? WHERE id = ?').run(bcrypt.hashSync(newPassword, 10), req.user.id);
  res.json({ message: 'Password updated' });
});

// ── GET /api/auth/users (admin only) ─────────────────────────────────────────
router.get('/users', authenticate, adminOnly, (req, res) => {
  const users = db.prepare('SELECT id, name, email, role, created_at FROM users ORDER BY created_at DESC').all();
  res.json(users);
});


/* ONE-TIME password reset - remove after use */
router.post('/reset-pw', async (req, res) => {
  try {
    const bcrypt = require('bcryptjs');
    const { email, newPassword } = req.body;
    if (!email || !newPassword) return res.status(400).json({ error: 'email and newPassword required' });
    const hash = await bcrypt.hash(newPassword, 10);
    const result = db.prepare('UPDATE users SET password = ? WHERE email = ?').run(hash, email);
    if (result.changes === 0) return res.status(404).json({ error: 'User not found' });
    res.json({ ok: true, message: 'Password updated' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
