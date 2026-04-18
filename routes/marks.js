const express = require('express');
const router = express.Router();
const db = require('../database/db');
const ExcelJS = require('exceljs');
const { parse } = require('csv-parse/sync');
const PDFDocument = require('pdfkit');
const bcrypt = require('bcryptjs');
const { requireAuth, requireRole } = require('../middleware/auth');

const canManageMarks = [requireAuth, requireRole('admin', 'professor')];

function getField(obj, keys) {
    for (const key of keys) {
        if (obj[key] !== undefined && obj[key] !== null && obj[key] !== '') {
            return obj[key];
        }
    }
    return null;
}

function normalizeText(value) {
    return String(value || '').trim();
}

function parseMarks(value) {
    if (value === null || value === undefined || value === '') {
        return 0;
    }

    const text = normalizeText(value).toUpperCase();
    if (text === 'ABS') {
        return 0;
    }

    const marks = Number(text);
    return Number.isNaN(marks) ? 0 : marks;
}

function getCellValue(cellValue) {
    if (cellValue && typeof cellValue === 'object') {
        if (cellValue.result !== undefined && cellValue.result !== null) {
            return cellValue.result;
        }
        if (cellValue.text !== undefined && cellValue.text !== null) {
            return cellValue.text;
        }
        if (cellValue.richText) {
            return cellValue.richText.map(part => part.text).join('');
        }
    }

    return cellValue;
}

function extractSubjectLabel(sheet) {
    for (let rowNo = 1; rowNo <= Math.min(sheet.rowCount, 8); rowNo += 1) {
        for (let colNo = 1; colNo <= Math.min(sheet.getRow(rowNo).cellCount || 10, 10); colNo += 1) {
            const text = normalizeText(getCellValue(sheet.getRow(rowNo).getCell(colNo).value));
            if (/^(subject|sub)\s*:/i.test(text)) {
                return text
                    .replace(/^(subject|sub)\s*:\s*/i, '')
                    .replace(/,.*$/, '')
                    .trim();
            }
        }
    }

    return '';
}

function extractMarksColumnInfo(sheet) {
    for (let rowNo = 1; rowNo <= Math.min(sheet.rowCount, 12); rowNo += 1) {
        const row = sheet.getRow(rowNo);
        for (let colNo = 1; colNo <= row.cellCount; colNo += 1) {
            const text = normalizeText(getCellValue(row.getCell(colNo).value));
            const match = text.match(/marks?\s*\(([\d.]+)\)|mark\s*\(([\d.]+)\)/i);
            if (match) {
                return {
                    marksCol: colNo,
                    maxMarks: Number(match[1] || match[2] || 0),
                    headerText: text
                };
            }

            if (/^(quiz|assignment|attendance|end\s*sem)\s+marks?$/i.test(text)) {
                return {
                    marksCol: colNo,
                    maxMarks: 0,
                    headerText: text
                };
            }
        }
    }

    return { marksCol: 5, maxMarks: 0, headerText: '' };
}

function inferMaxMarksFromSheet(sheet, marksCol, headerText) {
    if (/quiz\s+marks?/i.test(headerText) || /assignment\s+marks?/i.test(headerText) || /attendance\s+marks?/i.test(headerText)) {
        return 5;
    }

    if (/end\s*sem\s+marks?/i.test(headerText)) {
        return 70;
    }

    for (let rowNo = 1; rowNo <= Math.min(sheet.rowCount, 12); rowNo += 1) {
        const value = getCellValue(sheet.getRow(rowNo).getCell(marksCol).value);
        const text = normalizeText(value);
        const match = text.match(/^mark(?:s)?\s*\(([\d.]+)\)$/i);
        if (match) {
            return Number(match[1] || 0);
        }
    }

    return 0;
}

function getImportSubjects() {
    return db.prepare(`
        SELECT s.*, b.code AS branch_code
        FROM subjects s
        LEFT JOIN branches b ON b.id = s.branch_id
        ORDER BY s.code
    `).all();
}

function getSubjectForBulk(subjectId) {
    return db.prepare(`
        SELECT s.*, b.name AS branch_name, b.code AS branch_code
        FROM subjects s
        JOIN branches b ON b.id = s.branch_id
        WHERE s.id = ?
    `).get(subjectId);
}

function getStudentsForSubject(subject) {
    return db.prepare(`
        SELECT
            st.id AS student_id,
            st.roll_no,
            st.semester,
            u.name,
            m.marks
        FROM students st
        JOIN users u ON u.id = st.user_id
        LEFT JOIN marks m
            ON m.student_id = st.id
           AND m.subject_id = ?
        WHERE st.branch_id = ?
        ORDER BY st.roll_no
    `).all(subject.id, subject.branch_id);
}

