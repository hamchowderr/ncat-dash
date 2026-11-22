#!/bin/sh
# Pushes this version's backend (the Convex functions) to the copy's Convex and gives it
# the settings it needs. It runs in the setup image (the Dockerfile's `setup` stage), so
# the machine needs nothing but Docker:
#
#   docker compose -f deploy/compose.yml --env-file deploy/.env run --rm setup
#
# Run it after the first start, and again after every update, so the dashboard and the
# backend stay the same version. It is safe to run any number of times: the addresses
# are written each time, but a secret is only made when Convex has none yet. Changing
# CONNECTIONS_SECRET would lock every team out of its saved keys, so it is never replaced.
#
# Reads: CONVEX_SELF_HOSTED_URL, CONVEX_SELF_HOSTED_ADMIN_KEY, SITE_URL, AGENT_URL,
# MASTRA_JWT_SECRET and SIGN_UPS (see docs/self-hosting.md).
set -eu

fail() {
  echo "$*" >&2
  exit 1
}

[ -n "${CONVEX_SELF_HOSTED_ADMIN_KEY:-}" ] ||
  fail "Set CONVEX_ADMIN_KEY in deploy/.env first. Make it with: docker compose -f deploy/compose.yml --env-file deploy/.env exec convex ./generate_admin_key.sh"
[ -n "${SITE_URL:-}" ] || fail "Set SITE_URL in deploy/.env to the dashboard's address, such as https://app.example.com."
[ -n "${MASTRA_JWT_SECRET:-}" ] || fail "Set MASTRA_JWT_SECRET in deploy/.env."
case "$SITE_URL" in
  http://* | https://*) ;;
  *) fail "SITE_URL must be a full address starting with https:// (it is \"$SITE_URL\")." ;;
esac

export CONVEX_SELF_HOSTED_URL="${CONVEX_SELF_HOSTED_URL:-http://convex:3210}"
unset CONVEX_DEPLOYMENT CONVEX_DEPLOY_KEY
convex() { /app/node_modules/.bin/convex "$@"; }

# The image has Node but no curl.
answers() { node -e 'fetch(process.argv[1]).then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))' "$1"; }

echo "Waiting for Convex at $CONVEX_SELF_HOSTED_URL"
tries=0
until answers "$CONVEX_SELF_HOSTED_URL/version"; do
  tries=$((tries + 1))
  [ "$tries" -lt 60 ] || fail "Convex did not answer at $CONVEX_SELF_HOSTED_URL. Is it running (docker compose ... up -d)?"
  sleep 2
done

have=$(convex env list 2>/dev/null | cut -d= -f1) ||
  fail "Convex turned the admin key away. Make a new one with generate_admin_key.sh and put it in CONVEX_ADMIN_KEY."
has() { printf '%s\n' "$have" | grep -qx "$1"; }
set_value() { convex env set "$1" "$2" >/dev/null; }
secret() { head -c 32 /dev/urandom | base64 | tr -d '\n'; }

set_value SITE_URL "${SITE_URL%/}"
set_value MASTRA_JWT_SECRET "$MASTRA_JWT_SECRET"
if [ -n "${AGENT_URL:-}" ]; then set_value AGENT_URL "${AGENT_URL%/}"; fi
for name in BETTER_AUTH_SECRET CONNECTIONS_SECRET; do
  if has "$name"; then
    echo "Kept the $name Convex already has"
  else
    set_value "$name" "$(secret)"
    echo "Made $name"
  fi
done
# Only on the first run, so a choice made later with `convex env set` stays.
if ! has SIGN_UPS; then
  set_value SIGN_UPS "${SIGN_UPS:-invite-only}"
  echo "Sign-ups: ${SIGN_UPS:-invite-only}"
fi

echo "Pushing the backend"
cd /app
convex deploy -y --typecheck disable
echo "The backend is up to date. Open $SITE_URL to sign in."
