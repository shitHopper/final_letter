const initSqlJs = require("sql.js");
const path = require("path");
const fs = require("fs");

const DB_PATH = path.join(__dirname, "juebixin.db");

let db;
let saveTimer;

function save() {
  if (!db) return;
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(DB_PATH, buffer);
}

function throttledSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 500);
}
// 立即同步保存，用于关键写入
throttledSave.sync = function () {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  save();
};

async function initDb() {
  const SQL = await initSqlJs();

  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nickname TEXT DEFAULT '匿名用户',
      signature TEXT DEFAULT '',
      checkin_interval_days INTEGER DEFAULT 3,
      last_checkin_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      alert_interval_days INTEGER DEFAULT 3,
      push_interval_days INTEGER DEFAULT 3,
      status TEXT DEFAULT 'alert',
      alert_started_at TEXT,
      push_started_at TEXT
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS letters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      push_method INTEGER NOT NULL,
      push_target TEXT NOT NULL,
      is_sent INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      content TEXT NOT NULL,
      image_url TEXT DEFAULT '',
      likes INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      post_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      content TEXT NOT NULL,
      reply_to_id INTEGER DEFAULT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (post_id) REFERENCES posts(id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS post_likes (
      post_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      PRIMARY KEY (post_id, user_id),
      FOREIGN KEY (post_id) REFERENCES posts(id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS contacts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      notify_method INTEGER NOT NULL,
      notify_target TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  // Migrate: add image_url to posts if missing
  try {
    db.run("ALTER TABLE posts ADD COLUMN image_url TEXT DEFAULT ''");
  } catch (e) { /* column already exists */ }

  // Migrate: add reply_to_id to comments if missing
  try {
    db.run("ALTER TABLE comments ADD COLUMN reply_to_id INTEGER DEFAULT NULL");
  } catch (e) { /* column already exists */ }

  // Migrate: add password to letters if missing
  try {
    db.run("ALTER TABLE letters ADD COLUMN password TEXT DEFAULT NULL");
  } catch (e) { /* column already exists */ }

  // Migrate: add password to users if missing
  try {
    db.run("ALTER TABLE users ADD COLUMN password TEXT DEFAULT NULL");
  } catch (e) { /* column already exists */ }

  // Migrate: add force_reset to users if missing
  try {
    db.run("ALTER TABLE users ADD COLUMN force_reset INTEGER DEFAULT 0");
  } catch (e) { /* column already exists */ }

  // Migrate: add sent_at to letters if missing
  try {
    db.run("ALTER TABLE letters ADD COLUMN sent_at TEXT DEFAULT NULL");
  } catch (e) { /* column already exists */ }

  // Migrate: add alert/push interval and status fields to users
  try {
    db.run("ALTER TABLE users ADD COLUMN alert_interval_days INTEGER DEFAULT 3");
  } catch (e) { /* column already exists */ }
  try {
    db.run("ALTER TABLE users ADD COLUMN push_interval_days INTEGER DEFAULT 3");
  } catch (e) { /* column already exists */ }
  try {
    db.run("ALTER TABLE users ADD COLUMN status TEXT DEFAULT 'alert'");
  } catch (e) { /* column already exists */ }
  try {
    db.run("ALTER TABLE users ADD COLUMN alert_started_at TEXT");
  } catch (e) { /* column already exists */ }
  try {
    db.run("ALTER TABLE users ADD COLUMN push_started_at TEXT");
  } catch (e) { /* column already exists */ }

  // Migrate: add avatar_url and gender to users
  try {
    db.run("ALTER TABLE users ADD COLUMN avatar_url TEXT DEFAULT ''");
  } catch (e) { /* column already exists */ }
  try {
    db.run("ALTER TABLE users ADD COLUMN gender TEXT DEFAULT ''");
  } catch (e) { /* column already exists */ }

  // Migrate: add email and email_verified to users
  try {
    db.run("ALTER TABLE users ADD COLUMN email TEXT DEFAULT NULL");
  } catch (e) { /* column already exists */ }
  try {
    db.run("ALTER TABLE users ADD COLUMN email_verified INTEGER DEFAULT 0");
  } catch (e) { /* column already exists */ }

  // Migrate: add token_version to users for JWT invalidation on password change
  try {
    db.run("ALTER TABLE users ADD COLUMN token_version INTEGER DEFAULT 0");
  } catch (e) { /* column already exists */ }

  // Email verification codes table
  db.run(`
    CREATE TABLE IF NOT EXISTS email_verification_codes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL,
      code TEXT NOT NULL,
      type TEXT NOT NULL,
      user_id INTEGER,
      attempts INTEGER DEFAULT 0,
      expires_at TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // Unique index on email (NULL values excluded)
  try {
    db.run("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email) WHERE email IS NOT NULL");
  } catch (e) { /* index already exists */ }

  // Unique index on nickname
  try {
    db.run("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_nickname ON users(nickname)");
  } catch (e) { /* index already exists */ }

  // 初始化：将 checkin_interval_days 复制到 alert_interval_days，alert_started_at 复制自 last_checkin_at
  function queryAll(query, params = []) {
    const stmt = db.prepare(query);
    stmt.bind(params);
    const results = [];
    while (stmt.step()) results.push(stmt.getAsObject());
    stmt.free();
    return results;
  }
  const needInit = queryAll("SELECT id, checkin_interval_days, last_checkin_at FROM users WHERE alert_started_at IS NULL");
  for (const u of needInit) {
    const intervalDays = u.checkin_interval_days || 3;
    const lastAt = u.last_checkin_at;
    const now = Date.now();
    const isOverdue = lastAt ? now > new Date(lastAt).getTime() + intervalDays * 86400000 : false;
    db.run(
      "UPDATE users SET alert_interval_days = ?, alert_started_at = ?, status = ? WHERE id = ?",
      [intervalDays, lastAt || new Date().toISOString(), isOverdue ? 'push' : 'alert', u.id]
    );
  }

  // Mark existing accounts without a password as needing reset
  const pwRows = db.exec("SELECT id FROM users WHERE password IS NULL");
  if (pwRows.length > 0 && pwRows[0].values.length > 0) {
    db.run("UPDATE users SET force_reset = 1 WHERE password IS NULL");
  }

  // Seed demo user
  const rows = db.exec("SELECT COUNT(*) as c FROM users");
  if (rows[0].values[0][0] === 0) {
    const now = new Date().toISOString();
    db.run(
      "INSERT INTO users (nickname, signature, checkin_interval_days, last_checkin_at, alert_interval_days, push_interval_days, status, alert_started_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      ["小明", "好好生活", 3, now, 3, 3, 'alert', now]
    );
  }

  save();
  return { db, save: throttledSave };
}

module.exports = { initDb };
