import React, { useState } from 'react';
import { View, Text, TouchableOpacity, Alert, StyleSheet } from 'react-native';
import type { FinanceDailyClosing, DailyClosingExpenseEntry } from '@/modules/daily-closing/types';
import { useAddExpenses } from '@/modules/daily-closing/hooks/useAddExpenses';
import { useRemoveExpense } from '@/modules/daily-closing/hooks/useRemoveExpense';
import { useExpenseSubcategories } from '@/modules/daily-closing/hooks/useExpenseSubcategories';
import { AddExpenseModal, type AddExpenseRow } from './AddExpenseModal';
import { SummaryRow } from '@/core/ui/components/SummaryRow';
import { formatCurrency } from '@/modules/daily-closing/utils/formatUtils';
import { colors, radius, shadow } from '@/core/ui/theme/colors';

interface Props { date: string; closing: FinanceDailyClosing | null; readonly: boolean; }

export function CashExpensesSection({ date, closing, readonly }: Props) {
  const [showModal, setShowModal] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const addExpenses = useAddExpenses(date);
  const removeExpense = useRemoveExpense(date);
  const { data: subcategories = [] } = useExpenseSubcategories();

  function handleSave(rows: AddExpenseRow[]) {
    setSaveError(null);
    addExpenses.mutate({ expenses: rows }, {
      onSuccess: () => setShowModal(false),
      onError: (e: unknown) => setSaveError(e instanceof Error ? e.message : 'Failed to save'),
    });
  }

  function confirmDelete(entry: DailyClosingExpenseEntry) {
    Alert.alert('Remove Expense', `Remove ${entry.categoryName}${entry.subcategoryName ? ` · ${entry.subcategoryName}` : ''} — ${formatCurrency(entry.amount)}?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => removeExpense.mutate(entry.id) },
    ]);
  }

  const expenses = closing?.expenses ?? [];

  return (
    <View style={styles.card}>
      <Text style={styles.sectionLabel}>Cash Expenses</Text>

      {expenses.length === 0 && <Text style={styles.empty}>No expenses recorded</Text>}

      {expenses.map(entry => (
        <View key={entry.id} style={styles.row}>
          <View style={styles.rowInfo}>
            <Text style={styles.rowLabel}>
              {entry.categoryName}
              {entry.subcategoryName ? <Text style={styles.rowSubcategory}> · {entry.subcategoryName}</Text> : null}
            </Text>
            {entry.remarks ? <Text style={styles.rowRemarks}>{entry.remarks}</Text> : null}
          </View>
          <Text style={styles.expenseAmount}>{formatCurrency(entry.amount)}</Text>
          {!readonly && (
            <TouchableOpacity onPress={() => confirmDelete(entry)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={styles.deleteText}>✕</Text>
            </TouchableOpacity>
          )}
        </View>
      ))}

      <View style={styles.totalRow}>
        <SummaryRow label="Cash Expense Total" value={formatCurrency(closing?.cashExpenseTotal ?? 0)} bold />
      </View>

      {!readonly && !(closing?.locked) && (
        <TouchableOpacity style={styles.addBtn} onPress={() => { setSaveError(null); setShowModal(true); }} activeOpacity={0.8}>
          <Text style={styles.addBtnText}>+ Add Expenses</Text>
        </TouchableOpacity>
      )}

      <AddExpenseModal
        visible={showModal}
        onClose={() => setShowModal(false)}
        onSave={handleSave}
        isSaving={addExpenses.isPending}
        saveError={saveError}
        subcategories={subcategories}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.white, borderRadius: radius.card, borderWidth: 1, borderColor: colors.cardBorder, padding: 20, ...shadow.card },
  sectionLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 2, textTransform: 'uppercase', color: colors.slate400, marginBottom: 12 },
  empty: { color: colors.slate400, fontSize: 13, marginBottom: 8, fontStyle: 'italic' },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.slate50 },
  rowInfo: { flex: 1 },
  rowLabel: { fontSize: 14, color: colors.slate900 },
  rowSubcategory: { fontSize: 12, color: colors.slate400, fontWeight: '400' },
  rowRemarks: { fontSize: 12, color: colors.slate400, marginTop: 1 },
  expenseAmount: { fontSize: 14, fontWeight: '700', color: colors.rose600, marginHorizontal: 10, fontVariant: ['tabular-nums'] },
  deleteText: { color: colors.slate400, fontSize: 16, paddingHorizontal: 4 },
  totalRow: { paddingTop: 4 },
  addBtn: { marginTop: 12, paddingVertical: 10, borderRadius: radius.inner, borderWidth: 1, borderColor: colors.slateBtnBg, alignItems: 'center' },
  addBtnText: { color: colors.slateBtnBg, fontWeight: '700', fontSize: 14 },
});
