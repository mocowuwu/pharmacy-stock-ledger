ALTER TABLE "settings" ADD COLUMN "returns_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "barcodes_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "narkotika_enabled" boolean DEFAULT false NOT NULL;