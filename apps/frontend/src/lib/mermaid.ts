/**
 * Mermaid diagrams, drawn on demand: the library is only fetched when a page has a diagram on it. `load` says where
 * it comes from — the app bundles it as a lazy chunk (`editor/code-block.ts`), `<keep-page>` on another origin takes
 * it from a CDN. Nothing here imports it, so the elements script stays one file.
 */
type Mermaid = typeof import("mermaid")["default"];

export type MermaidLoader = () => Promise<Mermaid>;

let loading: Promise<Mermaid> | null = null;
let theme: string | null = null;
let next = 0;

const isDark = () =>
  document.documentElement.dataset.theme === "dark" ||
  (!document.documentElement.dataset.theme && matchMedia("(prefers-color-scheme: dark)").matches);

/** A diagram's source as SVG; a source Mermaid cannot read throws with its message. */
export async function renderMermaid(code: string, load: MermaidLoader): Promise<string> {
  loading ??= load();
  const mermaid = await loading;
  const wanted = isDark() ? "dark" : "default";
  if (theme !== wanted) {
    mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: wanted, fontFamily: "inherit" });
    theme = wanted;
  }
  const id = `keep-mermaid-${next++}`;
  try {
    const { svg } = await mermaid.render(id, code);
    return svg;
  } finally {
    // A failed render leaves its scratch element in the body.
    document.getElementById(`d${id}`)?.remove();
    document.getElementById(id)?.remove();
  }
}

export const MERMAID_LANGUAGE = "mermaid";
export const MERMAID_SAMPLE = "graph TD\n  A[Idea] --> B{Worth it?}\n  B -->|yes| C[Build it]\n  B -->|no| D[Drop it]";
