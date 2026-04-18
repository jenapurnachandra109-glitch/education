-- ============================================================
-- EduTrack – Student Performance Management System
-- Database Schema (SQLite)
-- ============================================================

PRAGMA foreign_keys = ON;

-- ------------------------------------------------------------
-- Table: roles
-- Defines the three system roles: admin, professor, student
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS roles (
    id   INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE  -- 'admin' | 'professor' | 'student'
);

-- Seed roles
INSERT OR IGNORE INTO roles (name) VALUES ('admin'), ('professor'), ('student');

-- ------------------------------------------------------------
-- Table: users
-- Central identity table for all system actors
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
    id                INTEGER  PRIMARY KEY AUTOINCREMENT,
    name              TEXT     NOT NULL,
    email             TEXT     NOT NULL UNIQUE,
    password_hash     TEXT     NOT NULL,
    role_id           INTEGER  NOT NULL REFERENCES roles(id),
    is_verified       INTEGER  NOT NULL DEFAULT 0,       -- 0=false, 1=true
    verify_token      TEXT,
    verify_token_exp  INTEGER,                           -- Unix timestamp
    profile_photo     TEXT     DEFAULT 'default.png',
    phone             TEXT,
    created_at        INTEGER  NOT NULL DEFAULT (strftime('%s','now')),
    updated_at        INTEGER  NOT NULL DEFAULT (strftime('%s','now'))
);

-- ------------------------------------------------------------
-- Table: password_resets
-- Stores one-time tokens for password recovery
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS password_resets (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token      TEXT    NOT NULL UNIQUE,
    expires_at INTEGER NOT NULL,   -- Unix timestamp
    used       INTEGER NOT NULL DEFAULT 0
);

-- ------------------------------------------------------------
-- Table: branches
-- Academic branches / departments
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS branches (
    id   INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,   -- e.g. 'Computer Science', 'Electronics'
    code TEXT NOT NULL UNIQUE    -- e.g. 'CSE', 'ECE'
);

-- ------------------------------------------------------------
-- Table: students
-- Extends users for student-specific attributes
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS students (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id   INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    roll_no   TEXT    NOT NULL UNIQUE,
    branch_id INTEGER NOT NULL REFERENCES branches(id),
    semester  INTEGER NOT NULL CHECK (semester BETWEEN 1 AND 8),
    dob       TEXT,
    address   TEXT
);

-- ------------------------------------------------------------
-- Table: professors
-- Extends users for professor-specific attributes
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS professors (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    employee_id  TEXT    NOT NULL UNIQUE,
    department   TEXT,
    designation  TEXT    DEFAULT 'Assistant Professor'
);

-- ------------------------------------------------------------
-- Table: subjects
-- Academic subjects scoped to branch + semester
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS subjects (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL,
    code        TEXT    NOT NULL UNIQUE,
    type        TEXT    NOT NULL CHECK (type IN ('THEORY','LAB')),
    max_marks   INTEGER NOT NULL DEFAULT 100,
    semester    INTEGER NOT NULL CHECK (semester BETWEEN 1 AND 8),
    branch_id   INTEGER NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
    created_by  INTEGER REFERENCES users(id),   -- admin or professor who created it
    created_at  INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);

-- ------------------------------------------------------------
-- Table: marks
-- Normalised per-student per-subject marks record
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS marks (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
    marks      REAL    NOT NULL DEFAULT 0,
    updated_by INTEGER REFERENCES users(id),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    UNIQUE (student_id, subject_id)
);

-- ------------------------------------------------------------
-- Table: notifications
-- Simple in-app notification log
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notifications (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    message    TEXT    NOT NULL,
    is_read    INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);

-- ------------------------------------------------------------
-- Indexes for common query patterns
-- ------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_users_email        ON users(email);
CREATE INDEX IF NOT EXISTS idx_marks_student      ON marks(student_id);
CREATE INDEX IF NOT EXISTS idx_marks_subject      ON marks(subject_id);
CREATE INDEX IF NOT EXISTS idx_subjects_branch    ON subjects(branch_id, semester);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, is_read);
CREATE INDEX IF NOT EXISTS idx_pw_resets_token    ON password_resets(token);
