/**
 * What JavaScript gets in a button's script and a formula alike: lists' `first`, `last` and `sum`, texts'
 * `capitalize`, `uppercase`… read as properties, and `keys` and `values` of an object. Empty is `null`, never `undefined`. The source is run before either;
 * the declarations are what their editors are given.
 */

export const LANGUAGE_SOURCE = `
Object.defineProperties(Array.prototype, {
  first: { get() { return this.length ? this[0] : null; } },
  last: { get() { return this.length ? this[this.length - 1] : null; } },
  sum: { get() { return this.reduce((total, item) => total + (typeof item === "number" ? item : 0), 0); } },
});
Object.defineProperties(String.prototype, {
  capitalize: { get() { return this.charAt(0).toUpperCase() + this.slice(1); } },
  uppercase: { get() { return this.toUpperCase(); } },
  lowercase: { get() { return this.toLowerCase(); } },
  titlecase: { get() { return this.replace(/(^|\\s)(\\S)/g, (_, space, letter) => space + letter.toUpperCase()); } },
  trimmed: { get() { return this.trim(); } },
  words: { get() { return this.split(/\\s+/).filter(Boolean); } },
});
globalThis.keys = (object) => Object.keys(object);
globalThis.values = (object) => Object.values(object);
`;

export const LANGUAGE_TYPES = `
interface String {
  /** Its first letter capitalized. */
  readonly capitalize: string;
  readonly uppercase: string;
  readonly lowercase: string;
  /** Each word's first letter capitalized. */
  readonly titlecase: string;
  /** Without spaces at either end. */
  readonly trimmed: string;
  /** Its words, split at spaces. */
  readonly words: string[];
}

interface Array<T> {
  /** Its first item; null when it is empty. */
  readonly first: T | null;
  /** Its last item; null when it is empty. */
  readonly last: T | null;
  /** Its numbers added up. */
  readonly sum: number;
}

/** An object's keys. */
declare function keys<T extends object>(object: T): (keyof T & string)[];
/** An object's values. */
declare function values<T extends object>(object: T): T[keyof T][];

interface DateValue { start: string; end?: string }
/** id is the People person id. */
interface Person { kind: "person"; id: string }
interface ExtensionValue { urn: string; label: string; icon?: string; fields?: Record<string, unknown> }
`;
