import React, { useState, useEffect, useRef } from 'react';
import { addonsFor, choicesFor, defaultChoices, choicesCost } from '../menu-groups';
import { orderShift, workdayKey, WORKDAY_START_HOUR } from '../shift';
import { generateInvoiceNo } from '../invoice';
import { mergeOrder, absorbBill, itemRound, itemStatus, statusFlowFor, deriveBillStatus, ITEM_STATUS_LABELS, ITEM_STATUS_COLORS, stampKitchenFields, checkoutStage, CHECKOUT_TYPE_LABELS, PAY_METHOD_LABELS, GRAB_TABLE, TAKEAWAY_TABLE, singleRoundBase, nextSingleRoundTable, tableLabel } from '../orders';
import KitchenBoard from './KitchenBoard';
import { fetchStockItems, adjustStockItem, restockAllStock, consumeStockByName, fetchStockHistory, resolveImageUrl, clockTime } from '../api';
import { STOCK_ACTION_LABELS, STOCK_ACTION_COLORS, fmtStockTime } from '../stock-history';
import generatePayload from 'promptpay-qr';
import { QRCodeSVG } from 'qrcode.react';
import {
  ClipboardList,
  Package,
  Plus,
  Minus,
  Trash2,
  PlusCircle,
  AlertTriangle,
  Check,
  Edit,
  X,
  Clock,
  MapPin,
  LogIn,
  LogOut,
  ChefHat,
  Printer,
  RotateCcw,
  Bell,
  Search
} from 'lucide-react';

// Money on the printed slip: always two decimals with a thousands separator
// (e.g. 1,340.00), matching a standard thermal receipt.
const fmtBaht = (n) =>
  Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Chime patterns as [frequency, seconds from now] pairs. A new order is a
