// ---------------------------------------------------------------------------
// Owner dashboard aggregations
// ---------------------------------------------------------------------------
// Turns the raw `orders` + `expenses` lists into the daily series and per-dish
// rollups the dashboard draws. Everything here is pure so it can be memoised.
// ---------------------------------------------------------------------------

import { orderShift } from './shift';
import { isDrinkItem } from './menu-groups';
import { todayKey } from './expenses';

// Which calendar day an order belongs to. Paid bills are counted on the day they
// were SETTLED (that is when the money arrived); anything else falls back to when
// it was created. Local time, to match how `expenses` stores its dates.
export function orderDateKey(order) {
  const ts = order?.paidAt || order?.createdAt;
  return ts ? todayKey(new Date(ts)) : null;
}

// What one order line actually brought in: unit price plus its add-ons, times qty.
// (`addonCost` is per unit — the same way StaffView computes an order total.)
export function lineRevenue(item) {
  return ((Number(item?.price) || 0) + (Number(item?.addonCost) || 0)) * (Number(item?.qty) || 0);
}

// Sold lines record the dish name with its chosen variant appended, e.g.
// "ทอดน้ำปลาราดข้าว (หมู)", while the menu stores the base name only. Try an
// exact hit first, then again with a trailing "(...)" stripped.
export function resolveMenuItem(name, menu) {
  if (!name) return null;
  const exact = (menu || []).find((m) => m.name === name);
  if (exact) return exact;
  const base = name.replace(/\s*\([^()]*\)\s*$/, '').trim();
  return (menu || []).find((m) => m.name === base) || null;
}

// 'food' | 'drink' for a sold line. Off-menu dishes (เมนูนอกเล่ม) resolve to
// nothing — they are counted as food, since that is what they always are here.
export function lineGroup(name, menu) {
  const item = resolveMenuItem(name, menu);
  if (!item) return 'food';
  return isDrinkItem(item) ? 'drink' : 'food';
}

// Orders that count as revenue: settled, and matching the chosen shift.
// `shift` is 'day' | 'night' | 'all'.
function revenueOrders(orders, shift) {
  return (orders || []).filter(
    (o) => o.status === 'paid' && (shift === 'all' || orderShift(o) === shift)
  );
}

function shiftExpenses(expenses, shift) {
  return (expenses || []).filter((e) => shift === 'all' || e.shop === shift);
}

// Revenue / expense / profit for one calendar day.
export function dayTotals(orders, expenses, shift, dateKey) {
  const revenue = revenueOrders(orders, shift)
    .filter((o) => orderDateKey(o) === dateKey)
    .reduce((n, o) => n + (Number(o.total) || 0), 0);
  const expense = shiftExpenses(expenses, shift)
    .filter((e) => e.date === dateKey)
    .reduce((n, e) => n + (Number(e.amount) || 0), 0);
  return { revenue, expense, profit: revenue - expense };
}

// How the day's takings split across the money types staff actually received:
//   cash  → เงินสด            (money in the till)
//   qr    → เงินในบัญชีร้าน    (PromptPay straight to the shop's bank account)
//   split → เงินในเป๋าตัง      (คนละครึ่ง — the government G-Wallet app)
// A settled bill with no `payMethod` (older records) is folded into cash, since
// that is what an un-tagged takings almost always was. Scoped to one day + shift.
export function dayTakingsByMethod(orders, shift, dateKey) {
  const takings = { cash: 0, qr: 0, split: 0 };
  revenueOrders(orders, shift)
    .filter((o) => orderDateKey(o) === dateKey)
    .forEach((o) => {
      const method = takings[o.payMethod] != null ? o.payMethod : 'cash';
      takings[method] += Number(o.total) || 0;
    });
  return takings;
}

// The last `days` calendar days ending today, oldest first, each with its totals.
// Days with no trade are still present as zeroes so the line keeps a real time
// axis instead of silently compressing gaps.
export function dailySeries(orders, expenses, shift, days, now = new Date()) {
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const key = todayKey(d);
    out.push({ key, date: d, ...dayTotals(orders, expenses, shift, key) });
  }
  return out;
}

// Same shape as dailySeries but bucketed by calendar month, for the 'ปี' range.
export function monthlySeries(orders, expenses, shift, months = 12, now = new Date()) {
  const paid = revenueOrders(orders, shift);
  const exps = shiftExpenses(expenses, shift);
  const out = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const prefix = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const revenue = paid
      .filter((o) => orderDateKey(o)?.startsWith(prefix))
      .reduce((n, o) => n + (Number(o.total) || 0), 0);
    const expense = exps
      .filter((e) => (e.date || '').startsWith(prefix))
      .reduce((n, e) => n + (Number(e.amount) || 0), 0);
    out.push({ key: prefix, date: d, revenue, expense, profit: revenue - expense });
  }
  return out;
}

// Per-dish totals across every non-cancelled order in the chosen shift.
// `group` filters to 'food' | 'drink' | 'all'; `sortBy` is 'qty' | 'revenue'.
export function menuStats(orders, menu, shift, group = 'all', sortBy = 'qty') {
  const rows = new Map();

  (orders || [])
    .filter((o) => o.status !== 'cancelled' && (shift === 'all' || orderShift(o) === shift))
    .forEach((o) => {
      (o.items || []).forEach((item) => {
        const g = lineGroup(item.name, menu);
        if (group !== 'all' && g !== group) return;
        const row = rows.get(item.name) || { name: item.name, group: g, qty: 0, revenue: 0 };
        row.qty += Number(item.qty) || 0;
        row.revenue += lineRevenue(item);
        rows.set(item.name, row);
      });
    });

  // Ties break on the other measure, so the order stays stable and sensible.
  return [...rows.values()].sort((a, b) =>
    sortBy === 'revenue' ? b.revenue - a.revenue || b.qty - a.qty : b.qty - a.qty || b.revenue - a.revenue
  );
}

