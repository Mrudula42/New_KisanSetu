# KisanSetu local setup

This folder retains the original Hatchable implementation (`api/`, `pages/`,
`migrations/`, root `seed.sql`, and `hatchable.toml`) alongside the local
Express/MySQL backend. The hosted Hatchable application is separate and is not
changed by these local instructions.

## Requirements

- Windows 10/11
- Node.js 20 or newer and npm
- VS Code Live Server extension
- MySQL Server 8.0 running as a Windows service

## Start the backend

In a VS Code PowerShell terminal:

```powershell
Set-Location 'C:\Users\kalem\Downloads\KisanSetu-main\KisanSetu-main\backend'
npm ci
npm run dev
```

The API listens on `http://localhost:3000`. `npm ci` is needed once after
installing or restoring dependencies; later starts need only `npm run dev`.
Check that MySQL is available with:

```powershell
Invoke-RestMethod 'http://localhost:3000/api/health'
```

Expected response: `status=ok`, `database=connected`.

## Start the frontend with Live Server

Open the outer workspace folder
`C:\Users\kalem\Downloads\KisanSetu-main` in VS Code. Its `.vscode/settings.json`
configures Live Server to serve the nested `KisanSetu-main\public` folder, bind
to `localhost`, and use port `5500`. Open
`KisanSetu-main\public\index.html` and select **Go Live** (or use the status
bar’s **Go Live** button). If Live Server was already running before this
configuration was added, select **Go Offline** and then **Go Live** again so it
reloads the configured web root.

- Farmer interface: `http://localhost:5500/`
- Administrator interface: `http://localhost:5500/admin`
- Sign in: `http://localhost:5500/login`

The frontend sends API requests directly to `http://localhost:3000`, includes
the session cookie, and the backend only permits browser requests from the
configured Live Server origin, `http://localhost:5500`. Keep `localhost`
consistent in both URLs; do not substitute `127.0.0.1` for one of them because
browser cookies are host-specific.

The Live Server folder route at `/admin` loads `public/admin/index.html`.
`/login` resolves through `public/login/index.html` to the existing login page.
`local_preview_server.py` is not required for this setup.

## Verify API connectivity and CORS

With the backend and Live Server running, run these checks in PowerShell:

```powershell
Invoke-RestMethod 'http://localhost:3000/api/health'
Invoke-WebRequest 'http://localhost:5500/' -UseBasicParsing
Invoke-WebRequest 'http://localhost:5500/admin' -UseBasicParsing
Invoke-WebRequest 'http://localhost:5500/api-config.js' -UseBasicParsing
curl.exe -i -X OPTIONS 'http://localhost:3000/api/auth/login' -H 'Origin: http://localhost:5500' -H 'Access-Control-Request-Method: POST' -H 'Access-Control-Request-Headers: content-type'
```

The first response must report a connected database. The three frontend
requests should return HTTP 200 and the CORS preflight should allow origin
`http://localhost:5500` and credentials. An unauthenticated request to a
protected API such as `/api/centres` correctly returns HTTP 401; sign in through
the frontend to test farmer APIs. Admin APIs remain restricted to `ADMIN`
accounts.

## Database and credentials

The local backend reads `backend/.env`. Its existing private development
configuration is preserved; do not display or share its passwords. If that
file is missing, copy `backend/.env.example` to `backend/.env` and configure a
least-privilege local MySQL account.

`database/schema.sql` defines the MySQL schema; `database/seed.sql` inserts
sample centres. Do not run either file against a database containing records
unless you explicitly intend to apply those statements. Starting the app does
not reset or reseed the database.

## Local administrator

New registrations are `FARMER` accounts. To create or reset a local
administrator, use the development-only secure prompt:

```powershell
Set-Location 'C:\Users\kalem\Downloads\KisanSetu-main\KisanSetu-main\backend'
npm run admin:setup
```

It requires `NODE_ENV=development`, asks for confirmation, hides password
input, hashes it with bcrypt, and revokes that account's existing sessions.
Admin routes continue to require the `ADMIN` role.

## Retained Hatchable source

The original Hatchable API handlers in `api/`, route in `pages/`, PostgreSQL
migration in `migrations/`, root `seed.sql`, and `hatchable.toml` are retained
for reference. The local Express server uses `backend/src/` and the MySQL
schema under `database/`; it does not execute the Hatchable handlers.
