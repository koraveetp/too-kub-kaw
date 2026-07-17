-- ==========================================================
-- ตู้กับข้าวบ้านยาย — Menu database schema
-- Run this in pgAdmin Query Tool (one step at a time or all together)
-- ==========================================================

-- 1) The table that mirrors your Google Sheet
CREATE TABLE menu_items (
    id          SERIAL PRIMARY KEY,          -- auto number, you don't fill this
    category    TEXT NOT NULL,               -- หมวดหมู่  (อาหาร, เครื่องดื่ม, ...)
    type        TEXT NOT NULL,               -- ประเภท   (เมนูหลัก, รายการเสริม)
    subcategory TEXT,                        -- หัวข้อ   (เมนูราดข้าว, ชา, ...)
    name        TEXT NOT NULL,               -- ชื่อรายการ
    meat        TEXT,                         -- เนื้อสัตว์ ("-" becomes NULL, see step 3)
    price       INTEGER NOT NULL DEFAULT 0,  -- ราคา (บาท)
    image_url   TEXT                          -- รูปภาพ
);

-- ==========================================================
-- 2) Import the CSV  -> do this with the GUI (see chat steps),
--    OR use this COPY command if the file path is reachable.
--    On a local Mac install, put the file somewhere readable, e.g.:
-- ==========================================================
-- COPY menu_items (category, type, subcategory, name, meat, price, image_url)
-- FROM '/Users/punnawit/Downloads/Copy of ตู้กับข้าวบ้านยาย Menu - Menu_Main.csv'
-- WITH (FORMAT csv, HEADER true, ENCODING 'UTF8');

-- ==========================================================
-- 3) Clean-up after import (optional but recommended)
-- ==========================================================
-- Turn the "-" and empty strings into real NULLs
UPDATE menu_items SET meat = NULL      WHERE meat = '-' OR meat = '';
UPDATE menu_items SET image_url = NULL WHERE image_url = '';

-- ==========================================================
-- 4) Check it worked
-- ==========================================================
-- SELECT COUNT(*) FROM menu_items;                 -- should be 136
-- SELECT * FROM menu_items ORDER BY id LIMIT 20;
-- SELECT DISTINCT category FROM menu_items;         -- see your 4 categories
