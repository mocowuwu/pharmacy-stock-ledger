CREATE TYPE "public"."device_role" AS ENUM('till', 'management');--> statement-breakpoint
CREATE TYPE "public"."offline_review_kind" AS ENUM('not_posted', 'flagged');--> statement-breakpoint
CREATE TABLE "device_handoffs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code_hash" text NOT NULL,
	"device_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "device_passes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"device_id" uuid NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"max_sales" integer NOT NULL,
	"max_total" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "devices" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"role" "device_role" NOT NULL,
	"code" text NOT NULL,
	"token_hash" text NOT NULL,
	"app_version" text,
	"registered_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_sync_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"revoked_by" uuid,
	CONSTRAINT "devices_revocation_is_attributed" CHECK (("devices"."revoked_at" is null) = ("devices"."revoked_by" is null))
);
--> statement-breakpoint
CREATE TABLE "offline_sale_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "offline_review_kind" NOT NULL,
	"device_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"offline_number" text NOT NULL,
	"cashier_id" uuid NOT NULL,
	"sold_at" timestamp with time zone NOT NULL,
	"sale_id" uuid,
	"reasons" jsonb NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by" uuid,
	"resolution_note" text,
	CONSTRAINT "offline_sale_reviews_resolution_is_explained" CHECK (("offline_sale_reviews"."resolved_at" is null) or ("offline_sale_reviews"."resolved_by" is not null and "offline_sale_reviews"."resolution_note" is not null)),
	CONSTRAINT "offline_sale_reviews_flagged_is_booked" CHECK ("offline_sale_reviews"."kind" <> 'flagged' or "offline_sale_reviews"."sale_id" is not null)
);
--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN "offline_client_id" uuid;--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN "offline_number" text;--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN "device_id" uuid;--> statement-breakpoint
ALTER TABLE "device_handoffs" ADD CONSTRAINT "device_handoffs_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_handoffs" ADD CONSTRAINT "device_handoffs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_passes" ADD CONSTRAINT "device_passes_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_registered_by_users_id_fk" FOREIGN KEY ("registered_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_revoked_by_users_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offline_sale_reviews" ADD CONSTRAINT "offline_sale_reviews_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offline_sale_reviews" ADD CONSTRAINT "offline_sale_reviews_cashier_id_users_id_fk" FOREIGN KEY ("cashier_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offline_sale_reviews" ADD CONSTRAINT "offline_sale_reviews_sale_id_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sales"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offline_sale_reviews" ADD CONSTRAINT "offline_sale_reviews_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "device_handoffs_code_idx" ON "device_handoffs" USING btree ("code_hash");--> statement-breakpoint
CREATE INDEX "device_passes_device_idx" ON "device_passes" USING btree ("device_id","issued_at");--> statement-breakpoint
CREATE UNIQUE INDEX "devices_code_idx" ON "devices" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "devices_token_hash_idx" ON "devices" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "offline_sale_reviews_client_idx" ON "offline_sale_reviews" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "offline_sale_reviews_open_idx" ON "offline_sale_reviews" USING btree ("created_at") WHERE "offline_sale_reviews"."resolved_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "sales_offline_client_idx" ON "sales" USING btree ("offline_client_id");--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_offline_is_complete" CHECK (("sales"."offline_client_id" is null) = ("sales"."offline_number" is null) and ("sales"."offline_client_id" is null) = ("sales"."device_id" is null));--> statement-breakpoint
-- Added by hand: the schema files leave this reference out to avoid an import
-- cycle between sales.ts and devices.ts.
ALTER TABLE "sales" ADD CONSTRAINT "sales_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE no action ON UPDATE no action;
