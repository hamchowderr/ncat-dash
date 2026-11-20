#!/bin/sh
# Starts the web app's image. Writes this copy's Convex addresses into the built pages
# in place of the stand-ins the image was built with (see the Dockerfile), then starts
# the Next.js server.
set -eu

check() {
  name=$1
  value=$2
  case "$value" in
    http://* | https://*) ;;
    *)
      echo "Set $name to the full address, starting with https:// (it is \"$value\")." >&2
      exit 1
      ;;
  esac
  # Kept to the characters an address uses, so it can go into sed safely.
  if printf '%s' "$value" | grep -q '[^A-Za-z0-9:/._~%-]'; then
    echo "$name has characters an address doesn't use: \"$value\"." >&2
    exit 1
  fi
}

convex_url=$(printf '%s' "${NEXT_PUBLIC_CONVEX_URL:-}" | sed 's:/*$::')
site_url=$(printf '%s' "${NEXT_PUBLIC_CONVEX_SITE_URL:-}" | sed 's:/*$::')
check NEXT_PUBLIC_CONVEX_URL "$convex_url"
check NEXT_PUBLIC_CONVEX_SITE_URL "$site_url"

while read -r file; do
  cp -p "/app/.pristine$file" "$file"
  sed -i \
    -e "s|https://convex-url\.kontifi\.invalid|$convex_url|g" \
    -e "s|https://convex-site-url\.kontifi\.invalid|$site_url|g" \
    "$file"
done < /app/.stand-ins

if [ -z "${MASTRA_SERVER_URL:-}" ] || [ -z "${MASTRA_JWT_SECRET:-}" ]; then
  echo "MASTRA_SERVER_URL or MASTRA_JWT_SECRET is not set, so the agent chat stays signed out." >&2
fi

cd /app
exec node server.js
