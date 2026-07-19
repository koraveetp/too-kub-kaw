import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  Trash2,
  Settings as SettingsIcon,
  Wallet,
  LayoutDashboard,
  FileSpreadsheet,
  UtensilsCrossed
} from 'lucide-react';
import OwnerDashboard from './OwnerDashboard';
import OwnerSummary from './OwnerSummary';
import OwnerMenu from './OwnerMenu';
import AdminThemePanel from './AdminThemePanel';
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
  showToast
}) {
  const [subTab, setSubTab] = useState('dashboard'); // dashboard, report, expenses, settings

  // --- EXPENSE ENTRY FORM ---
  const [expShop, setExpShop] = useState(SHOPS[0].id);
  const [expCategory, setExpCategory] = useState(EXPENSE_CATEGORIES[0]);
  const [expAmount, setExpAmount] = useState('');
  const [expNote, setExpNote] = useState('');
  // Which day's history is on screen. Defaults to today.
  const [historyDate, setHistoryDate] = useState(() => todayKey());

  // Form states for staff accounts
  const [newStaffName, setNewStaffName] = useState('');
  const [newStaffUser, setNewStaffUser] = useState('');
  const [newStaffPass, setNewStaffPass] = useState('');


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
      date: todayKey(),
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
      name: newStaffName.trim() || newStaffUser.trim()
    };

    setStaff(prev => [...prev, newAcc]);
    setNewStaffName('');
    setNewStaffUser('');
    setNewStaffPass('');
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
                  วันที่: {formatThaiDate(todayKey())}
                </span>
              </div>

              <form onSubmit={handleAddExpense} className="space-y-3 text-xs font-thai">
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
                      <span className="font-bold text-neutral-800 block">{s.name}</span>
                      <span className="text-neutral-400 font-mono text-[10px]">ชื่อผู้ใช้: {s.user} &bull; รหัสผ่าน: ••••••</span>
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
                
                <div className="grid grid-cols-2 gap-2">
                  <input 
                    type="text" 
                    value={newStaffName}
                    onChange={e => setNewStaffName(e.target.value)}
                    placeholder="ชื่อที่แสดง (เช่น เจ๊แหม่ม)" 
                    className="border rounded-xl p-2.5 bg-admin-field focus:outline-none focus:ring-1 focus:ring-amber-500 font-bold"
                  />
                  <input 
                    type="text" 
                    value={newStaffUser}
                    onChange={e => setNewStaffUser(e.target.value)}
                    placeholder="ชื่อผู้ใช้งานเข้าระบบ" 
                    className="border rounded-xl p-2.5 bg-admin-field focus:outline-none focus:ring-1 focus:ring-amber-500 font-bold"
                    required
                  />
                </div>
                
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
        <span className="text-[10px] text-neutral-400 font-medium">ดูแดชบอร์ดการเงิน ยอดขาย ปรับแต่งเมนู และจัดการสิทธิ์พนักงาน</span>
      </div>

      {/* SUB-TABS SELECTOR */}
      {/* Colours come from the --c-admin-* palette in index.css, so the whole
          bar can be re-coloured there without editing this file. */}
      <div className="flex gap-1 bg-admin-bar rounded-xl p-1 text-[10px] font-bold">
        {[
          { id: 'dashboard', label: 'ภาพรวม', icon: LayoutDashboard },
          { id: 'menu', label: 'จัดการเมนู', icon: UtensilsCrossed },
          // Labels are kept short: with five tabs sharing one row inside the
          // max-w-md shell, the full wording ("บันทึกรายจ่าย") no longer fits.
          { id: 'expenses', label: 'รายจ่าย', icon: Wallet },
          { id: 'summary', label: 'สรุปยอด', icon: FileSpreadsheet },
          { id: 'settings', label: 'ตั้งค่า', icon: SettingsIcon }
        ].map(tab => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setSubTab(tab.id)}
              // shadow-sm, not shadow-xs: shadow-xs is a Tailwind v4 class and
              // this project is on v3, where it compiles to nothing at all —
              // which is what left the selected tab as white-on-near-white.
              className={`flex-1 py-2.5 px-0.5 rounded-lg flex items-center justify-center gap-1 transition ${tab.id === subTab ? 'bg-admin-tab text-admin-tab-ink shadow-sm' : 'text-admin-tab-idle hover:text-admin-tab-hover'}`}
            >
              <Icon className="w-3.5 h-3.5 flex-shrink-0" />
              <span className="truncate">{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* RENDER VIEW AREA */}
      {renderActiveSubTab()}

    </div>
  );
}

export default OwnerView;
