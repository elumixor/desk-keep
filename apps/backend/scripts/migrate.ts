import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set — nothing to migrate");

const client = postgres(url, { prepare: false, max: 1, onnotice: () => {} });

// Agents become Pai before 0021/0022 drop them: that needs PAI_PEOPLE_ID and People, so it runs here, in TS, first.
const [{ agents }] = await client`select to_regclass('public.agent') is not null as agents`;
if (agents) {
  const { retireAgents } = await import("../server/lib/people-api/backfill");
  console.dir({ "Agents retired": await retireAgents() }, { depth: null });
}

// Predeploy runs this while the old build still serves: once 0022 drops `author_kind` and `token.agent_id`, that build
// fails comment inserts, version writes and agent-key auth until the new one is live (accepted: a short window). Account
// ids it writes as authors meanwhile are rewritten by the backfill below on the next run.
await migrate(drizzle(client), { migrationsFolder: new URL("../server/db/migrations", import.meta.url).pathname });
await client.end();
console.log("migrated");

// Data that lives in People cannot move in SQL: accounts are linked, person values and authors rewritten here, every run.
const { backfillPeople } = await import("../server/lib/people-api/backfill");
console.log("People backfill", await backfillPeople());
process.exit(0);
