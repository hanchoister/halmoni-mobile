# Supabase schema for halmoni-mobile

Migrations are the source of truth for the backend schema. Every table gets
`updated_at` (auto-bumped via trigger) and `deleted_at` (soft-delete tombstone)
so the offline-first sync engine can do timestamp-based last-write-wins merges.

## Applying migrations

**If you have the Supabase CLI linked to your project:**

```
supabase db push
```

**If not, paste each `migrations/*.sql` into the SQL editor in numeric order.**
Migrations are additive and use `IF NOT EXISTS` guards so they're safe to run
against a partially-populated database — but review the diff first.

## Files

| # | File | Purpose |
| - | ---- | ------- |
| 00 | `initial_schema.sql` | Core tables (families, parents, medications, etc.) with `updated_at` + `deleted_at` on every row |
| 01 | `updated_at_triggers.sql` | Trigger fn + `BEFORE UPDATE` on every table |
| 02 | `rls_policies.sql` | Row-level security scoped by `family_members` membership |
| 03 | `audit_log.sql` | Append-only who-did-what log |
| 04 | `presence.sql` | Heartbeat table for "Sarah active 2h ago" |
| 05 | `share_kits.sql` | Encrypted care-kit share metadata + Storage bucket |

## Schema conventions

- Every user-owned row has `family_id UUID NOT NULL REFERENCES families(id)`.
- `updated_at TIMESTAMPTZ NOT NULL DEFAULT now()` — trigger bumps on UPDATE.
- `deleted_at TIMESTAMPTZ` — soft delete tombstone. Sync clients treat non-null
  as a delete signal but keep the row for tombstone-aware merges.
- IDs are `UUID` (`gen_random_uuid()`) except where an external identifier is
  needed (e.g. `share_kits.id` is a short base32 slug for URL friendliness).
