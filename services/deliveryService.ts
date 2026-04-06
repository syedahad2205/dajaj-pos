import { doc, getDoc, onSnapshot, serverTimestamp, setDoc } from "firebase/firestore";
import { firestore } from "@/lib/firebase";
import { logFirestoreDebug, trackFirestoreRead } from "@/lib/firestoreReadTracker";
import type { DeliveryZone } from "@/lib/delivery";

export interface DeliverySettings {
  restaurantLocation: {
    lat: number;
    lng: number;
  };
  deliveryZones: DeliveryZone[];
  minimumOrder: number;
  updatedAt?: unknown;
}

const defaultSettings: DeliverySettings = {
  restaurantLocation: {
    lat: 0,
    lng: 0,
  },
  deliveryZones: [
    { radiusKm: 2, fee: 20 },
    { radiusKm: 4, fee: 40 },
    { radiusKm: 6, fee: 60 },
  ],
  minimumOrder: 100,
};

function settingsDoc() {
  return doc(firestore, "deliverySettings", "config");
}

function normalizeSettings(data?: Partial<DeliverySettings> & { restaurantLocation?: { lat?: number; lng?: number; latitude?: number; longitude?: number } }) {
  const location = data?.restaurantLocation;
  return {
    ...defaultSettings,
    ...data,
    restaurantLocation: {
      lat: location?.lat ?? location?.latitude ?? defaultSettings.restaurantLocation.lat,
      lng: location?.lng ?? location?.longitude ?? defaultSettings.restaurantLocation.lng,
    },
    deliveryZones: data?.deliveryZones?.length ? data.deliveryZones : defaultSettings.deliveryZones,
    minimumOrder: typeof data?.minimumOrder === "number" ? data.minimumOrder : defaultSettings.minimumOrder,
  } satisfies DeliverySettings;
}

export async function getDeliverySettings() {
  const snapshot = await getDoc(settingsDoc());
  trackFirestoreRead("deliverySettings getDoc");
  return normalizeSettings(snapshot.data() as Partial<DeliverySettings> | undefined);
}

export function subscribeToDeliverySettings(callback: (settings: DeliverySettings) => void) {
  logFirestoreDebug("deliverySettings listener attached");
  return onSnapshot(settingsDoc(), (snapshot) => {
    trackFirestoreRead("deliverySettings onSnapshot", { exists: snapshot.exists() });
    callback(normalizeSettings(snapshot.data() as Partial<DeliverySettings> | undefined));
  });
}

export async function saveDeliverySettings(settings: DeliverySettings) {
  await setDoc(
    settingsDoc(),
    {
      ...settings,
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
}

export function getDefaultDeliverySettings() {
  return defaultSettings;
}
