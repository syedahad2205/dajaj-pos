import { 
  collection, 
  doc, 
  addDoc, 
  getDoc, 
  getDocs, 
  query, 
  where, 
  runTransaction,
  serverTimestamp,
  Timestamp
} from 'firebase/firestore';
import { firestore } from './firebase';

export interface BillItem {
  sku: string;
  name: string;
  variant: string;
  qty: number;
  basePrice: number;
  addons: { name: string; price: number }[];
  itemTotal: number;
}

export interface Bill {
  billNo: string;
  publicToken: string;
  createdAt: Timestamp;
  customer: {
    name: string;
    mobile?: string;
  };
  items: BillItem[];
  subtotal: number;
  cgst: number;
  sgst: number;
  grandTotal: number;
  paymentMode: string;
}

export async function getNextBillNumber(): Promise<string> {
  const counterRef = doc(firestore, 'counters', 'bills');
  
  return runTransaction(firestore, async (transaction) => {
    const counterDoc = await transaction.get(counterRef);
    
    if (!counterDoc.exists()) {
      transaction.set(counterRef, { current: 1 });
      return 'DAJAJ-000001';
    }
    
    const current = counterDoc.data().current || 0;
    const next = current + 1;
    transaction.update(counterRef, { current: next });
    
    return `DAJAJ-${String(next).padStart(6, '0')}`;
  });
}

/**
 * Generate a cryptographically secure public token
 * Uses crypto.randomUUID() for 128-bit security (UUID v4)
 * Includes collision checking for extra safety
 */
async function generatePublicToken(): Promise<string> {
  let token: string;
  let exists = true;
  let attempts = 0;
  const maxAttempts = 10; // Safety limit

  // Generate token and check for collisions
  while (exists && attempts < maxAttempts) {
    // Try to use crypto.randomUUID() first (browser and Node.js 19+)
    const webCrypto = globalThis.crypto;
    if (webCrypto && typeof webCrypto.randomUUID === 'function') {
      token = webCrypto.randomUUID();
    } else {
      // Fallback: Generate 32 hex characters (128 bits) using crypto.getRandomValues
      const array = new Uint8Array(16);
      if (webCrypto && typeof webCrypto.getRandomValues === 'function') {
        webCrypto.getRandomValues(array);
        token = Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
      } else {
        // Final fallback for Node.js environments without Web Crypto API
        // This should rarely be needed in modern environments
        try {
          const nodeCrypto = await import('crypto');
          token = nodeCrypto.randomBytes(16).toString('hex');
        } catch {
          // Last resort: use Math.random (not cryptographically secure, but better than nothing)
          // This should never happen in production
          token = Array.from({ length: 32 }, () => 
            Math.floor(Math.random() * 16).toString(16)
          ).join('');
        }
      }
    }

    // Check if token already exists in Firestore
    const billsRef = collection(firestore, 'bills');
    const q = query(billsRef, where('publicToken', '==', token));
    const querySnapshot = await getDocs(q);
    exists = !querySnapshot.empty;
    attempts++;
  }

  if (attempts >= maxAttempts && exists) {
    throw new Error('Failed to generate unique token after multiple attempts');
  }

  return token!;
}

export async function createBill(billData: Omit<Bill, 'billNo' | 'publicToken' | 'createdAt'>): Promise<{ billNo: string; publicToken: string }> {
  const billNo = await getNextBillNumber();
  const publicToken = await generatePublicToken();
  
  const bill: Omit<Bill, 'billNo' | 'publicToken'> & { billNo: string; publicToken: string } = {
    ...billData,
    billNo,
    publicToken,
    createdAt: serverTimestamp() as any
  };
  
  const docRef = await addDoc(collection(firestore, 'bills'), bill);
  return { billNo, publicToken };
}

export async function getBillByNumber(billNo: string): Promise<Bill | null> {
  const billsRef = collection(firestore, 'bills');
  const q = query(billsRef, where('billNo', '==', billNo));
  const querySnapshot = await getDocs(q);
  
  if (querySnapshot.empty) {
    return null;
  }
  
  const doc = querySnapshot.docs[0];
  return doc.data() as Bill;
}

export async function getBillsByDate(date: Date): Promise<Bill[]> {
  const billsRef = collection(firestore, 'bills');
  
  // Get start and end of the selected date
  const startDate = new Date(date);
  startDate.setHours(0, 0, 0, 0);
  
  const endDate = new Date(date);
  endDate.setHours(23, 59, 59, 999);
  
  const startTimestamp = Timestamp.fromDate(startDate);
  const endTimestamp = Timestamp.fromDate(endDate);
  
  const q = query(
    billsRef,
    where('createdAt', '>=', startTimestamp),
    where('createdAt', '<=', endTimestamp)
  );
  
  const querySnapshot = await getDocs(q);
  const bills: Bill[] = [];
  
  querySnapshot.forEach((doc) => {
    bills.push(doc.data() as Bill);
  });
  
  // Sort by createdAt descending (newest first)
  bills.sort((a, b) => {
    const aTime = a.createdAt?.toDate ? a.createdAt.toDate().getTime() : 0;
    const bTime = b.createdAt?.toDate ? b.createdAt.toDate().getTime() : 0;
    return bTime - aTime;
  });
  
  return bills;
}

