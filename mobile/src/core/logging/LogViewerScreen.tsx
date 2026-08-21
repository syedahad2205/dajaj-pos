/**
 * LogViewerScreen — view, filter, export and clear the persistent application log.
 *
 * Accessible from SettingsScreen > Diagnostics > View Logs.
 * The export produces a plain-text blob suitable for attaching to bug reports.
 */
import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Alert,
  Share,
  StatusBar,
  FlatList,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  getPersistedLogs,
  clearPersistedLogs,
  exportLogs,
  type LogEntry,
  type LogLevel,
  type LogCategory,
} from '@/core/logging/logger';
import { colors, radius, shadow } from '@/core/ui/theme/colors';

// ─── Navigation type (AppNavigator must include this screen) ─────────────────
// The screen is pushed from SettingsScreen via navigation.push('LogViewer').
// Parent navigator type is intentionally loose here to avoid circular deps.
type Props = NativeStackScreenProps<Record<string, object | undefined>, 'LogViewer'>;

// ─── Level colours ────────────────────────────────────────────────────────────

const LEVEL_COLOR: Record<LogLevel, string> = {
  TRACE: '#94a3b8',
  DEBUG: '#64748b',
  INFO:  '#0ea5e9',
  WARN:  '#f59e0b',
  ERROR: '#ef4444',
};

const CATEGORY_LABEL: Record<LogCategory, string> = {
  network:      '🌐 network',
  auth:         '🔐 auth',
  firebase:     '🔥 firebase',
  sync:         '🔄 sync',
  queue:        '📋 queue',
  connectivity: '📶 conn',
  error:        '💥 error',
  app:          '📱 app',
};

const ALL_LEVELS: LogLevel[] = ['TRACE', 'DEBUG', 'INFO', 'WARN', 'ERROR'];

// ─── Component ────────────────────────────────────────────────────────────────

