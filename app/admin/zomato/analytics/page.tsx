'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { requireAdmin } from '@/lib/roleGuard';
import {
  getZomatoImports,
  getAggregatedAnalytics,
  type ZomatoImport,
  type AggregatedAnalytics,
} from '@/services/zomatoService';

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(iso: string) {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${d} ${months[parseInt(m, 10) - 1]} ${y}`;
}

function fmtRupee(n: number) {
  return `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

type SortKey = 'revenue' | 'qty' | 'name';

// ── Horizontal bar component ──────────────────────────────────────────────────

function BarRow({
  label,
  value,
  maxValue,
  pct,
  subLabel,
  color = 'bg-orange-500',
}: {
  label: string;
  value: string;
  maxValue: number;
  pct?: number;
  subLabel?: string;
  color?: string;
}) {
  const widthPct = maxValue > 0 ? Math.max(2, (parseFloat(value.replace(/[^0-9.]/g, '')) / maxValue) * 100) : 0;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium text-neutral-800 truncate max-w-[200px]">{label}</span>
        <div className="flex items-center gap-3 flex-shrink-0">
          {subLabel && <span className="text-xs text-neutral-400">{subLabel}</span>}
          <span className="font-bold text-neutral-900 tabular-nums">{value}</span>
          {pct !== undefined && (
            <span className="text-xs text-neutral-400 w-10 text-right">{pct}%</span>
          )}
        </div>
      </div>
      <div className="h-2 bg-neutral-100 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full ${color} transition-all duration-500`}
          style={{ width: `${widthPct}%` }}
        />
      </div>
    </div>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function ZomatoAnalyticsPage() {
  const router = useRouter();
  const { authenticated, loading: authLoading, role } = requireAdmin();

  const [imports, setImports]         = useState<ZomatoImport[]>([]);
  const [analytics, setAnalytics]     = useState<AggregatedAnalytics | null>(null);
  const [dataLoading, setDataLoading] = useState(true);
  const [error, setError]             = useState<string | null>(null);

  // Filters
  const [selectedImportId, setSelectedImportId] = useState<string>('all');
  const [categoryFilter, setCategoryFilter]     = useState('');
  const [itemSearch, setItemSearch]             = useState('');
  const [itemSort, setItemSort]                 = useState<SortKey>('revenue');

  // Load imports list once
  useEffect(() => {
    if (!authenticated) return;
    setDataLoading(true);
    setError(null);
    getZomatoImports()
      .then(setImports)
      .catch((e) => setError(e?.message ?? String(e)))
      .finally(() => setDataLoading(false));
  }, [authenticated]);

  // Load analytics when filter changes
  useEffect(() => {
    if (!authenticated || imports.length === 0) return;

    const ids =
      selectedImportId === 'all'
        ? imports.map((i) => i.id)
        : [selectedImportId];

    setDataLoading(true);
    setError(null);
    getAggregatedAnalytics(ids)
      .then((data) => { setAnalytics(data); })
      .catch((e) => setError(e?.message ?? String(e)))
      .finally(() => setDataLoading(false));
  }, [authenticated, imports, selectedImportId]);

  // Derived data with filters applied
  const filteredCategories = useMemo(() => {
    if (!analytics) return [];
    return analytics.categories.filter((c) =>
      !categoryFilter || c.category.toLowerCase().includes(categoryFilter.toLowerCase()),
    );
  }, [analytics, categoryFilter]);

  const filteredItems = useMemo(() => {
    if (!analytics) return [];
    let rows = analytics.items.filter(
      (i) =>
        (!itemSearch || i.itemName.toLowerCase().includes(itemSearch.toLowerCase())) &&
        (!categoryFilter || i.category.toLowerCase().includes(categoryFilter.toLowerCase())),
    );
    if (itemSort === 'revenue') rows = [...rows].sort((a, b) => b.revenue - a.revenue);
    else if (itemSort === 'qty')  rows = [...rows].sort((a, b) => b.qty - a.qty);
    else                          rows = [...rows].sort((a, b) => a.itemName.localeCompare(b.itemName));
    return rows;
  }, [analytics, itemSearch, categoryFilter, itemSort]);

  const maxCatRevenue = filteredCategories[0]?.revenue ?? 0;
  const maxItemRevenue = filteredItems[0]?.revenue ?? 0;

  // ── Auth ──────────────────────────────────────────────────────────────────

  if (authLoading) {
    return <main className="min-h-screen bg-neutral-50 px-4 py-10 text-sm text-neutral-400">Checking session…</main>;
  }
  if (!authenticated || role !== 'admin') return null;

  // ── Empty state ───────────────────────────────────────────────────────────

  if (!dataLoading && imports.length === 0) {
    return (
      <div className="min-h-screen bg-neutral-50 flex flex-col">
        <header className="bg-white border-b border-neutral-200 px-4 py-3 flex items-center gap-3">
          <button onClick={() => router.back()} className="p-1.5 rounded hover:bg-neutral-100 text-neutral-500">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
            </svg>
          </button>
          <h1 className="font-bold text-lg text-neutral-900">Analytics</h1>
        </header>
        <div className="flex-1 flex flex-col items-center justify-center gap-4 p-8 text-center">
          <div className="w-16 h-16 rounded-full bg-neutral-100 flex items-center justify-center">
            <svg className="w-8 h-8 text-neutral-400" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75Z" />
            </svg>
          </div>
          <p className="font-semibold text-neutral-700">No data yet</p>
          <p className="text-sm text-neutral-400">Upload a Zomato CSV to see analytics.</p>
          <button
            onClick={() => router.push('/admin/zomato/import')}
            className="px-5 py-2.5 rounded-xl bg-neutral-900 text-white text-sm font-semibold"
          >
            Upload CSV
          </button>
        </div>
      </div>
    );
  }

  // ── Main render ───────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-neutral-50 flex flex-col">
      {/* Header */}
      <header className="flex-shrink-0 bg-white border-b border-neutral-200 px-4 py-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button onClick={() => router.back()} className="p-1.5 rounded hover:bg-neutral-100 text-neutral-500">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
            </svg>
          </button>
          <h1 className="font-bold text-lg text-neutral-900">Analytics</h1>
        </div>

        {/* Period selector */}
        <select
          value={selectedImportId}
          onChange={(e) => setSelectedImportId(e.target.value)}
          className="px-3 py-1.5 border border-neutral-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 max-w-[200px]"
        >
          <option value="all">All Periods</option>
          {imports.map((imp) => (
            <option key={imp.id} value={imp.id}>
              {fmtDate(imp.reportStartDate)} – {fmtDate(imp.reportEndDate)}
            </option>
          ))}
        </select>
      </header>

      <div className="flex-1 overflow-y-auto p-4 space-y-4 max-w-3xl mx-auto w-full">
        {/* Loading */}
        {dataLoading && (
          <div className="flex justify-center py-12">
            <div className="w-8 h-8 border-4 border-neutral-200 border-t-orange-500 rounded-full animate-spin" />
          </div>
        )}

        {error && (
          <div className="rounded-xl bg-red-50 border border-red-200 p-4 text-sm text-red-700">{error}</div>
        )}

        {!dataLoading && analytics && (
          <>
            {/* Summary cards */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="bg-white rounded-xl border border-neutral-200 p-3 text-center">
                <p className="text-xl font-black text-emerald-600">{fmtRupee(analytics.totalRevenue)}</p>
                <p className="text-xs text-neutral-500 mt-0.5">Gross Revenue</p>
              </div>
              <div className="bg-white rounded-xl border border-neutral-200 p-3 text-center">
                <p className="text-xl font-black text-orange-600">{analytics.totalQuantity}</p>
                <p className="text-xs text-neutral-500 mt-0.5">Items Sold</p>
              </div>
              <div className="bg-white rounded-xl border border-neutral-200 p-3 text-center">
                <p className="text-xl font-black text-neutral-900">{analytics.categories.length}</p>
                <p className="text-xs text-neutral-500 mt-0.5">Categories</p>
              </div>
              <div className="bg-white rounded-xl border border-neutral-200 p-3 text-center">
                <p className="text-xl font-black text-neutral-900">{analytics.items.length}</p>
                <p className="text-xs text-neutral-500 mt-0.5">Unique Items</p>
              </div>
            </div>

            {/* Settlement summary — shown only when all selected imports have full settlement */}
            {analytics.hasSettlement &&
              analytics.totalNetOrderValue !== undefined &&
              analytics.totalFinalPayout  !== undefined &&
              analytics.totalDeductions   !== undefined &&
              analytics.overallDeductionPct !== undefined && (
              <div className="bg-blue-50 rounded-xl border border-blue-200 p-4 space-y-2">
                <p className="text-xs font-semibold text-blue-700 uppercase tracking-wide">Settlement Summary</p>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <div className="bg-white rounded-xl border border-blue-100 p-3 text-center">
                    <p className="text-lg font-black text-blue-700">{fmtRupee(analytics.totalNetOrderValue)}</p>
                    <p className="text-xs text-neutral-500 mt-0.5">Net Order Value (A)</p>
                  </div>
                  <div className="bg-white rounded-xl border border-emerald-100 p-3 text-center">
                    <p className="text-lg font-black text-emerald-600">{fmtRupee(analytics.totalFinalPayout)}</p>
                    <p className="text-xs text-neutral-500 mt-0.5">Final Payout</p>
                  </div>
                  <div className="bg-white rounded-xl border border-red-100 p-3 text-center">
                    <p className="text-lg font-black text-red-600">{fmtRupee(analytics.totalDeductions)}</p>
                    <p className="text-xs text-neutral-500 mt-0.5">Total Deductions</p>
                  </div>
                  <div className="bg-white rounded-xl border border-blue-100 p-3 text-center">
                    <p className="text-lg font-black text-neutral-700">{(analytics.overallDeductionPct * 100).toFixed(3)}%</p>
                    <p className="text-xs text-neutral-500 mt-0.5">Deduction %</p>
                  </div>
                </div>
              </div>
            )}

            {!analytics.hasSettlement && (
              <div className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 text-xs text-amber-700">
                Settlement data not available for this period. Enter Net Order Value and payout in{' '}
                <button
                  onClick={() => router.push('/admin/zomato/history')}
                  className="underline font-semibold hover:text-amber-900"
                >
                  Import History
                </button>{' '}
                to see deductions.
              </div>
            )}

            {/* Filters row */}
            <div className="flex gap-2 flex-wrap">
              <input
                type="text"
                placeholder="Filter by category…"
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                className="px-3 py-2 border border-neutral-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 flex-1 min-w-[140px]"
              />
              <input
                type="text"
                placeholder="Search items…"
                value={itemSearch}
                onChange={(e) => setItemSearch(e.target.value)}
                className="px-3 py-2 border border-neutral-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 flex-1 min-w-[140px]"
              />
            </div>

            {/* Category breakdown */}
            <div className="bg-white rounded-xl border border-neutral-200 overflow-hidden">
              <div className="px-4 py-3 border-b border-neutral-100 flex items-center justify-between">
                <p className="font-semibold text-sm text-neutral-900">Revenue by Category</p>
                <p className="text-xs text-neutral-400">sorted by revenue</p>
              </div>
              <div className="p-4 space-y-4">
                {filteredCategories.length === 0 ? (
                  <p className="text-sm text-neutral-400 text-center py-4">No categories match your filter.</p>
                ) : (
                  filteredCategories.map((cat) => (
                    <BarRow
                      key={cat.category}
                      label={cat.category || 'Uncategorized'}
                      value={fmtRupee(cat.revenue)}
                      maxValue={maxCatRevenue}
                      pct={cat.pct}
                      subLabel={`${cat.qty} sold`}
                      color="bg-orange-500"
                    />
                  ))
                )}
              </div>
            </div>

            {/* Category contribution donut-style list */}
            <div className="bg-white rounded-xl border border-neutral-200 overflow-hidden">
              <div className="px-4 py-3 border-b border-neutral-100">
                <p className="font-semibold text-sm text-neutral-900">Category Contribution</p>
              </div>
              <div className="divide-y divide-neutral-100">
                {filteredCategories.map((cat, i) => {
                  const colors = ['bg-orange-500','bg-emerald-500','bg-blue-500','bg-violet-500','bg-amber-500','bg-rose-500','bg-teal-500','bg-indigo-500'];
                  const dot = colors[i % colors.length];
                  return (
                    <div key={cat.category} className="px-4 py-3 flex items-center justify-between">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${dot}`} />
                        <span className="text-sm font-medium text-neutral-800 truncate">{cat.category || 'Uncategorized'}</span>
                      </div>
                      <div className="flex items-center gap-4 flex-shrink-0">
                        <span className="text-sm text-neutral-500 tabular-nums">{cat.qty} pcs</span>
                        <span className="text-sm font-bold text-neutral-900 tabular-nums w-20 text-right">{fmtRupee(cat.revenue)}</span>
                        <span className="text-xs text-neutral-400 w-10 text-right">{cat.pct}%</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Item performance table */}
            <div className="bg-white rounded-xl border border-neutral-200 overflow-hidden">
              <div className="px-4 py-3 border-b border-neutral-100 flex items-center justify-between flex-wrap gap-2">
                <p className="font-semibold text-sm text-neutral-900">Item Performance</p>
                <div className="flex gap-1.5">
                  {(['revenue', 'qty', 'name'] as SortKey[]).map((key) => (
                    <button
                      key={key}
                      onClick={() => setItemSort(key)}
                      className={`px-3 py-1 rounded-lg text-xs font-semibold transition-colors ${
                        itemSort === key ? 'bg-neutral-900 text-white' : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'
                      }`}
                    >
                      {key === 'revenue' ? 'Revenue' : key === 'qty' ? 'Quantity' : 'Name'}
                    </button>
                  ))}
                </div>
              </div>

              <div className="p-4 space-y-3">
                {filteredItems.length === 0 ? (
                  <p className="text-sm text-neutral-400 text-center py-4">No items match your search.</p>
                ) : (
                  filteredItems.map((item) => (
                    <BarRow
                      key={`${item.itemName}-${item.category}`}
                      label={item.itemName}
                      value={fmtRupee(item.revenue)}
                      maxValue={maxItemRevenue}
                      subLabel={`${item.qty} sold · ${item.category}`}
                      color="bg-violet-500"
                    />
                  ))
                )}
              </div>
            </div>

            {/* Top 5 / Bottom 5 */}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="bg-white rounded-xl border border-neutral-200 overflow-hidden">
                <div className="px-4 py-3 border-b border-neutral-100">
                  <p className="font-semibold text-sm text-neutral-900">🏆 Top Selling Items</p>
                </div>
                <div className="divide-y divide-neutral-100">
                  {analytics.items.slice(0, 5).map((item, i) => (
                    <div key={item.itemName} className="px-4 py-3 flex items-center justify-between">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span className="text-xs font-bold text-neutral-400 w-4">{i + 1}</span>
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-neutral-900 truncate max-w-[130px]">{item.itemName}</p>
                          <p className="text-xs text-neutral-400">{item.category}</p>
                        </div>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="text-sm font-bold text-emerald-600 tabular-nums">{fmtRupee(item.revenue)}</p>
                        <p className="text-xs text-neutral-400">{item.qty} sold</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="bg-white rounded-xl border border-neutral-200 overflow-hidden">
                <div className="px-4 py-3 border-b border-neutral-100">
                  <p className="font-semibold text-sm text-neutral-900">📉 Lowest Performing</p>
                </div>
                <div className="divide-y divide-neutral-100">
                  {[...analytics.items].sort((a, b) => a.revenue - b.revenue).slice(0, 5).map((item, i) => (
                    <div key={item.itemName} className="px-4 py-3 flex items-center justify-between">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span className="text-xs font-bold text-neutral-400 w-4">{i + 1}</span>
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-neutral-900 truncate max-w-[130px]">{item.itemName}</p>
                          <p className="text-xs text-neutral-400">{item.category}</p>
                        </div>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="text-sm font-bold text-rose-500 tabular-nums">{fmtRupee(item.revenue)}</p>
                        <p className="text-xs text-neutral-400">{item.qty} sold</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Revenue trend across imports */}
            {imports.length > 1 && (
              <div className="bg-white rounded-xl border border-neutral-200 overflow-hidden">
                <div className="px-4 py-3 border-b border-neutral-100">
                  <p className="font-semibold text-sm text-neutral-900">Revenue Trend by Period</p>
                </div>
                <div className="p-4 space-y-3">
                  {[...imports]
                    .sort((a, b) => a.reportStartDate.localeCompare(b.reportStartDate))
                    .map((imp) => {
                      const maxRev = Math.max(...imports.map((i) => i.totalRevenue));
                      return (
                        <BarRow
                          key={imp.id}
                          label={`${fmtDate(imp.reportStartDate)} – ${fmtDate(imp.reportEndDate)}`}
                          value={fmtRupee(imp.totalRevenue)}
                          maxValue={maxRev}
                          subLabel={`${imp.totalQuantity} sold`}
                          color="bg-blue-500"
                        />
                      );
                    })}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
