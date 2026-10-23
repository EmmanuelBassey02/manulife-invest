# Manulife Financial Investment — Real Estate Investment Platform

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
- Transactions, Documents (auto-generated **certificates and receipts**, printable to PDF), Withdrawals (withdraw matured investments to a crypto wallet; investors can save a payout wallet per cryptocurrency; password re-confirmation), Notifications, Support tickets, Account settings (profile, password, signed-in devices)

### Admin dashboard
Dashboard with live stats and activity chart · Investors (search/filter, profile, suspend/reactivate) · **KYC Reviews** (document viewer, per-document verification, approve / request info / reject) · Investments (filter, status changes with mandatory reason, manual entry) · Properties (create/edit, images, documents, publish) · Investment Plans · Payments (verify/reject crypto transactions) · Redemptions (review → approve → record payout) · Support · Documents (issue to an investor or all) · Website Content (CMS for every public page) · News · **Reports (CSV export, opens in Excel)** · **Audit Logs**.
Super Admin adds: Administrators (roles & per-area permissions), Platform Settings (payment wallets, rates, rules), Email Log.

### Investment engine
- Lifecycle: Pending → Awaiting payment → Payment confirmed → Active → Maturing → Matured → Completed/Withdrawn, plus Cancelled, Suspended, Under Review, Disputed. Invalid transitions are blocked; every change is recorded with who, when and why.
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

The frontend runs on Next.js 16. The existing Node API router and business logic are exposed through a Next.js route handler. SQLite and local uploads remain available for development; Vercel requires PostgreSQL and a private Vercel Blob store.

**Option A - Vercel**

Use the default Next.js build (`npm run build`). Configure these environment variables in Vercel Project Settings:

- `DATABASE_URL`: managed PostgreSQL connection string.
- `BLOB_READ_WRITE_TOKEN`: connect a private Vercel Blob store to the project. Files are uploaded to the app's own API and stored in Blob by the server; the browser never uploads to Blob directly. Photos are resized in the browser so every upload stays under Vercel's 4.5 MB request limit; PDFs are limited to 3 MB.
- `CRON_SECRET`: long random secret for the protected `/api/cron/tick` endpoint.
- Set production `APP_URL`, `NODE_ENV`, and mail settings.
- Optional: set `DEEPL_API_KEY` so that content an admin adds later (new properties, news) is translated automatically. See "Languages" below.

Vercel Hobby cron jobs run at most daily. To preserve one-minute payment expiry and investment maturity checks, configure an external scheduler to request `GET https://your-domain/api/cron/tick` every minute with `Authorization: Bearer <CRON_SECRET>`.

To migrate existing local data, back up `data/` first. Connect a private Blob store, set `DATABASE_URL`, `BLOB_READ_WRITE_TOKEN`, and `SOURCE_SQLITE_PATH` in your local shell, then run `npm run migrate:vercel`. The script refuses populated Postgres tables and leaves the SQLite database and source uploads untouched. Review its imported row counts and verify representative files before switching production traffic. Do not run the import again into a populated database.

**Option B - VPS with PM2 + Nginx**
```bash
npm install -g pm2
NODE_ENV=production pm2 start npm --name estateinvest -- start
pm2 save && pm2 startup
```
Put Nginx (or Caddy, which handles HTTPS automatically) in front, proxying to port 3000, and set `TRUST_PROXY=1`. Back up the `data/` folder (database + uploaded documents) daily.

**Option C - Docker**
```bash
docker build -t estateinvest .
docker run -d -p 3000:3000 --env-file .env estateinvest
```

Tables are created automatically on start; the PostgreSQL schema is in `server/db/schema.postgres.sql`. SQLite remains the local-development default.

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

## Changes in this version (Manulife)

- Company name and logo changed to **Manulife Financial Investment**. On first start, existing website content in the database (company name, hero text, "Redemption" wording) is updated once; later edits made in Website Content are never overwritten.
- "Redemption" is now **"Withdrawal"** everywhere users see it. Old links (`/app/redemptions`, `/admin/redemptions`) redirect to `/app/withdrawals` and `/admin/withdrawals`. The database table, API paths and admin permission key keep the internal name `redemptions`, so existing data and admin roles keep working. New withdrawal references start with `WDR-`; earlier ones keep `RED-`.
- **Withdrawals page**: a Withdraw button for every matured investment. The payout defaults to the cryptocurrency and network the investor paid with, and to their saved wallet for it. Investors can save one payout wallet per cryptocurrency and network (password required; they're emailed when it changes). Addresses are checked against the network format (TRC20, ERC20, BTC, TON) before a request is accepted.
- **KYC uploads fixed**: uploads no longer go from the browser straight to Vercel Blob (the site's security policy blocked that request and the Blob SDK retried it for many minutes, so the spinner never stopped). Every upload now has a time limit and a clear error message.
- **Investment plans**: the investor app has an Investment Plans page, and the first step of the invest flow shows the same plan table as the website. Choosing a plan on the website opens the invest flow with that plan selected.
- **Phones**: tables become stacked cards, dialogs keep their main button visible, the top bar no longer squeezes the search box, and step indicators show "Step X of Y".
- After deploying, rename the Vercel project and GitHub repository (currently `manulife-invest`) in their own settings; this code can't change those.

## Languages

The language menu offers English, French, Spanish, Portuguese (Brazil) and German. Every built-in text on the
website and investor dashboard (pages, buttons, forms, messages, notifications, dates) is translated in
`public/assets/i18n/{fr,es,pt,de}.json`. Keys are the English text; keys with `{0}`, `{1}` are patterns for
text that contains names, amounts or dates (for example `Welcome back, {0}.`).

Text that administrators add later (property descriptions, news articles, website copy) is not in those files.
Set `DEEPL_API_KEY` (or `LIBRETRANSLATE_URL`) to translate it automatically: each sentence is translated once and
stored in the `translations` table. Only text that actually appears in your content is sent to the service.
Property names and the company name are never translated. Without a key, that added text stays in English.

When you add or change built-in text in the code, add the same English text to each catalog file.

