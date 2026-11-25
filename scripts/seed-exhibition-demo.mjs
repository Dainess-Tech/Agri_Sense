#!/usr/bin/env node
/**
 * AgriSense field data seeder.
 *
 * Creates a complete farm dataset: account, farm, plantings, device, readings,
 * activities, cached weather/soil context, predictions and rule outputs.
 * Readings are posted through the same /api/v1/iot/readings endpoint used by
 * the ESP32 firmware.
 *
 * Usage:
 *   node scripts/seed-exhibition-demo.mjs
 *   DEMO_STREAM_SEC=120 node scripts/seed-exhibition-demo.mjs   # keep streaming
 *
 * Optional environment:
 *   AGRISENSE_BASE=http://localhost:3000
 *   DEMO_EMAIL=farm.manager@agrisense.local
 *   DEMO_PASSWORD=AgriSense2026!
 *   DEMO_HOURS=72
 */
const BASE = (process.env.AGRISENSE_BASE || "http://localhost:3000").replace(/\/$/, "");
const EMAIL = (process.env.DEMO_EMAIL || "farm.manager@agrisense.local").toLowerCase();
const PASSWORD = process.env.DEMO_PASSWORD || "AgriSense2026!";
const FARM_NAME = process.env.DEMO_FARM_NAME || "Nairobi North Farm";
const FARM_LOCATION = {
  locationName: "Nairobi County, Kenya",
  latitude: -1.2868,
  longitude: 36.8172,
  size: 4.5,
  areaUnit: "hectares",
  soilType: "Volcanic loam",
  irrigation: "rainfed",
  elevationM: 1795,
};
const DEVICE_UID = process.env.DEMO_DEVICE_UID || "nairobi-north-node-01";
const HOURS = Math.max(1, Number(process.env.DEMO_HOURS || 72));
const STREAM_SEC = Math.max(0, Number(process.env.DEMO_STREAM_SEC || 0));

let cookie = "";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const round = (value, digits = 1) => Number(value.toFixed(digits));
const clamp = (value, lo, hi) => Math.min(hi, Math.max(lo, value));

function rememberCookie(response) {
  const values = response.headers.getSetCookie
    ? response.headers.getSetCookie()
    : [response.headers.get("set-cookie") || ""];
  for (const value of values) {
    const match = value.match(/agrisense_session=([^;]*)/);
    if (match) cookie = `agrisense_session=${match[1]}`;
  }
}

async function api(path, { method = "GET", body, device } = {}) {
  const headers = { Accept: "application/json" };
  if (cookie) headers.Cookie = cookie;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (device) {
    headers["X-Device-Id"] = device.uid;
    headers.Authorization = `Bearer ${device.key}`;
  }
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  rememberCookie(response);
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  return { status: response.status, json, text };
}

function expect(result, label, statuses = [200, 201, 204]) {
  if (!statuses.includes(result.status)) {
    throw new Error(`${label} failed: HTTP ${result.status} ${result.text.slice(0, 300)}`);
  }
  return result.json;
}

async function authenticate() {
  const login = await api("/api/v1/auth/login", {
    method: "POST",
    body: { email: EMAIL, password: PASSWORD },
  });
  if (login.status === 200) {
    const me = expect(await api("/api/v1/auth/me"), "auth/me");
    console.log(`✓ Signed in as ${me.user.email} (${me.user.role})`);
    return;
  }

  const register = await api("/api/v1/auth/register", {
    method: "POST",
    body: { fullName: "Farm Manager", email: EMAIL, password: PASSWORD, country: "Kenya" },
  });
  if (register.status === 409) {
    throw new Error(`Account ${EMAIL} exists but the password did not match. Set DEMO_PASSWORD or use another email.`);
  }
  const data = expect(register, "auth/register");
  if (data.devVerificationLink) {
    const token = new URL(data.devVerificationLink).searchParams.get("token");
    if (token) await api("/api/v1/auth/verify-email", { method: "POST", body: { token } });
  }
  console.log(`✓ Created account ${EMAIL} and verified its email`);
}

