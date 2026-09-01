// A single "data changed" signal that screens subscribe to. Bumps when any
// local write lands (writeRow/deleteRow) or a realtime event upserts a row.
// Screens list-fetch on mount + on version bump — no per-table channels.
// Coarse-grained on purpose: family workloads are small (hundreds of rows,
// not thousands), and a whole-app refetch is cheaper than the bookkeeping.

import { useSyncExternalStore } from 'react';

let version = 0;
let scheduled = false;
const listeners = new Set<() => void>();

// Bursts are the normal case, not the exception: realtime delivers one event
// per ROW, so saving a medication (which writes ~90 days of doses) echoes back
// as hundreds of separate events. Notifying per event meant every screen re-ran
// its entire load() hundreds of times in a few hundred milliseconds, which React
// eventually kills with "Maximum update depth exceeded".
//
// Collapsing a burst into one notification is safe because the signal carries no
// payload — subscribers re-read from SQLite, so they only ever need to know
// "something changed", not what or how many times.
const COALESCE_MS = 50;

export function bumpDataVersion() {
  if (scheduled) return;
  scheduled = true;
  setTimeout(() => {
    scheduled = false;
    version += 1;
    for (const l of listeners) l();
  }, COALESCE_MS);
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
