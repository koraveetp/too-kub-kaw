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
// The MENU is read from PostgreSQL (see menu-db.js). The rest of the shared
// state (orders / stock / staff / settings) is persisted to backend/data.json
// so it survives a server restart.
//
// SECURITY MODEL
//   * /api/state and /api/events are public reads, but staff credentials are
//     stripped before they ever leave the server (see sanitizeState).
//   * Passwords are stored hashed (scrypt); plaintext is never persisted.
//   * POST /api/login verifies a password and returns a signed session token.
//   * Writing menu / staff / settings requires a valid staff token.
//   * Writing `orders` and `stock` is intentionally public — placing an order
//     from an unauthenticated customer tab both appends an order and decrements
//     stock — but the payloads are validated and size-capped. (Making these
//     fully server-authoritative would be the next hardening step.)
//   * CORS is restricted to configured origins.
// ---------------------------------------------------------------------------

import express from 'express';
import cors from 'cors';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SEED } from './seed.js';
import { fetchMenuFromDb } from './menu-db.js';
import { hashPassword, verifyPassword, isHashed, signToken, verifyToken } from './auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.join(__dirname, 'data.json');
const PORT = process.env.PORT || 3001;

// The menu now lives in PostgreSQL. Warn loudly if it is not configured, but
// keep running on the last-known (seed/persisted) menu so the rest of the app
// still works while someone fixes the connection string.
const HAS_DB = !!(process.env.DATABASE_URL || '').trim();
if (!HAS_DB) {
  console.warn(
    '[backend] DATABASE_URL is not set — the menu cannot be loaded from the ' +
    'database. Add it to backend/.env, e.g. ' +
    'postgres://USER:PASSWORD@localhost:5432/restaurant'
  );
}

// The resources a client is allowed to read/replace.
const RESOURCES = ['orders', 'menu', 'stock', 'staff', 'settings'];
// Writing any of these requires a valid staff session token. `orders` and
// `stock` are left out on purpose: an unauthenticated customer placing an order
// appends an order AND decrements stock from the browser.
const PROTECTED_RESOURCES = new Set(['menu', 'staff', 'settings']);

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

// One-time migration: any staff account still holding a plaintext `pass` gets
// its password hashed and the plaintext dropped, so credentials never sit on
// disk (or get served to a browser) in the clear again.
function migrateStaffPasswords() {
  let changed = false;
  for (const s of state.staff || []) {
    if (s && s.pass !== undefined) {
      if (s.pass && !isHashed(s.pass)) s.passHash = hashPassword(s.pass);
      delete s.pass;
      changed = true;
    }
  }
  if (changed) {
    console.log('[backend] Migrated plaintext staff passwords to scrypt hashes');
  }
}
migrateStaffPasswords();

function persist() {
  fs.writeFile(DATA_FILE, JSON.stringify(state, null, 2), (err) => {
    if (err) console.error('[backend] Failed to write data.json:', err);
  });
}
persist();

// A copy of the state that is safe to send to a browser: staff objects keep
// their username and display name but never their password hash.
function sanitizeState(s) {
  return {
    ...s,
    staff: (s.staff || []).map(({ passHash, pass, ...rest }) => rest),
  };
}

// --- Real-time (SSE) broadcasting ------------------------------------------
const clients = new Set();

function broadcast() {
  const payload = `event: state\ndata: ${JSON.stringify(sanitizeState(state))}\n\n`;
  for (const res of clients) res.write(payload);
}

