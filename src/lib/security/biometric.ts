// Face ID / Touch ID app lock. Opt-in via setBiometricLockEnabled(true) —
// stored in AsyncStorage so the preference survives restarts. Health data
// warrants an at-rest guard against a stolen unlocked phone.
//
// UX: unlock is required once per app foreground session. Sending the app
// to background arms the lock again.

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as LocalAuthentication from 'expo-local-authentication';

const ENABLED_KEY = 'halmoni.biometric.enabled';

export async function isBiometricAvailable(): Promise<boolean> {
  const [hasHardware, isEnrolled] = await Promise.all([
    LocalAuthentication.hasHardwareAsync(),
    LocalAuthentication.isEnrolledAsync(),
  ]);
  return hasHardware && isEnrolled;
}

export async function getBiometricLockEnabled(): Promise<boolean> {
  const v = await AsyncStorage.getItem(ENABLED_KEY);
  return v === '1';
}

export async function setBiometricLockEnabled(enabled: boolean): Promise<void> {
  await AsyncStorage.setItem(ENABLED_KEY, enabled ? '1' : '0');
}

export interface AuthResult {
  ok: boolean;
  error?: string;
}

export async function authenticate(reason = 'Unlock Halmoni'): Promise<AuthResult> {
  const result = await LocalAuthentication.authenticateAsync({
    promptMessage: reason,
    cancelLabel: 'Cancel',
    disableDeviceFallback: false,
    fallbackLabel: 'Use passcode',
  });
  if (result.success) return { ok: true };
  return { ok: false, error: (result as any).error ?? 'authentication_failed' };
}
