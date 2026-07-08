/**
 * LoginScreen — styled to match the DAJAJ web app aesthetic.
 * Warm cream background, orange accents, rounded-[28px] cards, slate buttons.
 */
import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, StatusBar,
} from 'react-native';
import { useForm, Controller } from 'react-hook-form';
import { signInWithCustomToken } from 'firebase/auth';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { AuthStackParamList } from '@/navigation/AuthNavigator';
import { login } from '@/core/auth/authApi';
import { getFirebaseAuth } from '@/core/firebase/firebaseClient';
import { useAuthStore } from '@/core/auth/useAuthStore';
import { DajajLogo } from '@/core/ui/components/DajajLogo';
import { colors, radius, shadow } from '@/core/ui/theme/colors';

type Props = NativeStackScreenProps<AuthStackParamList, 'Login'>;
interface FormValues { username: string; password: string; }

export function LoginScreen({ route }: Props) {
  const sessionExpiredMessage = route.params?.sessionExpiredMessage;
  const { setUser, setStatus } = useAuthStore();
  const [serverError, setServerError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const { control, handleSubmit, watch } = useForm<FormValues>({
    defaultValues: { username: '', password: '' },
  });
  const username = watch('username');
  const password = watch('password');
  const canSubmit = username.trim().length > 0 && password.length > 0 && !isLoading;

  async function onSubmit(values: FormValues) {
    setServerError(null);
    setIsLoading(true);
    try {
      const { customToken, user } = await login(values.username.trim(), values.password);
      const auth = getFirebaseAuth();
      await signInWithCustomToken(auth, customToken);
      setUser(user);
      setStatus('authenticated');
    } catch (err) {
      setServerError(err instanceof Error ? err.message : 'Login failed. Please try again.');
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <StatusBar barStyle="dark-content" backgroundColor={colors.pageBg} />
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">

        <View style={styles.logoArea}>
          <DajajLogo width={140} height={200} />
        </View>

        {/* Card */}
        <View style={styles.card}>
          <Text style={styles.financeLabel}>Finance</Text>
          <Text style={styles.pageTitle}>Sign In</Text>
          <Text style={styles.pageDesc}>Enter your Finance User credentials to access Daily Closing.</Text>

          {sessionExpiredMessage && (
            <View style={styles.warningBanner}>
              <Text style={styles.warningText}>{sessionExpiredMessage}</Text>
            </View>
          )}

          {serverError && (
            <View style={styles.errorBanner}>
              <Text style={styles.errorText}>{serverError}</Text>
            </View>
          )}

          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Username</Text>
            <Controller
              control={control}
              name="username"
              render={({ field: { onChange, value, onBlur } }) => (
                <TextInput
                  style={styles.input}
                  value={value}
                  onChangeText={onChange}
                  onBlur={onBlur}
                  autoCapitalize="none"
                  autoCorrect={false}
                  placeholder="your.username"
                  placeholderTextColor={colors.slate400}
                  editable={!isLoading}
                  testID="username-input"
                />
              )}
            />
          </View>

          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Password</Text>
            <Controller
              control={control}
              name="password"
              render={({ field: { onChange, value, onBlur } }) => (
                <TextInput
                  style={styles.input}
                  value={value}
                  onChangeText={onChange}
                  onBlur={onBlur}
                  secureTextEntry
                  placeholder="••••••••"
                  placeholderTextColor={colors.slate400}
                  editable={!isLoading}
                  testID="password-input"
                />
              )}
            />
          </View>

          <TouchableOpacity
            style={[styles.loginBtn, !canSubmit && styles.loginBtnDisabled]}
            onPress={handleSubmit(onSubmit)}
            disabled={!canSubmit}
            testID="login-button"
            activeOpacity={0.85}
          >
            {isLoading
              ? <ActivityIndicator color="#fff" />
              : <Text style={styles.loginBtnText}>Sign In</Text>
            }
          </TouchableOpacity>
        </View>

        <Text style={styles.footer}>Managed by your admin • DAJAJ Finance</Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.pageBg },
  scroll: { flexGrow: 1, paddingHorizontal: 20, paddingTop: 60, paddingBottom: 40 },
  logoArea: { alignItems: 'center', marginBottom: 32 },
  card: {
    backgroundColor: colors.white,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.orangeCardBorder,
    padding: 24,
    ...shadow.card,
  },
  financeLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 4,
    textTransform: 'uppercase',
    color: colors.orange600,
    marginBottom: 4,
  },
  pageTitle: {
    fontSize: 28,
    fontWeight: '900',
    color: colors.slate900,
    marginBottom: 6,
  },
  pageDesc: {
    fontSize: 13,
    color: colors.slate600,
    lineHeight: 19,
    marginBottom: 20,
  },
  warningBanner: {
    backgroundColor: colors.amber50,
    borderRadius: radius.inner,
    borderWidth: 1,
    borderColor: colors.amber200,
    padding: 12,
    marginBottom: 16,
  },
  warningText: { color: colors.amber800, fontSize: 13 },
  errorBanner: {
    backgroundColor: colors.rose50,
    borderRadius: radius.inner,
    borderWidth: 1,
    borderColor: colors.rose200,
    padding: 12,
    marginBottom: 16,
  },
  errorText: { color: colors.rose700, fontSize: 13 },
  fieldGroup: { marginBottom: 14 },
  fieldLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.slate500,
    marginBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  input: {
    backgroundColor: colors.slate50,
    borderRadius: radius.inner,
    borderWidth: 1,
    borderColor: colors.slate200,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: colors.slate900,
  },
  loginBtn: {
    backgroundColor: colors.slateBtnBg,
    borderRadius: radius.inner,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 8,
  },
  loginBtnDisabled: { opacity: 0.4 },
  loginBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  footer: {
    textAlign: 'center',
    marginTop: 24,
    fontSize: 12,
    color: colors.slate400,
  },
});
