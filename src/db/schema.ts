/**
 * AgriSense database schema (Drizzle ORM / PostgreSQL)
 * Table groups follow SRS §6: accounts, farm management, crops, IoT,
 * environment, prediction, recommendations, notifications, administration.
 * All timestamps are stored as timestamptz (UTC). Measurements carry explicit units.
 */
import {
  pgTable,
  uuid,
  text,
  varchar,
  timestamp,
  boolean,
  integer,
  numeric,
  jsonb,
  date,
  bigserial,
  index,
  uniqueIndex,
  primaryKey,
  pgEnum,
  doublePrecision,
} from "drizzle-orm/pg-core";

// ---------- Enums ----------
export const roleEnum = pgEnum("user_role", ["farmer", "agronomist", "technician", "admin"]);
export const irrigationEnum = pgEnum("irrigation_method", ["rainfed", "irrigated", "mixed"]);
export const plantingStatusEnum = pgEnum("planting_status", [
  "planned",
  "planted",
  "germination",
  "vegetative",
  "flowering",
  "maturing",
  "harvested",
  "failed",
]);
export const severityEnum = pgEnum("severity", ["info", "low", "medium", "high", "critical"]);
export const readingQualityEnum = pgEnum("reading_quality", ["valid", "suspect", "invalid"]);
export const tokenTypeEnum = pgEnum("auth_token_type", ["verify_email", "reset_password"]);

// ---------- Accounts ----------
export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    fullName: varchar("full_name", { length: 120 }).notNull(),
    email: varchar("email", { length: 255 }).notNull(),
    passwordHash: text("password_hash").notNull(),
    role: roleEnum("role").notNull().default("farmer"),
    phone: varchar("phone", { length: 32 }),
    country: varchar("country", { length: 64 }),
    language: varchar("language", { length: 8 }).notNull().default("en"),
    measurementSystem: varchar("measurement_system", { length: 16 }).notNull().default("metric"),
    emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("users_email_uq").on(t.email)],
);

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: varchar("token_hash", { length: 64 }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("sessions_token_uq").on(t.tokenHash), index("sessions_user_idx").on(t.userId)],
);

export const authTokens = pgTable(
  "auth_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: tokenTypeEnum("type").notNull(),
    tokenHash: varchar("token_hash", { length: 64 }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("auth_tokens_hash_uq").on(t.tokenHash)],
);

export const notificationPreferences = pgTable("notification_preferences", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  riskAlerts: boolean("risk_alerts").notNull().default(true),
  predictionReady: boolean("prediction_ready").notNull().default(true),
  deviceOffline: boolean("device_offline").notNull().default(true),
  harvestReminders: boolean("harvest_reminders").notNull().default(true),
  systemAnnouncements: boolean("system_announcements").notNull().default(true),
  pushEnabled: boolean("push_enabled").notNull().default(false),
  minSeverity: severityEnum("min_severity").notNull().default("low"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------- Farm management ----------
export const farms = pgTable(
  "farms",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 120 }).notNull(),
    locationName: varchar("location_name", { length: 255 }),
    latitude: numeric("latitude", { precision: 9, scale: 6 }).notNull(),
    longitude: numeric("longitude", { precision: 9, scale: 6 }).notNull(),
    size: numeric("size", { precision: 12, scale: 3 }).notNull(),
    areaUnit: varchar("area_unit", { length: 16 }).notNull().default("hectares"),
    soilType: varchar("soil_type", { length: 64 }),
    irrigation: irrigationEnum("irrigation").notNull().default("rainfed"),
    elevationM: numeric("elevation_m", { precision: 7, scale: 1 }),
    version: integer("version").notNull().default(1),
    clientId: varchar("client_id", { length: 64 }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("farms_owner_idx").on(t.ownerId), uniqueIndex("farms_client_uq").on(t.ownerId, t.clientId)],
);

export const farmMembers = pgTable(
  "farm_members",
  {
    farmId: uuid("farm_id")
      .notNull()
      .references(() => farms.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: varchar("role", { length: 24 }).notNull().default("viewer"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.farmId, t.userId] })],
);

