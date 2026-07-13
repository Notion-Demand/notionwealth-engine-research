#!/bin/bash
# Jump-box helper: runs a tsx script from the correct working directory so
# tsconfig path aliases (@/*) resolve correctly. Not part of the migration
# deliverables — a throwaway helper for running verification scripts against
# the jump-box during implementation, removed before the final PR.
set -e
cd /app
npx tsx "$@"
