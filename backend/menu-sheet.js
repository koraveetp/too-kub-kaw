// ---------------------------------------------------------------------------
// Google Sheet -> menu bridge
// ---------------------------------------------------------------------------
// The restaurant menu lives in a published Google Sheet (File > Share > Publish
// to web > CSV). This module fetches that CSV and turns each row into a menu
// item in the shape the app expects:
//
//     { id, name, price, category, theme, emoji, desc, available }
//
// The sheet only carries the three columns the owner cares about
// (หมวดหมู่ = category, ชื่อรายการ = name, ราคา = price); everything else is
// derived here so the UI still looks good.
// ---------------------------------------------------------------------------

// Published CSV endpoint of the menu sheet.
export const SHEET_CSV_URL =
  'https://docs.google.com/spreadsheets/d/e/2PACX-1vTLGCE9OFhscG2OT6SEFSMWinKttvuYnUrhp4UWZfbp27F1i7h_GHkj4Va9OudRCijqKRs92oZjv8Sh/pub?output=csv';

// --- Minimal CSV parser (handles quoted fields + embedded commas/newlines) ---
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } // escaped quote
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\n') {
      row.push(field); rows.push(row); row = []; field = '';
    } else if (c !== '\r') {
      field += c;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

// Pick a fitting emoji from the dish name so the menu isn't a wall of 🍽️.
// Ordered most-specific first (protein/ingredient, then cooking style).
const EMOJI_RULES = [
  ['ทะเล', '🦐'], ['กุ้ง', '🍤'], ['หอย', '🐚'], ['ปู', '🦀'],
  ['ปลาดุก', '🐟'], ['ปลาเค็ม', '🐟'], ['ปลา', '🐟'],
  ['กบ', '🐸'], ['หมูป่า', '🐗'], ['หมูกรอบ', '🥓'], ['หมู', '🐷'],
  ['เนื้อ', '🥩'], ['ไก่', '🍗'], ['ไข่', '🍳'],
  ['ต้มข่า', '🥥'], ['ต้มจืด', '🍲'], ['ต้มโคล้ง', '🍲'], ['ต้ม', '🍲'],
  ['แกงส้ม', '🥘'], ['แกง', '🥘'], ['สะตอ', '🫛'],
  ['ข้าวผัด', '🍚'], ['ผัดซีอิ๊ว', '🍜'], ['ราดหน้า', '🍜'],
  ['กะเพรา', '🌿'], ['ผัด', '🍳'], ['ข้าว', '🍚'],
];

function emojiFor(name) {
  for (const [kw, emoji] of EMOJI_RULES) {
    if (name.includes(kw)) return emoji;
  }
  return '🍽️';
}

// Protein words that appear as the last token of a dish name
// (e.g. "ทอดน้ำปลาราดข้าว หมู"). Rows that share a base name but differ only by
// this suffix are merged into ONE dish with selectable protein options.
const PROTEINS = new Set([
  'หมู', 'ไก่', 'หมูกรอบ', 'ทะเล', 'เนื้อ', 'ปลาเค็ม',
  'หมูสับ', 'ไก่สับ', 'ปลา', 'กุ้ง',
]);

// Split "base name" + trailing protein, if the last word is a known protein.
function splitProtein(name) {
  const idx = name.lastIndexOf(' ');
  if (idx === -1) return { base: name, protein: null };
  const protein = name.slice(idx + 1);
  if (PROTEINS.has(protein)) return { base: name.slice(0, idx), protein };
  return { base: name, protein: null };
}

// Turn parsed CSV rows into menu items. The first non-empty row is the header.
// Rows are grouped by (category + base name): a base with 2+ protein variants
// becomes a single item carrying an `options` list (protein -> price); anything
// else stays a plain single item.
export function sheetRowsToMenu(rows) {
  const body = rows.filter((r) => r.some((c) => c.trim() !== ''));
  if (body.length <= 1) return [];

  // Pass 1 — bucket rows by category|base, preserving first-seen order.
  const groups = [];
  const byKey = new Map();
  for (const cells of body.slice(1)) {
    const category = (cells[0] || '').trim();
    const rawName = (cells[1] || '').trim();
    const price = Number((cells[2] || '').replace(/[^0-9.]/g, ''));
    if (!rawName) continue;
    const { base, protein } = splitProtein(rawName);
    const key = `${category}|${base}`;
    let g = byKey.get(key);
    if (!g) { g = { category, base, rows: [] }; byKey.set(key, g); groups.push(g); }
    g.rows.push({ rawName, protein, price: Number.isFinite(price) ? price : 0 });
  }

  // Pass 2 — emit menu items.
  const menu = [];
  let i = 0;
  for (const g of groups) {
    const proteinRows = g.rows.filter((r) => r.protein);
    i++;
    const category = g.category || 'อาหารจานเดียว';
    if (proteinRows.length >= 2) {
      const options = proteinRows.map((r) => ({ name: r.protein, price: r.price }));
      menu.push({
        id: `d${i}`,
        name: g.base,
        price: Math.min(...options.map((o) => o.price)), // "starts at" price
        category,
        theme: 'day', // sheet is the daytime à la carte menu
        emoji: emojiFor(g.base),
        desc: '',
        options,
        available: true,
      });
    } else {
      // Single dish (no protein choice) — keep its full original name.
      const r = g.rows[0];
      menu.push({
        id: `d${i}`,
        name: r.rawName,
        price: r.price,
        category,
        theme: 'day',
        emoji: emojiFor(r.rawName),
        desc: '',
        options: [],
        available: true,
      });
    }
  }
  return menu;
}

// Fetch the published sheet and return it as an array of menu items.
// Throws on network/HTTP errors so the caller can fall back to the seed.
export async function fetchMenuFromSheet() {
  const res = await fetch(SHEET_CSV_URL, { redirect: 'follow' });
  if (!res.ok) throw new Error(`Sheet fetch failed: HTTP ${res.status}`);
  const text = await res.text();
  const menu = sheetRowsToMenu(parseCsv(text));
  if (!menu.length) throw new Error('Sheet produced an empty menu');
  return menu;
}
