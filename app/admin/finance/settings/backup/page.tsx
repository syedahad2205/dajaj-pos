"use client";

import { useState } from "react";
import { requireAdmin } from "@/lib/roleGuard";
import { auth } from "@/lib/firebase";
import FinanceNav from "@/components/finance/FinanceNav";
import { BACKUP_COLLECTIONS, checkBackupConsistency, type CollectionDiff, type ParsedBackup, type WireDoc } from "@/lib/financeBackup";
import {
  applyRestorePlan,
  backupFileName,
  buildBackupBlob,
  buildRestorePlan,
  diffAgainstCurrent,
  downloadBlob,
  fetchAllFinanceData,
  parseBackupFile,
  recordRestore,
} from "@/lib/financeBackupClient";

const LABELS = new Map(BACKUP_COLLECTIONS.map((c) => [c.name, c.label]));

function hasChanges(diff: CollectionDiff, mirror: boolean) {
  return diff.added.length > 0 || diff.changed.length > 0 || (mirror && diff.removed.length > 0);
}

export default function FinanceBackupPage() {
  const { authenticated, loading, role } = requireAdmin();

  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [fileName, setFileName] = useState("");
  const [parsed, setParsed] = useState<ParsedBackup | null>(null);
  const [diffs, setDiffs] = useState<CollectionDiff[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [mirror, setMirror] = useState(true);
  const [confirmText, setConfirmText] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

  if (loading) {
    return <main className="min-h-screen bg-[#fff8ed] px-4 py-10 text-slate-900">Checking your session…</main>;
  }
  if (!authenticated || role !== "admin") return null;

  const exportedBy = auth.currentUser?.email ?? "Admin";

  const downloadSnapshot = async (data: Record<string, WireDoc[]>, prefix: string) => {
    setProgress("Building spreadsheet…");
    downloadBlob(await buildBackupBlob(data, exportedBy), backupFileName(prefix));
  };

  const fetchWithProgress = (verb: string) =>
    fetchAllFinanceData((label, done, total) => setProgress(`${verb} ${label}… (${done}/${total})`));

  const handleExport = async () => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const data = await fetchWithProgress("Reading");
      await downloadSnapshot(data, "dajaj-finance-backup");
      const total = Object.values(data).reduce((sum, docs) => sum + docs.length, 0);
      setNotice(`Backup downloaded — ${total.toLocaleString()} records across ${BACKUP_COLLECTIONS.length} collections.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Export failed.");
    } finally {
      setBusy(false);
      setProgress("");
    }
  };

  const resetImport = () => {
    setParsed(null);
    setDiffs([]);
    setWarnings([]);
    setSelected(new Set());
    setConfirmText("");
    setExpanded(null);
  };

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    resetImport();
    setFileName(file.name);
    setBusy(true);
    setError("");
    setNotice("");
    try {
      setProgress("Reading the spreadsheet…");
      const result = await parseBackupFile(file);
      setParsed(result);
      if (result.errors.length > 0) return;

      const current = await fetchWithProgress("Comparing with current");
      const nextDiffs = diffAgainstCurrent(result, current);
      setDiffs(nextDiffs);
      setWarnings(checkBackupConsistency(result.collections));
      setSelected(new Set(nextDiffs.filter((d) => hasChanges(d, true)).map((d) => d.collection)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read this backup.");
    } finally {
      setBusy(false);
      setProgress("");
    }
  };

  const toggle = (name: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  const handleRestore = async () => {
    if (!parsed || confirmText !== "RESTORE") return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      // Fresh read right before writing: it is both the safety backup and the
      // baseline the writes are computed from, so nothing entered since the
      // preview is overwritten without being saved first.
      const current = await fetchWithProgress("Saving a safety backup of");
      await downloadSnapshot(current, "dajaj-finance-before-restore");

      const plan = buildRestorePlan(parsed, current, selected, mirror);
      const total = plan.reduce((sum, s) => sum + s.upserts.length + s.deletes.length, 0);
      if (total === 0) {
        setNotice("Nothing to change — the selected collections already match the spreadsheet.");
        return;
      }
      await applyRestorePlan(plan, (done, all, collection) => setProgress(`Restoring ${LABELS.get(collection) ?? collection}… ${done}/${all}`));

      const summary = plan.map((s) => `${s.collection}: ${s.upserts.length} written, ${s.deletes.length} deleted`);
      await recordRestore(fileName, parsed.meta.exportedAt, summary);
      setNotice(`Restore complete — ${summary.join(" · ")}. A safety backup of the previous state was downloaded first.`);
      resetImport();
      setFileName("");
    } catch (err) {
      setError(
        `${err instanceof Error ? err.message : "Restore failed."} Some collections may be partly restored — running the same restore again is safe and finishes the job. The safety backup downloaded before writing has the previous state.`,
      );
    } finally {
      setBusy(false);
      setProgress("");
    }
  };

  const selectedDiffs = diffs.filter((d) => selected.has(d.collection));
  const pending = selectedDiffs.reduce(
    (acc, d) => ({ add: acc.add + d.added.length, change: acc.change + d.changed.length, remove: acc.remove + (mirror ? d.removed.length : 0) }),
    { add: 0, change: 0, remove: 0 },
  );
  const missingFromFile = parsed && parsed.errors.length === 0 ? BACKUP_COLLECTIONS.filter((c) => !parsed.collections[c.name]) : [];

  return (
    <main className="min-h-screen bg-[#fff8ed] px-4 py-8 text-slate-900">
      <div className="mx-auto max-w-4xl space-y-5">
        <header className="rounded-[28px] border border-orange-200 bg-white p-6 shadow-sm">
          <p className="text-sm font-semibold uppercase tracking-[0.28em] text-orange-600">Finance · Settings</p>
          <h1 className="mt-1 text-3xl font-black">Backup &amp; Restore</h1>
          <p className="mt-2 text-sm text-slate-600">
            Download every finance record — accounts and opening balances, all ledger transactions, every Daily Closing with its
            expenses and deposits, categories, vendors, defaults, Quick Entry, settlements and the audit log — as one Excel
            spreadsheet. Upload that spreadsheet here to put the finance system back exactly as it was.
          </p>
          <div className="mt-5">
            <FinanceNav />
          </div>
        </header>

        {progress ? <p className="rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm font-medium text-sky-800">{progress}</p> : null}
        {notice ? <p className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700">{notice}</p> : null}
        {error ? <p className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">{error}</p> : null}

        <section className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-black">Export</h2>
          <p className="mt-1 text-sm text-slate-600">
            Reads every finance record once (counts toward the daily Firestore read quota), then downloads an .xlsx file.
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={handleExport}
            className="mt-4 rounded-2xl bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50"
          >
            Download full finance backup
          </button>
        </section>

        <section className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-black">Restore from a backup</h2>
          <p className="mt-1 text-sm text-slate-600">
            Choose a backup spreadsheet. Nothing is written until you review the changes and confirm.
          </p>
          <label className="mt-4 inline-flex cursor-pointer items-center gap-3 rounded-2xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">
            <input
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="hidden"
              disabled={busy}
              onChange={(e) => {
                void handleFile(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
            {fileName ? `Selected: ${fileName}` : "Choose backup file…"}
          </label>

          {parsed && parsed.errors.length > 0 ? (
            <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              <p className="font-semibold">This file can&apos;t be restored until these are fixed:</p>
              <ul className="mt-1 max-h-64 list-disc space-y-0.5 overflow-y-auto pl-5">
                {parsed.errors.slice(0, 200).map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
              {parsed.errors.length > 200 ? <p className="mt-1">…and {parsed.errors.length - 200} more.</p> : null}
            </div>
          ) : null}

          {diffs.length > 0 ? (
            <div className="mt-5 space-y-4">
              {parsed?.meta.exportedAt ? (
                <p className="text-sm text-slate-600">
                  Backup taken {parsed.meta.exportedAt} by {parsed.meta.exportedBy ?? "unknown"}.
                </p>
              ) : null}

              <div className="overflow-x-auto rounded-2xl border border-slate-200">
                <table className="w-full min-w-[640px] text-sm">
                  <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-3 py-2">Restore</th>
                      <th className="px-3 py-2">Collection</th>
                      <th className="px-3 py-2 text-right">In sheet</th>
                      <th className="px-3 py-2 text-right">Now</th>
                      <th className="px-3 py-2 text-right">New</th>
                      <th className="px-3 py-2 text-right">Changed</th>
                      <th className="px-3 py-2 text-right">Not in sheet</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {diffs.map((d) => (
                      <tr key={d.collection} className={hasChanges(d, mirror) ? "" : "text-slate-400"}>
                        <td className="px-3 py-2">
                          <input type="checkbox" checked={selected.has(d.collection)} disabled={busy} onChange={() => toggle(d.collection)} />
                        </td>
                        <td className="px-3 py-2">
                          <button type="button" className="text-left font-semibold hover:underline" onClick={() => setExpanded(expanded === d.collection ? null : d.collection)}>
                            {LABELS.get(d.collection)}
                          </button>
                          <span className="block text-xs text-slate-400">{d.collection}</span>
                        </td>
                        <td className="px-3 py-2 text-right">{d.inSheet}</td>
                        <td className="px-3 py-2 text-right">{d.inDatabase}</td>
                        <td className="px-3 py-2 text-right">{d.added.length || "—"}</td>
                        <td className="px-3 py-2 text-right">{d.changed.length || "—"}</td>
                        <td className={`px-3 py-2 text-right ${mirror && d.removed.length > 0 ? "font-semibold text-rose-600" : ""}`}>
                          {d.removed.length || "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {expanded ? (
                (() => {
                  const d = diffs.find((x) => x.collection === expanded)!;
                  return (
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-700">
                      <p className="font-semibold">{LABELS.get(d.collection)} — details</p>
                      {d.added.length > 0 ? <p className="mt-1">New: {d.added.slice(0, 30).join(", ")}{d.added.length > 30 ? ` …+${d.added.length - 30}` : ""}</p> : null}
                      {d.changed.slice(0, 30).map((c) => (
                        <p key={c.id} className="mt-1">
                          Changed <span className="font-mono">{c.id}</span>: {c.fields.join(", ")}
                        </p>
                      ))}
                      {d.changed.length > 30 ? <p className="mt-1">…and {d.changed.length - 30} more changed.</p> : null}
                      {d.removed.length > 0 ? (
                        <p className="mt-1">
                          In the database but not in the sheet: {d.removed.slice(0, 30).join(", ")}
                          {d.removed.length > 30 ? ` …+${d.removed.length - 30}` : ""}
                        </p>
                      ) : null}
                      {!hasChanges(d, true) ? <p className="mt-1">Identical to the current data.</p> : null}
                    </div>
                  );
                })()
              ) : null}

              {missingFromFile.length > 0 ? (
                <p className="text-sm text-slate-500">
                  Not in this file (left untouched): {missingFromFile.map((c) => c.label).join(", ")}.
                </p>
              ) : null}

              {warnings.length > 0 ? (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                  <p className="font-semibold">Consistency checks on the spreadsheet&apos;s own data ({warnings.length}):</p>
                  <ul className="mt-1 max-h-48 list-disc space-y-0.5 overflow-y-auto pl-5">
                    {warnings.slice(0, 100).map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                  <p className="mt-2 text-xs">These are restored as-is. Fix them in the sheet first if they are not intended.</p>
                </div>
              ) : null}

              <label className="flex items-start gap-2 text-sm text-slate-700">
                <input type="checkbox" className="mt-1" checked={mirror} disabled={busy} onChange={(e) => setMirror(e.target.checked)} />
                <span>
                  <span className="font-semibold">Restore exactly</span> — also delete records that exist now but are not in the sheet
                  (for the ticked collections). Untick to only add and overwrite.
                </span>
              </label>

              <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4">
                <p className="text-sm font-semibold text-rose-800">
                  This will add {pending.add}, overwrite {pending.change} and delete {pending.remove} record(s).
                </p>
                <p className="mt-1 text-xs text-rose-700">
                  A safety backup of the current data downloads first. Ask everyone to stop entering finance data until it finishes.
                  Type RESTORE to continue.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <input
                    value={confirmText}
                    onChange={(e) => setConfirmText(e.target.value)}
                    placeholder="RESTORE"
                    disabled={busy}
                    className="rounded-xl border border-rose-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-rose-200"
                  />
                  <button
                    type="button"
                    disabled={busy || confirmText !== "RESTORE" || selected.size === 0 || pending.add + pending.change + pending.remove === 0}
                    onClick={handleRestore}
                    className="rounded-xl bg-rose-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-rose-700 disabled:opacity-50"
                  >
                    Restore selected
                  </button>
                </div>
              </div>
            </div>
          ) : null}
        </section>
      </div>
    </main>
  );
}
