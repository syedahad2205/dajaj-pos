import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useConnectivityStore, type SyncStatus } from '@/core/connectivity/useConnectivityStore';
import { colors, radius } from '@/core/ui/theme/colors';

const STATUS_CONFIG: Record<SyncStatus, { label: string; bg: string; fg: string; border: string; tappable: boolean }> = {
  synced:         { label: '🟢  Synced',       bg: colors.emerald50,  fg: colors.emerald700, border: colors.emerald100, tappable: false },
  'pending-sync': { label: '🟡  Pending Sync', bg: colors.amber50,   fg: colors.amber800,   border: colors.amber200,  tappable: false },
  offline:        { label: '🔴  Offline',       bg: colors.rose50,    fg: colors.rose700,    border: colors.rose200,   tappable: false },
  'sync-failed':  { label: '🔴  Sync Failed',   bg: colors.rose50,    fg: colors.rose700,    border: colors.rose200,   tappable: true  },
};

export function ConnectivityBanner() {
  const { syncStatus } = useConnectivityStore();
  const navigation = useNavigation<{ navigate: (screen: string) => void }>();
  const cfg = STATUS_CONFIG[syncStatus];
  if (syncStatus === 'synced') return null;

  const inner = (
    <View style={[styles.container, { backgroundColor: cfg.bg, borderColor: cfg.border }]}>
      <Text style={[styles.text, { color: cfg.fg }]}>
        {cfg.label}{cfg.tappable ? ' — tap to review' : ''}
      </Text>
    </View>
  );

  return cfg.tappable
    ? <TouchableOpacity onPress={() => navigation.navigate('Settings')} testID="connectivity-banner">{inner}</TouchableOpacity>
    : <View testID="connectivity-banner">{inner}</View>;
}

const styles = StyleSheet.create({
  container: { borderRadius: radius.sm, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 8, marginBottom: 8 },
  text: { fontSize: 12, fontWeight: '600' },
});
