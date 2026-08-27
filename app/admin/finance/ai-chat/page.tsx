"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireAdmin } from "@/lib/roleGuard";
import { firebaseAuthedFetch } from "@/lib/firebaseAuthFetch";
import { formatCurrency, formatDateDisplay, todayDateKey } from "@/lib/financeFormat";
import NativeSelectField from "@/components/ui/NativeSelectField";

// ─────────────────────────────────────────────────────────────────────────
// Finance AI Assistant — a chat front door onto Daily Closing + Transactions.
// Every proposed action here is only ever a SUGGESTION until an admin
// explicitly approves it (services/financeAiChatService.ts does the actual
// writing, through the same existing functions every other Finance screen
// uses). Nothing is ever bulk-approved — one card, one decision at a time.
// ─────────────────────────────────────────────────────────────────────────

const ACCEPTED_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
const MAX_IMAGES = 6;

// Mirrors SUPPORTED_CASH_DEPOSIT_TYPES/CASH_DEPOSIT_TYPE_LABELS in lib/finance.ts —
// extend both in tandem if a second deposit type is ever turned on.
const DEPOSIT_TYPE_OPTIONS = [{ type: "pigmi", label: "Pigmi" }];

const FIELD_LABELS: Record<string, string> = {
  closingCash: "Closing Cash",
  upiSales: "UPI Sales",
  zomatoSales: "Zomato Sales",
  swiggySales: "Swiggy Sales",
  otherIncome: "Other Income",
};

type MatchSource = "deterministic" | "ai" | "misc_fallback" | null;
type ActionStatus = "pending" | "approved" | "discarded" | "failed";

interface DailyClosingPayload {
  date: string;
  field: "closingCash" | "upiSales" | "zomatoSales" | "swiggySales" | "otherIncome" | "expense" | "deposit";
  value: number | null;
  expenseCategoryId: string | null;
  expenseCategoryName: string | null;
  expenseAmount: number | null;
  expenseRemarks: string;
  depositType: string | null;
  depositAmount: number | null;
  depositRemarks: string;
}

interface TransactionPayload {
  type: "income" | "expense" | "transfer";
  date: string;
  time: string;
  amount: number;
  categoryId: string | null;
  categoryName: string | null;
  fromAccountId: string | null;
  fromAccountName: string | null;
  toAccountId: string | null;
  toAccountName: string | null;
  remarks: string;
  referenceNumber: string;
}

interface ProposedAction {
  id: string;
  kind: "daily_closing_field" | "transaction";
  sourceImageIndex: number | null;
  reasoning: string;
  confidence: number;
  categorySource: MatchSource;
  accountSource: MatchSource;
  dailyClosing: DailyClosingPayload | null;
  transaction: TransactionPayload | null;
  status: ActionStatus;
  resultRef: string | null;
  errorMessage: string | null;
  resolvedNote: string | null;
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  imageCount: number;
  proposedActions: ProposedAction[];
}

interface Option {
  id: string;
  name: string;
}
interface AccountOption extends Option {
  status: "active" | "archived";
}

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

function MatchBadge({ source }: { source: MatchSource }) {
  if (source === "misc_fallback") return <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-700">Misc fallback</span>;
  if (source === null) return <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-rose-700">Needs review</span>;
  return <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-700">AI matched</span>;
}

interface ActionEdits {
  date?: string;
  value?: number;
  expenseCategoryId?: string;
  expenseAmount?: number;
  expenseRemarks?: string;
  depositType?: string;
  depositAmount?: number;
  depositRemarks?: string;
  amount?: number;
  time?: string;
  categoryId?: string;
  fromAccountId?: string;
  toAccountId?: string;
  remarks?: string;
  referenceNumber?: string;
}

