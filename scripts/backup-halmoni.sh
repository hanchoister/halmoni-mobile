#!/bin/bash
# An encrypted backup of everything the app needs to exist (G1-21).
#
# WHY THIS RUNS ON YOUR MAC AND NOT IN CI
#
# A dump needs read access to every row, including health data. Putting that
# credential in GitHub Actions would mean a compromise of the repository is a
# full read of the medical record — a worse trade than the 24 hours of recovery
# point this closes. So the credential never leaves this machine.
#
# The cost is honest: this only runs when the laptop is on. It is defence in
# depth rather than the only net — Supabase's own daily backup (Pro, G0-03)
# still exists underneath it. Point-in-time recovery was priced and declined
# (2026-09-28), so the recovery point objective is: Supabase's daily backup,
# plus however recently this ran.
#
# WHAT IT CAPTURES, and why each part
#
#   public          every care table, policy, trigger, enum and function
#   auth.users      without it a restore has every medication and nobody able
#   auth.identities to sign in — see docs/backup-completeness.md
#
# Extensions are NOT in the dump (pgcrypto and uuid-ossp live in the
# `extensions` schema). The restore notes say to create them first; without
# them create_invite throws 42883 on a restored database.
#
# SETUP, once:
#   1. printf 'SUPABASE_DB_URL=postgresql://…\n' > ~/.halmoni-backup.env
#      chmod 600 ~/.halmoni-backup.env
#      (Supabase dashboard → Connect → Session pooler, with your DB password.)
#   2. openssl rand -base64 48 > ~/.halmoni-backup.key && chmod 600 ~/.halmoni-backup.key
#      THEN COPY THAT KEY SOMEWHERE OFF THIS MACHINE. Losing it makes every
#      backup unreadable, which is the same as having no backups.
#   3. bash scripts/backup-halmoni.sh   (to check it works)
#   4. Install the launchd job — see scripts/com.hanachoi.halmoni-backup.plist
#
# RESTORE: see docs/backup-completeness.md. Do not discover the procedure on
# the day you need it.

set -euo pipefail

ENV_FILE="${HALMONI_BACKUP_ENV:-$HOME/.halmoni-backup.env}"
KEY_FILE="${HALMONI_BACKUP_KEY:-$HOME/.halmoni-backup.key}"
OUT_DIR="${HALMONI_BACKUP_DIR:-$HOME/HalmoniBackups}"
KEEP_DAYS="${HALMONI_BACKUP_KEEP_DAYS:-30}"

# pg_dump must be at least the server's major version. Prod is Postgres 17;
# Homebrew's libpq is 18, which can dump a 17 server. Restoring a v18 dump into
# a v16 server does NOT work — the G1-05 drill hit exactly that.
PG_DUMP="${PG_DUMP:-/opt/homebrew/opt/libpq/bin/pg_dump}"

log() { printf '%s  %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"; }
die() { log "FAILED: $*"; exit 1; }

[ -x "$PG_DUMP" ] || die "pg_dump not found at $PG_DUMP (set PG_DUMP=...)"
[ -f "$ENV_FILE" ] || die "missing $ENV_FILE — see the setup notes at the top of this script"
[ -f "$KEY_FILE" ] || die "missing $KEY_FILE — see the setup notes at the top of this script"

# Refuse to run with a world-readable key. A backup encrypted with a key anyone
# on the machine can read is a backup with extra steps.
PERMS=$(stat -f '%OLp' "$KEY_FILE")
[ "$PERMS" = "600" ] || die "$KEY_FILE has permissions $PERMS — run: chmod 600 $KEY_FILE"

# shellcheck disable=SC1090
set -a; . "$ENV_FILE"; set +a
[ -n "${SUPABASE_DB_URL:-}" ] || die "SUPABASE_DB_URL is not set in $ENV_FILE"

mkdir -p "$OUT_DIR"
chmod 700 "$OUT_DIR"

STAMP=$(date '+%Y%m%dT%H%M%S')
WORK=$(mktemp -d "${TMPDIR:-/tmp}/halmoni-backup.XXXXXX")
# The working directory holds PLAINTEXT health data. Remove it whatever happens,
# including on failure or interrupt.
trap 'rm -rf "$WORK"' EXIT INT TERM
chmod 700 "$WORK"

log "dumping public schema"
"$PG_DUMP" "$SUPABASE_DB_URL" \
  --schema=public --no-owner --no-privileges \
  --file="$WORK/public.sql" || die "pg_dump of public failed"

log "dumping identity (auth.users, auth.identities)"
"$PG_DUMP" "$SUPABASE_DB_URL" \
  --data-only --no-owner --no-privileges \
  --table=auth.users --table=auth.identities \
  --file="$WORK/auth.sql" || die "pg_dump of auth failed"

# A dump that succeeded but wrote nothing is the failure mode that looks like
# success, so check before encrypting rather than discovering it at restore.
for f in public auth; do
  SIZE=$(wc -c < "$WORK/$f.sql" | tr -d ' ')
  [ "$SIZE" -gt 1000 ] || die "$f.sql is only ${SIZE} bytes — refusing to store an empty backup"
done
grep -q 'CREATE TABLE public.medications' "$WORK/public.sql" \
  || die "public.sql has no medications table — the dump is not what we think it is"
grep -q 'COPY auth.users' "$WORK/auth.sql" \
  || die "auth.sql has no auth.users rows — a restore would have nobody able to sign in"

cat > "$WORK/RESTORE.txt" <<'NOTES'
Halmoni backup. Restore order matters.

  1. Create the database, then:
       CREATE SCHEMA IF NOT EXISTS extensions;
       CREATE EXTENSION IF NOT EXISTS pgcrypto  WITH SCHEMA extensions;
       CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;
     Without these, create_invite throws 42883 at call time, not at load time.
  2. psql -v ON_ERROR_STOP=1 -f public.sql
  3. psql -v ON_ERROR_STOP=1 -f auth.sql     (needs the auth schema to exist)
  4. Prove it, do not count rows: call is_family_member() as a real user and
     call create_invite(). Matching row counts are exactly what passed while
     the restore was unusable.

Server must be PostgreSQL 17 or newer. These dumps were taken with pg_dump 18.
NOTES

log "encrypting"
ARCHIVE="$OUT_DIR/halmoni-$STAMP.tar.gz.enc"
tar -czf - -C "$WORK" public.sql auth.sql RESTORE.txt \
  | openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass "file:$KEY_FILE" \
  > "$ARCHIVE" || die "encryption failed"
chmod 600 "$ARCHIVE"

# Prove the archive decrypts NOW, while someone is watching. An encrypted file
# that cannot be opened is indistinguishable from a good one until the day it
# matters.
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass "file:$KEY_FILE" -in "$ARCHIVE" \
  | tar -tzf - > /dev/null 2>&1 || die "the archive just written cannot be decrypted"

log "wrote $ARCHIVE ($(du -h "$ARCHIVE" | cut -f1)), verified decryptable"

DELETED=$(find "$OUT_DIR" -name 'halmoni-*.tar.gz.enc' -mtime "+$KEEP_DAYS" -print -delete | wc -l | tr -d ' ')
[ "$DELETED" = "0" ] || log "pruned $DELETED backup(s) older than $KEEP_DAYS days"

log "ok — $(find "$OUT_DIR" -name 'halmoni-*.tar.gz.enc' | wc -l | tr -d ' ') backup(s) on disk"
