ALTER TABLE "settings" ADD COLUMN "low_stock_default_point" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "low_stock_cover_days" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "alert_rules" jsonb;--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_low_stock_sane" CHECK ("settings"."low_stock_default_point" >= 0 and "settings"."low_stock_cover_days" >= 0);--> statement-breakpoint
-- The alert thresholds used to be part of the settings screen, so anyone holding
-- `settings.manage` could change them. They are behind `alerts.configure` now;
-- everyone who could change them yesterday still can today. The owner holds
-- every permission implicitly and has no rows here.
INSERT INTO "user_permissions" ("user_id", "permission", "granted_by")
SELECT "user_id", 'alerts.configure', "granted_by" FROM "user_permissions" WHERE "permission" = 'settings.manage'
ON CONFLICT DO NOTHING;
