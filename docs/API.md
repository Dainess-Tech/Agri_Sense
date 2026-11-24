# AgriSense REST API v1

The Go service in `backend/` implements these routes. The Next.js app proxies API requests to it.

Base URL: `/api/v1` · JSON in/out · Times are ISO-8601 UTC · Machine-readable index: `GET /api/v1`

**Auth**: users authenticate with an httpOnly session cookie (`agrisense_session`, 30-day sliding expiry) set by `/auth/login` or `/auth/register`. Devices use `X-Device-Id` + `Authorization: Bearer <device_key>`.

**Errors**: `{ "error": { "code": "validation_failed", "message": "…", "details": [...] } }`
Status codes: 200 OK · 201 Created · 204 No Content · 400 Bad request · 401 Unauthenticated · 403 Forbidden · 404 Not found · 409 Conflict · 422 Validation failed · 429 Rate limited · 500 Server error · 503 Provider/data unavailable.

**Pagination**: `?page=1&limit=50` where noted.

**Permissions**: farm read = owner, farm members, admin, agronomist · farm write = owner, manager member, admin.

---

## Auth
| Method | Path | Body | Notes |
|---|---|---|---|
| POST | `/auth/register` | `{ fullName, email, password(≥8), country? }` | 201 `{ user, devVerificationLink? }`; 409 if email exists; rate-limited |
| POST | `/auth/login` | `{ email, password }` | 200 `{ user }`; 401 wrong credentials; rate-limited per IP & email |
| POST | `/auth/logout` | – | 204 |
| GET | `/auth/me` | – | 200 `{ user }` / 401 |
| POST | `/auth/forgot-password` | `{ email }` | always 200 (no account enumeration) |
| POST | `/auth/reset-password` | `{ token, password }` | revokes all sessions |
| POST | `/auth/verify-email` | `{ token }` | |
| POST | `/auth/resend-verification` | – | auth required |

## Users
| GET/PATCH/DELETE | `/users/profile` | PATCH `{ fullName?, phone?, country?, language?, measurementSystem? }` · DELETE `{ password }` → 204 (cascades) |
|---|---|---|
| GET/PATCH | `/users/preferences` | `{ riskAlerts, predictionReady, deviceOffline, harvestReminders, systemAnnouncements, pushEnabled, minSeverity }` |
| PATCH | `/users/password` | `{ currentPassword, newPassword }` |
| GET | `/users/export` | JSON download of all personal & farm data |

## Farms
| Method | Path | Notes |
|---|---|---|
| GET | `/farms?archived=1` | owned + shared farms |
| POST | `/farms` | `{ name, latitude(-90..90), longitude(-180..180), size>0, areaUnit(hectares\|acres\|square_meters), irrigation(rainfed\|irrigated\|mixed), locationName?, soilType?, elevationM?, clientId? }` → 201; idempotent with `clientId` |
| GET | `/farms/{id}` | `{ farm, canEdit }` |
| PATCH | `/farms/{id}` | partial fields + **`version` (required)** + `archived?`; 409 `{ details.current }` if stale |
| DELETE | `/farms/{id}` | owner/admin; 204 |
| GET | `/farms/{id}/members` | owner + memberships (`{ owner, members[] }`); owner/admin only |
| POST | `/farms/{id}/members` | `{ email, role: viewer\|manager }` → 201; owner/admin only; upserts membership |
| PATCH | `/farms/{id}/members` | `{ userId, role }`; owner/admin only |
| DELETE | `/farms/{id}/members?userId=` | revoke shared access; owner/admin only |
| GET | `/farms/{id}/weather` | Open-Meteo: `current`, `daily[]` (14 past days `kind:"model"`, 16 forecast days `kind:"forecast"`), `provider`, `retrievedAt`, `cached`, `stale`; `?historyDays=N` (≤365) → ERA5 archive; 503 if provider down & no cache |
| GET | `/farms/{id}/soil` | SoilGrids (modelled, 0–15 cm): pH, organic carbon g/kg, nitrogen g/kg, sand/silt/clay %, texture, `available`, `stale` (true when served from expired cache because the provider was unreachable) |
| GET | `/farms/{id}/risks?history=1&refresh=1` | active (or all) risks; `refresh=1` forces evaluation |
| GET | `/farms/{id}/recommendations?status=new\|read\|completed` | |
| GET/POST | `/farms/{id}/activities` | POST `{ type, description, plantingId?, occurredAt? }`; GET paginated |
| GET | `/farms/{id}/readings` | latest per sensor type (incl. quality) |
| GET | `/farms/{id}/readings?sensorType=soil_moisture&hours=24` | downsampled series, valid readings only |
| GET | `/farms/{id}/predictions` | |

## Crops & plantings
| GET | `/crops?q=` | catalogue + varieties + thresholds |
|---|---|---|
| GET | `/plantings?farmId=` | |
| POST | `/plantings` | `{ farmId, cropId, varietyId?, plantingDate(YYYY-MM-DD), plantedArea>0, areaUnit, season?, irrigation, status, notes?, clientId? }` |
| GET/PATCH/DELETE | `/plantings/{id}` | PATCH requires `version`; harvest: `{ status:"harvested", actualHarvestDate, actualYield, actualYieldUnit }` |

