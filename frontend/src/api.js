// ---------------------------------------------------------------------------
// Frontend -> Backend bridge
// ---------------------------------------------------------------------------
// Thin client for the shared-state backend. During `npm run dev`, Vite proxies
// every "/api" request to the backend (see vite.config.js), so we can use plain
// relative URLs here and never worry about ports or CORS.
// ---------------------------------------------------------------------------

// --- Session token ----------------------------------------------------------
// The staff session token issued by POST /api/login. Kept in memory and mirrored
// to localStorage so a refresh doesn't log the user out. Writes to protected
// resources send it as a Bearer token.
let authToken = null;
try {
  authToken = JSON.parse(localStorage.getItem('session') || 'null')?.token || null;
} catch {
  authToken = null;
}

export function setAuthToken(token) {
  authToken = token || null;
}

export function getAuthToken() {
  return authToken;
}

// Log in as a staff member. Returns { token, user, name } on success; throws
// with the server's message on bad credentials or rate limiting.
export async function login(user, pass) {
  const res = await fetch('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user, pass }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || 'เข้าสู่ระบบไม่สำเร็จ');
  }
  setAuthToken(data.token);
  return data;
}

// Fetch the full shared state once (used on first load).
export async function fetchState() {
  const res = await fetch('/api/state');
  if (!res.ok) throw new Error('Failed to load state from backend');
  return res.json();
}

// Replace one resource on the backend. The backend then broadcasts the new
// state to every connected tab over SSE. Fire-and-forget: the UI already
// updated optimistically, so we only log network failures. Protected resources
// (menu / stock / staff / settings) need a valid session token — `onAuthError`
// is called if the server rejects the write as unauthenticated.
export function saveResource(resource, value, onAuthError) {
  const headers = { 'Content-Type': 'application/json' };
  if (authToken) headers.Authorization = `Bearer ${authToken}`;
  return fetch(`/api/${resource}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify(value),
  })
    .then((res) => {
      if (res.status === 401 && typeof onAuthError === 'function') onAuthError();
      return res;
    })
    .catch((err) => {
      console.error(`[api] Could not save "${resource}" to backend:`, err);
    });
}

// --- Menu management (owner) ------------------------------------------------
// These all go through endpoints that require a staff session, and they change
// the DATABASE rather than the in-memory state — a write to state.menu would be
// overwritten by the next database sync a few seconds later.
//
// Each one throws with the server's Thai message so the caller can put it
// straight into a toast.
async function authedJson(url, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (authToken) headers.Authorization = `Bearer ${authToken}`;
  const res = await fetch(url, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'ทำรายการไม่สำเร็จ');
  return data;
}

// Dropdown values (หมวดหมู่ / ประเภท / หัวข้อ) as they exist in the database.
export function fetchMenuOptions() {
  return authedJson('/api/menu/options');
}

// Send one already-resized image. Returns { url: '/uploads/xxx.jpg' }.
// No Content-Type header here on purpose: fetch has to set the multipart
// boundary itself, and naming the type would strip it and break the parse.
export function uploadMenuImage(file) {
  const body = new FormData();
  body.append('image', file);
  return authedJson('/api/menu/upload', { method: 'POST', body });
}

// Add a dish (one row per protein option, handled server-side).
export function createMenuItem(item) {
  return authedJson('/api/menu/items', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(item),
  });
}

// Put a dish on or off sale, by its stable dish id.
export function setMenuAvailability(id, available) {
  return authedJson('/api/menu/items/availability', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, available }),
  });
}

// Resolve a stored image value into something an <img src> can use.
//
// Two shapes live in image_url side by side: the external links the menu was
// originally imported with (https://i.postimg.cc/...), which are used as-is,
// and the root-relative paths uploads produce (/uploads/xxx.jpg), which resolve
// against the current origin — Vite proxies /uploads to the backend in dev, and
// in production both are served from the same host.
export function resolveImageUrl(image) {
  const src = String(image || '').trim();
  if (!src) return '';
  if (/^https?:\/\//i.test(src) || src.startsWith('data:')) return src;
  return src.startsWith('/') ? src : `/${src}`;
}

// Subscribe to live state pushes. `onState` is called with the full state
// object on connect and again every time anything changes in any tab.
// Returns an unsubscribe function.
export function subscribeToState(onState) {
  const source = new EventSource('/api/events');
  source.addEventListener('state', (event) => {
    try {
      onState(JSON.parse(event.data));
    } catch (err) {
      console.error('[api] Bad state payload from backend:', err);
    }
  });
  return () => source.close();
}
