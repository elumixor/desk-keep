CREATE TYPE "public"."node_kind" AS ENUM('page', 'trait', 'view');--> statement-breakpoint
ALTER TABLE "page" ADD COLUMN "kind" "node_kind" DEFAULT 'page' NOT NULL;--> statement-breakpoint
-- A trait made from a database (0006) took the database page's id: it gets an id of its own, and whatever named it
-- (pages' traits, views' trait filters, relations kept to it) follows.
CREATE TEMP TABLE "trait_ids" AS
SELECT t.id AS old, CASE WHEN EXISTS (SELECT 1 FROM "page" p WHERE p.id = t.id) THEN gen_random_uuid() ELSE t.id END AS new
FROM "trait" t;--> statement-breakpoint
DELETE FROM "trait_ids" WHERE old = new;--> statement-breakpoint
UPDATE "trait" t SET id = m.new FROM "trait_ids" m WHERE t.id = m.old;--> statement-breakpoint
UPDATE "page" p SET "traits" = ARRAY(
  SELECT coalesce(m.new, x.id) FROM unnest(p.traits) WITH ORDINALITY x(id, n) LEFT JOIN "trait_ids" m ON m.old = x.id ORDER BY x.n
) WHERE p.traits && (SELECT coalesce(array_agg(old), '{}') FROM "trait_ids");--> statement-breakpoint
UPDATE "view" v SET "filter" = (
  SELECT jsonb_agg(CASE WHEN f->>'property' = '$trait'
    THEN jsonb_set(f, '{value}', to_jsonb(coalesce((SELECT m.new::text FROM "trait_ids" m WHERE m.old::text = f->>'value'), f->>'value')))
    ELSE f END ORDER BY n)
  FROM jsonb_array_elements(v.filter) WITH ORDINALITY e(f, n)
) WHERE jsonb_array_length(v.filter) > 0;--> statement-breakpoint
UPDATE "page" p SET "schema" = (
  SELECT jsonb_agg(CASE WHEN d ? 'trait'
    THEN jsonb_set(d, '{trait}', to_jsonb(coalesce((SELECT m.new::text FROM "trait_ids" m WHERE m.old::text = d->>'trait'), d->>'trait')))
    ELSE d END ORDER BY n)
  FROM jsonb_array_elements(p.schema) WITH ORDINALITY e(d, n)
) WHERE p.schema @? '$[*].trait';--> statement-breakpoint
UPDATE "trait" t SET "properties" = (
  SELECT jsonb_agg(CASE WHEN d ? 'trait'
    THEN jsonb_set(d, '{trait}', to_jsonb(coalesce((SELECT m.new::text FROM "trait_ids" m WHERE m.old::text = d->>'trait'), d->>'trait')))
    ELSE d END ORDER BY n)
  FROM jsonb_array_elements(t.properties) WITH ORDINALITY e(d, n)
) WHERE t.properties @? '$[*].trait';--> statement-breakpoint
-- Traits become nodes (same ids, so pages' `traits` and relations' `trait` keep pointing at them): one made from a
-- database goes under that database's page, the others under their workspace.
INSERT INTO "page" ("id", "parent_id", "workspace_id", "kind", "title", "icon", "schema", "sort", "created_at", "updated_at")
SELECT t.id, x.parent, t.workspace_id, 'trait', t.name, t.icon, t.properties,
  coalesce((SELECT max(c.sort) FROM "page" c WHERE c.parent_id = x.parent), 0)
    + row_number() OVER (PARTITION BY x.parent ORDER BY lower(t.name)),
  t.created_at, t.updated_at
