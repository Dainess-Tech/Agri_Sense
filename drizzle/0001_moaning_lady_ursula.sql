CREATE INDEX "audit_logs_actor_idx" ON "audit_logs" USING btree ("actor_id");--> statement-breakpoint
CREATE INDEX "audit_logs_entity_idx" ON "audit_logs" USING btree ("entity","entity_id");--> statement-breakpoint
CREATE INDEX "auth_tokens_user_idx" ON "auth_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "auth_tokens_expiry_idx" ON "auth_tokens" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "crop_varieties_name_uq" ON "crop_varieties" USING btree ("crop_id","name");--> statement-breakpoint
CREATE INDEX "farm_members_user_idx" ON "farm_members" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "farm_risks_active_dedupe_uq" ON "farm_risks" USING btree ("dedupe_key") WHERE "farm_risks"."active" = true;--> statement-breakpoint
CREATE INDEX "farm_risks_planting_idx" ON "farm_risks" USING btree ("planting_id","category");--> statement-breakpoint
CREATE INDEX "iot_devices_status_idx" ON "iot_devices" USING btree ("farm_id","active","last_seen_at");--> statement-breakpoint
CREATE INDEX "notifications_user_dedupe_idx" ON "notifications" USING btree ("user_id","dedupe_key","created_at");--> statement-breakpoint
CREATE INDEX "plantings_farm_date_idx" ON "plantings" USING btree ("farm_id","planting_date");--> statement-breakpoint
CREATE INDEX "plantings_status_idx" ON "plantings" USING btree ("status");--> statement-breakpoint
CREATE INDEX "push_subscriptions_user_idx" ON "push_subscriptions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "recommendations_risk_idx" ON "recommendations" USING btree ("risk_id");--> statement-breakpoint
CREATE INDEX "sensor_readings_received_idx" ON "sensor_readings" USING btree ("received_at");--> statement-breakpoint
CREATE INDEX "soil_profiles_expiry_idx" ON "soil_profiles" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "weather_snapshots_expiry_idx" ON "weather_snapshots" USING btree ("expires_at");