// Percent change from `prev` to `curr`. Returns null when there is no baseline
// to compare against — "+100%" against a zero yesterday would be a lie.
export function percentChange(curr, prev) {
  if (!prev) return null;
  return ((curr - prev) / prev) * 100;
}

// --- Monthly summary / export ----------------------------------------------
// The export deliberately does NOT list bills one by one: income is rolled up to
// a single line per day per shop ("รายรับรวมประจำวัน"), and outgoings to one line
// per day/shop/category. That is the shape the owner's book wants.

// Every 'YYYY-MM' that has any trade in it, newest first, plus the current month
// so a fresh month is always selectable.
export function availableMonths(orders, expenses, now = new Date()) {
  const months = new Set();
  (orders || []).forEach((o) => {
    const key = orderDateKey(o);
    if (key && o.status === 'paid') months.add(key.slice(0, 7));
  });
  (expenses || []).forEach((e) => {
    if (e.date) months.add(e.date.slice(0, 7));
  });
  months.add(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`);
  return [...months].sort().reverse();
}

// Flat rows for one month, sorted newest day first. Shape:
//   { date, shop, kind: 'income'|'expense', label, amount }
export function summaryRows(orders, expenses, monthKey) {
  const buckets = new Map(); // `${date}|${shop}|${kind}|${label}` -> amount

  const add = (date, shop, kind, label, amount) => {
    const k = `${date}|${shop}|${kind}|${label}`;
    buckets.set(k, (buckets.get(k) || 0) + amount);
  };

  (orders || [])
    .filter((o) => o.status === 'paid')
    .forEach((o) => {
      const date = orderDateKey(o);
      if (!date || !date.startsWith(monthKey)) return;
      add(date, orderShift(o), 'income', 'รายรับรวมประจำวัน', Number(o.total) || 0);
    });

  (expenses || []).forEach((e) => {
    if (!e.date || !e.date.startsWith(monthKey)) return;
    add(e.date, e.shop, 'expense', `${e.category}รวมประจำวัน`, Number(e.amount) || 0);
  });

  return [...buckets.entries()]
    .map(([k, amount]) => {
      const [date, shop, kind, label] = k.split('|');
      return { date, shop, kind, label, amount };
    })
    .sort((a, b) => b.date.localeCompare(a.date) || a.shop.localeCompare(b.shop) || a.kind.localeCompare(b.kind));
}

// --- Ledger rows (หน้าการเงิน) ----------------------------------------------
// What the on-screen ประวัติรายรับ-รายจ่าย table lists. It differs from
// summaryRows in ONE way that matters: an expense stays its own row, keeping the
// note the owner typed and the id needed to delete it. Rolling outgoings up (as
// the export sheet does) would throw both away and leave a row nobody can act on.
// Income is still one line per day per shop — bills are never listed one by one.
//
// Shape: { key, date, shop, kind: 'income'|'expense', label, note, amount, id }
// `id` is null on income rows, which is also what marks them as undeletable.
export function ledgerRows(orders, expenses, monthKey) {
  const rows = [];

  const income = new Map(); // `${date}|${shop}` -> amount
  (orders || [])
    .filter((o) => o.status === 'paid')
    .forEach((o) => {
      const date = orderDateKey(o);
      if (!date || !date.startsWith(monthKey)) return;
      const k = `${date}|${orderShift(o)}`;
      income.set(k, (income.get(k) || 0) + (Number(o.total) || 0));
    });
  income.forEach((amount, k) => {
    const [date, shop] = k.split('|');
    rows.push({
      key: `income|${k}`,
      date, shop, kind: 'income',
      label: 'รายรับรวมประจำวัน', note: '', amount, id: null, createdAt: 0,
    });
  });

  (expenses || []).forEach((e) => {
    if (!e.date || !e.date.startsWith(monthKey)) return;
    rows.push({
      key: `expense|${e.id}`,
      date: e.date,
      shop: e.shop,
      kind: 'expense',
      label: e.category,
      note: e.note || '',
      amount: Number(e.amount) || 0,
      id: e.id,
      createdAt: e.createdAt || 0,
    });
  });

  // Newest day first; within a day the takings lead, then the latest entry.
  // (b.kind vs a.kind because 'expense' sorts before 'income' alphabetically.)
  return rows.sort(
    (a, b) =>
      b.date.localeCompare(a.date) ||
      b.kind.localeCompare(a.kind) ||
      a.shop.localeCompare(b.shop) ||
      (b.createdAt || 0) - (a.createdAt || 0)
  );
}

// Month totals for the header strip. Works on either summaryRows or ledgerRows —
// both carry { kind, amount } and both add up to the same month.
export function summaryTotals(rows) {
  const income = rows.filter((r) => r.kind === 'income').reduce((n, r) => n + r.amount, 0);
  const expense = rows.filter((r) => r.kind === 'expense').reduce((n, r) => n + r.amount, 0);
  return { income, expense, profit: income - expense };
}

// Yesterday's key, for the KPI comparison line.
export function yesterdayKey(now = new Date()) {
  const d = new Date(now);
  d.setDate(d.getDate() - 1);
  return todayKey(d);
}
