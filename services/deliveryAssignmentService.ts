import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  where,
  writeBatch,
} from "firebase/firestore";
import { firestore } from "@/lib/firebase";
import { logFirestoreDebug, trackFirestoreRead } from "@/lib/firestoreReadTracker";
import { calculateDistanceKm } from "@/lib/delivery";
import type { Address } from "@/lib/addresses";
import type { CartItem } from "@/components/cart/CartProvider";
import { getDeliverySettings } from "@/services/deliveryService";
import { clearOrderTracking } from "@/services/trackingService";
import { orderDoc, type OrderRecord } from "@/services/orderService";
import { riderDoc, type RiderProfile } from "@/services/riderService";

export type DeliveryAssignmentStatus = "assigned" | "on_the_way" | "delivered" | "cancelled";

export interface DeliveryAssignmentRecord {
  id: string;
  orderId: string;
  orderNumber: string;
  riderId: string;
  riderName: string;
  riderPhone: string;
  assignedRiderId: string;
  assignedRiderName: string;
  assignedRiderPhone: string;
  customerName: string;
  customerPhone: string;
  address: Address;
  location: {
    lat: number;
    lng: number;
  };
  items: CartItem[];
  total: number;
  orderStatus: OrderRecord["orderStatus"];
  deliveryStatus: OrderRecord["deliveryStatus"];
  status: DeliveryAssignmentStatus;
  assignedAt?: unknown;
  pickedUpAt?: unknown;
  deliveredAt?: unknown;
  cancelledAt?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
}

function assignmentDoc(orderId: string) {
  return doc(firestore, "delivery_assignments", orderId);
}

function getFallbackAddress(raw?: Partial<Address>) {
  return {
    id: raw?.id || "",
    label: raw?.label || "Other",
    name: raw?.name || "",
    phone: raw?.phone || "",
    addressLine1: raw?.addressLine1 || "",
    addressLine2: raw?.addressLine2 || "",
    landmark: raw?.landmark || "",
    pincode: raw?.pincode || "",
    latitude: raw?.latitude || 0,
    longitude: raw?.longitude || 0,
    isDefault: raw?.isDefault ?? false,
    createdAt: raw?.createdAt,
  } satisfies Address;
}

function mapAssignment(snapshotDoc: { id: string; data: () => unknown }) {
  const raw = snapshotDoc.data() as Partial<DeliveryAssignmentRecord>;

  return {
    id: snapshotDoc.id,
    orderId: raw.orderId || snapshotDoc.id,
    orderNumber: raw.orderNumber || snapshotDoc.id,
    riderId: raw.riderId || "",
    riderName: raw.riderName || "",
    riderPhone: raw.riderPhone || "",
    assignedRiderId: raw.assignedRiderId || raw.riderId || "",
    assignedRiderName: raw.assignedRiderName || raw.riderName || "",
    assignedRiderPhone: raw.assignedRiderPhone || raw.riderPhone || "",
    customerName: raw.customerName || "Customer",
    customerPhone: raw.customerPhone || "",
    address: getFallbackAddress(raw.address),
    location: raw.location || {
      lat: raw.address?.latitude || 0,
      lng: raw.address?.longitude || 0,
    },
    items: raw.items || [],
    total: raw.total || 0,
    orderStatus: raw.orderStatus || "ready",
    deliveryStatus: raw.deliveryStatus || "assigned",
    status: raw.status || "assigned",
    assignedAt: raw.assignedAt,
    pickedUpAt: raw.pickedUpAt,
    deliveredAt: raw.deliveredAt,
    cancelledAt: raw.cancelledAt,
    createdAt: raw.createdAt || raw.assignedAt,
    updatedAt: raw.updatedAt,
  } satisfies DeliveryAssignmentRecord;
}