// two-note "ding-dong"; a table asking to pay is a rising triple rung twice, so
// it is unmistakably a different event and carries from across the shop.
const NEW_ORDER_CHIME = [[880, 0], [1174, 0.14]];
const CHECKOUT_CHIME = [
  [1046, 0], [1318, 0.12], [1568, 0.24],
  [1046, 0.5], [1318, 0.62], [1568, 0.74],
];

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
  choices,
  timeclock
}) {
  const [subTab, setSubTab] = useState('orders'); // orders, take-order, kitchen, stock, timeclock
  // คลังวัตถุดิบ tab: read from the SQL `stock_items` table (not the mockup
  // drink `stock` used when taking an order). Loaded when the tab is opened.
  const [stockItems, setStockItems] = useState([]);
  const [stockLoading, setStockLoading] = useState(false);
  const [stockError, setStockError] = useState('');
  const [stockSearch, setStockSearch] = useState('');
  // ประวัติการบันทึกสต็อก: the audit-log panel, opened from a button in the
  // คลังวัตถุดิบ tab. Loaded on demand so a closed panel costs nothing.
  const [showStockHistory, setShowStockHistory] = useState(false);
  const [stockHistory, setStockHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const [orderFilter, setOrderFilter] = useState('active'); // active, new, cooking, served, paid, all
  // The bill currently being sent to the printer. It is rendered into a hidden
  // #bill-print slip (80mm, styled for the Xprinter XP-80T) and fired straight
  // at window.print() — no on-screen preview. Cleared once printing returns.
  // { table, billIds, total, items, type } | null
  const [printData, setPrintData] = useState(null);
  // Which shift's orders the board shows + notifies for. This is LOCKED to the
  // logged-in staff member's own shift: App pins `theme` to their shop (day /
  // night) and hides the theme toggle, so a day-shift worker only ever sees the
  // day menu + day bills, and a night worker only the night side. There is no
  // switcher — hence a plain const, not state.
  const shiftView = theme;
  
  // Direct ordering states
  const [targetTable, setTargetTable] = useState('1');
  const [takeOrderCart, setTakeOrderCart] = useState([]);
  const [directCat, setDirectCat] = useState(null);
  const [selectedItem, setSelectedItem] = useState(null);
  const [selectedOption, setSelectedOption] = useState(null); // chosen protein/size (เนื้อสัตว์)
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

  // --- ลงเวลาเข้า-ออกงาน ----------------------------------------------------
  // While true the clock button is disabled: we're waiting on the GPS fix or
  // the server's answer. The server does the real geofence + time stamping.
  const [clockBusy, setClockBusy] = useState(false);

  // The WORKING day, matching the server's one-record-per-day key: 06:00 today →
  // 06:00 tomorrow. Anything before 6 AM still belongs to the shift that started
  // the evening before, so a night worker clocking out at 01:00 closes the same
  // record they opened.
  const todayKey = workdayKey();
  const myClockToday = (timeclock || []).find(
    (r) => r.user === activeStaffUser && r.date === todayKey
  );
  const clockFmt = (ts) =>
    ts ? new Date(ts).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }) + ' น.' : '—';

  const handleClockPress = () => {
    if (!navigator.geolocation) {
      showToast('เบราว์เซอร์นี้ไม่รองรับการระบุตำแหน่ง (GPS)');
      return;
    }
    setClockBusy(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const { action } = await clockTime({
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
          });
          showToast(action === 'in' ? '✅ ลงชื่อเข้างานเรียบร้อย' : '👋 ลงชื่อออกงานเรียบร้อย');
        } catch (err) {
          showToast(err.message || 'ลงเวลาไม่สำเร็จ');
        } finally {
          setClockBusy(false);
        }
      },
      () => {
        setClockBusy(false);
        showToast('อ่านตำแหน่งไม่ได้ กรุณาอนุญาตการเข้าถึงตำแหน่งแล้วลองใหม่');
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  };

  // --- "ยังไม่ได้ลงเวลา" prompt on the first open of a working day ------------
  // Staff open the app and head straight for the board — the time clock is a tab
  // they have to remember on their own, and a forgotten clock-in costs someone a
  // day's wage. So the first time the staff screen is opened on a working day
  // this account has no record for, a sheet asks them to clock in and takes them
  // to the ลงเวลา tab. The answer is remembered per user + working day in
  // localStorage, so it asks once rather than on every reload.
  const [showClockPrompt, setShowClockPrompt] = useState(false);
  const clockPromptKey = `clockPrompt:${activeStaffUser || 'unknown'}:${todayKey}`;

  useEffect(() => {
    // Already clocked in (or nobody is logged in) — nothing to ask.
    if (!activeStaffUser || myClockToday) {
      setShowClockPrompt(false);
      return;
    }
    try {
      if (localStorage.getItem(clockPromptKey) === '1') return;
    } catch {
      /* private mode / storage disabled — just ask */
    }
    setShowClockPrompt(true);
  }, [activeStaffUser, clockPromptKey, myClockToday]);

  const closeClockPrompt = (goToTimeclock) => {
    try {
      localStorage.setItem(clockPromptKey, '1');
    } catch {
      /* asking again after a reload is better than crashing */
    }
    setShowClockPrompt(false);
    if (goToTimeclock) setSubTab('timeclock');
  };

  // --- New-order notifications (toast + sound) ------------------------------
  // Track which order ids we've already seen so the first load doesn't fire a
  // burst of toasts. On mount every current order is marked seen silently; only
  // genuinely new orders that match the selected shift notify thereafter.
  const seenOrderIds = useRef(null);
  const audioCtxRef = useRef(null);

  // Plays one of the chime patterns via the Web Audio API — no audio file to ship,
  // and a blocked/suspended context can never break the board (best-effort only).
  const playChime = (pattern = NEW_ORDER_CHIME) => {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      if (!audioCtxRef.current) audioCtxRef.current = new Ctx();
      const ctx = audioCtxRef.current;
      if (ctx.state === 'suspended') ctx.resume();
      const now = ctx.currentTime;
      pattern.forEach(([freq, at]) => {
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

  // --- Check-bill requests (customer tapped เช็กบิล on their phone) -----------
  // The board card for a requesting table already shows an amber banner, but
  // staff are often on another tab (or another table) when it happens, so the
  // request has to come to them: a toast plus its own chime the moment it lands.
  // Only the ids currently requesting are remembered, so a table that cancels and
  // asks again rings a second time.
  const seenCheckoutIds = useRef(null);

  // Tables of this shift waiting to be billed — drives both the alert above and
  // the notification below.
  const checkoutRequests = orders.filter(
    (o) => checkoutStage(o) === 'requested' && orderShift(o) === shiftView
  );

  useEffect(() => {
    const requesting = orders.filter(
      (o) => checkoutStage(o) === 'requested' && orderShift(o) === shiftView
    );
    const ids = new Set(requesting.map((o) => o.id));
    // First run: whatever is already waiting was requested before this screen
    // opened — show it on the board, but don't ring for it.
    if (seenCheckoutIds.current === null) {
      seenCheckoutIds.current = ids;
      return;
    }
    const fresh = requesting.filter((o) => !seenCheckoutIds.current.has(o.id));
    seenCheckoutIds.current = ids;
    if (fresh.length === 0) return;
    fresh.forEach((o) =>
      showToast(
        `🔔 โต๊ะ ${o.table} ขอเช็กบิล · ${CHECKOUT_TYPE_LABELS[o.checkout?.type] || 'เช็กบิลปกติ'} · ฿${(o.total || 0).toLocaleString()}`
      )
    );
    playChime(CHECKOUT_CHIME);
  }, [orders, shiftView]);

  const filteredMenu = menu.filter(item => item.theme === theme || item.theme === 'both');
  const categories = [...new Set(filteredMenu.map(item => item.category))];

  if (categories.length > 0 && !directCat) {
    setDirectCat(categories[0]);
  } else if (categories.length > 0 && !categories.includes(directCat)) {
    setDirectCat(categories[0]);
  }

  // Filter orders for listing
  const getFilteredOrders = () => {
    // Screen the board to the selected shift first, then by status.
    const list = [...orders].filter(o => orderShift(o) === shiftView);

    if (orderFilter === 'active') {
      // OLDEST bill on top. The table that ordered first is the one to serve
      // first, and it must not slide down the board every time another table
      // orders. `createdAt` is the bill's START — mergeOrder keeps it when a
      // table orders more — so a table holds its place for the whole sitting.
      return list
        .filter(o => o.status !== 'paid' && o.status !== 'cancelled')
        .sort((a, b) => a.createdAt - b.createdAt);
    }

    // The other filters are history, where the most recent is what you want to
    // read first, so those stay newest-first.
    list.sort((a, b) => b.createdAt - a.createdAt);
    if (orderFilter !== 'all') {
      return list.filter(o => o.status === orderFilter);
    }
    return list;
  };

  // Actually settle bills once a payment method is confirmed in the pay modal.
  // On payment: stamp a bill number, mark paid and record the checkout time +
  // method ('cash' | 'qr'). Kept in `orders` as paid history (OwnerView reports
  // read it); the table frees up on its own because every board view ignores paid
  // bills. billIds arrive oldest-first so running invoice numbers stay
  // chronological; numbers are built up on a working copy so bill #2 counts
  // bill #1 and each gets a distinct, sequential number.
  const settleBills = (billIds, table, payMethod) => {
    const paidAt = Date.now();
    setOrders(prev => {
      const working = [...prev];
      for (const id of billIds) {
        const idx = working.findIndex(o => o.id === id);
        if (idx === -1) continue;
        const invoiceNo = working[idx].invoiceNo || generateInvoiceNo(working[idx], working);
        // The bill is settled: stamp it paid + the money actually received, and
        // clear the checkout stage so it reads as a clean paid record.
        working[idx] = { ...working[idx], invoiceNo, status: 'paid', paidAt, payMethod, checkout: null };
      }
      return working;
    });
    // Free the table for the next group: drop any lingering workspace bound to it.
    clearTableWorkspace(table);
    showToast(`เช็คบิล โต๊ะ ${table} เรียบร้อยแล้ว โต๊ะพร้อมรับลูกค้าใหม่`);
  };

  // --- Checkout flow (พิมพ์บิล → เลือกประเภทเงิน → เคลียร์โต๊ะ) ----------------
  // Print the receipt for one bill. This opens the printable overlay AND moves
  // the bill into the 'printed' stage, which is what makes the money-type
  // buttons appear on the card (they are hidden until the bill is printed).
  const printBill = (order) => {
    if (!order || order.status === 'paid' || order.status === 'cancelled') return;
    const type = order.checkout?.type || 'normal';
    if (checkoutStage(order) !== 'printed') {
      setOrders(prev => prev.map(o =>
        o.id === order.id
          ? { ...o, checkout: { ...(o.checkout || {}), stage: 'printed', type } }
          : o
      ));
    }
    // Stash the slip's data; the effect below paints it into #bill-print and
    // fires window.print() straight away, so there is no preview to dismiss.
    setPrintData({
      table: order.table,
      billIds: [order.id],
      total: order.total || 0,
      items: order.items,
      type,
      printedAt: Date.now(),
      staff: activeStaffUser || 'พนักงาน',
    });
  };

  // Auto-print: once the hidden slip is in the DOM, send it to the printer and
  // clear the data. window.print() blocks until the (native) dialog closes, so
  // the app never shows a print screen of its own. A tick's delay lets the QR
  // SVG and layout paint before the print snapshot is taken.
  useEffect(() => {
    if (!printData) return;
    const timer = setTimeout(() => {
      window.print();
      setPrintData(null);
    }, 120);
    return () => clearTimeout(timer);
  }, [printData]);

  // Settle one bill with the money type staff actually received (เงินสด / สแกน
  // QR / คนละครึ่ง). Frees the table immediately, replacing the old check-bill.
  const settleWithMethod = (order, method) => {
    settleBills([order.id], order.table, method);
  };

  // ยกเลิกบิล — send the table back to the un-checked-out state so the customer's
  // phone unlocks and they can order more. Nothing is settled.
  const cancelBill = (order) => {
    setOrders(prev => prev.map(o => (o.id === order.id ? { ...o, checkout: null } : o)));
    showToast(`ยกเลิกบิล โต๊ะ ${order.table} — ปลดล็อกให้ลูกค้าสั่งเพิ่มได้`);
  };

  // Re-open a bill that was closed by mistake (or before payment finished): pull
  // it back out of 'paid' and straight into the 'printed' stage, so the money-
  // type buttons are ready again without re-printing or re-keying the order.
  const reopenBill = (order) => {
    if (!confirm(`ดึงโต๊ะ ${order.table} กลับมาที่สถานะรอเช็กบิลใช่หรือไม่?`)) return;
    setOrders(prev => prev.map(o => {
      if (o.id !== order.id) return o;
      const { paidAt, payMethod, invoiceNo, ...rest } = o;
      return {
        ...rest,
        status: deriveBillStatus(o.items),
        checkout: { stage: 'printed', type: o.checkout?.type || 'normal' },
      };
    }));
    showToast(`ดึงโต๊ะ ${order.table} กลับมารอเช็กบิลแล้ว`);
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

  // Stock is deducted the moment a dish is marked เสิร์ฟแล้ว (สำเร็จ), by the
  // ordered qty — not when the order is placed. `stockDone` on the item makes
  // this idempotent: an item can be un-served (wrapped back) and served again
  // without double-counting, and the stock is restored if it is un-served.
  const changeStockCount = (stockRef, delta) => {
    if (!stockRef || !delta) return;
    setStock(prev => {
      const s = prev[stockRef];
      if (!s) return prev;
      return { ...prev, [stockRef]: { ...s, count: s.count + delta } };
    });
  };

  // The menu-card name behind an order line, for matching a stock_items row by
  // name. Order names can carry a folded option — "ข้าวผัด (หมู)" — so prefer
  // the menu row via menuId and fall back to stripping that suffix. Custom
  // "เมนูอื่นๆ" items return null: they never touch stock.
  const linkedStockName = (item) => {
    if (!item || item.menuId === 'custom') return null;
    const m = menu.find(mn => mn.id === item.menuId);
    if (m) return m.name;
    return String(item.name || '').replace(/\s*\([^)]*\)\s*$/, '').trim() || null;
  };

  // Mirror a serve/un-serve into the SQL stock_items row (คลังวัตถุดิบ) with the
  // same name — the stock the customer storefront checks. Positive qty deducts,
  // negative restores; no matching row is a no-op on the server. Fire-and-forget
  // so a network hiccup never blocks the serve tap; on success the คลังวัตถุดิบ
  // tab's local list is kept in step.
  const consumeLinkedStock = (item, qty) => {
    const name = linkedStockName(item);
    if (!name || !qty) return;
    consumeStockByName(name, qty)
      .then((updated) => {
        if (updated) setStockItems(prev => prev.map(it => (it.id === updated.id ? updated : it)));
      })
      .catch((err) => console.error('[stock] ตัดสต็อกไม่สำเร็จ:', err.message || err));
  };

  // How many units of the stock behind a dish are on hand right now — used to
  // decide whether a serve tap is allowed. A dish can be tied to the in-memory
  // drink `stock` (stockRef) and/or a คลังวัตถุดิบ row matched by name; when
  // both apply, the tighter limit wins. Returns null for dishes with no linked
  // stock (custom / unmatched) — those never block.
  const availableStockFor = (item) => {
    const limits = [];
    if (item?.stockRef && stock[item.stockRef]) limits.push(stock[item.stockRef].count);
    const name = linkedStockName(item);
    if (name) {
      const row = stockItems.find(it => it.name === name);
      if (row) limits.push(row.quantity);
    }
    return limits.length ? Math.min(...limits) : null;
  };

  // True when serving `item` would push its linked stock below zero — i.e. the
  // last units were already served to another bill. Un-served items (stockDone)
  // and non-stock dishes never block.
  const wouldOverdrawStock = (item) => {
    if (item.stockDone) return false;
    const avail = availableStockFor(item);
    return avail !== null && avail < item.qty;
  };

  // Set ONE dish on a bill to a chosen status (รับออเดอร์ / อยู่ในครัว /
  // เสิร์ฟแล้ว) from the per-item segmented control. The bill's own status is
  // re-derived from its items, so the board/customer keep in sync.
  const setItemStatusTo = (orderId, itemIndex, next) => {
    // Read the current item from props (not inside the updater) so the stock
    // side-effect fires exactly once even under React's double-invoked updaters.
    const order = orders.find(o => o.id === orderId);
    if (!order || order.status === 'paid' || order.status === 'cancelled') return;
    const item = order.items[itemIndex];
    const current = itemStatus(item);
    if (next === current) return;

    const nowServed = next === 'served' && !item.stockDone;
    // Block serving once the stock is gone — another bill already took the last
    // units, so this dish is สินค้าหมดแล้ว and can't be marked เสิร์ฟแล้ว.
    if (nowServed && wouldOverdrawStock(item)) { showToast('สินค้าหมดแล้ว'); return; }
    const unServed = current === 'served' && next !== 'served' && item.stockDone;
    if (nowServed) { changeStockCount(item.stockRef, -item.qty); consumeLinkedStock(item, item.qty); }
    if (unServed) { changeStockCount(item.stockRef, item.qty); consumeLinkedStock(item, -item.qty); }

    setOrders(prev => prev.map(o => {
      if (o.id !== orderId) return o;
      const items = o.items.map((it, i) => {
        if (i !== itemIndex) return it;
        const upd = { ...it, status: next };
        if (nowServed) upd.stockDone = true;
        if (unServed) upd.stockDone = false;
        return upd;
      });
      return { ...o, items, status: deriveBillStatus(items) };
    }));
  };

  // One tap to send every not-yet-started dish on a bill into the kitchen
  // (รับออเดอร์ → อยู่ในครัว). Dishes already cooking/served are untouched, and
  // no stock moves here — stock only changes on เสิร์ฟแล้ว.
  const markBillCooking = (orderId) => {
    const order = orders.find(o => o.id === orderId);
    if (!order || order.status === 'paid' || order.status === 'cancelled') return;
    setOrders(prev => prev.map(o => {
      if (o.id !== orderId) return o;
      const items = o.items.map(it => (itemStatus(it) === 'new' ? { ...it, status: 'cooking' } : it));
      return { ...o, items, status: deriveBillStatus(items) };
    }));
  };

  // One tap to mark every dish on a bill served — handy when a whole table's
  // food goes out together instead of poking each row. Deducts stock for every
  // dish not already counted.
  const markBillServed = (orderId) => {
    const order = orders.find(o => o.id === orderId);
    if (!order || order.status === 'paid' || order.status === 'cancelled') return;

    // A dish counts as stock-linked via either inventory: the in-memory drink
    // `stock` (stockRef) or a stock_items row matched by name.
    const shouldDeduct = (it) => !it.stockDone && (it.stockRef || linkedStockName(it));
    // Any dish whose linked stock has already run dry can't go out — leave it
    // unserved and warn, rather than driving the count negative.
    const blocked = (it) => shouldDeduct(it) && wouldOverdrawStock(it);
    const toDeduct = order.items.filter(it => shouldDeduct(it) && !blocked(it));
    if (toDeduct.length > 0) {
      setStock(prev => {
        const next = { ...prev };
        toDeduct.forEach(it => {
          if (!it.stockRef) return;
          const s = next[it.stockRef];
          if (s) next[it.stockRef] = { ...s, count: s.count - it.qty };
        });
        return next;
      });
      toDeduct.forEach(it => consumeLinkedStock(it, it.qty));
    }

    setOrders(prev => prev.map(o => {
      if (o.id !== orderId) return o;
      const items = o.items.map(it => {
        if (blocked(it)) return it; // สินค้าหมดแล้ว — keep it unserved
        return {
          ...it,
          status: 'served',
          stockDone: shouldDeduct(it) ? true : it.stockDone,
        };
      });
      return { ...o, items, status: deriveBillStatus(items) };
    }));

    if (order.items.some(blocked)) showToast('สินค้าหมดแล้ว บางรายการยังเสิร์ฟไม่ได้');
  };

  const getItemStatusLabel = (status) => ITEM_STATUS_LABELS[status] || status;
  const getItemStatusColor = (status) => ITEM_STATUS_COLORS[status] || 'bg-neutral-100 text-neutral-600';

  const getStatusLabel = (status) => {
    switch (status) {
      case 'new': return 'รับออเดอร์';
      case 'cooking': return 'อยู่ในครัว';
      case 'served': return 'เสิร์ฟแล้ว';
      case 'paid': return 'เช็กบิลแล้ว';
      case 'cancelled': return 'ยกเลิก';
      default: return status;
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'new': return 'bg-[#FDECC8] text-[#8a5a00]';
      case 'cooking': return 'bg-[#DCE9F7] text-[#2F5D8A]';
      // Same light brown as the per-dish 'served' chip (ITEM_STATUS_COLORS in
      // orders.js) — the card header and the dishes under it have to agree.
      case 'served': return 'bg-[#EADBC8] text-[#6B4A2B]';
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
    // Default to the first protein/size the same way the customer dialog does.
    setSelectedOption(item.options && item.options.length ? item.options[0] : null);
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

    // Protein/size (เนื้อสัตว์): its price becomes the base price, and its name is
    // folded into the dish name — "ข้าวกระเพรา (หมูสับ)" — so the kitchen ticket
    // and the bill both read the exact variant, matching the customer flow.
    const basePrice = selectedOption ? selectedOption.price : selectedItem.price;
    const lineName = selectedOption ? `${selectedItem.name} (${selectedOption.name})` : selectedItem.name;

    // When editing an existing bill, push straight into that bill. Tag the new
    // item with the bill's current last round so it stays grouped with it
    // rather than starting a stray divider.
    if (detailMode === 'editbill' && editingBill) {
      const lastRound = editingBill.items.reduce((m, it) => Math.max(m, itemRound(it)), 1);
      const items = [...editingBill.items, stampKitchenFields({
        name: lineName,
        menuId: selectedItem.id,
        group: selectedItem.group || 'food',
        // Heading rides along so serve-direct lines (cold towels, desserts,
        // snacks) get the 2-state flow like drinks — see isServeDirectItem.
        category: selectedItem.category,
        qty: modalQty,
        price: basePrice,
        addonCost: addonCost,
        addOns: [...chosenNames, ...selectedAddons.map(a => a.name)],
        note: modalNotes,
        round: lastRound,
        roundAt: Date.now(),
        stockRef: selectedItem.stockRef || null
      })];
      const total = items.reduce((sum, item) => sum + (item.price + (item.addonCost || 0)) * item.qty, 0);
      setEditingBill({ ...editingBill, items, total });
      setSelectedItem(null);
      showToast(`เพิ่ม ${selectedItem.name} ในบิลชั่วคราวแล้ว`);
      return;
    }

    const cartItem = {
      id: selectedItem.id + '_' + Date.now().toString(36),
      menuId: selectedItem.id,
      group: selectedItem.group || 'food',
      category: selectedItem.category,
      name: lineName,
      basePrice: basePrice,
      price: basePrice,
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
      group: 'food',
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

    // Stock is NOT deducted here — it comes off only when each dish is marked
    // เสิร์ฟแล้ว (สำเร็จ). We carry `stockRef` onto the order item so the serve
    // action knows what to subtract.
    const orderNo = '#' + String(orders.length + 1).padStart(3, '0');
    const directTotal = takeOrderCart.reduce((sum, item) => sum + (item.basePrice + item.addonCost) * item.qty, 0);
    const createdAt = Date.now();
    // Grab / กลับบ้าน never merge into an open bill — each order is its own
    // ticket. The number is picked here (rather than left to mergeOrder) so the
    // confirmation below can name the bill that was just opened.
    const channel = singleRoundBase(targetTable);
    const billTable = channel
      ? nextSingleRoundTable(orders, channel, { createdAt, type: theme })
      : targetTable;
    const newOrder = {
      id: 'B' + Math.floor(1000 + Math.random() * 9000),
      no: orderNo,
      time: new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }),
      createdAt,
      // Shift is stamped from the active menu/theme, so the order lands on the
      // matching day/night board regardless of the wall clock.
      type: theme,
      table: billTable,
      items: takeOrderCart.map(item => ({
        name: item.name,
        menuId: item.menuId,
        group: item.group || 'food',
        category: item.category,
        qty: item.qty,
        price: item.basePrice,
        addonCost: item.addonCost,
        addOns: item.addons,
        note: item.note,
        stockRef: item.stockRef || null
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
    showToast(`ลงบิล ${tableLabel(billTable)} สำเร็จแล้ว ✓`);
    setSubTab('orders');
  };

  // Edit Bill Modal handlers
  // Open the edit-bill modal for one bill. This used to be reached only from the
  // ผังโต๊ะ tab, which had to look a bill UP by table number; the board card
  // already IS the bill, so it is copied straight from the order. Deep copy —
  // the modal edits its own draft until บันทึก, so a cancel changes nothing.
  const openEditBill = (order) => {
    if (!order || order.status === 'paid' || order.status === 'cancelled') return;
    setEditingBill(JSON.parse(JSON.stringify(order)));
    setEditAddMenuId('');
    setShowMovePicker(false);
    setMoveConflict('');
  };

  // --- ย้ายโต๊ะ ---------------------------------------------------------------
  // Whether the "ย้ายโต๊ะ" table picker is expanded inside the edit-bill modal.
  const [showMovePicker, setShowMovePicker] = useState(false);
  // Set when the picked table already has an open bill: staff then choose
  // whether the two bills become one. Holds that table number, '' = no question
  // pending.
  const [moveConflict, setMoveConflict] = useState('');

  // Every open bill sitting at `table` right now (excluding the one being
  // edited). Used both to tint the picker and to find what to merge into.
  const openBillsAt = (table) => orders.filter((o) =>
    String(o.table) === String(table) &&
    o.status !== 'paid' && o.status !== 'cancelled' &&
    o.id !== editingBill?.id
  );

  // Move the bill being edited to another table. This is NOT part of the edit
  // draft: it saves immediately, because moving a table is a fact about the room
  // (the group got up and sat somewhere else), not a proposed change to the bill.
  //
  // The old table number is kept in `movedFrom` so the diner's phone — which is
  // pinned to the table it scanned — can follow the bill to its new number
  // instead of watching its own order disappear (see App.jsx).
  //
  // Tapping a table that already has a bill does NOT move anything yet: it asks
  // first (moveConflict), because "รวมบิล" and "แยกบิล" are both normal answers
  // and neither should be the silent default.
  const handleMoveTable = (to) => {
    if (!editingBill || !to) return;
    if (String(to) === String(editingBill.table)) { showToast('เป็นโต๊ะเดิมอยู่แล้ว'); return; }
    if (openBillsAt(to).length > 0) { setMoveConflict(String(to)); return; }
    moveBillTo(to);
  };

  // Carry the bill over as its own separate bill.
  const moveBillTo = (to) => {
    const from = String(editingBill.table);
    setOrders((prev) => prev.map((o) => (
      o.id === editingBill.id
        ? { ...o, table: String(to), movedFrom: [...(o.movedFrom || []), from], movedAt: Date.now() }
        : o
    )));
    // Keep the open modal pointed at the same bill, now under its new number.
    setEditingBill({ ...editingBill, table: String(to) });
    setShowMovePicker(false);
    setMoveConflict('');
    showToast(`ย้ายบิลจาก ${tableLabel(from)} ไป โต๊ะ ${to} แล้ว`);
  };

  // Combine this bill with the one already at `to`, so the joined tables pay as
  // one. The bill already sitting there is the one that survives (it keeps its
  // เลขที่บิล); the edited bill is folded into it and disappears, which is why
  // the editor closes afterwards — the record it was editing no longer exists.
  const mergeBillInto = (to) => {
    const from = String(editingBill.table);
    // If more than one bill is open there, join the earliest — the group that
    // has been at that table longest is the one the others are moving to.
    const target = openBillsAt(to).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))[0];
    if (!target) { showToast('ไม่พบบิลที่โต๊ะปลายทางแล้ว'); setMoveConflict(''); return; }

    setOrders((prev) => absorbBill(prev, editingBill.id, target.id));
    setEditingBill(null);
    setShowMovePicker(false);
    setMoveConflict('');
    showToast(`รวมบิล ${tableLabel(from)} เข้ากับ โต๊ะ ${to} เป็นบิลเดียวแล้ว (${target.no})`);
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
          // Re-derive the bill status: a newly added 'new' dish reopens the
          // ticket for the kitchen even if earlier rounds were served.
          return {
            ...o,
            items: editingBill.items,
            total: editingBill.total,
            status: deriveBillStatus(editingBill.items),
          };
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
  const adjustStockItemQty = async (id, amount, reason) => {
    try {
      const updated = await adjustStockItem(id, amount, reason);
      setStockItems((prev) => prev.map((it) => (it.id === id ? updated : it)));
      const sign = amount > 0 ? `+${amount}` : `${amount}`;
      showToast(`${updated.name} ${sign} (คงเหลือ ${updated.quantity})`);
    } catch (err) {
      showToast(err.message || 'ปรับจำนวนคลังไม่สำเร็จ');
    }
  };

  // The -1 (and any manual removal) opens a popup asking where the units went —
  // e.g. เจ้าของดื่มเอง / ของเสีย / ทำหล่น — so a shrinking count is always
  // accountable in the history. `removeTarget` holds the item + amount being
  // removed while the popup is open. { item, amount } | null
  const [removeTarget, setRemoveTarget] = useState(null);
  const [removeReason, setRemoveReason] = useState('');
  // The black "กรอกเลข" button opens a popup asking how many units to add.
  // `addTarget` holds the item while that popup is open; `addInput` is the
  // typed amount, kept as digits-only text so only positive integers get in.
  const [addTarget, setAddTarget] = useState(null);
  const [addInput, setAddInput] = useState('');

  // Quick-pick reasons for a stock removal; the free-text box covers anything
  // else. Tapping a chip just fills that same box, so either path is one field.
  const REMOVE_REASONS = ['เจ้าของ/พนักงานทานเอง', 'ของเสีย/หมดอายุ', 'ทำหล่น/แตกเสียหาย', 'ปรับยอดให้ตรงจริง'];

  // Open the reason popup for removing `amount` units of `item`.
  const askRemoveReason = (item, amount = 1) => {
    setRemoveReason('');
    setRemoveTarget({ item, amount });
  };

  // Confirm the removal with the chosen reason, then close the popup.
  const confirmRemove = async () => {
    if (!removeTarget) return;
    const { item, amount } = removeTarget;
    const reason = removeReason.trim();
    if (!reason) { showToast('กรุณาระบุเหตุผลที่นำออก'); return; }
    setRemoveTarget(null);
    await adjustStockItemQty(item.id, -Math.abs(amount), reason);
  };

  // Open the "type an amount to add" popup for `item`.
  const askAddAmount = (item) => {
    setAddInput('');
    setAddTarget(item);
  };

  // Add the typed amount to the item, then close the popup. Only whole
  // positive numbers are accepted — removals go through askRemoveReason so a
  // shrinking count always carries a reason.
  const confirmAdd = async () => {
    if (!addTarget) return;
    const amount = Number.parseInt(addInput, 10);
    if (!Number.isInteger(amount) || amount <= 0) { showToast('กรุณากรอกจำนวนเต็มบวก'); return; }
    const item = addTarget;
    setAddTarget(null);
    await adjustStockItemQty(item.id, amount);
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

  // Open the ประวัติ panel and pull the latest audit trail from the server.
  const openStockHistory = async () => {
    setShowStockHistory(true);
    setHistoryLoading(true);
    setHistoryError('');
    try {
      setStockHistory(await fetchStockHistory(200));
    } catch (err) {
      setHistoryError(err.message || 'โหลดประวัติการบันทึกสต็อกไม่สำเร็จ');
    } finally {
      setHistoryLoading(false);
    }
  };

  const renderActiveSubTab = () => {
    switch (subTab) {
      case 'kitchen':
        return (
          <KitchenBoard
            orders={orders}
            setOrders={setOrders}
            menu={menu}
            showToast={showToast}
            shiftView={shiftView}
          />
        );
      case 'orders':
        const filteredOrders = getFilteredOrders();
        return (
          <div className="space-y-4">
            {/* The board is locked to this staff member's own shift (day/night);
                there is deliberately no shift switcher. */}
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
              // One column on a phone; two on a desktop, where a single column
              // stretched across a monitor wastes the screen.
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3.5 items-start">
                {filteredOrders.map(order => (
                  <div key={order.id} className="border border-neutral-200 bg-admin-card rounded-2xl p-4 shadow-xs relative">
                    <div className="flex justify-between items-center border-b pb-2 mb-2">
                      <div className="flex items-center gap-2">
                        {/* A Grab/กลับบ้าน ticket carries its own number
                            (Grab#2) and is tinted differently, so a delivery
                            bill is never mistaken for a seated table. */}
                        <span className={`font-extrabold text-[11px] px-2 py-0.5 rounded-md font-kanit ${singleRoundBase(order.table) ? 'bg-violet-600 text-white' : 'bg-ctl text-ctl-ink'}`}>
                          {tableLabel(order.table)}
                        </span>
                        <span className="font-mono text-neutral-400 text-xs font-semibold">{order.no}</span>
                      </div>
                      {/* The four-step status row under every dish already says
                          where the bill is, so this corner is the edit button
                          rather than a second read-out of the same thing. The
                          badge is kept ONLY for the two whole-bill states that
                          row cannot show — ชำระแล้ว and ยกเลิก — which are also
                          exactly the bills that cannot be edited. */}
                      {order.status === 'paid' || order.status === 'cancelled' ? (
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${getStatusColor(order.status)}`}>
                          {getStatusLabel(order.status)}
                        </span>
                      ) : (
                        <button
                          onClick={() => openEditBill(order)}
                          title="แก้ไขบิล (เพิ่ม / ลบ / แก้จำนวน)"
                          aria-label="แก้ไขบิล"
                          className="p-1.5 -mr-1 rounded-lg text-neutral-400 hover:text-amber-700 hover:bg-amber-500/10 transition active:scale-95"
                        >
                          <Edit className="w-4 h-4" />
                        </button>
                      )}
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
                            {/* Two lines per dish: the dish + its price, then the
                                status on a line of its own. Squeezed beside the
                                price the four steps were 9px and clipped; given
                                the full width they are readable and tappable. */}
                            <div className="space-y-1 pb-0.5">
                              <div className="flex justify-between items-start gap-2 text-xs font-thai text-neutral-800">
                                <div className="min-w-0">
                                  <span className="font-bold text-amber-700 mr-1.5">{item.qty}×</span>
                                  <span>{item.name}</span>
                                  {item.addOns && item.addOns.length > 0 && (
                                    <p className="text-[9px] text-neutral-400 pl-5">พิเศษ: {item.addOns.join(', ')}</p>
                                  )}
                                  {item.note && (
                                    <p className="text-[9px] text-red-500 italic pl-5">📝 {item.note}</p>
                                  )}
                                </div>
                                <span className="font-mono text-neutral-500 font-medium text-xs flex-shrink-0">
                                  ฿{(item.price + (item.addonCost || 0)) * item.qty}
                                </span>
                              </div>

                              {order.status === 'paid' || order.status === 'cancelled' ? (
                                <div className="flex justify-end">
                                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${getItemStatusColor(itemStatus(item))}`}>
                                    {getItemStatusLabel(itemStatus(item))}
                                  </span>
                                </div>
                              ) : (
                                /* Segmented per-dish status: every step visible, tap to set. */
                                <div className="flex rounded-full border border-neutral-200 overflow-hidden">
                                  {statusFlowFor(item).map(s => {
                                    // The เสิร์ฟแล้ว step is locked out once the
                                    // linked stock is gone — the dish is หมดแล้ว
                                    // and another bill took the last units.
                                    const outOfStock = s === 'served' && itemStatus(item) !== 'served' && wouldOverdrawStock(item);
                                    return (
                                      <button
                                        key={s}
                                        onClick={() => setItemStatusTo(order.id, idx, s)}
                                        disabled={outOfStock}
                                        className={`flex-1 text-[10px] font-bold py-1 transition active:scale-95 ${itemStatus(item) === s ? getItemStatusColor(s) : outOfStock ? 'bg-admin-card text-neutral-200 cursor-not-allowed' : 'bg-admin-card text-neutral-300 hover:text-neutral-500'}`}
                                        title={outOfStock ? 'สินค้าหมดแล้ว' : `เปลี่ยนสถานะเป็น ${getItemStatusLabel(s)}`}
                                      >
                                        {outOfStock ? 'สินค้าหมดแล้ว' : getItemStatusLabel(s)}
                                      </button>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          </React.Fragment>
                        );
                      })}
                    </div>

                    <div className="border-t border-neutral-100 mt-2.5 pt-2 flex justify-between items-center text-xs">
                      <span className="text-[10px] text-neutral-400 font-medium">{order.time} น. · {order.by}</span>
                      <b className="font-mono text-neutral-800 font-extrabold">฿{order.total.toLocaleString()}</b>
                    </div>

                    {/* Status + check-bill actions */}
                    {order.status !== 'paid' && order.status !== 'cancelled' && (
                      <div className="mt-3 pt-2.5 border-t border-neutral-50 space-y-2">
                        {/* Whole-bill quick steps: send everything to the kitchen /
                            mark everything served — hidden once no dish needs them. */}
                        {order.items.some(it => itemStatus(it) !== 'served') && (
                          <div className="flex gap-2">
                            {order.items.some(it => itemStatus(it) === 'new') && (
                              <button
                                onClick={() => markBillCooking(order.id)}
                                className="flex-1 bg-sky-50 hover:bg-sky-100 text-sky-700 border border-sky-200 font-bold py-2 rounded-xl text-xs transition"
                              >
                                🍳 ส่งเข้าครัวทุกจาน
                              </button>
                            )}
                            <button
                              onClick={() => markBillServed(order.id)}
                              className="flex-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 font-bold py-2 rounded-xl text-xs transition"
                            >
                              ✓ เสิร์ฟครบทุกจาน
                            </button>
                          </div>
                        )}
                        {(() => {
                          const stage = checkoutStage(order);

                          // Receipt printed → pick the money actually received.
                          if (stage === 'printed') {
                            return (
                              <div className="space-y-2">
                                <p className="text-[10px] font-bold text-center text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg py-1.5">
                                  🧾 พิมพ์บิลแล้ว · เลือกประเภทเงินที่ได้รับจริงเพื่อปิดโต๊ะ
                                </p>
                                <div className="grid grid-cols-3 gap-1.5">
                                  <button
                                    onClick={() => settleWithMethod(order, 'cash')}
                                    className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-2 rounded-xl text-[11px] leading-tight transition"
                                  >
                                    💵<br />เงินสด
                                  </button>
                                  <button
                                    onClick={() => settleWithMethod(order, 'qr')}
                                    className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 rounded-xl text-[11px] leading-tight transition"
                                  >
                                    📱<br />สแกน QR
                                  </button>
                                  <button
                                    onClick={() => settleWithMethod(order, 'split')}
                                    className="bg-orange-500 hover:bg-orange-600 text-white font-bold py-2 rounded-xl text-[11px] leading-tight transition"
                                  >
                                    🟠<br />คนละครึ่ง
                                  </button>
                                </div>
                                <div className="flex gap-2">
                                  <button
                                    onClick={() => printBill(order)}
                                    className="flex-1 flex items-center justify-center gap-1 border border-neutral-200 hover:bg-neutral-50 text-neutral-600 font-bold py-2 rounded-xl text-xs transition"
                                  >
                                    <Printer className="w-3.5 h-3.5" /> พิมพ์ซ้ำ
                                  </button>
                                  <button
                                    onClick={() => cancelBill(order)}
                                    className="flex-1 flex items-center justify-center gap-1 border border-amber-200 hover:bg-amber-50 text-amber-700 font-bold py-2 rounded-xl text-xs transition"
                                  >
                                    <RotateCcw className="w-3.5 h-3.5" /> ยกเลิกบิล (สั่งเพิ่ม)
                                  </button>
                                </div>
                              </div>
                            );
                          }

                          // Customer asked to check out → alert staff + print.
                          if (stage === 'requested') {
                            const isSplit = order.checkout?.type === 'split';
                            return (
                              <div className="space-y-2">
                                <div className="flex items-start gap-2 text-[11px] font-bold text-amber-900 bg-amber-100 border border-amber-300 rounded-lg px-2.5 py-2">
                                  <Bell className="w-4 h-4 shrink-0 mt-0.5" />
                                  <span>
                                    {tableLabel(order.table)} ขอเช็กบิล · {CHECKOUT_TYPE_LABELS[order.checkout?.type] || 'เช็กบิลปกติ'}
                                    {isSplit && ' — อย่าลืมหยิบโทรศัพท์ร้าน (แอปถุงเงิน)'}
                                  </span>
                                </div>
                                <div className="flex gap-2">
                                  <button
                                    onClick={() => printBill(order)}
                                    className="flex-1 flex items-center justify-center gap-1.5 bg-amber-600 hover:bg-amber-700 text-white font-bold py-2 rounded-xl text-xs transition"
                                  >
                                    <Printer className="w-4 h-4" /> พิมพ์บิล
                                  </button>
                                  <button
                                    onClick={() => cancelBill(order)}
                                    className="px-3 border border-neutral-200 hover:bg-neutral-50 text-neutral-500 font-bold py-2 rounded-xl text-xs transition"
                                  >
                                    ยกเลิก
                                  </button>
                                </div>
                              </div>
                            );
                          }

                          // Open bill (incl. staff-initiated "เก็บเงินด้วยค่ะ").
                          return (
                            <div className="flex gap-2">
                              <button
                                onClick={() => printBill(order)}
                                className="flex-1 flex items-center justify-center gap-1.5 bg-amber-600 hover:bg-amber-700 text-white font-bold py-2 rounded-xl text-xs transition"
                              >
                                <Printer className="w-4 h-4" /> พิมพ์บิล / เช็กบิล
                              </button>
                              <button
                                onClick={() => cancelOrder(order.id)}
                                className="px-3 border border-neutral-200 hover:bg-neutral-50 text-neutral-500 font-bold py-2 rounded-xl text-xs transition"
                              >
                                ยกเลิก
                              </button>
                            </div>
                          );
                        })()}
                      </div>
                    )}

                    {/* Re-open a bill closed by mistake / before payment finished. */}
                    {order.status === 'paid' && (
                      <div className="mt-3 pt-2.5 border-t border-neutral-50 flex items-center justify-between gap-2">
                        <span className="text-[10px] text-neutral-400 font-medium">
                          {order.payMethod ? `รับชำระ: ${PAY_METHOD_LABELS[order.payMethod] || order.payMethod}` : 'ชำระเงินแล้ว'}
                        </span>
                        <button
                          onClick={() => reopenBill(order)}
                          className="flex items-center gap-1 border border-neutral-200 hover:bg-neutral-50 text-neutral-600 font-bold py-1.5 px-3 rounded-lg text-[11px] transition"
                          title="ดึงโต๊ะกลับมารอเช็กบิล (แก้กรณีเผลอปิดโต๊ะ)"
                        >
                          <RotateCcw className="w-3.5 h-3.5" /> ดึงโต๊ะกลับ
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
          // Stacked on a phone (pick dishes, then scroll to the bill). On a
          // desktop the two sit side by side, so the bill stays in sight while
          // dishes are still being added.
          <div className="space-y-4 lg:space-y-0 lg:grid lg:grid-cols-2 lg:gap-4 lg:items-start">
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
                  {/* Not seats — order channels. Each order placed against one
                      of these opens its OWN numbered bill (Grab#1, Grab#2 …)
                      instead of merging, so two riders never share a bill. */}
                  <option value={TAKEAWAY_TABLE}>สั่งกลับบ้าน / Takeaway</option>
                  <option value={GRAB_TABLE}>Grab / เดลิเวอรี</option>
                </select>
                {/* Says the rule out loud at the moment it applies, so nobody
                    waits for a second round to merge and wonders where it went. */}
                {singleRoundBase(targetTable) && (
                  <p className="mt-1.5 text-[10px] text-violet-700 bg-violet-50 border border-violet-200 rounded-lg px-2 py-1.5 font-medium">
                    ลงบิลครั้งนี้จะเปิดบิลใหม่เป็น <b>{nextSingleRoundTable(orders, singleRoundBase(targetTable), { createdAt: Date.now(), type: theme })}</b> —
                    ออเดอร์ของแต่ละรายจะไม่รวมกัน ถ้าต้องการเพิ่มรายการในบิลเดิม ให้กด “แก้ไขบิล” ที่หน้าบอร์ด
                  </p>
                )}
              </div>

              {/* Direct Categories Selector — a dropdown instead of a tab row so
                  a long category list stays compact on the take-order screen. */}
              <div className="pt-1">
                <select
                  value={directCat}
                  onChange={e => setDirectCat(e.target.value)}
                  className="w-full border rounded-xl p-3 focus:outline-none focus:ring-2 focus:ring-amber-500 bg-neutral-50 font-bold text-xs font-thai"
                >
                  {categories.map(c => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>

              {/* Quick Item List */}
              <div className="divide-y divide-neutral-100 max-h-56 lg:max-h-96 overflow-y-auto">
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
                  <span>สรุปรายการสั่งซื้อ ({tableLabel(targetTable)})</span>
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

      case 'stock': {
        // Warn when an item drops to this many units or fewer (stock_items has
        // no per-item threshold column, so one shared level is used).
        const LOW_STOCK = 5;
        // Search + sort. Fewest units first, so anything หมดแล้ว (0) / ใกล้หมด
        // floats to the very top where it needs attention. The old per-category
        // grouping is dropped in favour of that single ordering; each row keeps a
        // category tag so the section is still visible.
        const q = stockSearch.trim().toLowerCase();
        const visibleStock = stockItems
          .filter((it) =>
            !q ||
            it.name.toLowerCase().includes(q) ||
            (it.category || '').toLowerCase().includes(q)
          )
          .sort((a, b) => (a.quantity - b.quantity) || a.name.localeCompare(b.name, 'th'));
        return (
          <div className="space-y-4">
            <div className="flex justify-between items-center gap-2 flex-wrap">
              <div className="flex items-center gap-2">
                <h2 className="font-extrabold text-sm font-kanit uppercase tracking-wider text-neutral-400">คลังวัตถุดิบ</h2>
                <button
                  onClick={openStockHistory}
                  className="flex items-center gap-1 bg-neutral-100 hover:bg-neutral-200 text-neutral-700 border font-bold py-1.5 px-3 rounded-xl text-xs transition"
                  title="ดูประวัติการบันทึกสต็อก"
                >
                  <Clock className="w-3.5 h-3.5" />
                  <span>ประวัติ</span>
                </button>
              </div>
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

            {/* SEARCH — filters by item name or category */}
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
              <input
                type="text"
                value={stockSearch}
                onChange={(e) => setStockSearch(e.target.value)}
                placeholder="ค้นหารายการในคลัง"
                className="w-full border rounded-xl py-2.5 pl-9 pr-3 bg-admin-field text-xs focus:outline-none focus:ring-1 focus:ring-amber-500 font-bold font-thai"
              />
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
            {!stockLoading && !stockError && stockItems.length > 0 && visibleStock.length === 0 && (
              <div className="p-6 text-center text-xs text-neutral-400 font-thai">ไม่พบรายการที่ค้นหา</div>
            )}

            {!stockLoading && !stockError && visibleStock.length > 0 && (
              <div className="bg-admin-card border rounded-2xl overflow-hidden shadow-xs divide-y divide-neutral-100">
                {visibleStock.map((item) => {
                  const isOut = item.quantity <= 0;
                  const isLow = !isOut && item.quantity <= LOW_STOCK;
                  const img = resolveImageUrl(item.imageUrl);
                  return (
                    <div key={item.id} className="p-3.5 flex justify-between items-center text-xs font-thai">
                      <div className="flex items-center gap-3 min-w-0">
                        {img && (
                          <img src={img} alt="" width={40} height={40} className="w-10 h-10 rounded-lg object-cover border shrink-0" loading="lazy" decoding="async" />
                        )}
                        <div className="min-w-0">
                          <span className="font-bold text-neutral-800 truncate text-sm block">{item.name}</span>
                          {item.category && (
                            <span className="text-[10px] text-neutral-400 font-medium truncate block">{item.category}</span>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        {isOut && (
                          <span className="flex items-center gap-1 text-[9px] bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-bold">
                            <AlertTriangle className="w-3 h-3" />
                            <span>หมดแล้ว</span>
                          </span>
                        )}
                        {isLow && (
                          <span className="flex items-center gap-1 text-[9px] bg-yellow-100 text-yellow-800 px-2 py-0.5 rounded-full font-bold">
                            <AlertTriangle className="w-3 h-3" />
                            <span>ใกล้หมด</span>
                          </span>
                        )}

                        <div className="font-mono text-right">
                          <span className={`text-base font-extrabold block ${isOut ? 'text-red-600' : isLow ? 'text-yellow-600' : 'text-neutral-800'}`}>
                            {item.quantity}
                          </span>
                          <span className="text-[9px] text-neutral-400">หน่วยคงเหลือ</span>
                        </div>

                        {/* Per-item quantity controls, one row: + · +1 · -1 — equal
                            squares so they stay compact and leave the name its
                            width (persists to stock_items) */}
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => askAddAmount(item)}
                            className="w-8 h-8 flex items-center justify-center bg-neutral-900 hover:bg-black text-white font-bold rounded-lg text-sm leading-none transition"
                            title="กรอกจำนวนที่ต้องการเพิ่ม"
                          >
                            +
                          </button>
                          <button
                            onClick={() => adjustStockItemQty(item.id, 1)}
                            className="w-8 h-8 flex items-center justify-center bg-green-500 hover:bg-green-600 text-white font-bold rounded-lg text-[11px] leading-none transition"
                          >
                            +1
                          </button>
                          <button
                            onClick={() => askRemoveReason(item, 1)}
                            disabled={item.quantity <= 0}
                            className="w-8 h-8 flex items-center justify-center bg-red-600 hover:bg-red-700 text-white font-bold rounded-lg text-[11px] leading-none transition disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            -1
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      }

      case 'timeclock': {
        // My recent records, newest first (today included), for quick reference.
        const myRecords = (timeclock || [])
          .filter((r) => r.user === activeStaffUser)
          .sort((a, b) => (b.inAt || 0) - (a.inAt || 0))
          .slice(0, 7);
        const done = myClockToday && myClockToday.outAt;
        return (
          <div className="space-y-4">
            <div className="border-l-4 border-amber-600 pl-2">
              <h2 className="font-extrabold text-sm font-kanit uppercase tracking-wider text-neutral-400">ลงเวลาเข้า-ออกงาน</h2>
            </div>

            {/* TODAY CARD */}
            <div className="bg-admin-card border rounded-2xl p-5 shadow-xs space-y-4 text-center">
              <div>
                {/* The WORKING day, not the wall date: at 01:00 the record still
                    belongs to the shift that started the previous evening, so
                    showing the calendar date here would contradict it. */}
                <span className="text-[10px] font-bold text-neutral-400 uppercase tracking-wider block">
                  วันทำงาน · {new Date(`${todayKey}T12:00:00`).toLocaleDateString('th-TH', { weekday: 'long', day: 'numeric', month: 'long' })}
                </span>
                <span className="font-kanit font-extrabold text-base text-neutral-800">{activeStaffUser || 'ไม่ได้เข้าสู่ระบบ'}</span>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3">
                  <span className="text-[10px] font-bold text-emerald-600 uppercase flex items-center justify-center gap-1"><LogIn className="w-3 h-3" /> เวลาเข้า</span>
                  <span className="font-mono font-extrabold text-lg text-emerald-700 block">{clockFmt(myClockToday?.inAt)}</span>
                </div>
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
                  <span className="text-[10px] font-bold text-amber-600 uppercase flex items-center justify-center gap-1"><LogOut className="w-3 h-3" /> เวลาออก</span>
                  <span className="font-mono font-extrabold text-lg text-amber-700 block">{clockFmt(myClockToday?.outAt)}</span>
                </div>
              </div>

              {done ? (
                <div className="bg-neutral-100 text-neutral-500 font-bold py-3 rounded-xl text-xs">
                  ✓ วันนี้ลงเวลาเข้า-ออกครบแล้ว
                </div>
              ) : (
                <button
                  onClick={handleClockPress}
                  disabled={clockBusy || !activeStaffUser}
                  className={`w-full font-bold py-3.5 rounded-xl text-sm transition flex items-center justify-center gap-2 disabled:opacity-50 ${
                    myClockToday
                      ? 'bg-amber-600 hover:bg-amber-700 text-white'
                      : 'bg-emerald-600 hover:bg-emerald-700 text-white'
                  }`}
                >
                  <Clock className="w-4 h-4" />
                  <span>
                    {clockBusy
                      ? 'กำลังตรวจสอบตำแหน่ง…'
                      : myClockToday ? 'ลงชื่อออกงาน' : 'ลงชื่อเข้างาน'}
                  </span>
                </button>
              )}

              <p className="text-[10px] text-neutral-400 font-medium flex items-center justify-center gap-1">
                <MapPin className="w-3 h-3" />
                <span>ลงเวลาได้เฉพาะเมื่ออยู่ในพื้นที่ร้าน (รัศมี 50 ม.) — ต้องอนุญาตการเข้าถึงตำแหน่ง</span>
              </p>
              <p className="text-[10px] text-neutral-400 font-medium">
                นับเป็น 1 วันทำงาน ตั้งแต่ {String(WORKDAY_START_HOUR).padStart(2, '0')}:00 ถึง{' '}
                {String(WORKDAY_START_HOUR).padStart(2, '0')}:00 ของวันถัดไป
              </p>
            </div>

            {/* MY RECENT HISTORY */}
            {myRecords.length > 0 && (
              <div className="bg-admin-card border rounded-2xl overflow-hidden shadow-xs">
                <div className="px-4 pt-3 pb-1 text-[10px] font-extrabold text-neutral-400 uppercase tracking-wider">ประวัติล่าสุดของฉัน</div>
                <div className="divide-y divide-neutral-100">
                  {myRecords.map((r) => (
                    <div key={r.id} className="px-4 py-2.5 flex justify-between items-center text-xs font-thai">
                      <span className="font-bold text-neutral-700">
                        {new Date(r.inAt).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })}
                      </span>
                      <span className="font-mono text-neutral-500">
                        {clockFmt(r.inAt)} → {clockFmt(r.outAt)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      }

      default:
        return null;
    }
  };

  return (
    <div className="space-y-4 font-thai text-sm">

      {/* CHECK-BILL ALERT — stays on screen (on every tab) for as long as a table
          is waiting to be billed, so the toast+chime is never the only warning.
          Tapping it jumps to the board where พิมพ์บิล lives. */}
      {checkoutRequests.length > 0 && (
        <button
          onClick={() => setSubTab('orders')}
          className="w-full flex items-center gap-2.5 bg-amber-100 border border-amber-300 text-amber-900 rounded-2xl px-3.5 py-2.5 text-left transition hover:bg-amber-200 active:scale-[0.99] animate-pulse-slow"
        >
          <Bell className="w-4 h-4 shrink-0" />
          <span className="text-xs font-bold flex-1">
            {checkoutRequests.map((o) => tableLabel(o.table)).join(', ')} ขอเช็กบิล
            <span className="block text-[10px] font-semibold text-amber-800/80">
              แตะเพื่อไปพิมพ์บิลที่หน้าบอร์ด
            </span>
          </span>
          <span className="bg-amber-600 text-white text-[11px] font-extrabold rounded-full px-2 py-0.5 font-mono shrink-0">
            {checkoutRequests.length}
          </span>
        </button>
      )}

      {/* HORIZONTAL TAB CONTROL */}
      <div className="flex gap-1 bg-neutral-100 rounded-xl p-1 text-[9px] font-bold">
        {/* Ordered the way a shift runs: read the board, take an order, cook it,
            then the two things touched occasionally (คลัง, ลงเวลา). */}
        {[
          { id: 'orders', label: 'บอร์ด', icon: ClipboardList },
          { id: 'take-order', label: 'รับออเดอร์', icon: PlusCircle },
          { id: 'kitchen', label: 'ครัว', icon: ChefHat },
          { id: 'stock', label: 'คลัง', icon: Package },
          { id: 'timeclock', label: 'ลงเวลา', icon: Clock },
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

      {/* ประวัติการบันทึกสต็อก — audit trail of every stock movement */}
      {showStockHistory && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs z-[120] flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-admin-card rounded-t-3xl sm:rounded-3xl max-w-lg w-full max-h-[85vh] flex flex-col animate-slide-up text-neutral-800 shadow-2xl border-t border-neutral-100">
            <div className="flex items-center justify-between gap-3 p-5 border-b border-neutral-100">
              <div className="flex items-center gap-2 min-w-0">
                <span className="w-9 h-9 rounded-xl bg-sky-50 border border-sky-200 text-sky-700 flex items-center justify-center shrink-0">
                  <Clock className="w-4 h-4" />
                </span>
                <div className="min-w-0">
                  <h3 className="text-base font-extrabold font-kanit leading-tight">ประวัติการบันทึกสต็อก</h3>
                  <p className="text-[11px] text-neutral-500 font-medium">ใครปรับสต็อกรายการไหน เมื่อไหร่</p>
                </div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  onClick={openStockHistory}
                  className="p-2 rounded-lg hover:bg-neutral-100 text-neutral-500"
                  title="รีเฟรช"
                >
                  <RotateCcw className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setShowStockHistory(false)}
                  className="p-2 rounded-lg hover:bg-neutral-100 text-neutral-500"
                  title="ปิด"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="overflow-y-auto p-4 space-y-2">
              {historyLoading && (
                <div className="p-6 text-center text-xs text-neutral-400 font-thai">กำลังโหลดประวัติ…</div>
              )}
              {historyError && !historyLoading && (
                <div className="p-4 bg-red-50 border border-red-200 text-red-700 rounded-2xl text-xs font-thai flex items-center justify-between gap-3">
                  <span>{historyError}</span>
                  <button onClick={openStockHistory} className="font-bold underline shrink-0">ลองใหม่</button>
                </div>
              )}
              {!historyLoading && !historyError && stockHistory.length === 0 && (
                <div className="p-6 text-center text-xs text-neutral-400 font-thai">ยังไม่มีประวัติการบันทึกสต็อก</div>
              )}
              {!historyLoading && !historyError && stockHistory.map((h) => (
                <div key={h.id} className="flex items-start gap-3 p-3 bg-admin-field rounded-2xl text-xs font-thai">
                  <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full shrink-0 mt-0.5 ${STOCK_ACTION_COLORS[h.action] || 'bg-neutral-100 text-neutral-600'}`}>
                    {STOCK_ACTION_LABELS[h.action] || h.action}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-bold text-neutral-800 truncate">{h.itemName || '—'}</p>
                    {h.note && (
                      <p className="text-[10px] text-red-500 font-medium truncate">📝 {h.note}</p>
                    )}
                    <p className="text-[10px] text-neutral-400 font-medium">
                      โดย {h.byName || h.byUser || 'ไม่ทราบ'} · {fmtStockTime(h.createdAt)}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    {h.delta !== 0 && (
                      <span className={`font-mono font-extrabold ${h.delta > 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                        {h.delta > 0 ? `+${h.delta}` : h.delta}
                      </span>
                    )}
                    {h.quantityAfter != null && (
                      <p className="text-[10px] text-neutral-400 font-medium">เหลือ {h.quantityAfter}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ADD-STOCK AMOUNT — the black กรอกเลข button: type how many units to add.
          The box filters to digits as you type, so only จำนวนเต็มบวก can be sent. */}
      {addTarget && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs z-[120] flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-admin-card rounded-t-3xl sm:rounded-3xl max-w-md w-full p-6 space-y-4 animate-slide-up text-neutral-800 shadow-2xl border-t border-neutral-100">
            <div className="flex items-start gap-3">
              <span className="w-10 h-10 rounded-xl bg-neutral-900 text-white flex items-center justify-center shrink-0">
                <Plus className="w-5 h-5" />
              </span>
              <div className="min-w-0">
                <h3 className="text-base font-extrabold font-kanit leading-tight">เพิ่มสต็อก</h3>
                <p className="text-[11px] text-neutral-500 font-medium font-thai">
                  {addTarget.name} — คงเหลือตอนนี้ {addTarget.quantity} หน่วย
                </p>
              </div>
            </div>

            <input
              type="text"
              inputMode="numeric"
              value={addInput}
              onChange={(e) => setAddInput(e.target.value.replace(/\D/g, ''))}
              onKeyDown={(e) => { if (e.key === 'Enter') confirmAdd(); }}
              placeholder="กรอกจำนวนเต็มบวก เช่น 24"
              autoFocus
              className="w-full border rounded-xl py-2.5 px-3 bg-admin-field text-sm font-bold text-center focus:outline-none focus:ring-1 focus:ring-amber-500 font-thai"
            />

            <div className="flex gap-2 pt-1">
              <button
                onClick={() => setAddTarget(null)}
                className="flex-1 bg-neutral-100 hover:bg-neutral-200 text-neutral-700 font-bold py-2.5 rounded-xl text-sm transition"
              >
                ยกเลิก
              </button>
              <button
                onClick={confirmAdd}
                disabled={!(Number.parseInt(addInput, 10) > 0)}
                className="flex-1 bg-neutral-900 hover:bg-black text-white font-bold py-2.5 rounded-xl text-sm transition disabled:opacity-40 disabled:cursor-not-allowed"
              >
                ยืนยันเพิ่ม
              </button>
            </div>
          </div>
        </div>
      )}

      {/* REMOVE-STOCK REASON — why units are being taken out (เจ้าของดื่มเอง …) */}
      {removeTarget && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs z-[120] flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-admin-card rounded-t-3xl sm:rounded-3xl max-w-md w-full p-6 space-y-4 animate-slide-up text-neutral-800 shadow-2xl border-t border-neutral-100">
            <div className="flex items-start gap-3">
              <span className="w-10 h-10 rounded-xl bg-red-50 border border-red-200 text-red-700 flex items-center justify-center shrink-0">
                <Minus className="w-5 h-5" />
              </span>
              <div className="min-w-0">
                <h3 className="text-base font-extrabold font-kanit leading-tight">นำสต็อกออก {removeTarget.amount} หน่วย</h3>
                <p className="text-[11px] text-neutral-500 font-medium">
                  {removeTarget.item.name} — ระบุเหตุผลที่ของหายไป
                </p>
              </div>
            </div>

            {/* Quick-pick reasons */}
            <div className="flex flex-wrap gap-2">
              {REMOVE_REASONS.map((r) => (
                <button
                  key={r}
                  onClick={() => setRemoveReason(r)}
                  className={`text-[11px] font-bold px-3 py-1.5 rounded-full border transition ${removeReason === r ? 'bg-amber-600 text-white border-amber-600' : 'bg-admin-field text-neutral-600 border-neutral-200 hover:bg-neutral-100'}`}
                >
                  {r}
                </button>
              ))}
            </div>

            <input
              type="text"
              value={removeReason}
              onChange={(e) => setRemoveReason(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') confirmRemove(); }}
              placeholder="หรือพิมพ์เหตุผลเอง เช่น เจ้าของดื่มเอง"
              autoFocus
              className="w-full border rounded-xl py-2.5 px-3 bg-admin-field text-sm font-medium focus:outline-none focus:ring-1 focus:ring-amber-500 font-thai"
            />

            <div className="flex gap-2 pt-1">
              <button
                onClick={() => setRemoveTarget(null)}
                className="flex-1 bg-neutral-100 hover:bg-neutral-200 text-neutral-700 font-bold py-2.5 rounded-xl text-sm transition"
              >
                ยกเลิก
              </button>
              <button
                onClick={confirmRemove}
                disabled={!removeReason.trim()}
                className="flex-1 bg-red-600 hover:bg-red-700 text-white font-bold py-2.5 rounded-xl text-sm transition disabled:opacity-40 disabled:cursor-not-allowed"
              >
                ยืนยันนำออก
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CLOCK-IN PROMPT — first open of a working day with no record yet */}
      {showClockPrompt && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs z-[110] flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-admin-card rounded-t-3xl sm:rounded-3xl max-w-md w-full p-6 space-y-4 animate-slide-up text-neutral-800 shadow-2xl border-t border-neutral-100">
            <div className="flex items-start gap-3">
              <span className="w-10 h-10 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 flex items-center justify-center shrink-0">
                <Clock className="w-5 h-5" />
              </span>
              <div className="min-w-0">
                <h3 className="text-base font-extrabold font-kanit">ยังไม่ได้ลงเวลาเข้างาน</h3>
                <p className="text-[11px] text-neutral-500 font-medium leading-relaxed">
                  สวัสดี {activeStaffUser} — กดลงเวลาเข้างานก่อนเริ่มงานนะ
                </p>
              </div>
            </div>

            <p className="text-[11px] text-neutral-500 font-medium bg-neutral-50 border border-neutral-150 rounded-xl p-3 leading-relaxed">
              รอบวันทำงานเริ่ม {String(WORKDAY_START_HOUR).padStart(2, '0')}:00 ของวันนี้
              ถึง {String(WORKDAY_START_HOUR).padStart(2, '0')}:00 ของวันถัดไป —
              กะกลางคืนที่เลิกงานหลังเที่ยงคืนจึงยังนับเป็นวันเดียวกัน
            </p>

            <div className="flex gap-2 text-xs">
              <button
                onClick={() => closeClockPrompt(false)}
                className="flex-1 bg-neutral-150 hover:bg-neutral-200 text-neutral-700 font-bold py-3 rounded-xl transition"
              >
                ไว้ทีหลัง
              </button>
              <button
                onClick={() => closeClockPrompt(true)}
                className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-3 rounded-xl transition flex items-center justify-center gap-1.5"
              >
                <Clock className="w-4 h-4" />
                <span>ไปหน้าลงเวลา</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ITEM DETAIL MODAL (add-ons + notes + qty) — same options as customer */}
      {selectedItem && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs z-[100] flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-admin-card rounded-t-3xl sm:rounded-3xl max-w-md w-full p-6 space-y-4 animate-slide-up text-neutral-800 max-h-[85vh] overflow-y-auto shadow-2xl border-t border-neutral-100">

            <div className="flex justify-between items-start">
              <div>
                <h3 className="text-base font-extrabold font-kanit">{selectedItem.name}</h3>
                <span className="text-amber-600 font-extrabold font-mono text-base block mt-0.5">฿{selectedOption ? selectedOption.price : selectedItem.price}</span>
                <span className="text-[10px] text-neutral-400 font-medium">
                  {detailMode === 'editbill' ? `เพิ่มลงบิล ${tableLabel(editingBill?.table)}` : `รับออเดอร์ ${tableLabel(targetTable)}`}
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

            {/* PROTEIN / SIZE (เนื้อสัตว์) — one required pick, mirrors the customer
                dialog. Absent for dishes sold at a single price. */}
            {selectedItem.options && selectedItem.options.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-[10px] font-extrabold uppercase tracking-wider text-neutral-400">
                  {selectedItem.options.every(o => ['M', 'L', 'S'].includes(o.name)) ? 'เลือกขนาด' : 'เลือกเนื้อสัตว์'}
                </h4>
                <div className="grid grid-cols-2 gap-1.5">
                  {selectedItem.options.map(opt => (
                    <label
                      key={opt.name}
                      className={`flex items-center justify-between p-2.5 border rounded-xl cursor-pointer transition text-xs font-thai ${selectedOption?.name === opt.name ? 'border-amber-500 bg-amber-500/10 ring-1 ring-amber-500' : 'border-neutral-150 hover:bg-neutral-50'}`}
                    >
                      <div className="flex items-center gap-2">
                        <input
                          type="radio"
                          name="staff-option-choice"
                          checked={selectedOption?.name === opt.name}
                          onChange={() => setSelectedOption(opt)}
                          className="w-4 h-4 text-amber-600 border-neutral-300 focus:ring-amber-500"
                        />
                        <span className="font-semibold text-neutral-700">{opt.name}</span>
                      </div>
                      <span className="text-neutral-500 font-bold font-mono">฿{opt.price}</span>
                    </label>
                  ))}
                </div>
              </div>
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
                {detailMode === 'editbill' ? 'เพิ่มลงบิล' : 'ใส่บิล'} (฿{(((selectedOption ? selectedOption.price : selectedItem.price) + selectedAddons.reduce((sum, a) => sum + a.price, 0) + choicesCost(selectedChoices)) * modalQty).toLocaleString()})
              </button>
            </div>

          </div>
        </div>
      )}

      {/* CUSTOM ITEM MODAL ("เมนูอื่นๆ") — staff-typed item + editable extras */}
      {showCustomModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs z-[100] flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-admin-card rounded-t-3xl sm:rounded-3xl max-w-md w-full p-6 space-y-4 animate-slide-up text-neutral-800 max-h-[85vh] overflow-y-auto shadow-2xl border-t border-neutral-100">

            <div className="flex justify-between items-start">
              <div>
                <h3 className="text-base font-extrabold font-kanit">เมนูอื่นๆ (คีย์เอง)</h3>
                <span className="text-[10px] text-neutral-400 font-medium">รับออเดอร์ {tableLabel(targetTable)}</span>
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
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-admin-card rounded-t-3xl sm:rounded-3xl max-w-md w-full p-6 space-y-4 animate-slide-up text-neutral-800 max-h-[85vh] overflow-y-auto shadow-2xl border-t border-neutral-100">
            
            <div className="flex justify-between items-center gap-2">
              <h3 className="text-base font-extrabold font-kanit flex items-center gap-1.5 text-neutral-800 min-w-0">
                <Edit className="text-amber-600 w-4 h-4 shrink-0" />
                <span className="truncate">แก้ไขรายการบิล {tableLabel(editingBill.table)}</span>
              </h3>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  onClick={() => { setMoveConflict(''); setShowMovePicker((open) => !open); }}
                  className={`flex items-center gap-1 font-bold px-2.5 py-1.5 rounded-lg text-[11px] transition ${showMovePicker ? 'bg-sky-600 text-white' : 'bg-sky-100 hover:bg-sky-200 text-sky-700 border border-sky-200'}`}
                  title="ย้ายบิลนี้ไปโต๊ะอื่น"
                >
                  <MapPin className="w-3.5 h-3.5" />
                  <span>ย้ายโต๊ะ</span>
                </button>
                <button
                  onClick={() => { setShowMovePicker(false); setMoveConflict(''); setEditingBill(null); }}
                  className="p-1.5 rounded-full bg-neutral-100 hover:bg-neutral-200 text-neutral-500 transition"
                >
                  <X className="w-4.5 h-4.5" />
                </button>
              </div>
            </div>

            {/* ย้ายโต๊ะ PICKER — opens under the heading rather than as a second
                modal on top of this one. Only seated tables are offered: Grab /
                กลับบ้าน are delivery channels, not places to sit. */}
            {showMovePicker && (
              <div className="bg-sky-50 border border-sky-200 rounded-2xl p-3 space-y-2 text-xs font-thai">
                <span className="text-[10px] font-extrabold uppercase tracking-wider text-sky-700 block">
                  ย้ายบิลนี้จาก {tableLabel(editingBill.table)} ไปที่
                </span>
                <div className="grid grid-cols-5 gap-1.5 max-h-32 overflow-y-auto">
                  {Array.from({ length: settings.tables }, (_, i) => String(i + 1))
                    .filter((n) => n !== String(editingBill.table))
                    .map((n) => {
                      const busy = orders.some((o) =>
                        String(o.table) === n && o.status !== 'paid' && o.status !== 'cancelled'
                      );
                      return (
                        <button
                          key={n}
                          onClick={() => handleMoveTable(n)}
                          // A table with an open bill is still selectable — it
                          // just asks รวม/แยก first — but marked, so staff can
                          // see at a glance which ones are free.
                          className={`py-2 rounded-lg font-extrabold font-mono transition border ${moveConflict === n
                            ? 'bg-sky-600 border-sky-600 text-white'
                            : busy
                              ? 'bg-amber-100 border-amber-300 text-amber-800 hover:bg-amber-200'
                              : 'bg-admin-card border-sky-200 text-neutral-700 hover:bg-sky-100'}`}
                          title={busy ? `โต๊ะ ${n} — มีบิลเปิดอยู่` : `โต๊ะ ${n} — ว่าง`}
                        >
                          {n}
                        </button>
                      );
                    })}
                </div>

                {/* รวมบิล / แยกบิล — asked only when the chosen table already has
                    an open bill. Two groups pushing tables together and paying as
                    one is the common case, so it leads. */}
                {moveConflict ? (
                  <div className="bg-admin-card border border-sky-300 rounded-xl p-2.5 space-y-2">
                    <p className="text-[11px] font-bold text-neutral-700">
                      โต๊ะ {moveConflict} มีบิลเปิดอยู่แล้ว ({openBillsAt(moveConflict).length} บิล) ต้องการแบบไหน?
                    </p>
                    <div className="grid grid-cols-2 gap-1.5">
                      <button
                        onClick={() => mergeBillInto(moveConflict)}
                        className="bg-sky-600 hover:bg-sky-700 text-white font-bold py-2 rounded-lg text-[11px] transition"
                      >
                        รวมเป็นบิลเดียว
                      </button>
                      <button
                        onClick={() => moveBillTo(moveConflict)}
                        className="bg-admin-field hover:bg-neutral-100 border text-neutral-700 font-bold py-2 rounded-lg text-[11px] transition"
                      >
                        ย้ายแบบแยกบิล
                      </button>
                    </div>
                    <button
                      onClick={() => setMoveConflict('')}
                      className="w-full text-[10px] text-neutral-500 hover:text-neutral-700 font-bold py-1"
                    >
                      เลือกโต๊ะอื่น
                    </button>
                    <p className="text-[10px] text-neutral-400 leading-normal">
                      รวมบิล = รายการอาหารทั้งหมดไปอยู่ในบิลเดียว จ่ายทีเดียวจบ (ใช้เลขที่บิลของโต๊ะปลายทาง)
                    </p>
                  </div>
                ) : (
                  <p className="text-[10px] text-sky-700/80">
                    สีเหลือง = โต๊ะนั้นมีบิลที่ยังไม่ชำระอยู่ (กดแล้วจะถามว่ารวมบิลไหม) · เมื่อย้ายแล้ว หน้าจอของลูกค้าที่โต๊ะเดิมจะเปลี่ยนเป็นเลขโต๊ะใหม่ให้เอง
                  </p>
                )}
              </div>
            )}

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

      {/* HIDDEN PRINT SLIP — never shown on screen (off-canvas), only revealed
          to the printer by the @media print rule in index.css. printBill() fills
          this in and window.print() fires automatically, so there is no preview
          screen: staff tap พิมพ์บิล and the XP-80T just prints. Styled plain
          (no colour/shadow/rounded borders) for an 80mm monochrome thermal roll. */}
      {printData && (
        <div id="bill-print" aria-hidden="true">
          <div className="bp-hr-eq" />

          {/* Shop header */}
          <div className="bp-center">
            <div className="bp-shop">
              {theme === 'night' ? (settings.nameNight || 'เรือนเก่า') : (settings.name || 'ชื่อร้าน')}
            </div>
            <div className="bp-doc">ใบแจ้งรายการ{printData.type === 'split' ? ' (คนละครึ่ง)' : ''}</div>
          </div>

          <div className="bp-hr-eq" />

          {/* Table / time / date / staff */}
          <div className="bp-meta">
            <div>
              <span>โต๊ะ: {printData.table}</span>
              <span>เวลา: {new Date(printData.printedAt).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })} น.</span>
            </div>
            <div>
              <span>วันที่: {new Date(printData.printedAt).toLocaleDateString('en-GB')}</span>
              <span>พนักงาน: {printData.staff}</span>
            </div>
          </div>

          <div className="bp-hr-dash" />

          {/* Column header */}
          <div className="bp-item bp-head">
            <span className="bp-name">รายการ</span>
            <span className="bp-qty">Qty</span>
            <span className="bp-amt">ราคา</span>
          </div>

          {/* Line items — base on its own line, add-ons broken out beneath it */}
          {printData.items.map((it, i) => {
            const base = (it.price || 0) * it.qty;
            const addon = (it.addonCost || 0) * it.qty;
            return (
              <React.Fragment key={i}>
                <div className="bp-item">
                  <span className="bp-name">{it.name}</span>
                  <span className="bp-qty">x{it.qty}</span>
                  <span className="bp-amt">{fmtBaht(base)}</span>
                </div>
                {addon > 0 && (
                  <div className="bp-item bp-sub-item">
                    <span className="bp-name">- {it.addOns && it.addOns.length ? it.addOns.join(', ') : 'พิเศษ'}</span>
                    <span className="bp-qty">x{it.qty}</span>
                    <span className="bp-amt">{fmtBaht(addon)}</span>
                  </div>
                )}
              </React.Fragment>
            );
          })}

          <div className="bp-hr-dash" />

          {/* Total */}
          <div className="bp-total-row">
            <span>ราคารวมทั้งสิ้น (Total)</span>
            <span>{fmtBaht(printData.total)} THB</span>
          </div>

          <div className="bp-hr-eq" />

          {/* PromptPay QR of the shop account */}
          {settings.promptpayId && (
            <div className="bp-center bp-qr">
              <div className="bp-qrhead">[ QR CODE สแกนจ่าย ]</div>
              <QRCodeSVG value={generatePayload(settings.promptpayId, { amount: printData.total })} size={168} />
            </div>
          )}
          {printData.type === 'split' && (
            <div className="bp-center bp-foot">เปิดแอปถุงเงินบนมือถือร้าน แล้วให้ลูกค้าสแกน QR สิทธิ์คนละครึ่ง</div>
          )}

          {/* Footer */}
          <div className="bp-center bp-foot">
            <div>กรุณาตรวจสอบรายการอาหาร</div>
            <div>ขอบคุณที่ใช้บริการ</div>
          </div>

          <div className="bp-hr-eq" />
        </div>
      )}

    </div>
  );
}

export default StaffView;
