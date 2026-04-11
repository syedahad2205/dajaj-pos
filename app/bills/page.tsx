'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { signOut } from 'firebase/auth';
import { clearAdminBypassSession } from '@/lib/devAuth';
import { auth } from '@/lib/firebase';
import { getBillsByDate, updateBillByNumber, type Bill } from '@/lib/firestore';
import { requireAdmin } from '@/lib/roleGuard';

type PaymentMode = 'Cash' | 'Card' | 'UPI';

const PAYMENT_STYLE: Record<string, string> = {
  Cash: 'bg-green-100 text-green-800',
  UPI: 'bg-blue-100 text-blue-800',
  Card: 'bg-purple-100 text-purple-800',
};

function OrderLabel({ name }: { name: string }) {
  if (/^\d{10}$/.test(name)) {
    return (
      <span className="font-mono">
        <span className="text-neutral-400 text-xs">{name.slice(0, 6)}</span>
        <span className="text-orange-600 font-extrabold text-sm">#{name.slice(6)}</span>
      </span>
    );
  }
  return <span className="font-semibold text-neutral-900 text-sm">{name || 'N/A'}</span>;
}

function formatTime(ts: unknown): string {
  if (ts && typeof ts === 'object' && 'toDate' in ts && typeof (ts as { toDate: () => Date }).toDate === 'function') {
    return (ts as { toDate: () => Date }).toDate().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
  }
  return '—';
}

type EditState = { billNo: string; customerName: string; paymentMode: string };

