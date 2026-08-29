ALTER TABLE "settings" ADD COLUMN "business_tagline" text;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "digest_hour" integer DEFAULT 7 NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "smtp_host" text;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "smtp_port" integer DEFAULT 587 NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "smtp_user" text;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "smtp_password" text;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "smtp_from" text;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "smtp_secure" boolean DEFAULT false NOT NULL;