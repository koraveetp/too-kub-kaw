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

  // No open bill yet: this order opens the bill as round 1.
  if (idx === -1) {
    const items = newOrder.items.map(it => ({ ...it, round: 1, roundAt: newOrder.createdAt }));
    return [...prev, { ...newOrder, items }];
  }

  // Merge into the open bill as the next round.
  const existing = prev[idx];
  const nextRound = maxRound(existing.items) + 1;
  const addedItems = newOrder.items.map(it => ({
    ...it,
    round: nextRound,
    roundAt: newOrder.createdAt,
  }));
  const merged = {
    ...existing,
    items: [...existing.items, ...addedItems],
    total: (existing.total || 0) + (newOrder.total || 0),
    // New food went to the kitchen — reopen the bill so staff are alerted, even
    // if the earlier rounds were already served.
    status: 'new',
    // Keep the original createdAt (the bill's start); refresh the "last ordered"
    // time so the ticket footer shows the most recent round.
    time: newOrder.time,
    note: [existing.note, newOrder.note].filter(Boolean).join(' | '),
  };
  const next = [...prev];
  next[idx] = merged;
  return next;
}
