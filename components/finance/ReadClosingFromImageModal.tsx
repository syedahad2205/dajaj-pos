"use client";

import { useRef, useState } from "react";
import { firebaseAuthedFetch } from "@/lib/firebaseAuthFetch";
import { formatCurrency, formatDateDisplay } from "@/lib/financeFormat";
import Modal from "@/components/finance/Modal";
import NativeSelectField from "@/components/ui/NativeSelectField";

// ─────────────────────────────────────────────────────────────────────────
// "Read from Image" for Daily Closing (spec: AI Image Reading Feature).
//
// This component NEVER writes to fin_daily_closing itself. It only calls
// the stateless analysis route (/api/finance/closing/read-image) and, once
// the Finance Manager has reviewed/edited everything, applies the result
// through the EXISTING POST /api/finance/closing/[date]/expenses route —
// the exact same endpoint the page's own "Add Expenses" modal uses. The
// "Closing"/date fields are only ever handed back to the parent page via
// callbacks so ITS existing Closing Cash field / date picker populate —
// no separate save path, no lock/close side effect from this modal.
// ─────────────────────────────────────────────────────────────────────────

const ACCEPTED_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/webp"];

interface CategoryOption {
  id: string;
  name: string;
}

interface ExtractedItem {
  rawLabel: string;
  amount: number | null;
  aiCategory: string | null;
  categoryConfidence: number;
  amountConfidence: number;
  crossedOut: boolean;
  categoryId: string | null;
  categoryName: string | null;
  categorySource: "deterministic" | "ai" | "misc_fallback" | null;
  isDefault?: boolean;
}

interface ExtractedDeposit {
  type: string;
  typeLabel: string;
  amount: number | null;
  remarks: string;
}

interface ClosingLine {
  label: string | null;
  amount: number;
  sign: 1 | -1;
}

interface ReviewRow {
  key: string;
  rawLabel: string;
  amount: string;
  categoryId: string;
  remarks: string;
  crossedOut: boolean;
  include: boolean;
  categorySource: "deterministic" | "ai" | "misc_fallback" | null;
  isDefault: boolean;
}

interface ReviewDepositRow {
  key: string;
  type: string;
  typeLabel: string;
  amount: string;
  remarks: string;
  include: boolean;
}

type Stage = "upload" | "analyzing" | "review" | "applying";

async function readJson(response: Response) {
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.success) throw new Error(payload?.message || "Request failed.");
  return payload;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Couldn't read this file."));
    reader.readAsDataURL(file);
  });
}

export interface ReadClosingFromImageModalProps {
  date: string;
  categories: CategoryOption[];
  onClose: () => void;
  /** Called after the extracted expenses were successfully saved via the existing expenses endpoint — the parent should re-fetch (e.g. call its own load()). */
  onApplied: () => void;
  /** Called when a date was detected on the sheet and the user chose to switch to it — the parent owns date state (its existing date picker). */
  onDateDetected: (detectedDate: string) => void;
  /** Called when the user chooses to use the detected Closing/Outstanding line — the parent should set its existing Closing Cash draft field. Never auto-saves/locks. */
  onClosingCashSuggested: (value: string) => void;
}