FROM "trait" t
CROSS JOIN LATERAL (
  SELECT coalesce((SELECT m.old FROM "trait_ids" m JOIN "page" d ON d.id = m.old WHERE m.new = t.id AND d.deleted_at IS NULL), t.workspace_id) AS parent
) x;--> statement-breakpoint
DROP TABLE "trait_ids";--> statement-breakpoint
-- A page holds every property it has: its traits' first (in their order, a name once), then its own.
UPDATE "page" p SET "schema" = (
  SELECT coalesce(jsonb_agg(y.d ORDER BY y.ord), '[]'::jsonb) FROM (
    SELECT DISTINCT ON (lower(x.d->>'name')) x.d, x.ord FROM (
      SELECT tp.d, ti.n * 1000 + tp.n AS ord
      FROM unnest(p.traits) WITH ORDINALITY ti(id, n)
      JOIN "page" tr ON tr.id = ti.id AND tr.kind = 'trait'
      CROSS JOIN LATERAL jsonb_array_elements(tr.schema) WITH ORDINALITY tp(d, n)
      UNION ALL
      SELECT e.d, 1000000 + e.n FROM jsonb_array_elements(p.schema) WITH ORDINALITY e(d, n)
    ) x ORDER BY lower(x.d->>'name'), x.ord
  ) y
) WHERE p.kind = 'page' AND cardinality(p.traits) > 0;--> statement-breakpoint
-- A select's options are shared by every select of its name in a workspace: one list, an option's first id (traits'
-- first) standing for every option of its name. Values follow by option name.
DO $$
DECLARE
  r record;
  p record;
  i int;
  d jsonb;
  o jsonb;
  canon jsonb;
  val jsonb;
  mapped jsonb;
  x text;
  nm text;
  cid text;
  sch jsonb;
  vals jsonb;
BEGIN
  CREATE TEMP TABLE shared_options (workspace_id uuid, name text, options jsonb, PRIMARY KEY (workspace_id, name)) ON COMMIT DROP;
  FOR r IN
    SELECT coalesce(pg.workspace_id, pg.id) AS ws, lower(e->>'name') AS nm, coalesce(e->'options', '[]'::jsonb) AS opts
    FROM "page" pg CROSS JOIN LATERAL jsonb_array_elements(pg.schema) e
    WHERE e->>'type' IN ('select', 'multi_select')
    ORDER BY (pg.kind = 'trait') DESC, pg.created_at
  LOOP
    SELECT s.options INTO canon FROM shared_options s WHERE s.workspace_id = r.ws AND s.name = r.nm;
    IF canon IS NULL THEN
      canon := '[]'::jsonb;
      INSERT INTO shared_options VALUES (r.ws, r.nm, canon);
    END IF;
    FOR o IN SELECT * FROM jsonb_array_elements(r.opts) LOOP
      CONTINUE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(canon) c WHERE lower(c->>'name') = lower(o->>'name'));
      -- One id names one option: a copy renamed elsewhere gets an id of its own.
      IF EXISTS (SELECT 1 FROM jsonb_array_elements(canon) c WHERE c->>'id' = o->>'id') THEN
        o := jsonb_set(o, '{id}', to_jsonb(gen_random_uuid()::text));
      END IF;
      canon := canon || jsonb_build_array(o);
    END LOOP;
    UPDATE shared_options s SET options = canon WHERE s.workspace_id = r.ws AND s.name = r.nm;
  END LOOP;

  FOR p IN
    SELECT pg.id, coalesce(pg.workspace_id, pg.id) AS ws, pg.schema, pg.properties FROM "page" pg
    WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(pg.schema) e WHERE e->>'type' IN ('select', 'multi_select'))
  LOOP
    sch := p.schema;
    vals := p.properties;
    FOR i IN 0 .. jsonb_array_length(sch) - 1 LOOP
      d := sch->i;
      CONTINUE WHEN d->>'type' NOT IN ('select', 'multi_select');
      SELECT s.options INTO canon FROM shared_options s WHERE s.workspace_id = p.ws AND s.name = lower(d->>'name');
      val := vals->(d->>'name');
      IF val IS NOT NULL AND val <> 'null'::jsonb THEN
        mapped := '[]'::jsonb;
        FOR x IN SELECT jsonb_array_elements_text(CASE WHEN jsonb_typeof(val) = 'array' THEN val ELSE jsonb_build_array(val) END) LOOP
          SELECT op->>'name' INTO nm FROM jsonb_array_elements(coalesce(d->'options', '[]'::jsonb)) op WHERE op->>'id' = x LIMIT 1;
          cid := NULL;
          IF nm IS NOT NULL THEN
            SELECT c->>'id' INTO cid FROM jsonb_array_elements(canon) c WHERE lower(c->>'name') = lower(nm) LIMIT 1;
          END IF;
          IF cid IS NOT NULL THEN mapped := mapped || jsonb_build_array(cid); END IF;
        END LOOP;
        IF d->>'type' = 'select' THEN
          IF jsonb_array_length(mapped) > 0 THEN vals := jsonb_set(vals, ARRAY[d->>'name'], mapped->0);
          ELSE vals := vals - (d->>'name');
          END IF;
        ELSE
          vals := jsonb_set(vals, ARRAY[d->>'name'], mapped);
        END IF;
      END IF;
      sch := jsonb_set(sch, ARRAY[i::text], jsonb_set(d, '{options}', canon));
    END LOOP;
    UPDATE "page" SET "schema" = sch, "properties" = vals WHERE id = p.id;
  END LOOP;
