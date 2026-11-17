import type { JSONContent } from "@tiptap/core";
import { peopleApi } from "$lib/stores/people-api.svelte";
import { workspace } from "$lib/stores/workspace.svelte";
import { local } from "$lib/sync/local.svelte";
import { pageIdOf, pageUrn, personIdOf, personUrn } from "$model/urn";

/** The page a web address opens (Keep's own, `https://keep…/p/<id>`, or this origin's), when it is known here; null otherwise. */
export function pageOfHref(href: string): string | null {
  const canonical = pageIdOf(href);
  if (canonical) return local.page(canonical) ? canonical : null;
  try {
    const url = new URL(href, window.location.origin);
    if (url.origin !== window.location.origin) return null;
    const [, w, kind, id] = url.pathname.match(/^\/w\/([^/]+)(?:\/(p)\/([^/]+))?\/?$/) ?? [];
    if (!w || w !== workspace.id) return null;
    const target = kind === "p" ? id : w;
    return local.page(target) ? target : null;
  } catch {
    return null;
  }
}

const mention = (id: string, label: string): JSONContent => {
  const page = local.page(id);
  return { type: "mention", attrs: { id: pageUrn(id), label: page?.title || label, icon: page?.icon ?? null } };
};

/** The People person a web address opens (`https://people…/p/<id>`, or People's configured origin), or null. */
function personOfHref(href: string): string | null {
  const canonical = personIdOf(href);
  if (canonical) return canonical;
  const [, id] = href.match(/^(?:.*)\/p\/([0-9a-f-]{36})\/?$/i) ?? [];
  return id && href.startsWith(peopleApi.url(id).slice(0, -id.length)) ? id : null;
}

const personMention = (person: string, label: string): JSONContent => ({
  type: "mention",
  attrs: { id: personUrn(person), label: peopleApi.person(person)?.name || label, icon: null },
});

/** A page's (or a person's) mention for a bare address pasted alone. */
export function mentionOfHref(href: string): JSONContent | null {
  const id = pageOfHref(href);
  if (id) return mention(id, "");
  const person = personOfHref(href);
  return person ? personMention(person, "") : null;
}

/** Parsed Markdown with its links to known pages and to people turned into mentions of them. */
export function mentionLinks(node: JSONContent): JSONContent {
  const link = node.marks?.find((m) => m.type === "link");
  const href = node.type === "text" && link ? String(link.attrs?.href ?? "") : "";
  const id = href ? pageOfHref(href) : null;
  if (id) return mention(id, node.text ?? "");
  const person = href ? personOfHref(href) : null;
  if (person) return personMention(person, node.text ?? "");
  return node.content ? { ...node, content: node.content.map(mentionLinks) } : node;
}