export default function ReadClosingFromImageModal({
  date,
  categories,
  onClose,
  onApplied,
  onDateDetected,
  onClosingCashSuggested,
}: ReadClosingFromImageModalProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [stage, setStage] = useState<Stage>("upload");
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [uploadError, setUploadError] = useState("");
  const [analyzeError, setAnalyzeError] = useState("");
  const [aiWarning, setAiWarning] = useState("");
  const [applyError, setApplyError] = useState("");

  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [depositRows, setDepositRows] = useState<ReviewDepositRow[]>([]);
  const [detectedDate, setDetectedDate] = useState<string | null>(null);
  const [dateSwitched, setDateSwitched] = useState(false);
  const [closingLine, setClosingLine] = useState<ClosingLine | null>(null);

  const handleFileChosen = (chosen: File | null) => {
    setUploadError("");
    if (!chosen) return;
    if (!ACCEPTED_TYPES.includes(chosen.type)) {
      setUploadError("Please upload a JPG, PNG, or WEBP image.");
      return;
    }
    if (chosen.size > 8 * 1024 * 1024) {
      setUploadError("This image is too large. Please upload a photo under 8MB.");
      return;
    }
    setFile(chosen);
    setPreviewUrl(URL.createObjectURL(chosen));
  };

  const runAnalysis = async () => {
    if (!file) return;
    setStage("analyzing");
    setAnalyzeError("");
    setAiWarning("");
    try {
      const dataUrl = await readFileAsDataUrl(file);
      const payload = await readJson(
        await firebaseAuthedFetch("/api/finance/closing/read-image", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ imageBase64: dataUrl, mimeType: file.type }),
        }),
      );

      const extraction: {
        date: string | null;
        readable: boolean;
        items: ExtractedItem[];
        closingLine: ClosingLine | null;
        deposits: ExtractedDeposit[];
      } = payload.extraction;

      setRows(
        extraction.items.map((item, index) => ({
          key: `item-${index}`,
          rawLabel: item.rawLabel,
          amount: item.amount !== null ? String(item.amount) : "",
          categoryId: item.categoryId ?? "",
          remarks: item.rawLabel,
          crossedOut: item.crossedOut,
          include: !item.crossedOut && item.amount !== null,
          categorySource: item.categorySource,
          isDefault: item.isDefault === true,
        })),
      );
      setDepositRows(
        (extraction.deposits ?? []).map((deposit, index) => ({
          key: `deposit-${index}`,
          type: deposit.type,
          typeLabel: deposit.typeLabel,
          amount: deposit.amount !== null ? String(deposit.amount) : "",
          remarks: deposit.remarks,
          include: deposit.amount !== null,
        })),
      );
      setDetectedDate(extraction.date);
      setDateSwitched(false);
      setClosingLine(extraction.closingLine);
      // No extra click needed: a detected Closing/Outstanding line is
      // applied to the parent's (still-editable, still-unsaved) Closing
      // Cash draft field immediately — the Finance Manager can freely
      // change it afterwards, same as if they'd typed it themselves.
      if (extraction.closingLine) {
        onClosingCashSuggested(String(extraction.closingLine.sign * extraction.closingLine.amount));
      }
      if (payload.aiError) setAiWarning(payload.aiError);
      setStage("review");
    } catch (err) {
      setAnalyzeError(err instanceof Error ? err.message : "Failed to analyse this image.");
      setStage("upload");
    }
  };

  const updateRow = (key: string, patch: Partial<ReviewRow>) => {
    setRows((current) => current.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  };

  const updateDepositRow = (key: string, patch: Partial<ReviewDepositRow>) => {
    setDepositRows((current) => current.map((d) => (d.key === key ? { ...d, ...patch } : d)));
  };

  const includedRows = rows.filter((r) => r.include);
  const unresolvedIncluded = includedRows.filter((r) => !r.categoryId);
  const invalidAmountIncluded = includedRows.filter((r) => !Number.isFinite(Number(r.amount)) || Number(r.amount) <= 0);
  const includedDeposits = depositRows.filter((d) => d.include);
  const invalidAmountDeposits = includedDeposits.filter((d) => !Number.isFinite(Number(d.amount)) || Number(d.amount) <= 0);
  const canApply =
    (includedRows.length > 0 || includedDeposits.length > 0) &&
    unresolvedIncluded.length === 0 &&
    invalidAmountIncluded.length === 0 &&
    invalidAmountDeposits.length === 0;

  const handleApply = async () => {
    setApplyError("");
    if (!canApply) {
      if (unresolvedIncluded.length > 0) setApplyError("Select a category for every included expense before applying.");
      else if (invalidAmountIncluded.length > 0) setApplyError("Enter a valid amount for every included expense before applying.");
      else if (invalidAmountDeposits.length > 0) setApplyError("Enter a valid amount for every included deposit before applying.");
      else setApplyError("Include at least one expense or deposit, or close this and enter values manually.");
      return;
    }
    setStage("applying");
    try {
      // Reuses the EXACT SAME endpoint the page's own "Add Expenses" modal
      // calls — addDailyClosingExpenses() under the hood. No new save path.
      if (includedRows.length > 0) {
        await readJson(
          await firebaseAuthedFetch(`/api/finance/closing/${date}/expenses`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              expenses: includedRows.map((r) => ({
                categoryId: r.categoryId,
                amount: Number(r.amount),
                remarks: r.remarks,
              })),
            }),
          }),
        );
      }
      // Deposits use the EXISTING Cash Deposits endpoint — no batch variant
      // exists there (matches how the page's own "Add Deposit" form calls
      // it), so applied one at a time, sequentially, to avoid any doubt
      // about concurrent writes to the same day's document.
      for (const d of includedDeposits) {
        await readJson(
          await firebaseAuthedFetch(`/api/finance/closing/${date}/deposits`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              type: d.type,
              amount: Number(d.amount),
              remarks: d.remarks,
            }),
          }),
        );
      }
      onApplied();
      onClose();
    } catch (err) {
      setApplyError(err instanceof Error ? err.message : "Failed to save these expenses.");
      setStage("review");
    }
  };

  return (
    <Modal
      title="📷 Read from Image"
      subtitle="Upload a photo of the handwritten Daily Closing sheet — we'll read it for you to review."
      onClose={onClose}
      maxWidthClassName="max-w-3xl"
    >
      {stage === "upload" || stage === "analyzing" ? (
        <div className="space-y-4">
          {!previewUrl ? (
            <label className="flex flex-col items-center justify-center gap-2 rounded-[24px] border-2 border-dashed border-orange-300 bg-orange-50/50 px-6 py-12 text-center transition hover:bg-orange-50">
              <span className="text-4xl">📷</span>
              <span className="text-base font-bold text-slate-800">Tap to upload photo</span>
              <span className="text-xs text-slate-500">JPG, PNG, or WEBP</span>
              <input
                ref={fileInputRef}
                type="file"
                accept={ACCEPTED_TYPES.join(",")}
                className="hidden"
                onChange={(e) => handleFileChosen(e.target.files?.[0] ?? null)}
              />
            </label>
          ) : (
            <div className="space-y-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={previewUrl} alt="Daily Closing sheet preview" className="mx-auto max-h-80 w-full rounded-2xl border border-slate-200 object-contain" />
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="flex-1 rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                >
                  Replace
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setFile(null);
                    setPreviewUrl("");
                  }}
                  className="flex-1 rounded-2xl border border-rose-200 bg-white px-4 py-3 text-sm font-semibold text-rose-600 transition hover:bg-rose-50"
                >
                  Remove
                </button>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept={ACCEPTED_TYPES.join(",")}
                className="hidden"
                onChange={(e) => handleFileChosen(e.target.files?.[0] ?? null)}
              />
            </div>
          )}

          {uploadError ? <p className="text-sm font-medium text-rose-600">{uploadError}</p> : null}
          {analyzeError ? <p className="text-sm font-medium text-rose-600">{analyzeError}</p> : null}

          <button
            type="button"
            disabled={!file || stage === "analyzing"}
            onClick={runAnalysis}
            className="w-full rounded-2xl bg-orange-600 px-6 py-4 text-base font-black text-white transition hover:bg-orange-700 disabled:opacity-40"
          >
            {stage === "analyzing" ? "Analysing…" : analyzeError ? "Retry Analysis" : "Analyse Sheet"}
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {aiWarning ? <p className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800">{aiWarning}</p> : null}

          {detectedDate && detectedDate !== date && !dateSwitched ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3">
              <p className="text-sm text-sky-800">
                This looks like the sheet for <strong>{formatDateDisplay(detectedDate)}</strong>, but you&apos;re viewing {formatDateDisplay(date)}.
              </p>
              <button
                type="button"
                onClick={() => {
                  onDateDetected(detectedDate);
                  setDateSwitched(true);
                }}
                className="flex-shrink-0 rounded-xl bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-sky-700"
              >
                Switch to that date
              </button>
            </div>
          ) : null}

          {closingLine ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3">
              <p className="text-sm text-emerald-800">
                {closingLine.label ?? "Closing"} detected: <strong>{formatCurrency(closingLine.sign * closingLine.amount)}</strong> — already applied
                to Closing Cash below. Edit it there if needed.
              </p>
              <span className="flex-shrink-0 rounded-full bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white">Applied ✓</span>
            </div>
          ) : null}

          {rows.length === 0 && depositRows.length === 0 ? (
            <p className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
              No expense lines were found on this sheet. You can retry with a clearer photo, or close this and use &quot;Add Expenses&quot; to enter
              them manually.
            </p>
          ) : rows.length > 0 ? (
            <div className="space-y-2">
              {rows.map((row) => (
                <div
                  key={row.key}
                  className={`rounded-2xl border p-3 ${row.include ? "border-slate-200 bg-white" : "border-slate-100 bg-slate-50 opacity-70"}`}
                >
                  <div className="mb-2 flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={row.include}
                      onChange={(e) => updateRow(row.key, { include: e.target.checked })}
                      className="h-4 w-4 accent-slate-900"
                    />
                    <p className="text-sm font-bold text-slate-800">{row.rawLabel}</p>
                    {row.crossedOut ? (
                      <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-rose-600">
                        Crossed out
                      </span>
                    ) : null}
                    {row.categorySource === "ai" ? (
                      <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sky-600">
                        AI guess
                      </span>
                    ) : null}
                    {row.categorySource === "misc_fallback" ? (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700">
                        Misc (check this)
                      </span>
                    ) : null}
                    {row.isDefault ? (
                      <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-600">
                        Default
                      </span>
                    ) : null}
                  </div>

                  {row.include && !row.categoryId ? (
                    <p className="mb-2 text-xs font-semibold text-amber-700">⚠️ Please select a category for this expense.</p>
                  ) : null}

                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1.4fr_0.9fr_1.4fr]">
                    <NativeSelectField
                      value={row.categoryId}
                      onChange={(e) => updateRow(row.key, { categoryId: e.target.value })}
                      displayValue={categories.find((c) => c.id === row.categoryId)?.name ?? "Select category…"}
                      placeholder={!row.categoryId}
                      className={!row.categoryId && row.include ? "border-amber-400" : ""}
                    >
                      <option value="">Select category…</option>
                      {categories.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </NativeSelectField>
                    <input
                      type="number"
                      inputMode="decimal"
                      value={row.amount}
                      onChange={(e) => updateRow(row.key, { amount: e.target.value })}
                      placeholder="Amount"
                      className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
                    />
                    <input
                      value={row.remarks}
                      onChange={(e) => updateRow(row.key, { remarks: e.target.value })}
                      placeholder="Remarks"
                      className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
                    />
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          {depositRows.length > 0 ? (
            <div className="space-y-2">
              <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Cash Deposits</p>
              {depositRows.map((deposit) => (
                <div
                  key={deposit.key}
                  className={`rounded-2xl border p-3 ${deposit.include ? "border-slate-200 bg-white" : "border-slate-100 bg-slate-50 opacity-70"}`}
                >
                  <div className="mb-2 flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={deposit.include}
                      onChange={(e) => updateDepositRow(deposit.key, { include: e.target.checked })}
                      className="h-4 w-4 accent-slate-900"
                    />
                    <p className="text-sm font-bold text-slate-800">{deposit.typeLabel}</p>
                    <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700">
                      Deposit
                    </span>
                  </div>

                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-[0.9fr_1.4fr]">
                    <input
                      type="number"
                      inputMode="decimal"
                      value={deposit.amount}
                      onChange={(e) => updateDepositRow(deposit.key, { amount: e.target.value })}
                      placeholder="Amount"
                      className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
                    />
                    <input
                      value={deposit.remarks}
                      onChange={(e) => updateDepositRow(deposit.key, { remarks: e.target.value })}
                      placeholder="Remarks"
                      className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
                    />
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          {applyError ? <p className="text-sm font-medium text-rose-600">{applyError}</p> : null}

          <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-between">
            <button
              type="button"
              onClick={runAnalysis}
              className="rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 sm:py-2.5"
            >
              Retry Analysis
            </button>
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              <button
                type="button"
                onClick={onClose}
                className="rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 sm:py-2.5"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={stage === "applying" || !canApply}
                onClick={handleApply}
                className="rounded-2xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50 sm:py-2.5"
              >
                {stage === "applying"
                  ? "Saving…"
                  : `Add ${includedRows.length} Expense(s)${includedDeposits.length > 0 ? ` + ${includedDeposits.length} Deposit(s)` : ""}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
