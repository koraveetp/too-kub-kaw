import React, { useState, useMemo } from 'react';
import * as XLSX from 'xlsx';
import { FileSpreadsheet } from 'lucide-react';
import { shopLabel, formatThaiDate, THAI_MONTHS_FULL, todayKey } from '../expenses';
import { availableMonths, summaryRows, summaryTotals } from '../stats';

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

function OwnerSummary({ orders, expenses, showToast }) {
  const months = useMemo(() => availableMonths(orders, expenses), [orders, expenses]);
  const [month, setMonth] = useState(() => months[0] || todayKey().slice(0, 7));

  const rows = useMemo(() => summaryRows(orders, expenses, month), [orders, expenses, month]);
  const totals = useMemo(() => summaryTotals(rows), [rows]);

  const handleExport = () => {
    if (rows.length === 0) {
      alert('เดือนนี้ยังไม่มีข้อมูลสำหรับส่งออก');
      return;
    }

    const sheet = rows.map((r) => ({
      'วันที่': shortDate(r.date),
      'ร้าน': shopLabel(r.shop),
      'ประเภท': r.kind === 'income' ? 'รายรับ' : 'รายจ่าย',
      'รายการ': r.label,
      'จำนวนเงิน ฿': r.amount
    }));

    // Trailing totals so the sheet balances on its own.
    sheet.push({}, {
      'วันที่': 'รวมทั้งเดือน',
      'ร้าน': '',
      'ประเภท': 'รายรับ',
      'รายการ': '',
      'จำนวนเงิน ฿': totals.income
    }, {
      'วันที่': '',
      'ร้าน': '',
      'ประเภท': 'รายจ่าย',
      'รายการ': '',
      'จำนวนเงิน ฿': totals.expense
    }, {
      'วันที่': '',
      'ร้าน': '',
      'ประเภท': 'กำไรสุทธิ',
      'รายการ': '',
      'จำนวนเงิน ฿': totals.profit
    });

    const ws = XLSX.utils.json_to_sheet(sheet);
    ws['!cols'] = [{ wch: 12 }, { wch: 22 }, { wch: 10 }, { wch: 26 }, { wch: 14 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, monthLabel(month));
    XLSX.writeFile(wb, `สรุปยอด_${monthLabel(month).replace(/\s/g, '_')}.xlsx`);
    showToast('ส่งออกไฟล์ Excel สำเร็จ ✓');
  };

  return (
    <div className="space-y-4">

      <div className="flex justify-between items-baseline">
        {/* These two sit straight on the app shell, whose background flips from
            cream by day to near-black by night — so they take their colour from
            the theme (text-ink / text-ink-2) instead of naming one. A fixed
            neutral-800 was invisible at night; a fixed white would be invisible
            by day. */}
        <h3 className="font-extrabold text-base font-kanit text-ink">ข้อมูลเชิงลึก &amp; ส่งออก</h3>
        <span className="text-[10px] text-ink-2 font-medium">
          วันที่: {formatThaiDate(todayKey())}
        </span>
      </div>

      <div>
        <label className="block text-[10px] font-bold text-ink-2 mb-1">เลือกเดือน &amp; ปี</label>
        {/* text-neutral-800 rather than an inherited colour: the box carries
            its own background (bg-admin-field), so its text has to track that
            surface rather than the shell behind it. Both flip together. */}
        <select
          value={month}
          onChange={e => setMonth(e.target.value)}
          className="w-full border rounded-xl p-2.5 bg-admin-field text-neutral-800 text-xs font-bold focus:outline-none focus:ring-1 focus:ring-amber-500"
        >
          {months.map(m => (
            <option key={m} value={m}>{monthLabel(m)}</option>
          ))}
        </select>
      </div>

      {/* MONTH TOTALS */}
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="bg-admin-card border rounded-2xl p-2.5 shadow-xs">
          <span className="text-[9px] font-extrabold text-neutral-600 font-kanit block">รายรับ</span>
          <span className="font-mono text-sm font-extrabold text-admin-income">{baht(totals.income)}</span>
        </div>
        <div className="bg-admin-card border rounded-2xl p-2.5 shadow-xs">
          <span className="text-[9px] font-extrabold text-neutral-600 font-kanit block">รายจ่าย</span>
          <span className="font-mono text-sm font-extrabold text-admin-expense">{baht(totals.expense)}</span>
        </div>
        <div className="bg-admin-card border rounded-2xl p-2.5 shadow-xs">
          <span className="text-[9px] font-extrabold text-neutral-600 font-kanit block">กำไรสุทธิ</span>
          <span className="font-mono text-sm font-extrabold text-neutral-800">{baht(totals.profit)}</span>
        </div>
      </div>

      <button
        onClick={handleExport}
        className="w-full bg-admin-cta hover:bg-admin-cta-hover text-admin-cta-ink font-bold py-3 rounded-2xl transition flex items-center justify-center gap-2 font-kanit"
      >
        <FileSpreadsheet className="w-4 h-4" />
        ส่งออกข้อมูล (Export Data)
      </button>

      {/* ROWS — income is one line per day, never bill by bill */}
      <div className="bg-admin-card border rounded-2xl overflow-hidden shadow-xs">
        <div className="grid grid-cols-[1.1fr_1.3fr_0.9fr_1.6fr_1fr] gap-1.5 px-3 py-2 bg-neutral-50 border-b text-[9.5px] font-extrabold text-neutral-500 font-kanit">
          <span>วันที่</span>
          <span>ร้าน</span>
          <span>ประเภท</span>
          <span>รายการ</span>
          <span className="text-right">จำนวนเงิน ฿</span>
        </div>

        {rows.length > 0 ? (
          rows.map(r => (
            <div
              key={`${r.date}|${r.shop}|${r.kind}|${r.label}`}
              className="grid grid-cols-[1.1fr_1.3fr_0.9fr_1.6fr_1fr] gap-1.5 px-3 py-2.5 border-b border-neutral-100 last:border-0 text-[10px] items-center font-thai"
            >
              <span className="font-mono text-neutral-600">{shortDate(r.date)}</span>
              <span className="font-bold text-neutral-800 leading-tight">{shopLabel(r.shop)}</span>
              <span className={r.kind === 'income' ? 'text-admin-income font-bold' : 'text-admin-expense font-bold'}>
                {r.kind === 'income' ? 'รายรับ' : 'รายจ่าย'}
              </span>
              <span className="text-neutral-500 leading-tight">{r.label}</span>
              <span className="text-right font-mono font-bold text-neutral-800">{baht(r.amount)}</span>
            </div>
          ))
        ) : (
          <p className="text-neutral-500 text-xs py-6 text-center font-medium">
            ยังไม่มีข้อมูลในเดือน {monthLabel(month)}
          </p>
        )}
      </div>
    </div>
  );
}

export default OwnerSummary;
