import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "~/db";
import { pages } from "~/db/schema";
import { findProperty } from "~/model/properties";
import { draftProperties, type PageDraft, pageDraftSchema } from "~/model/script/define";
import { SELECT_REF } from "~/model/script/names";
import { snapshot } from "~/model/script/snapshot";
import { writtenValues } from "~/model/script/written";
import { pageIdOf, UUID } from "~/model/urn";
import type { Caller } from "../auth/caller";
import { runAction } from "../extensions/extensions";
import { answerable } from "../http/answerable";
import { ApiError, NotFoundError } from "../http/api-error";
import { search } from "../pages/search";
import { createPage, deletePage, movePage, updatePage } from "../pages/write";
import { authorizePage, type Page, workspaceRole } from "../permissions";

/**
 * What a button's script reaches outside its sandbox, as the one who pressed it: pages read, written and made through
 * the same functions as the API (each checked against their rights), extensions' actions run, and what is to reach
 * them afterwards (messages, links to open, the console) kept.
 */

export class ActionFailedError extends ApiError {
  constructor(message: string) {
    super(message);
    this.name = "ActionFailedError";
  }
}

/** What a question asks for; `options` asks for one of its `options`. */
export const ASK_KINDS = ["text", "number", "checkbox", "date", "options"] as const;
export type AskKind = (typeof ASK_KINDS)[number];

/** A question the script waits on. */
export interface ScriptQuestion {
  readonly question: string;
  readonly kind: AskKind;
  readonly options?: readonly string[];
}

export interface ScriptOutput {
  readonly messages: readonly string[];
  readonly open: readonly string[];
  readonly logs: readonly string[];
  /** Set when the script stopped at a question it had no answer for: asked, it runs again with the answers. */
  readonly ask?: ScriptQuestion;
}

/** How much a script may ask of the host and say, so one cannot flood the database or the answer. */
const MAX_CALLS = 500;
const MAX_LINES = 200;
const MAX_TEXT = 2000;

const values = z.record(z.string(), z.unknown());
/** What each operation takes. The prelude calls them, but the script can reach `__call` itself, so nothing is trusted. */
const OPERATIONS = {
  read: z.tuple([z.string().optional()]),
  write: z.tuple([z.uuid(), values]),
  children: z.tuple([z.uuid()]),
  create: z.tuple([z.uuid(), pageDraftSchema]),
  move: z.tuple([z.uuid(), z.uuid()]),
  trash: z.tuple([z.uuid()]),
  workspace: z.tuple([]),
  search: z.tuple([z.string().max(MAX_TEXT)]),
  action: z.tuple([z.uuid(), z.string(), z.uuid()]),
  ask: z.tuple([
    z.string().max(MAX_TEXT),
    z.object({ kind: z.enum(ASK_KINDS), options: z.array(z.string().max(MAX_TEXT)).max(200).optional() }),
  ]),
  select: z.tuple([z.string().max(MAX_TEXT)]),
};

/** What changes something: past one, a question cannot be asked by running the script again. */
const CHANGES = new Set(["write", "create", "move", "trash", "action"]);

function argsOf<T extends z.ZodType>(schema: T, args: readonly unknown[]): z.output<T> {
  const parsed = schema.safeParse(args);
  if (!parsed.success) throw new ApiError("A script's call to Keep had the wrong arguments");
  return parsed.data;
}

export class ScriptHost {
  readonly #caller: Caller;
  readonly #pressed: Page;
  readonly #messages: string[] = [];
  readonly #open: string[] = [];
  readonly #logs: string[] = [];
  readonly #answers: string[];
  #calls = 0;
  /** Whether the script has changed anything yet: past that, a question it cannot answer cannot be asked by running it again. */
  #changed = false;
  #asking: ScriptQuestion | undefined;

  /** `answers`: what the presser answered the script's questions, in order, the times it ran before. */
  constructor(caller: Caller, pressed: Page, answers: readonly string[] = []) {
    this.#caller = caller;
    this.#pressed = pressed;
    this.#answers = [...answers];
  }

