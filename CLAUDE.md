# CLAUDE.md — TexLag Express Codebase Reference

> This file documents the entire project for AI-assisted development sessions.
> It is the authoritative map of what exists, how it works, and what still needs doing.

---

## 1. What This Project Does

**TexLag Express** is a freight quoting web application for a 3PL (Third-Party Logistics) carrier.

- **Drivers** log in, fill out a quote form (route, load type, surcharges), and receive a calculated broker quote and internal driver payable.
- **Admins** manage driver accounts, configure pricing variables, view all driver quote history, download PDFs, and monitor an audit trail.
- Quotes can be emailed directly to brokers as PDF attachments via Resend.
- The carrier's real credentials: USDOT 3609656, MC-1229052, +1(832)-944-5199.

---

## 2. Tech Stack & Dependencies

### Runtime & Hosting
| Layer | Choice |
|---|---|
| Hosting | Vercel (SPA + Serverless Functions) |
| Node.js target | 22.x (set in `package.json` → `engines`) |
| Frontend bundler | Vite 6 |
| Frontend framework | React 18 |

### Production Dependencies (`package.json`)
| Package | Version | Purpose |
|---|---|---|
| `react` + `react-dom` | ^18.3.1 | UI |
| `@upstash/redis` | ^1.34.9 | Redis REST client (only database) |
| `jsonwebtoken` | ^9.0.2 | JWT sign / verify (server-side) |
| `bcryptjs` | ^2.4.3 | Password hashing (bcrypt, 12 rounds) |
| `@react-pdf/renderer` | ^4.3.0 | Server-side PDF generation — **ESM-only package** |
| `resend` | ^4.5.1 | Transactional email delivery |
| `uuid` | ^11.1.0 | Used for unique IDs (audit keys use random string instead) |
| `next-auth` | ^5.0.0-beta.25 | **UNUSED** — never imported anywhere, left over from early spike |
| `@auth/core` | ^0.37.4 | **UNUSED** — dependency of next-auth spike, also dead |
| `sharp` | ^0.34.5 | Likely **unused** — logo is loaded via `readFileSync` in `logoBase64.js`, not processed by sharp |

### Dev Dependencies
| Package | Version | Purpose |
|---|---|---|
| `vite` | ^6.3.5 | Build + dev server |
| `@vitejs/plugin-react` | ^4.3.4 | JSX transform + React Fast Refresh |

### External APIs
| Service | Usage |
|---|---|
| Google Maps Distance Matrix API | Route mileage calculation (multi-leg) |
| Google Maps Geocoding API | ZIP / postal code → city, state resolution |

---

## 3. Folder Structure

```
texlag-express/
├── api/                          # Vercel serverless functions (CommonJS via ncc bundler)
│   ├── auth.js                   # POST /api/auth — login, register, change/forgot/reset password
│   ├── deadhead.js               # POST /api/deadhead — calculate deadhead miles via Google Maps
│   ├── dispatch.js               # POST /api/dispatch — generate PDF or email quote to broker
│   ├── geocode.js                # POST /api/geocode — resolve ZIP/postal code to city+state
│   ├── quote.js                  # POST /api/quote — calculate & persist a freight quote
│   ├── rates.js                  # GET|POST /api/rates — read/write admin pricing variables
│   ├── admin/
│   │   ├── audit-log.js          # GET /api/admin/audit-log — paginated audit trail
│   │   └── drivers.js            # GET|POST /api/admin/drivers — driver management + quote history
│   ├── driver/
│   │   └── quotes.js             # GET|PATCH /api/driver/quotes — driver quote list + won toggle
│   └── _lib/                     # Shared utilities (not exposed as endpoints)
│       ├── audit.js              # logAudit() + AUDIT action constants
│       ├── auth.js               # signToken(), verifyToken(), requireAdmin()
│       ├── buildQuotePDF.js      # buildDocument() — React PDF document builder
│       ├── keys.js               # k.* — tenant-namespaced Redis key factory
│       ├── logoBase64.js         # Reads logo PNG as base64 for PDF embedding
│       └── redis.js              # Upstash Redis client singleton
│
├── src/                          # React SPA (Vite)
│   ├── main.jsx                  # React DOM root — mounts <App />
│   ├── App.jsx                   # Auth router: routes to LoginPage, DriverPortal, or AdminDashboard
│   ├── index.css                 # All styles (~2300 lines), BEM-ish classes, CSS variables
│   ├── assets/
│   │   ├── texlag-logo.avif      # Logo used in nav (frontend)
│   │   └── texlag-logo.png       # Logo used in PDF (backend, via logoBase64.js)
│   ├── context/
│   │   └── AuthContext.jsx       # JWT auth context: login/logout/getToken/mustChangePassword
│   ├── pages/                    # Top-level page shells (route targets)
│   │   ├── AdminDashboard.jsx    # Admin shell with sidebar: Drivers / Pricing / Audit
│   │   ├── DriverPortal.jsx      # Driver shell with Quote Form / Quote History tabs
│   │   ├── LoginPage.jsx         # Login form
│   │   ├── ChangePasswordPage.jsx # Forced password change (blocks portal on first login)
│   │   └── ForgotPasswordPage.jsx # Forgot password — request + enter 6-digit code
│   ├── views/                    # Section content components
│   │   ├── DriverQuoteForm.jsx   # Main quote form (~900 lines) — most complex component
│   │   ├── QuoteHistoryView.jsx  # Driver's own quote history, won/pending toggle, filters
│   │   ├── DriversView.jsx       # Admin: driver roster + profile with quote history
│   │   ├── PricingView.jsx       # Admin: pricing variable editor
│   │   └── AuditView.jsx         # Admin: paginated audit log
│   └── components/
│       └── QuotePDF.jsx          # Client-side PDF component — UNUSED in production flow
│                                 # (PDF is generated server-side by api/_lib/buildQuotePDF.js)
│
├── vercel.json                   # Vercel config: SPA rewrite rule, dispatch.js 60s timeout
├── vite.config.js                # Vite config with @vitejs/plugin-react
├── package.json                  # Node 22.x, CommonJS (no "type": "module")
├── .env.example                  # All required env vars documented
└── CLAUDE.md                     # This file
```

