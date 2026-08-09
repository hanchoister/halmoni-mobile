// SQLite mirror of the Supabase schema. Column types are relaxed (TEXT for
// dates/JSON) because the sync layer handles serialization and Supabase is the
// source of truth for typing. Every table carries updated_at + deleted_at so
// merge is timestamp-based with tombstone awareness.
//
// JSON-shaped columns (arrays, objects) are stored as TEXT and parsed via the
// repository. This keeps SQLite ↔ Postgres alignment simple.

export const SCHEMA_VERSION = 1;

// Ordered so foreign-key-referenced tables come first.
export const CREATE_TABLE_SQL: string[] = [
  `CREATE TABLE IF NOT EXISTS families (
    id           TEXT PRIMARY KEY,
    name         TEXT NOT NULL,
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL,
    deleted_at   TEXT
  )`,

  `CREATE TABLE IF NOT EXISTS family_members (
    id           TEXT PRIMARY KEY,
    family_id    TEXT NOT NULL,
    user_id      TEXT,
    name         TEXT NOT NULL,
    relation     TEXT,
    phone        TEXT,
    color        TEXT,
    photo_url    TEXT,
    is_owner     INTEGER NOT NULL DEFAULT 0,
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL,
    deleted_at   TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS family_members_family_id_idx ON family_members(family_id)`,

  `CREATE TABLE IF NOT EXISTS parents (
    id             TEXT PRIMARY KEY,
    family_id      TEXT NOT NULL,
    name           TEXT NOT NULL,
    nickname       TEXT,
    photo_url      TEXT,
    dob            TEXT,
    conditions     TEXT NOT NULL DEFAULT '[]',
    allergies      TEXT NOT NULL DEFAULT '[]',
    preferences    TEXT,
    blood_type     TEXT,
    ice_contacts   TEXT NOT NULL DEFAULT '[]',
    pharmacy       TEXT,
    primary_doctor TEXT,
    insurance      TEXT,
    created_at     TEXT NOT NULL,
    updated_at     TEXT NOT NULL,
    deleted_at     TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS parents_family_id_idx ON parents(family_id)`,

  `CREATE TABLE IF NOT EXISTS medications (
    id           TEXT PRIMARY KEY,
    parent_id    TEXT NOT NULL,
    family_id    TEXT NOT NULL,
    name         TEXT NOT NULL,
    dose         TEXT,
    purpose      TEXT,
    schedule     TEXT NOT NULL DEFAULT '[]',
    prescriber   TEXT,
    pharmacy     TEXT,
    refill_by    TEXT,
    pills_left   INTEGER,
    notes        TEXT,
    started_at   TEXT,
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL,
    deleted_at   TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS medications_parent_id_idx ON medications(parent_id)`,
  `CREATE INDEX IF NOT EXISTS medications_family_id_idx ON medications(family_id)`,

  `CREATE TABLE IF NOT EXISTS med_doses (
    id                   TEXT PRIMARY KEY,
    medication_id        TEXT NOT NULL,
    parent_id            TEXT NOT NULL,
    family_id            TEXT NOT NULL,
    scheduled_at         TEXT NOT NULL,
    given_at             TEXT,
    given_by_member_id   TEXT,
    skipped              INTEGER NOT NULL DEFAULT 0,
    created_at           TEXT NOT NULL,
    updated_at           TEXT NOT NULL,
    deleted_at           TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS med_doses_medication_id_idx ON med_doses(medication_id)`,
  `CREATE INDEX IF NOT EXISTS med_doses_family_scheduled_idx ON med_doses(family_id, scheduled_at DESC)`,

  `CREATE TABLE IF NOT EXISTS appointments (
    id             TEXT PRIMARY KEY,
    parent_id      TEXT NOT NULL,
    family_id      TEXT NOT NULL,
    provider_name  TEXT,
    specialty      TEXT,
    location       TEXT,
    starts_at      TEXT NOT NULL,
    duration_min   INTEGER,
    status         TEXT NOT NULL DEFAULT 'upcoming',
    summary        TEXT,
    prep_notes     TEXT,
    created_at     TEXT NOT NULL,
    updated_at     TEXT NOT NULL,
    deleted_at     TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS appointments_family_starts_idx ON appointments(family_id, starts_at DESC)`,

  `CREATE TABLE IF NOT EXISTS visit_notes (
    id              TEXT PRIMARY KEY,
    appointment_id  TEXT NOT NULL,
    family_id       TEXT NOT NULL,
    kind            TEXT NOT NULL,
    body            TEXT NOT NULL,
    captured_at     TEXT NOT NULL,
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL,
    deleted_at      TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS visit_notes_appt_idx ON visit_notes(appointment_id)`,

  `CREATE TABLE IF NOT EXISTS symptoms (
    id                       TEXT PRIMARY KEY,
    parent_id                TEXT NOT NULL,
    family_id                TEXT NOT NULL,
    description              TEXT NOT NULL,
    severity                 TEXT,
    observed_at              TEXT NOT NULL,
    observed_by_member_id    TEXT,
    possible_med_links       TEXT,
    created_at               TEXT NOT NULL,
    updated_at               TEXT NOT NULL,
    deleted_at               TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS symptoms_family_observed_idx ON symptoms(family_id, observed_at DESC)`,

  `CREATE TABLE IF NOT EXISTS handoffs (
    id                TEXT PRIMARY KEY,
    parent_id         TEXT NOT NULL,
    family_id         TEXT NOT NULL,
    from_member_id    TEXT NOT NULL,
    to_member_id      TEXT NOT NULL,
    summary           TEXT NOT NULL,
    personal_message  TEXT,
    sent_at           TEXT NOT NULL,
    accepted_at       TEXT,
    until             TEXT,
    created_at        TEXT NOT NULL,
    updated_at        TEXT NOT NULL,
    deleted_at        TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS handoffs_family_sent_idx ON handoffs(family_id, sent_at DESC)`,

  `CREATE TABLE IF NOT EXISTS on_duty (
    id           TEXT PRIMARY KEY,
    parent_id    TEXT NOT NULL UNIQUE,
    family_id    TEXT NOT NULL,
    member_id    TEXT NOT NULL,
    until        TEXT,
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL,
    deleted_at   TEXT
  )`,

  `CREATE TABLE IF NOT EXISTS thread_messages (
    id                 TEXT PRIMARY KEY,
    parent_id          TEXT NOT NULL,
    family_id          TEXT NOT NULL,
    author_member_id   TEXT,
    body               TEXT NOT NULL,
    is_digest          INTEGER NOT NULL DEFAULT 0,
    created_at         TEXT NOT NULL,
    updated_at         TEXT NOT NULL,
    deleted_at         TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS thread_messages_family_created_idx ON thread_messages(family_id, created_at DESC)`,

  `CREATE TABLE IF NOT EXISTS notes (
    id                 TEXT PRIMARY KEY,
    parent_id          TEXT NOT NULL,
    family_id          TEXT NOT NULL,
    author_member_id   TEXT,
    kind               TEXT NOT NULL,
    body               TEXT NOT NULL,
    created_at         TEXT NOT NULL,
    updated_at         TEXT NOT NULL,
    deleted_at         TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS notes_family_created_idx ON notes(family_id, created_at DESC)`,

  // Sync bookkeeping: per-table high-water mark so pulls are incremental.
  `CREATE TABLE IF NOT EXISTS sync_meta (
    table_name       TEXT PRIMARY KEY,
    last_pulled_at   TEXT NOT NULL DEFAULT '1970-01-01T00:00:00Z'
  )`,

  // Offline write queue: local writes stage here and drain to Supabase.
  // op is 'insert' | 'update' | 'delete'; payload is the row JSON.
  `CREATE TABLE IF NOT EXISTS pending_writes (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    table_name   TEXT NOT NULL,
    op           TEXT NOT NULL,
    row_id       TEXT NOT NULL,
    payload      TEXT NOT NULL,
    enqueued_at  TEXT NOT NULL,
    attempts     INTEGER NOT NULL DEFAULT 0,
    last_error   TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS pending_writes_table_idx ON pending_writes(table_name, enqueued_at)`,

  // Known-IDs cache: what we've seen from the server. Distinguishes "server
  // deleted this row" from "we've never seen it" during merge — mirrors
  // evergreen's approach.
  `CREATE TABLE IF NOT EXISTS known_ids (
    table_name   TEXT NOT NULL,
    row_id       TEXT NOT NULL,
    seen_at      TEXT NOT NULL,
    PRIMARY KEY (table_name, row_id)
  )`,
];

// Columns that store JSON in TEXT and need parse/stringify at the repository boundary.
export const JSON_COLUMNS: Record<string, string[]> = {
  parents: ['conditions', 'allergies', 'ice_contacts', 'pharmacy', 'primary_doctor', 'insurance'],
  medications: ['schedule'],
  symptoms: ['possible_med_links'],
};

// Columns that store booleans as 0/1 in SQLite.
export const BOOL_COLUMNS: Record<string, string[]> = {
  family_members: ['is_owner'],
  med_doses: ['skipped'],
  thread_messages: ['is_digest'],
};

export type SyncableTable =
  | 'families'
  | 'family_members'
  | 'parents'
  | 'medications'
  | 'med_doses'
  | 'appointments'
  | 'visit_notes'
  | 'symptoms'
  | 'handoffs'
  | 'on_duty'
  | 'thread_messages'
  | 'notes';

export const SYNCABLE_TABLES: SyncableTable[] = [
  'families',
  'family_members',
  'parents',
  'medications',
  'med_doses',
  'appointments',
  'visit_notes',
  'symptoms',
  'handoffs',
  'on_duty',
  'thread_messages',
  'notes',
];
