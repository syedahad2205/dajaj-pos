/**
 * HistoryScreen — styled to match DAJAJ web app.
 * Date-range filter, newest-first list, no search box (Requirement 5.6).
 */
import React, { useState } from 'react';
import {
  View, Text, TouchableOpacity, FlatList, StyleSheet, ActivityIndicator, StatusBar,
} from 'react-native';
import type { CompositeScreenProps } from '@react-navigation/native';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { TabParamList, RootStackParamList } from '@/navigation/AppNavigator';
import { useDailyClosingHistory } from '@/modules/daily-closing/hooks/useDailyClosingHistory';
import { toDateKey, startOfMonthKey, formatDateDisplay, formatClosingTime } from '@/modules/daily-closing/utils/dateUtils';
import { formatCurrency } from '@/modules/daily-closing/utils/formatUtils';
import type { FinanceDailyClosing } from '@/modules/daily-closing/types';
import { colors, radius, shadow } from '@/core/ui/theme/colors';

type Props = CompositeScreenProps<
  BottomTabScreenProps<TabParamList, 'History'>,
  NativeStackScreenProps<RootStackParamList>
>;

export function HistoryScreen({ navigation }: Props) {
  const today = toDateKey();
  const [dateFrom] = useState(startOfMonthKey());
  const [dateTo] = useState(today);

  const { data: closings = [], isLoading, isError } = useDailyClosingHistory(dateFrom, dateTo);

  function openClosing(item: FinanceDailyClosing) {
    (navigation as { navigate: (name: string, params: object) => void }).navigate('DailyClosing', {
      date: item.date,
      mode: 'readonly',
    });
  }

  return (
    <View style={styles.screen}>
      <StatusBar barStyle="dark-content" backgroundColor={colors.pageBg} />

      {/* Header */}
      <View style={styles.headerCard}>
        <Text style={styles.financeLabel}>Finance</Text>
        <Text style={styles.pageTitle}>History</Text>
        <Text style={styles.rangeText}>{dateFrom} → {dateTo}</Text>
      </View>

      {isLoading && (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.orange600} />
        </View>
      )}

      {isError && (
        <View style={styles.errorCard}>
          <Text style={styles.errorText}>Failed to load history. Pull to retry.</Text>
        </View>
      )}

      {!isLoading && !isError && (
        <FlatList
          data={closings}
          keyExtractor={item => item.date}
          contentContainerStyle={[
            styles.listContent,
            closings.length === 0 && styles.emptyContainer,
          ]}
          ListEmptyComponent={
            <Text style={styles.empty}>No Daily Closings in this range.</Text>
          }
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.row}
              onPress={() => openClosing(item)}
              activeOpacity={0.7}
            >
              <View style={styles.rowLeft}>
                <Text style={styles.rowDate}>{formatDateDisplay(item.date)}</Text>
                {item.locked && item.closedByName && (
                  <Text style={styles.rowMeta}>
                    {item.closedByName} · {formatClosingTime(item.closingTime)}
                  </Text>
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
          )}
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
    paddingBottom: 16,
  },
  financeLabel: {
    fontSize: 11, fontWeight: '700', letterSpacing: 4,
    textTransform: 'uppercase', color: colors.orange600, marginBottom: 2,
  },
  pageTitle: { fontSize: 24, fontWeight: '900', color: colors.slate900, marginBottom: 2 },
  rangeText: { fontSize: 12, color: colors.slate400 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  errorCard: {
    margin: 16, backgroundColor: colors.rose50,
    borderRadius: radius.inner, borderWidth: 1, borderColor: colors.rose200, padding: 14,
  },
  errorText: { color: colors.rose700, fontSize: 14, textAlign: 'center' },
  listContent: { paddingBottom: 32 },
  emptyContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 60 },
  empty: { color: colors.slate400, fontSize: 15 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    backgroundColor: colors.white,
  },
  rowLeft: { flex: 1 },
  rowDate: { fontSize: 14, fontWeight: '700', color: colors.slate900, marginBottom: 2 },
  rowMeta: { fontSize: 11, color: colors.slate400 },
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
