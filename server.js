// ============================================================
//  MEESHO MULTI-SELLER PORTAL — Backend Automation
//  Stack: Node.js + Express + SQLite
// ============================================================

const express  = require('express');
const Database = require('better-sqlite3');
const cors     = require('cors');
const fs       = require('fs');
const path     = require('path');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// ─── DATABASE SETUP ─────────────────────────────────────────
const db = new Database('meesho_portal.db');

db.exec(`
  CREATE TABLE IF NOT EXISTS accounts (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    name      TEXT NOT NULL,
    email     TEXT NOT NULL,
    password  TEXT NOT NULL,
    phone     TEXT,
    active    INTEGER DEFAULT 1,
    created   TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS products (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    description TEXT,
    category    TEXT,
    mrp         REAL,
    price       REAL,
    gst         TEXT,
    stock       INTEGER,
    sku         TEXT,
    image_path  TEXT,
    created     TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS upload_logs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id  INTEGER,
    account_id  INTEGER,
    status      TEXT,
    message     TEXT,
    catalog_id  TEXT,
    created     TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS analytics_cache (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id  INTEGER,
    data        TEXT,
    fetched_at  TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS live_data (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    supplier_id TEXT,
    type        TEXT,
    data        TEXT,
    timestamp   TEXT,
    created     TEXT DEFAULT (datetime('now'))
  );
`);

if (!fs.existsSync('./uploads')) fs.mkdirSync('./uploads');

// ─── API ROUTES ──────────────────────────────────────────────

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// ── Accounts ─────────────────────────────────────────────────
app.get('/api/accounts', (req, res) => {
  const rows = db.prepare('SELECT id, name, email, phone, active, created FROM accounts WHERE active = 1').all();
  res.json({ success: true, accounts: rows });
});

app.post('/api/accounts', (req, res) => {
  const { name, email, password, phone } = req.body;
  if (!name || !email || !password) {
    return res.json({ success: false, message: 'Name, email aur password required hai' });
  }
  const stmt = db.prepare('INSERT INTO accounts (name, email, password, phone) VALUES (?, ?, ?, ?)');
  const info = stmt.run(name, email, password || '', phone || '');
  res.json({ success: true, id: info.lastInsertRowid });
});

app.delete('/api/accounts/:id', (req, res) => {
  db.prepare('UPDATE accounts SET active = 0 WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// ── Products ──────────────────────────────────────────────────
app.get('/api/products', (req, res) => {
  const rows = db.prepare('SELECT * FROM products ORDER BY created DESC').all();
  res.json({ success: true, products: rows });
});

app.post('/api/products', (req, res) => {
  const { name, description, category, mrp, price, gst, stock, sku } = req.body;
  const stmt = db.prepare(
    'INSERT INTO products (name, description, category, mrp, price, gst, stock, sku) VALUES (?,?,?,?,?,?,?,?)'
  );
  const info = stmt.run(name, description, category, mrp, price, gst, stock, sku);
  res.json({ success: true, id: info.lastInsertRowid });
});

// ── Upload Logs ───────────────────────────────────────────────
app.get('/api/logs', (req, res) => {
  const rows = db.prepare(`
    SELECT l.*, p.name as product_name, a.name as account_name
    FROM upload_logs l
    LEFT JOIN products p ON l.product_id = p.id
    LEFT JOIN accounts a ON l.account_id = a.id
    ORDER BY l.created DESC LIMIT 100
  `).all();
  res.json({ success: true, logs: rows });
});

app.post('/api/upload', (req, res) => {
  const { productId, accountIds } = req.body;
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(productId);
  if (!product) return res.json({ success: false, message: 'Product not found' });

  const results = [];
  for (const accId of accountIds) {
    const account = db.prepare('SELECT * FROM accounts WHERE id = ?').get(accId);
    if (!account) {
      results.push({ accountId: accId, success: false, message: 'Account not found' });
      continue;
    }
    db.prepare('INSERT INTO upload_logs (product_id, account_id, status, message) VALUES (?,?,?,?)')
      .run(productId, accId, 'queued', 'Upload queued — automation pending');
    results.push({ accountId: accId, accountName: account.name, success: true, message: 'Queued' });
  }
  res.json({ success: true, results });
});

// ── Chrome Extension Sync ─────────────────────────────────────
// Extension se live data receive karo
app.post('/api/sync', (req, res) => {
  const { supplierId, type, data, timestamp } = req.body;
  if (!supplierId || !type || !data) {
    return res.json({ success: false, message: 'supplierId, type aur data required hai' });
  }
  // Purana data delete karo same type ka
  db.prepare('DELETE FROM live_data WHERE supplier_id = ? AND type = ?').run(supplierId, type);
  // Naya data save karo
  db.prepare('INSERT INTO live_data (supplier_id, type, data, timestamp) VALUES (?, ?, ?, ?)')
    .run(supplierId, type, JSON.stringify(data), timestamp || new Date().toISOString());
  res.json({ success: true });
});

// Ek supplier ka live data fetch karo
app.get('/api/live/:supplierId', (req, res) => {
  const rows = db.prepare(
    'SELECT type, data, timestamp FROM live_data WHERE supplier_id = ? ORDER BY created DESC'
  ).all(req.params.supplierId);

  const result = {};
  rows.forEach(row => {
    result[row.type] = {
      data: JSON.parse(row.data),
      timestamp: row.timestamp
    };
  });
  res.json({ success: true, data: result });
});

// Sabhi suppliers ka live data
app.get('/api/live', (req, res) => {
  const rows = db.prepare(
    'SELECT supplier_id, type, data, timestamp FROM live_data ORDER BY created DESC'
  ).all();

  const result = {};
  rows.forEach(row => {
    if (!result[row.supplier_id]) result[row.supplier_id] = {};
    result[row.supplier_id][row.type] = {
      data: JSON.parse(row.data),
      timestamp: row.timestamp
    };
  });
  res.json({ success: true, data: result });
});

// ─── START SERVER ────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`✅ MeeshoPro backend running on port ${PORT}`);
});
