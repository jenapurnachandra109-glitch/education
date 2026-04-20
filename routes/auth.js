// routes/auth.js
// Handles: register, login, logout, email verification, password reset
const {
    requireAuth,
    requireRole,
    requireImportPermission,
    redirectIfAuth
} = require('../middleware/auth');

const express  = require('express');
const bcrypt   = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const router   = express.Router();
const db       = require('../database/db');
const mailer   = require('../utils/mailer');



// ── Helper: Unix now + offset ────────────────────────────────
const nowPlus = (seconds) => Math.floor(Date.now() / 1000) + seconds;
const nowSec  = ()        => Math.floor(Date.now() / 1000);

// ════════════════════════════════════════════════════════════
// GET /  → redirect to dashboard or login
// ════════════════════════════════════════════════════════════
router.get('/', (req, res) => {
    if (req.session.user) return res.redirect('/dashboard');
    res.redirect('/login');
});

// ════════════════════════════════════════════════════════════
// GET /login
// ════════════════════════════════════════════════════════════
router.get('/login', redirectIfAuth, (req, res) => {
    res.render('auth/login', { title: 'Login' });
});

// ════════════════════════════════════════════════════════════
// POST /login
// ════════════════════════════════════════════════════════════
router.post('/login', redirectIfAuth, (req, res) => {
  const { email, password, roll_no } = req.body;

  // =====================
  // 1. Normal login
  // =====================
  if (email && password) {
    const user = db.prepare(`
      SELECT u.id, u.name, u.email, u.password_hash, r.name AS role
      FROM users u
      JOIN roles r ON r.id = u.role_id
      WHERE u.email = ?
    `).get(email);

    if (user && bcrypt.compareSync(password, user.password_hash)) {
      req.session.user = {
        id: user.id,
        name: user.name,
        role: user.role
      };
      return res.redirect('/dashboard');
    }
  }

  // =====================
  // 2. Student login via roll_no
  // =====================
  if (roll_no) {
    const student = db.prepare(`
      SELECT s.*, u.id as user_id
      FROM students s
      LEFT JOIN users u ON u.id = s.user_id
      WHERE s.roll_no = ?
    `).get(roll_no);

    if (!student) {
      req.flash('error', 'Student not found. Please register.');
      return res.redirect('/register');
    }

    // Auto create account if not linked
    if (!student.user_id) {
      const defaultPassword = '12345678';
      const hash = bcrypt.hashSync(defaultPassword, 12);

      const roleRow = db.prepare(`SELECT id FROM roles WHERE name='student'`).get();

      const result = db.prepare(`
        INSERT INTO users (name, email, password_hash, role_id)
        VALUES (?, ?, ?, ?)
      `).run(
        student.name || 'Student',
        `${student.roll_no}@auto.com`,
        hash,
        roleRow.id
      );

      const userId = result.lastInsertRowid;

      db.prepare(`
        UPDATE students SET user_id = ? WHERE roll_no = ?
      `).run(userId, roll_no);

      req.session.user = {
        id: userId,
        name: student.name || 'Student',
        role: 'student'
      };

      req.flash('info', 'Auto account created. Default password: 12345678');
      return res.redirect('/dashboard');
    }

    // Already linked → login directly
    req.session.user = {
      id: student.user_id,
      name: student.name || 'Student',
      role: 'student'
    };

    return res.redirect('/dashboard');
  }

  // fallback
  req.flash('error', 'Invalid login.');
  res.redirect('/login');
});

// ════════════════════════════════════════════════════════════
// GET /register
// ════════════════════════════════════════════════════════════
router.get('/register', redirectIfAuth, (req, res) => {
    const branches = db.prepare('SELECT * FROM branches ORDER BY name').all();
    res.render('auth/register', { title: 'Register', branches });
});

// ════════════════════════════════════════════════════════════
// POST /register
// ════════════════════════════════════════════════════════════
router.post('/register', redirectIfAuth, (req, res) => {
    const { name, email, password, confirm_password, role, roll_no, branch_id, semester, employee_id } = req.body;
    const branches = db.prepare('SELECT * FROM branches ORDER BY name').all();

    // Validation
    if (password !== confirm_password) {
        req.flash('error', 'Passwords do not match.');
        return res.redirect('/register');
    }
    if (password.length < 8) {
        req.flash('error', 'Password must be at least 8 characters.');
        return res.redirect('/register');
    }
    if (!['professor', 'student'].includes(role)) {
        req.flash('error', 'Invalid role selected.');
        return res.redirect('/register');
    }

    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (existing) {
        req.flash('error', 'An account with this email already exists.');
        return res.redirect('/register');
    }

    const hash      = bcrypt.hashSync(password, 12);
    const token     = uuidv4();
    const tokenExp  = nowPlus(24 * 3600);  // 24 hours
    const roleRow   = db.prepare('SELECT id FROM roles WHERE name = ?').get(role);

    const insertUser = db.prepare(`
        INSERT INTO users (name, email, password_hash, role_id, verify_token, verify_token_exp)
        VALUES (?, ?, ?, ?, ?, ?)
    `);

    const createUser = db.transaction(() => {
        const info = insertUser.run(name, email, hash, roleRow.id, token, tokenExp);
        const userId = info.lastInsertRowid;

        if (role === 'student') {

            // 1. Check if student exists (from CSV)
            const student = db.prepare(
                'SELECT * FROM students WHERE roll_no = ?'
            ).get(roll_no);

            if (!student) {
                throw new Error('STUDENT_NOT_FOUND');
            }

            if (student.user_id) {
                throw new Error('ACCOUNT_EXISTS');
            }

            // 2. Link existing student with user
            db.prepare(`
                UPDATE students
                SET user_id = ?, semester = ?, branch_id = ?
                WHERE roll_no = ?
            `).run(userId, semester, branch_id, roll_no);

            } else {
            db.prepare(`
                INSERT INTO professors (user_id, employee_id)
                VALUES (?, ?)
            `).run(userId, employee_id || `EMP${userId}`);
        }
        return userId;
    });

    try {
        createUser();
        mailer.sendVerificationEmail(email, name, token);
        req.flash('success', 'Registration successful! Please check your email to verify your account.');
        res.redirect('/login');
    } catch (err) {
        console.error('Registration error:', err);

        if (err.message === 'STUDENT_NOT_FOUND') {
            req.flash('error', 'Student record not found. Contact admin.');
        } else if (err.message === 'ACCOUNT_EXISTS') {
            req.flash('error', 'Account already exists for this roll number.');
        } else if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
            req.flash('error', 'Email already exists.');
        } else {
            req.flash('error', 'Registration failed.');
        }

        res.redirect('/register');
    }
});

