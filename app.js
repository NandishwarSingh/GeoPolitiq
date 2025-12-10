const express = require('express');
const expressLayouts = require('express-ejs-layouts');
const session = require('express-session');
const methodOverride = require('method-override');
const compression = require('compression');
const path = require('path');

const app = express();

// ═══════════════════════════════════════════════════════
// PERFORMANCE OPTIMIZATIONS
// ═══════════════════════════════════════════════════════

// Enable gzip compression for all responses
app.use(compression());

// Static files with aggressive caching (1 year for assets)
app.use(express.static(path.join(__dirname, 'public'), {
    maxAge: process.env.NODE_ENV === 'production' ? '1y' : 0,
    etag: true,
    lastModified: true,
    // Set immutable for better caching
    immutable: process.env.NODE_ENV === 'production'
}));

// ═══════════════════════════════════════════════════════
// VIEW ENGINE SETUP
// ═══════════════════════════════════════════════════════

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Enable view caching in production
if (process.env.NODE_ENV === 'production') {
    app.set('view cache', true);
}

// Express layouts
app.use(expressLayouts);
app.set('layout', 'layouts/main');

// ═══════════════════════════════════════════════════════
// MIDDLEWARE
// ═══════════════════════════════════════════════════════

// Body parsing
app.use(express.json({ limit: '10kb' })); // Limit payload size
app.use(express.urlencoded({ extended: true, limit: '10kb' }));

// Method override for PUT/DELETE
app.use(methodOverride('_method'));

// Session configuration
app.use(session({
    secret: process.env.SESSION_SECRET || 'geopolitiq-secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: {
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
}));

// Make session available to views
app.use((req, res, next) => {
    res.locals.isAdmin = req.session && req.session.isAdmin;
    next();
});

// ═══════════════════════════════════════════════════════
// ROUTES
// ═══════════════════════════════════════════════════════

const indexRoutes = require('./routes/index');
const adminRoutes = require('./routes/admin');

// Analytics middleware (track page views with bot filtering)
const analyticsMiddleware = require('./middleware/analytics');
app.use(analyticsMiddleware);

app.use('/', indexRoutes);
app.use('/admin', adminRoutes);

// ═══════════════════════════════════════════════════════
// AI SCHEDULER INITIALIZATION
// ═══════════════════════════════════════════════════════

const scheduler = require('./services/scheduler');

// Start scheduler if enabled (controlled by AI_SCHEDULER_ENABLED env var)
if (process.env.AI_SCHEDULER_ENABLED === 'true') {
    scheduler.init();
    console.log('[App] AI scheduler auto-started');
}

// ═══════════════════════════════════════════════════════
// ERROR HANDLERS
// ═══════════════════════════════════════════════════════

// 404 handler
app.use((req, res) => {
    res.status(404).render('error', {
        title: '404 - Page Not Found',
        message: 'The page you are looking for does not exist.'
    });
});

// Error handler
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).render('error', {
        title: 'Server Error',
        message: 'Something went wrong on our end.'
    });
});

module.exports = app;
