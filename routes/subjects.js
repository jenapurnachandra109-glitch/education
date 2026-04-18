// routes/subjects.js
// Create, read, update, delete subjects

const express = require('express');
const router  = express.Router();
const db      = require('../database/db');
const { requireAuth, requireRole } = require('../middleware/auth');

const adminOnly = [requireAuth, requireRole('admin')];

const professorOptionsQuery = `
    SELECT u.id, u.name, p.employee_id
    FROM professors p
    JOIN users u ON u.id = p.user_id
    JOIN roles r ON r.id = u.role_id
    WHERE r.name = 'professor'
    ORDER BY u.name
`;

// List all subjects
router.get('/', requireAuth, (req, res) => {
    const { branch_id, semester, type } = req.query;
    let query = `
        SELECT s.*, b.name AS branch_name, b.code AS branch_code,
               u.name AS creator_name,
               prof.name AS professor_name
        FROM subjects s
        JOIN branches b ON b.id = s.branch_id
        LEFT JOIN users u ON u.id = s.created_by
        LEFT JOIN users prof ON prof.id = s.professor_id
        WHERE 1=1
    `;
    const params = [];
    if (req.session.user.role === 'professor') {
        query += ' AND s.professor_id = ?';
        params.push(req.session.user.id);
    } else if (req.session.user.role === 'student') {
        query += ' AND s.branch_id = ?';
        const student = db.prepare(`
            SELECT branch_id
            FROM students
            WHERE user_id = ?
        `).get(req.session.user.id);

        if (!student) {
            req.flash('error', 'Student profile not found.');
            return res.redirect('/student/dashboard');
        }

        params.push(student.branch_id);
    }
    if (branch_id) { query += ' AND s.branch_id = ?'; params.push(branch_id); }
    if (semester)  { query += ' AND s.semester = ?';  params.push(semester); }
    if (type)      { query += ' AND s.type = ?';      params.push(type); }
    query += ' ORDER BY b.name, s.semester, s.type, s.name';

    const subjects = db.prepare(query).all(...params);
    const branches = db.prepare('SELECT * FROM branches ORDER BY name').all();
    res.render('subjects/index', { title: 'Subjects', subjects, branches, filters: req.query });
});

// Create subject form
router.get('/new', adminOnly, (req, res) => {
    const branches = db.prepare('SELECT * FROM branches ORDER BY name').all();
    const professors = db.prepare(professorOptionsQuery).all();

    res.render('subjects/form', {
        title: 'Add Subject',
        branches,
        professors,
        subject: null
    });
});

// Create subject
router.post('/', adminOnly, (req, res) => {
    const { name, code, type, max_marks, semester, branch_id, professor_id } = req.body;
    const assignedProfessorId = Number(professor_id);

    if (!assignedProfessorId) {
        req.flash('error', 'Please select a professor for this subject.');
        return res.redirect('/subjects/new');
    }

    try {
        db.prepare(`
            INSERT INTO subjects (name, code, type, branch_id, semester, max_marks, professor_id, created_by)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            name.trim(),
            code.trim().toUpperCase(),
            type,
            Number(branch_id),
            Number(semester),
            Number(max_marks),
            assignedProfessorId,
            req.session.user.id
        );
        req.flash('success', 'Subject created successfully.');
    } catch (error) {
        console.error('Subject create error:', error);
        req.flash('error', 'Failed to create subject. Please check the subject code and professor.');
    }
    res.redirect('/subjects');
});

// Edit form
router.get('/:id/edit', adminOnly, (req, res) => {
    const subject = db.prepare('SELECT * FROM subjects WHERE id = ?').get(req.params.id);
    const branches = db.prepare('SELECT * FROM branches ORDER BY name').all();
    const professors = db.prepare(professorOptionsQuery).all();

    res.render('subjects/form', {
        title: 'Edit Subject',
        subject,
        branches,
        professors
    });
});

// Update subject
router.post('/:id/update', adminOnly, (req, res) => {
    const { name, code, type, max_marks, semester, branch_id, professor_id } = req.body;
    const assignedProfessorId = Number(professor_id);

    if (!assignedProfessorId) {
        req.flash('error', 'Please select a professor for this subject.');
        return res.redirect(`/subjects/${req.params.id}/edit`);
    }

    try {
        db.prepare(`
            UPDATE subjects
            SET name = ?, code = ?, type = ?, max_marks = ?, semester = ?, branch_id = ?, professor_id = ?
            WHERE id = ?
        `).run(
            name.trim(),
            code.trim().toUpperCase(),
            type,
            Number(max_marks),
            Number(semester),
            Number(branch_id),
            assignedProfessorId,
            req.params.id
        );
        req.flash('success', 'Subject updated.');
    } catch (error) {
        console.error('Subject update error:', error);
        req.flash('error', 'Failed to update subject. Please check the subject code and professor.');
    }
    res.redirect('/subjects');
});

// Delete
router.post('/:id/delete', adminOnly, (req, res) => {
    db.prepare('DELETE FROM subjects WHERE id = ?').run(req.params.id);
    req.flash('success', 'Subject deleted.');
    res.redirect('/subjects');
});

module.exports = router;
