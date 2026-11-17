/**
 * What a node of the tree is: a page (with properties and their values), a trait (a named set of properties, whose
 * pages are the ones having them all) or a view (a saved query of pages). All three have a title, an icon and a body.
 */
/** The longest description a node has. */
export const DESCRIPTION_MAX = 1000;

export const NODE_KINDS = ["page", "trait", "view"] as const;
export type NodeKind = (typeof NODE_KINDS)[number];
