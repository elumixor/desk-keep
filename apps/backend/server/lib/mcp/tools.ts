import { randomUUID } from "node:crypto";
import { type ZodRawShape, z } from "zod";
import { visitorScope } from "~/lib/access";
import type { Caller } from "~/lib/auth/caller";
import { cleanupSaved } from "~/lib/cleanup";
import { commentPayload, commentsOn, deleteComment, saveComment, updateComment } from "~/lib/comments";
import { listExtensions } from "~/lib/extensions/extensions";
import { ApiError, NotFoundError } from "~/lib/http/api-error";
import { fields } from "~/lib/http/schemas";
import { listInbox, markRead } from "~/lib/notify/inbox";
import { changesSince } from "~/lib/notify/since";
import { myWatches, unwatchPage, watchPage } from "~/lib/notify/watch";
import { setArchived } from "~/lib/pages/archive";
import { getPage, myWorkspaces } from "~/lib/pages/read";
import { MAX_SEARCH_LIMIT, search } from "~/lib/pages/search";
import { createPage, updatePage, type ViewConfig } from "~/lib/pages/write";
import { authorizePage } from "~/lib/permissions";
import { addReaction, reactionsOf, removeReaction } from "~/lib/reactions";
import { pressButton } from "~/lib/scripts/run";
import { listShares, resolveInvitee, revokeShare, sharedOnly, sharePage } from "~/lib/shares";
import { checked, findTrait, listTraits, templateBody, updateTrait } from "~/lib/traits";
import { listViews, queryView, runQuery } from "~/lib/views";
import { assigneeInput, listAssignable, resolveAssignee } from "~/lib/workspaces/assignable";
import { SHARE_ROLES } from "~/model/access";
import { type DocNode, emptyDoc } from "~/model/document";
import { fromMarkdown, toMarkdown } from "~/model/markdown";
import { findProperty, mergeSchema, type Schema } from "~/model/properties";
import { SEARCH_BY } from "~/model/search";
import { outline, section } from "~/model/sections";
import { REACTION_EMOJI_MAX } from "~/model/sync";
import { pageIdOf, pageUrl, UUID } from "~/model/urn";
import { ARCHIVED_MODES, type ArchivedMode, cleanupSchema, type Filter, PARENT, type Sort, UNDER } from "~/model/views";

/**
 * What an assistant can do in Keep, written against the same services the routes call. Bodies travel as Markdown
 * (`model/markdown.ts`): a model reads and writes that far better than editor JSON.
 */
interface McpTool {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly inputSchema: ZodRawShape;
  readonly readOnly: boolean;
  run(args: Record<string, unknown>, caller: Caller): Promise<unknown>;
}

function tool<S extends ZodRawShape>(definition: {
  name: string;
  title: string;
  description: string;
  inputSchema: S;
  readOnly?: boolean;
  run(args: { [K in keyof S]: z.infer<S[K]> }, caller: Caller): Promise<unknown>;
}): McpTool {
  return {
    ...definition,
    readOnly: definition.readOnly ?? true,
    run: (args, caller) => definition.run(args as never, caller),
  };
}

const filled = (values: unknown) => !!values && typeof values === "object" && Object.keys(values).length > 0;

const summary = (page: { id: string; title: string; icon: string | null; properties?: unknown }) => ({
  id: page.id,
  url: pageUrl(page.id),
  title: page.title,
  icon: page.icon,
  ...(filled(page.properties) ? { properties: page.properties } : {}),
});

/** How `read_page` writes a body: with its marks, so bold, code and links survive. */
const BODY_MARKDOWN = { marks: true } as const;

/**
 * What `read_page` gives of a long body: the section a heading names, the outline (asked for, or when no heading
 * matches, with the `error` saying so), or both.
 */
function bodyPart(doc: DocNode, outlined: boolean | undefined, wanted: string | undefined) {
  const part = wanted === undefined ? null : section(doc, wanted, BODY_MARKDOWN);
  const missing = wanted !== undefined && part === null;
  return {
    ...(part !== null && { body: part }),
    ...((outlined || missing) && { outline: outline(doc, BODY_MARKDOWN) }),
    ...(missing && { error: `No heading is "${wanted}": the outline lists them` }),
  };
}

