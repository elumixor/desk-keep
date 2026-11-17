import variant from "@jitl/quickjs-singlefile-mjs-release-asyncify";
import { findProperty } from "~/model/properties";
import { prelude } from "~/model/script/prelude";
import { compile, runSandboxed, ScriptError } from "~/model/script/sandbox";
import type { Caller } from "../auth/caller";
import { workspaceExtensions } from "../extensions/extensions";
import { NotFoundError } from "../http/api-error";
import { authorizePage } from "../permissions";
import { ScriptHost, type ScriptOutput } from "./host";

/** A button's script is named this in what it throws. */
const FILENAME = "button.ts";

export type ButtonAnswer = ScriptOutput & { readonly ok: boolean; readonly error?: string };

/**
 * Presses a page's button: its script runs as whoever pressed it, with the workspace's extensions. `code` runs in its
 * place when given (the editor's Run, before it is saved); `answers` are what the presser answered its questions so
 * far. What it threw is answered, not raised, beside what it said and opened before, or the question it stopped at.
 */
export async function pressButton(
  caller: Caller,
  pageId: string,
  property: string,
  { code, answers }: { readonly code?: string; readonly answers?: readonly string[] } = {},
): Promise<ButtonAnswer> {
  const page = await authorizePage(caller, pageId, "write");
  const definition = findProperty(page.schema, property);
  if (code === undefined && definition?.type !== "button") throw new NotFoundError("Button");
  const extensions = await workspaceExtensions(page.workspaceId ?? page.id);
  const host = new ScriptHost(caller, page, answers);
  try {
    await runSandboxed(variant, prelude(extensions), compile(code ?? definition?.code ?? ""), FILENAME, host);
    return { ok: true, ...host.output };
  } catch (error) {
    if (!(error instanceof ScriptError)) throw error;
    // Stopped at a question: not a failure, the presser is asked.
    const output = host.output;
    return output.ask ? { ok: true, ...output } : { ok: false, error: error.message, ...output };
  }
}
