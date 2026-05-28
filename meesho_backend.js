// ============================================================
//  MEESHO MULTI-SELLER PORTAL — Backend Automation
//  Stack: Node.js + Puppeteer + Express + SQLite
//  Author: MeeshoPro Portal
// ============================================================

// ─── INSTALL DEPENDENCIES ───────────────────────────────────
// npm install puppeteer express better-sqlite3 sharp dotenv cors axios

const puppeteer  = require('puppeteer');
const express    = require('express');
const Database   = require('better-sqlite3');
const sharp      = require('sharp');
const cors       = require('cors');
const fs         = require('fs');
const path       = require('path');
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
`);

// ─── PUPPETEER BROWSER MANAGER ───────────────────────────────
class BrowserManager {
  constructor() { this.browsers = {}; }

  async getBrowser(accountId) {
    if (!this.browsers[accountId]) {
      this.browsers[accountId] = await puppeteer.launch({
        headless: 'new',
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-blink-features=AutomationControlled',
        ],
        userDataDir: `./sessions/account_${accountId}`,
      });
    }
    return this.browsers[accountId];
  }

  async closeBrowser(accountId) {
    if (this.browsers[accountId]) {
      await this.browsers[accountId].close();
      delete this.browsers[accountId];
    }
  }
}

const browserMgr = new BrowserManager();
if (!fs.existsSync('./sessions')) fs.mkdirSync('./sessions');
if (!fs.existsSync('./uploads'))  fs.mkdirSync('./uploads');

// ─── MEESHO AUTOMATION CLASS ─────────────────────────────────
class MeeshoAutomation {
  constructor(account) {
    this.account = account;
    this.baseUrl = 'https://supplier.meesho.com';
  }

  async getPage() {
    const browser = await browserMgr.getBrowser(this.account.id);
    const pages   = await browser.pages();
    return pages.length > 0 ? pages[0] : browser.newPage();
  }

  async login() {
    const page = await this.getPage();
    try {
      await page.goto(`${this.baseUrl}/login`, { waitUntil: 'networkidle2', timeout: 30000 });

      // Check if already logged in
      const loggedIn = await page.$('.supplier-dashboard, .dashboard-container');
      if (loggedIn) return { success: true, message: 'Already logged in' };

      // Fill login form
      await page.waitForSelector('input[type="email"], input[name="email"], input[placeholder*="email" i]', { timeout: 10000 });
      await page.type('input[type="email"], input[name="email"]', this.account.email, { delay: 80 });

      await page.waitForSelector('input[type="password"]');
      await page.type('input[type="password"]', this.account.password, { delay: 80 });

      await page.click('button[type="submit"]');
      await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 });

      // OTP handling (if Meesho asks for OTP)
      const otpField = await page.$('input[placeholder*="OTP" i]');
      if (otpField) {
        return { success: false, requiresOtp: true, message: 'OTP required. Please enter OTP manually.' };
      }

      return { success: true, message: 'Login successful' };
    } catch (err) {
      return { success: false, message: err.message };
    }
  }

  async uploadCatalog(product) {
    const page = await this.getPage();
    try {
      // Navigate to catalog upload
      await page.goto(`${this.baseUrl}/catalog/upload`, { waitUntil: 'networkidle2', timeout: 30000 });

      // Step 1: Select Category
      await page.waitForSelector('[class*="category"]', { timeout: 10000 });
      await page.click('[class*="category"]');
      await page.waitForSelector('[class*="dropdown"], [role="listbox"]');

      // Type category to search
      const catInput = await page.$('input[placeholder*="category" i]');
      if (catInput) {
        await catInput.type(product.category, { delay: 100 });
        await page.waitForTimeout(1000);
        const option = await page.$('[class*="option"]:first-child, [role="option"]:first-child');
        if (option) await option.click();
      }

      // Step 2: Fill product name
      await page.waitForSelector('input[placeholder*="product name" i], input[name*="name" i]');
      await page.type('input[placeholder*="product name" i]', product.name, { delay: 80 });

      // Step 3: Fill description
      const descField = await page.$('textarea[placeholder*="description" i]');
      if (descField) await descField.type(product.description, { delay: 60 });

      // Step 4: Fill price fields
      await page.waitForSelector('input[placeholder*="MRP" i], input[name*="mrp" i]');
      await page.type('input[placeholder*="MRP" i]', String(product.mrp), { delay: 80 });

      await page.waitForSelector('input[placeholder*="price" i], input[name*="selling" i]');
      await page.type('input[placeholder*="price" i]', String(product.price), { delay: 80 });

      // Step 5: Fill stock
      const stockField = await page.$('input[placeholder*="stock" i], input[name*="stock" i]');
      if (stockField) await stockField.type(String(product.stock), { delay: 80 });

      // Step 6: Upload image
      if (product.image_path && fs.existsSync(product.image_path)) {
        const fileInput = await page.$('input[type="file"]');
        if (fileInput) await fileInput.uploadFile(product.image_path);
        await page.waitForTimeout(2000); // wait for image upload
      }

      // Step 7: Submit
      const submitBtn = await page.$('button[type="submit"], button[class*="submit" i]');
      if (submitBtn) {
        await submitBtn.click();
        await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 });
      }

      // Extract catalog ID from success page
      const catalogId = await page.evaluate(() => {
        const el = document.querySelector('[class*="catalog-id"], [class*="success"]');
        return el ? el.textContent.trim() : 'CATALOG_' + Date.now();
      });

      return { success: true, catalogId, message: 'Catalog uploaded successfully' };
    } catch (err) {
      return { success: false, message: err.message };
    }
  }

  async scrapeAnalytics() {
    const page = await this.getPage();
    try {
      const analytics = {};

      // ── Orders & Revenue ──────────────────────────────
      await page.goto(`${this.baseUrl}/orders`, { waitUntil: 'networkidle2', timeout: 30000 });
      analytics.orders = await page.evaluate(() => {
        const getText = sel => document.querySelector(sel)?.textContent?.trim() || '0';
        return {
          total:    getText('[class*="total-orders"]'),
          pending:  getText('[class*="pending"]'),
          shipped:  getText('[class*="shipped"]'),
          delivered:getText('[class*="delivered"]'),
          revenue:  getText('[class*="revenue"], [class*="earnings"]'),
        };
      });

      // ── Returns & Cancellations ───────────────────────
      await page.goto(`${this.baseUrl}/returns`, { waitUntil: 'networkidle2', timeout: 30000 });
      analytics.returns = await page.evaluate(() => ({
        total:      document.querySelector('[class*="return-count"]')?.textContent?.trim() || '0',
        rate:       document.querySelector('[class*="return-rate"]')?.textContent?.trim() || '0%',
        refunded:   document.querySelector('[class*="refund"]')?.textContent?.trim() || '₹0',
      }));

      // ── Payments & Settlements ────────────────────────
      await page.goto(`${this.baseUrl}/payments`, { waitUntil: 'networkidle2', timeout: 30000 });
      analytics.payments = await page.evaluate(() => ({
        settled:    document.querySelector('[class*="settled"]')?.textContent?.trim() || '₹0',
        pending:    document.querySelector('[class*="pending-amount"]')?.textContent?.trim() || '₹0',
        nextPayout: document.querySelector('[class*="next-payout"]')?.textContent?.trim() || '—',
      }));

      // ── Catalog Performance ───────────────────────────
      await page.goto(`${this.baseUrl}/catalog/performance`, { waitUntil: 'networkidle2', timeout: 30000 });
      analytics.catalogs = await page.evaluate(() => {
        return [...document.querySelectorAll('[class*="catalog-row"]')].map(row => ({
          name:     row.querySelector('[class*="name"]')?.textContent?.trim() || '',
          orders:   row.querySelector('[class*="orders"]')?.textContent?.trim() || '0',
          revenue:  row.querySelector('[class*="revenue"]')?.textContent?.trim() || '₹0',
          returns:  row.querySelector('[class*="returns"]')?.textContent?.trim() || '0',
          rating:   row.querySelector('[class*="rating"]')?.textContent?.trim() || '0',
        }));
      });

      // ── Ratings & Reviews ─────────────────────────────
      await page.goto(`${this.baseUrl}/ratings`, { waitUntil: 'networkidle2', timeout: 30000 });
      analytics.ratings = await page.evaluate(() => ({
        overall: document.querySelector('[class*="overall-rating"]')?.textContent?.trim() || '0',
        total:   document.querySelector('[class*="total-reviews"]')?.textContent?.trim() || '0',
      }));

      analytics.fetchedAt = new Date().toISOString();
      return { success: true, data: analytics };
    } catch (err) {
      return { success: false, message: err.message };
    }
  }
}

// ─── IMAGE OPTIMIZER ─────────────────────────────────────────
class ImageOptimizer {
  // Meesho shipping tiers based on image size
  static TIERS = [
    { maxKB: 300,  cost: 0,  label: 'Tier 1 — Free' },
    { maxKB: 800,  cost: 10, label: 'Tier 2 — ₹10'  },
    { maxKB: Infinity, cost: 25, label: 'Tier 3 — ₹25' },
  ];

  static getTier(sizeKB) {
    return this.TIERS.find(t => sizeKB <= t.maxKB);
  }

  static async optimize(inputPath, outputPath) {
    const originalStats = fs.statSync(inputPath);
    const originalKB    = Math.round(originalStats.size / 1024);
    const originalTier  = this.getTier(originalKB);

    // Try progressive quality reduction to hit Tier 1 (≤300KB)
    const qualities = [85, 70, 55, 40, 30];
    let finalKB = originalKB;
    let usedQuality = 85;

    for (const q of qualities) {
      await sharp(inputPath)
        .resize(1080, 1080, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: q, progressive: true, mozjpeg: true })
        .toFile(outputPath);

      const stats = fs.statSync(outputPath);
      finalKB = Math.round(stats.size / 1024);
      usedQuality = q;

      if (finalKB <= 300) break; // hit Tier 1
    }

    const optimizedTier = this.getTier(finalKB);
    const saved = originalKB - finalKB;
    const costSaved = originalTier.cost - optimizedTier.cost;

    return {
      originalKB,
      originalTier: originalTier.label,
      originalCost: originalTier.cost,
      optimizedKB: finalKB,
      optimizedTier: optimizedTier.label,
      optimizedCost: optimizedTier.cost,
      qualityUsed: usedQuality,
      savedKB: saved,
      costSaved,
      outputPath,
    };
  }

  static async removeBackground(inputPath, outputPath) {
    // Uses sharp to process; for real BG removal integrate remove.bg API
    const REMOVE_BG_KEY = process.env.REMOVE_BG_API_KEY;
    if (REMOVE_BG_KEY) {
      const axios = require('axios');
      const formData = new FormData();
      formData.append('image_file', fs.createReadStream(inputPath));
      formData.append('size', 'auto');
      const res = await axios.post('https://api.remove.bg/v1.0/removebg', formData, {
        headers: { 'X-Api-Key': REMOVE_BG_KEY, ...formData.getHeaders() },
        responseType: 'arraybuffer',
      });
      fs.writeFileSync(outputPath, res.data);
      return { success: true, outputPath };
    }
    // Fallback: just convert to PNG with sharp
    await sharp(inputPath).png().toFile(outputPath);
    return { success: true, outputPath, note: 'Set REMOVE_BG_API_KEY in .env for real BG removal' };
  }
}

// ─── API ROUTES ──────────────────────────────────────────────

// -- Accounts --
app.get('/api/accounts', (req, res) => {
  const rows = db.prepare('SELECT id, name, email, phone, active, created FROM accounts').all();
  res.json({ success: true, accounts: rows });
});

app.post('/api/accounts', (req, res) => {
  const { name, email, password, phone } = req.body;
  const stmt = db.prepare('INSERT INTO accounts (name, email, password, phone) VALUES (?, ?, ?, ?)');
  const info = stmt.run(name, email, password, phone);
  res.json({ success: true, id: info.lastInsertRowid });
});

app.delete('/api/accounts/:id', (req, res) => {
  db.prepare('UPDATE accounts SET active = 0 WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// -- Login --
app.post('/api/accounts/:id/login', async (req, res) => {
  const account = db.prepare('SELECT * FROM accounts WHERE id = ?').get(req.params.id);
  if (!account) return res.json({ success: false, message: 'Account not found' });
  const bot    = new MeeshoAutomation(account);
  const result = await bot.login();
  res.json(result);
});

// -- Products --
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

// -- Catalog Upload --
app.post('/api/upload', async (req, res) => {
  const { productId, accountIds } = req.body;
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(productId);
  if (!product) return res.json({ success: false, message: 'Product not found' });

  const results = [];
  for (const accId of accountIds) {
    const account = db.prepare('SELECT * FROM accounts WHERE id = ?').get(accId);
    if (!account) { results.push({ accountId: accId, success: false, message: 'Account not found' }); continue; }

    const bot    = new MeeshoAutomation(account);
    await bot.login();
    const result = await bot.uploadCatalog(product);

    db.prepare('INSERT INTO upload_logs (product_id, account_id, status, message, catalog_id) VALUES (?,?,?,?,?)')
      .run(productId, accId, result.success ? 'success' : 'failed', result.message, result.catalogId || null);

    results.push({ accountId: accId, accountName: account.name, ...result });
  }

  res.json({ success: true, results });
});

// -- Analytics --
app.get('/api/analytics/:accountId', async (req, res) => {
  const { accountId } = req.params;
  const { refresh }   = req.query;
  const account = db.prepare('SELECT * FROM accounts WHERE id = ?').get(accountId);
  if (!account) return res.json({ success: false, message: 'Account not found' });

  // Check cache (5 min)
  if (!refresh) {
    const cached = db.prepare(
      "SELECT * FROM analytics_cache WHERE account_id = ? AND fetched_at > datetime('now', '-5 minutes') ORDER BY id DESC LIMIT 1"
    ).get(accountId);
    if (cached) return res.json({ success: true, data: JSON.parse(cached.data), fromCache: true });
  }

  const bot    = new MeeshoAutomation(account);
  await bot.login();
  const result = await bot.scrapeAnalytics();

  if (result.success) {
    db.prepare('INSERT INTO analytics_cache (account_id, data) VALUES (?, ?)').run(accountId, JSON.stringify(result.data));
  }

  res.json(result);
});

// -- Upload logs --
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

// -- Image: Upload & Optimize --
app.post('/api/image/optimize', async (req, res) => {
  const { imageBase64, filename } = req.body;
  const inputPath  = path.join('./uploads', 'orig_' + filename);
  const outputPath = path.join('./uploads', 'opt_'  + filename);

  fs.writeFileSync(inputPath, Buffer.from(imageBase64, 'base64'));
  const result = await ImageOptimizer.optimize(inputPath, outputPath);

  const optimizedBase64 = fs.readFileSync(outputPath).toString('base64');
  res.json({ success: true, ...result, optimizedBase64 });
});

// -- Image: Remove Background --
app.post('/api/image/remove-bg', async (req, res) => {
  const { imageBase64, filename } = req.body;
  const inputPath  = path.join('./uploads', 'orig_' + filename);
  const outputPath = path.join('./uploads', 'nobg_' + filename.replace(/\.[^.]+$/, '.png'));

  fs.writeFileSync(inputPath, Buffer.from(imageBase64, 'base64'));
  const result = await ImageOptimizer.removeBackground(inputPath, outputPath);

  if (result.success) {
    const base64 = fs.readFileSync(outputPath).toString('base64');
    res.json({ success: true, imageBase64: base64, outputPath });
  } else {
    res.json(result);
  }
});

// -- Health check --
app.get('/api/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

// ─── START SERVER ────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`✅ MeeshoPro backend running on http://localhost:${PORT}`);
});
