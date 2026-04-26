"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import { useRequireAuth } from "@/lib/useRequireAuth";
import { auth } from "@/lib/firebase";
import { getPosStaffProfileByEmail } from "@/lib/firestore";
import {
  subscribeToMenuNodes,
  buildMenuTree,
  type MenuNode,
  type MenuTreeNode,
} from "@/lib/menu-builder";
import { useStock } from "@/components/stock/StockProvider";
import {
  subscribeToModifierMasters,
  migrateExistingModifiers,
  type ModifierMaster,
} from "@/services/modifierMasterService";
import { bulkSetStockStatus } from "@/services/stockService";

// ── Bulk OOS context ───────────────────────────────────────────────────────────

const BulkSearchCtx = createContext<((name: string) => void) | null>(null);

// ── Shared components ──────────────────────────────────────────────────────────

function StockToggle({
  available,
  disabled,
  size = "md",
  onChange,
}: {
  available: boolean;
  disabled: boolean;
  size?: "sm" | "md";
  onChange: () => void;
}) {
  const h = size === "sm" ? "h-6 w-11" : "h-7 w-12";
  const knob = size === "sm" ? "h-4 w-4" : "h-5 w-5";
  const translate = size === "sm" ? "translate-x-5.5" : "translate-x-6";

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onChange();
      }}
      className={`relative shrink-0 rounded-full transition-colors ${h} ${
        available ? "bg-emerald-500" : "bg-rose-400"
      } ${disabled ? "cursor-not-allowed opacity-40" : "cursor-pointer"}`}
    >
      <span
        className={`absolute top-[3px] left-[3px] rounded-full bg-white shadow transition-transform ${knob} ${
          available ? translate : "translate-x-0"
        }`}
      />
    </button>
  );
}

function OOSBadge({ label = "Out of Stock" }: { label?: string }) {
  return (
    <span className="whitespace-nowrap rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-bold uppercase text-rose-600">
      {label}
    </span>
  );
}

function BulkButton({ name }: { name: string }) {
  const onBulkSearch = useContext(BulkSearchCtx);
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onBulkSearch?.(name);
      }}
      className="rounded px-1.5 py-0.5 text-[10px] font-bold uppercase text-violet-500 transition hover:bg-violet-50"
      title={`Disable all items containing "${name}"`}
    >
      All
    </button>
  );
}

// ── Tree rows ──────────────────────────────────────────────────────────────────

function ModifierRow({
  modifier,
  parentDisabled,
}: {
  modifier: MenuTreeNode;
  parentDisabled: boolean;
}) {
  const { isOutOfStock, toggleStock, outOfStockModifierMasters } = useStock();
  const selfOOS = isOutOfStock(modifier.id);
  const masterOOS = Boolean(
    modifier.modifierMasterId &&
      outOfStockModifierMasters.has(modifier.modifierMasterId),
  );
  const effectiveDisabled = parentDisabled || masterOOS;

  return (
    <div
      className={`flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2.5 ${
        selfOOS || masterOOS ? "opacity-60" : ""
      }`}
    >
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-slate-700">
          {modifier.name}
          {modifier.price !== 0 && (
            <span className="ml-1 text-xs text-slate-400">
              {modifier.price > 0 ? "+" : ""}₹{modifier.price}
            </span>
          )}
        </p>
      </div>
      <div className="flex items-center gap-1.5">
        {masterOOS && <OOSBadge label="Global OOS" />}
        {parentDisabled && !selfOOS && !masterOOS && (
          <span className="text-[10px] font-semibold uppercase text-slate-400">
            Parent OOS
          </span>
        )}
        <BulkButton name={modifier.name} />
        <StockToggle
          available={!selfOOS}
          disabled={effectiveDisabled}
          size="sm"
          onChange={() => toggleStock(modifier.id, !selfOOS)}
        />
      </div>
    </div>
  );
}