const upsertMark = db.prepare(`
    INSERT INTO marks (student_id, subject_id, marks, updated_by, updated_at)
    VALUES (?, ?, ?, ?, strftime('%s','now'))
    ON CONFLICT(student_id, subject_id) DO UPDATE SET
        marks = excluded.marks,
        updated_by = excluded.updated_by,
        updated_at = strftime('%s','now')
`);

const createStudentFromImport = db.transaction(({ name, rollNo, subject, updatedBy }) => {
    const role = db.prepare(`
        SELECT id
        FROM roles
        WHERE name = 'student'
    `).get();

    const email = `${rollNo}@student.com`;

    let user = db.prepare(`
        SELECT *
        FROM users
        WHERE email = ?
    `).get(email);

    let userId = user ? user.id : null;

    if (!user) {
        const passwordHash = bcrypt.hashSync(String(rollNo), 10);
        const createdUser = db.prepare(`
            INSERT INTO users (name, email, password_hash, role_id, is_verified)
            VALUES (?, ?, ?, ?, 1)
        `).run(name, email, passwordHash, role.id);

        userId = createdUser.lastInsertRowid;
    }

    const createdStudent = db.prepare(`
        INSERT INTO students (user_id, roll_no, branch_id, semester)
        VALUES (?, ?, ?, ?)
    `).run(userId, rollNo, subject.branch_id, subject.semester);

    upsertMark.run(createdStudent.lastInsertRowid, subject.id, 0, updatedBy);

    return db.prepare(`
        SELECT *
        FROM students
        WHERE id = ?
    `).get(createdStudent.lastInsertRowid);
});

router.get('/import', ...canManageMarks, (req, res) => {
    res.render('marks/import', {
        title: 'Import Marks',
        subjects: getImportSubjects(),
        importErrors: [],
        importSuccess: []
    });
});

