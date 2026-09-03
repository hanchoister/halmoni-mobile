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
      <Stack.Screen name="patterns" options={{ title: 'Questions to ask' }} />
      <Stack.Screen name="account" options={{ title: 'Account' }} />
      <Stack.Screen name="parent/new" options={{ title: 'Add parent', presentation: 'modal' }} />
      <Stack.Screen name="parent/edit/[id]" options={{ title: 'Edit details', presentation: 'modal' }} />
      <Stack.Screen name="handoff/new" options={{ title: 'Hand off', presentation: 'modal' }} />
    </Stack>
  );
}

// Beats presence on mount, on foreground, and every 5 min while active. That
// cadence is enough for "active Xm ago" precision without burning Supabase
// writes — a 60s interval put 50 active users past the free-tier write budget.
// No-op in demo mode.
const PRESENCE_INTERVAL_MS = 5 * 60_000;

function PresenceHeartbeat() {
  const { me } = useMe();
  const { familyId } = useFamily();
  useEffect(() => {
    if (!me || !familyId || isDemoMode()) return;
    void beatPresence(me.id, familyId);
    const interval = setInterval(() => {
      void beatPresence(me.id, familyId);
    }, PRESENCE_INTERVAL_MS);
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
  // Demo mode is a development and marketing affordance, not a product feature.
  // It stays reachable in dev, and in the web demo build served at
  // halmoni.app/demo (which sets EXPO_PUBLIC_START_IN_DEMO=1), but never in a
  // release build a tester or App Store reviewer installs.
  //
  // Reviewers get a seeded real account via the review notes instead (G2-15) —
  // that exercises the actual sync path, which a demo deliberately does not.
  const demoAvailable = __DEV__ || process.env.EXPO_PUBLIC_START_IN_DEMO === '1';

  return (
    <WelcomeScreen
      onTryDemo={demoAvailable ? () => enableDemoMode() : undefined}
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
