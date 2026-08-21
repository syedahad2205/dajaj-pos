/**
 * DailyClosingScreen — styled to match DAJAJ web app.
 * Sections: Opening Cash → Cash Expenses → Cash Deposits → Today's Sales → Daily Summary.
 * Header includes day navigation (‹ prev · date picker · next ›) capped at today.
 */
import React from 'react';
import { ScrollView, View, Text, StyleSheet, ActivityIndicator, RefreshControl, StatusBar } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '@/navigation/AppNavigator';
import { ConnectivityBanner } from '@/core/ui/components/ConnectivityBanner';
import { useDailyClosing } from '@/modules/daily-closing/hooks/useDailyClosing';
import { DateNav } from '@/modules/daily-closing/components/DateNav';
import { OpeningCashCard } from '@/modules/daily-closing/components/OpeningCashCard';
import { CashExpensesSection } from '@/modules/daily-closing/components/CashExpensesSection';
import { CashDepositsSection } from '@/modules/daily-closing/components/CashDepositsSection';
import { TodaysSalesSection } from '@/modules/daily-closing/components/TodaysSalesSection';
import { DailySummarySection } from '@/modules/daily-closing/components/DailySummarySection';
import { colors, radius, shadow } from '@/core/ui/theme/colors';
import { formatDateDisplay } from '@/modules/daily-closing/utils/dateUtils';

type Props = NativeStackScreenProps<RootStackParamList, 'DailyClosing'>;

export function DailyClosingScreen({ route, navigation }: Props) {
  const { date: initialDate, mode } = route.params;
  const [date, setDate] = React.useState(initialDate);
  const { data: closing, isLoading, isError, refetch, isRefetching } = useDailyClosing(date);

  // Read-only is driven by the day's actual lock state once loaded — so
  // navigating to any unlocked past day makes it editable (matches web),
  // while locked days stay read-only regardless of how the screen was opened.
  const readonly = closing ? closing.locked : mode === 'readonly';

  // Keep the stack screen title in sync when the picked date changes
  React.useLayoutEffect(() => {
    navigation.setOptions({ title: `Closing · ${formatDateDisplay(date)}` });
  }, [navigation, date]);

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.orange600} />
        <Text style={styles.loadingText}>Loading Daily Closing…</Text>
      </View>
    );
  }

  if (isError) {
    return (
      <ScrollView
        style={styles.screen}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={() => void refetch()} />}
      >
        <View style={[styles.errorCard]}>
          <Text style={styles.errorText}>Could not load Daily Closing. Pull down to retry.</Text>
        </View>
      </ScrollView>
    );
  }

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={() => void refetch()} tintColor={colors.orange600} />}
    >
      <StatusBar barStyle="dark-content" backgroundColor={colors.pageBg} />
      <ConnectivityBanner />

      {/* Header card */}
      <View style={[styles.card, styles.headerCard]}>
        <Text style={styles.financeLabel}>Finance</Text>
        <Text style={styles.pageTitle}>Daily Closing</Text>
        <DateNav date={date} onChange={setDate} />
        {readonly && (
          <View style={styles.readonlyBadge}>
            <Text style={styles.readonlyText}>Read-only view</Text>
          </View>
        )}
      </View>

      {/* Posting warnings — verbatim text per Requirement 6.18 */}
      {(closing?.postingWarnings ?? []).map((warning, i) => (
        <View key={i} style={styles.warningCard}>
          <Text style={styles.warningText}>{warning}</Text>
        </View>
      ))}

      <View style={styles.sections}>
        <OpeningCashCard date={date} closing={closing ?? null} readonly={readonly} />
        <CashExpensesSection date={date} closing={closing ?? null} readonly={readonly} />
        <CashDepositsSection date={date} closing={closing ?? null} readonly={readonly} />
        <TodaysSalesSection date={date} closing={closing ?? null} readonly={readonly} />
        <DailySummarySection date={date} closing={closing ?? null} readonly={readonly} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.pageBg },
  content: { padding: 16, gap: 12, paddingBottom: 32 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.pageBg, gap: 12 },
  loadingText: { color: colors.slate500, fontSize: 14 },
  card: {
    backgroundColor: colors.white,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    padding: 20,
    ...shadow.card,
  },
  headerCard: { borderColor: colors.orangeCardBorder },
  financeLabel: {
    fontSize: 11, fontWeight: '700', letterSpacing: 4,
    textTransform: 'uppercase', color: colors.orange600, marginBottom: 4,
  },
  pageTitle: { fontSize: 28, fontWeight: '900', color: colors.slate900, marginBottom: 4 },
  readonlyBadge: {
    backgroundColor: colors.slate100,
    borderRadius: radius.sm,
    paddingHorizontal: 10,
    paddingVertical: 4,
    alignSelf: 'flex-start',
    marginTop: 8,
  },
  readonlyText: { fontSize: 12, color: colors.slate500, fontWeight: '600' },
  warningCard: {
    backgroundColor: colors.amber50,
    borderRadius: radius.inner,
    borderWidth: 1,
    borderColor: colors.amber200,
    padding: 12,
  },
  warningText: { color: colors.amber800, fontSize: 13, lineHeight: 18 },
  errorCard: {
    margin: 16,
    backgroundColor: colors.rose50,
    borderRadius: radius.inner,
    borderWidth: 1,
    borderColor: colors.rose200,
    padding: 16,
  },
  errorText: { color: colors.rose700, fontSize: 14, textAlign: 'center' },
  sections: { gap: 12 },
});
