import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import CustomerView from './components/CustomerView';
import StaffView from './components/StaffView';
import OwnerView from './components/OwnerView';
import LoginPage from './components/LoginPage';
import { fetchState, saveResource, subscribeToState, login, setAuthToken } from './api';
import { paletteStyle } from './admin-theme';
import { shiftNow } from './shift';
import { ShieldCheck, Key, LogOut, Sun, Moon, Smartphone, Languages } from 'lucide-react';
import logoImg from './assets/logo.jpg';

const DEFAULT_MENU = [
  // Day Menu
  { id: 'd1', name: 'ผัดไทยกุ้งสด', price: 90, category: 'แนะนำ', theme: 'day', emoji: '🍤', desc: 'เส้นจันท์เหนียวนุ่มผัดซอสสูตรเด็ดของบ้านยาย เสิร์ฟพร้อมกุ้งสดตัวโต', available: true, stockRef: 'DST01' },
  { id: 'd2', name: 'ต้มยำกุ้งน้ำข้น', price: 150, category: 'แนะนำ', theme: 'day', emoji: '🍲', desc: 'เผ็ดร้อนถึงใจด้วยสมุนไพรสดและกุ้งแม่น้ำตัวใหญ่สุกกำลังดี', available: true, stockRef: 'DST01' },
  { id: 'd3', name: 'ข้าวผัดปู', price: 120, category: 'แนะนำ', theme: 'day', emoji: '🦀', desc: 'ข้าวหอมมะลิผัดร่วนเคลือบไข่ โรยด้วยเนื้อปูก้อนแน่นหวานฉ่ำ', available: true, stockRef: 'DST02' },
  { id: 'd4', name: 'ข้าวกระเพราหมูสับ/เนื้อสับ', price: 60, category: 'จานเดียว', theme: 'day', emoji: '🍳', desc: 'กะเพราแท้รสชาติเผ็ดร้อนดุดัน ผัดกระเทียมพริกแห้งหอมกรุ่น', available: true },
  { id: 'd5', name: 'ข้าวผัดกระเทียมหอมมะลิ', price: 55, category: 'จานเดียว', theme: 'day', emoji: '🧄', desc: 'ข้าวหอมมะลิผัดซอสกระเทียมกระทะเหล็ก หอมฟุ้งกรอบนอกนุ่มใน', available: true },
  { id: 'd6', name: 'ผัดคะน้าหมูกรอบราดข้าว', price: 70, category: 'จานเดียว', theme: 'day', emoji: '🥬', desc: 'หมูกรอบสุกกรอบนอกนุ่มใน ผัดกับคะน้าฮ่องกงซอสเข้มข้น', available: true },
  { id: 'd7', name: 'ต้มยำกุ้งน้ำข้นสูตรพิเศษ', price: 120, category: 'กับข้าว', theme: 'day', emoji: '🍲', desc: 'ต้มยำกุ้งแม่น้ำน้ำข้นมันกุ้งเยิ้มๆ รสกลมกล่อม', available: true },
  { id: 'd8', name: 'ไข่เจียวสมุนไพรทรงเครื่อง', price: 80, category: 'กับข้าว', theme: 'day', emoji: '🍳', desc: 'ไข่ดาวทอดฟูหนานุ่ม ผสมหัวหอม ใบมะกรูด และพริกขี้หนูสด', available: true },
  { id: 'd9', name: 'ยำวุ้นเส้นทะเล', price: 110, category: 'ต้ม & ยำ', theme: 'day', emoji: '🥗', desc: 'วุ้นเส้นคลุกเคล้าน้ำยำสามรส กุ้ง ปลาหมึกสด รสจัดจ้านถึงใจ', available: true },
  { id: 'd10', name: 'ต้มข่าไก่', price: 90, category: 'ต้ม & ยำ', theme: 'day', emoji: '🥥', desc: 'เนื้ออกไก่นุ่มในน้ำซุปกะทิสดสมุนไพร กลิ่นหอมข่าอ่อนๆ', available: true },
  { id: 'd11', name: 'ผัดคะน้าหมูกรอบ', price: 90, category: 'ผัด', theme: 'day', emoji: '🥬', desc: 'คะน้าฮ่องกงผัดหมูกรอบจานใหญ่ ทานคู่ข้าวสวยร้อนๆ', available: true },
  { id: 'd12', name: 'ผัดซีอิ๊วเส้นใหญ่', price: 70, category: 'ผัด', theme: 'day', emoji: '🍜', desc: 'เส้นใหญ่ผัดซีอิ๊วดำหอมกลิ่นกระทะเหล็ก ใส่คะน้าและหมูหมักนุ่ม', available: true },
  { id: 'd13', name: 'ข้าวสวย', price: 15, category: 'ข้าว', theme: 'day', emoji: '🍚', desc: 'ข้าวหอมมะลิสุรินทร์เกรดพรีเมียม หุงร้อนใหม่ทุกวัน', available: true },
  { id: 'd14', name: 'ข้าวเหนียว', price: 15, category: 'ข้าว', theme: 'day', emoji: '🍙', desc: 'ข้าวเหนียวเขี้ยวงูเม็ดสวย นุ่มเหนียวร้อนๆ', available: true },
  { id: 'd15', name: 'ข้าวเหนียวมะม่วง', price: 80, category: 'ของหวาน', theme: 'day', emoji: '🥭', desc: 'ข้าวเหนียวมูนกะทิเข้มข้น ทานคู่กับมะม่วงน้ำดอกไม้สุกสีทองหวานฉ่ำ', available: true, stockRef: 'DST03' },
  { id: 'd16', name: 'บัวลอยไข่หวาน', price: 45, category: 'ของหวาน', theme: 'day', emoji: '🍮', desc: 'บัวลอยแป้งนุ่มต้มในน้ำกะทิมะพร้าวอ่อนใบเตย พร้อมไข่หวานยางมะตูม', available: true },
  { id: 'd17', name: 'ชาไทยเย็น', price: 40, category: 'เครื่องดื่ม', theme: 'day', emoji: '🧋', desc: 'ชาไทยคัดพิเศษ ชงใส่นมข้นหวานมัน ท็อปด้วยนมข้นจืดเย็นฉ่ำ', available: true },
  { id: 'd18', name: 'น้ำเปล่า', price: 15, category: 'เครื่องดื่ม', theme: 'day', emoji: '💧', desc: 'น้ำดื่มบรรจุขวดเสิร์ฟพร้อมน้ำแข็งแก้วเย็นระยับ', available: true },
  { id: 'd19', name: 'โซดามะนาว', price: 45, category: 'เครื่องดื่ม', theme: 'day', emoji: '🍹', desc: 'น้ำมะนาวแท้คั้นสด ผสมน้ำเชื่อมใบเตยและโซดาซ่าสะใจ', available: true },
  
  // Night Menu
  { id: 'n1', name: 'ค็อกเทล Signature Blue Ocean', price: 220, category: 'เครื่องดื่ม', theme: 'night', emoji: '🍸', desc: 'ค็อกเทลสีฟ้าครามสดใส รสชาติอมเปรี้ยวหวานสดชื่นจากบลูคูราโซและเลมอน', available: true, stockRef: 'ST01' },
  { id: 'n2', name: 'เบียร์คราฟต์รสพีช', price: 180, category: 'เครื่องดื่ม', theme: 'night', emoji: '🍺', desc: 'เบียร์คราฟต์รสเบาละมุน หอมกลิ่นพีชญี่ปุ่นเข้มข้น ดื่มง่ายดื่มด่ำ', available: true, stockRef: 'ST02' },
  { id: 'n3', name: 'วิสกี้พรีเมียม (ช็อต)', price: 150, category: 'เครื่องดื่ม', theme: 'night', emoji: '🥃', desc: 'ซิงเกิลมอลต์วิสกี้บ่ม 12 ปี เสิร์ฟเย็นพร้อมน้ำแข็งกลมขนาดใหญ่สลายช้า', available: true, stockRef: 'ST03' },
  { id: 'n4', name: 'โซดาเกลือหิมะ', price: 80, category: 'เครื่องดื่ม', theme: 'night', emoji: '🧂', desc: 'โซดาแช่เย็นจัดในแก้วแช่แข็ง ขอบแก้วเคลือบด้วยเกลือหิมะฝอยละเอียดตัดรสชาติ', available: true, stockRef: 'ST04' },
  { id: 'n5', name: 'เฟรนช์ฟรายส์ทรัฟเฟิลชีส', price: 140, category: 'ของกินเล่น', theme: 'night', emoji: '🍟', desc: 'มันฝรั่งแท่งใหญ่ทอดกรอบสีทอง คลุกผงชีสและราดด้วยซอสครีมเห็ดทรัฟเฟิลหอมตลบ', available: true },
  { id: 'n6', name: 'ข้อไก่ทอดงาสามสี', price: 120, category: 'ของกินเล่น', theme: 'night', emoji: '🍗', desc: 'ข้อกระดูกอ่อนไก่ชุบแป้งบางๆ ทอดโรยด้วยงาขาว งาดำ และงาขี้ม้อนกรุบกรอบ', available: true }
];

