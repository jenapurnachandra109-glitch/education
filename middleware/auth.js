// middleware/auth.js
// Authentication & role-based access control middleware

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
const redirectIfAuth = (req, res, next) => {
    if (req.session.user) return res.redirect('/dashboard');
    next();
};

module.exports = { requireAuth, requireRole, redirectIfAuth };

function requireAuth(req, res, next) {
  if (!req.session?.user) {
    return res.redirect('/login');
  }
  next();
}
