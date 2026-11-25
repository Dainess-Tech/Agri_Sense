# AgriSense wake-up runbook

This is the practical “make every feature wake up” guide for the current stack:
Next.js PWA on `:3000`, Go API on `:3001`, bundled PostgreSQL on `:5433`.

All commands below are from the repository root.

---

## 0. One-time setup

```bash
cp .env.example .env
npm install
npm run db:start
npm run db:push
```

`.env` defaults are already correct for the bundled database:

```env
DATABASE_URL=postgresql://postgres@127.0.0.1:5433/app_db
APP_URL=http://localhost:3000
```

---

## 1. Start the whole system

Use three terminals.

**Terminal 1 — database (if not already running):**

```bash
npm run db:start
npm run db:status
```

**Terminal 2 — Go API:**

```bash
npm run dev:api          # http://127.0.0.1:3001
```

**Terminal 3 — Next.js frontend + API proxy:**

```bash
npm run dev              # http://localhost:3000
```

Production-style equivalent:

```bash
npm run build
npm run build:api
npm start                # terminal A
./dist/agrisense-api     # terminal B
```

Verify:

```bash
curl http://localhost:3001/api/health   # {"ok":true}
curl http://localhost:3000/api/health   # {"ok":true}
curl http://localhost:3000/api/v1       # API index
```

Open **http://localhost:3000**.

---

## 1b. Exhibition demo without hardware

Use this when you need a full, realistic-looking farm demonstration tomorrow but
do not have the ESP32 wired up. The seeder creates a **clearly labelled
simulated node**. It sends readings through the same
`POST /api/v1/iot/readings` endpoint used by the real firmware, so the API,
validation, charts, rule engine, notifications and reports are all genuinely
working. Do **not** present these values as physical sensor measurements; say
“this node is simulated; it uses the same ingestion path as the hardware.”

```bash
npm run demo:seed          # one-off realistic 72-hour backfill + predictions + risks
npm run demo:live          # same, then streams new simulated readings for 10 minutes
```

Demo login:

```text
exhibition.demo@agrisense.local
AgriSense2026!
```

What you get:

- Farm: **Nairobi Exhibition Farm** (Nairobi County, Kenya)
- Plantings: maize (42 days old) and beans (24 days old)
- One device: **North field demo station (SIMULATED DEMO)**, UID `demo-nairobi-node-01`
- 15-minute readings for 72 hours: soil moisture, air temperature/humidity,
  soil temperature, pH and **NPK** (nitrogen, phosphorus, potassium)
- Farm activities, rule-based predictions, active risks, recommendations and
  in-app notifications
- Weather and SoilGrids snapshots cached for the demo farm when the providers
  are reachable

Where to show it:

1. `/devices` — the node is marked **SIMULATED DEMO** and shows `fw demo-simulator-1.0`.
2. `/monitoring` — warning notice plus live charts and NPK values.
3. `/predictions` — open a prediction to see suitability, advisories, factors, data quality and limitations.
4. Farm detail → **Risks** → **Re-evaluate now** — the rule engine refreshes risks, recommendations and notifications.
5. `/reports` — printable report and CSV exports include the simulated data.

The seeder is idempotent: running it again reuses the farm and plantings,
rotates the demo API key, skips duplicate message IDs, and refreshes predictions
and rules.

---

## 2. Accounts, first admin, login

1. Open `/auth/register` (landing page: **Get started** / **Create free account**).
2. Fill **Full name**, **Email address**, **Password** (minimum 8 characters), optionally **Country (optional)**, then click **Create account**.
3. The **first account created in a fresh database becomes `admin`**; later accounts are `farmer`.
4. With no mail provider configured, the verification link is printed in the Go API terminal and returned as `devVerificationLink`. Open it, or use `/auth/verify?token=…` and click **Continue to dashboard →**.
5. Log in at `/auth/login` with **Sign in**. Password reset uses **Forgot password? → Send reset link → Update password**.

CLI equivalent:

```bash
BASE=http://localhost:3000
JAR=/tmp/agrisense-demo.cookies
curl -s -c "$JAR" -H 'Content-Type: application/json' \
  -d '{"fullName":"Demo Admin","email":"demo@example.com","password":"DemoPass123!"}' \
  "$BASE/api/v1/auth/register"
curl -s -b "$JAR" -c "$JAR" "$BASE/api/v1/auth/me"
```

