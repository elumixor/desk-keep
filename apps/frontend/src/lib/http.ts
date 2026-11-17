import { authenticatedFetch } from "./api";

/** A GET with a query string — the generated client has no place for one. */
export async function getJson<T>(
  path: string,
  query: Readonly<Record<string, string>>,
  signal?: AbortSignal,
): Promise<T> {
  const response = await authenticatedFetch(`${path}?${new URLSearchParams(query)}`, { signal });
  return (await response.json()) as T;
}
