import React, { useState, useMemo, useRef } from 'react';
import { TrendingUp, TrendingDown, Wallet, Coins, Banknote, Landmark, Smartphone } from 'lucide-react';
import { todayKey, formatThaiDate, THAI_MONTHS_FULL } from '../expenses';
import {
  dayTotals,
  dayTakingsByMethod,
  dailySeries,
  monthlySeries,
  menuStats,
  percentChange,
  yesterdayKey,
  summaryRows,
  summaryTotals,
  availableMonths
} from '../stats';

// 'YYYY-MM' -> 'กรกฎาคม 2569'
function monthLabel(key) {
  const [y, m] = (key || '').split('-').map(Number);
  if (!y || !m) return key || '';
  return `${THAI_MONTHS_FULL[m - 1]} ${y + 543}`;
}

// Categorical slots 1 and 2 of the validated palette. Sales and profit are both
// in baht, so they share ONE y-axis — never a second scale.
//
// The two hues live in index.css (--c-chart-*) because they have to lighten for
// the night theme: the day blue and green are picked for contrast against a
// white card and go muddy on a near-black one. These string forms are for
// inline `style` only — SVG presentation attributes don't accept var(), so the
// chart marks below reach the same variables through stroke-/fill- classes.
const C_REVENUE = 'var(--c-chart-revenue)';
const C_PROFIT = 'var(--c-chart-profit)';

const SHIFT_TABS = [
  { id: 'all', label: 'ทั้งหมด' },
  { id: 'day', label: 'กลางวัน' },
  { id: 'night', label: 'กลางคืน' }
];

const RANGES = [
  { id: 'week', label: 'สัปดาห์' },
  { id: 'month', label: 'เดือน' },
  { id: 'year', label: 'ปี' }
];

const GROUPS = [
  { id: 'all', label: 'ทั้งหมด' },
  { id: 'food', label: 'อาหาร' },
  { id: 'drink', label: 'น้ำ' }
];

const baht = (n) => Math.round(n).toLocaleString();

// A round gridline interval (1 / 2 / 2.5 / 5 × 10^n) at or above `raw`, so the
// axis labels are numbers a person would actually write down.
function niceStep(raw) {
  const pow = 10 ** Math.floor(Math.log10(Math.max(raw, 1)));
  const n = Math.max(raw, 1) / pow;
  const m = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
  return m * pow;
}

// Axis bounds snapped outward to whole steps. Because both ends are multiples of
// the same step, zero always lands exactly on a gridline whenever the range
// crosses it — which is what makes a loss legible against break-even.
function axisBounds(points) {
  const rawHi = Math.max(1, ...points.map((p) => Math.max(p.revenue, p.profit)));
  const rawLo = Math.min(0, ...points.map((p) => p.profit));
  const step = niceStep((rawHi - rawLo) / 4);
  const hi = Math.ceil(rawHi / step) * step;
  const lo = Math.floor(rawLo / step) * step;
  return { lo, hi: hi === lo ? lo + step : hi, step };
}

