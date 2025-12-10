# GeoPolitiq

A geopolitics intelligence platform combining Wikipedia's authoritative content style with Google News' dynamic feed presentation.

## 🌐 Features

- **Global Feed**: Latest geopolitical analysis at a glance
- **Post Pages**: In-depth articles with TL;DR summaries, sources, and related content
- **Tag Filtering**: Browse posts by topic, region, or theme
- **Admin Panel**: Simple password-protected dashboard for content management
- **Markdown Support**: Write content in Markdown, rendered as HTML
- **Responsive Design**: Works on desktop, tablet, and mobile

## 🚀 Quick Start

### Prerequisites

- Node.js 18+
- MongoDB (local or Atlas)

### Installation

1. Clone the repository:
```bash
git clone <your-repo-url>
cd GeoPolitiq
```

2. Install dependencies:
```bash
npm install
```

3. Configure environment:
```bash
# Edit .env with your settings
cp .env.example .env
```

Required environment variables:
```
PORT=3000
MONGODB_URI=mongodb://localhost:27017/geopolitiq
SESSION_SECRET=your-super-secret-session-key
ADMIN_PASSWORD=admin123
```

4. Start MongoDB (if running locally):
```bash
mongod
```

5. Seed sample data (optional):
```bash
node scripts/seed.js
```

6. Start the development server:
```bash
npm run dev
```

7. Open http://localhost:3000

## 📁 Project Structure

```
GeoPolitiq/
├── app.js                 # Express app configuration
├── server.js              # Server entry point
├── config/
│   └── db.js              # MongoDB connection
├── models/
│   └── Post.js            # Mongoose Post model
├── routes/
│   ├── index.js           # Public routes
│   └── admin.js           # Admin routes
├── controllers/
│   ├── postController.js  # Post logic
│   └── adminController.js # Admin logic
├── middleware/
│   └── adminAuth.js       # Admin authentication
├── views/
│   ├── layouts/           # EJS layouts
│   ├── partials/          # Reusable components
│   ├── admin/             # Admin views
│   └── *.ejs              # Page templates
├── public/
│   ├── css/               # Stylesheets
│   └── js/                # Client-side JavaScript
├── scripts/
│   └── seed.js            # Database seeder
└── utils/
    └── slugify.js         # Slug utilities
```

## 🛣️ Routes

### Public Routes

| Route | Description |
|-------|-------------|
| `GET /` | Homepage with latest posts |
| `GET /post/:slug` | Single post page |
| `GET /tag/:tag` | Posts filtered by tag |

### Admin Routes

| Route | Description |
|-------|-------------|
| `GET /admin` | Admin login |
| `POST /admin` | Process login |
| `GET /admin/dashboard` | Post management |
| `GET /admin/posts/new` | Create post form |
| `POST /admin/posts` | Create post |
| `GET /admin/posts/:id/edit` | Edit post form |
| `PUT /admin/posts/:id` | Update post |
| `DELETE /admin/posts/:id` | Delete post |
| `GET /admin/logout` | Logout |

## 📝 Post Model

```javascript
{
  title: String,        // Required, max 200 chars
  slug: String,         // URL-friendly, auto-generated
  tldr: String,         // Required, max 500 chars
  body: String,         // Markdown content
  tags: [String],       // Lowercase, e.g., ["china", "trade"]
  status: 'draft' | 'published',
  publishedAt: Date,
  featuredImage: String,
  sources: [{ title, url }],
  countries: [String],   // ISO codes for filtering
  metaTitle: String,     // SEO
  metaDescription: String
}
```

## 🔮 Future Extensibility

The architecture supports easy addition of:

- **Events**: Political events timeline
- **Polls**: Reader opinion polls
- **Datasets**: Interactive data visualizations
- **Wiki Pages**: Background reference articles
- **Country Feeds**: `/country/:code` routes
- **RSS Feed**: `/feed.xml` for syndication
- **Full Auth**: Replace simple password with user accounts

## 🎨 Design System

- **Typography**: Georgia (headings) + Inter (body)
- **Colors**: Navy primary, teal secondary, red accent
- **Cards**: Google News-style post cards
- **Layout**: Wikipedia-inspired article structure

## 📄 License

MIT
