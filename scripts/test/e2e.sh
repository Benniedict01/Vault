#!/usr/bin/env bash
# Dev/test-only end-to-end suite for Crypto Vault. Runs against a local
# `next start` server backed by the PGlite wire server (scripts/test/pg-server.mjs).
#
#   bash scripts/test/e2e.sh
#
# Exercises: auth flows, email failure handling, wallet policy, the pricing-null
# contract, monitor failsafe + auth, rate limiting, and API error handling.
# PASS/FAIL lines go to stderr; response bodies to stdout (captured by callers).

set -u
BASE="${BASE:-http://127.0.0.1:3100}"
SQL="node $(dirname "$0")/sql.mjs"
COOKIE_A=''; COOKIE_B=''
PASS=0; FAIL=0

say()  { printf '%s\n' "$*" >&2; }
ok()   { PASS=$((PASS+1)); say "  PASS  $*"; }
bad()  { FAIL=$((FAIL+1)); say "  FAIL  $*"; }

# req STATUS METHOD PATH [JSON_BODY] [COOKIE] — asserts HTTP status.
# COOKIE is a raw Cookie header value (Secure cookies are not re-sent by curl
# over plain http, so the jar is bypassed and the header is set explicitly).
# Prints ONLY the response body on stdout; verdicts on stderr.
req() {
  local want="$1" method="$2" path="$3" body="${4:-}" cookie="${5:-}"
  local args=(-s -o /tmp/e2e_body -w '%{http_code}' -X "$method" "$BASE$path" --max-time 90)
  [ -n "$body" ] && args+=(-H 'content-type: application/json' -d "$body")
  [ -n "$cookie" ] && args+=(-H "Cookie: $cookie")
  local code; code=$(curl "${args[@]}")
  if [ "$code" = "$want" ]; then ok "$method $path -> $code"; else bad "$method $path -> $code (want $want)"; fi
  cat /tmp/e2e_body
}

# body_has SUBSTRING — asserts last response body contains fixed substring.
body_has() {
  if grep -Fq -- "$1" /tmp/e2e_body; then ok "body contains: $1"; else bad "body missing: $1"; fi
}

# do_login EMAIL PASSWORD — logs in and prints the raw `cv_session=...` pair on
# stdout (capture it: COOKIE=$(do_login ...) then assert it is non-empty at the
# call site — command substitution runs in a subshell, so counters must live
# outside). The response body lands in /tmp/e2e_body like req().
do_login() {
  local email="$1" pass="$2"
  local hdrs val
  hdrs=$(curl -sD - -o /tmp/e2e_body -X POST "$BASE/api/auth/login" \
    -H 'content-type: application/json' -d "{\"email\":\"$email\",\"password\":\"$pass\"}" --max-time 30)
  val=$(printf '%s' "$hdrs" | grep -i '^set-cookie: cv_session=' | head -1 | sed 's/^[Ss]et-[Cc]ookie: //' | cut -d';' -f1)
  printf '%s' "$val"
}

say "== Crypto Vault e2e =="
say "-- 1. health & pages --"
req 200 GET /api/health >/dev/null
body_has '"ok":true'
req 200 GET / >/dev/null
body_has 'Crypto'
req 200 GET /login >/dev/null
req 200 GET /signup >/dev/null
req 200 GET /dashboard >/dev/null   # static shell renders; client redirects if signed out

say "-- 2. register validation & email failure handling --"
req 400 POST /api/auth/register '{"email":"not-an-email","password":"password123"}' >/dev/null
body_has 'Enter a valid email'
req 400 POST /api/auth/register '{"email":"x@example.com","password":"short"}' >/dev/null
REQ_OUT=$(req 200 POST /api/auth/register '{"email":"alice@example.com","password":"password123"}')
echo "$REQ_OUT" | jq -e '.ok == true' >/dev/null && ok 'alice registered' || bad 'alice register payload'
echo "$REQ_OUT" | jq -e '.emailSent == false' >/dev/null && ok 'email failed -> emailSent:false (no provider configured)' || bad 'emailSent flag'
echo "$REQ_OUT" | grep -Fq 'Account created' && ok 'friendly message' || bad 'friendly register message'
req 409 POST /api/auth/register '{"email":"alice@example.com","password":"password123"}' >/dev/null

say "-- 3. verification tokens: expiry, single-use --"
req 400 POST /api/auth/verify '{"token":"bogus"}' >/dev/null
body_has 'invalid or expired'
VToken="alice-verify-0001"
VHash=$(printf '%s' "$VToken" | sha256sum | cut -d' ' -f1)
$SQL "UPDATE \"User\" SET \"verificationTokenHash\"='$VHash', \"verificationTokenExpiresAt\"=NOW() + INTERVAL '1 day' WHERE email='alice@example.com'" >/dev/null || bad 'seed alice verify token'
req 200 POST /api/auth/verify "{\"token\":\"$VToken\"}" >/dev/null
body_has '"ok":true'
req 400 POST /api/auth/verify "{\"token\":\"$VToken\"}" >/dev/null   # single-use: reuse rejected
body_has 'invalid or expired'