To promote another account later:

```bash
curl -s -b "$JAR" -X PATCH -H 'Content-Type: application/json' \
  -d '{"userId":"USER_UUID","role":"admin"}' \
  "$BASE/api/v1/admin/users"
```

---

## 3. Farms and location

UI: **Farms → + Add farm** (or **Register a farm** from the welcome screen). Required: **Farm name**, **Latitude**, **Longitude**, **Farm size**. Optional: **Location / village (optional)**, **Area unit**, **Irrigation**, **Known soil type (optional)**, **Elevation, m (optional)**. Use **📍 Use my current location**, or **Search a place… → Search / Look up → Use saved values** to fill coordinates. Save with **Register farm** / **Save changes**; after saving, the app opens the farm’s **Crops & plantings** tab.

```bash
curl -s -b "$JAR" -H 'Content-Type: application/json' \
  -d '{"name":"Demo Farm","latitude":-1.2921,"longitude":36.8219,"size":5,"areaUnit":"hectares","irrigation":"irrigated","locationName":"Nairobi"}' \
  "$BASE/api/v1/farms"
```

Save the returned `farm.id`:

```bash
FARM_ID=$(curl -s -b "$JAR" "$BASE/api/v1/farms" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);console.log(j.farms?.[0]?.id||"")})')
```

Useful endpoints:

```bash
curl -s -b "$JAR" "$BASE/api/v1/farms/$FARM_ID"
curl -s -b "$JAR" -X PATCH -H 'Content-Type: application/json' \
  -d '{"name":"Demo Farm Renamed","version":1}' "$BASE/api/v1/farms/$FARM_ID"
curl -s -b "$JAR" "$BASE/api/v1/geo?q=Nairobi"
curl -s -b "$JAR" "$BASE/api/v1/geo?lat=-1.2921&lng=36.8219"
```

`PATCH /farms/{id}` requires the current `version`; a stale version returns `409`.

### Share a farm

```bash
curl -s -b "$JAR" -H 'Content-Type: application/json' \
  -d '{"email":"viewer@example.com","role":"manager"}' \
  "$BASE/api/v1/farms/$FARM_ID/members"
curl -s -b "$JAR" "$BASE/api/v1/farms/$FARM_ID/members"
```

Roles: `viewer` = read only, `manager` = can edit. Only the owner or an admin can manage members. The farm-member UI is API-only for now; use `curl` or the API index.

---

## 4. Crop catalogue and varieties

Seeded automatically: maize, beans, wheat, rice, potatoes.

UI: **Admin** → **Crop catalogue** tab. Other tabs are **Overview**, **Users**, **Audit log**. Crop rows have editable **Yield min/max**, **Maturity days**, **Soil moisture %**, **pH range**, **Critical °C low/high**, an **active** checkbox and a **Save** button. Use **Overview → Send to all users** to create a system announcement.

```bash
curl -s -b "$JAR" "$BASE/api/v1/crops"
curl -s -b "$JAR" "$BASE/api/v1/admin/crops"
curl -s -b "$JAR" "$BASE/api/v1/admin/varieties"
```

Create a crop and variety:

```bash
CROP_JSON=$(curl -s -b "$JAR" -X POST -H 'Content-Type: application/json' -d '{
  "slug":"demo-crop","name":"Demo Crop","yieldUnit":"t/ha",
  "baseYieldMin":1,"baseYieldMax":3,"maturityDaysMin":60,"maturityDaysMax":90,
  "baseTempC":10,"gddToMaturity":900,"tempOptMin":18,"tempOptMax":30,
  "tempCriticalLow":8,"tempCriticalHigh":35,
  "waterNeedMinMm":300,"waterNeedMaxMm":500,
  "soilMoistureMin":20,"soilMoistureMax":40,"phMin":5.5,"phMax":7.5
}' "$BASE/api/v1/admin/crops")
NEW_CROP_ID=$(echo "$CROP_JSON" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).id||""))')
curl -s -b "$JAR" -X POST -H 'Content-Type: application/json' \
  -d "{\"cropId\":\"$NEW_CROP_ID\",\"name\":\"Demo Variety\",\"maturityFactor\":0.9,\"yieldFactor\":1.1}" \
  "$BASE/api/v1/admin/varieties"
```

