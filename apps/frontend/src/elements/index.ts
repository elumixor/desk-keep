import type { DocNode } from "../../../backend/server/model/document";
import { iconText } from "../../../backend/server/model/icons";
import { pageIdOf } from "../../../backend/server/model/urn";
import { type MermaidLoader, renderMermaid } from "../lib/mermaid";
import { escapeHtml, render } from "./render";

/**
 * `<keep-pill urn="https://keep.example.com/p/…">` (or a legacy `keep:page/…`) and `<keep-page id="…">` for pages on other origins (pai, Balance). They read
 * Keep's API with the visitor's own Keep session cookie, so a page that embeds them needs no key of its own.
 */
const ORIGIN = new URL((document.currentScript as HTMLScriptElement).src).origin;
/** Mermaid for diagrams, fetched only when a page has one; from a CDN, as this script is one file on other origins. */
const MERMAID_URL = "https://cdn.jsdelivr.net/npm/mermaid@12.1.0/dist/mermaid.esm.min.mjs";
const cdnMermaid: MermaidLoader = () => import(/* @vite-ignore */ MERMAID_URL).then((m) => m.default);
const pageLink = (id: string) => `${ORIGIN}/embed/page/${id}`;
const hrefOf = (urn: string) => {
  const id = pageIdOf(urn);
  // Other schemes (`balance:`, `git:`) have no address Keep knows, and must never become a `javascript:` link.
  return id ? pageLink(id) : "#";
};

class KeepFetchError extends Error {
  constructor(readonly status: number) {
    super(
      status === 401 ? "Sign in to Keep to see this" : status === 404 ? "Not found in Keep" : `Keep answered ${status}`,
    );
    this.name = "KeepFetchError";
  }
}

async function get<T>(path: string): Promise<T> {
  const response = await fetch(`${ORIGIN}${path}`, { credentials: "include" });
  if (!response.ok) throw new KeepFetchError(response.status);
  return (await response.json()) as T;
}

const STYLE = `
  :host { font: 14px/1.5 "Inter", -apple-system, BlinkMacSystemFont, system-ui, sans-serif; color: inherit; }
  a { color: inherit; }
  a.link, a.mention { font-weight: 500; text-decoration-color: color-mix(in srgb, currentColor 25%, transparent); text-underline-offset: 3px; border-radius: 4px; }
  a.link:hover, a.mention:hover { background: color-mix(in srgb, currentColor 6%, transparent); }
  a.link .favicon { width: 1em; height: 1em; margin-right: .3em; vertical-align: -.125em; border-radius: 2px; }
  :host(keep-pill) { display: inline-flex; max-width: 100%; min-width: 0; vertical-align: bottom; }
  .pill { display: inline-flex; align-items: center; gap: .4em; max-width: 100%; min-width: 0; box-sizing: border-box; padding: .05em .6em .05em .45em; border-radius: 999px; background: color-mix(in srgb, currentColor 7%, transparent); text-decoration: none; white-space: nowrap; }
  .pill:hover { background: color-mix(in srgb, currentColor 12%, transparent); }
  .pill-title { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
  .mark { position: relative; flex: none; display: inline-grid; place-items: center; width: 1.15em; height: 1.15em; }
  .mark img { width: 1.1em; height: 1.1em; }
  .arrow { position: absolute; right: -.2em; bottom: -.15em; width: .7em; height: .7em; display: grid; }
  .arrow svg { grid-area: 1 / 1; width: 100%; height: 100%; fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; }
  .arrow .halo { stroke: var(--keep-pill-halo, var(--page, Canvas)); stroke-width: 9; }
  .arrow svg:not(.halo) { stroke-width: 4; }
  .status { flex: none; width: .9em; height: .9em; }
  .muted { opacity: .6; }
  h1, h2, h3 { line-height: 1.25; margin: 1em 0 .4em; }
  .title { font-size: 1.6em; font-weight: 700; margin: 0 0 .5em; }
  blockquote { border-left: 3px solid currentColor; margin: 0; padding-left: .9em; opacity: .8; }
  .diagram { display: flex; justify-content: center; overflow-x: auto; }
  .diagram svg { max-width: 100%; height: auto; }
  pre { padding: .8em 1em; border-radius: 6px; overflow-x: auto; background: color-mix(in srgb, currentColor 6%, transparent); }
  ul.tasks { list-style: none; padding-left: .2em; }
  table { border-collapse: collapse; } td, th { border: 1px solid color-mix(in srgb, currentColor 20%, transparent); padding: .3em .6em; }
  img { max-width: 100%; }
`;

abstract class KeepElement extends HTMLElement {
  protected readonly root = this.attachShadow({ mode: "open" });

  connectedCallback() {
    void this.draw();
  }

  attributeChangedCallback() {
    if (this.isConnected) void this.draw();
  }

