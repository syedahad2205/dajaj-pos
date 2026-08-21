/**
 * KeyboardDoneBar — "Done" input accessory for numeric keyboards.
 *
 * iOS decimal-pad / number-pad keyboards have NO return key, so without this
 * bar there is no way to dismiss the keyboard except tapping outside the
 * input. This renders a slim toolbar above the keyboard with a Done button
 * that dismisses it.
 *
 * Usage: pass `inputAccessoryID` to any TextInput along with
 *   <KeyboardDoneBar nativeID={inputAccessoryID} />
 * rendered once near the screen root (or inside each card — the views are
 * cheap and only mount while the keyboard is open on iOS).
 *
 * Android keyboards always have a back/dismiss affordance, so this is a no-op
 * there.
 */
import React from 'react';
import { Platform, Text, TouchableOpacity, View, StyleSheet } from 'react-native';
import { Keyboard } from 'react-native';
import { InputAccessoryView } from 'react-native';
import { colors } from '@/core/ui/theme/colors';

interface Props {
  /** Must match the TextInput's inputAccessoryViewID — use a unique string per screen */
  nativeID: string;
  label?: string;
}

export function KeyboardDoneBar({ nativeID, label = 'Done' }: Props) {
  if (Platform.OS !== 'ios') return null;

  return (
    <InputAccessoryView nativeID={nativeID}>
      <View style={styles.bar}>
        <TouchableOpacity
          style={styles.doneBtn}
          onPress={() => Keyboard.dismiss()}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Text style={styles.doneText}>{label}</Text>
        </TouchableOpacity>
      </View>
    </InputAccessoryView>
  );
}

const styles = StyleSheet.create({
  bar: {
    backgroundColor: colors.slate100,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.slate200,
    alignItems: 'flex-end',
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  doneBtn: {
    backgroundColor: colors.slateBtnBg,
    borderRadius: 10,
    paddingHorizontal: 18,
    paddingVertical: 7,
  },
  doneText: { color: '#fff', fontSize: 14, fontWeight: '700' },
});
