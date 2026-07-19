// ---------------------------------------------------------------------------
// Back-office colour scheme, editable from inside the app
// ---------------------------------------------------------------------------
// index.css holds the DEFAULT --c-admin-* values. This module lets the owner
// override them from the settings screen without touching any file: the chosen
// hex codes are stored in settings.adminColors and applied as inline custom
// properties on the element that carries .theme-day / .theme-night, which wins
// over the stylesheet for that subtree.
//
// Only a handful of knobs are exposed on purpose. Two of them (รายรับ/รายจ่าย)
// are really three shades each — the flat colour, a pale badge background and a
// dark ink for text on that badge. Asking anyone to keep three hex codes in
// step by hand is how a badge ends up unreadable, so the owner picks ONE colour
// and the other two are derived from it here.
// ---------------------------------------------------------------------------

// --- Colour maths -----------------------------------------------------------

function hexToRgb(hex) {
  const h = String(hex || '').replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  };
}

const toHex = (n) => Math.round(Math.min(255, Math.max(0, n))).toString(16).padStart(2, '0');
const rgbToHex = ({ r, g, b }) => `#${toHex(r)}${toHex(g)}${toHex(b)}`;

// A hex string we are willing to write into a CSS variable. Anything else is
// rejected rather than injected — these values end up in a style attribute.
export function isHex(value) {
  return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(String(value || '').trim());
}

// Relative luminance, per WCAG. Used for both the contrast check and to decide
// which direction a shade should move.
function luminance(hex) {
  const { r, g, b } = hexToRgb(hex);
  const f = (v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

// Contrast ratio between two colours, 1 (identical) to 21 (black on white).
// 4.5 is the readability floor for normal text.
export function contrast(a, b) {
  const x = luminance(a);
  const y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

// Blend toward white (amount > 0) or black (amount < 0).
function mix(hex, amount) {
  const { r, g, b } = hexToRgb(hex);
  const target = amount > 0 ? 255 : 0;
  const t = Math.abs(amount);
  return rgbToHex({
    r: r + (target - r) * t,
    g: g + (target - g) * t,
    b: b + (target - b) * t,
  });
}

// One picked colour -> the three shades the pages actually use.
//   base  the flat colour, on white cards
//   soft  a pale wash for the badge background on the dashboard tiles
//   ink   a darker version, for text sitting on `soft`
// Derived rather than picked so the badge can never end up unreadable.
export function deriveShades(base) {
  return {
    base,
    soft: mix(base, 0.85),
    ink: mix(base, -0.3),
  };
}

// --- The editable knobs -----------------------------------------------------
// `group` only drives the headings in the UI. `derived: true` marks the two
// colours that expand into three variables.
export const ADMIN_COLORS = [
  {
    key: '--c-admin-bar',
    label: 'พื้นแถบแท็บ',
    hint: 'แถบที่มี ภาพรวม / จัดการเมนู / รายจ่าย',
    group: 'แถบแท็บ',
    fallback: '#DCCFBA',
  },
  {
    key: '--c-admin-tab',
    label: 'แท็บที่กำลังเลือก',
    hint: 'ต้องต่างจากพื้นแถบพอสมควร ไม่งั้นจะดูไม่ออกว่าอยู่แท็บไหน',
    group: 'แถบแท็บ',
    fallback: '#FFFFFF',
    contrastAgainst: '--c-admin-bar',
    minContrast: 1.3,
  },
  {
    key: '--c-admin-tab-ink',
    label: 'ตัวอักษรแท็บที่เลือก',
    group: 'แถบแท็บ',
    fallback: '#4A2C17',
    contrastAgainst: '--c-admin-tab',
    minContrast: 4.5,
  },
  {
    key: '--c-admin-tab-idle',
    label: 'ตัวอักษรแท็บที่ไม่ได้เลือก',
    group: 'แถบแท็บ',
    fallback: '#5F5044',
    contrastAgainst: '--c-admin-bar',
    minContrast: 4.5,
  },
  {
    key: '--c-admin-head',
    label: 'แถบหัวข้อด้านบน',
    hint: 'กล่อง "หลังบ้านผู้บริหารระบบ"',
    group: 'แถบแท็บ',
    fallback: '#F7F3EB',
  },
  {
    key: '--c-admin-income',
    label: 'สีรายรับ',
    hint: 'ใช้ทั้งหน้าภาพรวมและหน้าสรุปยอด',
    group: 'ตัวเลขการเงิน',
    fallback: '#15803D',
    derived: true,
    contrastAgainst: '#FFFFFF',
    minContrast: 4.5,
  },
  {
    key: '--c-admin-expense',
    label: 'สีรายจ่าย',
    hint: 'ใช้ทั้งหน้าภาพรวมและหน้าสรุปยอด',
    group: 'ตัวเลขการเงิน',
    fallback: '#DC2626',
    derived: true,
    contrastAgainst: '#FFFFFF',
    minContrast: 4.5,
  },
];

export const ADMIN_GROUPS = ['แถบแท็บ', 'ตัวเลขการเงิน'];

// The value in force for one knob: the owner's override, else the built-in.
export function colorValue(colors, item) {
  const chosen = colors?.[item.key];
  return isHex(chosen) ? chosen : item.fallback;
}

// settings.adminColors -> the style object React puts on the theme wrapper.
// Unknown keys and malformed values are dropped: this object becomes a style
// attribute, so only vetted hex codes for known variables get through.
export function paletteStyle(colors) {
  const style = {};
  if (!colors || typeof colors !== 'object') return style;

  for (const item of ADMIN_COLORS) {
    const value = colors[item.key];
    if (!isHex(value)) continue;
    if (item.derived) {
      const { base, soft, ink } = deriveShades(value);
      style[item.key] = base;
      style[`${item.key}-soft`] = soft;
      style[`${item.key}-ink`] = ink;
    } else {
      style[item.key] = value;
    }
  }
  return style;
}

// Whether a chosen colour is legible where it is used. Returns null when the
// knob has no readability requirement, otherwise { ratio, ok, against }.
export function readability(colors, item) {
  if (!item.contrastAgainst) return null;
  const value = colorValue(colors, item);
  const against = item.contrastAgainst.startsWith('#')
    ? item.contrastAgainst
    : colorValue(colors, ADMIN_COLORS.find((c) => c.key === item.contrastAgainst));
  const ratio = contrast(value, against);
  return { ratio, ok: ratio >= item.minContrast, against };
}
