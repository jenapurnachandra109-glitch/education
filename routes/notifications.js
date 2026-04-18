// routes/notifications.js
const express = require('express');
const router  = express.Router();
const db      = require('../database/db');
const { requireAuth } = require('../middleware/auth');

router.get('/', requireAuth, (req, res) => {
    const notifications = db.prepare(`
        SELECT * FROM notifications WHERE user_id = ?
        ORDER BY created_at DESC LIMIT 50
    `).all(req.session.user.id);

    // Mark all as read
    db.prepare('UPDATE notifications SET is_read=1 WHERE user_id=?').run(req.session.user.id);

    res.render('notifications/index', { title: 'Notifications', notifications });
});

router.post('/:id/read', requireAuth, (req, res) => {
    db.prepare('UPDATE notifications SET is_read=1 WHERE id=? AND user_id=?')
      .run(req.params.id, req.session.user.id);
    res.json({ success: true });
});

// API: unread count (used by navbar)
router.get('/unread-count', requireAuth, (req, res) => {
    const { c } = db.prepare('SELECT COUNT(*) AS c FROM notifications WHERE user_id=? AND is_read=0')
                     .get(req.session.user.id);
    res.json({ count: c });
});

module.exports = router;
