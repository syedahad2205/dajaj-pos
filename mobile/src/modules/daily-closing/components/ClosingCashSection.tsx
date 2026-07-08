/**
 * ClosingCashSection — single numeric Closing Cash field (Requirement 6.13).
 * Disabled when locked. No pre-filled default beyond last saved value.
 * Parent (DailySummarySection) reads this value to enable the Save button.
 */
import React from 'react';
import { View, Text, TextInput, StyleSheet } from 'react-native';
import type { FinanceDailyClosing } from '@/modules/daily-closing/types';

interface Props {
  date: string;
  closing: FinanceDailyClosing | null;
  readonly: boolean;
  value: string;
  onChangeValue: (val: string) => void;
}

export function ClosingCashSection({ closing, readonly, value, onChangeValue }: Props) {
  const isLocked = closing?.locked ?? false;

  return (
    <View style={styles.section}>
      <Text style={styles.title}>Count the Drawer</Text>
      <Text style={styles.label}>Closing Cash</Text>
      {(readonly || isLocked) ? (
        <Text style={styles.readonlyValue}>
          {closing?.closingCash != null ? `₹${closing.closingCash.toFixed(2)}` : '—'}
        </Text>
      ) : (
        <TextInput
          style={styles.input}
          value={value}
          onChangeText={onChangeValue}
          keyboardType="decimal-pad"
          placeholder="0.00"
          testID="closing-cash-input"
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { backgroundColor: '#fff', borderRadius: 12, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: '#eee' },
  title: { fontSize: 13, fontWeight: '700', color: '#888', textTransform: 'uppercase', marginBottom: 8 },
  label: { fontSize: 14, color: '#444', marginBottom: 6 },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 10, fontSize: 20, fontVariant: ['tabular-nums'] },
  readonlyValue: { fontSize: 20, fontWeight: '600', fontVariant: ['tabular-nums'] },
});
