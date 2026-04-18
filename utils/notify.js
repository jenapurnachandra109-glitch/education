// utils/notify.js
// Helper to create in-app notifications

const db = require('../database/db');

const notifyStudent = (userId, message) => {
    try {
        db.prepare('INSERT INTO notifications (user_id, message) VALUES (?, ?)').run(userId, message);
    } catch (err) {
        console.error('Notify error:', err.message);
    }
};

module.exports = { notifyStudent };
