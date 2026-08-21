/**
 * DateNav — day navigation for the Daily Closing screen.
 * ‹ previous day · tappable date opens native picker (capped at today) · next day ›
 * Next is disabled on today; future dates are never selectable (matches web).
 */
import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { toDateKey, formatDateDisplay } from '@/modules/daily-closing/utils/dateUtils';
import { colors, radius } from '@/core/ui/theme/colors';

interface Props {
  date: string;
  onChange: (dateKey: string) => void;
}

function shiftDay(dateKey: string, days: number): string {
  const d = new Date(`${dateKey}T00:00:00`);
  d.setDate(d.getDate() + days);
  return toDateKey(d);
}

export function DateNav({ date, onChange }: Props) {
  const [showPicker, setShowPicker] = useState(false);
  const today = toDateKey();
  const isToday = date === today;
  const isFuture = date > today;

  return (
    <View style={styles.row}>
      <TouchableOpacity
        style={styles.arrowBtn}
        onPress={() => onChange(shiftDay(date, -1))}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        testID="prev-day-button"
      >
        <Text style={styles.arrowText}>‹</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.dateBtn} onPress={() => setShowPicker(true)} activeOpacity={0.7}>
        <Text style={styles.dateText} numberOfLines={1}>
          {formatDateDisplay(date)}
          {isToday ? ' · Today' : ''}
        </Text>
        <Text style={styles.calendarIcon}>📅</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.arrowBtn, (isToday || isFuture) && styles.arrowBtnDisabled]}
        onPress={() => !isToday && !isFuture && onChange(shiftDay(date, 1))}
        disabled={isToday || isFuture}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        testID="next-day-button"
      >
        <Text style={[styles.arrowText, (isToday || isFuture) && styles.arrowTextDisabled]}>›</Text>
      </TouchableOpacity>

      {showPicker && (
        <DateTimePicker
          value={new Date(`${date}T00:00:00`)}
          mode="date"
          display="default"
          maximumDate={new Date()}
          onChange={(_, selected) => {
            setShowPicker(false);
            if (selected) onChange(toDateKey(selected));
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 10,
  },
  arrowBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.slate50,
    borderWidth: 1,
    borderColor: colors.slate200,
    alignItems: 'center',
    justifyContent: 'center',
  },
  arrowBtnDisabled: { opacity: 0.35 },
  arrowText: { fontSize: 22, lineHeight: 26, color: colors.slate700, fontWeight: '700' },
  arrowTextDisabled: { color: colors.slate400 },
  dateBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: colors.slate50,
    borderWidth: 1,
    borderColor: colors.slate200,
    borderRadius: radius.inner,
    paddingVertical: 7,
    paddingHorizontal: 10,
  },
  dateText: { fontSize: 13, fontWeight: '600', color: colors.slate900, flexShrink: 1 },
  calendarIcon: { fontSize: 14 },
});
