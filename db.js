const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

const DB_DIR = process.env.DB_DIR || __dirname;
const DB_PATH = path.join(DB_DIR, 'fintrack.db');

fs.mkdirSync(DB_DIR, { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ─── Schema ───────────────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    email       TEXT UNIQUE NOT NULL,
    password    TEXT NOT NULL,
    role        TEXT NOT NULL DEFAULT 'employee',
    created_at  TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS projects (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL UNIQUE,
    description TEXT,
    created_by  TEXT,
    created_at  TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS employees (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    email       TEXT UNIQUE NOT NULL,
    phone       TEXT,
    department  TEXT,
    user_id     TEXT,
    created_at  TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS expenses (
    id               TEXT PRIMARY KEY,
    vendor           TEXT NOT NULL,
    invoice_no       TEXT,
    amount           REAL NOT NULL DEFAULT 0,
    gst              REAL DEFAULT 0,
    total            REAL NOT NULL DEFAULT 0,
    description      TEXT,
    date             TEXT NOT NULL,
    category         TEXT NOT NULL,
    project_id       TEXT,
    project_name     TEXT,
    is_reimbursement INTEGER DEFAULT 0,
    reimburse_to_id  TEXT,
    reimburse_to_name TEXT,
    status           TEXT DEFAULT 'pending',
    uploaded_by_id   TEXT,
    uploaded_by_name TEXT,
    file_path        TEXT,
    drive_url        TEXT,
    drive_file_id    TEXT,
    created_at       TEXT DEFAULT (datetime('now'))
  );
`);

// ─── Seed admin account if none exists ───────────────────────────────────────
const adminExists = db.prepare("SELECT id FROM users WHERE role = 'admin' LIMIT 1").get();
if (!adminExists) {
  const defaultPass = process.env.ADMIN_PASSWORD || 'Admin@123';
  const hashed = bcrypt.hashSync(defaultPass, 10);
  db.prepare(`
    INSERT INTO users (id, name, email, password, role)
    VALUES (?, ?, ?, ?, 'admin')
  `).run(uuidv4(), 'Admin', process.env.ADMIN_EMAIL || 'admin@company.com', hashed);
  console.log('✅ Admin account created:', process.env.ADMIN_EMAIL || 'admin@company.com', '/ password:', defaultPass);
}

// ─── Seed demo projects if none exist ────────────────────────────────────────
const projCount = db.prepare("SELECT COUNT(*) as c FROM projects").get().c;
if (projCount === 0) {
  const insert = db.prepare("INSERT INTO projects (id, name) VALUES (?, ?)");
  ['Office Renovation', 'Client Project Alpha', 'Marketing Campaign Q1'].forEach(name => {
    insert.run(uuidv4(), name);
  });
}

module.exports = db;