/** A Markdown body as editor JSON, left out when not given. */
const markdownBody = (body: string | undefined) => (body === undefined ? undefined : fromMarkdown(body));

/** The ids of the traits some refs (names, paths or ids) name in a workspace. */
const traitIds = (workspaceId: string, refs: readonly string[]) =>
  Promise.all(refs.map(async (ref) => (await findTrait(workspaceId, ref)).id));

const DEFINE =
  "Property definitions (`name`, `type`, and for a select its `options`, for a formula its `formula`, for an " +
  "extension `extension` + `extType`, for a button its `label` and `code`: JavaScript run when pressed, with " +
  '`self` (the pressed page), `page("<id or title>")`, `workspace`, `findPages(query)`, a page\'s `.prop(name).value` ' +
  "(assigning writes it), `.children` (`.add(page)` moves or makes one there, `.remove(page)` trashes it), " +
  "`new Page({title, traits, properties: [new Property(name, type, value)]})`, `.copy()`, `log`, `notify(text)`, `open(url)` and an extension's " +
  "actions as `<extension>.<actionId in camelCase>()`, all synchronous). Same name and type is the same property " +
  "wherever it is defined.";

const MENTIONS =
  "Mention a person as `[Name](https://people.example.com/p/<id>)` (ids from `list_people`), a page as " +
  "`[Title](https://keep.example.com/p/<id>)`.";

const CLIENT =
  "Tags this write (in place of the `x-keep-client` header): a watcher who is you, watching under the same tag, " +
  "is not told of it.";

const PROPERTIES =
  "Values keyed by property name (any case); a select or multi-select takes option names or ids; `null` clears one.";

const WHERE =
  "Filters: property names (any case) or `$title`, `$created`, `$updated`, `$parent` (is: the page right above), " +
  "`$under` (is: any page above), with is, is_not, contains, empty, not_empty, gt, lt.";

const VIEW =
  "What a view shows: the pages having all of `traits` (names, paths or ids; any page when none), `filter`ed, " +
  "`sort`ed and grouped (`group_by` a property name), laid out as a `layout` (table, board, list, timeline); " +
  "`show_archived` shows archived pages too. `cleanup` ({property, value, days}, null to remove) archives the pages " +
  "it shows once `property` has been `value` (an option's name) for `days` days: run daily, and once when saved. ";

const ARCHIVED =
  "Archived pages (out of the tree and views): `exclude` (default) leaves them out, `include` finds them too " +
  "(marked `archivedAt`), `only` finds nothing else.";

const viewInput = z.object({
  layout: fields.viewKind.optional(),
  traits: fields.traits.optional(),
  filter: fields.filter.optional(),
  sort: fields.sort.optional(),
  group_by: z.string().nullable().optional(),
  show_archived: z.boolean().optional(),
  cleanup: cleanupSchema.nullable().optional(),
});

/** A view's query as an assistant writes it, as the server keeps it: traits by id. */
async function viewConfig(
  workspaceId: string,
  view: z.infer<typeof viewInput> | undefined,
): Promise<ViewConfig | undefined> {
  if (!view) return undefined;
  return {
    kind: view.layout,
    traits: view.traits && (await traitIds(workspaceId, view.traits)),
    filter: view.filter,
    sort: view.sort,
    groupBy: view.group_by,
    showArchived: view.show_archived,
    cleanup: view.cleanup,
  };
}

/**
 * Person values as an assistant writes them (a People id or address, `{kind: "person", id}`, one or a list) as the server
 * keeps them: a checked list of assignees.
 */
async function withAssignees(schema: Schema, properties: Record<string, unknown> | undefined) {
  if (!properties) return undefined;
  const entries = await Promise.all(
    Object.entries(properties).map(async ([name, value]) => {
      if (value === null || findProperty(schema, name)?.type !== "person") return [name, value] as const;
      const list = z.array(assigneeInput).parse(Array.isArray(value) ? value : [value]);
      return [name, await Promise.all(list.map((a) => resolveAssignee(a)))] as const;
    }),
  );
  return Object.fromEntries(entries);
}

/** The properties of some traits, for reading the values written alongside them. */
const traitSchema = async (workspaceId: string, refs: readonly string[] | undefined) =>
  (await Promise.all((refs ?? []).map((ref) => findTrait(workspaceId, ref)))).flatMap((t) => t.properties);

