#!/usr/bin/env bash
# Une las migraciones 01…NN en un solo archivo para pegarlo de una vez en Supabase → SQL Editor.
# Uso: supabase/generar_instalador.sh [salida]   (por defecto regenera instalar_todo.sql; las pruebas verifican que esté al día)
set -euo pipefail
cd "$(dirname "$0")"
SALIDA="${1:-instalar_todo.sql}"
{
  echo "-- GPUnlock CRM · instalación completa (generado por supabase/generar_instalador.sh; no lo edites a mano)."
  echo "-- Equivale a ejecutar, en orden, las migraciones 01 → NN. Seguro de repetir."
  for f in [0-9][0-9]_*.sql; do
    printf '\n-- ###########################################################################\n-- %s\n-- ###########################################################################\n' "$f"
    cat "$f"
  done
} > "$SALIDA"
echo "$SALIDA: $(wc -c < "$SALIDA") bytes, $(ls [0-9][0-9]_*.sql | wc -l) migraciones"
