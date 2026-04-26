"use client";

import {
  collection,
  doc,
  getDocs,
  onSnapshot,
  setDoc,
  serverTimestamp,
  writeBatch,
} from "firebase/firestore";
import { firestore } from "@/lib/firebase";
import type { MenuNode } from "@/lib/menu-builder";

export interface ModifierMaster {
  id: string;
  name: string;
  createdAt?: unknown;
}

const mastersCollection = () => collection(firestore, "modifier_masters");

export function subscribeToModifierMasters(
  callback: (masters: ModifierMaster[]) => void,
  onError?: (error: Error) => void,
) {
  return onSnapshot(
    mastersCollection(),
    (snapshot) => {
      const masters = snapshot.docs.map(
        (d) => ({ id: d.id, ...d.data() }) as ModifierMaster,
      );
      masters.sort((a, b) => a.name.localeCompare(b.name));
      callback(masters);
    },
    (error) => onError?.(error),
  );
}

export async function getModifierMasters(): Promise<ModifierMaster[]> {
  const snapshot = await getDocs(mastersCollection());
  return snapshot.docs
    .map((d) => ({ id: d.id, ...d.data() }) as ModifierMaster)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function createModifierMaster(name: string): Promise<string> {
  const ref = doc(mastersCollection());
  await setDoc(ref, {
    id: ref.id,
    name: name.trim(),
    createdAt: serverTimestamp(),
  });
  return ref.id;
}

export async function findOrCreateModifierMaster(
  name: string,
  existingMasters?: ModifierMaster[],
): Promise<string> {
  const masters = existingMasters ?? (await getModifierMasters());
  const match = masters.find(
    (m) => m.name.toLowerCase().trim() === name.toLowerCase().trim(),
  );
  if (match) return match.id;
  return createModifierMaster(name);
}

/**
 * Migration: scans all modifier-type menu nodes, groups by name,
 * creates a modifier_master per unique name, and links each node.
 * Returns the count of nodes updated.
 */
export async function migrateExistingModifiers(
  allNodes: MenuNode[],
): Promise<{ mastersCreated: number; nodesUpdated: number }> {
  const modifiers = allNodes.filter(
    (n) => n.type === "modifier" && !n.modifierMasterId,
  );
  if (modifiers.length === 0) return { mastersCreated: 0, nodesUpdated: 0 };

  const existing = await getModifierMasters();
  const masterMap = new Map<string, string>();
  for (const m of existing) {
    masterMap.set(m.name.toLowerCase().trim(), m.id);
  }

  const uniqueNames = new Set(
    modifiers.map((m) => m.name.toLowerCase().trim()),
  );
  let mastersCreated = 0;

  for (const name of uniqueNames) {
    if (masterMap.has(name)) continue;
    const displayName =
      modifiers.find((m) => m.name.toLowerCase().trim() === name)?.name ??
      name;
    const id = await createModifierMaster(displayName);
    masterMap.set(name, id);
    mastersCreated++;
  }

  const batch = writeBatch(firestore);
  let nodesUpdated = 0;

  for (const mod of modifiers) {
    const masterId = masterMap.get(mod.name.toLowerCase().trim());
    if (!masterId) continue;
    batch.update(doc(firestore, "menus", mod.id), {
      modifierMasterId: masterId,
    });
    nodesUpdated++;
  }

  await batch.commit();
  return { mastersCreated, nodesUpdated };
}