export function toDeliveryAssignmentRecord(order: OrderRecord): DeliveryAssignmentRecord {
  return {
    id: order.id,
    orderId: order.id,
    orderNumber: order.orderNumber,
    riderId: order.assignedRiderId,
    riderName: order.assignedRiderName,
    riderPhone: order.assignedRiderPhone,
    assignedRiderId: order.assignedRiderId,
    assignedRiderName: order.assignedRiderName,
    assignedRiderPhone: order.assignedRiderPhone,
    customerName: order.customerName,
    customerPhone: order.customerPhone,
    address: getFallbackAddress(order.address),
    location: order.location,
    items: order.items,
    total: order.total,
    orderStatus: order.orderStatus,
    deliveryStatus: order.deliveryStatus,
    status:
      order.deliveryStatus === "on_the_way"
        ? "on_the_way"
        : order.deliveryStatus === "delivered"
          ? "delivered"
          : order.orderStatus === "cancelled"
            ? "cancelled"
            : "assigned",
    assignedAt: order.createdAt,
    pickedUpAt: order.pickedUpAt,
    deliveredAt: order.deliveredAt,
    cancelledAt: undefined,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
  };
}

function getNextRiderLoad(currentCount: number, delta: number) {
  return Math.max(0, currentCount + delta);
}

function canAssignOrder(order: OrderRecord) {
  return order.orderStatus === "ready";
}

export async function getSuggestedRider(_order: OrderRecord) {
  const ridersSnapshot = await getDocs(collection(firestore, "riders"));
  trackFirestoreRead("riders getDocs for suggestion");
  const settings = await getDeliverySettings();

  const availableRiders = ridersSnapshot.docs
    .map((snapshot) => {
      const rider = snapshot.data() as Partial<RiderProfile>;
      return {
        id: snapshot.id,
        phone: rider.phone || snapshot.id,
        name: rider.name || "Delivery Partner",
        vehicleType: rider.vehicleType || "Bike",
        accessCode: rider.accessCode || "",
        isActive: rider.isActive ?? true,
        isAvailable: rider.isAvailable ?? false,
        maxConcurrentOrders: rider.maxConcurrentOrders ?? 1,
        currentOrderCount: rider.currentOrderCount ?? 0,
        lastLocation: rider.lastLocation ?? null,
      } satisfies RiderProfile;
    })
    .filter((rider) => rider.id && rider.isActive && rider.isAvailable && rider.currentOrderCount < rider.maxConcurrentOrders);

  if (availableRiders.length === 0) {
    return null;
  }

  return [...availableRiders].sort((left, right) => {
    const leftDistance = left.lastLocation
      ? calculateDistanceKm(left.lastLocation.lat, left.lastLocation.lng, settings.restaurantLocation.lat, settings.restaurantLocation.lng)
      : Number.POSITIVE_INFINITY;
    const rightDistance = right.lastLocation
      ? calculateDistanceKm(right.lastLocation.lat, right.lastLocation.lng, settings.restaurantLocation.lat, settings.restaurantLocation.lng)
      : Number.POSITIVE_INFINITY;

    if (leftDistance !== rightDistance) {
      return leftDistance - rightDistance;
    }

    if (left.currentOrderCount !== right.currentOrderCount) {
      return left.currentOrderCount - right.currentOrderCount;
    }

    return left.name.localeCompare(right.name);
  })[0];
}

