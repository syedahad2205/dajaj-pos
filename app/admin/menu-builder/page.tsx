"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  buildMenuTree,
  calculateVariantFinalPrice,
  createMenuNode,
  deleteMenuNodeTree,
  duplicateMenuSubtree,
  getNodeBehavior,
  persistMenuNodePositions,
  subscribeToMenuNodes,
  toggleMenuNodeAvailability,
  updateMenuNode,
  updateMenuNodePrice,
  type MenuNode,
  type MenuNodeInput,
  type MenuNodeType,
  type InventoryTrackingMode,
  type SelectionType,
  type MenuTreeNode,
} from "@/lib/menu-builder";
import { requireAdmin } from "@/lib/roleGuard";
import {
  subscribeToModifierMasters,
  findOrCreateModifierMaster,
  type ModifierMaster,
} from "@/services/modifierMasterService";

type FormState = {
  name: string;
  parentId: string;
  type: MenuNodeType;
  price: string;
  selectionType: SelectionType;
  minSelection: string;
  maxSelection: string;
  description: string;
  imageUrl: string;
  isAvailable: boolean;
  trackInventory: boolean;
  inventoryMultiplier: string;
  inventoryTrackingMode: InventoryTrackingMode;
  modifierMasterId: string;
  order: string;
};

type DropPosition = "before" | "inside" | "after";

function getTypeLabel(type: MenuNodeType) {
  switch (type) {
    case "category":
      return "Category";
    case "variant":
      return "Variant";
    case "modifierGroup":
      return "Modifier Group";
    case "modifier":
      return "Modifier";
  }
}

function getNodePath(node: MenuNode, nodes: MenuNode[]) {
  const parts: string[] = [];
  let current: MenuNode | undefined = node;

  while (current) {
    parts.unshift(current.name);
    current = nodes.find((entry) => entry.id === current?.parentId);
  }

  return parts.join(" › ");
}

function getFirebaseErrorCode(error: unknown) {
  if (typeof error === "object" && error !== null && "code" in error) {
    return String((error as { code: unknown }).code);
  }

  return "";
}

function supportsInventoryControls(type: MenuNodeType, parentId: string | null) {
  return type === "variant" || (type === "category" && parentId === null);
}

function supportsModifierStockControls(type: MenuNodeType) {
  return type === "modifier";
}

function supportsInventoryModeControls(type: MenuNodeType, parentId: string | null) {
  return type === "category" && parentId === null;
}

function supportsNodeInventoryControls(node: MenuNode) {
  return supportsInventoryControls(node.type, node.parentId);
}

function formatInventoryMultiplierInput(node: Pick<MenuNode, "type" | "inventoryMultiplier">) {
  if (node.type === "variant" && node.inventoryMultiplier === null) {
    return "";
  }

  return String(node.inventoryMultiplier ?? 1);
}

/** Modifier: empty = default full portion (1) in inventory math. */
function formatModifierStockMultiplier(node: Pick<MenuNode, "type" | "inventoryMultiplier">) {
  if (node.type !== "modifier") {
    return "";
  }

  if (node.inventoryMultiplier === null || node.inventoryMultiplier === undefined) {
    return "";
  }

  return String(node.inventoryMultiplier);
}

function parseModifierStockMultiplierInput(rawValue: string): number | null {
  const trimmed = rawValue.trim();
  if (trimmed === "") {
    return null;
  }

  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error("Stock usage must be a number greater than 0 (e.g. 0.5 for half).");
  }

  return parsed;
}

function parseInventoryMultiplierInput(rawValue: string, nodeType: MenuNodeType) {
  const trimmed = rawValue.trim();
  if (trimmed === "") {
    return nodeType === "variant" ? null : 1;
  }

  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error("Inventory multiplier must be greater than 0.");
  }

  return parsed;
}

const emptyForm: FormState = {
  name: "",
  parentId: "",
  type: "category",
  price: "0",
  selectionType: "",
  minSelection: "0",
  maxSelection: "0",
  description: "",
  imageUrl: "",
  isAvailable: true,
  trackInventory: true,
  inventoryMultiplier: "",
  inventoryTrackingMode: "items",
  modifierMasterId: "",
  order: "0",
};

function siblingSort(a: MenuNode, b: MenuNode) {
  if (a.order !== b.order) {
    return a.order - b.order;
  }

  return a.name.localeCompare(b.name);
}

function normalizeSiblingOrders(nodes: MenuNode[], parentId: string | null) {
  return nodes
    .filter((node) => node.parentId === parentId)
    .sort(siblingSort)
    .map((node, index) => ({ ...node, order: index }));
}

function isDescendant(nodes: MenuNode[], ancestorId: string, targetId: string | null) {
  if (!targetId) {
    return false;
  }

  let currentId: string | null = targetId;

  while (currentId) {
    if (currentId === ancestorId) {
      return true;
    }

    currentId = nodes.find((node) => node.id === currentId)?.parentId ?? null;
  }

  return false;
}

