#!/usr/bin/env bash
set -u
BASE=http://localhost:3000
PASS=0; FAIL=0
TS=$(date +%s)
EMAIL="backend-$TS@example.com"
EMAIL2="backend2-$TS@example.com"
PW="TestPass123!"
C1=/tmp/c1-$TS.cookies; C2=/tmp/c2-$TS.cookies

check() {
  local name="$1" expected="$2" actual="$3"
  if [[ "$actual" == "$expected" ]]; then echo "PASS: $name ($actual)"; PASS=$((PASS+1));
  else echo "FAIL: $name expected=$expected actual=$actual"; FAIL=$((FAIL+1)); fi
}

code() { curl -s -o /tmp/resp-$TS.json -w '%{http_code}' "$@"; }
body() { cat /tmp/resp-$TS.json; }

api() { # method path cookies [data]
  local m="$1" p="$2" c="$3" d="${4-}"
  local args=(-s -o /tmp/resp-$TS.json -w '%{http_code}' -X "$m" -b "$c" -c "$c" -H 'Content-Type: application/json' "$BASE$p")
  [[ -n "$d" ]] && args+=(-d "$d")
  curl "${args[@]}"
}

PSQL="psql -h 127.0.0.1 -p 5433 -U postgres -d app_db -tAc"

echo "=== Setup accounts ==="
check "register admin candidate" 201 "$(api POST /api/v1/auth/register $C1 "{\"fullName\":\"Backend Admin\",\"email\":\"$EMAIL\",\"password\":\"$PW\"}")"
check "register member" 201 "$(api POST /api/v1/auth/register $C2 "{\"fullName\":\"Backend Member\",\"email\":\"$EMAIL2\",\"password\":\"$PW\"}")"
$PSQL "UPDATE users SET role='admin' WHERE email='$EMAIL';" >/dev/null
check "login admin" 200 "$(api POST /api/v1/auth/login $C1 "{\"email\":\"$EMAIL\",\"password\":\"$PW\"}")"
check "login member" 200 "$(api POST /api/v1/auth/login $C2 "{\"email\":\"$EMAIL2\",\"password\":\"$PW\"}")"

echo "=== Settings API ==="
check "GET admin settings" 200 "$(api GET /api/v1/admin/settings $C1)"
grep -q '"key":"risk_thresholds"' /tmp/resp-$TS.json && { echo "PASS: risk_thresholds listed"; PASS=$((PASS+1)); } || { echo "FAIL: risk_thresholds listed"; FAIL=$((FAIL+1)); }
check "PATCH settings" 200 "$(api PATCH /api/v1/admin/settings $C1 '{"key":"risk_thresholds","value":{"heavyRain7dMediumMm":120}}')"
check "GET settings effective" 200 "$(api GET /api/v1/admin/settings $C1)"
grep -q '"heavyRain7dMediumMm":120' /tmp/resp-$TS.json && { echo "PASS: override effective"; PASS=$((PASS+1)); } || { echo "FAIL: override effective"; FAIL=$((FAIL+1)); }
check "PATCH invalid setting rejected" 400 "$(api PATCH /api/v1/admin/settings $C1 '{"key":"unknown_key","value":{}}')"
check "DELETE settings reset" 200 "$(api DELETE '/api/v1/admin/settings?key=risk_thresholds' $C1)"

echo "=== Crop catalogue admin ==="
check "GET crops" 200 "$(api GET /api/v1/admin/crops $C1)"
CROP_ID=$($PSQL "SELECT id FROM crops WHERE slug='maize';")
check "PATCH crop invalid range rejected" 400 "$(api PATCH /api/v1/admin/crops $C1 "{\"cropId\":\"$CROP_ID\",\"baseYieldMin\":99,\"baseYieldMax\":1}")"
check "PATCH crop valid" 200 "$(api PATCH /api/v1/admin/crops $C1 "{\"cropId\":\"$CROP_ID\",\"baseYieldMax\":6.5}")"
check "POST crop" 201 "$(api POST /api/v1/admin/crops $C1 '{"slug":"test-crop-'"$TS"'","name":"Test Crop","yieldUnit":"t/ha","baseYieldMin":1,"baseYieldMax":3,"maturityDaysMin":60,"maturityDaysMax":90,"baseTempC":10,"gddToMaturity":900,"tempOptMin":18,"tempOptMax":30,"tempCriticalLow":8,"tempCriticalHigh":35,"waterNeedMinMm":300,"waterNeedMaxMm":500,"soilMoistureMin":20,"soilMoistureMax":40,"phMin":5.5,"phMax":7.5}')"
NEW_CROP_ID=$(grep -o '"id":"[^"]*"' /tmp/resp-$TS.json | head -1 | cut -d'"' -f4)
check "POST variety" 201 "$(api POST /api/v1/admin/varieties $C1 "{\"cropId\":\"$NEW_CROP_ID\",\"name\":\"Test Variety\",\"maturityFactor\":0.9,\"yieldFactor\":1.1}")"
VAR_ID=$(grep -o '"id":"[^"]*"' /tmp/resp-$TS.json | head -1 | cut -d'"' -f4)
check "GET varieties" 200 "$(api GET /api/v1/admin/varieties $C1)"
check "DELETE variety" 200 "$(api DELETE "/api/v1/admin/varieties?id=$VAR_ID" $C1)"
check "DELETE crop (deactivate)" 200 "$(api DELETE "/api/v1/admin/crops?id=$NEW_CROP_ID" $C1)"

