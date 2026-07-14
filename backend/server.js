// ---------------------------------------------------------------------------
// Restaurant BACKEND
// ---------------------------------------------------------------------------
// A tiny Express server that owns the *shared* state of the app so that every
// open browser tab (customer + staff + owner) sees the same live data.
//
//   * REST endpoints let a tab READ the full state and WRITE a resource.
//   * A Server-Sent Events (SSE) stream at /api/events PUSHES the latest state
//     to every connected tab the instant anything changes. That is what makes
//     a customer's new order pop up on the staff tab in real time (and the
//     staff's status change show up on the customer tab), even across 2 tabs.
//
// State is persisted to backend/data.json so it survives a server restart.
// ---------------------------------------------------------------------------

import express from 'express';
import cors from 'cors';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SEED } from './seed.js';
import { fetchMenuFromSheet } from './menu-sheet.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.join(__dirname, 'data.json');
const PORT = process.env.PORT || 3001;

// The resources a client is allowed to read/replace.
const RESOURCES = ['orders', 'menu', 'stock', 'staff', 'settings'];

// --- Load / persist state ---------------------------------------------------
let state;
try {
  state = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
  // Make sure every expected key exists (in case seed.js gained new fields).
  for (const key of RESOURCES) {
    if (!(key in state)) state[key] = SEED[key];
  }
  console.log('[backend] Loaded existing state from data.json');
} catch {
  state = structuredClone(SEED);
  console.log('[backend] No data.json found — seeding fresh state');
}

function persist() {
  fs.writeFile(DATA_FILE, JSON.stringify(state, null, 2), (err) => {
    if (err) console.error('[backend] Failed to write data.json:', err);
  });
}
persist();

// --- Real-time (SSE) broadcasting ------------------------------------------
const clients = new Set();

function broadcast() {
  const payload = `event: state\ndata: ${JSON.stringify(state)}\n\n`;
  for (const res of clients) res.write(payload);
}

// --- Live menu sync from the published Google Sheet ------------------------
// Pull the latest menu from the sheet and adopt it as the source of truth,
// while preserving any per-item "available" toggles the owner set locally.
async function syncMenuFromSheet() {
  const sheetMenu = await fetchMenuFromSheet();
  const prevAvailById = new Map((state.menu || []).map((m) => [m.id, m.available]));
  state.menu = sheetMenu.map((item) =>
    prevAvailById.has(item.id)
      ? { ...item, available: prevAvailById.get(item.id) }
      : item
  );
  persist();
  return state.menu.length;
}

// --- App --------------------------------------------------------------------
const app = express();
app.use(cors());
app.use(express.json({ limit: '5mb' }));

// Full snapshot of the shared state.
app.get('/api/state', (_req, res) => {
  res.json(state);
});

// Live stream: sends the current state on connect, then again on every change.
app.get('/api/events', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.write(`event: state\ndata: ${JSON.stringify(state)}\n\n`);
  // Comment ping keeps proxies/browsers from closing an idle connection.
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);

  clients.add(res);
  req.on('close', () => {
    clearInterval(ping);
    clients.delete(res);
  });
});

// Replace a single resource (orders / menu / stock / staff / settings), then
// tell everyone about the new state.
app.put('/api/:resource', (req, res) => {
  const { resource } = req.params;
  if (!RESOURCES.includes(resource)) {
    return res.status(404).json({ error: `Unknown resource: ${resource}` });
  }
  state[resource] = req.body;
  persist();
  broadcast();
  res.json({ ok: true });
});

// Manually re-pull the menu from the Google Sheet (e.g. after the owner edits
// the sheet). Broadcasts the refreshed menu to every open tab.
app.post('/api/menu/refresh', async (_req, res) => {
  try {
    const count = await syncMenuFromSheet();
    broadcast();
    console.log(`[backend] Menu refreshed from sheet (${count} items)`);
    res.json({ ok: true, count });
  } catch (err) {
    console.error('[backend] Menu refresh from sheet failed:', err.message);
    res.status(502).json({ ok: false, error: err.message });
  }
});

const server = app.listen(PORT, () => {
  console.log(`[backend] API + real-time server running on http://localhost:${PORT}`);

  // Sync the menu from the live Google Sheet on startup. If the network is
  // down the app keeps running on the last-known (seed/persisted) menu.
  syncMenuFromSheet()
    .then((count) => {
      broadcast();
      console.log(`[backend] Menu synced from Google Sheet (${count} items)`);
    })
    .catch((err) =>
      console.warn(`[backend] Could not sync menu from sheet — using stored menu. (${err.message})`)
    );
});

// If the port is still held by a leftover process, explain how to fix it
// instead of dumping a raw stack trace.
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(
      `\n[backend] Port ${PORT} is already in use — an old server is probably still running.\n` +
      `          Close it, or on Windows run:  taskkill /F /IM node.exe\n` +
      `          Then run "npm run dev" again.\n`
    );
    process.exit(1);
  }
  throw err;
});
