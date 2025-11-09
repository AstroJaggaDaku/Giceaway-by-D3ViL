const Database = require('better-sqlite3');
const path = require('path');
const dbPath = process.env.DB_PATH || path.join(__dirname, 'giveaways.db');
const db = new Database(dbPath);

db.prepare(`CREATE TABLE IF NOT EXISTS admins (
  id INTEGER PRIMARY KEY,
  email TEXT UNIQUE,
  password_hash TEXT
)`).run();

db.prepare(`CREATE TABLE IF NOT EXISTS giveaways (
  id TEXT PRIMARY KEY,
  title TEXT,
  description TEXT,
  start_at INTEGER,
  end_at INTEGER,
  max_winners INTEGER DEFAULT 1,
  created_at INTEGER
)`).run();

db.prepare(`CREATE TABLE IF NOT EXISTS participants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  giveaway_id TEXT,
  name TEXT,
  contact TEXT,
  note TEXT,
  created_at INTEGER
)`).run();

db.prepare(`CREATE TABLE IF NOT EXISTS winners (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  giveaway_id TEXT,
  participant_id INTEGER,
  created_at INTEGER
)`).run();

module.exports = db;