export function LogViewerScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const [entries, setEntries] = useState<LogEntry[]>(() => getPersistedLogs());
  const [search, setSearch] = useState('');
  const [levelFilter, setLevelFilter] = useState<LogLevel | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const refresh = useCallback(() => {
    setEntries(getPersistedLogs());
  }, []);

  const filtered = useMemo(() => {
    return entries.filter(e => {
      if (levelFilter && e.level !== levelFilter) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        if (
          !e.message.toLowerCase().includes(q) &&
          !e.category.toLowerCase().includes(q) &&
          !JSON.stringify(e.data ?? {}).toLowerCase().includes(q)
        ) return false;
      }
      return true;
    });
  }, [entries, search, levelFilter]);

  function toggleExpanded(id: string) {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function handleExport() {
    const text = exportLogs();
    try {
      await Share.share({ message: text, title: 'DAJAJ Finance Log' });
    } catch {
      Alert.alert('Export Failed', 'Could not open share sheet.');
    }
  }

  function handleClear() {
    Alert.alert(
      'Clear Logs',
      'This will permanently delete all stored logs. Continue?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear', style: 'destructive',
          onPress: () => {
            clearPersistedLogs();
            setEntries([]);
          },
        },
      ],
    );
  }

  const renderItem = useCallback(({ item: e }: { item: LogEntry }) => {
    const isExp = expanded.has(e.id);
    const hasData = e.data && Object.keys(e.data).length > 0;
    const time = e.timestamp.slice(11, 23); // HH:MM:SS.mmm

    return (
      <TouchableOpacity
        onPress={() => hasData && toggleExpanded(e.id)}
        activeOpacity={hasData ? 0.7 : 1}
        style={styles.entry}
      >
        <View style={styles.entryHeader}>
          <Text style={[styles.entryLevel, { color: LEVEL_COLOR[e.level] }]}>{e.level}</Text>
          <Text style={styles.entryCategory}>{CATEGORY_LABEL[e.category] ?? e.category}</Text>
          <Text style={styles.entryTime}>{time}</Text>
        </View>
        <Text style={styles.entryMessage} numberOfLines={isExp ? undefined : 2}>{e.message}</Text>
        {isExp && hasData && (
          <Text style={styles.entryData}>{JSON.stringify(e.data, null, 2)}</Text>
        )}
        {!isExp && hasData && (
          <Text style={styles.expandHint}>tap to expand</Text>
        )}
      </TouchableOpacity>
    );
  }, [expanded]);

  return (
    <View style={styles.root}>
      <StatusBar barStyle="dark-content" backgroundColor={colors.pageBg} />

      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backText}>‹ Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>App Logs</Text>
        <Text style={styles.count}>{filtered.length}/{entries.length}</Text>
      </View>

      {/* Toolbar */}
      <View style={styles.toolbar}>
        <TextInput
          style={styles.searchInput}
          placeholder="Search…"
          placeholderTextColor={colors.slate400}
          value={search}
          onChangeText={setSearch}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <TouchableOpacity onPress={refresh} style={styles.toolBtn}>
          <Text style={styles.toolBtnText}>↻</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={handleExport} style={styles.toolBtn}>
          <Text style={styles.toolBtnText}>⬆</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={handleClear} style={[styles.toolBtn, styles.clearBtn]}>
          <Text style={[styles.toolBtnText, { color: '#ef4444' }]}>🗑</Text>
        </TouchableOpacity>
      </View>

      {/* Level filter pills */}
      <View style={styles.pills}>
        <TouchableOpacity
          onPress={() => setLevelFilter(null)}
          style={[styles.pill, levelFilter === null && styles.pillActive]}
        >
          <Text style={[styles.pillText, levelFilter === null && styles.pillTextActive]}>ALL</Text>
        </TouchableOpacity>
        {ALL_LEVELS.map(level => (
          <TouchableOpacity
            key={level}
            onPress={() => setLevelFilter(levelFilter === level ? null : level)}
            style={[styles.pill, levelFilter === level && styles.pillActive, { borderColor: LEVEL_COLOR[level] }]}
          >
            <Text style={[styles.pillText, levelFilter === level && { color: LEVEL_COLOR[level] }]}>{level}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Log list */}
      {filtered.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>No log entries{search || levelFilter ? ' matching filter' : ''}.</Text>
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={e => e.id}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          initialNumToRender={30}
          maxToRenderPerBatch={20}
          windowSize={10}
        />
      )}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.pageBg },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 10,
    backgroundColor: colors.white,
    borderBottomWidth: 1,
    borderBottomColor: colors.orangeCardBorder,
  },
  backBtn: { marginRight: 12 },
  backText: { fontSize: 16, color: colors.orange600, fontWeight: '600' },
  title: { flex: 1, fontSize: 18, fontWeight: '800', color: colors.slate900 },
  count: { fontSize: 12, color: colors.slate400 },

  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 8,
    backgroundColor: colors.white,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.cardBorder,
  },
  searchInput: {
    flex: 1,
    backgroundColor: colors.slate50,
    borderRadius: radius.inner,
    borderWidth: 1,
    borderColor: colors.slate200,
    paddingHorizontal: 10,
    paddingVertical: 6,
    fontSize: 13,
    color: colors.slate900,
  },
  toolBtn: {
    backgroundColor: colors.slate50,
    borderRadius: radius.inner,
    borderWidth: 1,
    borderColor: colors.slate200,
    paddingHorizontal: 10,
    paddingVertical: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  clearBtn: { borderColor: '#fecaca' },
  toolBtnText: { fontSize: 16, color: colors.slate700 },

  pills: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: colors.white,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.cardBorder,
  },
  pill: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 99,
    borderWidth: 1,
    borderColor: colors.slate200,
    backgroundColor: colors.slate50,
  },
  pillActive: { backgroundColor: colors.slate900, borderColor: colors.slate900 },
  pillText: { fontSize: 10, fontWeight: '700', color: colors.slate500 },
  pillTextActive: { color: '#fff' },

  list: { padding: 8, gap: 4 },

  entry: {
    backgroundColor: colors.white,
    borderRadius: radius.inner,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    padding: 10,
    ...shadow.card,
  },
  entryHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 3 },
  entryLevel: { fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },
  entryCategory: { fontSize: 10, color: colors.slate500, flex: 1 },
  entryTime: { fontSize: 10, color: colors.slate400, fontFamily: 'monospace' },
  entryMessage: { fontSize: 12, color: colors.slate800, lineHeight: 16 },
  entryData: {
    marginTop: 6,
    fontSize: 10,
    color: colors.slate600,
    fontFamily: 'monospace',
    backgroundColor: colors.slate50,
    borderRadius: 4,
    padding: 6,
    lineHeight: 15,
  },
  expandHint: { fontSize: 10, color: colors.slate400, marginTop: 2 },

  empty: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyText: { fontSize: 14, color: colors.slate400 },
});
