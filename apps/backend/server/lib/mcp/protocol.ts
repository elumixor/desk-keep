import { z } from "zod";
import { type Caller, withClient } from "~/lib/auth/caller";
import { answerable } from "~/lib/http/answerable";
import { ApiError } from "~/lib/http/api-error";
import { mcpTools } from "./tools";

/**
 * The Model Context Protocol, spoken directly.
 *
 * A stateless JSON-RPC endpoint is all a server of tools needs: every call carries its own key,
 * nothing is remembered between two of them, and there is no server-initiated message to keep a
 * stream open for. That is small enough to be worth owning — the official SDK brings a transport
 * built around Node's `req`/`res` and a zod version of its own, and neither fits a Nitro route
 * that has to run unchanged on a Vercel function.
 *
 * The one rule that isn't obvious: a tool that fails answers 200 with `isError`, not a JSON-RPC
 * error. A protocol error means the client asked wrongly; a failed tool is a result the model is
 * meant to read and try something else about.
 */

/**
 * Versions this server knows how to be, newest first — the list Claude Code's own client carries.
 * An unrecognised request is answered with the first, which is what the spec says to do.
 */
const PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05", "2024-10-07"] as const;

const SERVER_INFO = { name: "keep", title: "Keep", version: "1.0.0" } as const;

const INSTRUCTIONS =
  "Keep is a workspace of pages: a workspace is a root page, every page can have properties (a name and a type, " +
  "values keyed by name), and pages link to each other and to things outside Keep by their https address (a page " +
  "`https://keep.example.com/p/<id>`, a person `https://people.example.com/p/<id>`, a pai thread " +
  "`https://pai.example.com/#/thread/<id>`, a Balance calendar block " +
  "`https://balance.example.com/calendar?event=<id>`); never write `keep:`/`people:` URNs. The tree also holds traits and views. A trait is a " +
  "named set of properties, like a TypeScript interface: a page has it when it has all of its properties (same name " +
  "and type), worked out by Keep, so a task is a page having the task trait's properties (Status, Due, Assignee). A " +
  "view is a saved query: the pages having all of its traits, filtered, sorted and grouped; `find_pages` with " +
  '`view: "Waiting on me"` is what waits on the user, the same list the app and pai show. ' +
  "A task is one deliverable: a title holding several jobs is split into child tasks under one parent task. A task " +
  "page opens with a summary quote of four lines, `**Outcome:**` (what done gives), `**State:**` (where it stands), " +
  "`**Next:**` (the next step and whose) and `**Decision:**` (what waits on someone, or none), then a `Details` and " +
  "a `Log` toggle (`<details><summary>Log</summary>`): whoever works on a task keeps those four lines current with " +
  "every change, and appends to the Log. A page created with one trait and no body starts as that trait's " +
  "`Template` child page. " +
  "To answer a question from what is written in Keep, `find_pages` with `text` (every workspace at once, with the " +
  "passage that matched) and read the best hits with `read_page`. To find pages by what they are, " +
  "`list_workspace_traits`, then `find_pages` with `traits`. To change things, `list_workspaces`, then `read_page`; " +
  "`create_page` makes a page (with `traits`: a task), a trait or a view, `edit_page` changes one, its values by " +
  "property name (a select by its option's name, a person or group by People id from `list_people`, what is assigned to a group without naming a member being its leader's). A button property is " +
  "an automation: `run_automation` runs its code. Bodies are Markdown; a ```mermaid fence is a diagram, and a " +
  "mention is `[Name](https://people.example.com/p/<id>)` for a person, " +
  "`[Title](https://keep.example.com/p/<id>)` for a page. `comment` adds a " +
  "comment (or a reply to one), edits or deletes yours, and reacts with an emoji. What you may " +
  "do follows your role in the workspace (owners and members edit, guests read and comment) or the share a page " +
  "came to you through (view, comment, edit, full), inherited by everything under it; `share_page` shares one. " +
  "To follow a page, `watch` it: what changes arrives as notifications (`inbox`, and through People), and " +
  "`read_page` with `since` shows the diff. Send `x-keep-client: <your tag>` (e.g. `pai:thread/<id>`), or `client` " +
  "on a write, so your own writes do not notify the same watch.";

const JSON_RPC_VERSION = "2.0";
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;
const INTERNAL_ERROR = -32603;

type Id = string | number | null;

interface Request {
  readonly jsonrpc: string;
  readonly id?: Id;
  readonly method: string;
  readonly params?: Record<string, unknown>;
}

