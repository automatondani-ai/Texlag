# Texlag Express

Automated freight quoting system for Texlag Express. Brokers generate itemised load quotes from a web UI — real road mileage via the Google Maps Distance Matrix API, live rates stored in Upstash Redis, and PDF export. An Admin panel lets staff update rate variables without a code deploy.

## Features

- Multi-stop route quoting with real road mileage (Google Maps Distance Matrix API)
- Solo / team driver modes (team loads bill at 2× CPM; internal driver cost always calculated on single-driver basis)
- Hazmat, tanker, and toll surcharge toggles
- One-click PDF export of the full itemised quote
- Admin panel to update CPM, fuel surcharge, hazmat, tanker, and toll rates live in Upstash Redis
- Serverless API (`/api/quote`, `/api/rates`) deployed as Vercel functions

---

## Local Setup

### 1. Clone the repo

```bash
git clone https://github.com/automatondani-ai/texlag.git
cd texlag
```

### 2. Install dependencies

```bash
npm install
```

### 3. Configure environment variables

Copy the example file and fill in your values:

```bash
cp .env.example .env.local
```

Open `.env.local` and set:

| Variable | Description |
|---|---|
| `GOOGLE_MAPS_API_KEY` | Google Cloud API key with the **Distance Matrix API** enabled |
| `UPSTASH_REDIS_REST_URL` | Upstash Redis REST endpoint URL (from Upstash or Vercel Storage dashboard) |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash Redis REST token (from Upstash or Vercel Storage dashboard) |
| `ADMIN_SECRET` | A strong secret string — required in the `Authorization: Bearer` header to update rates |

> **Note:** The Redis variables are only needed for the `/api` routes. The React frontend works locally without them; use `vercel dev` if you need fully working API routes locally.

### 4. Start the dev server

```bash
npm run dev
```

The app runs at `http://localhost:5173`. API routes require the KV variables to be set; use `vercel dev` instead if you need fully working API routes locally (see [Vercel CLI docs](https://vercel.com/docs/cli/dev)).

---

## Vercel Deployment

### 1. Push to GitHub

```bash
git add .
git commit -m "your message"
git push
```

### 2. Import the repo on Vercel

1. Go to [vercel.com/new](https://vercel.com/new)
2. Click **Import** next to the `texlag` repository
3. Leave the framework preset as **Vite** — Vercel will detect it automatically
4. Do not deploy yet

### 3. Create an Upstash Redis database

**Option A — via Vercel (recommended):**
1. In the Vercel dashboard, open the **Storage** tab
2. Click **Create Database → Upstash Redis**
3. Name it (e.g. `texlag-redis`) and click **Create**
4. Open the database, go to the **.env.local** tab, and copy `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`

**Option B — via Upstash directly:**
1. Go to [console.upstash.com](https://console.upstash.com) and create a Redis database
2. Open the database and copy the **REST URL** and **REST Token** from the REST API section

### 4. Add environment variables

In **Project Settings → Environment Variables**, add all four variables:

| Variable | Value |
|---|---|
| `GOOGLE_MAPS_API_KEY` | Your Google Maps API key |
| `UPSTASH_REDIS_REST_URL` | REST URL from Upstash or Vercel Storage dashboard |
| `UPSTASH_REDIS_REST_TOKEN` | REST token from Upstash or Vercel Storage dashboard |
| `ADMIN_SECRET` | A strong random secret (e.g. `openssl rand -hex 32`) |

Set all four for **Production**, **Preview**, and **Development** environments.

### 5. Deploy

Click **Deploy**. Subsequent pushes to `main` trigger automatic redeployments.

---

## Project Structure

```
texlag/
├── api/
│   ├── quote.js          # POST /api/quote — calculates and returns a freight quote
│   └── rates.js          # GET/POST /api/rates — reads and updates KV rate variables
├── src/
│   ├── components/
│   │   └── QuotePDF.jsx  # react-pdf document definition for PDF export
│   ├── views/
│   │   ├── QuoteView.jsx # Quote form + result display
│   │   └── AdminView.jsx # Rate management panel
│   ├── App.jsx
│   ├── main.jsx
│   └── index.css
├── .env.example          # Environment variable template (committed)
├── vercel.json           # Build output, SPA rewrite, function runtime config
└── vite.config.js
```

## Default Rates

Rates are seeded with defaults if the KV keys have not been set. To initialise them explicitly, POST to `/api/rates` with your admin secret:

```bash
curl -X POST https://<your-domain>/api/rates \
  -H "Authorization: Bearer <ADMIN_SECRET>" \
  -H "Content-Type: application/json" \
  -d '{
    "cpm": 1.85,
    "gasSurcharge": 0.18,
    "hazmat": 0.25,
    "tanker": 0.20,
    "tolls": 35.00
  }'
```
