ALTER TABLE "page" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "view" ADD COLUMN "show_archived" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "view" ADD COLUMN "cleanup" jsonb;