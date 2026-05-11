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
      created_at TEXT DEFAULT (datetime('now'))
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

  // Mark existing accounts without a password as needing reset
  const pwRows = db.exec("SELECT id FROM users WHERE password IS NULL");
  if (pwRows.length > 0 && pwRows[0].values.length > 0) {
    db.run("UPDATE users SET force_reset = 1 WHERE password IS NULL");
  }

  // Seed demo user
  const rows = db.exec("SELECT COUNT(*) as c FROM users");
  if (rows[0].values[0][0] === 0) {
    db.run(
      "INSERT INTO users (nickname, signature, checkin_interval_days, last_checkin_at) VALUES (?, ?, ?, ?)",
      ["小明", "好好生活", 3, new Date().toISOString()]
    );
  }

  save();
  return { db, save: throttledSave };
}

module.exports = { initDb };
