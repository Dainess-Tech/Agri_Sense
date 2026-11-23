import { desc, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { predictions } from "@/db/schema";
import { requireUser } from "@/server/auth";
import { accessibleFarms, getFarmForUser } from "@/server/access";
import { handle, json, parseBody, rateLimit } from "@/server/http";
import { generatePrediction } from "@/server/services/intelligence";

export const dynamic = "force-dynamic";

/** GET /api/v1/predictions?farmId= — prediction history (newest first). */
export const GET = handle(async (req: Request) => {
  const user = await requireUser();
  const farmId = new URL(req.url).searchParams.get("farmId");
  const farmList = farmId ? [await getFarmForUser(user, farmId)] : await accessibleFarms(user, true);
  if (!farmList.length) return json({ predictions: [] });
  const names = new Map(farmList.map((f) => [f.id, f.name]));
  const rows = await db.select().from(predictions).where(inArray(predictions.farmId, [...names.keys()])).orderBy(desc(predictions.createdAt)).limit(200);
  return json({ predictions: rows.map((p) => ({ ...p, farmName: names.get(p.farmId) })) });
});

/** POST /api/v1/predictions { plantingId } — runs the prediction engine and stores result + input snapshot. */
export const POST = handle(async (req: Request) => {
  const user = await requireUser();
  rateLimit(`predict:${user.id}`, 20, 60 * 60_000);
  const body = await parseBody(req, z.object({ plantingId: z.string().uuid() }));
  const prediction = await generatePrediction(user, body.plantingId);
  return json({ prediction }, 201);
});
