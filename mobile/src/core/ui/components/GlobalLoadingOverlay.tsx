/**
 * GlobalLoadingOverlay
 *
 * A non-blocking indicator shown whenever any TanStack Query mutation or
 * background fetch is in flight. Renders a small pill in the top-right corner
 * so the user always knows when a network call or save is happening.
 *
 * Non-blocking: pointerEvents="none" so it never intercepts touches.
 */
import React from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useIsMutating, useIsFetching } from '@tanstack/react-query';
import { colors } from '@/core/ui/theme/colors';

export function GlobalLoadingOverlay() {
  const mutating = useIsMutating();
  const fetching = useIsFetching();
  const active = mutating > 0 || fetching > 0;

  if (!active) return null;

  const label = mutating > 0 ? 'Saving…' : 'Loading…';

  return (
    <View style={styles.container} pointerEvents="none">
      <View style={styles.pill}>
        <ActivityIndicator size="small" color="#fff" style={styles.spinner} />
        <Text style={styles.label}>{label}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 52,
    right: 16,
    zIndex: 9999,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.slateBtnBg,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 8,
    gap: 6,
  },
  spinner: { transform: [{ scale: 0.8 }] },
  label: { fontSize: 12, fontWeight: '600', color: '#fff' },
});
