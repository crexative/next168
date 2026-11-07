#!/usr/bin/env bash
# Builds the app under the Google flag rows of design S1b 2.7 and checks what each bundle may carry. Run by CI (checks job)
# and locally: `bash scripts/check-google-bundles.sh`. Builds go to throwaway folders.
set -euo pipefail

CLIENT_ID='000000000000-ci.apps.googleusercontent.com'
OUT="$(mktemp -d)"
trap 'rm -rf "$OUT"' EXIT

build() {
  local folder="$1"; shift
  env "$@" npx vite build --outDir "$OUT/$folder" --emptyOutDir --logLevel error
}

fail() {
  echo "::error::$1"
  exit 1
}

# Row 1: no client ID, no flags. No Google sign-in code and no call to the Google server routes.
build plain VITE_GOOGLE_CLIENT_ID= VITE_GOOGLE_SERVER= VITE_GOOGLE_SERVER_INSTALLED=
if grep -rl "gsi/client" "$OUT/plain/assets"; then fail "a build without a Google client ID references gsi/client: the Google module must stay behind its dynamic import."; fi
if grep -rl "api/google" "$OUT/plain/assets"; then fail "a build without a Google client ID references api/google: the server-mode client must stay behind its build flag."; fi

# Accounts and sync (design accounts-and-sync.md S1): a build without VITE_ACCOUNTS carries no call to the account or sync routes.
for needle in "api/auth" "api/sync"; do
  if grep -rl "$needle" "$OUT/plain/assets"; then fail "a build without VITE_ACCOUNTS references $needle: account code must stay behind its build flag."; fi
done

# Client ID only (the e2e build): Google sign-in ships, the server-mode client does not.
build client VITE_GOOGLE_CLIENT_ID="$CLIENT_ID" VITE_GOOGLE_SERVER= VITE_GOOGLE_SERVER_INSTALLED=
if grep -rl "api/google" "$OUT/client/assets"; then fail "a build with a client ID but without VITE_GOOGLE_SERVER references api/google."; fi
grep -rl "gsi/client" "$OUT/client/assets" >/dev/null || fail "a build with a client ID does not carry Google sign-in at all."

# Server mode, with and without the installed-app flag: both Google modules exist, neither is in the entry chunk.
for installed in '' 1; do
  folder="server${installed}"
  build "$folder" VITE_GOOGLE_CLIENT_ID="$CLIENT_ID" VITE_GOOGLE_SERVER=1 VITE_GOOGLE_SERVER_INSTALLED="$installed"
  entry="$(grep -oE 'assets/index-[A-Za-z0-9_-]+\.js' "$OUT/$folder/index.html" | head -n 1)"
  [ -n "$entry" ] || fail "no entry chunk found in the server-mode build."
  for needle in "api/google" "gsi/client"; do
    if grep -q "$needle" "$OUT/$folder/$entry"; then fail "the entry chunk of the server-mode build references $needle: it must stay in a lazy chunk."; fi
    others="$(grep -rl "$needle" "$OUT/$folder/assets" | grep -v "$entry" || true)"
    [ -n "$others" ] || fail "no chunk of the server-mode build carries $needle."
  done
done

# Accounts flag on: S2 PLACEHOLDER. Nothing imports ACCOUNTS_ENABLED in S1, so this build carries no account code and the check
# below cannot fail today. It exists so that once the S2 client lands behind the flag it must stay out of the entry chunk.
build accounts VITE_GOOGLE_CLIENT_ID="$CLIENT_ID" VITE_GOOGLE_SERVER= VITE_GOOGLE_SERVER_INSTALLED= VITE_ACCOUNTS=1
entry="$(grep -oE 'assets/index-[A-Za-z0-9_-]+\.js' "$OUT/accounts/index.html" | head -n 1)"
[ -n "$entry" ] || fail "no entry chunk found in the accounts build."
for needle in "api/auth" "api/sync"; do
  if grep -q "$needle" "$OUT/accounts/$entry"; then fail "the entry chunk of the accounts build references $needle: it must stay in a lazy chunk."; fi
done
echo "Google bundle rows hold."
