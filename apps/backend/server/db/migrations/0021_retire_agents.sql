-- Agents are retired: Pai is a People person with a regular Keep account. `scripts/migrate.ts` moves everything that
-- names an agent over to Pai (`retireAgents`, `lib/people-api/backfill.ts`) before it runs this, because that needs
-- PAI_PEOPLE_ID and People. Here: refuse to go on while agents remain, so 0022 never drops them, then clear what is
-- left of agents already deleted. Safe to re-run.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "agent") THEN
    RAISE EXCEPTION 'Agents remain: migrate with `bun run db:migrate` and PAI_PEOPLE_ID set, which moves them to Pai first';
  END IF;
END $$;--> statement-breakpoint
DELETE FROM "token" WHERE "person_id" IS NULL;--> statement-breakpoint
-- Person values naming an agent that no longer exists lose it, order kept.
UPDATE "page" SET "properties" = (
  SELECT coalesce(jsonb_object_agg(k, CASE WHEN jsonb_typeof(v) = 'array' THEN (
    SELECT coalesce(jsonb_agg(e ORDER BY o), '[]'::jsonb) FROM jsonb_array_elements(v) WITH ORDINALITY AS a(e, o)
    WHERE NOT (jsonb_typeof(e) = 'object' AND e->>'kind' = 'agent' AND e ? 'id')) ELSE v END), '{}'::jsonb)
  FROM jsonb_each("properties") AS t(k, v))
WHERE jsonb_typeof("properties") = 'object' AND jsonb_path_exists("properties", '$.*[*] ? (@.kind == "agent")');--> statement-breakpoint
UPDATE "page_version" SET "properties" = (
  SELECT coalesce(jsonb_object_agg(k, CASE WHEN jsonb_typeof(v) = 'array' THEN (
    SELECT coalesce(jsonb_agg(e ORDER BY o), '[]'::jsonb) FROM jsonb_array_elements(v) WITH ORDINALITY AS a(e, o)
    WHERE NOT (jsonb_typeof(e) = 'object' AND e->>'kind' = 'agent' AND e ? 'id')) ELSE v END), '{}'::jsonb)
  FROM jsonb_each("properties") AS t(k, v))
WHERE jsonb_typeof("properties") = 'object' AND jsonb_path_exists("properties", '$.*[*] ? (@.kind == "agent")');
