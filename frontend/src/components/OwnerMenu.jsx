import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Plus, Trash2, Search, ImageUp, X, Loader2, Pencil, Sun, Moon } from 'lucide-react';
import {
  fetchMenuOptions,
  uploadMenuImage,
  createMenuItem,
  fetchMenuItem,
  updateMenuItem,
  createStockItem,
  setMenuTheme,
  resolveImageUrl,
} from '../api';
import { shrinkImage } from '../image';

// ---------------------------------------------------------------------------
// Owner > จัดการเมนู
// ---------------------------------------------------------------------------
// Two jobs: flip a dish on/off sale, and add a new one.
//
// Neither writes to the shared `menu` state. The menu's source of truth is the
// PostgreSQL table, which the backend re-reads on a timer — anything written
// into state.menu from here would simply be overwritten on the next sync. So
// both actions call an endpoint that changes the DATABASE, and the updated menu
// comes back to every open tab over the existing SSE stream. That is also why
// there is no local copy of the list here: `menu` arrives as a prop and is
// already live.
// ---------------------------------------------------------------------------

const THEMES = [
  { id: 'day', label: 'เมนูกลางวัน' },
  { id: 'night', label: 'เมนูกลางคืน' },
];
const FORM_THEMES = [
  { id: 'day', label: 'กลางวัน' },
  { id: 'night', label: 'กลางคืน' },
  { id: 'both', label: 'ทั้งสอง' },
];

// The list no longer splits by shift — every dish is shown together and each one
// carries its own sun/moon pill. These two map between the single `theme` column
// ('day' | 'night' | 'both' | 'none') and the pair of on/off shift toggles.
function shiftsFromTheme(theme) {
  return {
    day: theme === 'day' || theme === 'both',
    night: theme === 'night' || theme === 'both',
  };
}
function themeFromShifts(day, night) {
  if (day && night) return 'both';
  if (day) return 'day';
  if (night) return 'night';
  return 'none'; // shown in no storefront
}

const EMPTY_FORM = {
  category: '',
  type: 'เมนูหลัก',
  subcategory: '',
  name: '',
  price: '',
  quantity: '',
  imageUrl: '',
};

