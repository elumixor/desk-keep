import { and, desc, eq, inArray, lt } from "drizzle-orm";
import { z } from "zod";
import { db } from "~/db";
import { pageVersions, people } from "~/db/schema";
import { emptyDoc } from "~/model/document";
import { diffSnapshots, snapshotOf } from "~/model/history";
import { isWritten } from "~/model/properties";
import { personUrn } from "~/model/urn";
import type { Caller } from "../auth/caller";
import { NotFoundError } from "../http/api-error";
import { authorizePage } from "../permissions";
import { updatePage } from "./write";

type Version = typeof pageVersions.$inferSelect;
type Authored = Pick<Version, "authorId">;

/** Who wrote each version, by name: authors are People ids, looked up once for the whole list among the accounts. */
export async function withAuthors<T extends Authored>(versions: readonly T[]) {
  const ids = [...new Set(versions.flatMap((v) => (v.authorId ? [v.authorId] : [])))];
  const accounts = ids.length
    ? await db
        .select({ peopleId: people.peopleId, name: people.name, avatar: people.avatar })
        .from(people)
        .where(inArray(people.peopleId, ids))
    : [];
  return versions.map(({ authorId: id, ...version }) => {
    const account = accounts.find((a) => a.peopleId === id);
    const author = id ? { id, urn: personUrn(id), name: account?.name ?? null, avatar: account?.avatar ?? null } : null;
    return { ...version, author };
  });
}

/** A page's versions, newest first: who made each, when, and what it changed. */
export async function listVersions(caller: Caller, pageId: string) {
  await authorizePage(caller, pageId, "read");
  const versions = await db
    .select({
      id: pageVersions.id,
      authorId: pageVersions.authorId,
      changes: pageVersions.changes,
      createdAt: pageVersions.createdAt,
      editedAt: pageVersions.editedAt,
    })
    .from(pageVersions)
    .where(eq(pageVersions.pageId, pageId))
    .orderBy(desc(pageVersions.createdAt));
  return withAuthors(versions);
}

async function findVersion(pageId: string, versionId: string) {
  if (!z.uuid().safeParse(versionId).success) throw new NotFoundError("Version");
  const version = await db.query.pageVersions.findFirst({
    where: and(eq(pageVersions.id, versionId), eq(pageVersions.pageId, pageId)),
  });
  if (!version) throw new NotFoundError("Version");
  return version;
}

/** A version as it was, the one before it, and what changed between them. */
export async function getVersion(caller: Caller, pageId: string, versionId: string) {
  await authorizePage(caller, pageId, "read");
  const version = await findVersion(pageId, versionId);
  const earlier = await db.query.pageVersions.findFirst({
    where: and(eq(pageVersions.pageId, pageId), lt(pageVersions.createdAt, version.createdAt)),
    orderBy: desc(pageVersions.createdAt),
  });
  const previous = earlier ? snapshotOf(earlier) : null;
  const [authored] = await withAuthors([version]);
  return { version: authored, previous, diff: diffSnapshots(previous, snapshotOf(version)) };
}

/** Makes the page what it was at a version. The restore is a version of its own, so it can be undone the same way. */
export async function restoreVersion(caller: Caller, pageId: string, versionId: string) {
  await authorizePage(caller, pageId, "write");
  const version = await findVersion(pageId, versionId);
  // A formula's result is computed and a button has none; a value the version did not have is cleared.
  const properties = Object.fromEntries(
    version.schema.filter(isWritten).map(({ name }) => [name, version.properties[name] ?? null]),
  );
  return updatePage(
    caller,
    pageId,
    { title: version.title, icon: version.icon, body: version.body ?? emptyDoc(), schema: version.schema, properties },
    version.createdAt,
  );
}
