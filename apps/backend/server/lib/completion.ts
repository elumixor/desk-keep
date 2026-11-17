import { createGateway } from "@ai-sdk/gateway";
import { streamText } from "ai";
import { and, asc, eq, inArray, isNull, ne } from "drizzle-orm";
import { db } from "~/db";
import { links, pages } from "~/db/schema";
import {
  type CompletionContext,
  CURSOR,
  clean,
  excerpt,
  type RelatedPage,
  SYSTEM_PROMPT,
  userPrompt,
} from "~/model/completion";
import { pageIdOf } from "~/model/urn";
import { inScope, type Scope, scopeOf } from "./access";
import { accountId, type Caller } from "./auth/caller";
import { env } from "./env";
import { ApiError } from "./http/api-error";
import { ancestorsOf, sharedPart } from "./pages/read";
import { readableProperties } from "./pages/readable";
import { search } from "./pages/search";
import { authorizePage, type Page } from "./permissions";

/**
 * Through Vercel's AI Gateway, tagged so its report tells Keep's calls apart. Gemini Flash Lite writes a line in
 * under a second with the right spacing; the Claude models think first (Haiku spends the whole budget on it),
 * and the other cheap ones echo the bullet or ramble.
 */
const MODEL = env.COMPLETION_MODEL ?? "google/gemini-3.5-flash-lite";
/** How the gateway's report names Keep's calls: one tag per app, or a call is counted once per tag. */
const GATEWAY_TAG = "keep";
const MAX_TOKENS = 120;
/**
 * The page's surroundings, the right to write it and the search's answers are kept this long: typing changes the
 * page, not where it sits, who may write it or what it mentions, and every round trip saved is felt at the caret.
 */
const SURROUNDINGS_TTL_MS = 20_000;
const TIMEOUT_MS = 8000;
/** How much of a mentioned or found page the model reads. */
const MENTIONED_TEXT = 1500;
const FOUND_TEXT = 400;
const FOUND_PAGES = 5;
const NEIGHBOURS = 30;
/** The search for related pages asks about this much of what is being written. */
const QUERY_CHARS = 240;

const gateway = env.AI_GATEWAY_API_KEY ? createGateway({ apiKey: env.AI_GATEWAY_API_KEY }) : null;

class CompletionUnavailableError extends ApiError {
  constructor() {
    super("Completions are not set up on this server", 503);
    this.name = "CompletionUnavailableError";
  }
}

class CompletionFailedError extends ApiError {
  constructor(readonly cause: unknown) {
    super("The completion could not be written", 502);
    this.name = "CompletionFailedError";
  }
}

type Cache<T> = Map<string, { at: number; value: Promise<T> }>;

/** What `make` answers, remembered a while by key; a failure is forgotten at once. */
function remembered<T>(cache: Cache<T>, key: string, make: () => Promise<T>) {
  const held = cache.get(key);
  if (held && Date.now() - held.at < SURROUNDINGS_TTL_MS) return held.value;
  const value = make();
  value.catch(() => cache.delete(key));
  cache.set(key, { at: Date.now(), value });
  return value;
}

/** Titles of the pages next to the page and under it that the caller may read, in their order. */
async function neighbours(scope: Scope, page: { id: string; parentId: string | null }) {
  const titlesUnder = (parentId: string, except?: string) =>
    db
      .select({ title: pages.title })
      .from(pages)
      .where(
        and(
          eq(pages.parentId, parentId),
          isNull(pages.deletedAt),
          except ? ne(pages.id, except) : undefined,
          inScope(scope),
        ),
      )
      .orderBy(asc(pages.sort))
      .limit(NEIGHBOURS);
  const [siblings, children] = await Promise.all([
    page.parentId ? titlesUnder(page.parentId, page.id) : Promise.resolve([]),
    titlesUnder(page.id),
  ]);
  const titled = (rows: readonly { title: string }[]) => rows.map((r) => r.title).filter(Boolean);
  return { siblings: titled(siblings), children: titled(children) };
}

/** Where a page sits, as far up as the caller may see: the whole path for a member, from their share for a visitor. */
async function pathFor(scope: Scope, page: { id: string; workspaceId: string | null }) {
  const ancestors = await ancestorsOf(page.id);
  const shown = scope.workspaceIds.includes(page.workspaceId ?? page.id)
    ? ancestors
    : sharedPart(
        ancestors,
        scope.shareRoots.map((r) => r.pageId),
      );
  return shown.map((a) => a.title || "Untitled");
}

/** The pages the page mentions or embeds that the caller may read, with what they say. */
async function mentioned(
  scope: Scope,
  pageId: string,
): Promise<{ ids: readonly string[]; related: readonly RelatedPage[] }> {
  const rows = await db
    .selectDistinct({ toUrn: links.toUrn })
    .from(links)
    .where(and(eq(links.fromPage, pageId), inArray(links.kind, ["mention", "embed"])));
  const ids = rows.map((r) => pageIdOf(r.toUrn)).filter((id): id is string => id !== null && id !== pageId);
  if (!ids.length) return { ids, related: [] };
  const found = await db
    .select({ id: pages.id, workspaceId: pages.workspaceId, title: pages.title, text: pages.text })
    .from(pages)
    .where(and(inArray(pages.id, ids), isNull(pages.deletedAt), inScope(scope)));
  const paths = await Promise.all(found.map((p) => pathFor(scope, p)));
  const related = found.map((p, i) => ({
    title: p.title || "Untitled",
    path: paths[i],
    text: excerpt(p.text, MENTIONED_TEXT),
  }));
  return { ids, related };
}

