import { findProperty } from "~/model/properties";
import { blockIdOf, pageIdOf, parseUrn } from "~/model/urn";
import type { Caller } from "../auth/caller";
import { balanceBlock } from "../balance/blocks";
import { ApiError } from "../http/api-error";
import { authorizePage } from "../permissions";

const STATUS = "status";

/** What a pill shows for a URN or address: a Keep page (to whoever may read it), or a Balance block (read with Keep's key). */
export async function resolveUrn(caller: Caller, urn: string) {
  const blockId = blockIdOf(urn);
  if (blockId) {
    const block = await balanceBlock(blockId);
    if (!block) throw new ApiError(`Balance has no block ${blockId}`, 404);
    return { urn, id: block.id, title: block.title, icon: null, deleted: false, status: null, block };
  }
  const id = pageIdOf(urn);
  if (!id) throw new ApiError(`Keep does not know what ${parseUrn(urn).scheme}: points to`, 404);
  const page = await authorizePage(caller, id, "read");
  const statusProperty = findProperty(page.schema, STATUS);
  const option =
    statusProperty?.type === "select"
      ? statusProperty.options?.find((o) => o.id === page.properties[statusProperty.name])
      : undefined;
  return {
    urn,
    id: page.id,
    title: page.title,
    icon: page.icon,
    deleted: page.deletedAt !== null,
    status: option ? { name: option.name, color: option.color ?? null } : null,
    block: undefined,
  };
}