// ════════════════════════════════════════════════════════════
// GET /verify-email?token=…
// ════════════════════════════════════════════════════════════
router.get('/verify-email', (req, res) => {
    const { token } = req.query;
    const user = db.prepare('SELECT * FROM users WHERE verify_token = ?').get(token);

    if (!user || user.verify_token_exp < nowSec()) {
        req.flash('error', 'Verification link is invalid or has expired.');
        return res.redirect('/login');
    }

    db.prepare(`
        UPDATE users SET is_verified = 1, verify_token = NULL, verify_token_exp = NULL
        WHERE id = ?
    `).run(user.id);

    req.flash('success', 'Email verified successfully! You can now log in.');
    res.redirect('/login');
});

// ════════════════════════════════════════════════════════════
// GET /forgot-password
// ════════════════════════════════════════════════════════════
router.get('/forgot-password', redirectIfAuth, (req, res) => {
    res.render('auth/forgot-password', { title: 'Forgot Password' });
});

// ════════════════════════════════════════════════════════════
// POST /forgot-password
// ════════════════════════════════════════════════════════════
router.post('/forgot-password', redirectIfAuth, (req, res) => {
    const { email } = req.body;
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);

    // Always show the same message to prevent user enumeration
    req.flash('info', 'If that email exists, a password reset link has been sent.');

    if (user) {
        const token     = uuidv4();
        const expiresAt = nowPlus(3600);  // 1 hour
        db.prepare(`
            INSERT OR REPLACE INTO password_resets (user_id, token, expires_at)
            VALUES (?, ?, ?)
        `).run(user.id, token, expiresAt);
        mailer.sendPasswordResetEmail(email, user.name, token);
    }
    res.redirect('/forgot-password');
});

// ════════════════════════════════════════════════════════════
// GET /reset-password?token=…
// ════════════════════════════════════════════════════════════
router.get('/reset-password', redirectIfAuth, (req, res) => {
    const { token } = req.query;
    const reset = db.prepare('SELECT * FROM password_resets WHERE token = ? AND used = 0').get(token);

    if (!reset || reset.expires_at < nowSec()) {
        req.flash('error', 'Reset link is invalid or has expired.');
        return res.redirect('/forgot-password');
    }
    res.render('auth/reset-password', { title: 'Reset Password', token });
});

// ════════════════════════════════════════════════════════════
// POST /reset-password
// ════════════════════════════════════════════════════════════
router.post('/reset-password', redirectIfAuth, (req, res) => {
    const { token, password, confirm_password } = req.body;

    if (password !== confirm_password) {
        req.flash('error', 'Passwords do not match.');
        return res.redirect(`/reset-password?token=${token}`);
    }
    if (password.length < 8) {
        req.flash('error', 'Password must be at least 8 characters.');
        return res.redirect(`/reset-password?token=${token}`);
    }

    const reset = db.prepare('SELECT * FROM password_resets WHERE token = ? AND used = 0').get(token);
    if (!reset || reset.expires_at < nowSec()) {
        req.flash('error', 'Reset link is invalid or expired.');
        return res.redirect('/forgot-password');
    }

    const hash = bcrypt.hashSync(password, 12);
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, reset.user_id);
    db.prepare('UPDATE password_resets SET used = 1 WHERE token = ?').run(token);

    req.flash('success', 'Password reset successfully. Please log in.');
    res.redirect('/login');
});

// ════════════════════════════════════════════════════════════
// GET /dashboard  → role-based redirect
// ════════════════════════════════════════════════════════════
router.get('/dashboard', requireAuth, (req, res) => {
    const role = req.session.user.role;
    if (role === 'admin')     return res.redirect('/admin/dashboard');
    if (role === 'professor') return res.redirect('/professor/dashboard');
    if (role === 'student')   return res.redirect('/student/dashboard');
    res.redirect('/login');
});

// ════════════════════════════════════════════════════════════
// GET /logout
// ════════════════════════════════════════════════════════════
router.get('/logout', requireAuth, (req, res) => {
    req.session.destroy(() => res.redirect('/login'));
});

module.exports = router;
