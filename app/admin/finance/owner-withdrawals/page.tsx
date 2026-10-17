"use client";

import { useEffect, useMemo, useState } from "react";
import { requireAdmin } from "@/lib/roleGuard";
import { firebaseAuthedFetch } from "@/lib/firebaseAuthFetch";
import { formatCurrency, formatDateDisplay, todayDateKey } from "@/lib/financeFormat";
import {
  DEFAULT_OWNER_WITHDRAWAL_PARTNER_PCT,
  OWNER_WITHDRAWAL_OWNER_NAME,
  OWNER_WITHDRAWAL_PARTNER_NAME,
  roundCurrency,
  splitOwnerWithdrawal,
  type FinanceAccount,
  type FinanceTransaction,
} from "@/lib/finance";
import FinanceNav from "@/components/finance/FinanceNav";
import NativeDateField from "@/components/ui/NativeDateField";
import Modal from "@/components/finance/Modal";

async function readJson(response: Response) {
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.success) throw new Error(payload?.message || "Request failed.");
  return payload;
}

type PeriodKey = "this_month" | "last_month" | "this_year" | "custom";

function periodRange(key: PeriodKey, custom: { from: string; to: string }): { from: string; to: string } {
  const today = todayDateKey();
  const [y, m] = today.split("-").map(Number);
  const pad = (n: number) => String(n).padStart(2, "0");
  if (key === "this_month") return { from: `${y}-${pad(m)}-01`, to: today };
  if (key === "last_month") {
    const ly = m === 1 ? y - 1 : y;
    const lm = m === 1 ? 12 : m - 1;
    const lastDay = new Date(ly, lm, 0).getDate();
    return { from: `${ly}-${pad(lm)}-01`, to: `${ly}-${pad(lm)}-${pad(lastDay)}` };
  }
  if (key === "this_year") return { from: `${y}-01-01`, to: today };
  return custom;
}

interface PnlSummary {
  netPnl: number;
  closedDays: number;
  ownerWithdrawals?: { count: number; total: number; ownerTotal: number; partnerTotal: number };
  retainedProfit?: number;
}

/** Accounts profit can be taken from. Escrow holds Zomato/Swiggy money that isn't ours yet. */
function isWithdrawable(a: FinanceAccount) {
  return a.status === "active" && a.type !== "escrow";
}

