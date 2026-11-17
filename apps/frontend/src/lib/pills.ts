import { type BalanceBlock, balanceKind, pillKind, registerPillKind } from "@desk/core/pill";
import { getJson } from "./http";

/**
 * Records from other apps a page can name, registered with `@desk/core`'s pill. Keep's own pages and People's
 * persons keep their richer editor views (`PageMention`, `PersonMention`); every other URN a kind claims here is drawn
 * as the shared pill. A new kind is one more `registerPillKind`.
 */

// Balance calendar blocks: `https://balance.…/calendar?event=<id>`, keyed `balance:block/<id>`, read through Keep's backend (its Balance MCP key).
registerPillKind(
  balanceKind(async (id) => {
    const answer = await getJson<{ block?: BalanceBlock }>("/api/urn", { urn: `balance:block/${id}` });
    return answer.block ?? null;
  }),
);

/** Whether a URN is drawn as the shared pill rather than as a page. */
export const isPillUrn = (urn: string) => !urn.startsWith("keep:page/") && pillKind(urn) !== undefined;
