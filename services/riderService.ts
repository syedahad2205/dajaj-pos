import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import { firestore } from "@/lib/firebase";
import { logFirestoreDebug, trackFirestoreRead } from "@/lib/firestoreReadTracker";
import { normalizePhoneNumber } from "@/lib/phone";

export interface RiderLocation {
  lat: number;
  lng: number;
}

export interface RiderProfile {
  id: string;
  phone: string;
  name: string;
  vehicleType: string;
  accessCode: string;
  isActive: boolean;
  isAvailable: boolean;
  maxConcurrentOrders: number;
  currentOrderCount: number;
  lastLocation: RiderLocation | null;
  lastSeenAt?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface RiderInput {
  phone: string;
  name: string;
  vehicleType: string;
  accessCode: string;
  isActive: boolean;
  maxConcurrentOrders: number;
}

function ridersCollection() {
  return collection(firestore, "riders");
}

export function riderDoc(riderId: string) {
  return doc(firestore, "riders", riderId);
}

function mapRider(snapshotDoc: { id: string; data: () => unknown }) {
  const raw = snapshotDoc.data() as Partial<RiderProfile>;

  return {
    id: snapshotDoc.id,
    phone: raw.phone || snapshotDoc.id,
    name: raw.name || "Delivery Partner",
    vehicleType: raw.vehicleType || "Bike",
    accessCode: raw.accessCode || "",
    isActive: raw.isActive ?? true,
    isAvailable: raw.isAvailable ?? false,
    maxConcurrentOrders: raw.maxConcurrentOrders ?? 1,
    currentOrderCount: raw.currentOrderCount ?? 0,
    lastLocation:
      raw.lastLocation && typeof raw.lastLocation.lat === "number" && typeof raw.lastLocation.lng === "number"
        ? raw.lastLocation
        : null,
    lastSeenAt: raw.lastSeenAt,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  } satisfies RiderProfile;
}

export function isRiderAssignable(rider: RiderProfile) {
  return rider.isActive && rider.isAvailable && rider.currentOrderCount < rider.maxConcurrentOrders;
}

export async function getRiderProfile(riderId: string) {
  const snapshot = await getDoc(riderDoc(riderId));
  trackFirestoreRead("riders getDoc", { riderId });
  if (!snapshot.exists()) {
    return null;
  }

  return mapRider(snapshot);
}

export function subscribeToRiderProfile(riderId: string, callback: (profile: RiderProfile | null) => void) {
  logFirestoreDebug("riders listener attached", { scope: "single", riderId });
  return onSnapshot(riderDoc(riderId), (snapshot) => {
    trackFirestoreRead("riders onSnapshot single", { riderId, exists: snapshot.exists() });
    if (!snapshot.exists()) {
      callback(null);
      return;
    }

    callback(mapRider(snapshot));
  });
}

export function subscribeToRiders(callback: (riders: RiderProfile[]) => void) {
  const ridersQuery = query(ridersCollection(), orderBy("name"));
  logFirestoreDebug("riders listener attached", { scope: "all" });
  return onSnapshot(ridersQuery, (snapshot) => {
    trackFirestoreRead("riders onSnapshot all", { size: snapshot.size });
    callback(snapshot.docs.map(mapRider));
  });
}

export async function getAllRiders() {
  const ridersQuery = query(ridersCollection(), orderBy("name"));
  const snapshot = await getDocs(ridersQuery);
  trackFirestoreRead("riders getDocs all", { size: snapshot.size });
  return snapshot.docs.map(mapRider);
}

export async function authenticateRider(phoneInput: string, accessCode: string) {
  const normalizedPhone = normalizePhoneNumber(phoneInput);
  if (!normalizedPhone) {
    return null;
  }

  const rider = await getRiderProfile(normalizedPhone);
  if (!rider || !rider.isActive || rider.accessCode !== accessCode.trim()) {
    return null;
  }

  await updateDoc(riderDoc(normalizedPhone), {
    updatedAt: serverTimestamp(),
  });

  return rider;
}

export async function saveRider(input: RiderInput) {
  const normalizedPhone = normalizePhoneNumber(input.phone);
  if (!normalizedPhone) {
    throw new Error("Enter a valid rider phone number.");
  }

  const existing = await getRiderProfile(normalizedPhone);

  await setDoc(
    riderDoc(normalizedPhone),
    {
      phone: normalizedPhone,
      name: input.name.trim(),
      vehicleType: input.vehicleType.trim() || "Bike",
      accessCode: input.accessCode.trim(),
      isActive: input.isActive,
      isAvailable: input.isActive ? existing?.isAvailable ?? false : false,
      maxConcurrentOrders: Math.max(1, input.maxConcurrentOrders || 1),
      currentOrderCount: existing?.currentOrderCount ?? 0,
      lastLocation: existing?.lastLocation ?? null,
      lastSeenAt: existing?.lastSeenAt ?? null,
      createdAt: existing?.createdAt ?? serverTimestamp(),
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );

  return normalizedPhone;
}

export async function updateRiderAvailability(riderId: string, isAvailable: boolean) {
  await updateDoc(riderDoc(riderId), {
    isAvailable,
    updatedAt: serverTimestamp(),
  });
}

export async function updateRiderLocation(riderId: string, location: RiderLocation) {
  await updateDoc(riderDoc(riderId), {
    lastLocation: location,
    lastSeenAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}