export default function BillsHistoryPage() {
  const { authenticated, loading, role } = requireAdmin();
  const router = useRouter();
  const [bills, setBills] = useState<Bill[]>([]);
  const [loadingBills, setLoadingBills] = useState(false);
  const [selectedDate, setSelectedDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [editBill, setEditBill] = useState<EditState | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (authenticated) void loadBills();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate, authenticated]);

  const loadBills = async () => {
    setLoadingBills(true);
    try {
      setBills(await getBillsByDate(new Date(selectedDate)));
    } catch {
      setBills([]);
    } finally {
      setLoadingBills(false);
    }
  };

  const report = useMemo(() => {
    const sum = (mode: string) => bills.filter((b) => b.paymentMode === mode).reduce((s, b) => s + b.grandTotal, 0);
    const cash = sum('Cash');
    const upi = sum('UPI');
    const card = sum('Card');
    return { cash, upi, card, total: bills.reduce((s, b) => s + b.grandTotal, 0), count: bills.length };
  }, [bills]);

  const handleSave = async () => {
    if (!editBill) return;
    setSaving(true);
    try {
      await updateBillByNumber(editBill.billNo, {
        customer: { name: editBill.customerName },
        paymentMode: editBill.paymentMode,
      });
      setBills((prev) =>
        prev.map((b) =>
          b.billNo === editBill.billNo
            ? { ...b, customer: { ...b.customer, name: editBill.customerName }, paymentMode: editBill.paymentMode }
            : b,
        ),
      );
      setEditBill(null);
    } catch {
      alert('Failed to save. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-neutral-50">
        <p className="text-neutral-400">Loading…</p>
      </div>
    );
  }
  if (!authenticated || role !== 'admin') return null;

  return (
    <div className="min-h-dvh bg-neutral-100">

      {/* Header */}
      <header className="bg-white border-b border-neutral-200 px-4 py-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push('/pos')}
            className="text-sm font-medium text-neutral-500 hover:text-neutral-900 transition-colors"
          >
            ← POS
          </button>
          <h1 className="text-lg font-bold text-neutral-900">Bill History</h1>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="px-3 py-1.5 text-sm rounded-lg border border-neutral-300 bg-white focus:outline-none focus:ring-2 focus:ring-orange-400"
          />
          <button
            onClick={async () => { clearAdminBypassSession(); await signOut(auth); router.push('/admin/login'); }}
            className="px-3 py-1.5 text-sm rounded-lg bg-neutral-900 text-white hover:bg-neutral-700 transition-colors"
          >
            Logout
          </button>
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-4 py-6 space-y-4">

        {/* Daily Report */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="col-span-2 sm:col-span-1 bg-white rounded-xl border border-neutral-200 px-4 py-3">
            <p className="text-xs text-neutral-400 font-medium">Total Bills</p>
            <p className="text-2xl font-extrabold text-neutral-900 mt-0.5">{report.count}</p>
            <p className="text-xs text-neutral-500 mt-0.5 font-semibold">₹{report.total.toFixed(0)} collected</p>
          </div>
          <div className="bg-white rounded-xl border border-neutral-200 px-4 py-3">
            <p className="text-xs text-green-600 font-semibold">💵 Cash</p>
            <p className="text-xl font-extrabold text-green-700 mt-0.5">₹{report.cash.toFixed(0)}</p>
            <p className="text-xs text-neutral-400 mt-0.5">
              {bills.filter((b) => b.paymentMode === 'Cash').length} bills
            </p>
          </div>
          <div className="bg-white rounded-xl border border-neutral-200 px-4 py-3">
            <p className="text-xs text-blue-600 font-semibold">📲 UPI</p>
            <p className="text-xl font-extrabold text-blue-700 mt-0.5">₹{report.upi.toFixed(0)}</p>
            <p className="text-xs text-neutral-400 mt-0.5">
              {bills.filter((b) => b.paymentMode === 'UPI').length} bills
            </p>
          </div>
          <div className="bg-white rounded-xl border border-neutral-200 px-4 py-3">
            <p className="text-xs text-purple-600 font-semibold">💳 Card</p>
            <p className="text-xl font-extrabold text-purple-700 mt-0.5">₹{report.card.toFixed(0)}</p>
            <p className="text-xs text-neutral-400 mt-0.5">
              {bills.filter((b) => b.paymentMode === 'Card').length} bills
            </p>
          </div>
        </div>

        {/* Bills List */}
        <div className="bg-white rounded-xl border border-neutral-200 overflow-hidden">
          <div className="px-4 py-3 border-b border-neutral-100 flex items-center justify-between">
            <p className="text-sm font-semibold text-neutral-700">
              {loadingBills ? 'Loading…' : `${bills.length} bill${bills.length !== 1 ? 's' : ''}`}
            </p>
          </div>

          {loadingBills ? (
            <div className="py-16 text-center text-neutral-400 text-sm">Loading bills…</div>
          ) : bills.length === 0 ? (
            <div className="py-16 text-center text-neutral-400 text-sm">No bills for this date.</div>
          ) : (
            <div className="divide-y divide-neutral-100">
              {bills.map((bill) => (
                <div key={bill.billNo} className="flex items-center gap-3 px-4 py-3 hover:bg-neutral-50 transition-colors">

                  {/* Order label */}
                  <div className="w-28 flex-shrink-0">
                    <OrderLabel name={bill.customer.name} />
                  </div>

                  {/* Bill number + time + operator */}
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-neutral-400 font-mono truncate">{bill.billNo}</p>
                    <p className="text-xs text-neutral-400 mt-0.5">{formatTime(bill.createdAt)}</p>
                    {bill.punchedBy && (
                      <p className="text-xs text-neutral-400 truncate mt-0.5">👤 {bill.punchedBy}</p>
                    )}
                  </div>

                  {/* Payment badge */}
                  <span className={`hidden sm:inline-flex flex-shrink-0 text-xs font-semibold px-2.5 py-1 rounded-full ${PAYMENT_STYLE[bill.paymentMode] ?? 'bg-neutral-100 text-neutral-600'}`}>
                    {bill.paymentMode || 'N/A'}
                  </span>

                  {/* Amount */}
                  <p className="text-sm font-bold text-neutral-900 w-16 text-right flex-shrink-0">
                    ₹{bill.grandTotal.toFixed(0)}
                  </p>

                  {/* Actions */}
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <button
                      onClick={() => setEditBill({ billNo: bill.billNo, customerName: bill.customer.name, paymentMode: bill.paymentMode })}
                      className="px-2.5 py-1.5 text-xs font-semibold rounded-lg bg-neutral-100 hover:bg-neutral-200 text-neutral-600 transition-colors"
                    >
                      Edit
                    </button>
                    <a
                      href={`/bill/${bill.billNo}?token=${encodeURIComponent(bill.publicToken)}`}
                      className="px-2.5 py-1.5 text-xs font-semibold rounded-lg bg-orange-600 hover:bg-orange-700 text-white transition-colors"
                    >
                      View
                    </a>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Edit Modal */}
      {editBill && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4">
            <div>
              <h2 className="text-lg font-bold text-neutral-900">Edit Bill</h2>
              <p className="text-xs text-neutral-400 font-mono mt-0.5">{editBill.billNo}</p>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-semibold text-neutral-400 uppercase tracking-wider">Order Name</label>
              <input
                type="text"
                value={editBill.customerName}
                onChange={(e) => setEditBill((p) => p ? { ...p, customerName: e.target.value } : p)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-neutral-300 focus:outline-none focus:ring-2 focus:ring-orange-400"
              />
            </div>

            <div className="space-y-2">
              <label className="text-xs font-semibold text-neutral-400 uppercase tracking-wider">Payment Mode</label>
              <div className="grid grid-cols-3 gap-2">
                {(['Cash', 'Card', 'UPI'] as PaymentMode[]).map((mode) => (
                  <button
                    key={mode}
                    onClick={() => setEditBill((p) => p ? { ...p, paymentMode: mode } : p)}
                    className={`py-2.5 rounded-xl text-sm font-bold border-2 transition-all ${
                      editBill.paymentMode === mode
                        ? 'border-orange-500 bg-orange-50 text-orange-700'
                        : 'border-neutral-200 bg-white text-neutral-600 hover:border-neutral-300'
                    }`}
                  >
                    {mode === 'Cash' ? '💵' : mode === 'UPI' ? '📲' : '💳'}<br />
                    <span className="text-xs">{mode}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="flex gap-3 pt-1">
              <button
                onClick={() => setEditBill(null)}
                disabled={saving}
                className="flex-1 py-2.5 rounded-xl border border-neutral-300 text-sm font-semibold text-neutral-600 hover:bg-neutral-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => void handleSave()}
                disabled={saving}
                className="flex-1 py-2.5 rounded-xl bg-orange-600 hover:bg-orange-700 text-white text-sm font-bold transition-colors disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
