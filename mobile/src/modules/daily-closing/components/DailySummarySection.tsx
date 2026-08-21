/**
 * DailySummarySection — matches the web app's Summary card exactly.
 * Row order: Opening Cash → Cash Expenses → Cash Deposits → Total Cash Out →
 *            Cash Revenue → UPI Sales → Zomato → Swiggy → Other Income → Total Revenue → Closing Cash
 * Property 3: closingCash === null → cashRevenue/totalRevenue show "—", never "0".
 */
import React, { useState } from 'react';
import { View, Text, TextInput, StyleSheet, Alert } from 'react-native';
import type { FinanceDailyClosing } from '@/modules/daily-closing/types';
import { SummaryRow } from '@/core/ui/components/SummaryRow';
import { Button } from '@/core/ui/components/Button';
import { KeyboardDoneBar } from '@/core/ui/components/KeyboardDoneBar';
import { useCloseDailyClosing } from '@/modules/daily-closing/hooks/useCloseDailyClosing';
import { waitForSalesSave } from '@/modules/daily-closing/salesPendingSave';
import { getQueueForDate } from '@/core/offline/mutationQueue';
import { estimatePendingTotals, hasPendingChanges } from '@/modules/daily-closing/preview/estimatePendingTotals';
import { formatCurrency } from '@/modules/daily-closing/utils/formatUtils';
import { formatClosingTime } from '@/modules/daily-closing/utils/dateUtils';
import { colors, radius, shadow } from '@/core/ui/theme/colors';

interface Props { date: string; closing: FinanceDailyClosing | null; readonly: boolean; }

