import React, { useMemo, useState } from 'react';
import { ChefHat, Check, Scissors, Plus, X } from 'lucide-react';
import { kitchenBoard } from '../kitchen';
import { deriveBillStatus, ITEM_STATUS_LABELS, ITEM_STATUS_COLORS } from '../orders';

// ---------------------------------------------------------------------------
// Kitchen board — Batch ordering
// ---------------------------------------------------------------------------
// Renders the shared `orders` as grouped batch cards (see ../kitchen.js for the
// batching rules). The board is a pure view of orders: the only things written
// back are each line's `status` and, once a cook starts a batch, a shared
// `batchId` that freezes the group. Every write goes through setOrders, so the
// order-taking tab and customer screens update over SSE at the same instant.
//
// A dish leaves the board the moment it is marked "เสร็จแล้ว" (completed);
// delivery/serving (and its stock deduction) is handled on the order board.
// ---------------------------------------------------------------------------

const CLOSED = new Set(['paid', 'cancelled']);
const newBatchId = () => 'b' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

function KitchenBoard({ orders, setOrders, menu, showToast, shiftView }) {
  // Which card's tool tray (✂️ / ➕) is open, keyed by batch id.
  const [toolOpen, setToolOpen] = useState(null);

  const cards = useMemo(
    () => kitchenBoard(orders || [], { menu, shift: shiftView }),
    [orders, menu, shiftView]
  );

  // Lines still waiting in the kitchen (unlocked), grouped for the ➕ picker.
  const inKitchenByName = useMemo(() => {
    const map = new Map();
    cards.filter(c => c.status === 'in_kitchen').forEach(c => {
      c.members.forEach(m => {
        if (!map.has(m.name)) map.set(m.name, []);
        map.get(m.name).push(m);
      });
    });
    return map;
  }, [cards]);

  // Apply a patch to every line whose uid is in `uids`, then re-derive each
  // touched bill's status. `patch` may be an object or (item) => partial.
  const patchUids = (uids, patch) => {
    const set = uids instanceof Set ? uids : new Set(uids);
    setOrders(prev => prev.map(o => {
      if (CLOSED.has(o.status)) return o;
      let changed = false;
      const items = o.items.map(it => {
        if (!set.has(it.uid)) return it;
        changed = true;
        return { ...it, ...(typeof patch === 'function' ? patch(it) : patch) };
      });
      if (!changed) return o;
      return { ...o, items, status: deriveBillStatus(items) };
    }));
  };

  const memberUids = (batch) => batch.members.map(m => m.uid);

  // in_kitchen -> in_progress: lock the whole batch under one fresh batchId so no
  // new order can auto-join it while it cooks.
  const startBatch = (batch) => {
    patchUids(memberUids(batch), { status: 'in_progress', batchId: newBatchId() });
    showToast(`เริ่มทำ ${batch.name} · ${batch.totalQty} จาน`);
  };

  const completeBatch = (batch) => {
    patchUids(memberUids(batch), { status: 'completed' });
    showToast(`${batch.name} เสร็จแล้ว`);
  };

  // ✂️ pull one line out of a locked batch → its own solo batch (keeps cooking).
  const splitMember = (member) => {
    patchUids([member.uid], { batchId: newBatchId() });
    setToolOpen(null);
    showToast(`แยก ${member.name} (โต๊ะ ${member.table}) ออกจากกลุ่มแล้ว`);
  };

  // ➕ pull a waiting (in_kitchen) line of the same dish into this cooking batch.
  const addToBatch = (batch, member) => {
    patchUids([member.uid], { status: 'in_progress', batchId: batch.id });
    setToolOpen(null);
    showToast(`เพิ่ม ${member.name} (โต๊ะ ${member.table}) เข้ากลุ่มกำลังทำแล้ว`);
  };

  if (cards.length === 0) {
    return (
      <div className="text-center py-16 text-neutral-400">
        <ChefHat className="w-10 h-10 mx-auto mb-3 opacity-40" />
        <p className="text-sm font-bold font-thai">ยังไม่มีรายการอาหารในครัว</p>
        <p className="text-[11px] font-medium mt-1">ออเดอร์อาหารจะเข้ามาที่นี่โดยอัตโนมัติ (ไม่รวมเครื่องดื่ม)</p>
      </div>
    );
  }

  return (
    <div className="space-y-2.5 font-thai">
      {cards.map((batch) => {
        const chip = ITEM_STATUS_COLORS[batch.status];
        const queueLabel = batch.queues.length > 1
          ? `คิว ${batch.queues[0]}–${batch.queues[batch.queues.length - 1]}`
          : `คิว ${batch.queues[0]}`;
        const candidates = inKitchenByName.get(batch.name) || [];

        return (
          <div
            key={batch.id}
            className={`bg-admin-card border rounded-2xl p-3 shadow-xs ${batch.isBatch ? 'border-amber-300 ring-1 ring-amber-200' : 'border-line'}`}
          >
            {/* Header */}
            <div className="flex items-start gap-2.5">
              <div className="w-11 h-11 rounded-xl bg-amber-500 text-white flex flex-col items-center justify-center flex-shrink-0 leading-none">
                <span className="font-extrabold text-lg font-mono">{batch.totalQty}</span>
                <span className="text-[8px] font-bold">จาน</span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="font-extrabold text-sm text-neutral-800 truncate">{batch.name}</span>
                  {batch.isBatch && (
                    <span className="text-[9px] font-extrabold bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full">
                      รวม {batch.members.length} โต๊ะ
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${chip}`}>
                    {ITEM_STATUS_LABELS[batch.status]}
                  </span>
                  <span className="text-[10px] text-neutral-400 font-bold">{queueLabel}</span>
                </div>
              </div>
            </div>

            {/* Per-table breakdown */}
            <div className="mt-2 pl-1 space-y-1">
              {batch.members.map((m) => (
                <div key={m.uid} className="flex items-start gap-2 text-[11px]">
                  <span className="font-bold text-neutral-500 whitespace-nowrap">โต๊ะ {m.table}</span>
                  <span className="font-mono text-amber-700 font-bold">{m.qty}×</span>
                  <div className="min-w-0">
                    {m.addOns.length > 0 && (
                      <span className="text-neutral-500">+ {m.addOns.join(', ')}</span>
                    )}
                    {m.note && <span className="text-red-500 italic">📝 {m.note}</span>}
                  </div>
                </div>
              ))}
            </div>

            {/* Actions */}
            <div className="mt-2.5 flex items-center gap-2">
              {batch.status === 'in_kitchen' && (
                <button
                  onClick={() => startBatch(batch)}
                  className="flex-1 bg-[#E6DAF7] hover:brightness-95 text-[#5B3A9A] font-bold py-2 rounded-xl text-xs transition flex items-center justify-center gap-1.5"
                >
                  <ChefHat className="w-4 h-4" /> กำลังทำ
                </button>
              )}

              {batch.status === 'in_progress' && (
                <>
                  <button
                    onClick={() => completeBatch(batch)}
                    className="flex-1 bg-[#DCEFE0] hover:brightness-95 text-[#2C6E49] font-bold py-2 rounded-xl text-xs transition flex items-center justify-center gap-1.5"
                  >
                    <Check className="w-4 h-4" /> เสร็จแล้ว
                  </button>
                  {batch.members.length > 1 && (
                    <button
                      onClick={() => setToolOpen(toolOpen === `split-${batch.id}` ? null : `split-${batch.id}`)}
                      title="แยกจานออกจากกลุ่ม"
                      className="px-2.5 py-2 border border-neutral-200 rounded-xl text-neutral-500 hover:bg-neutral-50 transition"
                    >
                      <Scissors className="w-4 h-4" />
                    </button>
                  )}
                  {candidates.length > 0 && (
                    <button
                      onClick={() => setToolOpen(toolOpen === `add-${batch.id}` ? null : `add-${batch.id}`)}
                      title="ดึงเมนูเดียวกันจากโต๊ะอื่นเข้ากลุ่ม"
                      className="px-2.5 py-2 border border-neutral-200 rounded-xl text-neutral-500 hover:bg-neutral-50 transition"
                    >
                      <Plus className="w-4 h-4" />
                    </button>
                  )}
                </>
              )}
            </div>

            {/* ✂️ split tray */}
            {toolOpen === `split-${batch.id}` && (
              <ToolTray title="แยกจานไหนออก?" onClose={() => setToolOpen(null)}>
                {batch.members.map((m) => (
                  <button
                    key={m.uid}
                    onClick={() => splitMember(m)}
                    className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-admin-field hover:bg-neutral-100 text-[11px] font-bold transition"
                  >
                    <span>โต๊ะ {m.table} · {m.qty} จาน</span>
                    <Scissors className="w-3.5 h-3.5 text-neutral-400" />
                  </button>
                ))}
              </ToolTray>
            )}

            {/* ➕ manual-add tray */}
            {toolOpen === `add-${batch.id}` && (
              <ToolTray title="ดึงเมนูเดียวกันเข้ากลุ่ม" onClose={() => setToolOpen(null)}>
                {candidates.map((m) => (
                  <button
                    key={m.uid}
                    onClick={() => addToBatch(batch, m)}
                    className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-admin-field hover:bg-neutral-100 text-[11px] font-bold transition"
                  >
                    <span>โต๊ะ {m.table} · คิว {m.queueNo} · {m.qty} จาน</span>
                    <Plus className="w-3.5 h-3.5 text-neutral-400" />
                  </button>
                ))}
              </ToolTray>
            )}
          </div>
        );
      })}
    </div>
  );
}

function ToolTray({ title, onClose, children }) {
  return (
    <div className="mt-2 pt-2 border-t border-neutral-100">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[10px] font-extrabold text-neutral-500">{title}</span>
        <button onClick={onClose} className="text-neutral-400 hover:text-neutral-600">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

export default KitchenBoard;
