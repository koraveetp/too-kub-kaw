// ---------------------------------------------------------------------------
// Invoice number generator
// ---------------------------------------------------------------------------
// Builds the human-readable bill number stamped on an order the moment it is
// paid, in the form:
//
//     YYMMDD-D/N-0000
//        │     │   └── 4-digit running number, zero-padded, restarts each day
//        │     │       and is counted SEPARATELY per shift
//        │     └────── 'D' for a day-shift bill, 'N' for a night-shift bill
//        └──────────── today's date (2-digit year, month, day)
//
// e.g. the first day bill on 17 Jul 2026 → 260717-D-0001, the next → 260717-D-0002,
// and the first night bill that day → 260717-N-0001.
//
// The running number is derived from how many bills already carry an invoiceNo
// with the SAME date+shift prefix, so it needs no server-side counter and stays
// correct across restarts (the paid orders that hold the numbers are never
// deleted). Legacy orders that predate invoice numbers simply have none and are
// ignored by the count.
// ---------------------------------------------------------------------------

import { orderShift } from './shift';

// The YYMMDD-D/N- prefix an order's invoice number would start with today.
function invoicePrefix(order, now = new Date()) {
  const yy = String(now.getFullYear()).slice(-2);
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const shiftLetter = orderShift(order) === 'night' ? 'N' : 'D';
  return `${yy}${mm}${dd}-${shiftLetter}-`;
}

// Generate the next invoice number for `order`, given the full `orders` list it
// will live in. Counts existing invoice numbers sharing the same date+shift
// prefix and returns prefix + (count + 1), zero-padded to 4 digits.
//
// When settling several bills at once, pass a working list that already
// includes the invoice numbers assigned earlier in the batch, so each bill gets
// a distinct, sequential number (see handleClearAndPay in StaffView).
export function generateInvoiceNo(order, orders, now = new Date()) {
  const prefix = invoicePrefix(order, now);
  const used = (orders || []).reduce(
    (n, o) => (typeof o?.invoiceNo === 'string' && o.invoiceNo.startsWith(prefix) ? n + 1 : n),
    0
  );
  const running = String(used + 1).padStart(4, '0');
  return `${prefix}${running}`;
}