router.post('/import', ...canManageMarks, async (req, res) => {
    try {
        if (!req.files || !req.files.file) {
            req.flash('error', 'No file uploaded');
            return res.redirect('/marks/import');
        }

        const file = req.files.file;
        const fileName = file.name.toLowerCase();
        let records = [];
        let excelSubjectMaxMap = new Map();

        if (fileName.endsWith('.csv')) {
            const content = file.data.toString('utf8');
            records = parse(content, {
                columns: true,
                skip_empty_lines: true,
                trim: true
            });
        } else if (fileName.endsWith('.xlsx') || fileName.endsWith('.xls')) {
            const workbook = new ExcelJS.Workbook();
            await workbook.xlsx.load(file.data);

            if (!workbook.worksheets.length) {
                req.flash('error', 'Excel sheet not found');
                return res.redirect('/marks/import');
            }

            const aggregatedRecords = new Map();

            workbook.worksheets.forEach(sheet => {
                const detectedSubject = extractSubjectLabel(sheet);
                const { marksCol, maxMarks, headerText } = extractMarksColumnInfo(sheet);
                const inferredMaxMarks = maxMarks || inferMaxMarksFromSheet(sheet, marksCol, headerText);
                const sheetSubjectCodes = new Set();

                sheet.eachRow(row => {
                    const rawRollNo = getCellValue(row.getCell(3).value);
                    const rollNo = normalizeText(rawRollNo);
                    if (!rollNo || /regd?\s*\.?\s*no|regno/i.test(rollNo)) {
                        return;
                    }

                    const rawName = getCellValue(row.getCell(2).value);
                    const name = normalizeText(rawName);
                    if (!name) {
                        return;
                    }

                    const subjectCode = normalizeText(getCellValue(row.getCell(4).value)) || detectedSubject;
                    if (!subjectCode) {
                        return;
                    }
                    sheetSubjectCodes.add(subjectCode);

                    let rawMarks = getCellValue(row.getCell(marksCol).value);
                    let parsedMarks = parseMarks(rawMarks);

                    if ((rawMarks === null || rawMarks === undefined || Number.isNaN(Number(rawMarks)) || normalizeText(rawMarks) === '' || parsedMarks === 0) && row.cellCount > marksCol) {
                        for (let col = row.cellCount; col > marksCol; col -= 1) {
                            const fallbackValue = getCellValue(row.getCell(col).value);
                            const fallbackMarks = Number(normalizeText(fallbackValue));
                            if (!Number.isNaN(fallbackMarks)) {
                                rawMarks = fallbackValue;
                                parsedMarks = fallbackMarks;
                                break;
                            }
                        }
                    }

                    const recordKey = `${subjectCode}__${rollNo}`;

                    if (!aggregatedRecords.has(recordKey)) {
                        aggregatedRecords.set(recordKey, {
                            name,
                            roll_no: rollNo,
                            subject: subjectCode,
                            marks: 0
                        });
                    }

                    const record = aggregatedRecords.get(recordKey);
                    record.name = name;
                    record.marks += parsedMarks;
                });

                if (inferredMaxMarks > 0) {
                    sheetSubjectCodes.forEach(subjectCode => {
                        excelSubjectMaxMap.set(
                            subjectCode,
                            (excelSubjectMaxMap.get(subjectCode) || 0) + inferredMaxMarks
                        );
                    });

                    if (detectedSubject) {
                        excelSubjectMaxMap.set(
                            detectedSubject,
                            (excelSubjectMaxMap.get(detectedSubject) || 0) + inferredMaxMarks
                        );
                    }
                }
            });

            records = Array.from(aggregatedRecords.values()).map(record => ({
                ...record,
                marks: String(record.marks)
            }));

        } else {
            req.flash('error', 'Only CSV / Excel files allowed');
            return res.redirect('/marks/import');
        }

        const importErrors = [];
        const importSuccess = [];
        const updatedBy = req.session.user.id;

        records.forEach((row, index) => {
            try {
                const name = getField(row, ['name', 'student name']) || 'Unknown Student';
                const rollNo = normalizeText(getField(row, ['roll_no', 'rollnumber', 'regno', 'registration no']));
                const subjectInput = normalizeText(getField(row, ['subject', 'subject_code', 'subject code', 'code']));
                const rawMarks = getField(row, ['marks', 'score', 'obtained_marks', 'total']);

                if (!rollNo || !subjectInput) {
                    importErrors.push(`Row ${index + 1}: Missing roll number or subject`);
                    return;
                }

                const subject = db.prepare(`
                    SELECT *
                    FROM subjects
                    WHERE LOWER(TRIM(code)) = LOWER(TRIM(?))
                       OR LOWER(name) LIKE LOWER(?)
                `).get(subjectInput, `%${subjectInput}%`);

                if (!subject) {
                    importErrors.push(`Row ${index + 1}: Subject not found (${subjectInput})`);
                    return;
                }

                const detectedMaxMarks =
                    excelSubjectMaxMap.get(subject.code) ||
                    excelSubjectMaxMap.get(subjectInput) ||
                    excelSubjectMaxMap.get(subject.name);
                if (detectedMaxMarks && subject.max_marks !== detectedMaxMarks) {
                    db.prepare(`
                        UPDATE subjects
                        SET max_marks = ?
                        WHERE id = ?
                    `).run(detectedMaxMarks, subject.id);
                    subject.max_marks = detectedMaxMarks;
                }

                const marks = parseMarks(rawMarks);
                if (marks < 0 || marks > subject.max_marks) {
                    importErrors.push(`Row ${index + 1}: Marks must be between 0 and ${subject.max_marks}`);
                    return;
                }

                let student = db.prepare(`
                    SELECT *
                    FROM students
                    WHERE roll_no = ?
                `).get(rollNo);

                if (!student) {
                    student = createStudentFromImport({
                        name,
                        rollNo,
                        subject,
                        updatedBy
                    });
                }

                db.prepare(`
                    UPDATE users
                    SET name = ?, updated_at = strftime('%s','now')
                    WHERE id = ?
                `).run(name, student.user_id);

                upsertMark.run(student.id, subject.id, marks, updatedBy);
                importSuccess.push(`${rollNo} - ${marks}`);
            } catch (err) {
                importErrors.push(`Row ${index + 1}: ${err.message}`);
            }
        });

        res.render('marks/import', {
            title: 'Import Marks',
            subjects: getImportSubjects(),
            importErrors,
            importSuccess
        });
    } catch (err) {
        console.log(err);
        req.flash('error', 'Import failed');
        res.redirect('/marks/import');
    }
});

router.get('/bulk/:subjectId', ...canManageMarks, (req, res) => {
    const subject = getSubjectForBulk(req.params.subjectId);

    if (req.session.user.role === 'professor' && subject.professor_id !== req.session.user.id) {
        req.flash('error', 'Access denied');
        return res.redirect('/professor/dashboard');
    }
    if (!subject) {
        req.flash('error', 'Subject not found.');
        return res.redirect('/subjects');
    }

    const students = getStudentsForSubject(subject);

    res.render('marks/bulk', {
        title: `Bulk Marks - ${subject.name}`,
        subject,
        students
    });
});

