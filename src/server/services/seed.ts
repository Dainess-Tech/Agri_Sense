import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { cropVarieties, crops, predictionVersions, recommendationRules, sensorTypes } from "@/db/schema";
import { SENSOR_DEFS } from "@/modules/iot/validation";
import { ENGINE_METHOD, ENGINE_VERSION } from "@/modules/prediction-engine/engine";

/**
 * Initial configurable crop catalogue (SRS Module 3). Values are indicative
 * smallholder attainable ranges and agronomic thresholds; administrators can
 * edit them from the admin dashboard without code changes.
 */
const CROPS = [
  { slug: "maize", name: "Maize", scientificName: "Zea mays", baseYieldMin: "2.0", baseYieldMax: "6.0", maturityDaysMin: 90, maturityDaysMax: 150, baseTempC: "10", gddToMaturity: 1400, tempOptMin: "18", tempOptMax: "32", tempCriticalLow: "10", tempCriticalHigh: "35", waterNeedMinMm: 500, waterNeedMaxMm: 800, soilMoistureMin: "25", soilMoistureMax: "45", phMin: "5.5", phMax: "7.5",
    varieties: [["H614 (late maturing)", "1.15", "1.10"], ["DK8031 (early)", "0.85", "0.95"], ["Local landrace", "1.00", "0.80"]] },
  { slug: "beans", name: "Beans", scientificName: "Phaseolus vulgaris", baseYieldMin: "0.8", baseYieldMax: "2.0", maturityDaysMin: 60, maturityDaysMax: 100, baseTempC: "10", gddToMaturity: 1000, tempOptMin: "16", tempOptMax: "28", tempCriticalLow: "8", tempCriticalHigh: "32", waterNeedMinMm: 300, waterNeedMaxMm: 500, soilMoistureMin: "25", soilMoistureMax: "40", phMin: "6.0", phMax: "7.5",
    varieties: [["Rosecoco", "1.00", "1.00"], ["KAT B1 (drought tolerant)", "0.90", "0.95"]] },
  { slug: "wheat", name: "Wheat", scientificName: "Triticum aestivum", baseYieldMin: "2.0", baseYieldMax: "5.0", maturityDaysMin: 100, maturityDaysMax: 140, baseTempC: "0", gddToMaturity: 1900, tempOptMin: "12", tempOptMax: "25", tempCriticalLow: "3", tempCriticalHigh: "32", waterNeedMinMm: 450, waterNeedMaxMm: 650, soilMoistureMin: "20", soilMoistureMax: "40", phMin: "6.0", phMax: "7.5",
    varieties: [["Kenya Fahari", "1.00", "1.05"], ["Robin", "1.00", "1.00"]] },
  { slug: "rice", name: "Rice", scientificName: "Oryza sativa", baseYieldMin: "2.5", baseYieldMax: "6.0", maturityDaysMin: 100, maturityDaysMax: 150, baseTempC: "10", gddToMaturity: 1700, tempOptMin: "20", tempOptMax: "35", tempCriticalLow: "12", tempCriticalHigh: "38", waterNeedMinMm: 900, waterNeedMaxMm: 1500, soilMoistureMin: "40", soilMoistureMax: "60", phMin: "5.0", phMax: "7.0",
    varieties: [["Basmati 370", "1.05", "0.85"], ["NERICA (upland)", "0.90", "0.90"]] },
  { slug: "potatoes", name: "Potatoes", scientificName: "Solanum tuberosum", baseYieldMin: "10", baseYieldMax: "25", maturityDaysMin: 90, maturityDaysMax: 120, baseTempC: "7", gddToMaturity: 1300, tempOptMin: "15", tempOptMax: "24", tempCriticalLow: "5", tempCriticalHigh: "30", waterNeedMinMm: 500, waterNeedMaxMm: 700, soilMoistureMin: "30", soilMoistureMax: "45", phMin: "4.8", phMax: "6.5",
    varieties: [["Shangi", "0.90", "1.00"], ["Dutch Robjin", "1.05", "1.05"]] },
];

const RULES = [
  { code: "REC_DROUGHT", riskCategory: "drought", title: "Monitor soil moisture and water availability", body: "Rainfall has been low and little is forecast. Check soil moisture at root depth and review water sources. AgriSense does not prescribe irrigation amounts — consult your extension officer before changing irrigation.", requiresExpert: false },
  { code: "REC_RAIN", riskCategory: "excessive_rainfall", title: "Review upcoming rainfall before planning field activities", body: "Heavy rain is forecast. Consider postponing fertiliser application or spraying until after the wet period, and check that drainage channels are clear.", requiresExpert: false },
  { code: "REC_WATERLOG", riskCategory: "waterlogging", title: "Check field drainage", body: "Soil may be waterlogged. Inspect low-lying parts of the field and drainage paths. Prolonged waterlogging can damage roots.", requiresExpert: false },
  { code: "REC_HEAT", riskCategory: "heat_stress", title: "Monitor heat stress conditions", body: "High temperatures are forecast. Watch for leaf rolling or wilting during the hottest hours, especially during flowering.", requiresExpert: false },
  { code: "REC_COLD", riskCategory: "cold_stress", title: "Prepare for low temperatures", body: "Low temperatures are forecast. Young or sensitive crops may be affected; monitor plants after cold nights.", requiresExpert: false },
  { code: "REC_MOISTURE", riskCategory: "soil_moisture", title: "Monitor soil moisture", body: "Readings have remained below the configured crop threshold. Verify the sensor placement, then check the soil by hand. Irrigation amounts need agronomic advice.", requiresExpert: false },
  { code: "REC_PH", riskCategory: "soil_ph", title: "Check soil acidity", body: "Soil pH appears outside the suitable range for this crop. Confirm with a laboratory soil test before applying lime or any amendment.", requiresExpert: true },
  { code: "REC_SEASON", riskCategory: "season_disruption", title: "Review planting progress", body: "The growing season may be disrupted. Review crop establishment or update the planting record (e.g. record the harvest).", requiresExpert: false },
];

let seeded: Promise<void> | null = null;

export function ensureSeed(): Promise<void> {
  if (!seeded) {
    seeded = (async () => {
      for (const { varieties, ...c } of CROPS) {
        const inserted = await db.insert(crops).values(c).onConflictDoNothing().returning({ id: crops.id });
        if (inserted[0]) {
          await db.insert(cropVarieties).values(
            varieties.map(([name, maturityFactor, yieldFactor]) => ({ cropId: inserted[0].id, name, maturityFactor, yieldFactor })),
          );
        }
      }
      await db
        .insert(sensorTypes)
        .values(Object.values(SENSOR_DEFS).map((s) => ({ code: s.code, label: s.label, unit: s.unit, minValid: s.minValid, maxValid: s.maxValid })))
        .onConflictDoNothing();
      await db
        .insert(predictionVersions)
        .values({ version: ENGINE_VERSION, method: ENGINE_METHOD, description: "Initial rule-based release: limiting factors (water, temperature, pH, texture, measured moisture), GDD harvest window, data-quality widening." })
        .onConflictDoNothing();
      await db.insert(recommendationRules).values(RULES).onConflictDoNothing();
    })().catch((e) => {
      seeded = null;
      throw e;
    });
  }
  return seeded;
}

export async function getRuleFor(category: string) {
  const [r] = await db.select().from(recommendationRules).where(eq(recommendationRules.riskCategory, category)).limit(1);
  return r ?? null;
}
