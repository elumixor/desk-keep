ALTER TABLE "page" ADD COLUMN "traits" uuid[] DEFAULT '{}'::uuid[] NOT NULL;--> statement-breakpoint
CREATE INDEX "page_traits" ON "page" USING gin ("traits");--> statement-breakpoint
-- Every page names the traits it satisfied (by having all of a trait's properties, same name and type), and keeps as
-- its own only the properties none of them brings. Values follow the trait's property name and option ids (by option
-- name); an option the page had and the trait lacks joins the trait, so no value is lost.
DO $$
DECLARE
  p record;
  t record;
  tp jsonb;
  own jsonb;
  vals jsonb;
  val jsonb;
  props jsonb;
  opts jsonb;
  mapped jsonb;
  item jsonb;
  oid text;
  oname text;
  tid text;
  found_opt jsonb;
  i int;
BEGIN
  UPDATE page pg SET traits = coalesce((
    SELECT array_agg(tr.id ORDER BY lower(tr.name)) FROM trait tr
    WHERE tr.workspace_id = coalesce(pg.workspace_id, pg.id)
      AND jsonb_array_length(tr.properties) > 0
      AND NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(tr.properties) want
        WHERE NOT EXISTS (
          SELECT 1 FROM jsonb_array_elements(pg.schema) have
          WHERE lower(have->>'name') = lower(want->>'name') AND have->>'type' = want->>'type'
            AND (want->>'type' <> 'extension'
              OR (have->>'extension' IS NOT DISTINCT FROM want->>'extension'
                AND have->>'extType' IS NOT DISTINCT FROM want->>'extType'))))
  ), '{}');

  FOR p IN SELECT id, schema, properties, traits FROM page WHERE cardinality(traits) > 0 LOOP
    own := p.schema;
    vals := p.properties;
    FOREACH tid IN ARRAY p.traits::text[] LOOP
      SELECT * INTO t FROM trait WHERE id = tid::uuid;
      props := t.properties;
      FOR i IN 0 .. jsonb_array_length(props) - 1 LOOP
        tp := props->i;
        SELECT e INTO item FROM jsonb_array_elements(own) e WHERE lower(e->>'name') = lower(tp->>'name') LIMIT 1;
        CONTINUE WHEN item IS NULL;
        own := coalesce((SELECT jsonb_agg(e) FROM jsonb_array_elements(own) e WHERE lower(e->>'name') <> lower(tp->>'name')), '[]'::jsonb);
        val := vals->(item->>'name');
        vals := vals - (item->>'name');
        CONTINUE WHEN val IS NULL OR val = 'null'::jsonb;
        IF tp->>'type' IN ('select', 'multi_select') THEN
          opts := coalesce(tp->'options', '[]'::jsonb);
          mapped := '[]'::jsonb;
          FOR oid IN SELECT x FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(val) = 'array' THEN val ELSE jsonb_build_array(val) END) x LOOP
            SELECT o INTO found_opt FROM jsonb_array_elements(opts) o WHERE o->>'id' = oid LIMIT 1;
            IF found_opt IS NULL THEN
              SELECT o->>'name' INTO oname FROM jsonb_array_elements(coalesce(item->'options', '[]'::jsonb)) o WHERE o->>'id' = oid LIMIT 1;
              CONTINUE WHEN oname IS NULL;
              SELECT o INTO found_opt FROM jsonb_array_elements(opts) o WHERE lower(o->>'name') = lower(oname) LIMIT 1;
              IF found_opt IS NULL THEN
                found_opt := (SELECT o FROM jsonb_array_elements(item->'options') o WHERE o->>'id' = oid LIMIT 1);
                opts := opts || jsonb_build_array(found_opt);
              END IF;
            END IF;
            mapped := mapped || jsonb_build_array(found_opt->>'id');
          END LOOP;
          IF opts IS DISTINCT FROM coalesce(tp->'options', '[]'::jsonb) THEN
            tp := jsonb_set(tp, '{options}', opts);
            props := jsonb_set(props, ARRAY[i::text], tp);
            UPDATE trait SET properties = props WHERE id = t.id;
          END IF;
          IF tp->>'type' = 'select' THEN
            IF jsonb_array_length(mapped) > 0 THEN vals := vals || jsonb_build_object(tp->>'name', mapped->0); END IF;
          ELSIF jsonb_array_length(mapped) > 0 THEN
            vals := vals || jsonb_build_object(tp->>'name', mapped);
          END IF;
        ELSE
          vals := vals || jsonb_build_object(tp->>'name', val);
        END IF;
      END LOOP;
    END LOOP;
    UPDATE page SET schema = own, properties = vals WHERE id = p.id;
  END LOOP;
END $$;
