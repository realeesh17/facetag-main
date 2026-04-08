# 📸 FaceTag — AI Event Photo Platform

> Find yourself in every event photo. Instantly.

FaceTag uses face recognition AI to automatically group event photos by person. Guests scan a QR code and instantly see every photo they're in — no manual tagging, no scrolling through hundreds of images.

---

## ✨ Features

| Feature | Description |
|---------|-------------|
| 🤖 **AI Face Clustering** | Face++ API (92% accuracy) groups photos by person automatically |
| 🔗 **QR Code Access** | Each person gets a unique secure QR code for their gallery |
| 🖼️ **Pinterest Gallery** | Masonry layout with filters, favorites, lightbox, and slideshow |
| 📊 **Analytics Dashboard** | Track scans, views, downloads per event |
| 🌙 **Dark Mode** | Full light/dark theme with persistent preference |
| 📱 **Mobile Ready** | PWA-ready, works on any device |
| 🤝 **AI Assistant** | Gemini-powered chat assistant on every page |
| 📤 **Social Sharing** | Share photos to WhatsApp, Instagram, Facebook, Twitter |
| 🔒 **Secure Access** | Cryptographic tokens protect each person's gallery |

---

## 🛠️ Tech Stack

```
Frontend          React 18 + TypeScript + Vite
Styling           Tailwind CSS + shadcn/ui
Backend           Supabase (PostgreSQL + Auth + Storage + Edge Functions)
Face Recognition  Face++ API
AI Assistant      Google Gemini 1.5 Flash
QR Generation     QR Server API
Deployment        Vercel
```

---

## 🚀 Getting Started

### Prerequisites
- Node.js 18+
- npm or yarn
- Supabase account
- Face++ API key
- Google Gemini API key

### Local Development

```bash
# Clone the repo
git clone https://github.com/yourusername/facetag.git
cd facetag

# Install dependencies
npm install

# Set up environment variables
cp .env.example .env
# Fill in your keys in .env

# Start dev server
npm run dev
```

Open `http://localhost:8080`

### Environment Variables

Create a `.env` file in the root:

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=your-anon-key
```

### Supabase Edge Function Secrets

Set these in your Supabase dashboard under **Settings → Edge Functions**:

```
FACEPP_API_KEY=your-facepp-key
FACEPP_API_SECRET=your-facepp-secret
GEMINI_API_KEY=your-gemini-key-starting-with-AIzaSy
```

### Deploy Edge Functions

```bash
npx supabase functions deploy cluster-faces --project-ref your-project-ref
npx supabase functions deploy generate-qr --project-ref your-project-ref
npx supabase functions deploy send-qr-email --project-ref your-project-ref
npx supabase functions deploy chat --project-ref your-project-ref
npx supabase functions deploy suggest-similar --project-ref your-project-ref
```

---

## 📁 Project Structure

```
facetag/
├── src/
│   ├── components/          # Reusable UI components
│   │   ├── AIAssistant.tsx  # Gemini-powered chat widget
│   │   ├── Navbar.tsx       # Navigation with dark mode toggle
│   │   └── ui/              # shadcn/ui components
│   ├── hooks/
│   │   ├── useAuth.tsx      # Authentication hook
│   │   └── useTheme.tsx     # Dark mode hook
│   ├── pages/
│   │   ├── Landing.tsx      # Public landing page
│   │   ├── Gallery.tsx      # User photo gallery (QR access)
│   │   ├── admin/
│   │   │   ├── Events.tsx   # Event management
│   │   │   ├── EventDetail.tsx  # Upload, cluster, manage persons
│   │   │   └── Analytics.tsx   # Event analytics dashboard
│   │   └── user/
│   │       └── ScanQR.tsx   # QR code scanner
│   └── integrations/
│       └── supabase/        # Auto-generated Supabase client
├── supabase/
│   └── functions/
│       ├── cluster-faces/   # Face++ clustering engine
│       ├── generate-qr/     # QR code generation
│       ├── send-qr-email/   # Email delivery
│       ├── chat/            # Gemini AI assistant
│       └── suggest-similar/ # AI duplicate detection
└── public/
```

---

## 🔄 How It Works

```
Admin uploads photos
       ↓
cluster-faces edge function
       ↓
Face++ detects faces → converts bbox to % → groups by identity
       ↓
Gemini AI merges duplicate clusters
       ↓
Admin names each person → generate-qr creates secure link
       ↓
Guest scans QR → sees only their photos → download / share
```

---

## 🧑‍💻 Development

```bash
# Type checking
npm run typecheck

# Linting
npm run lint

# Build for production
npm run build

# Preview production build
npm run preview
```

---

## 📦 Deploying to Vercel

1. Push to GitHub
2. Import repo at [vercel.com](https://vercel.com)
3. Add environment variables:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_PUBLISHABLE_KEY`
4. Deploy ✅

Auto-deploys on every `git push` to `main`.

---

## 📄 License

MIT — built for academic project demonstration.

---

## 👥 Team

Built by **Rakesh Babriya**, Muskan Chaturvedi, Rishika Dubey, Moin Siddiqui  
G V Acharya Institute of Engineering & Technology  
University of Mumbai — TE CSE, 2025–26