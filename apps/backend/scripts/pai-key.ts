import { writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../server/db";
import { memberships, people } from "../server/db/schema";
import { mintToken } from "../server/lib/auth/tokens";
import { env } from "../server/lib/env";
import { peopleApi } from "../server/lib/people-api/client";

/**
 * Mints a `keep_` key for Pai's account (the one linked to People person PAI_PEOPLE_ID, made when missing) and writes
 * it to `--out`, never to the terminal: `bun run pai:key --out <file> [--workspace <id>]... [--name <key name>]`.
 * Each `--workspace` makes Pai a member there first.
 */
const { values } = parseArgs({
  options: {
    out: { type: "string" },
    workspace: { type: "string", multiple: true },
    name: { type: "string" },
  },
});
const args = z
  .object({
    out: z.string().min(1),
    workspace: z.array(z.uuid()).default([]),
    name: z.string().min(1).max(100).default("pai"),
  })
  .parse(values);

const peopleId = env.PAI_PEOPLE_ID;
if (!peopleId) throw new Error("PAI_PEOPLE_ID is not set: Pai's People person id");
if (!(await peopleApi.get(peopleId))) throw new Error(`People has no person ${peopleId} (PAI_PEOPLE_ID)`);

let pai = await db.query.people.findFirst({ where: eq(people.peopleId, peopleId) });
pai ??= (await db.insert(people).values({ name: "Pai", peopleId }).returning())[0];

for (const workspaceId of args.workspace)
  await db.insert(memberships).values({ personId: pai.id, workspaceId, role: "member" }).onConflictDoNothing();

const { secret, id } = await mintToken({ personId: pai.id }, args.name);
await writeFile(args.out, `${secret}\n`, { mode: 0o600 });
console.log({ account: pai.id, peopleId, token: id, workspaces: args.workspace, written: args.out });
process.exit(0);
