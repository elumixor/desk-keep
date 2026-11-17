import type { SuggestionOptions } from "@tiptap/suggestion";
import { access } from "$lib/stores/access.svelte";
import { DATE_NODE } from "$model/dates";
import { pageUrn, personUrn } from "$model/urn";
import { dateItems, isDate, isPerson, type MentionItem, peopleByQuery, peopleItems } from "./mention-search";
import { menuRenderer } from "./menu.svelte";
import { pagesByContent, pagesByName } from "./page-search.svelte";

const quietly = <T>(found: Promise<T[]>) =>
  found.catch((error) => {
    console.warn("[mention] search", error);
    return [] as T[];
  });

/**
 * What `@` does wherever Keep's editor runs (a page's body and title, a comment): people (the workspace's members, then
 * anyone in People) and pages by name, then pages by what they say. Mentioning somebody who cannot see `pageId` says
 * so, offering to share it.
 */
export function mentionSuggestion(pageId: string): Omit<SuggestionOptions<MentionItem>, "editor"> {
  return {
    char: "@",
    // Titles and names have spaces; the menu goes once nothing matches, so prose after the trigger is left alone.
    allowSpaces: true,
    // Wherever a mention may go: the text and the title, not code.
    allow: ({ state, range }) => {
      const $from = state.doc.resolve(range.from);
      const type = state.schema.nodes.mention;
      return !!type && $from.parent.canReplaceWith($from.index(), $from.index(), type);
    },
    items: ({ query }) => [...dateItems(query), ...peopleItems(query), ...pagesByName(query)],
    command: ({ editor, range, props: item }) => {
      if (isDate(item)) {
        editor
          .chain()
          .focus()
          .insertContentAt(range, [
            { type: DATE_NODE, attrs: { date: item.date } },
            { type: "text", text: " " },
          ])
          .run();
        return;
      }
      const attrs = isPerson(item)
        ? { id: personUrn(item.peopleId), label: item.label, icon: null }
        : { id: pageUrn(item.id), label: item.label, icon: item.icon ?? null };
      editor
        .chain()
        .focus()
        .insertContentAt(range, [
          { type: "mention", attrs },
          { type: "text", text: " " },
        ])
        .run();
      if (isPerson(item)) void access.warnIfHidden(pageId, [item.peopleId], "mention");
    },
    render: () =>
      menuRenderer<MentionItem>({
        hideEmpty: true,
        more: async (query, shown, signal) => {
          const people = new Set(shown.flatMap((i) => (isPerson(i) ? [i.peopleId] : [])));
          const pages = new Set(shown.flatMap((i) => (isPerson(i) || isDate(i) ? [] : [i.id])));
          const [persons, found] = await Promise.all([
            quietly(peopleByQuery(query, people, signal)),
            quietly(pagesByContent(query, pages, signal)),
          ]);
          return [...persons, ...found];
        },
      }),
  };
}