  protected show(html: string) {
    this.root.innerHTML = `<style>${STYLE}</style>${html}`;
  }

  protected abstract draw(): Promise<void>;

  protected async drawDiagrams() {
    await Promise.all([...this.root.querySelectorAll("[data-diagram]")].map(drawDiagram));
  }
}

interface Pill {
  readonly id: string;
  readonly title: string;
  readonly icon: string | null;
  readonly status: { name: string; color: string | null } | null;
}

const ARROW = `<path d="M7 17 17 7M7 7h10v10"/>`;
/** Keep's link icon, as its editor draws a page named in text: Keep's mark with the link arrow in its corner. */
const MARK = `<span class="mark"><img src="${ORIGIN}/favicon.svg" alt=""><span class="arrow"><svg class="halo" viewBox="0 0 24 24">${ARROW}</svg><svg viewBox="0 0 24 24">${ARROW}</svg></span></span>`;

/** Each option colour as an ink strong enough for a small mark (Keep's own `--tag-*` are washes). */
const STATUS_INK: Readonly<Record<string, string>> = {
  gray: "#8b8b8b",
  blue: "#3b82f6",
  green: "#2f9e5b",
  yellow: "#d4a106",
  orange: "#ea7a1a",
  red: "#e5484d",
  purple: "#8e4ec6",
  pink: "#d6409f",
  brown: "#a1714f",
};

/** A status as one small circle, read from its name: empty to do, half in progress, full done, struck cancelled. */
function statusIcon(status: { name: string; color: string | null }) {
  const name = status.name.toLowerCase();
  const fill = /done|complete|finish|closed|shipped|merged/.test(name)
    ? `<circle cx="8" cy="8" r="3.5" fill="currentColor"/>`
    : /cancel|drop|won.?t|abandon/.test(name)
      ? `<path d="M5 11 11 5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>`
      : /doing|progress|review|active|started|wip|testing|block/.test(name)
        ? `<path d="M8 4.5a3.5 3.5 0 0 1 0 7z" fill="currentColor"/>`
        : "";
  const ink = STATUS_INK[status.color ?? ""] ?? STATUS_INK.gray;
  const label = escapeHtml(status.name);
  return `<svg class="status" viewBox="0 0 16 16" style="color: ${ink}" role="img" aria-label="${label}"><title>${label}</title><circle cx="8" cy="8" r="6.25" fill="none" stroke="currentColor" stroke-width="1.5"/>${fill}</svg>`;
}

class KeepPill extends KeepElement {
  static observedAttributes = ["urn"];

  protected async draw() {
    const urn = this.getAttribute("urn") ?? "";
    this.show(`<span class="pill muted">…</span>`);
    try {
      const pill = await get<Pill>(`/api/urn?urn=${encodeURIComponent(urn)}`);
      const title = escapeHtml(pill.title || "Untitled");
      const status = pill.status ? statusIcon(pill.status) : "";
      this.show(
        `<a class="pill" part="pill" href="${escapeHtml(pageLink(pill.id))}" target="_blank" title="${title}">${MARK}<span class="pill-title">${title}</span>${status}</a>`,
      );
    } catch (error) {
      this.show(
        `<span class="pill muted" title="${escapeHtml(error instanceof Error ? error.message : "")}">${MARK}<span class="pill-title">${escapeHtml(urn)}</span></span>`,
      );
    }
  }
}

interface PageResponse {
  readonly page: { readonly title: string; readonly icon: string | null; readonly body: DocNode | null };
}

class KeepPage extends KeepElement {
  static observedAttributes = ["id"];

  protected async draw() {
    const id = this.getAttribute("id") ?? "";
    this.show(`<p class="muted">Loading…</p>`);
    try {
      const { page } = await get<PageResponse>(`/api/pages/${encodeURIComponent(id)}`);
      const body = page.body ? render(page.body, hrefOf) : "";
      this.show(
        `<article part="page"><p class="title">${escapeHtml(iconText(page.icon))} ${escapeHtml(page.title || "Untitled")}</p>${body}</article>`,
      );
      await this.drawDiagrams();
    } catch (error) {
      this.show(`<p class="muted">${escapeHtml(error instanceof Error ? error.message : String(error))}</p>`);
    }
  }
}

/** Each diagram's source is replaced by its drawing; one that does not parse keeps showing its source. */
async function drawDiagram(element: Element) {
  const code = element.textContent ?? "";
  try {
    element.innerHTML = await renderMermaid(code, cdnMermaid);
  } catch (error) {
    console.warn("[keep-page] diagram not drawn:", error);
  }
}

if (!customElements.get("keep-pill")) customElements.define("keep-pill", KeepPill);
if (!customElements.get("keep-page")) customElements.define("keep-page", KeepPage);
