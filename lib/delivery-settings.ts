import {
  doc,
  onSnapshot,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import { firestore } from "@/lib/firebase";
import type { DeliveryZone } from "@/lib/delivery";

export interface DeliverySettings {
  restaurantLocation: {
    latitude: number;
    longitude: number;
  };
  deliveryZones: DeliveryZone[];
  minimumOrder: number;
  updatedAt?: unknown;
}

const defaultSettings: DeliverySettings = {
  restaurantLocation: {
    latitude: 0,
    longitude: 0,
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

export function subscribeToDeliverySettings(callback: (settings: DeliverySettings) => void) {
  return onSnapshot(settingsDoc(), (snapshot) => {
    callback((snapshot.data() as DeliverySettings | undefined) ?? defaultSettings);
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
