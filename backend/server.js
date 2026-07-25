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
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { SEED } from './seed.js';
import {
  fetchMenuFromDb,
  fetchMenuOptions,
  setDishAvailability,
  setDishTheme,
  insertMenuItem,
  getDishForEdit,
  updateMenuItem,
  dishIdentityTaken,
  hasAvailableColumn,
} from './menu-db.js';
import { ensureOrdersTable, loadOrders, saveOrders } from './orders-db.js';
import { fetchStockItems, fetchStockAvailability, createStockItem, adjustStockItem, restockAll, consumeStockByName } from './stock-db.js';
import { hashPassword, verifyPassword, isHashed, signToken, verifyToken } from './auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.join(__dirname, 'data.json');
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const PORT = process.env.PORT || 3001;

// Menu photos land here. Created up front so the very first upload has
// somewhere to go on a fresh clone (the folder is gitignored).
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

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
const RESOURCES = ['orders', 'menu', 'stock', 'staff', 'settings', 'expenses', 'timeclock', 'payroll'];
// Writing any of these requires a valid staff session token. `orders` and
// `stock` are left out on purpose: an unauthenticated customer placing an order
// appends an order AND decrements stock from the browser. `expenses` is
// owner-only bookkeeping, so it stays protected.
const PROTECTED_RESOURCES = new Set(['menu', 'staff', 'settings', 'expenses']);
// A stricter subset of the protected resources that only an *owner* may write:
// staff accounts, shop settings, and the owner's expense bookkeeping. A plain
// staff session is rejected with 403.
const OWNER_RESOURCES = new Set(['staff', 'settings', 'expenses']);
// Server-owned resources: readable by everyone via /api/state, but never
// replaceable wholesale through PUT — records are only appended/updated by the
// server's own endpoints, so timestamps can't be forged from a browser.
const SERVER_OWNED_RESOURCES = new Set(['timeclock', 'payroll']);

// --- Staff time clock (ลงเวลาเข้า-ออกงาน) -----------------------------------
// Clocking in/out only works from inside the restaurant: the browser sends its
// GPS position and the server checks it is within TIMECLOCK.radiusM of the
// shop before recording the SERVER's current time (the client clock is never
// trusted). One clock-in + one clock-out per person per day.
const TIMECLOCK = {
  lat: 7.1919729,      // ร้านเรือนเก่า สงขลา (https://maps.app.goo.gl/2w5Cn49iNBAnwqpv8)
  lng: 100.5923647,
  radiusM: 50,
};

