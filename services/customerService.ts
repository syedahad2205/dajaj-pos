import {
  doc,
  getDoc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import { firestore } from "@/lib/firebase";
import { logFirestoreDebug, trackFirestoreRead } from "@/lib/firestoreReadTracker";

export interface CustomerProfile {
  id: string;
  phone: string;
  name: string;
  dob: string;
  createdAt?: unknown;
  lastLogin?: unknown;
}

function customerDoc(phone: string) {
  return doc(firestore, "customers", phone);
}

export async function getCustomerProfile(phone: string) {
  const snapshot = await getDoc(customerDoc(phone));
  trackFirestoreRead("customers getDoc", { phone });
  if (!snapshot.exists()) {
    return null;
  }

  return {
    id: snapshot.id,
    ...(snapshot.data() as Omit<CustomerProfile, "id">),
  } satisfies CustomerProfile;
}

export function subscribeToCustomerProfile(phone: string, callback: (profile: CustomerProfile | null) => void) {
  logFirestoreDebug("customers listener attached", { phone });
  return onSnapshot(customerDoc(phone), (snapshot) => {
    trackFirestoreRead("customers onSnapshot", { phone, exists: snapshot.exists() });
    if (!snapshot.exists()) {
      callback(null);
      return;
    }

    callback({
      id: snapshot.id,
      ...(snapshot.data() as Omit<CustomerProfile, "id">),
    });
  });
}

export async function createCustomerProfile(phone: string) {
  const profile = {
    phone,
    name: "",
    dob: "",
    createdAt: serverTimestamp(),
    lastLogin: serverTimestamp(),
  };

  await setDoc(customerDoc(phone), profile, { merge: true });
}

export async function updateCustomerProfile(phone: string, input: { name: string; dob?: string }) {
  await setDoc(
    customerDoc(phone),
    {
      phone,
      name: input.name,
      dob: input.dob || "",
      lastLogin: serverTimestamp(),
    },
    { merge: true },
  );
}

export async function touchCustomerLogin(phone: string) {
  await updateDoc(customerDoc(phone), {
    lastLogin: serverTimestamp(),
  });
}
