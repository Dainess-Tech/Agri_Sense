# AgriSense architecture

## Modular monolith

```
┌──────────────────────────── Client (PWA) ─────────────────────────────┐
│ Next.js pages (src/app/(app)) · components · lib/client/api.ts        │
│ Service worker (public/sw.js) · IndexedDB outbox & snapshots          │
└───────────────▲───────────────────────────────────────────────────────┘
                │ JSON over HTTPS  /api/v1/*
┌───────────────┴──────────── API layer (src/app/api/v1) ───────────────┐
│ handle() error wrapper · zod validation · session auth · RBAC ·       │
│ ownership checks (server/access.ts) · rate limits                     │
├────────────────────────── Services (src/server/services) ─────────────┤
│ weather (Open-Meteo, cache) · soil (SoilGrids, cache) · sensors       │
│ intelligence (evaluateFarm, generatePrediction) · notifications       │
├────────────────────────── Pure domain modules (src/modules) ──────────┤
│ prediction-engine · risk-engine · iot/validation · shared/units       │
└───────────────▲──────────────────────────────────▲────────────────────┘
                │ Drizzle ORM                      │ HTTP
           PostgreSQL                     ESP32 devices · Open-Meteo · SoilGrids · Nominatim · Web Push
```

Rules: pages never touch the DB; route handlers stay thin; domain modules never import DB/HTTP/Next (they are unit-testable and portable to Python).

## Database (logical ERD)

```
users 1─* sessions, auth_tokens          users 1─1 notification_preferences
users 1─* farms ─* farm_members *─1 users
farms 1─* plantings *─1 crops 1─* crop_varieties
farms 1─* farm_activities                plantings 1─* predictions 1─1 prediction_inputs (JSONB snapshot)
farms 1─* iot_devices 1─* sensor_readings (unique device+messageId+sensorType)
iot_devices 1─* device_logs              predictions 1─* prediction_risks; predictions *─1 prediction_versions
farms 1─* farm_risks 1─* recommendations *─1 recommendation_rules
users 1─* notifications, push_subscriptions
sensor_types (reference) · weather_snapshots & soil_profiles (provider cache + provenance)
audit_logs · system_settings
```

Key decisions
- UUID primary keys, `timestamptz` (UTC), `numeric` for measurements/yields, explicit `unit` columns.
- `sensor_readings` stores **measured_at** (device) and **received_at** (server) plus a **quality** flag (`valid | suspect | invalid`). Only `valid` readings feed charts, risks and predictions.
- `predictions` + `prediction_inputs` preserve the exact inputs, sources, retrieval times and engine version — history never silently changes.
- Optimistic concurrency: `farms.version`, `plantings.version` → `409 Conflict`.
- Offline idempotency: `clientId` unique per owner/farm.
- JSONB used only for genuinely flexible data (snapshots, factors, provider payload cache).

## Prediction engine (`agrisense-rules-1.0.0`)

1. Validate input (area > 0, plausible dates, crop params).
2. Attainable yield range (crop catalogue) × variety factor.
3. Limiting factors (multipliers): water balance (rain vs. crop need over the window; irrigation-aware), temperature (heat/cold days & distance from optimum), soil pH (measured preferred over modelled), soil texture & organic carbon, measured soil moisture.
4. Range widened by data-quality score (weather history 30, forecast 20, soil 20, sensors 20, variety 5, planting 5) and remaining season length.
5. Harvest window from growing-degree-days (base temperature, GDD to maturity), fallback to catalogue days.
6. Risks from the risk engine + seasonal deficit; limitations listed explicitly.

No LLM is used to produce numbers. When enough harvest records exist, add `ml-*` versions behind the same contract and compare with `prediction_versions`.

## Risk engine

Configurable thresholds (`DEFAULT_RISK_THRESHOLDS`) + crop thresholds (catalogue). Categories: drought, excessive rainfall, waterlogging, heat stress, cold stress, soil moisture, soil pH, season disruption. Each risk carries severity, explanation and source (sensor / forecast / soil / history). Evaluation (`evaluateFarm`) runs after sensor ingestion, on dashboard load (throttled to 10 min) and on demand; it upserts `farm_risks` with dedupe keys, resolves risks whose source data no longer shows them, creates recommendations and notifications (deduplicated), checks device connectivity and harvest-window reminders.

## IoT protocol

`POST /api/v1/iot/readings` with `X-Device-Id` + `Authorization: Bearer <key>` (keys are hashed, rotatable, independent of user accounts). Single message or `{ messages: [...] }` batch (≤200) for buffered uploads. Idempotent on `(device, messageId, sensorType)`. Response returns `intervalSec` so the server can reconfigure the device. Disconnected sensors are sent as `null` (rejected, not stored) or caught by validation sentinels (DS18B20 −127/85 °C, moisture 0/100 %).

## Offline / sync

- SW caches: shell (precache), pages (network-first → `/offline`), API GETs (network-first → cached copy flagged `x-agrisense-cache: offline`), static assets (cache-first). Auth, IoT and exports are never cached; user caches are cleared on logout.
- IndexedDB `kv` keeps last responses per endpoint; `outbox` keeps queued mutations with status `pending | conflict | failed`.

## Next steps (roadmap)

- Background worker/cron for scheduled `evaluateFarm` over all farms (currently event-driven + on dashboard load).
- Real email provider (Resend/SES) in `server/services/support.ts`.
- MQTT ingestion when device count grows; Redis for rate limits/cache when running multiple instances.
- Calibrate engine with pilot harvest data; add unit tests for `src/modules/*`.
