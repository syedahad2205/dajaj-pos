/**
 * HistoryScreen — styled to match DAJAJ web app's history page.
 * Range presets (This Month / 7 / 30 / 90 days), totals summary cards,
 * per-day badges (Reopened N×, Posting incomplete), newest-first list.
 * Unlocked days open in edit mode; locked days open read-only.
 */
import React, { useMemo, useState } from 'react';
import {
  View, Text, TouchableOpacity, FlatList, StyleSheet, ActivityIndicator,
  StatusBar, RefreshControl, ScrollView,
} from 'react-native';
import type { CompositeScreenProps } from '@react-navigation/native';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { TabParamList, RootStackParamList } from '@/navigation/AppNavigator';
import { useDailyClosingHistory, type FinanceHistoryDay } from '@/modules/daily-closing/hooks/useDailyClosingHistory';
import { toDateKey, formatDateDisplay, formatClosingTime } from '@/modules/daily-closing/utils/dateUtils';
import { formatCurrency } from '@/modules/daily-closing/utils/formatUtils';
import { colors, radius, shadow } from '@/core/ui/theme/colors';

type Props = CompositeScreenProps<
  BottomTabScreenProps<TabParamList, 'History'>,
  NativeStackScreenProps<RootStackParamList>
>;

type RangePreset = 'month' | '7d' | '30d' | '90d';

const PRESETS: Array<{ key: RangePreset; label: string }> = [
  { key: 'month', label: 'This Month' },
  { key: '7d', label: '7 Days' },
  { key: '30d', label: '30 Days' },
  { key: '90d', label: '90 Days' },
];

function presetRange(preset: RangePreset): { dateFrom: string; dateTo: string } {
  const today = new Date();
  const dateTo = toDateKey(today);
  if (preset === 'month') {
    const d = new Date(today.getFullYear(), today.getMonth(), 1);
    return { dateFrom: toDateKey(d), dateTo };
  }
  const days = preset === '7d' ? 6 : preset === '30d' ? 29 : 89;
  const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - days);
  return { dateFrom: toDateKey(d), dateTo };
}

