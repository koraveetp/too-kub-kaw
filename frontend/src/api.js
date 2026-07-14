// ---------------------------------------------------------------------------
// Frontend -> Backend bridge
// ---------------------------------------------------------------------------
// Thin client for the shared-state backend. During `npm run dev`, Vite proxies
// every "/api" request to the backend (see vite.config.js), so we can use plain
// relative URLs here and never worry about ports or CORS.
// ---------------------------------------------------------------------------

// Fetch the full shared state once (used on first load).
export async function fetchState() {
  const res = await fetch('/api/state');
  if (!res.ok) throw new Error('Failed to load state from backend');
  return res.json();
}

// Replace one resource on the backend. The backend then broadcasts the new
// state to every connected tab over SSE. Fire-and-forget: the UI already
// updated optimistically, so we only log network failures.
export function saveResource(resource, value) {
  return fetch(`/api/${resource}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(value),
  }).catch((err) => {
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
