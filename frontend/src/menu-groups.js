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

// Extras to offer for one dish. Food and drinks get different lists — a bowl of
// ต้มข่าไก่ should not offer ไข่มุก, and a ชาเย็น should not offer ไข่ดาว.
// The night bar keeps a single list of its own.
export function addonsFor(addons, theme, item) {
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
  return (isDrinkItem(item) ? choices?.drink : choices?.food) || [];
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