export function HistoryScreen({ navigation }: Props) {
  const [preset, setPreset] = useState<RangePreset>('month');
  const { dateFrom, dateTo } = useMemo(() => presetRange(preset), [preset]);

  const { data: closings = [], isLoading, isError, refetch, isRefetching } =
    useDailyClosingHistory(dateFrom, dateTo);

  const totals = useMemo(() => {
    const closed = closings.filter(c => c.locked);
    return {
      closedDays: closed.length,
      totalDays: closings.length,
      totalRevenue: closed.reduce((sum, c) => sum + (c.totalRevenue ?? 0), 0),
      // Blended: daily-closing cash expenses + ledger (bank) transactions — matches web dashboard
      totalExpenses: closed.reduce((sum, c) => sum + (c.totalExpense ?? c.cashExpenseTotal ?? 0), 0),
    };
  }, [closings]);

  function openClosing(item: FinanceHistoryDay) {
    navigation.navigate('DailyClosing', {
      date: item.date,
      // Locked days are read-only; anything else can still be edited
      mode: item.locked ? 'readonly' : 'edit',
    });
  }

  return (
    <View style={styles.screen}>
      <StatusBar barStyle="dark-content" backgroundColor={colors.pageBg} />

      {/* Header */}
      <View style={styles.headerCard}>
        <Text style={styles.financeLabel}>Finance</Text>
        <Text style={styles.pageTitle}>History</Text>

        {/* Range presets */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.presetsRow}
        >
          {PRESETS.map(({ key, label }) => (
            <TouchableOpacity
              key={key}
              style={[styles.presetChip, preset === key && styles.presetChipActive]}
              onPress={() => setPreset(key)}
            >
              <Text style={[styles.presetText, preset === key && styles.presetTextActive]}>{label}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {isLoading && (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.orange600} />
        </View>
      )}

      {!isLoading && (
        <FlatList
          data={closings}
          keyExtractor={item => item.date}
          contentContainerStyle={[
            styles.listContent,
            closings.length === 0 && styles.emptyContainer,
          ]}
          refreshControl={
            <RefreshControl refreshing={isRefetching} onRefresh={() => void refetch()} tintColor={colors.orange600} />
          }
          ListHeaderComponent={
            !isError && closings.length > 0 ? (
              <View style={styles.totalsRow}>
                <View style={[styles.totalCard, styles.totalCardWide]}>
                  <Text style={styles.totalLabel}>Days Closed</Text>
                  <Text style={styles.totalValue}>{totals.closedDays}/{totals.totalDays}</Text>
                </View>
                <View style={[styles.totalCard, styles.revenueCard]}>
                  <Text style={styles.totalLabel}>Revenue</Text>
                  <Text style={[styles.totalValue, { color: colors.emerald700 }]} numberOfLines={1} adjustsFontSizeToFit>
                    {formatCurrency(totals.totalRevenue)}
                  </Text>
                </View>
                <View style={[styles.totalCard, styles.expenseCard]}>
                  <Text style={styles.totalLabel}>Expenses</Text>
                  <Text style={[styles.totalValue, { color: colors.rose600 }]} numberOfLines={1} adjustsFontSizeToFit>
                    {formatCurrency(totals.totalExpenses)}
                  </Text>
                </View>
              </View>
            ) : null
          }
          ListEmptyComponent={
            isError ? (
              <View style={styles.errorCard}>
                <Text style={styles.errorText}>Failed to load history. Pull down to retry.</Text>
              </View>
            ) : (
              <Text style={styles.empty}>No Daily Closings in this range.</Text>
            )
          }
          renderItem={({ item }) => {
            const hasPostingWarnings = item.locked && (item.postingWarnings?.length ?? 0) > 0;
            return (
              <TouchableOpacity
                style={styles.row}
                onPress={() => openClosing(item)}
                activeOpacity={0.7}
              >
                <View style={styles.rowLeft}>
                  <Text style={styles.rowDate}>{formatDateDisplay(item.date)}</Text>
                  <View style={styles.badgeRow}>
                    {item.locked && item.closedByName && (
                      <Text style={styles.rowMeta}>
                        {item.closedByName} · {formatClosingTime(item.closingTime)}
                      </Text>
                    )}
                  </View>
                  {(item.reopenCount ?? 0) > 0 && (
                    <View style={styles.reopenedBadge}>
                      <Text style={styles.reopenedBadgeText}>Reopened {item.reopenCount}×</Text>
                    </View>
                  )}
                  {hasPostingWarnings && (
                    <View style={styles.postingBadge}>
                      <Text style={styles.postingBadgeText}>Posting incomplete</Text>
                    </View>
                  )}
                </View>
                <View style={styles.rowRight}>
                  {item.locked ? (
                    <>
                      <View style={styles.lockedBadge}>
                        <Text style={styles.lockedBadgeText}>🔒 Closed</Text>
                      </View>
                      <Text style={styles.revenueText}>{formatCurrency(item.totalRevenue)}</Text>
                    </>
                  ) : (
                    <Text style={styles.openText}>In Progress</Text>
                  )}
                  <Text style={styles.chevron}>›</Text>
                </View>
              </TouchableOpacity>
            );
          }}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.pageBg },
  headerCard: {
    backgroundColor: colors.white,
    borderBottomWidth: 1,
    borderBottomColor: colors.orangeCardBorder,
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 12,
  },
  financeLabel: {
    fontSize: 11, fontWeight: '700', letterSpacing: 4,
    textTransform: 'uppercase', color: colors.orange600, marginBottom: 2,
  },
  pageTitle: { fontSize: 24, fontWeight: '900', color: colors.slate900, marginBottom: 10 },
  presetsRow: { flexDirection: 'row', gap: 8, paddingBottom: 4 },
  presetChip: {
    paddingHorizontal: 14, paddingVertical: 7, borderRadius: radius.full,
    backgroundColor: colors.slate50, borderWidth: 1, borderColor: colors.slate200,
  },
  presetChipActive: { backgroundColor: colors.slateBtnBg, borderColor: colors.slateBtnBg },
  presetText: { fontSize: 13, fontWeight: '600', color: colors.slate600 },
  presetTextActive: { color: '#fff' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  listContent: { paddingBottom: 32 },
  emptyContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 60 },
  empty: { color: colors.slate400, fontSize: 15 },
  errorCard: {
    margin: 16, backgroundColor: colors.rose50,
    borderRadius: radius.inner, borderWidth: 1, borderColor: colors.rose200, padding: 14,
  },
  errorText: { color: colors.rose700, fontSize: 14, textAlign: 'center' },
  totalsRow: { flexDirection: 'row', gap: 8, padding: 16, paddingBottom: 8 },
  totalCard: {
    flex: 1, backgroundColor: colors.white, borderRadius: radius.inner,
    borderWidth: 1, borderColor: colors.cardBorder, padding: 12, ...shadow.card,
  },
  totalCardWide: { flex: 0.9 },
  revenueCard: { borderColor: colors.emerald100 },
  expenseCard: { borderColor: colors.rose200 },
  totalLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', color: colors.slate400, marginBottom: 4 },
  totalValue: { fontSize: 15, fontWeight: '900', color: colors.slate900, fontVariant: ['tabular-nums'] },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    backgroundColor: colors.white,
  },
  rowLeft: { flex: 1 },
  rowDate: { fontSize: 14, fontWeight: '700', color: colors.slate900, marginBottom: 2 },
  badgeRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  rowMeta: { fontSize: 11, color: colors.slate400 },
  reopenedBadge: {
    backgroundColor: colors.orange50, borderRadius: radius.sm,
    paddingHorizontal: 6, paddingVertical: 2, alignSelf: 'flex-start', marginTop: 3,
  },
  reopenedBadgeText: { fontSize: 10, color: colors.orange600, fontWeight: '700' },
  postingBadge: {
    backgroundColor: colors.rose50, borderRadius: radius.sm,
    paddingHorizontal: 6, paddingVertical: 2, alignSelf: 'flex-start', marginTop: 3,
  },
  postingBadgeText: { fontSize: 10, color: colors.rose700, fontWeight: '700' },
  rowRight: { alignItems: 'flex-end', gap: 4 },
  lockedBadge: {
    backgroundColor: colors.emerald100,
    borderRadius: radius.sm,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  lockedBadgeText: { fontSize: 11, color: colors.emerald700, fontWeight: '700' },
  revenueText: { fontSize: 14, fontWeight: '700', color: colors.slate800, fontVariant: ['tabular-nums'] },
  openText: { fontSize: 12, color: colors.orange600, fontWeight: '600' },
  chevron: { fontSize: 20, color: colors.slate200, marginLeft: 8 },
  separator: { height: StyleSheet.hairlineWidth, backgroundColor: colors.slate200, marginLeft: 20 },
});
