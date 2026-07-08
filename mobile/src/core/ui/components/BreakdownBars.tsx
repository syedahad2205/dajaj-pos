/**
 * Breakdown bars — presentation-only component showing proportional bars for
 * expense/deposit/sales breakdown. Pure display, no finance logic.
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

export interface BreakdownItem {
  label: string;
  value: number;
  color: string;
}

interface Props {
  items: BreakdownItem[];
  total: number;
}

export function BreakdownBars({ items, total }: Props) {
  if (total <= 0) return null;
  return (
    <View style={styles.container}>
      {items.map(item => {
        const pct = Math.max(0, Math.min(100, (item.value / total) * 100));
        return (
          <View key={item.label} style={styles.row}>
            <Text style={styles.label}>{item.label}</Text>
            <View style={styles.barBg}>
              <View style={[styles.bar, { width: `${pct}%` as unknown as number, backgroundColor: item.color }]} />
            </View>
            <Text style={styles.value}>₹{item.value.toFixed(2)}</Text>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginVertical: 8 },
  row: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  label: { width: 90, fontSize: 12, color: '#555' },
  barBg: { flex: 1, height: 8, backgroundColor: '#eee', borderRadius: 4, marginHorizontal: 8, overflow: 'hidden' },
  bar: { height: 8, borderRadius: 4 },
  value: { width: 72, fontSize: 12, color: '#222', textAlign: 'right', fontVariant: ['tabular-nums'] },
});
