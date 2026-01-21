'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { getBillsByDate, type Bill } from '@/lib/firestore';

const SOFT_BLACK = '#1a1a1a';
const SOFT_WHITE = '#fafafa';
const SOFT_GRAY = '#e8e8e8';
const BRAND_RED = '#d43f2f';

export default function BillsHistoryPage() {
  const [authenticated, setAuthenticated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [bills, setBills] = useState<Bill[]>([]);
  const [loadingBills, setLoadingBills] = useState(false);
  const [selectedDate, setSelectedDate] = useState(() => {
    // Default to today
    const today = new Date();
    return today.toISOString().split('T')[0];
  });
  const router = useRouter();

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (user) {
        setAuthenticated(true);
      } else {
        router.push('/login');
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, [router]);

  useEffect(() => {
    if (authenticated && selectedDate) {
      loadBills();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate, authenticated]);

  const loadBills = async () => {
    if (!selectedDate) return;
    
    setLoadingBills(true);
    try {
      const date = new Date(selectedDate);
      const billsData = await getBillsByDate(date);
      setBills(billsData);
    } catch (error) {
      console.error('Error loading bills:', error);
      setBills([]);
    } finally {
      setLoadingBills(false);
    }
  };

  const handleLogout = async () => {
    await signOut(auth);
    router.push('/login');
  };

  const formatDate = (date: Date | string) => {
    const d = typeof date === 'string' ? new Date(date) : date;
    return d.toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric'
    });
  };

  const formatTime = (date: Date | string) => {
    const d = typeof date === 'string' ? new Date(date) : date;
    return d.toLocaleTimeString('en-IN', {
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <div className="text-xl" style={{ color: SOFT_BLACK }}>Loading...</div>
      </div>
    );
  }

  if (!authenticated) {
    return null;
  }

  return (
    <div className="min-h-screen bg-white">
      <div className="border-b" style={{ borderColor: SOFT_GRAY }}>
        <div className="max-w-7xl mx-auto px-4 py-4 flex justify-between items-center">
          <h1 className="text-2xl font-bold" style={{ color: SOFT_BLACK }}>Bill History</h1>
          <div className="flex gap-3">
            <button
              onClick={() => router.push('/pos')}
              className="px-4 py-2 rounded-md transition-colors"
              style={{ backgroundColor: SOFT_GRAY, color: SOFT_BLACK, border: `1px solid ${SOFT_GRAY}` }}
              onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#e0e0e0'}
              onMouseLeave={(e) => e.currentTarget.style.backgroundColor = SOFT_GRAY}
            >
              Back to POS
            </button>
            <button
              onClick={handleLogout}
              className="px-4 py-2 rounded-md transition-colors"
              style={{ backgroundColor: SOFT_BLACK, color: SOFT_WHITE }}
              onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#2a2a2a'}
              onMouseLeave={(e) => e.currentTarget.style.backgroundColor = SOFT_BLACK}
            >
              Logout
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-6">
        <div className="bg-white border rounded-lg p-6" style={{ borderColor: SOFT_GRAY }}>
          <div className="mb-6">
            <label className="block text-sm font-medium mb-2" style={{ color: SOFT_BLACK }}>
              Select Date
            </label>
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="px-3 py-2 rounded-md border focus:outline-none focus:ring-2 transition-colors"
              style={{ 
                borderColor: SOFT_GRAY,
                color: SOFT_BLACK,
                borderWidth: '1px'
              }}
              onFocus={(e) => {
                e.currentTarget.style.borderColor = BRAND_RED;
                e.currentTarget.style.boxShadow = `0 0 0 2px ${BRAND_RED}20`;
              }}
              onBlur={(e) => {
                e.currentTarget.style.borderColor = SOFT_GRAY;
                e.currentTarget.style.boxShadow = 'none';
              }}
            />
          </div>

          {loadingBills ? (
            <div className="text-center py-8" style={{ color: SOFT_BLACK + '99' }}>
              Loading bills...
            </div>
          ) : bills.length === 0 ? (
            <div className="text-center py-8" style={{ color: SOFT_BLACK + '99' }}>
              No bills found for {formatDate(selectedDate)}
            </div>
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-5 gap-4 pb-3 border-b font-semibold text-sm" style={{ borderColor: SOFT_GRAY, color: SOFT_BLACK }}>
                <div>Bill No</div>
                <div>Customer Name</div>
                <div>Mobile</div>
                <div>Amount</div>
                <div>Time</div>
              </div>
              {bills.map((bill) => {
                const billDate = bill.createdAt?.toDate ? bill.createdAt.toDate() : new Date();
                return (
                  <a
                    key={bill.billNo}
                    href={`/bill/${bill.billNo}?token=${encodeURIComponent(bill.publicToken)}`}
                    className="grid grid-cols-5 gap-4 py-3 border-b items-center hover:bg-gray-50 transition-colors rounded cursor-pointer block"
                    style={{ borderColor: SOFT_GRAY }}
                  >
                    <div className="font-medium" style={{ color: SOFT_BLACK }}>
                      {bill.billNo}
                    </div>
                    <div style={{ color: SOFT_BLACK }}>
                      {bill.customer.name || 'N/A'}
                    </div>
                    <div style={{ color: SOFT_BLACK + '99' }}>
                      {bill.customer.mobile || 'N/A'}
                    </div>
                    <div className="font-semibold" style={{ color: SOFT_BLACK }}>
                      ₹{bill.grandTotal.toFixed(2)}
                    </div>
                    <div style={{ color: SOFT_BLACK + '99' }}>
                      {formatTime(billDate)}
                    </div>
                  </a>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

