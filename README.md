# TexLag Express — Automated Freight Quoting System

A full-stack freight brokerage quoting platform. Drivers log in, configure a load, and get an itemised quote calculated from live rates — with real road mileage via Google Maps, PDF export, and one-click email delivery to the broker.

---

## Features

- **JWT authentication** — Admin and Driver roles; login page routes each role to the correct portal
- **Driver Portal** — Jurisdiction toggle (Interstate / Intrastate), multi-stop routing, trip days, trailer hold, three deadhead modes (manual / location-based / GPS), driver assist, detention, low/no backhaul
- **Live quote engine** — Road mileage from Google Maps Distance Matrix API; rates read from Upstash Redis; formula: `(miles × CPM) + (days × truck rate) + (days × insurance) + (hold days × hold rate) + (deadhead miles × CPM) + extras`; backhaul flag doubles the gas surcharge
- **Team driver mode** — Client CPM doubled; internal driver cost always calculated on single-driver basis
- **PDF export** — Full itemised PDF with brand header (USDOT / MC / phone), route, line-item table, internal cost chip, detention compliance text, and "Quote Prepared By" footer; rendered server-side via `@react-pdf/renderer`
- **Email delivery** — Send quote PDF to broker via Resend with a branded HTML email
- **Admin Dashboard** — Pricing Variables panel (jurisdiction-split CPM, truck rate, insurance, hold rate, gas price); Driver Management panel (create drivers, view roster)
- **Serverless API** — All routes deployed as Vercel functions under `/api/`

---

## API Routes

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| `POST` | `/api/auth/login` | None | Exchange email + password for a JWT |
| `POST` | `/api/auth/register` | Admin JWT | Create a new driver or admin account |
| `GET` | `/api/rates` | None | Return current rate variables |
| `POST` | `/api/rates` | Admin JWT | Update one or more rate variables |
| `GET` | `/api/admin/drivers` | Admin JWT | List all driver accounts |
| `POST` | `/api/quote` | Any JWT | Calculate a freight quote |
| `POST` | `/api/deadhead` | Any JWT | Calculate deadhead miles (address or GPS coords) |
| `POST` | `/api/generate-pdf` | Any JWT | Render and return quote PDF as a binary buffer |
| `POST` | `/api/send-quote` | Any JWT | Generate PDF and email it to a broker via Resend |

---

## Local Setup

### 1. Clone

```bash
git clone https://github.com/automatondani-ai/Texlag.git
cd Texlag
```

### 2. Install dependencies

```bash
npm install
```

### 3. Configure environment variables

```bash
cp .env.example .env.local
```

Fill in `.env.local`:

