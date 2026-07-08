/**
 * Auth stack navigator — Login screen only for now (design §4).
 */
import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { LoginScreen } from '@/modules/daily-closing/screens/LoginScreen';

export type AuthStackParamList = {
  Login: { sessionExpiredMessage?: string } | undefined;
};

const Stack = createNativeStackNavigator<AuthStackParamList>();

export function AuthNavigator() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Login" component={LoginScreen} />
    </Stack.Navigator>
  );
}