---

## 4. Environment Variables

All variables are required unless marked optional.

| Variable | Required | Description |
|---|---|---|
| `UPSTASH_REDIS_REST_URL` | Yes | Upstash Redis database REST endpoint URL |
| `UPSTASH_REDIS_REST_TOKEN` | Yes | Upstash Redis REST auth token |
| `JWT_SECRET` | Yes | Secret for signing/verifying JWTs. Generate: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `GOOGLE_MAPS_API_KEY` | Yes | Google Cloud API key — needs Distance Matrix API + Geocoding API enabled |
| `RESEND_API_KEY` | Yes | Resend API key for outbound email (welcome emails, password resets, quote emails) |
| `RESEND_FROM_EMAIL` | Optional | Verified sender address (e.g. `quotes@yourdomain.com`). Falls back to `onboarding@resend.dev` (Resend test address — only delivers to your own Resend account) |
| `ADMIN_SECRET` | Optional | Bootstrap token to create the first admin account before any JWT exists. Pass as `Authorization: Bearer {ADMIN_SECRET}` to `POST /api/auth` with `action: register` |
| `REDIS_NS` | Optional | Namespace prefix for all quote-related Redis keys. Set to isolate tenant data when multiple instances share one database. Example: `REDIS_NS=texlag` → keys become `texlag:quote:...` |
| `RESEND_TEST_EMAIL` | Optional | **Undocumented in .env.example.** When set, all outbound quote emails are redirected to this address instead of the broker. Set in development to avoid emailing real brokers |

---

## 5. What's Built and Working

### Authentication
- [x] Login with email + password (bcrypt, timing-safe dummy comparison)
- [x] JWT tokens (8-hour expiry), stored in `localStorage` under `texlag_token`
- [x] Admin registration via admin JWT or bootstrap `ADMIN_SECRET`
- [x] Driver registration by admin — sends welcome email with temporary password
- [x] `mustChangePassword` flag: blocks driver portal until password is changed
- [x] Change password (authenticated endpoint, complexity rules enforced)
- [x] Forgot password — 6-digit code via email with 15-minute TTL
- [x] Reset password via code
- [x] Account deactivation — blocks login with friendly error message
- [x] Role eviction in `AppRouter` — unknown roles are immediately logged out

### Driver Quote Form (`DriverQuoteForm.jsx`)
- [x] Multi-stop route (pickup + up to 3 drop-offs)
- [x] ZIP / postal code auto-resolution (US 5-digit + Canadian FSA+LDU) with 600ms debounce
- [x] Deadhead miles field with GPS geolocation or address lookup
- [x] Jurisdiction toggle: Interstate / Intrastate
- [x] Driver mode toggle: Solo / Team (doubles both CPM rates for team loads)
- [x] Load Type toggle: Palletized / Non-Palletized
  - Palletized: optional pallet count field (min 0)
  - Driver assist + pallets > 0 → read-only calculated fee display (fetches live rate from `/api/rates`)
  - All other cases → manual flat fee input