function moveNode(
  nodes: MenuNode[],
  draggedId: string,
  targetId: string,
  position: DropPosition,
) {
  if (draggedId === targetId) {
    return null;
  }

  const dragged = nodes.find((node) => node.id === draggedId);
  const target = nodes.find((node) => node.id === targetId);

  if (!dragged || !target) {
    return null;
  }

  const nextParentId = position === "inside" ? target.id : target.parentId;
  if (isDescendant(nodes, dragged.id, nextParentId)) {
    return null;
  }

  const working = nodes.map((node) => ({ ...node }));
  const draggedNode = working.find((node) => node.id === draggedId)!;
  const previousParentId = draggedNode.parentId;

  draggedNode.parentId = nextParentId;

  const oldSiblings = working
    .filter((node) => node.parentId === previousParentId && node.id !== draggedId)
    .sort(siblingSort);

  oldSiblings.forEach((node, index) => {
    node.order = index;
  });

  const newSiblings = working
    .filter((node) => node.parentId === nextParentId && node.id !== draggedId)
    .sort(siblingSort);

  let insertAt = newSiblings.length;
  if (position !== "inside") {
    const targetIndex = newSiblings.findIndex((node) => node.id === targetId);
    insertAt = position === "before" ? targetIndex : targetIndex + 1;
  }

  if (insertAt < 0) {
    insertAt = newSiblings.length;
  }

  newSiblings.splice(insertAt, 0, draggedNode);
  newSiblings.forEach((node, index) => {
    node.order = index;
  });

  const changed = working.filter((node) => {
    const original = nodes.find((entry) => entry.id === node.id);
    return original && (original.parentId !== node.parentId || original.order !== node.order);
  });

  return {
    nextNodes: working,
    changed,
  };
}

