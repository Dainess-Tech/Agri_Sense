# 🌱 AgriSense — *A Land That Can Talk*

AgriSense is an installable **Progressive Web App** for agricultural intelligence: farm & crop management, **ESP32 IoT soil/climate monitoring**, **Open-Meteo** weather and **ISRIC SoilGrids** soil integration, a transparent **rule-based crop-yield prediction engine**, risk analysis, recommendations, notifications and reports.

> It answers three questions for a farmer: *What is happening on my farm?* (monitoring) · *What is likely to happen to my crops?* (prediction) · *What should I pay attention to?* (intelligence).

**New to the repo? Start with [`docs/GIT_WORKFLOW.md`](docs/GIT_WORKFLOW.md)** — Ubuntu setup, cloning, pushing and the team branching workflow.

The active application now lives at the repository root and uses Next.js. The earlier Vite starter remains in [`frontend/`](frontend) as a reference scaffold; it is not the app launched by the root-level commands below. The `backend/` directory remains a placeholder because API routes are part of the Next.js app.

---

## Tech stack (V1)

| Layer | Choice |
|------|--------|
| Frontend (PWA) | Next.js 16 App Router, React 19, TypeScript, Tailwind CSS 4, service worker, IndexedDB outbox |
| Backend | Next.js route handlers — versioned REST API at `/api/v1` (modular monolith) |
| Database | PostgreSQL + Drizzle ORM |
| Prediction & risk engines | Pure TypeScript modules (`src/modules/*`) — no DB/framework imports, portable to a Python/FastAPI service later |
| IoT | ESP32 (Arduino C++) → HTTPS JSON with device API keys and idempotent message IDs |
| External data | Open-Meteo (forecast + ERA5 archive + elevation), ISRIC SoilGrids v2, OSM Nominatim, OpenStreetMap embed maps |
| Notifications | In-app centre + Web Push (VAPID, optional) |

> The SRS suggested Python/FastAPI (Option A). We chose a single TypeScript codebase to move faster as a two-person team; the prediction engine is isolated behind a plain function contract (`predictYield(input) → result`) so it can be re-implemented in Python when ML models arrive, without touching the frontend.

## Project structure

```
agrisense/
├── docs/                      # GIT_WORKFLOW, ARCHITECTURE, API contracts
├── firmware/esp32/agrisense_node/   # ESP32 firmware (+ config.example.h)
├── public/                    # sw.js (service worker), icons, images
├── scripts/simulate-device.mjs      # ESP32 simulator for demos without hardware
└── src/
    ├── app/
    │   ├── page.tsx           # landing page
    │   ├── auth/[mode]/       # login · register · forgot · reset · verify
    │   ├── (app)/             # protected app: dashboard, farms, predictions, monitoring,
    │   │                      #   devices, weather, recommendations, notifications,
    │   │                      #   reports, settings, admin
    │   ├── api/v1/            # REST API (auth, users, farms, crops, plantings, devices,
    │   │                      #   iot, predictions, recommendations, notifications,
    │   │                      #   reports, dashboard, admin, geo)
    │   ├── manifest.ts        # web app manifest
    │   └── offline/           # offline fallback page
    ├── components/            # UI kit, charts, map, app shell, PWA widgets
    ├── db/                    # Drizzle schema + client
    ├── lib/client/            # API client, IndexedDB offline queue, hooks/context
    ├── modules/               # PURE domain logic (testable in isolation)
    │   ├── prediction-engine/ #   yield range, harvest window (GDD), data quality
    │   ├── risk-engine/       #   crop-specific configurable risk rules
    │   ├── iot/               #   sensor validation & device status
    │   └── shared/            #   units, dates, severity
    ├── server/                # auth/sessions, access control, HTTP helpers,
    │   └── services/          #   weather, soil, sensors, notifications, intelligence, seed
    └── proxy.ts               # route protection (Next 16 "proxy", formerly middleware)
```

## Run locally (Ubuntu)

The repo includes a self-contained PostgreSQL helper — no system database or Docker is required:

```bash
cp .env.example .env      # defaults point at the bundled DB on 127.0.0.1:5433
npm install
npm run db:start          # initialise & start PostgreSQL (first run creates the cluster)
npm run db:push           # create/update tables
npm run dev               # http://localhost:3000
```

Production-style run:

```bash
npm run build && npm start
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
3. **Devices** → register an ESP32 → copy the one-time API key.
4. Send data: flash the firmware *or* click **“Send simulated reading”** *or* run
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
| `npm run build && npm start` | Production build & run |
| `npm run typecheck` | TypeScript |
| `npm run lint` | ESLint |
| `npm run db:start` / `db:stop` / `db:status` | Manage the bundled local PostgreSQL |
| `npm run db:push` | Apply schema changes to the database |
| `npm run db:generate` | Generate a versioned SQL migration from the schema into `drizzle/` |
| `npm run test:smoke` / `test:api` / `test:backend` | HTTP integration suites (require the app and local DB to be running) |
| `npm test` | Run all three integration suites |

## Data attribution

Weather data by [Open-Meteo.com](https://open-meteo.com) (CC BY 4.0) · Soil data © ISRIC SoilGrids (CC BY 4.0) · Maps & geocoding © OpenStreetMap contributors (ODbL; respect the Nominatim 1 req/s usage policy).
