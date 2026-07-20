import React, { useState, useEffect, useMemo } from 'react';
import { ShoppingBag, ShoppingBasket, Trash2, X, Plus, Minus, CheckCircle } from 'lucide-react';
import { isDrinkItem, addonsFor, choicesFor, defaultChoices, choicesCost } from '../menu-groups';
import { mergeOrder, itemRound } from '../orders';
import { shiftNow } from '../shift';
import { resolveImageUrl, fetchStockAvailability } from '../api';

// Normalise a name for stock↔menu matching: trim, collapse inner whitespace,
// lowercase. Thai has no case but this keeps mixed Thai/English names in step.
const normName = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
import foodDayImg from '../assets/food.jpg';
import foodNightImg from '../assets/food-night.png';
import beverageDayImg from '../assets/beverage.jpg';
import beverageNightImg from '../assets/beverage-night.jpg';

// Each storefront card carries one photo per theme: the daytime kitchen
// shoots bright, the bar shoots dark, so a single image for both would
// always look wrong in one of them.
const GROUPS = [
  {
    key: 'food',
    label: 'เมนูอาหาร',
    image: { day: foodDayImg, night: foodNightImg },
    fallback: 'from-[#A9713D] to-[#6B4021]',
  },
  {
    key: 'drink',
    label: 'เครื่องดื่ม',
    image: { day: beverageDayImg, night: beverageNightImg },
    fallback: 'from-[#C99A5B] to-[#8A5A32]',
  },
];