## Devices & IoT
| GET | `/devices?farmId=` | includes computed `status: online\|offline\|never` |
|---|---|---|
| POST | `/devices` | `{ farmId, name, deviceUid?, hardware?, sensors[], intervalSec(60..86400) }` → 201 `{ device, apiKey }` (**key shown once**) |
| GET/PATCH/DELETE | `/devices/{id}` | PATCH `{ name?, intervalSec?, active?, farmId?, sensors? }` |
| POST | `/devices/{id}` | `{ action: "rotate-key" }` → `{ apiKey }` |
| GET | `/devices/{id}/readings?page&limit&sensorType` | raw paginated |
| GET | `/devices/{id}/readings?series=soil_moisture&hours=24` | chart series |

### Ingestion — `POST /iot/readings`
Headers: `X-Device-Id: as-1234abcd`, `Authorization: Bearer ask_…`
```json
{ "messageId": "as-1234abcd-1042", "measuredAt": 1767000000, "firmware": "1.0.0",
  "readings": [ { "type": "soil_moisture", "value": 31.4 }, { "type": "air_temperature", "value": 24.2 },
                { "type": "air_humidity", "value": 61 }, { "type": "soil_temperature", "value": 20.1 },
                { "type": "soil_ph", "value": 6.3 } ] }
```
or `{ "messages": [ …up to 200… ] }`. Sensor types/units: `soil_moisture` %VWC · `air_temperature` °C · `air_humidity` %RH · `soil_temperature` °C · `soil_ph` pH · `soil_n` / `soil_p` / `soil_k` mg/kg (optional NPK probes; 0 and full-scale values are flagged as suspect).
`measuredAt`: epoch seconds/ms or ISO; missing/unsynced (<2020) → server time (noted); >5 min in future → rejected.
Response 201/200: `{ accepted, duplicates, flagged, rejected:[{messageId,type,reason}], intervalSec, serverTime }`. 401 bad credentials · 403 deactivated · 429 >120 req/min.

## Predictions
| GET | `/predictions?farmId=` | history |
|---|---|---|
| POST | `/predictions` | `{ plantingId }` → 201 `{ prediction }`; 503 `data_unavailable` if weather can't be retrieved; 422 invalid inputs; 20/hour/user |
| GET | `/predictions/{id}` | `{ prediction (yieldMin/Max, yieldUnit, totalMin/Max, harvestStart/End, dataQualityScore, conditionsSummary, factors[], suitability{verdict,score,explanation}, advisories[], limitations[], methodVersion), risks[], inputs{snapshot,sources}, version, previous, farm, planting }` |

`suitability.verdict` is `suitable` (score ≥70), `marginal` (45–69), `unsuitable` (<45) or `unknown` when no environmental data is available. Advisories are proactive planting, water, soil, temperature and management guidance.

## Recommendations & notifications
| PATCH | `/recommendations/{id}` | `{ status: new\|read\|completed }` |
|---|---|---|
| GET | `/notifications?unread=1&page=` | `{ notifications, unread }` |
| POST | `/notifications` | mark all read → 204 |
| PATCH | `/notifications/{id}` | `{ read: boolean }` |
| GET/POST | `/notifications/push` | VAPID public key / store PushSubscription |

## Reports
`GET /reports/farms/{id}?type=summary` (JSON for printable PDF) · `type=readings&from&to` · `type=weather&days` · `type=plantings` · `type=predictions` (CSV with generation timestamp & units).

## Dashboard
`GET /dashboard?farmId=` → totals, farm list, selected farm's plantings, predictions, active risks, activities, latest readings, devices.

## Admin (role `admin`)
- `GET /admin/stats|users?q=|audit|varieties|crops` · `GET /admin/settings?key=` (raw + effective values; `key=risk_thresholds` supported).
- `PATCH /admin/users { userId, role }` · `PATCH /admin/crops { cropId, …thresholds }` · `PATCH /admin/varieties { varietyId, name?, maturityFactor?, yieldFactor?, notes? }` · `PATCH /admin/settings { key:"risk_thresholds", value:{ …partial thresholds } }`.
- `POST /admin/crops { slug, name, …agronomic fields }` (201) · `POST /admin/varieties { cropId, name, maturityFactor?, yieldFactor? }` (201) · `POST /admin/announcements { title, body }` · `POST /admin/maintenance { action:"retention", readingsDays? }` (purges expired sessions/tokens/cache rows and old logs/readings; returns per-table counts).
- `DELETE /admin/crops?id=` (soft-deactivates so historical plantings survive) · `DELETE /admin/varieties?id=` · `DELETE /admin/settings?key=risk_thresholds` (resets to built-in defaults).

Crop min/max pairs are validated (`min <= max`) on write. Risk thresholds stored in `system_settings` are merged over built-in defaults and validated; malformed overrides are ignored at evaluation time.

## Geo
`GET /geo?q=place` (Nominatim, 1 req/s) · `GET /geo?lat=&lng=` (elevation, Copernicus DEM via Open-Meteo).
