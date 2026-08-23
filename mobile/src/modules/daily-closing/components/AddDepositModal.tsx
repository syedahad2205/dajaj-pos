/**
 * AddDepositModal — centered fixed dialog, same pattern as AddExpenseModal.
 * No KeyboardAvoidingView, no shared Modal, no KeyboardDoneBar.
 * Dialog sits in the upper screen area so keyboard never reaches it.
 */
import React, { useRef, useState } from 'react';
import {
  Keyboard,
  Modal as RNModal,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Button } from '@/core/ui/components/Button';
import {
  SUPPORTED_CASH_DEPOSIT_TYPES,
  CASH_DEPOSIT_TYPE_LABELS,
  type CashDepositType,
} from '@/constants/finance';
import { colors, radius } from '@/core/ui/theme/colors';

interface Props {
  visible: boolean;
  onClose: () => void;
  onSave: (input: { type: CashDepositType; amount: number; remarks?: string }) => void;
  isSaving: boolean;
  saveError?: string | null;
}

export function AddDepositModal({ visible, onClose, onSave, isSaving, saveError }: Props) {
  const [type, setType] = useState<CashDepositType | ''>('');
  const [amount, setAmount] = useState('');
  const [remarks, setRemarks] = useState('');
  const remarksRef = useRef<TextInput>(null);

  const parsedAmount = parseFloat(amount);
  const canSave =
    type !== '' &&
    Number.isFinite(parsedAmount) &&
    parsedAmount > 0 &&
    !isSaving;

  function handleClose() {
    Keyboard.dismiss();
    setType('');
    setAmount('');
    setRemarks('');
    onClose();
  }

  function handleSave() {
    if (!canSave || !type) return;
    Keyboard.dismiss();
    onSave({ type, amount: parsedAmount, remarks: remarks || undefined });
  }

  return (
    <RNModal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={handleClose}
      onShow={() => Keyboard.dismiss()}
    >
      <View style={styles.overlay}>
        <View style={styles.dialog}>

          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.title}>Add Deposit</Text>
            <TouchableOpacity
              onPress={handleClose}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Text style={styles.closeIcon}>✕</Text>
            </TouchableOpacity>
          </View>

          {/* Deposit type chips */}
          <Text style={styles.label}>Deposit Type</Text>
          <View style={styles.chips}>
            {SUPPORTED_CASH_DEPOSIT_TYPES.map(t => (
              <TouchableOpacity
                key={t}
                style={[styles.chip, type === t && styles.chipActive]}
                onPress={() => setType(t)}
                activeOpacity={0.7}
              >
                <Text style={[styles.chipText, type === t && styles.chipTextActive]}>
                  {CASH_DEPOSIT_TYPE_LABELS[t]}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Amount */}
          <Text style={styles.label}>Amount</Text>
          <View style={styles.amountBox}>
            <Text style={styles.rupee}>₹</Text>
            <TextInput
              style={styles.amountInput}
              value={amount}
              onChangeText={setAmount}
              keyboardType="decimal-pad"
              placeholder="0"
              placeholderTextColor={colors.slate400}
              selectTextOnFocus
              returnKeyType="next"
              onSubmitEditing={() => remarksRef.current?.focus()}
            />
          </View>

          {/* Remarks */}
          <Text style={styles.label}>Remarks (optional)</Text>
          <TextInput
            ref={remarksRef}
            style={styles.remarksInput}
            value={remarks}
            onChangeText={setRemarks}
            placeholder="e.g. Daily Pigmi"
            placeholderTextColor={colors.slate400}
            returnKeyType="done"
            onSubmitEditing={handleSave}
          />

          {saveError ? <Text style={styles.error}>{saveError}</Text> : null}

          <Button
            title="Save Deposit"
            onPress={handleSave}
            disabled={!canSave}
            loading={isSaving}
            testID="save-deposit-button"
            style={styles.saveBtn}
          />
        </View>
      </View>
    </RNModal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'flex-start',
    paddingTop: 64,
    paddingHorizontal: 20,
  },
  dialog: {
    backgroundColor: colors.white,
    borderRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 20,
  },

  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.slate900,
  },
  closeIcon: {
    fontSize: 20,
    color: colors.slate500,
  },

  label: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.slate500,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 8,
  },

  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 20,
  },
  chip: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: radius.full,
    backgroundColor: colors.slate100,
    borderWidth: 1.5,
    borderColor: colors.slate200,
  },
  chipActive: {
    backgroundColor: colors.slateBtnBg,
    borderColor: colors.slateBtnBg,
  },
  chipText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.slate700,
  },
  chipTextActive: {
    color: '#fff',
  },

  amountBox: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: colors.slate200,
    borderRadius: radius.sm,
    backgroundColor: colors.white,
    paddingHorizontal: 12,
    marginBottom: 20,
  },
  rupee: {
    fontSize: 16,
    color: colors.slate500,
    marginRight: 4,
  },
  amountInput: {
    flex: 1,
    fontSize: 20,
    fontWeight: '700',
    color: colors.slate900,
    paddingVertical: 10,
    fontVariant: ['tabular-nums'],
  },

  remarksInput: {
    backgroundColor: colors.slate50,
    borderWidth: 1,
    borderColor: colors.slate200,
    borderRadius: radius.sm,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: colors.slate900,
    marginBottom: 4,
  },

  error: {
    color: colors.rose600,
    fontSize: 13,
    marginTop: 8,
    marginBottom: 4,
  },
  saveBtn: {
    marginTop: 16,
  },
});