// ---------- Crop management ----------
/** Configurable crop catalogue: thresholds drive the prediction & risk engines. */
export const crops = pgTable(
  "crops",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: varchar("slug", { length: 48 }).notNull(),
    name: varchar("name", { length: 80 }).notNull(),
    scientificName: varchar("scientific_name", { length: 120 }),
    yieldUnit: varchar("yield_unit", { length: 16 }).notNull().default("t/ha"),
    baseYieldMin: numeric("base_yield_min", { precision: 8, scale: 2 }).notNull(),
    baseYieldMax: numeric("base_yield_max", { precision: 8, scale: 2 }).notNull(),
    maturityDaysMin: integer("maturity_days_min").notNull(),
    maturityDaysMax: integer("maturity_days_max").notNull(),
    baseTempC: numeric("base_temp_c", { precision: 4, scale: 1 }).notNull(),
    gddToMaturity: integer("gdd_to_maturity").notNull(),
    tempOptMin: numeric("temp_opt_min", { precision: 4, scale: 1 }).notNull(),
    tempOptMax: numeric("temp_opt_max", { precision: 4, scale: 1 }).notNull(),
    tempCriticalLow: numeric("temp_critical_low", { precision: 4, scale: 1 }).notNull(),
    tempCriticalHigh: numeric("temp_critical_high", { precision: 4, scale: 1 }).notNull(),
    waterNeedMinMm: integer("water_need_min_mm").notNull(),
    waterNeedMaxMm: integer("water_need_max_mm").notNull(),
    soilMoistureMin: numeric("soil_moisture_min", { precision: 5, scale: 1 }).notNull(),
    soilMoistureMax: numeric("soil_moisture_max", { precision: 5, scale: 1 }).notNull(),
    phMin: numeric("ph_min", { precision: 3, scale: 1 }).notNull(),
    phMax: numeric("ph_max", { precision: 3, scale: 1 }).notNull(),
    active: boolean("active").notNull().default(true),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("crops_slug_uq").on(t.slug)],
);

export const cropVarieties = pgTable(
  "crop_varieties",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    cropId: uuid("crop_id")
      .notNull()
      .references(() => crops.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 80 }).notNull(),
    maturityFactor: numeric("maturity_factor", { precision: 4, scale: 2 }).notNull().default("1.00"),
    yieldFactor: numeric("yield_factor", { precision: 4, scale: 2 }).notNull().default("1.00"),
    notes: text("notes"),
  },
  (t) => [index("crop_varieties_crop_idx").on(t.cropId)],
);

export const plantings = pgTable(
  "plantings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    farmId: uuid("farm_id")
      .notNull()
      .references(() => farms.id, { onDelete: "cascade" }),
    cropId: uuid("crop_id")
      .notNull()
      .references(() => crops.id),
    varietyId: uuid("variety_id").references(() => cropVarieties.id),
    plantingDate: date("planting_date").notNull(),
    plantedArea: numeric("planted_area", { precision: 12, scale: 3 }).notNull(),
    areaUnit: varchar("area_unit", { length: 16 }).notNull().default("hectares"),
    season: varchar("season", { length: 64 }),
    irrigation: irrigationEnum("irrigation").notNull().default("rainfed"),
    status: plantingStatusEnum("status").notNull().default("planted"),
    actualHarvestDate: date("actual_harvest_date"),
    actualYield: numeric("actual_yield", { precision: 12, scale: 3 }),
    actualYieldUnit: varchar("actual_yield_unit", { length: 16 }),
    notes: text("notes"),
    version: integer("version").notNull().default(1),
    clientId: varchar("client_id", { length: 64 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("plantings_farm_idx").on(t.farmId),
    index("plantings_crop_idx").on(t.cropId),
    uniqueIndex("plantings_client_uq").on(t.farmId, t.clientId),
  ],
);

export const farmActivities = pgTable(
  "farm_activities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    farmId: uuid("farm_id")
      .notNull()
      .references(() => farms.id, { onDelete: "cascade" }),
    plantingId: uuid("planting_id").references(() => plantings.id, { onDelete: "set null" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    type: varchar("type", { length: 48 }).notNull(),
    description: text("description").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("farm_activities_farm_idx").on(t.farmId, t.occurredAt)],
);

// ---------- IoT ----------
export const iotDevices = pgTable(
  "iot_devices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    farmId: uuid("farm_id")
      .notNull()
      .references(() => farms.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 80 }).notNull(),
    deviceUid: varchar("device_uid", { length: 64 }).notNull(),
    apiKeyHash: varchar("api_key_hash", { length: 64 }).notNull(),
    hardware: varchar("hardware", { length: 80 }).notNull().default("ESP32"),
    sensors: jsonb("sensors").$type<string[]>().notNull().default([]),
    intervalSec: integer("interval_sec").notNull().default(900),
    firmwareVersion: varchar("firmware_version", { length: 32 }),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    active: boolean("active").notNull().default(true),
    offlineNotifiedAt: timestamp("offline_notified_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("iot_devices_uid_uq").on(t.deviceUid), index("iot_devices_farm_idx").on(t.farmId)],
);

/** Reference table of supported sensor types with units and plausible ranges. */
export const sensorTypes = pgTable("sensor_types", {
  code: varchar("code", { length: 32 }).primaryKey(),
  label: varchar("label", { length: 64 }).notNull(),
  unit: varchar("unit", { length: 16 }).notNull(),
  minValid: doublePrecision("min_valid").notNull(),
  maxValid: doublePrecision("max_valid").notNull(),
});

export const sensorReadings = pgTable(
  "sensor_readings",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    deviceId: uuid("device_id")
      .notNull()
      .references(() => iotDevices.id, { onDelete: "cascade" }),
    farmId: uuid("farm_id")
      .notNull()
      .references(() => farms.id, { onDelete: "cascade" }),
    sensorType: varchar("sensor_type", { length: 32 }).notNull(),
    value: numeric("value", { precision: 10, scale: 3 }).notNull(),
    unit: varchar("unit", { length: 16 }).notNull(),
    quality: readingQualityEnum("quality").notNull().default("valid"),
    qualityNote: varchar("quality_note", { length: 160 }),
    messageId: varchar("message_id", { length: 80 }).notNull(),
    measuredAt: timestamp("measured_at", { withTimezone: true }).notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("sensor_readings_idem_uq").on(t.deviceId, t.messageId, t.sensorType),
    index("sensor_readings_device_time_idx").on(t.deviceId, t.measuredAt),
    index("sensor_readings_farm_type_time_idx").on(t.farmId, t.sensorType, t.measuredAt),
  ],
);

export const deviceLogs = pgTable(
  "device_logs",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    deviceId: uuid("device_id")
      .notNull()
      .references(() => iotDevices.id, { onDelete: "cascade" }),
    level: varchar("level", { length: 16 }).notNull().default("info"),
    message: text("message").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("device_logs_device_idx").on(t.deviceId, t.createdAt)],
);

