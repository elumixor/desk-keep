import { z } from "zod";
import { env } from "~/lib/env";
import { ApiError } from "../http/api-error";

/** A Balance calendar block as Balance's MCP `get_event` answers it: what its pill shows. */
const blockSchema = z.looseObject({
  id: z.string(),
  title: z.string(),
  start: z.string(),
  end: z.string(),
  allDay: z.boolean(),
  location: z.string().nullish(),
  cancelled: z.boolean().optional(),
  sphere: z.object({ id: z.string(), name: z.string(), color: z.string() }).nullable(),
  path: z.string().optional(),
});

export type BalanceBlock = z.infer<typeof blockSchema>;

const origin = () => (env.BALANCE_URL ?? "https://balance.example.com").replace(/\/$/, "");
const FRESH_MS = 60_000;
const read = new Map<string, { at: number; block: Promise<BalanceBlock | null> }>();

/** One block, asked through Balance's MCP with Keep's key and remembered a minute; null when Balance has none by that id. */
export function balanceBlock(id: string): Promise<BalanceBlock | null> {
  const hit = read.get(id);
  if (hit && Date.now() - hit.at < FRESH_MS) return hit.block;
  const block = ask(id);
  read.set(id, { at: Date.now(), block });
  block.catch(() => read.delete(id));
  if (read.size > 500) read.delete(read.keys().next().value as string);
  return block;
}

async function ask(id: string) {
  if (!env.BALANCE_MCP_KEY) throw new ApiError("Keep has no Balance key (BALANCE_MCP_KEY)", 503);
  const response = await fetch(`${origin()}/mcp`, {
    method: "POST",
    signal: AbortSignal.timeout(8000),
    headers: {
      authorization: `Bearer ${env.BALANCE_MCP_KEY}`,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "get_event", arguments: { id } },
    }),
  });
  if (!response.ok) throw new ApiError(`Balance answered ${response.status}`, 502);
  const text = await response.text();
  // The MCP answers JSON, or one server-sent event holding it.
  const json = JSON.parse(text.startsWith("{") ? text : (text.match(/^data: (.*)$/m)?.[1] ?? "{}"));
  const answer = json.result?.structuredContent;
  if (!answer?.found) return null;
  return blockSchema.parse(answer);
}
