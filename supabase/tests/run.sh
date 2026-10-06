#!/usr/bin/env bash
# Prueba el SQL de supabase/ en un Postgres limpio:
#   simulación de Supabase → 01…NN (dos veces: deben poder repetirse) → pruebas *.test.sql
# Uso: supabase/tests/run.sh        (con PGHOST/PGUSER/PGPASSWORD del entorno, o el Postgres local)
set -euo pipefail
cd "$(dirname "$0")/.."
DB="${TEST_DB:-crm_test}"
PSQL=(psql -v ON_ERROR_STOP=1 -q -X)
# El instalador de un solo archivo debe estar al día con las migraciones.
NUEVO="$(mktemp)"; ./generar_instalador.sh "$NUEVO" >/dev/null
cmp -s instalar_todo.sql "$NUEVO" || { echo "instalar_todo.sql está desactualizado: ejecuta supabase/generar_instalador.sh y súbelo."; exit 1; }
"${PSQL[@]}" -d postgres -c "drop database if exists $DB" -c "create database $DB"
"${PSQL[@]}" -d "$DB" -f tests/00_supabase_stub.sql 2>&1 | grep -v -E "wal_level|^HINT" || true
for pasada in 1 2; do
  for f in [0-9][0-9]_*.sql; do
    echo ">> migración $f (pasada $pasada)"; PGOPTIONS='-c client_min_messages=warning' "${PSQL[@]}" -d "$DB" -f "$f"
  done
done
# El instalador de un solo archivo funciona en una base limpia (y se puede repetir).
"${PSQL[@]}" -d postgres -c "drop database if exists ${DB}_i" -c "create database ${DB}_i"
"${PSQL[@]}" -d "${DB}_i" -f tests/00_supabase_stub.sql 2>&1 | grep -v -E "wal_level|^HINT" || true
for pasada in 1 2; do PGOPTIONS='-c client_min_messages=warning' "${PSQL[@]}" -d "${DB}_i" -f instalar_todo.sql; done
"${PSQL[@]}" -d postgres -c "drop database ${DB}_i"
echo ">> instalar_todo.sql: OK en base limpia (dos veces)"
shopt -s nullglob
for f in tests/*.test.sql; do
  # Cada archivo de prueba corre en su propia copia limpia de la base ya migrada.
  "${PSQL[@]}" -d postgres -c "drop database if exists ${DB}_t" -c "create database ${DB}_t template $DB"
  echo ">> $f"
  "${PSQL[@]}" -d "${DB}_t" -f "$f" 2>&1 | sed -E 's/^psql:[^ ]+ //' | grep -E '^(NOTICE|ERROR|CONTEXT|DETAIL|HINT)' | sed -E 's/^NOTICE:  //'
done
"${PSQL[@]}" -d postgres -c "drop database if exists ${DB}_t"
echo "Todas las pruebas pasaron."
