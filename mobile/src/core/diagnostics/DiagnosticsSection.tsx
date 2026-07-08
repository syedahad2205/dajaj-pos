/**
 * DiagnosticsSection — shared read-only diagnostics display (design §3, §10.6, Requirement 14).
 *
 * Rendered inside SettingsScreen's Diagnostics section.
 * Exposes the 11 fields required by Requirement 14.1.
 * No destructive actions, no sensitive data (Requirement 14.2, 14.3).
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useConnectivityStore } from '@/core/connectivity/useConnectivityStore';
import { useAuthStore } from '@/core/auth/useAuthStore';
import { getQueue } from '@/core/offline/mutationQueue';
import {
  APP_VERSION,
  BUILD_NUMBER,
  ENVIRONMENT,
  FIREBASE_PROJECT,
  API_VERSION,
  getLastSuccessfulSync,
} from '@/core/diagnostics/deviceInfo';

const SYNC_STATUS_LABEL: Record<string, string> = {
  synced: '🟢 Synced',
  'pending-sync': '🟡 Pending Sync',
  offline: '🔴 Offline',
  'sync-failed': '🔴 Sync Failed',
};

export function DiagnosticsSection() {
  const { user } = useAuthStore();
  const { syncStatus } = useConnectivityStore();
  const queue = getQueue();
  const pending = queue.filter(m => m.status === 'pending' || m.status === 'syncing');
  const failed = queue.filter(m => m.status === 'failed');

  const rows: Array<{ label: string; value: string; testID?: string }> = [
    { label: 'Current User', value: user?.username ?? '—' },
    { label: 'App Version', value: APP_VERSION },
    { label: 'Build Number', value: BUILD_NUMBER },
    { label: 'Environment', value: ENVIRONMENT },
    { label: 'Firebase Project', value: FIREBASE_PROJECT },
    { label: 'API Version', value: `v${API_VERSION}` },
    { label: 'Last Successful Sync', value: getLastSuccessfulSync() ?? 'Never' },
    { label: 'Current Sync Status', value: SYNC_STATUS_LABEL[syncStatus] ?? syncStatus },
    { label: 'Queue Size', value: String(queue.length), testID: 'diag-queue-size' },
    { label: 'Pending Operations', value: String(pending.length), testID: 'diag-pending-ops' },
    { label: 'Failed Operations', value: String(failed.length), testID: 'diag-failed-ops' },
  ];

  return (
    <View style={styles.container}>
      {rows.map(({ label, value, testID }) => (
        <View key={label} style={styles.row}>
          <Text style={styles.label}>{label}</Text>
          <Text style={styles.value} testID={testID} numberOfLines={1}>{value}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { backgroundColor: '#fff', borderRadius: 12, paddingHorizontal: 16, paddingVertical: 4, borderWidth: 1, borderColor: '#eee' },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#f0f0f0' },
  label: { fontSize: 13, color: '#555', flex: 1 },
  value: { fontSize: 13, color: '#111', fontWeight: '500', maxWidth: '55%', textAlign: 'right' },
});