- [x] Trailer hold days input
- [x] Toggle surcharges: Driver Assist, Detention (with amount field), Low/No Backhaul (with Partial sub-toggle), Hazmat
- [x] Quote result card showing all line items, broker total, internal driver payable
- [x] Download quote as PDF (via `/api/dispatch?action=generate-pdf`)
- [x] Send quote to broker via email (via `/api/dispatch?action=send-quote`)
- [x] New quote / back button to reset the form

### Quote Calculation (`api/quote.js`)
- [x] Parallel fetch: Google Maps Distance Matrix + Redis rates
- [x] Auto-calculated trip days: `ceil(miles / speed_mph / 11)`, minimum 1 day
- [x] Broker-facing formula: Broker CPM × miles + truck rate × days + insurance × days + hazmat × days + trailer hold + deadhead CPM + driver assist + gas surcharge + backhaul gas + detention
- [x] Internal driver cost: same formula but using Driver CPM (lower than broker CPM)
- [x] Rate snapshot stored with each quote for audit trail accuracy
- [x] Quote ID format: `YYYYMMDD-NNN` (atomic daily Redis counter, resets per day)
- [x] Quote persisted to Redis: `quote:{id}`, indexed in `quotes:driver:{email}` list
- [x] Platform-wide counter incremented on each quote

### Admin Dashboard
- [x] **Driver Management** (default landing section)
  - Driver roster with quote count, active/inactive status
  - Add new driver (register form, sends welcome email)
  - Toggle driver active/inactive status
  - Driver profile: all quotes with month/year client-side filters
  - Won/Pending badge on each quote row in admin profile
  - Total Won summary cards (broker amount + driver payable) in admin profile
  - Download PDF for any quote from admin profile
- [x] **Pricing Variables** — edit all 20+ rate knobs via a form, persisted to Redis
- [x] **Audit Trail** — paginated log, newest first, with action type and description

### Driver Portal
- [x] **Quote Form** (described above)
- [x] **Quote History**
  - All quotes for the authenticated driver, newest first
  - Month/year filter dropdowns with Clear Filters
  - Won/Pending toggle per quote (PATCH to `/api/driver/quotes`)
  - Summary cards: total quotes, total won, total won (broker $), total won (driver $)
  - Download PDF for any quote

### PDF Generation (`api/_lib/buildQuotePDF.js` + `api/dispatch.js`)
- [x] Full-page PDF: header with logo + carrier credentials, info bar (driver, route, jurisdiction, load type, trip days), line items table, totals, internal cost section
- [x] Load Type shown in PDF info bar
- [x] Descriptive PDF filenames: `TexLag-Quote-{id}-{pickup}-to-{dest}.pdf`
- [x] Dynamic `import('@react-pdf/renderer')` inside async function bodies — correctly handles ESM-only package in CommonJS bundling context

### Email
- [x] Welcome email to new drivers (HTML, includes temp password)
- [x] Password reset email (6-digit code, HTML)
- [x] Quote email to broker (PDF attachment, configurable from address)
- [x] `RESEND_TEST_EMAIL` redirect for development (prevents real broker emails)

### Reliability / Security
- [x] Timing-safe login (dummy bcrypt hash prevents user enumeration)
- [x] Password enumeration protection on forgot-password (always returns 200)
- [x] Ownership enforcement on quote PATCH (driver can only update their own quotes)
- [x] `requireAdmin()` middleware guard on all admin endpoints
- [x] All rates validated before write (`non-negative finite number`)
- [x] Tenant-namespaced Redis keys for quote data (via `REDIS_NS` env var)
- [x] Audit log: every significant action logged (fire-and-forget, never blocks responses)

---

## 6. What's Broken / Incomplete / Pending

