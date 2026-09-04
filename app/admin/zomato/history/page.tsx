'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { requireAdmin } from '@/lib/roleGuard';
import NativeDateField from '@/components/ui/NativeDateField';
import {
  getZomatoImports,
  hardDeleteImport,
  recalculateAnalytics,
  getItemSalesForImport,
  saveSettlement,
  type ZomatoImport,
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

function fmtTimestamp(ts: { toDate?: () => Date } | null | undefined) {
  if (!ts?.toDate) return '—';
  return ts.toDate().toLocaleDateString('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

/** Returns the settlement status of an import for display purposes */
function settlementStatus(imp: ZomatoImport): 'full' | 'legacy' | 'none' {
  if (imp.netOrderValue !== undefined && imp.finalPayout !== undefined) return 'full';
  if (imp.finalPayout !== undefined) return 'legacy'; // old record: payout but no NOV
  return 'none';
}

// ── Detail drawer ─────────────────────────────────────────────────────────────

function ImportDetailDrawer({
  imp,
  onClose,
}: {
  imp: ZomatoImport;
  onClose: () => void;
}) {
  const [items, setItems]     = useState<Awaited<ReturnType<typeof getItemSalesForImport>>>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getItemSalesForImport(imp.id)
      .then((rows) => setItems(rows.sort((a, b) => b.revenue - a.revenue)))
      .finally(() => setLoading(false));
  }, [imp.id]);

  return (
    <div className="fixed inset-0 z-40 flex">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative ml-auto w-full max-w-md bg-white h-full flex flex-col shadow-xl">
        <div className="px-4 py-3 border-b border-neutral-200 flex items-center justify-between">
          <div>
            <p className="font-semibold text-sm text-neutral-900 truncate max-w-[220px]">{imp.fileName}</p>
            <p className="text-xs text-neutral-400">{fmtDate(imp.reportStartDate)} – {fmtDate(imp.reportEndDate)}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded hover:bg-neutral-100 text-neutral-500">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="overflow-y-auto flex-1">
          {loading ? (
            <div className="flex justify-center py-12">
              <div className="w-8 h-8 border-4 border-neutral-200 border-t-orange-500 rounded-full animate-spin" />
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-neutral-50 sticky top-0">
                <tr>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold text-neutral-500">Item</th>
                  <th className="px-4 py-2.5 text-right text-xs font-semibold text-neutral-500">Qty</th>
                  <th className="px-4 py-2.5 text-right text-xs font-semibold text-neutral-500">Revenue</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {items.map((item) => (
                  <tr key={item.id} className="hover:bg-neutral-50">
                    <td className="px-4 py-2.5">
                      <p className="font-medium text-neutral-900 truncate max-w-[180px]">{item.itemName}</p>
                      <p className="text-xs text-neutral-400">{item.category}</p>
                    </td>
                    <td className="px-4 py-2.5 text-right font-bold text-orange-600 tabular-nums">{item.quantitySold}</td>
                    <td className="px-4 py-2.5 text-right text-neutral-600 tabular-nums">{fmtRupee(item.revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Inline settlement form ────────────────────────────────────────────────────

function SettlementForm({
  imp,
  onSaved,
}: {
  imp: ZomatoImport;
  onSaved: () => void;
}) {
  const isLegacy = settlementStatus(imp) === 'legacy';
  const isFull   = settlementStatus(imp) === 'full';

  const [nov,      setNov]      = useState(imp.netOrderValue !== undefined ? String(imp.netOrderValue) : '');
  const [payout,   setPayout]   = useState(imp.finalPayout   !== undefined ? String(imp.finalPayout)   : '');
  const [transferDate, setTransferDate] = useState(imp.payoutReceivedDate || todayIso());
  const [saving,   setSaving]   = useState(false);
  const [err,      setErr]      = useState<string | null>(null);
  const [expanded, setExpanded] = useState(!isFull); // collapse if already settled
  const [syncing,  setSyncing]  = useState(false);
  const [syncErr,  setSyncErr]  = useState<string | null>(null);

  const novNum    = parseFloat(nov);
  const payoutNum = parseFloat(payout);
  const preview   = !isNaN(novNum) && !isNaN(payoutNum) && novNum > 0 && payoutNum >= 0;
  const previewDed = preview ? Math.round((novNum - payoutNum) * 100) / 100 : null;
  const previewPct = preview && novNum > 0 ? (novNum - payoutNum) / novNum * 100 : null;

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
      setErr(e instanceof Error ? e.message : 'Failed to save.');
    } finally {
      setSaving(false);
    }
  };

  const handleSyncToFinance = async () => {
    setSyncErr(null);
    setSyncing(true);
    try {
      await postZomatoSettlementToFinance(imp.id);
      onSaved();
    } catch (e) {
      setSyncErr(e instanceof Error ? e.message : 'Failed to sync to Finance.');
    } finally {
      setSyncing(false);
    }
  };

  const financeWarnings = imp.financePostingWarnings ?? [];
  const financeSynced = isFull && (imp.financeTransferTransactionId || imp.financeAdjustmentTransactionId) && financeWarnings.length === 0;

  return (
    <div className="border-t border-neutral-100 pt-3 mt-1 space-y-2">
      {/* Header row */}
      <button
        className="w-full flex items-center justify-between text-left"
        onClick={() => setExpanded((v) => !v)}
      >
        <div className="flex items-center gap-2">
          <p className="text-xs font-semibold text-neutral-500 uppercase tracking-wide">Settlement Reconciliation</p>
          {isFull && (
            <span className="text-xs bg-blue-100 text-blue-700 rounded-full px-2 py-0.5 font-medium">settled</span>
          )}
          {isLegacy && (
            <span className="text-xs bg-amber-100 text-amber-700 rounded-full px-2 py-0.5 font-medium">details missing</span>
          )}
        </div>
        <svg
          className={`w-4 h-4 text-neutral-400 transition-transform ${expanded ? 'rotate-180' : ''}`}
          fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
        </svg>
      </button>

      {expanded && (
        <>
          {/* Settled summary */}
          {isFull && imp.netOrderValue !== undefined && imp.finalPayout !== undefined && (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 text-center text-xs mb-1">
              <div className="rounded-lg bg-neutral-50 px-2 py-2">
                <p className="text-neutral-400">CSV Revenue</p>
                <p className="font-bold text-neutral-700 mt-0.5">{fmtRupeeExact(imp.totalRevenue)}</p>
              </div>
              <div className="rounded-lg bg-blue-50 px-2 py-2">
                <p className="text-neutral-400">Net Order Value</p>
                <p className="font-bold text-blue-700 mt-0.5">{fmtRupeeExact(imp.netOrderValue)}</p>
              </div>
              <div className="rounded-lg bg-emerald-50 px-2 py-2">
                <p className="text-neutral-400">Final Payout</p>
                <p className="font-bold text-emerald-700 mt-0.5">{fmtRupeeExact(imp.finalPayout)}</p>
              </div>
              <div className="rounded-lg bg-red-50 px-2 py-2">
                <p className="text-neutral-400">Deduction %</p>
                <p className="font-bold text-red-600 mt-0.5">
                  {imp.deductionPct !== undefined ? `${(imp.deductionPct * 100).toFixed(3)}%` : '—'}
                </p>
              </div>
            </div>
          )}

          {/* Finance sync status */}
          {isFull && (
            <div className="rounded-lg border border-neutral-200 px-3 py-2 space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-neutral-500 uppercase tracking-wide">Finance Sync</p>
                {financeSynced ? (
                  <span className="text-xs bg-emerald-100 text-emerald-700 rounded-full px-2 py-0.5 font-medium">synced</span>
                ) : financeWarnings.length > 0 ? (
                  <span className="text-xs bg-amber-100 text-amber-700 rounded-full px-2 py-0.5 font-medium">needs attention</span>
                ) : (
                  <span className="text-xs bg-neutral-100 text-neutral-500 rounded-full px-2 py-0.5 font-medium">not synced</span>
                )}
              </div>
              {typeof imp.financeEscrowTotal === 'number' && typeof imp.financeDifference === 'number' && (
                <div className="grid grid-cols-3 gap-2 text-center text-xs">
                  <div className="rounded-lg bg-neutral-50 px-2 py-1.5">
                    <p className="text-neutral-400">Escrow Recognized</p>
                    <p className="font-bold text-neutral-700 mt-0.5">{fmtRupeeExact(imp.financeEscrowTotal)}</p>
                  </div>
                  <div className="rounded-lg bg-neutral-50 px-2 py-1.5">
                    <p className="text-neutral-400">Settlement</p>
                    <p className="font-bold text-emerald-700 mt-0.5">{fmtRupeeExact(imp.finalPayout ?? 0)}</p>
                  </div>
                  <div className="rounded-lg bg-neutral-50 px-2 py-1.5">
                    <p className="text-neutral-400">Difference</p>
                    <p className={`font-bold mt-0.5 tabular-nums ${imp.financeDifference > 0 ? 'text-red-600' : imp.financeDifference < 0 ? 'text-emerald-700' : 'text-neutral-700'}`}>
                      {imp.financeDifference > 0 ? '-' : imp.financeDifference < 0 ? '+' : ''}
                      {fmtRupeeExact(Math.abs(imp.financeDifference))}
                    </p>
                  </div>
                </div>
              )}
              {financeWarnings.length > 0 && (
                <ul className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800 list-disc pl-5 space-y-0.5">
                  {financeWarnings.map((w, i) => <li key={i}>{w}</li>)}
                </ul>
              )}
              {syncErr && <p className="text-xs text-red-600">{syncErr}</p>}
              <button
                onClick={handleSyncToFinance}
                disabled={syncing}
                className="w-full py-1.5 rounded-lg border border-neutral-300 text-xs font-semibold text-neutral-600 hover:bg-neutral-50 disabled:opacity-50 transition-colors"
              >
                {syncing ? 'Syncing…' : 'Sync to Finance'}
              </button>
            </div>
          )}

          {/* Legacy warning */}
          {isLegacy && (
            <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">
              This import was saved before the Net Order Value field was added. Please re-enter both values to recalculate settlement correctly.
            </div>
          )}

          {/* Reconciliation diff (read-only) */}
          {isFull && imp.netOrderValue !== undefined && (
            <div className="flex items-center justify-between rounded-lg bg-neutral-50 px-3 py-2 text-xs">
              <span className="text-neutral-500">Reconciliation (NOV − CSV)</span>
              <span className={`font-bold tabular-nums ${
                imp.netOrderValue >= imp.totalRevenue ? 'text-emerald-700' : 'text-red-600'
              }`}>
                {imp.netOrderValue >= imp.totalRevenue ? '+' : ''}
                {fmtRupeeExact(imp.netOrderValue - imp.totalRevenue)}
              </span>
            </div>
          )}

          {/* Input fields */}
          <div className="space-y-2 pt-1">
            <div>
              <label className="text-xs text-neutral-500 mb-1 block">Net Order Value (A) <span className="text-neutral-400">— from Zomato payout statement</span></label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-neutral-400">₹</span>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  placeholder="e.g. 13235.25"
                  value={nov}
                  onChange={(e) => setNov(e.target.value)}
                  className="w-full pl-7 pr-3 py-2 border border-neutral-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                />
              </div>
            </div>
            <div>
              <label className="text-xs text-neutral-500 mb-1 block">Final Payout Received</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-neutral-400">₹</span>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  placeholder="e.g. 12059.59"
                  value={payout}
                  onChange={(e) => setPayout(e.target.value)}
                  className="w-full pl-7 pr-3 py-2 border border-neutral-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                />
              </div>
            </div>
            <div>
              <label className="text-xs text-neutral-500 mb-1 block">Bank transfer date <span className="text-neutral-400">— when the payout left escrow</span></label>
              <NativeDateField value={transferDate} onChange={(e) => setTransferDate(e.target.value)} />
            </div>

            {/* Live preview */}
            {preview && previewDed !== null && previewPct !== null && (
              <div className="grid grid-cols-3 gap-2 text-center text-xs">
                <div className="rounded-lg bg-neutral-50 px-2 py-1.5">
                  <p className="text-neutral-400">Deductions</p>
                  <p className="font-bold text-red-600 mt-0.5">{fmtRupeeExact(previewDed)}</p>
                </div>
                <div className="rounded-lg bg-neutral-50 px-2 py-1.5">
                  <p className="text-neutral-400">Deduction %</p>
                  <p className="font-bold text-neutral-700 mt-0.5">{previewPct.toFixed(3)}%</p>
                </div>
                <div className="rounded-lg bg-neutral-50 px-2 py-1.5">
                  <p className="text-neutral-400">CSV diff</p>
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
              className="w-full py-2 rounded-lg bg-neutral-900 text-white text-xs font-semibold hover:bg-neutral-800 disabled:opacity-40 transition-colors"
            >
              {saving ? 'Saving…' : isFull ? 'Update Settlement' : 'Save Settlement'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function ZomatoHistoryPage() {
  const router = useRouter();
  const { authenticated, loading: authLoading, role } = requireAdmin();

  const [imports, setImports]       = useState<ZomatoImport[]>([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState<string | null>(null);
  const [viewingImport, setViewing] = useState<ZomatoImport | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [recalcId, setRecalcId]     = useState<string | null>(null);

  const loadImports = useCallback(async () => {
    setLoading(true);
    try {
      setImports(await getZomatoImports());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load imports.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (authenticated) loadImports();
  }, [authenticated, loadImports]);

  const handleDelete = async (imp: ZomatoImport) => {
    const confirmed = window.confirm(
      `Delete import "${imp.fileName}" (${fmtDate(imp.reportStartDate)} – ${fmtDate(imp.reportEndDate)})?\n\nThis will permanently remove all item sales records, category summaries, and item summaries for this period.`,
    );
    if (!confirmed) return;
    setDeletingId(imp.id);
    try {
      await hardDeleteImport(imp.id);
      await loadImports();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed.');
    } finally {
      setDeletingId(null);
    }
  };

  const handleRecalculate = async (imp: ZomatoImport) => {
    setRecalcId(imp.id);
    try {
      await recalculateAnalytics(imp.id);
      await loadImports();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Recalculation failed.');
    } finally {
      setRecalcId(null);
    }
  };

  if (authLoading) {
    return <main className="min-h-screen bg-neutral-50 px-4 py-10 text-sm text-neutral-400">Checking session…</main>;
  }
  if (!authenticated || role !== 'admin') return null;

  return (
    <div className="min-h-screen bg-neutral-50 flex flex-col">
      {viewingImport && (
        <ImportDetailDrawer imp={viewingImport} onClose={() => setViewing(null)} />
      )}

      {/* Header */}
      <header className="flex-shrink-0 bg-white border-b border-neutral-200 px-4 py-3 flex items-center gap-3">
        <button onClick={() => router.back()} className="p-1.5 rounded hover:bg-neutral-100 text-neutral-500">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
          </svg>
        </button>
        <h1 className="font-bold text-lg text-neutral-900">Import History</h1>
        <div className="ml-auto">
          <button
            onClick={() => router.push('/admin/zomato/import')}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-neutral-900 text-white text-sm font-semibold hover:bg-neutral-800 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            Upload
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-4 max-w-3xl mx-auto w-full space-y-3">
        {error && (
          <div className="rounded-xl bg-red-50 border border-red-200 p-4 text-sm text-red-700">{error}</div>
        )}

        {loading ? (
          <div className="flex justify-center py-12">
            <div className="w-8 h-8 border-4 border-neutral-200 border-t-orange-500 rounded-full animate-spin" />
          </div>
        ) : imports.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
            <p className="font-semibold text-neutral-600">No imports yet</p>
            <p className="text-sm text-neutral-400">Upload a Zomato CSV to get started.</p>
            <button
              onClick={() => router.push('/admin/zomato/import')}
              className="px-5 py-2.5 rounded-xl bg-neutral-900 text-white text-sm font-semibold"
            >
              Upload CSV
            </button>
          </div>
        ) : (
          imports.map((imp) => {
            const status = settlementStatus(imp);
            return (
              <div key={imp.id} className="bg-white rounded-xl border border-neutral-200 p-4 space-y-3">
                {/* Top row */}
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-sm text-neutral-900 truncate">{imp.fileName}</p>
                    <p className="text-xs text-neutral-400 mt-0.5">Imported {fmtTimestamp(imp.importedAt as any)}</p>
                    {imp.overriddenImportId && (
                      <span className="inline-flex items-center gap-1 text-xs text-amber-700 bg-amber-50 rounded px-1.5 py-0.5 mt-1">
                        Overrode previous import
                      </span>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-1 flex-shrink-0">
                    <span className="text-xs bg-green-100 text-green-700 rounded-full px-2 py-0.5 font-medium">active</span>
                    {status === 'full'   && <span className="text-xs bg-blue-100 text-blue-700 rounded-full px-2 py-0.5 font-medium">settled</span>}
                    {status === 'legacy' && <span className="text-xs bg-amber-100 text-amber-700 rounded-full px-2 py-0.5 font-medium">details missing</span>}
                  </div>
                </div>

                {/* Date range + stats */}
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 text-center">
                  <div className="rounded-lg bg-neutral-50 px-2 py-2">
                    <p className="text-xs text-neutral-400">Period</p>
                    <p className="text-xs font-semibold text-neutral-700 mt-0.5">{fmtDate(imp.reportStartDate)}</p>
                    <p className="text-xs text-neutral-400">–</p>
                    <p className="text-xs font-semibold text-neutral-700">{fmtDate(imp.reportEndDate)}</p>
                  </div>
                  <div className="rounded-lg bg-neutral-50 px-2 py-2">
                    <p className="text-xs text-neutral-400">CSV Revenue</p>
                    <p className="text-sm font-bold text-neutral-700 mt-0.5">{fmtRupee(imp.totalRevenue)}</p>
                  </div>
                  <div className="rounded-lg bg-neutral-50 px-2 py-2">
                    <p className="text-xs text-neutral-400">Qty Sold</p>
                    <p className="text-sm font-bold text-orange-600 mt-0.5">{imp.totalQuantity}</p>
                  </div>
                  <div className="rounded-lg bg-neutral-50 px-2 py-2">
                    <p className="text-xs text-neutral-400">Items</p>
                    <p className="text-sm font-bold text-neutral-900 mt-0.5">{imp.totalItems}</p>
                  </div>
                </div>

                {/* Settlement section */}
                <SettlementForm imp={imp} onSaved={loadImports} />

                {/* Actions */}
                <div className="flex gap-2 pt-1">
                  <button
                    onClick={() => setViewing(imp)}
                    className="flex-1 py-2 rounded-lg border border-neutral-300 text-xs font-semibold text-neutral-600 hover:bg-neutral-50 transition-colors"
                  >
                    View Items
                  </button>
                  <button
                    onClick={() => handleRecalculate(imp)}
                    disabled={recalcId === imp.id}
                    className="flex-1 py-2 rounded-lg border border-neutral-300 text-xs font-semibold text-neutral-600 hover:bg-neutral-50 disabled:opacity-50 transition-colors"
                  >
                    {recalcId === imp.id ? 'Recalculating…' : 'Recalculate'}
                  </button>
                  <button
                    onClick={() => handleDelete(imp)}
                    disabled={deletingId === imp.id}
                    className="py-2 px-4 rounded-lg border border-red-200 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50 transition-colors"
                  >
                    {deletingId === imp.id ? '…' : 'Delete'}
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
