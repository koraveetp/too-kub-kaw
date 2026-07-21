// ---------------------------------------------------------------------------
// PostgreSQL -> menu bridge
// ---------------------------------------------------------------------------
// The menu's single source of truth: reads one-row-per-variant data from a
// Postgres `menu_items` table and runs it through the shared transforms in
// menu-transform.js, producing the { menu, addons, choices } shape the app
// expects.
//
// The table is created/loaded from the CSV via menu_schema.sql. Its English
// columns are aliased back to the Thai column names the transforms expect, so
// no mapping logic has to be duplicated here.
//
// Connection string comes from backend/.env (DATABASE_URL), e.g.
//   DATABASE_URL=postgres://USER:PASSWORD@localhost:5432/restaurant
// ---------------------------------------------------------------------------

import { getPool } from './db.js';
import {
  menuRowsToMenu,
  addonRowsToAddons,
  choiceRowsToChoices,
  groupDishRows,
} from './menu-transform.js';

// Read menu_items and hand back rows keyed by the Thai column names, so the
// shared transforms in menu-transform.js can consume them unchanged.
// Does menu_items carry the day/night `theme` column yet? A table created
// before the night menu existed does not, so it is detected once rather than
// assumed — that way starting the server before running the ALTER prints a hint
// instead of crashing with a bare "column does not exist".
// Both optional columns are probed the same way and the answer cached, so the
// check costs one query per column for the life of the process.
const columnCache = new Map();
const MISSING_COLUMN_HINT = {
  theme:
    'menu_items has no "theme" column — treating every item as the DAY menu. ' +
    'Add it with:  ALTER TABLE menu_items ADD COLUMN theme TEXT;',
  available:
    'menu_items has no "available" column — every dish will show as on sale ' +
    'and the owner\'s on/off switch cannot be saved. Add it with:  ' +
    'ALTER TABLE menu_items ADD COLUMN available BOOLEAN NOT NULL DEFAULT true;',
};

async function hasColumn(name) {
  if (!columnCache.has(name)) {
    const { rows } = await getPool().query(
      `SELECT 1 FROM information_schema.columns
       WHERE table_name = 'menu_items' AND column_name = $1
       LIMIT 1`,
      [name]
    );
    const present = rows.length > 0;
    columnCache.set(name, present);
    if (!present) console.warn(`[backend] ${MISSING_COLUMN_HINT[name] || `menu_items has no "${name}" column`}`);
  }
  return columnCache.get(name);
}

// Does the table carry the on/off switch yet? server.js asks so it knows
// whether the database or the old in-memory state owns `available`.
export function hasAvailableColumn() {
  return hasColumn('available');
}

async function fetchMenuRows() {
  // `theme` and `available` keep their English names: they are database
  // concepts, not columns that ever existed in the spreadsheet the Thai aliases
  // mirror. The primary key rides along as `__rowId` so a dish can be traced
  // back to the exact rows to UPDATE.
  const themeSelect = (await hasColumn('theme'))
    ? `COALESCE(theme, 'day') AS theme`
    : `'day' AS theme`;
  const availableSelect = (await hasColumn('available'))
    ? `COALESCE(available, true) AS available`
    : `true AS available`;
  // English companions are optional: a table without them selects '' so the
  // transforms (and the app) simply fall back to the Thai text.
  const subEnSelect = (await hasColumn('subcategory_en'))
    ? `COALESCE(subcategory_en, '')` : `''`;
  const nameEnSelect = (await hasColumn('name_en'))
    ? `COALESCE(name_en, '')` : `''`;
  const meatEnSelect = (await hasColumn('meat_en'))
    ? `COALESCE(meat_en, '')` : `''`;

  const { rows } = await getPool().query(`
    SELECT id          AS "__rowId",
           category    AS "หมวดหมู่",
           type        AS "ประเภท",
           subcategory AS "หัวข้อ",
           name        AS "ชื่อรายการ",
           meat        AS "เนื้อสัตว์",
           price       AS "ราคา (บาท)",
           image_url   AS "รูปภาพ",
           ${subEnSelect}  AS "หัวข้อ(en)",
           ${nameEnSelect} AS "ชื่อรายการ(en)",
           ${meatEnSelect} AS "เนื้อสัตว์(en)",
           ${themeSelect},
           ${availableSelect}
    FROM menu_items
    ORDER BY id
  `);
  return rows;
}

