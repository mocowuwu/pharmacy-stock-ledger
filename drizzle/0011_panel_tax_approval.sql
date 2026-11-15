CREATE TYPE "public"."panel_status" AS ENUM('approved', 'pending', 'rejected');--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "panel_tax_default" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "panel_approval_required" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "panel_entries" ADD COLUMN "tax_mode" "tax_mode";--> statement-breakpoint
ALTER TABLE "panel_entries" ADD COLUMN "tax_rate_bps" integer;--> statement-breakpoint
ALTER TABLE "panel_entries" ADD COLUMN "tax_amount" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "panel_entries" ADD COLUMN "status" "panel_status" DEFAULT 'approved' NOT NULL;--> statement-breakpoint
ALTER TABLE "panel_entries" ADD COLUMN "decided_by" uuid;--> statement-breakpoint
ALTER TABLE "panel_entries" ADD COLUMN "decided_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "panel_entries" ADD COLUMN "decision_note" text;--> statement-breakpoint
-- Every entry written before approval existed was in effect the moment it was saved,
-- so each is approved by its own recorder at the moment it was recorded. Without this
-- the decision check below would refuse the existing rows.
UPDATE "panel_entries" SET "decided_by" = "recorded_by", "decided_at" = "created_at";--> statement-breakpoint
ALTER TABLE "panel_entries" ADD CONSTRAINT "panel_entries_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "panel_entries_status_idx" ON "panel_entries" USING btree ("status");--> statement-breakpoint
ALTER TABLE "panel_entries" ADD CONSTRAINT "panel_entries_tax_complete" CHECK (("panel_entries"."tax_mode" is null) = ("panel_entries"."tax_rate_bps" is null) and "panel_entries"."tax_amount" >= 0 and ("panel_entries"."tax_mode" is not null or "panel_entries"."tax_amount" = 0));--> statement-breakpoint
ALTER TABLE "panel_entries" ADD CONSTRAINT "panel_entries_decision_complete" CHECK (("panel_entries"."status" = 'pending') = ("panel_entries"."decided_at" is null) and ("panel_entries"."decided_at" is null) = ("panel_entries"."decided_by" is null) and ("panel_entries"."status" <> 'rejected' or "panel_entries"."decision_note" is not null));