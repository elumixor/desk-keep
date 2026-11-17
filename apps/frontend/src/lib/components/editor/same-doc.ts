/**
 * Whether two editor documents say the same thing. The server keeps a body as `jsonb`, which orders keys its own way,
 * so the copy that comes back from a save is equal to the one sent without being the same text.
 */
export function sameDoc(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((item, i) => sameDoc(item, b[i]));
  const x = a as Record<string, unknown>;
  const y = b as Record<string, unknown>;
  const keys = Object.keys(x).filter((key) => x[key] !== undefined);
  if (keys.length !== Object.keys(y).filter((key) => y[key] !== undefined).length) return false;
  return keys.every((key) => sameDoc(x[key], y[key]));
}
