import { useSyncExternalStore } from 'react';

// Module-level flag. Read synchronously from anywhere (including the supabase
// proxy) without going through React context. UI components subscribe via the
// useDemoMode() hook, which uses useSyncExternalStore.
let demoActive = false;
const listeners = new Set<() => void>();

export function isDemoMode() {
  return demoActive;
}

export function enableDemoMode() {
  if (demoActive) return;
  demoActive = true;
  listeners.forEach((l) => l());
}

export function disableDemoMode() {
  if (!demoActive) return;
  demoActive = false;
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useDemoMode() {
  return useSyncExternalStore(subscribe, isDemoMode, isDemoMode);
}
