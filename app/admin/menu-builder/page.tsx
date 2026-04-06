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
  type SelectionType,
  type MenuTreeNode,
} from "@/lib/menu-builder";
import { requireAdmin } from "@/lib/roleGuard";

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
  onDragStart: (id: string) => void;
  onDrop: (targetId: string, position: DropPosition) => void;
}) {
  const [priceDraft, setPriceDraft] = useState(String(node.price));
  const isExpanded = expandedByDepth[depth] === node.id;
  const hasChildren = node.children.length > 0;
  const behavior = getNodeBehavior(node.type);
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
            </div>

            {node.description ? <p className="mt-2 text-sm text-slate-600">{node.description}</p> : null}

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
  const [isSaving, setIsSaving] = useState(false);
  const [status, setStatus] = useState<string>("Loading menu nodes...");

  useEffect(() => {
    if (!authenticated) {
      return;
    }

    const unsubscribe = subscribeToMenuNodes(
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

    return unsubscribe;
  }, [authenticated]);

  const tree = useMemo(() => buildMenuTree(nodes), [nodes]);
  const formBehavior = getNodeBehavior(form.type);

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