`min <= max` is validated. `DELETE /admin/crops?id=…` deactivates a crop so historical plantings survive.

---

## 5. Plantings and harvest

UI: open a farm → **Crops & plantings** tab → **+ Add planting** / **Record a planting** → **Save planting**. Required: **Crop**, **Planting date**, **Planted area**; optional **Variety (optional)**, **Area unit**, **Season (optional)**, **Irrigation**, **Growth status**, **Notes (optional)**. Use **Update / harvest** on an existing row to set **Status**, **Harvest date**, **Actual yield** and **Unit** (`tonnes`, `kg`, `90 kg bags`). The header **📈 Predict yield** jumps straight to prediction generation.

```bash
CROP_ID=$(curl -s -b "$JAR" "$BASE/api/v1/crops" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).crops?.[0]?.id||""))')
TODAY=$(date +%F)
PLANTING_JSON=$(curl -s -b "$JAR" -X POST -H 'Content-Type: application/json' \
  -d "{\"farmId\":\"$FARM_ID\",\"cropId\":\"$CROP_ID\",\"plantingDate\":\"$TODAY\",\"plantedArea\":2,\"areaUnit\":\"hectares\",\"irrigation\":\"irrigated\",\"status\":\"planted\"}" \
  "$BASE/api/v1/plantings")
PLANTING_ID=$(echo "$PLANTING_JSON" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).planting?.id||""))')
```

Harvest:

```bash
curl -s -b "$JAR" -X PATCH -H 'Content-Type: application/json' \
  -d '{"status":"harvested","actualHarvestDate":"2026-11-25","actualYield":5.2,"actualYieldUnit":"t","version":1}' \
  "$BASE/api/v1/plantings/$PLANTING_ID"
```

`PATCH /plantings/{id}` requires `version`; use the value from `GET /plantings?farmId=…`.

---

## 6. Devices, IoT credentials and readings

UI: **Devices → Register device**. Required: **Device name** (minimum 2) and a farm; optional **Device ID (optional)**. Pick **Measurement interval** (1/5/15/30 min or 1 hour) and connected-sensor checkboxes (**Soil moisture**, **Air temperature**, **Air humidity**, **Soil temperature**, **Soil pH**). **Copy the API key — it is shown once.** Buttons per device: **Readings / Hide**, interval select, **Deactivate / Activate**, **Rotate key**, **Remove**. The credentials panel has **📡 Send simulated reading** and **⚠ Simulate disconnected sensors**. NPK probes are not UI checkboxes yet — add them via the API/firmware example below.

```bash
DEVICE_JSON=$(curl -s -b "$JAR" -X POST -H 'Content-Type: application/json' \
  -d "{\"farmId\":\"$FARM_ID\",\"name\":\"Demo ESP32\",\"sensors\":[\"soil_moisture\",\"air_temperature\",\"air_humidity\",\"soil_temperature\",\"soil_ph\",\"soil_n\",\"soil_p\",\"soil_k\"],\"intervalSec\":900}" \
  "$BASE/api/v1/devices")
DEVICE_ID=$(echo "$DEVICE_JSON" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).device?.deviceUid||""))')
DEVICE_KEY=$(echo "$DEVICE_JSON" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).apiKey||""))')
echo "$DEVICE_ID $DEVICE_KEY"
```

Rotate a lost key:

```bash
curl -s -b "$JAR" -X POST -H 'Content-Type: application/json' \
  -d '{"action":"rotate-key"}' "$BASE/api/v1/devices/$DEVICE_ID"
```

### Option A — simulator (no hardware)

```bash
DEVICE_ID="$DEVICE_ID" DEVICE_API_KEY="$DEVICE_KEY" AGRISENSE_HOST="$BASE" \
  BACKFILL_HOURS=48 INTERVAL_SEC=10 timeout 20s node scripts/simulate-device.mjs
```

