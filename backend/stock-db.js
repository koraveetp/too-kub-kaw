// ---------------------------------------------------------------------------
// PostgreSQL -> stock (คลังวัตถุดิบ) bridge
// ---------------------------------------------------------------------------
// Reads the staff inventory straight from the `stock_items` table (created and
// loaded from the CSV via stock_schema.sql). Columns: id, category, name,
// quantity, image_url.
//
// This is deliberately separate from the in-memory `stock` used to validate and
// deduct drink stock while taking an order — that path is untouched. This module
// backs only the "คลังวัตถุดิบ" tab in the staff view.
//
// Connection string comes from backend/.env (DATABASE_URL).
// ---------------------------------------------------------------------------

import { getPool } from './db.js';

// The whole inventory, newest categories grouped together, then by name (Thai
// collation so the list reads naturally).
export async function fetchStockItems() {
  const { rows } = await getPool().query(`
    SELECT id, category, name, quantity, image_url AS "imageUrl"
    FROM stock_items
    ORDER BY category, name
  `);
  return rows;
}

// Just the names and remaining quantities — the customer storefront reads this
// (no auth) so it can grey out a dish whose linked stock has run out. Kept
// deliberately minimal: no ids, images or categories leak to the public.
export async function fetchStockAvailability() {
  const { rows } = await getPool().query(`
    SELECT name, quantity FROM stock_items
  `);
  return rows;
}

// Create a new inventory row, or — if one with the same name already exists —
// top it up by `quantity`. This is what the owner's "อัพเดทสตอก" action calls
// when it files a dish and its stock together: matching by name keeps a single
// row per product and lets the customer storefront link the two automatically.
export async function createStockItem({ category, name, quantity, imageUrl }) {
  const pool = getPool();
  const updated = await pool.query(
    `UPDATE stock_items
     SET quantity  = quantity + $2,
         category  = COALESCE(NULLIF($3, ''), category),
         image_url = COALESCE(NULLIF($4, ''), image_url)
     WHERE LOWER(TRIM(name)) = LOWER(TRIM($1))
     RETURNING id, category, name, quantity, image_url AS "imageUrl"`,
    [name, quantity, category, imageUrl || null]
  );
  if (updated.rows[0]) return updated.rows[0];

  const inserted = await pool.query(
    `INSERT INTO stock_items (category, name, quantity, image_url)
     VALUES ($1, $2, $3, $4)
     RETURNING id, category, name, quantity, image_url AS "imageUrl"`,
    [category, name, quantity, imageUrl || null]
  );
  return inserted.rows[0];
}

// Deduct `qty` from the row whose name matches the dish (or restore it when
// `qty` is negative — un-serving a mis-tap). Same LOWER(TRIM(...)) match as
// createStockItem, so the dish↔stock link stays name-based end to end. Never
// below 0. Returns the updated row, or null when no row matches — a dish with
// no linked stock is simply a no-op.
export async function consumeStockByName(name, qty) {
  const { rows } = await getPool().query(
    `UPDATE stock_items
     SET quantity = GREATEST(0, quantity - $2)
     WHERE LOWER(TRIM(name)) = LOWER(TRIM($1))
     RETURNING id, category, name, quantity, image_url AS "imageUrl"`,
    [name, qty]
  );
  return rows[0] || null;
}

// Add `delta` (may be negative) to one item's quantity, never dropping below 0.
// Returns the updated row, or null if the id matched nothing.
export async function adjustStockItem(id, delta) {
  const { rows } = await getPool().query(
    `UPDATE stock_items
     SET quantity = GREATEST(0, quantity + $2)
     WHERE id = $1
     RETURNING id, category, name, quantity, image_url AS "imageUrl"`,
    [id, delta]
  );
  return rows[0] || null;
}

// Bump every item by `delta` (the "เติมทั้งหมด" buttons). Returns how many rows
// changed.
export async function restockAll(delta) {
  const { rowCount } = await getPool().query(
    `UPDATE stock_items SET quantity = GREATEST(0, quantity + $1)`,
    [delta]
  );
  return rowCount;
}