/**
 * The pages a saved view shows: one view by id or address, or every view of that name (case aside) in the workspaces the
 * caller sees, their pages one list, each once.
 */
async function viewPages(
  caller: Caller,
  ref: string,
  workspaceId: string | undefined,
  limit: number,
  archived: ArchivedMode | undefined,
) {
  const id = pageIdOf(ref) ?? (UUID.test(ref) ? ref : null);
  const workspaces = workspaceId ? [workspaceId] : (await myWorkspaces(caller)).map((w) => w.id);
  const ids = id
    ? [id]
    : (await Promise.all(workspaces.map((w) => listViews(caller, w))))
        .flat()
        .filter((v) => v.name.trim().toLowerCase() === ref.trim().toLowerCase())
        .map((v) => v.id);
  if (!ids.length) throw new NotFoundError(`View "${ref}"`);
  const results = await Promise.all(ids.map((viewId) => queryView(caller, viewId, archived)));
  const rows = results.flatMap((r) => r.rows).filter((row, i, all) => all.findIndex((r) => r.id === row.id) === i);
  return {
    views: results.map((r) => ({ id: r.view.id, url: pageUrl(r.view.id), name: r.view.name })),
    columns: results.flatMap((r) => r.columns).filter((c, i, all) => all.findIndex((d) => d.name === c.name) === i),
    total: rows.length,
    pages: rows.slice(0, limit).map((row) => ({
      id: row.id,
      url: pageUrl(row.id),
      title: row.title,
      parentId: row.parentId,
      traits: row.traits,
      properties: row.properties,
      updatedAt: row.updatedAt,
      ...(row.archivedAt && { archivedAt: row.archivedAt }),
    })),
  };
}

/** Pages by structure (traits, where they sit, filters), as a view would show them. */
async function queryPages(
  caller: Caller,
  input: {
    workspaceId: string | undefined;
    under: string | undefined;
    scope: "children" | "subtree" | undefined;
    traits: readonly string[] | undefined;
    filter: Filter[] | undefined;
    sort: Sort[] | undefined;
    archived: ArchivedMode | undefined;
  },
) {
  const page = await authorizePage(caller, input.under ?? input.workspaceId ?? "", "read");
  const workspaceId = page.workspaceId ?? page.id;
  const where =
    page.id === workspaceId
      ? []
      : [{ property: input.scope === "children" ? PARENT : UNDER, op: "is" as const, value: page.id }];
  const result = await runQuery(
    workspaceId,
    {
      traits: await traitIds(workspaceId, input.traits ?? []),
      filter: [...where, ...(input.filter ?? [])],
      sort: input.sort ?? [],
      archived: input.archived ?? "exclude",
    },
    await visitorScope(caller.person.id, workspaceId),
  );
  return { workspaceId, ...result };
}

