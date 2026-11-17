type Sibling = { readonly id: string; readonly sort: number };

/**
 * Where `count` pages go, in order, among siblings (sorted, without them): before `beforeId`, or after the last one
 * when null.
 */
export function sortsBefore(siblings: readonly Sibling[], beforeId: string | null, count: number): number[] {
  const index = beforeId ? siblings.findIndex((s) => s.id === beforeId) : -1;
  const steps = Array.from({ length: count }, (_, i) => i + 1);
  if (index === -1) return steps.map((i) => (siblings.at(-1)?.sort ?? 0) + i);
  if (index === 0) return steps.map((i) => siblings[0].sort - (count + 1 - i));
  const [low, high] = [siblings[index - 1].sort, siblings[index].sort];
  return steps.map((i) => low + ((high - low) * i) / (count + 1));
}

/** Where a page goes among its siblings (sorted, without it): before `beforeId`, or after the last one when null. */
export const sortBefore = (siblings: readonly Sibling[], beforeId: string | null) =>
  sortsBefore(siblings, beforeId, 1)[0];
