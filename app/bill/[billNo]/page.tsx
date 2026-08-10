'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter, useParams, useSearchParams } from 'next/navigation';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { getBillByNumber, type Bill } from '@/lib/firestore';
import BillPDF from '@/components/BillPDF';
import { sendBillOnWhatsApp } from '@/lib/whatsapp';
import { buildUpiPaymentLink } from '@/lib/upi';
import { generateQrDataUrl } from '@/lib/qr';

export default function BillPage() {
  const [authenticated, setAuthenticated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [bill, setBill] = useState<Bill | null>(null);
  const [error, setError] = useState('');
  const [qrDataUrl, setQrDataUrl] = useState('');
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

  useEffect(() => {
    if (!bill) return;
    const link = buildUpiPaymentLink(bill.grandTotal, bill.billNo);
    generateQrDataUrl(link, 160).then(setQrDataUrl).catch(() => setQrDataUrl(''));
  }, [bill]);

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
      <div className="max-w-sm mx-auto px-4">
        {/* Bill Preview */}
        <div className="bg-white rounded-lg shadow-lg p-6 mb-6">
          <div className="text-center mb-4">
            <h1 className="text-2xl font-bold text-gray-800 tracking-wide">DAJAJ</h1>
            <p className="text-gray-500 text-sm italic">The Spice of Spices</p>
            <p className="text-xs text-gray-400 mt-0.5">Kundapura</p>
          </div>

          <div className="border-t border-dashed border-gray-300 my-3" />

          <div className="space-y-1.5">
            <div className="flex justify-between text-xs">
              <span className="text-gray-500">Bill No:</span>
              <span className="font-semibold">{bill.billNo}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-gray-500">Date:</span>
              <span>{formattedDate}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-gray-500">Time:</span>
              <span>{formattedTime}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-gray-500">Customer:</span>
              <span>{bill.customer.name}</span>
            </div>
            {bill.customer.mobile && (
              <div className="flex justify-between text-xs">
                <span className="text-gray-500">Mobile:</span>
                <span>{bill.customer.mobile}</span>
              </div>
            )}
          </div>

          <div className="border-t border-dashed border-gray-300 my-3" />

          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-400">
                <th className="text-left pb-1.5 text-[10px] font-semibold text-gray-500 uppercase tracking-wide">Item</th>
                <th className="text-right pb-1.5 text-[10px] font-semibold text-gray-500 uppercase tracking-wide">Rate</th>
                <th className="text-right pb-1.5 text-[10px] font-semibold text-gray-500 uppercase tracking-wide">Qty</th>
                <th className="text-right pb-1.5 text-[10px] font-semibold text-gray-500 uppercase tracking-wide">Amount</th>
              </tr>
            </thead>
            <tbody>
              {bill.items.map((item, index) => {
                const rate = item.basePrice + item.addons.reduce((s, a) => s + a.price, 0);
                return (
                  <tr key={index} className="border-b border-gray-100">
                    <td className="py-1.5">
                      <div className="text-xs font-medium">{item.name}</div>
                      {item.variant && <div className="text-[10px] text-gray-500">{item.variant}</div>}
                      {item.addons.length > 0 && (
                        <div className="mt-0.5">
                          {item.addons.map((addon, ai) => (
                            <div key={ai} className="text-[10px] text-gray-400 pl-3">
                              + {addon.name} (₹{addon.price})
                            </div>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="text-right text-xs align-top py-1.5">₹{rate.toFixed(2)}</td>
                    <td className="text-right text-xs align-top py-1.5">{item.qty}</td>
                    <td className="text-right text-xs align-top py-1.5">₹{item.itemTotal.toFixed(2)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <div className="space-y-1.5 mt-3">
            <div className="flex justify-between text-xs text-gray-500">
              <span>Subtotal:</span>
              <span>₹{bill.subtotal.toFixed(2)}</span>
            </div>
            {bill.deliveryCharge ? (
              <div className="flex justify-between text-xs text-gray-500">
                <span>Delivery Charge:</span>
                <span>+ ₹{bill.deliveryCharge.toFixed(2)}</span>
              </div>
            ) : null}
            {bill.discount ? (
              <div className="flex justify-between text-xs text-gray-500">
                <span>Discount{bill.discountPercent ? ` (${bill.discountPercent}%)` : ''}:</span>
                <span>− ₹{bill.discount.toFixed(2)}</span>
              </div>
            ) : null}
            <div className="flex justify-between font-bold text-base pt-2 mt-1 border-t border-gray-800">
              <span>Total:</span>
              <span>₹{bill.grandTotal.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-xs text-gray-500 pt-1.5">
              <span>Payment Mode:</span>
              <span>{bill.paymentMode}</span>
            </div>
            {bill.cashCollected ? (
              <div className="flex justify-between text-xs text-gray-500">
                <span>Cash Collected:</span>
                <span>₹{bill.cashCollected.toFixed(2)}</span>
              </div>
            ) : null}
          </div>

          {qrDataUrl && (
            <div className="flex flex-col items-center mt-4 pt-3 border-t border-dashed border-gray-300">
              <img src={qrDataUrl} alt="Scan to pay via UPI" className="w-24 h-24" />
              <p className="text-[10px] text-gray-500 mt-1">Scan & Pay ₹{bill.grandTotal.toFixed(2)}</p>
            </div>
          )}

          <div className="text-center mt-4 pt-3 border-t border-dashed border-gray-300">
            <p className="text-xs text-gray-500">Thank you. Visit Again.</p>
          </div>
        </div>

        {/* Actions */}
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <BillPDF bill={bill} />
          <button
            onClick={handleWhatsApp}
            className="px-6 py-3 bg-green-600 text-white rounded-md hover:bg-green-700 font-medium text-center"
          >
            Send on WhatsApp
          </button>
        </div>
      </div>
    </div>
  );
}

