// routes/student.js
// Student dashboard - view own marks and performance

const express = require('express');
const PDFDocument = require('pdfkit');
const router  = express.Router();
const db      = require('../database/db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { computeGrade } = require('../utils/grades');

function getStudentProfile(userId) {
    return db.prepare(`
        SELECT st.*, u.name, u.email, u.profile_photo, u.phone,
               b.name AS branch_name, b.code AS branch_code
        FROM students st
        JOIN users u ON u.id = st.user_id
        JOIN branches b ON b.id = st.branch_id
        WHERE st.user_id = ?
    `).get(userId);
}

function getStudentSubjects(studentId, branchId) {
    return db.prepare(`
        SELECT sub.*, prof.name AS professor_name, m.marks,
               CASE WHEN m.marks IS NOT NULL
                    THEN ROUND(m.marks * 100.0 / sub.max_marks, 1)
                    ELSE NULL
               END AS percentage
        FROM subjects sub
        LEFT JOIN marks m ON m.subject_id = sub.id AND m.student_id = ?
        LEFT JOIN users prof ON prof.id = sub.professor_id
        WHERE sub.branch_id = ?
        ORDER BY sub.semester, sub.type, sub.name
    `).all(studentId, branchId);
}

function buildStudentAnalytics(subjects) {
    const attempted = subjects.filter((subject) => subject.marks !== null);
    const totalMarks = attempted.reduce((sum, subject) => sum + subject.marks, 0);
    const totalMax = attempted.reduce((sum, subject) => sum + subject.max_marks, 0);
    const overallPctValue = totalMax > 0 ? Number(((totalMarks / totalMax) * 100).toFixed(1)) : null;
    const overallPct = overallPctValue !== null ? overallPctValue.toFixed(1) : null;
    const overallGrade = overallPct !== null ? computeGrade(overallPct) : '-';

    subjects.forEach((subject) => {
        subject.grade = subject.percentage !== null ? computeGrade(subject.percentage) : '-';
    });

    const semesterSummary = Array.from(
        subjects.reduce((map, subject) => {
            if (!map.has(subject.semester)) {
                map.set(subject.semester, {
                    semester: subject.semester,
                    attemptedSubjects: 0,
                    totalMarks: 0,
                    totalMax: 0,
                    averagePercentage: 0
                });
            }

            const bucket = map.get(subject.semester);
            if (subject.marks !== null) {
                bucket.attemptedSubjects += 1;
                bucket.totalMarks += subject.marks;
                bucket.totalMax += subject.max_marks;
            }

            bucket.averagePercentage = bucket.totalMax > 0
                ? Number(((bucket.totalMarks / bucket.totalMax) * 100).toFixed(1))
                : 0;

            return map;
        }, new Map()).values()
    );

    const gradeOrder = ['A+', 'A', 'B+', 'B', 'C', 'F'];
    const gradeDistributionMap = attempted.reduce((acc, subject) => {
        acc[subject.grade] = (acc[subject.grade] || 0) + 1;
        return acc;
    }, {});
    const gradeDistribution = gradeOrder
        .map((grade) => ({ grade, count: gradeDistributionMap[grade] || 0 }))
        .filter((entry) => entry.count > 0);

    const reportSubjects = attempted.map((subject) => ({
        name: subject.name,
        code: subject.code,
        semester: subject.semester,
        percentage: subject.percentage,
        marks: subject.marks,
        max_marks: subject.max_marks,
        grade: subject.grade
    }));

    return {
        attempted,
        totalMarks,
        totalMax,
        overallPct,
        overallGrade,
        semesterSummary,
        gradeDistribution,
        reportSubjects
    };
}

router.get('/dashboard', [requireAuth, requireRole('student')], (req, res) => {

    const sessionUser = req.session?.user;
    if (!sessionUser) return res.redirect('/login');

    const student = getStudentProfile(sessionUser.id);
    if (!student) {
        req.flash('error', 'Student profile not found.');
        return res.redirect('/logout');
    }

    const subjects = getStudentSubjects(student.id, student.branch_id);
    const analytics = buildStudentAnalytics(subjects);

    const notifications = db.prepare(`
        SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 5
    `).all(sessionUser.id);

    res.render('student/dashboard', {
        title: 'My Performance',
        student,
        subjects,
        theory: subjects.filter((subject) => subject.type === 'THEORY'),
        lab: subjects.filter((subject) => subject.type === 'LAB'),
        totalMarks: analytics.totalMarks,
        totalMax: analytics.totalMax,
        overallPct: analytics.overallPct,
        overallGrade: analytics.overallGrade,
        attemptedCount: analytics.attempted.length,
        semesterSummary: analytics.semesterSummary,
        gradeDistribution: analytics.gradeDistribution,
        reportSubjects: analytics.reportSubjects,
        notifications
    });
});

router.get('/report', [requireAuth, requireRole('student')], (req, res) => {

    const sessionUser = req.session?.user;
    if (!sessionUser) return res.redirect('/login');

    const student = getStudentProfile(sessionUser.id);

    if (!student) {
        req.flash('error', 'Student profile not found.');
        return res.redirect('/student/dashboard');
    }

    const subjects = getStudentSubjects(student.id, student.branch_id);
    const analytics = buildStudentAnalytics(subjects);

    res.setHeader(
        'Content-Disposition',
        `attachment; filename=${student.roll_no}-report.pdf`
    );
    res.setHeader('Content-Type', 'application/pdf');

    const doc = new PDFDocument({ margin: 40 });
    doc.pipe(res);

    doc.fontSize(18).text('EduTrack Student Report');
    doc.moveDown(0.5);
    doc.fontSize(11).text(`Name: ${student.name}`);
    doc.text(`Roll No: ${student.roll_no}`);
    doc.text(`Branch: ${student.branch_name} (${student.branch_code})`);
    doc.text(`Current Semester: ${student.semester}`);
    doc.moveDown();

    doc.fontSize(12).text(`Total Marks: ${analytics.totalMarks} / ${analytics.totalMax}`);
    doc.text(`Overall Percentage: ${analytics.overallPct !== null ? analytics.overallPct + '%' : '-'}`);
    doc.text(`Overall Grade: ${analytics.overallGrade}`);
    doc.moveDown();

    doc.fontSize(13).text('Subject Performance');
    doc.moveDown(0.5);

    if (!subjects.length) {
        doc.fontSize(11).text('No subjects found for this student.');
    } else {
        subjects.forEach((subject) => {
            const marksText = subject.marks !== null ? `${subject.marks} / ${subject.max_marks}` : `Not entered / ${subject.max_marks}`;
            const percentageText = subject.percentage !== null ? `${subject.percentage}%` : '-';
            const gradeText = subject.percentage !== null ? computeGrade(subject.percentage) : '-';
            doc.fontSize(11).text(
                `Sem ${subject.semester} | ${subject.name} (${subject.code}) | ${subject.type} | ${marksText} | ${percentageText} | Grade ${gradeText}`
            );
        });
    }

    doc.end();
});

module.exports = router;
