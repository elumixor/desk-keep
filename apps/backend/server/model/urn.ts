/**
 * Names for things in Keep and in the services around it, so a link can point outside Keep without Keep knowing
 * what is there. A link is an address: a page `https://keep.example.com/p/<id>`, a person
 * `https://people.example.com/p/<id>`, a group `…/g/<id>`, a pai thread `https://pai.example.com/#/thread/<id>`,
 * a Balance calendar block `https://balance.example.com/calendar?event=<id>` (its Google event id).
 * Inside, records are keyed by URN (`keep:page/<id>`, `keep:comment/<id>`, `people:person/<id>`, `balance:block/<id>`,
 * `git:<repo>#<n>`); the parsers take an address or a legacy URN alike.
 */

/** A uuid, as ids are. */
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const URN = /^([a-z][a-z0-9-]*):(.+)$/;
const ID = "([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})";
const KEEP_PAGE = new RegExp(`^keep:page/${ID}$`, "i");
const PEOPLE_PERSON = new RegExp(`^people:person/${ID}$`, "i");
const PEOPLE_GROUP = new RegExp(`^people:group/${ID}$`, "i");
const PAI_THREAD = /^pai:thread\/([\w-]+)$/;
/** A Keep address: `/p/<id>`, `/w/<workspace>/p/<id>` or a workspace's own `/w/<id>`. */
const KEEP_URL = new RegExp(`^https?://keep\\.[^/]+/(?:w/[^/]+/p/${ID}|p/${ID}|w/${ID})/?(?:[?#].*)?$`, "i");
const PEOPLE_URL = new RegExp(`^https?://people\\.[^/]+/(p|g)/${ID}/?(?:[?#].*)?$`, "i");
const PAI_URL = /^https?:\/\/pai\.[^/]+\/#\/thread\/([\w-]+)$/i;
const BALANCE_BLOCK = /^balance:block\/([\w-]+)$/;
/** A Balance block's address: `/calendar?event=<id>`, perhaps with `&at=<instant>`. */
const BALANCE_URL = /^https?:\/\/balance\.[^/]+\/calendar\/?\?(?:[^#]*&)?event=([\w-]+)(?:[&#].*)?$/i;

export const KEEP_ORIGIN = "https://keep.example.com";
export const PEOPLE_ORIGIN = "https://people.example.com";
export const PAI_ORIGIN = "https://pai.example.com";
export const BALANCE_ORIGIN = "https://balance.example.com";

export class InvalidUrnError extends Error {
  constructor(readonly urn: string) {
    super(`Not a URN: ${urn}`);
    this.name = "InvalidUrnError";
  }
}

interface Urn {
  readonly scheme: string;
  readonly rest: string;
}

export function parseUrn(urn: string): Urn {
  const match = urn.match(URN);
  if (!match) throw new InvalidUrnError(urn);
  return { scheme: match[1], rest: match[2] };
}

export function isUrn(value: string) {
  return URN.test(value);
}

export const pageUrn = (id: string) => `keep:page/${id}`;
export const pageUrl = (id: string) => `${KEEP_ORIGIN}/p/${id}`;

/** The page id a page's address (or `keep:page/<id>`) names, or null for anything else. */
export function pageIdOf(target: string): string | null {
  const url = target.match(KEEP_URL);
  if (url) return (url[1] ?? url[2] ?? url[3]).toLowerCase();
  return target.match(KEEP_PAGE)?.[1] ?? null;
}

export const personUrn = (id: string) => `people:person/${id}`;
export const personUrl = (id: string) => `${PEOPLE_ORIGIN}/p/${id}`;

/** The People person id a person's address (or `people:person/<id>`) names, or null for anything else. */
export function personIdOf(target: string): string | null {
  const url = target.match(PEOPLE_URL);
  if (url) return url[1] === "p" ? url[2].toLowerCase() : null;
  return target.match(PEOPLE_PERSON)?.[1] ?? null;
}

export const groupUrn = (id: string) => `people:group/${id}`;
export const groupUrl = (id: string) => `${PEOPLE_ORIGIN}/g/${id}`;

/** The People group id a group's address (or `people:group/<id>`) names, or null for anything else. */
export function groupIdOf(target: string): string | null {
  const url = target.match(PEOPLE_URL);
  if (url) return url[1] === "g" ? url[2].toLowerCase() : null;
  return target.match(PEOPLE_GROUP)?.[1] ?? null;
}

export const threadUrl = (id: string) => `${PAI_ORIGIN}/#/thread/${id}`;

export const blockUrn = (id: string) => `balance:block/${id}`;
export const blockUrl = (id: string) => `${BALANCE_ORIGIN}/calendar?event=${id}`;

/** The Google event id a Balance block's address (or `balance:block/<id>`) names, or null for anything else. */
export function blockIdOf(target: string): string | null {
  return target.match(BALANCE_URL)?.[1] ?? target.match(BALANCE_BLOCK)?.[1] ?? null;
}

export const commentUrn = (id: string) => `keep:comment/${id}`;

const KEEP_COMMENT = /^keep:comment\/([0-9a-f-]{36})$/;

/** The comment id a `keep:comment/<id>` names, or null for any other URN. */
export function commentIdOf(urn: string): string | null {
  return urn.match(KEEP_COMMENT)?.[1] ?? null;
}

/** The address a link to a URN writes: Keep's, People's, pai's and Balance's records by their https address; others as they are. */
export function urlOf(urn: string): string {
  const page = urn.match(KEEP_PAGE)?.[1];
  if (page) return pageUrl(page);
  const person = urn.match(PEOPLE_PERSON)?.[1];
  if (person) return personUrl(person);
  const group = urn.match(PEOPLE_GROUP)?.[1];
  if (group) return groupUrl(group);
  const thread = urn.match(PAI_THREAD)?.[1];
  if (thread) return threadUrl(thread);
  const block = urn.match(BALANCE_BLOCK)?.[1];
  if (block) return blockUrl(block);
  return urn;
}

/** The URN an address of a record Keep knows stands for (a page, a person, a group, a pai thread, a Balance block); null otherwise. */
export function urnOfUrl(target: string): string | null {
  const page = target.match(KEEP_URL);
  if (page) return pageUrn((page[1] ?? page[2] ?? page[3]).toLowerCase());
  const people = target.match(PEOPLE_URL);
  if (people) return people[1] === "p" ? personUrn(people[2].toLowerCase()) : groupUrn(people[2].toLowerCase());
  const thread = target.match(PAI_URL)?.[1];
  if (thread) return `pai:thread/${thread}`;
  const block = target.match(BALANCE_URL)?.[1];
  return block ? blockUrn(block) : null;
}
