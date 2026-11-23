#!/usr/bin/env node
/**
 * AgriSense ESP32 simulator — sends realistic readings to /api/v1/iot/readings.
 * Usage:
 *   DEVICE_ID=as-xxxx DEVICE_API_KEY=ask_xxx node scripts/simulate-device.mjs
 * Options (env):
 *   AGRISENSE_HOST=http://localhost:3000   INTERVAL_SEC=10   BACKFILL_HOURS=48   DRY=1 (simulate drying soil)   FAULT=1 (disconnected probes)
 */
const host = process.env.AGRISENSE_HOST || "http://localhost:3000";
const id = process.env.DEVICE_ID;
const key = process.env.DEVICE_API_KEY;
const interval = Number(process.env.INTERVAL_SEC || 10);
const backfill = Number(process.env.BACKFILL_HOURS || 0);
if (!id || !key) {
  console.error("Set DEVICE_ID and DEVICE_API_KEY (shown when registering a device in AgriSense).");
  process.exit(1);
}

let seq = Date.now();
function sample(at) {
  const h = at.getUTCHours() + at.getUTCMinutes() / 60;
  const diurnal = Math.sin(((h - 9) / 24) * 2 * Math.PI);
  // Older backfilled samples are wetter; moisture dries down as time moves toward now.
  const drift = process.env.DRY ? ((Date.now() - at.getTime()) / 3.6e6) * 0.1 : 0;
  const fault = !!process.env.FAULT;
  return {
    messageId: `${id}-${seq++}`,
    measuredAt: Math.floor(at.getTime() / 1000),
    readings: [
      { type: "soil_moisture", value: fault ? 0 : +(process.env.DRY ? 18 + Math.random() * 3 + drift : 32 + Math.random() * 4 - diurnal * 2).toFixed(1) },
      { type: "air_temperature", value: +(23 + diurnal * 6 + Math.random()).toFixed(1) },
      { type: "air_humidity", value: +(62 - diurnal * 15 + Math.random() * 3).toFixed(0) },
      { type: "soil_temperature", value: fault ? -127 : +(20 + diurnal * 2.5).toFixed(1) },
      { type: "soil_ph", value: +(6.2 + Math.random() * 0.2).toFixed(2) },
    ],
  };
}

async function send(body) {
  const res = await fetch(`${host}/api/v1/iot/readings`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Device-Id": id, Authorization: `Bearer ${key}` },
    body: JSON.stringify({ firmware: "simulator-1.0", ...body }),
  });
  const json = await res.json().catch(() => ({}));
  console.log(new Date().toISOString(), res.status, JSON.stringify(json));
}

if (backfill > 0) {
  const msgs = [];
  for (let t = Date.now() - backfill * 3.6e6; t < Date.now(); t += 15 * 60_000) msgs.push(sample(new Date(t)));
  for (let i = 0; i < msgs.length; i += 200) await send({ messages: msgs.slice(i, i + 200) });
  console.log(`Backfilled ${msgs.length} messages (${backfill} h).`);
}
await send(sample(new Date()));
setInterval(() => send(sample(new Date())).catch((e) => console.error("offline?", e.message)), interval * 1000);
