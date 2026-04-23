const express = require('express');
const router = express.Router();
const db = require('../database/db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { computeGrade } = require('../utils/grades');

const canViewCopo = [requireAuth, requireRole('admin', 'professor')];

function getAccessFilter(user) {
    if (user.role === 'professor') {
        return {
            clause: ' AND sub.professor_id = ?',
            params: [user.id]
        };
    }

    return {
        clause: '',
        params: []
    };
}

function getStudentSearchFilter(user, searchValue) {
    const baseParams = [
        `%${searchValue}%`,
        `%${searchValue}%`,
        String(searchValue)
    ];

    if (user.role === 'professor') {
        return {
            clause: `
                AND EXISTS (
                    SELECT 1
                    FROM marks m
                    JOIN subjects sub ON sub.id = m.subject_id
                    WHERE m.student_id = st.id
                      AND sub.professor_id = ?
                )
            `,
            params: [...baseParams, user.id]
        };
    }

    return {
        clause: '',
        params: baseParams
    };
}

function getStudentBySearch(user, rawSearchValue) {
    const searchValue = String(rawSearchValue || '').trim();

    if (!searchValue) {
        return null;
    }

    const filter = getStudentSearchFilter(user, searchValue);

    return db.prepare(`
        SELECT
            st.id AS student_id,
            st.roll_no,
            st.semester,
            st.branch_id,
            u.id AS user_id,
            u.name,
            u.email,
            b.name AS branch_name,
            b.code AS branch_code
        FROM students st
        JOIN users u ON u.id = st.user_id
        JOIN branches b ON b.id = st.branch_id
        WHERE (
            st.roll_no LIKE ?
            OR u.name LIKE ?
            OR CAST(st.id AS TEXT) = ?
        )
        ${filter.clause}
        ORDER BY
            CASE
                WHEN st.roll_no = ? THEN 0
                WHEN CAST(st.id AS TEXT) = ? THEN 1
                WHEN LOWER(u.name) = LOWER(?) THEN 2
                ELSE 3
            END,
            u.name ASC
        LIMIT 1
    `).get(
        ...filter.params,
        searchValue,
        searchValue,
        searchValue
    );
}

function getSubjectRowsForStudent(studentId, user) {
    const accessFilter = getAccessFilter(user);

    return db.prepare(`
        SELECT
            m.student_id,
            m.subject_id,
            m.marks,
            sub.name AS subject_name,
            sub.code AS subject_code,
            sub.type AS subject_type,
            sub.max_marks,
            sub.semester,
            ROUND((m.marks * 100.0) / NULLIF(sub.max_marks, 0), 1) AS percentage
        FROM marks m
        JOIN subjects sub ON sub.id = m.subject_id
        WHERE m.student_id = ?
        ${accessFilter.clause}
        ORDER BY sub.semester, sub.name
    `).all(studentId, ...accessFilter.params);
}

function getAttainmentLevel(percentage) {
    if (percentage >= 70) return 3;
    if (percentage >= 65) return 2;
    if (percentage >= 60) return 1;
    return 0;
}

function getCoRowsForSubject(studentId, subjectRow) {
    const fallbackPercentage = Number(subjectRow.percentage || 0);
    const fallbackLevel = getAttainmentLevel(fallbackPercentage);

    return db.prepare(`
        SELECT
            co.id,
            co.name,
            ROUND(COALESCE(AVG(ca.percentage), ?), 1) AS percentage,
            ROUND(COALESCE(AVG(ca.level), ?), 1) AS level
        FROM co
        LEFT JOIN co_attainment ca
            ON ca.co_id = co.id
           AND ca.student_id = ?
           AND ca.subject_id = ?
        WHERE co.subject_id = ?
        GROUP BY co.id, co.name
        ORDER BY co.id
    `).all(
        fallbackPercentage,
        fallbackLevel,
        studentId,
        subjectRow.subject_id,
        subjectRow.subject_id
    );
}

function getPoMappingsForCo(coId) {
    return db.prepare(`
        SELECT po, weight
        FROM co_po
        WHERE co_id = ?
        ORDER BY po
    `).all(coId);
}

function summarizeChartEntries(entries) {
    const aggregateMap = new Map();

    entries.forEach((entry) => {
        const key = String(entry.label || '').trim();
        if (!key) return;

        const current = aggregateMap.get(key) || {
            label: key,
            total: 0,
            count: 0
        };

        current.total += Number(entry.value || 0);
        current.count += 1;
        aggregateMap.set(key, current);
    });

    return Array.from(aggregateMap.values())
        .map((item) => {
            const value = item.count ? Number((item.total / item.count).toFixed(1)) : 0;

            return {
                label: item.label,
                value,
                grade: computeGrade(value),
                result: `${value.toFixed(1)}%`
            };
        })
        .sort((a, b) => a.label.localeCompare(b.label));
}

function buildStudentCopoReport(student, user) {
    const subjectRows = getSubjectRowsForStudent(student.student_id, user);
    const poAggregate = new Map();
    const coSummary = [];

    const subjects = subjectRows.map((subjectRow) => {
        const coRows = getCoRowsForSubject(student.student_id, subjectRow);
        const coValues = coRows.map((coRow) => {
            const percentage = Number(coRow.percentage || 0);
            const mappings = getPoMappingsForCo(coRow.id).map((mapping) => ({
                po: mapping.po,
                weight: Number(mapping.weight || 0)
            }));

            mappings.forEach((mapping) => {
                const existing = poAggregate.get(mapping.po) || {
                    po: mapping.po,
                    weight: 0,
                    weightedTotal: 0
                };

                existing.weight += mapping.weight;
                existing.weightedTotal += percentage * mapping.weight;
                poAggregate.set(mapping.po, existing);
            });

            coSummary.push({
                label: `${subjectRow.subject_code} - ${coRow.name}`,
                value: percentage,
                grade: computeGrade(percentage),
                result: `${percentage.toFixed(1)}%`
            });

            return {
                id: coRow.id,
                name: coRow.name,
                percentage,
                level: Number(coRow.level || 0),
                grade: computeGrade(percentage),
                poMappings: mappings
            };
        });

        const attainmentPercentage = coValues.length
            ? Number((coValues.reduce((sum, co) => sum + co.percentage, 0) / coValues.length).toFixed(1))
            : Number(subjectRow.percentage || 0);

        const subjectPoMappingMap = new Map();
        coValues.forEach((coValue) => {
            coValue.poMappings.forEach((mapping) => {
                const existing = subjectPoMappingMap.get(mapping.po) || {
                    po: mapping.po,
                    weight: 0,
                    weightedTotal: 0
                };
                existing.weight += mapping.weight;
                existing.weightedTotal += coValue.percentage * mapping.weight;
                subjectPoMappingMap.set(mapping.po, existing);
            });
        });

        const poMapping = Array.from(subjectPoMappingMap.values()).map((item) => ({
            po: item.po,
            weight: item.weight,
            percentage: item.weight
                ? Number((item.weightedTotal / item.weight).toFixed(1))
                : 0,
            grade: computeGrade(item.weight ? item.weightedTotal / item.weight : 0)
        }));

        return {
            subjectId: subjectRow.subject_id,
            subject: subjectRow.subject_name,
            subjectCode: subjectRow.subject_code,
            subjectType: subjectRow.subject_type,
            semester: subjectRow.semester,
            marks: Number(subjectRow.marks || 0),
            maxMarks: Number(subjectRow.max_marks || 0),
            percentage: Number(subjectRow.percentage || 0),
            attainmentPercentage,
            grade: computeGrade(attainmentPercentage),
            coValues,
            poMapping
        };
    });

    const poSummary = Array.from(poAggregate.values())
        .map((item) => {
            const percentage = item.weight
                ? Number((item.weightedTotal / item.weight).toFixed(1))
                : 0;

            return {
                label: item.po,
                value: percentage,
                grade: computeGrade(percentage),
                result: `${percentage.toFixed(1)}%`
            };
        })
        .sort((a, b) => a.label.localeCompare(b.label));

    return {
        student: {
            id: student.student_id,
            name: student.name,
            rollNo: student.roll_no,
            email: student.email,
            semester: student.semester,
            branch: student.branch_name,
            branchCode: student.branch_code
        },
        subjects,
        charts: {
            co: summarizeChartEntries(coSummary),
            po: summarizeChartEntries(poSummary)
        }
    };
}

router.get('/copo-reports', ...canViewCopo, (req, res) => {
    res.render('marks/copo_reports', {
        title: 'CO/PO Reports'
    });
});

router.get('/api/copo/:id', ...canViewCopo, (req, res) => {
    try {
        const searchValue = String(req.params.id || '').trim();

        if (!searchValue) {
            return res.status(400).json({
                error: 'Student search value is required.'
            });
        }

        const student = getStudentBySearch(req.session.user, searchValue);

        if (!student) {
            return res.status(404).json({
                error: 'Student not found or not accessible.'
            });
        }

        const report = buildStudentCopoReport(student, req.session.user);

        if (!report.subjects.length) {
            return res.status(404).json({
                error: 'No CO/PO data found for the selected student.'
            });
        }

        res.json(report);
    } catch (error) {
        console.error('CO/PO report API error:', error);
        res.status(500).json({
            error: 'Failed to load CO/PO report data.'
        });
    }
});

module.exports = router;
