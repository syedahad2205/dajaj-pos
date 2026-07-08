/**
 * AddDepositModal (Requirement 7.2, design §10.4).
 * Fields: Deposit Type (picker from SUPPORTED_CASH_DEPOSIT_TYPES), Amount, Remarks (optional).
 */
import React from 'react';
import { View, Text, TextInput, StyleSheet, TouchableOpacity } from 'react-native';
import { useForm, Controller } from 'react-hook-form';
import { Modal } from '@/core/ui/components/Modal';
import { Button } from '@/core/ui/components/Button';
import { SUPPORTED_CASH_DEPOSIT_TYPES, CASH_DEPOSIT_TYPE_LABELS, type CashDepositType } from '@/constants/finance';

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
          <TextInput style={styles.input} value={value} onChangeText={onChange} onBlur={onBlur} keyboardType="decimal-pad" placeholder="0.00" testID="deposit-amount-input" />
        )} />

        <Text style={styles.label}>Remarks (optional)</Text>
        <Controller control={control} name="remarks" render={({ field: { onChange, value, onBlur } }) => (
          <TextInput style={styles.input} value={value} onChangeText={onChange} onBlur={onBlur} placeholder="e.g. Daily Pigmi" />
        )} />

        {saveError && <Text style={styles.error}>{saveError}</Text>}
        <Button title="Save Deposit" onPress={handleSubmit(onSubmit)} disabled={!canSave} loading={isSaving} testID="save-deposit-button" style={styles.saveBtn} />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  form: { paddingBottom: 20 },
  label: { fontSize: 13, fontWeight: '600', color: '#444', marginBottom: 6 },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 10, fontSize: 16, marginBottom: 16 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 16 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: '#f1f3f4', marginRight: 8, marginBottom: 8 },
  chipSelected: { backgroundColor: '#1a73e8' },
  chipText: { color: '#333', fontSize: 13 },
  chipTextSelected: { color: '#fff', fontWeight: '600' },
  error: { color: '#c62828', marginBottom: 12, fontSize: 13 },
  saveBtn: { marginTop: 4 },
});
