import {
  collection,
  addDoc,
  doc,
  onSnapshot,
  serverTimestamp,
} from "firebase/firestore";
import { firestore } from "./firebase";

export type PrintJobType = "reprint" | "kot";
export type PrintJobStatus = "pending" | "processing" | "completed" | "failed";

export interface PrintJobDocument {
  restaurantId: string;
  jobType: PrintJobType;
  printerType: string;
  status: PrintJobStatus;
  orderId: string;
  orderNumber: string;
  source: "web_dashboard";
  payload: Record<string, unknown>;
  retryCount: number;
  failureReason: string | null;
  claimedBy: string | null;
  createdAt: ReturnType<typeof serverTimestamp>;
}

/**
 * Creates a reprint print job in Firestore.
 * Returns the created document ID.
 */
export async function createReprintJob(
  orderId: string,
  orderNumber: string,
  restaurantId: string
): Promise<string> {
  const jobData: PrintJobDocument = {
    restaurantId,
    jobType: "reprint",
    printerType: "bill",
    status: "pending",
    orderId,
    orderNumber,
    source: "web_dashboard",
    payload: {
      header: "REPRINT",
      orderNumber,
      reprintSource: "web_dashboard",
    },
    retryCount: 0,
    failureReason: null,
    claimedBy: null,
    createdAt: serverTimestamp(),
  };

  const docRef = await addDoc(collection(firestore, "print_jobs"), jobData);
  return docRef.id;
}

/**
 * Creates a KOT print job in Firestore.
 * Returns the created document ID.
 */
export async function createKotPrintJob(
  orderId: string,
  orderNumber: string,
  restaurantId: string
): Promise<string> {
  const jobData: PrintJobDocument = {
    restaurantId,
    jobType: "kot",
    printerType: "kot",
    status: "pending",
    orderId,
    orderNumber,
    source: "web_dashboard",
    payload: {
      header: "Kitchen Order Ticket",
      orderNumber,
      kotSource: "web_dashboard",
    },
    retryCount: 0,
    failureReason: null,
    claimedBy: null,
    createdAt: serverTimestamp(),
  };

  const docRef = await addDoc(collection(firestore, "print_jobs"), jobData);
  return docRef.id;
}

/**
 * Subscribes to real-time status updates for a print job.
 * Calls the callback whenever the job status changes.
 * Returns an unsubscribe function.
 */
export function observePrintJobStatus(
  jobId: string,
  callback: (status: PrintJobStatus) => void
): () => void {
  const jobRef = doc(firestore, "print_jobs", jobId);

  const unsubscribe = onSnapshot(jobRef, (snapshot) => {
    if (snapshot.exists()) {
      const data = snapshot.data();
      callback(data.status as PrintJobStatus);
    }
  });

  return unsubscribe;
}
