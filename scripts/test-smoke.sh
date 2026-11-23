#!/usr/bin/env bash
set -uo pipefail
BASE=http://localhost:3000
PASS=0; FAIL=0
EMAIL="smoke-$(date +%s)@example.com"
PASSWD="TestPass123!"
COOKIE=/tmp/opencode/smoke-cookies.txt
rm -f "$COOKIE"

check() {
  local name="$1" expected="$2" actual="$3" body="${4:-}"
  if [[ "$actual" == "$expected" ]]; then
    echo "PASS: $name ($actual)"
    PASS=$((PASS+1))
  else
    echo "FAIL: $name expected=$expected actual=$actual body=$(echo "$body" | head -c 300)"
    FAIL=$((FAIL+1))
  fi
}

req() {
  local method="$1" path="$2" data="${3:-}"
  if [[ -n "$data" ]]; then
    BODY=$(curl -s -w '\n%{http_code}' -b "$COOKIE" -c "$COOKIE" -X "$method" \
      -H 'Content-Type: application/json' -d "$data" "$BASE$path")
  else
    BODY=$(curl -s -w '\n%{http_code}' -b "$COOKIE" -c "$COOKIE" -X "$method" "$BASE$path")
  fi
  HTTP_CODE=$(echo "$BODY" | tail -1)
  BODY=$(echo "$BODY" | sed '$d')
}

jval() { echo "$1" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{let j=JSON.parse(s);let k=process.argv[1];console.log(k.split(".").reduce((o,x)=>o?.[x],j)??"")}catch(e){}})' "$2"; }

echo "=== Registration ==="
req POST /api/v1/auth/register "{\"fullName\":\"Smoke Tester\",\"email\":\"$EMAIL\",\"password\":\"$PASSWD\"}"
check "register" 201 "$HTTP_CODE" "$BODY"

echo "=== Login (fresh session) ==="
rm -f "$COOKIE"
req POST /api/v1/auth/login "{\"email\":\"$EMAIL\",\"password\":\"$PASSWD\"}"
check "login" 200 "$HTTP_CODE" "$BODY"

echo "=== Profile ==="
req GET /api/v1/users/profile
check "profile" 200 "$HTTP_CODE" "$BODY"

echo "=== Farm create ==="
FARM_DATA='{"name":"Smoke Farm","latitude":-0.3031,"longitude":36.08,"size":5,"areaUnit":"hectares","irrigation":"rainfed","clientId":"smoke-farm-1"}'
req POST /api/v1/farms "$FARM_DATA"
check "farm create" 201 "$HTTP_CODE" "$BODY"
FARM_ID=$(jval "$BODY" farm.id)
FARM_VER=$(jval "$BODY" farm.version)
[[ -n "$FARM_VER" ]] || FARM_VER=1

echo "=== Farm duplicate (idempotency) ==="
req POST /api/v1/farms "$FARM_DATA"
check "farm duplicate" 200 "$HTTP_CODE" "$BODY"

echo "=== Farm get ==="
req GET "/api/v1/farms/$FARM_ID"
check "farm get" 200 "$HTTP_CODE" "$BODY"

echo "=== Farm patch (optimistic concurrency) ==="
req PATCH "/api/v1/farms/$FARM_ID" "{\"name\":\"Smoke Farm Updated\",\"version\":$FARM_VER}"
check "farm patch" 200 "$HTTP_CODE" "$BODY"

echo "=== Farm patch stale version -> 409 ==="
req PATCH "/api/v1/farms/$FARM_ID" "{\"name\":\"Stale Update\",\"version\":$FARM_VER}"
check "farm stale version" 409 "$HTTP_CODE" "$BODY"

echo "=== Crops list ==="
req GET /api/v1/crops
check "crops" 200 "$HTTP_CODE" "$BODY"
CROP_ID=$(echo "$BODY" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{let j=JSON.parse(s);console.log((j.crops||j)[0]?.id||"")}catch(e){}})')

echo "=== Planting create ==="
TODAY=$(date -u +%Y-%m-%d)
PLANT_DATA="{\"farmId\":\"$FARM_ID\",\"cropId\":\"$CROP_ID\",\"plantingDate\":\"$TODAY\",\"plantedArea\":2,\"areaUnit\":\"hectares\",\"season\":\"Smoke Season\",\"clientId\":\"smoke-planting-1\"}"
req POST /api/v1/plantings "$PLANT_DATA"
check "planting create" 201 "$HTTP_CODE" "$BODY"
PLANT_ID=$(jval "$BODY" planting.id)
PLANT_VER=$(jval "$BODY" planting.version)
[[ -n "$PLANT_VER" ]] || PLANT_VER=1

echo "=== Planting duplicate ==="
req POST /api/v1/plantings "$PLANT_DATA"
check "planting duplicate" 200 "$HTTP_CODE" "$BODY"

