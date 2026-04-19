const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(
  path.join(__dirname, 'edutrack.db')
);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ✅ CREATE ALL TABLES HERE

// MARKS TABLE
db.prepare(`
CREATE TABLE IF NOT EXISTS marks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER,
  subject_id INTEGER,
  marks INTEGER,
  updated_by INTEGER,
  updated_at TEXT
)
`).run();

// STUDENTS TABLE (example – adjust if needed)
db.prepare(`
  CREATE TABLE IF NOT EXISTS students (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    email TEXT
  )
`).run();

// SUBJECTS TABLE (example)
db.prepare(`
  CREATE TABLE IF NOT EXISTS subjects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT
  )
`).run();

module.exports = db;