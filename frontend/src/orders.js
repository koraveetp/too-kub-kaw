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
// Checkout / billing lifecycle (เช็กบิล)
// ---------------------------------------------------------------------------
// While a bill is open a table can keep ordering. Once เช็กบิล starts, the bill
// moves through two stages before it is finally settled (paid):
//   'requested' — the customer tapped เช็กบิล on their phone; ordering is LOCKED
//                 and the staff board shows "โต๊ะ X ขอเช็กบิล" so they know to
//                 print the bill (and grab the ถุงเงิน phone for คนละครึ่ง).
//   'printed'   — staff printed the receipt; only now do the "ประเภทเงินที่ได้รับ
//                 จริง" buttons (เงินสด / สแกน QR / คนละครึ่ง) appear on the card.
// Picking a money type settles the bill (status 'paid') and frees the table.
//
// `type` records which checkout the customer chose so staff know whether to
// bring the ถุงเงิน phone: 'normal' (เงินสด/QR ร้าน) | 'split' (คนละครึ่ง).
export const CHECKOUT_TYPE_LABELS = {
  normal: 'เช็กบิลปกติ',
  split: 'เช็กบิลคนละครึ่ง',
};

// The actual money the shop received, chosen by staff at settle time. This is
// what the owner's reports split the takings by.
export const PAY_METHOD_LABELS = {
  cash: 'เงินสด',
  qr: 'สแกน QR',
  split: 'คนละครึ่ง',
};

// The current checkout stage of a bill, or null when it is still open.
export function checkoutStage(order) {
  return order?.checkout?.stage || null;
}

// A bill is "in checkout" (customer ordering must be locked) once เช็กบิล has
// been requested or the receipt has been printed — but not once it is paid.
export function isCheckoutLocked(order) {
  const s = checkoutStage(order);
  return s === 'requested' || s === 'printed';
}

// ---------------------------------------------------------------------------
// Per-item lifecycle (5 states)
// ---------------------------------------------------------------------------
// Every dish on a bill moves through the kitchen on its own:
//   'received'    รับออเดอร์  — just landed (drinks live here until served)
//   'in_kitchen'  อยู่ในครัว  — on the kitchen board, waiting to be batched/cooked
//   'in_progress' กำลังทำ     — the cook has started it (batch is locked)
//   'completed'   เสร็จแล้ว   — cooked & done; leaves the kitchen board here
//   'served'      เสิร์ฟแล้ว  — delivered to the table (tracked on the order board)
// เช็กบิล (paid) stays a whole-bill state, set when the table checks out.
//
// Food skips 'received': it is auto-placed on the kitchen board ('in_kitchen')
// the moment the order is sent. Drinks never reach the kitchen, so they sit at
// 'received' until staff mark them 'served' from the order-taking tab.
export const ITEM_STATUSES = ['received', 'in_kitchen', 'in_progress', 'completed', 'served'];

// Kept for backwards-compatible imports; the order-taking tab now builds a
// context-specific flow via statusFlowFor().
export const ITEM_STATUS_FLOW = ITEM_STATUSES;

// The statuses that put a dish on the kitchen board. A dish drops off the board
// the moment it is marked 'completed' (เสร็จแล้ว) — delivery/serving is then
// tracked on the order board, not here.
export const KITCHEN_STATUSES = ['in_kitchen', 'in_progress'];

export const ITEM_STATUS_LABELS = {
  received: 'รับออเดอร์',
  in_kitchen: 'อยู่ในครัว',
  in_progress: 'กำลังทำ',
  completed: 'เสร็จแล้ว',
  served: 'เสิร์ฟแล้ว',
};

export const ITEM_STATUS_COLORS = {
  received: 'bg-[#FDECC8] text-[#8a5a00]',
  in_kitchen: 'bg-[#DCE9F7] text-[#2F5D8A]',
  in_progress: 'bg-[#E6DAF7] text-[#5B3A9A]',
  completed: 'bg-[#DCEFE0] text-[#2C6E49]',
  served: 'bg-[#DFF0E3] text-[#2C6E49]',
};

// Is this order line a drink? Drinks are filtered off the kitchen board and
// have a shorter lifecycle. Uses the `group` stamped at order time; older items
// without it read as food (the safe default — food never gets wrongly hidden).
export function isDrinkItem(item) {
  return item?.group === 'drink';
}

// Normalise any stored status onto the 5-state vocabulary, healing legacy rows
// written before this feature ('new'/'cooking'). A legacy 'new' drink becomes
// 'received'; a legacy 'new' food becomes 'in_kitchen' (its auto-placed state).
export function normalizeItemStatus(item) {
  const s = item?.status;
  if (!s || s === 'new') return isDrinkItem(item) ? 'received' : 'in_kitchen';
  if (s === 'cooking') return 'in_progress';
  return ITEM_STATUSES.includes(s) ? s : 'in_kitchen';
}

// Public alias — components read the normalised status through this name.
export function itemStatus(item) {
  return normalizeItemStatus(item);
}

// The statuses a staff member can step a single line through on the order-taking
// tab. Drinks only ever go received -> served; food carries the full kitchen
// chain so staff can still override the cook's board manually.
export function statusFlowFor(item) {
  return isDrinkItem(item) ? ['received', 'served'] : ITEM_STATUSES.filter(s => s !== 'received');
}

// Roll the per-item statuses up into the ONE bill-level status the boards,
// new-order chime and reports already key on ('new'/'cooking'/'served').
// 'paid'/'cancelled' are terminal whole-bill states owned elsewhere.
//   - all lines served                         -> 'served'
//   - any line not yet started (received /
//     in_kitchen)                              -> 'new'  (keeps the chime + board)
//   - otherwise (cook has started something)    -> 'cooking'
// Mapping in_kitchen -> 'new' is deliberate: a freshly auto-placed food order
// must still trigger the "ออเดอร์ใหม่" chime, which fires only on bill 'new'.
export function deriveBillStatus(items) {
  const list = items || [];
  if (list.length === 0) return 'new';
  const states = list.map(normalizeItemStatus);
  if (states.every(s => s === 'served')) return 'served';
  if (states.some(s => s === 'received' || s === 'in_kitchen')) return 'new';
  return 'cooking';
}

// The status a line should carry the moment it is sent: food lands straight on
// the kitchen board, drinks wait at received.
export function initialItemStatus(item) {
  return isDrinkItem(item) ? 'received' : 'in_kitchen';
}

// Stamp the fields the kitchen board needs onto a freshly-added line: a stable
// `uid` (batch actions reference lines across bills) and its initial status.
// Idempotent — an item that already has a uid/status keeps them.
export function stampKitchenFields(item) {
  return {
    ...item,
    uid: item.uid || ('i' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)),
    status: item.status && item.status !== 'new' ? item.status : initialItemStatus(item),
  };
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

  // No open bill yet: this order opens the bill as round 1. Food lands on the
  // kitchen board straight away ('in_kitchen'); drinks wait at 'received'.
  if (idx === -1) {
    const items = newOrder.items.map(it => stampKitchenFields({
      ...it,
      round: 1,
      roundAt: newOrder.createdAt,
    }));
    return [...prev, { ...newOrder, items, status: deriveBillStatus(items) }];
  }

  // Merge into the open bill as the next round.
  const existing = prev[idx];
  const nextRound = maxRound(existing.items) + 1;
  const addedItems = newOrder.items.map(it => stampKitchenFields({
    ...it,
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