say "-- 4. login & session cookie flags --"
req 401 POST /api/auth/login '{"email":"alice@example.com","password":"wrongpass1"}' >/dev/null
COOKIE_A=$(do_login 'alice@example.com' 'password123')
[ -n "$COOKIE_A" ] && ok 'alice session cookie captured' || bad 'alice session cookie captured'
body_has '"emailVerified":true'
HDRS=$(curl -sD - -o /dev/null -X POST "$BASE/api/auth/login" -H 'content-type: application/json' \
  -d '{"email":"alice@example.com","password":"password123"}')
echo "$HDRS" | grep -qi 'set-cookie:.*httponly' && ok 'cookie is HttpOnly' || bad 'cookie HttpOnly'
echo "$HDRS" | grep -qi 'set-cookie:.*samesite=lax' && ok 'cookie SameSite=Lax' || bad 'cookie SameSite'
echo "$HDRS" | grep -qi 'set-cookie:.*secure' && ok 'cookie has Secure flag (correct for production https)' || bad 'cookie Secure'

say "-- 5. wallet guards (watch-only + address validation) --"
req 401 GET /api/wallets >/dev/null
req 200 GET /api/wallets '' "$COOKIE_A" >/dev/null
body_has '"wallets":[]'
req 400 POST /api/wallets '{"label":"bad","chain":"ethereum","address":"0x00000000000000000000000000000000000000000000000000000000000000000000000000"}' "$COOKIE_A" >/dev/null
req 400 POST /api/wallets '{"label":"evil","chain":"ethereum","address":"abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about"}' "$COOKIE_A" >/dev/null
body_has 'Private keys and seed phrases are never accepted'
req 400 POST /api/wallets '{"label":"bad","chain":"ethereum","address":"not-an-address"}' "$COOKIE_A" >/dev/null
req 200 POST /api/wallets '{"label":"Alice ETH","chain":"ethereum","address":"0x1111111111111111111111111111111111111111"}' "$COOKIE_A" >/dev/null
body_has 'Alice ETH'

say "-- 6. second-wallet rule (server-side) --"
req 200 POST /api/auth/register '{"email":"bob@example.com","password":"password456"}' >/dev/null
COOKIE_B=$(do_login 'bob@example.com' 'password456')
[ -n "$COOKIE_B" ] && ok 'bob session cookie captured' || bad 'bob session cookie captured'
body_has '"emailVerified":false'
req 200 POST /api/wallets '{"label":"Bob first","chain":"solana","address":"9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin"}' "$COOKIE_B" >/dev/null
REQ_OUT=$(req 403 POST /api/wallets '{"label":"Bob second","chain":"bitcoin","address":"bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq"}' "$COOKIE_B")
echo "$REQ_OUT" | jq -e '.code == "EMAIL_VERIFICATION_REQUIRED"' >/dev/null && ok 'code=EMAIL_VERIFICATION_REQUIRED' || bad 'wallet2 code'
echo "$REQ_OUT" | jq -e '.action == "resend-verification"' >/dev/null && ok 'action=resend-verification offered' || bad 'wallet2 action'
echo "$REQ_OUT" | grep -Fq 'Verify your email before adding another wallet.' && ok 'exact user-facing message' || bad 'wallet2 message'

say "-- 7. resend-verification: generic responses, no enumeration --"
req 200 POST /api/auth/resend-verification '{"email":"nobody@example.com"}' >/dev/null
body_has 'If the account exists'
req 200 POST /api/auth/resend-verification '{"email":"alice@example.com"}' >/dev/null   # verified -> generic
body_has 'If the account exists'

say "-- 8. verified user can add second wallet --"
BToken="bob-verify-0001"
BHash=$(printf '%s' "$BToken" | sha256sum | cut -d' ' -f1)
$SQL "UPDATE \"User\" SET \"verificationTokenHash\"='$BHash', \"verificationTokenExpiresAt\"=NOW() + INTERVAL '1 day', \"emailVerifiedAt\"=NOW() WHERE email='bob@example.com'" >/dev/null || bad 'seed bob verify token'
req 200 POST /api/auth/verify "{\"token\":\"$BToken\"}" >/dev/null
req 200 POST /api/wallets '{"label":"Bob second","chain":"bitcoin","address":"bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq"}' "$COOKIE_B" >/dev/null
body_has 'Bob second'

