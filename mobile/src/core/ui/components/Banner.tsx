import React, { type ReactNode } from 'react';
import { View, Text, StyleSheet } from 'react-native';

type BannerVariant = 'warning' | 'error' | 'info' | 'success';

interface Props {
  variant?: BannerVariant;
  message: string;
  children?: ReactNode;
}

const BG: Record<BannerVariant, string> = {
  warning: '#fff8e1',
  error: '#fdecea',
  info: '#e3f2fd',
  success: '#e8f5e9',
};
const FG: Record<BannerVariant, string> = {
  warning: '#e65100',
  error: '#c62828',
  info: '#1565c0',
  success: '#2e7d32',
};

export function Banner({ variant = 'info', message, children }: Props) {
  return (
    <View style={[styles.container, { backgroundColor: BG[variant] }]}>
      <Text style={[styles.text, { color: FG[variant] }]}>{message}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { borderRadius: 8, padding: 12, marginBottom: 12 },
  text: { fontSize: 13, lineHeight: 18 },
});