const requestSchema = z.object({
  jsonrpc: z.literal(JSON_RPC_VERSION),
  id: z.union([z.string(), z.number(), z.null()]).optional(),
  method: z.string(),
  params: z.record(z.string(), z.unknown()).optional(),
});

function result(id: Id, value: unknown) {
  return { jsonrpc: JSON_RPC_VERSION, id, result: value };
}

function failure(id: Id, code: number, message: string) {
  return { jsonrpc: JSON_RPC_VERSION, id, error: { code, message } };
}

/** Everything a model reads comes back as text; the same value is offered structured beside it. */
function toolResult(value: unknown) {
  return {
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
    structuredContent: value && typeof value === "object" && !Array.isArray(value) ? value : undefined,
  };
}

function toolFailure(message: string) {
  return { content: [{ type: "text", text: message }], isError: true };
}

const descriptors = mcpTools.map((tool) => ({
  name: tool.name,
  title: tool.title,
  description: tool.description,
  inputSchema: z.toJSONSchema(z.object(tool.inputSchema), { io: "input" }),
  annotations: { title: tool.title, readOnlyHint: tool.readOnly, destructiveHint: !tool.readOnly },
}));

const byName = new Map(mcpTools.map((tool) => [tool.name, tool]));

/**
 * Answers one JSON-RPC message, or nothing at all for a notification — which is what a client
 * sends to say it has finished starting up, and which must not be answered.
 */
export async function handleMessage(message: unknown, caller: Caller): Promise<object | null> {
  const parsed = requestSchema.safeParse(message);
  if (!parsed.success) return failure(null, INVALID_PARAMS, "Not a JSON-RPC 2.0 request");

  const request = parsed.data as Request;
  // A notification has no id, and the spec says an answer to one is an error in itself.
  const isNotification = request.id === undefined;
  const id = request.id ?? null;

  try {
    const answer = await dispatch(request, caller);
    if (isNotification) return null;
    return result(id, answer ?? {});
  } catch (error) {
    if (isNotification) return null;
    if (error instanceof MethodNotFound) return failure(id, METHOD_NOT_FOUND, error.message);
    if (error instanceof ApiError) return failure(id, INVALID_PARAMS, error.message);
    console.error(`[mcp] ${request.method}`, error);
    return failure(id, INTERNAL_ERROR, "Something went wrong on our side");
  }
}

class MethodNotFound extends Error {}

async function dispatch(request: Request, caller: Caller): Promise<unknown> {
  switch (request.method) {
    case "initialize":
      return {
        protocolVersion: negotiate(request.params?.protocolVersion),
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: INSTRUCTIONS,
      };
    case "ping":
      return {};
    // Sent once the client is up, and after `initialize`; both are notifications and mean nothing here.
    case "notifications/initialized":
    case "notifications/cancelled":
      return {};
    case "tools/list":
      return { tools: descriptors };
    case "tools/call":
      return callTool(request.params, caller);
    // Answered rather than refused: a client that asks and is told "none" stops asking.
    case "resources/list":
      return { resources: [] };
    case "resources/templates/list":
      return { resourceTemplates: [] };
    case "prompts/list":
      return { prompts: [] };
    default:
      throw new MethodNotFound(`Unknown method: ${request.method}`);
  }
}

function negotiate(requested: unknown) {
  const version = PROTOCOL_VERSIONS.find((known) => known === requested);
  return version ?? PROTOCOL_VERSIONS[0];
}

async function callTool(params: Record<string, unknown> | undefined, caller: Caller) {
  const name = typeof params?.name === "string" ? params.name : null;
  const tool = name ? byName.get(name) : undefined;
  if (!tool) throw new ApiError(`There is no tool called ${name ?? "(unnamed)"}`);

  const args = z.object(tool.inputSchema).safeParse(params?.arguments ?? {});
  if (!args.success) {
    const issue = args.error.issues[0];
    return toolFailure(`${issue.path.join(".") || "arguments"}: ${issue.message}`);
  }

  // A tool's `client` argument tags its writes in place of the `x-keep-client` header; the tool never reads it.
  const data = args.data as Record<string, unknown>;
  const scoped = typeof data.client === "string" ? withClient(caller, data.client) : caller;
  try {
    return toolResult(await tool.run(data, scoped));
  } catch (error) {
    // A refusal the API writes for a person — "reconnect your calendar" — is the answer here too.
    const answer = answerable(error);
    if (answer) return toolFailure(answer.message);
    console.error(`[mcp] ${tool.name}`, error);
    return toolFailure("Something went wrong on our side");
  }
}
