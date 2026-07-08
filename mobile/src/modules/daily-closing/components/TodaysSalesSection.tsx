import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, StyleSheet } from 'react-native';
import type { FinanceDailyClosing } from '@/modules/daily-closing/types';
import { useUpdateSales } from '@/modules/daily-closing/hooks/useUpdateSales';
import { colors, radius, shadow } from '@/core/ui/theme/colors';

interface Props { date: string; closing: FinanceDailyClosing | null; readonly: boolean; }

const SALES_FIELDS = [
  { key: 'upiSales' as const, label: 'UPI Sales' },
  { key: 'zomatoSales' as const, label: 'Zomato' },
  { key: 'swiggySales' as const, label: 'Swiggy' },
  { key: 'otherIncome' as const, label: 'Other Income' },
];

export function TodaysSalesSection({ date, closing, readonly }: Props) {
  const updateSales = useUpdateSales(date);
  const [fields, setFields] = useState({
    upiSales: String(closing?.upiSales ?? 0),
    zomatoSales: String(closing?.zomatoSales ?? 0),
    swiggySales: String(closing?.swiggySales ?? 0),
    otherIncome: String(closing?.otherIncome ?? 0),
  });

  useEffect(() => {
    setFields({
      upiSales: String(closing?.upiSales ?? 0),
      zomatoSales: String(closing?.zomatoSales ?? 0),
      swiggySales: String(closing?.swiggySales ?? 0),
      otherIncome: String(closing?.otherIncome ?? 0),
    });
  }, [closing?.upiSales, closing?.zomatoSales, closing?.swiggySales, closing?.otherIncome]);

  function handleBlur(field: keyof typeof fields) {
    const val = parseFloat(fields[field]);
    if (Number.isFinite(val)) updateSales.mutate({ [field]: val });
  }

  const isLocked = closing?.locked ?? false;

  return (
    <View style={styles.card}>
      <Text style={styles.sectionLabel}>Today's Sales</Text>
      {SALES_FIELDS.map(({ key, label }) => (
        <View key={key} style={styles.fieldRow}>
          <Text style={styles.fieldLabel}>{label}</Text>
          {readonly || isLocked ? (
            <Text style={styles.readonlyValue}>₹{parseFloat(fields[key]).toFixed(2)}</Text>
          ) : (
            <TextInput
              style={styles.input}
              value={fields[key]}
              onChangeText={val => setFields(f => ({ ...f, [key]: val }))}
              onBlur={() => handleBlur(key)}
              keyboardType="decimal-pad"
              editable={!updateSales.isPending}
              placeholderTextColor={colors.slate400}
            />
          )}
        </View>
      ))}
      {updateSales.isError && <Text style={styles.error}>{updateSales.error instanceof Error ? updateSales.error.message : 'Failed to save'}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.white, borderRadius: radius.card, borderWidth: 1, borderColor: colors.cardBorder, padding: 20, ...shadow.card },
  sectionLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 2, textTransform: 'uppercase', color: colors.slate400, marginBottom: 12 },
  fieldRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  fieldLabel: { fontSize: 14, color: colors.slate600, flex: 1 },
  input: {
    width: 120, backgroundColor: colors.slate50, borderRadius: radius.sm, borderWidth: 1,
    borderColor: colors.slate200, padding: 8, fontSize: 15, textAlign: 'right',
    color: colors.slate900, fontVariant: ['tabular-nums'],
  },
  readonlyValue: { fontSize: 15, fontWeight: '600', color: colors.slate900, fontVariant: ['tabular-nums'] },
  error: { color: colors.rose600, fontSize: 12, marginTop: 4 },
});
