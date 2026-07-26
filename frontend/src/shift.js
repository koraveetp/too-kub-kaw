// ---------------------------------------------------------------------------
// Shift helpers (day / night)
// ---------------------------------------------------------------------------
// An order's `type` records which *shift* it was placed in, taken from the
// menu/theme it was ordered from — a day-menu order is 'day', a night-menu
// order is 'night' — so a day order always shows on the day board and a night
// order on the night board, no matter the wall clock. This lets staff screen
// the order board by shift and get notified only for the shift they work.
//
// The clock helpers below are kept only as a fallback for legacy orders saved
// before `type` existed:
//
//   day   = 06:00–17:59
//   night = 18:00–05:59
// ---------------------------------------------------------------------------

// Which shift does a given Date fall in?
export function shiftFromDate(date) {
  const hour = date.getHours();
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

// Read an order's shift, tolerating legacy orders saved before `type` existed:
// fall back to the shift implied by their createdAt timestamp, and finally to
// 'day' if even that is missing.
export function orderShift(order) {
  if (order?.type === 'day' || order?.type === 'night') return order.type;
  if (order?.createdAt) return shiftFromDate(new Date(order.createdAt));
  return 'day';
}