// Great-circle distance in metres between two lat/lng points (haversine).
function distanceMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// Local calendar date (YYYY-MM-DD) for "one in + one out per day".
function localDateKey(ts = Date.now()) {
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

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
// The seed predates the time clock, so the resource loop above may have left
// this undefined on both fresh and existing installs.
if (!Array.isArray(state.timeclock)) state.timeclock = [];
// Owner-set "paid / not paid" per staff member per month, keyed "user__YYYY-MM".
if (!state.payroll || typeof state.payroll !== 'object' || Array.isArray(state.payroll)) {
  state.payroll = {};
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

// Rolling backups of data.json. Every persist() snapshots the OUTGOING file
// here before it is replaced, so a bad write (e.g. a stale second server
// instance overwriting good data with an older in-memory copy) is always
// recoverable: the previous good version is sitting in backend/backups.
const BACKUP_DIR = path.join(__dirname, 'backups');
const BACKUP_KEEP = 40; // most recent snapshots to retain; older ones are pruned
fs.mkdirSync(BACKUP_DIR, { recursive: true });

// Copy the current data.json aside, then prune to the newest BACKUP_KEEP files.
// Best-effort: a backup failure must never block or crash the real write.
function backupCurrentData() {
  try {
    if (!fs.existsSync(DATA_FILE)) return; // nothing to snapshot yet (first boot)
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    fs.copyFileSync(DATA_FILE, path.join(BACKUP_DIR, `data-${stamp}.json`));

    const backups = fs
      .readdirSync(BACKUP_DIR)
      .filter((f) => f.startsWith('data-') && f.endsWith('.json'))
      .sort(); // ISO timestamps sort chronologically
    for (const stale of backups.slice(0, -BACKUP_KEEP)) {
      fs.unlinkSync(path.join(BACKUP_DIR, stale));
    }
  } catch (err) {
    console.warn('[backend] Backup snapshot failed (continuing):', err.message);
  }
}

// Write to a temp file first, then rename over the real one. rename() is
// atomic, so a process that dies mid-write leaves data.json either fully old or
// fully new — never the half-written file that JSON.parse rejects on the next
// boot (which silently reseeds and loses the day's orders).
function persist() {
  const tmp = `${DATA_FILE}.tmp`;
  fs.writeFile(tmp, JSON.stringify(state, null, 2), (err) => {
    if (err) return console.error('[backend] Failed to write data.json:', err);
    // Snapshot the current (about-to-be-replaced) file first, so the last good
    // state survives even if this write turns out to carry stale data.
    backupCurrentData();
    fs.rename(tmp, DATA_FILE, (renameErr) => {
      if (renameErr) console.error('[backend] Failed to replace data.json:', renameErr);
    });
  });
}
persist();

// Mirror the orders array into Postgres. data.json stays as a local backup, but
// the database is the copy that matters: it survives a corrupt file, can be
// backed up with pg_dump, and can be queried directly in pgAdmin.
//
// Failures are logged, never thrown — orders-db.js only marks a row as saved
// once the write succeeds, so the next save retries whatever did not land.
let ordersWriteInFlight = false;
let ordersWriteQueued = false;

async function persistOrdersToDb() {
  if (!HAS_DB) return;
  // Collapse a burst of writes into one follow-up pass instead of queueing a
  // round trip per request.
  if (ordersWriteInFlight) {
    ordersWriteQueued = true;
    return;
  }
  ordersWriteInFlight = true;
  try {
    const saved = await saveOrders(state.orders);
    if (saved) console.log(`[backend] Saved ${saved} order(s) to PostgreSQL`);
  } catch (err) {
    console.warn(`[backend] Could not save orders to PostgreSQL, will retry on next write. (${err.message})`);
  } finally {
    ordersWriteInFlight = false;
    if (ordersWriteQueued) {
      ordersWriteQueued = false;
      persistOrdersToDb();
    }
  }
}

// A copy of the state that is safe to send to a browser: staff objects keep
// their username and display name but never their password hash.
// The view of the shared state a given caller is allowed to see. `session` is
// the verified token payload ({ user, ... }) or null. Access level is read from
// the LIVE staff record (not the token) so a demoted account loses access at
// once. Three tiers:
//   * public / customer (no session): storefront data only — menu, stock,
//     orders, settings, addons, choices.
//   * any signed-in staff: the above + the time clock (for the clock-in tab).
//   * owner: everything, including staff HR (wages/positions), the expense book
//     and payroll.
// Password material is stripped for everyone. This is what stops a diner on the
// shop WiFi from reading salaries/expenses off the public /api/state.
function sanitizeState(s, session = null) {
  const account = session && (s.staff || []).find((a) => a.user === session.user);
  const isAuthed = !!account;
  const isOwner = account?.role === 'owner';
  return {
    ...s,
    staff: isOwner
      ? (s.staff || []).map(({ passHash, pass, ...rest }) => rest)
      : [],
    timeclock: isAuthed ? s.timeclock : [],
    expenses: isOwner ? s.expenses : [],
    payroll: isOwner ? s.payroll : {},
  };
}

// --- Real-time (SSE) broadcasting ------------------------------------------
// Each client is { res, session } so every open stream is sent only the slice
// of state its session is allowed to see (see sanitizeState). One customer and
// one owner on the same broadcast get different payloads.
const clients = new Set();

function broadcast() {
  for (const client of clients) {
    const payload = `event: state\ndata: ${JSON.stringify(sanitizeState(state, client.session))}\n\n`;
    client.res.write(payload);
  }
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
  // Once menu_items carries an `available` column the DATABASE owns the on/off
  // switch, and the value it supplies must win — re-applying the previous
  // in-memory flag here would mask every toggle the owner makes and make the
  // switch look broken. Until the column is added there is nowhere to store it,
  // so the old in-memory behaviour is kept rather than resetting dishes to "on"
  // on every sync.
  const dbOwnsAvailable = await hasAvailableColumn();
  const prevAvailById = dbOwnsAvailable
    ? new Map()
    : new Map((state.menu || []).map((m) => [m.id, m.available]));
  // The database owns every theme it actually supplies. Until the night menu is
  // imported it supplies only 'day', so the hand-curated night menu in seed.js
  // survives untouched; once night rows exist, the database takes over and the
  // seeded copy is dropped rather than duplicated alongside it.
  const dbThemes = new Set(dbMenu.map((item) => item.theme));
  // Keep only the hand-seeded shift menus the database genuinely doesn't supply.
  // 'none' (hidden-everywhere) is a DATABASE-owned state, never a seeded theme:
  // a dish set to 'none' then re-enabled leaves a stale 'none' copy in state.menu
  // whose theme is never in dbThemes, so without this guard the merge would keep
  // it forever as an undeletable ghost that isn't in the database. Drop those.
  const manualItems = (state.menu || []).filter(
    (m) => m.theme !== 'none' && !dbThemes.has(m.theme)
  );
  const nextMenu = [
    ...dbMenu.map((item) =>
      prevAvailById.has(item.id)
        ? { ...item, available: prevAvailById.get(item.id) }
        : item
    ),
    ...manualItems,
  ];
  // Same rule for the extras, but an EMPTY bucket from the database never wins:
  // before the night menu is imported dbAddons.night is [], and letting that
  // overwrite the seeded night extras would silently empty the bar's list.
  const mergeBuckets = (current, incoming) => {
    const out = { ...(current || {}) };
    for (const [bucket, list] of Object.entries(incoming || {})) {
      if (Array.isArray(list) && list.length) out[bucket] = list;
    }
    return out;
  };
  const nextAddons = mergeBuckets(state.addons, dbAddons);
  const nextChoices = mergeBuckets(state.choices, dbChoices);

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

// The app is served to phones/tablets over the shop's LAN (and the LAN IP
// changes per network), so besides the fixed list also accept any localhost
// or RFC-1918 private-network origin on any port. Public internet origins
// are still rejected.
const PRIVATE_ORIGIN_RE =
  /^https?:\/\/(localhost|127\.0\.0\.1|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})(:\d+)?$/;

app.use(cors({
  origin(origin, cb) {
    // Same-origin / curl / server-to-server requests have no Origin header.
    if (!origin || ALLOWED_ORIGINS.includes(origin) || PRIVATE_ORIGIN_RE.test(origin)) {
      return cb(null, true);
    }
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

// Owner-only guard. The role is read from the *current* staff record (not just
// the token) so an account demoted from owner loses access immediately, even on
// a token that was signed while it was still an owner.
function requireOwner(req, res, next) {
  const session = getSession(req);
  if (!session) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  const account = (state.staff || []).find((s) => s.user === session.user);
  if (!account || account.role !== 'owner') {
    return res.status(403).json({ error: 'ต้องเป็นเจ้าของร้านเท่านั้น' });
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

// --- Menu photo uploads -----------------------------------------------------
// Accepting a file from a browser is a classic foothold, so the rules are
// deliberately narrow:
//
//   * The server names every file itself (UUID + an extension derived from the
//     allowed MIME type). A client-supplied filename is never touched, which is
//     what makes "../../etc/passwd" a non-event rather than a path traversal.
//   * Only the three image types the app can display are accepted.
//   * 5 MB cap and exactly one file per request, so an upload cannot fill the
//     disk in a single call.
//
// The browser already shrinks photos to <=1200px JPEG before sending (see
// OwnerView), so a real menu photo arrives at ~200KB and the server never needs
// an image library to process it.
const UPLOAD_TYPES = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
    filename: (_req, file, cb) =>
      cb(null, `${crypto.randomUUID()}${UPLOAD_TYPES[file.mimetype]}`),
  }),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (UPLOAD_TYPES[file.mimetype]) return cb(null, true);
    cb(new Error('รองรับเฉพาะไฟล์ภาพ JPEG, PNG หรือ WebP เท่านั้น'));
  },
});

// Serve the stored photos. `image_url` holds a root-relative path
// (/uploads/xxx.jpg) rather than an absolute URL, so the same value works from
// the Vite dev server (which proxies /uploads through to here) and from a
// production deploy without a hardcoded host in the database.
app.use('/uploads', express.static(UPLOAD_DIR, {
  maxAge: '7d',
  index: false,
  // Filenames are server-generated UUIDs, so a request for anything else is
  // someone probing — 404 immediately instead of falling through.
  fallthrough: true,
}));

// --- Routes -----------------------------------------------------------------

// Snapshot of the shared state, scoped to the caller's access (Bearer token).
app.get('/api/state', (req, res) => {
  res.json(sanitizeState(state, getSession(req)));
});

// Live stream: sends the current state on connect, then again on every change.
// EventSource cannot set an Authorization header, so the session token rides as
// a ?token= query param. Absent/invalid ⇒ the public view (customers connect
// here too), never a rejection.
app.get('/api/events', (req, res) => {
  const session = verifyToken(String(req.query.token || '')) || null;
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.write(`event: state\ndata: ${JSON.stringify(sanitizeState(state, session))}\n\n`);
  // Comment ping keeps proxies/browsers from closing an idle connection.
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);

  const client = { res, session };
  clients.add(client);
  req.on('close', () => {
    clearInterval(ping);
    clients.delete(client);
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

  // The token carries the role/shop so the frontend can route straight to the
  // right panel; owner-only endpoints re-check the role against the live record.
  const role = account.role === 'owner' ? 'owner' : 'staff';
  const shop = account.shop === 'night' ? 'night' : 'day';
  const token = signToken({ user: account.user, role, shop });
  res.json({ token, user: account.user, name: account.name, role, shop, position: account.position || '' });
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
    const existing = existingByUser.get(user);

    let passHash;
    if (raw.pass) {
      passHash = hashPassword(String(raw.pass));           // new / changed password
    } else if (isHashed(raw.passHash)) {
      passHash = raw.passHash;                             // client echoed a hash
    } else {
      passHash = existing?.passHash;                       // preserve stored hash
    }
    if (!passHash) throw new Error(`account "${user}" has no password set`);

    // HR fields entered by the owner (ตำแหน่ง / ค่าแรงรายวัน / ร้านที่ประจำ).
    // Sanitised to plain scalars; missing values fall back to the stored record
    // so a client that omits them doesn't wipe them.
    const position = String(raw?.position ?? existing?.position ?? '').trim().slice(0, 100);
    const dailyWage = Math.max(0, Number(raw?.dailyWage ?? existing?.dailyWage) || 0);
    const shop = ['day', 'night'].includes(raw?.shop) ? raw.shop : (existing?.shop || 'day');
    // Access level: 'owner' (เจ้าของ — back-office panel) | 'staff' (พนักงาน —
    // shift board only). Defaults to 'staff' so a new account is never
    // accidentally granted owner access.
    const role = ['owner', 'staff'].includes(raw?.role) ? raw.role : (existing?.role || 'staff');

    out.push({ user, name, passHash, position, dailyWage, shop, role });
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
    case 'expenses':
      if (!Array.isArray(body)) return 'expenses must be an array';
      if (body.length > 20000) return 'too many expenses';
      if (!body.every((e) => e && typeof e === 'object' && !Array.isArray(e))) {
        return 'each expense must be an object';
      }
      return null;
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

  if (SERVER_OWNED_RESOURCES.has(resource)) {
    return res.status(403).json({ error: `${resource} can only be changed through its own endpoint` });
  }

  if (PROTECTED_RESOURCES.has(resource) && !getSession(req)) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  // Editing staff accounts or shop settings is an owner-only action, even though
  // both are "protected" resources a plain staff session could otherwise write.
  if (OWNER_RESOURCES.has(resource)) {
    const session = getSession(req);
    const account = session && (state.staff || []).find((s) => s.user === session.user);
    if (!account || account.role !== 'owner') {
      return res.status(403).json({ error: 'ต้องเป็นเจ้าของร้านเท่านั้น' });
    }
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
  // Sales data additionally goes to Postgres, which is its real home. This is
  // deliberately not awaited: the write is already safe in memory + data.json,
  // and a slow or briefly unreachable database must never stall the tab that
  // is trying to take an order.
  if (resource === 'orders') persistOrdersToDb();
  broadcast();
  res.json({ ok: true });
});

// Staff clock-in / clock-out. Auth required (the record is tied to the logged-in
// account); the browser sends its GPS position and the action only succeeds
// inside the shop's geofence. The timestamp recorded is the server's clock at
// the moment of the request. First call of the day = clock-in, second = clock-out,
// anything after that is rejected.
app.post('/api/timeclock/clock', requireAuth, (req, res) => {
  const lat = Number(req.body?.lat);
  const lng = Number(req.body?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return res.status(400).json({ error: 'ไม่พบพิกัดตำแหน่ง กรุณาเปิดการเข้าถึงตำแหน่ง (GPS) แล้วลองใหม่' });
  }

  const distance = Math.round(distanceMeters(lat, lng, TIMECLOCK.lat, TIMECLOCK.lng));
  if (distance > TIMECLOCK.radiusM) {
    return res.status(403).json({
      error: `อยู่นอกพื้นที่ร้าน (ห่างประมาณ ${distance.toLocaleString()} ม. — ลงเวลาได้ภายใน ${TIMECLOCK.radiusM} ม.)`,
      distance,
    });
  }

  const user = req.session.user;
  const account = (state.staff || []).find((s) => s.user === user);
  const now = Date.now();
  const date = localDateKey(now);

  let record = state.timeclock.find((r) => r.user === user && r.date === date);
  let action;
  if (!record) {
    record = {
      id: 'T' + now.toString(36) + Math.random().toString(36).slice(2, 6),
      user,
      name: account?.name || user,
      date,
      inAt: now,
      outAt: null,
    };
    state.timeclock.push(record);
    action = 'in';
  } else if (!record.outAt) {
    record.outAt = now;
    action = 'out';
  } else {
    return res.status(409).json({ error: 'วันนี้ลงเวลาเข้า-ออกครบแล้ว (วันละ 1 ครั้ง)' });
  }

  persist();
  broadcast();
  res.json({ ok: true, action, record });
});

// Owner backfill: create or correct a day's in/out for a staff member who forgot
// to clock (or clocked wrong). Auth required, no geofence — this is a manual
// admin action. `date` is YYYY-MM-DD; `inAt`/`outAt` are epoch ms (outAt may be
// null). Upserts the single record for that user+date.
app.post('/api/timeclock/manual', requireOwner, (req, res) => {
  const user = String(req.body?.user || '').trim();
  const date = String(req.body?.date || '').trim();
  const inAt = req.body?.inAt == null ? null : Number(req.body.inAt);
  const outAt = req.body?.outAt == null ? null : Number(req.body.outAt);

  const account = (state.staff || []).find((s) => s.user === user);
  if (!account) return res.status(400).json({ error: 'ไม่พบพนักงานคนนี้' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'รูปแบบวันที่ไม่ถูกต้อง' });
  if (inAt != null && !Number.isFinite(inAt)) return res.status(400).json({ error: 'เวลาเข้าไม่ถูกต้อง' });
  if (outAt != null && !Number.isFinite(outAt)) return res.status(400).json({ error: 'เวลาออกไม่ถูกต้อง' });
  if (inAt == null && outAt == null) return res.status(400).json({ error: 'ต้องระบุเวลาเข้าหรือออกอย่างน้อยหนึ่งช่อง' });
  if (inAt != null && outAt != null && outAt < inAt) {
    return res.status(400).json({ error: 'เวลาออกต้องอยู่หลังเวลาเข้า' });
  }

  let record = state.timeclock.find((r) => r.user === user && r.date === date);
  if (record) {
    if (inAt != null) record.inAt = inAt;
    if (outAt !== undefined) record.outAt = outAt;
    record.manual = true;
  } else {
    record = {
      id: 'T' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      user,
      name: account.name || user,
      date,
      inAt: inAt ?? null,
      outAt: outAt ?? null,
      manual: true,
    };
    state.timeclock.push(record);
  }

  persist();
  broadcast();
  res.json({ ok: true, record });
});

// Owner sets a staff member's monthly payroll status ('paid' | 'unpaid').
// Keyed "user__YYYY-MM". Auth required.
app.post('/api/timeclock/payroll', requireOwner, (req, res) => {
  const user = String(req.body?.user || '').trim();
  const month = String(req.body?.month || '').trim();
  const status = req.body?.status === 'paid' ? 'paid' : 'unpaid';
  if (!user) return res.status(400).json({ error: 'missing user' });
  if (!/^\d{4}-\d{2}$/.test(month)) return res.status(400).json({ error: 'รูปแบบเดือนไม่ถูกต้อง' });

  const key = `${user}__${month}`;
  if (status === 'paid') state.payroll[key] = 'paid';
  else delete state.payroll[key]; // absent = unpaid, keeps the store small

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

// Push the freshly-changed menu to every open tab right away, instead of
// leaving the owner to wonder for up to 30s whether the edit landed.
async function refreshMenuAndBroadcast() {
  const { count } = await syncMenuFromDb();
  broadcast();
  return count;
}

// The values the owner's dropdowns offer, taken from what is already in the
// table so a new category never has to be added in code.
app.get('/api/menu/options', requireAuth, async (_req, res) => {
  try {
    res.json(await fetchMenuOptions());
  } catch (err) {
    console.error('[backend] Could not read menu options:', err.message);
    res.status(502).json({ error: 'อ่านตัวเลือกจากฐานข้อมูลไม่สำเร็จ' });
  }
});

// Store one menu photo and hand back the path to save in image_url. The reply
// is deliberately the public path only — never the location on disk.
app.post('/api/menu/upload', requireAuth, (req, res) => {
  upload.single('image')(req, res, (err) => {
    if (err) {
      const tooBig = err.code === 'LIMIT_FILE_SIZE';
      return res.status(400).json({
        error: tooBig ? 'ไฟล์ใหญ่เกิน 5MB' : (err.message || 'อัปโหลดรูปไม่สำเร็จ'),
      });
    }
    if (!req.file) return res.status(400).json({ error: 'ไม่พบไฟล์รูปภาพ' });
    res.json({ url: `/uploads/${req.file.filename}` });
  });
});

// Validate the new-dish payload. Returns { value } or { error }.
function parseMenuItemBody(body) {
  const str = (v) => String(v ?? '').trim();
  const category = str(body?.category);
  const type = str(body?.type) || 'เมนูหลัก';
  const subcategory = str(body?.subcategory);
  const name = str(body?.name);
  const rawTheme = str(body?.theme);
  const theme = ['day', 'night', 'both', 'none'].includes(rawTheme) ? rawTheme : 'day';
  const imageUrl = str(body?.imageUrl);

  if (!name) return { error: 'กรุณากรอกชื่อรายการ' };
  if (!category) return { error: 'กรุณาเลือกหมวดหมู่' };
  if (name.length > 200) return { error: 'ชื่อรายการยาวเกินไป' };

  // Only a path we issued, or an external link of the kind the imported data
  // already holds. Anything else (javascript:, data:) is refused rather than
  // stored and later rendered into an <img src>.
  if (imageUrl && !/^\/uploads\/[A-Za-z0-9-]+\.(jpg|png|webp)$/.test(imageUrl)
      && !/^https?:\/\//i.test(imageUrl)) {
    return { error: 'ลิงก์รูปภาพไม่ถูกต้อง' };
  }

  // No protein choices -> a single row whose เนื้อสัตว์ is "-", matching how the
  // imported data spells "not applicable".
  const rawVariants = Array.isArray(body?.variants) && body.variants.length
    ? body.variants
    : [{ meat: '-', price: body?.price }];

  const variants = [];
  for (const v of rawVariants) {
    const meat = str(v?.meat) || '-';
    const price = Number(v?.price);
    if (!Number.isFinite(price) || price < 0) {
      return { error: `ราคาของ "${meat === '-' ? name : meat}" ต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป` };
    }
    variants.push({ meat, price: Math.round(price) });
  }
  if (variants.length > 20) return { error: 'ตัวเลือกเนื้อสัตว์มากเกินไป' };

  const meats = variants.map((v) => v.meat);
  if (new Set(meats).size !== meats.length) {
    return { error: 'มีตัวเลือกเนื้อสัตว์ซ้ำกัน' };
  }

  return { value: { category, type, subcategory, name, theme, imageUrl, variants } };
}

// Add a dish. One row goes in per protein option, all sharing the image, which
// is what makes the transforms fold them back into a single card with options.
app.post('/api/menu/items', requireAuth, async (req, res) => {
  const { value, error } = parseMenuItemBody(req.body);
  if (error) return res.status(400).json({ error });

  try {
    if (await dishIdentityTaken(value)) {
      return res.status(409).json({ error: 'มีเมนูชื่อนี้อยู่แล้วในหัวข้อและกะเดียวกัน' });
    }
    const inserted = await insertMenuItem(value);
    const count = await refreshMenuAndBroadcast();
    console.log(`[backend] Added menu item "${value.name}" (${inserted} row(s)); menu now ${count} items`);
    res.json({ ok: true, rows: inserted });
  } catch (err) {
    console.error('[backend] Could not add menu item:', err.message);
    res.status(502).json({ error: err.message || 'บันทึกเมนูไม่สำเร็จ' });
  }
});

// Read one dish back in its editable form (category/type/subcategory + variants),
// so the owner's edit screen can pre-fill the same form the create screen uses.
app.get('/api/menu/items/:id', requireAuth, async (req, res) => {
  try {
    const dish = await getDishForEdit(String(req.params.id));
    if (!dish) return res.status(404).json({ error: 'ไม่พบเมนูนี้ในฐานข้อมูล' });
    res.json(dish);
  } catch (err) {
    console.error('[backend] Could not load menu item:', err.message);
    res.status(502).json({ error: err.message || 'โหลดเมนูไม่สำเร็จ' });
  }
});

// Edit an existing dish. Reuses the same validation as adding one, then replaces
// the dish's rows (see updateMenuItem) and broadcasts the refreshed menu.
app.put('/api/menu/items/:id', requireAuth, async (req, res) => {
  const { value, error } = parseMenuItemBody(req.body);
  if (error) return res.status(400).json({ error });
  const id = String(req.params.id);

  try {
    // Ignore the dish's own rows so renaming nothing isn't read as a collision.
    if (await dishIdentityTaken(value, id)) {
      return res.status(409).json({ error: 'มีเมนูชื่อนี้อยู่แล้วในหัวข้อและกะเดียวกัน' });
    }
    const updated = await updateMenuItem(id, value);
    if (!updated) return res.status(404).json({ error: 'ไม่พบเมนูนี้ในฐานข้อมูล' });
    const count = await refreshMenuAndBroadcast();
    console.log(`[backend] Updated menu item "${value.name}" (${updated} row(s)); menu now ${count} items`);
    res.json({ ok: true, rows: updated });
  } catch (err) {
    console.error('[backend] Could not update menu item:', err.message);
    res.status(502).json({ error: err.message || 'แก้ไขเมนูไม่สำเร็จ' });
  }
});

// Put a dish on or off sale. Keyed by the dish id the app already renders —
// see setDishAvailability() for why matching on name would be unreliable.
app.patch('/api/menu/items/availability', requireAuth, async (req, res) => {
  const id = String(req.body?.id || '').trim();
  const available = req.body?.available;
  if (!id) return res.status(400).json({ error: 'ต้องระบุรหัสเมนู' });
  if (typeof available !== 'boolean') {
    return res.status(400).json({ error: 'ค่า available ต้องเป็น true หรือ false' });
  }

  try {
    const updated = await setDishAvailability(id, available);
    if (!updated) return res.status(404).json({ error: 'ไม่พบเมนูนี้ในฐานข้อมูล' });
    await refreshMenuAndBroadcast();
    res.json({ ok: true, rows: updated });
  } catch (err) {
    console.error('[backend] Could not change availability:', err.message);
    res.status(502).json({ error: err.message || 'เปลี่ยนสถานะไม่สำเร็จ' });
  }
});

// Set which shift(s) a dish shows in — day / night / both / none. Drives the
// sun/moon pill in จัดการเมนู: 'none' hides the dish from every storefront
// without deleting it. See setDishTheme() for why it also clears ปิดขาย.
app.patch('/api/menu/items/theme', requireAuth, async (req, res) => {
  const id = String(req.body?.id || '').trim();
  const theme = String(req.body?.theme || '').trim();
  if (!id) return res.status(400).json({ error: 'ต้องระบุรหัสเมนู' });
  if (!['day', 'night', 'both', 'none'].includes(theme)) {
    return res.status(400).json({ error: "ค่า theme ต้องเป็น day, night, both หรือ none" });
  }

  try {
    const updated = await setDishTheme(id, theme);
    if (!updated) return res.status(404).json({ error: 'ไม่พบเมนูนี้ในฐานข้อมูล' });
    await refreshMenuAndBroadcast();
    res.json({ ok: true, rows: updated });
  } catch (err) {
    console.error('[backend] Could not change theme:', err.message);
    res.status(502).json({ error: err.message || 'เปลี่ยนกะที่แสดงไม่สำเร็จ' });
  }
});

// --- Stock (คลังวัตถุดิบ) ----------------------------------------------------
// The staff inventory tab reads and edits the `stock_items` table directly.
// Separate from the in-memory drink `stock` used when taking an order.

// The whole inventory.
app.get('/api/stock-items', requireAuth, async (_req, res) => {
  try {
    res.json({ items: await fetchStockItems() });
  } catch (err) {
    console.error('[backend] Could not read stock_items:', err.message);
    res.status(502).json({ error: 'อ่านคลังวัตถุดิบจากฐานข้อมูลไม่สำเร็จ' });
  }
});

// Create a stock item (or top up an existing one with the same name). Backs the
// owner's "อัพเดทสตอก" action, which adds a dish and its inventory row at once.
app.post('/api/stock-items', requireAuth, async (req, res) => {
  const category = String(req.body?.category || '').trim() || 'ทั่วไป';
  const name = String(req.body?.name || '').trim();
  const quantity = Number(req.body?.quantity);
  const imageUrl = String(req.body?.imageUrl || '').trim();
  if (!name) return res.status(400).json({ error: 'ต้องระบุชื่อรายการ' });
  if (!Number.isInteger(quantity) || quantity < 0) {
    return res.status(400).json({ error: 'จำนวนต้องเป็นจำนวนเต็มตั้งแต่ 0 ขึ้นไป' });
  }
  try {
    const item = await createStockItem({ category, name, quantity, imageUrl });
    res.json({ ok: true, item });
  } catch (err) {
    console.error('[backend] Could not create stock item:', err.message);
    res.status(502).json({ error: 'เพิ่มรายการในคลังไม่สำเร็จ' });
  }
});

// Public, read-only stock levels for the customer storefront (no auth). Returns
// [{ name, quantity }] so CustomerView can grey out a dish whose linked stock
// has hit 0. If the DB is unreachable we return an empty list rather than an
// error, so the menu still shows (fails open — never hides food on a DB hiccup).
app.get('/api/stock-availability', async (_req, res) => {
  try {
    res.json({ items: await fetchStockAvailability() });
  } catch (err) {
    console.error('[backend] Could not read stock availability:', err.message);
    res.json({ items: [] });
  }
});

// Adjust one item's quantity by { delta } (e.g. +1 / +10). Never below 0.
app.patch('/api/stock-items/:id', requireAuth, async (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  const delta = Number(req.body?.delta);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'รหัสสินค้าไม่ถูกต้อง' });
  if (!Number.isFinite(delta)) return res.status(400).json({ error: 'ค่า delta ต้องเป็นตัวเลข' });
  try {
    const item = await adjustStockItem(id, delta);
    if (!item) return res.status(404).json({ error: 'ไม่พบสินค้านี้ในคลัง' });
    res.json({ ok: true, item });
  } catch (err) {
    console.error('[backend] Could not adjust stock item:', err.message);
    res.status(502).json({ error: 'ปรับจำนวนคลังไม่สำเร็จ' });
  }
});

// Deduct { name, qty } from the stock row matched by dish name — fired when
// staff mark a dish เสิร์ฟแล้ว (negative qty restores it on un-serve). A dish
// with no matching row returns { item: null } rather than 404: not every menu
// item is stock-linked, and the serve tap must not fail because of that.
app.post('/api/stock-items/consume', requireAuth, async (req, res) => {
  const name = String(req.body?.name || '').trim();
  const qty = Number(req.body?.qty);
  if (!name) return res.status(400).json({ error: 'ต้องระบุชื่อรายการ' });
  if (!Number.isInteger(qty) || qty === 0 || Math.abs(qty) > 999) {
    return res.status(400).json({ error: 'ค่า qty ต้องเป็นจำนวนเต็มไม่เกิน ±999' });
  }
  try {
    const item = await consumeStockByName(name, qty);
    res.json({ ok: true, item });
  } catch (err) {
    console.error('[backend] Could not consume stock:', err.message);
    res.status(502).json({ error: 'ตัดสต็อกไม่สำเร็จ' });
  }
});

// Bump every item by { delta } (the "เติมทั้งหมด" buttons).
app.post('/api/stock-items/restock', requireAuth, async (req, res) => {
  const delta = Number(req.body?.delta);
  if (!Number.isFinite(delta)) return res.status(400).json({ error: 'ค่า delta ต้องเป็นตัวเลข' });
  try {
    const changed = await restockAll(delta);
    res.json({ ok: true, changed });
  } catch (err) {
    console.error('[backend] Could not restock all:', err.message);
    res.status(502).json({ error: 'เติมสต็อกทั้งหมดไม่สำเร็จ' });
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

  // Bring orders in from PostgreSQL. On the very first run the table is empty,
  // so whatever is already in data.json is migrated up into it — nobody has to
  // move their existing sales by hand.
  if (HAS_DB) {
    (async () => {
      await ensureOrdersTable();
      const dbOrders = await loadOrders();
      if (dbOrders.length) {
        state.orders = dbOrders; // the database is the source of truth
        persist();
        broadcast();
        console.log(`[backend] Loaded ${dbOrders.length} order(s) from PostgreSQL`);
      } else if (Array.isArray(state.orders) && state.orders.length) {
        const moved = await saveOrders(state.orders);
        console.log(`[backend] Migrated ${moved} existing order(s) from data.json into PostgreSQL`);
      } else {
        console.log('[backend] Orders table ready (no orders yet)');
      }
    })().catch((err) =>
      console.warn(`[backend] Orders are NOT being saved to PostgreSQL — check DATABASE_URL. (${err.message})`)
    );
  }

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