export default function OwnerWithdrawalsPage() {
  const { authenticated, loading, role } = requireAdmin();
  const canQuery = authenticated && role === "admin";

  const [period, setPeriod] = useState<PeriodKey>("this_month");
  const [custom, setCustom] = useState({ from: todayDateKey(), to: todayDateKey() });
  const range = periodRange(period, custom);

  const [accounts, setAccounts] = useState<FinanceAccount[]>([]);
  const [withdrawals, setWithdrawals] = useState<FinanceTransaction[]>([]);
  const [pnl, setPnl] = useState<PnlSummary | null>(null);
  const [fetching, setFetching] = useState(true);
  const [pnlLoading, setPnlLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [amount, setAmount] = useState("");
  const [partnerPct, setPartnerPct] = useState(String(DEFAULT_OWNER_WITHDRAWAL_PARTNER_PCT));
  const [date, setDate] = useState(todayDateKey());
  const [fromAccountId, setFromAccountId] = useState("");
  const [remarks, setRemarks] = useState("");
  const [saving, setSaving] = useState(false);
  const [voidingId, setVoidingId] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [modalError, setModalError] = useState("");
  const [voidTarget, setVoidTarget] = useState<FinanceTransaction | null>(null);
  const [voidReason, setVoidReason] = useState("");

  const loadLedger = async () => {
    const [accountsPayload, withdrawalsPayload] = await Promise.all([
      readJson(await firebaseAuthedFetch("/api/finance/accounts")),
      readJson(await firebaseAuthedFetch("/api/finance/owner-withdrawals")),
    ]);
    setAccounts(accountsPayload.accounts);
    setWithdrawals(withdrawalsPayload.withdrawals);
  };

  const loadPnl = async () => {
    setPnlLoading(true);
    try {
      const payload = await readJson(await firebaseAuthedFetch(`/api/finance/reports/pnl?dateFrom=${range.from}&dateTo=${range.to}`));
      setPnl(payload.summary);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load profit.");
    } finally {
      setPnlLoading(false);
    }
  };

  useEffect(() => {
    if (!canQuery) return;
    void (async () => {
      setFetching(true);
      try {
        await loadLedger();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load.");
      } finally {
        setFetching(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canQuery]);

  useEffect(() => {
    if (!canQuery || !range.from || !range.to || range.from > range.to) return;
    void loadPnl();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canQuery, range.from, range.to]);

  const amountValue = Number(amount);
  const pctValue = Number(partnerPct);
  const validAmount = Number.isFinite(amountValue) && amountValue > 0;
  const validPct = partnerPct.trim() !== "" && Number.isFinite(pctValue) && pctValue >= 0 && pctValue <= 100;
  const split = validAmount && validPct ? splitOwnerWithdrawal(roundCurrency(amountValue), pctValue) : null;

  const withdrawable = accounts.filter(isWithdrawable);
  // Suggest the bank account with the most money that can cover the amount;
  // otherwise whichever withdrawable account holds the most.
  const suggested = useMemo(() => {
    const need = validAmount ? amountValue : 0;
    const byBalance = [...withdrawable].sort((a, b) => b.currentBalance - a.currentBalance);
    return byBalance.find((a) => a.type === "bank" && a.currentBalance >= need) ?? byBalance.find((a) => a.currentBalance >= need) ?? null;
  }, [withdrawable, validAmount, amountValue]);

  useEffect(() => {
    if (!fromAccountId && suggested) setFromAccountId(suggested.id);
  }, [fromAccountId, suggested]);

  const selected = accounts.find((a) => a.id === fromAccountId) ?? null;
  const overdraw = Boolean(selected && validAmount && amountValue > selected.currentBalance);
  const available = pnl?.retainedProfit ?? null;
  const exceedsProfit = available !== null && validAmount && amountValue > available;

  const posted = withdrawals.filter((w) => w.status === "posted");
  const allTime = posted.reduce(
    (acc, w) => ({
      total: acc.total + w.amount,
      owner: acc.owner + (w.withdrawalSplit?.ownerAmount ?? w.amount),
      partner: acc.partner + (w.withdrawalSplit?.partnerAmount ?? 0),
    }),
    { total: 0, owner: 0, partner: 0 },
  );
  const byMonth = Array.from(
    posted
      .reduce((map, w) => {
        const key = w.date.slice(0, 7);
        const row = map.get(key) ?? { month: key, count: 0, total: 0, owner: 0, partner: 0 };
        row.count += 1;
        row.total = roundCurrency(row.total + w.amount);
        row.owner = roundCurrency(row.owner + (w.withdrawalSplit?.ownerAmount ?? w.amount));
        row.partner = roundCurrency(row.partner + (w.withdrawalSplit?.partnerAmount ?? 0));
        return map.set(key, row);
      }, new Map<string, { month: string; count: number; total: number; owner: number; partner: number }>())
      .values(),
  ).sort((a, b) => (a.month < b.month ? 1 : -1));

  if (loading) {
    return <main className="min-h-screen bg-[#fff8ed] px-4 py-10 text-slate-900">Checking your session…</main>;
  }
  if (!canQuery) return null;

  const openConfirm = () => {
    if (!split || !selected) return;
    setModalError("");
    setConfirmOpen(true);
  };

  const handleSubmit = async () => {
    if (!split || !selected) return;
    setSaving(true);
    setModalError("");
    setError("");
    setNotice("");
    try {
      await readJson(
        await firebaseAuthedFetch("/api/finance/owner-withdrawals", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ date, amount: amountValue, fromAccountId, partnerPct: pctValue, remarks }),
        }),
      );
      setNotice(`Withdrawn ${formatCurrency(amountValue)} from ${selected.name}.`);
      setConfirmOpen(false);
      setAmount("");
      setRemarks("");
      setPartnerPct(String(DEFAULT_OWNER_WITHDRAWAL_PARTNER_PCT));
      await Promise.all([loadLedger(), loadPnl()]);
    } catch (err) {
      setModalError(err instanceof Error ? err.message : "Failed to save the withdrawal.");
    } finally {
      setSaving(false);
    }
  };

  const openVoid = (w: FinanceTransaction) => {
    setVoidReason("");
    setModalError("");
    setVoidTarget(w);
  };

  const handleVoid = async () => {
    const w = voidTarget;
    const reason = voidReason.trim();
    if (!w || !reason) return;
    setVoidingId(w.id);
    setModalError("");
    setError("");
    setNotice("");
    try {
      await readJson(
        await firebaseAuthedFetch(`/api/finance/transactions/${w.id}/void`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason }),
        }),
      );
      setVoidTarget(null);
      setNotice(`Voided — ${formatCurrency(w.amount)} is back in ${w.fromAccountName ?? "the account"}.`);
      await Promise.all([loadLedger(), loadPnl()]);
    } catch (err) {
      setModalError(err instanceof Error ? err.message : "Failed to void.");
    } finally {
      setVoidingId(null);
    }
  };

  const inputClass =
    "w-full rounded-xl border border-slate-300 px-3 py-2.5 text-base outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100";

  return (
    <main className="min-h-screen bg-[#fff8ed] px-4 py-8 text-slate-900">
      <div className="mx-auto max-w-5xl space-y-5">
        <header className="rounded-[28px] border border-orange-200 bg-white p-6 shadow-sm">
          <p className="text-sm font-semibold uppercase tracking-[0.28em] text-orange-600">Finance · Admin Only</p>
          <h1 className="mt-1 text-3xl font-black">Owner Withdrawals</h1>
          <p className="mt-2 text-sm text-slate-600">
            Take profit out of the business, split between {OWNER_WITHDRAWAL_OWNER_NAME} and {OWNER_WITHDRAWAL_PARTNER_NAME}. It reduces the chosen
            account&apos;s balance but is never counted as an expense, so profit figures stay true.
          </p>
          <div className="mt-5">
            <FinanceNav role={role} />
          </div>
        </header>

        {notice ? <p className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700">{notice}</p> : null}
        {error ? <p className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">{error}</p> : null}

        {/* ── How much can I take ── */}
        <section className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <h2 className="text-lg font-black">Profit available</h2>
            <div className="flex flex-wrap items-end gap-2">
              {(
                [
                  ["this_month", "This month"],
                  ["last_month", "Last month"],
                  ["this_year", "This year"],
                  ["custom", "Custom"],
                ] as [PeriodKey, string][]
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setPeriod(key)}
                  className={`rounded-xl px-3 py-1.5 text-xs font-semibold ${period === key ? "bg-slate-900 text-white" : "border border-slate-300 text-slate-700 hover:bg-slate-50"}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          {period === "custom" ? (
            <div className="mt-3 flex flex-wrap gap-3">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-500">From</label>
                <NativeDateField value={custom.from} max={todayDateKey()} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-500">To</label>
                <NativeDateField value={custom.to} max={todayDateKey()} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} />
              </div>
            </div>
          ) : null}
          <p className="mt-2 text-xs text-slate-400">
            {formatDateDisplay(range.from)} – {formatDateDisplay(range.to)} · net profit from the P&amp;L (closed days only)
          </p>

          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl bg-slate-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Net profit</p>
              <p className={`mt-1 text-2xl font-black ${(pnl?.netPnl ?? 0) < 0 ? "text-rose-600" : "text-slate-900"}`}>
                {pnlLoading ? "…" : formatCurrency(pnl?.netPnl ?? 0)}
              </p>
              <p className="text-xs text-slate-400">{pnl ? `${pnl.closedDays} closed day(s)` : ""}</p>
            </div>
            <div className="rounded-2xl bg-violet-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-violet-500">Already withdrawn</p>
              <p className="mt-1 text-2xl font-black text-violet-700">{pnlLoading ? "…" : formatCurrency(pnl?.ownerWithdrawals?.total ?? 0)}</p>
              <p className="text-xs text-violet-500">
                Self {formatCurrency(pnl?.ownerWithdrawals?.ownerTotal ?? 0)} · Juice Lab {formatCurrency(pnl?.ownerWithdrawals?.partnerTotal ?? 0)}
              </p>
            </div>
            <div className="rounded-2xl bg-emerald-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-emerald-600">Still in the business</p>
              <p className={`mt-1 text-2xl font-black ${(available ?? 0) < 0 ? "text-rose-600" : "text-emerald-700"}`}>
                {pnlLoading ? "…" : formatCurrency(available ?? 0)}
              </p>
              <p className="text-xs text-emerald-600">Net profit − withdrawn</p>
            </div>
          </div>
        </section>

        {/* ── New withdrawal ── */}
        <section className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-black">New withdrawal</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-500">Total amount (₹)</label>
              <input type="number" inputMode="decimal" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className={inputClass} placeholder="0" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-500">Juice Lab share (%)</label>
              <input type="number" inputMode="decimal" min="0" max="100" step="0.5" value={partnerPct} onChange={(e) => setPartnerPct(e.target.value)} className={inputClass} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-500">Date</label>
              <NativeDateField value={date} max={todayDateKey()} onChange={(e) => setDate(e.target.value)} />
            </div>
          </div>

          {split ? (
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <div className="rounded-xl border border-slate-200 px-3 py-2 text-sm">
                <span className="text-slate-500">{OWNER_WITHDRAWAL_OWNER_NAME}</span>
                <span className="float-right font-bold">{formatCurrency(split.ownerAmount)}</span>
              </div>
              <div className="rounded-xl border border-slate-200 px-3 py-2 text-sm">
                <span className="text-slate-500">
                  {OWNER_WITHDRAWAL_PARTNER_NAME} · {split.partnerPct}%
                </span>
                <span className="float-right font-bold">{formatCurrency(split.partnerAmount)}</span>
              </div>
            </div>
          ) : !validPct ? (
            <p className="mt-2 text-xs font-semibold text-rose-600">Juice Lab share must be between 0 and 100%.</p>
          ) : null}

          <p className="mt-5 text-xs font-semibold uppercase tracking-wide text-slate-500">Take it from</p>
          {fetching ? (
            <p className="mt-2 text-sm text-slate-500">Loading accounts…</p>
          ) : (
            <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {withdrawable.map((a) => {
                const short = validAmount && a.currentBalance < amountValue;
                const isSelected = a.id === fromAccountId;
                return (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => setFromAccountId(a.id)}
                    className={`rounded-2xl border px-4 py-3 text-left transition ${
                      isSelected ? "border-violet-500 bg-violet-50 ring-2 ring-violet-200" : "border-slate-200 hover:bg-slate-50"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold">{a.name}</span>
                      {suggested?.id === a.id ? (
                        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold uppercase text-emerald-700">Suggested</span>
                      ) : null}
                    </div>
                    <p className={`text-sm ${short ? "text-rose-600" : "text-slate-600"}`}>{formatCurrency(a.currentBalance)}</p>
                    <p className="text-[11px] capitalize text-slate-400">
                      {a.type}
                      {short ? " · not enough" : ""}
                    </p>
                  </button>
                );
              })}
            </div>
          )}
          {selected?.type === "cash" ? (
            <p className="mt-2 text-xs text-amber-700">
              Taking cash from the drawer: do it on a day whose Daily Closing is still open. It&apos;s counted as cash leaving the till, so Cash Sales
              stay correct.
            </p>
          ) : null}

          <div className="mt-4">
            <label className="mb-1 block text-xs font-semibold text-slate-500">Note (optional)</label>
            <input value={remarks} onChange={(e) => setRemarks(e.target.value)} className={inputClass} placeholder="e.g. October profit" maxLength={500} />
          </div>

          {overdraw ? <p className="mt-3 text-sm font-semibold text-rose-600">{selected?.name} doesn&apos;t hold that much.</p> : null}
          {exceedsProfit && !overdraw ? (
            <p className="mt-3 text-sm font-semibold text-amber-700">
              This is more than the profit still in the business for the selected period ({formatCurrency(available ?? 0)}).
            </p>
          ) : null}

          <button
            type="button"
            disabled={saving || !split || !selected || overdraw}
            onClick={openConfirm}
            className="mt-4 rounded-2xl bg-violet-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-violet-700 disabled:opacity-50"
          >
            {saving ? "Saving…" : split ? `Withdraw ${formatCurrency(split.ownerAmount + split.partnerAmount)}` : "Withdraw"}
          </button>
        </section>

        {/* ── Totals ── */}
        <section className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-black">All-time totals</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl bg-slate-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Total withdrawn</p>
              <p className="mt-1 text-2xl font-black">{formatCurrency(roundCurrency(allTime.total))}</p>
            </div>
            <div className="rounded-2xl bg-slate-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{OWNER_WITHDRAWAL_OWNER_NAME}</p>
              <p className="mt-1 text-2xl font-black">{formatCurrency(roundCurrency(allTime.owner))}</p>
            </div>
            <div className="rounded-2xl bg-slate-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{OWNER_WITHDRAWAL_PARTNER_NAME}</p>
              <p className="mt-1 text-2xl font-black">{formatCurrency(roundCurrency(allTime.partner))}</p>
            </div>
          </div>

          {byMonth.length > 0 ? (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[480px] text-sm">
                <thead className="text-left text-xs font-semibold uppercase tracking-wide text-slate-400">
                  <tr>
                    <th className="py-2">Month</th>
                    <th className="py-2 text-right">Withdrawals</th>
                    <th className="py-2 text-right">Total</th>
                    <th className="py-2 text-right">Self</th>
                    <th className="py-2 text-right">Juice Lab</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {byMonth.map((r) => (
                    <tr key={r.month}>
                      <td className="py-2 font-semibold">{new Date(`${r.month}-01T00:00:00`).toLocaleDateString("en-IN", { month: "long", year: "numeric" })}</td>
                      <td className="py-2 text-right">{r.count}</td>
                      <td className="py-2 text-right font-semibold">{formatCurrency(r.total)}</td>
                      <td className="py-2 text-right">{formatCurrency(r.owner)}</td>
                      <td className="py-2 text-right">{formatCurrency(r.partner)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </section>

        {/* ── History ── */}
        <section className="rounded-[28px] border border-slate-200 bg-white shadow-sm">
          <h2 className="px-6 pt-6 text-lg font-black">History</h2>
          {fetching ? (
            <p className="p-6 text-sm text-slate-500">Loading…</p>
          ) : withdrawals.length === 0 ? (
            <p className="p-10 text-center text-sm font-semibold text-slate-400">No owner withdrawals yet.</p>
          ) : (
            <div className="overflow-x-auto p-2">
              <table className="w-full min-w-[760px] text-sm">
                <thead className="text-left text-xs font-semibold uppercase tracking-wide text-slate-400">
                  <tr>
                    <th className="px-4 py-2">Date</th>
                    <th className="px-4 py-2 text-right">Total</th>
                    <th className="px-4 py-2 text-right">Self</th>
                    <th className="px-4 py-2 text-right">Juice Lab</th>
                    <th className="px-4 py-2">From</th>
                    <th className="px-4 py-2">Note</th>
                    <th className="px-4 py-2">By</th>
                    <th className="px-4 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {withdrawals.map((w) => {
                    const voided = w.status === "void";
                    return (
                      <tr key={w.id} className={voided ? "text-slate-400 line-through" : ""}>
                        <td className="whitespace-nowrap px-4 py-3">{formatDateDisplay(w.date)}</td>
                        <td className="px-4 py-3 text-right font-bold">{formatCurrency(w.amount)}</td>
                        <td className="px-4 py-3 text-right">{formatCurrency(w.withdrawalSplit?.ownerAmount ?? w.amount)}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-right">
                          {formatCurrency(w.withdrawalSplit?.partnerAmount ?? 0)}
                          <span className="ml-1 text-xs text-slate-400">({w.withdrawalSplit?.partnerPct ?? 0}%)</span>
                        </td>
                        <td className="px-4 py-3">{w.fromAccountName ?? "—"}</td>
                        <td className="px-4 py-3 text-slate-500">{w.remarks || "—"}</td>
                        <td className="px-4 py-3 text-slate-500">{w.createdByName}</td>
                        <td className="px-4 py-3 text-right no-underline">
                          {voided ? (
                            <span className="text-xs font-semibold" title={w.voidReason ?? ""}>
                              Voided
                            </span>
                          ) : (
                            <button
                              type="button"
                              disabled={voidingId === w.id}
                              onClick={() => openVoid(w)}
                              className="text-xs font-semibold text-rose-600 hover:underline disabled:opacity-50"
                            >
                              Void
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      {confirmOpen && split && selected ? (
        <Modal title="Confirm owner withdrawal" subtitle={`${formatDateDisplay(date)} · not counted as an expense`} onClose={() => !saving && setConfirmOpen(false)}>
          <div className="space-y-4">
            <div className="rounded-2xl bg-violet-50 p-4 text-center">
              <p className="text-xs font-semibold uppercase tracking-wide text-violet-500">Taking out</p>
              <p className="mt-1 text-3xl font-black text-violet-700">{formatCurrency(split.ownerAmount + split.partnerAmount)}</p>
              <p className="mt-1 text-sm text-slate-600">
                from <span className="font-semibold text-slate-900">{selected.name}</span>
              </p>
            </div>

            <div className="divide-y divide-slate-100 rounded-2xl border border-slate-200 text-sm">
              <div className="flex items-center justify-between px-4 py-3">
                <span className="text-slate-600">{OWNER_WITHDRAWAL_OWNER_NAME}</span>
                <span className="font-bold">{formatCurrency(split.ownerAmount)}</span>
              </div>
              <div className="flex items-center justify-between px-4 py-3">
                <span className="text-slate-600">
                  {OWNER_WITHDRAWAL_PARTNER_NAME} <span className="text-slate-400">· {split.partnerPct}%</span>
                </span>
                <span className="font-bold">{formatCurrency(split.partnerAmount)}</span>
              </div>
              <div className="flex items-center justify-between gap-3 bg-slate-50 px-4 py-3">
                <span className="text-slate-500">{selected.name} balance</span>
                <span className="text-right font-semibold text-slate-700">
                  {formatCurrency(selected.currentBalance)} → {formatCurrency(roundCurrency(selected.currentBalance - split.ownerAmount - split.partnerAmount))}
                </span>
              </div>
            </div>

            {remarks.trim() ? <p className="text-sm text-slate-500">Note: {remarks.trim()}</p> : null}
            {exceedsProfit ? (
              <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800">
                More than the profit still in the business for the selected period ({formatCurrency(available ?? 0)}).
              </p>
            ) : null}
            {modalError ? <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700">{modalError}</p> : null}

            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                disabled={saving}
                onClick={() => setConfirmOpen(false)}
                className="rounded-2xl border border-slate-300 px-5 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={handleSubmit}
                className="rounded-2xl bg-violet-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-violet-700 disabled:opacity-50"
              >
                {saving ? "Saving…" : `Withdraw ${formatCurrency(split.ownerAmount + split.partnerAmount)}`}
              </button>
            </div>
          </div>
        </Modal>
      ) : null}

      {voidTarget ? (
        <Modal
          title="Void this withdrawal?"
          subtitle={`${formatDateDisplay(voidTarget.date)} · ${formatCurrency(voidTarget.amount)} goes back into ${voidTarget.fromAccountName ?? "the account"}`}
          onClose={() => voidingId === null && setVoidTarget(null)}
        >
          <div className="space-y-4">
            <div className="divide-y divide-slate-100 rounded-2xl border border-slate-200 text-sm">
              <div className="flex items-center justify-between px-4 py-3">
                <span className="text-slate-600">{OWNER_WITHDRAWAL_OWNER_NAME}</span>
                <span className="font-bold">{formatCurrency(voidTarget.withdrawalSplit?.ownerAmount ?? voidTarget.amount)}</span>
              </div>
              <div className="flex items-center justify-between px-4 py-3">
                <span className="text-slate-600">{OWNER_WITHDRAWAL_PARTNER_NAME}</span>
                <span className="font-bold">{formatCurrency(voidTarget.withdrawalSplit?.partnerAmount ?? 0)}</span>
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-500">Reason (required, kept in the audit log)</label>
              <input
                autoFocus
                value={voidReason}
                onChange={(e) => setVoidReason(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && voidReason.trim()) void handleVoid();
                }}
                className={inputClass}
                placeholder="e.g. Entered twice"
                maxLength={300}
              />
            </div>
            {modalError ? <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700">{modalError}</p> : null}
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                disabled={voidingId !== null}
                onClick={() => setVoidTarget(null)}
                className="rounded-2xl border border-slate-300 px-5 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
              >
                Keep it
              </button>
              <button
                type="button"
                disabled={voidingId !== null || !voidReason.trim()}
                onClick={() => void handleVoid()}
                className="rounded-2xl bg-rose-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-rose-700 disabled:opacity-50"
              >
                {voidingId ? "Voiding…" : "Void withdrawal"}
              </button>
            </div>
          </div>
        </Modal>
      ) : null}
    </main>
  );
}
