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

// Read an order's shift, tolerating legacy orders saved before `type` existed:
// fall back to the shift implied by their createdAt timestamp, and finally to
// 'day' if even that is missing.
export function orderShift(order) {
  if (order?.type === 'day' || order?.type === 'night') return order.type;
  if (order?.createdAt) return shiftFromDate(new Date(order.createdAt));
  return 'day';
}
