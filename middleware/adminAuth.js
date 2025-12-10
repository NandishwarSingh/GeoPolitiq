/**
 * Simple admin authentication middleware
 * Uses session-based authentication with a single admin password
 */

const adminAuth = (req, res, next) => {
    if (req.session && req.session.isAdmin) {
        return next();
    }

    // Store intended URL for redirect after login
    req.session.returnTo = req.originalUrl;
    res.redirect('/admin');
};

module.exports = adminAuth;