// Extras offered in the order dialog, keyed by which storefront they belong to.
// `food` and `drink` are replaced by the Google Sheet's รายการเสริม rows as soon
// as the backend responds; these values are only the pre-load fallback. `night`
// has no sheet behind it and stays curated here.
const DEFAULT_ADDONS = {
  food: [
    { id: 'a1', name: 'ไข่เจียว', price: 10 },
    { id: 'a2', name: 'ไข่ดาว', price: 10 }
  ],
  drink: [],
  night: [
    { id: 'a4', name: 'เพิ่มถังน้ำแข็งเกล็ดโต', price: 20 },
    { id: 'a5', name: 'เลมอนฝานนำเข้า', price: 15 }
  ]
};

// Pick-exactly-one groups (ขนาด / ระดับความหวาน). Replaced by the sheet's
// รายการเสริม rows once the backend responds; the night bar has none.
const DEFAULT_CHOICES = { food: [], drink: [], night: [] };

const DEFAULT_STOCK = {
  // Day-shift stock (kitchen ingredients / limited daily dishes).
  DST01: { name: 'กุ้งสด (ผัดไทย/ต้มยำ)', count: 30, min: 8, theme: 'day' },
  DST02: { name: 'เนื้อปูก้อน (ข้าวผัดปู)', count: 15, min: 4, theme: 'day' },
  DST03: { name: 'มะม่วงน้ำดอกไม้สุก', count: 12, min: 4, theme: 'day' },
  DST04: { name: 'ไข่ไก่สด', count: 60, min: 15, theme: 'day' },
  // Night-shift stock (bar drinks).
  ST01: { name: 'ค็อกเทล Signature Blue Ocean', count: 24, min: 5, theme: 'night' },
  ST02: { name: 'เบียร์คราฟต์รสพีช', count: 8, min: 10, theme: 'night' },
  ST03: { name: 'วิสกี้พรีเมียม (ช็อต)', count: 45, min: 15, theme: 'night' },
  ST04: { name: 'โซดาเกลือหิมะ', count: 2, min: 12, theme: 'night' }
};

