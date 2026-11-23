import "server-only";
import { and, isNotNull, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  auditLogs,
  authTokens,
  deviceLogs,
  farmRisks,
  notifications,
  sensorReadings,
  sessions,
  soilProfiles,
  weatherSnapshots,
} from "@/db/schema";

/**
 * Basic data-retention sweep. The schema stores TTLs on auth/provider caches,
 * but nothing deletes expired rows unless this runs. Intended to be called
 * from an admin endpoint (or a future cron worker).
 */
export async function runRetention(readingsDays = 365) {
  const now = new Date();
  const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000);
  const deleted: Record<string, number> = {};

  const sweep = async (name: string, query: Promise<{ rowCount?: number } | unknown>) => {
    try {
      const result = await query as { rowCount?: number };
      deleted[name] = result?.rowCount ?? 0;
    } catch (e) {
      // A single failed sweep must not abort the rest.
      deleted[name] = -1;
      console.error(`[retention] ${name} failed`, e);
    }
  };

  await sweep("expiredSessions", db.delete(sessions).where(lt(sessions.expiresAt, now)));
  await sweep("expiredAuthTokens", db.delete(authTokens).where(lt(authTokens.expiresAt, now)));
  await sweep("expiredWeatherCache", db.delete(weatherSnapshots).where(lt(weatherSnapshots.expiresAt, daysAgo(7))));
  await sweep("expiredSoilCache", db.delete(soilProfiles).where(lt(soilProfiles.expiresAt, daysAgo(7))));
  await sweep("oldDeviceLogs", db.delete(deviceLogs).where(lt(deviceLogs.createdAt, daysAgo(90))));
  await sweep("oldReadNotifications", db.delete(notifications).where(and(isNotNull(notifications.readAt), lt(notifications.createdAt, daysAgo(180)))));
  await sweep("oldSensorReadings", db.delete(sensorReadings).where(lt(sensorReadings.receivedAt, daysAgo(readingsDays))));
  await sweep("oldAuditLogs", db.delete(auditLogs).where(lt(auditLogs.createdAt, daysAgo(readingsDays * 2))));
  await sweep("resolvedRisks", db.delete(farmRisks).where(and(eqFalse(farmRisks.active), isNotNull(farmRisks.resolvedAt), lt(farmRisks.resolvedAt, daysAgo(180)))));

  return { ranAt: now.toISOString(), readingsDays, deleted };
}

/** Small helper so the where-clause stays readable. */
function eqFalse(column: typeof farmRisks.active) {
  return sql`${column} = false`;
}
