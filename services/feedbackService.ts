import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  type Timestamp,
} from "firebase/firestore";
import { firestore } from "@/lib/firebase";

export type FeedbackStatus = "new" | "reviewed";

export interface FeedbackRecord {
  id: string;
  uid: string;
  userEmail: string;
  userName: string;
  customerName: string;
  mobileNumber: string | null;
  feedback: string;
  createdAt: Timestamp | null;
  status: FeedbackStatus;
  source: "qr-feedback";
}

export interface CreateFeedbackPayload {
  uid: string;
  userEmail: string;
  userName: string;
  customerName: string;
  mobileNumber: string | null;
  feedback: string;
}

export async function createFeedback(payload: CreateFeedbackPayload): Promise<string> {
  const ref = await addDoc(collection(firestore, "feedback"), {
    ...payload,
    createdAt: serverTimestamp(),
    status: "new" as FeedbackStatus,
    source: "qr-feedback",
  });
  return ref.id;
}

export async function getAllFeedback(): Promise<FeedbackRecord[]> {
  const snap = await getDocs(
    query(collection(firestore, "feedback"), orderBy("createdAt", "desc")),
  );
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as FeedbackRecord);
}

export async function markFeedbackReviewed(id: string): Promise<void> {
  await updateDoc(doc(firestore, "feedback", id), { status: "reviewed" });
}

export async function deleteFeedback(id: string): Promise<void> {
  await deleteDoc(doc(firestore, "feedback", id));
}