async function ensureFarm() {
  const list = expect(await api("/api/v1/farms"), "list farms");
  const byName = list.farms.find((farm) => farm.name === FARM_NAME || farm.name === "Nairobi Exhibition Farm");
  let farm;
  if (byName) {
    farm = byName;
  } else {
    const created = expect(
      await api("/api/v1/farms", {
        method: "POST",
        body: { name: FARM_NAME, ...FARM_LOCATION, clientId: "agrisense-nairobi-farm-001" },
      }),
      "create farm",
    );
    farm = created.farm;
    console.log(`✓ Created farm ${farm.name} (${farm.id})`);
  }
  const updated = expect(
    await api(`/api/v1/farms/${farm.id}`, {
      method: "PATCH",
      body: { version: farm.version, name: FARM_NAME, ...FARM_LOCATION },
    }),
    "update farm",
  );
  console.log(`✓ Farm ${updated.farm.name} at ${updated.farm.latitude}, ${updated.farm.longitude} (${updated.farm.id})`);
  return updated.farm;
}

async function ensurePlantings(farm) {
  const crops = expect(await api("/api/v1/crops"), "list crops").crops;
  const plantings = expect(await api(`/api/v1/plantings?farmId=${farm.id}`), "list plantings").plantings;
  const wanted = [
    { slug: "maize", daysAgo: 42, area: 2.5, season: "2026 long rains", clientId: "agrisense-nairobi-maize-001" },
    { slug: "beans", daysAgo: 24, area: 1.2, season: "2026 long rains", clientId: "agrisense-nairobi-beans-001" },
  ];
  const result = [];
  for (const spec of wanted) {
    const crop = crops.find((item) => item.slug === spec.slug || item.name.toLowerCase() === spec.slug);
    if (!crop) throw new Error(`Crop ${spec.slug} is missing from the catalogue`);
    const found = plantings.find((item) => item.clientId === spec.clientId || item.cropId === crop.id);
    if (found) {
      console.log(`✓ Reusing ${crop.name} planting (${found.id})`);
      result.push({ ...found, cropName: crop.name });
      continue;
    }
    const date = new Date(Date.now() - spec.daysAgo * 24 * 3600_000).toISOString().slice(0, 10);
    const created = expect(
      await api("/api/v1/plantings", {
        method: "POST",
        body: {
          farmId: farm.id,
          cropId: crop.id,
          plantingDate: date,
          plantedArea: spec.area,
          areaUnit: "hectares",
          season: spec.season,
          irrigation: "rainfed",
          status: "planted",
          notes: "North plot planting",
          clientId: spec.clientId,
        },
      }),
      `create ${crop.name} planting`,
    );
    console.log(`✓ Created ${crop.name} planting (${created.planting.id})`);
    result.push({ ...created.planting, cropName: crop.name });
  }
  return result;
}

async function ensureDevice(farm) {
  const devices = expect(await api("/api/v1/devices"), "list devices").devices;
  const existing = devices.find((device) => device.deviceUid === DEVICE_UID);
  if (existing) {
    const rotated = expect(
      await api(`/api/v1/devices/${existing.id}`, { method: "POST", body: { action: "rotate-key" } }),
      "rotate device key",
    );
    console.log(`✓ Rotated key for ${DEVICE_UID}`);
    return { uid: DEVICE_UID, key: rotated.apiKey, id: existing.id };
  }
  const created = expect(
    await api("/api/v1/devices", {
      method: "POST",
      body: {
        farmId: farm.id,
        name: "North field monitoring station",
        deviceUid: DEVICE_UID,
        hardware: "ESP32",
        intervalSec: 900,
        sensors: ["soil_moisture", "air_temperature", "air_humidity", "soil_temperature", "soil_ph", "soil_n", "soil_p", "soil_k"],
      },
    }),
    "create device",
  );
  console.log(`✓ Registered node ${DEVICE_UID}`);
  return { uid: DEVICE_UID, key: created.apiKey, id: created.device.id };
}

