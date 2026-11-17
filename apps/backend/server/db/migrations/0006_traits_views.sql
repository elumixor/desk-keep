CREATE TYPE "public"."view_scope" AS ENUM('children', 'subtree', 'workspace');--> statement-breakpoint
CREATE TABLE "trait" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"icon" text,
	"properties" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "view" ADD COLUMN "scope" "view_scope" DEFAULT 'children' NOT NULL;--> statement-breakpoint
ALTER TABLE "view" ADD COLUMN "scope_page_id" uuid;--> statement-breakpoint
ALTER TABLE "view" ADD COLUMN "embedded" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "trait" ADD CONSTRAINT "trait_workspace_id_page_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."page"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "trait_workspace_name" ON "trait" USING btree ("workspace_id",lower("name"));--> statement-breakpoint
ALTER TABLE "view" ADD CONSTRAINT "view_scope_page_id_page_id_fk" FOREIGN KEY ("scope_page_id") REFERENCES "public"."page"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- Databases become traits: each database with properties gives its schema (without ids) to a trait of its name,
-- unique in its workspace; the trait takes the database page's id, so views can name it.
INSERT INTO "trait" ("id", "workspace_id", "name", "icon", "properties")
SELECT "id", "workspace_id", CASE WHEN "n" = 1 THEN "base" ELSE "base" || ' ' || "n" END, "icon", "properties"
FROM (
  SELECT d."id", coalesce(d."workspace_id", d."id") AS "workspace_id", d."icon",
    coalesce(nullif(trim(d."title"), ''), 'Untitled') AS "base",
    row_number() OVER (
      PARTITION BY coalesce(d."workspace_id", d."id"), lower(coalesce(nullif(trim(d."title"), ''), 'Untitled'))
      ORDER BY d."deleted_at" NULLS FIRST, d."created_at"
    ) AS "n",
    (SELECT jsonb_agg(e."def" - 'id' ORDER BY e."ord") FROM jsonb_array_elements(d."schema") WITH ORDINALITY e("def", "ord")) AS "properties"
  FROM "page" d
  WHERE d."kind" = 'database' AND jsonb_array_length(coalesce(d."schema", '[]'::jsonb)) > 0
) named;
--> statement-breakpoint
-- Views name properties by name, the title as `$title`, and a database's views keep to its trait.
UPDATE "view" v SET
  "filter" = coalesce((
    SELECT jsonb_agg(jsonb_set(e."f", '{property}', to_jsonb(CASE WHEN e."f"->>'property' = 'title' THEN '$title' ELSE coalesce(
      (SELECT x->>'name' FROM jsonb_array_elements(coalesce(d."schema", '[]'::jsonb)) x WHERE x->>'id' = e."f"->>'property'),
      e."f"->>'property') END)) ORDER BY e."ord")
    FROM jsonb_array_elements(v."filter") WITH ORDINALITY e("f", "ord")), '[]'::jsonb)
    || CASE WHEN EXISTS (SELECT 1 FROM "trait" t WHERE t."id" = d."id")
      THEN jsonb_build_array(jsonb_build_object('property', '$trait', 'op', 'is', 'value', d."id"::text)) ELSE '[]'::jsonb END,
  "sort" = coalesce((
    SELECT jsonb_agg(jsonb_set(e."s", '{property}', to_jsonb(CASE WHEN e."s"->>'property' = 'title' THEN '$title' ELSE coalesce(
      (SELECT x->>'name' FROM jsonb_array_elements(coalesce(d."schema", '[]'::jsonb)) x WHERE x->>'id' = e."s"->>'property'),
      e."s"->>'property') END)) ORDER BY e."ord")
    FROM jsonb_array_elements(v."sort") WITH ORDINALITY e("s", "ord")), '[]'::jsonb),
  "group_by" = coalesce(
    (SELECT x->>'name' FROM jsonb_array_elements(coalesce(d."schema", '[]'::jsonb)) x WHERE x->>'id' = v."group_by"),
    v."group_by"),
  "visible_properties" = (
    SELECT jsonb_agg(coalesce(
      (SELECT x->>'name' FROM jsonb_array_elements(coalesce(d."schema", '[]'::jsonb)) x WHERE x->>'id' = e."p"),
      e."p") ORDER BY e."ord")
    FROM jsonb_array_elements_text(v."visible_properties") WITH ORDINALITY e("p", "ord"))
FROM "page" d
WHERE d."id" = v."page_id";
--> statement-breakpoint
-- Every page's properties become its own: a row's are its database's plus its own extras (one giving way to a
-- database property of the same id or name), defined without ids; values are re-keyed from property id to name.
-- One statement, so every subquery reads the databases' schemas as they were.
UPDATE "page" p SET
  "schema" = coalesce((SELECT jsonb_agg(defs."def" - 'id' ORDER BY defs."ord") FROM (
      SELECT e."def", e."ord" FROM "page" d, jsonb_array_elements(coalesce(d."schema", '[]'::jsonb)) WITH ORDINALITY e("def", "ord")
      WHERE d."id" = p."parent_id" AND d."kind" = 'database'
      UNION ALL
      SELECT o."def", 100000 + o."ord" FROM jsonb_array_elements(p."own_schema") WITH ORDINALITY o("def", "ord")
      WHERE NOT EXISTS (
        SELECT 1 FROM "page" d, jsonb_array_elements(coalesce(d."schema", '[]'::jsonb)) x
        WHERE d."id" = p."parent_id" AND d."kind" = 'database'
          AND (x->>'id' = o."def"->>'id' OR lower(x->>'name') = lower(o."def"->>'name')))
    ) defs), '[]'::jsonb),
  "properties" = coalesce((SELECT jsonb_object_agg(defs."def"->>'name', p."properties"->(defs."def"->>'id')) FROM (
      SELECT e."def" FROM "page" d, jsonb_array_elements(coalesce(d."schema", '[]'::jsonb)) e("def")
      WHERE d."id" = p."parent_id" AND d."kind" = 'database'
      UNION ALL
      SELECT o."def" FROM jsonb_array_elements(p."own_schema") o("def")
      WHERE NOT EXISTS (
        SELECT 1 FROM "page" d, jsonb_array_elements(coalesce(d."schema", '[]'::jsonb)) x
        WHERE d."id" = p."parent_id" AND d."kind" = 'database'
          AND (x->>'id' = o."def"->>'id' OR lower(x->>'name') = lower(o."def"->>'name')))
    ) defs WHERE p."properties" ? (defs."def"->>'id')), '{}'::jsonb);
--> statement-breakpoint
ALTER TABLE "page" ALTER COLUMN "schema" SET DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "page" ALTER COLUMN "schema" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "page" DROP COLUMN "kind";--> statement-breakpoint
ALTER TABLE "page" DROP COLUMN "own_schema";--> statement-breakpoint
DROP TYPE "public"."page_kind";