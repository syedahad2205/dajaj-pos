"use client";

import { buildMenuTree, getMenuNodes, subscribeToMenuNodes, type MenuNode, type MenuTreeNode } from "@/lib/menu-builder";
import { trackFirestoreRead } from "@/lib/firestoreReadTracker";

function collectAvailableAncestors(nodes: MenuNode[]) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const required = new Set<string>();

  for (const node of nodes) {
    if (!node.isAvailable) {
      continue;
    }

    let current: MenuNode | undefined = node;
    while (current) {
      required.add(current.id);
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }
  }

  return required;
}

export function subscribeToAvailableMenuTree(
  callback: (tree: MenuTreeNode[], nodes: MenuNode[]) => void,
  onError?: (error: Error) => void,
) {
  return subscribeToMenuNodes(
    (nodes) => {
      trackFirestoreRead("menus onSnapshot");
      const requiredIds = collectAvailableAncestors(nodes);
      const filtered = nodes.filter((node) => requiredIds.has(node.id) && node.isAvailable);
      callback(buildMenuTree(filtered), filtered);
    },
    onError,
  );
}

export async function getAvailableMenuTree() {
  const nodes = await getMenuNodes();
  trackFirestoreRead("menus getDocs");
  const requiredIds = collectAvailableAncestors(nodes);
  const filtered = nodes.filter((node) => requiredIds.has(node.id) && node.isAvailable);
  return {
    tree: buildMenuTree(filtered),
    nodes: filtered,
  };
}
