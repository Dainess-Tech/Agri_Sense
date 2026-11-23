import { asc, eq, ilike, and } from "drizzle-orm";
import { db } from "@/db";
import { cropVarieties, crops } from "@/db/schema";
import { requireUser } from "@/server/auth";
import { handle, json } from "@/server/http";
import { ensureSeed } from "@/server/services/seed";

export const dynamic = "force-dynamic";

/** GET /api/v1/crops?q=mai — configurable crop catalogue with varieties and thresholds. */
export const GET = handle(async (req: Request) => {
  await requireUser();
  await ensureSeed();
  const q = new URL(req.url).searchParams.get("q")?.trim();
  const list = await db
    .select()
    .from(crops)
    .where(q ? and(eq(crops.active, true), ilike(crops.name, `%${q}%`)) : eq(crops.active, true))
    .orderBy(asc(crops.name));
  const varieties = await db.select().from(cropVarieties).orderBy(asc(cropVarieties.name));
  return json({ crops: list.map((c) => ({ ...c, varieties: varieties.filter((v) => v.cropId === c.id) })) });
});
