import React, { useState, useEffect, useRef } from 'react';
import { addonsFor, choicesFor, defaultChoices, choicesCost } from '../menu-groups';
import { orderShift } from '../shift';
import { generateInvoiceNo } from '../invoice';
import { mergeOrder, itemRound } from '../orders';
import { fetchStockItems, adjustStockItem, restockAllStock, resolveImageUrl } from '../api';
import {
  ClipboardList,
  LayoutGrid,
  Package,
  RefreshCw,
  Plus,
  Minus,
  Trash2,
  QrCode,
  PlusCircle,
  AlertTriangle,
  Check,
  Edit,
  X,
  Sun,
  Moon
} from 'lucide-react';

function StaffView({ 
  theme, 
  menu, 
  orders, 
  setOrders, 
  stock, 
  setStock, 
  settings, 
  activeStaffUser, 
  showToast,
  addons,
  choices
}) {
  const [subTab, setSubTab] = useState('orders'); // orders, take-order, tables, stock, qrcode
  // คลังวัตถุดิบ tab: read from the SQL `stock_items` table (not the mockup
  // drink `stock` used when taking an order). Loaded when the tab is opened.
  const [stockItems, setStockItems] = useState([]);
  const [stockLoading, setStockLoading] = useState(false);
  const [stockError, setStockError] = useState('');
  const [orderFilter, setOrderFilter] = useState('active'); // active, new, cooking, served, paid, all
  // Which shift's orders the board shows + notifies for. Defaults to the active
  // menu/theme, so staff see the shift matching the menu currently being served.
  const [shiftView, setShiftView] = useState(theme);
  
  // Direct ordering states
  const [targetTable, setTargetTable] = useState('1');
  const [takeOrderCart, setTakeOrderCart] = useState([]);
  const [directCat, setDirectCat] = useState(null);
  const [selectedItem, setSelectedItem] = useState(null);
  const [modalQty, setModalQty] = useState(1);
  const [modalNotes, setModalNotes] = useState('');
  const [selectedAddons, setSelectedAddons] = useState([]);
  // Pick-exactly-one groups (ขนาด / ระดับความหวาน), keyed by group name.
  const [selectedChoices, setSelectedChoices] = useState({});
  const [detailMode, setDetailMode] = useState('cart'); // 'cart' (take-order) | 'editbill'

  // Custom "เมนูอื่นๆ" — a staff-typed item that isn't on the menu (never
  // touches stock). Extras are toggle chips with editable prices; takeaway is a
  // flag surfaced to the kitchen.
  const [showCustomModal, setShowCustomModal] = useState(false);
  const [customName, setCustomName] = useState('');
  const [customPrice, setCustomPrice] = useState('');
  const [customQty, setCustomQty] = useState(1);
  const [customNote, setCustomNote] = useState('');
  const [customTakeaway, setCustomTakeaway] = useState(false);
  const [customExtras, setCustomExtras] = useState({
    'ไข่ดาว': { on: false, price: 10 },
    'ไข่เจียว': { on: false, price: 15 },
    'กับข้าว': { on: false, price: 20 }
  });

  // Edit Bill states
  const [editingBill, setEditingBill] = useState(null); // holds the order object being edited
  const [editAddMenuId, setEditAddMenuId] = useState('');

  // --- New-order notifications (toast + sound) ------------------------------
  // Track which order ids we've already seen so the first load doesn't fire a
  // burst of toasts. On mount every current order is marked seen silently; only
  // genuinely new orders that match the selected shift notify thereafter.
  const seenOrderIds = useRef(null);
  const audioCtxRef = useRef(null);

  // A short "ding-dong" via the Web Audio API — no audio file to ship, and a
  // blocked/suspended context can never break the board (best-effort only).
  const playChime = () => {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      if (!audioCtxRef.current) audioCtxRef.current = new Ctx();
      const ctx = audioCtxRef.current;
      if (ctx.state === 'suspended') ctx.resume();
      const now = ctx.currentTime;
      [[880, 0], [1174, 0.14]].forEach(([freq, at]) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.0001, now + at);
        gain.gain.exponentialRampToValueAtTime(0.3, now + at + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + at + 0.25);
        osc.connect(gain).connect(ctx.destination);
        osc.start(now + at);
        osc.stop(now + at + 0.26);
      });
    } catch {
      /* audio is best-effort */
    }
  };

  useEffect(() => {
    // First run: remember everything already on the board without notifying.
    if (seenOrderIds.current === null) {
      seenOrderIds.current = new Set(orders.map(o => o.id));
      return;
    }
    const fresh = orders.filter(o => !seenOrderIds.current.has(o.id));
    if (fresh.length === 0) return;
    const matching = fresh.filter(o => o.status === 'new' && orderShift(o) === shiftView);
    // Mark every fresh order seen (even the other shift's) so a later shift
    // toggle doesn't replay them as if they had only just arrived.
    fresh.forEach(o => seenOrderIds.current.add(o.id));
    if (matching.length > 0) {
      const label = shiftView === 'day' ? 'กลางวัน' : 'กลางคืน';
      matching.forEach(o =>
        showToast(`🔔 ออเดอร์ใหม่ (${label}) โต๊ะ ${o.table} · ฿${(o.total || 0).toLocaleString()}`)
      );
      playChime();
    }
  }, [orders, shiftView]);

  const isDay = theme === 'day';
  const filteredMenu = menu.filter(item => item.theme === theme);
  const categories = [...new Set(filteredMenu.map(item => item.category))];

  if (categories.length > 0 && !directCat) {
    setDirectCat(categories[0]);
  } else if (categories.length > 0 && !categories.includes(directCat)) {
    setDirectCat(categories[0]);
  }

  // Filter orders for listing
  const getFilteredOrders = () => {
    // Screen the board to the selected shift first, then by status.
    let list = [...orders]
      .filter(o => orderShift(o) === shiftView)
      .sort((a, b) => b.createdAt - a.createdAt);
    if (orderFilter === 'active') {
      return list.filter(o => o.status !== 'paid' && o.status !== 'cancelled');
    }
    if (orderFilter !== 'all') {
      return list.filter(o => o.status === orderFilter);
    }
    return list;
  };

  const payOrder = (order) => {
    if (confirm(`ยืนยันการเช็คบิล โต๊ะ ${order.table} ยอดรวม ฿${order.total.toLocaleString()} ใช่หรือไม่?`)) {
      // On payment: stamp a bill number, mark paid and record the checkout time.
      // Kept in `orders` as paid history (OwnerView reports read it); the table
      // frees up on its own since getTableStatus ignores paid bills.
      const paidAt = Date.now();
      setOrders(prev => prev.map(o => {
        if (o.id !== order.id) return o;
        // Count off `prev` so the running number reflects the latest state.
        const invoiceNo = o.invoiceNo || generateInvoiceNo(o, prev);
        return { ...o, invoiceNo, status: 'paid', paidAt };
      }));
      clearTableWorkspace(order.table);
      showToast(`เช็คบิล โต๊ะ ${order.table} เรียบร้อยแล้ว`);
    }
  };

  const cancelOrder = (orderId) => {
    if (confirm('คุณต้องการยกเลิกออเดอร์นี้ใช่หรือไม่?')) {
      setOrders(prev => prev.map(o => {
        if (o.id === orderId) {
          showToast('ยกเลิกออเดอร์แล้ว');
          return { ...o, status: 'cancelled' };
        }
        return o;
      }));
    }
  };

  const getStatusLabel = (status) => {
    switch (status) {
      case 'new': return 'ใหม่';
      case 'cooking': return 'กำลังทำ';
      case 'served': return 'เสิร์ฟแล้ว';
      case 'paid': return 'ชำระแล้ว';
      case 'cancelled': return 'ยกเลิก';
      default: return status;
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'new': return 'bg-[#FDECC8] text-[#8a5a00]';
      case 'cooking': return 'bg-[#DCE9F7] text-[#2F5D8A]';
      case 'served': return 'bg-[#DFF0E3] text-[#2C6E49]';
      case 'paid': return 'bg-[#E9E5DB] text-[#6b6656]';
      case 'cancelled': return 'bg-[#F6DAD7] text-[#9a2c22]';
      default: return 'bg-neutral-100 text-neutral-600';
    }
  };

  // Direct order handlers
  const handleOpenDetail = (item, mode = 'cart') => {
    if (!item.available) return;
    setDetailMode(mode);
    setSelectedItem(item);
    setModalQty(1);
    setModalNotes('');
    setSelectedAddons([]);
    setSelectedChoices(defaultChoices(choicesFor(choices, theme, item)));
  };

  const handleChoiceChange = (groupName, option) => {
    setSelectedChoices(prev => ({ ...prev, [groupName]: option }));
  };

  const handleAddonChange = (addonName, price, isChecked) => {
    if (isChecked) {
      setSelectedAddons(prev => [...prev, { name: addonName, price }]);
    } else {
      setSelectedAddons(prev => prev.filter(a => a.name !== addonName));
    }
  };

  const handleAddToCart = () => {
    if (!selectedItem) return;

    // Choices (ไซส์ L +5) ride on addonCost alongside addons, so bills and
    // kitchen tickets need no changes to understand them.
    const addonCost =
      selectedAddons.reduce((sum, a) => sum + a.price, 0) + choicesCost(selectedChoices);
    const chosenNames = Object.values(selectedChoices).map(o => o.name);

    // When editing an existing bill, push straight into that bill. Tag the new
    // item with the bill's current last round so it stays grouped with it
    // rather than starting a stray divider.
    if (detailMode === 'editbill' && editingBill) {
      const lastRound = editingBill.items.reduce((m, it) => Math.max(m, itemRound(it)), 1);
      const items = [...editingBill.items, {
        name: selectedItem.name,
        qty: modalQty,
        price: selectedItem.price,
        addonCost: addonCost,
        addOns: [...chosenNames, ...selectedAddons.map(a => a.name)],
        note: modalNotes,
        round: lastRound
      }];
      const total = items.reduce((sum, item) => sum + (item.price + (item.addonCost || 0)) * item.qty, 0);
      setEditingBill({ ...editingBill, items, total });
      setSelectedItem(null);
      showToast(`เพิ่ม ${selectedItem.name} ในบิลชั่วคราวแล้ว`);
      return;
    }

    const cartItem = {
      id: selectedItem.id + '_' + Date.now().toString(36),
      menuId: selectedItem.id,
      name: selectedItem.name,
      basePrice: selectedItem.price,
      price: selectedItem.price,
      addonCost: addonCost,
      qty: modalQty,
      addons: [...chosenNames, ...selectedAddons.map(a => a.name)],
      note: modalNotes,
      stockRef: selectedItem.stockRef || null
    };

    setTakeOrderCart(prev => [...prev, cartItem]);
    setSelectedItem(null);
    showToast(`เพิ่ม ${cartItem.name} ลงบิลเรียบร้อย`);
  };

  const handleRemoveDirectCartItem = (itemId) => {
    setTakeOrderCart(prev => prev.filter(item => item.id !== itemId));
  };

  // --- Custom "เมนูอื่นๆ" handlers -------------------------------------------
  const openCustomModal = () => {
    setCustomName('');
    setCustomPrice('');
    setCustomQty(1);
    setCustomNote('');
    setCustomTakeaway(false);
    setCustomExtras({
      'ไข่ดาว': { on: false, price: 10 },
      'ไข่เจียว': { on: false, price: 15 },
      'กับข้าว': { on: false, price: 20 }
    });
    setShowCustomModal(true);
  };

  const toggleCustomExtra = (name) => {
    setCustomExtras(prev => ({ ...prev, [name]: { ...prev[name], on: !prev[name].on } }));
  };

  const setCustomExtraPrice = (name, val) => {
    const price = Math.max(0, Number(val) || 0);
    setCustomExtras(prev => ({ ...prev, [name]: { ...prev[name], price } }));
  };

  // Selected extras (with their edited prices) + the sums used for the total.
  const customSelectedExtras = Object.entries(customExtras)
    .filter(([, v]) => v.on)
    .map(([name, v]) => ({ name, price: Number(v.price) || 0 }));
  const customAddonCost = customSelectedExtras.reduce((sum, e) => sum + e.price, 0);
  const customPriceNum = Number(customPrice) || 0;
  const customValid = customName.trim() !== '' && customPriceNum > 0;
  const customLiveTotal = (customPriceNum + customAddonCost) * customQty;

  const handleAddCustomToCart = () => {
    if (!customValid) return; // ชื่อห้ามว่าง, ราคา > 0
    // Extras carry their price in the label so the kitchen/bill shows both.
    const addonNames = customSelectedExtras.map(e => `${e.name} +฿${e.price}`);
    if (customTakeaway) addonNames.push('🏠 กลับบ้าน');

    const cartItem = {
      id: 'custom_' + Date.now().toString(36),
      menuId: 'custom',
      name: customName.trim(),
      basePrice: customPriceNum,
      price: customPriceNum,
      addonCost: customAddonCost,
      qty: customQty,
      addons: addonNames,
      note: customNote,
      stockRef: null // custom items never deduct stock
    };

    setTakeOrderCart(prev => [...prev, cartItem]);
    setShowCustomModal(false);
    showToast(`เพิ่ม ${cartItem.name} ลงบิลเรียบร้อย`);
  };

  const handlePlaceDirectOrder = () => {
    if (takeOrderCart.length === 0) return;

    // Validate stock
    let stockError = false;
    let errorItemName = '';
    takeOrderCart.forEach(cartItem => {
      if (cartItem.stockRef && stock[cartItem.stockRef]) {
        if (stock[cartItem.stockRef].count < cartItem.qty) {
          stockError = true;
          errorItemName = cartItem.name;
        }
      }
    });

    if (stockError) {
      alert(`คลังสินค้าสำหรับเครื่องดื่ม [${errorItemName}] ไม่เพียงพอ ไม่สามารถลงบิลได้`);
      return;
    }

    // Deduct stock
    const updatedStock = { ...stock };
    takeOrderCart.forEach(cartItem => {
      if (cartItem.stockRef && updatedStock[cartItem.stockRef]) {
        updatedStock[cartItem.stockRef].count -= cartItem.qty;
      }
    });
    setStock(updatedStock);

    const orderNo = '#' + String(orders.length + 1).padStart(3, '0');
    const directTotal = takeOrderCart.reduce((sum, item) => sum + (item.basePrice + item.addonCost) * item.qty, 0);
    const newOrder = {
      id: 'B' + Math.floor(1000 + Math.random() * 9000),
      no: orderNo,
      time: new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }),
      createdAt: Date.now(),
      // Shift is stamped from the active menu/theme, so the order lands on the
      // matching day/night board regardless of the wall clock.
      type: theme,
      table: targetTable,
      items: takeOrderCart.map(item => ({
        name: item.name,
        qty: item.qty,
        price: item.basePrice,
        addonCost: item.addonCost,
        addOns: item.addons,
        note: item.note
      })),
      total: directTotal,
      status: 'new',
      note: takeOrderCart.map(i => i.note).filter(Boolean).join(' | '),
      by: 'พนักงาน:' + (activeStaffUser || 'Staff')
    };

    // Merge into the table's open bill (as a new round) if it hasn't checked
    // out yet; otherwise this opens a fresh bill.
    setOrders(prev => mergeOrder(prev, newOrder));
    setTakeOrderCart([]);
    showToast(`ลงบิล โต๊ะ ${targetTable} สำเร็จแล้ว ✓`);
    setSubTab('orders');
  };

  // Edit Bill Modal handlers
  const handleOpenEditBill = (table) => {
    const activeBill = orders.find(o => String(o.table) === String(table) && o.status !== 'paid' && o.status !== 'cancelled');
    if (activeBill) {
      setEditingBill(JSON.parse(JSON.stringify(activeBill))); // Deep copy
      setEditAddMenuId('');
    } else {
      alert(`ไม่พบบิลค้างชำระสำหรับ โต๊ะ ${table}`);
    }
  };

  const editBillTotal = (items) =>
    items.reduce((sum, item) => sum + (item.price + (item.addonCost || 0)) * item.qty, 0);

  const handleEditBillQty = (idx, val) => {
    if (!editingBill) return;
    const items = [...editingBill.items];
    items[idx].qty = Math.max(1, items[idx].qty + val);
    setEditingBill({ ...editingBill, items, total: editBillTotal(items) });
  };

  const handleRemoveEditBillItem = (idx) => {
    if (!editingBill) return;
    const items = editingBill.items.filter((_, i) => i !== idx);
    setEditingBill({ ...editingBill, items, total: editBillTotal(items) });
  };

  const handleAddItemToEditBill = () => {
    if (!editAddMenuId || !editingBill) return;
    const item = filteredMenu.find(m => m.id === editAddMenuId);
    if (!item) return;
    // Open the same detail modal so staff can pick add-ons/notes/qty
    handleOpenDetail(item, 'editbill');
    setEditAddMenuId('');
  };

  const handleSaveEditedBill = () => {
    if (!editingBill) return;
    if (editingBill.items.length === 0) {
      // If all items removed, cancel the bill
      setOrders(prev => prev.map(o => {
        if (o.id === editingBill.id) {
          return { ...o, status: 'cancelled', items: [], total: 0 };
        }
        return o;
      }));
      showToast('ยกเลิกบิลสำเร็จเนื่องจากลบทุกรายการ');
    } else {
      setOrders(prev => prev.map(o => {
        if (o.id === editingBill.id) {
          return { ...o, items: editingBill.items, total: editingBill.total };
        }
        return o;
      }));
      showToast('บันทึกแก้ไขบิลเสร็จสิ้น');
    }
    setEditingBill(null);
  };

  // Wipe any in-progress staff workspace still tied to a table, so a freshly
  // paid/cleared table starts clean for the next group — no old take-order cart,
  // no stale edit-bill modal bleeding one session's data into the next.
  const clearTableWorkspace = (table) => {
    const same = (t) => String(t) === String(table);
    if (editingBill && same(editingBill.table)) setEditingBill(null);
    if (same(targetTable)) setTakeOrderCart([]);
    // Close the item-detail modal if it was opened for this table's flow.
    if (
      selectedItem &&
      ((detailMode === 'editbill' && editingBill && same(editingBill.table)) ||
        (detailMode === 'cart' && same(targetTable)))
    ) {
      setSelectedItem(null);
    }
  };

  const handleClearAndPay = (table) => {
    // Settle the whole table: pay EVERY active bill on it (same predicate
    // getTableStatus uses), so afterwards getTableStatus finds nothing
    // outstanding and the table reliably flips back to "ว่าง". Table occupancy
    // is shift-agnostic — a physical table is busy if it has ANY open bill,
    // regardless of whether it was placed in the day or night shift.
    const activeBills = orders.filter(
      o => String(o.table) === String(table) && o.status !== 'paid' && o.status !== 'cancelled'
    );
    if (activeBills.length === 0) return;
    const grandTotal = activeBills.reduce((sum, o) => sum + (o.total || 0), 0);
    if (!confirm(`ยืนยันการเช็คบิล โต๊ะ ${table} ยอดรวม ฿${grandTotal.toLocaleString()} ใช่หรือไม่?`)) return;

    // Settle each bill oldest-first so the running invoice numbers come out in
    // chronological order.
    const orderedIds = [...activeBills]
      .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))
      .map(o => o.id);
    const paidAt = Date.now();

    // Mark paid — kept in `orders` as history so OwnerView's Excel report still
    // sees them (never removed). Assign a SEPARATE invoice number to each bill,
    // building the numbers up on a working copy so bill #2 counts bill #1 (etc.)
    // and each gets a distinct, sequential number.
    setOrders(prev => {
      const working = [...prev];
      for (const id of orderedIds) {
        const idx = working.findIndex(o => o.id === id);
        if (idx === -1) continue;
        const invoiceNo = working[idx].invoiceNo || generateInvoiceNo(working[idx], working);
        working[idx] = { ...working[idx], invoiceNo, status: 'paid', paidAt };
      }
      return working;
    });
    // Free the table for the next group: drop any lingering workspace bound to it.
    clearTableWorkspace(table);
    showToast(`เช็คบิล โต๊ะ ${table} เรียบร้อยแล้ว โต๊ะพร้อมรับลูกค้าใหม่`);
  };

  // --- คลังวัตถุดิบ (SQL stock_items) ---------------------------------------
  // Load the inventory from the database whenever the tab is opened.
  const loadStockItems = async () => {
    setStockLoading(true);
    setStockError('');
    try {
      setStockItems(await fetchStockItems());
    } catch (err) {
      setStockError(err.message || 'โหลดคลังวัตถุดิบไม่สำเร็จ');
    } finally {
      setStockLoading(false);
    }
  };

  useEffect(() => {
    if (subTab === 'stock') loadStockItems();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subTab]);

  // Add `amount` to one item, persisting to the database. Updates the row in
  // place from the server's returned quantity (kept accurate even if two staff
  // edit at once).
  const adjustStockItemQty = async (id, amount) => {
    try {
      const updated = await adjustStockItem(id, amount);
      setStockItems((prev) => prev.map((it) => (it.id === id ? updated : it)));
      showToast(`${updated.name} +${amount} (คงเหลือ ${updated.quantity})`);
    } catch (err) {
      showToast(err.message || 'ปรับจำนวนคลังไม่สำเร็จ');
    }
  };

  // Bump every item in the database, then reload to reflect the new totals.
  const handleRestockAll = async (amount) => {
    try {
      await restockAllStock(amount);
      await loadStockItems();
      showToast(`เติมสต็อกทั้งหมด +${amount} เรียบร้อย`);
    } catch (err) {
      showToast(err.message || 'เติมสต็อกทั้งหมดไม่สำเร็จ');
    }
  };

  // Helper: check table status. Occupancy is shift-agnostic — the table is busy
  // whenever it has any unpaid/uncancelled bill, no matter which shift (day/night)
  // the order was stamped with, so an order never "disappears" just because the
  // ambient theme differs from the order's clock-based type.
  const getTableStatus = (tableNum) => {
    const activeBill = orders.find(o => String(o.table) === String(tableNum) && o.status !== 'paid' && o.status !== 'cancelled');
    if (activeBill) {
      return { active: true, bill: activeBill };
    }
    return { active: false, bill: null };
  };

  const renderActiveSubTab = () => {
    switch (subTab) {
      case 'orders':
        const filteredOrders = getFilteredOrders();
        return (
          <div className="space-y-4">
            {/* SHIFT SELECTOR — screens the board (and notifications) by shift */}
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-neutral-400">กะที่แสดง</span>
              <div className="flex gap-1 bg-neutral-100 rounded-xl p-1 text-[11px] font-bold">
                {[
                  { k: 'day', l: 'กลางวัน', icon: Sun },
                  { k: 'night', l: 'กลางคืน', icon: Moon }
                ].map(s => {
                  const Icon = s.icon;
                  return (
                    <button
                      key={s.k}
                      onClick={() => setShiftView(s.k)}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition ${s.k === shiftView ? 'bg-admin-field text-neutral-800 shadow-xs' : 'text-neutral-500 hover:text-neutral-700'}`}
                    >
                      <Icon className="w-3.5 h-3.5" />
                      <span>{s.l}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
              {[
                { k: 'active', l: 'กำลังทำงาน (ค้างชำระ)' },
                { k: 'paid', l: 'ชำระเงินแล้ว' },
                { k: 'all', l: 'ทั้งหมด' }
              ].map(f => (
                <button
                  key={f.k}
                  onClick={() => setOrderFilter(f.k)}
                  className={`px-3.5 py-1.5 rounded-full font-bold text-xs whitespace-nowrap transition border ${f.k === orderFilter ? 'bg-ctl border-ctl text-ctl-ink' : 'bg-admin-card border-neutral-200 text-neutral-500'}`}
                >
                  {f.l}
                </button>
              ))}
            </div>

            {filteredOrders.length > 0 ? (
              <div className="grid grid-cols-1 gap-3.5">
                {filteredOrders.map(order => (
                  <div key={order.id} className="border border-neutral-200 bg-admin-card rounded-2xl p-4 shadow-xs relative">
                    <div className="flex justify-between items-center border-b pb-2 mb-2">
                      <div className="flex items-center gap-2">
                        <span className="font-extrabold bg-ctl text-ctl-ink text-[11px] px-2 py-0.5 rounded-md font-kanit">
                          โต๊ะ {order.table}
                        </span>
                        <span className="font-mono text-neutral-400 text-xs font-semibold">{order.no}</span>
                      </div>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${getStatusColor(order.status)}`}>
                        {getStatusLabel(order.status)}
                      </span>
                    </div>

                    {order.invoiceNo && (
                      <div className="-mt-1 mb-2 text-[10px] font-mono font-bold text-amber-700">
                        เลขที่บิล: {order.invoiceNo}
                      </div>
                    )}

                    <div className="space-y-1.5 py-1">
                      {order.items.map((item, idx) => {
                        // Divider between ordering rounds merged into this bill.
                        const showRoundDivider = idx > 0 && itemRound(item) !== itemRound(order.items[idx - 1]);
                        return (
                          <React.Fragment key={idx}>
                            {showRoundDivider && (
                              <div className="flex items-center gap-2 pt-1 text-[9px] text-neutral-400 font-semibold">
                                <span className="h-px flex-1 bg-neutral-200" />
                                สั่งเพิ่ม · รอบที่ {itemRound(item)}
                                <span className="h-px flex-1 bg-neutral-200" />
                              </div>
                            )}
                            <div className="flex justify-between items-start text-xs font-thai text-neutral-800">
                              <div>
                                <span className="font-bold text-amber-700 mr-1.5">{item.qty}×</span>
                                <span>{item.name}</span>
                                {item.addOns && item.addOns.length > 0 && (
                                  <p className="text-[9px] text-neutral-400 pl-5">พิเศษ: {item.addOns.join(', ')}</p>
                                )}
                                {item.note && (
                                  <p className="text-[9px] text-red-500 italic pl-5">📝 {item.note}</p>
                                )}
                              </div>
                              <span className="font-mono text-neutral-500 font-medium">฿{(item.price + (item.addonCost || 0)) * item.qty}</span>
                            </div>
                          </React.Fragment>
                        );
                      })}
                    </div>

                    <div className="border-t border-neutral-100 mt-2.5 pt-2 flex justify-between items-center text-xs">
                      <span className="text-[10px] text-neutral-400 font-medium">{order.time} น. · {order.by}</span>
                      <b className="font-mono text-neutral-800 font-extrabold">฿{order.total.toLocaleString()}</b>
                    </div>

                    {/* Single check-bill action */}
                    {order.status !== 'paid' && order.status !== 'cancelled' && (
                      <div className="flex gap-2 mt-3 pt-2.5 border-t border-neutral-50">
                        <button
                          onClick={() => payOrder(order)}
                          className="flex-1 bg-amber-600 hover:bg-amber-700 text-white font-bold py-2 rounded-xl text-xs transition"
                        >
                          ฿ เช็คบิล
                        </button>
                        <button
                          onClick={() => cancelOrder(order.id)}
                          className="px-3 border border-neutral-200 hover:bg-neutral-50 text-neutral-500 font-bold py-2 rounded-xl text-xs transition"
                        >
                          ยกเลิก
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-12 text-neutral-400 text-xs font-medium">ไม่มีรายการออเดอร์ในหมวดหมู่ที่เลือก</div>
            )}
          </div>
        );

      case 'take-order':
        return (
          <div className="space-y-4">
            <div className="bg-admin-card border rounded-2xl p-4 space-y-3 shadow-xs">
              <div>
                <label className="block text-xs font-bold text-neutral-400 mb-1 uppercase">เลือกโต๊ะที่ต้องการรับออเดอร์</label>
                <select 
                  value={targetTable}
                  onChange={e => setTargetTable(e.target.value)}
                  className="w-full border rounded-xl p-3 focus:outline-none focus:ring-2 focus:ring-amber-500 bg-neutral-50 font-bold text-xs"
                >
                  {Array.from({ length: settings.tables }, (_, i) => (
                    <option key={i+1} value={String(i+1)}>โต๊ะ {i+1}</option>
                  ))}
                  <option value="กลับบ้าน">สั่งกลับบ้าน / Takeaway</option>
                </select>
              </div>

              {/* Direct Categories Selector */}
              <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-none pt-1">
                {categories.map(c => (
                  <button
                    key={c}
                    onClick={() => setDirectCat(c)}
                    className={`px-3 py-1 rounded-full text-xs font-bold whitespace-nowrap transition border ${c === directCat ? 'bg-ctl border-ctl text-ctl-ink' : 'bg-neutral-100 border-neutral-200 text-neutral-500'}`}
                  >
                    {c}
                  </button>
                ))}
              </div>

              {/* Quick Item List */}
              <div className="divide-y divide-neutral-100 max-h-56 overflow-y-auto">
                {filteredMenu.filter(m => m.category === directCat).map(dish => {
                  const qty = takeOrderCart.filter(i => i.menuId === dish.id).reduce((s, i) => s + i.qty, 0);
                  return (
                    <div key={dish.id} className="py-2.5 flex items-center justify-between font-thai text-xs">
                      <div>
                        <span className="font-bold text-neutral-800 block">
                          {dish.name}
                          {qty > 0 && <span className="ml-1.5 text-[10px] text-amber-600 font-mono">(ในบิล {qty})</span>}
                        </span>
                        <span className="text-neutral-400 font-mono">฿{dish.price}</span>
                      </div>

                      <button
                        onClick={() => handleOpenDetail(dish, 'cart')}
                        className="bg-ctl hover:bg-ctl-hover text-ctl-ink font-bold px-3 py-1.5 rounded-lg transition text-[11px] disabled:opacity-40"
                        disabled={!dish.available}
                      >
                        {dish.available ? '+ เลือก' : 'หมด'}
                      </button>
                    </div>
                  );
                })}
              </div>

              {/* Custom item entry — staff types a menu item that isn't listed */}
              <button
                onClick={openCustomModal}
                className="w-full flex items-center justify-center gap-1.5 border-2 border-dashed border-neutral-300 hover:border-amber-500 hover:bg-amber-500/10 text-neutral-600 hover:text-amber-700 font-bold py-2.5 rounded-xl transition text-xs"
              >
                <Plus className="w-4 h-4" />
                <span>เมนูอื่นๆ (คีย์เอง)</span>
              </button>
            </div>

            {/* Direct Cart Summary */}
            {takeOrderCart.length > 0 && (
              <div className="bg-admin-card border rounded-2xl p-4 space-y-3.5 shadow-xs font-thai text-xs">
                <div className="flex justify-between items-center font-kanit font-extrabold text-sm text-neutral-800">
                  <span>สรุปรายการสั่งซื้อ ({targetTable})</span>
                  <span className="font-mono text-amber-600">฿{takeOrderCart.reduce((sum, item) => sum + (item.basePrice + item.addonCost) * item.qty, 0).toLocaleString()}</span>
                </div>

                <div className="space-y-1 divide-y divide-neutral-50">
                  {takeOrderCart.map(item => (
                    <div key={item.id} className="flex justify-between items-start py-1.5 text-neutral-600">
                      <div className="pr-3">
                        <span>{item.name} (x{item.qty})</span>
                        {item.addons.length > 0 && (
                          <p className="text-[10px] text-neutral-400">พิเศษ: {item.addons.join(', ')}</p>
                        )}
                        {item.note && (
                          <p className="text-[10px] text-red-500 italic">📝 {item.note}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <span className="font-mono">฿{(item.basePrice + item.addonCost) * item.qty}</span>
                        <button
                          onClick={() => handleRemoveDirectCartItem(item.id)}
                          className="text-red-500 hover:text-red-700 p-0.5 rounded hover:bg-red-500/10"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                <button
                  onClick={handlePlaceDirectOrder}
                  className="w-full bg-amber-600 hover:bg-amber-700 text-white font-bold py-3 rounded-xl transition text-center"
                >
                  ยืนยันออเดอร์ส่งเข้าครัว
                </button>
              </div>
            )}
          </div>
        );

      case 'tables':
        return (
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <h2 className="font-extrabold text-sm font-kanit uppercase tracking-wider text-neutral-400">ผังโต๊ะให้บริการทั้งหมด</h2>
            </div>
            
            <div className="grid grid-cols-3 gap-3">
              {Array.from({ length: settings.tables }, (_, i) => {
                const tableNum = i + 1;
                const status = getTableStatus(tableNum);
                return (
                  <div 
                    key={tableNum}
                    onClick={() => {
                      if (status.active) {
                        handleOpenEditBill(tableNum);
                      } else {
                        setTargetTable(String(tableNum));
                        setSubTab('take-order');
                      }
                    }}
                    className={`border rounded-2xl p-3.5 flex flex-col justify-between items-center text-center cursor-pointer transition hover:scale-[1.03] active:scale-[0.97] h-28 relative shadow-xs ${status.active ? 'bg-amber-500/10 border-amber-500 text-amber-900 dark:text-amber-200' : 'bg-admin-card border-neutral-200 text-neutral-600'}`}
                  >
                    <span className="font-bold text-xs uppercase text-neutral-400 font-kanit">โต๊ะ {tableNum}</span>
                    <span className="text-xl">{status.active ? '🍛' : '🍽️'}</span>
                    
                    {status.active ? (
                      <div className="space-y-0.5">
                        <span className="font-mono text-xs font-extrabold block">฿{status.bill.total.toLocaleString()}</span>
                        <span className="text-[9px] bg-amber-500 text-white px-1.5 py-0.5 rounded-full font-bold">มีออเดอร์</span>
                      </div>
                    ) : (
                      <span className="text-[9px] text-neutral-400 font-medium">ว่าง</span>
                    )}

                    {status.active && (
                      <button 
                        onClick={(e) => {
                          e.stopPropagation();
                          handleClearAndPay(tableNum);
                        }}
                        className="absolute -top-1.5 -right-1.5 bg-green-600 text-white rounded-full p-1 shadow-md hover:bg-green-700"
                        title="เช็คบิล/เคลียร์โต๊ะ"
                      >
                        <Check className="w-3.5 h-3.5 stroke-[2.5]" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="bg-neutral-50 p-3 rounded-2xl text-[11px] font-thai text-neutral-500 leading-normal">
              💡 คลิกโต๊ะที่ <b className="text-amber-700">ว่าง</b> เพื่อไปจดสั่งอาหารแทนลูกค้า หรือคลิกโต๊ะที่มี <b className="text-amber-700">ออเดอร์ค้าง</b> เพื่อเปิดเมนูแก้ไขบิล/เช็คบิลชำระเงิน
            </div>
          </div>
        );

      case 'stock': {
        // Warn when an item drops to this many units or fewer (stock_items has
        // no per-item threshold column, so one shared level is used).
        const LOW_STOCK = 5;
        // Group the flat inventory by category for readable section headers.
        const grouped = stockItems.reduce((acc, it) => {
          (acc[it.category] = acc[it.category] || []).push(it);
          return acc;
        }, {});
        return (
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <h2 className="font-extrabold text-sm font-kanit uppercase tracking-wider text-neutral-400">คลังวัตถุดิบ</h2>
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] text-neutral-400 font-bold hidden sm:block">เติมทั้งหมด:</span>
                <button
                  onClick={() => handleRestockAll(1)}
                  className="flex items-center gap-1 bg-neutral-100 hover:bg-neutral-200 text-neutral-700 border font-bold py-1.5 px-3 rounded-xl text-xs transition"
                >
                  <PlusCircle className="w-3.5 h-3.5" />
                  <span>+1</span>
                </button>
                <button
                  onClick={() => handleRestockAll(10)}
                  className="flex items-center gap-1 bg-ctl hover:bg-ctl-hover text-ctl-ink font-bold py-1.5 px-3 rounded-xl text-xs transition"
                >
                  <PlusCircle className="w-3.5 h-3.5" />
                  <span>+10</span>
                </button>
              </div>
            </div>

            {stockLoading && (
              <div className="p-6 text-center text-xs text-neutral-400 font-thai">กำลังโหลดคลังวัตถุดิบ…</div>
            )}
            {stockError && !stockLoading && (
              <div className="p-4 bg-red-50 border border-red-200 text-red-700 rounded-2xl text-xs font-thai flex items-center justify-between gap-3">
                <span>{stockError}</span>
                <button onClick={loadStockItems} className="font-bold underline shrink-0">ลองใหม่</button>
              </div>
            )}
            {!stockLoading && !stockError && stockItems.length === 0 && (
              <div className="p-6 text-center text-xs text-neutral-400 font-thai">ยังไม่มีข้อมูลในตาราง stock_items</div>
            )}

            {!stockLoading && !stockError && Object.keys(grouped).map((category) => (
              <div key={category} className="space-y-1.5">
                <h3 className="text-[11px] font-extrabold text-neutral-500 font-thai px-1">{category}</h3>
                <div className="bg-admin-card border rounded-2xl overflow-hidden shadow-xs divide-y divide-neutral-100">
                  {grouped[category].map((item) => {
                    const isLow = item.quantity <= LOW_STOCK;
                    const img = resolveImageUrl(item.imageUrl);
                    return (
                      <div key={item.id} className="p-3.5 flex justify-between items-center text-xs font-thai">
                        <div className="flex items-center gap-3 min-w-0">
                          {img && (
                            <img src={img} alt="" className="w-10 h-10 rounded-lg object-cover border shrink-0" loading="lazy" />
                          )}
                          <span className="font-bold text-neutral-800 truncate text-sm">{item.name}</span>
                        </div>

                        <div className="flex items-center gap-3 shrink-0">
                          {isLow && (
                            <span className="flex items-center gap-1 text-[9px] bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-bold">
                              <AlertTriangle className="w-3 h-3" />
                              <span>ของใกล้หมด</span>
                            </span>
                          )}

                          <div className="font-mono text-right">
                            <span className={`text-base font-extrabold block ${isLow ? 'text-red-600' : 'text-neutral-800'}`}>
                              {item.quantity}
                            </span>
                            <span className="text-[9px] text-neutral-400">หน่วยคงเหลือ</span>
                          </div>

                          {/* Per-item quick add (persists to stock_items) */}
                          <div className="flex flex-col gap-1">
                            <button
                              onClick={() => adjustStockItemQty(item.id, 1)}
                              className="bg-neutral-100 hover:bg-neutral-200 text-neutral-700 border font-bold px-2 py-0.5 rounded-lg text-[10px] transition"
                            >
                              +1
                            </button>
                            <button
                              onClick={() => adjustStockItemQty(item.id, 10)}
                              className="bg-ctl hover:bg-ctl-hover text-ctl-ink font-bold px-2 py-0.5 rounded-lg text-[10px] transition"
                            >
                              +10
                            </button>
                            <button
                              onClick={() => adjustStockItemQty(item.id, -1)}
                              disabled={item.quantity <= 0}
                              className="bg-red-100 hover:bg-red-200 text-red-700 border border-red-200 font-bold px-2 py-0.5 rounded-lg text-[10px] transition disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                              -1
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        );
      }

      case 'qrcode':
        const urlToPrint = settings.baseUrl || window.location.origin + window.location.pathname;
        return (
          <div className="space-y-4">
            <div className="border-l-4 border-amber-600 pl-2">
              <h2 className="font-extrabold text-sm font-kanit uppercase tracking-wider text-neutral-400">พิมพ์/บันทึก QR Code ประจำโต๊ะ</h2>
            </div>
            
            <div className="grid grid-cols-1 gap-4">
              {Array.from({ length: settings.tables }, (_, i) => {
                const table = i + 1;
                const qrUrl = `${urlToPrint}?table=${table}`;
                const qrImageSrc = `https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(qrUrl)}`;
                
                return (
                  <div 
                    key={table}
                    className="bg-admin-card border border-neutral-200 rounded-2xl p-4 text-center shadow-xs flex flex-col items-center justify-center space-y-2.5 max-w-xs mx-auto w-full"
                  >
                    <b className="font-kanit text-neutral-800 text-sm">โต๊ะให้บริการหมายเลข {table}</b>
                    
                    {/* QR Code Container */}
                    <div className="w-44 h-44 bg-neutral-50 rounded-xl border flex items-center justify-center p-3 relative shadow-inner">
                      <img 
                        src={qrImageSrc} 
                        className="w-full h-full object-contain"
                        alt={`QR Code Table ${table}`}
                      />
                    </div>
                    
                    <p className="text-[10px] text-neutral-400 font-mono truncate w-full text-center max-w-[240px]">
                      {qrUrl}
                    </p>
                    
                    <a 
                      href={qrImageSrc} 
                      target="_blank" 
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 text-[10px] bg-neutral-100 hover:bg-neutral-200 border text-neutral-700 font-bold px-3.5 py-1.5 rounded-xl transition"
                    >
                      <QrCode className="w-3.5 h-3.5" />
                      <span>เปิดดาวน์โหลด QR รูปขนาดใหญ่</span>
                    </a>
                  </div>
                );
              })}
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div className="space-y-4 font-thai text-sm">
      
      {/* SECTION TITLE */}
      <div className="flex justify-between items-center bg-admin-panel p-2.5 rounded-2xl">
        <div>
          <h2 className="font-extrabold text-base font-kanit">แผงปฏิบัติงานพนักงาน</h2>
          <span className="text-[10px] text-neutral-400 font-medium">จัดการรับออเดอร์, อัปเดตสถานะ หรือเช็คสต็อกหน้าร้าน</span>
        </div>
        <button 
          onClick={() => {
            showToast('รีเฟรชข้อมูลล่าสุดเสร็จสมบูรณ์');
          }}
          className="p-2 border rounded-xl hover:bg-neutral-50 text-neutral-500 bg-admin-card shadow-xs"
          title="อัปเดตข้อมูลหน้าร้าน"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {/* HORIZONTAL TAB CONTROL */}
      <div className="flex gap-1 bg-neutral-100 rounded-xl p-1 text-[11px] font-bold">
        {[
          { id: 'orders', label: 'บอร์ดรับออเดอร์', icon: ClipboardList },
          { id: 'take-order', label: 'รับออเดอร์โต๊ะ', icon: PlusCircle },
          { id: 'tables', label: 'ผัง/เช็คบิลโต๊ะ', icon: LayoutGrid },
          { id: 'stock', label: isDay ? 'คลังวัตถุดิบ' : 'คลังเครื่องดื่ม', icon: Package },
          { id: 'qrcode', label: 'โต๊ะ & QR', icon: QrCode }
        ].map(tab => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setSubTab(tab.id)}
              className={`flex-1 py-2 rounded-lg flex flex-col items-center justify-center gap-1.5 transition ${tab.id === subTab ? 'bg-admin-field text-neutral-800 shadow-xs' : 'text-neutral-500 hover:text-neutral-700'}`}
            >
              <Icon className="w-4 h-4" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* PRIMARY SUB-TAB RENDER VIEW */}
      {renderActiveSubTab()}

      {/* ITEM DETAIL MODAL (add-ons + notes + qty) — same options as customer */}
      {selectedItem && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs z-[100] flex items-end justify-center p-0">
          <div className="bg-admin-card rounded-t-3xl max-w-md w-full p-6 space-y-4 animate-slide-up text-neutral-800 max-h-[85vh] overflow-y-auto shadow-2xl border-t border-neutral-100">

            <div className="flex justify-between items-start">
              <div>
                <h3 className="text-base font-extrabold font-kanit">{selectedItem.name}</h3>
                <span className="text-amber-600 font-extrabold font-mono text-base block mt-0.5">฿{selectedItem.price}</span>
                <span className="text-[10px] text-neutral-400 font-medium">
                  {detailMode === 'editbill' ? `เพิ่มลงบิล โต๊ะ ${editingBill?.table}` : `รับออเดอร์ โต๊ะ ${targetTable}`}
                </span>
              </div>
              <button
                onClick={() => setSelectedItem(null)}
                className="p-1.5 rounded-full bg-neutral-100 hover:bg-neutral-200 text-neutral-500 transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {selectedItem.desc && (
              <p className="text-xs text-neutral-400 bg-neutral-50 p-2.5 rounded-xl leading-normal font-medium font-thai">
                {selectedItem.desc}
              </p>
            )}

            {/* PICK-ONE GROUPS — ขนาด / ระดับความหวาน, straight from the sheet */}
            {choicesFor(choices, theme, selectedItem).map(group => (
              <div key={group.id || group.name} className="space-y-2">
                <h4 className="text-[10px] font-extrabold uppercase tracking-wider text-neutral-400">
                  {group.name}
                </h4>
                <div className="grid grid-cols-2 gap-1.5">
                  {group.options.map(opt => (
                    <label
                      key={opt.name}
                      className={`flex items-center justify-between p-2.5 border rounded-xl cursor-pointer transition text-xs font-thai ${selectedChoices[group.name]?.name === opt.name ? 'border-amber-500 bg-amber-500/10 ring-1 ring-amber-500' : 'border-neutral-150 hover:bg-neutral-50'}`}
                    >
                      <div className="flex items-center gap-2">
                        <input
                          type="radio"
                          name={`staff-choice-${group.name}`}
                          checked={selectedChoices[group.name]?.name === opt.name}
                          onChange={() => handleChoiceChange(group.name, opt)}
                          className="w-4 h-4 text-amber-600 border-neutral-300 focus:ring-amber-500"
                        />
                        <span className="font-semibold text-neutral-700">{opt.name}</span>
                      </div>
                      {opt.price > 0 && (
                        <span className="text-neutral-500 font-bold font-mono">+฿{opt.price}</span>
                      )}
                    </label>
                  ))}
                </div>
              </div>
            ))}

            {/* ADDONS LIST */}
            {addonsFor(addons, theme, selectedItem).length > 0 && (
              <div className="space-y-2">
                <h4 className="text-[10px] font-extrabold uppercase tracking-wider text-neutral-400">ตัวเลือกเพิ่มเติม</h4>
                <div className="space-y-1.5">
                  {addonsFor(addons, theme, selectedItem).map(addon => (
                    <label
                      key={addon.id}
                      className="flex items-center justify-between p-2.5 border rounded-xl cursor-pointer hover:bg-neutral-50 transition text-xs font-thai border-neutral-150"
                    >
                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={selectedAddons.some(a => a.name === addon.name)}
                          onChange={(e) => handleAddonChange(addon.name, addon.price, e.target.checked)}
                          className="w-4 h-4 text-amber-600 border-neutral-300 rounded focus:ring-amber-500"
                        />
                        <span className="font-semibold text-neutral-700">{addon.name}</span>
                      </div>
                      <span className="text-neutral-500 font-bold font-mono">+฿{addon.price}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            {/* CUSTOM NOTES */}
            <div className="space-y-1.5">
              <label className="text-[10px] font-extrabold uppercase tracking-wider text-neutral-400 block">หมายเหตุเพิ่มเติมถึงครัว</label>
              <textarea
                value={modalNotes}
                onChange={e => setModalNotes(e.target.value)}
                placeholder="เช่น ขอเผ็ดน้อยมาก, ไม่ใส่ผักชี, หรืออื่นๆ..."
                className="w-full text-xs border border-neutral-200 rounded-xl p-3 focus:outline-none focus:ring-2 focus:ring-amber-500 h-16 resize-none"
              />
            </div>

            {/* QUANTITY & ACTIONS */}
            <div className="flex items-center justify-between gap-4 pt-3 border-t border-neutral-100">
              <div className="flex items-center gap-3.5 border border-neutral-200 rounded-xl px-3 py-1.5">
                <button
                  onClick={() => setModalQty(prev => Math.max(1, prev - 1))}
                  className="p-1 text-neutral-500 hover:bg-neutral-100 rounded-lg transition"
                >
                  <Minus className="w-3.5 h-3.5 stroke-[2.5]" />
                </button>
                <span className="font-mono font-extrabold text-sm w-5 text-center">{modalQty}</span>
                <button
                  onClick={() => setModalQty(prev => prev + 1)}
                  className="p-1 text-neutral-500 hover:bg-neutral-100 rounded-lg transition"
                >
                  <Plus className="w-3.5 h-3.5 stroke-[2.5]" />
                </button>
              </div>

              <button
                onClick={handleAddToCart}
                className="flex-1 bg-amber-600 hover:bg-amber-700 text-white font-bold py-3 rounded-xl transition text-center text-xs"
              >
                {detailMode === 'editbill' ? 'เพิ่มลงบิล' : 'ใส่บิล'} (฿{((selectedItem.price + selectedAddons.reduce((sum, a) => sum + a.price, 0) + choicesCost(selectedChoices)) * modalQty).toLocaleString()})
              </button>
            </div>

          </div>
        </div>
      )}

      {/* CUSTOM ITEM MODAL ("เมนูอื่นๆ") — staff-typed item + editable extras */}
      {showCustomModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs z-[100] flex items-end justify-center p-0">
          <div className="bg-admin-card rounded-t-3xl max-w-md w-full p-6 space-y-4 animate-slide-up text-neutral-800 max-h-[85vh] overflow-y-auto shadow-2xl border-t border-neutral-100">

            <div className="flex justify-between items-start">
              <div>
                <h3 className="text-base font-extrabold font-kanit">เมนูอื่นๆ (คีย์เอง)</h3>
                <span className="text-[10px] text-neutral-400 font-medium">รับออเดอร์ โต๊ะ {targetTable}</span>
              </div>
              <button
                onClick={() => setShowCustomModal(false)}
                className="p-1.5 rounded-full bg-neutral-100 hover:bg-neutral-200 text-neutral-500 transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* NAME (required) */}
            <div className="space-y-1.5">
              <label className="text-[10px] font-extrabold uppercase tracking-wider text-neutral-400 block">ชื่อเมนู <span className="text-red-500">*</span></label>
              <input
                type="text"
                value={customName}
                onChange={e => setCustomName(e.target.value)}
                placeholder="เช่น ข้าวไข่ข้น, น้ำเปล่าพิเศษ..."
                className="w-full text-xs border border-neutral-200 rounded-xl p-3 focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
            </div>

            {/* PRICE (required, > 0) */}
            <div className="space-y-1.5">
              <label className="text-[10px] font-extrabold uppercase tracking-wider text-neutral-400 block">ราคา/ชิ้น (บาท) <span className="text-red-500">*</span></label>
              <input
                type="number"
                min="0"
                inputMode="numeric"
                value={customPrice}
                onChange={e => setCustomPrice(e.target.value)}
                placeholder="0"
                className="w-full text-xs border border-neutral-200 rounded-xl p-3 focus:outline-none focus:ring-2 focus:ring-amber-500 font-mono font-bold"
              />
            </div>

            {/* EXTRAS — toggle chips with editable prices */}
            <div className="space-y-2">
              <h4 className="text-[10px] font-extrabold uppercase tracking-wider text-neutral-400">ตัวเลือกเพิ่มเติม (กดเลือก)</h4>
              <div className="space-y-1.5">
                {Object.entries(customExtras).map(([name, v]) => (
                  <div
                    key={name}
                    className={`flex items-center justify-between gap-2 p-2.5 border rounded-xl transition text-xs font-thai ${v.on ? 'border-amber-500 bg-amber-500/10 ring-1 ring-amber-500' : 'border-neutral-150'}`}
                  >
                    <button
                      onClick={() => toggleCustomExtra(name)}
                      className="flex items-center gap-2 flex-1 text-left"
                    >
                      <span className={`w-4 h-4 rounded flex items-center justify-center border ${v.on ? 'bg-amber-600 border-amber-600 text-white' : 'border-neutral-300 bg-admin-card'}`}>
                        {v.on && <Check className="w-3 h-3 stroke-[3]" />}
                      </span>
                      <span className="font-semibold text-neutral-700">{name}</span>
                    </button>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <span className="text-neutral-400 font-bold">+฿</span>
                      <input
                        type="number"
                        min="0"
                        value={v.price}
                        onChange={e => setCustomExtraPrice(name, e.target.value)}
                        className="w-16 text-xs border border-neutral-200 rounded-lg p-1.5 focus:outline-none focus:ring-2 focus:ring-amber-500 font-mono font-bold text-right"
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* TAKEAWAY toggle */}
            <button
              onClick={() => setCustomTakeaway(prev => !prev)}
              className={`w-full flex items-center justify-center gap-2 py-2.5 rounded-xl font-bold text-xs transition border ${customTakeaway ? 'bg-amber-600 border-amber-600 text-white' : 'bg-admin-card border-neutral-200 text-neutral-600 hover:bg-neutral-50'}`}
            >
              <span>🏠</span>
              <span>{customTakeaway ? 'กลับบ้าน (เปิดอยู่)' : 'กลับบ้าน'}</span>
            </button>

            {/* NOTES */}
            <div className="space-y-1.5">
              <label className="text-[10px] font-extrabold uppercase tracking-wider text-neutral-400 block">หมายเหตุเพิ่มเติมถึงครัว</label>
              <textarea
                value={customNote}
                onChange={e => setCustomNote(e.target.value)}
                placeholder="เช่น ขอเผ็ดน้อย, ไม่ใส่ผักชี, หรืออื่นๆ..."
                className="w-full text-xs border border-neutral-200 rounded-xl p-3 focus:outline-none focus:ring-2 focus:ring-amber-500 h-16 resize-none"
              />
            </div>

            {/* QUANTITY & CONFIRM */}
            <div className="flex items-center justify-between gap-4 pt-3 border-t border-neutral-100">
              <div className="flex items-center gap-3.5 border border-neutral-200 rounded-xl px-3 py-1.5">
                <button
                  onClick={() => setCustomQty(prev => Math.max(1, prev - 1))}
                  className="p-1 text-neutral-500 hover:bg-neutral-100 rounded-lg transition"
                >
                  <Minus className="w-3.5 h-3.5 stroke-[2.5]" />
                </button>
                <span className="font-mono font-extrabold text-sm w-5 text-center">{customQty}</span>
                <button
                  onClick={() => setCustomQty(prev => prev + 1)}
                  className="p-1 text-neutral-500 hover:bg-neutral-100 rounded-lg transition"
                >
                  <Plus className="w-3.5 h-3.5 stroke-[2.5]" />
                </button>
              </div>

              <button
                onClick={handleAddCustomToCart}
                disabled={!customValid}
                className="flex-1 bg-amber-600 hover:bg-amber-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold py-3 rounded-xl transition text-center text-xs"
              >
                ใส่บิล (฿{customLiveTotal.toLocaleString()})
              </button>
            </div>

          </div>
        </div>
      )}

      {/* EDIT BILL MODAL (For modifying active bills) */}
      {editingBill && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs z-50 flex items-end justify-center p-0">
          <div className="bg-admin-card rounded-t-3xl max-w-md w-full p-6 space-y-4 animate-slide-up text-neutral-800 max-h-[85vh] overflow-y-auto shadow-2xl border-t border-neutral-100">
            
            <div className="flex justify-between items-center">
              <h3 className="text-base font-extrabold font-kanit flex items-center gap-1.5 text-neutral-800">
                <Edit className="text-amber-600 w-4 h-4" />
                <span>แก้ไขรายการบิล โต๊ะ {editingBill.table}</span>
              </h3>
              <button 
                onClick={() => setEditingBill(null)}
                className="p-1.5 rounded-full bg-neutral-100 hover:bg-neutral-200 text-neutral-500 transition"
              >
                <X className="w-4.5 h-4.5" />
              </button>
            </div>

            {/* EDIT BILL ITEMS */}
            <div className="divide-y divide-neutral-100 max-h-56 overflow-y-auto">
              {editingBill.items.length > 0 ? (
                editingBill.items.map((item, index) => (
                  <div key={index} className="py-3 flex justify-between items-center text-xs font-thai">
                    <div className="space-y-0.5 max-w-[50%]">
                      <span className="font-extrabold text-neutral-800 block truncate">{item.name}</span>
                      <span className="text-neutral-400 font-mono">฿{item.price + (item.addonCost || 0)} / ชิ้น</span>
                      {item.addOns && item.addOns.length > 0 && (
                        <p className="text-[9px] text-neutral-400 truncate">พิเศษ: {item.addOns.join(', ')}</p>
                      )}
                      {item.note && (
                        <p className="text-[9px] text-red-500 italic truncate">📝 {item.note}</p>
                      )}
                    </div>

                    <div className="flex items-center gap-3">
                      <div className="flex items-center gap-2 border rounded-lg px-2 py-0.5 bg-neutral-50">
                        <button 
                          onClick={() => handleEditBillQty(index, -1)}
                          className="p-0.5 hover:bg-neutral-200 rounded text-neutral-500"
                        >
                          <Minus className="w-3 h-3" />
                        </button>
                        <span className="font-bold w-4 text-center font-mono">{item.qty}</span>
                        <button 
                          onClick={() => handleEditBillQty(index, 1)}
                          className="p-0.5 hover:bg-neutral-200 rounded text-neutral-500"
                        >
                          <Plus className="w-3 h-3" />
                        </button>
                      </div>
                      <button 
                        onClick={() => handleRemoveEditBillItem(index)}
                        className="text-red-500 hover:text-red-700 p-1 rounded-lg hover:bg-red-500/10"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-center text-xs py-6 text-neutral-400 italic">ไม่มีรายการเหลืออยู่ในบิลนี้ (หากกดบันทึก บิลจะถูกยกเลิก)</p>
              )}
            </div>

            {/* APPEND NEW ITEM TO PENDING BILL */}
            <div className="space-y-1.5 pt-3 border-t border-neutral-100">
              <label className="text-[10px] font-extrabold uppercase tracking-wider text-neutral-400 block">เพิ่มรายการสินค้าลงในโต๊ะนี้</label>
              <div className="flex gap-2">
                <select 
                  value={editAddMenuId}
                  onChange={e => setEditAddMenuId(e.target.value)}
                  className="flex-1 bg-admin-field border border-neutral-200 rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-amber-500 font-bold"
                >
                  <option value="">-- เลือกเมนูอาหารที่จะสั่งเพิ่ม --</option>
                  {filteredMenu.filter(m => m.available).map(m => (
                    <option key={m.id} value={m.id}>{m.name} (฿{m.price})</option>
                  ))}
                </select>
                <button 
                  onClick={handleAddItemToEditBill}
                  className="bg-ctl hover:bg-ctl-hover text-ctl-ink text-xs font-bold px-4 py-2.5 rounded-xl transition"
                >
                  สั่งเพิ่ม
                </button>
              </div>
            </div>

            {/* SUMMARY & SUBMIT */}
            <div className="space-y-3 pt-3 border-t border-neutral-100">
              <div className="flex justify-between text-sm font-extrabold font-kanit">
                <span>ราคารวมหลังแก้ไข</span>
                <span className="text-amber-600 font-mono text-base">฿{editingBill.total.toLocaleString()}</span>
              </div>
              
              <div className="flex gap-2 pt-1 font-thai text-xs">
                <button 
                  onClick={() => setEditingBill(null)}
                  className="flex-1 bg-neutral-150 hover:bg-neutral-200 font-bold py-2.5 rounded-xl transition text-neutral-700"
                >
                  ยกเลิก
                </button>
                <button 
                  onClick={handleSaveEditedBill}
                  className="flex-1 bg-amber-600 hover:bg-amber-700 text-white font-bold py-2.5 rounded-xl transition text-center"
                >
                  บันทึกการแก้ไขบิล
                </button>
              </div>
            </div>

          </div>
        </div>
      )}

    </div>
  );
}

export default StaffView;
