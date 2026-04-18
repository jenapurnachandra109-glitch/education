const db = require('./db');
const bcrypt = require('bcryptjs');

// ✅ CREATE USERS TABLE FIRST
db.prepare(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    email TEXT UNIQUE,
    password_hash TEXT,
    role_id INTEGER,
    is_verified INTEGER
  )
`).run();

// ✅ CREATE MARKS TABLE
db.prepare(`
  CREATE TABLE IF NOT EXISTS marks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id INTEGER,
    subject TEXT,
    marks INTEGER
  )
`).run();

const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const db = require('./db');

// Load schema.sql first
const schema = fs.readFileSync(
  path.join(__dirname, 'schema.sql'),
  'utf8'
);

// Create tables
db.exec(schema);

console.log('Tables created successfully.');

// Check admin exists
const adminExists = db
  .prepare("SELECT * FROM users WHERE email = ?")
  .get('admin@edutrack.com');

if (!adminExists) {
  const hash = bcrypt.hashSync('admin123', 12);

  db.prepare(`
    INSERT INTO users (name, email, password_hash, role_id, is_verified)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    'Administrator',
    'admin@edutrack.com',
    hash,
    1,
    1
  );

  console.log('Admin created');
}

console.log('Database initialized successfully.');