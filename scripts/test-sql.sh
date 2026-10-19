#!/usr/bin/env bash
# Runs the whole SQL suite against a throw-away Postgres database.
#   Usage:  PGHOST=... PGPORT=... PGUSER=... [PGPASSWORD=...] scripts/test-sql.sh
# Steps: fresh DB → Supabase shim → db/RUN-ALL.sql twice (idempotency)
#        → every db/tests/NN_*.sql once, in order.
# Never point this at a real Supabase project: the shim fakes auth.uid().
set -euo pipefail
cd "$(dirname "$0")/.."

DB="${TEST_DB:-dubid_test}"
ADMIN_DB="${ADMIN_DB:-postgres}"
psql -v ON_ERROR_STOP=1 -q -d "$ADMIN_DB" -c "DROP DATABASE IF EXISTS $DB" -c "CREATE DATABASE $DB"

P="psql -v ON_ERROR_STOP=1 -q -d $DB"
$P -f db/tests/00_supabase_shim.sql >/dev/null
for pass in 1 2; do
  $P -f db/RUN-ALL.sql >/dev/null
  echo "RUN-ALL pass $pass ok"
done
# Test-only admin password (the real one lives only in production, never in git).
$P -c "UPDATE game.admin_secrets SET secret_hash = encode(digest('test-admin-pass','sha256'),'hex') WHERE id = 'primary'" >/dev/null

fail=0
for f in db/tests/[0-9][0-9]_*.sql; do
  case "$f" in *00_supabase_*) continue ;; esac
  if $P -f "$f" >/tmp/sqltest.log 2>&1; then
    echo "ok   $f"
  else
    echo "FAIL $f"; grep -iE "error|fail" /tmp/sqltest.log | head -5; fail=1
  fi
done
exit $fail
