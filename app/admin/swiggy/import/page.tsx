'use client';

import { useState, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { requireAdmin } from '@/lib/roleGuard';
import NativeDateField from '@/components/ui/NativeDateField';
import { parseSwiggyCsv, type ParsedSwiggyItem } from '@/lib/swiggyCsvParser';
import {
  checkSwiggyDateOverlap,
  deleteSwiggyImportAndData,
  importSwiggyCsv,
  resolveSwiggyItems,
  type OverlapResult,
  type SwiggyImport,
  type ResolvedSwiggyItem,
} from '@/services/swiggyService';

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

type Step = 'upload' | 'resolving' | 'preview' | 'conflict' | 'importing' | 'done';

interface ParsedState {
  rawItems: ParsedSwiggyItem[];
  resolvedItems: ResolvedSwiggyItem[];
  reportStartDate: string;
  reportEndDate: string;
  fileName: string;
  ordersParsed: number;
  ordersSkipped: number;
  errors: string[];
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function SwiggyImportPage() {
  const router = useRouter();
  const { authenticated, loading, role } = requireAdmin();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [step, setStep]               = useState<Step>('upload');
  const [isDragging, setIsDragging]   = useState(false);
  const [parsed, setParsed]           = useState<ParsedState | null>(null);
  const [overlap, setOverlap]         = useState<OverlapResult | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [manualStart, setManualStart] = useState('');
  const [manualEnd, setManualEnd]     = useState('');

  // ── File processing ──────────────────────────────────────────────────────

  const processFile = useCallback(async (file: File) => {
    setImportError(null);
    setStep('resolving');
    const text = await file.text();
    const result = parseSwiggyCsv(text);

    if (result.errors.length > 0 && result.items.length === 0) {
      setImportError(result.errors.join('\n'));
      setStep('upload');
      return;
    }

    try {
      const resolvedItems = await resolveSwiggyItems(result.items);
      setParsed({
        rawItems: result.items,
        resolvedItems,
        reportStartDate: result.reportStartDate ?? '',
        reportEndDate:   result.reportEndDate ?? '',
        fileName: file.name,
        ordersParsed: result.ordersParsed,
        ordersSkipped: result.ordersSkipped,
        errors: result.errors,
      });
      setManualStart(result.reportStartDate ?? '');
      setManualEnd(result.reportEndDate ?? '');
      setStep('preview');
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Failed to resolve item categories.');
      setStep('upload');
    }
  }, []);

  const onFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) await processFile(file);
    },
    [processFile],
  );

  const onDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const file = e.dataTransfer.files?.[0];
      if (file && file.name.endsWith('.csv')) await processFile(file);
    },
    [processFile],
  );

  // ── Confirm (check overlap, then import or show conflict) ────────────────

  const handleConfirm = async () => {
    if (!parsed) return;
    const start = manualStart || parsed.reportStartDate;
    const end   = manualEnd   || parsed.reportEndDate;

    if (!start || !end) {
      setImportError('Please enter the report start and end dates.');
      return;
    }
    if (start > end) {
      setImportError('Start date must be before end date.');
      return;
    }

    setStep('importing');
    setImportError(null);

    try {
      const ov = await checkSwiggyDateOverlap(start, end);
      if (ov.type !== 'none') {
        setOverlap(ov);
        setStep('conflict');
        return;
      }
      await doImport(start, end);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Import failed.');
      setStep('preview');
    }
  };

  const handleOverride = async () => {
    if (!parsed || !overlap) return;
    const start = manualStart || parsed.reportStartDate;
    const end   = manualEnd   || parsed.reportEndDate;

    setStep('importing');
    setImportError(null);

    try {
      for (const imp of overlap.conflictingImports) {
        await deleteSwiggyImportAndData(imp.id);
      }
      const overriddenId = overlap.conflictingImports[0]?.id;
      await doImport(start, end, overriddenId);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Override failed.');
      setStep('conflict');
    }
  };

  const doImport = async (start: string, end: string, overriddenImportId?: string) => {
    if (!parsed) return;
    await importSwiggyCsv({
      fileName: parsed.fileName,
      reportStartDate: start,
      reportEndDate: end,
      items: parsed.resolvedItems,
      ordersParsed: parsed.ordersParsed,
      ordersSkipped: parsed.ordersSkipped,
      ...(overriddenImportId ? { overriddenImportId } : {}),
    });
    setStep('done');
  };

  const reset = () => {
    setParsed(null);
    setOverlap(null);
    setImportError(null);
    setManualStart('');
    setManualEnd('');
    setStep('upload');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // ── Auth guard ───────────────────────────────────────────────────────────

  if (loading) {
    return <main className="min-h-screen bg-neutral-50 px-4 py-10 text-sm text-neutral-400">Checking session…</main>;
  }
  if (!authenticated || role !== 'admin') return null;

  // ── Render ───────────────────────────────────────────────────────────────

  const effectiveStart = manualStart || parsed?.reportStartDate || '';
  const effectiveEnd   = manualEnd   || parsed?.reportEndDate   || '';
  const unmatchedCount = parsed ? new Set(
    parsed.resolvedItems.filter((i) => i.categorySource === 'unmatched').map((i) => i.itemName),
  ).size : 0;

  return (
    <div className="min-h-screen bg-neutral-50 flex flex-col">
      {/* Header */}
      <header className="flex-shrink-0 bg-white border-b border-neutral-200 px-4 py-3 flex items-center gap-3">
        <button
          onClick={() => (step === 'upload' ? router.back() : reset())}
          className="p-1.5 rounded hover:bg-neutral-100 text-neutral-500"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
          </svg>
        </button>
        <h1 className="font-bold text-lg text-neutral-900">
          {step === 'done' ? 'Import Complete' : 'Upload Past Orders CSV'}
        </h1>
      </header>

      <div className="flex-1 overflow-y-auto p-4 max-w-2xl mx-auto w-full space-y-4">

        {/* ── UPLOAD STEP ── */}
        {step === 'upload' && (
          <>
            {importError && (
              <div className="rounded-xl bg-red-50 border border-red-200 p-4 text-sm text-red-700 whitespace-pre-line">
                {importError}
              </div>
            )}

            <div
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={onDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`rounded-2xl border-2 border-dashed p-10 text-center cursor-pointer transition-colors ${
                isDragging
                  ? 'border-orange-400 bg-orange-50'
                  : 'border-neutral-300 bg-white hover:border-orange-300 hover:bg-orange-50/40'
              }`}
            >
              <div className="mx-auto w-12 h-12 rounded-xl bg-orange-100 flex items-center justify-center mb-3">
                <svg className="w-6 h-6 text-orange-600" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" />
                </svg>
              </div>
              <p className="font-semibold text-neutral-900">Drop your CSV here, or click to browse</p>
              <p className="text-sm text-neutral-400 mt-1">Swiggy Past Orders Report (.csv)</p>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              onChange={onFileChange}
              className="hidden"
            />

            <div className="rounded-xl bg-white border border-neutral-200 p-4 space-y-1 text-sm text-neutral-600">
              <p className="font-semibold text-neutral-800 mb-2">Expected report</p>
              <p>Swiggy Partner Dashboard → Orders → <span className="font-mono text-xs bg-neutral-100 px-1 py-0.5 rounded">Past Orders</span> export. Only <span className="font-mono text-xs bg-neutral-100 px-1 py-0.5 rounded">delivered</span> orders are counted.</p>
              <p className="text-neutral-400">Swiggy doesn&apos;t label item categories in this file — new items show as &quot;Uncategorized&quot; until you map them once under Item → Category Map.</p>
            </div>
          </>
        )}

        {/* ── RESOLVING ── */}
        {step === 'resolving' && (
          <div className="flex flex-col items-center justify-center py-20 gap-4">
            <div className="w-12 h-12 border-4 border-neutral-200 border-t-orange-500 rounded-full animate-spin" />
            <p className="text-sm text-neutral-500">Reading file &amp; matching item categories…</p>
          </div>
        )}

        {/* ── PREVIEW STEP ── */}
        {step === 'preview' && parsed && (
          <>
            {parsed.errors.length > 0 && (
              <div className="rounded-xl bg-yellow-50 border border-yellow-200 p-4 text-sm text-yellow-800">
                <p className="font-semibold mb-1">Warnings</p>
                {parsed.errors.map((e, i) => <p key={i}>{e}</p>)}
              </div>
            )}

            {unmatchedCount > 0 && (
              <div className="rounded-xl bg-amber-50 border border-amber-200 p-4 text-sm text-amber-800">
                <p className="font-semibold">{unmatchedCount} item{unmatchedCount > 1 ? 's' : ''} could not be matched to a category</p>
                <p className="text-xs mt-1">They&apos;ll import as &quot;Uncategorized&quot;. You can map them any time from the Item → Category Map page — it&apos;ll apply to this and future imports.</p>
              </div>
            )}

            {/* File info */}
            <div className="rounded-xl bg-white border border-neutral-200 p-4 space-y-3">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-green-100 flex items-center justify-center flex-shrink-0">
                  <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                  </svg>
                </div>
                <div className="min-w-0">
                  <p className="font-semibold text-sm text-neutral-900 truncate">{parsed.fileName}</p>
                  <p className="text-xs text-neutral-400">
                    {parsed.ordersParsed} delivered orders · {new Set(parsed.resolvedItems.map((i) => i.itemName)).size} unique items
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2 pt-1">
                <div className="rounded-lg bg-neutral-50 p-2.5 text-center">
                  <p className="text-lg font-bold text-neutral-900">{parsed.ordersParsed}</p>
                  <p className="text-xs text-neutral-400">Orders</p>
                </div>
                <div className="rounded-lg bg-neutral-50 p-2.5 text-center">
                  <p className="text-lg font-bold text-orange-600">
                    {parsed.resolvedItems.reduce((s, i) => s + i.quantity, 0)}
                  </p>
                  <p className="text-xs text-neutral-400">Qty Sold</p>
                </div>
                <div className="rounded-lg bg-neutral-50 p-2.5 text-center">
                  <p className="text-lg font-bold text-emerald-600">
                    {fmtRupee(parsed.resolvedItems.reduce((s, i) => s + i.revenue, 0))}
                  </p>
                  <p className="text-xs text-neutral-400">Revenue (pre-GST)</p>
                </div>
              </div>
            </div>

            {/* Date range */}
            <div className="rounded-xl bg-white border border-neutral-200 p-4 space-y-3">
              <p className="font-semibold text-sm text-neutral-900">Report Date Range</p>
              {!parsed.reportStartDate && (
                <p className="text-xs text-amber-600 bg-amber-50 rounded-lg px-3 py-2">
                  Date range not detected in file. Please enter manually.
                </p>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-neutral-500 mb-1 block">Start Date</label>
                  <NativeDateField value={manualStart} onChange={(e) => setManualStart(e.target.value)} />
                </div>
                <div>
                  <label className="text-xs text-neutral-500 mb-1 block">End Date</label>
                  <NativeDateField value={manualEnd} onChange={(e) => setManualEnd(e.target.value)} />
                </div>
              </div>
            </div>

            {/* Item preview table — grouped by item, totals across all days */}
            {(() => {
              const grouped = new Map<string, { category: string; qty: number; revenue: number; source: string }>();
              for (const row of parsed.resolvedItems) {
                const cur = grouped.get(row.itemName) ?? { category: row.category, qty: 0, revenue: 0, source: row.categorySource };
                grouped.set(row.itemName, { category: row.category, qty: cur.qty + row.quantity, revenue: cur.revenue + row.revenue, source: row.categorySource });
              }
              const rows = Array.from(grouped.entries())
                .map(([itemName, d]) => ({ itemName, ...d }))
                .sort((a, b) => b.revenue - a.revenue);

              return (
                <div className="rounded-xl bg-white border border-neutral-200 overflow-hidden">
                  <div className="px-4 py-3 border-b border-neutral-100 flex items-center justify-between">
                    <p className="font-semibold text-sm text-neutral-900">Preview — Items (totals for period)</p>
                    <p className="text-xs text-neutral-400">{rows.length} items</p>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-neutral-50">
                        <tr>
                          <th className="px-4 py-2.5 text-left text-xs font-semibold text-neutral-500">Item</th>
                          <th className="px-4 py-2.5 text-left text-xs font-semibold text-neutral-500">Category</th>
                          <th className="px-4 py-2.5 text-right text-xs font-semibold text-neutral-500">Total Qty</th>
                          <th className="px-4 py-2.5 text-right text-xs font-semibold text-neutral-500">Total Revenue</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-neutral-100">
                        {rows.map((item) => (
                          <tr key={item.itemName} className="hover:bg-neutral-50">
                            <td className="px-4 py-2.5 font-medium text-neutral-900 max-w-[160px] truncate">{item.itemName}</td>
                            <td className="px-4 py-2.5 max-w-[140px] truncate">
                              <span className={item.source === 'unmatched' ? 'text-amber-600 font-medium' : 'text-neutral-500'}>
                                {item.category || '—'}
                              </span>
                            </td>
                            <td className="px-4 py-2.5 text-right text-orange-600 font-bold tabular-nums">{item.qty}</td>
                            <td className="px-4 py-2.5 text-right text-neutral-600 tabular-nums">{fmtRupee(item.revenue)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })()}

            {importError && (
              <div className="rounded-xl bg-red-50 border border-red-200 p-4 text-sm text-red-700">
                {importError}
              </div>
            )}

            <div className="flex gap-3">
              <button
                onClick={reset}
                className="flex-1 py-3 rounded-xl border border-neutral-300 text-sm font-semibold text-neutral-600 hover:bg-neutral-100 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirm}
                disabled={!effectiveStart || !effectiveEnd}
                className="flex-1 py-3 rounded-xl bg-neutral-900 text-white text-sm font-semibold hover:bg-neutral-800 disabled:opacity-40 transition-colors"
              >
                Confirm Import
              </button>
            </div>
          </>
        )}

        {/* ── CONFLICT STEP ── */}
        {step === 'conflict' && overlap && parsed && (
          <>
            <div className={`rounded-xl border p-4 ${overlap.type === 'exact' ? 'bg-red-50 border-red-200' : 'bg-amber-50 border-amber-200'}`}>
              <div className="flex items-start gap-3">
                <svg className={`w-5 h-5 flex-shrink-0 mt-0.5 ${overlap.type === 'exact' ? 'text-red-500' : 'text-amber-500'}`} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
                </svg>
                <div>
                  <p className={`font-semibold text-sm ${overlap.type === 'exact' ? 'text-red-800' : 'text-amber-800'}`}>
                    {overlap.type === 'exact' ? 'This report already exists.' : 'Date range overlaps with existing data.'}
                  </p>
                  <p className={`text-xs mt-1 ${overlap.type === 'exact' ? 'text-red-700' : 'text-amber-700'}`}>
                    {overlap.type === 'exact'
                      ? 'An import with the exact same date range has already been saved.'
                      : 'The incoming date range overlaps with one or more existing imports.'}
                  </p>
                </div>
              </div>
            </div>

            <div className="rounded-xl bg-white border border-neutral-200 p-4 space-y-3 text-sm">
              <p className="font-semibold text-neutral-800">Incoming</p>
              <div className="flex items-center justify-between text-neutral-600 bg-neutral-50 rounded-lg px-3 py-2">
                <span>{parsed.fileName}</span>
                <span className="tabular-nums">{fmtDate(effectiveStart)} → {fmtDate(effectiveEnd)}</span>
              </div>

              <p className="font-semibold text-neutral-800 pt-1">Conflicting import{overlap.conflictingImports.length > 1 ? 's' : ''}</p>
              {overlap.conflictingImports.map((imp) => (
                <div key={imp.id} className="flex items-center justify-between text-neutral-600 bg-red-50 rounded-lg px-3 py-2">
                  <span className="truncate max-w-[160px]">{imp.fileName}</span>
                  <span className="tabular-nums text-xs">{fmtDate(imp.reportStartDate)} → {fmtDate(imp.reportEndDate)}</span>
                </div>
              ))}
            </div>

            <p className="text-sm text-neutral-500 text-center">
              Overriding will <strong>permanently delete</strong> the conflicting import{overlap.conflictingImports.length > 1 ? 's' : ''} and replace with this new data.
            </p>

            <div className="flex gap-3">
              <button
                onClick={reset}
                className="flex-1 py-3 rounded-xl border border-neutral-300 text-sm font-semibold text-neutral-600 hover:bg-neutral-100 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleOverride}
                className="flex-1 py-3 rounded-xl bg-red-600 text-white text-sm font-semibold hover:bg-red-700 transition-colors"
              >
                {overlap.type === 'exact' ? 'Override Existing Import' : 'Override Overlapping Dates'}
              </button>
            </div>
          </>
        )}

        {/* ── IMPORTING ── */}
        {step === 'importing' && (
          <div className="flex flex-col items-center justify-center py-20 gap-4">
            <div className="w-12 h-12 border-4 border-neutral-200 border-t-orange-500 rounded-full animate-spin" />
            <p className="text-sm text-neutral-500">Saving data…</p>
          </div>
        )}

        {/* ── DONE ── */}
        {step === 'done' && (
          <div className="flex flex-col items-center text-center py-12 gap-4">
            <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center">
              <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
              </svg>
            </div>
            <div>
              <p className="text-xl font-black text-neutral-900">Import Successful</p>
              <p className="text-sm text-neutral-500 mt-1">
                {parsed?.ordersParsed} orders saved for {fmtDate(effectiveStart)} – {fmtDate(effectiveEnd)}
              </p>
            </div>
            <div className="flex gap-3 mt-2">
              <button
                onClick={reset}
                className="px-5 py-2.5 rounded-xl border border-neutral-300 text-sm font-semibold text-neutral-600 hover:bg-neutral-100 transition-colors"
              >
                Import Another
              </button>
              <button
                onClick={() => router.push('/admin/swiggy/reports')}
                className="px-5 py-2.5 rounded-xl bg-neutral-900 text-white text-sm font-semibold hover:bg-neutral-800 transition-colors"
              >
                Enter Payout &amp; View Report
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
