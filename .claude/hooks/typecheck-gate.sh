#!/usr/bin/env bash
cd "$(dirname "$0")/../../frontend" || exit 1
output=$(npm run typecheck 2>&1)
if [ $? -ne 0 ]; then
  echo "Typecheck failed — fix these type errors before finishing:" >&2
  echo "$output" >&2
  exit 2
fi
exit 0
