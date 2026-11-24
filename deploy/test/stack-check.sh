#!/usr/bin/env bash
# Starts Convex and the web app from deploy/compose.yml the way an owner would, pushes
# the backend to it with the setup image, and checks that signing up works and that an
# invite-only copy keeps strangers out. Run from the repository root:
#   WEB_IMAGE=takewon-web:check SETUP_IMAGE=takewon-setup:check deploy/test/stack-check.sh
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
WEB_IMAGE=${WEB_IMAGE:-ghcr.io/hamchowderr/takewon-web:latest}
SETUP_IMAGE=${SETUP_IMAGE:-ghcr.io/hamchowderr/takewon-setup:latest}
ENV

compose() {
  docker compose -p takewon-check -f "$root/deploy/compose.yml" -f "$here/compose.check.yml" \
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
cat >> "$env_file" <<ENV
CONVEX_ADMIN_KEY=$admin_key
SITE_URL=http://127.0.0.1:3000
ENV

# The setup image pushes the backend, as an owner runs it: the machine needs only Docker.
echo "Pushing the backend with the setup image"
compose run --rm setup > "$work/setup.log" 2>&1 || { cat "$work/setup.log"; exit 1; }
grep -q "Made CONNECTIONS_SECRET" "$work/setup.log" || { cat "$work/setup.log"; exit 1; }
connections_secret() {
  compose run --rm --no-deps --entrypoint /app/node_modules/.bin/convex setup env get CONNECTIONS_SECRET 2>/dev/null | tail -1
}
first_secret=$(connections_secret)
[ -n "$first_secret" ] || { echo "Setup left Convex without a CONNECTIONS_SECRET" >&2; exit 1; }

# Running it again (as after an update) keeps the secrets: a new CONNECTIONS_SECRET would
# lock every team out of its saved keys.
compose run --rm setup > "$work/setup-again.log" 2>&1 || { cat "$work/setup-again.log"; exit 1; }
grep -q "Kept the CONNECTIONS_SECRET" "$work/setup-again.log" || { cat "$work/setup-again.log"; exit 1; }
[ "$(connections_secret)" = "$first_secret" ] || { echo "Setup replaced CONNECTIONS_SECRET" >&2; exit 1; }
echo "Setup ran twice and kept the secrets"

wait_for http://127.0.0.1:3000/sign-up

page=$(curl -fsS http://127.0.0.1:3000/sign-up)
if grep -q "takewon.invalid" <<<"$page"; then
  echo "The sign-up page still holds a stand-in address" >&2
  exit 1
fi
# The page's scripts point at this copy's Convex, written in when the container started.
found=0
for chunk in $(grep -oE '/_next/static/[^"]+\.js' <<<"$page" | sort -u); do
  body=$(curl -fsS "http://127.0.0.1:3000$chunk")
  if grep -q "takewon.invalid" <<<"$body"; then
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