function ModifierGroupSection({
  group,
  parentDisabled,
}: {
  group: MenuTreeNode;
  parentDisabled: boolean;
}) {
  const { isOutOfStock, toggleStock } = useStock();
  const selfOOS = isOutOfStock(group.id);
  const childrenDisabled = parentDisabled || selfOOS;
  const modifiers = group.children.filter((c) => c.type === "modifier");

  return (
    <div className="ml-3 border-l-2 border-slate-200 pl-3">
      <div className="flex items-center justify-between gap-3 py-1.5">
        <div className="flex items-center gap-2">
          <p
            className={`text-sm font-bold ${
              selfOOS || parentDisabled ? "text-slate-400" : "text-slate-600"
            }`}
          >
            {group.name}
          </p>
          {group.selectionType && (
            <span className="text-[10px] font-normal uppercase text-slate-400">
              {group.selectionType}
            </span>
          )}
        </div>
        <StockToggle
          available={!selfOOS}
          disabled={parentDisabled}
          size="sm"
          onChange={() => toggleStock(group.id, !selfOOS)}
        />
      </div>
      <div className="space-y-1">
        {modifiers.map((mod) => (
          <ModifierRow
            key={mod.id}
            modifier={mod}
            parentDisabled={childrenDisabled}
          />
        ))}
      </div>
    </div>
  );
}

