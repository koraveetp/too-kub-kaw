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
