import React, { useState, useMemo } from 'react';
import * as XLSX from 'xlsx';
import { FileSpreadsheet, Trash2 } from 'lucide-react';
import { shopLabel, THAI_MONTHS_FULL } from '../expenses';
import { availableMonths, summaryRows, summaryTotals, ledgerRows } from '../stats';

const baht = (n) => Math.round(n).toLocaleString();

// 'YYYY-MM' -> 'กรกฎาคม 2569'
function monthLabel(key) {
  const [y, m] = (key || '').split('-').map(Number);
  if (!y || !m) return key || '';
  return `${THAI_MONTHS_FULL[m - 1]} ${y + 543}`;
}

// 'YYYY-MM-DD' -> '18/07/2026', matching the export sheet.
function shortDate(key) {
  const [y, m, d] = (key || '').split('-');
  return `${d}/${m}/${y}`;
}

// The ประเภท filter above the table.
const KIND_FILTERS = [
  { id: 'all', label: 'ทั้งหมด' },
  { id: 'income', label: 'รายรับ' },
  { id: 'expense', label: 'รายจ่าย' },
];

// The money half of the back office: pick a month, read the takings against the
// outgoings, export the sheet. Rendered under the expense entry form inside the
// การเงิน tab — the two used to be separate tabs (รายจ่าย / สรุปยอด).
//
// `onDeleteExpense(id, category, amount)` comes from OwnerView, which owns the
// expenses list. Income rows have no id and so are never deletable here.
//
// `month` / `setMonth` are lifted to OwnerView too: saving an expense dated into
// another month has to move this table to it, and only the form knows that.
function OwnerSummary({ orders, expenses, month, setMonth, showToast, onDeleteExpense }) {
  const months = useMemo(() => availableMonths(orders, expenses), [orders, expenses]);
  const [kind, setKind] = useState('all'); // all | income | expense

  // Two shapes of the same month: `ledger` is what the table shows (every expense
  // on its own row), `rows` is the rolled-up shape the Excel export wants.
  const ledger = useMemo(() => ledgerRows(orders, expenses, month), [orders, expenses, month]);
  const rows = useMemo(() => summaryRows(orders, expenses, month), [orders, expenses, month]);

  // Totals always cover the WHOLE month, never the filtered view — the filter is
  // for reading the list, not for changing what the month earned.
  const totals = useMemo(() => summaryTotals(ledger), [ledger]);
  const visible = useMemo(
    () => (kind === 'all' ? ledger : ledger.filter((r) => r.kind === kind)),
    [ledger, kind]
  );

  // The same month totals, but split by shift so day and night can be checked
  // side by side. Each shift also carries its own rows for the per-sheet export.
  const byShift = useMemo(() => {
    const make = (id) => {
      const shopRows = rows.filter((r) => r.shop === id);
      return { id, rows: shopRows, ...summaryTotals(shopRows) };
    };
    return { day: make('day'), night: make('night') };
  }, [rows]);

  // Turn a set of summary rows into the sheet shape, with trailing totals so each
  // sheet balances on its own.
  const buildSheet = (sheetRows) => {
    const t = summaryTotals(sheetRows);
    const body = sheetRows.map((r) => ({
      'วันที่': shortDate(r.date),
      'ร้าน': shopLabel(r.shop),
      'ประเภท': r.kind === 'income' ? 'รายรับ' : 'รายจ่าย',
      'รายการ': r.label,
      'จำนวนเงิน ฿': r.amount
    }));
    body.push({}, {
      'วันที่': 'รวมทั้งเดือน', 'ร้าน': '', 'ประเภท': 'รายรับ', 'รายการ': '', 'จำนวนเงิน ฿': t.income
    }, {
      'วันที่': '', 'ร้าน': '', 'ประเภท': 'รายจ่าย', 'รายการ': '', 'จำนวนเงิน ฿': t.expense
    }, {
      'วันที่': '', 'ร้าน': '', 'ประเภท': 'กำไรสุทธิ', 'รายการ': '', 'จำนวนเงิน ฿': t.profit
    });
    const ws = XLSX.utils.json_to_sheet(body);
    ws['!cols'] = [{ wch: 12 }, { wch: 22 }, { wch: 10 }, { wch: 26 }, { wch: 14 }];
    return ws;
  };

  const handleExport = () => {
    if (rows.length === 0) {
      alert('เดือนนี้ยังไม่มีข้อมูลสำหรับส่งออก');
      return;
    }

    // One workbook, three tabs: everything together, then day and night on their
    // own so each shift can be checked / handed off in isolation. Empty shifts
    // are skipped rather than adding a blank tab.
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, buildSheet(rows), 'ทั้งหมด');
    if (byShift.day.rows.length) {
      XLSX.utils.book_append_sheet(wb, buildSheet(byShift.day.rows), 'กลางวัน');
    }
    if (byShift.night.rows.length) {
      XLSX.utils.book_append_sheet(wb, buildSheet(byShift.night.rows), 'กลางคืน');
    }
    XLSX.writeFile(wb, `สรุปยอด_${monthLabel(month).replace(/\s/g, '_')}.xlsx`);
    showToast('ส่งออกไฟล์ Excel สำเร็จ ✓');
  };

  return (
    <div className="space-y-4">

      {/* HISTORY — replaces the old ประวัติการใช้จ่าย, now with income in it.
          There is deliberately no totals strip here: the dashboard's own
          สรุปยอดรายเดือน block already carries รายรับ / รายจ่าย / กำไรสุทธิ, and two
          copies of the same three numbers drift apart in the reader's head. */}
      <div className="flex justify-between items-center gap-2 pl-1 flex-wrap">
        <h3 className="font-extrabold text-base font-kanit text-neutral-800 whitespace-nowrap">
          ประวัติรายรับ-รายจ่าย
        </h3>
        {/* Month picker — this is what scopes the table AND the export below.
            text-neutral-600 rather than an inherited colour: the box carries its
            own background (bg-admin-field), so its text has to track that
            surface rather than the shell behind it. Both flip together. */}
        <select
          value={month}
          onChange={e => setMonth(e.target.value)}
          className="border rounded-full py-1.5 px-3 bg-admin-field text-[11px] font-bold text-neutral-600 focus:outline-none focus:ring-1 focus:ring-amber-500"
        >
          {months.map(m => (
            <option key={m} value={m}>{monthLabel(m)}</option>
          ))}
        </select>
      </div>

      {/* ประเภท filter: read the takings and the outgoings on their own. */}
      <div className="flex gap-1 bg-admin-bar rounded-full p-0.5 text-[10px] font-bold">
        {KIND_FILTERS.map(f => (
          <button
            key={f.id}
            onClick={() => setKind(f.id)}
            className={`flex-1 px-3 py-1.5 rounded-full transition ${
              kind === f.id
                ? 'bg-admin-tab text-admin-tab-ink shadow-sm'
                : 'text-admin-tab-idle hover:text-admin-tab-hover'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* ROWS — income is one line per day per shop, never bill by bill;
          each expense keeps its own row so its note and delete survive. */}
      <div className="bg-admin-card border rounded-2xl overflow-hidden shadow-xs">
        <div className="grid grid-cols-[1fr_1.1fr_0.8fr_1.4fr_0.9fr_auto] gap-1.5 px-3 py-2 bg-neutral-50 border-b text-[9.5px] font-extrabold text-neutral-500 font-kanit">
          <span>วันที่</span>
          <span>ร้าน</span>
          <span>ประเภท</span>
          <span>รายการ</span>
          <span className="text-right">จำนวนเงิน ฿</span>
          <span className="w-6" />
        </div>

        {visible.length > 0 ? (
          visible.map(r => (
            <div
              key={r.key}
              className="grid grid-cols-[1fr_1.1fr_0.8fr_1.4fr_0.9fr_auto] gap-1.5 px-3 py-2.5 border-b border-neutral-100 last:border-0 text-[10px] items-center font-thai"
            >
              <span className="font-mono text-neutral-600">{shortDate(r.date)}</span>
              <span className="font-bold text-neutral-800 leading-tight">{shopLabel(r.shop)}</span>
              <span className={r.kind === 'income' ? 'text-admin-income font-bold' : 'text-admin-expense font-bold'}>
                {r.kind === 'income' ? 'รายรับ' : 'รายจ่าย'}
              </span>
              <span className="text-neutral-500 leading-tight truncate" title={r.note || r.label}>
                {r.label}
                {r.note && <span className="block text-[9px] text-neutral-400 truncate">{r.note}</span>}
              </span>
              <span className="text-right font-mono font-bold text-neutral-800">{baht(r.amount)}</span>
              {/* Only outgoings can be removed — takings belong to the bills. */}
              {r.id ? (
                <button
                  onClick={() => onDeleteExpense?.(r.id, r.label, r.amount)}
                  className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-500/10 rounded-lg transition"
                  title="ลบรายการ"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              ) : (
                <span className="w-6" />
              )}
            </div>
          ))
        ) : (
          <p className="text-neutral-500 text-xs py-6 text-center font-medium">
            {kind === 'income'
              ? `ยังไม่มีรายรับในเดือน ${monthLabel(month)}`
              : kind === 'expense'
                ? `ยังไม่มีรายจ่ายในเดือน ${monthLabel(month)}`
                : `ยังไม่มีข้อมูลในเดือน ${monthLabel(month)}`}
          </p>
        )}

        {/* Adding takings to outgoings would be a meaningless number, so the
            unfiltered view foots with the month's profit instead of a sum. */}
        {visible.length > 0 && (
          <div className="flex justify-between items-center px-3 py-2.5 bg-admin-panel text-xs font-extrabold font-kanit">
            <span className="text-neutral-600">
              {kind === 'income' ? 'รวมรายรับ' : kind === 'expense' ? 'รวมรายจ่าย' : 'กำไรสุทธิทั้งเดือน'}
            </span>
            <span className={`font-mono ${kind === 'all' && totals.profit < 0 ? 'text-admin-expense' : 'text-neutral-800'}`}>
              ฿{baht(kind === 'all' ? totals.profit : visible.reduce((n, r) => n + r.amount, 0))}
            </span>
          </div>
        )}
      </div>

      {/* Export always covers the WHOLE month shown above, never the filtered
          view — the workbook is the month's book, not a screenshot of the list. */}
      <button
        onClick={handleExport}
        className="w-full bg-admin-cta hover:bg-admin-cta-hover text-admin-cta-ink font-bold py-3 rounded-2xl transition flex items-center justify-center gap-2 font-kanit"
      >
        <FileSpreadsheet className="w-4 h-4" />
        ส่งออกข้อมูล {monthLabel(month)}
      </button>
    </div>
  );
}

export default OwnerSummary;