export const mcpTools: readonly McpTool[] = [
  tool({
    name: "list_workspaces",
    title: "List workspaces",
    description:
      "The workspaces this key is a member of (`workspaces`, with the caller's role in each: owners run it, members " +
      "edit, guests read and comment; a workspace id is also its root page id), and the pages shared with it in " +
      "workspaces it is no member of (`shared`, each with its `role`: view, comment, edit, or full, which may also " +
      "share it on and trash it; a share reaches everything under the page).",
    inputSchema: {},
    run: async (_, caller) => ({ workspaces: await myWorkspaces(caller), shared: await sharedOnly(caller) }),
  }),
  tool({
    name: "find_pages",
    title: "Find pages",
    description:
      "Finds pages. `text` alone searches every workspace the key can see (or `workspace_id`): `by` `name` matches " +
      "titles fuzzily, `content` is full-text over titles, headings, bodies and property values, `both` (default) " +
      "gives name matches first; each hit has `match`, `snippet` (the passage that matched, terms in **bold**), " +
      "`path`, `workspace`, `url`, `updatedAt`. Any of `traits`, `under`, `filter`, `sort` finds pages by what they " +
      "are and where they sit, in one workspace (`workspace_id`, or the one `under` is in): `traits` (names, paths or " +
      "ids, from `list_workspace_traits`) keeps pages having all of them, `under` keeps the pages below that page " +
      "(`scope`: `subtree` (default) or `children`). " +
      WHERE +
      " `sort` likewise. These return pages with their values, `traits` (ids), `columns` and `total`; with `text` " +
      "too, only the ones the search found, in its order. `view` (an id, its address or a saved view's name, " +
      "like `Waiting on me`) gives the pages that view shows, in its order: a name gathers every view of that name in " +
      "the workspaces the key sees (or `workspace_id`), so a list read here is the one the app shows (`archived` " +
      "overrides whether it shows archived pages). " +
      ARCHIVED +
      " Read one in full with `read_page`.",
    inputSchema: {
      text: z.string().min(1).max(200).optional(),
      workspace_id: fields.id.optional(),
      under: fields.id.optional(),
      scope: z.enum(["children", "subtree"]).optional(),
      traits: fields.traits.optional(),
      filter: fields.filter.optional(),
      sort: fields.sort.optional(),
      by: z.enum(SEARCH_BY).optional(),
      view: z.string().min(1).max(200).optional(),
      archived: z.enum(ARCHIVED_MODES).optional(),
      limit: z.number().int().min(1).max(500).optional(),
    },
    run: async ({ text, workspace_id, under, scope, traits, filter, sort, by, view, archived, limit }, caller) => {
      if (view) return await viewPages(caller, view, workspace_id, limit ?? 100, archived);
      const structured = !!(under || traits?.length || filter?.length || sort?.length);
      if (!structured) {
        if (!text) throw new ApiError("Give `text`, or `traits`, `under`, `filter` or `sort`");
        return search(caller, {
          workspaceId: workspace_id,
          query: text,
          by,
          limit: Math.min(limit ?? 20, MAX_SEARCH_LIMIT),
          archived,
        });
      }
      if (!workspace_id && !under) throw new ApiError("Name the workspace (`workspace_id`) or a page (`under`)");
      const result = await queryPages(caller, {
        workspaceId: workspace_id,
        under,
        scope,
        traits,
        filter,
        sort,
        archived,
      });
      let rows = result.rows;
      const snippets = new Map<string, string | null>();
      if (text) {
        const hits = await search(caller, {
          workspaceId: result.workspaceId,
          query: text,
          by,
          limit: MAX_SEARCH_LIMIT,
          archived: archived ?? "exclude",
        });
        const byId = new Map(rows.map((r) => [r.id, r]));
        rows = hits.flatMap((h) => {
          const row = byId.get(h.id);
          if (row) snippets.set(h.id, h.snippet);
          return row ? [row] : [];
        });
      }
      return {
        traits: result.traits.map((t) => t.name),
        columns: result.columns,
        total: rows.length,
        pages: rows.slice(0, limit ?? 100).map((r) => ({
          id: r.id,
          url: pageUrl(r.id),
          title: r.title,
          parentId: r.parentId,
          traits: r.traits,
          properties: r.properties,
          ...(r.archivedAt && { archivedAt: r.archivedAt }),
          ...(snippets.get(r.id) && { snippet: snippets.get(r.id) }),
        })),
      };
    },
  }),
  tool({
    name: "read_page",
    title: "Read page",
    description:
      "A node in full: `kind` (page, trait or view), `path` (ancestor titles), `workspace`, `traits` it has (worked " +
      "out from its properties), `schema` (every property it has: name, type, options…; for a trait, the properties " +
      "its pages have), `properties` (values by name), `body` as Markdown (diagrams are ```mermaid fences, a view " +
      "embedded is a `[view <id>]` line, mentions are `[Label](address)`), `children`, the `views` under it, `backlinks` and " +
      "`comments` (oldest first: `body` text with `[Label](address)` mentions, `replyTo` the comment it answers, " +
      "`reactions` as emoji with who put them). For a view, also its query (`view`) and the `pages` it shows, filtered " +
      "and sorted as it is. `ancestors` are the pages above it, root first (`{id, url, title}`; for a page shared " +
      "with you, from the shared page down). `since` (a watch notification's `data.since`, or an ISO time) adds " +
      "`changes`: what changed since then (`items` as the notification tells them, the `body` diff in lines, " +
      "`properties`, the `comments` written or edited and the `children` added since; a time is matched to the " +
      "page's history, which keeps one version per ten minutes of editing). A long page: `outline: true` first, then " +
      "`section` (a heading's text): both give `children` as `{id, title}` and `commentCount` instead of the comments, " +
      "`outline` the body's headings with each section's length in characters instead of the body, `section` only that " +
      "heading's part of it (to the next heading of the same or a higher level), or the outline and an `error` when no " +
      "heading has that text.",
    inputSchema: {
      id: fields.id,
      since: z.string().min(1).max(100).optional(),
      outline: z.boolean().optional(),
      section: z.string().min(1).max(200).optional(),
    },
    run: async ({ id, since, outline: outlined, section: wanted }, caller) => {
      const [{ page, children, views, backlinks, ancestors, workspace }, comments] = await Promise.all([
        getPage(caller, id),
        // `getPage` authorizes the read: if it throws, these are never returned.
        commentsOn(id),
      ]);
      const path = ancestors.map((a) => a.title || "Untitled");
      const shown = page.kind === "view" ? await queryView(caller, id) : undefined;
      return {
        ...summary(page),
        kind: page.kind,
        path,
        ancestors: ancestors.map((a) => ({ id: a.id, url: pageUrl(a.id), title: a.title })),
        workspace: { id: workspace.id, title: workspace.title },
        updatedAt: page.updatedAt,
        ...(page.archivedAt && { archivedAt: page.archivedAt }),
        traits: page.traits.map((t) => t.name),
        schema: page.schema,
        properties: page.properties,
        ...(outlined || wanted !== undefined
          ? {
              ...bodyPart(page.body ?? emptyDoc(), outlined, wanted),
              children: children.map((c) => ({ id: c.id, title: c.title })),
              commentCount: comments.length,
            }
          : {
              body: page.body ? toMarkdown(page.body, BODY_MARKDOWN) : "",
              children: children.map((c) => ({ ...summary(c), kind: c.kind })),
              comments: comments.map(({ pageId: _, ...c }) => c),
            }),
        views: views.map((v) => ({ id: v.id, name: v.name, kind: v.kind, traits: v.traits })),
        backlinks,
        ...(page.view && { view: page.view }),
        ...(since && { changes: await changesSince(caller, page, since) }),
        ...(shown && {
          total: shown.rows.length,
          pages: shown.rows.slice(0, 100).map((r) => ({
            id: r.id,
            url: pageUrl(r.id),
            title: r.title,
            properties: r.properties,
          })),
        }),
      };
    },
  }),
  tool({
    name: "create_page",
    title: "Create page",
    description:
      "Creates a node under a parent: a page (default), a trait or a view (`kind`). A page: `traits` (names, paths or " +
      "ids, from `list_workspace_traits`) give it their properties, so it has those traits (a task is a page having " +
      "the workspace's task trait); `define` adds more properties; `properties` are values by name. A trait: " +
      "`define` is its properties, and the pages already having them all have it. A view: `view` is its query. The " +
      "body is Markdown; a ```mermaid fence becomes a diagram, a `[view <id>]` line embeds a view. " +
      MENTIONS +
      " Titles are unique under a parent: a taken one is numbered.",
    inputSchema: {
      parent_id: fields.id,
      kind: z.enum(["page", "trait", "view"]).optional(),
      title: fields.title,
      body: z.string().optional().describe("Markdown"),
      icon: fields.icon.optional(),
      traits: fields.traits.optional(),
      properties: fields.properties.optional().describe(PROPERTIES),
      define: fields.schema.optional().describe(DEFINE),
      view: viewInput.optional().describe(VIEW),
      client: fields.client.optional().describe(CLIENT),
    },
    readOnly: false,
    // `client` is the caller's already (`protocol.ts`).
    run: async ({ parent_id, kind = "page", body, define, traits, properties, view, client: _, ...input }, caller) => {
      const parent = await authorizePage(caller, parent_id, "write");
      const workspaceId = parent.workspaceId ?? parent.id;
      if (kind === "trait") {
        const trait = await createPage(caller, parent_id, {
          ...input,
          kind,
          body: markdownBody(body),
          schema: checked(define ?? []),
        });
        return { ...summary(trait), kind, schema: trait.schema };
      }
      const schema = [...(define ?? []), ...(await traitSchema(workspaceId, traits))];
      // A page of one trait and no body starts as the trait's template.
      const template =
        kind === "page" && body === undefined && traits?.length === 1
          ? await templateBody((await findTrait(workspaceId, traits[0])).id)
          : null;
      return summary(
        await createPage(caller, parent_id, {
          ...input,
          kind,
          ...(kind === "page" && {
            traits,
            addProperties: define,
            properties: await withAssignees(schema, properties),
          }),
          body: template ?? markdownBody(body),
          view: kind === "view" ? ((await viewConfig(workspaceId, view)) ?? {}) : undefined,
        }),
      );
    },
  }),
  tool({
    name: "edit_page",
    title: "Edit page",
    description:
      "Changes a node. `title`, `icon`, `body` (Markdown, replaces the whole body; a ```mermaid fence becomes a " +
      "diagram; " +
      MENTIONS +
      "). `properties` writes values by name (others kept; `null` clears one; a person property takes People " +
      "ids or addresses from `list_people`, a person or a group, and is replaced, not appended to). `define` adds " +
      "properties (or replaces them by name), `traits` gives it a trait's properties so it has the trait, `schema` " +
      "replaces every definition (a removed one's value goes too), `renames` ({old: new}) renames with values. On a " +
      "trait these change every page having it: `drop` takes properties off it (off its pages too with " +
      "`drop_from_pages`), a type change carries each value across. Which traits a page has follows from its " +
      "properties. On a view, `view` changes its query. `archived: true` archives a page (out of the tree, views and " +
      "`find_pages`, still read by id), `false` restores it.",
    inputSchema: {
      id: fields.id,
      title: fields.title.optional(),
      icon: fields.icon.optional(),
      body: z.string().optional().describe("Markdown"),
      properties: fields.properties.optional().describe(PROPERTIES),
      define: fields.schema.optional().describe(DEFINE),
      traits: fields.traits.optional(),
      schema: fields.schema.optional().describe(DEFINE),
      renames: fields.renames.optional(),
      drop: z.array(z.string()).optional(),
      drop_from_pages: z.boolean().optional(),
      view: viewInput.optional().describe(VIEW),
      archived: z.boolean().optional(),
      client: fields.client.optional().describe(CLIENT),
    },
    readOnly: false,
    run: async (
      {
        id,
        body,
        define,
        traits,
        schema,
        renames,
        drop,
        drop_from_pages,
        view,
        properties,
        archived,
        client: _,
        ...input
      },
      caller,
    ) => {
      const page = await authorizePage(caller, id, "write");
      // Archiving alone is no edit: the page's last update stays what it was.
      const editing = [body, define, traits, schema, renames, drop, view, properties, input.title, input.icon].some(
        (v) => v !== undefined,
      );
      if (archived !== undefined && !editing) {
        const row = await setArchived(caller, id, archived);
        return { ...summary(row), archivedAt: row.archivedAt };
      }
      const workspaceId = page.workspaceId ?? page.id;
      if (page.kind === "trait") {
        if (define || schema || renames || drop)
          await updateTrait(caller, id, {
            properties: define ? mergeSchema(schema ?? page.schema, define) : schema,
            renames,
            drop,
            dropFromPages: drop_from_pages,
          });
        return summary(await updatePage(caller, id, { ...input, body: markdownBody(body) }));
      }
      const known = mergeSchema(
        mergeSchema(schema ?? page.schema, define ?? []),
        await traitSchema(workspaceId, traits),
      );
      const config = page.kind === "view" ? await viewConfig(workspaceId, view) : undefined;
      const updated = await updatePage(caller, id, {
        ...input,
        body: markdownBody(body),
        schema,
        renames,
        traits,
        addProperties: define,
        properties: await withAssignees(known, properties),
        view: config,
      });
      const row = archived === undefined ? updated : await setArchived(caller, id, archived);
      const cleaned = await cleanupSaved(id, config?.cleanup);
      return {
        ...summary(updated),
        ...(row.archivedAt && { archivedAt: row.archivedAt }),
        ...(cleaned && { cleanup: { archived: cleaned.archived, pages: cleaned.pages.slice(0, 100) } }),
      };
    },
  }),
  tool({
    name: "list_workspace_traits",
    title: "List workspace traits",
    description:
      "Every trait of a workspace, wherever it sits in the tree: named sets of properties (like TypeScript " +
      "interfaces). A page has a trait when it has all of its properties (same name, same type); a page may have " +
      "several. `path` tells two of one name apart; `pages` counts the pages having each. Make or change one with " +
      "`create_page` / `edit_page`.",
    inputSchema: { workspace_id: fields.id },
    run: ({ workspace_id }, caller) => listTraits(caller, workspace_id),
  }),
  tool({
    name: "list_workspace_views",
    title: "List workspace views",
    description:
      "Every view of a workspace, or only the ones right under `page_id`: saved queries (the pages having all of " +
      "`traits`, filtered, sorted and grouped, as a table, board, list or timeline). `read_page` on one gives the " +
      "pages it shows.",
    inputSchema: { workspace_id: fields.id, page_id: fields.id.optional() },
    run: async ({ workspace_id, page_id }, caller) =>
      listViews(caller, workspace_id, page_id ? await authorizePage(caller, page_id, "read") : undefined),
  }),
  tool({
    name: "list_people",
    title: "List people",
    description:
      "Who can be assigned: people from People, assistants like Pai among them (id = People person id, `url` = " +
      "their People address, to mention them by; the workspace's members first, with their role) matching `query` if given. Assign by " +
      "writing them to a person property with `edit_page`.",
    inputSchema: { workspace_id: fields.id, query: z.string().max(200).optional() },
    run: async ({ workspace_id, query }, caller) => listAssignable(caller, workspace_id, query),
  }),
  tool({
    name: "list_extensions",
    title: "List extensions",
    description:
      "The apps plugged into a workspace, each with its manifest: property types (an `extension` property's " +
      "definition names `extension` = this id and `extType` = a type id) and the actions buttons can call.",
    inputSchema: { workspace_id: fields.id },
    run: ({ workspace_id }, caller) => listExtensions(caller, workspace_id),
  }),
  tool({
    name: "share_page",
    title: "Share page",
    description:
      "Who a page is shared with, and sharing it. With only `page_id`: its shares (`inherited` ones come from a page " +
      "above, `pending` people have not signed in yet). With `person` (a People id or address from `list_people`) or " +
      "`email` (found in People or added there): shares the page and everything under it as `role` (view, comment, " +
      "edit, full; default view), or changes the role they have on it; `revoke` takes their share on this page back. " +
      "Sharing needs full access to the page.",
    inputSchema: {
      page_id: fields.id,
      person: z.string().min(1).max(200).optional(),
      email: fields.email.optional(),
      role: z.enum(SHARE_ROLES).optional(),
      revoke: z.boolean().optional(),
    },
    readOnly: false,
    run: async ({ page_id, person, email, role, revoke }, caller) => {
      if (!person && !email) return listShares(caller, page_id);
      if (person && email) throw new ApiError("Give `person` or `email`, not both");
      const invitee = person ? { person } : { email: email as string };
      if (!revoke) return sharePage(caller, page_id, invitee, role ?? "view");
      const account = await resolveInvitee(invitee);
      const { shares } = await listShares(caller, page_id);
      const share = shares.find((s) => !s.inherited && s.person.id === account.id);
      if (!share) throw new ApiError("They have no share on this page itself");
      return revokeShare(caller, page_id, share.id);
    },
  }),
  tool({
    name: "comment",
    title: "Comment",
    description:
      "Comments on a page. `add` one (`page_id`, `body`; `reply_to` a comment id of that page to answer it, which " +
      "quotes it and tells its author), `edit` or `delete` your own (`comment_id`, and `body` to edit), `react` to a " +
      "comment with an emoji (`comment_id`, `emoji`; `remove: true` takes yours off). Bodies are text: " +
      MENTIONS +
      " Comments are read with `read_page`.",
    inputSchema: {
      action: z.enum(["add", "edit", "delete", "react"]),
      page_id: fields.id.optional(),
      comment_id: fields.id.optional(),
      body: z.string().trim().min(1).max(10_000).optional(),
      reply_to: fields.id.optional(),
      emoji: z.string().min(1).max(REACTION_EMOJI_MAX).optional(),
      remove: z.boolean().optional(),
      client: fields.client.optional().describe(CLIENT),
    },
    readOnly: false,
    run: async ({ action, page_id, comment_id, body, reply_to, emoji, remove }, caller) => {
      switch (action) {
        case "add": {
          if (!page_id || !body) throw new ApiError("Give `page_id` and `body`");
          const id = randomUUID();
          await saveComment(caller, id, page_id, body, reply_to ?? null);
          return commentPayload(id);
        }
        case "edit":
          if (!comment_id || !body) throw new ApiError("Give `comment_id` and `body`");
          await updateComment(caller, comment_id, body);
          return commentPayload(comment_id);
        case "delete":
          if (!comment_id) throw new ApiError("Give `comment_id`");
          await deleteComment(caller, comment_id);
          return { id: comment_id, deleted: true };
        case "react": {
          if (!comment_id || !emoji) throw new ApiError("Give `comment_id` and `emoji`");
          if (remove) await removeReaction(caller, { commentId: comment_id, emoji });
          else await addReaction(caller, undefined, comment_id, emoji);
          return { commentId: comment_id, reactions: (await reactionsOf([comment_id])).get(comment_id) ?? [] };
        }
      }
    },
  }),
  tool({
    name: "watch",
    title: "Watch page",
    description:
      "Follows a page: you get a `watch` notification (through People, and in `inbox`) when its title, body, " +
      "properties or comments change, a page right under it is added or removed, or it is trashed or restored; not " +
      "for changes deeper in its subtree. Changes within about a minute are told as one, with `data.since` for " +
      "`read_page`. A watch is kept per client tag (`client`, else the `x-keep-client` header, else none): a write of " +
      "yours made with the same tag does not tell that watch, one made with another tag does. `unwatch` stops it; " +
      "`list` gives your watches (all tags, or `page_id`'s).",
    inputSchema: {
      action: z.enum(["watch", "unwatch", "list"]),
      page_id: fields.id.optional(),
      client: fields.client.optional().describe("The tag the watch is kept under; defaults to `x-keep-client`."),
    },
    readOnly: false,
    run: async ({ action, page_id }, caller) => {
      if (action === "list") return { watches: await myWatches(caller, { client: "any", pageId: page_id }) };
      if (!page_id) throw new ApiError("Give `page_id`");
      if (action === "unwatch") return unwatchPage(caller, page_id, caller.client);
      const watch = await watchPage(caller, page_id, caller.client);
      return { pageId: watch.pageId, url: pageUrl(watch.pageId), client: watch.client, watching: true };
    },
  }),
  tool({
    name: "inbox",
    title: "Inbox",
    description:
      "Your notifications, newest first: `list` (unread only unless `unread_only: false`; `page_id` narrows), each " +
      "as People delivers it (`type` mention, reply, watch, share or invite; `title`, `text`, `url`, `subject` (the " +
      "page), `actor`, a watch's `client`, `data` with `changes` and `since` for `read_page`) and whether it is " +
      "`read`. `read` marks `ids` read, or every unread one with `all: true`.",
    inputSchema: {
      action: z.enum(["list", "read"]),
      unread_only: z.boolean().optional(),
      page_id: fields.id.optional(),
      limit: z.number().int().min(1).max(200).optional(),
      ids: z.array(fields.id).max(200).optional(),
      all: z.boolean().optional(),
    },
    readOnly: false,
    run: async ({ action, unread_only, page_id, limit, ids, all }, caller) => {
      if (action === "list")
        return { notifications: await listInbox(caller, { unreadOnly: unread_only, pageId: page_id, limit }) };
      if (!all && !ids?.length) throw new ApiError("Give `ids`, or `all: true`");
      return markRead(caller, all ? "all" : (ids ?? []));
    },
  }),
  tool({
    name: "run_automation",
    title: "Run automation",
    description:
      "Runs an automation of a page, named by the page and its button `property`: its code runs as you. Returns " +
      "`ok`, the `messages` it showed, the URLs it would `open`, its console `logs`, and the `error` it threw (with its " +
      'line) when it failed. When it returns `ask` (a question with its `kind`: text, number, checkbox as "true"/' +
      '"false", date as YYYY-MM-DD, or one of `options`), run it again with `answers`: every answer so far, in order, as text.',
    inputSchema: {
      page_id: fields.id,
      property: z.string().min(1).max(200),
      answers: z.array(z.string().max(2000)).max(50).optional(),
      client: fields.client.optional().describe(CLIENT),
    },
    readOnly: false,
    run: ({ page_id, property, answers }, caller) => pressButton(caller, page_id, property, { answers }),
  }),
];
