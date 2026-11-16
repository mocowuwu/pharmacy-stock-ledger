CREATE TABLE "panel_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entry_number" text NOT NULL,
	"entry_date" timestamp with time zone DEFAULT now() NOT NULL,
	"recorded_by" uuid NOT NULL,
	"pharmacist_id" uuid,
	"item_code" text NOT NULL,
	"item_name" text NOT NULL,
	"unit" text NOT NULL,
	"qty" bigint NOT NULL,
	"unit_cost" bigint DEFAULT 0 NOT NULL,
	"unit_price" bigint DEFAULT 0 NOT NULL,
	"partner_name" text,
	"destination" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "panel_entries_qty_positive" CHECK ("panel_entries"."qty" > 0)
);
--> statement-breakpoint
CREATE TABLE "panel_sequences" (
	"year" integer PRIMARY KEY NOT NULL,
	"last_number" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "panel_entries" ADD CONSTRAINT "panel_entries_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "panel_entries" ADD CONSTRAINT "panel_entries_pharmacist_id_users_id_fk" FOREIGN KEY ("pharmacist_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "panel_entries_number_idx" ON "panel_entries" USING btree ("entry_number");--> statement-breakpoint
CREATE INDEX "panel_entries_entry_date_idx" ON "panel_entries" USING btree ("entry_date");--> statement-breakpoint
CREATE INDEX "panel_entries_recorded_by_idx" ON "panel_entries" USING btree ("recorded_by");--> statement-breakpoint
CREATE INDEX "panel_entries_item_code_idx" ON "panel_entries" USING btree ("item_code");