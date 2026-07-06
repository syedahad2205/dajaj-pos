"use client";

import { formatCurrency } from "@/lib/financeFormat";

interface BreakdownItem {
  label: string;
  amount: number;
}

export default function BreakdownBars({ items, barColorClassName = "bg-orange-400", emptyLabel = "No data yet." }: { items: BreakdownItem[]; barColorClassName?: string; emptyLabel?: string }) {
  if (items.length === 0) {
    return <p className="py-6 text-center text-sm text-slate-400">{emptyLabel}</p>;
  }

  const max = Math.max(...items.map((i) => i.amount), 1);

  return (
    <div className="space-y-3">
      {items.map((item) => (
        <div key={item.label}>
          <div className="mb-1 flex items-center justify-between text-sm">
            <span className="font-medium text-slate-700">{item.label}</span>
            <span className="font-semibold text-slate-900">{formatCurrency(item.amount)}</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
            <div className={`h-full rounded-full ${barColorClassName}`} style={{ width: `${Math.max(4, (item.amount / max) * 100)}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}
