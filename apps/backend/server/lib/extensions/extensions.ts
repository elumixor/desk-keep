import { waitUntil } from "@elumixor/devkit/runtime";
import { and, eq } from "drizzle-orm";
import type { ZodType } from "zod";
import { z } from "zod";
import { db } from "~/db";
import { extensions } from "~/db/schema";
import { plainText } from "~/model/document";
import {
  type ActionAnswer,
  actionAnswerSchema,
  defaultFields,
  type ExtensionOption,
  extensionOptionSchema,
  type Manifest,
  manifestSchema,
} from "~/model/extensions";
import { findProperty, type PropertyDefinition, type Schema } from "~/model/properties";
import { pageUrn, personUrn } from "~/model/urn";
import type { Caller } from "../auth/caller";
import { ApiError, NotFoundError } from "../http/api-error";
import { updatePage } from "../pages/write";
import { authorizePage, authorizeWorkspace } from "../permissions";
import { open, seal } from "./secret";

export type Extension = typeof extensions.$inferSelect;

const TIMEOUT_MS = 8000;
const STALE_MS = 60 * 60 * 1000;
const BODY_TEXT_LIMIT = 8000;
const UPSTREAM = 502;

/** An extension that answered wrongly: its own words when it gave some, what went wrong otherwise. */
class ExtensionError extends ApiError {
  constructor(name: string, problem: string) {
    super(`${name}: ${problem}`, UPSTREAM);
    this.name = "ExtensionError";
  }
}

/** One call to an extension, with Keep's bearer for it, read as JSON and checked against what it should answer. */
async function call<T>(
  name: string,
  url: string,
  token: string,
  schema: ZodType<T>,
  init: { method?: "GET" | "POST"; body?: unknown } = {},
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: init.method ?? "GET",
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/json",
        ...(init.body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    throw new ExtensionError(
      name,
      error instanceof Error && error.name === "TimeoutError" ? "no answer in time" : "unreachable",
    );
  }
  const text = await response.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    throw new ExtensionError(name, `answered ${response.status} with something that is not JSON`);
  }
  if (!response.ok) {
    const said = body && typeof body === "object" && "error" in body ? String(body.error) : null;
    throw new ExtensionError(name, said ?? `answered ${response.status}`);
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new ExtensionError(name, `unexpected answer (${issue?.path.join(".") || "body"}: ${issue?.message})`);
  }
  return parsed.data;
}

const fetchManifest = (name: string, url: string, token: string) => call(name, url, token, manifestSchema);

/** What a reader sees of an extension: never its token. */
const visible = ({ token: _token, ...extension }: Extension) => extension;

async function find(workspaceId: string, extensionId: string) {
  const extension = await db.query.extensions.findFirst({
    where: and(eq(extensions.id, extensionId), eq(extensions.workspaceId, workspaceId)),
  });
  if (!extension) throw new NotFoundError("Extension");
  return extension;
}

async function refetch(extension: Extension) {
  const manifest = await fetchManifest(extension.name, extension.manifestUrl, open(extension.token));
  const [updated] = await db
    .update(extensions)
    .set({ manifest, fetchedAt: new Date() })
    .where(eq(extensions.id, extension.id))
    .returning();
  return updated;
}

/** A workspace's extensions with their cached manifests, for a caller already let in. */
export const workspaceExtensions = (workspaceId: string) =>
  db.query.extensions.findMany({ where: eq(extensions.workspaceId, workspaceId), orderBy: extensions.createdAt });

/** The workspace's extensions with their cached manifests; an hour-old manifest is fetched again behind the answer. */
export async function listExtensions(caller: Caller, workspaceId: string) {
  await authorizeWorkspace(caller, workspaceId, "read", { visitor: true });
  const rows = await workspaceExtensions(workspaceId);
  const stale = rows.filter((row) => Date.now() - row.fetchedAt.getTime() > STALE_MS);
  if (stale.length)
    waitUntil(
      Promise.allSettled(stale.map(refetch)).then((results) => {
        for (const result of results)
          if (result.status === "rejected") console.warn("[extensions] refresh failed:", result.reason);
      }),
    );
  return rows.map(visible);
}

/** Adds an app by its manifest URL and the token Keep is to send it. The manifest is fetched now, or nothing is added. */
export async function addExtension(
  caller: Caller,
  workspaceId: string,
  input: { manifestUrl: string; token: string; name?: string },
) {
  await authorizeWorkspace(caller, workspaceId, "admin");
  const manifest = await fetchManifest(input.name ?? "The extension", input.manifestUrl, input.token);
  const [created] = await db
    .insert(extensions)
    .values({
      workspaceId,
      name: input.name?.trim() || manifest.name,
      manifestUrl: input.manifestUrl,
      token: seal(input.token),
      manifest,
    })
    .returning();
  return visible(created);
}

export async function removeExtension(caller: Caller, workspaceId: string, extensionId: string) {
  await authorizeWorkspace(caller, workspaceId, "admin");
  const extension = await find(workspaceId, extensionId);
  await db.delete(extensions).where(eq(extensions.id, extension.id));
  return { id: extension.id };
}

