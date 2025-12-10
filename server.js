require('dotenv').config();

const app = require('./app');
const connectDB = require('./config/db');
const tagMatcher = require('./services/tagMatcher');
const Post = require('./models/Post');

const PORT = process.env.PORT || 3000;

// Initialize tag matcher index
async function initTagIndex() {
    try {
        const allTags = await Post.distinct('tags', { status: 'published' });
        await tagMatcher.buildIndex(allTags);
    } catch (error) {
        console.error('[TagMatcher] Failed to build index:', error.message);
    }
}

// Connect to MongoDB and start server
const startServer = async () => {
    try {
        await connectDB();

        // Build tag index for backlinking
        await initTagIndex();

        app.listen(PORT, () => {
            console.log(`
╔═══════════════════════════════════════════════════════════╗
║                                                           ║
║   🌐 GeoPolitiq Server Running                           ║
║                                                           ║
║   Local:   http://localhost:${PORT}                        ║
║   Admin:   http://localhost:${PORT}/admin                  ║
║                                                           ║
╚═══════════════════════════════════════════════════════════╝
      `);
        });
    } catch (error) {
        console.error('Failed to start server:', error);
        process.exit(1);
    }
};

startServer();
