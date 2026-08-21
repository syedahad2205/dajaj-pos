import React, { useState } from 'react';
import { View, Text, TouchableOpacity, Alert, StyleSheet } from 'react-native';
import type { FinanceDailyClosing, DailyClosingDepositEntry } from '@/modules/daily-closing/types';
import type { CashDepositType } from '@/constants/finance';
import { useAddDeposit } from '@/modules/daily-closing/hooks/useAddDeposit';
import { useRemoveDeposit } from '@/modules/daily-closing/hooks/useRemoveDeposit';
import { AddDepositModal } from './AddDepositModal';
import { SummaryRow } from '@/core/ui/components/SummaryRow';
import { formatCurrency } from '@/modules/daily-closing/utils/formatUtils';
import { colors, radius, shadow } from '@/core/ui/theme/colors';

interface Props { date: string; closing: FinanceDailyClosing | null; readonly: boolean; }

export function CashDepositsSection({ date, closing, readonly }: Props) {
  const [showModal, setShowModal] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const addDeposit = useAddDeposit(date);
  const removeDeposit = useRemoveDeposit(date);

  function handleSave(input: { type: CashDepositType; amount: number; remarks?: string }) {
    setSaveError(null);
    addDeposit.mutate(input, {
      onSuccess: () => setShowModal(false),
      onError: (e) => setSaveError(e instanceof Error ? e.message : 'Failed to save'),
    });
  }

  function confirmDelete(entry: DailyClosingDepositEntry) {
    Alert.alert('Remove Deposit', `Remove ${entry.typeLabel} — ${formatCurrency(entry.amount)}?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => removeDeposit.mutate(entry.id) },
    ]);
  }

  const deposits = closing?.deposits ?? [];

  return (
    <View style={styles.card}>
      <Text style={styles.sectionLabel}>Cash Deposits</Text>
      <Text style={styles.caption}>Cash moving out of the drawer — not a business expense.</Text>
      {deposits.length === 0 && <Text style={styles.empty}>No deposits recorded</Text>}
      {deposits.map(entry => (
        <View key={entry.id} style={styles.row}>
          <View style={styles.rowInfo}>
            <Text style={styles.rowLabel}>{entry.typeLabel}</Text>
            {entry.remarks ? <Text style={styles.rowRemarks}>{entry.remarks}</Text> : null}
          </View>
          <Text style={styles.depositAmount}>{formatCurrency(entry.amount)}</Text>
          {!readonly && (
            <TouchableOpacity onPress={() => confirmDelete(entry)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={styles.deleteText}>✕</Text>
            </TouchableOpacity>
          )}
        </View>
      ))}
      <View style={styles.totals}>
        <SummaryRow label="Cash Deposit Total" value={formatCurrency(closing?.depositTotal ?? 0)} />
        <SummaryRow label="Total Cash Out" value={formatCurrency(closing?.totalCashOut ?? 0)} bold />
      </View>
      {!readonly && !(closing?.locked) && (
        <TouchableOpacity style={styles.addBtn} onPress={() => { setSaveError(null); setShowModal(true); }} activeOpacity={0.8}>
          <Text style={styles.addBtnText}>+ Add Deposit</Text>
        </TouchableOpacity>
      )}
      <AddDepositModal visible={showModal} onClose={() => setShowModal(false)} onSave={handleSave} isSaving={addDeposit.isPending} saveError={saveError} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.white, borderRadius: radius.card, borderWidth: 1, borderColor: colors.cardBorder, padding: 20, ...shadow.card },
  sectionLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 2, textTransform: 'uppercase', color: colors.slate400, marginBottom: 4 },
  caption: { fontSize: 12, color: colors.slate400, marginBottom: 12 },
  empty: { color: colors.slate400, fontSize: 13, marginBottom: 8, fontStyle: 'italic' },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.slate50 },
  rowInfo: { flex: 1 },
  rowLabel: { fontSize: 14, color: colors.slate900 },
  rowRemarks: { fontSize: 12, color: colors.slate400 },
  depositAmount: { fontSize: 14, fontWeight: '700', color: colors.sky600, marginHorizontal: 10, fontVariant: ['tabular-nums'] },
  deleteText: { color: colors.slate400, fontSize: 16, paddingHorizontal: 4 },
  totals: { paddingTop: 4 },
  addBtn: { marginTop: 12, paddingVertical: 10, borderRadius: radius.inner, borderWidth: 1, borderColor: colors.slateBtnBg, alignItems: 'center' },
  addBtnText: { color: colors.slateBtnBg, fontWeight: '700', fontSize: 14 },
});
