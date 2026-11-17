import { sql } from "drizzle-orm";
import type { Tx } from "~/db";
import type { PropertyValues, Schema } from "~/model/properties";

interface BulkRow {
  readonly id: string;
  readonly schema?: Schema;
  readonly properties?: PropertyValues;
  readonly traits?: readonly string[];
}

const CHUNK = 500;

/**
 * Many pages rewritten in one statement each 500: what a trait change or a shared option does to every page having
 * it. A field left out of a row stays as it was; a changed schema or values count as a change (`updated_at`).
 */
export async function writeRows(tx: Tx, rows: readonly BulkRow[]) {
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    await tx.execute(sql`
      update page set
        schema = coalesce(v.schema, page.schema),
        properties = coalesce(v.properties, page.properties),
        traits = case when v.traits is null then page.traits
          else array(select jsonb_array_elements_text(v.traits))::uuid[] end,
        updated_at = case when v.schema is null and v.properties is null then page.updated_at else now() end
      from jsonb_to_recordset(${JSON.stringify(chunk)}::jsonb) as v(id uuid, schema jsonb, properties jsonb, traits jsonb)
      where page.id = v.id`);
  }
}
