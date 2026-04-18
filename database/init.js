const fs = require('fs');
const path = require('path');
const db = require('./db');
const bcrypt = require('bcryptjs');

// ✅ Load schema.sql
const schema = fs.readFileSync(
  path.join(__dirname, 'schema.sql'),
  'utf-8'
);

// ✅ Create all tables
db.exec(schema);

console.log('Tables created successfully.');

// ✅ Check admin exists
const adminExists = db
  .prepare("SELECT * FROM users WHERE email = ?")
  .get('admin@edutrack.com');

// ✅ Insert admin if not exists
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