export function DailySummarySection({ date, closing, readonly }: Props) {
  const [closingCashInput, setClosingCashInput] = useState(
    closing?.closingCash != null ? String(closing.closingCash) : '',
  );
  const closeDailyClosing = useCloseDailyClosing(date);
  const pendingQueue = getQueueForDate(date);
  const estimate = estimatePendingTotals(pendingQueue);
  const hasPending = hasPendingChanges(estimate);
  const isLocked = closing?.locked ?? false;
  const parsedClosingCash = parseFloat(closingCashInput);
  const canSave = !isLocked && !readonly && Number.isFinite(parsedClosingCash) && !closeDailyClosing.isPending;

  // Property 3: null closingCash → "—" not "0"
  const cashRevenueDisplay = closing?.closingCash == null ? '—' : formatCurrency(closing.cashRevenue);
  const totalRevenueDisplay = closing?.closingCash == null ? '—' : formatCurrency(closing.totalRevenue);

  function handleSave() {
    Alert.alert(
      'Save Daily Closing',
      `Close the day with Closing Cash ${formatCurrency(parsedClosingCash)}?\n\nThis will lock the day and post transactions.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Save & Close', style: 'default',
          // Wait for any in-flight sales save first (mirrors web behavior) so
          // the close can't race ahead of the last sales PATCH.
          onPress: () => {
            void waitForSalesSave().then(() => closeDailyClosing.mutate(parsedClosingCash));
          },
        },
      ],
    );
  }

  return (
    <View style={styles.card}>
      <Text style={styles.sectionLabel}>Daily Summary</Text>

      {hasPending && (
        <View style={styles.pendingBanner}>
          <Text style={styles.pendingText}>⏳ Pending changes — totals will update after sync</Text>
        </View>
      )}

      {/* Section order per Requirement 6.14 */}
      <SummaryRow label="Opening Cash" value={formatCurrency(closing?.openingCash ?? null)} />
      <SummaryRow label="Cash Expenses" value={formatCurrency(closing?.cashExpenseTotal ?? null)} />
      <SummaryRow label="Cash Deposits" value={formatCurrency(closing?.depositTotal ?? null)} />
      <SummaryRow label="Total Cash Out" value={formatCurrency(closing?.totalCashOut ?? null)} bold />
      <SummaryRow label="Cash Revenue" value={cashRevenueDisplay} testID="cash-revenue-row" />
      <SummaryRow label="UPI Sales" value={formatCurrency(closing?.upiSales ?? null)} />
      <SummaryRow label="Zomato Sales" value={formatCurrency(closing?.zomatoSales ?? null)} />
      <SummaryRow label="Swiggy Sales" value={formatCurrency(closing?.swiggySales ?? null)} />
      <SummaryRow label="Other Income" value={formatCurrency(closing?.otherIncome ?? null)} />
      <SummaryRow label="Total Revenue" value={totalRevenueDisplay} bold testID="total-revenue-row" />
      <SummaryRow
        label="Closing Cash"
        value={isLocked && closing?.closingCash != null
          ? formatCurrency(closing.closingCash)
          : (closingCashInput ? formatCurrency(parsedClosingCash) : '—')}
        bold
      />

      {/* Closing cash input — only when not locked and not readonly */}
      {!readonly && !isLocked && (
        <View style={styles.closingCashRow}>
          <KeyboardDoneBar nativeID="closing-cash-kb" />
          <Text style={styles.inputLabel}>Count the Drawer — Closing Cash</Text>
          <TextInput
            style={styles.closingInput}
            value={closingCashInput}
            onChangeText={setClosingCashInput}
            keyboardType="decimal-pad"
            placeholder="0.00"
            placeholderTextColor={colors.slate400}
            testID="closing-cash-input"
            inputAccessoryViewID="closing-cash-kb"
          />
        </View>
      )}

      {/* Locked state */}
      {isLocked ? (
        <View style={styles.lockedBanner}>
          <Text style={styles.lockedIcon}>🔒</Text>
          <View>
            <Text style={styles.lockedTitle}>Closed & Locked</Text>
            <Text style={styles.lockedMeta}>
              By {closing?.closedByName ?? 'Unknown'} · {formatClosingTime(closing?.closingTime)}
            </Text>
          </View>
        </View>
      ) : !readonly ? (
        <>
          <Button
            title="Save Daily Closing"
            onPress={handleSave}
            disabled={!canSave}
            loading={closeDailyClosing.isPending}
            style={styles.saveBtn}
            testID="save-daily-closing-button"
          />
          {!canSave && !closeDailyClosing.isPending && (
            <Text style={styles.saveHint}>Enter Closing Cash above to save</Text>
          )}
        </>
      ) : null}

      {closeDailyClosing.isError && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{closeDailyClosing.error instanceof Error ? closeDailyClosing.error.message : 'Failed to save'}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.white, borderRadius: radius.card, borderWidth: 1, borderColor: colors.cardBorder, padding: 20, ...shadow.card },
  sectionLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 2, textTransform: 'uppercase', color: colors.slate400, marginBottom: 12 },
  pendingBanner: { backgroundColor: colors.amber50, borderRadius: radius.sm, padding: 10, marginBottom: 12 },
  pendingText: { color: colors.amber800, fontSize: 12 },
  closingCashRow: { marginTop: 16, paddingTop: 12, borderTopWidth: 1, borderTopColor: colors.slate100 },
  inputLabel: { fontSize: 12, fontWeight: '600', color: colors.slate500, marginBottom: 8 },
  closingInput: {
    backgroundColor: colors.slate50, borderRadius: radius.inner, borderWidth: 1,
    borderColor: colors.orange400, paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 22, fontWeight: '700', color: colors.slate900, fontVariant: ['tabular-nums'],
  },
  saveBtn: { marginTop: 16 },
  saveHint: { textAlign: 'center', color: colors.slate400, fontSize: 12, marginTop: 6 },
  lockedBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: colors.emerald50, borderRadius: radius.inner,
    borderWidth: 1, borderColor: colors.emerald100, padding: 14, marginTop: 12,
  },
  lockedIcon: { fontSize: 20 },
  lockedTitle: { fontSize: 14, fontWeight: '700', color: colors.emerald700 },
  lockedMeta: { fontSize: 12, color: colors.emerald700, marginTop: 2 },
  errorBanner: { backgroundColor: colors.rose50, borderRadius: radius.inner, borderWidth: 1, borderColor: colors.rose200, padding: 12, marginTop: 10 },
  errorText: { color: colors.rose700, fontSize: 13 },
});
