import React, { useState } from 'react';
import { LogIn, User, Lock, Loader2 } from 'lucide-react';
import logoImg from '../assets/logo.jpg';

// ---------------------------------------------------------------------------
// Full-screen staff / owner login.
// ---------------------------------------------------------------------------
// This is the app's front door for everyone who is NOT a customer: a diner only
// ever reaches the menu by scanning a table QR (…?table=N), so the plain site
// URL lands here instead of on a customer view. `onLogin` returns a promise
// that resolves on success and rejects with the server's message on bad
// credentials; App decides which panel to route to from the role it gets back.
// ---------------------------------------------------------------------------
export default function LoginPage({ onLogin, settings }) {
  const [user, setUser] = useState('');
  const [pass, setPass] = useState('');
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    setError('');
    setBusy(true);
    try {
      await onLogin(user.trim(), pass, remember);
      // On success App swaps this whole screen out, so no cleanup needed here.
    } catch (err) {
      setError(err?.message || 'เข้าสู่ระบบไม่สำเร็จ');
      setBusy(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col items-center justify-center px-6 py-10 font-thai">
      <div className="w-full max-w-xs space-y-6">
        {/* Brand */}
        <div className="text-center space-y-3">
          <span className="w-20 h-20 mx-auto rounded-2xl overflow-hidden flex items-center justify-center shadow-lg ring-1 ring-black/10 bg-logo">
            <img src={logoImg} alt="โลโก้ร้าน" className="w-full h-full object-cover" />
          </span>
          <div>
            <h1 className="font-kanit font-extrabold text-xl text-ink leading-tight">
              {settings?.name || 'เข้าสู่ระบบ'}
            </h1>
            <p className="text-xs text-ink-3 mt-1">สำหรับพนักงานและเจ้าของร้านเท่านั้น</p>
          </div>
        </div>

        {/* Card */}
        <form
          onSubmit={submit}
          className="bg-admin-card rounded-2xl p-5 space-y-4 border border-neutral-100 shadow-2xl text-neutral-800"
        >
          <div>
            <label className="block font-bold text-neutral-500 text-xs mb-1">ชื่อผู้ใช้งาน</label>
            <div className="relative">
              <User className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
              <input
                type="text"
                value={user}
                onChange={(e) => setUser(e.target.value)}
                autoFocus
                autoCapitalize="none"
                autoCorrect="off"
                className="w-full border rounded-xl py-3 pl-9 pr-3 bg-admin-field focus:ring-2 focus:ring-amber-500 focus:outline-none text-sm"
                placeholder="เช่น admin"
                required
              />
            </div>
          </div>

          <div>
            <label className="block font-bold text-neutral-500 text-xs mb-1">รหัสผ่าน</label>
            <div className="relative">
              <Lock className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
              <input
                type="password"
                value={pass}
                onChange={(e) => setPass(e.target.value)}
                className="w-full border rounded-xl py-3 pl-9 pr-3 bg-admin-field focus:ring-2 focus:ring-amber-500 focus:outline-none text-sm"
                placeholder="รหัสผ่าน"
                required
              />
            </div>
          </div>

          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
              className="w-4 h-4 text-amber-600 focus:ring-amber-500 border-neutral-300 rounded"
            />
            <span className="text-[11px] font-semibold text-neutral-600">จดจำการเข้าสู่ระบบบนเครื่องนี้</span>
          </label>

          {error && (
            <div className="bg-red-50 text-red-700 text-[11px] font-semibold rounded-xl px-3 py-2 text-center">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={busy}
            className="w-full flex items-center justify-center gap-2 bg-amber-600 hover:bg-amber-700 disabled:opacity-60 font-bold py-3 rounded-xl transition text-white text-sm"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogIn className="w-4 h-4" />}
            <span>{busy ? 'กำลังเข้าสู่ระบบ...' : 'เข้าสู่ระบบ'}</span>
          </button>
        </form>

        <p className="text-[10px] text-center text-ink-3 leading-relaxed">
          ลูกค้าเข้าสั่งอาหารได้โดยการสแกน QR ที่โต๊ะเท่านั้น
        </p>
      </div>
    </div>
  );
}