| Variable | Required | Description |
|----------|----------|-------------|
| `GOOGLE_MAPS_API_KEY` | Yes | Google Cloud API key with **Distance Matrix API** enabled |
| `UPSTASH_REDIS_REST_URL` | Yes | Upstash Redis REST endpoint (e.g. `https://xxx.upstash.io`) |
| `UPSTASH_REDIS_REST_TOKEN` | Yes | Upstash Redis REST write token |
| `JWT_SECRET` | Yes | 64-character hex string used to sign and verify all JWTs. Generate with: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `RESEND_API_KEY` | For email | API key from [resend.com](https://resend.com) |
| `RESEND_FROM_EMAIL` | For email | Verified sender address on your Resend domain (e.g. `quotes@yourdomain.com`) |

> Email (`RESEND_API_KEY` / `RESEND_FROM_EMAIL`) is only required for the **Send to Broker** feature. All other functionality works without it.

### 4. Start the dev server

```bash
npm run dev        # Frontend only — http://localhost:5173
vercel dev         # Frontend + API routes with env vars loaded
```

---

## Vercel Deployment

### 1. Create an Upstash Redis database

**Via Vercel (recommended):**
1. Open your Vercel project → **Storage** tab
2. **Create Database → Upstash Redis**, name it (e.g. `texlag-redis`)
3. Copy `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` from the database's **.env.local** tab

**Via Upstash directly:**
1. Go to [console.upstash.com](https://console.upstash.com) and create a Redis database
2. Copy the **REST URL** and **REST Token** from the REST API section

### 2. Add environment variables in Vercel

**Project Settings → Environment Variables** — add all six for Production, Preview, and Development:

| Variable | Value |
|----------|-------|
| `GOOGLE_MAPS_API_KEY` | Your Google Maps API key |
| `UPSTASH_REDIS_REST_URL` | REST URL from Upstash |
| `UPSTASH_REDIS_REST_TOKEN` | REST token from Upstash |
| `JWT_SECRET` | A random 64-char hex string (`openssl rand -hex 32`) |
| `RESEND_API_KEY` | Your Resend API key |
| `RESEND_FROM_EMAIL` | Verified sender address |

### 3. Deploy

Push to `main` — Vercel redeploys automatically.

---

## First Admin Account (Bootstrap)

The `/api/auth/register` endpoint is admin-only, so the first admin must be seeded directly in Redis. In the [Upstash console](https://console.upstash.com), open your database's **Data Browser** and run:

```
SET users:admin@yourdomain.com '{"email":"admin@yourdomain.com","firstName":"Admin","lastName":"User","role":"admin","passwordHash":"<bcrypt-hash>","createdAt":"2025-01-01T00:00:00.000Z"}'
```

Generate the bcrypt hash locally (cost factor 12):

```bash
node -e "const b=require('bcryptjs'); b.hash('yourpassword', 12).then(console.log)"
```

Once the first admin exists, all subsequent accounts can be created through the Admin Dashboard → Driver Management panel.

---

## Default Rates

Rates fall back to hardcoded defaults when Redis keys are not set. To seed them explicitly, log in as admin and use the Pricing Variables panel, or POST directly:

```bash
curl -X POST https://<your-domain>/api/rates \
  -H "Authorization: Bearer <JWT>" \
  -H "Content-Type: application/json" \
  -d '{
    "interstateCpm": 2.50,
    "intrastateCpm": 2.00,
    "interstateTruckRate": 3.50,
    "intrastateTruckRate": 3.00,
    "insuranceRate": 0.15,
    "trailerHoldRate": 75.00,
    "gasPricePerGallon": 3.85
  }'
```

---

## Project Structure

```
texlag/
├── api/
│   ├── _lib/
│   │   ├── auth.js            # signToken, verifyToken, requireAdmin
│   │   ├── redis.js           # Shared Upstash Redis client
│   │   └── buildQuotePDF.js   # Shared PDF document builder (React.createElement)
│   ├── auth/
│   │   ├── login.js           # POST /api/auth/login
│   │   └── register.js        # POST /api/auth/register (admin only)
│   ├── admin/
│   │   └── drivers.js         # GET /api/admin/drivers (admin only)
│   ├── deadhead.js            # POST /api/deadhead
│   ├── generate-pdf.js        # POST /api/generate-pdf
│   ├── quote.js               # POST /api/quote
│   ├── rates.js               # GET + POST /api/rates
│   └── send-quote.js          # POST /api/send-quote
├── src/
│   ├── components/
│   │   └── QuotePDF.jsx       # Client-side PDF component (mirrors buildQuotePDF.js)
│   ├── context/
│   │   └── AuthContext.jsx    # JWT decode, login/logout, getToken
│   ├── pages/
│   │   ├── LoginPage.jsx
│   │   ├── AdminDashboard.jsx
│   │   └── DriverPortal.jsx
│   ├── views/
│   │   ├── DriverQuoteForm.jsx
│   │   ├── DriversView.jsx
│   │   └── PricingView.jsx
│   ├── App.jsx                # Role-based routing (admin → AdminDashboard, driver → DriverPortal)
│   ├── main.jsx
│   └── index.css
├── .env.example               # Env var template (committed — no secrets)
├── vercel.json                # Build config + SPA rewrite
└── vite.config.js
```
