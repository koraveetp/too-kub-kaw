import React from 'react';
import { QrCode } from 'lucide-react';

// ---------------------------------------------------------------------------
// QR Code ประจำโต๊ะ (Owner > ตั้งค่า)
// ---------------------------------------------------------------------------
// One printable QR per table, per shift. This used to be a tab on the staff
// screen, but printing table stickers is a once-a-setup job for the owner, not
// something a server does mid-shift — so it lives in the back office next to the
// setting (`settings.tables`) that decides how many are produced.
//
// Pure presentation: it reads `settings` and writes nothing.
// ---------------------------------------------------------------------------

function TableQrCodes({ settings }) {
  // Where the codes point. `baseUrl` is set in ตั้งค่าร้าน for the case where the
  // shop is reached on a different address than the one this tab was opened on
  // (a tunnel, a LAN IP); otherwise the current address is the right answer.
  const baseUrl = settings.baseUrl || window.location.origin + window.location.pathname;
  const tables = Math.max(0, Number(settings.tables) || 0);

  return (
    <div className="bg-admin-card border rounded-2xl p-4 space-y-4 shadow-xs font-thai text-xs">
      <div>
        <h3 className="font-kanit font-extrabold text-xs text-neutral-400 uppercase tracking-wider">
          พิมพ์/บันทึก QR Code ประจำโต๊ะ
        </h3>
        <span className="text-[10px] text-neutral-400 font-medium">
          แต่ละโต๊ะมี 2 QR แยกกลางวัน/กลางคืน — สแกนอันไหนล็อกกะนั้นทันที
          (จำนวนโต๊ะปรับได้ที่ "ตั้งค่าร้าน" ด้านบน)
        </span>
      </div>

      {tables > 0 ? (
        <div className="grid grid-cols-1 gap-4">
          {Array.from({ length: tables }, (_, i) => {
            const table = i + 1;
            // Two explicit links per table: the day storefront and the night
            // bar. The customer app locks the shift from whichever it scans.
            const variants = [
              { key: 'day', label: 'กลางวัน', url: `${baseUrl}?table-day=${table}`, tone: 'bg-amber-100 text-amber-800' },
              { key: 'night', label: 'กลางคืน', url: `${baseUrl}?table-night=${table}`, tone: 'bg-indigo-100 text-indigo-800' },
            ];

            return (
              <div
                key={table}
                className="bg-admin-field border border-neutral-200 rounded-2xl p-4 max-w-xs mx-auto w-full space-y-3"
              >
                <b className="font-kanit text-neutral-800 text-sm block text-center">โต๊ะให้บริการหมายเลข {table}</b>

                <div className="grid grid-cols-2 gap-3">
                  {variants.map((v) => {
                    const src = `https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(v.url)}`;
                    return (
                      <div key={v.key} className="flex flex-col items-center space-y-1.5">
                        <span className={`text-[10px] font-extrabold px-2 py-0.5 rounded-full ${v.tone}`}>{v.label}</span>
                        <div className="w-full aspect-square bg-neutral-50 rounded-xl border flex items-center justify-center p-2 shadow-inner">
                          <img src={src} className="w-full h-full object-contain" alt={`QR โต๊ะ ${table} ${v.label}`} />
                        </div>
                        <p className="text-[9px] text-neutral-400 font-mono break-all text-center leading-tight">{v.url}</p>
                        <a
                          href={src}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-[9px] bg-neutral-100 hover:bg-neutral-200 border text-neutral-700 font-bold px-2 py-1 rounded-lg transition"
                        >
                          <QrCode className="w-3 h-3" />
                          <span>ดาวน์โหลด</span>
                        </a>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="text-center py-6 text-neutral-400 font-medium">
          ยังไม่ได้ตั้งจำนวนโต๊ะ — กรอกจำนวนโต๊ะที่ "ตั้งค่าร้าน" ก่อน
        </p>
      )}
    </div>
  );
}

export default TableQrCodes;
