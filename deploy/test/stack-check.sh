#!/usr/bin/env bash
# Starts Convex and the web app from deploy/compose.yml the way an owner would, pushes
# the backend to it, and checks that signing up works and that an invite-only copy
# keeps strangers out. Run from the repository root:
#   WEB_IMAGE=ncat-dash-web:check deploy/test/stack-check.sh
# CI runs it on Intel/AMD and on ARM (.github/workflows/web-image.yml).
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/../.." && pwd)
work=$(mktemp -d)
env_file="$work/.env"
secret() { openssl rand -hex 32; }

cat > "$env_file" <<ENV
CONVEX_URL=http://127.0.0.1:3210
CONVEX_SITE_URL=http://127.0.0.1:3211
CONVEX_INSTANCE_SECRET=$(secret)
TOOLKIT_API_KEY=unused
S3_ENDPOINT_URL=http://127.0.0.1:9
S3_ACCESS_KEY=unused
S3_SECRET_KEY=unused
S3_BUCKET_NAME=unused
AGENT_APP_SECRET=$(secret)
MASTRA_JWT_SECRET=$(secret)
WEB_IMAGE=${WEB_IMAGE:-ghcr.io/hamchowderr/ncat-dash-web:latest}
ENV

compose() {
  docker compose -p kontifi-check -f "$root/deploy/compose.yml" -f "$here/compose.check.yml" \
    --env-file "$env_file" "$@"
}
finish() {
  status=$?
  if [ "$status" -ne 0 ]; then compose logs --tail 80 convex web || true; fi
  compose down -v >/dev/null 2>&1 || true
  rm -rf "$work"
  exit "$status"
}
trap finish EXIT

wait_for() {
  for _ in $(seq 1 90); do
    if curl -fsS -o /dev/null "$1"; then return 0; fi
    sleep 2
  done
  echo "No answer from $1" >&2
  return 1
}

echo "Starting Convex and the web app"
compose up -d convex web
wait_for http://127.0.0.1:3210/version

admin_key=$(compose exec -T convex ./generate_admin_key.sh | tail -1)
export CONVEX_SELF_HOSTED_URL=http://127.0.0.1:3210
export CONVEX_SELF_HOSTED_ADMIN_KEY=$admin_key
unset CONVEX_DEPLOYMENT CONVEX_DEPLOY_KEY

cd "$root"
convex() { npx convex "$@"; }
convex env set SITE_URL http://127.0.0.1:3000 >/dev/null
convex env set BETTER_AUTH_SECRET "$(secret)" >/dev/null
convex env set CONNECTIONS_SECRET "$(secret)" >/dev/null
convex env set MASTRA_JWT_SECRET "$(grep MASTRA_JWT_SECRET "$env_file" | cut -d= -f2)" >/dev/null
convex env set SIGN_UPS invite-only >/dev/null
echo "Pushing the backend"
convex deploy -y > "$work/deploy.log" 2>&1 || { cat "$work/deploy.log"; exit 1; }

wait_for http://127.0.0.1:3000/sign-up

page=$(curl -fsS http://127.0.0.1:3000/sign-up)
if grep -q "kontifi.invalid" <<<"$page"; then
  echo "The sign-up page still holds a stand-in address" >&2
  exit 1
fi
# The page's scripts point at this copy's Convex, written in when the container started.
found=0
for chunk in $(grep -oE '/_next/static/[^"]+\.js' <<<"$page" | sort -u); do
  body=$(curl -fsS "http://127.0.0.1:3000$chunk")
  if grep -q "kontifi.invalid" <<<"$body"; then
    echo "$chunk still holds a stand-in address" >&2
    exit 1
  fi
  if grep -q "127.0.0.1:3210" <<<"$body"; then found=1; fi
done
[ "$found" = 1 ] || { echo "No script on the page points at this copy's Convex" >&2; exit 1; }
echo "Pages point at this copy's Convex"

sign_up() {
  curl -sS -o "$work/answer" -w '%{http_code}' -X POST http://127.0.0.1:3000/api/auth/sign-up/email \
    -H 'Content-Type: application/json' -H 'Origin: http://127.0.0.1:3000' \
    -d "{\"name\":\"$1\",\"email\":\"$2\",\"password\":\"a-long-test-password-1\"}"
}

code=$(sign_up Owner owner@example.test)
[ "$code" = 200 ] || { echo "The owner could not sign up ($code): $(cat "$work/answer")" >&2; exit 1; }
echo "The first account (the owner) signed up"

code=$(sign_up Stranger stranger@example.test)
if [ "$code" = 200 ] || ! grep -q "invite-only" "$work/answer"; then
  echo "A stranger was not turned away ($code): $(cat "$work/answer")" >&2
  exit 1
fi
echo "A stranger was turned away: $(cat "$work/answer")"

echo "Stack check passed on $(uname -m)"
