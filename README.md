# 🌱 AgriSense — *A Land That Can Talk*

AgriSense is an installable **Progressive Web App** for agricultural intelligence: farm & crop management, **ESP32 IoT soil/climate monitoring**, **Open-Meteo** weather and **ISRIC SoilGrids** soil integration, a transparent **rule-based crop-yield prediction engine**, risk analysis, recommendations, notifications and reports.

> It answers three questions for a farmer: *What is happening on my farm?* (monitoring) · *What is likely to happen to my crops?* (prediction) · *What should I pay attention to?* (intelligence).

**New to the repo? Start with [`docs/GIT_WORKFLOW.md`](docs/GIT_WORKFLOW.md)** — Ubuntu setup, cloning, pushing and the team branching workflow. To run and demo every feature, use [`docs/RUNBOOK.md`](docs/RUNBOOK.md).

The active application uses Next.js for pages and a standalone Go service for backend APIs. Next.js proxies `/api/v1/*` and `/api/health` to the Go service. The earlier Vite starter remains in [`frontend/`](frontend) as a reference scaffold; it is not the app launched by the root-level commands below.

---

## Tech stack (V1)

| Layer | Choice |
|------|--------|
| Frontend (PWA) | Next.js 16 App Router, React 19, TypeScript, Tailwind CSS 4, service worker, IndexedDB outbox |
| Backend | Standalone Go HTTP API — versioned REST API at `/api/v1` (Next.js proxies API requests) |
| Database | PostgreSQL (Go `pgx`; schema managed by Drizzle Kit) |
| Domain logic | Go API implementation under `backend/internal/api` |
| IoT | ESP32 (Arduino C++) → MQTT/TLS bridge or HTTPS JSON; idempotent message IDs |
| External data | Open-Meteo (forecast + ERA5 archive + elevation), ISRIC SoilGrids v2, OSM Nominatim, OpenStreetMap embed maps |
| Notifications | In-app centre + Web Push (VAPID, optional) |

> The API is a Go service; the Next.js app is the frontend and reverse proxy. PostgreSQL schema changes continue to use the existing Drizzle schema and migration tooling.

## Project structure

```
agrisense/
├── docs/                      # GIT_WORKFLOW, ARCHITECTURE, API contracts
├── firmware/esp32/agrisense_node/   # ESP32 firmware (+ config.example.h)
├── iotcode/                   # ESP32 MQTT firmware for HiveMQ
├── public/                    # sw.js (service worker), icons, images
├── scripts/simulate-device.mjs      # ESP32 simulator for demos without hardware
├── scripts/seed-exhibition-demo.mjs # field account, farm, plantings and readings
├── backend/                   # Go API, PostgreSQL access and endpoint handlers
└── src/
    ├── app/
    │   ├── page.tsx           # landing page
    │   ├── auth/[mode]/       # login · register · forgot · reset · verify
    │   ├── (app)/             # protected app: dashboard, farms, predictions, monitoring,
    │   │                      #   devices, weather, recommendations, notifications,
    │   │                      #   reports, settings, admin
    │   ├── manifest.ts        # web app manifest
    │   └── offline/           # offline fallback page
    ├── components/            # UI kit, charts, map, app shell, PWA widgets
    ├── db/schema.ts           # Drizzle schema used by migration tooling
    ├── lib/client/            # API client, IndexedDB offline queue, hooks/context
    └── proxy.ts               # route protection (Next 16 "proxy", formerly middleware)
```

`firmware/esp32/agrisense_node/` sends readings directly to the AgriSense HTTP
API. The `iotcode/` sketch publishes to MQTT; configure the Go API's MQTT
subscriber in `.env` to forward those readings into the same app data store.

## Run locally (Ubuntu)

The repo includes a self-contained PostgreSQL helper — no system database or Docker is required:

```bash
cp .env.example .env      # defaults point at the bundled DB on 127.0.0.1:5433
npm install
npm run db:start          # initialise & start PostgreSQL (first run creates the cluster)
npm run db:push           # create/update tables
```

Run the API and frontend in separate terminals:

```bash
npm run dev:api           # Go API on :3001
npm run dev               # Next.js frontend and API proxy on :3000
```

For a complete field dataset, run:

```bash
npm run field:seed        # creates farm data, plantings, device and readings
npm run field:live        # same, then streams new readings for 10 minutes
```

The seeder signs in as `farm.manager@agrisense.local` / `AgriSense2026!` and creates a farm, plantings, NPK readings, rule-based predictions, risks and recommendations. Readings go through the same `/api/v1/iot/readings` endpoint as the ESP32 firmware. See [`docs/RUNBOOK.md`](docs/RUNBOOK.md) for the full walkthrough.

