import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, StyleSheet } from 'react-native';
import type { FinanceDailyClosing } from '@/modules/daily-closing/types';
import { useSetOpeningCash } from '@/modules/daily-closing/hooks/useSetOpeningCash';
import { formatCurrency } from '@/modules/daily-closing/utils/formatUtils';
import { colors, radius, shadow } from '@/core/ui/theme/colors';

interface Props { date: string; closing: FinanceDailyClosing | null; readonly: boolean; }

export function OpeningCashCard({ date, closing, readonly }: Props) {
  const isChained = !closing || closing.openingCashSource === 'chained';
  const isDeficit = (closing?.openingCash ?? 0) < 0;
  const setOpeningCash = useSetOpeningCash(date);
  const [localValue, setLocalValue] = useState(String(closing?.openingCash ?? '0'));
  useEffect(() => { setLocalValue(String(closing?.openingCash ?? '0')); }, [closing?.openingCash]);

  function handleBlur() {
    const parsed = parseFloat(localValue);
    if (Number.isFinite(parsed)) setOpeningCash.mutate(parsed);
  }

  return (
    <View style={styles.card}>
      <Text style={styles.sectionLabel}>Opening Cash</Text>
      {(isChained || readonly) ? (
        <View>
          <Text style={[styles.valueText, isDeficit && styles.deficit]}>
            {formatCurrency(closing?.openingCash ?? null)}
          </Text>
          {isChained && <Text style={styles.chainedNote}>Carried over from yesterday&apos;s closing</Text>}
          {isDeficit && (
            <View style={styles.deficitBadge}>
              <Text style={styles.deficitText}>⚠ Opening with cash deficit</Text>
            </View>
          )}
        </View>
      ) : (
        <TextInput
          style={styles.input}
          value={localValue}
          onChangeText={setLocalValue}
          onBlur={handleBlur}
          keyboardType="decimal-pad"
          editable={!setOpeningCash.isPending}
          placeholder="0.00"
          placeholderTextColor={colors.slate400}
        />
      )}
      {setOpeningCash.isError && (
        <Text style={styles.errorText}>{setOpeningCash.error instanceof Error ? setOpeningCash.error.message : 'Failed to save'}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.white, borderRadius: radius.card, borderWidth: 1, borderColor: colors.cardBorder, padding: 20, ...shadow.card },
  sectionLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 2, textTransform: 'uppercase', color: colors.slate400, marginBottom: 8 },
  valueText: { fontSize: 24, fontWeight: '900', color: colors.slate900, fontVariant: ['tabular-nums'] },
  deficit: { color: colors.orange600 },
  chainedNote: { fontSize: 11, color: colors.slate400, marginTop: 4 },
  deficitBadge: { backgroundColor: colors.amber100, borderRadius: radius.sm, paddingHorizontal: 8, paddingVertical: 4, alignSelf: 'flex-start', marginTop: 6 },
  deficitText: { color: colors.amber800, fontSize: 12, fontWeight: '600' },
  input: { backgroundColor: colors.slate50, borderRadius: radius.inner, borderWidth: 1, borderColor: colors.slate200, paddingHorizontal: 14, paddingVertical: 12, fontSize: 22, fontWeight: '700', color: colors.slate900, fontVariant: ['tabular-nums'] },
  errorText: { color: colors.rose600, fontSize: 12, marginTop: 4 },
});
