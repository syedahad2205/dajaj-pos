import React from 'react';
import { Platform, StyleSheet, Image } from 'react-native';
import { createNativeBottomTabNavigator } from '@bottom-tabs/react-navigation';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { HomeScreen } from '@/modules/daily-closing/screens/HomeScreen';
import { HistoryScreen } from '@/modules/daily-closing/screens/HistoryScreen';
import { SettingsScreen } from '@/core/ui/screens/SettingsScreen';
import { DailyClosingScreen } from '@/modules/daily-closing/screens/DailyClosingScreen';
import { LogViewerScreen } from '@/core/logging/LogViewerScreen';
import { colors } from '@/core/ui/theme/colors';

// SF Symbols are iOS-only — Android uses bundled PNGs (tinted natively)
const TAB_ICONS = {
  Home: {
    ios: 'house.fill',
    android: require('@/assets/icons/home.png'),
  },
  History: {
    ios: 'clock.arrow.circlepath',
    android: require('@/assets/icons/history.png'),
  },
  Settings: {
    ios: 'gearshape',
    android: require('@/assets/icons/settings.png'),
  },
} as const;

function tabIcon(name: keyof typeof TAB_ICONS) {
  return () =>
    Platform.OS === 'ios'
      ? { sfSymbol: TAB_ICONS[name].ios }
      : TAB_ICONS[name].android;
}

// Tinted PNG icon for Android JS tab bar
function AndroidTabIcon({
  source,
  color,
  size,
}: {
  source: ReturnType<typeof require>;
  color: string;
  size: number;
}) {
  return (
    <Image
      source={source}
      style={{ width: size, height: size, tintColor: color }}
      resizeMode="contain"
    />
  );
}

export type RootStackParamList = {
  Tabs: undefined;
  DailyClosing: { date: string; mode: 'edit' | 'readonly' };
  LogViewer: undefined;
};

export type TabParamList = {
  Home: undefined;
  History: undefined;
  Settings: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();
// iOS: native UITabBarController (Liquid Glass on iOS 26)
// Android: JS bottom tabs — native tab navigator doesn't render correctly on Android
const NativeTab = createNativeBottomTabNavigator<TabParamList>();
const JSTab = createBottomTabNavigator<TabParamList>();

const ANDROID_TAB_SCREEN_OPTIONS = {
  headerStyle: { backgroundColor: colors.pageBg },
  headerTitleStyle: { fontWeight: '900' as const, color: colors.slate900, fontSize: 17 },
  headerTintColor: colors.slate900,
  tabBarActiveTintColor: colors.slateBtnBg,
  tabBarInactiveTintColor: colors.slate400,
  tabBarLabelStyle: { fontSize: 10, fontWeight: '700' as const },
  tabBarStyle: {
    backgroundColor: '#ffffff',
    borderTopColor: colors.slate200,
    borderTopWidth: 1,
    elevation: 0,
  },
};

function TabNavigator() {
  if (Platform.OS === 'android') {
    return (
      <JSTab.Navigator screenOptions={ANDROID_TAB_SCREEN_OPTIONS}>
        <JSTab.Screen
          name="Home"
          component={HomeScreen}
          options={{
            title: 'Today',
            headerShown: false,
            tabBarIcon: ({ color, size }) => TAB_ICONS.Home.android
              ? <AndroidTabIcon source={TAB_ICONS.Home.android} color={color} size={size} />
              : null,
          }}
        />
        <JSTab.Screen
          name="History"
          component={HistoryScreen}
          options={{
            title: 'History',
            headerShown: false,
            tabBarIcon: ({ color, size }) => TAB_ICONS.History.android
              ? <AndroidTabIcon source={TAB_ICONS.History.android} color={color} size={size} />
              : null,
          }}
        />
        <JSTab.Screen
          name="Settings"
          component={SettingsScreen}
          options={{
            title: 'Settings',
            headerShown: false,
            tabBarIcon: ({ color, size }) => TAB_ICONS.Settings.android
              ? <AndroidTabIcon source={TAB_ICONS.Settings.android} color={color} size={size} />
              : null,
          }}
        />
      </JSTab.Navigator>
    );
  }

  return (
    <NativeTab.Navigator
      labeled
      tabBarStyle={{ backgroundColor: '#ffffff' }}
      tabLabelStyle={{ color: colors.slate500 }}
      screenOptions={{
        headerStyle: { backgroundColor: colors.pageBg },
        headerTitleStyle: { fontWeight: '900', color: colors.slate900, fontSize: 17 },
        headerTintColor: colors.slate900,
        tabBarActiveTintColor: colors.slateBtnBg,
        tabBarInactiveTintColor: colors.slate400,
        sceneStyle: { backgroundColor: colors.pageBg },
      }}
    >
      <NativeTab.Screen
        name="Home"
        component={HomeScreen}
        options={{ title: 'Today', headerShown: false, tabBarIcon: tabIcon('Home') }}
      />
      <NativeTab.Screen
        name="History"
        component={HistoryScreen}
        options={{ title: 'History', headerShown: false, tabBarIcon: tabIcon('History') }}
      />
      <NativeTab.Screen
        name="Settings"
        component={SettingsScreen}
        options={{ title: 'Settings', headerShown: false, tabBarIcon: tabIcon('Settings') }}
      />
    </NativeTab.Navigator>
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
      <Stack.Screen
        name="LogViewer"
        component={LogViewerScreen}
        options={{ title: 'App Logs', headerShown: false }}
      />
    </Stack.Navigator>
  );
}

const styles = StyleSheet.create({});
