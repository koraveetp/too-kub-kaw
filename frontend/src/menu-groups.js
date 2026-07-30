// Which storefront a menu item belongs to, and which extras go with it.
// Shared by CustomerView and StaffView so the two order dialogs can never
// drift apart on what they offer.

// Items synced from the Google Sheet carry `group` ('food' | 'drink') straight
// from its หมวดหมู่ column. This list is only a fallback for items that predate
// that field: the hand-curated night menu, or a stored menu from an older sync.
export const DRINK_CATEGORIES = new Set([
  'เครื่องดื่ม',
  'ชา',
  'ชาผลไม้',
  'กาแฟ',
  'โกโก้ นม',
  'น้ำผลไม้โซดา',
  'ท็อปปิ้ง',
]);

export function isDrinkItem(item) {
  if (!item) return false;
  return item.group ? item.group === 'drink' : DRINK_CATEGORIES.has(item.category);
}

// Headings (the menu's หัวข้อ, exposed as `category`) that are served straight to
// the table — cold towels, desserts, pre-packed snacks. Like drinks, they take
// no plated-food extras: a ผ้าเย็น or ข้าวเหนียวมะม่วง should never offer ไข่ดาว,
// สั่งกลับบ้าน or เป็นกับข้าว. Mirrors NON_KITCHEN_HEADINGS in kitchen.js.
const NO_FOOD_ADDON_HEADINGS = new Set(['ผ้าเย็น', 'ของหวาน', 'ขนมหวาน', 'ขนมขบเคี้ยว']);

// Headings for drinks that come pre-packaged from stock — bottled/canned, served
// as-is (น้ำในสต็อก): water, soft drinks, beer, wine, spirits, ciders. Unlike a
// made-to-order cup (ชา, กาแฟ, โกโก้, ชาผลไม้, น้ำผลไม้โซดา), a sealed can of โค้ก
// or a bottle of เบียร์ can't be "50% sweet" or take ไข่มุก, so it offers no
// sweetness level and no toppings. Its ขนาด choice (if any) is left alone.
const PACKAGED_DRINK_HEADINGS = new Set([
  'น้ำดื่ม', 'น้ำเปล่า', 'น้ำอัดลม',
  'เบียร์', 'เบียร์คราฟต์', 'เบียร์ขาว',
  'ไวน์', 'ไวน์คูลเลอร์', 'ไซเดอร์', 'บรั่นดี รัม',
]);

function isPackagedDrink(item) {
  return PACKAGED_DRINK_HEADINGS.has(item?.category);
}

// Extras to offer for one dish. Food and drinks get different lists — a bowl of
// ต้มข่าไก่ should not offer ไข่มุก, and a ชาเย็น should not offer ไข่ดาว.
// The night bar keeps a single list of its own.
export function addonsFor(addons, theme, item) {
  // Packaged drinks (bottled/canned) take no extras (no toppings) in any storefront.
  if (isPackagedDrink(item)) return [];
  if (theme === 'night') return addons?.night || [];
  if (isDrinkItem(item)) return addons?.drink || [];
  // Non-course food (desserts, snacks, cold towels) offers no plated-food extras.
  if (NO_FOOD_ADDON_HEADINGS.has(item?.category)) return [];
  return addons?.food || [];
}

// Pick-exactly-one groups for one dish, e.g. ขนาด (ไซส์ M/L) and
// ระดับความหวาน for drinks. Unlike addons these always have a value.
export function choicesFor(choices, theme, item) {
  if (theme === 'night') return [];
  const list = (isDrinkItem(item) ? choices?.drink : choices?.food) || [];
  // Packaged drinks drop the sweetness level; any other group (e.g. ขนาด) stays.
  return isPackagedDrink(item) ? list.filter((g) => !String(g?.name).includes('หวาน')) : list;
}

// The default selection for every group: the sheet's first option.
// Shape: { 'ขนาด': { name: 'ไซส์ M', price: 0 }, ... }
export function defaultChoices(groups) {
  const picked = {};
  for (const group of groups) {
    if (group.options?.length) picked[group.name] = group.options[0];
  }
  return picked;
}

// What the selected choices add to the dish price.
export function choicesCost(picked) {
  return Object.values(picked || {}).reduce((sum, o) => sum + (o?.price || 0), 0);
}
