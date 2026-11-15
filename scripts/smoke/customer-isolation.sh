#!/usr/bin/env sh
# Customer portal isolation smoke test (spec 0044).
#
# Checks that customers can only authenticate on the customer origin, never through the central auth
# front door (auth-proxy) or the staff gateway, and that the customer edge only exposes its allowlist.
#
# Usage:
#   CUSTOMER_ORIGIN=https://customer-ticketing-web.<env>.azurecontainerapps.io \
#   CENTRAL_ORIGIN=https://<auth-proxy-host> \
#   GATEWAY_ORIGIN=https://ticketing-gateway.<env>.azurecontainerapps.io \
#   [CUSTOMER_TOKEN=<customer bearer token>] [STAFF_TOKEN=<central JWT>] \
#   sh scripts/smoke/customer-isolation.sh
#
# Optional tokens enable the token checks (AC-13, AC-9). Exits with 1 on any mismatch.

set -u
: "${CUSTOMER_ORIGIN:?set CUSTOMER_ORIGIN}"
: "${CENTRAL_ORIGIN:?set CENTRAL_ORIGIN}"
: "${GATEWAY_ORIGIN:?set GATEWAY_ORIGIN}"
CUSTOMER_TOKEN="${CUSTOMER_TOKEN:-}"
STAFF_TOKEN="${STAFF_TOKEN:-}"

FAILED=0
PASSED=0

# code METHOD URL [extra curl args...]
code() {
  method="$1"; url="$2"; shift 2
  curl -s -o /dev/null -w '%{http_code}' -X "$method" --max-time 20 "$@" "$url"
}

# expect LABEL WANT GOT   (WANT may be "!404" meaning "anything except 404")
expect() {
  label="$1"; want="$2"; got="$3"
  case "$want" in
    !*) if [ "$got" != "${want#!}" ] && [ "$got" != "000" ]; then ok=1; else ok=0; fi ;;
    *)  if [ "$got" = "$want" ]; then ok=1; else ok=0; fi ;;
  esac
  if [ "$ok" = 1 ]; then PASSED=$((PASSED + 1)); printf 'PASS  %-70s %s\n' "$label" "$got"
  else FAILED=$((FAILED + 1)); printf 'FAIL  %-70s got %s, want %s\n' "$label" "$got" "$want"; fi
}

echo "== AC-3: customer credential routes are closed on the central door and the staff gateway"
for origin in "$CENTRAL_ORIGIN" "$GATEWAY_ORIGIN"; do
  for path in customer/login customer/Login customer/login/ customer/auth/refresh customer/forgot-password \
              customer/forgot-password/verify customer/reset-password customer/first-login/verify-otp \
              customer/change-password customer/register; do
    expect "POST $origin/api/ticketing/$path" 404 "$(code POST "$origin/api/ticketing/$path" -H 'Content-Type: application/json' -d '{}')"
  done
  expect "POST $origin/api/customer/login (no ticketing prefix)" 404 "$(code POST "$origin/api/customer/login" -d '{}')"
  expect "GET  $origin/api/ticketing/customer/encryption-key (staff allowlist)" '!404' "$(code GET "$origin/api/ticketing/customer/encryption-key")"
done

echo "== AC-3: customer login still works on the customer origin"
expect "POST customer origin /api/ticketing/customer/login reaches customer-service" '!404' \
  "$(code POST "$CUSTOMER_ORIGIN/api/ticketing/customer/login" -H 'Content-Type: application/json' -d '{}')"

echo "== AC-4: the customer edge exposes only its allowlist"
for path in api/ticketing/employee/departments api/ticketing/notification/x api/ticketing/customer/customers/provision \
            api/ticketing/ticket/internal/tickets/1/sla/recalculate api/ticketing/messaging/internal/tickets/1/messages api/login; do
  expect "customer origin /$path" 404 "$(code POST "$CUSTOMER_ORIGIN/$path" -d '{}')"
done

echo "== AC-8: provisioning needs the internal secret"
expect "POST gateway customers/provision without secret" 401 \
  "$(code POST "$GATEWAY_ORIGIN/api/ticketing/customer/customers/provision" -H 'Content-Type: application/json' -d '{}')"

if [ -n "$CUSTOMER_TOKEN" ]; then
  echo "== AC-13 / AC-6: customer token works on the customer origin only"
  expect "customer token on customer origin /customer/me" 200 \
    "$(code GET "$CUSTOMER_ORIGIN/api/ticketing/customer/me" -H "Authorization: Bearer $CUSTOMER_TOKEN")"
  expect "customer token on customer origin /ticket/tickets" '!401' \
    "$(code GET "$CUSTOMER_ORIGIN/api/ticketing/ticket/tickets" -H "Authorization: Bearer $CUSTOMER_TOKEN")"
  for origin in "$CENTRAL_ORIGIN" "$GATEWAY_ORIGIN"; do
    expect "customer token on $origin /customer/me" 401 \
      "$(code GET "$origin/api/ticketing/customer/me" -H "Authorization: Bearer $CUSTOMER_TOKEN")"
    expect "customer token + forged edge header on $origin /ticket/tickets" 401 \
      "$(code GET "$origin/api/ticketing/ticket/tickets" -H "Authorization: Bearer $CUSTOMER_TOKEN" -H 'X-Ticketing-Edge: customer')"
  done
fi

if [ -n "$STAFF_TOKEN" ]; then
  echo "== AC-9 / AC-13: staff identity never works through the customer edge cookie, still works on the gateway"
  expect "staff access_token cookie on customer origin /customer/me" 401 \
    "$(code GET "$CUSTOMER_ORIGIN/api/ticketing/customer/me" -H "Cookie: access_token=$STAFF_TOKEN")"
  expect "staff JWT on gateway /customer/me" 200 \
    "$(code GET "$GATEWAY_ORIGIN/api/ticketing/customer/me" -H "Authorization: Bearer $STAFF_TOKEN")"
fi

echo
echo "Passed: $PASSED  Failed: $FAILED"
[ "$FAILED" -eq 0 ]
