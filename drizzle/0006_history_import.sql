CREATE TYPE "public"."history_import_status" AS ENUM('active', 'withdrawn');--> statement-breakpoint
CREATE TABLE "history_imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"import_number" text NOT NULL,
	"file_name" text,
	"file_hash" text NOT NULL,
	"line_count" integer NOT NULL,
	"first_day" date NOT NULL,
	"last_day" date NOT NULL,
	"total" bigint NOT NULL,
	"imported_by" uuid NOT NULL,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" "history_import_status" DEFAULT 'active' NOT NULL,
	"withdrawn_by" uuid,
	"withdrawn_at" timestamp with time zone,
	"withdraw_reason" text,
	CONSTRAINT "history_imports_line_count_positive" CHECK ("history_imports"."line_count" > 0),
	CONSTRAINT "history_imports_days_ordered" CHECK ("history_imports"."first_day" <= "history_imports"."last_day"),
	CONSTRAINT "history_imports_withdrawal_is_explained" CHECK (("history_imports"."status" <> 'withdrawn') or ("history_imports"."withdrawn_by" is not null and "history_imports"."withdraw_reason" is not null and "history_imports"."withdrawn_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "history_sale_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"import_id" uuid NOT NULL,
	"source_row" integer NOT NULL,
	"sold_on" date NOT NULL,
	"receipt_number" text,
	"item_id" uuid,
	"item_name" text NOT NULL,
	"qty" bigint NOT NULL,
	"unit_price" bigint NOT NULL,
	"line_total" bigint NOT NULL,
	"unit_cost" bigint,
	"payment_method" "payment_method",
	"cashier_name" text,
	CONSTRAINT "history_sale_lines_qty_positive" CHECK ("history_sale_lines"."qty" > 0),
	CONSTRAINT "history_sale_lines_total_non_negative" CHECK ("history_sale_lines"."line_total" >= 0),
	CONSTRAINT "history_sale_lines_price_non_negative" CHECK ("history_sale_lines"."unit_price" >= 0),
	CONSTRAINT "history_sale_lines_cost_non_negative" CHECK ("history_sale_lines"."unit_cost" is null or "history_sale_lines"."unit_cost" >= 0)
);
--> statement-breakpoint
ALTER TABLE "history_imports" ADD CONSTRAINT "history_imports_imported_by_users_id_fk" FOREIGN KEY ("imported_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "history_imports" ADD CONSTRAINT "history_imports_withdrawn_by_users_id_fk" FOREIGN KEY ("withdrawn_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "history_sale_lines" ADD CONSTRAINT "history_sale_lines_import_id_history_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."history_imports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "history_sale_lines" ADD CONSTRAINT "history_sale_lines_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "history_imports_number_idx" ON "history_imports" USING btree ("import_number");--> statement-breakpoint
CREATE UNIQUE INDEX "history_imports_active_hash_idx" ON "history_imports" USING btree ("file_hash") WHERE "history_imports"."status" = 'active';--> statement-breakpoint
CREATE INDEX "history_sale_lines_import_idx" ON "history_sale_lines" USING btree ("import_id");--> statement-breakpoint
CREATE INDEX "history_sale_lines_sold_on_idx" ON "history_sale_lines" USING btree ("sold_on");--> statement-breakpoint
CREATE INDEX "history_sale_lines_item_idx" ON "history_sale_lines" USING btree ("item_id");