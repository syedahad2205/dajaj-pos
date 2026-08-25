"use client";

import { useRef, useState } from "react";
import { requireFinanceAccess } from "@/lib/roleGuard";
import { firebaseAuthedFetch } from "@/lib/firebaseAuthFetch";
import { formatCurrency, todayDateKey } from "@/lib/financeFormat";
import FinanceNav from "@/components/finance/FinanceNav";
import NativeSelectField from "@/components/ui/NativeSelectField";
import NativeDateField from "@/components/ui/NativeDateField";

const ACCEPTED_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/webp"];

type AiStatus = "success" | "failed" | "pending" | "unknown";
type PaymentMethod = "cash" | "upi" | "card" | "bank_transfer" | "cheque" | "other";

interface AccountOption {
  id: string;
  name: string;
  type: string;
  status: "active" | "archived";
}
interface CategoryOption {
  id: string;
  name: string;
  active: boolean;
}
interface DuplicateCandidate {
  transactionId: string;
  date: string;
  time: string;
  amount: number;
  description: string;
  categoryName: string | null;
  fromAccountName: string | null;
  referenceNumber: string;
}
interface AIExtractedPayment {
  amount: number | null;
  currency: string | null;
  date: string | null;
  time: string | null;
  status: AiStatus;
  paymentMethod: PaymentMethod | null;
  bankName: string | null;
  accountIdentifier: string | null;
  payee: string | null;
  referenceNumber: string | null;
  notes: string | null;
  suggestedCategory: string | null;
  confidence: number;
  readable: boolean;
}

const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: "Cash",
  upi: "UPI",
  card: "Card",
  bank_transfer: "Bank Transfer",
  cheque: "Cheque",
  other: "Other",
};

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

type Stage = "upload" | "analyzing" | "review" | "saving" | "success";