`DRY=1` simulates drying soil; `FAULT=1` injects disconnected-probe sentinels.

### Option B — manual ingestion with NPK

```bash
curl -s -X POST -H 'Content-Type: application/json' \
  -H "X-Device-Id: $DEVICE_ID" -H "Authorization: Bearer $DEVICE_KEY" \
  -d '{"messageId":"demo-1","readings":[
        {"type":"soil_moisture","value":31.4},
        {"type":"air_temperature","value":24.2},
        {"type":"air_humidity","value":61},
        {"type":"soil_temperature","value":20.1},
        {"type":"soil_ph","value":6.3},
        {"type":"soil_n","value":45},
        {"type":"soil_p","value":22},
        {"type":"soil_k","value":180}]}' \
  "$BASE/api/v1/iot/readings"
```

Accepted types/units: `soil_moisture` %VWC, `air_temperature` °C, `air_humidity` %RH, `soil_temperature` °C, `soil_ph` pH, `soil_n`/`soil_p`/`soil_k` mg/kg. Sentinels such as `0`, `-127`, or full-scale values are flagged instead of trusted. Duplicate `messageId`s are idempotent.

### Option C — ESP32 firmware

Copy `firmware/esp32/agrisense_node/config.example.h` to `config.h`, set `WIFI_SSID`, `WIFI_PASSWORD`, `AGRISENSE_HOST`, `DEVICE_ID`, `DEVICE_API_KEY`, calibrate the moisture sensor, then flash the sketch. Use `https://` in production; for a LAN demo use `http://192.168.x.x:3000`. The IoT MQTT sketch in `iotcode/` needs a bridge to this HTTP ingestion endpoint.

---

## 7. Monitoring

UI: **Monitoring → Latest readings**. Choose a chart period (**6 h**, **24 h**, **3 days**, **7 days**, **30 days**). Suspect/flagged readings are excluded from trend bands; use **Manage devices** or **Add a farm** from the empty state.

```bash
curl -s -b "$JAR" "$BASE/api/v1/farms/$FARM_ID/readings"
curl -s -b "$JAR" "$BASE/api/v1/farms/$FARM_ID/readings?sensorType=soil_moisture&hours=24"
curl -s -b "$JAR" "$BASE/api/v1/devices/$DEVICE_ID/readings?page=1&limit=50"
curl -s -b "$JAR" "$BASE/api/v1/devices/$DEVICE_ID/readings?series=soil_moisture&hours=24"
```

Device status is `online`, `offline`, or `never`.

---

## 8. Weather and soil

UI: farm detail → **Weather & soil** tab, or the global **Weather & Soil** page. Use **History period** (**30 days**, **90 days**, **180 days**, **1 year**), **⬇ Export as CSV**, and **Retry** if a provider call was incomplete. Cards: **Weather**, **Historical weather**, **Soil properties**.

```bash
curl -s -b "$JAR" "$BASE/api/v1/farms/$FARM_ID/weather?days=7"
curl -s -b "$JAR" "$BASE/api/v1/farms/$FARM_ID/weather?historyDays=30"
curl -s -b "$JAR" "$BASE/api/v1/farms/$FARM_ID/soil"
```

Weather comes from Open-Meteo; soil from ISRIC SoilGrids. Both are cached. `stale: true` means the provider was unreachable and an expired cache entry was served. `503` means no data was available at all.

---

## 9. Predictions (yield, suitability, advisories)

UI: **Predictions** → choose **Planting** → **Generate prediction** (requires an active planting; the button is disabled offline). Progress steps shown: **Validating farm & crop information**, **Retrieving weather history & forecast**, **Retrieving soil properties**, **Reading recent sensor measurements**, **Running crop-specific model**, **Estimating harvest window & risks**, **Saving prediction & input snapshot**. Open a history row for the detail page (**📄 Farm report**, **New prediction**, **Hide/Show input snapshot**, previous-prediction link).

```bash
PRED_JSON=$(curl -s -b "$JAR" -X POST -H 'Content-Type: application/json' \
  -d "{\"plantingId\":\"$PLANTING_ID\"}" "$BASE/api/v1/predictions")
PRED_ID=$(echo "$PRED_JSON" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).prediction?.id||""))')
curl -s -b "$JAR" "$BASE/api/v1/predictions/$PRED_ID"
curl -s -b "$JAR" "$BASE/api/v1/farms/$FARM_ID/predictions"
```