  get output(): ScriptOutput {
    return {
      messages: [...this.#messages],
      open: [...this.#open],
      logs: [...this.#logs],
      ...(this.#asking && { ask: this.#asking }),
    };
  }

  /** What the sandbox's synchronous `__out` says: the console, `notify` and `open`; past the limit, nothing. */
  out(kind: string, text: string) {
    const list = kind === "notify" ? this.#messages : kind === "open" ? this.#open : this.#logs;
    if (list.length >= MAX_LINES) return;
    const line = text.slice(0, MAX_TEXT);
    list.push(kind === "log" || list !== this.#logs ? line : `${kind}: ${line}`);
  }

  /** What the API did not mean to say is logged and hidden from the script, as routes do. */
  failure(error: unknown) {
    const answer = answerable(error);
    if (!answer) console.error("[scripts] host call failed:", error);
    return answer?.message ?? "Something went wrong on our side";
  }

  /** What the sandbox's `__call` asks for, by name with its arguments. */
  async call(op: string, args: readonly unknown[]): Promise<unknown> {
    if (++this.#calls > MAX_CALLS) throw new ApiError(`A script may ask for at most ${MAX_CALLS} things`);
    // Stopped at a question: nothing more happens until it is answered and the script runs again.
    if (this.#asking) throw new ApiError("Waiting for an answer");
    if (CHANGES.has(op)) this.#changed = true;
    switch (op) {
      case "ask":
        return this.#ask(...argsOf(OPERATIONS.ask, args));
      case "select":
        return this.#select(...argsOf(OPERATIONS.select, args));
      case "read": {
        const [ref] = argsOf(OPERATIONS.read, args);
        // The pressed page is already read (and the script keeps what its writes answer).
        return snapshot(ref === undefined ? this.#pressed : await this.#find(ref));
      }
      case "workspace": {
        const workspaceId = this.#pressed.workspaceId ?? this.#pressed.id;
        if (!(await workspaceRole(this.#caller, workspaceId))) throw new ApiError("Not available on a shared page");
        return snapshot(await authorizePage(this.#caller, workspaceId, "read"));
      }
      case "search":
        return this.#search(...argsOf(OPERATIONS.search, args));
      case "move":
        return this.#move(...argsOf(OPERATIONS.move, args));
      case "trash":
        await deletePage(this.#caller, ...argsOf(OPERATIONS.trash, args));
        return null;
      case "write":
        return this.#write(...argsOf(OPERATIONS.write, args));
      case "children":
        return this.#children(...argsOf(OPERATIONS.children, args));
      case "create":
        return this.#create(...argsOf(OPERATIONS.create, args));
      case "action":
        return this.#action(...argsOf(OPERATIONS.action, args));
      default:
        throw new ApiError(`Unknown operation ${op}`);
    }
  }

  /**
   * The next answer, or a stop: the question goes to whoever pressed, and the script runs again from the start with
   * it answered. So it must ask before it changes anything, or that would happen twice.
   */
  #ask(question: string, { kind, options }: { kind: AskKind; options?: readonly string[] }) {
    const answer = this.#answers.shift();
    if (answer !== undefined)
      return kind === "number" ? Number(answer) : kind === "checkbox" ? answer === "true" : answer;
    if (this.#changed) throw new ApiError("Ask before changing anything: the script runs again once answered");
    if (kind === "options" && !options?.length) throw new ApiError("Nothing to choose from");
    this.#asking = { question, kind, ...(kind === "options" && { options }) };
    throw new ApiError("Waiting for an answer");
  }

  /** The option names of a select, named `<page id>/<property>`. */
  async #select(ref: string) {
    const [, pageId, name] = ref.match(SELECT_REF) ?? [];
    if (!pageId || !name) throw new ApiError(`"${ref}" names no select: write it as select("<page id>/<property>")`);
    const page = await authorizePage(this.#caller, pageId, "read");
    const definition = findProperty(page.schema, name);
    if (definition?.type !== "select" && definition?.type !== "multi_select")
      throw new ApiError(`${page.title} has no select "${name}"`);
    return (definition.options ?? []).map((option) => option.name);
  }

  /** A page by id, address or exact title (any case) in the pressed page's workspace. */
  async #find(ref: string) {
    const id = UUID.test(ref) ? ref : pageIdOf(ref);
    if (id) return authorizePage(this.#caller, id, "read");
    const workspaceId = this.#pressed.workspaceId ?? this.#pressed.id;
    const titled = await db
      .select({ id: pages.id })
      .from(pages)
      .where(
        and(
          eq(pages.workspaceId, workspaceId),
          eq(pages.kind, "page"),
          isNull(pages.deletedAt),
          sql`lower(${pages.title}) = lower(${ref})`,
        ),
      )
      .limit(2);
    if (!titled.length) throw new NotFoundError(`Page "${ref}"`);
    if (titled.length > 1) throw new ApiError(`Several pages are titled "${ref}"; name it by its id`);
    return authorizePage(this.#caller, titled[0].id, "read");
  }

  async #write(id: string, values: Record<string, unknown>) {
    const page = await authorizePage(this.#caller, id, "write");
    await updatePage(this.#caller, id, { properties: writtenValues(page.schema, values) });
    return snapshot(await authorizePage(this.#caller, id, "read"));
  }

  async #children(id: string) {
    await authorizePage(this.#caller, id, "read");
    const rows = await db
      .select()
      .from(pages)
      .where(and(eq(pages.parentId, id), eq(pages.kind, "page"), isNull(pages.deletedAt)))
      .orderBy(asc(pages.sort));
    return rows.map(snapshot);
  }

  /** A page made under `parentId` from a draft: its traits' properties and its own, or a copy of another page. */
  async #create(parentId: string, draft: PageDraft) {
    const source = draft.copyOf ? await authorizePage(this.#caller, draft.copyOf, "read", { body: true }) : undefined;
    const { schema, values } = draftProperties(draft);
    const created = await createPage(this.#caller, parentId, {
      title: draft.title,
      traits: draft.traits,
      addProperties: [...(source?.schema ?? []), ...schema],
      properties: source?.properties,
      ...(source && { icon: source.icon, body: source.body ?? undefined }),
    });
    // Written once made, so they are read as the properties its traits gave it too.
    return Object.keys(values).length
      ? this.#write(created.id, values)
      : snapshot(await authorizePage(this.#caller, created.id, "read"));
  }

  /** Puts a page last under another. */
  async #move(id: string, parentId: string) {
    await movePage(this.#caller, id, parentId, { beforeId: null });
    return snapshot(await authorizePage(this.#caller, id, "read"));
  }

  /** The workspace's pages whose title matches, best first. */
  async #search(query: string) {
    const workspaceId = this.#pressed.workspaceId ?? this.#pressed.id;
    const hits = await search(this.#caller, { workspaceId, query, by: "name" });
    return Promise.all(hits.map(async (hit) => snapshot(await authorizePage(this.#caller, hit.id, "read"))));
  }

  /** Runs an extension's action; what it says and opens reaches whoever pressed, and a refusal stops the script. */
  async #action(extensionId: string, actionId: string, pageId: string) {
    const answer = await runAction(this.#caller, pageId, { extensionId, action: actionId });
    if (!answer.ok) throw new ActionFailedError(answer.message ?? `${actionId} did not succeed`);
    if (answer.message) this.#messages.push(answer.message);
    if (answer.open) this.#open.push(answer.open);
    if (answer.skipped.length) this.#logs.push(`warn: no property could hold ${answer.skipped.join(", ")}`);
    return { message: answer.message, open: answer.open, set: answer.set };
  }
}
