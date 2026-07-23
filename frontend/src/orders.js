// ---------------------------------------------------------------------------
// Order helpers — bill merging & rounds
// ---------------------------------------------------------------------------
// While a table has not checked out yet, every additional order it sends to the
// kitchen is folded into that table's ONE open bill instead of starting a
// separate one. Each batch of items keeps a `round` number so the ticket can
// draw a divider between "the first order" and "ordered more later".
//
// A bill is considered OPEN (mergeable) when it is the same table, the same
// shift, and not yet paid or cancelled — the same predicate the table-status
// and customer-session views use.
// ---------------------------------------------------------------------------

import { orderShift } from './shift';

// An item with no `round` (placed before this feature, or the very first batch)
// counts as round 1.
export function itemRound(item) {
  return item?.round || 1;
}

// ---------------------------------------------------------------------------
// Per-item kitchen status
// ---------------------------------------------------------------------------
// Every dish on a bill moves through the kitchen on its own:
//   'new'     รับออเดอร์  — just landed, not started
//   'cooking' อยู่ในครัว  — being prepared
//   'served'  เสิร์ฟแล้ว  — delivered to the table
// เช็กบิล (paid) stays a whole-bill state, set when the table checks out.
export const ITEM_STATUS_FLOW = ['new', 'cooking', 'served'];

// An item placed before this feature (or restored from old data) has no
// `status` and counts as freshly received.
export function itemStatus(item) {
  return item?.status || 'new';
}

// Roll the per-item statuses up into the ONE bill-level status the boards,
// new-order chime and reports already key on. 'paid'/'cancelled' are terminal
// whole-bill states owned elsewhere and are never produced here.
//   - all dishes served            -> 'served'
//   - anything still 'new'          -> 'new'    (kitchen has unstarted work)
//   - otherwise (all started, some
//     served, none pending)         -> 'cooking'
export function deriveBillStatus(items) {
  const list = items || [];
  if (list.length === 0) return 'new';
  if (list.every(it => itemStatus(it) === 'served')) return 'served';
  if (list.some(it => itemStatus(it) === 'new')) return 'new';
  return 'cooking';
}

// Return a copy of `order` with one item's status changed and the bill-level
// status re-derived to match. Callers guard against paid/cancelled bills.
export function withItemStatus(order, itemIndex, status) {
  const items = order.items.map((it, i) => (i === itemIndex ? { ...it, status } : it));
  return { ...order, items, status: deriveBillStatus(items) };
}

// Highest round currently on a bill.
function maxRound(items) {
  return (items || []).reduce((m, it) => Math.max(m, itemRound(it)), 1);
}

// Fold `newOrder` into the table's existing open bill as the next round, or —
// if the table has no open bill — add it as a fresh bill whose items are round
// 1. Returns the next `orders` array (never mutates `prev`).
export function mergeOrder(prev, newOrder) {
  const idx = prev.findIndex(o =>
    String(o.table) === String(newOrder.table) &&
    orderShift(o) === orderShift(newOrder) &&
    o.status !== 'paid' &&
    o.status !== 'cancelled'
  );

  // No open bill yet: this order opens the bill as round 1. Every dish starts
  // at 'new' (รับออเดอร์) so staff can walk it through the kitchen.
  if (idx === -1) {
    const items = newOrder.items.map(it => ({
      ...it,
      status: it.status || 'new',
      round: 1,
      roundAt: newOrder.createdAt,
    }));
    return [...prev, { ...newOrder, items, status: deriveBillStatus(items) }];
  }

  // Merge into the open bill as the next round.
  const existing = prev[idx];
  const nextRound = maxRound(existing.items) + 1;
  const addedItems = newOrder.items.map(it => ({
    ...it,
    status: it.status || 'new',
    round: nextRound,
    roundAt: newOrder.createdAt,
  }));
  const mergedItems = [...existing.items, ...addedItems];
  const merged = {
    ...existing,
    items: mergedItems,
    total: (existing.total || 0) + (newOrder.total || 0),
    // New food went to the kitchen — the freshly added 'new' dishes pull the
    // derived bill status back to 'new', reopening it so staff are alerted even
    // if the earlier rounds were already served.
    status: deriveBillStatus(mergedItems),
    // Keep the original createdAt (the bill's start); refresh the "last ordered"
    // time so the ticket footer shows the most recent round.
    time: newOrder.time,
    note: [existing.note, newOrder.note].filter(Boolean).join(' | '),
  };
  const next = [...prev];
  next[idx] = merged;
  return next;
}
