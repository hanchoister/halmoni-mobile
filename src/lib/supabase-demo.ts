// In-memory Supabase impersonator for demo mode. Implements just enough of
// the query-builder API to satisfy every call site under src/app and src/lib.
// State lives in a mutable DemoStore rebuilt from fixtures at demo start.

import {
  buildDemoStore,
  DEMO_FAMILY_ID,
  DEMO_PARENT_ID,
  DEMO_USER_ID,
  DemoStore,
  newDemoId,
  TableName,
} from '@/lib/demo-fixtures';

let store: DemoStore = buildDemoStore();

export function resetDemoStore() {
  store = buildDemoStore();
}

type Row = Record<string, any>;

type Filter =
  | { op: 'eq'; col: string; val: any }
  | { op: 'gte'; col: string; val: any }
  | { op: 'lte'; col: string; val: any }
  | { op: 'is'; col: string; val: any }
  | { op: 'contains'; col: string; val: any[] };

function applyFilters(rows: Row[], filters: Filter[]): Row[] {
  return rows.filter((r) =>
    filters.every((f) => {
      const v = r[f.col];
      switch (f.op) {
        case 'eq':
          return v === f.val;
        case 'gte':
          return v != null && String(v) >= String(f.val);
        case 'lte':
          return v != null && String(v) <= String(f.val);
        case 'is':
          // SQL `IS NULL` matches a column that is null. The fixtures do not
          // carry `deleted_at` at all, so the value here is `undefined`, and a
          // strict `undefined === null` was false — which meant
          // `.is('deleted_at', null)` filtered out EVERY row in the demo
          // store. Since every synced table is soft-deleted and every read
          // carries that filter, the whole demo returned empty: no family, so
          // the app fell through to the create-family screen instead of the
          // sample data. Treat missing and null as the same absence.
          return f.val === null ? v == null : v === f.val;
        case 'contains':
          return Array.isArray(v) && f.val.every((x: any) => v.includes(x));
      }
    }),
  );
}

function applyOrder(
  rows: Row[],
  ord?: { col: string; ascending: boolean },
): Row[] {
  if (!ord) return rows;
  return [...rows].sort((a, b) => {
    const av = a[ord.col];
    const bv = b[ord.col];
    if (av === bv) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    const cmp = av < bv ? -1 : 1;
    return ord.ascending ? cmp : -cmp;
  });
}

type Mode = 'select' | 'insert' | 'update' | 'delete' | 'upsert';

class MockQuery<T = Row> implements PromiseLike<{ data: T | T[] | null; error: null }> {
  private filters: Filter[] = [];
  private ordering?: { col: string; ascending: boolean };
  private limitN?: number;
  private singleMode?: 'single' | 'maybeSingle';

  constructor(
    private table: TableName,
    private mode: Mode,
    private payload?: any,
    private upsertOpts?: { onConflict?: string },
  ) {}

  select(_cols?: string) {
    // The mock returns whole rows; column selection is a no-op.
    return this;
  }
  eq(col: string, val: any) {
    this.filters.push({ op: 'eq', col, val });
    return this;
  }
  gte(col: string, val: any) {
    this.filters.push({ op: 'gte', col, val });
    return this;
  }
  lte(col: string, val: any) {
    this.filters.push({ op: 'lte', col, val });
    return this;
  }
  is(col: string, val: any) {
    this.filters.push({ op: 'is', col, val });
    return this;
  }
  contains(col: string, val: any[]) {
    this.filters.push({ op: 'contains', col, val });
    return this;
  }
  order(col: string, opts: { ascending: boolean }) {
    this.ordering = { col, ascending: opts.ascending };
    return this;
  }
  limit(n: number) {
    this.limitN = n;
    return this;
  }
  maybeSingle() {
    this.singleMode = 'maybeSingle';
    return this;
  }
  single() {
    this.singleMode = 'single';
    return this;
  }

