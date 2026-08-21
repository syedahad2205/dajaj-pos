import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TextInput, StyleSheet } from 'react-native';
import type { FinanceDailyClosing } from '@/modules/daily-closing/types';
import { useUpdateSales } from '@/modules/daily-closing/hooks/useUpdateSales';
import { trackSalesSave } from '@/modules/daily-closing/salesPendingSave';
import { KeyboardDoneBar } from '@/core/ui/components/KeyboardDoneBar';
import { colors, radius, shadow } from '@/core/ui/theme/colors';

interface Props { date: string; closing: FinanceDailyClosing | null; readonly: boolean; }

const SALES_FIELDS = [
  { key: 'upiSales' as const, label: 'UPI Sales' },
  { key: 'zomatoSales' as const, label: 'Zomato' },
  { key: 'swiggySales' as const, label: 'Swiggy' },
  { key: 'otherIncome' as const, label: 'Other Income' },
];

type FieldKey = (typeof SALES_FIELDS)[number]['key'];
type FieldStates = Record<FieldKey, 'idle' | 'saving' | 'saved'>;

export function TodaysSalesSection({ date, closing, readonly }: Props) {
  const updateSales = useUpdateSales(date);
  const [fields, setFields] = useState({
    upiSales: String(closing?.upiSales ?? 0),
    zomatoSales: String(closing?.zomatoSales ?? 0),
    swiggySales: String(closing?.swiggySales ?? 0),
    otherIncome: String(closing?.otherIncome ?? 0),
  });
  // Last values actually persisted server-side — used to skip no-op saves
  const savedRef = useRef({
    upiSales: closing?.upiSales ?? 0,
    zomatoSales: closing?.zomatoSales ?? 0,
    swiggySales: closing?.swiggySales ?? 0,
    otherIncome: closing?.otherIncome ?? 0,
  });
  const [fieldStates, setFieldStates] = useState<FieldStates>({
    upiSales: 'idle', zomatoSales: 'idle', swiggySales: 'idle', otherIncome: 'idle',
  });

  useEffect(() => {
    setFields({
      upiSales: String(closing?.upiSales ?? 0),
      zomatoSales: String(closing?.zomatoSales ?? 0),
      swiggySales: String(closing?.swiggySales ?? 0),
      otherIncome: String(closing?.otherIncome ?? 0),
    });
    savedRef.current = {
      upiSales: closing?.upiSales ?? 0,
      zomatoSales: closing?.zomatoSales ?? 0,
      swiggySales: closing?.swiggySales ?? 0,
      otherIncome: closing?.otherIncome ?? 0,
    };
    setFieldStates({ upiSales: 'idle', zomatoSales: 'idle', swiggySales: 'idle', otherIncome: 'idle' });
  }, [closing?.upiSales, closing?.zomatoSales, closing?.swiggySales, closing?.otherIncome]);

  function handleBlur(field: FieldKey) {
    const raw = fields[field].trim();
    const val = parseFloat(raw);
    const savedVal = savedRef.current[field];

    // Empty or unchanged → don't hit the network
    if (!Number.isFinite(val) || val === savedVal) {
      setFields(f => ({ ...f, [field]: String(savedVal) }));
      return;
    }

    setFieldStates(s => ({ ...s, [field]: 'saving' }));
    trackSalesSave(
      updateSales.mutateAsync(
        { [field]: val },
        {
          onSuccess: () => {
            savedRef.current = { ...savedRef.current, [field]: val };
            setFieldStates(s => ({ ...s, [field]: 'saved' }));
            setTimeout(() => setFieldStates(s => ({ ...s, [field]: 'idle' })), 1500);
          },
          onError: () => setFieldStates(s => ({ ...s, [field]: 'idle' })),
        },
      ),
    );
  }

  const isLocked = closing?.locked ?? false;

  return (
    <View style={styles.card}>
      <KeyboardDoneBar nativeID="sales-section-kb" />
      <Text style={styles.sectionLabel}>Today's Sales</Text>
      <Text style={styles.caption}>No need to say which bank — that gets reconciled later.</Text>
      {SALES_FIELDS.map(({ key, label }) => (
        <View key={key} style={styles.fieldRow}>
          <View style={styles.labelWrap}>
            <Text style={styles.fieldLabel}>{label}</Text>
            {fieldStates[key] === 'saving' && <Text style={styles.stateSaving}>Saving…</Text>}
            {fieldStates[key] === 'saved' && <Text style={styles.stateSaved}>✓ Saved</Text>}
          </View>
          {readonly || isLocked ? (
            <Text style={styles.readonlyValue}>₹{parseFloat(fields[key]).toFixed(2)}</Text>
          ) : (
            <TextInput
              style={[styles.input, fieldStates[key] === 'saved' && styles.inputSaved]}
              value={fields[key]}
              onChangeText={val => setFields(f => ({ ...f, [key]: val }))}
              onBlur={() => handleBlur(key)}
              keyboardType="decimal-pad"
              editable={!updateSales.isPending}
              placeholderTextColor={colors.slate400}
              inputAccessoryViewID="sales-section-kb"
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
  sectionLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 2, textTransform: 'uppercase', color: colors.slate400, marginBottom: 4 },
  caption: { fontSize: 12, color: colors.slate400, marginBottom: 12 },
  fieldRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  labelWrap: { flex: 1 },
  fieldLabel: { fontSize: 14, color: colors.slate600 },
  stateSaving: { fontSize: 11, color: colors.slate400, marginTop: 1 },
  stateSaved: { fontSize: 11, color: colors.emerald700, fontWeight: '600', marginTop: 1 },
  input: {
    width: 120, backgroundColor: colors.slate50, borderRadius: radius.sm, borderWidth: 1,
    borderColor: colors.slate200, padding: 8, fontSize: 15, textAlign: 'right',
    color: colors.slate900, fontVariant: ['tabular-nums'],
  },
  inputSaved: { borderColor: colors.emerald100 },
  readonlyValue: { fontSize: 15, fontWeight: '600', color: colors.slate900, fontVariant: ['tabular-nums'] },
  error: { color: colors.rose600, fontSize: 12, marginTop: 4 },
});
