import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { HomeScreen } from '@/modules/daily-closing/screens/HomeScreen';
import { HistoryScreen } from '@/modules/daily-closing/screens/HistoryScreen';
import { SettingsScreen } from '@/core/ui/screens/SettingsScreen';
import { DailyClosingScreen } from '@/modules/daily-closing/screens/DailyClosingScreen';
import { colors } from '@/core/ui/theme/colors';

export type RootStackParamList = {
  Tabs: undefined;
  DailyClosing: { date: string; mode: 'edit' | 'readonly' };
};

export type TabParamList = {
  Home: undefined;
  History: undefined;
  Settings: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator<TabParamList>();

// Simple text-based tab icons that work without a native icon library
function TabIcon({ icon, focused }: { icon: string; focused: boolean }) {
  return (
    <Text style={[styles.tabIcon, { color: focused ? colors.slateBtnBg : colors.slate400 }]}>
      {icon}
    </Text>
  );
}

function TabNavigator() {
  return (
    <Tab.Navigator
      screenOptions={{
        tabBarStyle: {
          backgroundColor: '#fff',
          borderTopColor: colors.slate200,
          borderTopWidth: 1,
          elevation: 0,
          shadowOpacity: 0,
          height: 60,
          paddingBottom: 8,
        },
        tabBarActiveTintColor: colors.slateBtnBg,
        tabBarInactiveTintColor: colors.slate400,
        tabBarLabelStyle: { fontSize: 10, fontWeight: '700', letterSpacing: 0.3 },
        headerStyle: {
          backgroundColor: colors.pageBg,
          elevation: 0,
          shadowOpacity: 0,
          borderBottomWidth: 0,
        },
        headerTitleStyle: { fontWeight: '900', color: colors.slate900, fontSize: 17 },
        headerTintColor: colors.slate900,
        headerTitleAlign: 'center',
      }}
    >
      <Tab.Screen
        name="Home"
        component={HomeScreen}
        options={{
          title: 'Today',
          headerShown: false,
          tabBarIcon: ({ focused }) => <TabIcon icon="⊙" focused={focused} />,
        }}
      />
      <Tab.Screen
        name="History"
        component={HistoryScreen}
        options={{
          title: 'History',
          tabBarIcon: ({ focused }) => <TabIcon icon="☰" focused={focused} />,
        }}
      />
      <Tab.Screen
        name="Settings"
        component={SettingsScreen}
        options={{
          title: 'Settings',
          tabBarIcon: ({ focused }) => <TabIcon icon="⚙" focused={focused} />,
        }}
      />
    </Tab.Navigator>
  );
}

export function AppNavigator() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: colors.pageBg },
        headerTitleStyle: { fontWeight: '900', color: colors.slate900 },
        headerTintColor: colors.slate900,
        headerBackTitle: 'Back',
        contentStyle: { backgroundColor: colors.pageBg },
      }}
    >
      <Stack.Screen name="Tabs" component={TabNavigator} options={{ headerShown: false }} />
      <Stack.Screen
        name="DailyClosing"
        component={DailyClosingScreen}
        options={{ title: 'Daily Closing' }}
      />
    </Stack.Navigator>
  );
}

const styles = StyleSheet.create({
  tabIcon: {
    fontSize: 20,
    lineHeight: 24,
    textAlign: 'center',
  },
});