say "-- 9. forgot / reset password --"
req 200 POST /api/auth/forgot '{"email":"nobody@example.com"}' >/dev/null
body_has "If an account exists for that email, you'll receive a password reset email."
req 200 POST /api/auth/forgot '{"email":"alice@example.com"}' >/dev/null
body_has "If an account exists for that email, you'll receive a password reset email."
RToken="alice-reset-0001"
RHash=$(printf '%s' "$RToken" | sha256sum | cut -d' ' -f1)
$SQL "UPDATE \"User\" SET \"resetTokenHash\"='$RHash', \"resetTokenExpiresAt\"=NOW() + INTERVAL '1 hour' WHERE email='alice@example.com'" >/dev/null || bad 'seed alice reset token'
req 400 POST /api/auth/reset "{\"token\":\"$RToken\",\"password\":\"short\"}" >/dev/null
req 200 POST /api/auth/reset "{\"token\":\"$RToken\",\"password\":\"newpassword123\"}" >/dev/null
body_has '"ok":true'
req 400 POST /api/auth/reset "{\"token\":\"$RToken\",\"password\":\"newpassword123\"}" >/dev/null   # single-use
req 401 POST /api/auth/login '{"email":"alice@example.com","password":"password123"}' >/dev/null   # old password dead
COOKIE_A=$(do_login 'alice@example.com' 'newpassword123')
[ -n "$COOKIE_A" ] && ok 'alice re-login after reset' || bad 'alice re-login after reset'

say "-- 10. expired tokens rejected --"
EToken="alice-expired-0001"
EHash=$(printf '%s' "$EToken" | sha256sum | cut -d' ' -f1)
$SQL "UPDATE \"User\" SET \"verificationTokenHash\"='$EHash', \"verificationTokenExpiresAt\"=NOW() - INTERVAL '1 hour' WHERE email='alice@example.com'" >/dev/null || bad 'seed expired token'
req 400 POST /api/auth/verify "{\"token\":\"$EToken\"}" >/dev/null
body_has 'invalid or expired'

say "-- 11. monitor: auth + failsafe on provider outage --"
req 401 POST /api/monitor >/dev/null
code=$(curl -s -o /tmp/e2e_body -w '%{http_code}' -X POST "$BASE/api/monitor" -H "Authorization: Bearer wrong-secret" --max-time 90)
[ "$code" = "401" ] && ok 'bad cron secret -> 401' || bad "bad cron secret -> $code"
REQ_OUT=$(req 200 POST /api/monitor '' "$COOKIE_A")
echo "$REQ_OUT" | jq -e '(.checked | type == "number") and (.degraded | type == "array")' >/dev/null \
  && ok 'user monitor returns checked + degraded[]' || bad 'user monitor shape'
REQ_OUT=$(curl -s -X POST "$BASE/api/monitor" -H "Authorization: Bearer ${CRON_SECRET}" --max-time 120 -w '\n%{http_code}')
echo "$REQ_OUT" | tail -1 | grep -q 200 && ok 'cron monitor -> 200' || bad 'cron monitor'
echo "$REQ_OUT" | head -1 | jq -e '.users >= 2' >/dev/null && ok 'cron monitor saw all users' || bad 'cron monitor users'

say "-- 12. portfolio: price-unavailable contract (no fabricated \$0.00) --"
REQ_OUT=$(req 200 GET /api/portfolio '' "$COOKIE_A")
echo "$REQ_OUT" | jq -e '.wallets | length >= 1' >/dev/null && ok 'portfolio has wallets' || bad 'portfolio wallets'
echo "$REQ_OUT" | jq -e '.wallets[0].nativeUsdValue == null' >/dev/null && ok 'nativeUsdValue is null when unpriced' || bad 'nativeUsdValue null'
echo "$REQ_OUT" | jq -e '.wallets[0].priceAvailable == false' >/dev/null && ok 'priceAvailable=false' || bad 'priceAvailable flag'
echo "$REQ_OUT" | jq -e '.hasUnpriced == true' >/dev/null && ok 'hasUnpriced=true' || bad 'hasUnpriced flag'

say "-- 13. settings & activity degrade --"
req 200 GET /api/settings '' "$COOKIE_A" >/dev/null
body_has 'alice@example.com'
req 200 PATCH /api/settings '{"minimumNotificationUsd":"0"}' "$COOKIE_A" >/dev/null
body_has '"minimumNotificationUsd":"0"'
req 200 PATCH /api/settings '{"notifyWithdrawals":true}' "$COOKIE_A" >/dev/null
req 200 GET /api/activity '' "$COOKIE_A" >/dev/null   # indexers unreachable -> degrades to []

say "-- 14. email events recorded (observability) --"
$SQL "SELECT status, \"failureCode\", type FROM \"EmailEvent\" ORDER BY \"createdAt\"" > /tmp/e2e_events.json || bad 'query EmailEvent'
grep -Fq 'failed' /tmp/e2e_events.json && ok 'EmailEvent has failed rows' || bad 'EmailEvent failed rows'
grep -Eq 'EMAIL_NOT_CONFIGURED|NETWORK_ERROR|UNKNOWN' /tmp/e2e_events.json && ok 'EmailEvent has failure codes' || bad 'EmailEvent failure codes'

say "-- 15. rate limiting --"
HIT429=0
for i in $(seq 1 25); do
  code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/auth/login" \
    -H 'content-type: application/json' -d '{"email":"alice@example.com","password":"nope-nope-nope"}' --max-time 15)
  [ "$code" = "429" ] && HIT429=1
done
[ "$HIT429" = "1" ] && ok 'login rate limit returns 429' || bad 'login rate limit never triggered'

say ""
say "== RESULT: $PASS passed, $FAIL failed =="
[ "$FAIL" = "0" ]
