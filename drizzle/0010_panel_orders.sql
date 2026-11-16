ALTER TABLE "panel_sequences" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "panel_sequences" CASCADE;--> statement-breakpoint
ALTER TABLE "panel_entries" ALTER COLUMN "entry_date" DROP DEFAULT;--> statement-breakpoint
-- Rows written so far stored the chosen day as UTC midnight, so UTC recovers it exactly;
-- the session timezone, which a bare cast would use, could shift it a day.
ALTER TABLE "panel_entries" ALTER COLUMN "entry_date" SET DATA TYPE date USING (("entry_date" AT TIME ZONE 'UTC')::date);--> statement-breakpoint
ALTER TABLE "panel_entries" ADD COLUMN "order_ref" text;--> statement-breakpoint
ALTER TABLE "panel_entries" ADD COLUMN "voided_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "panel_entries" ADD COLUMN "voided_by" uuid;--> statement-breakpoint
ALTER TABLE "panel_entries" ADD COLUMN "void_reason" text;--> statement-breakpoint
ALTER TABLE "panel_entries" ADD CONSTRAINT "panel_entries_voided_by_users_id_fk" FOREIGN KEY ("voided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "panel_entries" ADD CONSTRAINT "panel_entries_money_not_negative" CHECK ("panel_entries"."unit_cost" >= 0 and "panel_entries"."unit_price" >= 0);--> statement-breakpoint
ALTER TABLE "panel_entries" ADD CONSTRAINT "panel_entries_void_complete" CHECK (("panel_entries"."voided_at" is null) = ("panel_entries"."voided_by" is null) and ("panel_entries"."voided_at" is null) = ("panel_entries"."void_reason" is null));