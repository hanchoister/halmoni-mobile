// React context for sync status. Screens subscribe via useSyncStatus() to
// render "Syncing..." / "Offline" / last-sync indicators. Anywhere in the app
// can call requestSync() to trigger a run (debounced).

import { AppState } from 'react-native';
import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';

import { topUpDoseHorizon } from '@/lib/dose-maintenance';
import { syncOnce, SyncResult } from '@/lib/sync/engine';
import { _registerSyncTrigger } from '@/lib/sync/write-path';

export type SyncStatus = 'idle' | 'syncing' | 'synced' | 'dirty' | 'error' | 'offline';

interface SyncState {
  status: SyncStatus;
  lastSyncAt: string | null;
  lastError: string | null;
  requestSync: () => void;
}

const SyncContext = createContext<SyncState>({
  status: 'idle',
  lastSyncAt: null,
  lastError: null,
  requestSync: () => {},
});

const FOREGROUND_INTERVAL_MS = 30_000;
const DEBOUNCE_MS = 400;

// How often the dose horizon is topped up. The sync loop runs every 30s and
// re-reading every medication's doses that often would be silly; a medication
// only needs extending once it drops under 60 days of runway, so hourly is
// generous. Zero on first call, so it always runs once after launch.
const TOP_UP_INTERVAL_MS = 60 * 60_000;
let lastTopUpAt = 0;

/**
 * Extend the dose horizon after a clean sync.
 *
 * After, not before: the mirror has to hold the doses another sibling's phone
 * already created before this one decides they are missing. (Dose ids are
 * derived from the medication and the instant, so even a genuine race converges
 * on one row rather than two — this is belt as well as braces.)
 *
 * A run with errors is skipped, which means a device offline for two months
 * would not top up. The horizon is 90 days and the threshold 60, so that is a
 * month of slack before it could matter.
 */
async function maybeTopUpDoses() {
  if (Date.now() - lastTopUpAt < TOP_UP_INTERVAL_MS) return;
  lastTopUpAt = Date.now();
  try {
    const { created, medications } = await topUpDoseHorizon();
    if (__DEV__ && created) {
      console.log(`[doses] extended ${medications} medication(s), ${created} dose(s)`);
    }
  } catch (err) {
    // Never let dose maintenance break sync status reporting. The next run
    // retries; nothing here is one-shot.
    lastTopUpAt = 0;
    if (__DEV__) {
      console.warn('[doses] top-up failed', err);
    }
  }
}

function isNetworkErrorMessage(msg: string): boolean {
  return /network|fetch|failed to fetch|offline|timed? out/i.test(msg);
}

function isNetworkError(err: unknown): boolean {
  return isNetworkErrorMessage(err instanceof Error ? err.message : String(err));
}

export function SyncProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SyncStatus>('idle');
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const runningRef = useRef(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const runSync = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    setStatus('syncing');
    try {
      const result: SyncResult = await syncOnce();
      setLastSyncAt(new Date().toISOString());

      // Per-table failures no longer throw — they are collected so the rest of
      // the sync can proceed. That means they have to be reported explicitly,
      // or a run where nothing moved would still show as "synced".
      if (result.errors.length > 0) {
        setLastError(result.errors.join('; '));
        setStatus(result.errors.some(isNetworkErrorMessage) ? 'offline' : 'error');
        // eslint-disable-next-line no-console
        console.warn('[sync] FAILED:\n  ' + result.errors.join('\n  '));
      } else {
        setLastError(null);
        setStatus('synced');
        await maybeTopUpDoses();
      }

      // Log pulled counts in dev only to aid debugging.
      if (__DEV__ && (result.pushed || Object.keys(result.pulled).length)) {
        // eslint-disable-next-line no-console
        console.log('[sync]', result);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setLastError(msg);
      setStatus(isNetworkError(err) ? 'offline' : 'error');
    } finally {
      runningRef.current = false;
    }
  }, []);

  const requestSync = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void runSync();
    }, DEBOUNCE_MS);
  }, [runSync]);

  // Let write-path helpers nudge the engine after every local write.
  useEffect(() => {
    _registerSyncTrigger(requestSync);
  }, [requestSync]);

  // Foreground polling loop + on foreground transition, sync immediately.
  useEffect(() => {
    void runSync();

    intervalRef.current = setInterval(() => {
      void runSync();
    }, FOREGROUND_INTERVAL_MS);

    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') void runSync();
    });

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      sub.remove();
    };
  }, [runSync]);

  return (
    <SyncContext.Provider value={{ status, lastSyncAt, lastError, requestSync }}>
      {children}
    </SyncContext.Provider>
  );
}

export function useSyncStatus(): SyncState {
  return useContext(SyncContext);
}