function CustomerView({
  theme,
  tableNo,
  menu,
  orders,
  setOrders,
  stock,
  setStock,
  cart,
  setCart,
  addons,
  choices,
  showToast
}) {
  const [activeGroup, setActiveGroup] = useState('food');
  const [showStatusList, setShowStatusList] = useState(false);
  const [selectedItem, setSelectedItem] = useState(null);
  const [selectedOption, setSelectedOption] = useState(null); // chosen protein
  const [modalQty, setModalQty] = useState(1);
  const [modalNotes, setModalNotes] = useState('');
  const [selectedAddons, setSelectedAddons] = useState([]);
  // Pick-exactly-one groups, keyed by group name: { 'ขนาด': {name, price}, ... }
  const [selectedChoices, setSelectedChoices] = useState({});
  const [showCartModal, setShowCartModal] = useState(false);
  const [showSuccessNotice, setShowSuccessNotice] = useState(false);

  const isDay = theme === 'day';

  // Live stock levels from the คลังวัตถุดิบ (stock_items) table. Public read, so
  // the customer tab can grey out a sold-out dish. Refreshed on mount and every
  // 45s (staff top-ups/deductions land within that window). Fails open: on any
  // error this stays empty and nothing gets hidden.
  const [stockLevels, setStockLevels] = useState([]);
  useEffect(() => {
    let alive = true;
    const load = () => fetchStockAvailability()
      .then(items => { if (alive) setStockLevels(items); })
      .catch(() => {});
    load();
    const timer = setInterval(load, 45000);
    return () => { alive = false; clearInterval(timer); };
  }, []);

  // Map of normalised name -> remaining quantity, merged from the drink `stock`
  // object and the stock_items table. When a name shows up in both, the smaller
  // count wins (safer). A dish is "sold out" when its name matches an entry here
  // whose quantity is 0 or less; unmatched dishes are unaffected.
  const soldOutNames = useMemo(() => {
    const qty = new Map();
    const put = (name, count) => {
      const key = normName(name);
      if (!key || typeof count !== 'number') return;
      qty.set(key, qty.has(key) ? Math.min(qty.get(key), count) : count);
    };
    Object.values(stock || {}).forEach(s => put(s.name, s.count));
    (stockLevels || []).forEach(s => put(s.name, s.quantity));
    const out = new Set();
    qty.forEach((count, key) => { if (count <= 0) out.add(key); });
    return out;
  }, [stock, stockLevels]);

  // A dish is orderable only if the owner marked it available AND its linked
  // stock (matched by name) has not run dry.
  const isAvailable = (dish) => dish.available && !soldOutNames.has(normName(dish.name));

  // Filter menu items for current theme
  const filteredMenu = menu.filter(item => item.theme === theme);

  const itemsToShow = filteredMenu.filter(item =>
    activeGroup === 'drink' ? isDrinkItem(item) : !isDrinkItem(item)
  );

  // Group the visible dishes under their category heading, preserving the order
  // the categories first appear in the menu data.
  const sections = itemsToShow.reduce((acc, item) => {
    const section = acc.find(s => s.category === item.category);
    if (section) section.items.push(item);
    else acc.push({ category: item.category, items: [item] });
    return acc;
  }, []);

  // The line under a dish name: its protein/size choices, e.g. "หมู/ไก่/ทะเล".
  const subtitleOf = (dish) =>
    dish.options && dish.options.length
      ? dish.options.map(o => o.name).join('/')
      : dish.desc;

  // Cart operations
  const cartCount = cart.reduce((sum, item) => sum + item.qty, 0);
  const cartTotal = cart.reduce((sum, item) => sum + (item.price + item.addonCost) * item.qty, 0);

  const handleOpenDetail = (item) => {
    if (!isAvailable(item)) return;
    setSelectedItem(item);
    // Default to the first protein option (if the dish has any).
    setSelectedOption(item.options && item.options.length ? item.options[0] : null);
    setModalQty(1);
    setModalNotes('');
    setSelectedAddons([]);
    // Every pick-one group starts on the sheet's first option (ไซส์ M, 100%).
    setSelectedChoices(defaultChoices(choicesFor(choices, theme, item)));
  };

  const handleChoiceChange = (groupName, option) => {
    setSelectedChoices(prev => ({ ...prev, [groupName]: option }));
  };

  // Price of the dish once the protein choice is applied.
  const basePriceOf = (item, option) =>
    option ? option.price : (item ? item.price : 0);

  const handleAddonChange = (addonName, price, isChecked) => {
    if (isChecked) {
      setSelectedAddons(prev => [...prev, { name: addonName, price }]);
    } else {
      setSelectedAddons(prev => prev.filter(a => a.name !== addonName));
    }
  };

  const handleAddToCart = () => {
    if (!selectedItem) return;

    // Choices (ไซส์ L +5) and addons (ไข่มุก +5) both ride on addonCost, so the
    // cart, the bill and the kitchen ticket need no changes to understand them.
    const addonCost =
      selectedAddons.reduce((sum, a) => sum + a.price, 0) + choicesCost(selectedChoices);
    const basePrice = basePriceOf(selectedItem, selectedOption);
    // Fold the chosen protein into the item name, e.g. "ทอดน้ำปลาราดข้าว (หมู)".
    const itemName = selectedOption
      ? `${selectedItem.name} (${selectedOption.name})`
      : selectedItem.name;
    const cartItem = {
      id: selectedItem.id + '_' + Date.now().toString(36),
      menuId: selectedItem.id,
      name: itemName,
      option: selectedOption ? selectedOption.name : null,
      basePrice: basePrice,
      price: basePrice,
      addonCost: addonCost,
      qty: modalQty,
      addons: [
        ...Object.values(selectedChoices).map(o => o.name),
        ...selectedAddons.map(a => a.name),
      ],
      note: modalNotes,
      stockRef: selectedItem.stockRef || null
    };

    setCart(prev => [...prev, cartItem]);
    setSelectedItem(null);
    showToast(`เพิ่ม ${cartItem.name} ลงตะกร้าแล้ว`);
  };

  const handleRemoveCartItem = (itemId) => {
    const updatedCart = cart.filter(item => item.id !== itemId);
    setCart(updatedCart);
    if (updatedCart.length === 0) {
      setShowCartModal(false);
    }
  };

  const handlePlaceOrder = () => {
    if (cart.length === 0) return;

    // REALTIME stock validation
    let stockError = false;
    let errorItemName = '';

    cart.forEach(cartItem => {
      if (cartItem.stockRef && stock[cartItem.stockRef]) {
        const remaining = stock[cartItem.stockRef].count;
        if (remaining < cartItem.qty) {
          stockError = true;
          errorItemName = cartItem.name;
        }
      }
    });

    if (stockError) {
      alert(`ขออภัยอย่างยิ่ง! เครื่องดื่ม [${errorItemName}] มีสต็อกไม่เพียงพอในขณะนี้ ไม่สามารถจัดส่งออเดอร์ได้`);
      return;
    }

    // Deduct stock
    const updatedStock = { ...stock };
    cart.forEach(cartItem => {
      if (cartItem.stockRef && updatedStock[cartItem.stockRef]) {
        updatedStock[cartItem.stockRef].count -= cartItem.qty;
      }
    });
    setStock(updatedStock);

    // Create new order/bill
    const orderNo = '#' + String(orders.length + 1).padStart(3, '0');
    const newOrder = {
      id: 'B' + Math.floor(1000 + Math.random() * 9000),
      no: orderNo,
      time: new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }),
      createdAt: Date.now(),
      // Shift is stamped from the wall clock at creation, not the browsed theme.
      type: shiftNow(),
      table: tableNo,
      items: cart.map(item => ({
        name: item.name,
        qty: item.qty,
        price: item.basePrice,
        addonCost: item.addonCost,
        addOns: item.addons,
        note: item.note
      })),
      total: cartTotal,
      status: 'new', // new -> cooking -> served -> paid
      note: cart.map(i => i.note).filter(Boolean).join(' | '),
      by: 'ลูกค้าสแกน'
    };

    // Merge into this table's open bill (as a new round) if it hasn't checked
    // out yet; otherwise this opens a fresh bill.
    setOrders(prev => mergeOrder(prev, newOrder));
    setCart([]);
    setShowCartModal(false);
    setShowSuccessNotice(true);
    setTimeout(() => setShowSuccessNotice(false), 3000);
    setShowStatusList(true); // Auto switch to status page
  };

  // Orders of the CURRENT session at this table only. Once a bill is checked
  // out it becomes 'paid' (and 'cancelled' bills are likewise closed), so the
  // moment customer A pays, their orders drop out of view — the next customer B
  // at the same table sees a clean history with only their own orders. This is
  // the same "active bill" predicate the staff/table-status logic uses.
  const tableOrders = orders
    .filter(o =>
      String(o.table) === String(tableNo) &&
      o.status !== 'paid' &&
      o.status !== 'cancelled'
    )
    .sort((a, b) => b.createdAt - a.createdAt);

  const getStatusLabel = (status) => {
    switch (status) {
      case 'new': return 'ได้รับรายการแล้ว';
      case 'cooking': return 'กำลังปรุงร้อนๆ';
      case 'served': return 'เสิร์ฟเสร็จแล้ว';
      case 'paid': return 'ชำระเงินเรียบร้อย';
      case 'cancelled': return 'ยกเลิกออเดอร์';
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

  return (
    <div className="space-y-4 font-thai text-sm">

      {/* SUCCESS NOTICE ANIMATED BOUNCE */}
      {showSuccessNotice && (
        <div className="fixed top-4 left-1/2 transform -translate-x-1/2 bg-green-600 text-white py-3 px-6 rounded-2xl shadow-2xl z-[210] flex items-center gap-2 animate-bounce border border-green-500">
          <CheckCircle className="w-5 h-5" />
          <span className="text-xs font-bold font-thai">ส่งรายการอาหารเข้าครัวเรียบร้อยแล้ว!</span>
        </div>
      )}

      {/* CUSTOM STATUS VIEW TOGGLE */}
      {showStatusList ? (
        <div className="space-y-4">
          <div className="flex justify-between items-center p-2 rounded-xl bg-strip-soft">
            <h2 className="font-extrabold text-base font-kanit">สถานะสั่งซื้อ โต๊ะ {tableNo}</h2>
            <button
              onClick={() => setShowStatusList(false)}
              className="text-xs px-3 py-1.5 font-bold rounded-lg border transition-all bg-raised hover:bg-raised-hover border-line-strong text-ink"
            >
              ← กลับไปสั่งอาหาร
            </button>
          </div>

          <div className="space-y-3.5">
            {tableOrders.length > 0 ? (
              tableOrders.map(order => (
                <div
                  key={order.id}
                  className="border rounded-2xl p-4 shadow-sm relative overflow-hidden transition bg-card border-line"
                >
                  {/* Decorative Ticket Cuts — filled with the page colour so
                      they read as bites taken out of the ticket. */}
                  <div className="absolute top-12 -left-2 w-4 h-4 rounded-full border-r bg-app border-line" />
                  <div className="absolute top-12 -right-2 w-4 h-4 rounded-full border-l bg-app border-line" />

                  <div className="flex justify-between items-center border-b pb-2 mb-2 border-dashed border-line-strong">
                    <span className="font-mono font-bold text-xs text-ink-2">{order.no}</span>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${getStatusColor(order.status)}`}>
                      {getStatusLabel(order.status)}
                    </span>
                  </div>

                  <div className="space-y-1.5">
                    {order.items.map((item, idx) => {
                      // Draw a divider whenever a new ordering round begins, so
                      // "ordered more later" is visually separated from the
                      // first order on the same ticket.
                      const showRoundDivider = idx > 0 && itemRound(item) !== itemRound(order.items[idx - 1]);
                      return (
                        <React.Fragment key={idx}>
                          {showRoundDivider && (
                            <div className="flex items-center gap-2 pt-1.5 text-[9px] text-neutral-400 dark:text-[#9B8875] font-semibold">
                              <span className="h-px flex-1 bg-neutral-200 dark:bg-[#4A3A2C]" />
                              สั่งเพิ่ม · รอบที่ {itemRound(item)}
                              <span className="h-px flex-1 bg-neutral-200 dark:bg-[#4A3A2C]" />
                            </div>
                          )}
                          <div className="flex justify-between items-start text-xs">
                            <div>
                              <span className="font-extrabold text-amber-700 dark:text-[#E8B45C] mr-1.5">{item.qty}×</span>
                              <span className="font-semibold">{item.name}</span>
                              {item.addOns && item.addOns.length > 0 && (
                                <p className="text-[9px] text-neutral-400 dark:text-[#9B8875] pl-5 font-medium">ตัวเลือก: {item.addOns.join(', ')}</p>
                              )}
                              {item.note && (
                                <p className="text-[9px] text-orange-900/60 dark:text-[#C9B8A6] pl-5 italic font-medium">📝 "{item.note}"</p>
                              )}
                            </div>
                            <span className="font-mono text-neutral-500 dark:text-[#C9B8A6]">฿{((item.price + (item.addonCost || 0)) * item.qty).toLocaleString()}</span>
                          </div>
                        </React.Fragment>
                      );
                    })}
                  </div>

                  <div className="border-t border-dashed border-neutral-200/80 dark:border-[#4A3A2C] mt-3 pt-2.5 flex justify-between items-center text-xs">
                    <span className="text-[10px] text-neutral-400 dark:text-[#9B8875] font-medium">สั่งเมื่อ {order.time} น.</span>
                    <div>
                      <span className="text-neutral-400 dark:text-[#9B8875] text-[10px] mr-1 font-medium">รวมทั้งสิ้น</span>
                      <span className="font-mono font-extrabold text-sm text-amber-700 dark:text-[#E8B45C]">฿{order.total.toLocaleString()}</span>
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <div className="text-center py-10 space-y-2 border border-dashed rounded-2xl border-neutral-200 dark:border-[#4A3A2C]">
                <span className="text-3xl">🧾</span>
                <p className="text-neutral-400 dark:text-[#9B8875] font-medium text-xs">โต๊ะนี้ยังไม่มีข้อมูลออเดอร์ในวันนี้</p>
                <button
                  onClick={() => setShowStatusList(false)}
                  className="text-xs text-amber-600 dark:text-[#E8B45C] font-bold underline mt-1 block"
                >
                  สั่งอาหารมื้ออร่อยของคุณเลย →
                </button>
              </div>
            )}
          </div>
        </div>
      ) : (
        /* CUSTOMER MENU VIEW */
        <div className="space-y-4">

          {/* STOREFRONT CATEGORY CARDS */}
          <div className="grid grid-cols-2 gap-3">
            {GROUPS.map(group => (
              <button
                key={group.key}
                onClick={() => setActiveGroup(group.key)}
                className={`relative h-32 rounded-2xl overflow-hidden shadow-md bg-gradient-to-br flex items-center justify-center transition duration-300 active:scale-[0.98] ${group.fallback} ${
                  activeGroup === group.key
                    ? 'ring-4 ring-[#6B4021]/70'
                    : 'opacity-90 hover:opacity-100'
                }`}
              >
                <img
                  src={group.image[theme] || group.image.day}
                  alt=""
                  loading="lazy"
                  className="absolute inset-0 w-full h-full object-cover"
                  onError={e => { e.currentTarget.style.display = 'none'; }}
                />
                <span className="absolute inset-0 bg-gradient-to-t from-black/50 via-black/15 to-black/25" />
                <span className="relative font-kanit text-2xl font-bold text-white [text-shadow:0_2px_6px_rgba(0,0,0,0.65)]">
                  {group.label}
                </span>
              </button>
            ))}
          </div>

          {/* HOW-TO-ORDER STEP GUIDE — สั่งอาหารง่ายๆ ใน 3 ขั้นตอน */}
          <div className="rounded-2xl p-4 bg-card border border-line">
            <h3 className="font-kanit font-bold text-base text-heading mb-3">สั่งอาหารง่ายๆ ใน 3 ขั้นตอน</h3>
            <div className="grid grid-cols-3 gap-2">
              {[
                { n: '1', icon: '📖', title: 'เลือกเมนู', desc: 'แตะรายการที่ต้องการ' },
                { n: '2', icon: '🛒', title: 'ใส่ตะกร้า', desc: 'เลือกตัวเลือกแล้วกดใส่ตะกร้า' },
                { n: '3', icon: '🍽️', title: 'ส่งเข้าครัว', desc: 'กดยืนยันส่งรายการ' },
              ].map(step => (
                <div key={step.n} className="text-center space-y-1">
                  <div className="relative w-11 h-11 mx-auto rounded-full flex items-center justify-center text-xl bg-amber-100">
                    <span>{step.icon}</span>
                    <span className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-cta text-cta-ink text-[10px] font-bold flex items-center justify-center font-mono">
                      {step.n}
                    </span>
                  </div>
                  <p className="font-kanit font-bold text-xs text-title">{step.title}</p>
                  <p className="text-[10px] text-ink-2 leading-tight">{step.desc}</p>
                </div>
              ))}
            </div>
          </div>

          {/* MENU SECTIONS */}
          {sections.length > 0 ? (
            sections.map(section => (
              <div key={section.category} className="space-y-3">
                <h2 className="font-kanit text-xl font-semibold text-heading">
                  {section.category}
                </h2>

                {section.items.map(dish => {
                  const available = isAvailable(dish);
                  return (
                  <div
                    key={dish.id}
                    onClick={() => handleOpenDetail(dish)}
                    className={`rounded-3xl p-3.5 flex items-center gap-3.5 transition duration-300 bg-card hover:bg-card-hover ${available ? 'cursor-pointer active:scale-[0.99]' : 'opacity-55'} ${isDay ? 'shadow-[0_6px_20px_-8px_rgba(90,46,20,0.28)] hover:shadow-[0_10px_26px_-8px_rgba(90,46,20,0.35)]' : 'border border-line shadow-[0_6px_20px_-10px_rgba(0,0,0,0.8)]'}`}
                  >
                    <div className={`w-[88px] h-[88px] rounded-2xl flex-shrink-0 flex items-center justify-center text-4xl overflow-hidden ${isDay ? 'bg-gradient-to-b from-well to-well-2' : 'bg-well border border-line'}`}>
                      {dish.image
                        ? <img src={resolveImageUrl(dish.image)} alt="" loading="lazy" className="w-full h-full object-cover" />
                        : <span>{dish.emoji || '🍽️'}</span>}
                    </div>

                    <div className="flex-1 min-w-0">
                      <h4 className="font-kanit font-bold text-[17px] leading-snug truncate text-title">
                        {dish.name}
                      </h4>
                      {subtitleOf(dish) && (
                        <p className="text-sm truncate mt-0.5 text-ink-2">{subtitleOf(dish)}</p>
                      )}
                      <div className="mt-2 flex items-center gap-2">
                        <span className="font-kanit font-bold text-lg text-accent">
                          {dish.price}.-
                        </span>
                        {!available && (
                          <span className="text-[10px] text-red-600 bg-red-100 px-2 py-0.5 rounded-full font-semibold">
                            หมดชั่วคราว
                          </span>
                        )}
                      </div>
                    </div>

                    {available && (
                      <span className="w-14 h-14 rounded-full flex-shrink-0 flex items-center justify-center shadow-md transition bg-add hover:bg-add-hover text-add-ink">
                        <ShoppingBasket className="w-6 h-6" />
                      </span>
                    )}
                  </div>
                  );
                })}
              </div>
            ))
          ) : (
            <div className="text-center py-10 text-xs font-medium text-ink-3">ยังไม่มีรายการเมนูในหมวดนี้</div>
          )}

          {/* VIEW STATUS SHORTCUT BUTTON */}
          <div className="text-center pt-4">
            <button
              onClick={() => setShowStatusList(true)}
              className="text-xs font-extrabold hover:underline text-link"
            >
              ตรวจสอบประวัติการสั่งและสถานะออเดอร์ของโต๊ะนี้ →
            </button>
          </div>

        </div>
      )}

      {/* FLOATING CART BAR */}
      {cartCount > 0 && !showStatusList && (
        <div className="fixed bottom-14 left-0 right-0 max-w-md mx-auto px-4 py-2 z-30 pointer-events-none">
          <button
            onClick={() => setShowCartModal(true)}
            className="w-full font-bold rounded-2xl p-3 flex items-center justify-between gap-3 shadow-2xl pointer-events-auto transition hover:scale-[1.02] active:scale-[0.98] bg-cta hover:bg-cta-hover text-cta-ink"
          >
            <div className="flex items-center gap-2">
              <div className="relative">
                <span className={`p-1.5 rounded-lg block ${isDay ? 'bg-white/20' : 'bg-black/15'}`}>
                  <ShoppingBag className="w-4 h-4" />
                </span>
                <span className="absolute -top-1.5 -right-1.5 bg-red-500 text-white text-[9px] w-4.5 h-4.5 rounded-full flex items-center justify-center font-bold font-mono">
                  {cartCount}
                </span>
              </div>
              <span className="text-xs font-thai font-semibold">ดูรายการในตะกร้า</span>
            </div>

            <div className="flex items-center gap-1.5">
              <span className="text-[10px] opacity-75 font-normal">ราคารวม</span>
              <span className="font-mono text-sm font-extrabold">฿{cartTotal.toLocaleString()}</span>
            </div>
          </button>
        </div>
      )}

      {/* DETAIL MODAL WITH CUSTOM ADDONS */}
      {selectedItem && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs z-[100] flex items-end justify-center p-0">
          <div className="surface-light bg-white rounded-t-3xl max-w-md w-full p-6 space-y-4 animate-slide-up text-neutral-800 max-h-[85vh] overflow-y-auto shadow-2xl border-t border-neutral-100">

            <div className="flex justify-between items-start">
              <div>
                <h3 className="text-base font-extrabold font-kanit">{selectedItem.name}</h3>
                <span className="text-amber-600 font-extrabold font-mono text-base block mt-0.5">฿{basePriceOf(selectedItem, selectedOption)}</span>
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

            {/* OPTION CHOICE (required) — protein for food, size (M/L) for drinks */}
            {selectedItem.options && selectedItem.options.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-[10px] font-extrabold uppercase tracking-wider text-neutral-400">
                  {selectedItem.options.every(o => ['M', 'L', 'S'].includes(o.name)) ? 'เลือกขนาด' : 'เลือกเนื้อสัตว์'}
                </h4>
                <div className="grid grid-cols-2 gap-1.5">
                  {selectedItem.options.map(opt => (
                    <label
                      key={opt.name}
                      className={`flex items-center justify-between p-2.5 border rounded-xl cursor-pointer transition text-xs font-thai ${selectedOption?.name === opt.name ? 'border-amber-500 bg-amber-50 ring-1 ring-amber-500' : 'border-neutral-150 hover:bg-neutral-50'}`}
                    >
                      <div className="flex items-center gap-2">
                        <input
                          type="radio"
                          name="option-choice"
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
                      className={`flex items-center justify-between p-2.5 border rounded-xl cursor-pointer transition text-xs font-thai ${selectedChoices[group.name]?.name === opt.name ? 'border-amber-500 bg-amber-50 ring-1 ring-amber-500' : 'border-neutral-150 hover:bg-neutral-50'}`}
                    >
                      <div className="flex items-center gap-2">
                        <input
                          type="radio"
                          name={`choice-${group.name}`}
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
                ใส่ตะกร้าสินค้า (฿{((basePriceOf(selectedItem, selectedOption) + selectedAddons.reduce((sum, a) => sum + a.price, 0) + choicesCost(selectedChoices)) * modalQty).toLocaleString()})
              </button>
            </div>

          </div>
        </div>
      )}

      {/* VIEW CART OVERLAY SHEET */}
      {showCartModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs z-[100] flex items-end justify-center p-0">
          <div className="surface-light bg-white rounded-t-3xl max-w-md w-full p-6 space-y-4 animate-slide-up text-neutral-800 max-h-[85vh] overflow-y-auto shadow-2xl border-t border-neutral-100">

            <div className="flex justify-between items-center">
              <h3 className="text-base font-extrabold font-kanit flex items-center gap-2">
                <ShoppingBag className="text-amber-600 w-5 h-5" />
                <span>ตะกร้าสินค้าของคุณ (โต๊ะ {tableNo})</span>
              </h3>
              <button
                onClick={() => setShowCartModal(false)}
                className="p-1.5 rounded-full bg-neutral-100 hover:bg-neutral-200 text-neutral-500 transition"
              >
                <X className="w-4.5 h-4.5" />
              </button>
            </div>

            {/* CART ITEMS LIST */}
            <div className="divide-y divide-neutral-100 max-h-60 overflow-y-auto pr-1">
              {cart.map(cartItem => (
                <div key={cartItem.id} className="py-3.5 flex justify-between items-start text-xs font-thai">
                  <div className="space-y-1 pr-4">
                    <span className="font-extrabold text-neutral-800 text-sm">{cartItem.name} <b className="text-amber-700">x{cartItem.qty}</b></span>
                    {cartItem.addons.length > 0 && (
                      <p className="text-[10px] text-neutral-400 font-medium">พิเศษ: {cartItem.addons.join(', ')}</p>
                    )}
                    {cartItem.note && (
                      <p className="text-[10px] text-amber-700 bg-amber-50 px-2 py-0.5 rounded-lg inline-block italic">รายละเอียด: "{cartItem.note}"</p>
                    )}
                  </div>
                  <div className="flex items-center gap-3.5">
                    <span className="font-mono font-extrabold text-neutral-800">฿{((cartItem.basePrice + cartItem.addonCost) * cartItem.qty).toLocaleString()}</span>
                    <button
                      onClick={() => handleRemoveCartItem(cartItem.id)}
                      className="text-red-500 hover:text-red-700 p-1 rounded-lg hover:bg-red-50 transition"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* TOTAL */}
            <div className="space-y-3 pt-3 border-t border-neutral-100">
              <div className="flex justify-between text-base font-extrabold font-kanit">
                <span>ราคารวมสุทธิ</span>
                <span className="text-amber-600 font-mono text-lg">฿{cartTotal.toLocaleString()}</span>
              </div>

              <button
                onClick={handlePlaceOrder}
                className="w-full bg-amber-600 hover:bg-amber-700 text-white font-bold py-3.5 rounded-xl transition text-sm flex items-center justify-center gap-2 shadow-md"
              >
                <span>ส่งรายการเข้าห้องครัวเลย ✓</span>
              </button>
            </div>

          </div>
        </div>
      )}

    </div>
  );
}

export default CustomerView;
