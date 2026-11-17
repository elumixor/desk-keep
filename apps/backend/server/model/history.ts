import { type ChangeObject, diffArrays, diffWordsWithSpace } from "diff";
import type { DocNode } from "./document";
import { toMarkdown } from "./markdown";
import {
  findProperty,
  type PropertyDefinition,
  type PropertyValue,
  type PropertyValues,
  type Schema,
} from "./properties";

/** What a version keeps of a page: everything a person writes on it. */
export interface Snapshot {
  readonly title: string;
  readonly icon: string | null;
  readonly body: DocNode | null;
  readonly properties: PropertyValues;
  readonly schema: Schema;
}

/** What a version changed, kept with it so a page's history reads without loading every version. */
export interface ChangeSummary {
  readonly created: boolean;
  readonly title: boolean;
  readonly icon: boolean;
  /** Lines of the body added and removed. */
  readonly added: number;
  readonly removed: number;
  /** Properties whose value or definition changed. */
  readonly properties: readonly string[];
  /** When the version this one brought back was made, for a restore. */
  readonly restoredFrom?: string;
}

export type Change = "added" | "removed" | "kept";

/** A run of text a diff keeps, adds or removes. */
export interface DiffPart {
  readonly text: string;
  readonly change: Change;
}

/** A line of the body; a line edited in place carries the words that changed in it. */
export interface DiffLine extends DiffPart {
  readonly words?: readonly DiffPart[];
}

/** Unchanged lines left out between the changes. */
export interface Skipped {
  readonly skipped: number;
}

interface PropertySide {
  readonly definition: PropertyDefinition;
  readonly value: PropertyValue | undefined;
}

/** A property as it was and as it became; a side is missing where the page did not have the property. */
export interface PropertyChange {
  readonly name: string;
  readonly before?: PropertySide;
  readonly after?: PropertySide;
}

interface SnapshotDiff {
  readonly title: readonly DiffPart[];
  readonly icon: { readonly before: string | null; readonly after: string | null } | null;
  readonly body: readonly (DiffLine | Skipped)[];
  readonly properties: readonly PropertyChange[];
}

/** Unchanged lines shown around each change. */
const CONTEXT_LINES = 2;

const EMPTY: Snapshot = { title: "", icon: null, body: null, properties: {}, schema: [] };

/** The part of a page, or of a stored version, that a version keeps. */
export const snapshotOf = ({ title, icon, body, properties, schema }: Snapshot): Snapshot => ({
  title,
  icon,
  body,
  properties,
  schema,
});

const changeOf = (part: Pick<ChangeObject<unknown>, "added" | "removed">): Change =>
  part.added ? "added" : part.removed ? "removed" : "kept";

function diffWords(before: string, after: string): DiffPart[] {
  return diffWordsWithSpace(before, after).map((part) => ({ text: part.value, change: changeOf(part) }));
}

/** The body as the lines a person reads: Markdown with marks, blank lines left out. */
const bodyLines = (body: DocNode | null) =>
  body
    ? toMarkdown(body, { marks: true, labels: true })
        .split("\n")
        .filter((line) => line.trim())
    : [];

/** Lines removed and then added in their place are paired, so a one-word edit shows as that word. */
function paired(removed: readonly string[], added: readonly string[]) {
  const words = removed.slice(0, added.length).map((line, i) => diffWords(line, added[i]));
  const side = (lines: readonly string[], change: Change, hidden: Change): DiffLine[] =>
    lines.map((text, i) => ({
      text,
      change,
      ...(words[i] && { words: words[i].filter((part) => part.change !== hidden) }),
    }));
  return { removed: side(removed, "removed", "added"), added: side(added, "added", "removed") };
}

function diffBody(before: DocNode | null, after: DocNode | null): DiffLine[] {
  const runs = diffArrays(bodyLines(before), bodyLines(after));
  return runs.flatMap((run, i): DiffLine[] => {
    const previous = runs[i - 1];
    const next = runs[i + 1];
    if (run.removed && next?.added) return paired(run.value, next.value).removed;
    if (run.added && previous?.removed) return paired(previous.value, run.value).added;
    return run.value.map((text) => ({ text, change: changeOf(run) }));
  });
}

/** Keeps the changed lines and `context` lines around each; the rest become counts of what was left out. */
export function collapse(lines: readonly DiffLine[], context = CONTEXT_LINES): (DiffLine | Skipped)[] {
  const changed = lines.flatMap((line, i) => (line.change === "kept" ? [] : [i]));
  const near = (i: number) => changed.some((at) => Math.abs(at - i) <= context);
  const out: (DiffLine | Skipped)[] = [];
  lines.forEach((line, i) => {
    const last = out.at(-1);
    if (near(i)) out.push(line);
    else if (last && "skipped" in last) out[out.length - 1] = { skipped: last.skipped + 1 };
    else out.push({ skipped: 1 });
  });
  return out;
}

function side(snapshot: Snapshot, name: string): PropertySide | undefined {
  const definition = findProperty(snapshot.schema, name);
  // A formula's result is computed, not written: only its definition belongs to a version.
  return (
    definition && {
      definition,
      value: definition.type === "formula" ? undefined : snapshot.properties[definition.name],
    }
  );
}

const sameSide = (a: PropertySide | undefined, b: PropertySide | undefined) =>
  !!a &&
  !!b &&
  a.definition.type === b.definition.type &&
  JSON.stringify(a.value ?? null) === JSON.stringify(b.value ?? null);

function diffProperties(before: Snapshot, after: Snapshot): PropertyChange[] {
  const gone = before.schema.filter((p) => !findProperty(after.schema, p.name));
  return [...after.schema, ...gone].flatMap(({ name }) => {
    const was = side(before, name);
    const is = side(after, name);
    return sameSide(was, is) ? [] : [{ name, ...(was && { before: was }), ...(is && { after: is }) }];
  });
}

/** What changed from `before` to `after`; with no `before` the page was created, and all of it is new. */
export function summarize(before: Snapshot | null, after: Snapshot): ChangeSummary {
  const base = before ?? EMPTY;
  const lines = diffBody(base.body, after.body);
  return {
    created: !before,
    title: base.title !== after.title,
    icon: base.icon !== after.icon,
    added: lines.filter((line) => line.change === "added").length,
    removed: lines.filter((line) => line.change === "removed").length,
    properties: diffProperties(base, after).map((change) => change.name),
  };
}

export const changedNothing = (summary: ChangeSummary) =>
  !summary.created &&
  !summary.title &&
  !summary.icon &&
  !summary.added &&
  !summary.removed &&
  !summary.properties.length;

/**
 * Everything a person needs to see what a version did: `context` lines of the body are kept around each change, or
 * every line with `null`.
 */
export function diffSnapshots(
  before: Snapshot | null,
  after: Snapshot,
  context: number | null = CONTEXT_LINES,
): SnapshotDiff {
  const base = before ?? EMPTY;
  const body = diffBody(base.body, after.body);
  return {
    title: diffWords(base.title, after.title),
    icon: base.icon === after.icon ? null : { before: base.icon, after: after.icon },
    body: context === null ? body : collapse(body, context),
    properties: diffProperties(base, after),
  };
}
