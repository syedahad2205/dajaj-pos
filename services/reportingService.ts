import {
  collection,
  onSnapshot,
  query,
  Timestamp,
  where,
} from "firebase/firestore";
import { firestore } from "@/lib/firebase";
import { logFirestoreDebug, trackFirestoreRead } from "@/lib/firestoreReadTracker";

// ─── Types ──────────────────────────────────────────────────────────────────

export type ReportPeriod = "daily" | "weekly" | "monthly";

export type OrderChannel = "walk_in" | "whatsapp" | "website";

export interface ChannelMetrics {
  channel: OrderChannel;
  orderCount: number;
  revenue: number;
}

export interface PeakHour {
  hour: number; // 0-23
  orderCount: number;
}

export interface ReportSummary {
  period: ReportPeriod;
  startDate: Date;
  endDate: Date;
  totalOrders: number;
  totalRevenue: number; // rounded to 2 decimal places
  averageOrderValue: number; // revenue / orders, rounded to 2 decimal places
  peakHour: PeakHour;
  channelBreakdown: ChannelMetrics[];
}

// ─── Completed Order (raw from Firestore) ───────────────────────────────────

interface CompletedOrderDoc {
  status?: string;
  orderStatus?: string;
  channel?: string;
  grandTotal?: number;
  total?: number;
  subtotal?: number;
  completedAt?: Timestamp;
  createdAt?: Timestamp;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function getDateRange(period: ReportPeriod, referenceDate: Date): { start: Date; end: Date } {
  const end = new Date(referenceDate);
  end.setHours(23, 59, 59, 999);

  const start = new Date(referenceDate);
  start.setHours(0, 0, 0, 0);

  if (period === "daily") {
    // Single day: 00:00-23:59 of referenceDate
    return { start, end };
  }

  if (period === "weekly") {
    // Preceding 7 calendar days (including referenceDate)
    start.setDate(start.getDate() - 6);
    return { start, end };
  }

  // monthly: preceding 30 calendar days (including referenceDate)
  start.setDate(start.getDate() - 29);
  return { start, end };
}

function normalizeChannel(raw: string | undefined): OrderChannel {
  if (!raw) return "walk_in";
  const lower = raw.toLowerCase().replace(/[-\s]/g, "_");
  if (lower === "whatsapp") return "whatsapp";
  if (lower === "website") return "website";
  return "walk_in";
}

function getOrderRevenue(doc: CompletedOrderDoc): number {
  // Prefer grandTotal (post-discount+tax), fall back to total, then subtotal
  return doc.grandTotal ?? doc.total ?? doc.subtotal ?? 0;
}

function getOrderTimestamp(doc: CompletedOrderDoc): Date | null {
  const ts = doc.completedAt ?? doc.createdAt;
  if (!ts) return null;
  if (typeof ts === "object" && "toDate" in ts && typeof ts.toDate === "function") {
    return ts.toDate();
  }
  return null;
}

function roundTwo(value: number): number {
  return Math.round(value * 100) / 100;
}

// ─── Aggregation ────────────────────────────────────────────────────────────

export function computeReportSummary(
  orders: CompletedOrderDoc[],
  period: ReportPeriod,
  referenceDate: Date,
): ReportSummary {
  const { start, end } = getDateRange(period, referenceDate);

  let totalRevenue = 0;
  const channelMap: Record<OrderChannel, { orderCount: number; revenue: number }> = {
    walk_in: { orderCount: 0, revenue: 0 },
    whatsapp: { orderCount: 0, revenue: 0 },
    website: { orderCount: 0, revenue: 0 },
  };
  const hourCounts: number[] = new Array(24).fill(0);

  for (const order of orders) {
    const revenue = getOrderRevenue(order);
    totalRevenue += revenue;

    const channel = normalizeChannel(order.channel);
    channelMap[channel].orderCount += 1;
    channelMap[channel].revenue += revenue;

    const ts = getOrderTimestamp(order);
    if (ts) {
      hourCounts[ts.getHours()] += 1;
    }
  }

  // Peak hour
  let peakHourIdx = 0;
  let peakHourCount = 0;
  for (let h = 0; h < 24; h++) {
    if (hourCounts[h] > peakHourCount) {
      peakHourCount = hourCounts[h];
      peakHourIdx = h;
    }
  }

  const totalOrders = orders.length;
  const averageOrderValue = totalOrders > 0 ? roundTwo(totalRevenue / totalOrders) : 0;

  return {
    period,
    startDate: start,
    endDate: end,
    totalOrders,
    totalRevenue: roundTwo(totalRevenue),
    averageOrderValue,
    peakHour: { hour: peakHourIdx, orderCount: peakHourCount },
    channelBreakdown: [
      { channel: "walk_in", ...channelMap.walk_in },
      { channel: "whatsapp", ...channelMap.whatsapp },
      { channel: "website", ...channelMap.website },
    ],
  };
}

// ─── Real-time subscription ─────────────────────────────────────────────────

/**
 * Subscribes to completed orders within the given period.
 * Uses a real-time listener so new completed orders show up within 60s.
 * Returns an unsubscribe function.
 */
export function subscribeToCompletedOrders(
  period: ReportPeriod,
  referenceDate: Date,
  callback: (orders: CompletedOrderDoc[]) => void,
  onError?: (error: Error) => void,
): () => void {
  const { start, end } = getDateRange(period, referenceDate);
  const startTs = Timestamp.fromDate(start);
  const endTs = Timestamp.fromDate(end);

  // Query orders that are completed within the period
  // We use completedAt for the time range since we only want COMPLETED orders
  // But completedAt might not exist on older orders, so we also query by createdAt
  // and filter by status on the client side for robustness
  const ordersRef = collection(firestore, "orders");

  // Primary query: status=completed with completedAt in range
  // Fallback: we'll also query by createdAt for orders that may not have completedAt set
  const completedQuery = query(
    ordersRef,
    where("status", "==", "completed"),
    where("completedAt", ">=", startTs),
    where("completedAt", "<=", endTs),
  );

  logFirestoreDebug("reports listener attached", { period, start: start.toISOString(), end: end.toISOString() });

  const unsubscribe = onSnapshot(
    completedQuery,
    (snapshot) => {
      trackFirestoreRead("orders onSnapshot reports", { period, size: snapshot.size });
      const orders: CompletedOrderDoc[] = snapshot.docs.map((docSnap) => {
        const data = docSnap.data() as CompletedOrderDoc;
        return data;
      });
      callback(orders);
    },
    (error) => {
      console.error("[reports] Firestore completed orders listener error:", error.code, error.message);
      if (onError) {
        onError(error);
      }
    },
  );

  return unsubscribe;
}

/**
 * Same as subscribeToCompletedOrders but queries by orderStatus field
 * (used in this app) + createdAt range as fallback for orders without completedAt.
 */
export function subscribeToCompletedOrdersFallback(
  period: ReportPeriod,
  referenceDate: Date,
  callback: (orders: CompletedOrderDoc[]) => void,
  onError?: (error: Error) => void,
): () => void {
  const { start, end } = getDateRange(period, referenceDate);
  const startTs = Timestamp.fromDate(start);
  const endTs = Timestamp.fromDate(end);

  const ordersRef = collection(firestore, "orders");

  // This app uses "orderStatus" field in orders and "createdAt" for timestamp
  // Query completed orders by createdAt range and filter by status client-side
  const ordersQuery = query(
    ordersRef,
    where("createdAt", ">=", startTs),
    where("createdAt", "<=", endTs),
  );

  logFirestoreDebug("reports fallback listener attached", { period, start: start.toISOString(), end: end.toISOString() });

  const unsubscribe = onSnapshot(
    ordersQuery,
    (snapshot) => {
      trackFirestoreRead("orders onSnapshot reports-fallback", { period, size: snapshot.size });
      const orders: CompletedOrderDoc[] = snapshot.docs
        .map((docSnap) => docSnap.data() as CompletedOrderDoc)
        .filter((order) => {
          const status = order.status ?? order.orderStatus;
          return status === "completed";
        });
      callback(orders);
    },
    (error) => {
      console.error("[reports-fallback] Firestore orders listener error:", error.code, error.message);
      if (onError) {
        onError(error);
      }
    },
  );

  return unsubscribe;
}