const DEFAULT_STAFF = [
  { user: 'admin', pass: '1234', name: 'ผู้จัดการร้าน' }
];

const DEFAULT_SETTINGS = {
  name: 'ตู้กับข้าวบ้านยาย',
  nameNight: 'เรือนเก่า',
  tables: 12,
  baseUrl: '',
  // PromptPay ID of the shop (mobile no. or citizen ID) — powers the
  // pay-by-QR option at checkout. Empty disables the QR choice.
  promptpayId: '',
  // Back-office colour overrides picked in ตั้งค่า, keyed by CSS variable.
  // Empty means "use the defaults from index.css".
  adminColors: {}
};

// The saved login session (if any), shape { user, name, token, role, shop }.
function readSession() {
  try {
    return JSON.parse(localStorage.getItem('session') || 'null');
  } catch {
    return null;
  }
}

// A customer arrives via a table link. Three URL shapes are accepted:
//   ?table-day=N   → table N, shift LOCKED to the day storefront
//   ?table-night=N → table N, shift LOCKED to the night bar
//   ?table=N       → table N, shift decided by the clock (shiftNow())
// Returns { table:Number, shift:'day'|'night'|null } or null when none is
// present (null shift means "let the clock decide"). This is the single source
// of truth for how a QR scan maps to a table + shift.
function readTableParam() {
  const params = new URLSearchParams(window.location.search);
  const num = (v) => {
    const n = parseInt(v);
    return !isNaN(n) && n > 0 ? n : null;
  };
  const day = num(params.get('table-day'));
  if (day) return { table: day, shift: 'day' };
  const night = num(params.get('table-night'));
  if (night) return { table: night, shift: 'night' };
  const plain = num(params.get('table'));
  if (plain) return { table: plain, shift: null };
  return null;
}