### Known Issues
- **`RESEND_TEST_EMAIL` not in `.env.example`** — used in `api/dispatch.js` but not documented. Add it to `.env.example`.
- **Partial tenant namespacing** — only quote-related keys use the `k.*` factory (`quote:*`, `quotes:driver:*`, `quotes:platform:total`, `quote_counter:*`). Auth keys (`users:*`, `password_reset:*`), rate keys (`rates:*`), and audit log keys (`audit_log:*`) are NOT namespaced. If multi-tenancy is ever required, these need updating too.
- **`src/components/QuotePDF.jsx` is dead code** — a client-side React PDF component that is never imported or used. The actual PDF is built server-side by `api/_lib/buildQuotePDF.js`. Should be removed to avoid confusion.
- **`next-auth` + `@auth/core` dead dependencies** — both listed in `package.json` but never imported. They add ~6MB to install and slow bundling. Should be removed.
- **`sharp` likely unused** — logo is embedded as base64 via `readFileSync` in `api/_lib/logoBase64.js`; no image processing is done anywhere in the codebase.
- **`uuid` usage** — imported in package.json but audit keys use `Math.random().toString(36)` instead of `uuid`. Either use it consistently or remove it.

### Incomplete Features
- **No quote editing** — once a quote is generated and saved, it cannot be edited. If a driver makes an error, they must generate a new quote.
- **No quote deletion** — quotes accumulate indefinitely; there is no admin or driver endpoint to delete or archive quotes.
- **No multi-admin support tested** — the system supports `role: 'admin'` but there is no self-serve admin creation UI; admins must be created via `ADMIN_SECRET` bootstrap or by another admin via the register API.
- **Driver PDF download in admin** — works via `api/dispatch.js?action=generate-pdf`, but there is no loading/error state shown if the PDF generation fails in the admin UI.
- **No password confirmation field** — the change-password and reset-password flows have no "confirm password" input to guard against typos.
- **No rate history / versioning** — when an admin updates rates, the old values are overwritten with no record (except the audit log which only records that rates changed, not the old values).

### Pending / Not Started
- **No test suite** — zero unit tests, integration tests, or E2E tests anywhere in the project.
- **No CI/CD pipeline** — no GitHub Actions or similar; deploys are manual `vercel --prod` or git push to Vercel.
- **No rate limiting** — the login endpoint has no brute-force protection; the quote endpoint has no request throttling.
- **No pagination for driver quote history (admin side)** — the admin profile fetches all quotes at once (`?all=true`). At scale this could become slow; server-side filtering would be more efficient.
- **No search in driver roster** — the admin drivers list has no search/filter; as the driver count grows this will become unwieldy.
- **No email for quote sent confirmation** — when a driver emails a quote to a broker, there is no CC or confirmation email to the driver or admin.

---

## 7. Naming Conventions, Patterns & Architectural Decisions

### API Layer
- **Single-handler pattern**: Each `api/*.js` file exports one `default async function handler(req, res)`. Routing within a handler is done by `req.method` and `req.query.action` / `req.body.action`.
- **`_lib/` prefix convention**: Files prefixed with `_` (or in the `_lib/` folder) are shared utilities not exposed as endpoints. Vercel treats them accordingly.
- **CJS bundling**: The project has no `"type": "module"` in `package.json`. All `api/` files use ES module syntax (`import`/`export`) but Vercel's `ncc` bundler compiles them to CommonJS at deploy time. **This is intentional** — do NOT change it.
- **Dynamic import for ESM packages**: `@react-pdf/renderer` v4 is ESM-only and cannot survive `ncc` static analysis → `require()` conversion. All uses of this package must use `await import('@react-pdf/renderer')` inside `async` function bodies. See `api/_lib/buildQuotePDF.js` and `api/dispatch.js`.
- **Error shape**: All API errors return `{ error: "message string" }`. Validation errors may include additional fields like `{ error, invalid: [...] }` or `{ error, allowed: [...] }`.
- **`r2()` rounding**: All monetary values are rounded to 2 decimal places via `const r2 = n => Math.round(n * 100) / 100`.

### Redis Key Schema
All quote-related keys go through `api/_lib/keys.js`:
```
quote:{quoteId}                    → full quote payload object
quotes:driver:{email}              → Redis list of quote IDs (LPUSH, index 0 = newest)
quotes:platform:total              → platform-wide quote counter (INCR)
quote_counter:{YYYYMMDD}           → daily sequence counter for quote IDs (INCR)
```
Non-quote keys (not namespaced by `k.*`):
```
users:{email}                      → user object (passwordHash included)
password_reset:{email}             → 6-digit reset code (15-minute TTL via ex: 900)
rates:{kv_name}                    → individual rate values (e.g. rates:interstate_cpm)
audit_log:index                    → Redis list of all audit entries (LPUSH, newest first)
audit_log:{YYYY-MM-DD}:{ms}:{rand} → individual audit entry objects
```

