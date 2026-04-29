const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

// ─── Connection Pool ──────────────────────────────────────────────────────────
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
  console.error('PostgreSQL pool error:', err.message);
});

// ─── Query helpers ────────────────────────────────────────────────────────────
function toPostgres(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

const db = {
  pool,
  async get(sql, params = []) {
    const r = await pool.query(toPostgres(sql), params);
    return r.rows[0] || null;
  },
  async all(sql, params = []) {
    const r = await pool.query(toPostgres(sql), params);
    return r.rows;
  },
  async run(sql, params = []) {
    return pool.query(toPostgres(sql), params);
  },
  async insert(sql, params = []) {
    const pg = toPostgres(sql);
    const withReturn = pg.trim().toUpperCase().includes('RETURNING') ? pg : pg + ' RETURNING *';
    const r = await pool.query(withReturn, params);
    return r.rows[0];
  },
  async query(sql, params = []) {
    return pool.query(sql, params);
  }
};

// ─── Schema ───────────────────────────────────────────────────────────────────
async function initSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      email       TEXT UNIQUE NOT NULL,
      password    TEXT NOT NULL,
      role        TEXT NOT NULL DEFAULT 'employee',
      created_at  TEXT DEFAULT to_char(NOW(), 'YYYY-MM-DD HH24:MI:SS')
    );
    CREATE TABLE IF NOT EXISTS projects (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL UNIQUE,
      description TEXT,
      created_by  TEXT,
      created_at  TEXT DEFAULT to_char(NOW(), 'YYYY-MM-DD HH24:MI:SS')
    );
    CREATE TABLE IF NOT EXISTS project_details (
      id               TEXT PRIMARY KEY,
      project_name     TEXT UNIQUE,
      client_name      TEXT,
      mobile           TEXT,
      email            TEXT,
      address          TEXT,
      fund_allocated   NUMERIC DEFAULT 0,
      fund_releases    JSONB DEFAULT '[]',
      drive_folder_url TEXT,
      created_at       TEXT DEFAULT to_char(NOW(), 'YYYY-MM-DD HH24:MI:SS'),
      updated_at       TEXT DEFAULT to_char(NOW(), 'YYYY-MM-DD HH24:MI:SS')
    );
    CREATE TABLE IF NOT EXISTS employees (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      email       TEXT UNIQUE NOT NULL,
      phone       TEXT,
      department  TEXT,
      user_id     TEXT,
      created_at  TEXT DEFAULT to_char(NOW(), 'YYYY-MM-DD HH24:MI:SS')
    );
    CREATE TABLE IF NOT EXISTS expenses (
      id                TEXT PRIMARY KEY,
      vendor            TEXT NOT NULL,
      invoice_no        TEXT,
      amount            NUMERIC NOT NULL DEFAULT 0,
      gst               NUMERIC DEFAULT 0,
      total             NUMERIC NOT NULL DEFAULT 0,
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
      created_at        TEXT DEFAULT to_char(NOW(), 'YYYY-MM-DD HH24:MI:SS'),
      advance_paid      NUMERIC DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS bank_statement_entries (
      id              SERIAL PRIMARY KEY,
      date            TEXT,
      vendor          TEXT,
      amount          NUMERIC,
      type            TEXT DEFAULT '',
      invoice_no      TEXT DEFAULT '',
      utr_number      TEXT DEFAULT '',
      remark          TEXT DEFAULT '',
      reference_files JSONB DEFAULT '[]',
      statement_name  TEXT,
      created_at      TEXT DEFAULT to_char(NOW(), 'YYYY-MM-DD HH24:MI:SS')
    );
  `);
  console.log('✅ PostgreSQL schema ready');
}

async function seedAdmin() {
  const adminExists = await db.get("SELECT id FROM users WHERE role = 'admin' LIMIT 1");
  if (!adminExists) {
    const hashed = bcrypt.hashSync(process.env.ADMIN_PASSWORD || 'Admin@123', 10);
    await db.run('INSERT INTO users (id, name, email, password, role) VALUES (?, ?, ?, ?, ?)',
      [uuidv4(), 'Admin', process.env.ADMIN_EMAIL || 'admin@company.com', hashed, 'admin']);
    console.log('✅ Admin seeded:', process.env.ADMIN_EMAIL || 'admin@company.com');
  }
}

async function init() {
  try {
    await initSchema();
    await seedAdmin();
  } catch (err) {
    console.error('❌ DB init error:', err.message);
    throw err;
  }
}

init().catch(console.error);
module.exports = db;
