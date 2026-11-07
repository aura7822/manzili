### RELEASE NOTES 

Release Version: v3.3.0

Release Date: November 7, 2026

Target Environment: Node.js 20+ | PostgreSQL 14+ / Neon DB



#  PROPERTY MANAGEMENT : Manzili Mkononi (Node.js)

Landlord Control Panel + tenant QR payment page, in pure JavaScript.

| Layer | Tech |
|---|---|
| API | Node.js 20+, Express 5, PostgreSQL (`pg`), Zod validation, JWT, node-cron, Server-Sent Events |
| Database | PostgreSQL 14+, works with **Neon** (see below) |
| Web | Vue 3 + Vue Router + Vite, hand-written CSS |
| Payments | M-Pesa Daraja STK Push + webhook |
| Messaging | Africa's Talking SMS, SMTP email (WhatsApp is a stub) |

**Look and feel:** Ocean Water `#CAE8E8`, Cherry Velvet `#C1121F` and Singapore `#E5DF94`. Flat colours (no gradients), neumorphic and clay shadows (no glows), sharp edges everywhere (no rounded corners). Skeleton screens while loading and updating, friendly error and toast messages, and a layout that works on phones (bottom navigation, full-width sheet dialogs, tables that become cards).

## Sections

| Section | What it does |
|---|---|
| **Sign in** | Calligraphy title, a random real estate quote, and an eye button to peek at your password. |
| **Control Panel** | Opens with a "Pulling resources" progress bar (0 to 100%) beside the title; skeletons stay until it completes. **Property buttons** (All properties, each property, and a **+** to add one) switch the whole panel between global and per-property figures. Net income, rent collected, maintenance spend (editable), pending, overdue, occupancy, deposits, income chart, **houses by type** with total units, a **payments feed**, **prices**, and overdue ageing. A **calendar button** shows the system as it was on any day up to 2 weeks back (read-only). |
| **Units** | Every house with a Vacant / Occupied indicator, floor, house type, rent, **deposit**, tenant and tenure. All / Occupied / Vacant tabs. **Vacate** archives the tenant, erases their details at once and moves the house to Vacant. Payment QR per property. |
| **Tenants** | Name, phone, house, **rent status**, **deposit**, **date added** and a **Send reminder** button (greyed out once rent is paid). The Add tenant card lets you pick the property, house, house type, deposit (paid or not) and reminder channel (email is greyed out until an email address is entered). If no house is available, an **Add house** button opens the house window. |
| **Broadcast** | Message everyone, or filter by house type, floor, rent status and deposit status, or **pick specific tenants**. `{name}` and `{house}` placeholders. |
| **Archives** | Vacated tenants (with their deposit info) kept for 60 days, then deleted automatically. |
| **Logs** | Every M-Pesa message and every other activity, filterable and searchable. |

House types: Single, Bedsitter, Studio, 1 bedroom, 2 bedroom, 3 bedroom, 4 bedroom.

### Prices that fill in by themselves
On the Control Panel, **Edit prices** lets you set the monthly rent per house type for a property, and optionally a different price for a specific floor (a floor price wins). When you add a house, or add a tenant and change the house type, the rent fills in from this list once property, type and floor are known. You can still type a different rent. Tick "update vacant houses" to re-price empty houses to match.

### Phone numbers
Any phone number is accepted when adding a tenant (07xx, 01xx, +254, or international). Only the M-Pesa prompt itself needs a Kenyan line (07xx or 01xx).

### Looking back in time
The calendar rebuilds the Control Panel as of an earlier day (up to 14 days) from payment, invoice and tenancy history. While viewing the past, editing is switched off. Notes: maintenance spend is shown as it had been entered by that day, and the Deposits tile (which has no history) is replaced by "Paid up".

## Quick start

Requirements: Node 20+, PostgreSQL 14+ (or a Neon database).

```bash
cp server/.env.example server/.env     # edit DATABASE_URL, JWT_SECRET, ADMIN_EMAIL, ADMIN_PASSWORD
npm run install:all
npm run migrate                        # creates/upgrades tables (safe to re-run)
npm run seed                           # creates the admin user
npm run dev:server                     # API on http://localhost:3000
npm run dev:web                        # app on http://localhost:5173
```

Production: `npm run build` then `npm start` (the API serves `web/dist`). Put it behind HTTPS.

## Using Neon

1. Create a project at neon.tech and copy the connection string from the dashboard.
2. Put it in `server/.env`:
   ```
   DATABASE_URL=postgresql://USER:PASSWORD@ep-xxxx.REGION.aws.neon.tech/neondb?sslmode=require
   ```
   If Neon adds `&channel_binding=require`, remove it (the `pg` driver does not use it).
