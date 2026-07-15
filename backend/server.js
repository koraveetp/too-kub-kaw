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

// --- Live menu sync from the Google Sheet (via Apps Script) ----------------
// Pull the latest menu and adopt it as the source of truth for the DAY menu,
// which the sheet owns in full (food, drinks and desserts alike). Anything the
// sheet does not carry — the hand-curated night menu — is kept as-is.
//
// Scoping by theme rather than by category matters: the sheet's categories can
// be renamed by the owner at any time, and a category-based rule would strand
// items under the old name as undeletable duplicates.
//
// Per-item "available" toggles set by the owner in the app survive a sync,
// keyed by the item's stable id.
async function syncMenuFromSheet() {
  const { menu: sheetMenu, addons: sheetAddons, choices: sheetChoices } = await fetchMenuFromSheet();
  const prevAvailById = new Map((state.menu || []).map((m) => [m.id, m.available]));
  const manualItems = (state.menu || []).filter((m) => m.theme !== 'day');
  const nextMenu = [
    ...sheetMenu.map((item) =>
      prevAvailById.has(item.id)
        ? { ...item, available: prevAvailById.get(item.id) }
        : item
    ),
    ...manualItems,
  ];
  // The sheet owns the day-time extras; the night bar's are curated in the app.
  const nextAddons = { ...(state.addons || {}), ...sheetAddons };
  const nextChoices = { ...(state.choices || {}), ...sheetChoices };

  // Only touch state when something actually differs, so the poll below stays
  // silent (no disk write, no SSE push) while the sheet is untouched.
  const changed =
    JSON.stringify(state.menu) !== JSON.stringify(nextMenu) ||
    JSON.stringify(state.addons) !== JSON.stringify(nextAddons) ||
    JSON.stringify(state.choices) !== JSON.stringify(nextChoices);
  if (changed) {
    state.menu = nextMenu;
    state.addons = nextAddons;
    state.choices = nextChoices;
    persist();
  }
  return { count: nextMenu.length, changed };
}

// Re-pull the sheet on a timer so an edit in Google Sheets reaches every open
// tab on its own.
//
// A word on the interval: one round-trip to Apps Script measures ~4.6s, so at
// MENU_SYNC_INTERVAL_SECONDS=5 the backend is calling Google essentially
// non-stop. Each request also burns ~4.6s of Apps Script *runtime* quota
// (90 min/day on a consumer account, 6 h/day on Workspace), which a 5s poll
// exhausts in roughly 1-2 hours — after which the sheet stops loading for the
// rest of the day. Fine for a demo or while editing the sheet; raise it to 60+
// for anything long-running.
const SYNC_INTERVAL_SEC = Number(process.env.MENU_SYNC_INTERVAL_SECONDS || 60);

function startMenuPolling() {
  if (!(SYNC_INTERVAL_SEC > 0)) {
    console.log('[backend] Menu auto-sync disabled (MENU_SYNC_INTERVAL_SECONDS=0)');
    return;
  }
  let running = false; // never let a slow sheet overlap itself
  setInterval(async () => {
    if (running) return;
    running = true;
    try {
      const { count, changed } = await syncMenuFromSheet();
      if (changed) {
        broadcast();
        console.log(`[backend] Sheet changed — menu updated (${count} items)`);
      }
    } catch (err) {
      // A transient failure is not fatal: the last-known menu stays live and
      // the next tick will try again.
      console.warn(`[backend] Menu auto-sync failed, keeping current menu. (${err.message})`);
    } finally {
      running = false;
    }
  }, SYNC_INTERVAL_SEC * 1000);
  console.log(`[backend] Menu auto-sync every ${SYNC_INTERVAL_SEC}s`);
  if (SYNC_INTERVAL_SEC < 30) {
    console.warn(
      `[backend] Note: a ${SYNC_INTERVAL_SEC}s interval calls Apps Script ~${Math.round(3600 / SYNC_INTERVAL_SEC)}x/hour ` +
      `(~4.6s each). Expect to hit Google's daily script-runtime quota in a few hours; ` +
      `set MENU_SYNC_INTERVAL_SECONDS=60 for long runs.`
    );
  }
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
    const { count, changed } = await syncMenuFromSheet();
    if (changed) broadcast();
    console.log(`[backend] Menu refreshed from sheet (${count} items, ${changed ? 'updated' : 'no change'})`);
    res.json({ ok: true, count, changed });
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
    .then(({ count }) => {
      broadcast();
      console.log(`[backend] Menu synced from Google Sheet (${count} items)`);
    })
    .catch((err) =>
      console.warn(`[backend] Could not sync menu from sheet — using stored menu. (${err.message})`)
    )
    // Poll regardless of how the first sync went: the network may recover.
    .finally(startMenuPolling);
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
