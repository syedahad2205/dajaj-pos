import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  type Firestore,
  updateDoc,
  where,
} from "firebase/firestore";
import { firestore as defaultFirestore } from "@/lib/firebase";
import { getMenuNodes, type InventoryTrackingMode, type MenuNode } from "@/lib/menu-builder";
import type { BillItem } from "@/lib/firestore";

export type InventoryActionType = "OPENING" | "CLOSING" | "EDIT";

export interface InventoryTrackableVariant {
  variantId: string;
  name: string;
  multiplier: number;
}

export interface InventoryTrackableItem {
  itemId: string;
  name: string;
  description: string;
  trackInventory: boolean;
  trackingMode: InventoryTrackingMode;
  variants: InventoryTrackableVariant[];
}

export interface InventoryEntry {
  id: string;
  itemId: string;
  date: string;
  openingStock: number | null;
  closingStock: number | null;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface InventoryAuditLog {
  id: string;
  itemId: string;
  date: string;
  userId: string;
  userName: string;
  actionType: InventoryActionType;
  field: "openingStock" | "closingStock";
  oldValue: number | null;
  newValue: number | null;
  timestamp?: unknown;
}

function inventoryEntriesCollection(db: Firestore = defaultFirestore) {
  return collection(db, "inventory_entries");
}

function inventoryLogsCollection(db: Firestore = defaultFirestore) {
  return collection(db, "inventory_audit_logs");
}

function collectDescendantVariants(nodeId: string, allNodes: MenuNode[]): MenuNode[] {
  const children = allNodes.filter((child) => child.parentId === nodeId);
  const variants: MenuNode[] = [];

  for (const child of children) {
    if (!child.isAvailable) {
      continue;
    }

    if (child.type === "variant") {
      variants.push(child);
    }

    variants.push(...collectDescendantVariants(child.id, allNodes));
  }

  return variants;
}

function collectInventoryTrackableItemsFromNodes(nodes: MenuNode[]): InventoryTrackableItem[] {
  const trackedCategories = nodes.filter(
    (node) => node.type === "category" && node.parentId === null && node.trackInventory && node.isAvailable,
  );

  const items = trackedCategories.map((category) => {
    const categoryDefaultMultiplier =
      typeof category.inventoryMultiplier === "number" && category.inventoryMultiplier > 0
        ? category.inventoryMultiplier
        : 1;
    const trackingMode = category.inventoryTrackingMode ?? "items";
    const descendantVariants = collectDescendantVariants(category.id, nodes);

    const variants = descendantVariants
      .filter((variant) => variant.isAvailable && (trackingMode === "aggregate" || variant.trackInventory))
      .map((variant) => ({
        variantId: variant.id,
        name: variant.name,
        multiplier:
          trackingMode === "aggregate"
            ? categoryDefaultMultiplier
            : typeof variant.inventoryMultiplier === "number" && variant.inventoryMultiplier > 0
            ? variant.inventoryMultiplier
            : categoryDefaultMultiplier,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    return {
      itemId: category.id,
      name: category.name,
      description: category.description,
      trackInventory: true,
      trackingMode,
      variants,
    };
  }).filter((item) => item.variants.length > 0);

  return items.sort((a, b) => a.name.localeCompare(b.name));
}

export async function getInventoryTrackableItems(db: Firestore = defaultFirestore): Promise<InventoryTrackableItem[]> {
  const nodes = await getMenuNodes(db);
  return collectInventoryTrackableItemsFromNodes(nodes);
}

/** Modifier doc ids on a bill SKU after the variant id segment (POS `buildSku` appends sorted modifier ids). */
export function listModifierIdsFromSku(sku: string, variantId: string): string[] {
  if (!sku || !variantId) return [];
  if (!sku.startsWith(variantId)) return [];
  const tail = sku.slice(variantId.length);
  if (!tail.startsWith("-")) return [];
  return tail.slice(1).split("-").filter(Boolean);
}

function modifierStockFactorFromSku(sku: string, variantId: string, allNodes: MenuNode[]): number {
  const ids = listModifierIdsFromSku(sku, variantId);
  if (ids.length === 0) {
    return 1;
  }

  const modifierById = new Map(
    allNodes.filter((n) => n.type === "modifier").map((n) => [n.id, n]),
  );

  return ids.reduce((acc, id) => {
    const node = modifierById.get(id);
    const m =
      node && typeof node.inventoryMultiplier === "number" && node.inventoryMultiplier > 0
        ? node.inventoryMultiplier
        : 1;
    return acc * m;
  }, 1);
}

/** @deprecated Prefer resolveVariantIdForInventorySku — variant ids that contain `-` need longest-prefix matching. */
export function parseVariantIdFromSku(sku: string) {
  return sku.split("-")[0];
}

/** Match bill line SKU to a tracked variant id (handles modifier suffixes and variant ids with hyphens). */
export function resolveVariantIdForInventorySku(sku: string, trackedVariantIds: Iterable<string>): string | null {
  const trimmed = (sku ?? "").trim();
  if (!trimmed) return null;

  const ids = [...trackedVariantIds];
  if (ids.includes(trimmed)) {
    return trimmed;
  }

  let best: string | null = null;
  for (const id of ids) {
    if (!id) continue;
    if (trimmed === id || trimmed.startsWith(`${id}-`)) {
      if (!best || id.length > best.length) {
        best = id;
      }
    }
  }

  return best;
}

export async function getInventoryEntriesForDate(
  date: string,
  db: Firestore = defaultFirestore,
): Promise<InventoryEntry[]> {
  const q = query(inventoryEntriesCollection(db), where("date", "==", date));
  const snapshot = await getDocs(q);
  return snapshot.docs
    .map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() as Omit<InventoryEntry, "id">) }))
    .sort((a, b) => a.itemId.localeCompare(b.itemId));
}

