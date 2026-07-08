import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors } from '@/core/ui/theme/colors';

interface Props {
  label: string;
  value: string;
  pending?: boolean;
  bold?: boolean;
  testID?: string;
}

export function SummaryRow({ label, value, pending, bold, testID }: Props) {
  return (
    <View style={styles.row} testID={testID}>
      <Text style={[styles.label, bold && styles.boldLabel, pending && styles.pendingLabel]}>
        {label}
      </Text>
      <Text style={[styles.value, bold && styles.boldValue, pending && styles.pendingValue]}>
        {pending ? '~' : ''}{value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.slate50,
  },
  label: { fontSize: 14, color: colors.slate600, flex: 1 },
  boldLabel: { fontWeight: '700', color: colors.slate900 },
  pendingLabel: { color: colors.orange400 },
  value: { fontSize: 14, color: colors.slate800, fontWeight: '600', fontVariant: ['tabular-nums'] },
  boldValue: { fontSize: 15, color: colors.slate900, fontWeight: '900' },
  pendingValue: { color: colors.orange400, fontStyle: 'italic' },
});
