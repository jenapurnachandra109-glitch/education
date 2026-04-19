// app.js – EduTrack Express Application Entry Point

require('./database/init');

require('dotenv').config();
const express     = require('express');
const session     = require('express-session');
const flash       = require('connect-flash');
const fileUpload  = require('express-fileupload');
const path        = require('path');
const db = require('./database/db');

const app = express();

// ── View Engine ─────────────────────────────────────────────
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// ── Static Assets ────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

// ── Body Parsing ─────────────────────────────────────────────
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// ── File Upload ──────────────────────────────────────────────
app.use(fileUpload({
    limits: { fileSize: 5 * 1024 * 1024 },  // 5 MB
    abortOnLimit: true,
}));

// ── Session ──────────────────────────────────────────────────
app.use(session({
    secret: process.env.SESSION_SECRET || 'fallback-secret',
    resave: false,
    saveUninitialized: false,
    cookie: {
        maxAge: 1000 * 60 * 60 * 8, // 8 hours
        httpOnly: true,
        secure: false, // 👉 keep false for now (true only on HTTPS)
        sameSite: 'lax'
    }
}));

// ── Flash Messages ────────────────────────────────────────────
app.use(flash());


// — Global Template Variables —
app.use((req, res, next) => {
    res.locals.user    = req.session.user || null;
    res.locals.success = req.flash('success');
    res.locals.error   = req.flash('error');
    res.locals.info    = req.flash('info');
    next();
});

// ✅ ADD HERE (BETWEEN LINE 46–47)



// — Routes —
app.use('/', require('./routes/auth'));
app.use('/admin', require('./routes/admin'));



// ── Routes ───────────────────────────────────────────────────
app.use('/',            require('./routes/auth'));
app.use('/admin',       require('./routes/admin'));
app.use('/professor',   require('./routes/professor'));
app.use('/student',     require('./routes/student'));
app.use('/profile',     require('./routes/profile'));
app.use('/subjects',    require('./routes/subjects'));
app.use('/marks',       require('./routes/marks'));
app.use('/notifications', require('./routes/notifications'));

// ── 404 Handler ───────────────────────────────────────────────
app.use((req, res) => {
    res.status(404).render('error', { code: 404, message: 'Page not found' });
});

// ── Error Handler ─────────────────────────────────────────────
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).render('error', { code: 500, message: 'Internal Server Error' });
});

// ── Start Server ─────────────────────────────────────────────
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});