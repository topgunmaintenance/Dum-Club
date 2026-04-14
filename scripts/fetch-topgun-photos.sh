#!/usr/bin/env bash
# fetch-topgun-photos.sh
#
# Mirrors the 5 Topgun Maintenance LLC storefront photos from
# topgunmaintenance.com into frontend/public/images/topgun/ so they
# ship with the Next.js build. Run this once before deploying the
# migration 031 seed (the migration references these exact paths).
#
# Idempotent — safe to re-run. Exits non-zero if any download fails,
# so you can wire it into CI or a pre-deploy hook if you want.
#
# Usage: bash scripts/fetch-topgun-photos.sh
#        (run from the repo root)

set -euo pipefail

DEST="frontend/public/images/topgun"
mkdir -p "$DEST"

# Source → local filename. Keep these in sync with the URLs
# in backend/db/migrations/031_topgun_storefront_seed.sql.
declare -a PHOTOS=(
  "https://topgunmaintenance.com/images/TG-photo-jackingplane.jpeg|tg-jacking-plane.jpeg"
  "https://topgunmaintenance.com/images/topgunpilotinplane.jpeg|tg-pilot-in-plane.jpeg"
  "https://topgunmaintenance.com/images/drone-pilots.jpeg|tg-drone-pilots.jpeg"
  "https://topgunmaintenance.com/images/wing-inspection.jpeg|tg-wing-inspection.jpeg"
  "https://topgunmaintenance.com/images/full-airplane-hanger.jpeg|tg-hangar.jpeg"
)

echo "Mirroring 5 Topgun photos -> $DEST"
for entry in "${PHOTOS[@]}"; do
  url="${entry%%|*}"
  name="${entry##*|}"
  out="$DEST/$name"
  echo "  - $name"
  curl -fsSL --retry 3 --retry-delay 2 -o "$out" "$url"
done

echo "Done. $(ls "$DEST" | wc -l | tr -d ' ') files in $DEST"
