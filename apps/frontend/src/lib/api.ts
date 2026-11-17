import { NitroAPI } from "./api-client";
import { auth } from "./auth.svelte";

/** A refusal from the API, with the sentence it was written with. */
export class KeepApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "KeepApiError";
  }
}

/** A fetch with the session's token, which throws the API's refusal as a `KeepApiError`. */
export async function authenticatedFetch(input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) {
  const token = await auth.token();
  const headers = new Headers(init?.headers);
  if (token) headers.set("authorization", `Bearer ${token}`);
  const response = await fetch(input, { ...init, headers });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new KeepApiError(response.status, body?.error ?? `Request failed (${response.status})`);
  }
  return response;
}

export const api = new NitroAPI({ baseUrl: "", fetch: authenticatedFetch }).api;

export type { ViewRecord as View } from "$model/sync";
export type { Page, PageData } from "./stores/pages.svelte";
export type { ViewResult, ViewRow } from "./stores/view-rows.svelte";
export type Member = ReturnType<typeof api.workspaces>["members"]["$get"]["$response"][number];
export type SearchHit = ReturnType<typeof api.workspaces>["search"]["$get"]["$response"][number];
export type Version = ReturnType<typeof api.pages>["versions"]["$get"]["$response"][number];
export type VersionDetail = ReturnType<ReturnType<typeof api.pages>["versions"]>["$get"]["$response"];
