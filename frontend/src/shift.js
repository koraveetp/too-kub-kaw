// ---------------------------------------------------------------------------
// Shift helpers (day / night)
// ---------------------------------------------------------------------------
// An order's `type` records which *shift* it was placed in, derived from the
// wall clock at the moment it was created — NOT from the visual theme the
// customer happened to be browsing. This lets staff screen the order board by
// shift and get notified only for the shift they are working.
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
