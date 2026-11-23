#!/usr/bin/env bash
set -uo pipefail
BASE=http://localhost:3000
PASS=0; FAIL=0
COOKIE=/tmp/opencode/verify-cookies.txt
EMAIL="verify-$(date +%s)@example.com"
rm -f "$COOKIE"

check() {
  if [[ "$2" == "$3" ]]; then echo "PASS: $1 ($2)"; PASS=$((PASS+1));
  else echo "FAIL: $1 expected=$2 actual=$3 body=$(echo "$4" | head -c 200)"; FAIL=$((FAIL+1)); fi
}
req() {
  local m="$1" p="$2" d="${3:-}"
  if [[ -n "$d" ]]; then B=$(curl -s -w '\n%{http_code}' -b "$COOKIE" -c "$COOKIE" -X "$m" -H 'Content-Type: application/json' -d "$d" "$BASE$p");
  else B=$(curl -s -w '\n%{http_code}' -b "$COOKIE" -c "$COOKIE" -X "$m" "$BASE$p"); fi
  C=$(echo "$B"|tail -1); B=$(echo "$B"|sed '$d')
}
jv() { echo "$1" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{let j=JSON.parse(s);console.log(process.argv[1].split(".").reduce((o,x)=>o?.[x],j)??"")}catch(e){}})' "$2"; }

req POST /api/v1/auth/register "{\"fullName\":\"Verify User\",\"email\":\"$EMAIL\",\"password\":\"TestPass123!\"}"
check "register" 201 "$C" "$B"

req POST /api/v1/farms '{"name":"Verify Farm","latitude":-1.2921,"longitude":36.8219,"size":3,"areaUnit":"hectares","irrigation":"irrigated","clientId":"verify-farm"}'
check "farm" 201 "$C" "$B"; FID=$(jv "$B" farm.id)

req GET /api/v1/crops
CID=$(echo "$B"|node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{let j=JSON.parse(s);console.log((j.crops||j)[0]?.id||"")}catch(e){}})')
TODAY=$(date -u +%Y-%m-%d)
req POST /api/v1/plantings "{\"farmId\":\"$FID\",\"cropId\":\"$CID\",\"plantingDate\":\"$TODAY\",\"plantedArea\":2,\"areaUnit\":\"hectares\",\"clientId\":\"verify-plant\"}"
check "planting" 201 "$C" "$B"; PID=$(jv "$B" planting.id)

req POST /api/v1/predictions "{\"farmId\":\"$FID\",\"plantingId\":\"$PID\"}"
check "prediction" 201 "$C" "$B"; PREDID=$(jv "$B" prediction.id)

req GET "/api/v1/predictions/$PREDID"
check "prediction detail" 200 "$C" "$B"

req GET "/api/v1/farms/$FID/weather?days=7"
check "forecast" 200 "$C" "$B"

req GET "/api/v1/farms/$FID/soil"
check "soil" 200 "$C" "$B"

req GET "/api/v1/farms/$FID/risks"
check "risks" 200 "$C" "$B"

req GET "/api/v1/farms/$FID/recommendations"
check "recommendations" 200 "$C" "$B"

# Public pages
for p in / /auth/login /auth/register /offline /manifest.webmanifest /icons/agrisense.svg /sw.js; do
  code=$(curl -s -o /dev/null -w '%{http_code}' "$BASE$p")
  check "page $p" 200 "$code" ""
done

echo ""; echo "=== RESULTS: $PASS passed, $FAIL failed ==="
[[ $FAIL -eq 0 ]]
