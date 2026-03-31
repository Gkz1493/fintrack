const Database = require('better-sqlite3');
const path     = require('path');
const fs       = require('fs');
const bcrypt   = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

/* ââ Persistent storage: Railway Volume â /data â app dir âââââââââ
   In Railway: Add a Volume, set mount path to /data.
   The env var RAILWAY_VOLUME_MOUNT_PATH is set automatically.      */
const DB_DIR  = process.env.DB_DIR
             || process.env.RAILWAY_VOLUME_MOUNT_PATH
             || path.join(__dirname, 'data');
const DB_PATH = path.join(DB_DIR, 'fintrack.db');
fs.mkdirSync(DB_DIR, { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

/* ââ Schema âââââââââââââââââââââââââââââââââââââââââââââââââââââââ */
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    email      TEXT UNIQUE NOT NULL,
    password   TEXT NOT NULL,
    role       TEXT NOT NULL DEFAULT 'employee',
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS projects (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL UNIQUE,
    description TEXT,
    created_by  TEXT,
    created_at  TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS employees (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    email      TEXT,
    phone      TEXT,
    department TEXT,
    user_id    TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS expenses (
    id                TEXT PRIMARY KEY,
    vendor            TEXT NOT NULL,
    invoice_no        TEXT,
    amount            REAL NOT NULL DEFAULT 0,
    gst               REAL DEFAULT 0,
    total             REAL NOT NULL DEFAULT 0,
    description       TEXT,
    date              TEXT NOT NULL,
    category          TEXT NOT NULL,
    project_id        TEXT,
    project_name      TEXT,
    is_reimbursement  INTEGER DEFAULT 0,
    reimburse_to_id   TEXT,
    reimburse_to_name TEXT,
    status            TEXT DEFAULT 'pending',
    uploaded_by_id    TEXT,
    uploaded_by_name  TEXT,
    file_path         TEXT,
    drive_url         TEXT,
    drive_file_id     TEXT,
    created_at        TEXT DEFAULT (datetime('now'))
  );
`);

/* ââ Migration: make employees.email nullable (drop NOT NULL) âââââ */
try {
  const cols = db.prepare('PRAGMA table_info(employees)').all();
  const emailCol = cols.find(c => c.name === 'email');
  if (emailCol && emailCol.notnull === 1) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS employees_v2 (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT, phone TEXT,
        department TEXT, user_id TEXT, created_at TEXT DEFAULT (datetime('now'))
      );
      INSERT OR IGNORE INTO employees_v2 SELECT id,name,email,phone,department,user_id,created_at FROM employees;
      DROP TABLE employees;
      ALTER TABLE employees_v2 RENAME TO employees;
    `);
    console.log('â Migrated employees table (email now nullable)');
  }
} catch (e) { console.warn('Employee migration skipped:', e.message); }

/* -- Migration: add project_details table -- */
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS project_details (
      id               TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      project_name     TEXT UNIQUE NOT NULL,
      client_name      TEXT,
      mobile           TEXT,
      email            TEXT,
      address          TEXT,
      fund_allocated   REAL DEFAULT 0,
      fund_releases    TEXT DEFAULT '[]',
      drive_folder_url TEXT,
      created_at       TEXT DEFAULT (datetime('now')),
      updated_at       TEXT DEFAULT (datetime('now'))
    )
  `);
} catch (e) { console.warn('project_details table:', e.message); }

/* ââ Seed admin account âââââââââââââââââââââââââââââââââââââââââââ */
const adminExists = db.prepare("SELECT id FROM users WHERE role='admin' LIMIT 1").get();
if (!adminExists) {
  const pw = process.env.ADMIN_PASSWORD || 'Admin@123';
  db.prepare("INSERT INTO users (id,name,email,password,role) VALUES (?,?,?,?,'admin')")
    .run(uuidv4(), 'Admin', process.env.ADMIN_EMAIL || 'admin@company.com', bcrypt.hashSync(pw, 10));
  console.log('â Admin created:', process.env.ADMIN_EMAIL || 'admin@company.com');
}

/* ââ Seed demo projects only on a truly empty DB (no expenses yet) â */
const projCount = db.prepare('SELECT COUNT(*) as c FROM projects').get().c;
const expCount  = db.prepare('SELECT COUNT(*) as c FROM expenses').get().c;
if (projCount === 0 && expCount === 0) {
  const ins = db.prepare('INSERT OR IGNORE INTO projects (id,name) VALUES (?,?)');
  ['Office Renovation','Client Project Alpha','Marketing Campaign Q1'].forEach(n => ins.run(uuidv4(), n));
  console.log('â Demo projects seeded');
}

module.exports = db;