// A <select> of the values already in the database, plus a "พิมพ์เอง…" escape
// hatch — the owner has to be able to create a genuinely new category without
// waiting for a code change, but picking an existing one should not require
// retyping it exactly (a typo would silently create a near-duplicate heading).
function ComboBox({ label, value, options, onChange, placeholder, required }) {
  const [typing, setTyping] = useState(false);
  const isCustom = typing || (value && !options.includes(value));

  return (
    <div>
      <label className="block font-bold text-neutral-500 mb-1">{label}</label>
      {isCustom ? (
        <div className="flex gap-1.5">
          <input
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            required={required}
            autoFocus
            className="flex-1 border rounded-xl p-2.5 bg-admin-field focus:outline-none focus:ring-1 focus:ring-amber-500 font-bold"
          />
          {options.length > 0 && (
            <button
              type="button"
              onClick={() => { setTyping(false); onChange(''); }}
              className="px-3 rounded-xl border text-neutral-500 hover:bg-neutral-50 transition"
              title="เลือกจากรายการเดิม"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      ) : (
        <select
          value={value}
          onChange={(e) => {
            if (e.target.value === '__custom__') {
              setTyping(true);
              onChange('');
            } else {
              onChange(e.target.value);
            }
          }}
          required={required}
          className="w-full border rounded-xl p-2.5 bg-admin-field focus:outline-none focus:ring-1 focus:ring-amber-500 font-bold"
        >
          <option value="">— เลือก —</option>
          {options.map((o) => (
            <option key={o} value={o}>{o}</option>
          ))}
          <option value="__custom__">+ พิมพ์ค่าใหม่เอง…</option>
        </select>
      )}
    </div>
  );
}

function OwnerMenu({ menu, showToast }) {
  const [search, setSearch] = useState('');
  const [heading, setHeading] = useState('all');
  // Dish ids with a toggle request in flight, so a double tap can't send two
  // conflicting writes.
  const [pending, setPending] = useState(() => new Set());

  const [showForm, setShowForm] = useState(false);
  // 'menu' = add a dish only. 'stock' = add the dish AND file it in คลังวัตถุดิบ.
  // Both use the exact same form; stock mode just reveals a quantity field and
  // writes an inventory row on submit.
  const [formMode, setFormMode] = useState('menu');
  // The dish id currently being edited, or null when adding a new one. When set,
  // the same form saves over an existing dish instead of creating one.
  const [editingId, setEditingId] = useState(null);
  // Dish whose editable copy is being fetched, so its pencil shows a spinner.
  const [loadingEditId, setLoadingEditId] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [formTheme, setFormTheme] = useState('day');
  const [variants, setVariants] = useState([]);
  const [options, setOptions] = useState({ categories: [], types: [], subcategories: [] });
  const [imagePreview, setImagePreview] = useState('');
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef(null);

  // Dropdown values come from the database, so a heading added straight in
  // pgAdmin is offered here too. Fetched when the form opens rather than on
  // mount, so simply viewing the list costs nothing.
  //
  // showToast is deliberately not a dependency: App re-creates it on every
  // render, and every SSE push re-renders App — including it would re-fetch the
  // options on each one for as long as the form stayed open.
  useEffect(() => {
    if (!showForm) return;
    fetchMenuOptions()
      .then(setOptions)
      .catch((err) => showToast(`โหลดตัวเลือกไม่สำเร็จ: ${err.message}`));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showForm]);

  // One combined list — day and night dishes together. Visibility per shift is
  // controlled by each row's sun/moon pill, not by a page-level shift switch.
  const allMenu = useMemo(() => menu || [], [menu]);

  const headings = useMemo(
    () => [...new Set(allMenu.map((m) => m.category).filter(Boolean))].sort(
      (a, b) => a.localeCompare(b, 'th')
    ),
    [allMenu]
  );

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allMenu.filter(
      (m) =>
        (heading === 'all' || m.category === heading) &&
        (!q || m.name.toLowerCase().includes(q))
    );
  }, [allMenu, heading, search]);

  // "Hidden" = shown in no shift (theme 'none').
  const hiddenCount = allMenu.filter((m) => (m.theme || 'day') === 'none').length;

  // --- Shift visibility (sun/moon pill) -------------------------------------
  // Toggle one shift (day or night) for a dish. The other shift is left as-is,
  // and the two booleans collapse back into the single `theme` value the backend
  // stores. Turning both off hides the dish everywhere ('none').
  const handleToggleShift = async (dish, which) => {
    if (pending.has(dish.id)) return;
    const cur = shiftsFromTheme(dish.theme || 'day');
    const next = { ...cur, [which]: !cur[which] };
    const nextTheme = themeFromShifts(next.day, next.night);

    setPending((prev) => new Set(prev).add(dish.id));
    try {
      await setMenuTheme(dish.id, nextTheme);
      // No local state update: the backend re-syncs from the database and pushes
      // the new menu over SSE, which lands in every tab at once.
      const where =
        nextTheme === 'both' ? 'กลางวัน + กลางคืน'
          : nextTheme === 'day' ? 'กลางวัน'
            : nextTheme === 'night' ? 'กลางคืน'
              : null;
      showToast(
        where
          ? `[${dish.name}] แสดงช่วง ${where}`
          : `ซ่อน [${dish.name}] แล้ว (ไม่แสดงทั้งกลางวันและกลางคืน)`
      );
    } catch (err) {
      showToast(`เปลี่ยนไม่สำเร็จ: ${err.message}`);
    } finally {
      setPending((prev) => {
        const n = new Set(prev);
        n.delete(dish.id);
        return n;
      });
    }
  };

  // --- New dish form --------------------------------------------------------
  const resetForm = () => {
    setForm(EMPTY_FORM);
    setVariants([]);
    setImagePreview('');
    setEditingId(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // Open the form pre-filled with an existing dish. The editable copy — which
  // includes หมวดหมู่/ประเภท the app-facing menu drops — is fetched from the
  // backend rather than read off the menu prop, so what is saved back is exactly
  // what is in the database.
  const startEdit = async (dish) => {
    if (loadingEditId) return;
    setLoadingEditId(dish.id);
    try {
      const spec = await fetchMenuItem(dish.id);
      setForm({
        category: spec.category || '',
        type: spec.type || 'เมนูหลัก',
        subcategory: spec.subcategory || '',
        name: spec.name || '',
        price: spec.price != null ? String(spec.price) : '',
        quantity: '',
        imageUrl: spec.imageUrl || '',
      });
      setVariants((spec.variants || []).map((v) => ({ meat: v.meat, price: String(v.price) })));
      setFormTheme(spec.theme || 'day');
      setImagePreview('');
      setEditingId(dish.id);
      setFormMode('menu');
      setShowForm(true);
      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch (err) {
      showToast(`โหลดเมนูไม่สำเร็จ: ${err.message}`);
    } finally {
      setLoadingEditId(null);
    }
  };

  const handlePickImage = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      // Shrink first: a 5 MB phone photo becomes ~200 KB, which is both under
      // the server's cap and quick to send over mobile data.
      const small = await shrinkImage(file);
      const { url } = await uploadMenuImage(small);
      setForm((f) => ({ ...f, imageUrl: url }));
      setImagePreview(URL.createObjectURL(small));
      showToast('อัปโหลดรูปภาพเรียบร้อย');
    } catch (err) {
      showToast(`อัปโหลดรูปไม่สำเร็จ: ${err.message}`);
      if (fileInputRef.current) fileInputRef.current.value = '';
    } finally {
      setUploading(false);
    }
  };

  const handleClearImage = () => {
    setForm((f) => ({ ...f, imageUrl: '' }));
    setImagePreview('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const updateVariant = (index, patch) =>
    setVariants((prev) => prev.map((v, i) => (i === index ? { ...v, ...patch } : v)));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (saving) return;

    if (!form.name.trim()) return showToast('กรุณากรอกชื่อรายการ');
    if (!form.category.trim()) return showToast('กรุณาเลือกหมวดหมู่');

    // With no protein choices the dish's own price is what is charged; with
    // choices, each option carries its own and the dish price is derived.
    const filled = variants.filter((v) => v.meat.trim());
    if (!filled.length) {
      const price = Number(form.price);
      if (!Number.isFinite(price) || price < 0) {
        return showToast('กรุณากรอกราคาเป็นตัวเลขตั้งแต่ 0 ขึ้นไป');
      }
    } else if (filled.some((v) => !Number.isFinite(Number(v.price)) || Number(v.price) < 0)) {
      return showToast('กรุณากรอกราคาของทุกตัวเลือกให้ถูกต้อง');
    }

    // Stock mode also needs a starting quantity for the inventory row.
    let quantity = 0;
    if (formMode === 'stock') {
      quantity = Number(form.quantity);
      if (!Number.isInteger(quantity) || quantity < 0) {
        return showToast('กรุณากรอกจำนวนในคลังเป็นจำนวนเต็มตั้งแต่ 0 ขึ้นไป');
      }
    }

    setSaving(true);
    const payload = {
      category: form.category.trim(),
      type: form.type.trim() || 'เมนูหลัก',
      subcategory: form.subcategory.trim(),
      name: form.name.trim(),
      theme: formTheme,
      imageUrl: form.imageUrl,
      variants: filled.length
        ? filled.map((v) => ({ meat: v.meat.trim(), price: Number(v.price) }))
        : [{ meat: '-', price: Number(form.price) }],
    };
    try {
      if (editingId) {
        // Editing an existing dish: overwrite its rows. No stock side-effect —
        // that only makes sense when a dish is first created.
        await updateMenuItem(editingId, payload);
        showToast(`แก้ไขเมนู [${form.name.trim()}] เรียบร้อย`);
      } else {
        await createMenuItem(payload);

        // In stock mode, file the same item in คลังวัตถุดิบ. Keep the menu success
        // even if the stock write fails — just tell the owner about it.
        let stockMsg = ' เรียบร้อย';
        if (formMode === 'stock') {
          try {
            const item = await createStockItem({
              category: form.category.trim(),
              name: form.name.trim(),
              quantity,
              imageUrl: form.imageUrl,
            });
            stockMsg = ` และบันทึกลงคลังแล้ว (คงเหลือ ${item.quantity})`;
          } catch (stockErr) {
            stockMsg = ` แต่บันทึกลงคลังไม่สำเร็จ: ${stockErr.message}`;
          }
        }
        showToast(`เพิ่มเมนู [${form.name.trim()}]${stockMsg}`);
      }

      resetForm();
      setShowForm(false);
      setHeading('all');
    } catch (err) {
      showToast(`${editingId ? 'แก้ไข' : 'เพิ่ม'}เมนูไม่สำเร็จ: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">

      {/* ADD BUTTONS */}
      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={() => { resetForm(); setShowForm(true); setFormMode('menu'); setFormTheme('day'); }}
          className="bg-admin-cta hover:bg-admin-cta-hover text-admin-cta-ink font-bold py-3 rounded-2xl transition font-kanit flex items-center justify-center gap-2 text-xs"
        >
          <Plus className="w-4 h-4" />
          เพิ่มเมนูใหม่
        </button>
        <button
          onClick={() => { resetForm(); setShowForm(true); setFormMode('stock'); setFormTheme('day'); }}
          className="bg-ctl hover:bg-ctl-hover text-ctl-ink font-bold py-3 rounded-2xl transition font-kanit flex items-center justify-center gap-2 text-xs"
        >
          <Plus className="w-4 h-4" />
          อัพเดทสตอก
        </button>
      </div>

      {/* FORM — as a pop-up, so editing a dish deep in the list no longer jumps
          the whole page to the top. Bottom-sheet on phones, centred card on
          wider screens. Tapping the dim backdrop closes it. */}
      {showForm && (
        <div
          className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4"
          onClick={() => { setShowForm(false); resetForm(); }}
        >
          <form
            onSubmit={handleSubmit}
            onClick={(e) => e.stopPropagation()}
            className="bg-admin-panel w-full max-w-md rounded-t-3xl sm:rounded-3xl p-4 space-y-3 text-xs font-thai max-h-[90vh] overflow-y-auto shadow-2xl"
          >
          <div className="flex justify-between items-baseline">
            <h3 className="font-extrabold text-base font-kanit text-neutral-800">{editingId ? 'แก้ไขเมนู' : formMode === 'stock' ? 'อัพเดทสตอก' : 'เพิ่มเมนูใหม่'}</h3>
            <button
              type="button"
              onClick={() => { setShowForm(false); resetForm(); }}
              className="text-[10px] text-neutral-500 font-bold hover:text-neutral-700"
            >
              ยกเลิก
            </button>
          </div>

          {/* SHIFT */}
          <div>
            <label className="block font-bold text-neutral-500 mb-1">กะที่ขาย</label>
            <div className="flex gap-1.5 bg-admin-card border rounded-xl p-1">
              {(formMode === 'menu' ? FORM_THEMES : THEMES).map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setFormTheme(t.id)}
                  className={`flex-1 py-2 rounded-lg font-bold transition ${t.id === formTheme ? 'bg-ctl text-ctl-ink' : 'text-neutral-500'}`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          <ComboBox
            label="หมวดหมู่"
            value={form.category}
            options={options.categories}
            onChange={(v) => setForm((f) => ({ ...f, category: v }))}
            placeholder="เช่น อาหาร, เครื่องดื่ม"
            required
          />

          <div className="grid grid-cols-2 gap-2">
            <ComboBox
              label="ประเภท"
              value={form.type}
              options={options.types}
              onChange={(v) => setForm((f) => ({ ...f, type: v }))}
              placeholder="เช่น เมนูหลัก"
            />
            <ComboBox
              label="หัวข้อ"
              value={form.subcategory}
              options={options.subcategories}
              onChange={(v) => setForm((f) => ({ ...f, subcategory: v }))}
              placeholder="เช่น เมนูราดข้าว"
            />
          </div>

          <div>
            <label className="block font-bold text-neutral-500 mb-1">ชื่อรายการ</label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="เช่น ทอดน้ำปลาราดข้าว"
              required
              className="w-full border rounded-xl p-2.5 bg-admin-field focus:outline-none focus:ring-1 focus:ring-amber-500 font-bold"
            />
          </div>

          {/* PRICE — only when the dish has no protein choices to price */}
          {variants.length === 0 && (
            <div>
              <label className="block font-bold text-neutral-500 mb-1">ราคา (บาท)</label>
              <input
                type="number"
                min="0"
                step="1"
                value={form.price}
                onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))}
                placeholder="กรอกตัวเลข ฿"
                required
                className="w-full border rounded-xl p-2.5 bg-admin-field focus:outline-none focus:ring-1 focus:ring-amber-500 font-mono font-bold"
              />
            </div>
          )}

          {/* STOCK QUANTITY — only in อัพเดทสตอก mode */}
          {formMode === 'stock' && (
            <div>
              <label className="block font-bold text-neutral-500 mb-1">จำนวนในคลัง (เริ่มต้น)</label>
              <input
                type="number"
                min="0"
                step="1"
                value={form.quantity}
                onChange={(e) => setForm((f) => ({ ...f, quantity: e.target.value }))}
                placeholder="เช่น 50"
                required
                className="w-full border rounded-xl p-2.5 bg-admin-field focus:outline-none focus:ring-1 focus:ring-amber-500 font-mono font-bold"
              />
              <p className="text-[10px] text-neutral-400 font-medium mt-1">
                จะบันทึกลงคลังวัตถุดิบด้วย ชื่อตรงกับเมนูเพื่อให้หน้าลูกค้าซ่อนอัตโนมัติเมื่อของหมด
              </p>
            </div>
          )}

          {/* PROTEIN OPTIONS */}
          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <label className="font-bold text-neutral-500">ตัวเลือกเนื้อสัตว์</label>
              <button
                type="button"
                onClick={() => setVariants((v) => [...v, { meat: '', price: form.price || '' }])}
                className="text-[10px] font-extrabold text-amber-700 hover:text-amber-900"
              >
                + เพิ่มตัวเลือก
              </button>
            </div>

            {variants.length === 0 ? (
              <p className="text-[10px] text-neutral-400 font-medium">
                ไม่มีตัวเลือก = ขายราคาเดียว (เช่น ข้าวสวย)
              </p>
            ) : (
              <>
                {variants.map((v, i) => (
                  <div key={i} className="flex gap-1.5">
                    <input
                      type="text"
                      value={v.meat}
                      onChange={(e) => updateVariant(i, { meat: e.target.value })}
                      placeholder="เช่น หมู, ไก่, ทะเล"
                      className="flex-1 border rounded-xl p-2.5 bg-admin-field focus:outline-none focus:ring-1 focus:ring-amber-500 font-bold"
                    />
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={v.price}
                      onChange={(e) => updateVariant(i, { price: e.target.value })}
                      placeholder="฿"
                      className="w-20 border rounded-xl p-2.5 bg-admin-field focus:outline-none focus:ring-1 focus:ring-amber-500 font-mono font-bold"
                    />
                    <button
                      type="button"
                      onClick={() => setVariants((prev) => prev.filter((_, idx) => idx !== i))}
                      className="px-2.5 text-red-400 hover:text-red-600 hover:bg-red-500/10 rounded-xl transition"
                      title="ลบตัวเลือก"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
                <p className="text-[10px] text-neutral-400 font-medium">
                  ต้องมีอย่างน้อย 2 ตัวเลือก ลูกค้าจึงจะเห็นเป็นตัวเลือกให้กด
                </p>
              </>
            )}
          </div>

          {/* IMAGE */}
          <div>
            <label className="block font-bold text-neutral-500 mb-1">รูปภาพ</label>
            {form.imageUrl ? (
              <div className="flex items-center gap-3 bg-admin-card border rounded-xl p-2.5">
                <img
                  src={imagePreview || resolveImageUrl(form.imageUrl)}
                  alt=""
                  className="w-16 h-16 rounded-xl object-cover flex-shrink-0"
                />
                <div className="flex-1 min-w-0">
                  <span className="block font-bold text-neutral-700">อัปโหลดแล้ว</span>
                  <span className="block text-[10px] text-neutral-400 font-mono truncate">
                    {form.imageUrl}
                  </span>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    aria-label="เปลี่ยนรูป"
                    title="เปลี่ยนรูป"
                    className="p-2 rounded-lg text-amber-700 hover:bg-amber-500/10 transition"
                  >
                    <Pencil className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={handleClearImage}
                    aria-label="ลบรูป"
                    title="ลบรูป"
                    className="p-2 rounded-lg text-red-500 hover:bg-red-500/10 transition"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="w-full border border-dashed border-neutral-300 rounded-xl p-4 bg-admin-card text-neutral-500 font-bold flex items-center justify-center gap-2 hover:border-amber-400 hover:text-amber-700 transition disabled:opacity-50"
              >
                {uploading ? (
                  <><Loader2 className="w-4 h-4 animate-spin" /> กำลังอัปโหลด…</>
                ) : (
                  <><ImageUp className="w-4 h-4" /> เลือกรูป หรือถ่ายภาพ</>
                )}
              </button>
            )}
            {/* accept="image/*" lets a phone offer its camera as well as the
                photo library. The file is downscaled before it is sent. */}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handlePickImage}
              className="hidden"
            />
          </div>

          <button
            type="submit"
            disabled={saving || uploading}
            className="w-full bg-admin-cta hover:bg-admin-cta-hover text-admin-cta-ink font-bold py-3 rounded-2xl transition font-kanit disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            {saving ? 'กำลังบันทึก…' : editingId ? 'บันทึกการแก้ไข' : (formMode === 'stock' ? 'บันทึกเมนู + คลัง' : 'บันทึกเมนูใหม่')}
          </button>
          </form>
        </div>
      )}

      {/* FILTERS */}
      <div className="space-y-2">
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="ค้นหาชื่อเมนู"
            className="w-full border rounded-xl py-2.5 pl-9 pr-3 bg-admin-field text-xs focus:outline-none focus:ring-1 focus:ring-amber-500 font-bold"
          />
        </div>

        <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-none">
          {['all', ...headings].map((h) => (
            <button
              key={h}
              onClick={() => setHeading(h)}
              className={`px-3 py-1 rounded-full text-[11px] font-bold whitespace-nowrap transition border ${h === heading ? 'bg-ctl border-ctl text-ctl-ink' : 'bg-neutral-100 border-neutral-200 text-neutral-500'}`}
            >
              {h === 'all' ? 'ทั้งหมด' : h}
            </button>
          ))}
        </div>
      </div>

      {/* LIST */}
      <div className="flex justify-between items-center pl-1 text-[10px] font-bold text-neutral-400">
        <span>{visible.length} รายการ</span>
        {hiddenCount > 0 && <span className="text-red-500">ซ่อนอยู่ {hiddenCount} รายการ</span>}
      </div>

      <div className="bg-admin-card border rounded-2xl overflow-hidden shadow-xs divide-y divide-neutral-100">
        {visible.length > 0 ? (
          visible.map((dish) => {
            const busy = pending.has(dish.id);
            const shifts = shiftsFromTheme(dish.theme || 'day');
            return (
              <div key={dish.id} className="flex items-center gap-2.5 px-3 py-2.5 font-thai">
                <div className="w-11 h-11 rounded-xl bg-neutral-100 flex items-center justify-center text-xl overflow-hidden flex-shrink-0">
                  {dish.image
                    ? <img src={resolveImageUrl(dish.image)} alt="" loading="lazy" className="w-full h-full object-cover" />
                    : <span>{dish.emoji || '🍽️'}</span>}
                </div>

                <div className="flex-1 min-w-0">
                  {/* Name always shown normally — the empty sun/moon pill is the
                      only "hidden" cue, matching the design mock. */}
                  <span className="block font-bold text-xs truncate text-neutral-800">
                    {dish.name}
                  </span>
                  <span className="block text-[10px] text-neutral-400 font-medium truncate">
                    {dish.category}
                    {dish.options?.length > 0 && ` • ${dish.options.length} ตัวเลือก`}
                    {' • '}
                    <span className="font-mono">฿{dish.price}</span>
                  </span>
                </div>

                {/* SHIFT PILL — sun = show by day, moon = show by night. Neither lit
                    = hidden everywhere. Each segment toggles independently. */}
                <div className={`inline-flex rounded-full border-2 border-wood-dark overflow-hidden flex-shrink-0 ${busy ? 'opacity-50' : ''}`}>
                  <button
                    onClick={() => handleToggleShift(dish, 'day')}
                    disabled={busy}
                    aria-pressed={shifts.day}
                    aria-label={`${shifts.day ? 'ปิด' : 'เปิด'}การแสดงตอนกลางวัน ${dish.name}`}
                    title={shifts.day ? 'แสดงตอนกลางวัน (กดเพื่อปิด)' : 'ไม่แสดงตอนกลางวัน (กดเพื่อเปิด)'}
                    className={`px-3 py-1.5 transition ${shifts.day ? 'bg-wood text-white' : 'text-wood-dark hover:bg-wood/10'}`}
                  >
                    <Sun className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleToggleShift(dish, 'night')}
                    disabled={busy}
                    aria-pressed={shifts.night}
                    aria-label={`${shifts.night ? 'ปิด' : 'เปิด'}การแสดงตอนกลางคืน ${dish.name}`}
                    title={shifts.night ? 'แสดงตอนกลางคืน (กดเพื่อปิด)' : 'ไม่แสดงตอนกลางคืน (กดเพื่อเปิด)'}
                    className={`px-3 py-1.5 border-l-2 border-wood-dark transition ${shifts.night ? 'bg-wood text-white' : 'text-wood-dark hover:bg-wood/10'}`}
                  >
                    <Moon className="w-4 h-4" />
                  </button>
                </div>

                {/* EDIT (pencil) */}
                <button
                  onClick={() => startEdit(dish)}
                  disabled={loadingEditId === dish.id}
                  aria-label={`แก้ไข ${dish.name}`}
                  title="แก้ไขเมนู (ชื่อ ราคา ฯลฯ)"
                  className="w-9 h-9 rounded-full border-2 border-wood-dark flex items-center justify-center text-wood-dark hover:bg-wood/10 transition disabled:opacity-50 flex-shrink-0"
                >
                  {loadingEditId === dish.id
                    ? <Loader2 className="w-4 h-4 animate-spin" />
                    : <Pencil className="w-4 h-4" />}
                </button>
              </div>
            );
          })
        ) : (
          <p className="text-neutral-400 text-xs py-6 text-center font-medium">
            ไม่พบเมนูที่ตรงกับเงื่อนไข
          </p>
        )}
      </div>
    </div>
  );
}

export default OwnerMenu;
