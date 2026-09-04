'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { requireAdmin } from '@/lib/roleGuard';
import NativeDateField from '@/components/ui/NativeDateField';
import {
  getZomatoImports,
  getSettlementReport,
  saveSettlement,
  buildSettlementCsv,
  type ZomatoImport,
  type SettlementReport,
} from '@/services/zomatoService';
import { postZomatoSettlementToFinance } from '@/services/zomatoFinanceService';

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

function fmtRupeeExact(n: number) {
  return `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function downloadCsv(content: string, fileName: string) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

/** Returns the settlement state of an import */
function settlementState(imp: ZomatoImport): 'full' | 'legacy' | 'none' {
  if (imp.netOrderValue !== undefined && imp.finalPayout !== undefined) return 'full';
  if (imp.finalPayout !== undefined) return 'legacy';
  return 'none';
}

type CatSortKey  = 'revenue' | 'qty' | 'deduction' | 'net';
type ItemSortKey = 'revenue' | 'qty' | 'deduction' | 'net' | 'name';

// ── Settlement entry form ─────────────────────────────────────────────────────

function SettlementEntryForm({
  imp,
  onSaved,
  compact = false,
}: {
  imp: ZomatoImport;
  onSaved: () => void;
  compact?: boolean;
}) {
  const isLegacy = settlementState(imp) === 'legacy';

  const [nov,    setNov]    = useState(imp.netOrderValue !== undefined ? String(imp.netOrderValue) : '');
  const [payout, setPayout] = useState(imp.finalPayout   !== undefined ? String(imp.finalPayout)   : '');
  const [transferDate, setTransferDate] = useState(imp.payoutReceivedDate || todayIso());
  const [saving, setSaving] = useState(false);
  const [err,    setErr]    = useState<string | null>(null);

  const novNum    = parseFloat(nov);
  const payoutNum = parseFloat(payout);
  const preview   = !isNaN(novNum) && !isNaN(payoutNum) && novNum > 0 && payoutNum >= 0 && payoutNum <= novNum;
  const previewDed = preview ? Math.round((novNum - payoutNum) * 100) / 100 : null;
  const previewPct = preview && novNum > 0 ? ((novNum - payoutNum) / novNum * 100) : null;

  const handleSave = async () => {
    if (isNaN(novNum) || novNum <= 0)       { setErr('Enter a valid Net Order Value.'); return; }
    if (isNaN(payoutNum) || payoutNum < 0)  { setErr('Enter a valid Final Payout.'); return; }
    if (payoutNum > novNum)                 { setErr('Final Payout cannot exceed Net Order Value (A).'); return; }
    if (!transferDate)                      { setErr('Enter the date the payout was transferred to the bank.'); return; }
    setErr(null);
    setSaving(true);
    try {
      await saveSettlement(imp.id, novNum, payoutNum, transferDate);
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to save settlement.');
    } finally {
      setSaving(false);
    }
  };

  const isFull = settlementState(imp) === 'full';

  return (
    <div className={compact ? 'space-y-3' : 'space-y-4'}>
      {isLegacy && (
        <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 text-xs text-amber-800">
          This import was saved before the Net Order Value field was added. Enter both values below to recalculate settlement with the correct formula.
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-semibold text-neutral-600 mb-1.5 block">
            Net Order Value (A)
            <span className="ml-1 text-neutral-400 font-normal">from Zomato payout statement</span>
          </label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-neutral-400">₹</span>
            <input
              type="number"
              min={0}
              step="0.01"
              placeholder="e.g. 13235.25"
              value={nov}
              onChange={(e) => setNov(e.target.value)}
              className="w-full pl-7 pr-3 py-2.5 border border-neutral-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
            />
          </div>
        </div>
        <div>
          <label className="text-xs font-semibold text-neutral-600 mb-1.5 block">Final Payout Received</label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-neutral-400">₹</span>
            <input
              type="number"
              min={0}
              step="0.01"
              placeholder="e.g. 12059.59"
              value={payout}
              onChange={(e) => setPayout(e.target.value)}
              className="w-full pl-7 pr-3 py-2.5 border border-neutral-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
            />
          </div>
        </div>
      </div>

      <div>
        <label className="text-xs font-semibold text-neutral-600 mb-1.5 block">
          Bank transfer date
          <span className="ml-1 text-neutral-400 font-normal">when the payout left escrow</span>
        </label>
        <NativeDateField value={transferDate} onChange={(e) => setTransferDate(e.target.value)} />
      </div>

      {/* Live preview */}
      {preview && previewDed !== null && previewPct !== null && (
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded-lg bg-red-50 border border-red-100 px-2 py-2 text-xs">
            <p className="text-neutral-400">Deductions</p>
            <p className="font-bold text-red-600 mt-0.5">{fmtRupeeExact(previewDed)}</p>
          </div>
          <div className="rounded-lg bg-neutral-50 border border-neutral-100 px-2 py-2 text-xs">
            <p className="text-neutral-400">Deduction %</p>
            <p className="font-bold text-neutral-700 mt-0.5">{previewPct.toFixed(3)}%</p>
          </div>
          <div className="rounded-lg bg-neutral-50 border border-neutral-100 px-2 py-2 text-xs">
            <p className="text-neutral-400">NOV vs CSV</p>
            <p className={`font-bold mt-0.5 tabular-nums ${novNum >= imp.totalRevenue ? 'text-emerald-700' : 'text-red-600'}`}>
              {novNum >= imp.totalRevenue ? '+' : ''}{fmtRupeeExact(novNum - imp.totalRevenue)}
            </p>
          </div>
        </div>
      )}

      {err && <p className="text-xs text-red-600">{err}</p>}

      <button
        onClick={handleSave}
        disabled={saving || !nov || !payout || !transferDate}
        className="w-full py-2.5 rounded-lg bg-neutral-900 text-white text-sm font-semibold hover:bg-neutral-800 disabled:opacity-40 transition-colors"
      >
        {saving ? 'Saving…' : isFull ? 'Update Settlement' : 'Save Settlement & Generate Report'}
      </button>
    </div>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function ZomatoReportsPage() {
  const router = useRouter();
  const { authenticated, loading: authLoading, role } = requireAdmin();

  const [imports, setImports]         = useState<ZomatoImport[]>([]);
  const [selectedId, setSelectedId]   = useState<string>('');
  const [report, setReport]           = useState<SettlementReport | null>(null);
  const [loading, setLoading]         = useState(false);
  const [initialLoad, setInitialLoad] = useState(true);
  const [error, setError]             = useState<string | null>(null);
  const [syncing, setSyncing]         = useState(false);
  const [syncErr, setSyncErr]         = useState<string | null>(null);

  // Table sort / filter
  const [catSort,   setCatSort]   = useState<CatSortKey>('revenue');
  const [itemSort,  setItemSort]  = useState<ItemSortKey>('revenue');
  const [catFilter, setCatFilter] = useState('');

  const selectedImport = useMemo(
    () => imports.find((i) => i.id === selectedId) ?? null,
    [imports, selectedId],
  );

  // Load imports list
  useEffect(() => {
    if (!authenticated) return;
    getZomatoImports()
      .then((list) => {
        setImports(list);
        if (list.length > 0) setSelectedId(list[0].id);
      })
      .catch((e) => setError(e?.message ?? String(e)))
      .finally(() => setInitialLoad(false));
  }, [authenticated]);

  // Load settlement report when selection changes
  useEffect(() => {
    if (!selectedId) return;
    setReport(null);
    setError(null);
    setLoading(true);
    getSettlementReport(selectedId)
      .then(setReport)
      .catch((e) => setError(e?.message ?? String(e)))
      .finally(() => setLoading(false));
  }, [selectedId]);

  // After saving settlement, reload both imports list and report
  const handleSaved = async () => {
    try {
      const [updatedImports, updatedReport] = await Promise.all([
        getZomatoImports(),
        getSettlementReport(selectedId),
      ]);
      setImports(updatedImports);
      setReport(updatedReport);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to reload.');
    }
  };

  const handleSyncToFinance = async () => {
    if (!selectedId) return;
    setSyncErr(null);
    setSyncing(true);
    try {
      await postZomatoSettlementToFinance(selectedId);
      await handleSaved();
    } catch (e) {
      setSyncErr(e instanceof Error ? e.message : 'Failed to sync to Finance.');
    } finally {
      setSyncing(false);
    }
  };

  // Sorted categories
  const sortedCats = useMemo(() => {
    if (!report) return [];
    const rows = [...report.categories];
    if (catSort === 'revenue')   rows.sort((a, b) => b.grossRevenue - a.grossRevenue);
    if (catSort === 'qty')       rows.sort((a, b) => b.qty - a.qty);
    if (catSort === 'deduction') rows.sort((a, b) => b.allocatedDeduction - a.allocatedDeduction);
    if (catSort === 'net')       rows.sort((a, b) => b.netRevenue - a.netRevenue);
    return rows;
  }, [report, catSort]);

  // Sorted + filtered items
  const sortedItems = useMemo(() => {
    if (!report) return [];
    let rows = report.items.filter((i) =>
      !catFilter || i.category.toLowerCase().includes(catFilter.toLowerCase()),
    );
    if (itemSort === 'revenue')   rows = [...rows].sort((a, b) => b.grossRevenue - a.grossRevenue);
    if (itemSort === 'qty')       rows = [...rows].sort((a, b) => b.qty - a.qty);
    if (itemSort === 'deduction') rows = [...rows].sort((a, b) => b.allocatedDeduction - a.allocatedDeduction);
    if (itemSort === 'net')       rows = [...rows].sort((a, b) => b.netRevenue - a.netRevenue);
    if (itemSort === 'name')      rows = [...rows].sort((a, b) => a.itemName.localeCompare(b.itemName));
    return rows;
  }, [report, itemSort, catFilter]);

  const handleExportCsv = () => {
    if (!report || !selectedImport) return;
    const period = `${fmtDate(selectedImport.reportStartDate)} – ${fmtDate(selectedImport.reportEndDate)}`;
    const csv    = buildSettlementCsv(report, period, catFilter || undefined);
    const name   = `settlement_${selectedImport.reportStartDate}_${selectedImport.reportEndDate}.csv`;
    downloadCsv(csv, name);
  };

  if (authLoading || initialLoad) {
    return <main className="min-h-screen bg-neutral-50 px-4 py-10 text-sm text-neutral-400">Checking session…</main>;
  }
  if (!authenticated || role !== 'admin') return null;

  return (
    <div className="min-h-screen bg-neutral-50 flex flex-col">
      {/* Header */}
      <header className="flex-shrink-0 bg-white border-b border-neutral-200 px-4 py-3 flex items-center gap-3">
        <button onClick={() => router.back()} className="p-1.5 rounded hover:bg-neutral-100 text-neutral-500">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
          </svg>
        </button>
        <h1 className="font-bold text-lg text-neutral-900">Settlement Reports</h1>
      </header>

      <div className="flex-1 overflow-y-auto p-4 max-w-3xl mx-auto w-full space-y-4">

        {/* Import selector */}
        <div className="bg-white rounded-xl border border-neutral-200 p-4 space-y-3">
          <p className="font-semibold text-sm text-neutral-900">Select Import Period</p>
          {imports.length === 0 ? (
            <p className="text-sm text-neutral-400">No imports found. Upload a CSV first.</p>
          ) : (
            <div className="space-y-2">
              {imports.map((imp) => {
                const state = settlementState(imp);
                return (
                  <button
                    key={imp.id}
                    onClick={() => setSelectedId(imp.id)}
                    className={`w-full text-left px-4 py-3 rounded-xl border transition-colors ${
                      selectedId === imp.id
                        ? 'border-orange-400 bg-orange-50'
                        : 'border-neutral-200 hover:bg-neutral-50'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-semibold text-neutral-900">
                          {fmtDate(imp.reportStartDate)} – {fmtDate(imp.reportEndDate)}
                        </p>
                        <p className="text-xs text-neutral-400 truncate">{imp.fileName}</p>
                      </div>
                      <div className="flex flex-col items-end gap-1 flex-shrink-0 ml-3">
                        <span className="text-xs font-bold text-neutral-700">{fmtRupee(imp.totalRevenue)}</span>
                        {state === 'full'   && <span className="text-xs bg-blue-100 text-blue-700 rounded-full px-2 py-0.5 font-medium">settled</span>}
                        {state === 'legacy' && <span className="text-xs bg-amber-100 text-amber-700 rounded-full px-2 py-0.5 font-medium">details missing</span>}
                        {state === 'none'   && <span className="text-xs bg-neutral-100 text-neutral-500 rounded-full px-2 py-0.5 font-medium">no payout</span>}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {error && (
          <div className="rounded-xl bg-red-50 border border-red-200 p-4 text-sm text-red-700">{error}</div>
        )}

        {loading && (
          <div className="flex justify-center py-8">
            <div className="w-8 h-8 border-4 border-neutral-200 border-t-orange-500 rounded-full animate-spin" />
          </div>
        )}

        {/* No settlement / legacy — show entry form */}
        {!loading && selectedImport && !report && (
          <div className="bg-white rounded-xl border border-neutral-200 p-5 space-y-4">
            <div>
              <p className="font-semibold text-sm text-neutral-900 mb-0.5">Settlement Reconciliation</p>
              <p className="text-xs text-neutral-500">
                CSV Revenue (read-only): <span className="font-bold text-neutral-700">{fmtRupeeExact(selectedImport.totalRevenue)}</span>
                <span className="ml-2 text-neutral-400">— Enter both values from the Zomato payout statement to generate the settlement report.</span>
              </p>
            </div>
            <SettlementEntryForm imp={selectedImport} onSaved={handleSaved} />
          </div>
        )}

        {/* Settlement report */}
        {!loading && report && selectedImport && (
          <>
            {/* Settlement summary cards */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="bg-blue-50 rounded-xl border border-blue-200 p-3 text-center">
                <p className="text-lg font-black text-blue-700">{fmtRupee(report.netOrderValue)}</p>
                <p className="text-xs text-neutral-500 mt-0.5">Net Order Value (A)</p>
              </div>
              <div className="bg-emerald-50 rounded-xl border border-emerald-200 p-3 text-center">
                <p className="text-lg font-black text-emerald-700">{fmtRupee(report.finalPayout)}</p>
                <p className="text-xs text-neutral-500 mt-0.5">Final Payout</p>
                {selectedImport.payoutReceivedDate && (
                  <p className="text-[11px] text-neutral-400 mt-0.5">Bank {fmtDate(selectedImport.payoutReceivedDate)}</p>
                )}
              </div>
              <div className="bg-red-50 rounded-xl border border-red-200 p-3 text-center">
                <p className="text-lg font-black text-red-600">{fmtRupee(report.totalDeductions)}</p>
                <p className="text-xs text-neutral-500 mt-0.5">Total Deductions</p>
              </div>
              <div className="bg-white rounded-xl border border-neutral-200 p-3 text-center">
                <p className="text-lg font-black text-neutral-700">{(report.deductionPct * 100).toFixed(3)}%</p>
                <p className="text-xs text-neutral-500 mt-0.5">Deduction %</p>
              </div>
            </div>

            {/* Reconciliation section */}
            <div className="bg-white rounded-xl border border-neutral-200 overflow-hidden">
              <div className="px-4 py-3 border-b border-neutral-100">
                <p className="font-semibold text-sm text-neutral-900">Reconciliation Check</p>
                <p className="text-xs text-neutral-400 mt-0.5">Compares CSV-derived revenue against Zomato&apos;s Net Order Value</p>
              </div>
              <div className="p-4 grid grid-cols-1 sm:grid-cols-3 gap-3 text-center">
                <div className="rounded-lg bg-neutral-50 px-3 py-3">
                  <p className="text-xs text-neutral-500 mb-1">CSV Revenue</p>
                  <p className="text-base font-bold text-neutral-700">{fmtRupeeExact(report.csvRevenue)}</p>
                  <p className="text-xs text-neutral-400 mt-0.5">from item sales report</p>
                </div>
                <div className="rounded-lg bg-blue-50 px-3 py-3">
                  <p className="text-xs text-neutral-500 mb-1">Net Order Value (A)</p>
                  <p className="text-base font-bold text-blue-700">{fmtRupeeExact(report.netOrderValue)}</p>
                  <p className="text-xs text-neutral-400 mt-0.5">from payout statement</p>
                </div>
                <div className={`rounded-lg px-3 py-3 ${
                  report.reconciliationDiff >= 0 ? 'bg-emerald-50' : 'bg-red-50'
                }`}>
                  <p className="text-xs text-neutral-500 mb-1">Difference (NOV − CSV)</p>
                  <p className={`text-base font-bold tabular-nums ${
                    report.reconciliationDiff >= 0 ? 'text-emerald-700' : 'text-red-600'
                  }`}>
                    {report.reconciliationDiff >= 0 ? '+' : ''}{fmtRupeeExact(report.reconciliationDiff)}
                  </p>
                  <p className="text-xs text-neutral-400 mt-0.5">
                    {Math.abs(report.reconciliationDiff) < 0.01
                      ? 'exact match'
                      : report.reconciliationDiff > 0
                        ? 'NOV higher than CSV'
                        : 'CSV higher than NOV'}
                  </p>
                </div>
              </div>
            </div>

            {/* Finance sync */}
            <div className="bg-white rounded-xl border border-neutral-200 overflow-hidden">
              <div className="px-4 py-3 border-b border-neutral-100 flex items-center justify-between">
                <div>
                  <p className="font-semibold text-sm text-neutral-900">Finance Sync</p>
                  <p className="text-xs text-neutral-400 mt-0.5">Transfers the payout out of Zomato Escrow and records any deduction/adjustment</p>
                </div>
                {selectedImport && (selectedImport.financeTransferTransactionId || selectedImport.financeAdjustmentTransactionId) && (selectedImport.financePostingWarnings ?? []).length === 0 ? (
                  <span className="text-xs bg-emerald-100 text-emerald-700 rounded-full px-2 py-0.5 font-medium">synced</span>
                ) : (selectedImport?.financePostingWarnings ?? []).length > 0 ? (
                  <span className="text-xs bg-amber-100 text-amber-700 rounded-full px-2 py-0.5 font-medium">needs attention</span>
                ) : (
                  <span className="text-xs bg-neutral-100 text-neutral-500 rounded-full px-2 py-0.5 font-medium">not synced</span>
                )}
              </div>
              <div className="p-4 space-y-3">
                {selectedImport && typeof selectedImport.financeEscrowTotal === 'number' && typeof selectedImport.financeDifference === 'number' && (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-center">
                    <div className="rounded-lg bg-neutral-50 px-3 py-3">
                      <p className="text-xs text-neutral-500 mb-1">Escrow Recognized</p>
                      <p className="text-base font-bold text-neutral-700">{fmtRupeeExact(selectedImport.financeEscrowTotal)}</p>
                      <p className="text-xs text-neutral-400 mt-0.5">Zomato Sales posted for this period</p>
                    </div>
                    <div className="rounded-lg bg-emerald-50 px-3 py-3">
                      <p className="text-xs text-neutral-500 mb-1">Settlement (Final Payout)</p>
                      <p className="text-base font-bold text-emerald-700">{fmtRupeeExact(report.finalPayout)}</p>
                      <p className="text-xs text-neutral-400 mt-0.5">transferred out of Escrow</p>
                    </div>
                    <div className={`rounded-lg px-3 py-3 ${selectedImport.financeDifference > 0 ? 'bg-red-50' : selectedImport.financeDifference < 0 ? 'bg-emerald-50' : 'bg-neutral-50'}`}>
                      <p className="text-xs text-neutral-500 mb-1">Difference</p>
                      <p className={`text-base font-bold tabular-nums ${selectedImport.financeDifference > 0 ? 'text-red-600' : selectedImport.financeDifference < 0 ? 'text-emerald-700' : 'text-neutral-700'}`}>
                        {selectedImport.financeDifference > 0 ? '-' : selectedImport.financeDifference < 0 ? '+' : ''}
                        {fmtRupeeExact(Math.abs(selectedImport.financeDifference))}
                      </p>
                      <p className="text-xs text-neutral-400 mt-0.5">
                        {selectedImport.financeDifference > 0 ? 'posted as an Expense' : selectedImport.financeDifference < 0 ? 'posted as Income' : 'nothing to post'}
                      </p>
                    </div>
                  </div>
                )}
                {(selectedImport?.financePostingWarnings ?? []).length > 0 && (
                  <ul className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800 list-disc pl-5 space-y-0.5">
                    {(selectedImport?.financePostingWarnings ?? []).map((w, i) => <li key={i}>{w}</li>)}
                  </ul>
                )}
                {syncErr && <p className="text-xs text-red-600">{syncErr}</p>}
                <button
                  onClick={handleSyncToFinance}
                  disabled={syncing}
                  className="w-full py-2 rounded-lg border border-neutral-300 text-xs font-semibold text-neutral-600 hover:bg-neutral-50 disabled:opacity-50 transition-colors"
                >
                  {syncing ? 'Syncing…' : 'Sync to Finance'}
                </button>
              </div>
            </div>

            {/* Update settlement */}
            <details className="bg-white rounded-xl border border-neutral-200 overflow-hidden">
              <summary className="px-4 py-3 text-sm font-semibold text-neutral-700 cursor-pointer hover:bg-neutral-50 select-none list-none flex items-center justify-between">
                <span>Update Settlement Values</span>
                <svg className="w-4 h-4 text-neutral-400" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
                </svg>
              </summary>
              <div className="px-4 pb-4 pt-3 border-t border-neutral-100">
                <p className="text-xs text-neutral-400 mb-3">
                  Current: NOV {fmtRupeeExact(report.netOrderValue)} · Payout {fmtRupeeExact(report.finalPayout)}
                </p>
                <SettlementEntryForm imp={selectedImport} onSaved={handleSaved} compact />
              </div>
            </details>

            {/* Filters + export */}
            <div className="flex gap-2 flex-wrap items-center">
              <input
                type="text"
                placeholder="Filter by category…"
                value={catFilter}
                onChange={(e) => setCatFilter(e.target.value)}
                className="flex-1 min-w-[160px] px-3 py-2 border border-neutral-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
              />
              <button
                onClick={handleExportCsv}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg border border-neutral-300 text-sm font-semibold text-neutral-700 hover:bg-neutral-50 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
                </svg>
                Export CSV
              </button>
            </div>

            {/* Category settlement table */}
            <div className="bg-white rounded-xl border border-neutral-200 overflow-hidden">
              <div className="px-4 py-3 border-b border-neutral-100 flex items-center justify-between flex-wrap gap-2">
                <div>
                  <p className="font-semibold text-sm text-neutral-900">Category Settlement</p>
                  <p className="text-xs text-neutral-400 mt-0.5">
                    Deduction % = {(report.deductionPct * 100).toFixed(4)}% · applied to CSV revenue per category
                  </p>
                </div>
                <div className="flex gap-1.5 flex-wrap">
                  {(['revenue', 'deduction', 'net', 'qty'] as CatSortKey[]).map((key) => (
                    <button
                      key={key}
                      onClick={() => setCatSort(key)}
                      className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors ${
                        catSort === key ? 'bg-neutral-900 text-white' : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'
                      }`}
                    >
                      {key === 'revenue' ? 'CSV Rev' : key === 'deduction' ? 'Deduction' : key === 'net' ? 'Net' : 'Qty'}
                    </button>
                  ))}
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[580px]">
                  <thead className="bg-neutral-50">
                    <tr>
                      <th className="px-4 py-2.5 text-left text-xs font-semibold text-neutral-500">Category</th>
                      <th className="px-4 py-2.5 text-right text-xs font-semibold text-neutral-500">Qty</th>
                      <th className="px-4 py-2.5 text-right text-xs font-semibold text-neutral-500">CSV Revenue</th>
                      <th className="px-4 py-2.5 text-right text-xs font-semibold text-red-500">Deduction</th>
                      <th className="px-4 py-2.5 text-right text-xs font-semibold text-blue-600">Net Revenue</th>
                      <th className="px-4 py-2.5 text-right text-xs font-semibold text-neutral-500">Share</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-100">
                    {sortedCats.map((cat) => (
                      <tr key={cat.category} className="hover:bg-neutral-50">
                        <td className="px-4 py-2.5 font-medium text-neutral-900">{cat.category || 'Uncategorized'}</td>
                        <td className="px-4 py-2.5 text-right text-orange-600 font-bold tabular-nums">{cat.qty}</td>
                        <td className="px-4 py-2.5 text-right text-neutral-700 tabular-nums">{fmtRupeeExact(cat.grossRevenue)}</td>
                        <td className="px-4 py-2.5 text-right text-red-600 tabular-nums">−{fmtRupeeExact(cat.allocatedDeduction)}</td>
                        <td className="px-4 py-2.5 text-right text-blue-700 font-bold tabular-nums">{fmtRupeeExact(cat.netRevenue)}</td>
                        <td className="px-4 py-2.5 text-right text-neutral-400 tabular-nums">{cat.sharePct}%</td>
                      </tr>
                    ))}
                    {/* Totals row */}
                    <tr className="bg-neutral-50 font-semibold">
                      <td className="px-4 py-2.5 text-neutral-900">Total</td>
                      <td className="px-4 py-2.5 text-right text-orange-600 tabular-nums">
                        {sortedCats.reduce((s, c) => s + c.qty, 0)}
                      </td>
                      <td className="px-4 py-2.5 text-right text-neutral-700 tabular-nums">
                        {fmtRupeeExact(report.csvRevenue)}
                      </td>
                      <td className="px-4 py-2.5 text-right text-red-600 tabular-nums">
                        −{fmtRupeeExact(Math.round(sortedCats.reduce((s, c) => s + c.allocatedDeduction, 0) * 100) / 100)}
                      </td>
                      <td className="px-4 py-2.5 text-right text-blue-700 tabular-nums">
                        {fmtRupeeExact(Math.round(sortedCats.reduce((s, c) => s + c.netRevenue, 0) * 100) / 100)}
                      </td>
                      <td className="px-4 py-2.5 text-right text-neutral-400">100%</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            {/* Item settlement table */}
            <div className="bg-white rounded-xl border border-neutral-200 overflow-hidden">
              <div className="px-4 py-3 border-b border-neutral-100 flex items-center justify-between flex-wrap gap-2">
                <p className="font-semibold text-sm text-neutral-900">
                  Item Settlement
                  {catFilter && <span className="ml-2 text-xs text-neutral-400">— filtered: {catFilter}</span>}
                </p>
                <div className="flex gap-1.5 flex-wrap">
                  {(['revenue', 'deduction', 'net', 'qty', 'name'] as ItemSortKey[]).map((key) => (
                    <button
                      key={key}
                      onClick={() => setItemSort(key)}
                      className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors ${
                        itemSort === key ? 'bg-neutral-900 text-white' : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'
                      }`}
                    >
                      {key === 'revenue' ? 'CSV Rev' : key === 'deduction' ? 'Deduction' : key === 'net' ? 'Net' : key === 'qty' ? 'Qty' : 'Name'}
                    </button>
                  ))}
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[620px]">
                  <thead className="bg-neutral-50">
                    <tr>
                      <th className="px-4 py-2.5 text-left text-xs font-semibold text-neutral-500">Item</th>
                      <th className="px-4 py-2.5 text-left text-xs font-semibold text-neutral-500">Category</th>
                      <th className="px-4 py-2.5 text-right text-xs font-semibold text-neutral-500">Qty</th>
                      <th className="px-4 py-2.5 text-right text-xs font-semibold text-neutral-500">CSV Revenue</th>
                      <th className="px-4 py-2.5 text-right text-xs font-semibold text-red-500">Deduction</th>
                      <th className="px-4 py-2.5 text-right text-xs font-semibold text-blue-600">Net Revenue</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-100">
                    {sortedItems.map((item) => (
                      <tr key={`${item.itemName}__${item.category}`} className="hover:bg-neutral-50">
                        <td className="px-4 py-2.5 font-medium text-neutral-900 max-w-[160px] truncate">{item.itemName}</td>
                        <td className="px-4 py-2.5 text-neutral-400 text-xs max-w-[100px] truncate">{item.category}</td>
                        <td className="px-4 py-2.5 text-right font-bold text-orange-600 tabular-nums">{item.qty}</td>
                        <td className="px-4 py-2.5 text-right text-neutral-700 tabular-nums">{fmtRupeeExact(item.grossRevenue)}</td>
                        <td className="px-4 py-2.5 text-right text-red-600 tabular-nums">−{fmtRupeeExact(item.allocatedDeduction)}</td>
                        <td className="px-4 py-2.5 text-right text-blue-700 font-bold tabular-nums">{fmtRupeeExact(item.netRevenue)}</td>
                      </tr>
                    ))}
                    {sortedItems.length === 0 && (
                      <tr>
                        <td colSpan={6} className="px-4 py-8 text-center text-sm text-neutral-400">
                          No items match the current filter.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
