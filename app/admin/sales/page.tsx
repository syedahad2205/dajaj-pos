'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { getBillsByDate, type Bill } from '@/lib/firestore';
import { requireAdmin } from '@/lib/roleGuard';

interface VariantRow {
  category: string;
  variant: string;
  qty: number;
  revenue: number;
}

interface CategoryRow {
  category: string;
  qty: number;
  revenue: number;
  variants: VariantRow[];
}

function toDateInputValue(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function SalesPage() {
  const router = useRouter();
  const { authenticated, role } = requireAdmin();
  const [date, setDate] = useState(() => toDateInputValue(new Date()));
  const [bills, setBills] = useState<Bill[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'category' | 'variant'>('category');
  const [expandedCats, setExpandedCats] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!authenticated) return;
    setLoading(true);
    const d = new Date(date + 'T00:00:00');
    getBillsByDate(d).then((b) => { setBills(b); setLoading(false); });
  }, [date, authenticated]);

  const { categoryRows, variantRows, totalQty, totalRevenue } = useMemo(() => {
    const variantMap = new Map<string, VariantRow>();
    const catMap = new Map<string, { qty: number; revenue: number; variants: Map<string, VariantRow> }>();

    for (const bill of bills) {
      for (const item of bill.items) {
        const cat = item.name || 'Uncategorized';
        const variant = item.variant || 'Default';
        const key = `${cat}|||${variant}`;

        // Variant level
        const existing = variantMap.get(key);
        if (existing) {
          existing.qty += item.qty;
          existing.revenue += item.itemTotal;
        } else {
          variantMap.set(key, { category: cat, variant, qty: item.qty, revenue: item.itemTotal });
        }

        // Category level
        if (!catMap.has(cat)) {
          catMap.set(cat, { qty: 0, revenue: 0, variants: new Map() });
        }
        const catEntry = catMap.get(cat)!;
        catEntry.qty += item.qty;
        catEntry.revenue += item.itemTotal;

        const catVariant = catEntry.variants.get(variant);
        if (catVariant) {
          catVariant.qty += item.qty;
          catVariant.revenue += item.itemTotal;
        } else {
          catEntry.variants.set(variant, { category: cat, variant, qty: item.qty, revenue: item.itemTotal });
        }
      }
    }

    const variantRows = Array.from(variantMap.values()).sort((a, b) => b.qty - a.qty);
    const categoryRows: CategoryRow[] = Array.from(catMap.entries())
      .map(([category, data]) => ({
        category,
        qty: data.qty,
        revenue: data.revenue,
        variants: Array.from(data.variants.values()).sort((a, b) => b.qty - a.qty),
      }))
      .sort((a, b) => b.qty - a.qty);

    const totalQty = variantRows.reduce((s, r) => s + r.qty, 0);
    const totalRevenue = variantRows.reduce((s, r) => s + r.revenue, 0);

    return { categoryRows, variantRows, totalQty, totalRevenue };
  }, [bills]);

  const toggleCat = (cat: string) => {
    setExpandedCats((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat); else next.add(cat);
      return next;
    });
  };

  if (!authenticated || role !== 'admin') return null;

  return (
    <div className="min-h-dvh bg-neutral-50 flex flex-col">
      {/* Header */}
      <header className="flex-shrink-0 bg-white border-b border-neutral-200 px-4 py-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.back()}
            className="p-1.5 rounded hover:bg-neutral-100 text-neutral-500"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" /></svg>
          </button>
          <h1 className="font-bold text-lg text-neutral-900">Sales Tracker</h1>
        </div>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="px-3 py-1.5 border border-neutral-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
        />
      </header>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-3 p-4">
        <div className="bg-white rounded-xl border border-neutral-200 p-3 text-center">
          <p className="text-2xl font-bold text-neutral-900">{bills.length}</p>
          <p className="text-xs text-neutral-500 mt-0.5">Bills</p>
        </div>
        <div className="bg-white rounded-xl border border-neutral-200 p-3 text-center">
          <p className="text-2xl font-bold text-orange-600">{totalQty}</p>
          <p className="text-xs text-neutral-500 mt-0.5">Items Sold</p>
        </div>
        <div className="bg-white rounded-xl border border-neutral-200 p-3 text-center">
          <p className="text-2xl font-bold text-emerald-600">₹{totalRevenue.toFixed(0)}</p>
          <p className="text-xs text-neutral-500 mt-0.5">Revenue</p>
        </div>
      </div>

      {/* View toggle */}
      <div className="px-4 flex gap-2">
        <button
          onClick={() => setView('category')}
          className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
            view === 'category' ? 'bg-neutral-900 text-white' : 'bg-white border border-neutral-300 text-neutral-600 hover:bg-neutral-50'
          }`}
        >
          By Category
        </button>
        <button
          onClick={() => setView('variant')}
          className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
            view === 'variant' ? 'bg-neutral-900 text-white' : 'bg-white border border-neutral-300 text-neutral-600 hover:bg-neutral-50'
          }`}
        >
          By Variant
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {loading ? (
          <p className="text-center text-neutral-400 mt-12">Loading…</p>
        ) : bills.length === 0 ? (
          <p className="text-center text-neutral-400 mt-12">No bills for this date.</p>
        ) : view === 'category' ? (
          /* ── Category view ── */
          categoryRows.map((cat) => (
            <div key={cat.category} className="bg-white rounded-xl border border-neutral-200 overflow-hidden">
              <button
                onClick={() => toggleCat(cat.category)}
                className="w-full flex items-center justify-between px-4 py-3 hover:bg-neutral-50 transition-colors"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <svg
                    className={`w-4 h-4 text-neutral-400 transition-transform ${expandedCats.has(cat.category) ? 'rotate-90' : ''}`}
                    fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
                  </svg>
                  <span className="font-semibold text-sm text-neutral-900 truncate">{cat.category}</span>
                </div>
                <div className="flex items-center gap-4 flex-shrink-0">
                  <span className="text-sm font-bold text-orange-600 tabular-nums">{cat.qty}</span>
                  <span className="text-sm font-semibold text-neutral-600 tabular-nums w-20 text-right">₹{cat.revenue.toFixed(0)}</span>
                </div>
              </button>
              {expandedCats.has(cat.category) && (
                <div className="border-t border-neutral-100">
                  {cat.variants.map((v) => (
                    <div key={v.variant} className="flex items-center justify-between px-4 py-2.5 pl-11 hover:bg-neutral-50">
                      <span className="text-sm text-neutral-700 truncate">{v.variant}</span>
                      <div className="flex items-center gap-4 flex-shrink-0">
                        <span className="text-sm font-bold text-orange-600 tabular-nums">{v.qty}</span>
                        <span className="text-sm text-neutral-500 tabular-nums w-20 text-right">₹{v.revenue.toFixed(0)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))
        ) : (
          /* ── Variant view ── */
          <div className="bg-white rounded-xl border border-neutral-200 overflow-hidden divide-y divide-neutral-100">
            {variantRows.map((v, i) => (
              <div key={`${v.category}-${v.variant}-${i}`} className="flex items-center justify-between px-4 py-3 hover:bg-neutral-50">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-neutral-900 truncate">{v.variant}</p>
                  <p className="text-xs text-neutral-400 truncate">{v.category}</p>
                </div>
                <div className="flex items-center gap-4 flex-shrink-0">
                  <span className="text-sm font-bold text-orange-600 tabular-nums">{v.qty}</span>
                  <span className="text-sm text-neutral-500 tabular-nums w-20 text-right">₹{v.revenue.toFixed(0)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
