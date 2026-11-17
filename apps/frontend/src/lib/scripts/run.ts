import variant from "@jitl/quickjs-singlefile-browser-release-asyncify";
import { prelude } from "$model/script/prelude";
import { compile, runSandboxed, ScriptError } from "$model/script/sandbox";
import type { ScriptExtension } from "$model/script/types";
import type { PageRecord } from "$model/sync";
import type { QuestionSource } from "../stores/script-ask.svelte";
import { BrowserHost } from "./host";

/** A button's script is named this in what it throws. */
const FILENAME = "button.js";

export interface ScriptRun {
  readonly ok: boolean;
  readonly error?: string;
  readonly messages: readonly string[];
  readonly open: readonly string[];
  readonly logs: readonly string[];
}

/**
 * Runs a button's script in this browser, on `page` as it is synced here: what it writes shows at once and syncs
 * behind. A question dismissed stops it quietly; what it threw is answered, beside what it said before.
 */
export async function runScript(
  page: PageRecord,
  code: string,
  source: QuestionSource,
  extensions: readonly ScriptExtension[],
): Promise<ScriptRun> {
  const host = new BrowserHost(page, source);
  const said = () => ({ messages: host.messages, open: host.open, logs: host.logs });
  try {
    await runSandboxed(variant, prelude(extensions), compile(code), FILENAME, host);
    return { ok: true, ...said() };
  } catch (error) {
    if (!(error instanceof ScriptError)) throw error;
    return host.dismissed ? { ok: true, ...said() } : { ok: false, error: error.message, ...said() };
  }
}
