import {
  collection,
  query,
  where,
  onSnapshot,
  doc,
  getDocs,
  runTransaction,
  limit,
  type Timestamp,
} from "firebase/firestore";
import { firestore } from "@/lib/firebase";

export interface DeviceRecord {
  id: string;
  restaurantId: string;
  deviceName: string;
  isPrimaryPrinter: boolean;
  status: "online" | "offline";
  lastHeartbeat: Timestamp | null;
  registeredAt: Timestamp | null;
}

const STALENESS_THRESHOLD_MS = 90_000; // 90 seconds

/**
 * Determines if a device is online based on its lastHeartbeat timestamp.
 * A device is considered offline if its heartbeat is older than 90 seconds.
 */
export function isDeviceOnline(lastHeartbeat: Timestamp | null): boolean {
  if (!lastHeartbeat) return false;
  const now = Date.now();
  const heartbeatMs = lastHeartbeat.toMillis();
  return now - heartbeatMs < STALENESS_THRESHOLD_MS;
}

/**
 * Formats the time since last heartbeat into a human-readable relative string.
 */
export function formatTimeSinceHeartbeat(lastHeartbeat: Timestamp | null): string {
  if (!lastHeartbeat) return "Never";
  const now = Date.now();
  const heartbeatMs = lastHeartbeat.toMillis();
  const diffMs = now - heartbeatMs;

  if (diffMs < 60_000) return "Just now";
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/**
 * Subscribes to real-time updates of all devices for a given restaurant.
 * Evaluates staleness on each snapshot to determine online/offline status.
 * Returns an unsubscribe function.
 */
export function subscribeToDevices(
  restaurantId: string,
  callback: (devices: DeviceRecord[]) => void
): () => void {
  const devicesRef = collection(firestore, "devices");
  const devicesQuery = query(
    devicesRef,
    where("restaurantId", "==", restaurantId),
    limit(10)
  );

  const unsubscribe = onSnapshot(devicesQuery, (snapshot) => {
    const devices: DeviceRecord[] = snapshot.docs.map((docSnap) => {
      const data = docSnap.data();
      const lastHeartbeat = data.lastHeartbeat as Timestamp | null;
      const computedStatus = isDeviceOnline(lastHeartbeat) ? "online" : "offline";

      return {
        id: docSnap.id,
        restaurantId: data.restaurantId,
        deviceName: data.deviceName ?? "Unknown Device",
        isPrimaryPrinter: data.isPrimaryPrinter ?? false,
        status: computedStatus,
        lastHeartbeat,
        registeredAt: data.registeredAt ?? null,
      };
    });

    callback(devices);
  });

  return unsubscribe;
}

/**
 * Designates a device as the primary printer using a Firestore transaction.
 * Clears isPrimaryPrinter on all other devices for the same restaurant,
 * then sets isPrimaryPrinter=true on the target device.
 *
 * Throws if the device is offline.
 */
export async function designatePrimaryPrinter(
  deviceId: string,
  restaurantId: string
): Promise<void> {
  const deviceRef = doc(firestore, "devices", deviceId);

  // First, find current primary devices to clear within the transaction
  const devicesRef = collection(firestore, "devices");
  const primaryQuery = query(
    devicesRef,
    where("restaurantId", "==", restaurantId),
    where("isPrimaryPrinter", "==", true)
  );
  const currentPrimarySnap = await getDocs(primaryQuery);

  await runTransaction(firestore, async (transaction) => {
    const deviceSnap = await transaction.get(deviceRef);

    if (!deviceSnap.exists()) {
      throw new Error("Device not found.");
    }

    const deviceData = deviceSnap.data();

    // Verify device is online (heartbeat within 90s)
    const lastHeartbeat = deviceData.lastHeartbeat as Timestamp | null;
    if (!isDeviceOnline(lastHeartbeat)) {
      throw new Error("Cannot designate an offline device as primary printer. Only online devices can be designated.");
    }

    // Clear existing primary designations
    currentPrimarySnap.docs.forEach((primaryDoc) => {
      if (primaryDoc.id !== deviceId) {
        transaction.update(doc(firestore, "devices", primaryDoc.id), {
          isPrimaryPrinter: false,
        });
      }
    });

    // Set the new primary
    transaction.update(deviceRef, { isPrimaryPrinter: true });
  });
}
