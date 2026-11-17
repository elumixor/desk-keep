import { DATE_NODE, dateNodeText } from "../../../backend/server/model/dates";
import type { DocNode } from "../../../backend/server/model/document";
import { EMOJI_NODE, emojiNodeText } from "../../../backend/server/model/icons";
import { favicon } from "../../../backend/server/model/link";
import { personIdOf, personUrl } from "../../../backend/server/model/urn";

export const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const SAFE_LINK = /^(https?:|mailto:|\/)/;

const MARKS: Readonly<Record<string, [string, string]>> = {
  bold: ["<strong>", "</strong>"],
  italic: ["<em>", "</em>"],
  strike: ["<s>", "</s>"],
  code: ["<code>", "</code>"],
  underline: ["<u>", "</u>"],
};

function text(node: DocNode): string {
  let html = escapeHtml(node.text ?? "");
  for (const mark of node.marks ?? []) {
    if (mark.type === "link" && typeof mark.attrs?.href === "string" && SAFE_LINK.test(mark.attrs.href)) {
      // As the editor draws it: the site's icon first.
      const icon = favicon(mark.attrs.href);
      const img = icon
        ? `<img class="favicon" src="${escapeHtml(icon)}" alt="" onload="if(this.naturalWidth<=16)this.remove()" onerror="this.remove()">`
        : "";
      html = `<a class="link" href="${escapeHtml(mark.attrs.href)}" target="_blank" rel="noopener">${img}${html}</a>`;
    }
    const tags = MARKS[mark.type];
    if (tags) html = `${tags[0]}${html}${tags[1]}`;
  }
  return html;
}

const TAGS: Readonly<Record<string, string>> = {
  paragraph: "p",
  bulletList: "ul",
  orderedList: "ol",
  listItem: "li",
  blockquote: "blockquote",
  details: "details",
  detailsSummary: "summary",
  detailsContent: "div",
  table: "table",
  tableRow: "tr",
  tableCell: "td",
  tableHeader: "th",
};

/** A page body as read-only HTML: every block the editor makes, nothing it does not. */
export function render(node: DocNode, href: (urn: string) => string): string {
  const inner = () => (node.content ?? []).map((child) => render(child, href)).join("");
  switch (node.type) {
    case "doc":
      return inner();
    case "text":
      return text(node);
    case "heading": {
      const level = Math.min(3, Math.max(1, Number(node.attrs?.level ?? 1)));
      return `<h${level}>${inner()}</h${level}>`;
    }
    case "taskList":
      return `<ul class="tasks">${inner()}</ul>`;
    case "taskItem":
      return `<li><input type="checkbox" disabled ${node.attrs?.checked ? "checked" : ""}> ${inner()}</li>`;
    case "codeBlock":
      // A diagram keeps its source until `<keep-page>` draws it (`drawDiagrams`).
      return node.attrs?.language === "mermaid"
        ? `<div class="diagram" data-diagram><pre><code>${inner()}</code></pre></div>`
        : `<pre><code>${inner()}</code></pre>`;
    case "horizontalRule":
      return "<hr>";
    case "hardBreak":
      return "<br>";
    case "image":
      return `<img src="${escapeHtml(String(node.attrs?.src ?? ""))}" alt="">`;
    case "mention":
      // A person opens in People.
      if (personIdOf(String(node.attrs?.id ?? "")))
        return `<a class="mention" href="${escapeHtml(personUrl(personIdOf(String(node.attrs?.id ?? "")) ?? ""))}" target="_blank" rel="noopener">${escapeHtml(String(node.attrs?.label ?? ""))}</a>`;
      return `<a class="mention" href="${escapeHtml(href(String(node.attrs?.id ?? "")))}">${escapeHtml(String(node.attrs?.label ?? ""))}</a>`;
    case EMOJI_NODE:
      return escapeHtml(emojiNodeText(node.attrs));
    case DATE_NODE:
      return escapeHtml(dateNodeText(node.attrs));
    case "pageEmbed":
      return `<keep-pill urn="${escapeHtml(String(node.attrs?.urn ?? ""))}"></keep-pill>`;
    default: {
      const tag = TAGS[node.type];
      return tag ? `<${tag}>${inner()}</${tag}>` : inner();
    }
  }
}