export async function saveInventoryOpening(
  date: string,
  itemId: string,
  openingStock: number | null,
  userId: string,
  userName: string,
  db: Firestore = defaultFirestore,
): Promise<InventoryEntry> {
  const docId = `${date}_${itemId}`;
  const ref = doc(inventoryEntriesCollection(db), docId);
  const snapshot = await getDoc(ref);
  const existing = snapshot.exists() ? (snapshot.data() as Partial<InventoryEntry>) : null;
  const oldValue = existing?.openingStock ?? null;
  const actionType: InventoryActionType = existing ? "EDIT" : "OPENING";

  const entry: InventoryEntry = {
    id: docId,
    itemId,
    date,
    openingStock,
    closingStock: existing?.closingStock ?? null,
    createdBy: existing?.createdBy ?? userId,
    updatedBy: userId,
    createdAt: existing?.createdAt ?? serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  await updateDoc(ref, {
    itemId,
    date,
    openingStock,
    closingStock: existing?.closingStock ?? null,
    createdBy: existing?.createdBy ?? userId,
    updatedBy: userId,
    updatedAt: serverTimestamp(),
    createdAt: existing?.createdAt ?? serverTimestamp(),
  }).catch(async () => {
    await setDoc(ref, {
      itemId,
      date,
      openingStock,
      closingStock: existing?.closingStock ?? null,
      createdBy: existing?.createdBy ?? userId,
      updatedBy: userId,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  });

  await addDoc(inventoryLogsCollection(db), {
    itemId,
    date,
    userId,
    userName,
    actionType,
    field: "openingStock",
    oldValue,
    newValue: openingStock,
    timestamp: serverTimestamp(),
  });

  return entry;
}

export async function saveInventoryClosing(
  date: string,
  itemId: string,
  closingStock: number | null,
  userId: string,
  userName: string,
  db: Firestore = defaultFirestore,
): Promise<InventoryEntry> {
  const docId = `${date}_${itemId}`;
  const ref = doc(inventoryEntriesCollection(db), docId);
  const snapshot = await getDoc(ref);
  const existing = snapshot.exists() ? (snapshot.data() as Partial<InventoryEntry>) : null;
  const oldValue = existing?.closingStock ?? null;
  const actionType: InventoryActionType = existing ? "EDIT" : "CLOSING";

  const entry: InventoryEntry = {
    id: docId,
    itemId,
    date,
    openingStock: existing?.openingStock ?? null,
    closingStock,
    createdBy: existing?.createdBy ?? null,
    updatedBy: userId,
    createdAt: existing?.createdAt ?? serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  await updateDoc(ref, {
    itemId,
    date,
    openingStock: existing?.openingStock ?? null,
    closingStock,
    createdBy: existing?.createdBy ?? null,
    updatedBy: userId,
    updatedAt: serverTimestamp(),
    createdAt: existing?.createdAt ?? serverTimestamp(),
  }).catch(async () => {
    await setDoc(ref, {
      itemId,
      date,
      openingStock: existing?.openingStock ?? null,
      closingStock,
      createdBy: existing?.createdBy ?? null,
      updatedBy: userId,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  });

  await addDoc(inventoryLogsCollection(db), {
    itemId,
    date,
    userId,
    userName,
    actionType,
    field: "closingStock",
    oldValue,
    newValue: closingStock,
    timestamp: serverTimestamp(),
  });

  return entry;
}

export async function getInventoryLogs(db: Firestore = defaultFirestore): Promise<InventoryAuditLog[]> {
  const logsQuery = query(inventoryLogsCollection(db), orderBy("timestamp", "desc"));
  const snapshot = await getDocs(logsQuery);
  return snapshot.docs.map((docSnap) => ({
    id: docSnap.id,
    ...(docSnap.data() as Omit<InventoryAuditLog, "id">),
  }));
}

function expandTrackableItemsToReportRows(
  trackableItems: InventoryTrackableItem[],
): InventoryTrackableItem[] {
  const rows: InventoryTrackableItem[] = [];

  for (const category of trackableItems) {
    if (category.trackingMode === "aggregate") {
      rows.push(category);
      continue;
    }

    for (const variant of category.variants) {
      rows.push({
        itemId: variant.variantId,
        name: `${category.name} · ${variant.name}`,
        description: category.description,
        trackInventory: true,
        trackingMode: "items",
        variants: [variant],
      });
    }
  }

  return rows;
}

export async function getInventoryReportForDate(date: string, db: Firestore = defaultFirestore): Promise<{
  date: string;
  items: Array<InventoryTrackableItem & {
    openingStock: number | null;
    closingStock: number | null;
    sold: number;
    expectedClosing: number | null;
    variance: number | null;
  }>;
}> {
  try {
    const nodes = await getMenuNodes(db);
    const trackableItems = collectInventoryTrackableItemsFromNodes(nodes);
    const reportRows = expandTrackableItemsToReportRows(trackableItems);
    const entries = await getInventoryEntriesForDate(date, db);

    const variantToItem = new Map<string, { itemId: string; multiplier: number }>();
    for (const category of trackableItems) {
      for (const variant of category.variants) {
        const stockItemId =
          category.trackingMode === "aggregate" ? category.itemId : variant.variantId;
        variantToItem.set(variant.variantId, { itemId: stockItemId, multiplier: variant.multiplier });
      }
    }

    const start = Timestamp.fromDate(new Date(`${date}T00:00:00`));
    const end = Timestamp.fromDate(new Date(`${date}T23:59:59.999`));

    const billsSnapshot = await getDocs(
      query(
        collection(db, "bills"),
        where("createdAt", ">=", start),
        where("createdAt", "<=", end),
      ),
    );
    
    const itemsById = new Map(reportRows.map((item) => [item.itemId, {
      ...item,
      openingStock: null as number | null,
      closingStock: null as number | null,
      sold: 0,
      expectedClosing: null as number | null,
      variance: null as number | null,
    }]));

    const soldByItemId = new Map<string, number>();
    billsSnapshot.docs.forEach((billDoc) => {
      const bill = billDoc.data() as { createdAt?: Timestamp; items?: BillItem[] };
      if (!bill.createdAt || !bill.items) return;
      if (bill.createdAt.toDate() < start.toDate() || bill.createdAt.toDate() > end.toDate()) return;
      for (const billItem of bill.items) {
        try {
          if (typeof billItem.sku !== "string" || !billItem.sku.trim()) continue;
          const variantId = resolveVariantIdForInventorySku(billItem.sku, variantToItem.keys());
          if (!variantId) continue;
          const mapping = variantToItem.get(variantId);
          if (!mapping) continue;
          const modifierFactor = modifierStockFactorFromSku(billItem.sku, variantId, nodes);
          const itemSold = soldByItemId.get(mapping.itemId) ?? 0;
          soldByItemId.set(
            mapping.itemId,
            itemSold + billItem.qty * mapping.multiplier * modifierFactor,
          );
        } catch (err) {
          console.warn("[getInventoryReportForDate] Error processing bill item:", billItem, err);
        }
      }
    });

    for (const entry of entries) {
      const item = itemsById.get(entry.itemId);
      if (!item) continue;
      item.openingStock = entry.openingStock;
      item.closingStock = entry.closingStock;
    }

    for (const [itemId, item] of itemsById.entries()) {
      const sold = soldByItemId.get(itemId) ?? 0;
      item.sold = sold;
      item.expectedClosing = item.openingStock !== null ? Number((item.openingStock - sold).toFixed(3)) : null;
      item.variance = item.expectedClosing !== null && item.closingStock !== null
        ? Number((item.expectedClosing - item.closingStock).toFixed(3))
        : null;
    }

    return {
      date,
      items: Array.from(itemsById.values()),
    };
  } catch (error) {
    console.error("[getInventoryReportForDate] Error:", error);
    throw error;
  }
}
