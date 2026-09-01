#!/usr/bin/env bash
# Two drift checks. Silence means clean.
#
#   1. Does production still have every column the mirror expects?
#      (the 2026-08-31 failure: created_at missing from five tables)
#   2. Has the local mirror's shape changed without the snapshot being refreshed?
#      (catches a schema edit landing without anyone reviewing it, including a
#      NOT NULL change, which check 1 physically cannot see)
#
# Run before any release, and after touching src/lib/db/schema.ts.
set -euo pipefail
cd "$(dirname "$0")/.."

fail=0

echo "── 1. server has what the mirror expects ──"
if ! node scripts/verify-schema.mjs; then
  fail=1
fi

echo
echo "── 2. local mirror matches the reviewed snapshot ──"
if [ ! -f scripts/schema-snapshot.json ]; then
  echo "No snapshot yet. Create one with: node scripts/snapshot-schema.mjs"
  fail=1
elif ! git ls-files --error-unmatch scripts/schema-snapshot.json >/dev/null 2>&1; then
  # `git diff` reports nothing for an untracked file, so without this guard the
  # check silently passes and reports "no drift" for every change. Found exactly
  # that way while testing it.
  echo "Snapshot exists but is not committed, so there is nothing to diff against."
  echo "Commit scripts/schema-snapshot.json first."
  fail=1
else
  node scripts/snapshot-schema.mjs >/dev/null
  if git diff --quiet -- scripts/schema-snapshot.json; then
    echo "OK — mirror unchanged since the last reviewed snapshot."
  else
    echo "The local mirror has changed and the snapshot was not refreshed:"
    echo
    git --no-pager diff -- scripts/schema-snapshot.json | sed 's/^/    /'
    echo
    echo "If the change is intentional, commit the refreshed snapshot alongside it."
    echo "If it is not, revert src/lib/db/schema.ts."
    fail=1
  fi
fi

echo
if [ "$fail" -eq 0 ]; then
  echo "No drift."
else
  echo "DRIFT — see above."
fi
exit "$fail"
