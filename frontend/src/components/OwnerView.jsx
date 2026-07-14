import React, { useState } from 'react';
import * as XLSX from 'xlsx';
import { 
  TrendingUp, 
  ShoppingBag, 
  Users, 
  Download, 
  Plus, 
  Trash2, 
  Edit3, 
  Settings as SettingsIcon,
  Coffee,
  CheckCircle,
  XCircle,
  Eye,
  Save,
  Moon,
  Sun
} from 'lucide-react';

function OwnerView({ 
  theme, 
  menu, 
  setMenu, 
  orders, 
  setOrders, 
  stock, 
  setStock, 
  settings, 
  setSettings, 
  staff, 
  setStaff, 
  showToast 
}) {
  const [subTab, setSubTab] = useState('report'); // report, menu-editor, settings
  const [editorTheme, setEditorTheme] = useState('day'); // theme menu to edit
  const [showItemModal, setShowItemModal] = useState(false);
  const [editingItem, setEditingItem] = useState(null); // null means adding new

  // Form states for menu editor modal
  const [formName, setFormName] = useState('');
  const [formPrice, setFormPrice] = useState('');
  const [formCategory, setFormCategory] = useState('');
  const [formEmoji, setFormEmoji] = useState('');
  const [formDesc, setFormDesc] = useState('');
  const [formTheme, setFormTheme] = useState('day');

  // Form states for staff accounts
  const [newStaffName, setNewStaffName] = useState('');
  const [newStaffUser, setNewStaffUser] = useState('');
  const [newStaffPass, setNewStaffPass] = useState('');

  const isDay = theme === 'day';

  // --- REPORT SUMMARY METRICS ---
  const paidOrders = orders.filter(o => o.status === 'paid');
  const pendingOrders = orders.filter(o => o.status !== 'paid' && o.status !== 'cancelled');
  
  const totalRevenue = paidOrders.reduce((sum, o) => sum + o.total, 0);
  const pendingRevenue = pendingOrders.reduce((sum, o) => sum + o.total, 0);
  
  const activeTablesCount = [...new Set(pendingOrders.map(o => o.table))].length;
  const tableUtilizationRate = settings.tables > 0 
    ? Math.round((activeTablesCount / settings.tables) * 100) 
    : 0;

  // Calculate top-selling dishes
  const getTopSellers = () => {
    const counts = {};
    orders.filter(o => o.status !== 'cancelled').forEach(o => {
      o.items.forEach(i => {
        counts[i.name] = (counts[i.name] || 0) + i.qty;
      });
    });

    return Object.keys(counts)
      .map(name => ({ name, qty: counts[name] }))
      .sort((a, b) => b.qty - a.qty)
      .slice(0, 5);
  };

  const topSellers = getTopSellers();

  // EXPORT EXCEL VIA SHEETJS
  const handleExportExcel = () => {
    if (orders.length === 0) {
      alert('ไม่มีข้อมูลรายการสั่งซื้อสำหรับการสร้างรายงาน');
      return;
    }

    const wsData = orders.map(o => ({
      'รหัสบิล': o.id,
      'หมายเลขโต๊ะ': o.table,
      'เวลาสั่งซื้อ': o.time,
      'ยอดชำระสุทธิ': o.total,
      'รายการอาหาร': o.items.map(i => `${i.name} (x${i.qty})`).join(', '),
      'สั่งซื้อโดย': o.by,
      'ประเภท': o.type === 'day' ? 'ตู้กับข้าวบ้านยาย (กลางวัน)' : 'Siam Blend Bar (กลางคืน)',
      'สถานะบิล': o.status === 'paid' ? 'ชำระเงินเรียบร้อย' : o.status === 'cancelled' ? 'ยกเลิกออเดอร์' : 'ค้างชำระ/รอเสิร์ฟ'
    }));

    const ws = XLSX.utils.json_to_sheet(wsData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'รายงานสั่งอาหาร');
    
    // Auto-fit column widths
    const maxLens = {};
    wsData.forEach(row => {
      Object.keys(row).forEach(key => {
        const valStr = String(row[key] || '');
        maxLens[key] = Math.max(maxLens[key] || 10, valStr.length * 1.5);
      });
    });
    ws['!cols'] = Object.keys(maxLens).map(key => ({ wch: maxLens[key] }));

    XLSX.writeFile(wb, `รายงานประวัติบัญชี_${new Date().toISOString().slice(0, 10)}.xlsx`);
    showToast('สร้างรายงาน Excel บันทึกลงเครื่องสำเร็จ ✓');
  };

  // --- MENU EDITOR ACTIONS ---
  const handleOpenItemModal = (item = null) => {
    if (item) {
      setEditingItem(item);
      setFormName(item.name);
      setFormPrice(String(item.price));
      setFormCategory(item.category);
      setFormEmoji(item.emoji || '');
      setFormDesc(item.desc || '');
      setFormTheme(item.theme || 'day');
    } else {
      setEditingItem(null);
      setFormName('');
      setFormPrice('');
      setFormCategory(categoriesList(editorTheme)[0] || 'อาหารจานเดียว');
      setFormEmoji('');
      setFormDesc('');
      setFormTheme(editorTheme);
    }
    setShowItemModal(true);
  };

  const categoriesList = (t) => {
    const list = menu.filter(m => m.theme === t).map(m => m.category);
    const defaults = t === 'day' 
      ? ['แนะนำ', 'จานเดียว', 'กับข้าว', 'ต้ม & ยำ', 'ผัด', 'ข้าว', 'ของหวาน', 'เครื่องดื่ม']
      : ['เครื่องดื่ม', 'ของกินเล่น'];
    return [...new Set([...list, ...defaults])];
  };

  const handleSaveMenuItem = (e) => {
    e.preventDefault();
    const priceNum = parseFloat(formPrice);
    if (!formName.trim() || isNaN(priceNum)) {
      alert('กรุณากรอกชื่อเมนูและราคาให้ถูกต้อง');
      return;
    }

    if (editingItem) {
      // Edit
      setMenu(prev => prev.map(m => {
        if (m.id === editingItem.id) {
          return {
            ...m,
            name: formName,
            price: priceNum,
            category: formCategory,
            emoji: formEmoji || '🍽️',
            desc: formDesc,
            theme: formTheme
          };
        }
        return m;
      }));
      showToast(`บันทึกการแก้ไข [${formName}] สำเร็จ`);
    } else {
      // Create
      const newItem = {
        id: 'item_' + Date.now().toString(36),
        name: formName,
        price: priceNum,
        category: formCategory,
        emoji: formEmoji || '🍽️',
        desc: formDesc,
        theme: formTheme,
        available: true
      };
      setMenu(prev => [...prev, newItem]);
      showToast(`เพิ่มเมนูใหม่ [${formName}] สำเร็จแล้ว`);
    }

    setShowItemModal(false);
  };

  const handleDeleteMenuItem = (itemId, name) => {
    if (confirm(`คุณมั่นใจที่จะลบเมนู [${name}] ออกจากระบบใช่หรือไม่?`)) {
      setMenu(prev => prev.filter(m => m.id !== itemId));
      showToast(`ลบ ${name} ออกจากระบบแล้ว`);
    }
  };

  const toggleItemAvailability = (itemId) => {
    setMenu(prev => prev.map(m => {
      if (m.id === itemId) {
        const nextState = !m.available;
        showToast(`${m.name}: ${nextState ? 'เปิดจำหน่าย' : 'หมดชั่วคราว'}`);
        return { ...m, available: nextState };
      }
      return m;
    }));
  };

  // --- SETTINGS FORM ACTIONS ---
  const handleSaveSettings = (e) => {
    e.preventDefault();
    showToast('บันทึกข้อมูลการตั้งค่าเสร็จสมบูรณ์');
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
      case 'report':
        return (
          <div className="space-y-4">
            
            {/* KPI OVERVIEWS CARDS */}
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-white border rounded-2xl p-4 shadow-xs">
                <span className="text-[10px] text-neutral-400 font-extrabold uppercase font-kanit tracking-wide block">ยอดขายที่เสร็จสิ้น (บาท)</span>
                <div className="flex items-center gap-1.5 mt-1.5">
                  <TrendingUp className="w-5 h-5 text-green-600" />
                  <span className="font-mono text-2xl font-extrabold text-neutral-800">฿{totalRevenue.toLocaleString()}</span>
                </div>
                <span className="text-[9px] text-neutral-400 font-medium block mt-1">รับเข้าชำระเงินบิลแล้ว</span>
              </div>
              <div className="bg-white border rounded-2xl p-4 shadow-xs">
                <span className="text-[10px] text-neutral-400 font-extrabold uppercase font-kanit tracking-wide block">บิลค้างชำระ (บาท)</span>
                <div className="flex items-center gap-1.5 mt-1.5">
                  <ShoppingBag className="w-5 h-5 text-amber-500" />
                  <span className="font-mono text-2xl font-extrabold text-neutral-800">฿{pendingRevenue.toLocaleString()}</span>
                </div>
                <span className="text-[9px] text-neutral-400 font-medium block mt-1">กำลังปรุง / รอเช็คยอด</span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="bg-white border rounded-2xl p-4 shadow-xs">
                <span className="text-[10px] text-neutral-400 font-extrabold uppercase font-kanit tracking-wide block">จำนวนบิลทั้งหมด</span>
                <span className="font-mono text-xl font-extrabold text-neutral-800 mt-1.5 block">
                  {orders.filter(o => o.status !== 'cancelled').length} บิล
                </span>
                <span className="text-[9px] text-neutral-400 font-medium block mt-1">
                  ชำระ {paidOrders.length} &bull; รอทำ {pendingOrders.length}
                </span>
              </div>
              <div className="bg-white border rounded-2xl p-4 shadow-xs">
                <span className="text-[10px] text-neutral-400 font-extrabold uppercase font-kanit tracking-wide block">ความหนาแน่นโต๊ะ</span>
                <span className="font-mono text-xl font-extrabold text-neutral-800 mt-1.5 block">
                  {tableUtilizationRate}%
                </span>
                <span className="text-[9px] text-neutral-400 font-medium block mt-1">
                  โต๊ะกำลังใช้งาน {activeTablesCount} / {settings.tables} โต๊ะ
                </span>
              </div>
            </div>

            {/* EXPORT TO EXCEL BUTTON */}
            <button
              onClick={handleExportExcel}
              className="w-full bg-green-700 hover:bg-green-800 text-white font-bold py-3.5 rounded-2xl transition flex items-center justify-center gap-2 shadow-sm font-kanit"
            >
              <Download className="w-4.5 h-4.5" />
              <span>ดาวน์โหลดรายงานประวัติการสั่ง (Excel)</span>
            </button>

            {/* TOP SELLERS CHART */}
            <div className="bg-white border rounded-2xl p-4 shadow-xs space-y-3">
              <h3 className="font-kanit font-extrabold text-xs text-neutral-400 uppercase tracking-wider">อันดับสินค้าขายดี (ยอดสั่งสูงสุด)</h3>
              {topSellers.length > 0 ? (
                <div className="space-y-2.5">
                  {topSellers.map((item, idx) => {
                    const maxQty = topSellers[0].qty;
                    const percent = Math.round((item.qty / maxQty) * 100);
                    return (
                      <div key={idx} className="space-y-1 text-xs">
                        <div className="flex justify-between font-semibold">
                          <span>{idx + 1}. {item.name}</span>
                          <span className="font-mono text-amber-700 font-bold">{item.qty} ชิ้น</span>
                        </div>
                        <div className="w-full bg-neutral-100 h-2 rounded-full overflow-hidden">
                          <div 
                            className="bg-amber-600 h-full rounded-full transition-all duration-500" 
                            style={{ width: `${percent}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-neutral-400 text-xs py-4 text-center font-medium">ยังไม่มีข้อมูลออเดอร์สำหรับการประมวลผล</p>
              )}
            </div>

            {/* RECENT HISTORIC LIST TRANSACTION LOG */}
            <div className="bg-white border rounded-2xl p-4 shadow-xs space-y-3 font-thai text-xs">
              <h3 className="font-kanit font-extrabold text-xs text-neutral-400 uppercase tracking-wider">ประวัติธุรกรรมล่าสุด</h3>
              <div className="space-y-2.5 max-h-48 overflow-y-auto pr-1">
                {orders.length > 0 ? (
                  [...orders].sort((a,b)=>b.createdAt-a.createdAt).map(o => (
                    <div key={o.id} className="flex justify-between items-center py-1.5 border-b border-neutral-50 last:border-0">
                      <div>
                        <span className="font-mono font-bold text-neutral-800">{o.no}</span>
                        <span className="text-neutral-400 text-[10px] ml-1.5">โต๊ะ {o.table} &bull; {o.time}</span>
                      </div>
                      <div className="text-right">
                        <span className="font-mono font-extrabold text-neutral-800 block">฿{o.total.toLocaleString()}</span>
                        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${o.status === 'paid' ? 'bg-green-100 text-green-700' : o.status === 'cancelled' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>
                          {o.status === 'paid' ? 'ชำระแล้ว' : o.status === 'cancelled' ? 'ยกเลิก' : 'ค้าง'}
                        </span>
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="text-neutral-400 text-xs py-2 text-center font-medium">ยังไม่มีรายการสั่งซื้อเข้าระบบ</p>
                )}
              </div>
            </div>
          </div>
        );

      case 'menu-editor':
        return (
          <div className="space-y-4">
            
            {/* THEME MENU SWITCH FILTER */}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setEditorTheme('day')}
                className={`flex-1 py-2 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 border ${editorTheme === 'day' ? 'bg-neutral-800 border-neutral-800 text-white' : 'bg-white border-neutral-200 text-neutral-500'}`}
              >
                <Sun className="w-3.5 h-3.5" />
                <span>เมนู ตู้กับข้าวบ้านยาย</span>
              </button>
              <button
                type="button"
                onClick={() => setEditorTheme('night')}
                className={`flex-1 py-2 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 border ${editorTheme === 'night' ? 'bg-orange-950 border-orange-950 text-[#E8D5C4]' : 'bg-white border-neutral-200 text-neutral-500'}`}
              >
                <Moon className="w-3.5 h-3.5" />
                <span>เมนู Siam Blend Bar</span>
              </button>
            </div>

            <div className="flex justify-between items-center pl-1">
              <span className="text-xs text-neutral-400 font-bold uppercase tracking-wider font-kanit">
                จัดการรายการ ({editorTheme === 'day' ? 'กลางวัน' : 'กลางคืน'})
              </span>
              <button 
                onClick={() => handleOpenItemModal(null)}
                className="flex items-center gap-1 bg-amber-600 hover:bg-amber-700 text-white font-bold py-1.5 px-3 rounded-xl text-xs transition"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>เพิ่มเมนูอาหาร</span>
              </button>
            </div>

            {/* ITEMS LIST */}
            <div className="bg-white border rounded-2xl divide-y divide-neutral-100 overflow-hidden shadow-xs">
              {menu.filter(item => item.theme === editorTheme).map(item => (
                <div key={item.id} className="p-3.5 flex justify-between items-center text-xs font-thai">
                  <div className="flex items-center gap-2.5">
                    <span className="text-2xl w-9 h-9 bg-neutral-50 rounded-xl flex items-center justify-center border">
                      {item.emoji || '🍽️'}
                    </span>
                    <div>
                      <span className="font-extrabold text-neutral-800 block">{item.name}</span>
                      <span className="text-neutral-400 text-[10px] font-mono">฿{item.price} &bull; {item.category}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => toggleItemAvailability(item.id)}
                      className={`text-[9px] px-2.5 py-1 rounded-full font-bold transition ${item.available ? 'bg-green-100 text-green-700 hover:bg-green-200' : 'bg-red-100 text-red-700 hover:bg-red-200'}`}
                    >
                      {item.available ? 'เปิดจำหน่าย' : 'หมดชั่วคราว'}
                    </button>
                    <button
                      onClick={() => handleOpenItemModal(item)}
                      className="p-2 border rounded-xl hover:bg-neutral-50 text-neutral-500 bg-white"
                      title="แก้ไขเมนู"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => handleDeleteMenuItem(item.id, item.name)}
                      className="p-2 border border-red-100 text-red-500 hover:bg-red-50 rounded-xl bg-white"
                      title="ลบเมนู"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );

      case 'settings':
        return (
          <div className="space-y-4">
            
            {/* MAIN SETTINGS CONFIG */}
            <form onSubmit={handleSaveSettings} className="bg-white border rounded-2xl p-4 space-y-3.5 shadow-xs font-thai text-xs">
              <h3 className="font-kanit font-extrabold text-xs text-neutral-400 uppercase tracking-wider">ตั้งค่าระบบทั่วไป</h3>
              
              <div>
                <label className="block font-bold text-neutral-500 mb-1">ชื่อร้านค้า (ฝั่งกลางวัน)</label>
                <input 
                  type="text"
                  value={settings.name}
                  onChange={e => setSettings({ ...settings, name: e.target.value })}
                  className="w-full border rounded-xl p-3 focus:outline-none focus:ring-2 focus:ring-amber-500 font-bold"
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
                  className="w-full border rounded-xl p-3 focus:outline-none focus:ring-2 focus:ring-amber-500 font-mono font-bold"
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
                  className="w-full border rounded-xl p-3 focus:outline-none focus:ring-2 focus:ring-amber-500 font-mono text-[11px]"
                />
              </div>

              <button 
                type="submit"
                className="w-full bg-amber-600 hover:bg-amber-700 text-white font-bold py-3 rounded-xl transition text-center"
              >
                บันทึกการตั้งค่าระบบ
              </button>
            </form>

            {/* STAFF CRUD ACCOUNTS MANAGEMENT */}
            <div className="bg-white border rounded-2xl p-4 space-y-4 shadow-xs font-thai text-xs">
              <h3 className="font-kanit font-extrabold text-xs text-neutral-400 uppercase tracking-wider">จัดการสิทธิ์พนักงาน</h3>
              
              <div className="divide-y divide-neutral-100 max-h-36 overflow-y-auto">
                {staff.map(s => (
                  <div key={s.user} className="py-2.5 flex justify-between items-center text-xs">
                    <div>
                      <span className="font-bold text-neutral-800 block">{s.name}</span>
                      <span className="text-neutral-400 font-mono text-[10px]">ชื่อผู้ใช้: {s.user} &bull; รหัสผ่าน: {s.pass}</span>
                    </div>
                    <button
                      onClick={() => handleDeleteStaffAccount(s.user)}
                      className="text-red-500 hover:text-red-700 p-1.5 hover:bg-red-50 rounded-lg transition"
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
                    className="border rounded-xl p-2.5 focus:outline-none focus:ring-1 focus:ring-amber-500 font-bold"
                  />
                  <input 
                    type="text" 
                    value={newStaffUser}
                    onChange={e => setNewStaffUser(e.target.value)}
                    placeholder="ชื่อผู้ใช้งานเข้าระบบ" 
                    className="border rounded-xl p-2.5 focus:outline-none focus:ring-1 focus:ring-amber-500 font-bold"
                    required
                  />
                </div>
                
                <div className="flex gap-2">
                  <input 
                    type="text" 
                    value={newStaffPass}
                    onChange={e => setNewStaffPass(e.target.value)}
                    placeholder="รหัสผ่านเข้างาน" 
                    className="flex-1 border rounded-xl p-2.5 focus:outline-none focus:ring-1 focus:ring-amber-500 font-mono"
                    required
                  />
                  <button 
                    type="submit"
                    className="bg-neutral-800 hover:bg-neutral-700 text-white font-bold px-4 rounded-xl transition font-thai"
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
      <div className="bg-[#F7F3EB]/40 dark:bg-neutral-900/20 p-2.5 rounded-2xl">
        <h2 className="font-extrabold text-base font-kanit">หลังบ้านผู้บริหารระบบ</h2>
        <span className="text-[10px] text-neutral-400 font-medium">ดูแดชบอร์ดการเงิน ยอดขาย ปรับแต่งเมนู และจัดการสิทธิ์พนักงาน</span>
      </div>

      {/* SUB-TABS SELECTOR */}
      <div className="flex gap-1.5 bg-neutral-100 rounded-xl p-1 text-[11px] font-bold">
        {[
          { id: 'report', label: 'รายงานบัญชี', icon: TrendingUp },
          { id: 'menu-editor', label: 'จัดการเมนู', icon: Coffee },
          { id: 'settings', label: 'ตั้งค่าร้านค้า', icon: SettingsIcon }
        ].map(tab => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setSubTab(tab.id)}
              className={`flex-1 py-2.5 rounded-lg flex items-center justify-center gap-1.5 transition ${tab.id === subTab ? 'bg-white text-neutral-800 shadow-xs' : 'text-neutral-500 hover:text-neutral-700'}`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* RENDER VIEW AREA */}
      {renderActiveSubTab()}

      {/* ADD/EDIT MENU ITEM MODAL */}
      {showItemModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs z-50 flex items-center justify-center p-4 animate-fade">
          <div className="bg-white rounded-2xl max-w-sm w-full p-6 text-neutral-800 space-y-4 border border-neutral-100 shadow-2xl">
            <div className="flex justify-between items-center border-b pb-2">
              <h3 className="font-extrabold text-base font-kanit text-neutral-800">
                {editingItem ? `แก้ไขเมนู [${editingItem.name}]` : 'เพิ่มเมนูอาหารใหม่'}
              </h3>
              <button 
                onClick={() => setShowItemModal(false)}
                className="p-1.5 rounded-full bg-neutral-100 hover:bg-neutral-200 text-neutral-500 transition"
              >
                <XCircle className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveMenuItem} className="space-y-3 font-thai text-xs">
              <div>
                <label className="block font-bold text-neutral-500 mb-1">ชื่อรายการอาหาร</label>
                <input 
                  type="text"
                  value={formName}
                  onChange={e => setFormName(e.target.value)}
                  className="w-full border rounded-xl p-2.5 focus:outline-none focus:ring-1 focus:ring-amber-500 font-bold"
                  placeholder="เช่น กะเพราเป็ดย่าง"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block font-bold text-neutral-500 mb-1">ราคา (บาท)</label>
                  <input 
                    type="number"
                    min="0"
                    step="any"
                    value={formPrice}
                    onChange={e => setFormPrice(e.target.value)}
                    className="w-full border rounded-xl p-2.5 focus:outline-none focus:ring-1 focus:ring-amber-500 font-mono font-bold"
                    placeholder="เช่น 80"
                    required
                  />
                </div>
                <div>
                  <label className="block font-bold text-neutral-500 mb-1">ไอคอนอิโมจิ</label>
                  <input 
                    type="text"
                    value={formEmoji}
                    onChange={e => setFormEmoji(e.target.value)}
                    className="w-full border rounded-xl p-2.5 focus:outline-none focus:ring-1 focus:ring-amber-500 text-center text-lg"
                    placeholder="เช่น 🍳"
                  />
                </div>
              </div>

              <div>
                <label className="block font-bold text-neutral-500 mb-1">หมวดหมู่ของเมนูนี้</label>
                <input 
                  type="text"
                  list="owner-catlist"
                  value={formCategory}
                  onChange={e => setFormCategory(e.target.value)}
                  className="w-full border rounded-xl p-2.5 focus:outline-none focus:ring-1 focus:ring-amber-500 font-bold"
                  placeholder="พิมพ์หมวดหมู่ใหม่ หรือ เลือกที่มีอยู่"
                  required
                />
                <datalist id="owner-catlist">
                  {categoriesList(formTheme).map(c => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
              </div>

              <div>
                <label className="block font-bold text-neutral-500 mb-1 font-thai">คำอธิบายประกอบย่อ</label>
                <input 
                  type="text"
                  value={formDesc}
                  onChange={e => setFormDesc(e.target.value)}
                  className="w-full border rounded-xl p-2.5 focus:outline-none focus:ring-1 focus:ring-amber-500"
                  placeholder="เช่น เส้นนุ่ม, เผ็ดจัดจ้าน..."
                />
              </div>

              <div>
                <label className="block font-bold text-neutral-500 mb-1">จัดจำหน่ายในช่วงเวลา (แชร์ธีมสี)</label>
                <select
                  value={formTheme}
                  onChange={e => setFormTheme(e.target.value)}
                  className="w-full border rounded-xl p-2.5 focus:outline-none focus:ring-1 focus:ring-amber-500 font-bold"
                >
                  <option value="day">ตู้กับข้าวบ้านยาย (กลางวัน)</option>
                  <option value="night">Siam Blend Bar (กลางคืน)</option>
                </select>
              </div>

              <div className="flex gap-2 pt-3">
                <button
                  type="button"
                  onClick={() => setShowItemModal(false)}
                  className="flex-1 bg-neutral-100 hover:bg-neutral-200 font-bold py-2.5 rounded-xl transition text-neutral-700"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  className="flex-1 bg-amber-600 hover:bg-amber-700 font-bold py-2.5 rounded-xl transition text-white"
                >
                  บันทึกรายการ
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}

export default OwnerView;
