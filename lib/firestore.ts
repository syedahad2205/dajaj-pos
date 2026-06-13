import { 
  collection, 
  doc, 
  getDoc, 
  getDocs, 
  query, 
  where, 
  serverTimestamp,
  Timestamp,
  onSnapshot,
  updateDoc,
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
  canManageInventory?: boolean;
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

export async function updatePosStaffInventoryPermission(docId: string, canManageInventory: boolean): Promise<void> {
  await updateDoc(doc(firestore, 'pos_staff', docId), { canManageInventory, updatedAt: serverTimestamp() });
}

export function subscribeToPosStaff(callback: (staff: PosStaff[]) => void) {
  return onSnapshot(
    query(collection(firestore, 'pos_staff'), orderBy('createdAt', 'desc')),
    (snap) => callback(snap.docs.map((d) => ({ docId: d.id, ...d.data() }) as PosStaff)),
  );
}

// ─── Bills ──────────────────────────────────────────────────────────────────

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

