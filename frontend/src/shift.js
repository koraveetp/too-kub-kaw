// ---------------------------------------------------------------------------
// Shift helpers (day / night)
// ---------------------------------------------------------------------------
// An order's `type` records which *shift* it was placed in, taken from the
// menu/theme it was ordered from — a day-menu order is 'day', a night-menu
// order is 'night' — so a day order always shows on the day board and a night
// order on the night board, no matter the wall clock. This lets staff screen
// the order board by shift and get notified only for the shift they work.
//
// The clock helpers below decide the shift for a table QR scan (a plain
// ?table=N link opens whichever shop is running right now), and are also the
// fallback for legacy orders saved before `type` existed:
//
//   day   = 06:00–17:59
//   night = 18:00–05:59
// ---------------------------------------------------------------------------

// The line is drawn on Bangkok time, not the device clock. The shop is in
// Thailand, but the phone scanning the QR need not be set to Thai time — a
// tourist's handset still on its home timezone would otherwise be handed the
// day menu at 20:00 Bangkok, and its order would land on the wrong board.
const BANGKOK_HOUR = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Bangkok',
  hour: 'numeric',
  // h23 explicitly: `hour12: false` renders midnight as "24" on some engines.
  hourCycle: 'h23',
});

// The hour (0–23) it is in Thailand at the given moment.
export function bangkokHour(date = new Date()) {
  return Number(BANGKOK_HOUR.format(date));
}

// Which shift does a given Date fall in?
export function shiftFromDate(date) {
  const hour = bangkokHour(date);
  return hour >= 6 && hour < 18 ? 'day' : 'night';
}

// The shift right now — used when stamping a brand-new order.
export function shiftNow() {
  return shiftFromDate(new Date());
}

// --- The working day (for the time clock) -----------------------------------
// A shop day is NOT a calendar day: the night side closes after midnight, so a
// worker who clocks in at 20:00 and out at 01:30 has to land on ONE record. The
// day therefore runs 06:00 today → 06:00 tomorrow, and everything before 06:00
// counts as the previous date — the same boundary the day/night split uses.
export const WORKDAY_START_HOUR = 6;

// The date key ('YYYY-MM-DD') of the working day a moment belongs to. Shifting
// the clock back by the start hour turns "06:00-based day" into a plain local
// calendar date, so 2 AM on the 27th keys as the 26th.
export function workdayKey(at = new Date()) {
  const d = new Date(at);
  d.setHours(d.getHours() - WORKDAY_START_HOUR);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// A key that changes whenever EITHER the working day rolls over OR the shift
// flips day↔night — e.g. '2026-08-08-day', then '2026-08-08-night' at 18:00,
// then '2026-08-09-day' at 06:00. The whole night side (18:00 → 05:59) shares
// one key because workdayKey already folds after-midnight back onto the same
// date. The เช็กบิล lock is scoped to this: a phone that paid on the day side
// unlocks itself once the shop turns to the night side (or the next working day
// begins), so a lunch group returning for dinner scans the same table back in —
// while the group that just paid stays locked for the rest of the current shift.
export function shiftKey(at = new Date()) {
  const d = new Date(at);
  return `${workdayKey(d)}-${shiftFromDate(d)}`;
}

// Read an order's shift, tolerating legacy orders saved before `type` existed:
// fall back to the shift implied by their createdAt timestamp, and finally to
// 'day' if even that is missing.
export function orderShift(order) {
  if (order?.type === 'day' || order?.type === 'night') return order.type;
  if (order?.createdAt) return shiftFromDate(new Date(order.createdAt));
  return 'day';
}
