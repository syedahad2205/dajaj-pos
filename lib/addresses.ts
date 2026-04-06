import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  writeBatch,
} from "firebase/firestore";
import { firestore } from "@/lib/firebase";
import { logFirestoreDebug, trackFirestoreRead } from "@/lib/firestoreReadTracker";

export interface Address {
  id: string;
  label: "Home" | "Work" | "Other";
  name: string;
  phone: string;
  addressLine1: string;
  addressLine2: string;
  landmark: string;
  pincode: string;
  latitude: number;
  longitude: number;
  isDefault: boolean;
  createdAt?: unknown;
}

export type AddressInput = Omit<Address, "id" | "createdAt">;

function addressesCollection(userId: string) {
  return collection(firestore, "customers", userId, "addresses");
}

export function subscribeToAddresses(userId: string, callback: (addresses: Address[]) => void) {
  const addressesQuery = query(addressesCollection(userId), orderBy("createdAt", "desc"));
  logFirestoreDebug("addresses listener attached", { userId });
  return onSnapshot(addressesQuery, (snapshot) => {
    trackFirestoreRead("addresses onSnapshot", { userId, size: snapshot.size });
    callback(snapshot.docs.map((snapshotDoc) => ({ id: snapshotDoc.id, ...(snapshotDoc.data() as Omit<Address, "id">) })));
  });
}

export async function getAddresses(userId: string) {
  const addressesQuery = query(addressesCollection(userId), orderBy("createdAt", "desc"));
  const snapshot = await getDocs(addressesQuery);
  trackFirestoreRead("addresses getDocs", { userId, size: snapshot.size });
  return snapshot.docs.map((snapshotDoc) => ({ id: snapshotDoc.id, ...(snapshotDoc.data() as Omit<Address, "id">) }));
}

export async function saveAddress(userId: string, input: AddressInput, addressId?: string) {
  const addressRef = addressId ? doc(firestore, "customers", userId, "addresses", addressId) : doc(addressesCollection(userId));

  await setDoc(
    addressRef,
    {
      ...input,
      id: addressRef.id,
      createdAt: serverTimestamp(),
    },
    { merge: true },
  );

  if (input.isDefault) {
    await setDefaultAddress(userId, addressRef.id);
  }
}

export async function deleteAddress(userId: string, addressId: string) {
  await deleteDoc(doc(firestore, "customers", userId, "addresses", addressId));
}

export async function setDefaultAddress(userId: string, addressId: string) {
  const batch = writeBatch(firestore);
  const addresses = await getAddresses(userId);

  addresses.forEach((address) => {
    batch.update(doc(firestore, "customers", userId, "addresses", address.id), {
      isDefault: false,
    });
  });

  batch.update(doc(firestore, "customers", userId, "addresses", addressId), { isDefault: true });

  await batch.commit();
}
