# EstateInvest — Real Estate Investment Platform

A complete, responsive web application built from the PRD: public website, investor portal and admin dashboard, with cryptocurrency-only payments (USDT, BTC, ETH, TON).

## Quick start

Requirements: **Node.js 22.13 or newer** (download from https://nodejs.org). Nothing else is needed — the app has no required npm dependencies and includes its own database.

```bash
cd estateinvest
cp .env.example .env      # optional — works with defaults
npm start
```

Open **http://localhost:3000**. On first start the database is created and filled with demo content.

### Demo accounts

| Role | Email | Password |
|---|---|---|
| Super Admin | `admin@estateinvest.com` | `Admin@12345` |
| Investor (verified, with investments) | `john@example.com` | `Investor@123` |
| Other investors (various KYC states) | `sarah@`, `michael@`, `amaka@`, `john.smith@`, `lerato@` … `@example.com` | `Investor@123` |

**Change the admin password** (or set `SEED_ADMIN_PASSWORD` before first start) before going live. Set `SEED_DEMO_DATA=0` to start without demo properties and investors.

**Emails in development:** without an email provider, every email (verification links, password resets, notifications) is printed in the terminal and visible in **Admin → Email Log**. Use that to click verification links while testing.

To wipe the local database and start fresh: `npm run reset-db`.

---

## What's included

### Public website
Home (hero, featured properties, plan comparison, how it works, trust points, testimonials, FAQs, disclosures), About, Properties (filter by type, search, sort), Property detail (gallery, funding progress, plans, details, documents, risks, enquiry form), Investment Plans, How It Works, FAQs, Contact (+ WhatsApp), News, and eight Legal/Compliance pages. All content is editable in the admin CMS.

### Investor portal
- Registration with Terms, Privacy and Risk acceptance; **email verification required**
- **KYC in 6 steps**: personal info & date of birth, government ID (passport/national ID/driver's licence), proof of address, selfie (opens the camera on phones), source of funds & suitability, review & submit. Statuses: Not Started, Pending Review, Approved, Rejected, Requires Additional Information
- Dashboard: total invested, active/completed, pending payments, next maturity, portfolio chart, allocation chart, recent activity
- **Investment flow** matching the mock-up: Select plan → Enter amount → Choose crypto → Payment (amount, network, wallet address, copy button, **scannable QR code**, countdown) → Confirmation
- Investment details: ID, property, plan, amount, currency, transaction hash, payment/start/maturity dates, status history, return terms, documents
- Transactions, Documents (auto-generated **certificates and receipts**, printable to PDF), Redemption requests (password re-confirmation), Notifications, Support tickets, Account settings (profile, password, signed-in devices)

### Admin dashboard
Dashboard with live stats and activity chart · Investors (search/filter, profile, suspend/reactivate) · **KYC Reviews** (document viewer, per-document verification, approve / request info / reject) · Investments (filter, status changes with mandatory reason, manual entry) · Properties (create/edit, images, documents, publish) · Investment Plans · Payments (verify/reject crypto transactions) · Redemptions (review → approve → record payout) · Support · Documents (issue to an investor or all) · Website Content (CMS for every public page) · News · **Reports (CSV export, opens in Excel)** · **Audit Logs**.
Super Admin adds: Administrators (roles & per-area permissions), Platform Settings (payment wallets, rates, rules), Email Log.

### Investment engine
- Lifecycle: Pending → Awaiting payment → Payment confirmed → Active → Maturing → Matured → Completed/Redeemed, plus Cancelled, Suspended, Under Review, Disputed. Invalid transitions are blocked; every change is recorded with who, when and why.
- Maturity calculated from the payment confirmation date using calendar months.
- **Returns are never invented.** A plan shows a return figure only after an admin enters the client-supplied rate *and* ticks "approved by legal counsel". Until then investors see "Return structure pending legal approval". The terms are snapshotted onto each investment so later edits don't change existing ones.
- A scheduler (every minute) expires unpaid invoices, moves investments to Maturing/Matured and notifies investors.

---

## Before going live — checklist

These match PRD sections 14 and 18 and must come from the company:

1. **Wallet addresses** — Admin → Platform Settings → enter your real public receiving addresses for each currency/network, set current USD rates, then untick *Show "demo address" warning*. The seeded addresses are placeholders and contain the word "Demo". **Never enter private keys or seed phrases** — the app only needs public addresses.
2. **Legal documents** — Admin → Website Content → Legal pages. Every page currently starts with "Template placeholder"; replace with your counsel-approved Terms, Privacy Policy, Investment Terms, Risk Disclosure, KYC/AML Policy, Redemption Policy, Investor Agreement and Crypto Disclosure.
3. **Regulatory approval** — keep *Allow new investments* switched **off** (Platform Settings → Investing) until licensing/legal opinion is in place, as the PRD requires.
4. **Return structures** — enter approved figures per plan and tick the approval box.
5. **Company details, statistics, testimonials, team** — Website Content. Only publish figures and testimonials you can verify.
6. **Properties & photos** — replace demo properties; upload real photos (until then a generated illustration is shown).
7. **Email** — create a free account at https://resend.com, verify your domain, set `RESEND_API_KEY` and `MAIL_FROM`.
8. **Production settings** — `NODE_ENV=production`, `APP_URL=https://your-domain`, a strong `SEED_ADMIN_PASSWORD`, and HTTPS (see Deployment).

---

## Deployment

The app is a single Node.js process. Any VPS or platform that runs Node 22 works (DigitalOcean, AWS Lightsail, Render, Railway, Hetzner, etc.).

**Option A — VPS with PM2 + Nginx (recommended)**
```bash
npm install -g pm2
NODE_ENV=production pm2 start server/index.js --name estateinvest
pm2 save && pm2 startup
```
Put Nginx (or Caddy, which handles HTTPS automatically) in front, proxying to port 3000, and set `TRUST_PROXY=1`. Back up the `data/` folder (database + uploaded documents) daily.

**Option B — Docker**
```bash
docker build -t estateinvest .
docker run -d -p 3000:3000 --env-file .env -v estateinvest-data:/app/data estateinvest
```

**PostgreSQL** (as specified in the PRD): `npm install pg`, set `DATABASE_URL=postgres://…` (and `PGSSL=1` for managed databases). Tables are created automatically on start; the schema is also in `server/db/schema.postgres.sql`. The SQLite default is ideal for development and small deployments; use PostgreSQL for production scale.

---

## Crypto payments

Two modes (Admin → Platform Settings):

- **Manual (default):** the investor sends crypto and pastes their transaction hash; an admin checks it on a block explorer (correct address, amount, network, confirmations) and clicks Confirm. The investment activates automatically.
- **Provider:** connect a payment processor (e.g. NOWPayments, CoinPayments, BTCPay Server) that POSTs to `/api/webhooks/payments`:
  ```json
  { "payment_ref": "TX-1931", "status": "confirmed", "tx_hash": "…", "confirmations": 12, "amount": 10000 }
  ```
  with header `X-Signature: hex(HMAC-SHA256(PAYMENT_WEBHOOK_SECRET, raw body))`. Underpayments are held for manual review, payments wait for the configured confirmations, and duplicate webhooks are ignored. Most providers need a small adapter to map their payload to this format.

---

## Security

scrypt password hashing · HttpOnly, SameSite=Strict session cookies (Secure in production) with server-side revocation · role-based and per-area admin permissions · CSRF protection · rate limiting on login, registration, uploads and payments · strict Content-Security-Policy and security headers · input validation on every endpoint · uploads checked by file content (not just extension), size-limited and stored privately outside the web root · duplicate transaction-hash detection · append-only audit log for all financial and admin actions · login alerts on new devices · "sign out other devices" · password changes revoke other sessions.

Recommended next steps from the PRD: 2FA for admins, a professional penetration test before launch, and a KYC provider (e.g. Sumsub, Onfido, Smile ID) for automated liveness checks.

---

## Project structure

```
server/
  index.js            HTTP server, routing, security headers, static files, scheduler
  config.js           Environment settings
  db/                 Database adapter (SQLite/PostgreSQL), schema, demo seed
  lib/                auth, validation, investment engine, email, uploads, audit, CSV
  routes/             public, auth, investor, admin, webhooks APIs
public/
  index.html
  assets/css/app.css  Design system (navy & gold, Playfair Display + Manrope)
  assets/js/          App shell, router, charts, QR generator, property illustrations
  assets/js/pages/    public, auth, investor and admin screens
scripts/              reset-db, export-pg-schema
```

## Phase 2 (from the PRD, not included)

Native mobile apps, advanced biometric KYC, referrals, multilingual support, advanced analytics, investor messaging, tax documents, property marketplace, additional blockchains, advanced compliance monitoring.