The detail response includes `yieldMin`/`yieldMax`, `totalMin`/`totalMax`, `harvestStart`/`harvestEnd`, `conditionsSummary`, `factors`, `suitability`, `advisories`, `limitations`, `risks`, and the immutable `inputs` snapshot. Limit: 20 predictions per user per hour.

> `methodVersion` is `agrisense-rules-1.1.0`. The explainable engine scores temperature, rainfall, soil moisture, SoilGrids pH and optional NPK probes with transparent weights, then derives suitability, yield adjustment, advisories and limitations. If a provider is unavailable, that component is marked unavailable in `conditionsSummary.dataQuality.components` instead of being silently guessed. Engine code: `backend/internal/api/rule_engine.go`.

---

## 10. Risks and recommendations

UI: farm detail → **Risks** / **Recommendations** tabs; global **Recommendations**. Risk tab has **Re-evaluate now** and **Include resolved risks (history)**. Recommendation filters: **open**, **completed**, **all**; actions **Mark read**, **✓ Mark completed**, **Reopen**; expert items show **👩‍🔬 Requires expert confirmation**. The global empty state is **Nothing needs attention**.

```bash
curl -s -b "$JAR" "$BASE/api/v1/farms/$FARM_ID/risks"
curl -s -b "$JAR" "$BASE/api/v1/farms/$FARM_ID/risks?history=1"
curl -s -b "$JAR" "$BASE/api/v1/farms/$FARM_ID/recommendations"
curl -s -b "$JAR" -X PATCH -H 'Content-Type: application/json' \
  -d '{"status":"completed"}' "$BASE/api/v1/recommendations/RECOMMENDATION_ID"
```

**Re-evaluate now** is live: `refresh=1` runs `agrisense-rules-1.1.0`. It reads
the active plantings, weather forecast, SoilGrids profile and the last 7 days
of valid sensor readings, then upserts deduplicated `farm_risks`, matching
`recommendations` and in-app `notifications`. Stale risks are resolved
automatically. There is no background scheduler, so click **Re-evaluate now**
after new readings arrive (or generate a prediction, which also refreshes the
farm).

```bash
curl -s -b "$JAR" "$BASE/api/v1/farms/$FARM_ID/risks?refresh=1"
curl -s -b "$JAR" "$BASE/api/v1/farms/$FARM_ID/recommendations"
curl -s -b "$JAR" "$BASE/api/v1/notifications"
```

---

## 11. Notifications and Web Push

UI: **Notifications** (or the 🔔 in the app shell). Use **Mark all read**, the **Unread only (N)** toggle, **View**, and **Mark read / Mark unread**. The **Device notifications** card has **🔔 Enable device notifications** / **Re-register push on this device**.

Generate a test system announcement as admin:

```bash
curl -s -b "$JAR" -X POST -H 'Content-Type: application/json' \
  -d '{"title":"Demo announcement","body":"Inspect your farms before the rain."}' \
  "$BASE/api/v1/admin/announcements"
curl -s -b "$JAR" "$BASE/api/v1/notifications?unread=1"
curl -s -b "$JAR" -X POST "$BASE/api/v1/notifications"
```

Optional Web Push keys:

```bash
npx web-push generate-vapid-keys
```

Add `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` to `.env`, restart the Go API, then enable push in **Settings → Notifications** and allow browser permission. `GET /api/v1/notifications/push` reports whether VAPID is configured. The current backend stores subscriptions; it does not yet include a background push dispatcher. Local/in-app notifications work without VAPID while the app is open.

---

## 12. Reports and export

UI: **Reports → Open printable report** (or **⬇ Download PDF** via browser print/Save as PDF). CSV buttons: **⬇ Download readings CSV** (with **From** / **To** dates), **⬇ Last 30 days**, **⬇ Last 90 days**, **⬇ Last 365 days**, **⬇ Plantings & harvests**, **⬇ Predictions**. Printable sections: **Farm details**, **Plantings & harvests**, **Yield predictions**, **Latest sensor readings**, **Risks**, **Recommendations**.

