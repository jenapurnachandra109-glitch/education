// routes/profile.js
const express = require('express');
const bcrypt  = require('bcryptjs');
const path    = require('path');
const router  = express.Router();
const db      = require('../database/db');
const { requireAuth } = require('../middleware/auth');
router.get('/', requireAuth, (req, res) => {

  const sessionUser = req.session?.user;

  if (!sessionUser) {
    return res.redirect('/login');
  }

  const user = db.prepare(`
    SELECT u.*, r.name AS role 
    FROM users u 
    JOIN roles r ON r.id = u.role_id 
    WHERE u.id = ?
  `).get(sessionUser.id);

  let extra = null;

  if (user.role === 'student') {
    extra = db.prepare(`
      SELECT st.*, b.name AS branch_name, b.code
      FROM students st
      JOIN branches b ON b.id = st.branch_id
      WHERE st.user_id = ?
    `).get(user.id);

  } else if (user.role === 'professor') {
    extra = db.prepare(`
      SELECT * FROM professors WHERE user_id = ?
    `).get(user.id);
  }

  res.render('profile/index', {
    title: 'My Profile',
    user,
    extra
  });
});
router.post('/update', requireAuth, (req, res) => {

    const sessionUser = req.session?.user;   // ✅ ADD THIS

    if (!sessionUser) {                      // ✅ ADD THIS
        return res.redirect('/login');
    }

    const { name, phone } = req.body;

    db.prepare(`
        UPDATE users 
        SET name=?, phone=?, updated_at=strftime('%s','now') 
        WHERE id=?
    `).run(name, phone, sessionUser.id);     // ✅ CHANGE THIS

    if (req.session?.user) {
        req.session.user.name = name;
    }
    req.flash('success', 'Profile updated.');
    res.redirect('/profile');
});

router.post('/photo', requireAuth, (req, res) => {
    if (!req.files || !req.files.photo) {
        req.flash('error', 'No file uploaded.');
        return res.redirect('/profile');
    }
    const file = req.files.photo;
    const ext  = path.extname(file.name).toLowerCase();
    if (!['.jpg','.jpeg','.png','.webp'].includes(ext)) {
        req.flash('error', 'Invalid file type. Use JPG, PNG or WebP.');
        return res.redirect('/profile');
    }
    const filename = `user_${sessionUser.id}${ext}`;
    const dest = path.join(__dirname, '../public/uploads', filename);
    file.mv(dest, (err) => {
        if (err) { req.flash('error', 'Upload failed.'); return res.redirect('/profile'); }
        db.prepare('UPDATE users SET profile_photo=? WHERE id=?').run(filename, sessionUser.id);
        if (req.session && req.session.user) {
          req.session.user.photo = filename;
        }
        req.flash('success', 'Profile photo updated.');
        res.redirect('/profile');
    });
});

router.post('/change-password', requireAuth, (req, res) => {

    const sessionUser = req.session?.user;   // ✅ ADD
    if (!sessionUser) return res.redirect('/login');   // ✅ ADD

    const { current, password, confirm } = req.body;

    const user = db.prepare('SELECT * FROM users WHERE id=?')
        .get(sessionUser.id);   // ✅ FIX
    if (!bcrypt.compareSync(current, user.password_hash)) {
        req.flash('error', 'Current password is incorrect.');
        return res.redirect('/profile');
    }
    if (password !== confirm || password.length < 8) {
        req.flash('error', 'New passwords do not match or too short.');
        return res.redirect('/profile');
    }
    db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(bcrypt.hashSync(password, 12), user.id);
    req.flash('success', 'Password changed successfully.');
    res.redirect('/profile');
});

module.exports = router;


// routes/notifications.js
