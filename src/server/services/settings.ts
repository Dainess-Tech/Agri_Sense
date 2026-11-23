import "server-only";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { systemSettings } from "@/db/schema";
import { DEFAULT_RISK_THRESHOLDS, type RiskThresholds } from "@/modules/risk-engine/rules";
import { badRequest } from "../http";

/**
 * Runtime-configurable engine settings (proposal §3.3 / §5: thresholds must be
 * adjustable without redeploying). Values live in `system_settings`; unknown
 * or malformed overrides are ignored so a bad admin edit can never break the
 * prediction/risk engines.
 */

export const riskThresholdSchema = z.object({
  forecastWindowDays: z.number().int().min(1).max(30),
  heavyRain7dMediumMm: z.number().min(1).max(1000),
  heavyRain7dHighMm: z.number().min(1).max(2000),
  heavyRainSingleDayMm: z.number().min(1).max(500),
  droughtPast14dMm: z.number().min(0).max(500),
  droughtNext7dMm: z.number().min(0).max(500),
  waterloggingMoistureMargin: z.number().min(0).max(50),
  waterloggingClayPct: z.number().min(0).max(100),
  waterloggingRain7dMm: z.number().min(1).max(1000),
  minSensorSamples: z.number().int().min(1).max(100),
  phMediumMargin: z.number().min(0).max(5),
  phHighMargin: z.number().min(0).max(5),
});

export const SETTABLE_KEYS = ["risk_thresholds"] as const;
export type SettableKey = (typeof SETTABLE_KEYS)[number];

/** Reads the active risk thresholds, merging any validated override with the code defaults. */
export async function getRiskThresholds(): Promise<RiskThresholds> {
  const [row] = await db.select().from(systemSettings).where(eq(systemSettings.key, "risk_thresholds")).limit(1);
  const override = row?.value && typeof row.value === "object" && !Array.isArray(row.value) ? row.value : {};
  const parsed = riskThresholdSchema.partial().safeParse(override);
  const merged: RiskThresholds = { ...DEFAULT_RISK_THRESHOLDS, ...(parsed.success ? parsed.data : {}) };
  // Keep derived thresholds coherent even if an override is contradictory.
  if (merged.heavyRain7dHighMm < merged.heavyRain7dMediumMm) merged.heavyRain7dHighMm = merged.heavyRain7dMediumMm;
  if (merged.phHighMargin < merged.phMediumMargin) merged.phHighMargin = merged.phMediumMargin;
  return merged;
}

/** Admin listing: every configurable key with its effective value and provenance. */
export async function listSettings() {
  const rows = await db.select().from(systemSettings);
  const byKey = new Map(rows.map((r) => [r.key, r]));
  const result: { key: string; value: unknown; effective: unknown; updatedAt: Date | null; overridden: boolean }[] = [];
  for (const key of SETTABLE_KEYS) {
    const row = byKey.get(key);
    result.push({
      key,
      value: row?.value ?? null,
      effective: key === "risk_thresholds" ? await getRiskThresholds() : row?.value ?? null,
      updatedAt: row?.updatedAt ?? null,
      overridden: Boolean(row),
    });
  }
  return result;
}

/** Admin detail for one key: raw override plus effective (merged) value. */
export async function getSetting(key: SettableKey) {
  const [row] = await db.select().from(systemSettings).where(eq(systemSettings.key, key)).limit(1);
  if (key === "risk_thresholds") {
    return { key, value: row?.value ?? null, effective: await getRiskThresholds(), updatedAt: row?.updatedAt ?? null };
  }
  return { key, value: row?.value ?? null, updatedAt: row?.updatedAt ?? null };
}

/** Validates and upserts a setting override. Only known keys are writable. */
export async function setSetting(key: string, value: unknown) {
  if (!(SETTABLE_KEYS as readonly string[]).includes(key)) throw badRequest(`Unknown setting "${key}"`);
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw badRequest("Setting value must be a JSON object");
  if (key === "risk_thresholds") {
    const parsed = riskThresholdSchema.partial().safeParse(value);
    if (!parsed.success) throw badRequest("Invalid risk thresholds", parsed.error.issues);
    if (Object.keys(parsed.data).length === 0) throw badRequest("No recognised risk threshold fields supplied");
  }
  await db
    .insert(systemSettings)
    .values({ key, value: value as Record<string, unknown>, updatedAt: new Date() })
    .onConflictDoUpdate({ target: systemSettings.key, set: { value: value as Record<string, unknown>, updatedAt: new Date() } });
  return getSetting(key as SettableKey);
}

/** Removes an override so the key falls back to built-in defaults. */
export async function resetSetting(key: string) {
  if (!(SETTABLE_KEYS as readonly string[]).includes(key)) throw badRequest(`Unknown setting "${key}"`);
  await db.delete(systemSettings).where(eq(systemSettings.key, key));
  return getSetting(key as SettableKey);
}
