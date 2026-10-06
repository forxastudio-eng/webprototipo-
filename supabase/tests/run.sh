#!/usr/bin/env bash
# Prueba el SQL de supabase/ en un Postgres limpio:
#   simulación de Supabase → 01…NN (dos veces: deben poder repetirse) → pruebas *.test.sql
# Uso: supabase/tests/run.sh        (con PGHOST/PGUSER/PGPASSWORD del entorno, o el Postgres local)
set -euo pipefail
cd "$(dirname "$0")/.."
DB="${TEST_DB:-crm_test}"
PSQL=(psql -v ON_ERROR_STOP=1 -q -X)
"${PSQL[@]}" -d postgres -c "drop database if exists $DB" -c "create database $DB"
"${PSQL[@]}" -d "$DB" -f tests/00_supabase_stub.sql 2>&1 | grep -v -E "wal_level|^HINT" || true
for pasada in 1 2; do
  for f in [0-9][0-9]_*.sql; do
    echo ">> migración $f (pasada $pasada)"; PGOPTIONS='-c client_min_messages=warning' "${PSQL[@]}" -d "$DB" -f "$f"
  done
done
shopt -s nullglob
for f in tests/*.test.sql; do
  # Cada archivo de prueba corre en su propia copia limpia de la base ya migrada.
  "${PSQL[@]}" -d postgres -c "drop database if exists ${DB}_t" -c "create database ${DB}_t template $DB"
  echo ">> $f"
  "${PSQL[@]}" -d "${DB}_t" -f "$f" 2>&1 | sed -E 's/^psql:[^ ]+ //' | grep -E '^(NOTICE|ERROR|CONTEXT|DETAIL|HINT)' | sed -E 's/^NOTICE:  //'
done
"${PSQL[@]}" -d postgres -c "drop database if exists ${DB}_t"
echo "Todas las pruebas pasaron."
