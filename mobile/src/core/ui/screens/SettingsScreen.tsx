/**
 * SettingsScreen — styled to match DAJAJ web app.
 * Sections: Identity, Sync, Diagnostics, Logout.
 */
import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Alert, TouchableOpacity, StatusBar, Share } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { signOut as firebaseSignOut } from 'firebase/auth';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '@/navigation/AppNavigator';
import { useAuthStore } from '@/core/auth/useAuthStore';
import { getFirebaseAuth } from '@/core/firebase/firebaseClient';
import { useConnectivityStore } from '@/core/connectivity/useConnectivityStore';
import { runAll } from '@/core/offline/QueueProcessor';
import { getQueue, dequeue, updateMutation } from '@/core/offline/mutationQueue';
import {
  APP_VERSION, BUILD_NUMBER, ENVIRONMENT, FIREBASE_PROJECT, API_VERSION, getLastSuccessfulSync,
} from '@/core/diagnostics/deviceInfo';
import { exportLogs, clearPersistedLogs, getPersistedLogs } from '@/core/logging/logger';
import { colors, radius, shadow } from '@/core/ui/theme/colors';

const SYNC_LABEL: Record<string, string> = {
  synced: '🟢  Synced',
  'pending-sync': '🟡  Pending Sync',
  offline: '🔴  Offline',
  'sync-failed': '🔴  Sync Failed',
};

// Settings is a tab screen — we use useNavigation to access the root stack
type SettingsNavProp = NativeStackNavigationProp<RootStackParamList>;

export function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<SettingsNavProp>();
  const { user, signOut } = useAuthStore();
  const { syncStatus } = useConnectivityStore();
  const [isSyncing, setIsSyncing] = useState(false);

  const queue = getQueue();
  const pending = queue.filter(m => m.status === 'pending' || m.status === 'syncing');
  const failed = queue.filter(m => m.status === 'failed');

  async function handleLogout() {
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out', style: 'destructive',
        onPress: async () => {
          await firebaseSignOut(getFirebaseAuth()).catch(() => {});
          signOut();
        },
      },
    ]);
  }

  async function handleSyncNow() {
    setIsSyncing(true);
    try { await runAll(); } finally { setIsSyncing(false); }
  }

  function handleRetry(id: string) {
    updateMutation(id, { status: 'pending', retryCount: 0 });
    void runAll();
  }

  function handleDiscard(id: string) {
    Alert.alert('Discard Operation', 'Remove this failed operation from the queue?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: () => dequeue(id) },
    ]);
  }

  async function handleExportLogs() {
    try {
      const text = exportLogs();
      await Share.share({ message: text, title: 'DAJAJ Finance Log' });
    } catch {
      Alert.alert('Export Failed', 'Could not open share sheet.');
    }
  }

  function handleClearLogs() {
    Alert.alert(
      'Clear Logs',
      'This will permanently delete all stored logs. Continue?',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Clear', style: 'destructive', onPress: () => clearPersistedLogs() },
      ],
    );
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={[styles.content, { paddingTop: insets.top + 16 }]}>
      <StatusBar barStyle="dark-content" backgroundColor={colors.pageBg} />

      {/* Page header */}
      <View style={styles.headerCard}>
        <Text style={styles.financeLabel}>Finance</Text>
        <Text style={styles.pageTitle}>Settings</Text>
      </View>

      {/* Identity */}
      <Text style={styles.groupLabel}>Identity</Text>
      <View style={styles.card}>
        <Row label="Name" value={user?.fullName ?? '—'} />
        <Row label="Email" value={user?.email ?? '—'} />
        <Row
          label="Role"
          value={user?.role === 'admin' ? 'Administrator' : user?.role === 'financeManager' ? 'Finance Manager' : '—'}
          last
        />
      </View>

      {/* Sync */}
      <Text style={styles.groupLabel}>Sync</Text>
      <View style={styles.card}>
        <Row label="Status" value={SYNC_LABEL[syncStatus] ?? syncStatus} />

        {failed.length > 0 && (
          <View style={styles.failedSection}>
            <Text style={styles.failedHeader}>Failed Operations ({failed.length})</Text>
            {failed.map(m => (
              <View key={m.id} style={styles.failedRow}>
                <Text style={styles.failedOp} numberOfLines={1}>{m.operation} · {m.targetDate}</Text>
                <TouchableOpacity onPress={() => handleRetry(m.id)} style={styles.retryBtn} activeOpacity={0.7}>
                  <Text style={styles.retryText}>Retry</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => handleDiscard(m.id)} style={styles.discardBtn} activeOpacity={0.7}>
                  <Text style={styles.discardText}>Discard</Text>
                </TouchableOpacity>
              </View>
            ))}
          </View>
        )}

        <TouchableOpacity
          onPress={handleSyncNow}
          disabled={isSyncing}
          style={[styles.syncBtn, isSyncing && styles.syncBtnDisabled]}
          activeOpacity={0.8}
        >
          <Text style={styles.syncBtnText}>{isSyncing ? 'Syncing…' : 'Sync Now'}</Text>
        </TouchableOpacity>
      </View>

      {/* Diagnostics */}
      <Text style={styles.groupLabel}>Diagnostics</Text>
      <View style={styles.card}>
        <Row label="App Version" value={APP_VERSION} />
        <Row label="Build" value={BUILD_NUMBER} />
        <Row label="Environment" value={ENVIRONMENT} />
        <Row label="Firebase Project" value={FIREBASE_PROJECT} />
        <Row label="API Version" value={`v${API_VERSION}`} />
        <Row label="Last Sync" value={getLastSuccessfulSync() ?? 'Never'} />
        <Row label="Queue Size" value={String(queue.length)} testID="queue-size" />
        <Row label="Pending" value={String(pending.length)} testID="pending-ops" />
        <Row label="Failed" value={String(failed.length)} testID="failed-ops" />
        <Row label="Log Entries" value={String(getPersistedLogs().length)} last />

        {/* Log actions */}
        <View style={styles.logActions}>
          <TouchableOpacity
            style={styles.logBtn}
            onPress={() => navigation.push('LogViewer')}
            activeOpacity={0.8}
          >
            <Text style={styles.logBtnText}>📋  View Logs</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.logBtn}
            onPress={handleExportLogs}
            activeOpacity={0.8}
          >
            <Text style={styles.logBtnText}>⬆  Export</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.logBtn, styles.logBtnDestructive]}
            onPress={handleClearLogs}
            activeOpacity={0.8}
          >
            <Text style={[styles.logBtnText, { color: colors.rose700 }]}>🗑  Clear</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Logout */}
      <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout} activeOpacity={0.85}>
        <Text style={styles.logoutText}>Sign Out</Text>
      </TouchableOpacity>

      <Text style={styles.footer}>DAJAJ Finance · v{APP_VERSION}</Text>
    </ScrollView>
  );
}

