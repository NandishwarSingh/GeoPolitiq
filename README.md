# GeoPolitiq 🌍

**Live:** [geopolitiq.com](https://geopolitiq.com/)

A geopolitics intelligence platform combining Wikipedia's authoritative content style with Google News' dynamic feed presentation. Features AI-powered content generation, push notifications, and a newspaper-inspired design.

## ✨ Features (What We Have)

### 🤖 AI Content Generation
- **Automated News Generation** - AI generates 5 posts per batch covering USA, India, UK, EU, and Global news
- **Perplexity Sonar Pro Integration** - Real-time web search for today's news via OpenRouter API
- **Scheduled Generation** - Configurable cron-based scheduler (e.g., every 2 hours)
- **Manual Seeding** - `node scripts/aiSeed.js` for on-demand content generation
- **News Verification** - Posts are verified for authenticity before publishing
- **Smart Image Search** - Automatically finds relevant images for each article

### 🔔 Push Notifications
- **Web Push API** - Browser notifications when new content is published
- **Country-Based Targeting** - Users receive notifications based on their preferred regions (USA, India, UK, EU, Global)
- **Auto-Subscribe** - Prompts users after 5 seconds on first visit
- **Footer Toggle** - Easy on/off toggle in the footer

### 🏷️ Tag System
- **Automatic Tag Linking** - Tags in articles become clickable links
- **Tag Migration** - `migrateTagLinks.js` updates all posts with new tag backlinks
- **Tag Cloud Page** - Visual tag browser at `/tags`
- **SEO-Optimized** - Each tag has its own paginated archive

### 📰 Content & Design
- **Newspaper-Style UI** - Premium, modern design with Merriweather typography
- **Dark Mode** - System-aware with manual toggle
- **Responsive Design** - Mobile-first approach
- **Infinite Scroll** - Load more posts automatically on scroll
- **Related Posts** - Each article shows related content

### 📊 Analytics & SEO
- **Page View Tracking** - Bot-filtered analytics stored in MongoDB
- **Sitemap Generation** - Auto-generated XML sitemaps for posts, tags, and static pages
- **LLMs.txt** - AI-readable site summary for LLM crawlers
- **Open Graph & Twitter Cards** - Social sharing optimization
- **JSON-LD Structured Data** - Rich snippets for search engines

### 🛡️ Admin Dashboard
- **Password-Protected** - Simple session-based authentication
- **AI Dashboard** - Trigger manual content generation, view logs
- **Post Management** - Create, edit, delete posts
- **Analytics Overview** - View page view statistics

---

## 🚧 Roadmap (What We Don't Have Yet)

### Authentication & Users
- [ ] User registration and login
- [ ] User profiles and preferences
- [ ] Social login (Google, GitHub)
- [ ] Email verification

### Content Features
- [ ] Comments system
- [ ] Bookmarks / Save articles
- [ ] Share count tracking
- [ ] Reading time estimates
- [ ] Audio narration (TTS)
- [ ] Newsletter subscription

### Advanced Features
- [ ] RSS Feed (`/feed.xml`)
- [ ] Country-specific feeds (`/country/:code`)
- [ ] Wiki-style reference pages
- [ ] Interactive data visualizations (D3.js)
- [ ] Real-time updates (WebSocket)
- [ ] Search functionality

### Performance
- [ ] Redis caching
- [ ] CDN integration
- [ ] Image optimization pipeline
- [ ] Service worker offline mode

### Monetization
- [ ] Premium subscription tiers
- [ ] Ad integration
- [ ] Donation support

---

## 🚀 Quick Start

### Prerequisites
- Node.js 18+
- MongoDB (local or Atlas)
- OpenRouter API key (for AI generation)

### Installation

```bash
# Clone the repository
git clone git@github.com:NandishwarSingh/GeoPolitiq.git
cd GeoPolitiq

# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Edit .env with your settings
```

### Environment Variables

```env
# Server
PORT=3000
NODE_ENV=development

# Database
MONGODB_URI=mongodb://localhost:27017/geopolitiq

# Authentication
SESSION_SECRET=your-secret-key
ADMIN_PASSWORD=your-admin-password

# AI Content Generation
OPENROUTER_API_KEY=your-openrouter-key
AI_SCHEDULER_ENABLED=true

# Push Notifications (generate with: npx web-push generate-vapid-keys)
VAPID_PUBLIC_KEY=your-public-key
VAPID_PRIVATE_KEY=your-private-key
VAPID_SUBJECT=mailto:your@email.com
```

### Run Development Server

```bash
npm run dev
```

Visit http://localhost:3000

### Generate Content

```bash
# Manual AI seed (generates 10 posts)
node scripts/aiSeed.js

# Or enable scheduler in .env for automatic generation
AI_SCHEDULER_ENABLED=true
```

---

## 📁 Project Structure

```
GeoPolitiq/
├── app.js                 # Express app configuration
├── server.js              # Server entry point
├── config/
│   ├── ai.js              # AI/OpenRouter configuration
│   ├── db.js              # MongoDB connection
│   └── upload.js          # File upload config
├── models/
│   ├── Post.js            # Post schema with geo fields
│   ├── PageView.js        # Analytics schema
│   ├── PushSubscription.js # Push notification subscriptions
│   └── AiGenerationLog.js # AI generation history
├── services/
│   ├── aiContentService.js    # AI content generation
│   ├── pushNotificationService.js # Web push handling
│   ├── scheduler.js       # Cron scheduler
│   ├── tagMatcher.js      # Tag linking logic
│   └── sitemapService.js  # Sitemap generation
├── routes/
│   ├── index.js           # Public routes + Push API
│   └── admin.js           # Admin routes
├── views/
│   ├── layouts/           # EJS layouts
│   ├── partials/          # Header, footer, cards
│   └── *.ejs              # Page templates
├── public/
│   ├── css/               # Stylesheets
│   ├── js/main.js         # Client-side JS + Push handler
│   └── sw.js              # Service worker
└── scripts/
    ├── aiSeed.js          # Manual content seeder
    └── migrateTagLinks.js # Tag migration utility
```

---

## 🛣️ API Routes

### Public
| Route | Description |
|-------|-------------|
| `GET /` | Homepage with latest posts |
| `GET /post/:slug` | Single post page |
| `GET /tag/:tag` | Posts by tag |
| `GET /tags` | Tag cloud page |
| `GET /topic/:cluster` | Posts by region |
| `GET /api/posts` | JSON API for infinite scroll |

### Push Notifications
| Route | Description |
|-------|-------------|
| `GET /api/push/vapid-key` | Get VAPID public key |
| `POST /api/push/subscribe` | Subscribe to notifications |
| `POST /api/push/unsubscribe` | Unsubscribe |

### Admin
| Route | Description |
|-------|-------------|
| `GET /admin` | Login page |
| `GET /admin/dashboard` | Main dashboard |
| `GET /admin/ai` | AI generation controls |
| `POST /admin/ai/generate` | Trigger AI generation |

---

## 🚀 Deployment

See the [VPS Deployment Guide](docs/vps-deployment-guide.md) for complete instructions on deploying to Ubuntu VPS with:
- Nginx reverse proxy
- Let's Encrypt SSL
- PM2 process manager
- MongoDB setup
- Push notification configuration

---

## 🎨 Design

- **Typography**: Merriweather (headlines) + Source Sans 3 (body)
- **Colors**: Dark navy primary, red accent, cream background
- **Dark Mode**: Full dark theme with system preference detection
- **Layout**: Newspaper-inspired with lead story + sidebar

---

## 📄 License

MIT

---

**Built with ❤️ for geopolitics enthusiasts**
