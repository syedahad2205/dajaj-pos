/**
 * AddExpenseModal (Requirement 7.1, design §10.4).
 * Fields: Category (picker), Amount (numeric), Remarks (optional).
 * Save disabled until Category set AND Amount is a positive finite number.
 */
import React from 'react';
import { View, Text, TextInput, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { useForm, Controller } from 'react-hook-form';
import { Modal } from '@/core/ui/components/Modal';
import { Button } from '@/core/ui/components/Button';
import { useExpenseCategories } from '@/modules/daily-closing/hooks/useExpenseCategories';
import type { FinanceExpenseCategory } from '@/modules/daily-closing/types';

interface FormValues {
  categoryId: string;
  amount: string;
  remarks: string;
}

interface Props {
  visible: boolean;
  onClose: () => void;
  onSave: (input: { categoryId: string; amount: number; remarks?: string }) => void;
  isSaving: boolean;
  saveError?: string | null;
}

export function AddExpenseModal({ visible, onClose, onSave, isSaving, saveError }: Props) {
  const { data: categories = [] } = useExpenseCategories();
  const { control, handleSubmit, watch, reset, formState: { errors } } = useForm<FormValues>({
    defaultValues: { categoryId: '', amount: '', remarks: '' },
  });

  const categoryId = watch('categoryId');
  const amount = watch('amount');
  const parsedAmount = parseFloat(amount);
  // Save enabled only when category set AND amount is a positive finite number (Requirement 7.1)
  const canSave = categoryId.trim() !== '' && Number.isFinite(parsedAmount) && parsedAmount > 0 && !isSaving;

  function handleClose() {
    reset();
    onClose();
  }

  function onSubmit(values: FormValues) {
    onSave({ categoryId: values.categoryId, amount: parseFloat(values.amount), remarks: values.remarks || undefined });
  }

  return (
    <Modal visible={visible} title="Add Expense" onClose={handleClose}>
      <View style={styles.form}>
        {/* Category picker */}
        <Text style={styles.label}>Category *</Text>
        <Controller
          control={control}
          name="categoryId"
          render={({ field: { onChange, value } }) => (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chips}>
              {categories.map((cat: FinanceExpenseCategory) => (
                <TouchableOpacity
                  key={cat.id}
                  style={[styles.chip, value === cat.id && styles.chipSelected]}
                  onPress={() => onChange(cat.id)}
                  testID={`category-chip-${cat.id}`}
                >
                  <Text style={[styles.chipText, value === cat.id && styles.chipTextSelected]}>
                    {cat.name}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}
        />

        {/* Amount */}
        <Text style={styles.label}>Amount *</Text>
        <Controller
          control={control}
          name="amount"
          render={({ field: { onChange, value, onBlur } }) => (
            <TextInput
              style={styles.input}
              value={value}
              onChangeText={onChange}
              onBlur={onBlur}
              keyboardType="decimal-pad"
              placeholder="0.00"
              testID="expense-amount-input"
            />
          )}
        />

        {/* Remarks */}
        <Text style={styles.label}>Remarks (optional)</Text>
        <Controller
          control={control}
          name="remarks"
          render={({ field: { onChange, value, onBlur } }) => (
            <TextInput
              style={styles.input}
              value={value}
              onChangeText={onChange}
              onBlur={onBlur}
              placeholder="e.g. Vegetable purchase"
            />
          )}
        />

        {saveError && <Text style={styles.error}>{saveError}</Text>}

        <Button
          title="Save Expense"
          onPress={handleSubmit(onSubmit)}
          disabled={!canSave}
          loading={isSaving}
          testID="save-expense-button"
          style={styles.saveBtn}
        />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  form: { paddingBottom: 20 },
  label: { fontSize: 13, fontWeight: '600', color: '#444', marginBottom: 6 },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 10, fontSize: 16, marginBottom: 16 },
  chips: { marginBottom: 16 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: '#f1f3f4', marginRight: 8 },
  chipSelected: { backgroundColor: '#1a73e8' },
  chipText: { color: '#333', fontSize: 13 },
  chipTextSelected: { color: '#fff', fontWeight: '600' },
  error: { color: '#c62828', marginBottom: 12, fontSize: 13 },
  saveBtn: { marginTop: 4 },
});