echo "=== Farm member management ==="
check "create farm" 201 "$(api POST /api/v1/farms $C1 '{"name":"Backend Test Farm","latitude":-1.29,"longitude":36.82,"size":2,"areaUnit":"hectares","irrigation":"rainfed"}')"
FARM_ID=$(grep -o '"id":"[^"]*"' /tmp/resp-$TS.json | head -1 | cut -d'"' -f4)
check "GET members (owner only)" 200 "$(api GET /api/v1/farms/$FARM_ID/members $C1)"
check "member cannot manage" 403 "$(api GET /api/v1/farms/$FARM_ID/members $C2)"
check "POST member" 201 "$(api POST /api/v1/farms/$FARM_ID/members $C1 "{\"email\":\"$EMAIL2\",\"role\":\"manager\"}")"
MEMBER_ID=$($PSQL "SELECT id FROM users WHERE email='$EMAIL2';")
check "member can now read farm" 200 "$(api GET /api/v1/farms/$FARM_ID $C2)"
check "PATCH member role" 200 "$(api PATCH /api/v1/farms/$FARM_ID/members $C1 "{\"userId\":\"$MEMBER_ID\",\"role\":\"viewer\"}")"
check "DELETE member" 200 "$(api DELETE "/api/v1/farms/$FARM_ID/members?userId=$MEMBER_ID" $C1)"
check "member access revoked" 403 "$(api GET /api/v1/farms/$FARM_ID $C2)"

echo "=== NPK sensor ingestion ==="
check "create NPK device" 201 "$(api POST /api/v1/devices $C1 "{\"farmId\":\"$FARM_ID\",\"name\":\"NPK Node\",\"sensors\":[\"soil_moisture\",\"soil_n\",\"soil_p\",\"soil_k\"],\"intervalSec\":900}")"
DEV_UID=$(grep -o '"deviceUid":"[^"]*"' /tmp/resp-$TS.json | head -1 | cut -d'"' -f4)
DEV_KEY=$(grep -o '"apiKey":"[^"]*"' /tmp/resp-$TS.json | head -1 | cut -d'"' -f4)
NPK_BODY='{"messageId":"npk-'"$TS"'","readings":[{"type":"soil_moisture","value":31.5},{"type":"soil_n","value":45},{"type":"soil_p","value":22},{"type":"soil_k","value":180}]}'
CODE=$(curl -s -o /tmp/resp-$TS.json -w '%{http_code}' -X POST -H 'Content-Type: application/json' -H "X-Device-Id: $DEV_UID" -H "Authorization: Bearer $DEV_KEY" -d "$NPK_BODY" $BASE/api/v1/iot/readings)
check "NPK ingestion" 201 "$CODE"
grep -q '"accepted":4' /tmp/resp-$TS.json && { echo "PASS: 4 NPK readings accepted"; PASS=$((PASS+1)); } || { echo "FAIL: NPK accepted body=$(body)"; FAIL=$((FAIL+1)); }

echo "=== Prediction suitability ==="
check "create planting" 201 "$(api POST /api/v1/plantings $C1 "{\"farmId\":\"$FARM_ID\",\"cropId\":\"$CROP_ID\",\"plantingDate\":\"$(date +%F -d '-10 days')\",\"plantedArea\":1,\"areaUnit\":\"hectares\",\"irrigation\":\"rainfed\",\"status\":\"planted\"}")"
PLANT_ID=$(grep -o '"id":"[^"]*"' /tmp/resp-$TS.json | head -1 | cut -d'"' -f4)
check "generate prediction" 201 "$(api POST /api/v1/predictions $C1 "{\"plantingId\":\"$PLANT_ID\"}")"
PRED_ID=$(grep -o '"id":"[^"]*"' /tmp/resp-$TS.json | head -1 | cut -d'"' -f4)
if [[ -n "$PRED_ID" ]]; then
  check "GET prediction detail" 200 "$(api GET /api/v1/predictions/$PRED_ID $C1)"
  grep -q '"suitability"' /tmp/resp-$TS.json && { echo "PASS: suitability persisted"; PASS=$((PASS+1)); } || { echo "FAIL: suitability missing"; FAIL=$((FAIL+1)); }
  grep -q '"advisories"' /tmp/resp-$TS.json && { echo "PASS: advisories persisted"; PASS=$((PASS+1)); } || { echo "FAIL: advisories missing"; FAIL=$((FAIL+1)); }
else
  echo "FAIL: no prediction id"; FAIL=$((FAIL+1))
fi

echo "=== Maintenance ==="
check "POST retention" 200 "$(api POST /api/v1/admin/maintenance $C1 '{"action":"retention","readingsDays":365}')"
grep -q '"deleted"' /tmp/resp-$TS.json && { echo "PASS: retention counts"; PASS=$((PASS+1)); } || { echo "FAIL: retention counts body=$(body)"; FAIL=$((FAIL+1)); }

echo "=== RESULTS: $PASS passed, $FAIL failed ==="
rm -f "$C1" "$C2"
[[ $FAIL -eq 0 ]]