export async function assignOrderToRider(order: OrderRecord, rider: RiderProfile, previousRider?: RiderProfile | null) {
  logFirestoreDebug("assignOrderToRider called", {
    orderId: order.id,
    orderNumber: order.orderNumber,
    riderId: rider.id,
    previousRiderId: previousRider?.id ?? "",
  });
  if (!canAssignOrder(order)) {
    throw new Error("Only ready orders can be assigned to a rider.");
  }

  if (!rider.isActive || !rider.isAvailable) {
    throw new Error("This rider is not available for pickup.");
  }

  if (rider.currentOrderCount >= rider.maxConcurrentOrders && order.assignedRiderId !== rider.id) {
    throw new Error("This rider has reached the maximum active orders.");
  }

  if (order.deliveryStatus === "on_the_way") {
    throw new Error("This order is already on the way and cannot be reassigned.");
  }

  const batch = writeBatch(firestore);
  const currentAssignedRiderId = order.assignedRiderId || "";

  if (currentAssignedRiderId && currentAssignedRiderId !== rider.id && previousRider) {
    batch.update(riderDoc(previousRider.id), {
      currentOrderCount: getNextRiderLoad(previousRider.currentOrderCount ?? 0, -1),
      updatedAt: serverTimestamp(),
    });
  }

  if (currentAssignedRiderId !== rider.id) {
    batch.update(riderDoc(rider.id), {
      currentOrderCount: getNextRiderLoad(rider.currentOrderCount ?? 0, 1),
      updatedAt: serverTimestamp(),
    });
  }

  batch.set(
    assignmentDoc(order.id),
    {
      orderId: order.id,
      orderNumber: order.orderNumber,
      riderId: rider.id,
      riderName: rider.name,
      riderPhone: rider.phone,
      assignedRiderId: rider.id,
      assignedRiderName: rider.name,
      assignedRiderPhone: rider.phone,
      customerName: order.customerName,
      customerPhone: order.customerPhone,
      address: order.address,
      location: order.location,
      items: order.items,
      total: order.total,
      createdAt: order.createdAt ?? serverTimestamp(),
      orderStatus: order.orderStatus,
      deliveryStatus: "assigned",
      status: "assigned",
      assignedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );

  batch.update(orderDoc(order.id), {
    assignedRiderId: rider.id,
    assignedRiderName: rider.name,
    assignedRiderPhone: rider.phone,
    deliveryStatus: "assigned",
    updatedAt: serverTimestamp(),
  });

  await batch.commit();
}

export async function autoAssignOrder(order: OrderRecord, riders?: RiderProfile[]) {
  logFirestoreDebug("autoAssignOrder called", {
    orderId: order.id,
    orderNumber: order.orderNumber,
  });
  const suggestedRider = await getSuggestedRider(order);
  if (!suggestedRider) {
    throw new Error("No available riders found right now.");
  }

  const previousRider = riders?.find((rider) => rider.id === order.assignedRiderId) ?? null;
  await assignOrderToRider(order, suggestedRider, previousRider);
}

export async function unassignOrder(order: OrderRecord, assignedRider?: RiderProfile | null) {
  logFirestoreDebug("unassignOrder called", {
    orderId: order.id,
    assignedRiderId: order.assignedRiderId,
  });
  if (!order.assignedRiderId) {
    return;
  }

  if (order.deliveryStatus === "on_the_way") {
    throw new Error("This order is already on the way and cannot be unassigned.");
  }

  const batch = writeBatch(firestore);

  if (assignedRider) {
    batch.update(riderDoc(assignedRider.id), {
      currentOrderCount: getNextRiderLoad(assignedRider.currentOrderCount ?? 0, -1),
      updatedAt: serverTimestamp(),
    });
  }

  batch.set(
    assignmentDoc(order.id),
    {
      riderId: order.assignedRiderId,
      riderName: order.assignedRiderName,
      riderPhone: order.assignedRiderPhone,
      assignedRiderId: "",
      assignedRiderName: "",
      assignedRiderPhone: "",
      orderStatus: order.orderStatus,
      deliveryStatus: "unassigned",
      status: "cancelled",
      cancelledAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );

  batch.update(orderDoc(order.id), {
    assignedRiderId: "",
    assignedRiderName: "",
    assignedRiderPhone: "",
    deliveryStatus: "unassigned",
    updatedAt: serverTimestamp(),
  });

  await batch.commit();

  await clearOrderTracking(order.id);
}

export async function markOrderPickedUp(
  order: Pick<DeliveryAssignmentRecord, "id" | "assignedRiderId">,
  riderId: string,
) {
  logFirestoreDebug("markOrderPickedUp called", {
    orderId: order.id,
    riderId,
  });
  if (order.assignedRiderId !== riderId) {
    throw new Error("This order is assigned to another rider.");
  }

  const batch = writeBatch(firestore);
  batch.set(
    assignmentDoc(order.id),
    {
      status: "on_the_way",
      orderStatus: "out_for_delivery",
      deliveryStatus: "on_the_way",
      pickedUpAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );

  batch.update(orderDoc(order.id), {
    orderStatus: "out_for_delivery",
    deliveryStatus: "on_the_way",
    pickedUpAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  await batch.commit();
}

export async function markOrderDelivered(
  order: Pick<DeliveryAssignmentRecord, "id" | "assignedRiderId">,
  rider: Pick<RiderProfile, "id" | "currentOrderCount">,
) {
  logFirestoreDebug("markOrderDelivered called", {
    orderId: order.id,
    riderId: rider.id,
  });
  if (order.assignedRiderId !== rider.id) {
    throw new Error("This order is assigned to another rider.");
  }

  const batch = writeBatch(firestore);
  batch.set(
    assignmentDoc(order.id),
    {
      status: "delivered",
      orderStatus: "delivered",
      deliveryStatus: "delivered",
      deliveredAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );

  batch.update(orderDoc(order.id), {
    orderStatus: "delivered",
    deliveryStatus: "delivered",
    deliveredAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  batch.update(riderDoc(rider.id), {
    currentOrderCount: getNextRiderLoad(rider.currentOrderCount ?? 0, -1),
    updatedAt: serverTimestamp(),
  });

  await batch.commit();

  await clearOrderTracking(order.id);
}

export async function cancelOrder(order: OrderRecord, assignedRider?: RiderProfile | null) {
  logFirestoreDebug("cancelOrder called", {
    orderId: order.id,
    assignedRiderId: order.assignedRiderId,
  });
  const batch = writeBatch(firestore);

  if (order.assignedRiderId && assignedRider) {
    batch.update(riderDoc(assignedRider.id), {
      currentOrderCount: getNextRiderLoad(assignedRider.currentOrderCount ?? 0, -1),
      updatedAt: serverTimestamp(),
    });

    batch.set(
      assignmentDoc(order.id),
      {
        riderId: order.assignedRiderId,
        riderName: order.assignedRiderName,
        riderPhone: order.assignedRiderPhone,
        orderStatus: "cancelled",
        deliveryStatus: order.deliveryStatus === "delivered" ? "delivered" : "unassigned",
        status: "cancelled",
        cancelledAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );
  }

  batch.update(orderDoc(order.id), {
    orderStatus: "cancelled",
    deliveryStatus: order.deliveryStatus === "delivered" ? "delivered" : "unassigned",
    updatedAt: serverTimestamp(),
  });

  await batch.commit();

  await clearOrderTracking(order.id);
}

export async function getAssignmentsForRider(riderId: string) {
  const assignmentsQuery = query(collection(firestore, "delivery_assignments"), where("riderId", "==", riderId));
  const snapshot = await getDocs(assignmentsQuery);
  trackFirestoreRead("delivery_assignments getDocs by rider", { riderId });
  return snapshot.docs.map(mapAssignment);
}

export async function getAssignmentById(orderId: string) {
  const snapshot = await getDoc(assignmentDoc(orderId));
  trackFirestoreRead("delivery_assignments getDoc by id", { orderId });
  if (!snapshot.exists()) {
    return null;
  }

  return mapAssignment(snapshot);
}

export function subscribeToAssignmentsByRider(riderId: string, callback: (assignments: DeliveryAssignmentRecord[]) => void) {
  const assignmentsQuery = query(collection(firestore, "delivery_assignments"), where("riderId", "==", riderId));
  logFirestoreDebug("delivery_assignments listener attached", { scope: "rider", riderId });
  return onSnapshot(
    assignmentsQuery,
    (snapshot) => {
      trackFirestoreRead("delivery_assignments onSnapshot rider", { riderId, size: snapshot.size });
      const assignments = snapshot.docs.map(mapAssignment);
      callback(
        assignments.sort((left, right) => {
          const leftTime =
            left.assignedAt && typeof left.assignedAt === "object" && "toDate" in left.assignedAt && typeof left.assignedAt.toDate === "function"
              ? left.assignedAt.toDate().getTime()
              : 0;
          const rightTime =
            right.assignedAt && typeof right.assignedAt === "object" && "toDate" in right.assignedAt && typeof right.assignedAt.toDate === "function"
              ? right.assignedAt.toDate().getTime()
              : 0;
          return rightTime - leftTime;
        }),
      );
    },
    (error) => {
      console.error(`Firestore rider assignments listener error for ${riderId}:`, error);
    },
  );
}

export function subscribeToAssignment(orderId: string, callback: (assignment: DeliveryAssignmentRecord | null) => void) {
  logFirestoreDebug("delivery_assignments listener attached", { scope: "single", orderId });
  return onSnapshot(
    assignmentDoc(orderId),
    (snapshot) => {
      trackFirestoreRead("delivery_assignments onSnapshot single", { orderId, exists: snapshot.exists() });
      if (!snapshot.exists()) {
        callback(null);
        return;
      }

      callback(mapAssignment(snapshot));
    },
    (error) => {
      console.error(`Firestore assignment listener error for ${orderId}:`, error);
    },
  );
}
