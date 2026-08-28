'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { requireAdmin } from '@/lib/roleGuard';
import {
  getAllSwiggyItemCategories,
  upsertSwiggyItemCategory,
  COOL_CORNER_CATEGORY,
  type SwiggyItemCategory,
} from '@/services/swiggyCategoryMapService';

const SOURCE_LABEL: Record<string, string> = {
  seed: 'Cool Corner (seeded)',
  manual: 'Manually mapped',
  zomato_bootstrap: 'From Zomato history',
  unmapped: 'Not mapped yet',
};

function EditRow({ item, onSaved }: { item: SwiggyItemCategory; onSaved: (updated: SwiggyItemCategory) => void }) {
  const [editing, setEditing] = useState(false);
  const [category, setCategory] = useState(item.category);
  const [subCategory, setSubCategory] = useState(item.subCategory);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await upsertSwiggyItemCategory(item.itemName, category, subCategory);
      onSaved({ ...item, category, subCategory, source: 'manual' });
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  if (!editing) {
    return (
      <tr className={`hover:bg-neutral-50 ${item.category === 'Uncategorized' ? 'bg-amber-50/50' : ''}`}>
        <td className="px-4 py-2.5 font-medium text-neutral-900 max-w-[180px] truncate">{item.itemName}</td>
        <td className="px-4 py-2.5">
          <span className={item.category === 'Uncategorized' ? 'text-amber-700 font-semibold' : 'text-neutral-700'}>
            {item.category}
          </span>
        </td>
        <td className="px-4 py-2.5 text-neutral-500">{item.subCategory || '—'}</td>
        <td className="px-4 py-2.5 text-xs text-neutral-400">{SOURCE_LABEL[item.source] ?? item.source}</td>
        <td className="px-4 py-2.5 text-right">
          <button onClick={() => setEditing(true)} className="text-xs font-semibold text-orange-600 hover:text-orange-700">
            Edit
          </button>
        </td>
      </tr>
    );
  }

  return (
    <tr className="bg-orange-50/50">
      <td className="px-4 py-2.5 font-medium text-neutral-900 max-w-[180px] truncate">{item.itemName}</td>
      <td className="px-4 py-2.5">
        <input
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          placeholder="e.g. Cool Corner"
          className="w-full px-2 py-1 border border-neutral-300 rounded text-sm"
        />
      </td>
      <td className="px-4 py-2.5">
        <input
          value={subCategory}
          onChange={(e) => setSubCategory(e.target.value)}
          placeholder="optional"
          className="w-full px-2 py-1 border border-neutral-300 rounded text-sm"
        />
      </td>
      <td colSpan={1} />
      <td className="px-4 py-2.5 text-right whitespace-nowrap">
        <button onClick={save} disabled={saving || !category.trim()} className="text-xs font-semibold text-emerald-600 hover:text-emerald-700 disabled:opacity-40 mr-3">
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button onClick={() => setEditing(false)} className="text-xs font-semibold text-neutral-400 hover:text-neutral-600">
          Cancel
        </button>
      </td>
    </tr>
  );
}

export default function SwiggyCategoriesPage() {
  const router = useRouter();
  const { authenticated, loading: authLoading, role } = requireAdmin();

  const [items, setItems] = useState<SwiggyItemCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [showUnmatchedOnly, setShowUnmatchedOnly] = useState(false);

  useEffect(() => {
    if (!authenticated) return;
    getAllSwiggyItemCategories()
      .then(setItems)
      .catch((e) => setError(e?.message ?? String(e)))
      .finally(() => setLoading(false));
  }, [authenticated]);

  const filtered = useMemo(() => {
    let rows = items;
    if (showUnmatchedOnly) rows = rows.filter((i) => i.category === 'Uncategorized');
    if (filter) rows = rows.filter((i) => i.itemName.toLowerCase().includes(filter.toLowerCase()) || i.category.toLowerCase().includes(filter.toLowerCase()));
    return rows;
  }, [items, filter, showUnmatchedOnly]);

  const unmatchedCount = items.filter((i) => i.category === 'Uncategorized').length;
  const coolCornerCount = items.filter((i) => i.category === COOL_CORNER_CATEGORY).length;

  if (authLoading) {
    return <main className="min-h-screen bg-neutral-50 px-4 py-10 text-sm text-neutral-400">Checking session…</main>;
  }
  if (!authenticated || role !== 'admin') return null;

  return (
    <div className="min-h-screen bg-neutral-50 flex flex-col">
      <header className="flex-shrink-0 bg-white border-b border-neutral-200 px-4 py-3 flex items-center gap-3">
        <button onClick={() => router.back()} className="p-1.5 rounded hover:bg-neutral-100 text-neutral-500">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
          </svg>
        </button>
        <h1 className="font-bold text-lg text-neutral-900">Item → Category Map</h1>
      </header>

      <div className="flex-1 overflow-y-auto p-4 max-w-3xl mx-auto w-full space-y-4">
        <div className="rounded-xl bg-white border border-neutral-200 p-4 text-sm text-neutral-600">
          <p>
            Swiggy&apos;s Past Orders report never tells you an item&apos;s category, so this list is what every import
            is matched against. It only grows as new items appear on an import — items you&apos;ve never sold on Swiggy
            (or Zomato) yet won&apos;t show up here until they do.
          </p>
          <p className="mt-2 text-xs text-neutral-400">
            {coolCornerCount} item{coolCornerCount === 1 ? '' : 's'} mapped to Cool Corner
            {unmatchedCount > 0 ? ` · ${unmatchedCount} still Uncategorized` : ' · nothing Uncategorized right now'}
          </p>
        </div>

        {error && <div className="rounded-xl bg-red-50 border border-red-200 p-4 text-sm text-red-700">{error}</div>}

        <div className="flex gap-2 flex-wrap items-center">
          <input
            type="text"
            placeholder="Search item or category…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="flex-1 min-w-[160px] px-3 py-2 border border-neutral-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
          />
          <button
            onClick={() => setShowUnmatchedOnly((s) => !s)}
            className={`px-3 py-2 rounded-lg text-sm font-semibold transition-colors ${
              showUnmatchedOnly ? 'bg-amber-100 text-amber-800 border border-amber-300' : 'bg-neutral-100 text-neutral-600 border border-neutral-200 hover:bg-neutral-200'
            }`}
          >
            Uncategorized only{unmatchedCount > 0 ? ` (${unmatchedCount})` : ''}
          </button>
        </div>

        {loading ? (
          <div className="flex justify-center py-8">
            <div className="w-8 h-8 border-4 border-neutral-200 border-t-orange-500 rounded-full animate-spin" />
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-neutral-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[560px]">
                <thead className="bg-neutral-50">
                  <tr>
                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-neutral-500">Item</th>
                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-neutral-500">Category</th>
                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-neutral-500">Sub-Category</th>
                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-neutral-500">Source</th>
                    <th className="px-4 py-2.5" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {filtered.map((item) => (
                    <EditRow
                      key={item.id}
                      item={item}
                      onSaved={(updated) => setItems((prev) => prev.map((i) => (i.id === updated.id ? updated : i)))}
                    />
                  ))}
                  {filtered.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-sm text-neutral-400">
                        {items.length === 0 ? 'No items yet — import a Past Orders CSV first.' : 'No items match the current filter.'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
