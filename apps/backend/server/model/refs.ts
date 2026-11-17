import { UUID, urlOf, urnOfUrl } from "./urn";

/**
 * References in plain text: `[Label](<address>)`, a Markdown link to a record's https address
 * (`[Ann](https://people.example.com/p/<id>)`, `[Spec](https://keep.example.com/p/<id>)`); a legacy
 * URN target (`keep:page/<id>`) still reads. A ref carries the record's URN, its key inside. The label is what the text
 * said when the reference was made, so it reads without the app; the app shows the record's current name.
 */

export interface Ref {
  readonly urn: string;
  readonly label: string;
}

export type RefSegment =
  | { readonly text: string; readonly ref?: undefined }
  | { readonly text?: undefined; readonly ref: Ref };

const REF = /\[([^\]\n]*)\]\(([^)\s]+)\)/g;
const URN_TARGET = /^[a-z][a-z0-9-]*:[a-z][a-z0-9-]*\/[^)\s]+$/;

/** The URN a link's target stands for: a record's address, or a legacy URN; null for any other link. */
const urnOf = (target: string) => urnOfUrl(target) ?? (URN_TARGET.test(target) ? target : null);

/** Keep's and People's own URNs name a record by uuid; one that does not is text, not a broken reference. */
const OWN = /^(keep:page|people:person)\/(.*)$/;

const valid = (urn: string) => {
  const own = urn.match(OWN);
  return !own || UUID.test(own[2]);
};

const escapeLabel = (label: string) => label.replace(/[[\]\n]/g, " ").trim();

export const formatRef = ({ urn, label }: Ref) => `[${escapeLabel(label)}](${urlOf(urn)})`;

/** The text cut into plain runs and references, in order; adjacent plain text is one run. */
export function parseRefs(text: string): RefSegment[] {
  const out: RefSegment[] = [];
  let last = 0;
  const plain = (to: number) => {
    if (to <= last) return;
    const run = text.slice(last, to);
    const previous = out.at(-1);
    if (previous?.text !== undefined) out[out.length - 1] = { text: previous.text + run };
    else out.push({ text: run });
  };
  for (const match of text.matchAll(REF)) {
    const [whole, label = "", target = ""] = match;
    const urn = urnOf(target);
    if (!urn || !valid(urn)) continue;
    plain(match.index);
    out.push({ ref: { urn, label } });
    last = match.index + whole.length;
  }
  plain(text.length);
  return out;
}

/** Every reference the text makes, in order, repeats included. */
export const refsIn = (text: string): Ref[] => parseRefs(text).flatMap((s) => (s.ref ? [s.ref] : []));

/** The text as it reads, each reference by its label. */
export const refsPlainText = (text: string) =>
  parseRefs(text)
    .map((s) => s.text ?? s.ref.label)
    .join("");