  private run(): { data: any; error: null } {
    const tableRows = store[this.table];

    if (this.mode === 'select') {
      let rows = applyFilters(tableRows, this.filters);
      rows = applyOrder(rows, this.ordering);
      if (this.limitN != null) rows = rows.slice(0, this.limitN);
      if (this.singleMode) {
        return { data: rows[0] ?? null, error: null };
      }
      return { data: rows, error: null };
    }

    if (this.mode === 'insert') {
      const payload = this.payload;
      const rowsIn: Row[] = Array.isArray(payload) ? payload : [payload];
      const inserted: Row[] = rowsIn.map((r) => ({
        id: r.id ?? newDemoId(this.table),
        created_at: r.created_at ?? new Date().toISOString(),
        ...r,
      }));
      tableRows.push(...inserted);
      if (this.singleMode) {
        return { data: inserted[0] ?? null, error: null };
      }
      return { data: inserted, error: null };
    }

    if (this.mode === 'update') {
      const targets = applyFilters(tableRows, this.filters);
      for (const row of targets) {
        Object.assign(row, this.payload);
      }
      if (this.singleMode) {
        return { data: targets[0] ?? null, error: null };
      }
      return { data: targets, error: null };
    }

    if (this.mode === 'delete') {
      const remaining = tableRows.filter(
        (r) => !applyFilters([r], this.filters).length,
      );
      const removed = tableRows.length - remaining.length;
      store[this.table] = remaining;
      return { data: { count: removed }, error: null };
    }

    if (this.mode === 'upsert') {
      const payload = this.payload;
      const conflictKey = this.upsertOpts?.onConflict ?? 'id';
      const rowsIn: Row[] = Array.isArray(payload) ? payload : [payload];
      const results: Row[] = [];
      for (const r of rowsIn) {
        const existing = tableRows.find((x) => x[conflictKey] === r[conflictKey]);
        if (existing) {
          Object.assign(existing, r);
          results.push(existing);
        } else {
          const created = {
            id: r.id ?? newDemoId(this.table),
            created_at: new Date().toISOString(),
            ...r,
          };
          tableRows.push(created);
          results.push(created);
        }
      }
      return { data: results, error: null };
    }

    return { data: null, error: null };
  }

  then<TResult1 = { data: any; error: null }, TResult2 = never>(
    onFulfilled?: ((value: { data: any; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
    onRejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    try {
      const result = this.run();
      return Promise.resolve(result).then(onFulfilled as any, onRejected as any);
    } catch (err) {
      return Promise.reject(err).then(onFulfilled as any, onRejected as any);
    }
  }
}

// ---- top-level client -------------------------------------------------------

// Auth state: fake a session so downstream code (family_members lookup) works.
type Listener = (event: string, session: any) => void;
const authListeners = new Set<Listener>();

const fakeSession = {
  access_token: 'demo-token',
  refresh_token: 'demo-refresh',
  token_type: 'bearer',
  expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  user: {
    id: DEMO_USER_ID,
    email: 'demo@halmoni.uk',
    app_metadata: {},
    user_metadata: { name: 'Sofia (demo)' },
    aud: 'authenticated',
    created_at: new Date().toISOString(),
  },
} as const;

export const demoSupabase = {
  from(table: TableName) {
    return {
      select: (cols?: string) => new MockQuery(table, 'select').select(cols),
      insert: (row: any) => new MockQuery(table, 'insert', row),
      update: (patch: any) => new MockQuery(table, 'update', patch),
      delete: () => new MockQuery(table, 'delete'),
      upsert: (row: any, opts?: { onConflict?: string }) =>
        new MockQuery(table, 'upsert', row, opts),
    };
  },
  auth: {
    async getSession() {
      return { data: { session: fakeSession }, error: null };
    },
    onAuthStateChange(cb: Listener) {
      authListeners.add(cb);
      // Immediately notify so consumers hydrate.
      setTimeout(() => cb('SIGNED_IN', fakeSession), 0);
      return {
        data: {
          subscription: {
            unsubscribe() {
              authListeners.delete(cb);
            },
          },
        },
      };
    },
    async signOut() {
      authListeners.forEach((l) => l('SIGNED_OUT', null));
      return { error: null };
    },
    async signInWithOtp() {
      return { data: null, error: { message: 'Demo mode is read-only for auth.' } };
    },
    async verifyOtp() {
      return { data: null, error: { message: 'Demo mode is read-only for auth.' } };
    },
  },
  async rpc(fn: string, _args?: any) {
    if (fn === 'create_invite') {
      return { data: 'DEMO-INVITE-CODE', error: null };
    }
    // Everything else deliberately refuses rather than pretending.
    //
    // This used to be `return { data: null, error: null }` — a silent success
    // for work that had not happened. "Create family" and "Join family"
    // reported no error and dropped you back into the sample family with
    // nothing created, which reads as the button being broken. Worse,
    // `delete_my_account` claimed to have deleted an account and then wiped
    // local data, so the demo appeared to honour a destructive action it had
    // not performed. A demo that looks like it works while nothing happens is
    // the failure mode this app has already decided is worse than no demo.
    const refusals: Record<string, string> = {
      create_family:
        'The demo is a fixed sample family. Creating your own needs a real account.',
      accept_invite:
        'The demo is a fixed sample family. Joining one needs a real account.',
      delete_my_account: 'There is nothing to delete — the demo is not a real account.',
    };
    return {
      data: null,
      error: { message: refusals[fn] ?? `"${fn}" is not available in the demo.` },
    };
  },
  // Referenced from the demo-fixtures constants — re-export here so demo
  // components can access them without importing fixtures directly.
  demo: { familyId: DEMO_FAMILY_ID, parentId: DEMO_PARENT_ID, userId: DEMO_USER_ID },
};

export type DemoSupabase = typeof demoSupabase;
