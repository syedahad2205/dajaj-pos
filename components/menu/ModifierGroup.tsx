"use client";

import type { MenuTreeNode } from "@/lib/menu-builder";

function formatModifierLabel(modifier: MenuTreeNode) {
  if (modifier.price > 0) {
    return `${modifier.name} (+₹${modifier.price})`;
  }

  if (modifier.price < 0) {
    return `${modifier.name} (-₹${Math.abs(modifier.price)})`;
  }

  return modifier.name;
}

function getSelectionInstruction(group: MenuTreeNode) {
  const label = group.name.toLowerCase();

  if (group.minSelection === 0 && group.maxSelection === 0) {
    return null;
  }

  if (group.minSelection === 1 && group.maxSelection === 1) {
    return "Choose 1 option";
  }

  if (group.minSelection === 1 && group.maxSelection > 1) {
    return `Choose 1 to ${group.maxSelection} ${label}`;
  }

  if (group.minSelection === 0 && group.maxSelection > 0) {
    return `Choose up to ${group.maxSelection} ${label}`;
  }

  if (group.minSelection > 1 && group.maxSelection > 0) {
    return `Choose ${group.minSelection} to ${group.maxSelection} ${label}`;
  }

  if (group.minSelection > 0) {
    return `Choose at least ${group.minSelection} ${label}`;
  }

  return null;
}

export default function ModifierGroup({
  group,
  selectedModifierIds,
  outOfStockIds,
  outOfStockModifierMasters,
  onToggleModifier,
}: {
  group: MenuTreeNode;
  selectedModifierIds: string[];
  outOfStockIds?: Set<string>;
  outOfStockModifierMasters?: Set<string>;
  onToggleModifier: (group: MenuTreeNode, modifier: MenuTreeNode) => void;
}) {
  const isSingle = group.selectionType === "single";
  const maxReached = group.maxSelection > 0 && selectedModifierIds.length >= group.maxSelection;
  const instruction = getSelectionInstruction(group);
  const groupOOS = outOfStockIds?.has(group.id) ?? false;

  return (
    <section className={`border-t border-slate-200 pt-4 ${groupOOS ? "opacity-50" : ""}`}>
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-base font-black text-slate-900">{group.name}</h3>
            {groupOOS && (
              <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-bold uppercase text-rose-600">Out of Stock</span>
            )}
          </div>
          {instruction ? <p className="mt-1 text-sm text-slate-500">{instruction}</p> : null}
        </div>
      </div>

      <div className="space-y-2">
        {group.children
          .filter((child) => child.type === "modifier")
          .map((modifier) => {
            const selected = selectedModifierIds.includes(modifier.id);
            const modifierNodeOOS = outOfStockIds?.has(modifier.id) ?? false;
            const modifierMasterOOS = Boolean(modifier.modifierMasterId && outOfStockModifierMasters?.has(modifier.modifierMasterId));
            const modifierOOS = modifierNodeOOS || modifierMasterOOS;
            const disabled = groupOOS || modifierOOS || (!selected && !isSingle && maxReached);

            return (
              <label
                key={modifier.id}
                className={`flex items-center justify-between gap-3 rounded-2xl border px-4 py-3 ${
                  selected && !modifierOOS ? "border-orange-400 bg-orange-50" : "border-slate-200 bg-white"
                } ${disabled ? "cursor-not-allowed opacity-50" : ""}`}
              >
                <div className="flex items-center gap-3">
                  <input
                    type={isSingle ? "radio" : "checkbox"}
                    checked={selected}
                    disabled={disabled}
                    onChange={() => onToggleModifier(group, modifier)}
                    name={`modifier-group-${group.id}`}
                    className="h-4 w-4"
                  />
                  <span className="text-sm font-semibold text-slate-800">{formatModifierLabel(modifier)}</span>
                  {modifierOOS && (
                    <span className="rounded-full bg-rose-100 px-1.5 py-0.5 text-[9px] font-bold uppercase text-rose-600">OOS</span>
                  )}
                </div>
                <span className="text-sm font-bold text-slate-700">
                  {modifier.price === 0 ? "Included" : `${modifier.price > 0 ? "+" : "-"}₹${Math.abs(modifier.price)}`}
                </span>
              </label>
            );
          })}
      </div>
    </section>
  );
}