function sample(at, startMs) {
  // Round to the 15-minute grid so repeated backfills use the same message IDs.
  const slot = Math.floor(at.getTime() / (15 * 60_000)) * 15 * 60_000;
  const hoursIn = (slot - startMs) / 3600_000;
  const solar = Math.sin(((at.getUTCHours() + at.getUTCMinutes() / 60 - 6) / 24) * 2 * Math.PI);
  const noise = (scale) => (Math.random() - 0.5) * scale;
  const rainPulse = (center, width, height) => height * Math.exp(-Math.pow(hoursIn - center, 2) / width);
  const moisture = clamp(
    30.5 - hoursIn * 0.22 + rainPulse(18, 18, 5.5) + rainPulse(52, 20, 3.5) + noise(1.4),
    18,
    40,
  );
  return {
    messageId: `msg-${DEVICE_UID}-${new Date(slot).toISOString().replace(/[-:.TZ]/g, "")}`,
    measuredAt: Math.floor(slot / 1000),
    readings: [
      { type: "soil_moisture", value: round(moisture) },
      { type: "air_temperature", value: round(21.5 + solar * 6.8 + noise(1.1)) },
      { type: "air_humidity", value: round(clamp(70 - solar * 17 + noise(3), 35, 95), 0) },
      { type: "soil_temperature", value: round(20.8 + solar * 2.3 + noise(0.5)) },
      { type: "soil_ph", value: round(6.25 + Math.sin(hoursIn / 28) * 0.18 + noise(0.08), 2) },
      { type: "soil_n", value: round(clamp(58 + Math.sin(hoursIn / 34) * 7 + noise(5), 20, 120), 0) },
      { type: "soil_p", value: round(clamp(25 + Math.sin(hoursIn / 41 + 1) * 5 + noise(3), 8, 60), 0) },
      { type: "soil_k", value: round(clamp(188 + Math.sin(hoursIn / 37 + 2) * 18 + noise(12), 90, 320), 0) },
    ],
  };
}

async function sendMessages(device, messages) {
  let accepted = 0;
  let duplicates = 0;
  for (let i = 0; i < messages.length; i += 150) {
    const batch = messages.slice(i, i + 150);
    const result = await api("/api/v1/iot/readings", {
      method: "POST",
      body: {
        messages: batch,
        firmware: "esp32-1.4.2",
        log: `Ingested batch of ${batch.length} messages`,
      },
      device,
    });
    const data = expect(result, "ingest readings");
    accepted += data.accepted || 0;
    duplicates += data.duplicates || 0;
  }
  return { accepted, duplicates };
}

async function backfill(device) {
  const start = Date.now() - HOURS * 3600_000;
  const messages = [];
  for (let t = start; t <= Date.now(); t += 15 * 60_000) messages.push(sample(new Date(t), start));
  const { accepted, duplicates } = await sendMessages(device, messages);
  console.log(`✓ Streamed ${messages.length} messages: ${accepted} new readings, ${duplicates} already present`);
}

async function seedActivities(farm, plantings) {
  const existing = expect(await api(`/api/v1/farms/${farm.id}/activities?limit=100`), "list activities").activities || [];
  const desired = [
    { type: "planting", description: "Maize planted on the north plot", plantingId: plantings[0]?.id, hoursAgo: 42 * 24 },
    { type: "irrigation", description: "Supplementary irrigation after dry spell", plantingId: plantings[0]?.id, hoursAgo: 30 },
    { type: "planting", description: "Beans planted as intercrop", plantingId: plantings[1]?.id, hoursAgo: 24 * 24 },
    { type: "observation", description: "Scouting check, no pest pressure observed", plantingId: plantings[0]?.id, hoursAgo: 4 },
  ];
  let added = 0;
  for (const item of desired) {
    if (existing.some((row) => row.description === item.description)) continue;
    expect(
      await api(`/api/v1/farms/${farm.id}/activities`, {
        method: "POST",
        body: {
          type: item.type,
          description: item.description,
          plantingId: item.plantingId || "",
          occurredAt: new Date(Date.now() - item.hoursAgo * 3600_000).toISOString(),
        },
      }),
      "create activity",
    );
    added++;
  }
  console.log(`✓ Added ${added} farm activities (${existing.length} already present)`);
}

