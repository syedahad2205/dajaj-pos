/**
 * AddExpenseModal — bulk expense entry (mirrors web admin "Add Cash Expenses").
 *
 * Shows a table-like list of rows (Category · Subcategory · Amount · Remarks),
 * lets the manager add several lines at once, with a subcategory picker shown
 * only when the chosen category actually has subcategories. "Save" submits
 * every valid row together via onSave.
 */
import React, { useMemo, useState } from 'react';
import { View, Text, TextInput, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { Modal } from '@/core/ui/components/Modal';
import { Button } from '@/core/ui/components/Button';
import { useExpenseCategories } from '@/modules/daily-closing/hooks/useExpenseCategories';
import type { FinanceExpenseCategory, FinanceExpenseSubcategory } from '@/modules/daily-closing/types';

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
  subcategories: FinanceExpenseSubcategory[];
}

let rowCounter = 0;
function newRow(): { key: string; categoryId: string; subcategoryId: string; amount: string; remarks: string } {
  rowCounter += 1;
  return { key: `row-${rowCounter}`, categoryId: '', subcategoryId: '', amount: '', remarks: '' };
}

export function AddExpenseModal({ visible, onClose, onSave, isSaving, saveError, subcategories }: Props) {
  const { data: categories = [] } = useExpenseCategories();
  const [rows, setRows] = useState<Array<{ key: string; categoryId: string; subcategoryId: string; amount: string; remarks: string }>>([newRow()]);

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

  function updateRow(key: string, patch: Partial<{ categoryId: string; subcategoryId: string; amount: string; remarks: string }>) {
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
      <View style={styles.form}>
        <Text style={styles.hint}>Add as many lines as you need, then save them all at once.</Text>

        <View style={styles.headerRow}>
          <Text style={[styles.colHeader, { flex: 1.4 }]}>Category</Text>
          <Text style={[styles.colHeader, { flex: 1.2 }]}>Subcategory</Text>
          <Text style={[styles.colHeader, { flex: 0.9 }]}>Amount</Text>
          <Text style={[styles.colHeader, { flex: 1.4 }]}>Remarks</Text>
          <Text style={styles.colHeader} />
        </View>

        <ScrollView style={styles.rowsScroll}>
          {rows.map((row) => {
            const subs = subcategoriesByCategory.get(row.categoryId) ?? [];
            return (
              <View key={row.key} style={styles.row}>
                <View style={[styles.cell, { flex: 1.4 }]}>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chips}>
                    {categories.map((cat: FinanceExpenseCategory) => (
                      <TouchableOpacity
                        key={cat.id}
                        style={[styles.chip, row.categoryId === cat.id && styles.chipSelected]}
                        onPress={() => updateRow(row.key, { categoryId: cat.id, subcategoryId: '' })}
                      >
                        <Text style={[styles.chipText, row.categoryId === cat.id && styles.chipTextSelected]}>{cat.name}</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </View>

                <View style={[styles.cell, { flex: 1.2 }]}>
                  {!row.categoryId ? (
                    <Text style={styles.placeholderText}>—</Text>
                  ) : subs.length === 0 ? (
                    <Text style={styles.placeholderText}>None</Text>
                  ) : (
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chips}>
                      {subs.map((s) => (
                        <TouchableOpacity
                          key={s.id}
                          style={[styles.chip, row.subcategoryId === s.id && styles.chipSelected]}
                          onPress={() => updateRow(row.key, { subcategoryId: s.id })}
                        >
                          <Text style={[styles.chipText, row.subcategoryId === s.id && styles.chipTextSelected]}>{s.name}</Text>
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                  )}
                </View>

                <View style={[styles.cell, { flex: 0.9 }]}>
                  <TextInput
                    style={styles.input}
                    value={row.amount}
                    onChangeText={(t) => updateRow(row.key, { amount: t })}
                    keyboardType="decimal-pad"
                    placeholder="0"
                  />
                </View>

                <View style={[styles.cell, { flex: 1.4 }]}>
                  <TextInput
                    style={styles.input}
                    value={row.remarks}
                    onChangeText={(t) => updateRow(row.key, { remarks: t })}
                    placeholder="Optional"
                  />
                </View>

                <TouchableOpacity
                  style={[styles.removeBtn, rows.length === 1 && styles.removeBtnDisabled]}
                  onPress={() => removeRow(row.key)}
                  disabled={rows.length === 1}
                  hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                >
                  <Text style={styles.removeBtnText}>✕</Text>
                </TouchableOpacity>
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
  hint: { fontSize: 12, color: '#666', marginBottom: 12 },
  headerRow: { flexDirection: 'row', paddingHorizontal: 2, marginBottom: 6 },
  colHeader: { fontSize: 10, fontWeight: '700', color: '#999', textTransform: 'uppercase', letterSpacing: 0.5 },
  rowsScroll: { maxHeight: 360 },
  row: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#eee' },
  cell: { marginRight: 6 },
  chips: { maxHeight: 34 },
  chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, backgroundColor: '#f1f3f4', marginRight: 6 },
  chipSelected: { backgroundColor: '#1a73e8' },
  chipText: { color: '#333', fontSize: 12 },
  chipTextSelected: { color: '#fff', fontWeight: '600' },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 8, fontSize: 14 },
  placeholderText: { fontSize: 12, color: '#bbb', paddingVertical: 6 },
  removeBtn: { paddingHorizontal: 6, paddingVertical: 8 },
  removeBtnDisabled: { opacity: 0.3 },
  removeBtnText: { color: '#c62828', fontSize: 16 },
  addRowBtn: { marginTop: 10, paddingVertical: 10, borderRadius: 8, borderWidth: 1, borderColor: '#ccc', borderStyle: 'dashed', alignItems: 'center' },
  addRowBtnText: { color: '#555', fontWeight: '600', fontSize: 13 },
  error: { color: '#c62828', marginBottom: 12, marginTop: 10, fontSize: 13 },
  saveBtn: { marginTop: 12 },
});