// One KPI tile. `delta` is a percent vs the previous day, or null when there is
// no baseline — in which case we say so rather than printing a fake +100%.
function StatTile({ label, value, delta, tone, Icon }) {
  const up = delta != null && delta >= 0;
  return (
    <div className="bg-admin-card border rounded-2xl p-3.5 shadow-xs">
      <span className={`text-[10px] font-extrabold font-kanit px-2 py-1 rounded-lg ${tone}`}>
        {label}
      </span>
      <div className="flex items-baseline gap-1 mt-2">
        <Icon className="w-4 h-4 text-neutral-400 shrink-0" />
        <span className="font-mono text-lg font-extrabold text-neutral-800 leading-none">
          {baht(value)}
        </span>
        <span className="text-[10px] text-neutral-400 font-medium">บาท</span>
      </div>
      {delta != null ? (
        <span
          className={`text-[10px] font-bold mt-1 flex items-center gap-0.5 ${up ? 'text-green-700' : 'text-red-600'}`}
        >
          {up ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
          {up ? '+' : ''}{delta.toFixed(1)}%
        </span>
      ) : (
        <span className="text-[10px] text-neutral-400 font-medium mt-1 block">
          ไม่มีข้อมูลเมื่อวาน
        </span>
      )}
    </div>
  );
}

// One takings tile: where today's money physically landed (till / bank / wallet).
// Simpler than StatTile — no day-over-day delta, since "which pocket" is a
// snapshot, not a trend.
function TakingsTile({ label, value, tone, Icon }) {
  return (
    <div className="bg-admin-card border rounded-2xl p-3.5 shadow-xs">
      <span className={`inline-flex items-center gap-1 text-[10px] font-extrabold font-kanit px-2 py-1 rounded-lg ${tone}`}>
        <Icon className="w-3 h-3" />
        {label}
      </span>
      <div className="flex items-baseline gap-1 mt-2">
        <span className="font-mono text-lg font-extrabold text-neutral-800 leading-none">
          {baht(value)}
        </span>
        <span className="text-[10px] text-neutral-400 font-medium">บาท</span>
      </div>
    </div>
  );
}

// Two-series line chart on a single shared axis, with a hover crosshair.
function TrendChart({ points, range }) {
  const svgRef = useRef(null);
  const [hover, setHover] = useState(null);

  const W = 360;
  const H = 190;
  const padL = 44;
  const padR = 10;
  const padT = 12;
  const padB = 26;

  // The axis has to reach below zero when a day loses money — clamping a loss to
  // the baseline would draw it exactly like breaking even.
  const { lo, hi, step } = axisBounds(points);

  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const x = (i) => padL + (points.length <= 1 ? plotW / 2 : (i / (points.length - 1)) * plotW);
  const y = (v) => padT + plotH - ((v - lo) / (hi - lo)) * plotH;

  const path = (key) => points.map((p, i) => `${i ? 'L' : 'M'}${x(i)},${y(p[key])}`).join(' ');

  const ticks = [];
  for (let t = lo; t <= hi + step / 2; t += step) ticks.push(t);

  // Label every point when they fit, otherwise thin them out to ~6.
  const labelEvery = Math.max(1, Math.ceil(points.length / 6));

  // Day-of-month alone restarts at 1 mid-axis, so carry the month with it.
  const shortLabel = (p) => {
    if (range === 'year') return THAI_MONTHS_FULL[p.date.getMonth()].slice(0, 3);
    return `${p.date.getDate()}/${p.date.getMonth() + 1}`;
  };

  const onMove = (e) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    // Client px -> viewBox units, since the SVG scales to its container.
    const vx = ((e.clientX - rect.left) / rect.width) * W;
    const i = Math.round(((vx - padL) / plotW) * (points.length - 1));
    setHover(Math.min(points.length - 1, Math.max(0, i)));
  };

  const hp = hover != null ? points[hover] : null;

  return (
    // The SVG scales to its container, and everything inside it — line weights,
    // axis numbers, markers — scales with it. In the widened desktop shell that
    // blew the chart up to full monitor width with huge numbers on it, so the
    // container is capped: a phone is unaffected (its shell is narrower than
    // max-w-md anyway) and a desktop gets a slightly larger chart, not a poster.
    // Widen/narrow the chart by changing THIS max-width, nothing else.
    <div className="relative w-full max-w-md lg:max-w-lg mx-auto">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="w-full h-auto touch-none"
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
      >
        {/* gridlines + y labels */}
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} className="stroke-chart-grid" strokeWidth="1" />
            <text x={padL - 6} y={y(t) + 3} textAnchor="end" fontSize="7" className="fill-chart-axis">
              {baht(t)}
            </text>
          </g>
        ))}

        {/* break-even line, drawn darker so losses read as below it */}
        {lo < 0 && (
          <line x1={padL} x2={W - padR} y1={y(0)} y2={y(0)} className="stroke-chart-zero" strokeWidth="1" />
        )}

        {/* x labels */}
        {points.map((p, i) =>
          i % labelEvery === 0 ? (
            <text key={p.key} x={x(i)} y={H - 8} textAnchor="middle" fontSize="7.5" className="fill-chart-axis">
              {shortLabel(p)}
            </text>
          ) : null
        )}

        {/* Profit is dashed so it stays readable where it sits exactly on top of
            revenue — which is every day with no expenses recorded yet. The dash
            doubles as the secondary encoding the palette rules ask for. */}
        <path d={path('revenue')} fill="none" className="stroke-chart-revenue" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        <path d={path('profit')} fill="none" className="stroke-chart-profit" strokeWidth="2" strokeDasharray="5 3" strokeLinejoin="round" strokeLinecap="round" />

        {/* crosshair + markers, drawn with a surface ring so they read over the lines */}
        {hp && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={padT} y2={padT + plotH} className="stroke-chart-cross" strokeWidth="1" strokeDasharray="3 3" />
            <circle cx={x(hover)} cy={y(hp.revenue)} r="4.5" className="fill-chart-revenue stroke-chart-surface" strokeWidth="2" />
            <circle cx={x(hover)} cy={y(hp.profit)} r="4.5" className="fill-chart-profit stroke-chart-surface" strokeWidth="2" />
          </g>
        )}
      </svg>

      {/* tooltip */}
      {hp && (
        <div
          className={`absolute top-0 bg-admin-card border rounded-xl px-2.5 py-1.5 text-[10px] shadow-sm pointer-events-none font-thai ${
            hover > points.length / 2 ? 'left-0' : 'right-0'
          }`}
        >
          <span className="font-extrabold text-neutral-700 block mb-0.5">
            {range === 'year'
              ? `${THAI_MONTHS_FULL[hp.date.getMonth()]} ${hp.date.getFullYear() + 543}`
              : formatThaiDate(hp.key)}
          </span>
          <span className="flex items-center gap-1 text-neutral-600">
            <span className="w-2 h-2 rounded-full inline-block" style={{ background: C_REVENUE }} />
            ยอดขาย <b className="font-mono">{baht(hp.revenue)}</b>
          </span>
          <span className="flex items-center gap-1 text-neutral-600">
            <span className="w-2 h-2 rounded-full inline-block" style={{ background: C_PROFIT }} />
            กำไร <b className="font-mono">{baht(hp.profit)}</b>
          </span>
        </div>
      )}
    </div>
  );
}

