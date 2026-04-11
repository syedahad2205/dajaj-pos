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
  Timestamp,
  onSnapshot,
  updateDoc,
  deleteDoc,
  orderBy,
  setDoc,
} from 'firebase/firestore';
import { firestore } from './firebase';

// ─── POS Staff ──────────────────────────────────────────────────────────────

export type PosStaffStatus = 'pending' | 'active' | 'rejected';

export interface PosStaff {
  docId: string;     // Firestore doc ID = lowercase email
  uid?: string;      // Firebase Auth UID — set on first login after approval
  name: string;
  email: string;
  status: PosStaffStatus;
  createdAt: Timestamp;
  updatedAt?: Timestamp;
}

/** Submit a request without creating a Firebase Auth account. Doc keyed by email. */
export async function createPosStaffRequest(name: string, email: string): Promise<void> {
  const emailKey = email.toLowerCase().trim();
  const existing = await getDoc(doc(firestore, 'pos_staff', emailKey));
  if (existing.exists()) {
    const data = existing.data() as Omit<PosStaff, 'docId'>;
    if (data.status === 'pending') throw new Error('A request for this email is already pending.');
    if (data.status === 'active') throw new Error('This email is already registered as POS staff.');
    if (data.status === 'rejected') throw new Error('This request was previously rejected. Contact the admin.');
  }
  await setDoc(doc(firestore, 'pos_staff', emailKey), {
    name,
    email: emailKey,
    status: 'pending',
    createdAt: serverTimestamp(),
  });
}

/** Look up a POS staff record directly by email (fast — email is the doc key). */
export async function getPosStaffProfileByEmail(email: string): Promise<PosStaff | null> {
  const emailKey = email.toLowerCase().trim();
  const snap = await getDoc(doc(firestore, 'pos_staff', emailKey));
  if (!snap.exists()) return null;
  return { docId: snap.id, ...snap.data() } as PosStaff;
}

/** Set the Firebase Auth UID on the staff doc after their first login. */
export async function setPosStaffUid(email: string, uid: string): Promise<void> {
  const emailKey = email.toLowerCase().trim();
  await updateDoc(doc(firestore, 'pos_staff', emailKey), { uid, updatedAt: serverTimestamp() });
}

/** @deprecated Prefer getPosStaffProfileByEmail. Queries by uid field. */
export async function getPosStaffProfile(uid: string): Promise<PosStaff | null> {
  const snap = await getDocs(query(collection(firestore, 'pos_staff'), where('uid', '==', uid)));
  if (snap.empty) return null;
  const d = snap.docs[0];
  return { docId: d.id, ...d.data() } as PosStaff;
}

export async function getAllPosStaff(): Promise<PosStaff[]> {
  const snap = await getDocs(query(collection(firestore, 'pos_staff'), orderBy('createdAt', 'desc')));
  return snap.docs.map((d) => ({ docId: d.id, ...d.data() }) as PosStaff);
}

export async function updatePosStaffStatus(docId: string, status: PosStaffStatus): Promise<void> {
  await updateDoc(doc(firestore, 'pos_staff', docId), { status, updatedAt: serverTimestamp() });
}

export function subscribeToPosStaff(callback: (staff: PosStaff[]) => void) {
  return onSnapshot(
    query(collection(firestore, 'pos_staff'), orderBy('createdAt', 'desc')),
    (snap) => callback(snap.docs.map((d) => ({ docId: d.id, ...d.data() }) as PosStaff)),
  );
}

// ─── POS Open Orders ──────────────────────────────────────────────────────────

export interface PosModifier {
  id: string;
  name: string;
  price: number;
  groupName: string;
}

export interface PosCartItem {
  id: string;
  sku: string;
  name: string;
  variantLabel: string;
  qty: number;
  basePrice: number;
  modifiers: PosModifier[];
  itemTotal: number;
  variantId: string;
}

export interface PosOpenOrder {
  id: string;
  label: string;
  items: PosCartItem[];
  createdAt: Timestamp;
  updatedAt: Timestamp;
  billedAt?: Timestamp;
}

/**
 * Generates a daily sequential order label in the format DDMMYY####
 * e.g. 1104260001 = 1st order on 11 April 2026
 */
