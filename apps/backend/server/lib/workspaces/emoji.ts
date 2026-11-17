import { and, eq } from "drizzle-orm";
import { db } from "~/db";
import { customEmoji } from "~/db/schema";
import { EMOJI_IMAGE_MAX, EMOJI_IMAGE_TYPES, EMOJI_NAME, EMOJI_NAME_MAX } from "~/model/icons";
import { UUID } from "~/model/urn";
import { authorId, type Caller } from "../auth/caller";
import { ApiError, NotFoundError } from "../http/api-error";
import { authorizeWorkspace } from "../permissions";

const UNIQUE_VIOLATION = "23505";
const DATA_URL = /^data:([a-z+/]+);base64,[A-Za-z0-9+/]+=*$/;

/** Every custom emoji of the workspace, by name: anyone who can read it can use them. */
export async function listEmoji(caller: Caller, workspaceId: string) {
  await authorizeWorkspace(caller, workspaceId, "read", { visitor: true });
  return await db.query.customEmoji.findMany({
    where: eq(customEmoji.workspaceId, workspaceId),
    orderBy: customEmoji.name,
  });
}

/** Anyone who writes in the workspace adds one; its name is free there and its picture a small image. */
export async function addEmoji(caller: Caller, workspaceId: string, input: { name: string; image: string }) {
  await authorizeWorkspace(caller, workspaceId, "write");
  const name = input.name.trim().toLowerCase();
  if (name.length > EMOJI_NAME_MAX || !EMOJI_NAME.test(name))
    throw new ApiError("A name is letters and digits, its words joined by - or _");
  const type = DATA_URL.exec(input.image)?.[1];
  if (!type || !(EMOJI_IMAGE_TYPES as readonly string[]).includes(type))
    throw new ApiError("The picture must be a PNG, WebP, GIF, JPEG or SVG image");
  if (input.image.length > EMOJI_IMAGE_MAX) throw new ApiError("The picture is too large: keep it under 256 kB");
  try {
    const [added] = await db
      .insert(customEmoji)
      .values({ workspaceId, name, image: input.image, createdBy: authorId(caller) })
      .returning();
    return added;
  } catch (error) {
    const { code, cause } = error as { code?: string; cause?: { code?: string } };
    if ((code ?? cause?.code) === UNIQUE_VIOLATION)
      throw new ApiError(`There is an emoji named :${name}: already`, 409);
    throw error;
  }
}

/** A page that shows a removed emoji keeps its reference to it, and shows nothing there. */
export async function removeEmoji(caller: Caller, workspaceId: string, id: string) {
  await authorizeWorkspace(caller, workspaceId, "write");
  if (!UUID.test(id)) throw new NotFoundError("Emoji");
  const [removed] = await db
    .delete(customEmoji)
    .where(and(eq(customEmoji.id, id), eq(customEmoji.workspaceId, workspaceId)))
    .returning({ id: customEmoji.id });
  if (!removed) throw new NotFoundError("Emoji");
  return removed;
}
