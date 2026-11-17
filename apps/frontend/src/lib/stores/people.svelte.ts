import { api, type Member } from "../api";
import { notices } from "./notices.svelte";
import { peopleApi } from "./people-api.svelte";

/** Who belongs to the open workspace: its members (people in People), loaded once per workspace. */
class People {
  members = $state<Member[]>([]);
  #loadedFor: string | null = null;

  async load(workspaceId: string, force = false) {
    if (this.#loadedFor === workspaceId && !force) return;
    this.#loadedFor = workspaceId;
    try {
      this.members = await api.workspaces(workspaceId).members.$get();
    } catch (error) {
      notices.error(error);
    }
  }

  /** The members' People ids, for putting them first among people found in People. */
  get memberIds(): ReadonlySet<string> {
    return new Set(this.members.flatMap((m) => (m.peopleId ? [m.peopleId] : [])));
  }

  /** A People person's name, once People has answered. */
  name(id: string) {
    return peopleApi.person(id)?.name;
  }

  avatar(id: string) {
    return peopleApi.person(id)?.avatar ?? null;
  }
}

export const people = new People();
