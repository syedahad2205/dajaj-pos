import {
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import { firestore } from "@/lib/firebase";
import { calculateDistanceKm } from "@/lib/delivery";
import { calculateEtaMinutes } from "@/lib/eta";
import { logFirestoreDebug, trackFirestoreRead } from "@/lib/firestoreReadTracker";
import type { OrderRecord } from "@/services/orderService";
import { updateRiderLocation, type RiderProfile } from "@/services/riderService";

export interface OrderTrackingRecord {
  id: string;
  orderId: string;
  riderId: string;
  riderName: string;
  riderLocation: {
    lat: number;
    lng: number;
  };
  distanceKmToCustomer: number;
  etaMinutes: number;
  lastUpdatedAt?: unknown;
}

function trackingDoc(orderId: string) {
  return doc(firestore, "order_tracking", orderId);
}

function mapTracking(snapshotDoc: { id: string; data: () => unknown }) {
  const raw = snapshotDoc.data() as Partial<OrderTrackingRecord>;

  return {
    id: snapshotDoc.id,
    orderId: raw.orderId || snapshotDoc.id,
    riderId: raw.riderId || "",
    riderName: raw.riderName || "",
    riderLocation: raw.riderLocation || { lat: 0, lng: 0 },
    distanceKmToCustomer: raw.distanceKmToCustomer || 0,
    etaMinutes: raw.etaMinutes || 0,
    lastUpdatedAt: raw.lastUpdatedAt,
  } satisfies OrderTrackingRecord;
}

export function subscribeToOrderTracking(orderId: string, callback: (tracking: OrderTrackingRecord | null) => void) {
  logFirestoreDebug("order_tracking listener attached", { orderId });
  return onSnapshot(
    trackingDoc(orderId),
    (snapshot) => {
      trackFirestoreRead("order_tracking onSnapshot", { orderId, exists: snapshot.exists() });
      if (!snapshot.exists()) {
        callback(null);
        return;
      }

      callback(mapTracking(snapshot));
    },
    (error) => {
      console.error(`Firestore order tracking listener error for ${orderId}:`, error);
    },
  );
}

export async function getOrderTracking(orderId: string) {
  const snapshot = await getDoc(trackingDoc(orderId));
  trackFirestoreRead("order_tracking getDoc", { orderId });
  if (!snapshot.exists()) {
    return null;
  }

  return mapTracking(snapshot);
}

export async function clearOrderTracking(orderId: string) {
  await deleteDoc(trackingDoc(orderId));
}

export async function updateRiderLocationForActiveOrders(
  rider: Pick<RiderProfile, "id" | "name">,
  location: {
    lat: number;
    lng: number;
  },
  orders: Array<Pick<OrderRecord, "id" | "deliveryStatus" | "location" | "address">>,
) {
  logFirestoreDebug("updateRiderLocationForActiveOrders called", {
    riderId: rider.id,
    candidateOrders: orders.length,
  });
  await updateRiderLocation(rider.id, location);

  const activeOrders = orders.filter((order) => order.deliveryStatus === "assigned" || order.deliveryStatus === "on_the_way");

  if (activeOrders.length === 0) {
    return;
  }

  await Promise.all(
    activeOrders.map(async (order) => {
      const customerLocation = {
        lat: order.location?.lat ?? order.address?.latitude ?? 0,
        lng: order.location?.lng ?? order.address?.longitude ?? 0,
      };

      if (!customerLocation.lat || !customerLocation.lng) {
        return;
      }

      const distanceKm = calculateDistanceKm(location.lat, location.lng, customerLocation.lat, customerLocation.lng);

      await setDoc(
        trackingDoc(order.id),
        {
          orderId: order.id,
          riderId: rider.id,
          riderName: rider.name,
          riderLocation: location,
          distanceKmToCustomer: distanceKm,
          etaMinutes: calculateEtaMinutes(distanceKm),
          lastUpdatedAt: serverTimestamp(),
        },
        { merge: true },
      );
    }),
  );
}
