// ---------------------------------------------------------------------------
// Expense bookkeeping
// ---------------------------------------------------------------------------
// The owner records every outgoing (ingredients, wages, rent, bills...) against
// one of the two shops. An expense is stored as:
//
//   { id, date: 'YYYY-MM-DD', shop: 'day' | 'night', category, amount, note, createdAt }
//
// `date` is a plain local calendar day, NOT a timestamp: an expense belongs to
// the day the owner says it does, and must not shift when read in another
// timezone (which is exactly what storing an epoch would do). `createdAt` keeps
// the real entry time, only for ordering entries made on the same day.
// ---------------------------------------------------------------------------

// The two shops, keyed by the shift they trade in. The ids match an order's
// `type`/shift so revenue and expenses can be totalled per shop later.
export const SHOPS = [
  { id: 'day', label: 'ตู้กับข้าวบ้านยาย' },
  { id: 'night', label: 'เรินเก่า' },
];

export function shopLabel(id) {
  return SHOPS.find((s) => s.id === id)?.label || id;
}

// Fixed category list for the dropdown. 'อื่น ๆ' is the catch-all — the note
// field is where the owner explains it.
export const EXPENSE_CATEGORIES = [
  'ค่าวัตถุดิบ',
  'ค่าอุปกรณ์',
  'ค่าแรงพนักงาน',
  'ค่าเช่าที่',
  'ค่าน้ำ',
  'ค่าไฟ',
  'อื่น ๆ',
];

// Today as 'YYYY-MM-DD' in LOCAL time. (toISOString() would return UTC and so
// roll over to tomorrow during the night shift, filing bills under the wrong day.)
export function todayKey(now = new Date()) {
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

const THAI_MONTHS_SHORT = [
  'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
  'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.',
];

export const THAI_MONTHS_FULL = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
];

// 'YYYY-MM-DD' -> '18 ก.ค. 2569' (Buddhist era, as the owner reads dates).
export function formatThaiDate(dateKey) {
  const [y, m, d] = (dateKey || '').split('-').map(Number);
  if (!y || !m || !d) return dateKey || '';
  return `${d} ${THAI_MONTHS_SHORT[m - 1]} ${y + 543}`;
}

// Sum a list of expenses, tolerating entries whose amount never parsed.
export function sumExpenses(list) {
  return (list || []).reduce((n, e) => n + (Number(e?.amount) || 0), 0);
}
