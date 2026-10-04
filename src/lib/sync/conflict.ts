/**
 * The conflict decision, as a pure function (G2-28).
 *
 * This lives apart from engine.ts so it can be tested without a Supabase
 * client, a database or a network. The engine's job is fetching the server's
 * state; deciding what that state MEANS is this, and it is the part that has to
 * be right — a wrong "safe" silently destroys a sibling's edit, and a wrong
 * "conflict" interrupts someone who did nothing wrong.
 */

export type WriteVerdict =
  /** Nobody else touched the row. Push it. */
  | 'safe'
  /** Somebody wrote after this edit began. Pushing would erase their change. */
  | 'conflict';

/**
 * @param base              the server version this edit was made against, from
 *                          known_ids at edit time. Null when the server has
 *                          never shown us this row, or when the queue entry
 *                          predates the column.
 * @param serverUpdatedAt   what the server holds now. Undefined when the server
 *                          has no such row.
 */
export function classifyWrite(
  base: string | null,
  serverUpdatedAt: string | undefined,
): WriteVerdict {
  // No base to compare against. Either a genuine insert, or an entry queued
  // before this bookkeeping existed. Both must push exactly as they did before:
  // treating them as conflicts would strand a queue full of the user's unsent
  // edits on the first launch after an upgrade, which is a worse bug than the
  // one being fixed.
  if (base === null) return 'safe';

  // The server does not have the row. The upsert will insert it, and there is
  // nothing to overwrite. (This is also what a hard delete looks like from
  // here — rare enough, and re-inserting the user's own edit is kinder than
  // discarding it.)
  if (serverUpdatedAt === undefined) return 'safe';

  // Equality, not "is newer".
  //
  // Every synced table carries a `set_updated_at` BEFORE trigger on production
  // that does `NEW.updated_at := now()`, so updated_at only ever moves forward
  // and only ever under the server's own clock. Any difference therefore means a
  // write landed between this edit starting and now. Using `>` would instead
  // make the answer depend on this device's clock agreeing with the server's,
  // and a phone running two minutes fast would quietly stop detecting
  // conflicts — the exact class of silent failure this item exists to remove.
  return serverUpdatedAt === base ? 'safe' : 'conflict';
}

/**
 * A queued write, reduced to the parts the conflict decision actually needs.
 *
 * Deliberately structural rather than imported from the repository: this module
 * has no imports at all, which is what lets verify:logic compile and test it
 * without expo-sqlite or a Supabase client.
 */
export type ContestableWrite = {
  row_id: string;
  base_updated_at: string | null;
};

export type Partitioned<T> = {
  /** Safe to push. */
  safe: T[];
  /** Would erase somebody else's change. */
  conflicted: Array<{ write: T; serverUpdatedAt: string; serverRow: Record<string, unknown> }>;
};

/**
 * Split a table's pending writes into the ones that are safe to push and the
 * ones that would overwrite a change made since the edit began.
 *
 * Lives here, apart from the engine, so the whole decision is testable. The
 * engine's job is fetching `serverRows`; deciding what they MEAN is this. That
 * split matters because the engine cannot be compiled outside a React Native
 * runtime, so anything left inside it is only ever verified by reading it — and
 * this project has twice shipped a check that could only report "fine".
 *
 * @param serverRows what the server currently holds, keyed by row id. A row
 *                   absent from the map is one the server does not have.
 */
export function partitionWrites<T extends ContestableWrite>(
  writes: T[],
  serverRows: Map<string, Record<string, unknown>>,
): Partitioned<T> {
  const safe: T[] = [];
  const conflicted: Partitioned<T>['conflicted'] = [];

  for (const w of writes) {
    const serverRow = serverRows.get(w.row_id);
    const serverUpdatedAt = serverRow?.updated_at as string | undefined;
    if (classifyWrite(w.base_updated_at, serverUpdatedAt) === 'safe') {
      safe.push(w);
      continue;
    }
    // classifyWrite only says 'conflict' when both of these are present, so the
    // assertions below cannot fire — but they are narrowed explicitly rather
    // than cast, so a future change to classifyWrite breaks the build here
    // instead of producing an undefined in a conflict record.
    if (serverRow === undefined || serverUpdatedAt === undefined) {
      safe.push(w);
      continue;
    }
    conflicted.push({ write: w, serverUpdatedAt, serverRow });
  }

  return { safe, conflicted };
}
