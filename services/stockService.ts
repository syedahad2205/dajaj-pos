"use client";

import {
  doc,
  onSnapshot,
  updateDoc,
  setDoc,
  deleteField,
  serverTimestamp,
} from "firebase/firestore";
import { firestore } from "@/lib/firebase";

export type StockOverrides = Record<string, true>;

const stockRef = () => doc(firestore, "stock_control", "overrides");

export function subscribeToStockOverrides(
  callback: (nodes: StockOverrides, modifierMasters: StockOverrides) => void,
  onError?: (error: Error) => void,
) {
  return onSnapshot(
    stockRef(),
    (snapshot) => {
      const data = snapshot.data();
      const nodes = ((data?.nodes ?? data?.items ?? {}) as StockOverrides);
      const modifierMasters = ((data?.modifierMasters ?? {}) as StockOverrides);
      callback(nodes, modifierMasters);
    },
    (error) => onError?.(error),
  );
}

export async function setStockStatus(
  nodeId: string,
  outOfStock: boolean,
): Promise<void> {
  const ref = stockRef();
  try {
    await updateDoc(ref, {
      [`nodes.${nodeId}`]: outOfStock ? true : deleteField(),
      updatedAt: serverTimestamp(),
    });
  } catch {
    if (outOfStock) {
      await setDoc(ref, {
        nodes: { [nodeId]: true },
        modifierMasters: {},
        updatedAt: serverTimestamp(),
      }, { merge: true });
    }
  }
}

export async function bulkSetStockStatus(
  nodeIds: string[],
  outOfStock: boolean,
): Promise<void> {
  if (nodeIds.length === 0) return;
  const ref = stockRef();
  const updates: Record<string, unknown> = { updatedAt: serverTimestamp() };
  for (const id of nodeIds) {
    updates[`nodes.${id}`] = outOfStock ? true : deleteField();
  }
  try {
    await updateDoc(ref, updates);
  } catch {
    if (outOfStock) {
      const nodes: Record<string, true> = {};
      for (const id of nodeIds) nodes[id] = true;
      await setDoc(
        ref,
        { nodes, updatedAt: serverTimestamp() },
        { merge: true },
      );
    }
  }
}

export async function setModifierMasterStockStatus(
  masterId: string,
  outOfStock: boolean,
): Promise<void> {
  const ref = stockRef();
  try {
    await updateDoc(ref, {
      [`modifierMasters.${masterId}`]: outOfStock ? true : deleteField(),
      updatedAt: serverTimestamp(),
    });
  } catch {
    if (outOfStock) {
      await setDoc(ref, {
        nodes: {},
        modifierMasters: { [masterId]: true },
        updatedAt: serverTimestamp(),
      }, { merge: true });
    }
  }
}
