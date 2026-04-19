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
    user_id INTEGER,
    roll_no TEXT,
    branch_id INTEGER,
    semester INTEGER
  )
`).run();

// SUBJECTS TABLE (example)
// subjects table
db.prepare(`
  CREATE TABLE IF NOT EXISTS subjects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    code TEXT,
    branch_id INTEGER,
    semester INTEGER,
    professor_id INTEGER,
    max_marks INTEGER
  )
`).run();

// ✅ ADD THIS RIGHT HERE
db.exec(`
  CREATE UNIQUE INDEX IF NOT EXISTS idx_marks_student_subject
  ON marks(student_id, subject_id);
`);

module.exports = db;

const check = db.prepare(`
  SELECT sql FROM sqlite_master 
  WHERE type='table' AND name='marks'
`).get();

console.log("MARKS TABLE:", check.sql);