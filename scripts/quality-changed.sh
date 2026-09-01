#!/usr/bin/env bash
set -euo pipefail

base="${QUALITY_BASE_SHA:-ae43e4dcb03e96fd9ec410467f5cba8c965c6baa}"
mapfile -t changed < <(
  {
    git diff --name-only --diff-filter=ACMR "$base" --
    git ls-files --others --exclude-standard
  } | sort -u
)

typescript=()
for file in "${changed[@]}"; do
  if [[ "$file" =~ ^(src|test)/.*\.ts$ ]]; then
    typescript+=("$file")
  fi
done

if (( ${#typescript[@]} == 0 )); then
  echo "No changed TypeScript files require strict quality checks."
  exit 0
fi

./node_modules/.bin/eslint --max-warnings=0 "${typescript[@]}"
./node_modules/.bin/prettier --check "${typescript[@]}"
echo "Changed-file quality checks passed for ${#typescript[@]} TypeScript file(s)."
