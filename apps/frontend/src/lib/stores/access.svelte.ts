import { type Access, type Action, accessOf, may, nearestShare, type ShareRole } from "$model/access";
import { api } from "../api";
import { local } from "../sync/local.svelte";
import { notices } from "./notices.svelte";
import { pageBar } from "./page-bar.svelte";
import { peopleApi } from "./people-api.svelte";
import { storedJson, storeJson } from "./stored";
import { workspace } from "./workspace.svelte";

const SHARED = "keep.shared";
/** How often the shares are asked again while the tab is visible: a page shared with you shows up on its own. */
const REFRESH_MS = 60_000;

export type SharedPage = Awaited<ReturnType<typeof api.me.shared.$get>>[number];

/**
 * What the signed-in person may do to each page, worked out on the device as the server does (`$model/access`): their
 * role in its workspace, raised by the share nearest it up its ancestry. The shares come from `GET /api/me/shared`.
 */
class PageAccess {
  #shared = $state<SharedPage[]>(storedJson<SharedPage[]>(SHARED, []));
  #started = false;

  /** Every page shared with the person, member or not where it is. */
  readonly shared = $derived(this.#shared);
  /** The pages shared with the person in workspaces they are no member of: "Shared with me". */
  readonly sharedRoots = $derived(this.#shared.filter((s) => !s.member));
  readonly #byPage = $derived(new Map<string, ShareRole>(this.#shared.map((s) => [s.pageId, s.role])));
  /** The workspaces the person only visits, through shares. */
  readonly visited = $derived(new Set(this.sharedRoots.map((s) => s.workspaceId)));

  /** Asks for the shares now and keeps them fresh while the tab is visible. */
  start() {
    void this.load();
    if (this.#started) return;
    this.#started = true;
    setInterval(() => document.visibilityState === "visible" && void this.load(), REFRESH_MS);
    addEventListener("visibilitychange", () => document.visibilityState === "visible" && void this.load());
  }

  async load() {
    try {
      this.#shared = await api.me.shared.$get();
      storeJson(SHARED, this.#shared);
    } catch (error) {
      console.warn("[access] shares", error);
    }
  }

  /** Whether the person is a member of the workspace; optimistic while the list has not arrived. */
  member(workspaceId: string | null | undefined) {
    if (!workspaceId) return false;
    return workspace.list.some((w) => w.id === workspaceId) || !this.visited.has(workspaceId);
  }

  /** Whether the person writes in a workspace as a whole (a member or owner): traits, emoji, a new top-level page. */
  writesIn(workspaceId: string | null | undefined) {
    if (!workspaceId) return false;
    const listed = workspace.list.find((w) => w.id === workspaceId);
    return listed ? listed.role !== "guest" : !this.visited.has(workspaceId);
  }

  /** The person's access to a page on the device. */
  of(pageId: string): Access {
    const page = local.page(pageId);
    const workspaceId = page?.workspaceId ?? page?.id ?? pageId;
    const listed = workspace.list.find((w) => w.id === workspaceId);
    // Before the list arrives, a workspace nobody shared with them is taken as theirs: edits are refused anyway.
    const role = listed?.role ?? (this.visited.has(workspaceId) ? null : "member");
    const chain = page
      ? [
          page.id,
          ...local
            .ancestors(page)
            .map((a) => a.id)
            .reverse(),
        ]
      : [pageId];
    return accessOf(role, nearestShare(chain, this.#byPage));
  }

  can(pageId: string, action: Action) {
    return may(this.of(pageId), action);
  }

  /**
   * After somebody is mentioned on a page or set on its person property: a notice for each of them who cannot see the
   * page (they hear nothing of it), offering to share it with them. A hint, never a blocker: failures are only logged.
   */
  async warnIfHidden(pageId: string, peopleIds: readonly string[], kind: "mention" | "assign") {
    const ids = [...new Set(peopleIds)];
    if (!ids.length) return;
    try {
      const { hidden } = await api.pages(pageId).access.$post({ people: ids });
      for (const id of hidden) {
        const name = peopleApi.person(id)?.name ?? "They";
        const role: ShareRole = kind === "assign" ? "edit" : "comment";
        notices.show(`${name} can't see this page`, {
          // Only the open page's share dialog can take it; a row's page elsewhere is shared from that page.
          action:
            this.can(pageId, "share") && pageBar.sharing === pageId
              ? {
                  label: "Share",
                  run: () => {
                    if (pageBar.sharing === pageId) pageBar.share = { pageId, person: { id, name }, role };
                  },
                }
              : undefined,
        });
      }
    } catch (error) {
      console.warn("[access] who can see", error);
    }
  }
}

export const access = new PageAccess();
