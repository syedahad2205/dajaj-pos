/**
 * AddExpenseModal — row-based form, web-parity UX.
 *
 * Tapping Category/Subcategory opens a small floating dropdown anchored
 * right below the button (measureInWindow → absolute position inside the
 * Modal overlay). Dialog never expands, never shifts.
 */
import React, { useRef, useMemo, useState } from 'react';
import {
  Keyboard,
  Modal as RNModal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Button } from '@/core/ui/components/Button';
import { useExpenseCategories } from '@/modules/daily-closing/hooks/useExpenseCategories';
import { useExpenseSubcategories } from '@/modules/daily-closing/hooks/useExpenseSubcategories';
import type { FinanceExpenseCategory, FinanceExpenseSubcategory } from '@/modules/daily-closing/types';
import { colors, radius } from '@/core/ui/theme/colors';

// ─── Public types ──────────────────────────────────────────────────────────────

export interface AddExpenseRow {
  categoryId: string;
  amount: number;
  remarks?: string;
  subcategoryId?: string | null;
  subcategoryName?: string | null;
}

interface Props {
  visible: boolean;
  onClose: () => void;
  onSave: (rows: AddExpenseRow[]) => void;
  isSaving: boolean;
  saveError?: string | null;
}

// ─── Internal types ────────────────────────────────────────────────────────────

interface DraftLine {
  key: string;
  categoryId: string;
  subcategoryId: string;
  amount: string;
  remarks: string;
}

interface DropdownState {
  lineKey: string;
  field: 'category' | 'subcategory';
  top: number;
  left: number;
  width: number;
}

let lineCounter = 0;
function makeKey() { lineCounter += 1; return `line-${lineCounter}`; }
function blankLine(): DraftLine {
  return { key: makeKey(), categoryId: '', subcategoryId: '', amount: '', remarks: '' };
}

// ─── Dropdown button ───────────────────────────────────────────────────────────

interface DropdownBtnProps {
  label: string;
  placeholder?: boolean;
  onOpen: (top: number, left: number, width: number) => void;
}

function DropdownBtn({ label, placeholder, onOpen }: DropdownBtnProps) {
  const ref = useRef<View>(null);
  return (
    <TouchableOpacity
      ref={ref}
      style={[styles.pickerBtn, !placeholder && styles.pickerBtnFilled]}
      onPress={() => {
        ref.current?.measureInWindow((x, y, w, h) => {
          onOpen(y + h + 4, x, w);
        });
      }}
      activeOpacity={0.75}
    >
      <Text
        style={[styles.pickerBtnText, placeholder && styles.pickerBtnPlaceholder]}
        numberOfLines={1}
      >
        {label} ▾
      </Text>
    </TouchableOpacity>
  );
}

// ─── Component ─────────────────────────────────────────────────────────────────

