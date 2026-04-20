// middleware/auth.js
// Authentication & role-based access control middleware
const db = require('../database/db');
/**
 * Ensure user is authenticated.
 * Redirects to login if session is absent.
 */

const requireAuth = (req, res, next) => {
    if (!req.session.user) {
        req.flash('error', 'Please log in to continue.');
        return res.redirect('/login');
    }
    next();
};

/**
 * Factory: restrict access to specific roles.
 * @param {...string} roles – allowed role names
 */
const requireRole = (...roles) => (req, res, next) => {
    if (!req.session.user) {
        req.flash('error', 'Please log in to continue.');
        return res.redirect('/login');
    }
    if (!roles.includes(req.session.user.role)) {
        req.flash('error', 'Access denied. Insufficient privileges.');
        return res.redirect('/dashboard');
    }
    next();
};

/**
 * Redirect already-authenticated users away from auth pages.
 */



function requireImportPermission(req, res, next) {
  if (!req.session.user || req.session.user.role !== 'professor') {
    req.flash('error', 'Access denied.');
    return res.redirect('/dashboard');
  }

  const prof = db.prepare(`
    SELECT can_import FROM professors WHERE user_id = ?
  `).get(req.session.user.id);

  if (!prof || prof.can_import !== 1) {
    req.flash('error', 'You are not allowed to import marks.');
    return res.redirect('/dashboard');
  }

  next();
}

const redirectIfAuth = (req, res, next) => {
  if (req.session.user) {
    return res.redirect('/dashboard');
  }
  next();
};
module.exports = {
  requireAuth,
  requireRole,
  requireImportPermission,
  redirectIfAuth
};