/**
 * What the writer is on about: the title, the heading above the cursor and the last words before it, less the word
 * being typed, so the question (and its cached answer) changes once a word, not once a letter.
 */
function queryFor(document: string, title: string) {
  const before = document.slice(0, document.indexOf(CURSOR)).replace(/\S+$/, "");
  const heading =
    before
      .match(/^#{1,3} (.+)$/gm)
      ?.at(-1)
      ?.replace(/^#+ /, "") ?? "";
  return [title, heading, before.slice(-QUERY_CHARS)]
    .join(" ")
    .replace(/[^\p{L}\p{N} ]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

type Found = RelatedPage & { id: string };
const searches: Cache<readonly Found[]> = new Map();

/** `found`, remembered a while by caller, page and question: the next pause in the same sentence asks the same. */
const foundCached = (caller: Caller, workspaceId: string, query: string, pageId: string) =>
  remembered(searches, `${accountId(caller)}\n${pageId}\n${query}`, () => found(caller, workspaceId, query, pageId));

/** Pages the search finds for what is being written, other than the page itself. */
async function found(caller: Caller, workspaceId: string, query: string, pageId: string): Promise<Found[]> {
  if (!query) return [];
  const hits = (await search(caller, { workspaceId, query, limit: FOUND_PAGES + 1, by: "content" })).filter(
    (hit) => hit.id !== pageId,
  );
  const chosen = hits.slice(0, FOUND_PAGES);
  if (!chosen.length) return [];
  const texts = await db
    .select({ id: pages.id, text: pages.text })
    .from(pages)
    .where(
      inArray(
        pages.id,
        chosen.map((h) => h.id),
      ),
    );
  const textOf = new Map(texts.map((t) => [t.id, t.text]));
  return chosen.map(
    (hit): Found => ({
      id: hit.id,
      title: hit.title || "Untitled",
      path: hit.path,
      text: excerpt(textOf.get(hit.id) ?? hit.snippet ?? "", FOUND_TEXT),
    }),
  );
}

const authorized: Cache<Page> = new Map();

/** `authorizePage(…, "write")`, remembered a while per caller and page. */
const authorizedCached = (caller: Caller, pageId: string) =>
  remembered(authorized, `${accountId(caller)}\n${pageId}`, () => authorizePage(caller, pageId, "write"));

type Surroundings = Omit<CompletionContext, "related"> & { mentions: Awaited<ReturnType<typeof mentioned>> };

const surroundings: Cache<Surroundings> = new Map();

/** What does not change as the page is typed into, as the caller may see it, fetched once in a while. */
const surroundingsOf = (caller: Caller, page: Page): Promise<Surroundings> =>
  remembered(surroundings, `${accountId(caller)}\n${page.id}`, async () => {
    const scope = await scopeOf(accountId(caller));
    return Promise.all([pathFor(scope, page), neighbours(scope, page), mentioned(scope, page.id)]).then(
      ([path, around, mentions]): Surroundings => ({
        title: page.title,
        path,
        properties: readableProperties(page.schema, page.properties),
        ...around,
        mentions,
      }),
    );
  });

/** Every query at once: the database is a round trip away, and the model is still to come. */
async function contextOf(caller: Caller, page: Page, document: string): Promise<CompletionContext> {
  const [around, more] = await Promise.all([
    surroundingsOf(caller, page),
    foundCached(caller, page.workspaceId ?? page.id, queryFor(document, page.title), page.id),
  ]);
  const { mentions, ...rest } = around;
  return { ...rest, related: [...mentions.related, ...more.filter((m) => !mentions.ids.includes(m.id))] };
}

/**
 * The text to show at the cursor of the page's editor, as it is written: what the model writes at `CURSOR` in
 * `document`, knowing where the page sits, what its properties say, what is next to it and what it mentions or the
 * search finds for it. Each value is the whole text so far, cleaned; the last is final.
 */
export async function* complete(caller: Caller, pageId: string, document: string): AsyncGenerator<{ text: string }> {
  if (!document.includes(CURSOR)) throw new ApiError(`The document must mark the cursor with ${CURSOR}`);
  const page = await authorizedCached(caller, pageId);
  // After the access check, so a page the caller cannot see stays a 404 on a server without completions.
  if (!gateway) throw new CompletionUnavailableError();
  const context = await contextOf(caller, page, document);
  try {
    const result = streamText({
      model: gateway(MODEL),
      system: SYSTEM_PROMPT,
      prompt: userPrompt(document, context),
      maxOutputTokens: MAX_TOKENS,
      maxRetries: 0,
      abortSignal: AbortSignal.timeout(TIMEOUT_MS),
      providerOptions: {
        gateway: { tags: [GATEWAY_TAG], user: accountId(caller) },
        // No thinking before the answer: every token before it is latency.
        google: { thinkingConfig: { thinkingBudget: 0 } },
      },
    });
    let raw = "";
    let shown = "";
    for await (const delta of result.textStream) {
      raw += delta;
      const text = clean(raw, document);
      if (text && text !== shown) {
        shown = text;
        yield { text };
      }
    }
    const text = (await result.finishReason) === "stop" ? clean(raw, document) : "";
    if (text !== shown) yield { text };
  } catch (error) {
    console.error("[completion]", error);
    throw new CompletionFailedError(error);
  }
}