```bash
curl -s -b "$JAR" "$BASE/api/v1/reports/farms/$FARM_ID?type=summary"
curl -s -b "$JAR" "$BASE/api/v1/reports/farms/$FARM_ID?type=readings&from=2026-11-01&to=2026-11-25"
curl -s -b "$JAR" "$BASE/api/v1/reports/farms/$FARM_ID?type=weather&days=14"
curl -s -b "$JAR" "$BASE/api/v1/reports/farms/$FARM_ID?type=plantings"
curl -s -b "$JAR" "$BASE/api/v1/reports/farms/$FARM_ID?type=predictions"
```

CSV responses include a generation timestamp and units.

---

## 13. Admin, settings and maintenance

UI: **Admin** (visible to the admin account).

```bash
curl -s -b "$JAR" "$BASE/api/v1/admin/stats"
curl -s -b "$JAR" "$BASE/api/v1/admin/users?q=demo"
curl -s -b "$JAR" "$BASE/api/v1/admin/audit"
curl -s -b "$JAR" "$BASE/api/v1/admin/settings?key=risk_thresholds"
curl -s -b "$JAR" -X PATCH -H 'Content-Type: application/json' \
  -d '{"key":"risk_thresholds","value":{"heavyRain7dMediumMm":120}}' \
  "$BASE/api/v1/admin/settings"
curl -s -b "$JAR" -X DELETE "$BASE/api/v1/admin/settings?key=risk_thresholds"
curl -s -b "$JAR" -X POST -H 'Content-Type: application/json' \
  -d '{"action":"retention","readingsDays":365}' "$BASE/api/v1/admin/maintenance"
```

Retention removes expired sessions/tokens/cache rows and old logs/readings.

---

## 14. Settings, privacy and PWA offline

UI: **Settings** — cards **Profile** (**Verify email**, **Save profile**), **Appearance** (`light`/`dark`), **Notification preferences** (**Environmental & risk alerts**, **New predictions**, **Device disconnections**, **Harvest-window reminders**, **System announcements**, **Minimum risk severity to notify**, **Send push notifications to my devices**, **🔔 Enable device notifications**), **Install AgriSense**, **Change password**, **Your data** (**⬇ Export my data**), **Delete account** (**Delete my account**).

```bash
curl -s -b "$JAR" "$BASE/api/v1/users/profile"
curl -s -b "$JAR" "$BASE/api/v1/users/preferences"
curl -s -b "$JAR" "$BASE/api/v1/users/export" -o agrisense-export.json
```

Install the PWA from the browser address bar (**Install app**). `/sw.js` caches the app shell and visited pages, never API responses. IndexedDB keeps last-seen snapshots plus an outbox of queued changes; it is replayed on reconnect and cleared on sign-out or `401`. Offline status appears in the app shell as **Online / Offline / Syncing / N pending / needs review**. Generating a new prediction is disabled offline because it needs fresh weather/soil data.

---

## 15. Verify everything

With both servers running:

```bash
npm run typecheck
npm run lint
npm run build
npm run build:api
npm test
```

Expected final results:

```text
test:go       ok  agrisense/backend/internal/api
test:smoke    27 passed, 0 failed
test:api      16 passed, 0 failed
test:backend  37 passed, 0 failed
```

### Troubleshooting

| Symptom | Fix |
|---|---|
| `/api/health` returns `500` | Go API is not running. Start `npm run dev:api` and check `:3001/api/health`. |
| `bind: address already in use` on `:3001` | Stop the old Go process: `pkill -f 'go run .'` (or close its terminal) and restart. |
| `DATABASE_URL is required` | Run `cp .env.example .env` and `npm run db:start`. |
| `pg_ctl: no server running` | Run `npm run db:start`. |
| Weather/soil `503` | Provider unreachable; check network or retry. Cached data returns with `stale: true`. |
| `409` on farm/planting patch | Reload to get the current `version`, then resubmit. |
| No verification email | Console mode prints the link in the Go API terminal; configure `MAIL_API_URL` for real delivery. |
| Too many predictions | Limit is 20/hour/user; wait or use another account. |
