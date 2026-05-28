// ─── SYNC ENDPOINT (Extension se data receive karta hai) ─────
// Ye table pehle banao database mein (server start hone pe auto-create hogi)
db.exec(`
  CREATE TABLE IF NOT EXISTS live_data (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    supplier_id TEXT,
    type        TEXT,
    data        TEXT,
    timestamp   TEXT,
    created     TEXT DEFAULT (datetime('now'))
  );
`);

// Extension se data receive karo
app.post('/api/sync', (req, res) => {
  const { supplierId, type, data, timestamp } = req.body;
  
  // Purana data delete karo same type ka
  db.prepare('DELETE FROM live_data WHERE supplier_id = ? AND type = ?').run(supplierId, type);
  
  // Naya data save karo
  db.prepare('INSERT INTO live_data (supplier_id, type, data, timestamp) VALUES (?, ?, ?, ?)')
    .run(supplierId, type, JSON.stringify(data), timestamp);
  
  res.json({ success: true });
});

// Frontend ke liye live data fetch karo
app.get('/api/live/:supplierId', (req, res) => {
  const rows = db.prepare('SELECT type, data, timestamp FROM live_data WHERE supplier_id = ? ORDER BY created DESC')
    .all(req.params.supplierId);
  
  const result = {};
  rows.forEach(row => {
    result[row.type] = {
      data: JSON.parse(row.data),
      timestamp: row.timestamp
    };
  });
  
  res.json({ success: true, data: result });
});

// Sabhi accounts ka live data
app.get('/api/live', (req, res) => {
  const rows = db.prepare('SELECT supplier_id, type, data, timestamp FROM live_data ORDER BY created DESC').all();
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
