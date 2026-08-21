/**
 * HomeScreen — styled to match the DAJAJ web app aesthetic.
 */
import React from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView, RefreshControl, StatusBar,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { CompositeScreenProps } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { TabParamList, RootStackParamList } from '@/navigation/AppNavigator';
import { ConnectivityBanner } from '@/core/ui/components/ConnectivityBanner';
import { DajajLogo } from '@/core/ui/components/DajajLogo';
import { useTodaysClosing } from '@/modules/daily-closing/hooks/useDailyClosing';
import { toDateKey, formatDateDisplay } from '@/modules/daily-closing/utils/dateUtils';
import { formatCurrency } from '@/modules/daily-closing/utils/formatUtils';
import { colors, radius, shadow } from '@/core/ui/theme/colors';

type Props = CompositeScreenProps<
  BottomTabScreenProps<TabParamList, 'Home'>,
  NativeStackScreenProps<RootStackParamList>
>;

type ClosingStatus = 'Not Started' | 'In Progress' | 'Closed';

function deriveStatus(closing: { locked?: boolean; expenses?: unknown[]; deposits?: unknown[] } | null | undefined): ClosingStatus {
  if (!closing) return 'Not Started';
  if (closing.locked) return 'Closed';
  const hasEntries = (closing.expenses?.length ?? 0) > 0 || (closing.deposits?.length ?? 0) > 0;
  return hasEntries ? 'In Progress' : 'Not Started';
}

const STATUS_CONFIG: Record<ClosingStatus, { bg: string; fg: string; border: string; ctaLabel: string }> = {
  'Not Started': { bg: colors.slate50, fg: colors.slate500, border: colors.slate200, ctaLabel: 'Start Daily Closing' },
  'In Progress': { bg: colors.amber50, fg: colors.orange600, border: colors.amber200, ctaLabel: 'Continue Daily Closing' },
  'Closed':      { bg: colors.emerald50, fg: colors.emerald700, border: colors.emerald100, ctaLabel: 'View Daily Closing' },
};

export function HomeScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const today = toDateKey();
  const { data: closing, isLoading, refetch, isRefetching } = useTodaysClosing();
  const status = deriveStatus(closing);
  const cfg = STATUS_CONFIG[status];

  function openDailyClosing() {
    (navigation as { navigate: (name: string, params: object) => void }).navigate('DailyClosing', {
      date: today,
      mode: status === 'Closed' ? 'readonly' : 'edit',
    });
  }

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + 16 }]}
      refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={() => void refetch()} tintColor={colors.orange600} />}
    >
      <StatusBar barStyle="dark-content" backgroundColor={colors.pageBg} />

      {/* Header card */}
      <View style={[styles.card, styles.headerCard]}>
        <DajajLogo width={80} height={115} />
        <View style={styles.headerDivider} />
        <Text style={styles.dateText}>{formatDateDisplay(today)}</Text>
        <ConnectivityBanner />
      </View>

      {/* Status card */}
      <View style={[styles.card, { borderColor: cfg.border, backgroundColor: cfg.bg }]}>
        <Text style={styles.sectionLabel}>Today's Status</Text>
        <Text style={[styles.statusValue, { color: cfg.fg }]} testID="status-badge">
          {isLoading ? '…' : status}
        </Text>

        {/* Opening cash */}
        <View style={styles.openingCashRow}>
          <Text style={styles.openingLabel}>Opening Cash</Text>
          <Text style={styles.openingValue}>
            {isLoading ? '…' : formatCurrency(closing?.openingCash ?? null)}
          </Text>
        </View>
        {closing?.openingCashSource === 'chained' && (
          <Text style={styles.chainedHint}>↑ Carried over from yesterday's closing</Text>
        )}
        {(closing?.openingCash ?? 0) < 0 && closing?.openingCashSource === 'chained' && (
          <View style={styles.deficitBadge}>
            <Text style={styles.deficitText}>⚠ Opening with cash deficit</Text>
          </View>
        )}
      </View>

      {/* CTA */}
      <TouchableOpacity
        style={styles.ctaBtn}
        onPress={openDailyClosing}
        activeOpacity={0.85}
        testID="daily-closing-cta"
      >
        <Text style={styles.ctaBtnText}>{cfg.ctaLabel}</Text>
      </TouchableOpacity>

      {/* History shortcut */}
      <TouchableOpacity
        style={styles.historyBtn}
        onPress={() => (navigation as { navigate: (n: string) => void }).navigate('History')}
        activeOpacity={0.7}
      >
        <Text style={styles.historyBtnText}>View History</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.pageBg },
  content: { padding: 16, gap: 12, paddingBottom: 32 },
  card: {
    backgroundColor: colors.white,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    padding: 20,
    ...shadow.card,
  },
  headerCard: {
    borderColor: colors.orangeCardBorder,
    gap: 8,
  },
  headerDivider: { height: 1, backgroundColor: colors.orange100, marginVertical: 4 },
  dateText: { fontSize: 14, color: colors.slate600, fontWeight: '500' },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 2,
    textTransform: 'uppercase',
    color: colors.slate400,
    marginBottom: 6,
  },
  statusValue: { fontSize: 26, fontWeight: '900', marginBottom: 12 },
  openingCashRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  openingLabel: { fontSize: 13, color: colors.slate600 },
  openingValue: { fontSize: 20, fontWeight: '700', color: colors.slate900, fontVariant: ['tabular-nums'] },
  chainedHint: { fontSize: 11, color: colors.slate400, marginTop: 2 },
  deficitBadge: {
    backgroundColor: colors.amber100,
    borderRadius: radius.sm,
    paddingHorizontal: 8,
    paddingVertical: 4,
    alignSelf: 'flex-start',
    marginTop: 6,
  },
  deficitText: { color: colors.amber800, fontSize: 12, fontWeight: '600' },
  ctaBtn: {
    backgroundColor: colors.slateBtnBg,
    borderRadius: radius.inner,
    paddingVertical: 16,
    alignItems: 'center',
    ...shadow.card,
  },
  ctaBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  historyBtn: { paddingVertical: 14, alignItems: 'center' },
  historyBtnText: { color: colors.orange600, fontSize: 14, fontWeight: '600' },
});
