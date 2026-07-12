import { Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { LoginScreen } from '@/components/login-screen';
import { OnboardingScreen } from '@/components/onboarding-screen';
import { WelcomeScreen } from '@/components/welcome-screen';
import { AuthProvider, useAuth } from '@/lib/auth';
import { enableDemoMode, useDemoMode } from '@/lib/demo-mode';
import { FamilyProvider, useFamily } from '@/lib/family';
import { MeProvider } from '@/lib/me';
import { ParentProvider } from '@/lib/parent';
import { palette } from '@/lib/theme';

function Spinner() {
  return (
    <View
      style={{
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: palette.cream50,
      }}>
      <ActivityIndicator color={palette.sage500} />
    </View>
  );
}

function AppStack() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: palette.cream50 },
        headerTintColor: palette.ink900,
        headerTitleStyle: { fontWeight: '700' },
        contentStyle: { backgroundColor: palette.cream50 },
      }}>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="medication/[id]" options={{ title: 'Medication' }} />
      <Stack.Screen name="medication/new" options={{ title: 'Add medication', presentation: 'modal' }} />
      <Stack.Screen name="medication/edit/[id]" options={{ title: 'Edit medication', presentation: 'modal' }} />
      <Stack.Screen name="appointment/[id]" options={{ title: 'Appointment' }} />
      <Stack.Screen name="appointment/new" options={{ title: 'Add appointment', presentation: 'modal' }} />
      <Stack.Screen name="appointment/edit/[id]" options={{ title: 'Edit appointment', presentation: 'modal' }} />
      <Stack.Screen name="visit/[id]" options={{ title: 'Visit Mode' }} />
      <Stack.Screen name="profile" options={{ title: 'Profile' }} />
      <Stack.Screen name="account" options={{ title: 'Account' }} />
      <Stack.Screen name="parent/new" options={{ title: 'Add parent', presentation: 'modal' }} />
      <Stack.Screen name="handoff/new" options={{ title: 'Hand off', presentation: 'modal' }} />
    </Stack>
  );
}

function FamilyGate() {
  const { familyId, loading } = useFamily();
  if (loading) return <Spinner />;
  if (!familyId) return <OnboardingScreen />;
  return (
    <ParentProvider>
      <MeProvider>
        <AppStack />
      </MeProvider>
    </ParentProvider>
  );
}

function RootNavigator() {
  const { session, loading } = useAuth();
  const demoMode = useDemoMode();
  const [showLogin, setShowLogin] = useState(false);
  // Appetize / resume build auto-enters demo. Set EXPO_PUBLIC_START_IN_DEMO=1
  // when exporting for the public demo build.
  useEffect(() => {
    if (process.env.EXPO_PUBLIC_START_IN_DEMO === '1') enableDemoMode();
  }, []);
  if (loading) return <Spinner />;
  if (session || demoMode) {
    return (
      <FamilyProvider>
        <FamilyGate />
      </FamilyProvider>
    );
  }
  if (showLogin) return <LoginScreen />;
  return (
    <WelcomeScreen
      onTryDemo={() => enableDemoMode()}
      onLogIn={() => setShowLogin(true)}
    />
  );
}

export default function RootLayout() {
  return (
    <AuthProvider>
      <RootNavigator />
    </AuthProvider>
  );
}
