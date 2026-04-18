// routes/professor.js
// Professor dashboard and student management

const express = require('express');
const router  = express.Router();
const db      = require('../database/db');
const { requireAuth, requireRole } = require('../middleware/auth');

const isProf = [requireAuth, requireRole('professor', 'admin')];

// ── Dashboard ────────────────────────────────────────────────
router.get('/dashboard', isProf, (req, res) => {
    const subjects = db.prepare(`
        SELECT s.*, b.name AS branch_name, b.code AS branch_code
        FROM subjects s 
        JOIN branches b ON b.id = s.branch_id
        WHERE s.professor_id = ?
        ORDER BY s.created_at DESC
    `).all(req.session.user.id);
    const recentMarks = db.prepare(`
        SELECT u.name, st.roll_no, sub.name AS subject, m.marks, sub.max_marks,
               m.updated_at
        FROM marks m
        JOIN students st  ON st.id = m.student_id
        JOIN users u      ON u.id  = st.user_id
        JOIN subjects sub ON sub.id = m.subject_id
        WHERE m.updated_by = ?
        ORDER BY m.updated_at DESC LIMIT 10
    `).all(req.session.user.id);

    res.render('professor/dashboard', { title: 'Professor Dashboard', subjects, recentMarks });
});

// ── Students in a subject ─────────────────────────────────────
router.get('/subject/:subjectId/students', isProf, (req, res) => {
    const subject = db.prepare(`
        SELECT s.*, b.name AS branch_name FROM subjects s
        JOIN branches b ON b.id = s.branch_id
        WHERE s.id = ?
    `).get(req.params.subjectId);

    if (!subject) {
        req.flash('error', 'Subject not found.');
        return res.redirect('/professor/dashboard');
    }

    if (req.session.user.role === 'professor' && subject.professor_id !== req.session.user.id) {
        req.flash('error', 'You can only manage marks for your assigned subjects.');
        return res.redirect('/subjects');
    }

    const students = db.prepare(`
        SELECT st.id AS student_id, u.name, u.email, st.roll_no, st.semester,
               m.marks, m.updated_at
        FROM students st
        JOIN users u ON u.id = st.user_id
        LEFT JOIN marks m ON m.student_id = st.id AND m.subject_id = ?
        WHERE st.branch_id = ? AND st.semester = ?
        ORDER BY st.roll_no
    `).all(subject.id, subject.branch_id, subject.semester);

    res.render('professor/students', { title: 'Student Marks', subject, students });
});

module.exports = router;
