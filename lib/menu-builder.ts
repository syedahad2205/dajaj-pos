import {
  collection,
  doc,
  getDocs,
  onSnapshot,
  serverTimestamp,
  type Firestore,
  setDoc,
  updateDoc,
  writeBatch,
  type FieldValue,
} from "firebase/firestore";
import { firestore } from "@/lib/firebase";

export type MenuNodeType = "category" | "variant" | "modifierGroup" | "modifier";
export type SelectionType = "single" | "multiple" | "";
export type InventoryTrackingMode = "aggregate" | "items";

export interface MenuNode {
  id: string;
  name: string;
  parentId: string | null;
  type: MenuNodeType;
  price: number;
  selectionType: SelectionType;
  minSelection: number;
  maxSelection: number;
  description: string;
  imageUrl: string;
  isAvailable: boolean;
  trackInventory: boolean;
  inventoryMultiplier: number | null;
  inventoryTrackingMode: InventoryTrackingMode | null;
  order: number;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface MenuTreeNode extends MenuNode {
  children: MenuTreeNode[];
}

export interface MenuNodeInput {
  name: string;
  parentId: string | null;
  type: MenuNodeType;
  price: number;
  selectionType: SelectionType;
  minSelection: number;
  maxSelection: number;
  description: string;
  imageUrl: string;
  isAvailable: boolean;
  trackInventory: boolean;
  inventoryMultiplier: number | null;
  inventoryTrackingMode: InventoryTrackingMode | null;
  order: number;
}

function menusCollection(db: Firestore = firestore) {
  return collection(db, "menus");
}

function normalizeMenuNode(data: Partial<MenuNode>, fallbackId: string): MenuNode {
  const legacyImage = "image" in data ? String((data as { image?: unknown }).image ?? "") : "";
  const rawType = typeof data.type === "string" ? (data.type as string) : "";
  const normalizedType: MenuNodeType =
    rawType === "category" || rawType === "variant" || rawType === "modifierGroup" || rawType === "modifier"
      ? rawType
      : rawType === "item"
        ? "variant"
        : "category";
  const normalizedParentId = data.parentId ?? null;
  const supportsInventory = normalizedType === "variant" || (normalizedType === "category" && normalizedParentId === null);
  const legacyTrackInventory = normalizedType === "variant" || (normalizedType === "category" && normalizedParentId === null);
  const supportsInventoryMode = normalizedType === "category" && normalizedParentId === null;
  const normalizedMultiplier =
    typeof data.inventoryMultiplier === "number"
      ? data.inventoryMultiplier
      : supportsInventory
        ? 1
        : null;
  const normalizedTrackingMode: InventoryTrackingMode | null = supportsInventoryMode
    ? data.inventoryTrackingMode === "aggregate" || data.inventoryTrackingMode === "items"
      ? data.inventoryTrackingMode
      : "items"
    : null;

  return {
    id: data.id ?? fallbackId,
    name: data.name ?? "",
    parentId: normalizedParentId,
    type: normalizedType,
    price: typeof data.price === "number" ? data.price : 0,
    selectionType: (data.selectionType as SelectionType) ?? "",
    minSelection: typeof data.minSelection === "number" ? data.minSelection : 0,
    maxSelection: typeof data.maxSelection === "number" ? data.maxSelection : 0,
    description: data.description ?? "",
    imageUrl: data.imageUrl ?? legacyImage,
    isAvailable: data.isAvailable ?? true,
    trackInventory: typeof data.trackInventory === "boolean" ? data.trackInventory : legacyTrackInventory,
    inventoryMultiplier: normalizedMultiplier,
    inventoryTrackingMode: normalizedTrackingMode,
    order: typeof data.order === "number" ? data.order : 0,
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
  };
}

export function subscribeToMenuNodes(
  callback: (nodes: MenuNode[]) => void,
  onError?: (error: Error) => void,
) {
  return onSnapshot(
    menusCollection(),
    (snapshot) => {
      const nodes = snapshot.docs
        .map((menuDoc) => normalizeMenuNode(menuDoc.data() as Partial<MenuNode>, menuDoc.id))
        .sort((a, b) => sortNodes(a, b));

      callback(nodes);
    },
    (error) => {
      onError?.(error);
    },
  );
}

export async function getMenuNodes(db: Firestore = firestore) {
  const snapshot = await getDocs(menusCollection(db));
  return snapshot.docs
    .map((menuDoc) => normalizeMenuNode(menuDoc.data() as Partial<MenuNode>, menuDoc.id))
    .sort((a, b) => sortNodes(a, b));
}

export function buildMenuTree(nodes: MenuNode[]): MenuTreeNode[] {
  const nodeMap = new Map<string, MenuTreeNode>();
  const roots: MenuTreeNode[] = [];

  for (const node of nodes) {
    nodeMap.set(node.id, { ...node, children: [] });
  }

  for (const node of nodes) {
    const treeNode = nodeMap.get(node.id)!;

    if (!node.parentId) {
      roots.push(treeNode);
      continue;
    }

    const parent = nodeMap.get(node.parentId);
    if (parent) {
      parent.children.push(treeNode);
    } else {
      roots.push(treeNode);
    }
  }

  const sortTree = (items: MenuTreeNode[]) => {
    items.sort(sortNodes);
    items.forEach((item) => sortTree(item.children));
  };

  sortTree(roots);
  return roots;
}

function sortNodes(a: Pick<MenuNode, "order" | "name">, b: Pick<MenuNode, "order" | "name">) {
  if (a.order !== b.order) {
    return a.order - b.order;
  }

  return a.name.localeCompare(b.name);
}

export function getNodeBehavior(type: MenuNodeType) {
  switch (type) {
    case "category":
      return {
        supportsPrice: false,
        supportsSelection: false,
        priceLabel: "No price",
      };
    case "variant":
      return {
        supportsPrice: true,
        supportsSelection: false,
        priceLabel: "Price",
      };
    case "modifierGroup":
      return {
        supportsPrice: false,
        supportsSelection: true,
        priceLabel: "No price",
      };
    case "modifier":
      return {
        supportsPrice: true,
        supportsSelection: false,
        priceLabel: "Price adjustment",
      };
  }
}

export function sanitizeMenuNodeInput(input: MenuNodeInput): MenuNodeInput {
  const behavior = getNodeBehavior(input.type);
  const minSelection = behavior.supportsSelection ? Math.max(0, input.minSelection) : 0;
  const rawMaxSelection = behavior.supportsSelection ? Math.max(0, input.maxSelection) : 0;
  const maxSelection = rawMaxSelection > 0 && rawMaxSelection < minSelection ? minSelection : rawMaxSelection;
  const supportsInventory = input.type === "variant" || (input.type === "category" && input.parentId === null);
  const supportsModifierStock = input.type === "modifier";
  const supportsInventoryMode = input.type === "category" && input.parentId === null;
  const numericMultiplier = typeof input.inventoryMultiplier === "number" && Number.isFinite(input.inventoryMultiplier)
    ? Math.max(0, input.inventoryMultiplier)
    : null;
  const inventoryMultiplier = supportsInventory
    ? input.type === "category"
      ? numericMultiplier && numericMultiplier > 0 ? numericMultiplier : 1
      : numericMultiplier && numericMultiplier > 0
        ? numericMultiplier
        : null
    : supportsModifierStock
      ? numericMultiplier && numericMultiplier > 0
        ? numericMultiplier
        : null
      : null;
  const inventoryTrackingMode = supportsInventoryMode ? input.inventoryTrackingMode ?? "items" : null;

  return {
    ...input,
    price: behavior.supportsPrice ? input.price : 0,
    selectionType: behavior.supportsSelection ? input.selectionType || "single" : "",
    minSelection,
    maxSelection,
    trackInventory: supportsInventory ? input.trackInventory : false,
    inventoryMultiplier,
    inventoryTrackingMode,
  };
}

export function calculateVariantFinalPrice(variant: MenuNode, modifiers: MenuNode[]) {
  return variant.price + modifiers.reduce((sum, modifier) => sum + modifier.price, 0);
}

export async function createMenuNode(input: MenuNodeInput) {
  const menuRef = doc(menusCollection());
  const now = serverTimestamp();

  await setDoc(menuRef, {
    ...sanitizeMenuNodeInput(input),
    id: menuRef.id,
    createdAt: now,
    updatedAt: now,
  });
}

export async function updateMenuNode(id: string, input: Partial<MenuNodeInput>) {
  await updateDoc(doc(firestore, "menus", id), {
    ...("type" in input &&
    "name" in input &&
    "parentId" in input &&
    "price" in input &&
    "selectionType" in input &&
    "minSelection" in input &&
    "maxSelection" in input &&
    "description" in input &&
    "imageUrl" in input &&
    "isAvailable" in input &&
    "trackInventory" in input &&
    "inventoryMultiplier" in input &&
    "inventoryTrackingMode" in input &&
    "order" in input
      ? sanitizeMenuNodeInput(input as MenuNodeInput)
      : input),
    updatedAt: serverTimestamp(),
  });
}

export async function updateMenuNodePrice(id: string, price: number) {
  await updateDoc(doc(firestore, "menus", id), {
    price,
    updatedAt: serverTimestamp(),
  });
}

export async function toggleMenuNodeAvailability(id: string, isAvailable: boolean) {
  await updateDoc(doc(firestore, "menus", id), {
    isAvailable,
    updatedAt: serverTimestamp(),
  });
}

export async function persistMenuNodePositions(
  updates: Array<Pick<MenuNode, "id" | "parentId" | "order">>,
) {
  const batch = writeBatch(firestore);
  const updatedAt: FieldValue = serverTimestamp();

  for (const update of updates) {
    batch.update(doc(firestore, "menus", update.id), {
      parentId: update.parentId,
      order: update.order,
      updatedAt,
    });
  }

  await batch.commit();
}

export async function deleteMenuNodeTree(nodes: MenuNode[], id: string) {
  const idsToDelete = new Set<string>();

  const collect = (parentId: string) => {
    idsToDelete.add(parentId);

    for (const node of nodes) {
      if (node.parentId === parentId) {
        collect(node.id);
      }
    }
  };

  collect(id);

  const batch = writeBatch(firestore);
  for (const nodeId of idsToDelete) {
    batch.delete(doc(firestore, "menus", nodeId));
  }
  await batch.commit();
}

export async function duplicateMenuSubtree(
  nodes: MenuNode[],
  sourceId: string,
  newParentId: string | null,
) {
  const sourceNode = nodes.find((node) => node.id === sourceId);
  if (!sourceNode) {
    throw new Error("Source node not found.");
  }

  const subtree: MenuNode[] = [];
  const queue = [sourceId];

  while (queue.length > 0) {
    const currentId = queue.shift()!;
    const currentNode = nodes.find((node) => node.id === currentId);
    if (!currentNode) {
      continue;
    }

    subtree.push(currentNode);
    nodes
      .filter((node) => node.parentId === currentId)
      .sort(sortNodes)
      .forEach((child) => queue.push(child.id));
  }

  const siblingCount = nodes.filter((node) => node.parentId === newParentId).length;
  const idMap = new Map<string, string>();
  const batch = writeBatch(firestore);
  const timestamp = serverTimestamp();

  for (const node of subtree) {
    idMap.set(node.id, doc(menusCollection()).id);
  }

  for (const node of subtree) {
    const nextId = idMap.get(node.id)!;
    const nextParentId = node.id === sourceId ? newParentId : (node.parentId ? idMap.get(node.parentId)! : newParentId);
    const nextOrder = node.id === sourceId ? siblingCount : node.order;
    const cloneName = node.id === sourceId ? `${node.name} Copy` : node.name;

    batch.set(doc(firestore, "menus", nextId), {
      ...node,
      id: nextId,
      name: cloneName,
      parentId: nextParentId,
      order: nextOrder,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  }

  await batch.commit();
}