Production-style run:

```bash
npm run build && npm run build:api
npm start                 # Next.js frontend
./dist/agrisense-api      # Go API
```

Use an existing PostgreSQL server instead by setting `DATABASE_URL` in `.env`:
```bash
DATABASE_URL=postgresql://user:password@127.0.0.1:5432/app_db
```

- The **first registered account becomes admin**.
- Without an email provider, verification/reset links are printed in the server log and shown on screen (dev "console mode"). **Reset tokens are never returned by the API in production** — configure `MAIL_API_URL` (and optionally `MAIL_API_KEY`) to deliver real emails.
- Crop catalogue (maize, beans, wheat, rice, potatoes + varieties) is seeded automatically and fully editable via **Admin → Crop catalogue** (`/api/v1/admin/crops`, `/api/v1/admin/varieties`).
- Risk thresholds are runtime-configurable from `system_settings` via `/api/v1/admin/settings`; `DELETE` resets them to built-in defaults.
- Farms can be shared with other accounts as `viewer` or `manager` via `/api/v1/farms/{id}/members` (owner/admin only).
- Predictions include an environmental **suitability verdict/score** and proactive **advisories** in addition to the yield range, harvest window, risks and factors.
- IoT ingestion accepts optional NPK nutrient probes (`soil_n`, `soil_p`, `soil_k` in mg/kg) alongside moisture, pH, soil temperature, air temperature and humidity.

## End-to-end demo (SRS §11)

1. Register → add a farm (search a place, use GPS, or type coordinates).
2. Add a **maize** planting (Farm → Crops & plantings).
3. **Devices** → register an ESP32 and select its sensors. Copy the device ID
   and MQTT topic from the one-time credentials panel.
4. Configure the MQTT bridge in `.env`, copy the ID/topic into the firmware,
   then flash it. Sensor readings appear in the serial monitor and refresh in
   the app. To post a reading manually, click **“Send reading”** or run
   `DEVICE_ID=as-xxxx DEVICE_API_KEY=ask_xxx BACKFILL_HOURS=48 node scripts/simulate-device.mjs`
5. Dashboard / Monitoring show readings with timestamps, units and fault flags.
6. **Predictions** → generate → see yield range, total production, harvest window, suitability verdict, advisories, risks, factors, data quality, limitations and the saved input snapshot.
7. Revisit the prediction later; export CSV/PDF from **Reports**.

## PWA & offline

- Installable (manifest, scalable AgriSense icon, standalone display, install button + iOS fallback hint).
- Service worker: cached app shell and previously visited pages (offline fallback, `/offline` page). API responses are **never** cached by the service worker to avoid cross-user data leaks; offline snapshots live in IndexedDB and are cleared on sign-out/401.
- IndexedDB: last-seen data snapshots + an **outbox** of queued changes (create farm/planting, log activity, complete recommendation). Replayed in order on reconnect; idempotent via `clientId`; **409 conflicts** are surfaced for review instead of overwriting newer data.
- Status pill: Online / Offline / Syncing / N pending / needs review.
- New predictions are disabled offline (they need fresh weather/soil data) — cached predictions remain viewable.

## Web Push (optional)

```bash
npx web-push generate-vapid-keys   # put keys in .env (VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY)
```
Without VAPID keys, alerts still appear in the in-app centre and as local device notifications while the app is open.

## Scripts

| Command | Purpose |
|--------|---------|
| `npm run dev` | Dev server |
| `npm run dev:api` / `npm run start:api` | Go API (development runner) |
| `npm run build && npm run build:api` | Production builds for frontend and API |
| `npm start` / `./dist/agrisense-api` | Run frontend and Go API |
| `npm run typecheck` | TypeScript |
| `npm run lint` | ESLint |
| `npm run db:start` / `db:stop` / `db:status` | Manage the bundled local PostgreSQL |
| `npm run db:push` | Apply schema changes to the database |
| `npm run db:generate` | Generate a versioned SQL migration from the schema into `drizzle/` |
| `npm run test:smoke` / `test:api` / `test:backend` | HTTP integration suites (require the app and local DB to be running) |
| `npm test` | Run Go unit tests and all three HTTP integration suites |

## Data attribution

Weather data by [Open-Meteo.com](https://open-meteo.com) (CC BY 4.0) · Soil data © ISRIC SoilGrids (CC BY 4.0) · Maps & geocoding © OpenStreetMap contributors (ODbL; respect the Nominatim 1 req/s usage policy).
