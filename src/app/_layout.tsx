import {
  InstrumentSerif_400Regular,
  InstrumentSerif_400Regular_Italic,
} from '@expo-google-fonts/instrument-serif';
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
} from '@expo-google-fonts/inter';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, AppState, View } from 'react-native';

import { LoginScreen } from '@/components/login-screen';
import { OnboardingScreen } from '@/components/onboarding-screen';
import { HeaderBackButton } from '@/components/ui/header-back';
import { WelcomeScreen } from '@/components/welcome-screen';
import { AuthProvider, useAuth } from '@/lib/auth';
import { enableDemoMode, isDemoMode, useDemoMode } from '@/lib/demo-mode';
import { seedDemoDataIntoDb } from '@/lib/demo-seed';
import { FamilyProvider, useFamily } from '@/lib/family';
import { MeProvider, useMe } from '@/lib/me';
import { ParentProvider } from '@/lib/parent';
import { beatPresence } from '@/lib/presence';
import { ErrorBoundary } from '@/lib/reliability/error-boundary';
import { BiometricLockGate } from '@/lib/security/lock-gate';
import { SyncProvider } from '@/lib/sync';
import { startRealtime, stopRealtime } from '@/lib/sync/realtime';
import { palette } from '@/lib/theme';

// Sync targets real Supabase; skip it in demo mode (in-memory backend).
function MaybeSyncProvider({ children }: { children: React.ReactNode }) {
  if (isDemoMode()) return <>{children}</>;
  return <SyncProvider>{children}</SyncProvider>;
}

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
        headerShadowVisible: false,
        headerBackTitle: 'Back',
        headerLeft: () => <HeaderBackButton />,
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
      <Stack.Screen name="patterns" options={{ title: 'Possible patterns' }} />
      <Stack.Screen name="account" options={{ title: 'Account' }} />
      <Stack.Screen name="parent/new" options={{ title: 'Add parent', presentation: 'modal' }} />
      <Stack.Screen name="handoff/new" options={{ title: 'Hand off', presentation: 'modal' }} />
    </Stack>
  );
}

// Beats presence once on mount, on foreground, and every 60s while active.
// Lives inside MeProvider so `me.id` is available; no-op in demo mode.
function PresenceHeartbeat() {
  const { me } = useMe();
  const { familyId } = useFamily();
  useEffect(() => {
    if (!me || !familyId || isDemoMode()) return;
    void beatPresence(me.id, familyId);
    const interval = setInterval(() => {
      void beatPresence(me.id, familyId);
    }, 60_000);
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void beatPresence(me.id, familyId);
    });
    return () => {
      clearInterval(interval);
      sub.remove();
    };
  }, [me, familyId]);
  return null;
}

function FamilyGate() {
  const { familyId, loading } = useFamily();

  // Realtime channel follows the current family — skip in demo mode.
  useEffect(() => {
    if (!familyId || isDemoMode()) return;
    startRealtime(familyId);
    return () => stopRealtime();
  }, [familyId]);

  if (loading) return <Spinner />;
  if (!familyId) return <OnboardingScreen />;
  return (
    <ParentProvider>
      <MeProvider>
        <PresenceHeartbeat />
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
  // Seed the local SQLite mirror from fixtures every time demo mode activates
  // so screens (which read from the mirror) render immediately.
  useEffect(() => {
    if (demoMode) void seedDemoDataIntoDb();
  }, [demoMode]);
  if (loading) return <Spinner />;
  if (session || demoMode) {
    return (
      <MaybeSyncProvider>
        <FamilyProvider>
          <FamilyGate />
        </FamilyProvider>
      </MaybeSyncProvider>
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
  const [fontsLoaded] = useFonts({
    InstrumentSerif_400Regular,
    InstrumentSerif_400Regular_Italic,
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });
  if (!fontsLoaded) return <Spinner />;
  return (
    <ErrorBoundary>
      <BiometricLockGate>
        <AuthProvider>
          <RootNavigator />
        </AuthProvider>
      </BiometricLockGate>
    </ErrorBoundary>
  );
}