function OwnerDashboard({ orders, expenses, menu }) {
  const [shift, setShift] = useState('all');
  const [range, setRange] = useState('month');
  const [group, setGroup] = useState('all');
  const [sortBy, setSortBy] = useState('qty');

  const today = todayKey();

  const todayTotals = useMemo(
    () => dayTotals(orders, expenses, shift, today),
    [orders, expenses, shift, today]
  );
  const prevTotals = useMemo(
    () => dayTotals(orders, expenses, shift, yesterdayKey()),
    [orders, expenses, shift]
  );

  // Where today's takings landed: cash in the till, PromptPay to the shop bank,
  // or คนละครึ่ง into the เป๋าตัง wallet.
  const takings = useMemo(
    () => dayTakingsByMethod(orders, shift, today),
    [orders, shift, today]
  );

  const points = useMemo(() => {
    if (range === 'week') return dailySeries(orders, expenses, shift, 7);
    if (range === 'month') return dailySeries(orders, expenses, shift, 30);
    return monthlySeries(orders, expenses, shift, 12);
  }, [orders, expenses, shift, range]);

  const rows = useMemo(
    () => menuStats(orders, menu, shift, group, sortBy),
    [orders, menu, shift, group, sortBy]
  );

  // Month summary, split day vs night with a combined total — moved here from
  // the สรุปยอด tab so it sits directly under today's income/expense cards.
  // Always shows both shifts (that's the whole point of the table), so it ignores
  // the shift selector above; the month is chosen with its own dropdown.
  const summaryMonths = useMemo(() => availableMonths(orders, expenses), [orders, expenses]);
  const [summaryMonth, setSummaryMonth] = useState(() => today.slice(0, 7));
  // If the picked month scrolls out of the available list (e.g. data cleared),
  // fall back to the newest month so the table never renders a stale/empty key.
  const monthKey = summaryMonths.includes(summaryMonth)
    ? summaryMonth
    : (summaryMonths[0] || today.slice(0, 7));
  const monthRows = useMemo(
    () => summaryRows(orders, expenses, monthKey),
    [orders, expenses, monthKey]
  );
  const monthTotals = useMemo(() => summaryTotals(monthRows), [monthRows]);
  const monthByShift = useMemo(() => {
    const make = (id) => summaryTotals(monthRows.filter((r) => r.shop === id));
    return { day: make('day'), night: make('night') };
  }, [monthRows]);

  return (
    <div className="space-y-4">

      {/* SHIFT SPLIT — every number below is scoped to this */}
      <div className="flex gap-1.5 bg-neutral-100 rounded-xl p-1 text-[11px] font-bold">
        {SHIFT_TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setShift(t.id)}
            className={`flex-1 py-2 rounded-lg transition ${t.id === shift ? 'bg-admin-field text-neutral-800 shadow-xs' : 'text-neutral-500'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* KPI TILES */}
      <div className="grid grid-cols-3 gap-2">
        <StatTile
          label="ยอดขายวันนี้"
          value={todayTotals.revenue}
          delta={percentChange(todayTotals.revenue, prevTotals.revenue)}
          tone="bg-admin-income-soft text-admin-income-ink"
          Icon={TrendingUp}
        />
        <StatTile
          label="รายจ่ายวันนี้"
          value={todayTotals.expense}
          delta={percentChange(todayTotals.expense, prevTotals.expense)}
          tone="bg-admin-expense-soft text-admin-expense-ink"
          Icon={Wallet}
        />
        <StatTile
          label="กำไรวันนี้"
          value={todayTotals.profit}
          delta={percentChange(todayTotals.profit, prevTotals.profit)}
          tone="bg-blue-100 text-blue-800"
          Icon={Coins}
        />
      </div>

      {/* TAKINGS BY MONEY TYPE — where today's money physically landed */}
      <div className="grid grid-cols-3 gap-2">
        <TakingsTile
          label="เงินสด"
          value={takings.cash}
          tone="bg-emerald-100 text-emerald-800"
          Icon={Banknote}
        />
        <TakingsTile
          label="บัญชีร้าน"
          value={takings.qr}
          tone="bg-indigo-100 text-indigo-800"
          Icon={Landmark}
        />
        <TakingsTile
          label="เป๋าตัง"
          value={takings.split}
          tone="bg-rose-100 text-rose-800"
          Icon={Smartphone}
        />
      </div>

      {/* MONTH SUMMARY — day vs night side by side for the chosen month, with a
          combined row underneath. Moved here from the สรุปยอด tab so it reads
          right below today's cards; the month is picked with the dropdown. */}
      <div className="bg-admin-card border rounded-2xl overflow-hidden shadow-xs">
        <div className="flex items-center justify-between gap-2 px-3 py-2 bg-neutral-50 border-b">
          <span className="text-[11px] font-extrabold text-neutral-700 font-kanit">สรุปยอดรายเดือน</span>
          {summaryMonths.length > 0 ? (
            <select
              value={monthKey}
              onChange={(e) => setSummaryMonth(e.target.value)}
              className="text-[10px] font-bold text-neutral-600 bg-admin-field border rounded-lg py-1 pl-2 pr-1 focus:outline-none focus:ring-1 focus:ring-amber-500"
            >
              {summaryMonths.map((m) => (
                <option key={m} value={m}>{monthLabel(m)}</option>
              ))}
            </select>
          ) : (
            <span className="text-[10px] font-bold text-neutral-500">{monthLabel(monthKey)}</span>
          )}
        </div>
        <div className="grid grid-cols-[1.1fr_1fr_1fr_1fr] gap-1.5 px-3 py-2 bg-neutral-50 border-b text-[9.5px] font-extrabold text-neutral-500 font-kanit">
          <span>กะ</span>
          <span className="text-right">รายรับ</span>
          <span className="text-right">รายจ่าย</span>
          <span className="text-right">กำไรสุทธิ</span>
        </div>
        {[
          { label: 'กลางวัน', t: monthByShift.day },
          { label: 'กลางคืน', t: monthByShift.night }
        ].map(({ label, t }) => (
          <div
            key={label}
            className="grid grid-cols-[1.1fr_1fr_1fr_1fr] gap-1.5 px-3 py-2.5 border-b border-neutral-100 text-[11px] items-center font-thai"
          >
            <span className="font-bold text-neutral-800">{label}</span>
            <span className="text-right font-mono font-bold text-admin-income">{baht(t.income)}</span>
            <span className="text-right font-mono font-bold text-admin-expense">{baht(t.expense)}</span>
            <span className="text-right font-mono font-extrabold text-neutral-800">{baht(t.profit)}</span>
          </div>
        ))}
        <div className="grid grid-cols-[1.1fr_1fr_1fr_1fr] gap-1.5 px-3 py-2.5 bg-neutral-50 text-[11px] items-center font-thai">
          <span className="font-extrabold text-neutral-800 font-kanit">รวมทั้งเดือน</span>
          <span className="text-right font-mono font-extrabold text-admin-income">{baht(monthTotals.income)}</span>
          <span className="text-right font-mono font-extrabold text-admin-expense">{baht(monthTotals.expense)}</span>
          <span className="text-right font-mono font-extrabold text-neutral-800">{baht(monthTotals.profit)}</span>
        </div>
      </div>

      {/* TREND CHART */}
      <div className="bg-admin-card border rounded-2xl p-3 shadow-xs space-y-2">
        <div className="flex gap-1.5 bg-neutral-100 rounded-xl p-1 text-[11px] font-bold">
          {RANGES.map(r => (
            <button
              key={r.id}
              onClick={() => setRange(r.id)}
              className={`flex-1 py-1.5 rounded-lg transition ${r.id === range ? 'bg-admin-field text-neutral-800 shadow-xs' : 'text-neutral-500'}`}
            >
              {r.label}
            </button>
          ))}
        </div>

        {/* legend — identity is never carried by color alone */}
        <div className="flex justify-center gap-4 text-[10px] font-bold text-neutral-600">
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-[2px] rounded-full" style={{ background: C_REVENUE }} />
            ยอดขาย
          </span>
          <span className="flex items-center gap-1.5">
            <svg width="14" height="2" aria-hidden="true">
              <line x1="0" y1="1" x2="14" y2="1" className="stroke-chart-profit" strokeWidth="2" strokeDasharray="5 3" />
            </svg>
            กำไร
          </span>
        </div>

        <TrendChart points={points} range={range} />
      </div>

      {/* MENU STATS */}
      <div className="bg-admin-card border rounded-2xl overflow-hidden shadow-xs">
        <div className="p-3.5 pb-2.5 space-y-2.5">
          <h3 className="font-extrabold text-base font-kanit text-neutral-800">สถิติเมนู</h3>

          <div className="flex gap-1 bg-neutral-100 rounded-xl p-1 text-[11px] font-bold">
            {GROUPS.map(g => (
              <button
                key={g.id}
                onClick={() => setGroup(g.id)}
                className={`flex-1 py-1.5 rounded-lg transition ${g.id === group ? 'bg-admin-field text-neutral-800 shadow-xs' : 'text-neutral-500'}`}
              >
                {g.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <span className="text-[10px] text-neutral-400 font-bold shrink-0">เรียงตาม</span>
            <select
              value={sortBy}
              onChange={e => setSortBy(e.target.value)}
              className="flex-1 border rounded-xl py-1.5 px-2 text-[11px] font-bold text-neutral-600 bg-admin-field focus:outline-none focus:ring-1 focus:ring-amber-500"
            >
              <option value="qty">จำนวนจานที่ขายได้มากสุด</option>
              <option value="revenue">ยอดขายรวมมากสุด</option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-[2fr_1fr_1fr] gap-2 px-3.5 py-2 bg-neutral-50 border-y text-[10px] font-extrabold text-neutral-500 font-kanit">
          <span>ชื่อเมนู</span>
          <span className="text-right">จำนวนที่ขายได้</span>
          <span className="text-right">ยอดขายรวม</span>
        </div>

        {rows.length > 0 ? (
          rows.map(r => (
            <div
              key={r.name}
              className="grid grid-cols-[2fr_1fr_1fr] gap-2 px-3.5 py-2.5 border-b border-neutral-100 last:border-0 text-[11px] items-center font-thai"
            >
              <span className="font-bold text-neutral-800">{r.name}</span>
              <span className="text-right font-mono text-neutral-700">{r.qty}</span>
              <span className="text-right font-mono font-bold text-neutral-800">
                {baht(r.revenue)} บาท
              </span>
            </div>
          ))
        ) : (
          <p className="text-neutral-400 text-xs py-6 text-center font-medium">
            ยังไม่มียอดขายในช่วงที่เลือก
          </p>
        )}
      </div>
    </div>
  );
}

export default OwnerDashboard;
