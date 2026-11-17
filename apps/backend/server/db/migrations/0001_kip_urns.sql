-- Keep was renamed Kip: page URNs change scheme from `keep:page/<id>` to `kip:page/<id>`.
UPDATE "link" SET "to_urn" = replace("to_urn", 'keep:page/', 'kip:page/') WHERE "to_urn" LIKE 'keep:page/%';
--> statement-breakpoint
UPDATE "page" SET "body" = replace("body"::text, 'keep:page/', 'kip:page/')::jsonb WHERE "body"::text LIKE '%keep:page/%';
--> statement-breakpoint
UPDATE "page" SET "properties" = replace("properties"::text, 'keep:page/', 'kip:page/')::jsonb WHERE "properties"::text LIKE '%keep:page/%';
--> statement-breakpoint
UPDATE "page" SET "text" = replace("text", 'keep:page/', 'kip:page/') WHERE "text" LIKE '%keep:page/%';
