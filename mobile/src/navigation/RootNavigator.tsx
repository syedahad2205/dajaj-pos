/**
 * RootNavigator — top-level navigator that switches between Auth and App stacks
 * based on session status (design §4, Requirement 1.10).
 *
 * SplashScreen is displayed while status === 'pending' (Firebase Auth resolving
 * persisted session). Never pushed onto the navigation stack — shown as a static
 * view so it can never be reached via back-navigation.
 */
import React from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { AuthNavigator } from '@/navigation/AuthNavigator';
import { AppNavigator } from '@/navigation/AppNavigator';
import { useAuthStore } from '@/core/auth/useAuthStore';
import { setNavigationRef } from '@/app/providers/AuthProvider';
import { DajajLogo } from '@/core/ui/components/DajajLogo';
import { colors } from '@/core/ui/theme/colors';

export function RootNavigator() {
  const status = useAuthStore(s => s.status);

  if (status === 'pending') {
    return (
      <View style={styles.splash}>
        <DajajLogo width={160} height={229} />
        <ActivityIndicator size="small" color="#e8503b" style={styles.splashSpinner} />
      </View>
    );
  }

  return (
    <NavigationContainer
      ref={ref => setNavigationRef(ref as Parameters<typeof setNavigationRef>[0])}
    >
      {status === 'authenticated' ? <AppNavigator /> : <AuthNavigator />}
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  splash: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.pageBg,
    gap: 0,
  },
  splashSpinner: {
    marginTop: 40,
  },
});