### Quote ID Format
`YYYYMMDD-NNN` — e.g. `20250527-001`. Atomic daily Redis INCR. Resets automatically each new day (key includes date). Minimum 3-digit zero-padded sequence per day.

### Frontend
- **No client-side router** — routing is entirely role-based in `App.jsx` via a `ROLE_MAP` object. No React Router, no URL params.
- **`localStorage` for auth** — JWT stored under `texlag_token`; `mustChangePassword` flag stored under `texlag_mcp`. Decoded client-side via `atob` without signature verification (server verifies on every API call).
- **CSS class naming** — BEM-inspired, not strict BEM. Blocks: `.card`, `.nav`, `.dashboard`, `.mode-toggle`, `.qh-summary`. Modifiers use `--`: `.nav__logout`, `.sidebar-nav__item--active`, `.qh-won-btn--on`. All styles in one flat `src/index.css` file.
- **`useCallback` + `useMemo`** — used consistently throughout views for derived state (filtered quote lists, year/month options, summary totals).
- **Fetch pattern**: `fetch('/api/...', { headers: { Authorization: 'Bearer ' + getToken() } })`. No Axios, no fetch wrapper library.
- **Error state naming**: `const [error, setError] = useState(null)` — displayed as `{error && <p className="error-msg">{error}</p>}`.

### Email
- All HTML emails are inline-styled table-based layouts (no external CSS, for email client compatibility).
- `RESEND_FROM_EMAIL` falls back to `onboarding@resend.dev` — **not suitable for production** (only delivers to Resend account owner).
- Quote emails to brokers: `api/dispatch.js` handles both PDF-to-browser (`action=generate-pdf`) and email (`action=send-quote`).

### PDF
- Built server-side only (never in the browser) using `@react-pdf/renderer` v4.
- The `STYLES` constant in `buildQuotePDF.js` is a plain object (no `StyleSheet.create()` at module level) — `StyleSheet.create()` is called inside the async `buildDocument()` function after the dynamic import resolves.
- Logo is embedded as a base64 data URI read from `texlag-logo.png` via `fs.readFileSync` at module load time.

---

## 8. v2.1 Spec Features — Status

| Feature | Status |
|---|---|
| Load Type selector (Palletized / Non-Palletized) | ✅ Done |
| Palletized: optional pallet count (min 0) | ✅ Done |
| Non-Palletized: manual driver assist fee input | ✅ Done |
| Palletized + driver assist + pallets > 0: read-only calculated fee | ✅ Done |
| Load type shown on quote result card | ✅ Done |
| Load type shown on PDF info bar | ✅ Done |
| Load type in quote API payload + Redis storage | ✅ Done |
| Admin: Month/year filter on driver quote history | ✅ Done |
| Admin: Won/Pending badge on quote rows | ✅ Done |
| Admin: Total Won — Broker Amount summary card | ✅ Done |
| Admin: Total Won — Driver Payable summary card | ✅ Done |
| Tenant-namespaced Redis keys (quote-related) | ✅ Done |
| Load Type toggle equal-width buttons (50/50 flex) | ✅ Done |
| ERR_REQUIRE_ESM fix (dynamic import for @react-pdf/renderer) | ✅ Done |
| Driver quote history with won/pending toggle | ✅ Done |
| Driver quote history month/year filter + earnings cards | ✅ Done |
| ZIP auto-resolution (US + Canadian postal codes) | ✅ Done |
| Deadhead miles (address or GPS) | ✅ Done |
| Trailer hold days | ✅ Done |
| Hazmat surcharge per day | ✅ Done |
| Low/No Backhaul with Partial sub-toggle | ✅ Done |
| Broker CPM separate from Driver CPM | ✅ Done |
| Auto trip days from route miles + speed | ✅ Done |
| Per-driver quote count in admin roster | ✅ Done |
| Admin PDF download for any driver quote | ✅ Done |
| Quote email to broker with PDF attachment | ✅ Done |
| Intrastate / Interstate jurisdiction toggle | ✅ Done |
| Team / Solo driver mode toggle | ✅ Done |
| Full mobile responsiveness | ✅ Done |
| Quote deletion / archiving | ❌ Not built |
| Quote editing after generation | ❌ Not built |
| Rate history / change tracking | ❌ Not built |
| Test suite (unit / integration / E2E) | ❌ Not built |
| Brute-force protection on login | ❌ Not built |
| Multi-tenant namespacing for auth/rates/audit keys | ❌ Partial (quote keys only) |
