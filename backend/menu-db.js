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
} from './menu-transform.js';

// Read menu_items and hand back rows keyed by the Thai column names, so the
// shared transforms in menu-transform.js can consume them unchanged.
// Does menu_items carry the day/night `theme` column yet? A table created
// before the night menu existed does not, so it is detected once rather than
// assumed — that way starting the server before running the ALTER prints a hint
// instead of crashing with a bare "column does not exist".
let themeColumn = null;
async function hasThemeColumn() {
  if (themeColumn === null) {
    const { rows } = await getPool().query(`
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'menu_items' AND column_name = 'theme'
      LIMIT 1
    `);
    themeColumn = rows.length > 0;
    if (!themeColumn) {
      console.warn(
        '[backend] menu_items has no "theme" column — treating every item as ' +
        'the DAY menu. Add it with:  ALTER TABLE menu_items ADD COLUMN theme TEXT;'
      );
    }
  }
  return themeColumn;
}

async function fetchMenuRows() {
  // `theme` keeps its English name: it is a database concept, not a column that
  // ever existed in the spreadsheet the Thai aliases mirror.
  const themeSelect = (await hasThemeColumn())
    ? `COALESCE(theme, 'day') AS theme`
    : `'day' AS theme`;

  const { rows } = await getPool().query(`
    SELECT category    AS "หมวดหมู่",
           type        AS "ประเภท",
           subcategory AS "หัวข้อ",
           name        AS "ชื่อรายการ",
           meat        AS "เนื้อสัตว์",
           price       AS "ราคา (บาท)",
           image_url   AS "รูปภาพ",
           ${themeSelect}
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