// ---------- Environment (provider cache + provenance) ----------
export const weatherSnapshots = pgTable(
  "weather_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    cacheKey: varchar("cache_key", { length: 200 }).notNull(),
    kind: varchar("kind", { length: 16 }).notNull(), // forecast | history
    provider: varchar("provider", { length: 64 }).notNull(),
    latitude: numeric("latitude", { precision: 9, scale: 6 }).notNull(),
    longitude: numeric("longitude", { precision: 9, scale: 6 }).notNull(),
    payload: jsonb("payload").notNull(),
    retrievedAt: timestamp("retrieved_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [uniqueIndex("weather_snapshots_key_uq").on(t.cacheKey)],
);

export const soilProfiles = pgTable(
  "soil_profiles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    cacheKey: varchar("cache_key", { length: 100 }).notNull(),
    provider: varchar("provider", { length: 64 }).notNull(),
    latitude: numeric("latitude", { precision: 9, scale: 6 }).notNull(),
    longitude: numeric("longitude", { precision: 9, scale: 6 }).notNull(),
    phH2o: numeric("ph_h2o", { precision: 4, scale: 2 }),
    organicCarbonGKg: numeric("organic_carbon_g_kg", { precision: 7, scale: 2 }),
    nitrogenGKg: numeric("nitrogen_g_kg", { precision: 7, scale: 3 }),
    sandPct: numeric("sand_pct", { precision: 5, scale: 1 }),
    siltPct: numeric("silt_pct", { precision: 5, scale: 1 }),
    clayPct: numeric("clay_pct", { precision: 5, scale: 1 }),
    texture: varchar("texture", { length: 40 }),
    depth: varchar("depth", { length: 16 }).notNull().default("0-15cm"),
    available: boolean("available").notNull().default(true),
    retrievedAt: timestamp("retrieved_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [uniqueIndex("soil_profiles_key_uq").on(t.cacheKey)],
);

// ---------- Prediction ----------
export const predictionVersions = pgTable("prediction_versions", {
  version: varchar("version", { length: 40 }).primaryKey(),
  method: varchar("method", { length: 80 }).notNull(),
  description: text("description").notNull(),
  releasedAt: timestamp("released_at", { withTimezone: true }).notNull().defaultNow(),
});

export const predictions = pgTable(
  "predictions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    farmId: uuid("farm_id")
      .notNull()
      .references(() => farms.id, { onDelete: "cascade" }),
    plantingId: uuid("planting_id")
      .notNull()
      .references(() => plantings.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    cropName: varchar("crop_name", { length: 80 }).notNull(),
    yieldMin: numeric("yield_min", { precision: 10, scale: 2 }).notNull(),
    yieldMax: numeric("yield_max", { precision: 10, scale: 2 }).notNull(),
    yieldUnit: varchar("yield_unit", { length: 16 }).notNull(),
    totalMin: numeric("total_min", { precision: 12, scale: 2 }).notNull(),
    totalMax: numeric("total_max", { precision: 12, scale: 2 }).notNull(),
    totalUnit: varchar("total_unit", { length: 16 }).notNull().default("t"),
    harvestStart: date("harvest_start").notNull(),
    harvestEnd: date("harvest_end").notNull(),
    dataQualityScore: integer("data_quality_score").notNull(),
    methodVersion: varchar("method_version", { length: 40 })
      .notNull()
      .references(() => predictionVersions.version),
    conditionsSummary: jsonb("conditions_summary").notNull(),
    factors: jsonb("factors").notNull(),
    limitations: jsonb("limitations").$type<string[]>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("predictions_farm_idx").on(t.farmId, t.createdAt), index("predictions_planting_idx").on(t.plantingId)],
);

/** Immutable snapshot of every input used — preserves history if providers revise data. */
export const predictionInputs = pgTable("prediction_inputs", {
  predictionId: uuid("prediction_id")
    .primaryKey()
    .references(() => predictions.id, { onDelete: "cascade" }),
  snapshot: jsonb("snapshot").notNull(),
  sources: jsonb("sources").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const predictionRisks = pgTable(
  "prediction_risks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    predictionId: uuid("prediction_id")
      .notNull()
      .references(() => predictions.id, { onDelete: "cascade" }),
    category: varchar("category", { length: 40 }).notNull(),
    severity: severityEnum("severity").notNull(),
    explanation: text("explanation").notNull(),
  },
  (t) => [index("prediction_risks_pred_idx").on(t.predictionId)],
);

// ---------- Risks & recommendations ----------
export const farmRisks = pgTable(
  "farm_risks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    farmId: uuid("farm_id")
      .notNull()
      .references(() => farms.id, { onDelete: "cascade" }),
    plantingId: uuid("planting_id").references(() => plantings.id, { onDelete: "cascade" }),
    category: varchar("category", { length: 40 }).notNull(),
    severity: severityEnum("severity").notNull(),
    title: varchar("title", { length: 160 }).notNull(),
    explanation: text("explanation").notNull(),
    source: varchar("source", { length: 32 }).notNull(), // sensor | forecast | soil | history
    dedupeKey: varchar("dedupe_key", { length: 200 }).notNull(),
    active: boolean("active").notNull().default(true),
    detectedAt: timestamp("detected_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (t) => [index("farm_risks_farm_idx").on(t.farmId, t.active), index("farm_risks_dedupe_idx").on(t.dedupeKey)],
);

export const recommendationRules = pgTable("recommendation_rules", {
  code: varchar("code", { length: 48 }).primaryKey(),
  riskCategory: varchar("risk_category", { length: 40 }).notNull(),
  title: varchar("title", { length: 160 }).notNull(),
  body: text("body").notNull(),
  requiresExpert: boolean("requires_expert").notNull().default(false),
  active: boolean("active").notNull().default(true),
});

export const recommendations = pgTable(
  "recommendations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    farmId: uuid("farm_id")
      .notNull()
      .references(() => farms.id, { onDelete: "cascade" }),
    plantingId: uuid("planting_id").references(() => plantings.id, { onDelete: "cascade" }),
    riskId: uuid("risk_id").references(() => farmRisks.id, { onDelete: "set null" }),
    ruleCode: varchar("rule_code", { length: 48 }),
    title: varchar("title", { length: 160 }).notNull(),
    body: text("body").notNull(),
    reason: text("reason").notNull(),
    severity: severityEnum("severity").notNull(),
    requiresExpert: boolean("requires_expert").notNull().default(false),
    status: varchar("status", { length: 16 }).notNull().default("new"), // new | read | completed
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("recommendations_farm_idx").on(t.farmId, t.status)],
);

// ---------- Notifications ----------
export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    farmId: uuid("farm_id").references(() => farms.id, { onDelete: "cascade" }),
    type: varchar("type", { length: 32 }).notNull(), // risk | prediction | device | harvest | system
    severity: severityEnum("severity").notNull().default("info"),
    title: varchar("title", { length: 160 }).notNull(),
    body: text("body").notNull(),
    link: varchar("link", { length: 255 }),
    dedupeKey: varchar("dedupe_key", { length: 200 }),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("notifications_user_idx").on(t.userId, t.createdAt), index("notifications_dedupe_idx").on(t.dedupeKey)],
);

export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    endpoint: text("endpoint").notNull(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("push_subscriptions_endpoint_uq").on(t.endpoint)],
);

// ---------- Administration ----------
export const auditLogs = pgTable(
  "audit_logs",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    action: varchar("action", { length: 64 }).notNull(),
    entity: varchar("entity", { length: 48 }).notNull(),
    entityId: varchar("entity_id", { length: 64 }),
    meta: jsonb("meta"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("audit_logs_created_idx").on(t.createdAt)],
);

export const systemSettings = pgTable("system_settings", {
  key: varchar("key", { length: 64 }).primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
