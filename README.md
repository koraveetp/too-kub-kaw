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
    ├── server.js            REST API + real-time Server-Sent Events
    ├── menu-sheet.js        pulls the live menu from the Google Sheet (CSV)
    ├── seed.js              default menu/stock/staff/settings
    └── data.json            live saved state (auto-created, git-ignored)
```

## Menu comes from a Google Sheet

The menu is driven by a **published Google Sheet** (columns: `หมวดหมู่`,
`ชื่อรายการ`, `ราคา (บาท)`). On startup the backend fetches that sheet's CSV
(`backend/menu-sheet.js`) and adopts it as the menu, preserving any per-item
"available" toggles staff/owner set locally. If the network is down it falls
back to the baked-in copy in `seed.js`.

After editing the sheet, pull the changes without restarting:

```bash
curl -X POST http://localhost:3001/api/menu/refresh
```

The refreshed menu is broadcast to every open tab in real time. To point at a
different sheet, change `SHEET_CSV_URL` in `backend/menu-sheet.js`.

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

# start the backend and the frontend together
npm run dev
```

Then open the app at **http://localhost:5173**.
The backend API runs at **http://localhost:3001**.

To see cross-tab sync: open http://localhost:5173 in two tabs, switch one to the
staff panel (login `admin` / `1234`), place an order from the other as a
customer, and watch it appear on the staff tab.

### Other scripts

| Command         | What it does                                  |
| --------------- | --------------------------------------------- |
| `npm run dev`   | Runs backend + frontend together (for dev)    |
| `npm run build` | Builds the frontend for production            |
| `npm run start` | Runs only the backend                         |
| `npm run setup` | Installs all dependencies (root/backend/front)|
