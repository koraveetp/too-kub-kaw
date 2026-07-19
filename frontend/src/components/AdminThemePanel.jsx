import React from 'react';
import { RotateCcw, AlertTriangle, Palette } from 'lucide-react';
import {
  ADMIN_COLORS,
  ADMIN_GROUPS,
  colorValue,
  readability,
  deriveShades,
  isHex,
} from '../admin-theme';

// ---------------------------------------------------------------------------
// Owner > ตั้งค่า > ปรับสีหน้าหลังบ้าน
// ---------------------------------------------------------------------------
// Colour pickers for the back-office palette. Every change is written straight
// into settings.adminColors, which App applies as inline CSS variables — so the
// screen recolours as the picker moves, and (because settings is a shared
// resource) every other open tab follows over SSE.
//
// Each row also shows the contrast ratio against whatever the colour sits on,
// and says so when a pick drops below the readable threshold. That guard is
// here because this palette has already produced two invisible-text bugs: a
// white tab on a near-white bar, and dark text on a dark background.
// ---------------------------------------------------------------------------

function ColorRow({ item, colors, onChange }) {
  const value = colorValue(colors, item);
  const check = readability(colors, item);
  const isOverridden = isHex(colors?.[item.key]);

  return (
    <div className="py-2.5 border-b border-neutral-100 last:border-0">
      <div className="flex items-center gap-2.5">
        {/* The swatch IS the picker: the native input is stretched over it so
            the whole square is the click target on a phone. */}
        <span className="relative w-9 h-9 rounded-xl border border-neutral-200 overflow-hidden flex-shrink-0 shadow-sm">
          <span className="absolute inset-0" style={{ backgroundColor: value }} />
          <input
            type="color"
            value={value}
            onChange={(e) => onChange(item.key, e.target.value)}
            aria-label={item.label}
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
          />
        </span>

        <div className="flex-1 min-w-0">
          <span className="block font-bold text-neutral-800 text-xs">{item.label}</span>
          {item.hint && (
            <span className="block text-[10px] text-neutral-500 leading-tight">{item.hint}</span>
          )}
        </div>

        <input
          type="text"
          value={value.toUpperCase()}
          onChange={(e) => {
            const next = e.target.value.trim();
            if (isHex(next)) onChange(item.key, next);
          }}
          spellCheck={false}
          className="w-[74px] border rounded-lg px-1.5 py-1 font-mono text-[10px] text-neutral-700 text-center focus:outline-none focus:ring-1 focus:ring-amber-500"
        />

        {isOverridden && (
          <button
            type="button"
            onClick={() => onChange(item.key, null)}
            title="กลับไปใช้สีเดิม"
            className="p-1 text-neutral-400 hover:text-neutral-700 transition"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* The two money colours expand into three shades; show them so it is
          clear what the one pick actually produced. */}
      {item.derived && (
        <div className="flex items-center gap-1.5 mt-1.5 ml-11">
          {Object.entries(deriveShades(value)).map(([name, shade]) => (
            <span key={name} className="flex items-center gap-1">
              <span
                className="w-3.5 h-3.5 rounded border border-neutral-200"
                style={{ backgroundColor: shade }}
              />
              <span className="text-[9px] text-neutral-400 font-mono">{name}</span>
            </span>
          ))}
          <span className="text-[9px] text-neutral-400">← สร้างให้อัตโนมัติ</span>
        </div>
      )}

      {check && !check.ok && (
        <p className="flex items-start gap-1 mt-1.5 ml-11 text-[10px] text-amber-700 font-medium leading-tight">
          <AlertTriangle className="w-3 h-3 mt-px flex-shrink-0" />
          <span>
            สีนี้ตัดกับพื้นหลังแค่ {check.ratio.toFixed(1)} เท่า (ควรอย่างน้อย{' '}
            {item.minContrast}) อาจมองไม่เห็นหรืออ่านยาก
          </span>
        </p>
      )}
    </div>
  );
}

function AdminThemePanel({ colors, onChange, onReset }) {
  const hasOverrides = ADMIN_COLORS.some((item) => isHex(colors?.[item.key]));

  return (
    <div className="surface-light bg-white border rounded-2xl p-4 space-y-3 shadow-sm font-thai text-xs">
      <div className="flex justify-between items-center">
        <h3 className="font-kanit font-extrabold text-xs text-neutral-400 uppercase tracking-wider flex items-center gap-1.5">
          <Palette className="w-3.5 h-3.5" />
          ปรับสีหน้าหลังบ้าน
        </h3>
        {hasOverrides && (
          <button
            type="button"
            onClick={onReset}
            className="text-[10px] font-bold text-neutral-500 hover:text-neutral-800 flex items-center gap-1 transition"
          >
            <RotateCcw className="w-3 h-3" />
            คืนค่าสีเดิมทั้งหมด
          </button>
        )}
      </div>

      <p className="text-[10px] text-neutral-500 leading-relaxed">
        กดที่ช่องสีเพื่อเลือกสีใหม่ หน้าจอจะเปลี่ยนให้เห็นทันที
        และบันทึกอัตโนมัติไปยังทุกเครื่องที่เปิดอยู่
      </p>

      {ADMIN_GROUPS.map((group) => (
        <div key={group}>
          <span className="block text-[10px] font-extrabold text-neutral-400 mt-1 mb-0.5">
            {group}
          </span>
          <div>
            {ADMIN_COLORS.filter((item) => item.group === group).map((item) => (
              <ColorRow key={item.key} item={item} colors={colors} onChange={onChange} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export default AdminThemePanel;