END $$;--> statement-breakpoint
-- A page has every trait whose properties it has (same name in any case, same type).
UPDATE "page" pg SET "traits" = coalesce((
  SELECT array_agg(tr.id ORDER BY lower(tr.title)) FROM "page" tr
  WHERE tr.kind = 'trait' AND tr.deleted_at IS NULL
    AND tr.workspace_id = coalesce(pg.workspace_id, pg.id)
    AND jsonb_array_length(tr.schema) > 0
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(tr.schema) want
      WHERE NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(pg.schema) have
        WHERE lower(have->>'name') = lower(want->>'name') AND have->>'type' = want->>'type'
          AND (want->>'type' <> 'extension'
            OR (have->>'extension' IS NOT DISTINCT FROM want->>'extension'
              AND have->>'extType' IS NOT DISTINCT FROM want->>'extType'))))
), '{}') WHERE pg.kind = 'page';--> statement-breakpoint
UPDATE "page" SET "traits" = '{}' WHERE "kind" <> 'page';--> statement-breakpoint
DROP TABLE "trait" CASCADE;--> statement-breakpoint
DROP FUNCTION IF EXISTS "bury_trait"();--> statement-breakpoint
DELETE FROM "sync_tombstone" WHERE "model" = 'traits';--> statement-breakpoint
-- Views become nodes under the page that hosted them (same ids, so view blocks in bodies keep working).
INSERT INTO "page" ("id", "parent_id", "workspace_id", "kind", "title", "sort", "deleted_at")
SELECT v.id, v.page_id, coalesce(h.workspace_id, h.id), 'view', v.name,
  coalesce((SELECT max(c.sort) FROM "page" c WHERE c.parent_id = v.page_id), 0)
    + row_number() OVER (PARTITION BY v.page_id ORDER BY v.position),
  h.deleted_at
