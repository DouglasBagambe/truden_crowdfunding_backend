#!/usr/bin/env bash
set -euo pipefail

lint_report="$(mktemp)"
format_report="$(mktemp)"
trap 'rm -f "$lint_report" "$format_report"' EXIT

lint_status=0
./node_modules/.bin/eslint '{src,apps,libs,test}/**/*.ts' --format json >"$lint_report" || lint_status=$?
if (( lint_status > 1 )); then
  echo "ESLint failed before producing a usable baseline report." >&2
  exit "$lint_status"
fi

read -r errors warnings files < <(
  node -e '
    const fs = require("fs");
    const results = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const errors = results.reduce((n, result) => n + result.errorCount, 0);
    const warnings = results.reduce((n, result) => n + result.warningCount, 0);
    process.stdout.write(`${errors} ${warnings} ${results.length}\n`);
  ' "$lint_report"
)

if (( files == 0 )); then
  echo "ESLint produced an empty baseline report." >&2
  exit 1
fi
if (( errors > 5245 || warnings > 108 )); then
  echo "Legacy lint baseline regressed: ${errors} errors/${warnings} warnings; maximum 5245/108." >&2
  exit 1
fi

format_status=0
./node_modules/.bin/prettier --list-different 'src/**/*.ts' 'test/**/*.ts' >"$format_report" || format_status=$?
if (( format_status > 1 )); then
  echo "Prettier failed before producing a usable baseline report." >&2
  exit "$format_status"
fi

formatted_files="$(awk 'NF { count++ } END { print count + 0 }' "$format_report")"
if (( formatted_files > 116 )); then
  echo "Legacy format baseline regressed: ${formatted_files} files; maximum 116." >&2
  exit 1
fi

echo "Legacy baseline accepted: ${errors} lint errors, ${warnings} warnings, ${formatted_files} unformatted files. Changed files must pass current rules."