function ActionCard({
  action,
  messageId,
  expenseCategories,
  incomeCategories,
  accounts,
  onResolved,
}: {
  action: ProposedAction;
  messageId: string;
  expenseCategories: Option[];
  incomeCategories: Option[];
  accounts: AccountOption[];
  onResolved: (messageId: string, updated: ProposedAction) => void;
}) {
  const [edits, setEdits] = useState<ActionEdits>({});
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState("");

  const dc = action.dailyClosing;
  const t = action.transaction;
  const activeAccounts = accounts.filter((a) => a.status === "active");

  const resolve = async (decision: "approve" | "discard") => {
    setBusy(true);
    setLocalError("");
    try {
      const response = await firebaseAuthedFetch("/api/finance/ai-chat/actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId, actionId: action.id, decision, edits: decision === "approve" ? edits : undefined }),
      });
      const payload = await readJson(response);
      onResolved(messageId, payload.action as ProposedAction);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  const resolved = action.status !== "pending" && action.status !== "failed";

  let title = "";
  let canApprove = false;

  if (action.kind === "daily_closing_field" && dc) {
    const date = edits.date ?? dc.date;
    if (dc.field === "expense") {
      const categoryId = edits.expenseCategoryId ?? dc.expenseCategoryId ?? "";
      const amount = edits.expenseAmount ?? dc.expenseAmount ?? 0;
      canApprove = Boolean(categoryId) && amount > 0;
      title = `Add expense — ${formatCurrency(amount)} on ${formatDateDisplay(date)}`;
    } else if (dc.field === "deposit") {
      const depositType = edits.depositType ?? dc.depositType ?? "";
      const amount = edits.depositAmount ?? dc.depositAmount ?? 0;
      canApprove = Boolean(depositType) && amount > 0;
      title = `Add Cash Deposit — ${formatCurrency(amount)} on ${formatDateDisplay(date)}`;
    } else if (dc.field === "closingCash") {
      const value = edits.value ?? dc.value ?? 0;
      canApprove = Number.isFinite(value);
      title = `⚠️ Close & lock ${formatDateDisplay(date)} — Closing Cash ${formatCurrency(value)}`;
    } else {
      const value = edits.value ?? dc.value ?? 0;
      canApprove = Number.isFinite(value);
      title = `Set ${FIELD_LABELS[dc.field] ?? dc.field} = ${formatCurrency(value)} on ${formatDateDisplay(date)}`;
    }
  } else if (action.kind === "transaction" && t) {
    const amount = edits.amount ?? t.amount;
    const categoryId = edits.categoryId ?? t.categoryId ?? "";
    const fromAccountId = edits.fromAccountId ?? t.fromAccountId ?? "";
    const toAccountId = edits.toAccountId ?? t.toAccountId ?? "";
    if (t.type === "income") {
      canApprove = Boolean(categoryId) && Boolean(toAccountId) && amount > 0;
      title = `Income — ${formatCurrency(amount)} → ${t.toAccountName ?? "choose account"}`;
    } else if (t.type === "expense") {
      canApprove = Boolean(categoryId) && Boolean(fromAccountId) && amount > 0;
      title = `Expense — ${formatCurrency(amount)} from ${t.fromAccountName ?? "choose account"}`;
    } else {
      canApprove = Boolean(fromAccountId) && Boolean(toAccountId) && fromAccountId !== toAccountId && amount > 0;
      title = `Transfer — ${formatCurrency(amount)}: ${t.fromAccountName ?? "?"} → ${t.toAccountName ?? "?"}`;
    }
  }

  return (
    <div
      className={`rounded-2xl border p-4 text-sm shadow-sm ${
        action.status === "approved"
          ? "border-emerald-200 bg-emerald-50"
          : action.status === "discarded"
          ? "border-slate-200 bg-slate-50 opacity-70"
          : action.status === "failed"
          ? "border-rose-200 bg-rose-50"
          : dc?.field === "closingCash"
          ? "border-amber-300 bg-amber-50"
          : "border-slate-200 bg-white"
      }`}
    >
      <p className="font-bold text-slate-900">{title}</p>
      <p className="mt-1 text-xs text-slate-500">{action.reasoning}</p>

      {action.status === "failed" && action.errorMessage ? (
        <p className="mt-2 rounded-xl bg-rose-100 px-3 py-2 text-xs font-semibold text-rose-700">⚠️ {action.errorMessage} — fix below and retry, or discard.</p>
      ) : null}
      {localError ? <p className="mt-2 rounded-xl bg-rose-100 px-3 py-2 text-xs font-semibold text-rose-700">{localError}</p> : null}

      {!resolved && (
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {action.kind === "daily_closing_field" && dc && (
            <>
              <label className="col-span-2 sm:col-span-1 text-xs font-semibold text-slate-500 sm:col-span-1">
                Date
                <input
                  type="date"
                  max={todayDateKey()}
                  value={edits.date ?? dc.date}
                  onChange={(e) => setEdits((p) => ({ ...p, date: e.target.value }))}
                  className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                />
              </label>

              {dc.field === "expense" && (
                <>
                  <label className="text-xs font-semibold text-slate-500">
                    Amount
                    <input
                      type="number"
                      value={edits.expenseAmount ?? dc.expenseAmount ?? ""}
                      onChange={(e) => setEdits((p) => ({ ...p, expenseAmount: Number(e.target.value) }))}
                      className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                    />
                  </label>
                  <label className="text-xs font-semibold text-slate-500">
                    Category <MatchBadge source={action.categorySource} />
                    <NativeSelectField
                      displayValue={expenseCategories.find((c) => c.id === (edits.expenseCategoryId ?? dc.expenseCategoryId))?.name ?? "Choose…"}
                      placeholder={!(edits.expenseCategoryId ?? dc.expenseCategoryId)}
                      value={edits.expenseCategoryId ?? dc.expenseCategoryId ?? ""}
                      onChange={(e) => setEdits((p) => ({ ...p, expenseCategoryId: e.target.value }))}
                      className="mt-1"
                    >
                      <option value="">Choose…</option>
                      {expenseCategories.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </NativeSelectField>
                  </label>
                  <label className="col-span-2 text-xs font-semibold text-slate-500 sm:col-span-1">
                    Remarks
                    <input
                      type="text"
                      value={edits.expenseRemarks ?? dc.expenseRemarks}
                      onChange={(e) => setEdits((p) => ({ ...p, expenseRemarks: e.target.value }))}
                      className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                    />
                  </label>
                </>
              )}

              {dc.field === "deposit" && (
                <>
                  <label className="text-xs font-semibold text-slate-500">
                    Amount
                    <input
                      type="number"
                      value={edits.depositAmount ?? dc.depositAmount ?? ""}
                      onChange={(e) => setEdits((p) => ({ ...p, depositAmount: Number(e.target.value) }))}
                      className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                    />
                  </label>
                  <label className="text-xs font-semibold text-slate-500">
                    Type
                    <NativeSelectField
                      displayValue={DEPOSIT_TYPE_OPTIONS.find((o) => o.type === (edits.depositType ?? dc.depositType))?.label ?? "Choose…"}
                      placeholder={!(edits.depositType ?? dc.depositType)}
                      value={edits.depositType ?? dc.depositType ?? ""}
                      onChange={(e) => setEdits((p) => ({ ...p, depositType: e.target.value }))}
                      className="mt-1"
                    >
                      <option value="">Choose…</option>
                      {DEPOSIT_TYPE_OPTIONS.map((o) => (
                        <option key={o.type} value={o.type}>
                          {o.label}
                        </option>
                      ))}
                    </NativeSelectField>
                  </label>
                </>
              )}

              {(dc.field === "closingCash" || FIELD_LABELS[dc.field]) && (
                <label className="text-xs font-semibold text-slate-500">
                  Amount
                  <input
                    type="number"
                    value={edits.value ?? dc.value ?? ""}
                    onChange={(e) => setEdits((p) => ({ ...p, value: Number(e.target.value) }))}
                    className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                  />
                </label>
              )}
            </>
          )}

          {action.kind === "transaction" && t && (
            <>
              <label className="text-xs font-semibold text-slate-500">
                Date
                <input
                  type="date"
                  max={todayDateKey()}
                  value={edits.date ?? t.date}
                  onChange={(e) => setEdits((p) => ({ ...p, date: e.target.value }))}
                  className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                />
              </label>
              <label className="text-xs font-semibold text-slate-500">
                Amount
                <input
                  type="number"
                  value={edits.amount ?? t.amount}
                  onChange={(e) => setEdits((p) => ({ ...p, amount: Number(e.target.value) }))}
                  className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                />
              </label>

              {t.type !== "transfer" && (
                <label className="text-xs font-semibold text-slate-500">
                  Category <MatchBadge source={action.categorySource} />
                  <NativeSelectField
                    displayValue={(t.type === "income" ? incomeCategories : expenseCategories).find((c) => c.id === (edits.categoryId ?? t.categoryId))?.name ?? "Choose…"}
                    placeholder={!(edits.categoryId ?? t.categoryId)}
                    value={edits.categoryId ?? t.categoryId ?? ""}
                    onChange={(e) => setEdits((p) => ({ ...p, categoryId: e.target.value }))}
                    className="mt-1"
                  >
                    <option value="">Choose…</option>
                    {(t.type === "income" ? incomeCategories : expenseCategories).map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </NativeSelectField>
                </label>
              )}

              {(t.type === "expense" || t.type === "transfer") && (
                <label className="text-xs font-semibold text-slate-500">
                  From account <MatchBadge source={action.accountSource} />
                  <NativeSelectField
                    displayValue={activeAccounts.find((a) => a.id === (edits.fromAccountId ?? t.fromAccountId))?.name ?? "Choose…"}
                    placeholder={!(edits.fromAccountId ?? t.fromAccountId)}
                    value={edits.fromAccountId ?? t.fromAccountId ?? ""}
                    onChange={(e) => setEdits((p) => ({ ...p, fromAccountId: e.target.value }))}
                    className="mt-1"
                  >
                    <option value="">Choose…</option>
                    {activeAccounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </NativeSelectField>
                </label>
              )}

              {(t.type === "income" || t.type === "transfer") && (
                <label className="text-xs font-semibold text-slate-500">
                  To account <MatchBadge source={action.accountSource} />
                  <NativeSelectField
                    displayValue={activeAccounts.find((a) => a.id === (edits.toAccountId ?? t.toAccountId))?.name ?? "Choose…"}
                    placeholder={!(edits.toAccountId ?? t.toAccountId)}
                    value={edits.toAccountId ?? t.toAccountId ?? ""}
                    onChange={(e) => setEdits((p) => ({ ...p, toAccountId: e.target.value }))}
                    className="mt-1"
                  >
                    <option value="">Choose…</option>
                    {activeAccounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </NativeSelectField>
                </label>
              )}

              <label className="col-span-2 text-xs font-semibold text-slate-500 sm:col-span-1">
                Remarks
                <input
                  type="text"
                  value={edits.remarks ?? t.remarks}
                  onChange={(e) => setEdits((p) => ({ ...p, remarks: e.target.value }))}
                  className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                />
              </label>
            </>
          )}
        </div>
      )}

      {resolved ? (
        <>
          <p className={`mt-2 text-xs font-bold ${action.status === "approved" ? "text-emerald-700" : "text-slate-400"}`}>
            {action.status === "approved" ? `✅ Approved${action.resultRef ? ` — ${action.resultRef}` : ""}` : "Discarded"}
          </p>
          {action.resolvedNote ? <p className="mt-1 text-xs font-medium text-amber-700">ℹ️ {action.resolvedNote}</p> : null}
        </>
      ) : (
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            disabled={busy || !canApprove}
            onClick={() => resolve("approve")}
            className="flex-1 rounded-xl bg-orange-600 px-4 py-2.5 text-xs font-bold text-white transition hover:bg-orange-700 disabled:opacity-40"
          >
            {busy ? "Saving…" : action.status === "failed" ? "Retry" : "Approve"}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => resolve("discard")}
            className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-xs font-bold text-slate-600 transition hover:bg-slate-50 disabled:opacity-40"
          >
            Discard
          </button>
        </div>
      )}
    </div>
  );
}

interface PendingImage {
  file: File;
  previewUrl: string;
  base64: string;
  mimeType: string;
}

export default function FinanceAiChatPage() {
  const { authenticated, loading, role } = requireAdmin();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState("");

  const [expenseCategories, setExpenseCategories] = useState<Option[]>([]);
  const [incomeCategories, setIncomeCategories] = useState<Option[]>([]);
  const [accounts, setAccounts] = useState<AccountOption[]>([]);

  const [text, setText] = useState("");
  const [images, setImages] = useState<PendingImage[]>([]);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState("");

  const fileInputRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!authenticated || role !== "admin") return;
    Promise.all([
      firebaseAuthedFetch("/api/finance/ai-chat/messages").then(readJson),
      firebaseAuthedFetch("/api/finance/expense-categories").then(readJson),
      firebaseAuthedFetch("/api/finance/income-categories").then(readJson),
      firebaseAuthedFetch("/api/finance/accounts").then(readJson),
    ])
      .then(([chatPayload, expensePayload, incomePayload, accountsPayload]) => {
        setMessages(chatPayload.messages);
        setExpenseCategories(expensePayload.categories);
        setIncomeCategories(incomePayload.categories);
        setAccounts(accountsPayload.accounts);
      })
      .catch((err) => setHistoryError(err instanceof Error ? err.message : "Failed to load the AI Assistant."))
      .finally(() => setHistoryLoading(false));
  }, [authenticated, role]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#fff8ed] text-sm text-slate-500">Checking your session…</div>
    );
  }
  if (!authenticated || role !== "admin") return null;

  const handleFilesChosen = async (files: FileList | null) => {
    if (!files) return;
    setSendError("");
    const chosen = Array.from(files).slice(0, MAX_IMAGES - images.length);
    for (const file of chosen) {
      if (!ACCEPTED_TYPES.includes(file.type)) {
        setSendError("Please upload only JPG, PNG, or WEBP images.");
        continue;
      }
      if (file.size > 8 * 1024 * 1024) {
        setSendError("Each image must be under 8MB.");
        continue;
      }
      const dataUrl = await readFileAsDataUrl(file);
      const match = /^data:([^;]+);base64,([\s\S]*)$/.exec(dataUrl);
      if (!match) continue;
      setImages((prev) => [...prev, { file, previewUrl: dataUrl, base64: match[2], mimeType: match[1] }]);
    }
  };

  const removeImage = (index: number) => setImages((prev) => prev.filter((_, i) => i !== index));

  const handleSend = async () => {
    if (sending) return;
    if (!text.trim() && images.length === 0) return;
    setSending(true);
    setSendError("");
    try {
      const response = await firebaseAuthedFetch("/api/finance/ai-chat/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, images: images.map((img) => ({ data: img.base64, mimeType: img.mimeType })) }),
      });
      const payload = await readJson(response);
      setMessages((prev) => [...prev, payload.userMessage, payload.assistantMessage]);
      setText("");
      setImages([]);
    } catch (err) {
      setSendError(err instanceof Error ? err.message : "Couldn't send that — please try again.");
    } finally {
      setSending(false);
    }
  };

  const updateAction = (messageId: string, updated: ProposedAction) => {
    setMessages((prev) =>
      prev.map((m) => (m.id === messageId ? { ...m, proposedActions: m.proposedActions.map((a) => (a.id === updated.id ? updated : a)) } : m)),
    );
  };

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[#fff8ed] text-slate-900">
      <div className="flex flex-shrink-0 items-center gap-3 border-b border-orange-200 bg-white px-3 py-2.5 shadow-sm">
        <Link
          href="/admin/finance"
          className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-slate-600 transition hover:bg-slate-100"
          aria-label="Back"
        >
          <ArrowLeft size={20} strokeWidth={2.5} />
        </Link>
        <p className="truncate text-sm font-bold text-slate-900">🤖 AI Assistant</p>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-4">
        <div className="mx-auto max-w-2xl space-y-3">
          {historyError ? <p className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">{historyError}</p> : null}

          {historyLoading ? (
            <p className="pt-10 text-center text-sm text-slate-400">Loading conversation…</p>
          ) : messages.length === 0 ? (
            <div className="rounded-[28px] border border-dashed border-orange-200 bg-white p-10 text-center text-sm text-slate-400">
              Say hello — try &quot;what&apos;s my profit today?&quot;, &quot;₹500 cash expense for tea&quot;, or attach a UPI settlement screenshot.
            </div>
          ) : (
            messages.map((message) => (
              <div key={message.id} className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[85%] space-y-2 ${message.role === "user" ? "items-end" : "items-start"}`}>
                  <div
                    className={`rounded-2xl px-4 py-3 text-sm shadow-sm ${
                      message.role === "user" ? "bg-slate-900 text-white" : "border border-slate-200 bg-white text-slate-800"
                    }`}
                  >
                    {message.text}
                    {message.imageCount > 0 ? (
                      <p className={`mt-1 text-xs ${message.role === "user" ? "text-slate-300" : "text-slate-400"}`}>
                        📎 {message.imageCount} image{message.imageCount > 1 ? "s" : ""} attached
                      </p>
                    ) : null}
                  </div>
                  {message.proposedActions.length > 0 ? (
                    <div className="w-full space-y-2">
                      {message.proposedActions.map((action) => (
                        <ActionCard
                          key={action.id}
                          action={action}
                          messageId={message.id}
                          expenseCategories={expenseCategories}
                          incomeCategories={incomeCategories}
                          accounts={accounts}
                          onResolved={updateAction}
                        />
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
            ))
          )}

          {sending ? (
            <div className="flex justify-start">
              <div className="flex items-center gap-1.5 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400 [animation-delay:0ms]" />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400 [animation-delay:150ms]" />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400 [animation-delay:300ms]" />
              </div>
            </div>
          ) : null}

          <div ref={bottomRef} />
        </div>
      </div>

      <div className="flex-shrink-0 border-t border-orange-200 bg-white px-3 py-3">
        <div className="mx-auto max-w-2xl">
          {images.length > 0 ? (
            <div className="mb-3 flex flex-wrap gap-2">
              {images.map((img, index) => (
                <div key={index} className="relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={img.previewUrl} alt="" className="h-16 w-16 rounded-xl border border-slate-200 object-cover" />
                  <button
                    type="button"
                    disabled={sending}
                    onClick={() => removeImage(index)}
                    className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-rose-600 text-xs font-bold text-white disabled:opacity-40"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          ) : null}

          {sendError ? <p className="mb-2 text-xs font-medium text-rose-600">{sendError}</p> : null}

          <div className="flex items-end gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPTED_TYPES.join(",")}
              multiple
              className="hidden"
              onChange={(e) => {
                handleFilesChosen(e.target.files);
                e.target.value = "";
              }}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={sending || images.length >= MAX_IMAGES}
              className="flex-shrink-0 rounded-xl border border-slate-300 bg-white px-3 py-3 text-sm font-semibold text-slate-600 transition hover:bg-slate-50 disabled:opacity-40"
            >
              📎
            </button>
            <textarea
              rows={1}
              value={text}
              disabled={sending}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              placeholder={sending ? "Waiting for a reply…" : "Type what happened, or attach a screenshot…"}
              className="flex-1 resize-none rounded-xl border border-slate-300 px-3 py-3 text-sm focus:border-orange-400 focus:outline-none focus:ring-2 focus:ring-orange-100 disabled:bg-slate-50 disabled:text-slate-400"
            />
            <button
              type="button"
              disabled={sending || (!text.trim() && images.length === 0)}
              onClick={handleSend}
              className="flex-shrink-0 rounded-xl bg-orange-600 px-5 py-3 text-sm font-black text-white transition hover:bg-orange-700 disabled:opacity-40"
            >
              Send
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
