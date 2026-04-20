const fs = require('fs');
const path = require('path');
const db = require('./db');
const bcrypt = require('bcryptjs');

const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf-8');

function getColumnNames(tableName) {
  return db.prepare(`PRAGMA table_info(${tableName})`).all().map((column) => column.name);
}

function hasAllColumns(tableName, expectedColumns) {
  const existing = new Set(getColumnNames(tableName));
  return expectedColumns.every((column) => existing.has(column));
}

function recreateStudentsTable() {
  db.exec(`ALTER TABLE students RENAME TO students_old`);

  db.exec(`
    CREATE TABLE students (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id   INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      roll_no   TEXT    NOT NULL UNIQUE,
      branch_id INTEGER NOT NULL REFERENCES branches(id),
      semester  INTEGER NOT NULL CHECK (semester BETWEEN 1 AND 8),
      dob       TEXT,
      address   TEXT
    )
  `);

  db.exec(`
    INSERT INTO students (id, user_id, roll_no, branch_id, semester)
    SELECT id, user_id, roll_no, branch_id, semester
    FROM students_old
  `);

  db.exec(`DROP TABLE students_old`);
  console.log('Migration applied: rebuilt students table');
}

function recreateSubjectsTable() {
  db.exec(`ALTER TABLE subjects RENAME TO subjects_old`);

  db.exec(`
    CREATE TABLE subjects (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      name         TEXT    NOT NULL,
      code         TEXT    NOT NULL UNIQUE,
      type         TEXT    NOT NULL CHECK (type IN ('THEORY','LAB')),
      max_marks    INTEGER NOT NULL DEFAULT 100,
      semester     INTEGER NOT NULL CHECK (semester BETWEEN 1 AND 8),
      branch_id    INTEGER NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
      professor_id INTEGER REFERENCES users(id),
      created_by   INTEGER REFERENCES users(id),
      created_at   INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    )
  `);

  db.exec(`
    INSERT INTO subjects (id, name, code, type, max_marks, semester, branch_id, professor_id, created_at)
    SELECT
      id,
      name,
      code,
      'THEORY',
      COALESCE(max_marks, 100),
      semester,
      branch_id,
      professor_id,
      CAST(strftime('%s','now') AS INTEGER)
    FROM subjects_old
  `);

  db.exec(`DROP TABLE subjects_old`);
  console.log('Migration applied: rebuilt subjects table');
}

function recreateMarksTable() {
  db.exec(`ALTER TABLE marks RENAME TO marks_old`);

  db.exec(`
    CREATE TABLE marks (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
      marks      REAL    NOT NULL DEFAULT 0,
      updated_by INTEGER REFERENCES users(id),
      updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      UNIQUE (student_id, subject_id)
    )
  `);

  db.exec(`
    INSERT OR IGNORE INTO marks (id, student_id, subject_id, marks, updated_by, updated_at)
    SELECT
      id,
      student_id,
      subject_id,
      COALESCE(marks, 0),
      updated_by,
      COALESCE(updated_at, CAST(strftime('%s','now') AS INTEGER))
    FROM marks_old
  `);

  db.exec(`DROP TABLE marks_old`);
  console.log('Migration applied: rebuilt marks table');
}

function runRepairMigrations() {
  const studentsExpected = ['id', 'user_id', 'roll_no', 'branch_id', 'semester', 'dob', 'address'];
  const subjectsExpected = ['id', 'name', 'code', 'type', 'max_marks', 'semester', 'branch_id', 'professor_id', 'created_by', 'created_at'];
  const marksExpected = ['id', 'student_id', 'subject_id', 'marks', 'updated_by', 'updated_at'];

  const needsStudentsRepair = !hasAllColumns('students', studentsExpected);
  const needsSubjectsRepair = !hasAllColumns('subjects', subjectsExpected);
  const needsMarksRepair = !hasAllColumns('marks', marksExpected);

  if (!needsStudentsRepair && !needsSubjectsRepair && !needsMarksRepair) {
    return;
  }

  db.pragma('foreign_keys = OFF');

  try {
    const migrate = db.transaction(() => {
      if (needsStudentsRepair) recreateStudentsTable();
      if (needsSubjectsRepair) recreateSubjectsTable();
      if (needsMarksRepair) recreateMarksTable();
    });

    migrate();
  } finally {
    db.pragma('foreign_keys = ON');
  }

  db.exec(schema);
}

db.exec(schema);
runRepairMigrations();

// Migration: ensure older databases get the professor_id column
const subjectColumns = db.prepare(`PRAGMA table_info(subjects)`).all();
const hasProfessorId = subjectColumns.some((column) => column.name === 'professor_id');

if (!hasProfessorId) {
  db.exec(`
    ALTER TABLE subjects
    ADD COLUMN professor_id INTEGER REFERENCES users(id)
  `);
  console.log('Migration applied: added subjects.professor_id');
}

console.log('Tables created successfully.');

const adminRole = db.prepare(`SELECT id FROM roles WHERE name = ?`).get('admin');

if (!adminRole) {
  throw new Error('Admin role is missing from roles table.');
}

const adminExists = db.prepare(`SELECT id, role_id FROM users WHERE email = ?`).get('admin@edutrack.com');

if (!adminExists) {
  const hash = bcrypt.hashSync('admin123', 12);

  db.prepare(`
    INSERT INTO users (name, email, password_hash, role_id, is_verified)
    VALUES (?, ?, ?, ?, ?)
  `).run('Administrator', 'admin@edutrack.com', hash, adminRole.id, 1);

  console.log('Admin created');
} else if (adminExists.role_id !== adminRole.id) {
  db.prepare(`
    UPDATE users
    SET role_id = ?, is_verified = 1, updated_at = strftime('%s','now')
    WHERE id = ?
  `).run(adminRole.id, adminExists.id);

  console.log('Admin role repaired');
}

console.log('Database initialized successfully.');

