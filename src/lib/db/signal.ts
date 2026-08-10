// A single "data changed" signal that screens subscribe to. Bumps when any
// local write lands (writeRow/deleteRow) or a realtime event upserts a row.
// Screens list-fetch on mount + on version bump — no per-table channels.
// Coarse-grained on purpose: family workloads are small (hundreds of rows,
// not thousands), and a whole-app refetch is cheaper than the bookkeeping.

import { useSyncExternalStore } from 'react';

let version = 0;
const listeners = new Set<() => void>();

export function bumpDataVersion() {
  version += 1;
  for (const l of listeners) l();
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

function getSnapshot() {
  return version;
}

export function useDataVersion(): number {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
