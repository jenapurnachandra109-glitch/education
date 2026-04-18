# EduTrack – Student Performance Management System

A production-grade academic management platform built with **Node.js + Express + EJS + SQLite**.

---

## ✨ Features

| Feature | Details |
|---|---|
| **Authentication** | bcrypt-12 password hashing, session-based login, email verification |
| **Password Recovery** | Secure UUID tokens with 1-hour expiry, SMTP email delivery |
| **Role-Based Access** | Admin · Professor · Student — separate dashboards and middleware |
| **Subject Management** | THEORY and LAB subjects scoped to branch + semester |
| **Marks System** | Normalised per-subject storage, inline real-time editing (AJAX) |
| **Grade Computation** | Auto O/A/B/C/D/F based on percentage |
| **CSV Import** | Bulk marks upload with validation and auto-student creation |
| **PDF Export** | Per-student styled report via PDFKit |
| **Excel Export** | Per-subject cohort marks via ExcelJS |
| **Notifications** | In-app alerts on mark updates, live badge counter |
| **Profile Management** | Photo upload, editable details, password change |
| **Analytics** | Branch-wise performance, grade distribution, top students |
| **Responsive UI** | Clean CSS design system, mobile-friendly |

---

## 🚀 Quick Start

### Prerequisites
- Node.js ≥ 18
- npm ≥ 9

### Installation

```bash
# 1. Clone or extract the project
cd edutrack

# 2. Install dependencies
npm install

# 3. Configure environment (optional – sensible defaults exist)
cp .env.example .env
# Edit .env with your SMTP and session settings

# 4. Initialise database (creates SQLite DB, seeds admin + branches)
node database/init.js

# 5. Start the server
npm start
# → http://localhost:3000
```

### Default Credentials

| Role | Email | Password |
|---|---|---|
| Admin | `admin@edutrack.com` | `Admin@1234` |

---

## 📁 Project Structure

```
edutrack/
├── app.js                        ← Express application entry point
├── package.json
├── .env.example                  ← Environment variable template
│
├── database/
│   ├── schema.sql                ← SQLite schema (9 tables)
│   ├── init.js                   ← DB initialiser + seeder
│   └── db.js                     ← Shared WAL connection singleton
│
├── middleware/
│   └── auth.js                   ← requireAuth · requireRole · redirectIfAuth
│
├── routes/
│   ├── auth.js                   ← Login · Register · Verify · Reset password
│   ├── admin.js                  ← Dashboard · Users · Branches · Analytics
│   ├── professor.js              ← Dashboard · Subject student lists
│   ├── student.js                ← Personal performance dashboard
│   ├── subjects.js               ← Full CRUD for subjects
│   ├── marks.js                  ← Entry · CSV import · PDF/Excel export
│   ├── profile.js                ← Photo upload · Edit details · Change password
│   └── notifications.js          ← List · Mark-read · Unread badge API
│
├── utils/
│   ├── grades.js                 ← computeGrade(pct) → O/A/B/C/D/F
│   ├── mailer.js                 ← Nodemailer: verification + reset emails
│   └── notify.js                 ← notifyStudent(userId, message)
│
├── views/                        ← EJS server-side templates
│   ├── partials/
│   │   ├── header.ejs            ← Navbar, flash messages, <head>
│   │   └── footer.ejs            ← Scripts, notification badge polling
│   ├── auth/
│   │   ├── login.ejs
│   │   ├── register.ejs          ← Role-switcher (student/professor)
│   │   ├── forgot-password.ejs
│   │   └── reset-password.ejs
│   ├── admin/
│   │   ├── dashboard.ejs         ← Stats, recent users, grade chart
│   │   ├── users.ejs             ← Searchable user table with actions
│   │   ├── branches.ejs          ← Add/delete branches
│   │   └── analytics.ejs         ← Branch performance, top students
│   ├── professor/
│   │   ├── dashboard.ejs         ← Subject cards + recent mark updates
│   │   └── students.ejs          ← Inline marks editing (AJAX)
│   ├── student/
│   │   └── dashboard.ejs         ← THEORY + LAB tables, summary stats
│   ├── subjects/
│   │   ├── index.ejs             ← Filterable subject list
│   │   └── form.ejs              ← Create / edit subject
│   ├── marks/
│   │   ├── bulk.ejs              ← Batch marks entry form
│   │   └── import.ejs            ← CSV upload with results
│   ├── profile/
│   │   └── index.ejs             ← Photo, personal info, password
│   ├── notifications/
│   │   └── index.ejs
│   └── error.ejs                 ← 404/500 error page
│
└── public/
    ├── css/main.css              ← Complete design system (~700 lines)
    └── uploads/                  ← Profile photos (gitignored except default)
```

---

## 🗄️ Database Schema

```
users          → id, name, email, password_hash, role_id, is_verified, verify_token…
roles          → id, name  (admin | professor | student)
password_resets→ id, user_id, token, expires_at, used
branches       → id, name, code
students       → id, user_id, roll_no, branch_id, semester, dob, address
professors     → id, user_id, employee_id, department, designation
subjects       → id, name, code, type(THEORY|LAB), max_marks, semester, branch_id
marks          → id, student_id, subject_id, marks  [UNIQUE constraint]
notifications  → id, user_id, message, is_read
```

---

## 📊 Grading Scale

| Grade | Percentage |
|---|---|
| **O** – Outstanding | ≥ 90% |
| **A** – Excellent   | 80–89% |
| **B** – Very Good   | 70–79% |
| **C** – Good        | 60–69% |
| **D** – Satisfactory| 50–59% |
| **F** – Fail        | < 50% |

---

## 📥 CSV Import Format

```csv
name,roll_no,subject,marks
John Doe,CSE2024001,CS301,87
Jane Smith,CSE2024002,CS301,92
```

- `subject` must match an existing **Subject Code** in the system
- If a student with that `roll_no` doesn't exist and `name` is provided, an account is auto-created
- Marks are validated against the subject's `max_marks`
- All operations are wrapped in a transaction — partial failures are reported

---

## 🔐 Security

- Passwords hashed with **bcrypt** (cost factor 12)
- Email verification required before first login
- Password reset tokens expire after **1 hour** and are single-use
- Session cookies with 8-hour lifetime
- Role middleware enforced on every protected route
- User enumeration prevented on forgot-password endpoint

---

## ⚙️ Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | HTTP server port |
| `BASE_URL` | `http://localhost:3000` | Used in email links |
| `SESSION_SECRET` | (hardcoded dev key) | Change in production |
| `SMTP_HOST` | `smtp.ethereal.email` | SMTP server hostname |
| `SMTP_PORT` | `587` | SMTP port |
| `SMTP_SECURE` | `false` | Use TLS |
| `SMTP_USER` | — | SMTP username |
| `SMTP_PASS` | — | SMTP password |

> **Tip:** For development email testing, create a free [Ethereal](https://ethereal.email) account.

---

## 🛠️ npm Scripts

```bash
npm start      # Start production server
npm run dev    # Start with nodemon (auto-restart)
npm run init-db # Initialise/reset database
```

---

## 📄 Licence

MIT – Free to use and modify for academic and commercial purposes.
