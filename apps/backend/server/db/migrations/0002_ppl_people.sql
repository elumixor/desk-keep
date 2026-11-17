-- People moved to ppl: the People database and its person pages go (views and links cascade), and an account
-- carries its ppl id. Person property values are rewritten to ppl ids by `scripts/ppl-backfill.ts`.
DELETE FROM "link" WHERE "to_urn" IN (SELECT 'kip:page/' || "id" FROM "page" WHERE "system" IS NOT NULL OR "kind" = 'person');
--> statement-breakpoint
DELETE FROM "page" WHERE "kind" = 'person';
--> statement-breakpoint
DELETE FROM "page" WHERE "system" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "page" DROP CONSTRAINT "page_person_id_person_id_fk";
--> statement-breakpoint
ALTER TABLE "page" ALTER COLUMN "kind" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "page" ALTER COLUMN "kind" SET DEFAULT 'page'::text;--> statement-breakpoint
DROP TYPE "public"."page_kind";--> statement-breakpoint
CREATE TYPE "public"."page_kind" AS ENUM('page', 'database');--> statement-breakpoint
ALTER TABLE "page" ALTER COLUMN "kind" SET DEFAULT 'page'::"public"."page_kind";--> statement-breakpoint
ALTER TABLE "page" ALTER COLUMN "kind" SET DATA TYPE "public"."page_kind" USING "kind"::"public"."page_kind";--> statement-breakpoint
ALTER TABLE "person" ADD COLUMN "ppl_id" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "person_ppl_id" ON "person" USING btree ("ppl_id");--> statement-breakpoint
ALTER TABLE "page" DROP COLUMN "system";--> statement-breakpoint
ALTER TABLE "page" DROP COLUMN "person_id";--> statement-breakpoint
DROP TYPE "public"."system_page";