function Row({ label, value, testID, last }: { label: string; value: string; testID?: string; last?: boolean }) {
  return (
    <View style={[styles.row, last && styles.rowLast]}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue} testID={testID} numberOfLines={1}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.pageBg },
  content: { paddingBottom: 48 },
  headerCard: {
    backgroundColor: colors.white,
    borderBottomWidth: 1,
    borderBottomColor: colors.orangeCardBorder,
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 16,
    marginBottom: 8,
  },
  financeLabel: {
    fontSize: 11, fontWeight: '700', letterSpacing: 4,
    textTransform: 'uppercase', color: colors.orange600, marginBottom: 2,
  },
  pageTitle: { fontSize: 24, fontWeight: '900', color: colors.slate900 },
  groupLabel: {
    fontSize: 11, fontWeight: '700', letterSpacing: 2,
    textTransform: 'uppercase', color: colors.slate400,
    marginHorizontal: 20, marginTop: 20, marginBottom: 8,
  },
  card: {
    backgroundColor: colors.white,
    marginHorizontal: 16,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    paddingVertical: 4,
    paddingHorizontal: 16,
    ...shadow.card,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.slate50,
  },
  rowLast: { borderBottomWidth: 0 },
  rowLabel: { fontSize: 14, color: colors.slate600, flex: 1 },
  rowValue: { fontSize: 14, color: colors.slate900, fontWeight: '600', maxWidth: '55%', textAlign: 'right' },
  failedSection: {
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.slate50,
  },
  failedHeader: { fontSize: 12, fontWeight: '700', color: colors.rose700, marginBottom: 8 },
  failedRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8, gap: 6 },
  failedOp: { flex: 1, fontSize: 12, color: colors.slate600 },
  retryBtn: { backgroundColor: colors.slate50, borderRadius: radius.sm, paddingHorizontal: 10, paddingVertical: 5, borderWidth: 1, borderColor: colors.slate200 },
  retryText: { fontSize: 12, color: colors.slate900, fontWeight: '700' },
  discardBtn: { backgroundColor: colors.rose50, borderRadius: radius.sm, paddingHorizontal: 10, paddingVertical: 5, borderWidth: 1, borderColor: colors.rose200 },
  discardText: { fontSize: 12, color: colors.rose700, fontWeight: '700' },
  syncBtn: {
    marginVertical: 10,
    backgroundColor: colors.slateBtnBg,
    borderRadius: radius.inner,
    paddingVertical: 12,
    alignItems: 'center',
  },
  syncBtnDisabled: { opacity: 0.5 },
  syncBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  logoutBtn: {
    marginHorizontal: 16,
    marginTop: 24,
    backgroundColor: '#dc2626',
    borderRadius: radius.inner,
    paddingVertical: 14,
    alignItems: 'center',
  },
  logoutText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  footer: { textAlign: 'center', marginTop: 20, fontSize: 12, color: colors.slate400 },
  logActions: {
    flexDirection: 'row',
    paddingTop: 10,
    paddingBottom: 4,
    gap: 8,
  },
  logBtn: {
    flex: 1,
    backgroundColor: colors.slate50,
    borderRadius: radius.inner,
    borderWidth: 1,
    borderColor: colors.slate200,
    paddingVertical: 9,
    alignItems: 'center',
  },
  logBtnDestructive: {
    borderColor: '#fecaca',
    backgroundColor: colors.rose50,
  },
  logBtnText: { fontSize: 12, fontWeight: '700', color: colors.slate700 },
});