3. Run `npm run migrate`. It creates the tables and sets the database time zone (Africa/Nairobi by default, change with `TZ`) so "today" is right.

Notes: the app turns on TLS for Neon hosts automatically, waits up to 20 seconds for the first connection after Neon wakes from idle, and survives dropped idle connections. Either Neon connection string works: the **pooled** one (host contains `-pooler`) or the **direct** one. `btree_gist` and `pgcrypto` are available on Neon and are enabled by the migration. Use a separate Neon branch or database for tests (`TEST_DATABASE_URL`).

### Upgrading from an earlier version
`npm run migrate` upgrades in place: it adds the new house types, price list, deposit and "voided at" columns, and drops the old m² column. Old `maintenance_requests` and `audit_log` tables are no longer used (drop them yourself if you wish).

## How things work

**Adding a tenant** creates the tenant, an open-ended tenancy, sets the house type, records the deposit and issues this month's invoice (never due before move-in).

**Rent status** is live: an unpaid invoice shows as Overdue the moment its due date passes. **Reminders** work for any unpaid rent; if SMS or email is not set up, you are told it could not be delivered.

**Vacating** (all or nothing): details are copied to Archives, the tenancy ends, unpaid invoices are voided (the unpaid amount is kept in the archive), personal details and message history are erased, and the house becomes Vacant. Payment history stays for income figures but is no longer linked to a name. Archives are deleted after 60 days.

**Net income** = rent collected in the month minus the maintenance spend you enter.

### QR payment flow
1. Units > **Payment QR** prints one QR per property (`/p/<slug>`).
2. The tenant picks their house and enters the phone number on their tenancy (rate limited, same error for every failure).
3. They pay the oldest open invoice (full or part) with an M-Pesa prompt.
4. Safaricom calls `POST /api/webhooks/mpesa/<MPESA_WEBHOOK_SECRET>/stk`: stored first (replay-safe), acknowledged, then applied in one database transaction.
5. The Control Panel updates live, a receipt is sent, and the tenant can download a PDF receipt.

### M-Pesa, SMS and email
Set `MPESA_*` (consumer key and secret, shortcode, passkey, a long random `MPESA_WEBHOOK_SECRET`, and a public HTTPS `MPESA_CALLBACK_BASE_URL`), `AT_USERNAME` / `AT_API_KEY` for SMS, and/or `SMTP_*` for email.

## Scheduled jobs (inside the server unless `DISABLE_JOBS=true`)

| Job | When (Africa/Nairobi) | Manual run |
|---|---|---|
| generate-invoices | 1st of month 00:30 | `npm --prefix server run job -- generate-invoices` |
| mark-overdue | daily 00:10 | `... mark-overdue` |
| purge-archives (and logs older than 365 days) | daily 02:00 and at startup | `... purge-archives` |
| send-reminders | daily 08:00 | `... send-reminders` |
| reconcile-pending | every 10 min | `... reconcile-pending` |

## Roles

| Role | Can do |
|---|---|
| admin | everything |
| landlord | everything for properties they own |
| caretaker | view Control Panel, Units and Tenants only |

## Tests

```bash
createdb rent_test
npm test            # server: 34 tests on real PostgreSQL; web: 32 component and design-rule tests
```
**The test database is wiped on every run; never point `TEST_DATABASE_URL` at real data.**

## Known limitations

- **Not tested against live Neon, Daraja or Africa's Talking.** Everything was tested on PostgreSQL 16; Neon is standard PostgreSQL and the connection settings were checked, but run `npm run migrate` against your Neon database first and watch for errors.
- **The visual design was verified by building and mounting every page and by automated style checks (no gradients, no border radius, palette), not by viewing it in a browser or on a phone.** Expect to tweak spacing or colours.
- The calligraphy font (Great Vibes) loads from Google Fonts; offline it falls back to the device's script font.
- The sidebar "Live updates on" indicator was removed. The payments feed on the Control Panel still updates live.
- There is no screen for recording cash or bank payments (the API `POST /api/transactions/manual` exists). A tenant who pays cash still shows as unpaid until you add one.
- Activity logs keep tenant names (deleted after 365 days). WhatsApp reminders are not implemented.
- Daraja does not sign callbacks; protection is the secret URL path plus a replay table.
- Staff sessions are a single 8-hour token (no refresh token or 2FA yet). No late fees or rent proration.
