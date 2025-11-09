const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');
const path = require('path');

const dbPath = process.env.DB_PATH || path.join(__dirname, 'giveaways.db');

let dbInstance;

/**
 * Initialize and return a singleton async database connection.
 * Automatically creates all required tables if they don't exist.
 */
async function getDB() {
  if (dbInstance) return dbInstance;

  dbInstance = await open({
    filename: dbPath,
    driver: sqlite3.Database,
  });

  // Create tables if not exist
  await dbInstance.exec(`
    CREATE TABLE IF NOT EXISTS admins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE,
      password_hash TEXT
    );

    CREATE TABLE IF NOT EXISTS giveaways (
      id TEXT PRIMARY KEY,
      title TEXT,
      description TEXT,
      start_at INTEGER,
      end_at INTEGER,
      max_winners INTEGER DEFAULT 1,
      created_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS participants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      giveaway_id TEXT,
      name TEXT,
      contact TEXT,
      note TEXT,
      created_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS winners (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      giveaway_id TEXT,
      participant_id INTEGER,
      created_at INTEGER
    );
  `);

  return dbInstance;
}

module.exports = getDB;
