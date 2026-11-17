ALTER TABLE "page" DROP CONSTRAINT IF EXISTS "page_layout_id_layout_id_fk";--> statement-breakpoint
ALTER TABLE "page" DROP COLUMN "layout_id";--> statement-breakpoint
DROP TABLE "layout" CASCADE;--> statement-breakpoint
DELETE FROM "sync_tombstone" WHERE "model" = 'layouts';
