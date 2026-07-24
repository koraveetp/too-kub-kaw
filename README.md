# Restaurant App

A restaurant ordering system with a **customer** view, a **staff** view, and an
**owner** view. All open tabs (on the same machine/network) share live data
through a small backend, so an order placed on a customer tab shows up on the
staff tab instantly — and a status change by staff shows up for the customer.

## Where is the frontend vs. the backend?

```
Restaurant/
├── package.json        ← run BOTH with one command (npm run dev)
│
├── frontend/           ← FRONTEND  (React + Vite, the UI in the browser)
│   ├── src/
│   │   ├── App.jsx           app shell + shared-state wiring
│   │   ├── api.js            talks to the backend (REST + live SSE stream)
│   │   └── components/       CustomerView / StaffView / OwnerView
│   └── vite.config.js        proxies "/api" → backend
│
└── backend/            ← BACKEND  (Node + Express, the shared server)
    ├── server.js            REST API + real-time Server-Sent Events + auth
    ├── menu-db.js           reads the live menu from PostgreSQL
    ├── menu-transform.js    maps DB rows → the app's menu shape
    ├── auth.js              password hashing + signed session tokens
    ├── seed.js              default menu/stock/staff/settings
    └── data.json            live saved state (auto-created, git-ignored)
```

## Menu comes from PostgreSQL

The menu is driven by a **PostgreSQL** `menu_items` table (columns: `หมวดหมู่`,
`ชื่อรายการ`, `ราคา (บาท)`, …). Create it with `menu_schema.sql` and import the
CSV (see the comments in that file). On startup — and every
`MENU_SYNC_INTERVAL_SECONDS` — the backend reads the table
(`backend/menu-db.js`) and adopts it as the menu, preserving any per-item
"available" toggles staff/owner set locally. If the DB is unreachable it keeps
the last-known menu from `data.json`/`seed.js`.

Set the connection string in `backend/.env` (copy `backend/.env.example`):

```
DATABASE_URL=postgres://USER:PASSWORD@localhost:5432/restaurant
```

After editing the table directly (e.g. in pgAdmin), pull the changes without
restarting — this is a **staff-only** endpoint, so send your login token:

```bash
curl -X POST http://localhost:3001/api/menu/refresh -H "Authorization: Bearer <token>"
```

The refreshed menu is broadcast to every open tab in real time.

## Roles & access

Each person sees exactly one panel — there is no in-app switcher:

- **Customer** — reaches the menu *only* by scanning a table QR. Opening the
  plain site URL never shows the menu; it shows the login page. Tables are
  numbered 1–9. Three link shapes decide the shift:
  - `?table-day=N` — table N, **locked to the day** storefront
  - `?table-night=N` — table N, **locked to the night** bar
  - `?table=N` — table N, shift decided by the **clock** at scan time

  The staff **QR Code** tab prints a day *and* a night QR for every table.
- **Staff** (`role: 'staff'`) — logs in and lands on the shift board for their
  `shop` (`day` / `night`). Cannot reach the customer or owner views.
- **Owner** (`role: 'owner'`) — logs in and lands on the back-office board.

Login accounts carry a `role` (`owner` | `staff`) and a `shop` (`day` |
`night`). `POST /api/login` returns both so the frontend routes straight to the
right panel.

### Test accounts (all password `1234`)

| Username | Role  | Shop  | Lands on            |
| -------- | ----- | ----- | ------------------- |
| `admin`  | owner | day   | Owner back office   |
| `day`    | staff | day   | Day shift board     |
| `night`  | staff | night | Night shift board   |
| `cook`   | staff | day   | Day shift board (ครัว) |

## Security

- **Passwords are hashed** (scrypt) — plaintext is never stored or sent to a
  browser. `GET /api/state` strips staff credentials before responding.
- **Login is server-side**: `POST /api/login` verifies the password and returns
  a signed session token (carrying `role`/`shop`). The frontend sends it as a
  `Bearer` token.
- **Management writes require that token**: `PUT /api/menu`, `/api/staff`, and
  `/api/settings` reject unauthenticated requests. `orders` and `stock` stay
  public because unauthenticated customers place orders (and that decrements
  stock) — those payloads are validated and size-capped.
- **Owner-only writes are role-gated**: editing staff accounts, shop settings,
  expenses, and the manual timeclock/payroll endpoints require an `owner`
  session (re-checked against the live record), so a plain staff token gets 403.
- **CORS** is limited to `ALLOWED_ORIGINS` (defaults to the local dev ports).
- Set a stable **`AUTH_SECRET`** in `backend/.env` so sessions survive restarts.

- **Frontend** = everything the user sees. It renders the UI and, whenever
  something changes, sends it to the backend and listens for updates.
- **Backend** = the single source of truth. It stores orders/menu/stock/etc.,
  saves them to `data.json`, and **broadcasts every change to all connected
  tabs** so they stay in sync in real time.

## How the two tabs communicate

1. A tab loads the current state from `GET /api/state`.
2. It opens a live stream: `GET /api/events` (Server-Sent Events).
3. When any tab changes something, it does `PUT /api/<resource>` (e.g.
   `orders`). The backend saves it and **pushes the new state to every open
   stream**, so all other tabs update immediately — no refresh needed.

Per-tab preferences (theme, current role, table number, login session) stay in
that tab's `localStorage` and are intentionally **not** shared.

## Running it

```bash
# first time only: install dependencies for root + backend + frontend
npm run setup

# configure the backend: copy the example env and fill in DATABASE_URL + AUTH_SECRET
cp backend/.env.example backend/.env

# start the backend and the frontend together
npm run dev
```

Then open the app at **http://localhost:5173**.
The backend API runs at **http://localhost:3001**.

To see cross-tab sync: open the staff board in one tab
(http://localhost:5173, log in as `day` / `1234`), open a customer table in
another (http://localhost:5173/?table=1), place an order there, and watch it
appear on the staff tab.

### Other scripts

| Command         | What it does                                  |
| --------------- | --------------------------------------------- |
| `npm run dev`   | Runs backend + frontend together (for dev)    |
| `npm run build` | Builds the frontend for production            |
| `npm run start` | Runs only the backend                         |
| `npm run setup` | Installs all dependencies (root/backend/front)|