FROM "view" v JOIN "page" h ON h.id = v.page_id;--> statement-breakpoint
-- A view that was a tab of its page shows in the page's body instead, after what is there.
UPDATE "page" h SET "body" = jsonb_set(
  coalesce(h.body, '{"type":"doc","content":[]}'::jsonb),
  '{content}',
  coalesce(h.body->'content', '[]'::jsonb) || (
    SELECT jsonb_agg(jsonb_build_object('type', 'viewBlock', 'attrs', jsonb_build_object('view', v.id)) ORDER BY v.position)
    FROM "view" v WHERE v.page_id = h.id AND NOT v.embedded
  )
) WHERE EXISTS (SELECT 1 FROM "view" v WHERE v.page_id = h.id AND NOT v.embedded);--> statement-breakpoint
ALTER TABLE "view" DROP CONSTRAINT "view_page_id_page_id_fk";--> statement-breakpoint
ALTER TABLE "view" DROP CONSTRAINT "view_scope_page_id_page_id_fk";--> statement-breakpoint
DROP INDEX "view_page";--> statement-breakpoint
ALTER TABLE "view" ALTER COLUMN "id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "view" ADD COLUMN "traits" uuid[] DEFAULT '{}'::uuid[] NOT NULL;--> statement-breakpoint
ALTER TABLE "view" ADD COLUMN "new_parent" uuid;--> statement-breakpoint
-- What a view keeps to: its trait filters become its traits; where it looked (a page's children or everything under
-- it) becomes a filter, and where its new pages went stays where they go.
UPDATE "view" v SET
  "traits" = coalesce((
    SELECT array_agg(DISTINCT (f->>'value')::uuid) FROM jsonb_array_elements(v.filter) f
    WHERE f->>'property' = '$trait' AND f->>'op' = 'is'
      AND EXISTS (SELECT 1 FROM "page" t WHERE t.id::text = f->>'value' AND t.kind = 'trait')
  ), '{}'),
  "filter" = coalesce((SELECT jsonb_agg(f) FROM jsonb_array_elements(v.filter) f WHERE f->>'property' <> '$trait'), '[]'::jsonb)
    || CASE v.scope
      WHEN 'children' THEN jsonb_build_array(jsonb_build_object('property', '$parent', 'op', 'is', 'value', coalesce(v.scope_page_id, v.page_id)))
      WHEN 'subtree' THEN jsonb_build_array(jsonb_build_object('property', '$under', 'op', 'is', 'value', coalesce(v.scope_page_id, v.page_id)))
      ELSE '[]'::jsonb END,
  "new_parent" = CASE WHEN v.scope = 'workspace' THEN v.page_id ELSE coalesce(v.scope_page_id, v.page_id) END;--> statement-breakpoint
DROP TRIGGER IF EXISTS "view_tombstone" ON "view";--> statement-breakpoint
DROP FUNCTION IF EXISTS "bury_view"();--> statement-breakpoint
ALTER TABLE "view" DROP COLUMN "page_id";--> statement-breakpoint
ALTER TABLE "view" DROP COLUMN "name";--> statement-breakpoint
ALTER TABLE "view" DROP COLUMN "scope";--> statement-breakpoint
ALTER TABLE "view" DROP COLUMN "scope_page_id";--> statement-breakpoint
ALTER TABLE "view" DROP COLUMN "embedded";--> statement-breakpoint
ALTER TABLE "view" DROP COLUMN "position";--> statement-breakpoint
DROP TYPE "public"."view_scope";--> statement-breakpoint
ALTER TABLE "view" ADD CONSTRAINT "view_id_page_id_fk" FOREIGN KEY ("id") REFERENCES "public"."page"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "view" ADD CONSTRAINT "view_new_parent_page_id_fk" FOREIGN KEY ("new_parent") REFERENCES "public"."page"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
DELETE FROM "sync_tombstone" WHERE "model" = 'views';--> statement-breakpoint
-- A view is deleted with its node (to the trash and back), so it needs no tombstone of its own.
-- Two live nodes under one parent never share a name: later ones are numbered.
DO $$
BEGIN
  LOOP
    WITH dup AS (
      SELECT id, title, row_number() OVER (
        PARTITION BY parent_id, lower(title) ORDER BY (kind = 'page') DESC, created_at, id
      ) AS n
      FROM "page" WHERE deleted_at IS NULL AND title <> '' AND parent_id IS NOT NULL
    )
    UPDATE "page" p SET "title" = dup.title || ' (' || dup.n || ')' FROM dup WHERE p.id = dup.id AND dup.n > 1;
    EXIT WHEN NOT FOUND;
  END LOOP;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX "page_title" ON "page" USING btree ("parent_id",lower("title")) WHERE "page"."deleted_at" is null and "page"."title" <> '';--> statement-breakpoint
-- A page's property names, lowercased: which pages could have a trait is found through an index on them.
CREATE FUNCTION "prop_keys"("schema" jsonb) RETURNS text[] LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT coalesce(array_agg(lower(e->>'name')), '{}') FROM jsonb_array_elements("schema") e
$$;--> statement-breakpoint
CREATE INDEX "page_prop_keys" ON "page" USING gin (prop_keys("schema"));
