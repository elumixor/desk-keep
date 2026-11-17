import { findProperty, mergeSchema, type PropertyValues, type Schema, validateValues } from "$model/properties";
import { draftProperties, type PageDraft, pageDraftSchema } from "$model/script/define";
import { SELECT_REF } from "$model/script/names";
import type { Host } from "$model/script/sandbox";
import { snapshot } from "$model/script/snapshot";
import { writtenValues } from "$model/script/written";
import { searchNames } from "$model/search";
import type { PageRecord } from "$model/sync";
import { pageIdOf, UUID } from "$model/urn";
import { deletePage, freeTitle, movePage, newPageRecord } from "../actions";
import { api } from "../api";
import { type QuestionSource, scriptAsk } from "../stores/script-ask.svelte";
import { pageRecords, synced } from "../sync/client.svelte";
import { local } from "../sync/local.svelte";

/**
 * What a button's script reaches when it runs in this browser: the synced pages, read and written here at once (the
 * sync carries the writes to Keep, which checks them as any edit), questions put to the presser as they come, and an
 * extension's action asked of Keep's server. What it says and opens is kept for the press to show.
 */

/** A script's error the presser caused or meant: said to the script as it is. */
export class ScriptRefusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScriptRefusal";
  }
}

/** The presser dismissed a question: the script stops, and nothing is said of it. */
export class ScriptDismissed extends Error {
  constructor() {
    super("Dismissed");
    this.name = "ScriptDismissed";
  }
}

/** How much a script may say, so one cannot flood the screen. */
const MAX_LINES = 200;
const MAX_TEXT = 2000;
/** How many pages `findPages` answers. */
const SEARCH_LIMIT = 50;
/** Prefixes on what the console says besides `log`. */
const LOG_KINDS = new Set(["warn", "error"]);

export class BrowserHost implements Host {
  readonly #pressed: PageRecord;
  readonly #source: QuestionSource;
  readonly messages: string[] = [];
  readonly open: string[] = [];
  readonly logs: string[] = [];
  #dismissed = false;

  constructor(pressed: PageRecord, source: QuestionSource) {
    this.#pressed = pressed;
    this.#source = source;
  }

  get dismissed() {
    return this.#dismissed;
  }

  out(kind: string, text: string) {
    const list = kind === "notify" ? this.messages : kind === "open" ? this.open : this.logs;
    if (list.length >= MAX_LINES) return;
    const line = text.slice(0, MAX_TEXT);
    list.push(LOG_KINDS.has(kind) ? `${kind}: ${line}` : line);
  }

  failure(error: unknown) {
    if (error instanceof ScriptDismissed) this.#dismissed = true;
    return error instanceof Error ? error.message : String(error);
  }