// --- Live menu sync from PostgreSQL ----------------------------------------
// Pull the latest menu and adopt it as the source of truth for the DAY menu,
// which the database owns in full (food, drinks and desserts alike). Anything
// the database does not carry — the hand-curated night menu — is kept as-is.
//
// Scoping by theme rather than by category matters: categories can be renamed
// at any time, and a category-based rule would strand items under the old name
// as undeletable duplicates.
//
// Per-item "available" toggles set by the owner in the app survive a sync,
// keyed by the item's stable id.
async function syncMenuFromDb() {
  const { menu: dbMenu, addons: dbAddons, choices: dbChoices } = await fetchMenuFromDb();
  const prevAvailById = new Map((state.menu || []).map((m) => [m.id, m.available]));
  const manualItems = (state.menu || []).filter((m) => m.theme !== 'day');
  const nextMenu = [
    ...dbMenu.map((item) =>
      prevAvailById.has(item.id)
        ? { ...item, available: prevAvailById.get(item.id) }
        : item
    ),
    ...manualItems,
  ];
  // The database owns the day-time extras; the night bar's are curated in-app.
  const nextAddons = { ...(state.addons || {}), ...dbAddons };
  const nextChoices = { ...(state.choices || {}), ...dbChoices };

  // Only touch state when something actually differs, so the poll below stays
  // silent (no disk write, no SSE push) while the database is untouched.
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

// Re-pull the database on a timer so an edit made directly in Postgres (e.g. in
// pgAdmin) reaches every open tab on its own. A local DB query is cheap, so a
// short interval is fine here.
const SYNC_INTERVAL_SEC = Number(process.env.MENU_SYNC_INTERVAL_SECONDS || 30);

function startMenuPolling() {
  if (!HAS_DB || !(SYNC_INTERVAL_SEC > 0)) {
    console.log('[backend] Menu auto-sync disabled');
    return;
  }
  let running = false; // never let a slow query overlap itself
  setInterval(async () => {
    if (running) return;
    running = true;
    try {
      const { count, changed } = await syncMenuFromDb();
      if (changed) {
        broadcast();
        console.log(`[backend] Database changed — menu updated (${count} items)`);
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
}

// --- App --------------------------------------------------------------------
const app = express();
app.disable('x-powered-by');

// CORS: only allow the origins we expect the app to be served from. Configure
// extra ones (e.g. your deployed URL) via ALLOWED_ORIGINS, comma-separated.
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ||
  'http://localhost:5173,http://127.0.0.1:5173,http://localhost:3000,http://127.0.0.1:3000')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

app.use(cors({
  origin(origin, cb) {
    // Same-origin / curl / server-to-server requests have no Origin header.
    if (!origin || ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    cb(new Error(`Origin not allowed by CORS: ${origin}`));
  },
}));

// Minimal security headers (avoids pulling in helmet as a dependency).
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});

app.use(express.json({ limit: '2mb' }));

// --- Auth helpers -----------------------------------------------------------

// Pull "Authorization: Bearer <token>" off a request and verify it. Returns the
// token payload ({ user, exp }) or null.
function getSession(req) {
  const header = req.get('authorization') || '';
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match) return null;
  return verifyToken(match[1]);
}

function requireAuth(req, res, next) {
  const session = getSession(req);
  if (!session) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  req.session = session;
  next();
}

// Very small in-memory rate limiter for the login endpoint, so the password
// hash can't be brute-forced from a single IP. Not a substitute for a real
// WAF, but stops the trivial case.
const loginAttempts = new Map(); // ip -> { count, first }
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 10;

function loginRateLimited(ip) {
  const now = Date.now();
  const rec = loginAttempts.get(ip);
  if (!rec || now - rec.first > LOGIN_WINDOW_MS) {
    loginAttempts.set(ip, { count: 1, first: now });
    return false;
  }
  rec.count += 1;
  return rec.count > LOGIN_MAX_ATTEMPTS;
}

// --- Routes -----------------------------------------------------------------

// Full snapshot of the shared state (credentials stripped).
app.get('/api/state', (_req, res) => {
  res.json(sanitizeState(state));
});

// Live stream: sends the current state on connect, then again on every change.
app.get('/api/events', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.write(`event: state\ndata: ${JSON.stringify(sanitizeState(state))}\n\n`);
  // Comment ping keeps proxies/browsers from closing an idle connection.
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);

  clients.add(res);
  req.on('close', () => {
    clearInterval(ping);
    clients.delete(res);
  });
});