async function warmResources(farm) {
  for (const resource of ["weather", "soil"]) {
    const result = await api(`/api/v1/farms/${farm.id}/${resource}`);
    if (result.status === 200) console.log(`✓ Cached ${resource} for the farm`);
    else console.log(`⚠ ${resource} provider unavailable (HTTP ${result.status}); cached data will be used where available`);
  }
}

async function seedPredictions(farm, plantings) {
  const existing = expect(await api(`/api/v1/predictions?farmId=${farm.id}`), "list predictions").predictions || [];
  let added = 0;
  for (const planting of plantings) {
    if (existing.some((prediction) => prediction.cropName === planting.cropName || prediction.plantingId === planting.id)) continue;
    const created = expect(
      await api("/api/v1/predictions", { method: "POST", body: { plantingId: planting.id } }),
      `predict ${planting.cropName}`,
    );
    const prediction = created.prediction;
    console.log(
      `✓ ${planting.cropName}: ${prediction.suitability?.verdict || "rule-based"} ${prediction.suitability?.score ?? "?"}/100, ` +
        `${prediction.yieldMin}–${prediction.yieldMax} ${prediction.yieldUnit}, quality ${prediction.dataQualityScore}%`,
    );
    added++;
  }
  if (!added) console.log("✓ Predictions already present");
}

async function refreshRules(farm) {
  const risks = expect(await api(`/api/v1/farms/${farm.id}/risks?refresh=1`), "evaluate risks").risks || [];
  const recommendations = expect(await api(`/api/v1/farms/${farm.id}/recommendations`), "list recommendations").recommendations || [];
  const notifications = expect(await api("/api/v1/notifications"), "list notifications");
  console.log(`✓ Rule engine: ${risks.length} active risks, ${recommendations.length} recommendations, ${notifications.unread ?? 0} unread notifications`);
}

async function stream(device, seconds) {
  const until = Date.now() + seconds * 1000;
  console.log(`▶ Live ingestion for ${seconds}s`);
  while (Date.now() < until) {
    const result = await api("/api/v1/iot/readings", {
      method: "POST",
      body: {
        messages: [sample(new Date(), Date.now() - HOURS * 3600_000)],
        firmware: "esp32-1.4.2",
      },
      device,
    });
    if (result.status !== 201 && result.status !== 200) console.error(`  ingestion HTTP ${result.status}: ${result.text.slice(0, 120)}`);
    await sleep(10_000);
  }
  console.log("■ Live ingestion stopped");
}

async function main() {
  console.log("AgriSense field data seeder");
  console.log("Loading readings through the ingestion API.\n");
  await authenticate();
  const farm = await ensureFarm();
  const plantings = await ensurePlantings(farm);
  const device = await ensureDevice(farm);
  await backfill(device);
  await seedActivities(farm, plantings);
  await warmResources(farm);
  await seedPredictions(farm, plantings);
  await refreshRules(farm);
  if (STREAM_SEC > 0) await stream(device, STREAM_SEC);

  console.log("\nReady.");
  console.log(`  Login:  ${EMAIL} / ${PASSWORD}`);
  console.log(`  Open:   ${BASE}/farms/${farm.id}`);
}

main().catch((error) => {
  console.error(`\nSeed failed: ${error.message}`);
  process.exit(1);
});
