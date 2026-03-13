#!/usr/bin/env bash
set -euo pipefail

markers_regex='^(<<<<<<< |=======|>>>>>>> )'

matches="$(git grep -nE "$markers_regex" -- . ':(exclude)package-lock.json' ':(exclude)bun.lock' || true)"

if [[ -n "$matches" ]]; then
  echo "❌ Foram encontrados marcadores de conflito de merge:"
  echo "$matches"
  echo
  echo "Resolva os conflitos e remova as linhas com <<<<<<<, ======= e >>>>>>>."
  exit 1
fi

echo "✅ Nenhum marcador de conflito de merge encontrado."
