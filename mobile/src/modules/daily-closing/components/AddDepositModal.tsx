/**
 * AddDepositModal (Requirement 7.2, design §10.4).
 * Fields: Deposit Type (picker from SUPPORTED_CASH_DEPOSIT_TYPES), Amount, Remarks (optional).
 */
import React from 'react';
import { View, Text, TextInput, StyleSheet, TouchableOpacity } from 'react-native';
import { useForm, Controller } from 'react-hook-form';
import { Modal } from '@/core/ui/components/Modal';
import { Button } from '@/core/ui/components/Button';
import { KeyboardDoneBar } from '@/core/ui/components/KeyboardDoneBar';
import { SUPPORTED_CASH_DEPOSIT_TYPES, CASH_DEPOSIT_TYPE_LABELS, type CashDepositType } from '@/constants/finance';
import { colors, radius } from '@/core/ui/theme/colors';

interface FormValues { type: CashDepositType | ''; amount: string; remarks: string; }

interface Props {
  visible: boolean; onClose: () => void;
  onSave: (input: { type: CashDepositType; amount: number; remarks?: string }) => void;
  isSaving: boolean; saveError?: string | null;
}

export function AddDepositModal({ visible, onClose, onSave, isSaving, saveError }: Props) {
  const { control, handleSubmit, watch, reset } = useForm<FormValues>({
    defaultValues: { type: '', amount: '', remarks: '' },
  });
  const type = watch('type');
  const amount = watch('amount');
  const parsedAmount = parseFloat(amount);
  const canSave = type !== '' && Number.isFinite(parsedAmount) && parsedAmount > 0 && !isSaving;

  function handleClose() { reset(); onClose(); }
  function onSubmit(values: FormValues) {
    onSave({ type: values.type as CashDepositType, amount: parseFloat(values.amount), remarks: values.remarks || undefined });
  }

  return (
    <Modal visible={visible} title="Add Deposit" onClose={handleClose}>
      <KeyboardDoneBar nativeID="add-deposit-modal-kb" />
      <View style={styles.form}>
        <Text style={styles.label}>Deposit Type *</Text>
        <Controller control={control} name="type" render={({ field: { onChange, value } }) => (
          <View style={styles.chips}>
            {SUPPORTED_CASH_DEPOSIT_TYPES.map(t => (
              <TouchableOpacity key={t} style={[styles.chip, value === t && styles.chipSelected]} onPress={() => onChange(t)}>
                <Text style={[styles.chipText, value === t && styles.chipTextSelected]}>{CASH_DEPOSIT_TYPE_LABELS[t]}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )} />

        <Text style={styles.label}>Amount *</Text>
        <Controller control={control} name="amount" render={({ field: { onChange, value, onBlur } }) => (
          <TextInput style={styles.input} value={value} onChangeText={onChange} onBlur={onBlur} keyboardType="decimal-pad" placeholder="0.00" placeholderTextColor={colors.slate400} testID="deposit-amount-input" inputAccessoryViewID="add-deposit-modal-kb" />
        )} />

        <Text style={styles.label}>Remarks (optional)</Text>
        <Controller control={control} name="remarks" render={({ field: { onChange, value, onBlur } }) => (
          <TextInput style={styles.input} value={value} onChangeText={onChange} onBlur={onBlur} placeholder="e.g. Daily Pigmi" placeholderTextColor={colors.slate400} />
        )} />

        {saveError && <Text style={styles.error}>{saveError}</Text>}
        <Button title="Save Deposit" onPress={handleSubmit(onSubmit)} disabled={!canSave} loading={isSaving} testID="save-deposit-button" style={styles.saveBtn} />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  form: { paddingBottom: 20 },
  label: { fontSize: 11, fontWeight: '600', color: colors.slate500, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 },
  input: {
    backgroundColor: colors.slate50, borderWidth: 1, borderColor: colors.slate200, borderRadius: radius.sm,
    paddingHorizontal: 12, paddingVertical: 10, fontSize: 16, color: colors.slate900, marginBottom: 16,
    fontVariant: ['tabular-nums'],
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.full, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.slate200 },
  chipSelected: { backgroundColor: colors.slateBtnBg, borderColor: colors.slateBtnBg },
  chipText: { color: colors.slate700, fontSize: 13, fontWeight: '600' },
  chipTextSelected: { color: '#fff' },
  error: { color: colors.rose600, marginBottom: 12, fontSize: 13 },
  saveBtn: { marginTop: 4 },
});