export function AddExpenseModal({ visible, onClose, onSave, isSaving, saveError }: Props) {
  const { data: categories = [] } = useExpenseCategories();
  const { data: subcategories = [] } = useExpenseSubcategories();
  const cats = categories as FinanceExpenseCategory[];

  const [lines, setLines] = useState<DraftLine[]>([blankLine()]);
  const [dropdown, setDropdown] = useState<DropdownState | null>(null);

  // ── Derived ─────────────────────────────────────────────────────────────────

  const subcategoriesByCategory = useMemo(() => {
    const map = new Map<string, FinanceExpenseSubcategory[]>();
    for (const s of subcategories) {
      const list = map.get(s.categoryId) ?? [];
      list.push(s);
      map.set(s.categoryId, list);
    }
    return map;
  }, [subcategories]);

  const validLines = lines.filter(l => {
    const n = parseFloat(l.amount);
    return l.categoryId && Number.isFinite(n) && n > 0;
  });
  const canSave = validLines.length > 0 && !isSaving;

  // ── Helpers ─────────────────────────────────────────────────────────────────

  function reset() { setLines([blankLine()]); setDropdown(null); }
  function close() { Keyboard.dismiss(); reset(); onClose(); }

  function updateLine(key: string, patch: Partial<DraftLine>) {
    setLines(prev => prev.map(l => l.key === key ? { ...l, ...patch } : l));
  }

  function removeLine(key: string) {
    setLines(prev => { const n = prev.filter(l => l.key !== key); return n.length ? n : [blankLine()]; });
    if (dropdown?.lineKey === key) setDropdown(null);
  }

  function openDropdown(lineKey: string, field: 'category' | 'subcategory', top: number, left: number, width: number) {
    Keyboard.dismiss();
    setDropdown({ lineKey, field, top, left, width });
  }

  function selectItem(id: string) {
    if (!dropdown) return;
    const { lineKey, field } = dropdown;
    if (field === 'category') {
      updateLine(lineKey, { categoryId: id, subcategoryId: '' });
      const subs = subcategoriesByCategory.get(id) ?? [];
      setDropdown(null);
      // If category has subs, let user tap Subcategory ▾ themselves — no auto-advance
    } else {
      const line = lines.find(l => l.key === lineKey);
      updateLine(lineKey, { subcategoryId: line?.subcategoryId === id ? '' : id });
      setDropdown(null);
    }
  }

  function handleSave() {
    Keyboard.dismiss();
    onSave(validLines.map(l => {
      const subs = subcategoriesByCategory.get(l.categoryId) ?? [];
      const sub = l.subcategoryId ? subs.find(s => s.id === l.subcategoryId) : undefined;
      return {
        categoryId: l.categoryId,
        amount: parseFloat(l.amount),
        remarks: l.remarks || undefined,
        subcategoryId: sub?.id ?? null,
        subcategoryName: sub?.name ?? null,
      };
    }));
  }

  // ── Dropdown items ───────────────────────────────────────────────────────────

  const dropdownLine = dropdown ? lines.find(l => l.key === dropdown.lineKey) : null;
  const dropdownItems =
    dropdown?.field === 'category'
      ? cats.map(c => ({ id: c.id, label: c.name }))
      : (subcategoriesByCategory.get(dropdownLine?.categoryId ?? '') ?? []).map(s => ({ id: s.id, label: s.name }));
  const selectedId =
    dropdown?.field === 'category' ? dropdownLine?.categoryId : dropdownLine?.subcategoryId;

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <RNModal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={close}
      onShow={() => Keyboard.dismiss()}
    >
      {/* Tap outside dropdown to close it */}
      <TouchableOpacity
        style={styles.overlay}
        activeOpacity={1}
        onPress={() => dropdown ? setDropdown(null) : close()}
      >
        {/* Dialog — stop propagation so taps inside don't close */}
        <View style={styles.dialog} onStartShouldSetResponder={() => true}>

          {/* Header */}
          <View style={styles.header}>
            <View style={{ flex: 1, marginRight: 12 }}>
              <Text style={styles.title}>Add Cash Expenses</Text>
              <Text style={styles.subtitle}>Add as many lines as you need, then save.</Text>
            </View>
            <TouchableOpacity onPress={close} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Text style={styles.closeIcon}>✕</Text>
            </TouchableOpacity>
          </View>

          {/* Expense lines */}
          <ScrollView
            style={styles.linesScroll}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {lines.map((line, idx) => {
              const cat = cats.find(c => c.id === line.categoryId);
              const lineSubs = subcategoriesByCategory.get(line.categoryId) ?? [];
              const sub = line.subcategoryId ? lineSubs.find(s => s.id === line.subcategoryId) : null;

              return (
                <View key={line.key} style={styles.lineCard}>
                  <View style={styles.lineHeader}>
                    <Text style={styles.lineNum}>Line {idx + 1}</Text>
                    {lines.length > 1 && (
                      <TouchableOpacity onPress={() => removeLine(line.key)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                        <Text style={styles.lineDelete}>✕</Text>
                      </TouchableOpacity>
                    )}
                  </View>

                  <View style={styles.pickerRow}>
                    <DropdownBtn
                      label={cat ? cat.name : 'Category'}
                      placeholder={!cat}
                      onOpen={(top, left, width) => openDropdown(line.key, 'category', top, left, width)}
                    />
                    {lineSubs.length > 0 && (
                      <DropdownBtn
                        label={sub ? sub.name : 'Subcategory'}
                        placeholder={!sub}
                        onOpen={(top, left, width) => openDropdown(line.key, 'subcategory', top, left, width)}
                      />
                    )}
                  </View>

                  <View style={styles.inputRow}>
                    <View style={styles.amountBox}>
                      <Text style={styles.rupee}>₹</Text>
                      <TextInput
                        style={styles.amountInput}
                        value={line.amount}
                        onChangeText={v => updateLine(line.key, { amount: v })}
                        keyboardType="decimal-pad"
                        placeholder="0"
                        placeholderTextColor={colors.slate400}
                        selectTextOnFocus
                        returnKeyType="done"
                        onFocus={() => setDropdown(null)}
                      />
                    </View>
                    <TextInput
                      style={styles.remarksInput}
                      value={line.remarks}
                      onChangeText={v => updateLine(line.key, { remarks: v })}
                      placeholder="Remarks (optional)"
                      placeholderTextColor={colors.slate400}
                      returnKeyType="done"
                      onFocus={() => setDropdown(null)}
                    />
                  </View>
                </View>
              );
            })}

            <TouchableOpacity
              style={styles.addLineBtn}
              onPress={() => setLines(prev => [...prev, blankLine()])}
              activeOpacity={0.7}
            >
              <Text style={styles.addLineBtnText}>+ Add another line</Text>
            </TouchableOpacity>
          </ScrollView>

          {saveError ? <Text style={styles.error}>{saveError}</Text> : null}

          <View style={styles.footer}>
            <TouchableOpacity style={styles.cancelBtn} onPress={close} activeOpacity={0.7}>
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>
            <View style={styles.saveBtnWrap}>
              <Button
                title={validLines.length > 0 ? `Save Expense${validLines.length !== 1 ? 's' : ''} (${validLines.length})` : 'Save Expense(s)'}
                onPress={handleSave}
                disabled={!canSave}
                loading={isSaving}
                testID="save-expense-button"
              />
            </View>
          </View>
        </View>

        {/* Floating dropdown — positioned absolutely at button coordinates */}
        {dropdown && (
          <View
            style={[styles.dropdown, { top: dropdown.top, left: dropdown.left, minWidth: Math.max(dropdown.width, 160) }]}
            onStartShouldSetResponder={() => true}
          >
            <ScrollView
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              style={{ maxHeight: 220 }}
            >
              {dropdownItems.map(item => {
                const selected = selectedId === item.id;
                return (
                  <TouchableOpacity
                    key={item.id}
                    style={[styles.dropdownItem, selected && styles.dropdownItemSelected]}
                    onPress={() => selectItem(item.id)}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.dropdownItemText, selected && styles.dropdownItemTextSelected]}>
                      {selected ? '✓ ' : ''}{item.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        )}
      </TouchableOpacity>
    </RNModal>
  );
}

// ─── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'flex-start',
    paddingTop: 52,
    paddingHorizontal: 16,
  },
  dialog: {
    backgroundColor: colors.white,
    borderRadius: 20,
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 16,
  },

  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 },
  title: { fontSize: 17, fontWeight: '700', color: colors.slate900, marginBottom: 2 },
  subtitle: { fontSize: 13, color: colors.slate500 },
  closeIcon: { fontSize: 18, color: colors.slate400, marginTop: 2 },

  linesScroll: { maxHeight: 400 },

  lineCard: {
    borderWidth: 1, borderColor: colors.slate200,
    borderRadius: 10, padding: 12, marginBottom: 10,
    backgroundColor: colors.slate50,
  },
  lineHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  lineNum: { fontSize: 10, fontWeight: '700', color: colors.slate400, textTransform: 'uppercase', letterSpacing: 1 },
  lineDelete: { fontSize: 14, color: colors.slate400 },

  pickerRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  pickerBtn: {
    paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: radius.full,
    backgroundColor: colors.white,
    borderWidth: 1.5, borderColor: colors.slate200,
  },
  pickerBtnFilled: { backgroundColor: colors.slateBtnBg, borderColor: colors.slateBtnBg },
  pickerBtnText: { fontSize: 13, fontWeight: '600', color: '#fff' },
  pickerBtnPlaceholder: { color: colors.slate500 },

  inputRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  amountBox: {
    flexDirection: 'row', alignItems: 'center',
    borderWidth: 1.5, borderColor: colors.slate200,
    borderRadius: radius.sm, backgroundColor: colors.white,
    paddingHorizontal: 10, width: 100,
  },
  rupee: { fontSize: 15, color: colors.slate500, marginRight: 2 },
  amountInput: { flex: 1, fontSize: 16, fontWeight: '700', color: colors.slate900, paddingVertical: 8, fontVariant: ['tabular-nums'] },
  remarksInput: {
    flex: 1, borderWidth: 1, borderColor: colors.slate200,
    borderRadius: radius.sm, backgroundColor: colors.white,
    paddingHorizontal: 10, paddingVertical: 8, fontSize: 13, color: colors.slate900,
  },

  addLineBtn: {
    paddingVertical: 11, borderRadius: 10,
    borderWidth: 1, borderColor: colors.slate200,
    borderStyle: 'dashed', alignItems: 'center', marginBottom: 4,
  },
  addLineBtnText: { fontSize: 14, fontWeight: '600', color: colors.slate500 },

  error: { color: colors.rose600, fontSize: 13, marginTop: 8 },

  footer: { flexDirection: 'row', gap: 10, marginTop: 14, alignItems: 'center' },
  cancelBtn: { flex: 1, paddingVertical: 12, borderRadius: radius.sm, borderWidth: 1.5, borderColor: colors.slate200, alignItems: 'center' },
  cancelBtnText: { fontSize: 14, fontWeight: '600', color: colors.slate700 },
  saveBtnWrap: { flex: 2 },

  // Floating dropdown
  dropdown: {
    position: 'absolute',
    backgroundColor: colors.white,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.slate200,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 12,
    zIndex: 999,
    overflow: 'hidden',
  },
  dropdownItem: {
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.slate100,
  },
  dropdownItemSelected: { backgroundColor: colors.slate50 },
  dropdownItemText: { fontSize: 14, color: colors.slate700, fontWeight: '500' },
  dropdownItemTextSelected: { color: colors.slateBtnBg, fontWeight: '700' },
});
