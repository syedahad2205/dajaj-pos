/**
 * AddExpenseModal — bulk expense entry (mirrors web admin "Add Cash Expenses").
 *
 * One card per line, stacked vertically for fast thumb entry on a phone:
 *   Category chips → Subcategory chips (only when they exist) → Amount + Remarks.
 * "Add another line" appends a fresh card; Save submits every valid row at once.
 */
import React, { useMemo, useState } from 'react';
import { View, Text, TextInput, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { Modal } from '@/core/ui/components/Modal';
import { Button } from '@/core/ui/components/Button';
import { KeyboardDoneBar } from '@/core/ui/components/KeyboardDoneBar';
import { useExpenseCategories } from '@/modules/daily-closing/hooks/useExpenseCategories';
import type { FinanceExpenseCategory, FinanceExpenseSubcategory } from '@/modules/daily-closing/types';
import { colors, radius } from '@/core/ui/theme/colors';

export interface AddExpenseRow {
  categoryId: string;
  amount: number;
  remarks?: string;
  subcategoryId?: string | null;
  subcategoryName?: string | null;
}

interface RowState {
  key: string;
  categoryId: string;
  subcategoryId: string;
  amount: string;
  remarks: string;
}

interface Props {
  visible: boolean;
  onClose: () => void;
  onSave: (rows: AddExpenseRow[]) => void;
  isSaving: boolean;
  saveError?: string | null;
  subcategories: FinanceExpenseSubcategory[];
}

let rowCounter = 0;
function newRow(): RowState {
  rowCounter += 1;
  return { key: `row-${rowCounter}`, categoryId: '', subcategoryId: '', amount: '', remarks: '' };
}

export function AddExpenseModal({ visible, onClose, onSave, isSaving, saveError, subcategories }: Props) {
  const { data: categories = [] } = useExpenseCategories();
  const [rows, setRows] = useState<RowState[]>([newRow()]);

  const subcategoriesByCategory = useMemo(() => {
    const map = new Map<string, FinanceExpenseSubcategory[]>();
    for (const s of subcategories) {
      const list = map.get(s.categoryId) ?? [];
      list.push(s);
      map.set(s.categoryId, list);
    }
    return map;
  }, [subcategories]);

  function close() {
    setRows([newRow()]);
    onClose();
  }

  function updateRow(key: string, patch: Partial<RowState>) {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  function addRow() {
    setRows((prev) => [...prev, newRow()]);
  }

  function removeRow(key: string) {
    setRows((prev) => (prev.length > 1 ? prev.filter((r) => r.key !== key) : prev));
  }

  const validCount = rows.filter((r) => r.categoryId && Number.isFinite(parseFloat(r.amount)) && parseFloat(r.amount) > 0).length;
  const canSave = validCount > 0 && !isSaving;

  function handleSave() {
    const valid = rows
      .map((r) => ({ ...r, amountNum: parseFloat(r.amount) }))
      .filter((r) => r.categoryId && Number.isFinite(r.amountNum) && r.amountNum > 0);
    const payload: AddExpenseRow[] = valid.map((r) => {
      const subs = subcategoriesByCategory.get(r.categoryId) ?? [];
      const chosen = r.subcategoryId ? subs.find((s) => s.id === r.subcategoryId) : undefined;
      return {
        categoryId: r.categoryId,
        amount: r.amountNum,
        remarks: r.remarks || undefined,
        subcategoryId: chosen ? chosen.id : null,
        subcategoryName: chosen ? chosen.name : null,
      };
    });
    onSave(payload);
  }

  return (
    <Modal visible={visible} title="Add Cash Expenses" onClose={close}>
      <KeyboardDoneBar nativeID="add-expense-modal-kb" />
      <View style={styles.form}>
        <Text style={styles.hint}>Add as many lines as you need, then save them all at once.</Text>

        <ScrollView style={styles.rowsScroll} keyboardShouldPersistTaps="handled">
          {rows.map((row, index) => {
            const subs = subcategoriesByCategory.get(row.categoryId) ?? [];
            return (
              <View key={row.key} style={styles.rowCard}>
                <View style={styles.rowHeader}>
                  <Text style={styles.rowTitle}>Line {index + 1}</Text>
                  <TouchableOpacity
                    style={[styles.removeBtn, rows.length === 1 && styles.removeBtnDisabled]}
                    onPress={() => removeRow(row.key)}
                    disabled={rows.length === 1}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Text style={styles.removeBtnText}>✕</Text>
                  </TouchableOpacity>
                </View>

                <Text style={styles.fieldLabel}>Category</Text>
                <View style={styles.chipsWrap}>
                  {categories.map((cat: FinanceExpenseCategory) => (
                    <TouchableOpacity
                      key={cat.id}
                      style={[styles.chip, row.categoryId === cat.id && styles.chipSelected]}
                      onPress={() => updateRow(row.key, { categoryId: cat.id, subcategoryId: '' })}
                    >
                      <Text style={[styles.chipText, row.categoryId === cat.id && styles.chipTextSelected]}>{cat.name}</Text>
                    </TouchableOpacity>
                  ))}
                </View>

                {row.categoryId !== '' && subs.length > 0 && (
                  <>
                    <Text style={styles.fieldLabel}>Subcategory</Text>
                    <View style={styles.chipsWrap}>
                      {subs.map((s) => (
                        <TouchableOpacity
                          key={s.id}
                          style={[styles.chip, row.subcategoryId === s.id && styles.chipSelected]}
                          onPress={() => updateRow(row.key, { subcategoryId: s.id })}
                        >
                          <Text style={[styles.chipText, row.subcategoryId === s.id && styles.chipTextSelected]}>{s.name}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </>
                )}

                <View style={styles.inputsRow}>
                  <View style={styles.amountWrap}>
                    <Text style={styles.fieldLabel}>Amount ₹</Text>
                    <TextInput
                      style={styles.amountInput}
                      value={row.amount}
                      onChangeText={(t) => updateRow(row.key, { amount: t })}
                      keyboardType="decimal-pad"
                      placeholder="0"
                      placeholderTextColor={colors.slate400}
                      inputAccessoryViewID="add-expense-modal-kb"
                    />
                  </View>
                  <View style={styles.remarksWrap}>
                    <Text style={styles.fieldLabel}>Remarks</Text>
                    <TextInput
                      style={styles.remarksInput}
                      value={row.remarks}
                      onChangeText={(t) => updateRow(row.key, { remarks: t })}
                      placeholder="Optional"
                      placeholderTextColor={colors.slate400}
                      inputAccessoryViewID="add-expense-modal-kb"
                    />
                  </View>
                </View>
              </View>
            );
          })}
        </ScrollView>

        <TouchableOpacity style={styles.addRowBtn} onPress={addRow} activeOpacity={0.8}>
          <Text style={styles.addRowBtnText}>+ Add another line</Text>
        </TouchableOpacity>

        {saveError && <Text style={styles.error}>{saveError}</Text>}

        <Button
          title={`Save ${validCount > 0 ? validCount : ''} Expense(s)`.trim()}
          onPress={handleSave}
          disabled={!canSave}
          loading={isSaving}
          testID="save-expense-button"
          style={styles.saveBtn}
        />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  form: { paddingBottom: 20 },
  hint: { fontSize: 12, color: colors.slate500, marginBottom: 12 },
  rowsScroll: { maxHeight: 380 },
  rowCard: {
    backgroundColor: colors.slate50,
    borderRadius: radius.inner,
    borderWidth: 1,
    borderColor: colors.slate200,
    padding: 14,
    marginBottom: 12,
  },
  rowHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  rowTitle: { fontSize: 12, fontWeight: '700', color: colors.slate500, textTransform: 'uppercase', letterSpacing: 1 },
  removeBtn: { paddingHorizontal: 6, paddingVertical: 4 },
  removeBtnDisabled: { opacity: 0.3 },
  removeBtnText: { color: colors.rose600, fontSize: 16 },
  fieldLabel: { fontSize: 11, fontWeight: '600', color: colors.slate500, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 },
  chipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 10 },
  chip: { paddingHorizontal: 13, paddingVertical: 8, borderRadius: radius.full, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.slate200 },
  chipSelected: { backgroundColor: colors.slateBtnBg, borderColor: colors.slateBtnBg },
  chipText: { color: colors.slate700, fontSize: 13, fontWeight: '600' },
  chipTextSelected: { color: '#fff' },
  inputsRow: { flexDirection: 'row', gap: 10 },
  amountWrap: { width: 120 },
  remarksWrap: { flex: 1 },
  amountInput: {
    backgroundColor: colors.white, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.slate200,
    paddingHorizontal: 12, paddingVertical: 9, fontSize: 16, fontWeight: '700', color: colors.slate900,
    fontVariant: ['tabular-nums'],
  },
  remarksInput: {
    backgroundColor: colors.white, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.slate200,
    paddingHorizontal: 12, paddingVertical: 9, fontSize: 14, color: colors.slate900,
  },
  addRowBtn: {
    marginTop: 2, paddingVertical: 11, borderRadius: radius.inner, borderWidth: 1.5,
    borderColor: colors.slate200, borderStyle: 'dashed', alignItems: 'center',
  },
  addRowBtnText: { color: colors.slate600, fontWeight: '700', fontSize: 13 },
  error: { color: colors.rose600, marginTop: 10, fontSize: 13 },
  saveBtn: { marginTop: 12 },
});