function NodeRow({
  node,
  depth,
  expandedByDepth,
  onToggleExpanded,
  onCreateChild,
  onEdit,
  onDelete,
  onCopy,
  onToggleAvailability,
  onQuickPriceSave,
  onQuickDescriptionSave,
  onQuickModifierStockSave,
  onQuickInventorySave,
  onDragStart,
  onDrop,
}: {
  node: MenuTreeNode;
  depth: number;
  expandedByDepth: Record<number, string | undefined>;
  onToggleExpanded: (id: string, depth: number) => void;
  onCreateChild: (node: MenuNode) => void;
  onEdit: (node: MenuNode) => void;
  onDelete: (node: MenuNode) => void;
  onCopy: (node: MenuNode) => void;
  onToggleAvailability: (node: MenuNode) => void;
  onQuickPriceSave: (node: MenuNode, value: string) => void;
  onQuickDescriptionSave: (node: MenuNode, value: string) => void;
  onQuickModifierStockSave: (node: MenuNode, value: string) => void;
  onQuickInventorySave: (
    node: MenuNode,
    trackInventory: boolean,
    multiplier: string,
    trackingMode: InventoryTrackingMode | null,
  ) => void;
  onDragStart: (id: string) => void;
  onDrop: (targetId: string, position: DropPosition) => void;
}) {
  const [priceDraft, setPriceDraft] = useState(String(node.price));
  const [descriptionOpen, setDescriptionOpen] = useState(false);
  const [descriptionDraft, setDescriptionDraft] = useState(node.description);
  const [modifierStockDraft, setModifierStockDraft] = useState(() =>
    node.type === "modifier" ? formatModifierStockMultiplier(node) : "",
  );
  const [inventoryTrackDraft, setInventoryTrackDraft] = useState(node.trackInventory);
  const savedInventoryMultiplier = formatInventoryMultiplierInput(node);
  const [inventoryMultiplierDraft, setInventoryMultiplierDraft] = useState(savedInventoryMultiplier);
  const [inventoryTrackingModeDraft, setInventoryTrackingModeDraft] = useState<InventoryTrackingMode>(
    node.inventoryTrackingMode ?? "items",
  );
  const isExpanded = expandedByDepth[depth] === node.id;
  const hasChildren = node.children.length > 0;
  const behavior = getNodeBehavior(node.type);
  const inventoryConfigurable = supportsNodeInventoryControls(node);
  const inventoryModeConfigurable = supportsInventoryModeControls(node.type, node.parentId);
  const hasPendingInventoryChanges =
    inventoryTrackDraft !== node.trackInventory ||
    inventoryMultiplierDraft !== savedInventoryMultiplier ||
    (inventoryModeConfigurable && inventoryTrackingModeDraft !== (node.inventoryTrackingMode ?? "items"));
  let cardStyle = "";
  switch (node.type) {
    case "category":
      cardStyle = "bg-slate-50 border-slate-400";
      break;
    case "variant":
      cardStyle = "bg-orange-50 border-orange-400";
      break;
    case "modifierGroup":
      cardStyle = "bg-amber-50 border-amber-400";
      break;
    case "modifier":
      cardStyle = "bg-white border-slate-200";
      break;
  }
  const childModifiers = node.type === "variant" ? node.children.filter((child) => child.type === "modifier") : [];
  const previewPrice =
    node.type === "variant" && childModifiers.length > 0
      ? calculateVariantFinalPrice(node, childModifiers)
      : node.price;

  useEffect(() => {
    setPriceDraft(String(node.price));
  }, [node.price]);

  useEffect(() => {
    setDescriptionDraft(node.description);
  }, [node.description]);

  useEffect(() => {
    if (node.type === "modifier") {
      setModifierStockDraft(
        formatModifierStockMultiplier({ type: "modifier", inventoryMultiplier: node.inventoryMultiplier }),
      );
    }
  }, [node.id, node.inventoryMultiplier, node.type]);

  useEffect(() => {
    setInventoryTrackDraft(node.trackInventory);
    setInventoryMultiplierDraft(savedInventoryMultiplier);
    setInventoryTrackingModeDraft(node.inventoryTrackingMode ?? "items");
  }, [node.trackInventory, node.inventoryMultiplier, node.inventoryTrackingMode, node.type, savedInventoryMultiplier]);

  return (
    <div className="space-y-2">
      <div
        className="h-2 rounded-full border border-dashed border-transparent transition hover:border-orange-400 hover:bg-orange-100"
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          onDrop(node.id, "before");
        }}
      />

      <div
        draggable
        onDragStart={() => onDragStart(node.id)}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          onDrop(node.id, "inside");
        }}
        className={`rounded-2xl border p-4 shadow-sm ${cardStyle}`}
        style={{ marginLeft: depth * 18 }}
      >
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              {hasChildren ? (
                <button
                  type="button"
                  onClick={() => onToggleExpanded(node.id, depth)}
                  className="rounded-full border border-orange-300 px-2 py-1 text-xs font-semibold uppercase tracking-wide text-orange-700"
                >
                  {isExpanded ? "Hide Items" : "Show Items"}
                </button>
              ) : (
                <span className="rounded-full border border-slate-200 px-2 py-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Final Item
                </span>
              )}

              <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold uppercase tracking-wide text-slate-600">
                {node.type}
              </span>
              {node.type === "modifierGroup" && node.selectionType ? (
                <span className="rounded-full bg-amber-100 px-2 py-1 text-xs font-semibold uppercase tracking-wide text-amber-700">
                  {node.selectionType} {node.minSelection}/{node.maxSelection || "any"}
                </span>
              ) : null}
              <span
                className={`rounded-full px-2 py-1 text-xs font-semibold uppercase tracking-wide ${
                  node.isAvailable ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"
                }`}
              >
                {node.isAvailable ? "Available" : "Unavailable"}
              </span>
              {node.type === "modifier" && node.modifierMasterId ? (
                <span className="rounded-full bg-violet-100 px-2 py-1 text-xs font-semibold uppercase tracking-wide text-violet-700">
                  Global Modifier
                </span>
              ) : null}
              {node.type === "modifier" &&
              typeof node.inventoryMultiplier === "number" &&
              node.inventoryMultiplier > 0 &&
              node.inventoryMultiplier !== 1 ? (
                <span className="rounded-full bg-amber-100 px-2 py-1 text-xs font-semibold uppercase tracking-wide text-amber-800">
                  Stock ×{node.inventoryMultiplier}
                </span>
                ) : null}
              {inventoryConfigurable ? (
                <span
                  className={`rounded-full px-2 py-1 text-xs font-semibold uppercase tracking-wide ${
                    node.trackInventory ? "bg-sky-100 text-sky-700" : "bg-slate-200 text-slate-600"
                  }`}
                >
                  {node.trackInventory ? "Track inventory" : "Ignore inventory"}
                </span>
              ) : null}
              {inventoryModeConfigurable ? (
                <span className="rounded-full bg-sky-50 px-2 py-1 text-xs font-semibold uppercase tracking-wide text-sky-700">
                  {node.inventoryTrackingMode === "aggregate" ? "Whole category" : "Individual items"}
                </span>
              ) : null}
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-3">
              <h3 className="text-xl font-black text-slate-900">{node.name}</h3>
              <span className="text-sm font-semibold text-slate-500">Display Order {node.order}</span>
              <span className="text-sm font-semibold text-slate-500">
                Location: {node.parentId ? "Inside menu" : "Top Level"}
              </span>
              <span className="text-sm font-semibold text-slate-500">
                {behavior.priceLabel}: {behavior.supportsPrice ? previewPrice : "No price"}
              </span>
              {inventoryConfigurable ? (
                <span className="text-sm font-semibold text-slate-500">
                  {node.type === "category"
                    ? `Default multiplier ${node.inventoryMultiplier ?? 1}`
                    : `Multiplier ${node.inventoryMultiplier ?? "inherits category default"}`}
                </span>
              ) : null}
              {inventoryModeConfigurable ? (
                <span className="text-sm font-semibold text-slate-500">
                  Mode: {node.inventoryTrackingMode === "aggregate" ? "Whole category stock" : "Item-by-item stock"}
                </span>
              ) : null}
            </div>

            {node.description ? <p className="mt-2 text-sm text-slate-600">{node.description}</p> : null}

            {descriptionOpen ? (
              <div className="mt-2 flex items-start gap-2">
                <textarea
                  rows={2}
                  value={descriptionDraft}
                  onChange={(event) => setDescriptionDraft(event.target.value)}
                  placeholder="Add a short description..."
                  className="min-w-0 flex-1 rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-orange-500"
                />
                <button
                  type="button"
                  onClick={() => { onQuickDescriptionSave(node, descriptionDraft); setDescriptionOpen(false); }}
                  className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white"
                >
                  Save
                </button>
                <button
                  type="button"
                  onClick={() => { setDescriptionDraft(node.description); setDescriptionOpen(false); }}
                  className="rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-500"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setDescriptionOpen(true)}
                className="mt-2 text-sm font-semibold text-orange-600 hover:text-orange-700"
              >
                {node.description ? "Edit description" : "+ Add description"}
              </button>
            )}

            {node.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={node.imageUrl}
                alt={node.name}
                className="mt-3 h-24 w-24 rounded-2xl object-cover ring-1 ring-orange-200"
              />
            ) : null}
          </div>

          <div className="w-full max-w-md space-y-3">
            {behavior.supportsPrice ? (
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  step="0.01"
                  value={priceDraft}
                  onChange={(event) => setPriceDraft(event.target.value)}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none ring-0 focus:border-orange-500"
                />
                <button
                  type="button"
                  onClick={() => onQuickPriceSave(node, priceDraft)}
                  className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white"
                >
                  Save Price
                </button>
              </div>
            ) : null}

            {node.type === "modifier" ? (
              <div className="rounded-2xl border border-amber-200 bg-amber-50/80 p-3">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-900">Stock usage</p>
                <p className="mt-1 text-xs leading-5 text-slate-600">
                  POS bills store this modifier on the SKU. Set <strong>0.5</strong> for half portions, or leave empty for a
                  full portion (<strong>1</strong>). Full category stock uses this times bill quantity.
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={modifierStockDraft}
                    onChange={(event) => setModifierStockDraft(event.target.value)}
                    placeholder="default 1 (e.g. 0.5 for half)"
                    className="min-w-[8rem] flex-1 rounded-xl border border-amber-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-amber-500"
                  />
                  <button
                    type="button"
                    onClick={() => onQuickModifierStockSave(node, modifierStockDraft)}
                    className="rounded-xl bg-amber-700 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-800"
                  >
                    Save stock
                  </button>
                </div>
              </div>
            ) : null}

            {inventoryConfigurable ? (
              <div className="rounded-2xl border border-sky-200 bg-sky-50 p-3">
                <label className="flex items-center gap-3 text-sm font-semibold text-slate-700">
                  <input
                    type="checkbox"
                    checked={inventoryTrackDraft}
                    onChange={(event) => setInventoryTrackDraft(event.target.checked)}
                    className="h-4 w-4"
                  />
                  Track inventory
                </label>

                <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={inventoryMultiplierDraft}
                    onChange={(event) => setInventoryMultiplierDraft(event.target.value)}
                    placeholder={node.type === "variant" ? "inherit top category" : "1"}
                    className="min-w-0 flex-1 rounded-xl border border-sky-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                  />
                  {inventoryModeConfigurable ? (
                    <select
                      value={inventoryTrackingModeDraft}
                      onChange={(event) => setInventoryTrackingModeDraft(event.target.value as InventoryTrackingMode)}
                      className="min-w-0 rounded-xl border border-sky-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900 outline-none focus:border-sky-500"
                    >
                      <option value="aggregate">Whole category</option>
                      <option value="items">Individual items</option>
                    </select>
                  ) : null}
                  <button
                    type="button"
                    onClick={() =>
                      onQuickInventorySave(
                        node,
                        inventoryTrackDraft,
                        inventoryMultiplierDraft,
                        inventoryModeConfigurable ? inventoryTrackingModeDraft : null,
                      )
                    }
                    disabled={!hasPendingInventoryChanges}
                    className="rounded-xl bg-sky-600 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Save Tracking
                  </button>
                </div>

                <p className="mt-2 text-xs leading-5 text-slate-600">
                  {node.type === "category"
                    ? inventoryTrackingModeDraft === "aggregate"
                      ? "Whole category mode treats every sold child item as usage from one shared stock bucket."
                      : "Individual items mode lets child items opt in and use their own multiplier."
                    : "Tracked items reduce stock from their top-level category. Leave the multiplier blank to inherit the category default."}
                </p>

                {hasPendingInventoryChanges ? (
                  <p className="mt-2 text-xs font-semibold uppercase tracking-[0.18em] text-amber-700">
                    Tracking changes are not saved yet
                  </p>
                ) : null}
              </div>
            ) : null}

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => onCreateChild(node)}
                className="rounded-xl bg-orange-600 px-3 py-2 text-sm font-semibold text-white"
              >
                Add Item Inside
              </button>
              <button
                type="button"
                onClick={() => onEdit(node)}
                className="rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700"
              >
                Edit
              </button>
              <button
                type="button"
                onClick={() => onCopy(node)}
                className="rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700"
              >
                Copy
              </button>
              <button
                type="button"
                onClick={() => onToggleAvailability(node)}
                className="rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700"
              >
                {node.isAvailable ? "Mark Unavailable" : "Mark Available"}
              </button>
              <button
                type="button"
                onClick={() => onDelete(node)}
                className="rounded-xl border border-rose-300 px-3 py-2 text-sm font-semibold text-rose-700"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      </div>

      <div
        className="h-2 rounded-full border border-dashed border-transparent transition hover:border-orange-400 hover:bg-orange-100"
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          onDrop(node.id, "after");
        }}
      />

      {hasChildren && isExpanded ? (
        <div className="space-y-2">
          {node.children.map((child) => (
            <NodeRow
              key={child.id}
              node={child}
              depth={depth + 1}
              expandedByDepth={expandedByDepth}
              onToggleExpanded={onToggleExpanded}
              onCreateChild={onCreateChild}
              onEdit={onEdit}
              onDelete={onDelete}
              onCopy={onCopy}
              onToggleAvailability={onToggleAvailability}
              onQuickPriceSave={onQuickPriceSave}
              onQuickDescriptionSave={onQuickDescriptionSave}
              onQuickModifierStockSave={onQuickModifierStockSave}
              onQuickInventorySave={onQuickInventorySave}
              onDragStart={onDragStart}
              onDrop={onDrop}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export default function AdminMenuBuilderPage() {
  const { authenticated, loading: authLoading, role } = requireAdmin();
  const [nodes, setNodes] = useState<MenuNode[]>([]);
  const [expandedByDepth, setExpandedByDepth] = useState<Record<number, string | undefined>>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [copiedNodeId, setCopiedNodeId] = useState<string | null>(null);
  const [modifierMasters, setModifierMasters] = useState<ModifierMaster[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [status, setStatus] = useState<string>("Loading menu nodes...");

  useEffect(() => {
    if (!authenticated) {
      return;
    }

    const unsub1 = subscribeToMenuNodes(
      (nextNodes) => {
        setNodes(nextNodes);
        setExpandedByDepth((current) => ({
          ...current,
          0: current[0] ?? nextNodes.find((node) => node.parentId === null)?.id,
        }));
        setStatus("");
      },
      (error) => {
        if (getFirebaseErrorCode(error) === "permission-denied") {
          setStatus("Firebase denied access to menus. Sign in with an authenticated admin user and deploy the Firestore rules from README.md.");
          return;
        }

        setStatus(error.message || "Failed to load menu nodes.");
      },
    );
    const unsub2 = subscribeToModifierMasters((masters) => setModifierMasters(masters));

    return () => { unsub1(); unsub2(); };
  }, [authenticated]);

  const tree = useMemo(() => buildMenuTree(nodes), [nodes]);
  const formBehavior = getNodeBehavior(form.type);
  const formSupportsInventory = supportsInventoryControls(form.type, form.parentId || null);
  const formSupportsModifierStock = supportsModifierStockControls(form.type);
  const formSupportsInventoryMode = supportsInventoryModeControls(form.type, form.parentId || null);

  useEffect(() => {
    setForm((current) => {
      const nextPrice = formBehavior.supportsPrice ? current.price : "0";
      const nextSelectionType = formBehavior.supportsSelection ? current.selectionType || "single" : "";
      const nextMinSelection = formBehavior.supportsSelection ? current.minSelection : "0";
      const nextMaxSelection = formBehavior.supportsSelection ? current.maxSelection : "0";

      if (
        nextPrice === current.price &&
        nextSelectionType === current.selectionType &&
        nextMinSelection === current.minSelection &&
        nextMaxSelection === current.maxSelection
      ) {
        return current;
      }

      return {
        ...current,
        price: nextPrice,
        selectionType: nextSelectionType,
        minSelection: nextMinSelection,
        maxSelection: nextMaxSelection,
      };
    });
  }, [formBehavior.supportsPrice, formBehavior.supportsSelection, form.type]);

  const resetForm = () => {
    setEditingId(null);
    setForm(emptyForm);
  };

  const populateForm = (node?: MenuNode, parentId?: string | null) => {
    if (!node) {
      const siblings = normalizeSiblingOrders(nodes, parentId ?? null);
      setEditingId(null);
      setForm({
        ...emptyForm,
        parentId: parentId ?? "",
        order: String(siblings.length),
      });
      return;
    }

    setEditingId(node.id);
    setForm({
      name: node.name,
      parentId: node.parentId ?? "",
      type: node.type,
      price: String(node.price),
      selectionType: node.selectionType,
      minSelection: String(node.minSelection),
      maxSelection: String(node.maxSelection),
      description: node.description,
      imageUrl: node.imageUrl,
      isAvailable: node.isAvailable,
      trackInventory: node.trackInventory,
      inventoryMultiplier:
        node.type === "modifier" ? formatModifierStockMultiplier(node) : formatInventoryMultiplierInput(node),
      inventoryTrackingMode: node.inventoryTrackingMode ?? "items",
      modifierMasterId: node.modifierMasterId ?? "",
      order: String(node.order),
    });
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSaving(true);

    try {
      const nextParentId = form.parentId || null;
      if (editingId && (nextParentId === editingId || isDescendant(nodes, editingId, nextParentId))) {
        throw new Error("A node cannot be assigned to itself or one of its descendants.");
      }

      let modifierMasterId: string | null = null;
      if (form.type === "modifier") {
        if (form.modifierMasterId === "__auto__" || form.modifierMasterId === "") {
          modifierMasterId = await findOrCreateModifierMaster(
            form.name.trim(),
            modifierMasters,
          );
        } else if (form.modifierMasterId) {
          modifierMasterId = form.modifierMasterId;
        }
      }

      const payload: MenuNodeInput = {
        name: form.name.trim(),
        parentId: nextParentId,
        type: form.type,
        price: Number(form.price) || 0,
        selectionType: form.selectionType,
        minSelection: Math.max(0, Number(form.minSelection) || 0),
        maxSelection: Math.max(0, Number(form.maxSelection) || 0),
        description: form.description.trim(),
        imageUrl: form.imageUrl.trim(),
        isAvailable: form.isAvailable,
        trackInventory: form.trackInventory,
        inventoryMultiplier: formSupportsModifierStock
          ? parseModifierStockMultiplierInput(form.inventoryMultiplier)
          : formSupportsInventory
            ? parseInventoryMultiplierInput(form.inventoryMultiplier, form.type)
            : null,
        inventoryTrackingMode: formSupportsInventoryMode ? form.inventoryTrackingMode : null,
        modifierMasterId,
        order: Math.max(0, Number(form.order) || 0),
      };

      if (editingId) {
        await updateMenuNode(editingId, payload);
        setStatus("Menu node updated.");
      } else {
        await createMenuNode(payload);
        setStatus("Menu node created.");
      }

      resetForm();
    } catch (error) {
      if (getFirebaseErrorCode(error) === "permission-denied") {
        setStatus("Firebase denied write access. Check that you are signed in and that Firestore rules allow admin access.");
      } else {
        setStatus(error instanceof Error ? error.message : "Failed to save node.");
      }
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (node: MenuNode) => {
    const confirmed = window.confirm(`Delete "${node.name}" and all nested children?`);
    if (!confirmed) {
      return;
    }

    try {
      await deleteMenuNodeTree(nodes, node.id);
      setStatus("Menu node deleted.");
      if (editingId === node.id) {
        resetForm();
      }
    } catch (error) {
      if (getFirebaseErrorCode(error) === "permission-denied") {
        setStatus("Firebase denied delete access. Check Firestore rules for authenticated admins.");
      } else {
        setStatus(error instanceof Error ? error.message : "Failed to delete node.");
      }
    }
  };

  const handleQuickPriceSave = async (node: MenuNode, value: string) => {
    try {
      await updateMenuNodePrice(node.id, Number(value) || 0);
      setStatus(`Updated price for ${node.name}.`);
    } catch (error) {
      if (getFirebaseErrorCode(error) === "permission-denied") {
        setStatus("Firebase denied price update access. Check Firestore rules for authenticated admins.");
      } else {
        setStatus(error instanceof Error ? error.message : "Failed to update price.");
      }
    }
  };

  const handleQuickDescriptionSave = async (node: MenuNode, value: string) => {
    try {
      await updateMenuNode(node.id, { description: value.trim() });
      setStatus(`Updated description for ${node.name}.`);
    } catch (error) {
      if (getFirebaseErrorCode(error) === "permission-denied") {
        setStatus("Firebase denied description update access. Check Firestore rules for authenticated admins.");
      } else {
        setStatus(error instanceof Error ? error.message : "Failed to update description.");
      }
    }
  };

  const handleQuickModifierStockSave = async (node: MenuNode, value: string) => {
    if (node.type !== "modifier") {
      return;
    }

    try {
      const parsed = parseModifierStockMultiplierInput(value);
      await updateMenuNode(node.id, { inventoryMultiplier: parsed });
      setStatus(`Stock usage updated for ${node.name}.`);
    } catch (error) {
      if (getFirebaseErrorCode(error) === "permission-denied") {
        setStatus("Firebase denied menu update access. Check Firestore rules for authenticated admins.");
      } else {
        setStatus(error instanceof Error ? error.message : "Failed to update stock usage.");
      }
    }
  };

  const handleQuickInventorySave = async (
    node: MenuNode,
    trackInventory: boolean,
    multiplier: string,
    trackingMode: InventoryTrackingMode | null,
  ) => {
    if (!supportsNodeInventoryControls(node)) {
      return;
    }

    try {
      await updateMenuNode(node.id, {
        trackInventory,
        inventoryMultiplier: parseInventoryMultiplierInput(multiplier, node.type),
        inventoryTrackingMode: supportsInventoryModeControls(node.type, node.parentId) ? trackingMode ?? "items" : null,
      });
      setStatus(`Inventory tracking updated for ${node.name}.`);
    } catch (error) {
      if (getFirebaseErrorCode(error) === "permission-denied") {
        setStatus("Firebase denied inventory updates. Check Firestore rules for authenticated admins.");
      } else {
        setStatus(error instanceof Error ? error.message : "Failed to update inventory settings.");
      }
    }
  };

  const handleToggleAvailability = async (node: MenuNode) => {
    try {
      await toggleMenuNodeAvailability(node.id, !node.isAvailable);
      setStatus(`Availability updated for ${node.name}.`);
    } catch (error) {
      if (getFirebaseErrorCode(error) === "permission-denied") {
        setStatus("Firebase denied availability updates. Check Firestore rules for authenticated admins.");
      } else {
        setStatus(error instanceof Error ? error.message : "Failed to update availability.");
      }
    }
  };

  const handleDrop = async (targetId: string, position: DropPosition) => {
    if (!draggedId) {
      return;
    }

    const result = moveNode(nodes, draggedId, targetId, position);
    setDraggedId(null);

    if (!result || result.changed.length === 0) {
      return;
    }

    try {
      await persistMenuNodePositions(
        result.changed.map((node) => ({
          id: node.id,
          parentId: node.parentId,
          order: node.order,
        })),
      );
      setStatus("Menu tree reordered.");
    } catch (error) {
      if (getFirebaseErrorCode(error) === "permission-denied") {
        setStatus("Firebase denied reorder access. Check Firestore rules for authenticated admins.");
      } else {
        setStatus(error instanceof Error ? error.message : "Failed to reorder tree.");
      }
    }
  };

  const handleCopy = (node: MenuNode) => {
    setCopiedNodeId(node.id);
    setStatus(`Copied "${node.name}".`);
  };

  const handleImportCopiedNode = async () => {
    if (!copiedNodeId) {
      return;
    }

    try {
      const targetParentId = form.parentId || null;
      await duplicateMenuSubtree(nodes, copiedNodeId, targetParentId);
      if (targetParentId) {
        const parentNode = nodes.find((node) => node.id === targetParentId);
        if (parentNode) {
          const depth = getNodePath(parentNode, nodes).split(" › ").length - 1;
          setExpandedByDepth((current) => ({ ...current, [depth]: targetParentId }));
        }
      }
      setStatus("Imported copied menu subtree");
    } catch (error) {
      if (getFirebaseErrorCode(error) === "permission-denied") {
        setStatus("Firebase denied import access. Check Firestore rules for authenticated admins.");
      } else {
        setStatus(error instanceof Error ? error.message : "Failed to import copied menu subtree.");
      }
    }
  };

  if (authLoading) {
    return (
      <main className="min-h-screen bg-[linear-gradient(135deg,#fff8ef_0%,#ffe7cc_45%,#ffd6a8_100%)] px-4 py-8 text-slate-900 md:px-8">
        <div className="mx-auto max-w-2xl rounded-[28px] border border-orange-200 bg-white/90 p-8 shadow-[0_20px_60px_rgba(180,83,9,0.12)]">
          Checking admin session...
        </div>
      </main>
    );
  }

  if (!authenticated || role !== "admin") {
    return null;
  }

  return (
    <main className="min-h-screen bg-[linear-gradient(135deg,#fff8ef_0%,#ffe7cc_45%,#ffd6a8_100%)] px-4 py-8 text-slate-900 md:px-8">
      <div className="mx-auto grid max-w-7xl gap-6 xl:grid-cols-[420px_minmax(0,1fr)]">
        <section className="rounded-[28px] border border-orange-200 bg-white/90 p-6 shadow-[0_20px_60px_rgba(180,83,9,0.12)] backdrop-blur">
          <div className="mb-6">
            <p className="text-sm font-semibold uppercase tracking-[0.3em] text-orange-600">Admin Panel</p>
            <h1 className="mt-2 text-3xl font-black">Menu Builder</h1>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              Build a Firestore-backed menu tree with categories, variants, modifier groups, modifiers, and nested pricing controls.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="mb-2 block text-sm font-semibold text-slate-700">Name</label>
              <input
                required
                value={form.name}
                onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                className="w-full rounded-2xl border border-slate-300 px-4 py-3 outline-none focus:border-orange-500"
              />
            </div>

            {copiedNodeId ? (
              <button
                type="button"
                onClick={handleImportCopiedNode}
                className="rounded-2xl border border-sky-300 bg-sky-50 px-4 py-3 text-sm font-semibold text-sky-700"
              >
                Import Copied Node
              </button>
            ) : null}

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-2 block text-sm font-semibold text-slate-700">Parent</label>
                <select
                  value={form.parentId}
                  onChange={(event) => setForm((current) => ({ ...current, parentId: event.target.value }))}
                  className="w-full rounded-2xl border border-slate-300 px-4 py-3 outline-none focus:border-orange-500"
                >
                  <option value="">Top Level Category</option>
                  {nodes.map((node) => (
                    <option key={node.id} value={node.id}>
                      {getTypeLabel(node.type)} • {getNodePath(node, nodes)}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-2 block text-sm font-semibold text-slate-700">Type</label>
                <select
                  value={form.type}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, type: event.target.value as MenuNodeType }))
                  }
                  className="w-full rounded-2xl border border-slate-300 px-4 py-3 outline-none focus:border-orange-500"
                >
                  <option value="category">category</option>
                  <option value="variant">variant</option>
                  <option value="modifierGroup">modifierGroup</option>
                  <option value="modifier">modifier</option>
                </select>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              {formBehavior.supportsPrice ? (
                <div>
                  <label className="mb-2 block text-sm font-semibold text-slate-700">
                    {form.type === "variant" ? "Price" : "Price Adjustment"}
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={form.price}
                    onChange={(event) => setForm((current) => ({ ...current, price: event.target.value }))}
                    className="w-full rounded-2xl border border-slate-300 px-4 py-3 outline-none focus:border-orange-500"
                  />
                </div>
              ) : (
                <div>
                  <label className="mb-2 block text-sm font-semibold text-slate-700">Price</label>
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500">
                    This node type does not store a price.
                  </div>
                </div>
              )}

              <div>
                <label className="mb-2 block text-sm font-semibold text-slate-700">Order</label>
                <input
                  type="number"
                  min="0"
                  value={form.order}
                  onChange={(event) => setForm((current) => ({ ...current, order: event.target.value }))}
                  className="w-full rounded-2xl border border-slate-300 px-4 py-3 outline-none focus:border-orange-500"
                />
              </div>
            </div>

            {formBehavior.supportsSelection ? (
              <div className="grid gap-4 sm:grid-cols-3">
                <div>
                  <label className="mb-2 block text-sm font-semibold text-slate-700">Selection Type</label>
                  <select
                    value={form.selectionType || "single"}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, selectionType: event.target.value as SelectionType }))
                    }
                    className="w-full rounded-2xl border border-slate-300 px-4 py-3 outline-none focus:border-orange-500"
                  >
                    <option value="single">single</option>
                    <option value="multiple">multiple</option>
                  </select>
                </div>

                <div>
                  <label className="mb-2 block text-sm font-semibold text-slate-700">Min Selection</label>
                  <input
                    type="number"
                    min="0"
                    value={form.minSelection}
                    onChange={(event) => setForm((current) => ({ ...current, minSelection: event.target.value }))}
                    className="w-full rounded-2xl border border-slate-300 px-4 py-3 outline-none focus:border-orange-500"
                  />
                </div>

                <div>
                  <label className="mb-2 block text-sm font-semibold text-slate-700">Max Selection</label>
                  <input
                    type="number"
                    min="0"
                    value={form.maxSelection}
                    onChange={(event) => setForm((current) => ({ ...current, maxSelection: event.target.value }))}
                    className="w-full rounded-2xl border border-slate-300 px-4 py-3 outline-none focus:border-orange-500"
                  />
                </div>
              </div>
            ) : null}

            <div>
              <label className="mb-2 block text-sm font-semibold text-slate-700">Description</label>
              <textarea
                rows={4}
                value={form.description}
                onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
                className="w-full rounded-2xl border border-slate-300 px-4 py-3 outline-none focus:border-orange-500"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-semibold text-slate-700">Image URL</label>
              <input
                value={form.imageUrl}
                onChange={(event) => setForm((current) => ({ ...current, imageUrl: event.target.value }))}
                className="w-full rounded-2xl border border-slate-300 px-4 py-3 outline-none focus:border-orange-500"
                placeholder="https://..."
              />
            </div>

            {formSupportsModifierStock ? (
              <div className="rounded-2xl border border-amber-200 bg-amber-50/70 p-4">
                <label className="mb-2 block text-sm font-semibold text-slate-700">Stock usage (optional)</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.inventoryMultiplier}
                  onChange={(event) => setForm((current) => ({ ...current, inventoryMultiplier: event.target.value }))}
                  placeholder="1 = full portion; e.g. 0.5 for half"
                  className="w-full rounded-2xl border border-amber-200 bg-white px-4 py-3 outline-none focus:border-amber-500"
                />
                <p className="mt-2 text-xs leading-5 text-slate-600">
                  Bills attach modifier IDs to the line SKU. This number multiplies how much tracked stock the line
                  consumes (times bill quantity and category or item multipliers). Leave empty for a full portion.
                </p>
              </div>
            ) : null}

            {form.type === "modifier" ? (
              <div className="rounded-2xl border border-violet-200 bg-violet-50/70 p-4">
                <label className="mb-2 block text-sm font-semibold text-slate-700">
                  Global Modifier Link
                </label>
                <select
                  value={form.modifierMasterId}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      modifierMasterId: event.target.value,
                    }))
                  }
                  className="w-full rounded-2xl border border-violet-200 bg-white px-4 py-3 outline-none focus:border-violet-500"
                >
                  <option value="">Auto-link by name</option>
                  {modifierMasters.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
                <p className="mt-2 text-xs leading-5 text-slate-600">
                  Links this modifier to a global modifier master. &ldquo;Auto-link&rdquo; will match by name or create a
                  new master. When the global master is marked out of stock, all linked modifiers are disabled everywhere.
                </p>
              </div>
            ) : null}

            {formSupportsInventory ? (
              <div className="rounded-2xl border border-sky-200 bg-sky-50 p-4">
                <label className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={form.trackInventory}
                    onChange={(event) => setForm((current) => ({ ...current, trackInventory: event.target.checked }))}
                    className="h-4 w-4"
                  />
                  <span className="text-sm font-semibold text-slate-700">Track inventory</span>
                </label>

                <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_170px] sm:items-end">
                  <div>
                    <label className="mb-2 block text-sm font-semibold text-slate-700">
                      {form.type === "category" ? "Default multiplier" : "Multiplier"}
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={form.inventoryMultiplier}
                      onChange={(event) => setForm((current) => ({ ...current, inventoryMultiplier: event.target.value }))}
                      placeholder={form.type === "variant" ? "inherit top category" : "1"}
                      className="w-full rounded-2xl border border-slate-300 px-4 py-3 outline-none focus:border-sky-500"
                    />
                  </div>

                  <p className="text-xs leading-5 text-slate-600">
                    {form.type === "category"
                      ? form.inventoryTrackingMode === "aggregate"
                        ? "Whole category mode uses one shared stock bucket for every child item sale."
                        : "Individual items mode lets you choose which child items affect inventory."
                      : "Tracked items consume stock from their top-level category. Leave blank to inherit the category default."}
                  </p>
                </div>

                {formSupportsInventoryMode ? (
                  <div className="mt-4">
                    <label className="mb-2 block text-sm font-semibold text-slate-700">Tracking mode</label>
                    <select
                      value={form.inventoryTrackingMode}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          inventoryTrackingMode: event.target.value as InventoryTrackingMode,
                        }))
                      }
                      className="w-full rounded-2xl border border-slate-300 px-4 py-3 outline-none focus:border-sky-500"
                    >
                      <option value="aggregate">Whole category stock</option>
                      <option value="items">Individual child items</option>
                    </select>
                  </div>
                ) : null}
              </div>
            ) : null}

            <label className="flex items-center gap-3 rounded-2xl border border-slate-200 px-4 py-3">
              <input
                type="checkbox"
                checked={form.isAvailable}
                onChange={(event) => setForm((current) => ({ ...current, isAvailable: event.target.checked }))}
                className="h-4 w-4"
              />
              <span className="text-sm font-semibold text-slate-700">Available</span>
            </label>

            <div className="flex flex-wrap gap-3">
              <button
                type="submit"
                disabled={isSaving}
                className="rounded-2xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white disabled:opacity-60"
              >
                {isSaving ? "Saving..." : editingId ? "Update Node" : "Create Node"}
              </button>
              <button
                type="button"
                onClick={() => populateForm()}
                className="rounded-2xl border border-slate-300 px-5 py-3 text-sm font-semibold text-slate-700"
              >
                New Top Level Category
              </button>
              {(editingId || form.name || form.description || form.imageUrl) && (
                <button
                  type="button"
                  onClick={resetForm}
                  className="rounded-2xl border border-slate-300 px-5 py-3 text-sm font-semibold text-slate-700"
                >
                  Reset
                </button>
              )}
            </div>
          </form>
        </section>

        <section className="rounded-[28px] border border-orange-200 bg-[#fffaf4] p-6 shadow-[0_20px_60px_rgba(180,83,9,0.12)]">
            <div className="mb-6 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
              <div>
                <p className="text-sm font-semibold uppercase tracking-[0.3em] text-orange-600">Tree View</p>
                <h2 className="mt-2 text-3xl font-black">Restaurant Menu</h2>
              </div>
              <p className="max-w-xl text-sm leading-6 text-slate-600">
                Drag an item onto the highlighted line to move it before or after another item. Drop onto a card to place it inside that section.
              </p>
            </div>

          {copiedNodeId ? (
            <div className="mb-4 rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm font-medium text-sky-700">
              A copied node is ready. Use the form to import the copied subtree under the selected parent.
            </div>
          ) : null}

          {status ? (
            <div className="mb-4 rounded-2xl border border-orange-200 bg-orange-50 px-4 py-3 text-sm font-medium text-orange-700">
              {status}
            </div>
          ) : null}

          <div className="space-y-3">
            <button
              type="button"
              onClick={() => populateForm(undefined, null)}
              className="rounded-2xl bg-orange-600 px-4 py-3 text-sm font-semibold text-white"
            >
              Add Top Level Category
            </button>

            {tree.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center text-sm text-slate-500">
                No menu nodes yet.
              </div>
            ) : (
              tree.map((node) => (
                <NodeRow
                  key={node.id}
                  node={node}
                  depth={0}
                  expandedByDepth={expandedByDepth}
                  onToggleExpanded={(id, depth) =>
                    setExpandedByDepth((current) => {
                      const next: Record<number, string | undefined> = { ...current };
                      if (next[depth] === id) {
                        next[depth] = undefined;
                        Object.keys(next).forEach((key) => {
                          if (Number(key) > depth) {
                            delete next[Number(key)];
                          }
                        });
                        return next;
                      }

                      next[depth] = id;
                      Object.keys(next).forEach((key) => {
                        if (Number(key) > depth) {
                          delete next[Number(key)];
                        }
                      });
                      return next;
                    })
                  }
                  onCreateChild={(node) => {
                    populateForm(undefined, node.id);
                    setExpandedByDepth((current) => ({ ...current, [0]: current[0] }));
                  }}
                  onEdit={(node) => populateForm(node)}
                  onDelete={handleDelete}
                  onCopy={handleCopy}
                  onToggleAvailability={handleToggleAvailability}
                  onQuickPriceSave={handleQuickPriceSave}
                  onQuickDescriptionSave={handleQuickDescriptionSave}
                  onQuickModifierStockSave={handleQuickModifierStockSave}
                  onQuickInventorySave={handleQuickInventorySave}
                  onDragStart={(id) => setDraggedId(id)}
                  onDrop={handleDrop}
                />
              ))
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