function ItemRow({
  item,
  parentDisabled,
}: {
  item: MenuTreeNode;
  parentDisabled: boolean;
}) {
  const { isOutOfStock, toggleStock } = useStock();
  const [expanded, setExpanded] = useState(false);
  const selfOOS = isOutOfStock(item.id);
  const childrenDisabled = parentDisabled || selfOOS;
  const modifierGroups = item.children.filter(
    (c) => c.type === "modifierGroup",
  );
  const hasChildren = modifierGroups.length > 0;

  return (
    <div
      className={`rounded-xl border bg-white ${
        selfOOS || parentDisabled
          ? "border-slate-200 opacity-60"
          : "border-slate-200"
      }`}
    >
      <div
        className={`flex items-center justify-between gap-2 px-3 py-3 ${
          hasChildren ? "cursor-pointer" : ""
        }`}
        onClick={() => hasChildren && setExpanded(!expanded)}
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {hasChildren && (
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                className={`shrink-0 text-slate-400 transition-transform ${
                  expanded ? "rotate-90" : ""
                }`}
              >
                <polyline points="9 18 15 12 9 6" />
              </svg>
            )}
            <p
              className={`text-sm font-semibold ${
                selfOOS || parentDisabled
                  ? "text-slate-400 line-through"
                  : "text-slate-800"
              }`}
            >
              {item.name}
            </p>
            <span className="text-xs text-slate-400">₹{item.price}</span>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {parentDisabled && !selfOOS && (
            <span className="text-[10px] font-semibold uppercase text-slate-400">
              Parent OOS
            </span>
          )}
          <BulkButton name={item.name} />
          <StockToggle
            available={!selfOOS}
            disabled={parentDisabled}
            size="sm"
            onChange={() => toggleStock(item.id, !selfOOS)}
          />
        </div>
      </div>
      {expanded && hasChildren && (
        <div className="space-y-2 border-t border-slate-100 px-3 py-2">
          {modifierGroups.map((group) => (
            <ModifierGroupSection
              key={group.id}
              group={group}
              parentDisabled={childrenDisabled}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function CategoryAccordion({ category }: { category: MenuTreeNode }) {
  const { isOutOfStock, toggleStock, outOfStockIds } = useStock();
  const [expanded, setExpanded] = useState(false);
  const selfOOS = isOutOfStock(category.id);

  const collectAllChildren = useCallback(
    (node: MenuTreeNode): MenuTreeNode[] => {
      const result: MenuTreeNode[] = [];
      for (const child of node.children) {
        result.push(child);
        result.push(...collectAllChildren(child));
      }
      return result;
    },
    [],
  );

  const allChildren = useMemo(
    () => collectAllChildren(category),
    [category, collectAllChildren],
  );
  const variants = allChildren.filter((c) => c.type === "variant");
  const oosCount = allChildren.filter((c) => outOfStockIds.has(c.id)).length;

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className={`shrink-0 text-slate-400 transition-transform ${
                expanded ? "rotate-90" : ""
              }`}
            >
              <polyline points="9 18 15 12 9 6" />
            </svg>
            <h3
              className={`text-sm font-bold ${
                selfOOS ? "text-slate-400" : "text-slate-900"
              }`}
            >
              {category.name}
            </h3>
            {selfOOS && <OOSBadge />}
          </div>
          <p className="mt-0.5 ml-6 text-xs text-slate-400">
            {variants.length} item{variants.length !== 1 ? "s" : ""}
            {oosCount > 0 && !selfOOS && (
              <span className="ml-1 text-rose-500">
                &middot; {oosCount} unavailable
              </span>
            )}
          </p>
        </div>
        <StockToggle
          available={!selfOOS}
          disabled={false}
          onChange={() => toggleStock(category.id, !selfOOS)}
        />
      </button>
      {expanded && (
        <div className="space-y-1.5 border-t border-slate-100 px-3 pb-3 pt-2">
          {category.children.map((child) => {
            if (child.type === "variant") {
              return (
                <ItemRow
                  key={child.id}
                  item={child}
                  parentDisabled={selfOOS}
                />
              );
            }
            if (child.type === "category") {
              return <CategoryAccordion key={child.id} category={child} />;
            }
            return null;
          })}
        </div>
      )}
    </div>
  );
}

// ── Global Modifiers ───────────────────────────────────────────────────────────

function GlobalModifiersSection({
  masters,
}: {
  masters: ModifierMaster[];
}) {
  const { outOfStockModifierMasters, toggleModifierMasterStock } = useStock();
  const [expanded, setExpanded] = useState(true);
  const oosCount = masters.filter((m) =>
    outOfStockModifierMasters.has(m.id),
  ).length;

  if (masters.length === 0) return null;

  return (
    <div className="overflow-hidden rounded-xl border border-violet-200 bg-white shadow-sm">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center justify-between gap-3 bg-violet-50 px-4 py-3 text-left"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className={`shrink-0 text-violet-400 transition-transform ${
                expanded ? "rotate-90" : ""
              }`}
            >
              <polyline points="9 18 15 12 9 6" />
            </svg>
            <h3 className="text-sm font-bold text-violet-900">
              Global Modifiers
            </h3>
            <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-bold text-violet-600">
              {masters.length}
            </span>
          </div>
          <p className="mt-0.5 ml-6 text-xs text-violet-400">
            Toggle once to disable everywhere
            {oosCount > 0 && (
              <span className="ml-1 text-rose-500">
                &middot; {oosCount} disabled
              </span>
            )}
          </p>
        </div>
      </button>
      {expanded && (
        <div className="divide-y divide-slate-100 px-3 pb-2 pt-1">
          {masters.map((master) => {
            const isOOS = outOfStockModifierMasters.has(master.id);
            return (
              <div
                key={master.id}
                className="flex items-center justify-between gap-3 py-2.5"
              >
                <div className="flex items-center gap-2">
                  <p
                    className={`text-sm font-medium ${
                      isOOS ? "text-slate-400 line-through" : "text-slate-700"
                    }`}
                  >
                    {master.name}
                  </p>
                  {isOOS && <OOSBadge label="Global OOS" />}
                </div>
                <StockToggle
                  available={!isOOS}
                  disabled={false}
                  size="sm"
                  onChange={() => toggleModifierMasterStock(master.id, !isOOS)}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Bulk Disable Modal ─────────────────────────────────────────────────────────

function getTypeLabel(type: string) {
  switch (type) {
    case "variant":
      return "Item";
    case "modifier":
      return "Modifier";
    case "modifierGroup":
      return "Group";
    case "category":
      return "Category";
    default:
      return type;
  }
}

function BulkDisableModal({
  keyword,
  matches,
  outOfStockIds,
  onConfirm,
  onClose,
}: {
  keyword: string;
  matches: MenuTreeNode[];
  outOfStockIds: Set<string>;
  onConfirm: (nodeIds: string[]) => void;
  onClose: () => void;
}) {
  const toDisable = matches.filter((m) => !outOfStockIds.has(m.id));
  const alreadyOOS = matches.filter((m) => outOfStockIds.has(m.id));
  const [loading, setLoading] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={onClose}
        className="fixed inset-0 z-40 bg-black/40"
      />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl">
          <h2 className="text-lg font-black text-slate-900">
            Disable all &ldquo;{keyword}&rdquo;?
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Found {matches.length} item{matches.length !== 1 ? "s" : ""}{" "}
            containing this name.
            {toDisable.length > 0 && (
              <span className="font-semibold text-rose-600">
                {" "}
                {toDisable.length} will be newly disabled.
              </span>
            )}
          </p>

          <div className="mt-4 max-h-60 space-y-1 overflow-y-auto">
            {toDisable.map((m) => (
              <div
                key={m.id}
                className="flex items-center justify-between rounded-lg bg-rose-50 px-3 py-2"
              >
                <div>
                  <p className="text-sm font-medium text-slate-800">
                    {m.name}
                  </p>
                  <p className="text-[10px] text-slate-400">
                    {getTypeLabel(m.type)}
                  </p>
                </div>
                <span className="text-[10px] font-bold uppercase text-rose-500">
                  Will disable
                </span>
              </div>
            ))}
            {alreadyOOS.map((m) => (
              <div
                key={m.id}
                className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 opacity-50"
              >
                <div>
                  <p className="text-sm font-medium text-slate-500">
                    {m.name}
                  </p>
                  <p className="text-[10px] text-slate-400">
                    {getTypeLabel(m.type)}
                  </p>
                </div>
                <span className="text-[10px] font-semibold text-slate-400">
                  Already OOS
                </span>
              </div>
            ))}
          </div>

          <div className="mt-5 flex gap-2">
            {toDisable.length > 0 ? (
              <button
                type="button"
                disabled={loading}
                onClick={async () => {
                  setLoading(true);
                  await onConfirm(toDisable.map((m) => m.id));
                  setLoading(false);
                }}
                className="flex-1 rounded-xl bg-rose-600 py-2.5 text-sm font-bold text-white transition hover:bg-rose-700 disabled:opacity-50"
              >
                {loading
                  ? "Disabling..."
                  : `Disable ${toDisable.length} item${toDisable.length !== 1 ? "s" : ""}`}
              </button>
            ) : (
              <div className="flex-1 rounded-xl bg-slate-100 py-2.5 text-center text-sm font-medium text-slate-500">
                All already out of stock
              </div>
            )}
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-bold text-slate-700 transition hover:bg-slate-50"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

// ── Migration Banner ───────────────────────────────────────────────────────────

function MigrationBanner({
  menuNodes,
  onComplete,
}: {
  menuNodes: MenuNode[];
  onComplete: () => void;
}) {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<{
    mastersCreated: number;
    nodesUpdated: number;
  } | null>(null);

  const unlinkedCount = menuNodes.filter(
    (n) => n.type === "modifier" && !n.modifierMasterId,
  ).length;

  if (unlinkedCount === 0 && !result) return null;

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
      {result ? (
        <div>
          <p className="text-sm font-bold text-emerald-700">
            Migration complete
          </p>
          <p className="mt-0.5 text-xs text-slate-600">
            Created {result.mastersCreated} masters, linked{" "}
            {result.nodesUpdated} modifiers.
          </p>
          <button
            type="button"
            onClick={onComplete}
            className="mt-2 text-xs font-semibold text-emerald-700 underline"
          >
            Dismiss
          </button>
        </div>
      ) : (
        <div>
          <p className="text-sm font-bold text-amber-800">
            {unlinkedCount} modifier{unlinkedCount !== 1 ? "s" : ""} not linked
            to global masters
          </p>
          <p className="mt-0.5 text-xs text-slate-600">
            Run migration to auto-create global modifiers from existing names.
          </p>
          <button
            type="button"
            disabled={running}
            onClick={async () => {
              setRunning(true);
              try {
                const r = await migrateExistingModifiers(menuNodes);
                setResult(r);
              } catch (err) {
                console.error(err);
                setRunning(false);
              }
            }}
            className="mt-2 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50"
          >
            {running ? "Migrating..." : "Run Migration"}
          </button>
        </div>
      )}
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function flattenTree(nodes: MenuTreeNode[]): MenuTreeNode[] {
  const flat: MenuTreeNode[] = [];
  const walk = (n: MenuTreeNode) => {
    flat.push(n);
    n.children.forEach(walk);
  };
  nodes.forEach(walk);
  return flat;
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function StockControlPage() {
  const router = useRouter();
  const { authenticated, loading: authLoading, role } = useRequireAuth("pos");
  const [hasAccess, setHasAccess] = useState<boolean | null>(null);
  const [menuTree, setMenuTree] = useState<MenuTreeNode[]>([]);
  const [rawNodes, setRawNodes] = useState<MenuNode[]>([]);
  const [modifierMasters, setModifierMasters] = useState<ModifierMaster[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [showOOSOnly, setShowOOSOnly] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [showMigrationBanner, setShowMigrationBanner] = useState(true);
  const [bulkTarget, setBulkTarget] = useState<{
    keyword: string;
    matches: MenuTreeNode[];
  } | null>(null);
  const { outOfStockIds, outOfStockModifierMasters, loading: stockLoading } =
    useStock();

  useEffect(() => {
    if (authLoading || !authenticated) return;
    if (role === "admin") {
      setHasAccess(true);
      return;
    }
    const email = auth.currentUser?.email;
    if (!email) {
      setHasAccess(false);
      return;
    }
    getPosStaffProfileByEmail(email).then((profile) => {
      setHasAccess(profile?.canManageInventory === true);
    });
  }, [authenticated, authLoading, role]);

  useEffect(() => {
    const unsub1 = subscribeToMenuNodes((nodes: MenuNode[]) => {
      setRawNodes(nodes);
      setMenuTree(buildMenuTree(nodes));
    });
    const unsub2 = subscribeToModifierMasters((masters) => {
      setModifierMasters(masters);
    });
    return () => {
      unsub1();
      unsub2();
    };
  }, []);

  const categories = useMemo(
    () => menuTree.filter((n) => n.type === "category"),
    [menuTree],
  );

  const filteredCategories = useMemo(() => {
    let result = categories;
    if (selectedCategory !== "all") {
      result = result.filter((c) => c.id === selectedCategory);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      result = result.filter((cat) => {
        if (cat.name.toLowerCase().includes(q)) return true;
        const walk = (node: MenuTreeNode): boolean => {
          if (node.name.toLowerCase().includes(q)) return true;
          return node.children.some(walk);
        };
        return walk(cat);
      });
    }
    if (showOOSOnly) {
      result = result.filter((cat) => {
        if (outOfStockIds.has(cat.id)) return true;
        const walk = (node: MenuTreeNode): boolean => {
          if (outOfStockIds.has(node.id)) return true;
          return node.children.some(walk);
        };
        return walk(cat);
      });
    }
    return result;
  }, [categories, selectedCategory, searchQuery, showOOSOnly, outOfStockIds]);

  const filteredMasters = useMemo(() => {
    if (!searchQuery.trim() && !showOOSOnly) return modifierMasters;
    let result = modifierMasters;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      result = result.filter((m) => m.name.toLowerCase().includes(q));
    }
    if (showOOSOnly) {
      result = result.filter((m) => outOfStockModifierMasters.has(m.id));
    }
    return result;
  }, [modifierMasters, searchQuery, showOOSOnly, outOfStockModifierMasters]);

  const handleBulkSearch = useCallback(
    (name: string) => {
      const keyword = name.toLowerCase().trim();
      const all = flattenTree(menuTree);
      const matches = all.filter((n) =>
        n.name.toLowerCase().trim().includes(keyword),
      );
      if (matches.length === 0) return;
      setBulkTarget({ keyword: name, matches });
    },
    [menuTree],
  );

  const handleBulkConfirm = useCallback(
    async (nodeIds: string[]) => {
      await bulkSetStockStatus(nodeIds, true);
      setBulkTarget(null);
    },
    [],
  );

  if (authLoading || hasAccess === null) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <div className="flex items-center gap-2">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-slate-600" />
          <p className="text-sm font-medium text-slate-500">Loading...</p>
        </div>
      </div>
    );
  }

  if (!hasAccess) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-slate-50 p-6">
        <div className="max-w-sm rounded-2xl bg-white p-8 text-center shadow-md">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-rose-100">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="28"
              height="28"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-rose-600"
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
            </svg>
          </div>
          <h1 className="text-2xl font-black text-slate-900">Access Denied</h1>
          <p className="mt-2 text-sm text-slate-500">
            You don&apos;t have permission to manage stock. Contact your admin
            for inventory access.
          </p>
          <button
            type="button"
            onClick={() => router.push("/admin")}
            className="mt-6 w-full rounded-xl bg-slate-900 px-5 py-3 text-sm font-bold text-white"
          >
            Go Back
          </button>
        </div>
      </div>
    );
  }

  const totalOOS = outOfStockIds.size + outOfStockModifierMasters.size;

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <div className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 px-4 py-3 shadow-sm backdrop-blur-sm">
        <div className="mx-auto max-w-lg">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-black text-slate-900">
                Stock Control
              </h1>
              <p className="text-xs text-slate-500">
                {totalOOS > 0 ? (
                  <span className="font-semibold text-rose-500">
                    {totalOOS} item{totalOOS !== 1 ? "s" : ""} out of stock
                  </span>
                ) : (
                  "All items available"
                )}
              </p>
            </div>
            <button
              type="button"
              onClick={() => router.push("/admin")}
              className="rounded-full border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600"
            >
              &larr; Back
            </button>
          </div>

          {/* Search */}
          <div className="mt-2 flex items-center gap-2 rounded-lg bg-slate-100 px-3 py-2">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="shrink-0 text-slate-400"
            >
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.3-4.3" />
            </svg>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search items or modifiers..."
              className="min-w-0 flex-1 bg-transparent text-sm text-slate-900 outline-none placeholder:text-slate-400"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="text-slate-400"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M18 6 6 18" />
                  <path d="m6 6 12 12" />
                </svg>
              </button>
            )}
          </div>

          {/* Filters */}
          <div className="mt-2 flex items-center gap-2">
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 outline-none"
            >
              <option value="all">All Categories</option>
              {categories.map((cat) => (
                <option key={cat.id} value={cat.id}>
                  {cat.name}
                </option>
              ))}
            </select>

            <button
              type="button"
              onClick={() => setShowOOSOnly(!showOOSOnly)}
              className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border px-2.5 py-1.5 text-xs font-medium transition ${
                showOOSOnly
                  ? "border-rose-300 bg-rose-50 text-rose-700"
                  : "border-slate-200 bg-white text-slate-600"
              }`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  showOOSOnly ? "bg-rose-500" : "bg-slate-300"
                }`}
              />
              OOS Only
            </button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="mx-auto max-w-lg px-4 py-4 pb-20">
        <BulkSearchCtx.Provider value={handleBulkSearch}>
          <div className="space-y-3">
            {/* Migration banner */}
            {role === "admin" && showMigrationBanner && (
              <MigrationBanner
                menuNodes={rawNodes}
                onComplete={() => setShowMigrationBanner(false)}
              />
            )}

            {/* Global Modifiers */}
            <GlobalModifiersSection masters={filteredMasters} />

            {/* Categories */}
            {stockLoading ? (
              <div className="rounded-xl bg-white px-6 py-10 text-center text-sm font-medium text-slate-400 shadow-sm">
                Loading stock status...
              </div>
            ) : filteredCategories.length === 0 ? (
              <div className="rounded-xl bg-white px-6 py-10 text-center text-sm font-medium text-slate-400 shadow-sm">
                {searchQuery || showOOSOnly
                  ? "No matching items found."
                  : "No menu items configured yet."}
              </div>
            ) : (
              filteredCategories.map((category) => (
                <CategoryAccordion key={category.id} category={category} />
              ))
            )}
          </div>
        </BulkSearchCtx.Provider>
      </div>

      {/* Bulk Disable Modal */}
      {bulkTarget && (
        <BulkDisableModal
          keyword={bulkTarget.keyword}
          matches={bulkTarget.matches}
          outOfStockIds={outOfStockIds}
          onConfirm={handleBulkConfirm}
          onClose={() => setBulkTarget(null)}
        />
      )}
    </div>
  );
}
