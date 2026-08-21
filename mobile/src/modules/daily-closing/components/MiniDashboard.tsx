/**
 * MiniDashboard — Today + This Month stat cards for the Home screen.
 * Data comes from /api/mobile/v1/finance/dashboard which runs the same
 * service as the web dashboard — so Monthly Expense includes ledger
 * transactions (bank payments etc.), not just Daily Closing cash entries.
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import type { FinanceDashboardSummary } from '@/modules/daily-closing/types';
import { formatCurrency } from '@/modules/daily-closing/utils/formatUtils';
import { colors, radius, shadow } from '@/core/ui/theme/colors';

interface Props {
  summary: FinanceDashboardSummary | undefined;
  isLoading: boolean;
}

function Stat({
  label,
  value,
  tone = 'neutral',
  isLoading,
}: {
  label: string;
  value: number | undefined;
  tone?: 'neutral' | 'positive' | 'negative';
  isLoading: boolean;
}) {
  const color =
    tone === 'positive' ? colors.emerald700 : tone === 'negative' ? colors.rose600 : colors.slate900;
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel} numberOfLines={1}>{label}</Text>
      <Text style={[styles.statValue, { color }]} numberOfLines={1} adjustsFontSizeToFit>
        {isLoading ? '…' : formatCurrency(value ?? 0)}
      </Text>
    </View>
  );
}

export function MiniDashboard({ summary, isLoading }: Props) {
  return (
    <View style={styles.wrap}>
      {/* Today */}
      <View style={styles.card}>
        <Text style={styles.sectionLabel}>Today</Text>
        <View style={styles.row}>
          <Stat label="Revenue" value={summary?.cards.todayTotalRevenue} tone="positive" isLoading={isLoading} />
          <View style={styles.divider} />
          <Stat label="Cash Expense" value={summary?.cards.todayCashExpense} tone="negative" isLoading={isLoading} />
          <View style={styles.divider} />
          <Stat label="Profit" value={summary?.cards.todayProfit} isLoading={isLoading} />
        </View>
      </View>

      {/* This month */}
      <View style={styles.card}>
        <Text style={styles.sectionLabel}>This Month</Text>
        <View style={styles.row}>
          <Stat label="Revenue" value={summary?.cards.monthlyRevenue} tone="positive" isLoading={isLoading} />
          <View style={styles.divider} />
          <Stat label="Expense" value={summary?.cards.monthlyExpense} tone="negative" isLoading={isLoading} />
          <View style={styles.divider} />
          <Stat label="Profit" value={summary?.cards.monthlyProfit} isLoading={isLoading} />
        </View>
        <Text style={styles.caption}>Expense includes bank transactions, matching the web dashboard.</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 12 },
  card: {
    backgroundColor: colors.white,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    paddingVertical: 16,
    paddingHorizontal: 12,
    ...shadow.card,
  },
  sectionLabel: {
    fontSize: 11, fontWeight: '700', letterSpacing: 2,
    textTransform: 'uppercase', color: colors.slate400, marginBottom: 10,
    textAlign: 'center',
  },
  row: { flexDirection: 'row', alignItems: 'stretch' },
  stat: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  statLabel: { fontSize: 11, fontWeight: '600', color: colors.slate500, marginBottom: 4 },
  statValue: { fontSize: 15, fontWeight: '900', fontVariant: ['tabular-nums'] },
  divider: { width: StyleSheet.hairlineWidth, backgroundColor: colors.slate200 },
  caption: { fontSize: 10, color: colors.slate400, textAlign: 'center', marginTop: 8 },
});
