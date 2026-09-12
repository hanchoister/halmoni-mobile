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
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, View } from 'react-native';

import { LoginScreen } from '@/components/login-screen';
import { OnboardingScreen } from '@/components/onboarding-screen';
import { HeaderBackButton } from '@/components/ui/header-back';
import { WelcomeScreen } from '@/components/welcome-screen';
import { AuthProvider, useAuth } from '@/lib/auth';
import { enableDemoMode, isDemoMode, useDemoMode } from '@/lib/demo-mode';
import { purgeDemoResidue, seedDemoDataIntoDb } from '@/lib/demo-seed';
import { FamilyProvider, useFamily } from '@/lib/family';
import { MeProvider, useMe } from '@/lib/me';
import { ParentProvider } from '@/lib/parent';
import { beatPresence } from '@/lib/presence';
import { ErrorBoundary } from '@/lib/reliability/error-boundary';
import { initSentry } from '@/lib/reliability/sentry';
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
  // Signing out has to return you to the welcome screen, not the email form.
  // showLogin is set when "Log in / create account" is tapped and was never
  // cleared, so after a sign-out the tree fell straight through to
  // <LoginScreen /> — with no way back to "See the live demo" short of
  // reloading the app.
  //
  // Only reset on the transition OUT of a session. Clearing it whenever
  // `session` is null would eject the user from the login form the moment they
  // opened it, since they have no session while signing in.
  const hadSession = useRef(false);
  useEffect(() => {
    if (session) {
      hadSession.current = true;
    } else if (hadSession.current) {
      hadSession.current = false;
      setShowLogin(false);
    }
  }, [session]);
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
  // A real session must never start on top of demo fixtures. demoActive is a
  // module flag and the fixtures are on disk, so a relaunch leaves the rows
  // looking like real data — which is how 430 demo dose updates ended up
  // queued against production on 2026-09-11. Runs before the sync engine
  // mounts, because MaybeSyncProvider is below this in the tree.
  useEffect(() => {
    if (session && !demoMode) void purgeDemoResidue();
  }, [session, demoMode]);
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

// Before anything else renders, so an early crash is still captured — and so
// the scrubbing in initSentry() is in place before any event can be sent.
initSentry();

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
