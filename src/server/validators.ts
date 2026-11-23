import { z } from "zod";

const AREA = z.enum(["hectares", "acres", "square_meters"]);
const IRRIGATION = z.enum(["rainfed", "irrigated", "mixed"]);
const STATUS = z.enum(["planned", "planted", "germination", "vegetative", "flowering", "maturing", "harvested", "failed"]);
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

// NOTE: create schemas apply defaults; patch schemas must NOT (otherwise omitted
// fields would be silently reset on update).
const farmFields = {
  name: z.string().trim().min(2, "Farm name is required").max(120),
  locationName: z.string().trim().max(255).nullable().optional(),
  latitude: z.coerce.number().min(-90).max(90),
  longitude: z.coerce.number().min(-180).max(180),
  size: z.coerce.number().positive("Farm size must be greater than zero").max(1_000_000),
  areaUnit: AREA,
  soilType: z.string().trim().max(64).nullable().optional(),
  irrigation: IRRIGATION,
  elevationM: z.coerce.number().min(-500).max(9000).nullable().optional(),
};

export const farmInput = z.object({
  ...farmFields,
  areaUnit: AREA.default("hectares"),
  irrigation: IRRIGATION.default("rainfed"),
  clientId: z.string().max(64).optional(),
});

export const farmPatch = z
  .object(farmFields)
  .partial()
  .extend({ version: z.number().int().positive(), archived: z.boolean().optional() });

const plantingFields = {
  cropId: z.string().uuid(),
  varietyId: z.string().uuid().nullable().optional(),
  plantingDate: DATE,
  plantedArea: z.coerce.number().positive().max(1_000_000),
  areaUnit: AREA,
  season: z.string().trim().max(64).nullable().optional(),
  irrigation: IRRIGATION,
  status: STATUS,
  notes: z.string().max(2000).nullable().optional(),
};

export const plantingInput = z.object({
  ...plantingFields,
  farmId: z.string().uuid(),
  areaUnit: AREA.default("hectares"),
  irrigation: IRRIGATION.default("rainfed"),
  status: STATUS.default("planted"),
  clientId: z.string().max(64).optional(),
});

export const plantingPatch = z
  .object(plantingFields)
  .partial()
  .extend({
    version: z.number().int().positive(),
    actualHarvestDate: DATE.nullable().optional(),
    actualYield: z.coerce.number().min(0).nullable().optional(),
    actualYieldUnit: z.string().max(16).nullable().optional(),
  });

export const deviceInput = z.object({
  farmId: z.string().uuid(),
  name: z.string().trim().min(2).max(80),
  deviceUid: z.string().trim().regex(/^[A-Za-z0-9_-]{4,64}$/, "4–64 chars: letters, numbers, - or _").optional(),
  hardware: z.string().trim().max(80).default("ESP32"),
  sensors: z.array(z.enum(["soil_moisture", "air_temperature", "air_humidity", "soil_temperature", "soil_ph"])).default(["soil_moisture", "air_temperature", "air_humidity", "soil_temperature"]),
  intervalSec: z.coerce.number().int().min(60).max(86400).default(900),
});

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
