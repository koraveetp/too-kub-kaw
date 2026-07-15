// ---------------------------------------------------------------------------
// Google Sheets API service
// ---------------------------------------------------------------------------
// One reusable place for talking to the Apps Script Web App, which returns the
// whole spreadsheet as { "<tab name>": [ {col: value}, ... ], ... }.
//
// Nothing here knows what a menu is — it fetches, validates and cleans rows.
// Domain mapping lives in menu-sheet.js.
//
// The URL comes from backend/.env (GOOGLE_SHEETS_API_URL). It is not a secret
// (the deployment is public by design), but keeping it in one file means the
// deployment can be rotated without touching code.
// ---------------------------------------------------------------------------

const REQUEST_TIMEOUT_MS = 15000;

export function getApiUrl() {
  const url = (process.env.GOOGLE_SHEETS_API_URL || '').trim();
  if (!url) {
    throw new Error(
      'GOOGLE_SHEETS_API_URL is not set. Copy backend/.env.example to backend/.env ' +
      'and put your Apps Script /exec URL in it.'
    );
  }
  return url;
}

// Fetch every tab of the spreadsheet as plain objects.
// Throws with an actionable message on network, HTTP, permission or JSON errors
// so the caller can fall back to the last-known menu.
export async function fetchSheets() {
  const url = getApiUrl();

  let res;
  try {
    res = await fetch(url, {
      redirect: 'follow', // Apps Script always 302s to script.googleusercontent.com
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    const reason = err.name === 'TimeoutError'
      ? `no response in ${REQUEST_TIMEOUT_MS / 1000}s`
      : err.message;
    throw new Error(`Could not reach the Apps Script endpoint (${reason})`);
  }

  if (!res.ok) {
    throw new Error(`Apps Script returned HTTP ${res.status} ${res.statusText}`);
  }

  const body = await res.text();

  // A public deployment returns JSON. An HTML body means the request was
  // bounced to a Google sign-in page — i.e. the deployment is not public — or
  // the script threw and Apps Script rendered its error page. Both arrive as
  // HTTP 200, so the status code alone cannot be trusted.
  const looksLikeHtml = /^\s*<(?:!doctype|html)/i.test(body);
  if (looksLikeHtml) {
    throw new Error(
      'Apps Script returned an HTML page instead of JSON. The deployment is most ' +
      'likely not public: redeploy with "Execute as: Me" and "Who has access: Anyone" ' +
      '(note: "Anyone with Google account" is NOT enough).'
    );
  }

  let data;
  try {
    data = JSON.parse(body);
  } catch (err) {
    throw new Error(`Apps Script response was not valid JSON: ${err.message}`);
  }

  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('Expected an object of { tabName: rows[] } from Apps Script');
  }
  return data;
}

// Read one tab. Missing tab (renamed/deleted) -> [] rather than a crash.
export function getTab(sheets, name) {
  const rows = sheets?.[name];
  if (!Array.isArray(rows)) return [];
  return rows.filter((r) => r && typeof r === 'object' && !Array.isArray(r));
}

// Trim column names and string values, then drop rows that carry no content.
// Guards against a stray trailing space in a sheet header silently breaking
// every lookup that follows.
export function cleanRows(rows) {
  const cleaned = [];
  for (const row of rows) {
    const out = {};
    let hasValue = false;
    for (const [key, value] of Object.entries(row)) {
      const k = String(key).trim();
      if (!k) continue;
      const v = typeof value === 'string' ? value.trim() : value;
      out[k] = v;
      if (v !== '' && v !== null && v !== undefined) hasValue = true;
    }
    if (hasValue) cleaned.push(out);
  }
  return cleaned;
}

// Sheets may hand back a number (55) or a string ("55", "55 บาท", "-", "").
// Returns `fallback` for anything that isn't a usable figure.
export function toNumber(value, fallback = 0) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : fallback;
  const raw = String(value ?? '').trim();
  if (!raw || raw === '-') return fallback;
  const n = Number(raw.replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : fallback;
}

// Cell -> trimmed string. "-" is the sheet's "not applicable" marker, so it
// reads as empty.
export function text(value) {
  const raw = String(value ?? '').trim();
  return raw === '-' ? '' : raw;
}