function App() {
  const [theme, setTheme] = useState(() => {
    // A customer arriving via a table QR is pinned to their shift from the very
    // first frame — so a day diner never flashes the night palette (or vice-
    // versa) from a stale saved theme. An explicit ?table-day / ?table-night
    // link fixes the shift; a plain ?table falls back to the clock.
    const tp = readTableParam();
    if (tp) return tp.shift || shiftNow();
    return localStorage.getItem('activeTheme') || 'day';
  });
  // The active screen. Access is decided up-front, not switchable at will:
  //   • a table QR (…?table=N) is the ONLY way to become a 'customer';
  //   • a saved login restores that account's own panel ('staff' | 'owner');
  //   • everyone else lands on the 'login' page.
  // This is what keeps each role boxed into its own view — there is no dropdown
  // to hop between them anymore.
  const [role, setRole] = useState(() => {
    if (readTableParam()) return 'customer';
    const session = readSession();
    if (session?.role) return session.role === 'owner' ? 'owner' : 'staff';
    return 'login';
  });
  const [tableNo, setTableNo] = useState(() => {
    const tp = readTableParam();
    if (tp) return tp.table;
    return parseInt(localStorage.getItem('tableNo') || '1');
  });
  // Customer-facing menu language ('th' | 'en'). Only the customer view reads
  // it; staff and owner panels stay Thai. Persisted so a foreign diner's choice
  // survives a page reload.
  const [lang, setLang] = useState(() => localStorage.getItem('lang') || 'th');
  // --- SHARED STATE (lives on the backend, cached here) --------------------
  // These are seeded with local defaults only for the first render; the real
  // values arrive from the backend a moment later and are then kept in sync
  // across every open tab via the SSE stream (see the effect further down).
  const [menu, setMenuLocal] = useState(DEFAULT_MENU);
  const [stock, setStockLocal] = useState(DEFAULT_STOCK);
  const [staff, setStaffLocal] = useState(DEFAULT_STAFF);
  const [settings, setSettingsLocal] = useState(DEFAULT_SETTINGS);
  const [orders, setOrdersLocal] = useState([]);
  // Owner-recorded outgoings. Empty until the backend answers.
  const [expenses, setExpensesLocal] = useState([]);
  // Staff clock-in/out records. Server-owned: read-only here, appended to only
  // via the /api/timeclock/clock endpoint (which then broadcasts over SSE).
  const [timeclock, setTimeclockLocal] = useState([]);
  // Monthly payroll status keyed "user__YYYY-MM" -> 'paid'. Server-owned too.
  const [payroll, setPayrollLocal] = useState({});
  // Extras come from the sheet via the backend; fall back to the local
  // defaults for anything it doesn't carry (i.e. the night bar).
  const [addons, setAddonsLocal] = useState(DEFAULT_ADDONS);
  const [choices, setChoicesLocal] = useState(DEFAULT_CHOICES);

  // Refs mirror the latest value of each shared resource so the wrapped
  // setters below can compute functional updates (prev => next) without going
  // stale, even right after an SSE push.
  const ordersRef = useRef(orders);
  const stockRef = useRef(stock);
  const staffRef = useRef(staff);
  const settingsRef = useRef(settings);
  const expensesRef = useRef(expenses);
  useEffect(() => { expensesRef.current = expenses; }, [expenses]);
  useEffect(() => { ordersRef.current = orders; }, [orders]);
  useEffect(() => { stockRef.current = stock; }, [stock]);
  useEffect(() => { staffRef.current = staff; }, [staff]);
  useEffect(() => { settingsRef.current = settings; }, [settings]);

  // Wrapped setters: update this tab immediately (optimistic) AND push the new
  // value to the backend, which broadcasts it to all other tabs. They accept
  // either a value or an updater function, exactly like a useState setter, so
  // the child components need no changes.
  const makeSetter = (resource, setLocal, ref) =>
    (updater) => {
      const next = typeof updater === 'function' ? updater(ref.current) : updater;
      ref.current = next;
      setLocal(next);
      // A 401 means our staff session expired — drop it and ask to log in again.
      saveResource(resource, next, handleSessionExpired);
    };
  const setOrders = useCallback(makeSetter('orders', setOrdersLocal, ordersRef), []);
  const setStock = useCallback(makeSetter('stock', setStockLocal, stockRef), []);
  const setStaff = useCallback(makeSetter('staff', setStaffLocal, staffRef), []);
  const setSettings = useCallback(makeSetter('settings', setSettingsLocal, settingsRef), []);
  const setExpenses = useCallback(makeSetter('expenses', setExpensesLocal, expensesRef), []);
  
  // App UX States
  const [cart, setCart] = useState([]);
  const [activeStaffUser, setActiveStaffUser] = useState(() => readSession()?.user || null);
  // The logged-in account's access level ('owner' | 'staff') and home shop
  // ('day' | 'night'), restored from the saved session so a refresh keeps them.
  const [activeRole, setActiveRole] = useState(() => readSession()?.role || null);
  const [activeShop, setActiveShop] = useState(() => readSession()?.shop || null);
  const [toast, setToast] = useState({ show: false, message: '' });
  // Recomputed only when the owner actually changes a colour.
  const adminPaletteStyle = useMemo(
    () => paletteStyle(settings.adminColors),
    [settings.adminColors]
  );
  const [showPwaModal, setShowPwaModal] = useState(false);
  // Status of the very first load of shared state from the backend.
  // 'loading' -> 'ready' | 'error'. Later SSE pushes never revert this.
  const [loadState, setLoadState] = useState('loading');
  const [loadError, setLoadError] = useState('');

  // A staff member is pinned to their own shift: the theme (which drives the
  // menu, the bill board and the whole palette) is forced to their shop and the
  // day/night toggle is hidden, so a day worker can never reach the night side
  // (or dark mode) and vice-versa. Runs before the toggle can ever be shown.
  useEffect(() => {
    if (role === 'staff' && activeShop && theme !== activeShop) {
      setTheme(activeShop);
    }
  }, [role, activeShop, theme]);

  // Per-tab UI preferences still live in localStorage (they are NOT shared).
  useEffect(() => {
    localStorage.setItem('activeTheme', theme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem('tableNo', tableNo.toString());
  }, [tableNo]);

  useEffect(() => {
    localStorage.setItem('lang', lang);
  }, [lang]);

  // Load the shared state from the backend, then keep it live over SSE — this is
  // what lets a customer's order appear on the staff tab (and vice-versa) in
  // real time. It re-runs whenever the logged-in user changes (login/logout) so
  // both the fetch and the stream carry the current session token, and the
  // server re-scopes what it returns (an owner then starts receiving the gated
  // expenses/payroll/time-clock data; a logout drops back to the public slice).
  useEffect(() => {
    const applyState = (s) => {
      if (s.orders) setOrdersLocal(s.orders);
      if (s.menu) setMenuLocal(s.menu);
      if (s.stock) setStockLocal(s.stock);
      if (s.staff) setStaffLocal(s.staff);
      if (s.settings) setSettingsLocal({ ...DEFAULT_SETTINGS, ...s.settings });
      if (s.expenses) setExpensesLocal(s.expenses);
      if (s.addons) setAddonsLocal({ ...DEFAULT_ADDONS, ...s.addons });
      if (s.choices) setChoicesLocal({ ...DEFAULT_CHOICES, ...s.choices });
      if (s.timeclock) setTimeclockLocal(s.timeclock);
      if (s.payroll) setPayrollLocal(s.payroll);
    };
    fetchState()
      .then((s) => {
        applyState(s);
        setLoadState('ready');
      })
      .catch((err) => {
        console.error('[app] Could not reach backend. Is it running?', err);
        setLoadError(err.message || String(err));
        setLoadState('error');
      });
    // An SSE push means the backend is reachable after all, so a connection
    // that recovers on its own clears the error screen without a reload.
    const unsubscribe = subscribeToState((s) => {
      applyState(s);
      setLoadState('ready');
    });
    return unsubscribe;
  }, [activeStaffUser]);

  // Handle URL table param (?table / ?table-day / ?table-night)
  useEffect(() => {
    const tp = readTableParam();
    if (tp) {
      setTableNo(tp.table);
      setRole('customer');
      // A QR scan is a fresh customer arrival: an explicit ?table-day /
      // ?table-night link fixes the shift; a plain ?table shows whichever shop
      // is open right now (by the clock) — never a stale theme from a previous
      // session, which could stamp a daytime order onto the night board/bills.
      setTheme(tp.shift || shiftNow());
      const suffix = tp.shift === 'day' ? ' (กลางวัน)' : tp.shift === 'night' ? ' (กลางคืน)' : '';
      showToast(`สแกนเข้าโต๊ะหมายเลข ${tp.table}${suffix} สำเร็จ`);
    }
  }, []);

  const showToast = (message) => {
    setToast({ show: true, message });
    setTimeout(() => {
      setToast(prev => ({ ...prev, show: false }));
    }, 2800);
  };

  // Called by the login page. The backend verifies the password against a hashed
  // store and returns the account's role/shop; we route straight to that panel
  // and never anywhere else, so a staff login can't reach the owner board and
  // vice-versa. Rejects (re-throws) so the login page can show the error inline.
  const handleLogin = async (user, pass, remember) => {
    // Verified server-side; credentials are never checked in the browser.
    const { token, user: u, name, role: r, shop } = await login(user, pass);
    const landRole = r === 'owner' ? 'owner' : 'staff';
    const landShop = shop === 'night' ? 'night' : 'day';
    setActiveStaffUser(u);
    setActiveRole(landRole);
    setActiveShop(landShop);
    // Persist so a refresh keeps the session (setAuthToken already ran inside
    // login(), so an un-remembered session still works in memory this tab).
    if (remember) {
      localStorage.setItem('session', JSON.stringify({ user: u, name, token, role: landRole, shop: landShop }));
    }
    // Staff land on the shift matching their shop; the owner keeps the palette.
    if (landRole === 'staff') setTheme(landShop);
    setRole(landRole);
    showToast(`${name} เข้าสู่ระบบสำเร็จ`);
  };

  const handleLogout = () => {
    setActiveStaffUser(null);
    setActiveRole(null);
    setActiveShop(null);
    setAuthToken(null);
    localStorage.removeItem('session');
    // Back to the front door, NOT the customer menu (that needs a table QR).
    setRole('login');
    showToast('ออกจากระบบแล้ว');
  };

  // Called when the backend rejects a protected write because our session token
  // is missing or expired. Clear the stale session and send back to login.
  const handleSessionExpired = () => {
    setActiveStaffUser(null);
    setActiveRole(null);
    setActiveShop(null);
    setAuthToken(null);
    localStorage.removeItem('session');
    showToast('เซสชันหมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง');
    setRole('login');
  };

  const triggerPwa = () => {
    setShowPwaModal(true);
  };

  return (
    // The owner's colour picks ride as inline custom properties on the very
    // element that carries .theme-day / .theme-night, so they override the
    // stylesheet's defaults for everything inside without a global reset.
    <div
      className={`min-h-screen transition-colors duration-500 flex flex-col ${theme === 'day' ? 'theme-day' : 'theme-night'}`}
      style={adminPaletteStyle}
    >
      
      {/* GLOBAL TOAST */}
      <div className={`fixed bottom-20 left-1/2 transform -translate-x-1/2 bg-neutral-900/95 text-white text-xs px-4 py-2.5 rounded-full shadow-xl z-[200] transition-all duration-300 pointer-events-none flex items-center gap-2 ${toast.show ? 'opacity-100 translate-y-0 scale-100' : 'opacity-0 translate-y-4 scale-90'}`}>
        <span>ℹ️</span>
        <span className="font-medium font-thai">{toast.message}</span>
      </div>

      {/* CORE MOBILE SHELL */}
      <div className={`flex flex-col flex-1 w-full max-w-md mx-auto shadow-2xl relative overflow-hidden transition-all duration-500 min-h-screen text-ink ${theme === 'day' ? 'surface-cozy' : 'bg-app border-x border-line'}`}>

        {/* TOP NAVBAR */}
        <header className={`px-3.5 py-3 flex items-center justify-between gap-3 transition-colors duration-500 shadow-md text-header-ink ${theme === 'day' ? 'wood-grain' : 'border-b border-line bg-strip'}`}>
          <div className="flex items-center gap-2.5 min-w-0">
            <span className={`w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 shadow-sm overflow-hidden bg-logo ${theme === 'day' ? 'ring-1 ring-black/10' : 'ring-1 ring-line-strong text-accent'}`}>
              {theme === 'day' ? (
                <img src={logoImg} alt="ตู้กับข้าวบ้านยาย" className="w-full h-full object-cover" />
              ) : (
                <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M22 3H2l10 10V21" />
                  <line x1="6" y1="21" x2="18" y2="21" />
                  <line x1="3" y1="5" x2="21" y2="5" />
                </svg>
              )}
            </span>
            <h1
              className={`font-kanit font-bold tracking-wide leading-none select-none truncate text-xl ${theme === 'day' ? '[text-shadow:0_1px_3px_rgba(60,30,10,0.55)]' : ''}`}
            >
              {/* Saved settings predate nameNight, so fall back to the default
                  rather than rendering an empty header. */}
              {theme === 'day'
                ? settings.name
                : (settings.nameNight || DEFAULT_SETTINGS.nameNight)}
            </h1>
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
            {/* Menu language toggle — shown only to diners, since the menu is
                the only thing translated. Flips the whole customer menu between
                Thai and English. */}
            {role === 'customer' && (
              <button
                onClick={() => setLang(prev => (prev === 'th' ? 'en' : 'th'))}
                className={`h-10 px-3 rounded-full flex items-center justify-center gap-1 font-kanit font-bold text-sm transition-all duration-300 shadow-sm bg-raised hover:bg-raised-hover text-raised-ink ${theme === 'day' ? '' : 'border border-line-strong'}`}
                title="เปลี่ยนภาษา / Change language"
              >
                <Languages className="w-4 h-4" />
                <span>{lang === 'th' ? 'EN' : 'ไทย'}</span>
              </button>
            )}

            {/* Quick theme toggler — the owner only. Both staff AND customers are
                locked to their own shift's palette: a day diner/worker stays
                light/day, a night one stays dark/night, and neither may flip the
                background or cross into the other shift. A customer's shift is
                pinned from the clock at QR-scan time. */}
            {role === 'owner' && (
            <button
              onClick={() => setTheme(prev => prev === 'day' ? 'night' : 'day')}
              className={`w-10 h-10 rounded-full flex items-center justify-center transition-all duration-300 shadow-sm bg-raised hover:bg-raised-hover text-raised-ink ${theme === 'day' ? '' : 'border border-line-strong'}`}
              title="เปลี่ยนช่วงเวลา/ธีม"
            >
              {theme === 'day' ? <Moon className="w-5 h-5" /> : <Sun className="w-4 h-4" />}
            </button>
            )}

            {/* Static role badge. There is intentionally no switcher: which panel
                you see is fixed by how you arrived (QR scan → customer, or the
                account you logged in as → staff / owner). */}
            {role !== 'login' && (
              <div
                className={`flex items-center gap-1.5 rounded-full font-kanit font-semibold tracking-wide bg-raised ${theme === 'day' ? 'text-raised-ink text-base px-5 py-2 shadow-sm' : 'border border-line-strong text-ink text-sm px-4 py-2'}`}
              >
                {role === 'customer' && <span>โต๊ะ {tableNo}</span>}
                {role === 'staff' && (
                  <>
                    <ShieldCheck className="w-3.5 h-3.5 text-accent" />
                    <span>พนักงาน{activeShop === 'night' ? 'กลางคืน' : 'กลางวัน'}</span>
                  </>
                )}
                {role === 'owner' && (
                  <>
                    <Key className="w-3.5 h-3.5 text-accent" />
                    <span>ผู้บริหาร</span>
                  </>
                )}
              </div>
            )}
          </div>
        </header>

        {/* MAIN BODY LAYOUT */}
        <main className={`flex-1 overflow-y-auto ${role === 'login' ? 'flex flex-col' : 'p-4 space-y-4'}`}>
          {/* The front door for staff/owner. Shown regardless of menu load state
              — it doesn't need the menu, and the backend has to be up to log in
              anyway (a failure surfaces inline on the form). */}
          {role === 'login' && (
            <LoginPage onLogin={handleLogin} settings={settings} />
          )}

          {/* First-load states. Once state has arrived these never show again,
              so live SSE updates don't flash a spinner over the menu. */}
          {role !== 'login' && loadState === 'loading' && (
            <div className="py-16 text-center space-y-3 font-thai">
              <div className="w-8 h-8 mx-auto rounded-full border-2 border-[#A9713D]/25 border-t-[#A9713D] animate-spin" />
              <p className="text-xs text-neutral-400 font-medium">กำลังโหลดเมนูจาก Google Sheets...</p>
            </div>
          )}

          {role !== 'login' && loadState === 'error' && (
            <div className="py-12 px-4 text-center space-y-3 font-thai">
              <span className="text-3xl">📡</span>
              <h3 className="font-kanit font-bold text-sm text-[#5A2E14]">โหลดข้อมูลไม่สำเร็จ</h3>
              <p className="text-xs text-neutral-500 leading-relaxed">
                ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ของร้านได้ กรุณาตรวจสอบว่าเปิดระบบหลังบ้านอยู่ แล้วลองใหม่อีกครั้ง
              </p>
              {loadError && (
                <p className="text-[10px] text-neutral-400 font-mono break-all bg-neutral-100 rounded-lg p-2">
                  {loadError}
                </p>
              )}
              <button
                onClick={() => window.location.reload()}
                className="text-xs bg-[#A9713D] hover:bg-[#8A5A32] text-white font-bold py-2.5 px-5 rounded-xl transition"
              >
                ลองใหม่อีกครั้ง
              </button>
            </div>
          )}

          {role !== 'login' && loadState === 'ready' && menu.length === 0 && (
            <div className="py-16 text-center space-y-2 font-thai">
              <span className="text-3xl">🍽️</span>
              <h3 className="font-kanit font-bold text-sm text-[#5A2E14]">ยังไม่มีรายการอาหาร</h3>
              <p className="text-xs text-neutral-400">ยังไม่มีเมนูในระบบขณะนี้ กรุณาติดต่อพนักงาน</p>
            </div>
          )}

          {loadState === 'ready' && menu.length > 0 && role === 'customer' && (
            <CustomerView
              theme={theme}
              lang={lang}
              tableNo={tableNo}
              menu={menu}
              orders={orders}
              setOrders={setOrders}
              stock={stock}
              setStock={setStock}
              cart={cart}
              setCart={setCart}
              addons={addons}
              choices={choices}
              showToast={showToast}
            />
          )}

          {loadState === 'ready' && role === 'staff' && (
            <StaffView
              theme={theme} 
              menu={menu} 
              orders={orders}
              setOrders={setOrders}
              stock={stock}
              setStock={setStock}
              settings={settings}
              activeStaffUser={activeStaffUser}
              showToast={showToast}
              addons={addons}
              choices={choices}
              timeclock={timeclock}
            />
          )}

          {loadState === 'ready' && role === 'owner' && (
            <OwnerView
              menu={menu}
              expenses={expenses}
              setExpenses={setExpenses}
              orders={orders}
              settings={settings}
              setSettings={setSettings}
              staff={staff}
              setStaff={setStaff}
              showToast={showToast}
              timeclock={timeclock}
              payroll={payroll}
            />
          )}
        </main>

        {/* LOGOUT ACTION FOR STAFF/OWNER */}
        {(role === 'staff' || role === 'owner') && (
          <div className="p-3 border-t text-center flex justify-between items-center text-xs font-thai bg-strip border-line text-ink">
            <span className="font-semibold text-[11px]">
              ล็อกอินเป็น: <b className="text-amber-600">{activeStaffUser}</b>
            </span>
            <button 
              onClick={handleLogout}
              className="flex items-center gap-1 bg-red-500 hover:bg-red-600 text-white font-bold py-1 px-3 rounded-full transition-colors font-thai text-[10px]"
            >
              <LogOut className="w-3 h-3" />
              <span>ออกจากระบบ</span>
            </button>
          </div>
        )}

        {/* FOOTER */}
        <footer className="text-[10px] text-center py-2 border-t font-thai transition-colors duration-500 border-line bg-strip text-ink-3">
          ระบบร้านค้าอัจฉริยะ &bull; <button onClick={triggerPwa} className="underline hover:text-amber-500 font-bold focus:outline-none">ติดตั้งแอปรวม (PWA)</button>
        </footer>
      </div>

      {/* PWA MOCKUP MODAL */}
      {showPwaModal && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-admin-card rounded-2xl max-w-xs w-full p-6 text-center space-y-4 text-neutral-800 shadow-2xl">
            <div className="mx-auto w-14 h-14 bg-amber-500/10 rounded-2xl flex items-center justify-center text-amber-600 dark:text-amber-300 shadow-inner">
              <Smartphone className="w-8 h-8" />
            </div>
            <div>
              <h3 className="font-extrabold text-base font-kanit">เพิ่มไปยังหน้าจอหลัก (PWA)</h3>
              <p className="text-xs text-neutral-500 font-thai leading-snug mt-1">ติดตั้งแอปสั่งอาหารไว้บนหน้าจอมือถือของคุณเพื่อสแกนสั่งครั้งต่อๆ ไปอย่างรวดเร็วโดยไม่ต้องค้นหาเว็บ</p>
            </div>
            <div className="bg-neutral-50 rounded-xl p-3 text-left space-y-1.5 text-[11px] font-thai text-neutral-600">
              <div><span className="font-bold text-neutral-800">ระบบปฏิบัติการ Android:</span> กดปุ่มขีดสามขีดหรือเมนูมุมขวา เลือกหัวข้อ "เพิ่มไปยังหน้าจอหลัก"</div>
              <div className="border-t border-neutral-100 pt-1.5"><span className="font-bold text-neutral-800">ระบบปฏิบัติการ iOS (Safari):</span> กดปุ่มแชร์รูปกล่องมีลูกศรชี้ขึ้นที่แถบนำทางล่าง แล้วเลือกเมนู "เพิ่มไปยังหน้าจอโฮม"</div>
            </div>
            <div className="flex gap-2 pt-1 font-thai text-xs">
              <button 
                onClick={() => setShowPwaModal(false)} 
                className="flex-1 bg-neutral-100 hover:bg-neutral-200 font-bold py-2 rounded-xl transition text-neutral-700"
              >
                ปิด
              </button>
              <button 
                onClick={() => {
                  setShowPwaModal(false);
                  showToast('ติดตั้งไอคอนลงหน้าจอโฮมสำเร็จ!');
                }} 
                className="flex-1 bg-amber-600 hover:bg-amber-700 font-bold py-2 rounded-xl transition text-white"
              >
                ติดตั้งด่วน
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

export default App;
