import { CalendarDays } from "lucide-svelte";
import { access } from "$lib/stores/access.svelte";
import { people } from "$lib/stores/people.svelte";
import type { PeoplePerson } from "$lib/stores/people-api.svelte";
import { findPeople, memberPeople } from "$lib/stores/people-search.svelte";
import { workspace } from "$lib/stores/workspace.svelte";
import { dateLabel } from "$lib/time";
import { daysFor } from "$model/dates";
import type { MenuItem } from "./menu.svelte";
import type { PageItem } from "./page-search.svelte";

/** A person `@` offers: a People person, by id. */
export interface PersonItem extends MenuItem {
  readonly peopleId: string;
  readonly label: string;
  readonly avatar: { readonly name: string; readonly src: string | null };
}

/** A day `@` offers when what follows says one: `today`, `tomorrow`, `12.3.2025`. */
export interface DateItem extends MenuItem {
  readonly date: string;
  readonly label: string;
}

/** What `@` offers: people, pages and days, in one menu. */
export type MentionItem = PageItem | PersonItem | DateItem;

export const isPerson = (item: MentionItem): item is PersonItem => "peopleId" in item;
export const isDate = (item: MentionItem): item is DateItem => "date" in item;

export const DATES_GROUP = "Dates";

/** The days `query` says, as the menu's first rows. */
export const dateItems = (query: string): DateItem[] =>
  daysFor(query).map(({ date, word }) => ({
    date,
    label: dateLabel(date),
    hint: word ? date : undefined,
    icon: CalendarDays,
    group: DATES_GROUP,
  }));

const MEMBERS_SHOWN = 5;
export const PEOPLE_GROUP = "People";
const MORE_PEOPLE_GROUP = "More people";

const item = (person: PeoplePerson, group: string): PersonItem => ({
  peopleId: person.id,
  label: person.name,
  hint: person.emails[0],
  avatar: { name: person.name, src: person.avatar },
  group,
});

/** The open workspace's members `query` names (by name or email), from the device: at once and offline. */
export function peopleItems(query: string): PersonItem[] {
  const q = query.trim().toLowerCase();
  // Loaded once per workspace; a visitor (no member) has none to list.
  if (workspace.id && access.member(workspace.id)) void people.load(workspace.id);
  const members = memberPeople();
  if (!q) return members.slice(0, MEMBERS_SHOWN).map((p) => item(p, PEOPLE_GROUP));
  return members
    .filter((p) => p.name.toLowerCase().includes(q) || p.emails.some((e) => e.toLowerCase().includes(q)))
    .map((p) => item(p, PEOPLE_GROUP));
}

/** Anyone else People finds for `query`, without the ones already shown. */
export async function peopleByQuery(
  query: string,
  shown: ReadonlySet<string>,
  signal?: AbortSignal,
): Promise<PersonItem[]> {
  if (!query.trim()) return [];
  const found = await findPeople(query.trim());
  if (signal?.aborted) return [];
  return found.filter((p) => !shown.has(p.id)).map((p) => item(p, MORE_PEOPLE_GROUP));
}
