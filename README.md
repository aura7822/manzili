
## REAL ESTATE MANAGEMENT IS NOW FLEXIBLE WITH : MANZILI®

### RELEASE NOTES 

Release Version: v3.4.5-patch 3

Release Date: November 7, 2026

Release Enviroment : Nightly Build

Running: Node.js 20+ | PostgreSQL 14+ + Neon DB  | render | netlify

Software Type : Opensource

<div align = 'center'>

[![Netlify](https://img.shields.io/badge/Netlify-%23000000.svg?logo=netlify&logoColor=#00C7B7)](#)
[![Render](https://img.shields.io/badge/Render-46E3B7?logo=render&logoColor=000)](#)
[![Neovim](https://img.shields.io/badge/Neovim-57A143?logo=neovim&logoColor=fff)](#)
[![Postgres](https://img.shields.io/badge/Postgres-%23316192.svg?logo=postgresql&logoColor=white)](#)
[![Vue.js](https://img.shields.io/badge/Vue.js-4FC08D?logo=vuedotjs&logoColor=fff)](#)</div>

### 🕷 BUGS CLOBBERED

Hardened CORS middleware handshake protocols satisfying origin whitelisting

Specified URI ```/api``` prefix in login page tackling upstream proxy bugs

Duplicate email turndown - friendly conflict response

Updated VITE_API_BASE_URL variable including the /api path for both ```render``` and ```netlify```

Updated entry point in server.js to shut down server cleanly on SIGINT/ SIGTERM

### PATCHES

Priviledge inception by refining onboarding pipelines 4 authenticated signups

Explicit CRUD ops and tweaks for property && tenants parameter aggregates

ln10 scaffolding - Swahili linguistic telementary [experimental]

Logic runtime flow revision

<div align = 'center'>

### TESTS

<table><tr><td><strong>PASSED</strong></td><td><strong>FAILED</strong></td></tr><tr><td><strong>38</strong></td><td><strong>0</strong></td></tr></table></div>

### MIGRATION

<div align='center'>

<table><tr><td>🛈 Docker is now deprecated for this software due to linux kernel-driver compatibility conflicts , resolution  queued</td></tr></table>
<table><tr><td>🛈 Utilise the Netlify link for full access[Recommended] for contriutions/local execution do : </td></tr></table></div>

```linux
git clone git@github.com:aura7822/manzili.git

cd manzili

chmod +x neon.sh # installs and configures postgress + neon and syncs databases, same for neon.pssc

./neon.sh # or ./neon.pssc for powershell
```
For windows, execute in power shell and run the ```neon.pssc``` script


### DB MIGRATIONS && WEB BOOTING


```bash
cp server/.env.example server/.env     # edit DATABASE_URL, JWT_SECRET, ADMIN_EMAIL, ADMIN_PASSWORD
pnpm run install:all
pnpm run migrate                        # creates/upgrades tables (safe to re-run)
pnpm run seed                           # creates the admin user
pnpm run dev:server                     # API on http://localhost:3000
pnpm run dev:web                        # app on http://localhost:5173
```



##  Neon Setup

1. Create a project at neon.tech and copy the connection string from the dashboard.
2. Put it in `server/.env`:
   ```
   DATABASE_URL=postgresql://USER:PASSWORD@ep-xxxx.REGION.aws.neon.tech/neondb?sslmode=require
   ```
   If Neon adds `&channel_binding=require`, remove it (the `pg` driver does not use it).
3. Run `npm run migrate`. It creates the tables and sets the database time zone (Africa/Nairobi by default, change with `TZ`) so "today" is right.
<div align='center'>
<table><tr><td>🛈 Tip : Running Postgres locally insted of neon is also allowed, this is also recommended for executions since at times neon sleeps </td></tr></table></div>


## END OF THIS DOCUMENT!