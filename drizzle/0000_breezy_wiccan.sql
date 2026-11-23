CREATE TYPE "public"."irrigation_method" AS ENUM('rainfed', 'irrigated', 'mixed');--> statement-breakpoint
CREATE TYPE "public"."planting_status" AS ENUM('planned', 'planted', 'germination', 'vegetative', 'flowering', 'maturing', 'harvested', 'failed');--> statement-breakpoint
CREATE TYPE "public"."reading_quality" AS ENUM('valid', 'suspect', 'invalid');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('farmer', 'agronomist', 'technician', 'admin');--> statement-breakpoint
CREATE TYPE "public"."severity" AS ENUM('info', 'low', 'medium', 'high', 'critical');--> statement-breakpoint
CREATE TYPE "public"."auth_token_type" AS ENUM('verify_email', 'reset_password');--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"actor_id" uuid,
	"action" varchar(64) NOT NULL,
	"entity" varchar(48) NOT NULL,
	"entity_id" varchar(64),
	"meta" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" "auth_token_type" NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crop_varieties" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"crop_id" uuid NOT NULL,
	"name" varchar(80) NOT NULL,
	"maturity_factor" numeric(4, 2) DEFAULT '1.00' NOT NULL,
	"yield_factor" numeric(4, 2) DEFAULT '1.00' NOT NULL,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "crops" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" varchar(48) NOT NULL,
	"name" varchar(80) NOT NULL,
	"scientific_name" varchar(120),
	"yield_unit" varchar(16) DEFAULT 't/ha' NOT NULL,
	"base_yield_min" numeric(8, 2) NOT NULL,
	"base_yield_max" numeric(8, 2) NOT NULL,
	"maturity_days_min" integer NOT NULL,
	"maturity_days_max" integer NOT NULL,
	"base_temp_c" numeric(4, 1) NOT NULL,
	"gdd_to_maturity" integer NOT NULL,
	"temp_opt_min" numeric(4, 1) NOT NULL,
	"temp_opt_max" numeric(4, 1) NOT NULL,
	"temp_critical_low" numeric(4, 1) NOT NULL,
	"temp_critical_high" numeric(4, 1) NOT NULL,
	"water_need_min_mm" integer NOT NULL,
	"water_need_max_mm" integer NOT NULL,
	"soil_moisture_min" numeric(5, 1) NOT NULL,
	"soil_moisture_max" numeric(5, 1) NOT NULL,
	"ph_min" numeric(3, 1) NOT NULL,
	"ph_max" numeric(3, 1) NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "device_logs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"device_id" uuid NOT NULL,
	"level" varchar(16) DEFAULT 'info' NOT NULL,
	"message" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "farm_activities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"farm_id" uuid NOT NULL,
	"planting_id" uuid,
	"user_id" uuid,
	"type" varchar(48) NOT NULL,
	"description" text NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "farm_members" (
	"farm_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" varchar(24) DEFAULT 'viewer' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "farm_members_farm_id_user_id_pk" PRIMARY KEY("farm_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "farm_risks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"farm_id" uuid NOT NULL,
	"planting_id" uuid,
	"category" varchar(40) NOT NULL,
	"severity" "severity" NOT NULL,
	"title" varchar(160) NOT NULL,
	"explanation" text NOT NULL,
	"source" varchar(32) NOT NULL,
	"dedupe_key" varchar(200) NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"detected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "farms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"name" varchar(120) NOT NULL,
	"location_name" varchar(255),
	"latitude" numeric(9, 6) NOT NULL,
	"longitude" numeric(9, 6) NOT NULL,
	"size" numeric(12, 3) NOT NULL,
	"area_unit" varchar(16) DEFAULT 'hectares' NOT NULL,
	"soil_type" varchar(64),
	"irrigation" "irrigation_method" DEFAULT 'rainfed' NOT NULL,
	"elevation_m" numeric(7, 1),
	"version" integer DEFAULT 1 NOT NULL,
	"client_id" varchar(64),
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "iot_devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"farm_id" uuid NOT NULL,
	"name" varchar(80) NOT NULL,
	"device_uid" varchar(64) NOT NULL,
	"api_key_hash" varchar(64) NOT NULL,
	"hardware" varchar(80) DEFAULT 'ESP32' NOT NULL,
	"sensors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"interval_sec" integer DEFAULT 900 NOT NULL,
	"firmware_version" varchar(32),
	"last_seen_at" timestamp with time zone,
	"active" boolean DEFAULT true NOT NULL,
	"offline_notified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_preferences" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"risk_alerts" boolean DEFAULT true NOT NULL,
	"prediction_ready" boolean DEFAULT true NOT NULL,
	"device_offline" boolean DEFAULT true NOT NULL,
	"harvest_reminders" boolean DEFAULT true NOT NULL,
	"system_announcements" boolean DEFAULT true NOT NULL,
	"push_enabled" boolean DEFAULT false NOT NULL,
	"min_severity" "severity" DEFAULT 'low' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"farm_id" uuid,
	"type" varchar(32) NOT NULL,
	"severity" "severity" DEFAULT 'info' NOT NULL,
	"title" varchar(160) NOT NULL,
	"body" text NOT NULL,
	"link" varchar(255),
	"dedupe_key" varchar(200),
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plantings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"farm_id" uuid NOT NULL,
	"crop_id" uuid NOT NULL,
	"variety_id" uuid,
	"planting_date" date NOT NULL,
	"planted_area" numeric(12, 3) NOT NULL,
	"area_unit" varchar(16) DEFAULT 'hectares' NOT NULL,
	"season" varchar(64),
	"irrigation" "irrigation_method" DEFAULT 'rainfed' NOT NULL,
	"status" "planting_status" DEFAULT 'planted' NOT NULL,
	"actual_harvest_date" date,
	"actual_yield" numeric(12, 3),
	"actual_yield_unit" varchar(16),
	"notes" text,
	"version" integer DEFAULT 1 NOT NULL,
	"client_id" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prediction_inputs" (
	"prediction_id" uuid PRIMARY KEY NOT NULL,
	"snapshot" jsonb NOT NULL,
	"sources" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prediction_risks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"prediction_id" uuid NOT NULL,
	"category" varchar(40) NOT NULL,
	"severity" "severity" NOT NULL,
	"explanation" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prediction_versions" (
	"version" varchar(40) PRIMARY KEY NOT NULL,
	"method" varchar(80) NOT NULL,
	"description" text NOT NULL,
	"released_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "predictions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"farm_id" uuid NOT NULL,
	"planting_id" uuid NOT NULL,
	"user_id" uuid,
	"crop_name" varchar(80) NOT NULL,
	"yield_min" numeric(10, 2) NOT NULL,
	"yield_max" numeric(10, 2) NOT NULL,
	"yield_unit" varchar(16) NOT NULL,
	"total_min" numeric(12, 2) NOT NULL,
	"total_max" numeric(12, 2) NOT NULL,
	"total_unit" varchar(16) DEFAULT 't' NOT NULL,
	"harvest_start" date NOT NULL,
	"harvest_end" date NOT NULL,
	"data_quality_score" integer NOT NULL,
	"method_version" varchar(40) NOT NULL,
	"conditions_summary" jsonb NOT NULL,
	"factors" jsonb NOT NULL,
	"suitability" jsonb,
	"advisories" jsonb,
	"limitations" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "push_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recommendation_rules" (
	"code" varchar(48) PRIMARY KEY NOT NULL,
	"risk_category" varchar(40) NOT NULL,
	"title" varchar(160) NOT NULL,
	"body" text NOT NULL,
	"requires_expert" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recommendations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"farm_id" uuid NOT NULL,
	"planting_id" uuid,
	"risk_id" uuid,
	"rule_code" varchar(48),
	"title" varchar(160) NOT NULL,
	"body" text NOT NULL,
	"reason" text NOT NULL,
	"severity" "severity" NOT NULL,
	"requires_expert" boolean DEFAULT false NOT NULL,
	"status" varchar(16) DEFAULT 'new' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sensor_readings" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"device_id" uuid NOT NULL,
	"farm_id" uuid NOT NULL,
	"sensor_type" varchar(32) NOT NULL,
	"value" numeric(10, 3) NOT NULL,
	"unit" varchar(16) NOT NULL,
	"quality" "reading_quality" DEFAULT 'valid' NOT NULL,
	"quality_note" varchar(160),
	"message_id" varchar(80) NOT NULL,
	"measured_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sensor_types" (
	"code" varchar(32) PRIMARY KEY NOT NULL,
	"label" varchar(64) NOT NULL,
	"unit" varchar(16) NOT NULL,
	"min_valid" double precision NOT NULL,
	"max_valid" double precision NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "soil_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cache_key" varchar(100) NOT NULL,
	"provider" varchar(64) NOT NULL,
	"latitude" numeric(9, 6) NOT NULL,
	"longitude" numeric(9, 6) NOT NULL,
	"ph_h2o" numeric(4, 2),
	"organic_carbon_g_kg" numeric(7, 2),
	"nitrogen_g_kg" numeric(7, 3),
	"sand_pct" numeric(5, 1),
	"silt_pct" numeric(5, 1),
	"clay_pct" numeric(5, 1),
	"texture" varchar(40),
	"depth" varchar(16) DEFAULT '0-15cm' NOT NULL,
	"available" boolean DEFAULT true NOT NULL,
	"retrieved_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "system_settings" (
	"key" varchar(64) PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"full_name" varchar(120) NOT NULL,
	"email" varchar(255) NOT NULL,
	"password_hash" text NOT NULL,
	"role" "user_role" DEFAULT 'farmer' NOT NULL,
	"phone" varchar(32),
	"country" varchar(64),
	"language" varchar(8) DEFAULT 'en' NOT NULL,
	"measurement_system" varchar(16) DEFAULT 'metric' NOT NULL,
	"email_verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "weather_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cache_key" varchar(200) NOT NULL,
	"kind" varchar(16) NOT NULL,
	"provider" varchar(64) NOT NULL,
	"latitude" numeric(9, 6) NOT NULL,
	"longitude" numeric(9, 6) NOT NULL,
	"payload" jsonb NOT NULL,
	"retrieved_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_tokens" ADD CONSTRAINT "auth_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crop_varieties" ADD CONSTRAINT "crop_varieties_crop_id_crops_id_fk" FOREIGN KEY ("crop_id") REFERENCES "public"."crops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_logs" ADD CONSTRAINT "device_logs_device_id_iot_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."iot_devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "farm_activities" ADD CONSTRAINT "farm_activities_farm_id_farms_id_fk" FOREIGN KEY ("farm_id") REFERENCES "public"."farms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "farm_activities" ADD CONSTRAINT "farm_activities_planting_id_plantings_id_fk" FOREIGN KEY ("planting_id") REFERENCES "public"."plantings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "farm_activities" ADD CONSTRAINT "farm_activities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "farm_members" ADD CONSTRAINT "farm_members_farm_id_farms_id_fk" FOREIGN KEY ("farm_id") REFERENCES "public"."farms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "farm_members" ADD CONSTRAINT "farm_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "farm_risks" ADD CONSTRAINT "farm_risks_farm_id_farms_id_fk" FOREIGN KEY ("farm_id") REFERENCES "public"."farms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "farm_risks" ADD CONSTRAINT "farm_risks_planting_id_plantings_id_fk" FOREIGN KEY ("planting_id") REFERENCES "public"."plantings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "farms" ADD CONSTRAINT "farms_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iot_devices" ADD CONSTRAINT "iot_devices_farm_id_farms_id_fk" FOREIGN KEY ("farm_id") REFERENCES "public"."farms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_farm_id_farms_id_fk" FOREIGN KEY ("farm_id") REFERENCES "public"."farms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plantings" ADD CONSTRAINT "plantings_farm_id_farms_id_fk" FOREIGN KEY ("farm_id") REFERENCES "public"."farms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plantings" ADD CONSTRAINT "plantings_crop_id_crops_id_fk" FOREIGN KEY ("crop_id") REFERENCES "public"."crops"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plantings" ADD CONSTRAINT "plantings_variety_id_crop_varieties_id_fk" FOREIGN KEY ("variety_id") REFERENCES "public"."crop_varieties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prediction_inputs" ADD CONSTRAINT "prediction_inputs_prediction_id_predictions_id_fk" FOREIGN KEY ("prediction_id") REFERENCES "public"."predictions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prediction_risks" ADD CONSTRAINT "prediction_risks_prediction_id_predictions_id_fk" FOREIGN KEY ("prediction_id") REFERENCES "public"."predictions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "predictions" ADD CONSTRAINT "predictions_farm_id_farms_id_fk" FOREIGN KEY ("farm_id") REFERENCES "public"."farms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "predictions" ADD CONSTRAINT "predictions_planting_id_plantings_id_fk" FOREIGN KEY ("planting_id") REFERENCES "public"."plantings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "predictions" ADD CONSTRAINT "predictions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "predictions" ADD CONSTRAINT "predictions_method_version_prediction_versions_version_fk" FOREIGN KEY ("method_version") REFERENCES "public"."prediction_versions"("version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommendations" ADD CONSTRAINT "recommendations_farm_id_farms_id_fk" FOREIGN KEY ("farm_id") REFERENCES "public"."farms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommendations" ADD CONSTRAINT "recommendations_planting_id_plantings_id_fk" FOREIGN KEY ("planting_id") REFERENCES "public"."plantings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommendations" ADD CONSTRAINT "recommendations_risk_id_farm_risks_id_fk" FOREIGN KEY ("risk_id") REFERENCES "public"."farm_risks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sensor_readings" ADD CONSTRAINT "sensor_readings_device_id_iot_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."iot_devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sensor_readings" ADD CONSTRAINT "sensor_readings_farm_id_farms_id_fk" FOREIGN KEY ("farm_id") REFERENCES "public"."farms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_logs_created_idx" ON "audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_tokens_hash_uq" ON "auth_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "crop_varieties_crop_idx" ON "crop_varieties" USING btree ("crop_id");--> statement-breakpoint
CREATE UNIQUE INDEX "crops_slug_uq" ON "crops" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "device_logs_device_idx" ON "device_logs" USING btree ("device_id","created_at");--> statement-breakpoint
CREATE INDEX "farm_activities_farm_idx" ON "farm_activities" USING btree ("farm_id","occurred_at");--> statement-breakpoint
CREATE INDEX "farm_risks_farm_idx" ON "farm_risks" USING btree ("farm_id","active");--> statement-breakpoint
CREATE INDEX "farm_risks_dedupe_idx" ON "farm_risks" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX "farms_owner_idx" ON "farms" USING btree ("owner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "farms_client_uq" ON "farms" USING btree ("owner_id","client_id");--> statement-breakpoint
CREATE UNIQUE INDEX "iot_devices_uid_uq" ON "iot_devices" USING btree ("device_uid");--> statement-breakpoint
CREATE INDEX "iot_devices_farm_idx" ON "iot_devices" USING btree ("farm_id");--> statement-breakpoint
CREATE INDEX "notifications_user_idx" ON "notifications" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "notifications_dedupe_idx" ON "notifications" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX "plantings_farm_idx" ON "plantings" USING btree ("farm_id");--> statement-breakpoint
CREATE INDEX "plantings_crop_idx" ON "plantings" USING btree ("crop_id");--> statement-breakpoint
CREATE UNIQUE INDEX "plantings_client_uq" ON "plantings" USING btree ("farm_id","client_id");--> statement-breakpoint
CREATE INDEX "prediction_risks_pred_idx" ON "prediction_risks" USING btree ("prediction_id");--> statement-breakpoint
CREATE INDEX "predictions_farm_idx" ON "predictions" USING btree ("farm_id","created_at");--> statement-breakpoint
CREATE INDEX "predictions_planting_idx" ON "predictions" USING btree ("planting_id");--> statement-breakpoint
CREATE UNIQUE INDEX "push_subscriptions_endpoint_uq" ON "push_subscriptions" USING btree ("endpoint");--> statement-breakpoint
CREATE INDEX "recommendations_farm_idx" ON "recommendations" USING btree ("farm_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "sensor_readings_idem_uq" ON "sensor_readings" USING btree ("device_id","message_id","sensor_type");--> statement-breakpoint
CREATE INDEX "sensor_readings_device_time_idx" ON "sensor_readings" USING btree ("device_id","measured_at");--> statement-breakpoint
CREATE INDEX "sensor_readings_farm_type_time_idx" ON "sensor_readings" USING btree ("farm_id","sensor_type","measured_at");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_uq" ON "sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "soil_profiles_key_uq" ON "soil_profiles" USING btree ("cache_key");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_uq" ON "users" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "weather_snapshots_key_uq" ON "weather_snapshots" USING btree ("cache_key");