  async call(op: string, args: readonly unknown[]): Promise<unknown> {
    // Once dismissed, the script is only let to unwind.
    if (this.#dismissed) throw new ScriptDismissed();
    const text = (index: number) => String(args[index] ?? "");
    switch (op) {
      case "read":
        return snapshot(args[0] === undefined ? this.#page(this.#pressed.id) : this.#find(text(0)));
      case "write":
        return this.#write(text(0), (args[1] ?? {}) as Record<string, unknown>);
      case "children":
        return local
          .childrenOf(this.#page(text(0)).id)
          .filter((c) => c.kind === "page")
          .map(snapshot);
      case "create":
        return this.#create(text(0), pageDraftSchema.parse(args[1]));
      case "move":
        return this.#move(text(0), text(1));
      case "trash":
        this.#page(text(0));
        deletePage(text(0), false);
        return null;
      case "workspace":
        return snapshot(this.#page(this.#pressed.workspaceId ?? this.#pressed.id));
      case "search":
        return searchNames(this.#workspacePages(), text(0), SEARCH_LIMIT).map((hit) => snapshot(hit.page));
      case "action":
        return this.#action(text(0), text(1), text(2));
      case "ask":
        return this.#ask(text(0), (args[1] ?? { kind: "text" }) as { kind: string; options?: string[] });
      case "select":
        return this.#select(text(0));
      default:
        throw new ScriptRefusal(`Unknown operation ${op}`);
    }
  }

  #page(id: string) {
    const page = local.page(id);
    if (!page) throw new ScriptRefusal(`Page ${id} not found`);
    return page;
  }

  /** A page by id, address or exact title (any case) in the pressed page's workspace. */
  #find(ref: string) {
    const id = UUID.test(ref) ? ref : pageIdOf(ref);
    if (id) return this.#page(id);
    const titled = this.#workspacePages().filter((p) => p.title.toLowerCase() === ref.toLowerCase());
    if (!titled.length) throw new ScriptRefusal(`Page "${ref}" not found`);
    if (titled.length > 1) throw new ScriptRefusal(`Several pages are titled "${ref}"; name it by its id`);
    return titled[0];
  }

  /** The pages of the pressed page's workspace (not its traits or views). */
  #workspacePages() {
    const workspaceId = this.#pressed.workspaceId ?? this.#pressed.id;
    return [...local.pages.values()].filter((p) => (p.workspaceId ?? p.id) === workspaceId && p.kind === "page");
  }

  /** `values` checked against the schema (an option by its name), merged over `current`: null clears one. */
  #merged(schema: Schema, current: PropertyValues, values: Readonly<Record<string, unknown>>) {
    const merged: Record<string, unknown> = { ...current };
    for (const [key, value] of Object.entries(validateValues(schema, writtenValues(schema, values)))) {
      if (value === null) delete merged[key];
      else merged[key] = value;
    }
    return merged as PageRecord["properties"];
  }

  #write(id: string, values: Record<string, unknown>) {
    const page = this.#page(id);
    pageRecords.update(id, { properties: this.#merged(page.schema, page.properties, values) });
    return snapshot(this.#page(id));
  }

  /** A page made under `parentId` from a draft: its traits' properties (by id or name) and its own, or a copy. */
  #create(parentId: string, draft: PageDraft) {
    const parent = this.#page(parentId);
    const workspaceId = parent.workspaceId ?? parent.id;
    const source = draft.copyOf ? this.#page(draft.copyOf) : undefined;
    const own = draftProperties(draft);
    const traits = draft.traits.map((ref) => {
      const trait = local.traitsOf(workspaceId).find((t) => t.id === ref || t.name.toLowerCase() === ref.toLowerCase());
      if (!trait) throw new ScriptRefusal(`Trait "${ref}" not found`);
      return trait.properties;
    });
    const schema = [source?.schema ?? [], ...traits, own.schema].reduce<Schema>(
      (schema, add) =>
        mergeSchema(
          schema,
          add.filter((p) => !findProperty(schema, p.name)),
        ),
      [],
    );
    const id = crypto.randomUUID();
    pageRecords.create({
      id,
      ...newPageRecord(parentId, {
        title: freeTitle(parentId, draft.title),
        schema: [...schema],
        properties: this.#merged(schema, source?.properties ?? {}, own.values),
        ...(source && { icon: source.icon, body: source.body }),
      }),
    });
    return snapshot(this.#page(id));
  }

  /** Puts a page last under another. */
  #move(id: string, parentId: string) {
    this.#page(id);
    this.#page(parentId);
    movePage(id, parentId, null);
    return snapshot(this.#page(id));
  }

  /** An extension's action, run by Keep's server on the page as synced: this device's edits go up first. */
  async #action(extensionId: string, action: string, pageId: string) {
    await synced.flush();
    const answer = await api.pages(pageId).actions.$post({ extension: extensionId, action });
    if (!answer.ok) throw new ScriptRefusal(answer.message ?? `${action} did not succeed`);
    if (answer.message) this.messages.push(answer.message);
    if (answer.open) this.open.push(answer.open);
    if (answer.skipped.length) this.logs.push(`warn: no property could hold ${answer.skipped.join(", ")}`);
    await synced.sync();
    return { message: answer.message, open: answer.open, set: answer.set };
  }

  async #ask(question: string, { kind, options }: { kind: string; options?: string[] }) {
    if (kind === "options" && !options?.length) throw new ScriptRefusal("Nothing to choose from");
    const asked = kind === "number" || kind === "checkbox" || kind === "date" || kind === "options" ? kind : "text";
    const answer = await scriptAsk.ask(
      { question, kind: asked, ...(asked === "options" && { options }) },
      this.#source,
    );
    if (answer === null) throw new ScriptDismissed();
    return asked === "number" ? Number(answer) : asked === "checkbox" ? answer === "true" : answer;
  }

  /** The option names of a select, named `<page id>/<property>`. */
  #select(ref: string) {
    const [, pageId, name] = ref.match(SELECT_REF) ?? [];
    if (!pageId || !name)
      throw new ScriptRefusal(`"${ref}" names no select: write it as select("<page id>/<property>")`);
    const page = this.#page(pageId);
    const definition = findProperty(page.schema, name);
    if (definition?.type !== "select" && definition?.type !== "multi_select")
      throw new ScriptRefusal(`${page.title} has no select "${name}"`);
    return (definition.options ?? []).map((option) => option.name);
  }
}
