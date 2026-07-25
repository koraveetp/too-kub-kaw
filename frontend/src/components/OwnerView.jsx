import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  Trash2,
  Settings as SettingsIcon,
  Wallet,
  LayoutDashboard,
  FileSpreadsheet,
  UtensilsCrossed,
  CalendarClock,
  Users
} from 'lucide-react';
import OwnerDashboard from './OwnerDashboard';
import OwnerSummary from './OwnerSummary';
import OwnerMenu from './OwnerMenu';
import AdminThemePanel from './AdminThemePanel';
import { manualTimeclock, setPayrollStatus } from '../api';
import {
  SHOPS,
  EXPENSE_CATEGORIES,
  shopLabel,
  todayKey,
  formatThaiDate,
  sumExpenses
} from '../expenses';

function OwnerView({
  menu,
  orders,
  expenses,
  setExpenses,
  settings,
  setSettings,
  staff,
  setStaff,
  showToast,
  timeclock,
  payroll
}) {
  const [subTab, setSubTab] = useState('dashboard'); // dashboard, report, expenses, timeclock, settings

  // --- EXPENSE ENTRY FORM ---
  const [expShop, setExpShop] = useState(SHOPS[0].id);
  const [expCategory, setExpCategory] = useState(EXPENSE_CATEGORIES[0]);
  const [expAmount, setExpAmount] = useState('');
  const [expNote, setExpNote] = useState('');
  // The day a new expense is filed under (defaults to today, but the owner can
  // back-date a receipt they forgot to enter).
  const [expDate, setExpDate] = useState(() => todayKey());
  // Which day's history is on screen. Defaults to today.
  const [historyDate, setHistoryDate] = useState(() => todayKey());

  // Form states for staff accounts
  const [newStaffName, setNewStaffName] = useState('');
  const [newStaffUser, setNewStaffUser] = useState('');
  const [newStaffPass, setNewStaffPass] = useState('');
  // ตำแหน่ง + ค่าแรงรายวัน + ร้านที่ประจำ ('day' | 'night') — owner-only info,
  // shown nowhere outside this settings panel.
  const [newStaffPosition, setNewStaffPosition] = useState('');
  const [newStaffWage, setNewStaffWage] = useState('');
  const [newStaffShop, setNewStaffShop] = useState('day');
  // Access level: 'staff' (พนักงาน — shift board only) | 'owner' (เจ้าของ —
  // this back office). Defaults to staff so owner access is always deliberate.
  const [newStaffRole, setNewStaffRole] = useState('staff');

  // --- ประวัติเข้างาน (time clock history) ---
  // Which month the summary table shows (YYYY-MM) and which day the in/out
  // detail table shows (YYYY-MM-DD). Both default to now/today.
  const [tcMonth, setTcMonth] = useState(() => todayKey().slice(0, 7));
  const [tcDate, setTcDate] = useState(() => todayKey());

  // Backfill modal (admin logs a forgotten clock). null = closed.
  const [backfill, setBackfill] = useState(null); // { user, date, inTime, outTime }
  const [savingClock, setSavingClock] = useState(false);

  // Days worked (and wages owed) per staff member in the chosen month. A day
  // counts ONLY when it has BOTH a clock-in and a clock-out — hours don't
  // matter (they're only for spotting a late arrival). Staff with no records
  // still get a row showing 0.
  const tcMonthlySummary = useMemo(() => {
    const monthRecords = (timeclock || []).filter((r) => (r.date || '').startsWith(tcMonth));
    return (staff || []).map((s) => {
      const days = new Set(
        monthRecords.filter((r) => r.user === s.user && r.inAt && r.outAt).map((r) => r.date)
      ).size;
      const paid = payroll?.[`${s.user}__${tcMonth}`] === 'paid';
      return {
        user: s.user, name: s.name, position: s.position,
        dailyWage: s.dailyWage || 0, days, salary: days * (s.dailyWage || 0), paid,
      };
    });
  }, [timeclock, staff, tcMonth, payroll]);

  // The chosen day flattened into ONE row per event (a clock-in and a clock-out
  // are separate rows), sorted by the actual time — matching the daily ticket.
  const tcDayEvents = useMemo(() => {
    const events = [];
    (timeclock || [])
      .filter((r) => r.date === tcDate)
      .forEach((r) => {
        if (r.inAt) events.push({ id: r.id + '-in', at: r.inAt, name: r.name || r.user, kind: 'in' });
        if (r.outAt) events.push({ id: r.id + '-out', at: r.outAt, name: r.name || r.user, kind: 'out' });
      });
    return events.sort((a, b) => a.at - b.at);
  }, [timeclock, tcDate]);

  const tcTime = (ts) =>
    ts ? new Date(ts).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }) + ' น.' : '—';

  // Combine the modal's date (YYYY-MM-DD) + a "HH:MM" time into epoch ms.
  const combineDateTime = (date, time) =>
    time ? new Date(`${date}T${time}:00`).getTime() : null;

  const handleTogglePaid = async (row) => {
    const next = row.paid ? 'unpaid' : 'paid';
    try {
      await setPayrollStatus({ user: row.user, month: tcMonth, status: next });
      showToast(next === 'paid' ? `ทำเครื่องหมายจ่ายแล้ว: ${row.name}` : `ยกเลิกการจ่าย: ${row.name}`);
    } catch (err) {
      showToast(err.message || 'อัปเดตสถานะไม่สำเร็จ');
    }
  };

  const openBackfill = () => {
    setBackfill({ user: staff?.[0]?.user || '', date: tcDate, inTime: '', outTime: '' });
  };

  const handleSaveBackfill = async () => {
    if (!backfill?.user || !backfill?.date) return;
    if (!backfill.inTime && !backfill.outTime) {
      showToast('กรุณาระบุเวลาเข้าหรือออกอย่างน้อยหนึ่งช่อง');
      return;
    }
    setSavingClock(true);
    try {
      await manualTimeclock({
        user: backfill.user,
        date: backfill.date,
        inAt: combineDateTime(backfill.date, backfill.inTime),
        outAt: combineDateTime(backfill.date, backfill.outTime),
      });
      showToast('บันทึกเวลาย้อนหลังเรียบร้อย');
      setBackfill(null);
    } catch (err) {
      showToast(err.message || 'บันทึกเวลาย้อนหลังไม่สำเร็จ');
    } finally {
      setSavingClock(false);
    }
  };


  // --- EXPENSE ACTIONS ---
  // Every day that has at least one expense, newest first, so the date picker
  // only ever offers days the owner actually recorded something on. Today is
  // always included even when still empty, so a fresh entry has somewhere to land.
  const expenseDates = useMemo(() => {
    const days = new Set((expenses || []).map((e) => e.date).filter(Boolean));
    days.add(todayKey());
    return [...days].sort().reverse();
  }, [expenses]);

  const dayExpenses = useMemo(
    () =>
      (expenses || [])
        .filter((e) => e.date === historyDate)
        .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)),
    [expenses, historyDate]
  );

  const handleAddExpense = (e) => {
    e.preventDefault();
    const amountNum = parseFloat(expAmount);
    if (isNaN(amountNum) || amountNum <= 0) {
      alert('กรุณากรอกจำนวนเงินให้ถูกต้อง');
      return;
    }

    const entry = {
      id: 'exp_' + Date.now().toString(36),
      date: expDate || todayKey(),
      shop: expShop,
      category: expCategory,
      amount: amountNum,
      note: expNote.trim(),
      createdAt: Date.now()
    };

    setExpenses((prev) => [...(prev || []), entry]);
    // Jump the history to the day we just filed under, so the new row is visible.
    setHistoryDate(entry.date);
    setExpAmount('');
    setExpNote('');
    showToast(`บันทึกรายจ่าย ${amountNum.toLocaleString()} บาท (${expCategory}) แล้ว`);
  };

  const handleDeleteExpense = (id, category, amount) => {
    if (confirm(`ลบรายจ่าย [${category} ${amount.toLocaleString()} บาท] ใช่หรือไม่?`)) {
      setExpenses((prev) => (prev || []).filter((e) => e.id !== id));
      showToast('ลบรายการรายจ่ายแล้ว');
    }
  };

  // --- SETTINGS FORM ACTIONS ---
  const handleSaveSettings = (e) => {
    e.preventDefault();
    showToast('บันทึกข้อมูลการตั้งค่าเสร็จสมบูรณ์');
  };

  // --- BACK-OFFICE COLOURS ---
  // There is no "save" button: a pick lands in `settings`, which is a shared
  // resource, so the new colour persists and reaches every other open tab over
  // SSE. Passing `null` drops the override and the built-in colour from
  // index.css takes over again.
  //
  // The commit is debounced because <input type="color"> fires on every step of
  // a drag — writing straight through would send a PUT and a broadcast to every
  // connected tab for each intermediate colour. The draft below keeps the
  // swatch responsive while the drag is in flight; the real write happens once
  // the owner settles on a colour.
  const [colorDraft, setColorDraft] = useState(null); // null = ใช้ค่าจาก settings
  const colorTimer = useRef(null);
  const activeColors = colorDraft ?? (settings.adminColors || {});

  useEffect(() => () => clearTimeout(colorTimer.current), []);

  const handleAdminColorChange = (key, value) => {
    const next = { ...activeColors };
    if (value == null) delete next[key];
    else next[key] = value;

    setColorDraft(next);
    clearTimeout(colorTimer.current);
    colorTimer.current = setTimeout(() => {
      setSettings((prev) => ({ ...prev, adminColors: next }));
      setColorDraft(null); // settings now holds it; fall back to the shared copy
    }, 300);
  };

  const handleAdminColorReset = () => {
    clearTimeout(colorTimer.current);
    setColorDraft(null);
    setSettings((prev) => ({ ...prev, adminColors: {} }));
    showToast('คืนค่าสีหน้าหลังบ้านเป็นค่าเริ่มต้นแล้ว');
  };

  const handleAddStaffAccount = (e) => {
    e.preventDefault();
    if (!newStaffUser.trim() || !newStaffPass.trim()) {
      alert('กรุณากรอกชื่อผู้ใช้และรหัสผ่านพนักงาน');
      return;
    }
    if (staff.some(s => s.user === newStaffUser)) {
      alert('มีชื่อผู้ใช้งานนี้ในระบบแล้ว');
      return;
    }

    const newAcc = {
      user: newStaffUser.trim(),
      pass: newStaffPass,
      name: newStaffName.trim() || newStaffUser.trim(),
      position: newStaffPosition.trim(),
      // Daily wage in THB — numeric so payroll sums can be computed later.
      dailyWage: Math.max(0, parseFloat(newStaffWage) || 0),
      // Which shop this person works at: 'day' (ตู้กับข้าวบ้านยาย) | 'night' (เรือนเก่า)
      shop: newStaffShop,
      // Access level decides which panel their login lands on.
      role: newStaffRole
    };

    setStaff(prev => [...prev, newAcc]);
    setNewStaffName('');
    setNewStaffUser('');
    setNewStaffPass('');
    setNewStaffPosition('');
    setNewStaffWage('');
    setNewStaffShop('day');
    setNewStaffRole('staff');
    showToast(`เพิ่มพนักงาน [${newAcc.name}] เข้าระบบแล้ว`);
  };

  const handleDeleteStaffAccount = (username) => {
    if (staff.length <= 1) {
      alert('ไม่สามารถลบพนักงานบัญชีสุดท้ายได้ ระบบต้องการอย่างน้อย 1 บัญชีผู้ใช้');
      return;
    }
    if (confirm(`คุณต้องการลบบัญชีพนักงาน [${username}] ใช่หรือไม่?`)) {
      setStaff(prev => prev.filter(s => s.user !== username));
      showToast(`ลบบัญชีผู้ใช้ ${username} สำเร็จ`);
    }
  };

  const renderActiveSubTab = () => {
    switch (subTab) {
      case 'dashboard':
        return <OwnerDashboard orders={orders} expenses={expenses} menu={menu} />;

      case 'menu':
        return <OwnerMenu menu={menu} showToast={showToast} />;

      case 'summary':
        return <OwnerSummary orders={orders} expenses={expenses} showToast={showToast} />;

      case 'expenses':
        return (
          <div className="space-y-4">

            {/* ENTRY FORM */}
            <div className="bg-admin-panel border border-line rounded-2xl p-4 space-y-3">
              <div className="flex justify-between items-baseline">
                <h3 className="font-extrabold text-base font-kanit text-neutral-800">เพิ่มรายการรายจ่าย</h3>
                <span className="text-[10px] text-neutral-500 font-medium">
                  วันที่: {formatThaiDate(expDate)}
                </span>
              </div>

              <form onSubmit={handleAddExpense} className="space-y-3 text-xs font-thai">
                <div>
                  <label className="block font-bold text-neutral-500 mb-1">วันที่</label>
                  <input
                    type="date"
                    value={expDate}
                    max={todayKey()}
                    onChange={e => setExpDate(e.target.value || todayKey())}
                    className="w-full border rounded-xl p-2.5 bg-admin-field focus:outline-none focus:ring-1 focus:ring-amber-500 font-bold"
                  />
                </div>

                <div>
                  <label className="block font-bold text-neutral-500 mb-1">ชื่อร้าน</label>
                  <select
                    value={expShop}
                    onChange={e => setExpShop(e.target.value)}
                    className="w-full border rounded-xl p-2.5 bg-admin-field focus:outline-none focus:ring-1 focus:ring-amber-500 font-bold"
                  >
                    {SHOPS.map(s => (
                      <option key={s.id} value={s.id}>{s.label}</option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block font-bold text-neutral-500 mb-1">ประเภท</label>
                    <select
                      value={expCategory}
                      onChange={e => setExpCategory(e.target.value)}
                      className="w-full border rounded-xl p-2.5 bg-admin-field focus:outline-none focus:ring-1 focus:ring-amber-500 font-bold"
                    >
                      {EXPENSE_CATEGORIES.map(c => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block font-bold text-neutral-500 mb-1">ราคา</label>
                    <input
                      type="number"
                      min="0"
                      step="any"
                      value={expAmount}
                      onChange={e => setExpAmount(e.target.value)}
                      className="w-full border rounded-xl p-2.5 bg-admin-field focus:outline-none focus:ring-1 focus:ring-amber-500 font-mono font-bold"
                      placeholder="กรอกตัวเลข ฿"
                      required
                    />
                  </div>
                </div>

                <div>
                  <label className="block font-bold text-neutral-500 mb-1">หมายเหตุ</label>
                  <textarea
                    value={expNote}
                    onChange={e => setExpNote(e.target.value)}
                    rows={3}
                    className="w-full border rounded-xl p-2.5 bg-admin-field focus:outline-none focus:ring-1 focus:ring-amber-500 resize-none"
                    placeholder="เช่น ค่าน้ำแข็ง, ค่าแรงเบิกล่วงหน้า"
                  />
                </div>

                <button
                  type="submit"
                  className="w-full bg-admin-cta hover:bg-admin-cta-hover text-admin-cta-ink font-bold py-3 rounded-2xl transition font-kanit"
                >
                  บันทึกรายจ่าย
                </button>
              </form>
            </div>

            {/* HISTORY */}
            <div className="flex justify-between items-center gap-2 pl-1">
              <h3 className="font-extrabold text-base font-kanit text-neutral-800 whitespace-nowrap">
                ประวัติการใช้จ่าย
              </h3>
              <select
                value={historyDate}
                onChange={e => setHistoryDate(e.target.value)}
                className="border rounded-full py-1.5 px-3 bg-admin-field text-[11px] font-bold text-neutral-600 focus:outline-none focus:ring-1 focus:ring-amber-500"
              >
                {expenseDates.map(d => (
                  <option key={d} value={d}>{formatThaiDate(d)}</option>
                ))}
              </select>
            </div>

            <div className="bg-admin-card border rounded-2xl overflow-hidden shadow-xs">
              <div className="grid grid-cols-[1.4fr_1.2fr_0.8fr_1.4fr_auto] gap-2 px-3 py-2.5 bg-neutral-50 border-b text-[10px] font-extrabold text-neutral-500 font-kanit">
                <span>ร้าน</span>
                <span>ประเภท</span>
                <span className="text-right">ราคา</span>
                <span>หมายเหตุ</span>
                <span className="w-6" />
              </div>

              {dayExpenses.length > 0 ? (
                dayExpenses.map(e => (
                  <div
                    key={e.id}
                    className="grid grid-cols-[1.4fr_1.2fr_0.8fr_1.4fr_auto] gap-2 px-3 py-2.5 border-b border-neutral-100 last:border-0 text-[11px] items-center font-thai"
                  >
                    <span className="font-bold text-neutral-800">{shopLabel(e.shop)}</span>
                    <span className="text-neutral-600">{e.category}</span>
                    <span className="text-right font-mono font-bold text-neutral-800">
                      {e.amount.toLocaleString()}
                    </span>
                    <span className="text-neutral-500 truncate" title={e.note}>{e.note || '-'}</span>
                    <button
                      onClick={() => handleDeleteExpense(e.id, e.category, e.amount)}
                      className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-500/10 rounded-lg transition"
                      title="ลบรายการ"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))
              ) : (
                <p className="text-neutral-400 text-xs py-6 text-center font-medium">
                  ยังไม่มีรายจ่ายของวันที่ {formatThaiDate(historyDate)}
                </p>
              )}

              {dayExpenses.length > 0 && (
                <div className="flex justify-between items-center px-3 py-2.5 bg-admin-panel text-xs font-extrabold font-kanit">
                  <span className="text-neutral-600">รวมรายจ่ายวันนี้</span>
                  <span className="font-mono text-neutral-800">
                    ฿{sumExpenses(dayExpenses).toLocaleString()}
                  </span>
                </div>
              )}
            </div>
          </div>
        );

      case 'timeclock':
        return (
          <div className="space-y-4 font-thai text-xs">

            {/* BACKFILL — admin logs a forgotten clock */}
            <button
              onClick={openBackfill}
              className="w-full flex items-center justify-center gap-1.5 border-2 border-dashed border-neutral-300 hover:border-amber-500 hover:bg-amber-500/10 text-neutral-600 hover:text-amber-700 font-bold py-2.5 rounded-xl transition text-xs"
            >
              <CalendarClock className="w-4 h-4" />
              <span>ลงเวลาย้อนหลัง (กรณีพนักงานลืมลงเวลา)</span>
            </button>

            {/* TABLE 1 — MONTHLY SUMMARY: days, wage/day, salary, paid status */}
            <div className="bg-admin-card border rounded-2xl p-4 space-y-3 shadow-xs">
              <div className="flex justify-between items-center gap-2 flex-wrap">
                <h3 className="font-kanit font-extrabold text-xs text-neutral-400 uppercase tracking-wider">ตารางที่ 1: สรุปจำนวนวัน & เงินเดือน</h3>
                <input
                  type="month"
                  value={tcMonth}
                  onChange={(e) => setTcMonth(e.target.value)}
                  className="border rounded-xl p-2 bg-admin-field focus:outline-none focus:ring-1 focus:ring-amber-500 font-bold text-xs"
                />
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-[10px] text-neutral-400 uppercase border-b border-neutral-100">
                      <th className="text-left py-2 font-extrabold">ชื่อ</th>
                      <th className="text-center py-2 font-extrabold">จำนวนวัน</th>
                      <th className="text-right py-2 font-extrabold">ค่าแรง/วัน</th>
                      <th className="text-right py-2 font-extrabold">เงินเดือน</th>
                      <th className="text-center py-2 font-extrabold">สถานะ</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-100">
                    {tcMonthlySummary.map((row) => (
                      <tr key={row.user}>
                        <td className="py-2.5">
                          <span className="font-bold text-neutral-800 block">{row.name}</span>
                          <span className="text-[10px] text-neutral-400">{row.position || row.user}</span>
                        </td>
                        <td className="py-2.5 text-center font-mono font-extrabold text-neutral-800">
                          {row.days > 0 ? row.days : <span className="text-neutral-300">0</span>}
                        </td>
                        <td className="py-2.5 text-right font-mono text-neutral-500">
                          {row.dailyWage > 0 ? row.dailyWage.toLocaleString() : <span className="text-neutral-300">—</span>}
                        </td>
                        <td className="py-2.5 text-right font-mono font-bold text-amber-700">
                          {row.salary > 0 ? row.salary.toLocaleString() : <span className="text-neutral-300">—</span>}
                        </td>
                        <td className="py-2.5 text-center">
                          <button
                            onClick={() => handleTogglePaid(row)}
                            className={`text-[10px] font-bold px-2.5 py-1 rounded-full transition ${
                              row.paid
                                ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'
                                : 'bg-red-100 text-red-700 hover:bg-red-200'
                            }`}
                            title="แตะเพื่อสลับสถานะการจ่ายเงิน"
                          >
                            {row.paid ? 'จ่ายแล้ว ✓' : 'ยังไม่จ่าย'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-[10px] text-neutral-400">* นับเป็น 1 วันเมื่อมีทั้งเวลาเข้าและออก (ชั่วโมงมีไว้เช็กเข้าสายเท่านั้น) — เงินเดือน = จำนวนวัน × ค่าแรง/วัน</p>
            </div>

            {/* TABLE 2 — DAILY IN/OUT LOG (one row per event, by time) */}
            <div className="bg-admin-card border rounded-2xl p-4 space-y-3 shadow-xs">
              <div className="flex justify-between items-center gap-2 flex-wrap">
                <h3 className="font-kanit font-extrabold text-xs text-neutral-400 uppercase tracking-wider">ตารางที่ 2: ประวัติการเข้า-ออกรายวัน</h3>
                <input
                  type="date"
                  value={tcDate}
                  onChange={(e) => setTcDate(e.target.value)}
                  className="border rounded-xl p-2 bg-admin-field focus:outline-none focus:ring-1 focus:ring-amber-500 font-bold text-xs"
                />
              </div>

              {tcDayEvents.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-[10px] text-neutral-400 uppercase border-b border-neutral-100">
                        <th className="text-left py-2 font-extrabold">เวลา</th>
                        <th className="text-left py-2 font-extrabold">ชื่อ</th>
                        <th className="text-center py-2 font-extrabold">สถานะ (เข้า/ออก)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-neutral-100">
                      {tcDayEvents.map((ev) => (
                        <tr key={ev.id}>
                          <td className="py-2.5 font-mono font-bold text-neutral-700">{tcTime(ev.at)}</td>
                          <td className="py-2.5 font-bold text-neutral-800">{ev.name}</td>
                          <td className="py-2.5 text-center">
                            <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full ${ev.kind === 'in' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                              {ev.kind === 'in' ? 'เข้า' : 'ออก'}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="text-center py-8 text-neutral-400 font-medium">ไม่มีการลงเวลาในวันที่เลือก</div>
              )}
            </div>
          </div>
        );

      case 'settings':
        return (
          <div className="space-y-4">
            
            {/* MAIN SETTINGS CONFIG */}
            <form onSubmit={handleSaveSettings} className="bg-admin-card border rounded-2xl p-4 space-y-3.5 shadow-xs font-thai text-xs">
              <h3 className="font-kanit font-extrabold text-xs text-neutral-400 uppercase tracking-wider">ตั้งค่าระบบทั่วไป</h3>
              
              <div>
                <label className="block font-bold text-neutral-500 mb-1">ชื่อร้านค้า (ฝั่งกลางวัน)</label>
                <input
                  type="text"
                  value={settings.name}
                  onChange={e => setSettings({ ...settings, name: e.target.value })}
                  className="w-full border rounded-xl p-3 bg-admin-field focus:outline-none focus:ring-2 focus:ring-amber-500 font-bold"
                  required
                />
              </div>

              <div>
                <label className="block font-bold text-neutral-500 mb-1">ชื่อร้านค้า (ฝั่งกลางคืน)</label>
                <input
                  type="text"
                  value={settings.nameNight || ''}
                  onChange={e => setSettings({ ...settings, nameNight: e.target.value })}
                  className="w-full border rounded-xl p-3 bg-admin-field focus:outline-none focus:ring-2 focus:ring-amber-500 font-bold"
                  required
                />
              </div>

              <div>
                <label className="block font-bold text-neutral-500 mb-1">จำนวนโต๊ะให้บริการทั้งหมด</label>
                <input 
                  type="number"
                  min="1"
                  max="100"
                  value={settings.tables}
                  onChange={e => setSettings({ ...settings, tables: Math.max(1, parseInt(e.target.value) || 1) })}
                  className="w-full border rounded-xl p-3 bg-admin-field focus:outline-none focus:ring-2 focus:ring-amber-500 font-mono font-bold"
                  required
                />
              </div>

              <div>
                <label className="block font-bold text-neutral-500 mb-1">URL หลักระบบของร้าน (สำหรับสร้าง QR Code)</label>
                <input 
                  type="text"
                  value={settings.baseUrl}
                  onChange={e => setSettings({ ...settings, baseUrl: e.target.value })}
                  placeholder={window.location.origin + window.location.pathname}
                  className="w-full border rounded-xl p-3 bg-admin-field focus:outline-none focus:ring-2 focus:ring-amber-500 font-mono text-[11px]"
                />
              </div>

              <div>
                <label className="block font-bold text-neutral-500 mb-1">เบอร์พร้อมเพย์ร้าน (สำหรับ QR รับชำระเงิน)</label>
                <input
                  type="text"
                  value={settings.promptpayId || ''}
                  onChange={e => setSettings({ ...settings, promptpayId: e.target.value })}
                  placeholder="เบอร์มือถือ 10 หลัก หรือเลขบัตรประชาชน 13 หลัก"
                  className="w-full border rounded-xl p-3 bg-admin-field focus:outline-none focus:ring-2 focus:ring-amber-500 font-mono"
                />
                <p className="text-[10px] text-neutral-400 mt-1">เว้นว่างไว้ = ปิดตัวเลือกจ่ายด้วย QR ตอนเช็คบิล</p>
              </div>

              <button 
                type="submit"
                className="w-full bg-amber-600 hover:bg-amber-700 text-white font-bold py-3 rounded-xl transition text-center"
              >
                บันทึกการตั้งค่าระบบ
              </button>
            </form>

            {/* BACK-OFFICE COLOUR PICKERS */}
            <AdminThemePanel
              colors={activeColors}
              onChange={handleAdminColorChange}
              onReset={handleAdminColorReset}
            />

            {/* STAFF CRUD ACCOUNTS MANAGEMENT */}
            <div className="bg-admin-card border rounded-2xl p-4 space-y-4 shadow-xs font-thai text-xs">
              <h3 className="font-kanit font-extrabold text-xs text-neutral-400 uppercase tracking-wider">จัดการสิทธิ์พนักงาน</h3>
              
              <div className="divide-y divide-neutral-100 max-h-36 overflow-y-auto">
                {staff.map(s => (
                  <div key={s.user} className="py-2.5 flex justify-between items-center text-xs">
                    <div>
                      <span className="font-bold text-neutral-800 block">
                        {s.name}
                        {s.position && <span className="ml-1.5 text-[10px] font-semibold text-amber-700 bg-amber-50 border border-amber-100 px-1.5 py-0.5 rounded-full">{s.position}</span>}
                        {s.shop && (
                          <span className="ml-1 text-[10px] font-semibold text-neutral-500 bg-neutral-100 px-1.5 py-0.5 rounded-full">
                            {s.shop === 'night' ? (settings.nameNight || 'เรือนเก่า') : settings.name}
                          </span>
                        )}
                      </span>
                      <span className="text-neutral-400 font-mono text-[10px]">
                        ชื่อผู้ใช้: {s.user} &bull; รหัสผ่าน: ••••••
                        {s.dailyWage > 0 && <> &bull; ค่าแรง {s.dailyWage.toLocaleString()} บาท/วัน</>}
                      </span>
                    </div>
                    <button
                      onClick={() => handleDeleteStaffAccount(s.user)}
                      className="text-red-500 hover:text-red-700 p-1.5 hover:bg-red-500/10 rounded-lg transition"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>

              {/* ADD NEW STAFF FORM */}
              <form onSubmit={handleAddStaffAccount} className="border-t border-neutral-100 pt-3.5 space-y-3">
                <span className="text-[10px] font-extrabold text-neutral-400 uppercase block">เพิ่มพนักงานใหม่</span>
                
                <div className="grid grid-cols-2 gap-2 items-end">
                  <input
                    type="text"
                    value={newStaffName}
                    onChange={e => setNewStaffName(e.target.value)}
                    placeholder="ชื่อที่แสดง (เช่น เจ๊แหม่ม)"
                    className="border rounded-xl p-2.5 bg-admin-field focus:outline-none focus:ring-1 focus:ring-amber-500 font-bold"
                  />
                  <div>
                    <label className="text-[10px] font-bold text-neutral-400 block mb-1">ร้านที่ประจำ</label>
                    <select
                      value={newStaffShop}
                      onChange={e => setNewStaffShop(e.target.value)}
                      className="w-full border rounded-xl p-2.5 bg-admin-field focus:outline-none focus:ring-1 focus:ring-amber-500 font-bold font-thai"
                    >
                      <option value="day">{settings.name} (กลางวัน)</option>
                      <option value="night">{settings.nameNight || 'เรือนเก่า'} (กลางคืน)</option>
                    </select>
                  </div>
                </div>
                
                <div className="grid grid-cols-2 gap-2 items-end">
                  <input
                    type="text"
                    value={newStaffPosition}
                    onChange={e => setNewStaffPosition(e.target.value)}
                    placeholder="ตำแหน่ง (เช่น เสิร์ฟ, ครัว)"
                    className="border rounded-xl p-2.5 bg-admin-field focus:outline-none focus:ring-1 focus:ring-amber-500 font-bold"
                  />
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={newStaffWage}
                    onChange={e => setNewStaffWage(e.target.value)}
                    placeholder="ค่าแรง (บาท/วัน)"
                    className="border rounded-xl p-2.5 bg-admin-field focus:outline-none focus:ring-1 focus:ring-amber-500 font-mono font-bold"
                  />
                </div>

                <div>
                  <label className="text-[10px] font-bold text-neutral-400 block mb-1">สิทธิ์การเข้าถึง</label>
                  <select
                    value={newStaffRole}
                    onChange={e => setNewStaffRole(e.target.value)}
                    className="w-full border rounded-xl p-2.5 bg-admin-field focus:outline-none focus:ring-1 focus:ring-amber-500 font-bold font-thai"
                  >
                    <option value="staff">พนักงาน (เห็นเฉพาะบอร์ดรับออเดอร์)</option>
                    <option value="owner">เจ้าของ/ผู้บริหาร (เข้าหลังบ้านได้)</option>
                  </select>
                </div>

                <input
                  type="text"
                  value={newStaffUser}
                  onChange={e => setNewStaffUser(e.target.value)}
                  placeholder="ชื่อผู้ใช้งานเข้าระบบ"
                  className="w-full border rounded-xl p-2.5 bg-admin-field focus:outline-none focus:ring-1 focus:ring-amber-500 font-bold"
                  required
                />

                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newStaffPass}
                    onChange={e => setNewStaffPass(e.target.value)}
                    placeholder="รหัสผ่านเข้างาน"
                    className="flex-1 border rounded-xl p-2.5 bg-admin-field focus:outline-none focus:ring-1 focus:ring-amber-500 font-mono"
                    required
                  />
                  <button
                    type="submit"
                    className="bg-ctl hover:bg-ctl-hover text-ctl-ink font-bold px-4 rounded-xl transition font-thai"
                  >
                    + เพิ่มพนักงาน
                  </button>
                </div>
              </form>
            </div>

          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div className="space-y-4 font-thai text-sm">
      
      {/* SECTION HEADER */}
      <div className="bg-admin-head p-2.5 rounded-2xl">
        <h2 className="font-extrabold text-base font-kanit">หลังบ้านผู้บริหารระบบ</h2>
      </div>

      {/* SUB-TABS SELECTOR */}
      {/* Colours come from the --c-admin-* palette in index.css, so the whole
          bar can be re-coloured there without editing this file. */}
      <div className="flex gap-1 bg-admin-bar rounded-xl p-1 text-[10px] font-bold">
        {[
          { id: 'dashboard', label: 'ภาพรวม', icon: LayoutDashboard },
          { id: 'menu', label: 'จัดการเมนู', icon: UtensilsCrossed },
          { id: 'expenses', label: 'รายจ่าย', icon: Wallet },
          { id: 'summary', label: 'สรุปยอด', icon: FileSpreadsheet },
          { id: 'timeclock', label: 'ข้อมูลพนักงาน', icon: Users },
          { id: 'settings', label: 'ตั้งค่า', icon: SettingsIcon }
        ].map(tab => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setSubTab(tab.id)}
              // Icon-only tabs: the label is kept as title/aria-label for
              // tooltips + screen readers, but not rendered as text. With six
              // tabs sharing one row in the max-w-md shell, dropping the words
              // gives each icon room to breathe.
              title={tab.label}
              aria-label={tab.label}
              // shadow-sm, not shadow-xs: shadow-xs is a Tailwind v4 class and
              // this project is on v3, where it compiles to nothing at all —
              // which is what left the selected tab as white-on-near-white.
              className={`flex-1 py-2.5 px-0.5 rounded-lg flex items-center justify-center transition ${tab.id === subTab ? 'bg-admin-tab text-admin-tab-ink shadow-sm' : 'text-admin-tab-idle hover:text-admin-tab-hover'}`}
            >
              <Icon className="w-5 h-5 flex-shrink-0" />
            </button>
          );
        })}
      </div>

      {/* RENDER VIEW AREA */}
      {renderActiveSubTab()}

      {/* BACKFILL MODAL — admin logs a forgotten clock-in/out */}
      {backfill && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs z-[100] flex items-end justify-center p-0" onClick={() => setBackfill(null)}>
          <div className="bg-admin-card rounded-t-3xl max-w-md w-full p-6 space-y-4 text-neutral-800 max-h-[85vh] overflow-y-auto shadow-2xl border-t border-neutral-100 font-thai" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-start">
              <div>
                <h3 className="text-base font-extrabold font-kanit">ลงเวลาย้อนหลัง</h3>
                <span className="text-[10px] text-neutral-400 font-medium">สำหรับกรณีพนักงานลืมลงเวลาเข้า/ออก</span>
              </div>
              <button onClick={() => setBackfill(null)} className="p-1.5 rounded-full bg-neutral-100 hover:bg-neutral-200 text-neutral-500 transition">✕</button>
            </div>

            <div className="space-y-1.5">
              <label className="text-[10px] font-extrabold uppercase tracking-wider text-neutral-400 block">พนักงาน</label>
              <select
                value={backfill.user}
                onChange={(e) => setBackfill({ ...backfill, user: e.target.value })}
                className="w-full border rounded-xl p-2.5 bg-admin-field focus:outline-none focus:ring-1 focus:ring-amber-500 font-bold text-xs"
              >
                {(staff || []).map((s) => (
                  <option key={s.user} value={s.user}>{s.name} ({s.user})</option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="text-[10px] font-extrabold uppercase tracking-wider text-neutral-400 block">วันที่</label>
              <input
                type="date"
                value={backfill.date}
                onChange={(e) => setBackfill({ ...backfill, date: e.target.value })}
                className="w-full border rounded-xl p-2.5 bg-admin-field focus:outline-none focus:ring-1 focus:ring-amber-500 font-bold text-xs"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <label className="text-[10px] font-extrabold uppercase tracking-wider text-emerald-600 block">เวลาเข้า</label>
                <input
                  type="time"
                  value={backfill.inTime}
                  onChange={(e) => setBackfill({ ...backfill, inTime: e.target.value })}
                  className="w-full border rounded-xl p-2.5 bg-admin-field focus:outline-none focus:ring-1 focus:ring-amber-500 font-mono font-bold text-xs"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-extrabold uppercase tracking-wider text-amber-600 block">เวลาออก</label>
                <input
                  type="time"
                  value={backfill.outTime}
                  onChange={(e) => setBackfill({ ...backfill, outTime: e.target.value })}
                  className="w-full border rounded-xl p-2.5 bg-admin-field focus:outline-none focus:ring-1 focus:ring-amber-500 font-mono font-bold text-xs"
                />
              </div>
            </div>
            <p className="text-[10px] text-neutral-400">เว้นว่างช่องใดช่องหนึ่งได้ (เช่น ลงเฉพาะเวลาออกที่ลืม) — ถ้ามีบันทึกของวันนั้นอยู่แล้ว ระบบจะแก้ไขให้</p>

            <button
              onClick={handleSaveBackfill}
              disabled={savingClock}
              className="w-full bg-amber-600 hover:bg-amber-700 text-white font-bold py-3 rounded-xl transition text-sm disabled:opacity-50"
            >
              {savingClock ? 'กำลังบันทึก…' : 'บันทึกเวลา'}
            </button>
          </div>
        </div>
      )}

    </div>
  );
}

export default OwnerView;