// Staff login. Verifies the password against the stored hash and, on success,
// returns a signed session token plus the staff member's public profile.
app.post('/api/login', (req, res) => {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  if (loginRateLimited(ip)) {
    return res.status(429).json({ error: 'Too many attempts. Try again later.' });
  }

  const user = String(req.body?.user || '').trim();
  const pass = String(req.body?.pass || '');
  const account = (state.staff || []).find((s) => s.user === user);

  // Always run a verify (even for an unknown user) to avoid leaking which
  // usernames exist via response timing.
  const ok = account
    ? verifyPassword(pass, account.passHash)
    : verifyPassword(pass, 'scrypt$0$00');

  if (!ok || !account) {
    return res.status(401).json({ error: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' });
  }

  const token = signToken({ user: account.user });
  res.json({ token, user: account.user, name: account.name });
});

// Reduce the incoming staff array to safe, hashed records. New accounts must
// carry a plaintext `pass`; existing accounts (which arrive without one, since
// the served state omits it) keep their stored hash. Throws on invalid input.
function normalizeStaffWrite(incoming) {
  if (!Array.isArray(incoming)) throw new Error('staff must be an array');
  const existingByUser = new Map((state.staff || []).map((s) => [s.user, s]));
  const out = [];
  for (const raw of incoming) {
    const user = String(raw?.user || '').trim();
    const name = String(raw?.name || '').trim() || user;
    if (!user) throw new Error('every staff member needs a username');

    let passHash;
    if (raw.pass) {
      passHash = hashPassword(String(raw.pass));           // new / changed password
    } else if (isHashed(raw.passHash)) {
      passHash = raw.passHash;                             // client echoed a hash
    } else {
      passHash = existingByUser.get(user)?.passHash;       // preserve stored hash
    }
    if (!passHash) throw new Error(`account "${user}" has no password set`);

    out.push({ user, name, passHash });
  }
  if (!out.length) throw new Error('at least one staff account is required');
  return out;
}

// Lightweight shape/size checks so a public `orders` write (or a buggy client)
// can't corrupt the store or blow up memory.
function validateResourceBody(resource, body) {
  switch (resource) {
    case 'orders':
      if (!Array.isArray(body)) return 'orders must be an array';
      if (body.length > 5000) return 'too many orders';
      if (!body.every((o) => o && typeof o === 'object' && !Array.isArray(o))) {
        return 'each order must be an object';
      }
      return null;
    case 'menu':
      return Array.isArray(body) ? null : 'menu must be an array';
    case 'stock':
    case 'settings':
      return body && typeof body === 'object' && !Array.isArray(body)
        ? null : `${resource} must be an object`;
    default:
      return null;
  }
}

// Replace a single resource, then tell everyone about the new state.
// Protected resources (menu/stock/staff/settings) require a valid session;
// `orders` is public so customers can place them.
app.put('/api/:resource', (req, res) => {
  const { resource } = req.params;
  if (!RESOURCES.includes(resource)) {
    return res.status(404).json({ error: `Unknown resource: ${resource}` });
  }

  if (PROTECTED_RESOURCES.has(resource) && !getSession(req)) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  if (resource === 'staff') {
    try {
      state.staff = normalizeStaffWrite(req.body);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  } else {
    const problem = validateResourceBody(resource, req.body);
    if (problem) return res.status(400).json({ error: problem });
    state[resource] = req.body;
  }

  persist();
  broadcast();
  res.json({ ok: true });
});

// Manually re-pull the menu from the database (e.g. after editing it directly
// in pgAdmin). Staff-only. Broadcasts the refreshed menu to every open tab.
app.post('/api/menu/refresh', requireAuth, async (_req, res) => {
  try {
    const { count, changed } = await syncMenuFromDb();
    if (changed) broadcast();
    console.log(`[backend] Menu refreshed from database (${count} items, ${changed ? 'updated' : 'no change'})`);
    res.json({ ok: true, count, changed });
  } catch (err) {
    console.error('[backend] Menu refresh from database failed:', err.message);
    res.status(502).json({ ok: false, error: err.message });
  }
});

// Central error handler: turn a rejected CORS origin or malformed JSON body
// into a clean status code, and never leak a stack trace to the client.
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  if (/Origin not allowed/.test(err.message || '')) {
    return res.status(403).json({ error: 'Origin not allowed' });
  }
  if (err.type === 'entity.parse.failed' || err instanceof SyntaxError) {
    return res.status(400).json({ error: 'Invalid JSON body' });
  }
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Payload too large' });
  }
  console.error('[backend] Unhandled error:', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

const server = app.listen(PORT, () => {
  console.log(`[backend] API + real-time server running on http://localhost:${PORT}`);

  // Sync the menu from PostgreSQL on startup. If the DB is unreachable the app
  // keeps running on the last-known (seed/persisted) menu.
  if (HAS_DB) {
    syncMenuFromDb()
      .then(({ count }) => {
        broadcast();
        console.log(`[backend] Menu synced from PostgreSQL (${count} items)`);
      })
      .catch((err) =>
        console.warn(`[backend] Could not sync menu from PostgreSQL — using stored menu. (${err.message})`)
      )
      // Poll regardless of how the first sync went: the DB may recover.
      .finally(startMenuPolling);
  }
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