echo "=== Planting patch ==="
req PATCH "/api/v1/plantings/$PLANT_ID" "{\"notes\":\"Smoke notes\",\"version\":$PLANT_VER}"
check "planting patch" 200 "$HTTP_CODE" "$BODY"

echo "=== Device create ==="
DEV_DATA="{\"farmId\":\"$FARM_ID\",\"name\":\"Smoke Device\",\"hardware\":\"ESP32\",\"sensors\":[\"soil_moisture\",\"air_temperature\"],\"intervalSec\":60}"
req POST /api/v1/devices "$DEV_DATA"
check "device create" 201 "$HTTP_CODE" "$BODY"
DEV_ID=$(jval "$BODY" device.id)
DEV_UID=$(jval "$BODY" device.deviceUid)
DEV_KEY=$(jval "$BODY" apiKey)

echo "=== IoT reading (valid) ==="
READING="{\"messageId\":\"smoke-1\",\"measuredAt\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"readings\":[{\"type\":\"soil_moisture\",\"value\":35},{\"type\":\"air_temperature\",\"value\":24}]}"
HTTP_CODE=$(curl -s -o /tmp/opencode/iot-resp.txt -w '%{http_code}' -X POST -H 'Content-Type: application/json' \
  -H "X-Device-Id: $DEV_UID" -H "Authorization: Bearer $DEV_KEY" -d "$READING" "$BASE/api/v1/iot/readings")
check "iot reading" 201 "$HTTP_CODE" "$(cat /tmp/opencode/iot-resp.txt)"

echo "=== IoT reading (invalid sensor sentinel) ==="
READING2="{\"messageId\":\"smoke-2\",\"measuredAt\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"readings\":[{\"type\":\"soil_temperature\",\"value\":-127}]}"
HTTP_CODE=$(curl -s -o /tmp/opencode/iot-resp2.txt -w '%{http_code}' -X POST -H 'Content-Type: application/json' \
  -H "X-Device-Id: $DEV_UID" -H "Authorization: Bearer $DEV_KEY" -d "$READING2" "$BASE/api/v1/iot/readings")
check "iot invalid reading accepted but flagged" 201 "$HTTP_CODE" "$(cat /tmp/opencode/iot-resp2.txt)"

echo "=== Dashboard ==="
req GET "/api/v1/dashboard?farmId=$FARM_ID"
check "dashboard" 200 "$HTTP_CODE" "$BODY"

echo "=== Farm readings ==="
req GET "/api/v1/farms/$FARM_ID/readings?days=7"
check "farm readings" 200 "$HTTP_CODE" "$BODY"

echo "=== Farm activities ==="
req GET "/api/v1/farms/$FARM_ID/activities"
check "farm activities" 200 "$HTTP_CODE" "$BODY"

echo "=== Activity with planting ==="
req POST "/api/v1/farms/$FARM_ID/activities" "{\"type\":\"scouting\",\"description\":\"Smoke activity\",\"plantingId\":\"$PLANT_ID\"}"
check "activity create" 201 "$HTTP_CODE" "$BODY"

echo "=== Report valid dates ==="
req GET "/api/v1/reports/farms/$FARM_ID?type=readings&from=2026-01-01&to=2026-12-31"
check "report valid dates" 200 "$HTTP_CODE" "$BODY"

echo "=== Report invalid dates -> 400 ==="
req GET "/api/v1/reports/farms/$FARM_ID?type=readings&from=abc"
check "report invalid dates" 400 "$HTTP_CODE" "$BODY"

echo "=== Geo missing coords -> 422 ==="
req GET /api/v1/geo
check "geo missing coords" 422 "$HTTP_CODE" "$BODY"

echo "=== Notifications ==="
req GET /api/v1/notifications
check "notifications" 200 "$HTTP_CODE" "$BODY"

echo "=== Forgot password (should not leak token) ==="
req POST /api/v1/auth/forgot-password "{\"email\":\"$EMAIL\"}"
check "forgot password" 200 "$HTTP_CODE" "$BODY"
if echo "$BODY" | grep -q "devResetLink\|reset?token"; then
  echo "FAIL: forgot password leaked reset token in response"
  FAIL=$((FAIL+1))
else
  echo "PASS: forgot password did not leak reset token"
  PASS=$((PASS+1))
fi

echo "=== Password change revokes sessions ==="
req PATCH /api/v1/users/password "{\"currentPassword\":\"$PASSWD\",\"newPassword\":\"NewPass123!\"}"
check "password change" 200 "$HTTP_CODE" "$BODY"
req GET /api/v1/users/profile
check "old session invalid after password change" 401 "$HTTP_CODE" "$BODY"

echo ""
echo "=== RESULTS: $PASS passed, $FAIL failed ==="
[[ $FAIL -eq 0 ]]
