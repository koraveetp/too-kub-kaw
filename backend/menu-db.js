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

import pg from 'pg';
import {
  menuRowsToMenu,
  addonRowsToAddons,
  choiceRowsToChoices,
} from './menu-transform.js';

const { Pool } = pg;

// One shared pool for the whole process (created lazily so importing this file
// without a DATABASE_URL set never throws).
let pool;
function getPool() {
  if (!pool) {
    const connectionString = (process.env.DATABASE_URL || '').trim();
    if (!connectionString) {
      throw new Error(
        'DATABASE_URL is not set. Add it to backend/.env, e.g. ' +
        'postgres://USER:PASSWORD@localhost:5432/restaurant'
      );
    }
    pool = new Pool({ connectionString });
  }
  return pool;
}

// Read menu_items and hand back rows keyed by the Thai column names, so the
// shared transforms in menu-transform.js can consume them unchanged.
async function fetchMenuRows() {
  const { rows } = await getPool().query(`
    SELECT category    AS "หมวดหมู่",
           type        AS "ประเภท",
           subcategory AS "หัวข้อ",
           name        AS "ชื่อรายการ",
           meat        AS "เนื้อสัตว์",
           price       AS "ราคา (บาท)",
           image_url   AS "รูปภาพ"
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