export async function getNextDailyOrderLabel(): Promise<string> {
  const now = new Date();
  const dd = String(now.getDate()).padStart(2, '0');
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const yy = String(now.getFullYear()).slice(2);
  const dateKey = `${dd}${mm}${yy}`;

  const counterRef = doc(firestore, 'counters', `orders_${dateKey}`);
  return runTransaction(firestore, async (tx) => {
    const snap = await tx.get(counterRef);
    const current = snap.exists() ? (snap.data().current as number) : 0;
    const next = current + 1;
    tx.set(counterRef, { current: next }, { merge: true });
    return `${dateKey}${String(next).padStart(4, '0')}`;
  });
}

export async function createPosOpenOrder(label: string, createdBy?: string): Promise<string> {
  const ref = await addDoc(collection(firestore, 'pos_open_orders'), {
    label,
    items: [],
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    ...(createdBy ? { createdBy } : {}),
  });
  return ref.id;
}

export function subscribeToPosOpenOrders(
  callback: (orders: PosOpenOrder[]) => void,
): () => void {
  const q = query(
    collection(firestore, 'pos_open_orders'),
    orderBy('createdAt', 'asc'),
  );
  return onSnapshot(q, (snapshot) => {
    const orders = snapshot.docs
      .map((d) => ({ id: d.id, ...d.data() } as PosOpenOrder))
      .filter((o) => !o.billedAt);
    callback(orders);
  });
}

/** Subscribe to today's bills in real-time */
export function subscribeToTodaysBills(
  callback: (bills: (Bill & { docId: string })[]) => void,
): () => void {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const startTs = Timestamp.fromDate(todayStart);

  const q = query(
    collection(firestore, 'bills'),
    where('createdAt', '>=', startTs),
    orderBy('createdAt', 'desc'),
  );

  return onSnapshot(q, (snapshot) => {
    const bills = snapshot.docs.map((d) => ({ docId: d.id, ...(d.data() as Bill) }));
    callback(bills);
  });
}

export async function updatePosOpenOrder(
  id: string,
  label: string,
  items: PosCartItem[],
): Promise<void> {
  await updateDoc(doc(firestore, 'pos_open_orders', id), {
    label,
    items,
    updatedAt: serverTimestamp(),
  });
}

export async function markPosOrderBilled(id: string): Promise<void> {
  await updateDoc(doc(firestore, 'pos_open_orders', id), { billedAt: serverTimestamp() });
}

export async function unmarkPosOrderBilled(id: string): Promise<void> {
  await updateDoc(doc(firestore, 'pos_open_orders', id), { billedAt: null });
}

/** Recreate a POS open order from a bill so it can be edited and re-billed */
export async function reopenBillAsOrder(bill: Bill & { docId: string }): Promise<string> {
  const items: PosCartItem[] = bill.items.map((bi, idx) => ({
    id: `reopened-${idx}-${Date.now()}`,
    sku: bi.sku,
    name: bi.name,
    variantLabel: bi.variant,
    qty: bi.qty,
    basePrice: bi.basePrice,
    modifiers: bi.addons.map((a, ai) => {
      const parts = a.name.split(': ');
      return { id: `mod-${idx}-${ai}`, groupName: parts[0] || '', name: parts[1] || a.name, price: a.price };
    }),
    itemTotal: bi.itemTotal,
    variantId: '',
  }));

  const ref = await addDoc(collection(firestore, 'pos_open_orders'), {
    label: bill.customer.name || bill.billNo,
    items,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    reopenedFromBill: bill.billNo,
  });

  // Delete the old bill so re-billing won't create a duplicate
  await deleteDoc(doc(firestore, 'bills', bill.docId));

  return ref.id;
}

export async function deletePosOpenOrder(id: string): Promise<void> {
  await deleteDoc(doc(firestore, 'pos_open_orders', id));
}

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
  cashCollected?: number;
  punchedBy?: string;
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

export async function updateBillByNumber(
  billNo: string,
  updates: Partial<Pick<Bill, 'paymentMode' | 'customer'>>,
): Promise<void> {
  const billsRef = collection(firestore, 'bills');
  const q = query(billsRef, where('billNo', '==', billNo));
  const snapshot = await getDocs(q);
  if (snapshot.empty) throw new Error('Bill not found');
  await updateDoc(snapshot.docs[0].ref, updates as Record<string, unknown>);
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

