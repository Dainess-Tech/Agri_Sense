import { timingSafeEqual } from "crypto";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { deviceLogs, iotDevices, sensorReadings } from "@/db/schema";
import { sha256 } from "@/server/auth";
import { ApiError, clientIp, forbidden, handle, json, parseBody, rateLimit, unauthorized } from "@/server/http";
import { evaluateFarm } from "@/server/services/intelligence";
import { validateReading } from "@/modules/iot/validation";

export const dynamic = "force-dynamic";

/**
 * Device ingestion endpoint (ESP32 over HTTP).
 * Auth: headers `X-Device-Id: <device_uid>` + `Authorization: Bearer <device_api_key>`
 * (device credentials are independent from user credentials).
 * Idempotency: (device, messageId, sensorType) is unique — retried uploads are not duplicated.
 * Body: a single message or { messages: [...] } for buffered uploads after reconnection.
 */
const message = z.object({
  messageId: z.string().trim().min(1).max(80),
  measuredAt: z.union([z.string(), z.number()]).optional(),
  readings: z.array(z.object({ type: z.string().max(32), value: z.number().nullable() })).min(1).max(12),
});
const payload = z.union([
  z.object({ messages: z.array(message).min(1).max(200), firmware: z.string().max(32).optional(), log: z.string().max(500).optional() }),
  message.extend({ firmware: z.string().max(32).optional(), log: z.string().max(500).optional() }),
]);

function parseTime(v: string | number | undefined, now: Date): { at: Date; note?: string } {
  if (v === undefined) return { at: now, note: "no device timestamp; server time used" };
  const d = typeof v === "number" ? new Date(v < 1e12 ? v * 1000 : v) : new Date(v);
  if (isNaN(d.getTime()) || d.getFullYear() < 2020) return { at: now, note: "device clock not synchronised; server time used" };
  if (d.getTime() > now.getTime() + 5 * 60_000) throw new ApiError(422, "measuredAt is in the future");
  return { at: d };
}

export const POST = handle(async (req: Request) => {
  const uid = req.headers.get("x-device-id")?.trim();
  const key = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() || req.headers.get("x-device-key")?.trim();
  if (!uid || !key) throw unauthorized("Device credentials required (X-Device-Id + Authorization: Bearer <key>)");
  // Rate-limit unknown callers by IP, then by the verified device (never by a
  // caller-supplied UID alone, which would let anyone block a device).
  rateLimit(`iot:lookup:${clientIp(req)}`, 300, 60_000);
  const [device] = await db.select().from(iotDevices).where(eq(iotDevices.deviceUid, uid)).limit(1);
  const a = Buffer.from(sha256(key));
  const b = Buffer.from(device?.apiKeyHash ?? "0".repeat(64));
  if (!device || !timingSafeEqual(a, b)) throw unauthorized("Invalid device credentials");
  rateLimit(`iot:${device.id}`, 120, 60_000);
  if (!device.active) throw forbidden("Device is deactivated");

  const body = await parseBody(req, payload);
  const messages = "messages" in body ? body.messages : [body];
  const now = new Date();
  const rejected: { messageId: string; type?: string; reason: string }[] = [];
  let accepted = 0;
  let duplicates = 0;
  let flagged = 0;

  for (const m of messages) {
    let time: ReturnType<typeof parseTime>;
    try {
      time = parseTime(m.measuredAt, now);
    } catch (e) {
      rejected.push({ messageId: m.messageId, reason: (e as Error).message });
      continue;
    }
    const rows = [];
    for (const r of m.readings) {
      if (r.value === null) {
        rejected.push({ messageId: m.messageId, type: r.type, reason: "Sensor read failed (null/NaN) — not stored as a measurement" });
        continue;
      }
      const v = validateReading(r.type, r.value);
      if (!v) {
        rejected.push({ messageId: m.messageId, type: r.type, reason: "Unknown sensor type" });
        continue;
      }
      if (v.quality !== "valid") flagged++;
      rows.push({
        deviceId: device.id,
        farmId: device.farmId,
        sensorType: r.type,
        value: r.value.toFixed(3),
        unit: v.unit,
        quality: v.quality,
        qualityNote: [v.note, time.note].filter(Boolean).join("; ").slice(0, 160) || null,
        messageId: m.messageId,
        measuredAt: time.at,
        receivedAt: now,
      });
    }
    if (rows.length) {
      const inserted = await db.insert(sensorReadings).values(rows).onConflictDoNothing().returning({ id: sensorReadings.id });
      accepted += inserted.length;
      duplicates += rows.length - inserted.length;
    }
  }

  await db.update(iotDevices).set({ lastSeenAt: now, ...(body.firmware && { firmwareVersion: body.firmware }) }).where(eq(iotDevices.id, device.id));
  if (body.log) await db.insert(deviceLogs).values({ deviceId: device.id, level: "info", message: body.log });
  if (flagged || rejected.length) {
    await db.insert(deviceLogs).values({ deviceId: device.id, level: "warn", message: `${flagged} reading(s) flagged suspect/invalid, ${rejected.length} rejected` });
  }
  if (accepted > 0) void evaluateFarm(device.farmId).catch((e) => console.error("[iot] risk evaluation failed", e));

  return json({ accepted, duplicates, flagged, rejected, intervalSec: device.intervalSec, serverTime: now.toISOString() }, accepted > 0 ? 201 : 200);
});