function StatusBadge({ status }: { status: AiStatus }) {
  const styles: Record<AiStatus, string> = {
    success: "bg-emerald-100 text-emerald-700",
    failed: "bg-rose-100 text-rose-700",
    pending: "bg-amber-100 text-amber-700",
    unknown: "bg-slate-100 text-slate-500",
  };
  const labels: Record<AiStatus, string> = { success: "Success", failed: "Failed", pending: "Pending", unknown: "Unknown" };
  return <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${styles[status]}`}>{labels[status]}</span>;
}

export default function QuickEntryPage() {
  const { authenticated, loading, role } = requireFinanceAccess();
  const hasFinanceAccess = authenticated && (role === "admin" || role === "financeManager");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [stage, setStage] = useState<Stage>("upload");
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string>("");
  const [uploadError, setUploadError] = useState("");
  const [analyzeError, setAnalyzeError] = useState("");
  const [aiWarning, setAiWarning] = useState("");

  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [duplicates, setDuplicates] = useState<DuplicateCandidate[]>([]);
  const [duplicateOverridden, setDuplicateOverridden] = useState(false);
  const [aiExtracted, setAiExtracted] = useState<AIExtractedPayment | null>(null);
  const [matchedPayeeRuleId, setMatchedPayeeRuleId] = useState<string | null>(null);
  const [statusAcknowledged, setStatusAcknowledged] = useState(false);

  const today = todayDateKey();
  const [form, setForm] = useState({
    amount: "",
    date: today,
    time: "",
    accountId: "",
    payee: "",
    categoryId: "",
    paymentMethod: "" as "" | PaymentMethod,
    referenceNumber: "",
    notes: "",
  });

  const [saveError, setSaveError] = useState("");
  const [savedAmount, setSavedAmount] = useState(0);

  if (loading) {
    return <main className="min-h-screen bg-[#fff8ed] px-4 py-10 text-slate-900">Checking your session…</main>;
  }
  if (!hasFinanceAccess) return null;

  const resetAll = () => {
    setStage("upload");
    setFile(null);
    setPreviewUrl("");
    setUploadError("");
    setAnalyzeError("");
    setAiWarning("");
    setDuplicates([]);
    setDuplicateOverridden(false);
    setAiExtracted(null);
    setMatchedPayeeRuleId(null);
    setStatusAcknowledged(false);
    setSaveError("");
    setForm({ amount: "", date: today, time: "", accountId: "", payee: "", categoryId: "", paymentMethod: "", referenceNumber: "", notes: "" });
  };

  const handleFileChosen = (chosen: File | null) => {
    setUploadError("");
    if (!chosen) return;
    if (!ACCEPTED_TYPES.includes(chosen.type)) {
      setUploadError("Please upload a JPG, PNG, or WEBP image.");
      return;
    }
    if (chosen.size > 8 * 1024 * 1024) {
      setUploadError("This image is too large. Please upload a screenshot under 8MB.");
      return;
    }
    setFile(chosen);
    setPreviewUrl(URL.createObjectURL(chosen));
  };

  const handleAnalyze = async () => {
    if (!file) return;
    setStage("analyzing");
    setAnalyzeError("");
    setAiWarning("");
    try {
      const dataUrl = await readFileAsDataUrl(file);
      const payload = await readJson(
        await firebaseAuthedFetch("/api/finance/quick-entry/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ imageBase64: dataUrl, mimeType: file.type }),
        }),
      );

      const extracted: AIExtractedPayment = payload.extracted;
      setAiExtracted(extracted);
      setAccounts(payload.accounts ?? []);
      setCategories((payload.categories ?? []).filter((c: CategoryOption) => c.active));
      setDuplicates(payload.duplicates ?? []);
      setMatchedPayeeRuleId(payload.matchedPayeeRuleId ?? null);

      if (payload.aiError) setAiWarning(payload.aiError);
      else if (!extracted.readable) {
        setAiWarning("We couldn't read this payment clearly. Please upload a clearer screenshot or enter the details manually.");
      }

      const now = new Date();
      setForm({
        amount: extracted.amount ? String(extracted.amount) : "",
        date: extracted.date ?? today,
        time: extracted.time ?? `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`,
        accountId: payload.defaultAccountId ?? "",
        payee: extracted.payee ?? "",
        categoryId: payload.matchedCategoryId ?? "",
        paymentMethod: (extracted.paymentMethod as PaymentMethod) ?? "",
        referenceNumber: extracted.referenceNumber ?? "",
        notes: extracted.notes ?? "",
      });
      setStatusAcknowledged(extracted.status === "success");
      setStage("review");
    } catch (err) {
      setAnalyzeError(err instanceof Error ? err.message : "Failed to analyse this screenshot.");
      setStage("upload");
    }
  };

  const activeAccounts = accounts.filter((a) => a.status === "active");
  const canSave =
    Number.isFinite(Number(form.amount)) &&
    Number(form.amount) > 0 &&
    !!form.accountId &&
    !!form.categoryId &&
    !!form.date &&
    statusAcknowledged &&
    (duplicates.length === 0 || duplicateOverridden);

  const handleSave = async () => {
    setSaveError("");
    setStage("saving");
    try {
      const amountNum = Number(form.amount);
      const payload = await readJson(
        await firebaseAuthedFetch("/api/finance/quick-entry/save", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            amount: amountNum,
            date: form.date,
            time: form.time,
            accountId: form.accountId,
            payee: form.payee,
            categoryId: form.categoryId,
            paymentMethod: form.paymentMethod || null,
            referenceNumber: form.referenceNumber,
            notes: form.notes,
            aiExtracted,
            matchedPayeeRuleId,
            duplicateOverridden,
          }),
        }),
      );
      setSavedAmount(payload.transaction?.amount ?? amountNum);
      setStage("success");
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to save this transaction.");
      setStage("review");
    }
  };

  return (
    <main className="min-h-screen bg-[#fff8ed] px-4 py-8 text-slate-900">
      <div className="mx-auto max-w-2xl space-y-5">
        <header className="rounded-[28px] border border-orange-200 bg-white p-6 shadow-sm">
          <p className="text-sm font-semibold uppercase tracking-[0.28em] text-orange-600">Finance</p>
          <h1 className="mt-1 text-3xl font-black">Quick Entry</h1>
          <p className="mt-2 text-sm text-slate-600">Upload a payment screenshot — we&apos;ll read the details for you to review and save.</p>
          <div className="mt-5">
            <FinanceNav role={role} />
          </div>
        </header>

        {stage === "upload" || stage === "analyzing" ? (
          <section className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
            <p className="mb-3 text-sm font-black text-slate-900">Upload Payment Screenshot</p>

            {!previewUrl ? (
              <label className="flex flex-col items-center justify-center gap-2 rounded-[24px] border-2 border-dashed border-orange-300 bg-orange-50/50 px-6 py-14 text-center transition hover:bg-orange-50">
                <span className="text-4xl">📷</span>
                <span className="text-base font-bold text-slate-800">Tap to upload screenshot</span>
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
                <img src={previewUrl} alt="Payment screenshot preview" className="mx-auto max-h-96 w-full rounded-2xl border border-slate-200 object-contain" />
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

            {uploadError ? <p className="mt-3 text-sm font-medium text-rose-600">{uploadError}</p> : null}
            {analyzeError ? <p className="mt-3 text-sm font-medium text-rose-600">{analyzeError}</p> : null}

            <button
              type="button"
              disabled={!file || stage === "analyzing"}
              onClick={handleAnalyze}
              className="mt-5 w-full rounded-2xl bg-orange-600 px-6 py-4 text-base font-black text-white transition hover:bg-orange-700 disabled:opacity-40"
            >
              {stage === "analyzing" ? "Analysing…" : "Analyse Screenshot"}
            </button>
          </section>
        ) : null}

        {stage === "review" || stage === "saving" ? (
          <>
            <section className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
              <div className="mb-4 flex items-center justify-between">
                <p className="text-sm font-black text-slate-900">Payment Details</p>
                {aiExtracted ? <StatusBadge status={aiExtracted.status} /> : null}
              </div>

              {previewUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={previewUrl} alt="Payment screenshot" className="mb-4 max-h-56 w-full rounded-2xl border border-slate-200 object-contain" />
              ) : null}

              {aiWarning ? (
                <p className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800">{aiWarning}</p>
              ) : null}

              {aiExtracted && aiExtracted.status !== "success" ? (
                <label className="mb-4 flex items-start gap-2 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                  <input
                    type="checkbox"
                    checked={statusAcknowledged}
                    onChange={(e) => setStatusAcknowledged(e.target.checked)}
                    className="mt-0.5 h-4 w-4 accent-amber-600"
                  />
                  <span>
                    This screenshot shows the payment status as <strong className="capitalize">{aiExtracted.status}</strong>, not a confirmed success.
                    Confirm you still want to record this transaction.
                  </span>
                </label>
              ) : null}

              {duplicates.length > 0 ? (
                <div className="mb-4 rounded-2xl border border-amber-300 bg-amber-50 p-4">
                  <p className="text-sm font-bold text-amber-900">⚠️ This payment may already have been recorded.</p>
                  <ul className="mt-2 space-y-1 text-xs text-amber-800">
                    {duplicates.map((d) => (
                      <li key={d.transactionId}>
                        {d.date} · {formatCurrency(d.amount)} · {d.categoryName ?? "—"} · {d.fromAccountName ?? "—"}
                        {d.referenceNumber ? ` · Ref: ${d.referenceNumber}` : ""}
                      </li>
                    ))}
                  </ul>
                  <div className="mt-3 flex gap-3">
                    <button
                      type="button"
                      onClick={resetAll}
                      className="rounded-xl border border-amber-300 bg-white px-4 py-2 text-xs font-semibold text-amber-800 hover:bg-amber-100"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => setDuplicateOverridden(true)}
                      disabled={duplicateOverridden}
                      className="rounded-xl bg-amber-600 px-4 py-2 text-xs font-semibold text-white hover:bg-amber-700 disabled:opacity-50"
                    >
                      {duplicateOverridden ? "Continuing anyway ✓" : "Continue Anyway"}
                    </button>
                  </div>
                </div>
              ) : null}

              {!form.categoryId ? (
                <p className="mb-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-600">
                  We couldn&apos;t determine the expense category. Please select one.
                </p>
              ) : null}

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-500">Amount</label>
                  <input
                    type="number"
                    value={form.amount}
                    onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                    placeholder="0"
                    className="w-full rounded-xl border border-slate-300 px-3 py-3 text-base font-bold outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-500">Date</label>
                  <NativeDateField value={form.date} max={today} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-500">Time</label>
                  <input
                    type="time"
                    value={form.time}
                    onChange={(e) => setForm((f) => ({ ...f, time: e.target.value }))}
                    className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-500">Paid From</label>
                  <NativeSelectField
                    value={form.accountId}
                    onChange={(e) => setForm((f) => ({ ...f, accountId: e.target.value }))}
                    displayValue={activeAccounts.find((a) => a.id === form.accountId)?.name ?? "Select…"}
                    placeholder={!form.accountId}
                  >
                    <option value="">Select…</option>
                    {activeAccounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </NativeSelectField>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-500">Paid To (Payee)</label>
                  <input
                    value={form.payee}
                    onChange={(e) => setForm((f) => ({ ...f, payee: e.target.value }))}
                    placeholder="Payee name"
                    className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-500">Expense Category</label>
                  <NativeSelectField
                    value={form.categoryId}
                    onChange={(e) => setForm((f) => ({ ...f, categoryId: e.target.value }))}
                    displayValue={categories.find((c) => c.id === form.categoryId)?.name ?? "Select…"}
                    placeholder={!form.categoryId}
                  >
                    <option value="">Select…</option>
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </NativeSelectField>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-500">Payment Method</label>
                  <NativeSelectField
                    value={form.paymentMethod}
                    onChange={(e) => setForm((f) => ({ ...f, paymentMethod: e.target.value as PaymentMethod | "" }))}
                    displayValue={form.paymentMethod ? PAYMENT_METHOD_LABELS[form.paymentMethod as PaymentMethod] : "Select…"}
                    placeholder={!form.paymentMethod}
                  >
                    <option value="">Select…</option>
                    {Object.entries(PAYMENT_METHOD_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </NativeSelectField>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-500">Transaction / Reference ID</label>
                  <input
                    value={form.referenceNumber}
                    onChange={(e) => setForm((f) => ({ ...f, referenceNumber: e.target.value }))}
                    placeholder="UTR / Ref no."
                    className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="mb-1 block text-xs font-semibold text-slate-500">Notes (optional)</label>
                  <input
                    value={form.notes}
                    onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                    placeholder="Optional"
                    className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
                  />
                </div>
              </div>

              {saveError ? <p className="mt-4 text-sm font-medium text-rose-600">{saveError}</p> : null}

              <div className="mt-5 flex gap-3">
                <button
                  type="button"
                  onClick={resetAll}
                  className="flex-1 rounded-2xl border border-slate-300 bg-white px-4 py-4 text-sm font-bold text-slate-700 transition hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={!canSave || stage === "saving"}
                  onClick={handleSave}
                  className="flex-1 rounded-2xl bg-slate-900 px-4 py-4 text-sm font-black text-white transition hover:bg-slate-800 disabled:opacity-40"
                >
                  {stage === "saving" ? "Saving…" : "Save Transaction"}
                </button>
              </div>
            </section>
          </>
        ) : null}

        {stage === "success" ? (
          <section className="rounded-[28px] border border-emerald-200 bg-white p-8 text-center shadow-sm">
            <p className="text-5xl">✅</p>
            <p className="mt-3 text-xl font-black text-slate-900">Transaction Saved</p>
            <p className="mt-1 text-sm text-slate-600">{formatCurrency(savedAmount)} recorded in the Dajaj finance system.</p>
            <button
              type="button"
              onClick={resetAll}
              className="mt-6 w-full rounded-2xl bg-orange-600 px-6 py-4 text-base font-black text-white transition hover:bg-orange-700"
            >
              Record Another Payment
            </button>
          </section>
        ) : null}
      </div>
    </main>
  );
}
