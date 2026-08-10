// Blocks the app tree until the user unlocks with biometrics — but only when
// the preference is enabled AND we're not already unlocked this foreground
// session. Sending the app to background re-arms the lock.

import { ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Pressable, Text, View } from 'react-native';

import {
  authenticate,
  getBiometricLockEnabled,
  isBiometricAvailable,
} from '@/lib/security/biometric';
import { palette } from '@/lib/theme';

export function BiometricLockGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<'checking' | 'locked' | 'unlocked'>('checking');
  const stateRef = useRef(state);
  stateRef.current = state;

  const evaluate = useCallback(async () => {
    const [enabled, available] = await Promise.all([
      getBiometricLockEnabled(),
      isBiometricAvailable(),
    ]);
    if (!enabled || !available) {
      setState('unlocked');
      return;
    }
    setState('locked');
  }, []);

  const tryUnlock = useCallback(async () => {
    const result = await authenticate('Unlock Halmoni');
    if (result.ok) setState('unlocked');
  }, []);

  // Initial evaluation + arm on backgrounding.
  useEffect(() => {
    void evaluate();
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'background' || next === 'inactive') {
        // Re-arm on next foreground: force re-evaluation.
        if (stateRef.current === 'unlocked') setState('checking');
      } else if (next === 'active' && stateRef.current === 'checking') {
        void evaluate();
      }
    });
    return () => sub.remove();
  }, [evaluate]);

  // When we transition into 'locked', auto-prompt once so users don't have
  // to tap through an intermediate screen every time.
  useEffect(() => {
    if (state === 'locked') void tryUnlock();
  }, [state, tryUnlock]);

  if (state === 'checking') {
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

  if (state === 'locked') {
    return (
      <View
        style={{
          flex: 1,
          justifyContent: 'center',
          alignItems: 'center',
          padding: 24,
          backgroundColor: palette.cream50,
        }}>
        <Text
          style={{
            fontSize: 20,
            fontWeight: '700',
            color: palette.ink900,
            marginBottom: 20,
          }}>
          Halmoni is locked
        </Text>
        <Pressable
          onPress={tryUnlock}
          style={{
            backgroundColor: palette.sage500,
            paddingVertical: 12,
            paddingHorizontal: 24,
            borderRadius: 10,
          }}>
          <Text style={{ color: 'white', fontWeight: '600' }}>Unlock</Text>
        </Pressable>
      </View>
    );
  }

  return <>{children}</>;
}