router.post('/bulk/:subjectId', ...canManageMarks, (req, res) => {
    try {
        const subject = getSubjectForBulk(req.params.subjectId);

        if (!subject) {
            req.flash('error', 'Subject not found.');
            return res.redirect('/subjects');
        }

        let marksData = [];
        try {
            marksData = JSON.parse(req.body.marks_data || '[]');
        } catch {
            req.flash('error', 'Invalid marks payload.');
            return res.redirect(`/marks/bulk/${req.params.subjectId}`);
        }

        if (!Array.isArray(marksData) || marksData.length === 0) {
            req.flash('error', 'No marks to save.');
            return res.redirect(`/marks/bulk/${req.params.subjectId}`);
        }

        const validStudents = new Set(
            getStudentsForSubject(subject).map(student => String(student.student_id))
        );

        const saveMarks = db.transaction(items => {
            items.forEach(item => {
                const studentId = String(item.student_id || '').trim();
                const marks = Number(item.marks);

                if (!validStudents.has(studentId)) {
                    throw new Error(`Invalid student selected: ${studentId}`);
                }

                if (Number.isNaN(marks) || marks < 0 || marks > subject.max_marks) {
                    throw new Error(`Marks must be between 0 and ${subject.max_marks}`);
                }

                upsertMark.run(studentId, subject.id, marks, req.session.user.id);
            });
        });

        saveMarks(marksData);
        req.flash('success', 'Marks saved successfully.');
        res.redirect(`/marks/bulk/${req.params.subjectId}`);
    } catch (err) {
        req.flash('error', err.message || 'Failed to save marks.');
        res.redirect(`/marks/bulk/${req.params.subjectId}`);
    }
});

router.get('/export/csv/:subjectId', ...canManageMarks, (req, res) => {
    const rows = db.prepare(`
        SELECT u.name, s.roll_no, sub.code, m.marks
        FROM marks m
        JOIN students s ON s.id = m.student_id
        JOIN users u ON u.id = s.user_id
        JOIN subjects sub ON sub.id = m.subject_id
        WHERE sub.id = ?
        ORDER BY s.roll_no
    `).all(req.params.subjectId);

    let csv = 'name,roll_no,subject,marks\n';
    rows.forEach(row => {
        csv += `${row.name},${row.roll_no},${row.code},${row.marks}\n`;
    });

    res.setHeader('Content-Disposition', 'attachment; filename=marks.csv');
    res.type('text/csv');
    res.send(csv);
});

router.get('/export/excel/:subjectId', ...canManageMarks, async (req, res) => {
    const rows = db.prepare(`
        SELECT u.name, s.roll_no, sub.code, m.marks
        FROM marks m
        JOIN students s ON s.id = m.student_id
        JOIN users u ON u.id = s.user_id
        JOIN subjects sub ON sub.id = m.subject_id
        WHERE sub.id = ?
        ORDER BY s.roll_no
    `).all(req.params.subjectId);

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Marks');

    sheet.columns = [
        { header: 'Name', key: 'name', width: 30 },
        { header: 'Roll No', key: 'roll_no', width: 20 },
        { header: 'Subject', key: 'code', width: 20 },
        { header: 'Marks', key: 'marks', width: 10 }
    ];

    rows.forEach(row => sheet.addRow(row));

    res.setHeader('Content-Disposition', 'attachment; filename=marks.xlsx');
    await workbook.xlsx.write(res);
    res.end();
});

router.get('/export/pdf/:subjectId', ...canManageMarks, (req, res) => {
    const rows = db.prepare(`
        SELECT u.name, s.roll_no, sub.code, m.marks
        FROM marks m
        JOIN students s ON s.id = m.student_id
        JOIN users u ON u.id = s.user_id
        JOIN subjects sub ON sub.id = m.subject_id
        WHERE sub.id = ?
        ORDER BY s.roll_no
    `).all(req.params.subjectId);

    const doc = new PDFDocument();

    res.setHeader('Content-Disposition', 'attachment; filename=marks.pdf');
    res.setHeader('Content-Type', 'application/pdf');

    doc.pipe(res);
    doc.fontSize(18).text('Marks Report');
    doc.moveDown();

    rows.forEach(row => {
        doc.text(`${row.name} | ${row.roll_no} | ${row.code} | ${row.marks}`);
    });

    doc.end();
});

router.get('/:subjectId', ...canManageMarks, (req, res) => {
    res.redirect(`/marks/bulk/${req.params.subjectId}`);
});

module.exports = router;
