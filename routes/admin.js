// routes/admin.js
// Admin dashboard, user management, analytics

const express = require('express');
const bcrypt  = require('bcryptjs');
const router  = express.Router();
const db      = require('../database/db');
const { requireAuth, requireRole } = require('../middleware/auth');

const isAdmin = [requireAuth, requireRole('admin')];

// ── Dashboard ────────────────────────────────────────────────
router.get('/dashboard', isAdmin, (req, res) => {
    const stats = {
        students:   db.prepare("SELECT COUNT(*) AS c FROM students").get().c,
        professors: db.prepare("SELECT COUNT(*) AS c FROM professors").get().c,
        subjects:   db.prepare("SELECT COUNT(*) AS c FROM subjects").get().c,
        branches:   db.prepare("SELECT COUNT(*) AS c FROM branches").get().c,
    };

    // Recent registrations
    const recent = db.prepare(`
        SELECT u.name, u.email, r.name AS role, u.created_at
        FROM users u JOIN roles r ON r.id = u.role_id
        ORDER BY u.created_at DESC LIMIT 8
    `).all();

    // Grade distribution
    const gradeDist = db.prepare(`
        SELECT
            CASE
                WHEN (m.marks * 100.0 / s.max_marks) >= 90 THEN 'O'
                WHEN (m.marks * 100.0 / s.max_marks) >= 80 THEN 'A'
                WHEN (m.marks * 100.0 / s.max_marks) >= 70 THEN 'B'
                WHEN (m.marks * 100.0 / s.max_marks) >= 60 THEN 'C'
                WHEN (m.marks * 100.0 / s.max_marks) >= 50 THEN 'D'
                ELSE 'F'
            END AS grade,
            COUNT(*) AS count
        FROM marks m JOIN subjects s ON s.id = m.subject_id
        GROUP BY grade
    `).all();

    res.render('admin/dashboard', { title: 'Admin Dashboard', stats, recent, gradeDist });
});

// ── All Users ────────────────────────────────────────────────
router.get('/users', isAdmin, (req, res) => {
    const users = db.prepare(`
        SELECT u.*, r.name AS role FROM users u
        JOIN roles r ON r.id = u.role_id
        ORDER BY u.created_at DESC
    `).all();
    res.render('admin/users', { title: 'Manage Users', users });
});

// ── Delete User ───────────────────────────────────────────────
router.post('/users/:id/delete', isAdmin, (req, res) => {
    const { id } = req.params;
    // Prevent self-deletion
    if (parseInt(id) === req.session.user.id) {
        req.flash('error', 'You cannot delete your own account.');
        return res.redirect('/admin/users');
    }
    db.prepare('DELETE FROM users WHERE id = ?').run(id);
    req.flash('success', 'User deleted successfully.');
    res.redirect('/admin/users');
});

// ── Branches ─────────────────────────────────────────────────
router.get('/branches', isAdmin, (req, res) => {
    const branches = db.prepare(`
        SELECT b.*, COUNT(DISTINCT s.id) AS student_count
        FROM branches b
        LEFT JOIN students s ON s.branch_id = b.id
        GROUP BY b.id ORDER BY b.name
    `).all();
    res.render('admin/branches', { title: 'Manage Branches', branches });
});

router.post('/branches', isAdmin, (req, res) => {
    const { name, code } = req.body;
    try {
        db.prepare('INSERT INTO branches (name, code) VALUES (?, ?)').run(name, code.toUpperCase());
        req.flash('success', 'Branch added successfully.');
    } catch {
        req.flash('error', 'Branch code or name already exists.');
    }
    res.redirect('/admin/branches');
});

router.post('/branches/:id/delete', isAdmin, (req, res) => {
    db.prepare('DELETE FROM branches WHERE id = ?').run(req.params.id);
    req.flash('success', 'Branch deleted.');
    res.redirect('/admin/branches');
});

// ── Analytics ────────────────────────────────────────────────
router.get('/analytics', isAdmin, (req, res) => {
    const byBranch = db.prepare(`
        SELECT b.name AS branch, b.code,
               COUNT(DISTINCT st.id) AS students,
               ROUND(AVG(m.marks), 1) AS avg_marks,
               ROUND(AVG(m.marks * 100.0 / sub.max_marks), 1) AS avg_pct
        FROM branches b
        LEFT JOIN students st  ON st.branch_id = b.id
        LEFT JOIN marks m      ON m.student_id = st.id
        LEFT JOIN subjects sub ON sub.id = m.subject_id
        GROUP BY b.id ORDER BY b.name
    `).all();

    const topStudents = db.prepare(`
        SELECT u.name, st.roll_no, b.code AS branch, st.semester,
               ROUND(SUM(m.marks), 1) AS total_marks,
               SUM(sub.max_marks) AS total_max_marks,
               ROUND(AVG(m.marks * 100.0 / sub.max_marks), 1) AS avg_pct
        FROM students st
        JOIN users u    ON u.id = st.user_id
        JOIN branches b ON b.id = st.branch_id
        LEFT JOIN marks m      ON m.student_id = st.id
        LEFT JOIN subjects sub ON sub.id = m.subject_id
        GROUP BY st.id
        ORDER BY avg_pct DESC LIMIT 10
    `).all();

    res.render('admin/analytics', { title: 'Analytics', byBranch, topStudents });
});

// ── Verify / Unverify user ────────────────────────────────────
router.post('/users/:id/verify', isAdmin, (req, res) => {
    const user = db.prepare('SELECT is_verified FROM users WHERE id = ?').get(req.params.id);
    if (user) {
        db.prepare('UPDATE users SET is_verified = ? WHERE id = ?').run(user.is_verified ? 0 : 1, req.params.id);
    }
    req.flash('success', 'User verification status updated.');
    res.redirect('/admin/users');
});

module.exports = router;

router.post('/toggle-import/:userId', requireAuth, requireRole('admin'), (req, res) => {
    const userId = req.params.userId;

    // Remove import from all professors
    db.prepare(`UPDATE professors SET can_import = 0`).run();

    // Give import to selected professor
    db.prepare(`
        UPDATE professors 
        SET can_import = 1 
        WHERE user_id = ?
    `).run(userId);

    req.flash('success', 'Import permission updated');
    res.redirect('/admin/users');
});