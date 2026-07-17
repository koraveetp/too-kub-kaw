// ---------------------------------------------------------------------------
// Menu row -> app shape transforms (source-agnostic)
// ---------------------------------------------------------------------------
// These pure functions map one-row-per-variant menu data onto the shape the
// app expects. They know nothing about WHERE the rows came from — the
// PostgreSQL bridge (menu-db.js) feeds them rows keyed by the same Thai column
// names the data was originally authored with.
//
//     { id, name, price, category, group, theme, emoji, image, desc,
//       options, available }
//
// One normalised row per sellable variant:
//
//   หมวดหมู่     อาหาร | เพิ่มเติม | ของหวาน | เครื่องดื่ม   -> food/drink group
//   ประเภท       เมนูหลัก (a dish) | รายการเสริม (an add-on)
//   หัวข้อ        เมนูราดข้าว, อาหารจานเดียว, ชา, กาแฟ ...   -> section heading
//   ชื่อรายการ    dish name
//   เนื้อสัตว์     protein for this row, or "-" -> becomes an `options` entry
//   ราคา (บาท)   price for this row
//   รูปภาพ       image URL (shared by every variant of a dish)
//
// Rows sharing (หัวข้อ + ชื่อรายการ) are merged into ONE dish whose `options`
// list carries the protein choices, e.g. ทอดน้ำปลาราดข้าว -> หมู/ไก่/หมูกรอบ/ทะเล.
// ---------------------------------------------------------------------------

// Column names, kept here so a schema rename is a one-line fix.
const COL = {
  group: 'หมวดหมู่',
  kind: 'ประเภท',
  heading: 'หัวข้อ',
  name: 'ชื่อรายการ',
  protein: 'เนื้อสัตว์',
  price: 'ราคา (บาท)',
  image: 'รูปภาพ',
};

const KIND_DISH = 'เมนูหลัก';       // a sellable dish
const KIND_ADDON = 'รายการเสริม';   // an optional extra, not a dish
const DRINK_GROUP = 'เครื่องดื่ม';   // หมวดหมู่ value that means "drink"

// รายการเสริม rows split by their หัวข้อ into two different controls:
//   CHOICE_HEADINGS -> pick exactly one (radio), e.g. ไซส์ M *or* ไซส์ L
//   everything else -> tick as many as you like (checkbox), e.g. ท็อปปิ้ง
const CHOICE_HEADINGS = ['ขนาด', 'ระดับความหวาน'];

// --- Cell helpers -----------------------------------------------------------

// Value -> usable number. Accepts a number (55) or a string ("55", "55 บาท",
// "-", ""). Returns `fallback` for anything that isn't a usable figure.
export function toNumber(value, fallback = 0) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : fallback;
  const raw = String(value ?? '').trim();
  if (!raw || raw === '-') return fallback;
  const n = Number(raw.replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : fallback;
}

// Cell -> trimmed string. "-" is the "not applicable" marker, so it reads as
// empty.
export function text(value) {
  const raw = String(value ?? '').trim();
  return raw === '-' ? '' : raw;
}

// --- Emoji fallback ---------------------------------------------------------

// Pick a fitting emoji from the dish name so the menu isn't a wall of 🍽️.
// Ordered most-specific first (protein/ingredient, then cooking style).
// Used only as a fallback for the rows with no รูปภาพ.
const EMOJI_RULES = [
  ['ทะเล', '🦐'], ['กุ้ง', '🍤'], ['หอย', '🐚'], ['ปู', '🦀'],
  ['ปลาดุก', '🐟'], ['ปลาเค็ม', '🐟'], ['ปลา', '🐟'],
  ['กบ', '🐸'], ['หมูป่า', '🐗'], ['หมูกรอบ', '🥓'], ['หมู', '🐷'],
  ['เนื้อ', '🥩'], ['ไก่', '🍗'], ['ไข่', '🍳'],
  ['ต้มข่า', '🥥'], ['ต้มจืด', '🍲'], ['ต้มโคล้ง', '🍲'], ['ต้ม', '🍲'],
  ['แกงส้ม', '🥘'], ['แกง', '🥘'], ['สะตอ', '🫛'],
  ['ข้าวผัด', '🍚'], ['ผัดซีอิ๊ว', '🍜'], ['ราดหน้า', '🍜'],
  ['กะเพรา', '🌿'], ['ผัด', '🍳'], ['ข้าว', '🍚'],
  // Drinks & sweets
  ['ไข่มุก', '🧋'], ['เฉาก๊วย', '🍮'], ['บุก', '🍮'], ['นม', '🥛'],
  ['โกโก้', '🍫'], ['เอสเปรสโซ่', '☕'], ['ลาเต้', '☕'], ['คาปูชิโน่', '☕'],
  ['มอคค่า', '☕'], ['อเมริกาโน่', '☕'], ['กาแฟ', '☕'],
  ['โซดา', '🥤'], ['ชา', '🍵'],
];

function emojiFor(name) {
  for (const [kw, emoji] of EMOJI_RULES) {
    if (name.includes(kw)) return emoji;
  }
  return '🍽️';
}

// The data is inconsistent about where the protein lives: เมนูราดข้าว rows keep
// the name clean ("ทอดน้ำปลาราดข้าว" + เนื้อสัตว์ "หมู"), while เมนูต้ม rows repeat
// it in the name ("ต้มจืดเต้าหู้ หมูสับ" + เนื้อสัตว์ "หมูสับ"). Strip the trailing
// protein so both conventions group into one dish.
function stripTrailingProtein(name, protein) {
  if (!protein || !name.endsWith(protein)) return name;
  const base = name.slice(0, -protein.length).trim();
  return base || name; // a dish named only after its protein keeps its name
}

