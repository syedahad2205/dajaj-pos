"use client";

import type { Address } from "@/lib/addresses";

export default function AddressCard({
  address,
  selected,
  onSelect,
  onEdit,
  onDelete,
  onSetDefault,
}: {
  address: Address;
  selected: boolean;
  onSelect: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onSetDefault: () => void;
}) {
  return (
    <div className={`rounded-2xl border p-4 ${selected ? "border-orange-500 bg-orange-50" : "border-slate-200 bg-white"}`}>
      <button type="button" onClick={onSelect} className="w-full text-left">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-bold uppercase tracking-[0.2em] text-orange-600">{address.label}</p>
            <h3 className="mt-1 text-base font-black text-slate-900">{address.addressLine1}</h3>
            <p className="mt-1 text-sm text-slate-600">{address.addressLine2}</p>
            {address.landmark ? <p className="mt-1 text-sm text-slate-500">Near {address.landmark}</p> : null}
            <p className="mt-1 text-sm text-slate-500">
              {address.name} • {address.phone}
            </p>
            {address.isDefault ? <p className="mt-2 text-xs font-semibold uppercase tracking-[0.18em] text-emerald-600">Default address</p> : null}
          </div>
          <input type="radio" checked={selected} readOnly className="h-4 w-4" />
        </div>
      </button>

      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" onClick={onEdit} className="rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700">
          Edit
        </button>
        <button type="button" onClick={onDelete} className="rounded-xl border border-rose-300 px-3 py-2 text-sm font-semibold text-rose-700">
          Delete
        </button>
        {!address.isDefault ? (
          <button type="button" onClick={onSetDefault} className="rounded-xl border border-emerald-300 px-3 py-2 text-sm font-semibold text-emerald-700">
            Make Default
          </button>
        ) : null}
      </div>
    </div>
  );
}
