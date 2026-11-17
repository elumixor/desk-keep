-- Kip was renamed Keep, ppl People: page URNs change scheme from `kip:page/<id>` to `keep:page/<id>`, person URNs
-- from `ppl:person/<id>` to `people:person/<id>`, and an account's People id column follows.
UPDATE "link" SET "to_urn" = replace("to_urn", 'kip:page/', 'keep:page/') WHERE "to_urn" LIKE 'kip:page/%';
--> statement-breakpoint
UPDATE "link" SET "to_urn" = replace("to_urn", 'ppl:person/', 'people:person/') WHERE "to_urn" LIKE 'ppl:person/%';
--> statement-breakpoint
UPDATE "page" SET "body" = replace(replace("body"::text, 'kip:page/', 'keep:page/'), 'ppl:person/', 'people:person/')::jsonb WHERE "body"::text LIKE '%kip:page/%' OR "body"::text LIKE '%ppl:person/%';
--> statement-breakpoint
UPDATE "page" SET "properties" = replace(replace("properties"::text, 'kip:page/', 'keep:page/'), 'ppl:person/', 'people:person/')::jsonb WHERE "properties"::text LIKE '%kip:page/%' OR "properties"::text LIKE '%ppl:person/%';
--> statement-breakpoint
UPDATE "page" SET "text" = replace(replace("text", 'kip:page/', 'keep:page/'), 'ppl:person/', 'people:person/') WHERE "text" LIKE '%kip:page/%' OR "text" LIKE '%ppl:person/%';
--> statement-breakpoint
ALTER TABLE "person" RENAME COLUMN "ppl_id" TO "people_id";
--> statement-breakpoint
ALTER INDEX "person_ppl_id" RENAME TO "person_people_id";
