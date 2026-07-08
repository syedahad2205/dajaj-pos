import React from 'react';
import { TouchableOpacity, Text, ActivityIndicator, StyleSheet, type TouchableOpacityProps, type StyleProp, type ViewStyle } from 'react-native';
import { colors, radius } from '@/core/ui/theme/colors';

interface Props extends TouchableOpacityProps {
  title: string;
  loading?: boolean;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  style?: StyleProp<ViewStyle>;
}

export function Button({ title, loading, variant = 'primary', style, disabled, ...rest }: Props) {
  const isDisabled = disabled || loading;
  return (
    <TouchableOpacity
      style={[styles.base, styles[variant], isDisabled && styles.disabled, style]}
      disabled={isDisabled}
      activeOpacity={0.85}
      {...rest}
    >
      {loading
        ? <ActivityIndicator color={variant === 'primary' || variant === 'danger' ? '#fff' : colors.slate900} />
        : <Text style={[styles.text, styles[`${variant}Text` as keyof typeof styles] as object]}>{title}</Text>
      }
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  base: { borderRadius: radius.inner, paddingVertical: 12, paddingHorizontal: 18, alignItems: 'center' },
  primary: { backgroundColor: colors.slateBtnBg },
  secondary: { backgroundColor: colors.white, borderWidth: 1, borderColor: colors.slate200 },
  danger: { backgroundColor: '#dc2626' },
  ghost: { backgroundColor: 'transparent' },
  disabled: { opacity: 0.4 },
  text: { fontSize: 14, fontWeight: '700' },
  primaryText: { color: '#fff' },
  secondaryText: { color: colors.slate900 },
  dangerText: { color: '#fff' },
  ghostText: { color: colors.orange600 },
});