export async function refreshExtension(caller: Caller, workspaceId: string, extensionId: string) {
  await authorizeWorkspace(caller, workspaceId, "write");
  return visible(await refetch(await find(workspaceId, extensionId)));
}

/**
 * What a property type of an extension offers to pick, asked of the app by Keep so the token never reaches a
 * browser.
 */
export async function extensionOptions(
  caller: Caller,
  workspaceId: string,
  extensionId: string,
  type: string,
  query: string,
): Promise<ExtensionOption[]> {
  await authorizeWorkspace(caller, workspaceId, "read", { visitor: true });
  const extension = await find(workspaceId, extensionId);
  const propertyType = (extension.manifest as Manifest).propertyTypes.find((t) => t.id === type);
  if (!propertyType) throw new NotFoundError("Property type");
  if (!propertyType.options) return [];
  const url = new URL(propertyType.options);
  url.searchParams.set("q", query);
  return call(extension.name, url.toString(), open(extension.token), z.array(extensionOptionSchema));
}

/** `set` names the page's properties by name (any case), or by the app's own property type (`project`). */
function propertyFor(schema: Schema, extensionId: string, key: string) {
  return (
    findProperty(schema, key) ??
    schema.find((p) => p.type === "extension" && p.extension === extensionId && p.extType === key)
  );
}

const SCALAR_TYPES = { string: "text", number: "number", boolean: "checkbox" } as const;

/**
 * A property for a key the page has none for, made one of its own: the extension's property type the key names (by
 * id or name), else a text, number or checkbox named after the key when the value is one. Anything else is skipped.
 */
function newProperty(extension: Extension, key: string, value: unknown, taken: Schema) {
  const type = (extension.manifest as Manifest).propertyTypes.find(
    (t) => t.id === key || t.name.toLowerCase() === key.toLowerCase(),
  );
  if (type) {
    const fields = defaultFields(type, undefined);
    return {
      name: findProperty(taken, type.name) ? `${type.name} (${extension.name})` : type.name,
      type: "extension",
      extension: extension.id,
      extType: type.id,
      ...(type.multiple && { multiple: true }),
      ...(fields && { fields }),
    } satisfies PropertyDefinition;
  }
  const scalar = SCALAR_TYPES[typeof value as keyof typeof SCALAR_TYPES];
  return scalar ? ({ name: key, type: scalar } satisfies PropertyDefinition) : undefined;
}

/** Which installed extension has an action: the one named, or the only one that has an action by that id. */
async function actionOf(workspaceId: string, extensionId: string | undefined, actionId: string) {
  const candidates = extensionId
    ? [await find(workspaceId, extensionId)]
    : await db.query.extensions.findMany({ where: eq(extensions.workspaceId, workspaceId) });
  const matches = candidates.flatMap((extension) =>
    (extension.manifest as Manifest).actions.filter((a) => a.id === actionId).map((action) => ({ extension, action })),
  );
  if (!matches.length) throw new NotFoundError("Action");
  if (matches.length > 1) throw new ApiError("Several extensions have that action; name the extension");
  return matches[0];
}

/**
 * Runs an extension's action on a page: the app is told the page and who asked, and
 * what it answers in `set` is written to the page.
 */
export async function runAction(
  caller: Caller,
  pageId: string,
  input: { extensionId?: string; action: string },
): Promise<ActionAnswer & { applied: string[]; created: string[]; skipped: string[] }> {
  const page = await authorizePage(caller, pageId, "write", { body: true });
  const workspaceId = page.workspaceId ?? page.id;
  const { extension, action } = await actionOf(workspaceId, input.extensionId, input.action);
  const user = { email: caller.person.email, name: caller.person.name, urn: personUrn(caller.person.peopleId) };
  const answer = await call(extension.name, action.endpoint, open(extension.token), actionAnswerSchema, {
    method: "POST",
    body: {
      action: action.id,
      workspace: workspaceId,
      page: {
        id: page.id,
        urn: pageUrn(page.id),
        title: page.title,
        properties: page.properties,
        /** Every property the page has (its traits' and its own); values are keyed by their names. */
        schema: page.schema,
        body_text: page.body ? plainText(page.body).slice(0, BODY_TEXT_LIMIT) : "",
      },
      user,
    },
  });
  // A key the page has no property for becomes a property of its own, so an action works on any page.
  const schema = [...page.schema];
  const properties: Record<string, unknown> = {};
  const created: PropertyDefinition[] = [];
  const skipped: string[] = [];
  for (const [key, value] of Object.entries(answer.set ?? {})) {
    const property = propertyFor(schema, extension.id, key) ?? newProperty(extension, key, value, schema);
    if (!property) {
      skipped.push(key);
      continue;
    }
    if (!schema.includes(property)) {
      schema.push(property);
      created.push(property);
    }
    properties[property.name] = value;
  }
  if (Object.keys(properties).length) await updatePage(caller, page.id, { properties, addProperties: created });
  return { ...answer, applied: Object.keys(properties), created: created.map((p) => p.name), skipped };
}