// Fetch from Postgres and build the menu + extras.
// Throws on connection/query errors so the caller can fall back to the
// last-known menu, exactly like the sheet path does.
export async function fetchMenuFromDb() {
  const rows = await fetchMenuRows();
  if (!rows.length) {
    throw new Error(
      'Table "menu_items" is empty. Import the CSV (see menu_schema.sql) first.'
    );
  }

  const menu = menuRowsToMenu(rows);
  if (!menu.length) {
    throw new Error(
      `menu_items has ${rows.length} rows but produced no dishes — ` +
      `check the "ประเภท"/"ชื่อรายการ" columns still hold the expected values.`
    );
  }

  return {
    menu,
    addons: addonRowsToAddons(rows),
    choices: choiceRowsToChoices(rows),
  };
}

// --- Writes -----------------------------------------------------------------

// The distinct values already in the table, for the owner's dropdowns. Read
// from the data rather than hard-coded, so a category added here shows up in
// the form without a code change.
export async function fetchMenuOptions() {
  const { rows } = await getPool().query(`
    SELECT DISTINCT category, type, subcategory FROM menu_items
  `);
  const collect = (key) =>
    [...new Set(rows.map((r) => (r[key] || '').trim()).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, 'th'));
  return {
    categories: collect('category'),
    types: collect('type'),
    subcategories: collect('subcategory'),
  };
}

// Flip one dish on or off. A dish is several rows (one per protein), so this
// updates every row behind it — found by running the live rows through the same
// grouping the menu itself is built from, never by re-matching on name.
// Returns the number of rows updated; 0 means the id matched no dish.
export async function setDishAvailability(dishId, available) {
  if (!(await hasColumn('available'))) {
    throw new Error(
      'menu_items has no "available" column — run: ALTER TABLE menu_items ' +
      'ADD COLUMN available BOOLEAN NOT NULL DEFAULT true;'
    );
  }
  const dish = groupDishRows(await fetchMenuRows()).find((d) => d.id === dishId);
  if (!dish) return 0;

  const rowIds = dish.sourceRows.map((r) => r.__rowId).filter((id) => id != null);
  if (!rowIds.length) return 0;

  const { rowCount } = await getPool().query(
    `UPDATE menu_items SET available = $1 WHERE id = ANY($2::int[])`,
    [available, rowIds]
  );
  return rowCount;
}

// Add a dish: one row per protein option, all sharing the same image.
// `variants` is [{ meat, price }]; a dish with no protein choice passes a
// single variant with meat '-' , matching how the imported data spells "none".
//
// The rows go in inside a transaction so a dish is never left half-inserted
// (which would surface as a dish missing some of its options).
export async function insertMenuItem({
  category, type, subcategory, name, theme, imageUrl, variants,
}) {
  if (!(await hasColumn('theme'))) {
    throw new Error(
      'menu_items has no "theme" column — a new dish could not be filed under ' +
      'the day or night menu. Run: ALTER TABLE menu_items ADD COLUMN theme TEXT;'
    );
  }
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const v of variants) {
      await client.query(
        `INSERT INTO menu_items (category, type, subcategory, name, meat, price, image_url, theme)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [category, type, subcategory, name, v.meat, v.price, imageUrl || null, theme]
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  return variants.length;
}

// Would this dish collide with one that already exists?
//
// The app's dish id is a hash of (theme|หัวข้อ|ชื่อ), so a second dish resolving
// to the same identity would share an id with the first: the two would collide
// in the menu and the on/off switch would flip both at once.
//
// Rather than re-deriving that identity here (and drifting from it the next
// time the grouping rules change), the prospective rows are run through the
// real grouping alongside the live ones. If they merge into an existing dish
// instead of forming a new one, the dish count does not grow — that is the
// collision, and it catches the cases a plain name comparison misses, e.g. a
// new "ต้มจืดเต้าหู้ หมูสับ" folding into the existing "ต้มจืดเต้าหู้".
export async function dishIdentityTaken({ category, type, subcategory, name, theme, variants }) {
  const existing = await fetchMenuRows();
  const candidateRows = variants.map((v) => ({
    'หมวดหมู่': category,
    'ประเภท': type,
    'หัวข้อ': subcategory,
    'ชื่อรายการ': name,
    'เนื้อสัตว์': v.meat,
    'ราคา (บาท)': v.price,
    'รูปภาพ': null,
    theme,
    available: true,
  }));
  // Add-on rows (รายการเสริม) are not dishes and never reach the grouping, so
  // "the count did not grow" would be true for reasons that have nothing to do
  // with a collision. Nothing to check for those.
  if (!groupDishRows(candidateRows).length) return false;

  const before = groupDishRows(existing).length;
  const after = groupDishRows([...existing, ...candidateRows]).length;
  return after === before;
}
