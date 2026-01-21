'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter, useParams, useSearchParams } from 'next/navigation';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { getBillByNumber, type Bill } from '@/lib/firestore';
import BillPDF from '@/components/BillPDF';
import { sendBillOnWhatsApp } from '@/lib/whatsapp';

export default function BillPage() {
  const [authenticated, setAuthenticated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [bill, setBill] = useState<Bill | null>(null);
  const [error, setError] = useState('');
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();
  
  // Normalize billNo - can be string or string[]
  const billNoRaw = params.billNo;
  const billNo = Array.isArray(billNoRaw) ? billNoRaw[0] : (billNoRaw || '');
  
  // Guard to prevent multiple loadBill calls
  const hasLoadedRef = useRef(false);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (user) {
        setAuthenticated(true);
      }
      // Don't redirect unauthenticated users - they might have a valid token
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    // Load bill once we have billNo, searchParams, and auth state is determined
    // Guard prevents multiple calls
    if (billNo && searchParams && !loading && !hasLoadedRef.current) {
      hasLoadedRef.current = true;
      loadBill();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [billNo, searchParams, loading]);

  const loadBill = async () => {
    try {
      // Ensure billNo is a string before calling getBillByNumber
      if (!billNo || typeof billNo !== 'string') {
        setError('Invalid bill number');
        return;
      }

      const billData = await getBillByNumber(billNo);
      if (!billData) {
        setError('Bill not found');
        return;
      }

      // If user is authenticated (admin), allow access without token
      if (authenticated) {
        setBill(billData);
        return;
      }

      // For unauthenticated users, token is required
      const providedTokenRaw = searchParams?.get('token');
      
      if (!providedTokenRaw) {
        setError('Invalid or expired link. Token is required to access this bill.');
        return;
      }

      // Decode token (may be URL-encoded from WhatsApp links)
      const providedToken = decodeURIComponent(providedTokenRaw);

      // Validate token (compare decoded token with stored token)
      if (billData.publicToken !== providedToken) {
        setError('Invalid or expired link. The provided token does not match.');
        return;
      }

      // Token is valid, show bill
      setBill(billData);
    } catch (err: any) {
      console.error('Error loading bill FULL:', err);
      setError(err?.message || 'Failed to load bill. Please check your link and try again.');
    }    
  };

  const handleWhatsApp = () => {
    if (!bill) return;
    sendBillOnWhatsApp({
      mobile: bill.customer.mobile || '',
      billNo: bill.billNo,
      grandTotal: bill.grandTotal,
      publicToken: bill.publicToken
    });
  };

  // Don't wait for auth loading - load bill immediately
  if (loading && !bill && !error) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-xl">Loading...</div>
      </div>
    );
  }

  if (error || !bill) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center bg-white p-8 rounded-lg shadow-md max-w-md">
          <h1 className="text-2xl font-bold text-red-600 mb-4">{error || 'Bill not found'}</h1>
          <p className="text-gray-600 mb-6">
            {error.includes('token') || error.includes('Token')
              ? 'This link is invalid or has expired. Please request a new bill link.'
              : 'The requested bill could not be found.'}
          </p>
          {authenticated && (
            <button
              onClick={() => router.push('/pos')}
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
            >
              Back to POS
            </button>
          )}
        </div>
      </div>
    );
  }

  const date = bill.createdAt?.toDate ? bill.createdAt.toDate() : new Date();
  const formattedDate = date.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  });
  const formattedTime = date.toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit'
  });

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-4xl mx-auto px-4">
        <div className="mb-4">
        </div>

        {/* Bill Preview */}
        <div className="bg-white rounded-lg shadow-lg p-8 mb-6">
          <div className="text-center mb-6">
            <h1 className="text-3xl font-bold text-gray-800 mb-2">DAJAJ</h1>
            <p className="text-gray-600">Real Grill Taste</p>
            <p className="text-sm text-gray-500 mt-1">Kundapura</p>
          </div>

          <div className="border-t border-b py-4 mb-4">
            <div className="flex justify-between text-sm mb-2">
              <span className="text-gray-600">Bill No:</span>
              <span className="font-semibold">{bill.billNo}</span>
            </div>
            <div className="flex justify-between text-sm mb-2">
              <span className="text-gray-600">Date:</span>
              <span>{formattedDate}</span>
            </div>
            <div className="flex justify-between text-sm mb-2">
              <span className="text-gray-600">Time:</span>
              <span>{formattedTime}</span>
            </div>
            <div className="flex justify-between text-sm mb-2">
              <span className="text-gray-600">Customer:</span>
              <span>{bill.customer.name}</span>
            </div>
            {bill.customer.mobile && (
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">Mobile:</span>
                <span>{bill.customer.mobile}</span>
              </div>
            )}
          </div>

          <div className="mb-4">
            <table className="w-full">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-2 text-sm font-semibold text-gray-700">Item</th>
                  <th className="text-right py-2 text-sm font-semibold text-gray-700">Qty</th>
                  <th className="text-right py-2 text-sm font-semibold text-gray-700">Price</th>
                </tr>
              </thead>
              <tbody>
                {bill.items.map((item, index) => (
                  <tr key={index} className="border-b">
                    <td className="py-2">
                      <div className="text-sm font-medium">{item.name}</div>
                      <div className="text-xs text-gray-500">{item.variant}</div>
                      <div className="text-xs text-gray-400">{item.sku}</div>
                      {item.addons.length > 0 && (
                        <div className="mt-1">
                          {item.addons.map((addon, ai) => (
                            <div key={ai} className="text-xs text-gray-500 pl-4">
                              + {addon.name} (₹{addon.price})
                            </div>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="text-right text-sm">{item.qty}</td>
                    <td className="text-right text-sm">₹{item.itemTotal.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="border-t pt-4 space-y-2">
            <div className="flex justify-between text-sm">
              <span>Subtotal:</span>
              <span>₹{bill.subtotal.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-sm text-gray-600">
              <span>CGST (2.5%):</span>
              <span>₹{bill.cgst.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-sm text-gray-600">
              <span>SGST (2.5%):</span>
              <span>₹{bill.sgst.toFixed(2)}</span>
            </div>
            <div className="flex justify-between font-bold text-lg border-t pt-2 mt-2">
              <span>Grand Total:</span>
              <span>₹{bill.grandTotal.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-sm text-gray-600 mt-2">
              <span>Payment Mode:</span>
              <span>{bill.paymentMode}</span>
            </div>
          </div>

          <div className="text-center mt-6 pt-4 border-t">
            <p className="text-sm text-gray-600">Thank you. Visit Again.</p>
          </div>
        </div>

        {/* Actions */}
        <div className="flex space-x-4 justify-center">
          <BillPDF bill={bill} />
          <button
            onClick={handleWhatsApp}
            className="px-6 py-3 bg-green-600 text-white rounded-md hover:bg-green-700 font-medium"
          >
            Send on WhatsApp
          </button>
        </div>
      </div>
    </div>
  );
}