// Stable, readable id derived from the dish identity rather than row position,
// so an owner's `available` toggle survives rows being reordered.
function idFor(heading, name) {
  let hash = 0;
  const key = `${heading}|${name}`;
  for (let i = 0; i < key.length; i++) {
    hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  }
  return `d${hash.toString(36)}`;
}

// Map cleaned rows onto menu items.
export function menuRowsToMenu(rows) {
  // Only real dishes. `รายการเสริม` rows are add-ons (ไข่ดาว, ท็อปปิ้ง, ขนาด,
  // ระดับความหวาน) and must not appear as cards in the menu.
  const dishRows = rows.filter((r) => text(r[COL.kind]) === KIND_DISH);

  // Pass 1 — bucket rows by (heading|name), preserving first-seen order.
  const groups = [];
  const byKey = new Map();
  for (const row of dishRows) {
    const rawName = text(row[COL.name]);
    if (!rawName) continue; // ignore rows with no dish name

    const protein = text(row[COL.protein]); // "" when the source says "-"
    const baseName = stripTrailingProtein(rawName, protein);
    const heading = text(row[COL.heading]);
    const key = `${heading}|${baseName}`;
    let g = byKey.get(key);
    if (!g) {
      g = {
        name: baseName,
        heading,
        group: text(row[COL.group]) === DRINK_GROUP ? 'drink' : 'food',
        image: text(row[COL.image]),
        rows: [],
      };
      byKey.set(key, g);
      groups.push(g);
    }
    if (!g.image) g.image = text(row[COL.image]); // first variant that has one
    g.rows.push({ rawName, protein, price: toNumber(row[COL.price], 0) });
  }

  // Pass 2 — emit one menu item per group.
  return groups.map((g) => {
    const variants = g.rows.filter((r) => r.protein);
    // 2+ protein variants -> a single dish with selectable options.
    const options = variants.length >= 2
      ? variants.map((r) => ({ name: r.protein, price: r.price }))
      : [];
    const price = options.length
      ? Math.min(...options.map((o) => o.price)) // "starts at" price
      : toNumber(g.rows[0]?.price, 0);
    // With no choice to offer, the protein is part of the dish's identity —
    // keep the original wording ("ผัดเผ็ดราดข้าว หมู") rather than the stripped
    // base name.
    const name = options.length ? g.name : g.rows[0].rawName;

    return {
      id: idFor(g.heading, name),
      name,
      price,
      category: g.heading || 'อื่นๆ',
      group: g.group,
      theme: 'day', // the database holds the daytime menu
      emoji: emojiFor(g.name),
      image: g.image,
      desc: '',
      options,
      available: true,
    };
  });
}

// Map the `รายการเสริม` rows onto the tick-box extras shown in the order
// dialog, split by which storefront they belong to:
//
//   food  — ไข่ดาว, ไข่เจียว, เป็นกับข้าว, สั่งกลับบ้าน
//   drink — ท็อปปิ้ง
//
// Rows whose หัวข้อ is a CHOICE_HEADING are handled by choiceRowsToChoices()
// instead: as tick-boxes they would let a customer order both ไซส์ M and
// ไซส์ L, or two sweetness levels at once.
export function addonRowsToAddons(rows) {
  const addonRows = rows.filter((r) => text(r[COL.kind]) === KIND_ADDON);
  const out = { food: [], drink: [] };

  for (const row of addonRows) {
    const name = text(row[COL.name]);
    if (!name) continue;
    if (CHOICE_HEADINGS.includes(text(row[COL.heading]))) continue;

    const bucket = text(row[COL.group]) === DRINK_GROUP ? out.drink : out.food;
    // สั่งกลับบ้าน is listed under both อาหาร and เพิ่มเติม — keep it once.
    if (bucket.some((a) => a.name === name)) continue;

    bucket.push({ id: idFor('addon', name), name, price: toNumber(row[COL.price], 0) });
  }
  return out;
}

// Map the pick-exactly-one รายการเสริม rows onto choice groups:
//
//   { name: 'ขนาด',           options: [ไซส์ M +0, ไซส์ L +5] }
//   { name: 'ระดับความหวาน',  options: [100%, 50%, 25%, 0%, 120%] }
//
// Row order is preserved and the FIRST option of each group is the default,
// which is why 100% (หวานปกติ) leading the sweetness rows matters.
export function choiceRowsToChoices(rows) {
  const addonRows = rows.filter((r) => text(r[COL.kind]) === KIND_ADDON);
  const out = { food: [], drink: [] };

  for (const row of addonRows) {
    const heading = text(row[COL.heading]);
    if (!CHOICE_HEADINGS.includes(heading)) continue;
    const name = text(row[COL.name]);
    if (!name) continue;

    const bucket = text(row[COL.group]) === DRINK_GROUP ? out.drink : out.food;
    let group = bucket.find((g) => g.name === heading);
    if (!group) {
      group = { id: idFor('choice', heading), name: heading, options: [] };
      bucket.push(group);
    }
    if (group.options.some((o) => o.name === name)) continue;
    group.options.push({ name, price: toNumber(row[COL.price], 0) });
  }

  // A group with one option is not a choice — hide it rather than show a radio
  // button that cannot be changed.
  for (const key of ['food', 'drink']) {
    out[key] = out[key].filter((g) => g.options.length >= 2);
  }
  return out;
}
