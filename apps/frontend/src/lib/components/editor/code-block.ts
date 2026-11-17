import { proseCodeBlock } from "@desk/editor";
import { type MermaidLoader, renderMermaid } from "$lib/mermaid";

/** The app's own copy of Mermaid, split out of the main bundle and fetched with the first diagram. */
const bundledMermaid: MermaidLoader = () => import("mermaid").then((m) => m.default);

/** Code blocks, where one in `mermaid` is a diagram. */
export const KeepCodeBlock = proseCodeBlock({ renderDiagram: (source) => renderMermaid(source, bundledMermaid) });
