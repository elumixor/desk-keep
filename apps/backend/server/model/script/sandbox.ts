import {
  newQuickJSAsyncWASMModuleFromVariant,
  type QuickJSAsyncContext,
  type QuickJSAsyncVariant,
  type QuickJSHandle,
  shouldInterruptAfterDeadline,
} from "quickjs-emscripten-core";
import { transform } from "sucrase";

/**
 * Runs a script in QuickJS (WebAssembly), on the server or in the browser alike: nothing outside is reachable from
 * inside but `__call` (asks the host, the script waiting as if it were synchronous) and `__out` (tells it). Each run gets a module of its own, since an
 * asyncified module can wait on one call at a time and runs on one instance may overlap.
 */

const MEMORY_BYTES = 32 * 1024 * 1024;
const STACK_BYTES = 1024 * 1024;
const DEADLINE_MS = 20_000;

export interface Host {
  call(op: string, args: readonly unknown[]): Promise<unknown>;
  out(kind: string, text: string): void;
  /** What a call that failed with `error` tells the script, which may catch it. */
  failure(error: unknown): string;
}

/** What a script threw, or what stopped it, with the line of the script where it happened. */
export class ScriptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScriptError";
  }
}

/** TypeScript as the JavaScript QuickJS runs: any types left in stripped, every line where it was. */
export function compile(code: string) {
  try {
    return transform(code, { transforms: ["typescript"], disableESTransforms: true }).code;
  } catch (error) {
    throw new ScriptError(error instanceof Error ? error.message : String(error));
  }
}

/** A thrown value as one line: `TypeError: x is not a function (line 3)`. */
function describe(context: QuickJSAsyncContext, handle: QuickJSHandle, filename: string) {
  const thrown = context.dump(handle) as { name?: string; message?: string; stack?: string } | string;
  if (typeof thrown !== "object" || thrown === null) return String(thrown);
  const line = thrown.stack?.match(new RegExp(`${filename}:(\\d+)`))?.[1];
  return `${thrown.name ?? "Error"}: ${thrown.message ?? ""}${line ? ` (line ${line})` : ""}`;
}

function expose(context: QuickJSAsyncContext, host: Host) {
  const call = context.newAsyncifiedFunction("__call", async (op, args) => {
    try {
      const value = await host.call(context.getString(op), JSON.parse(context.getString(args)));
      return context.newString(JSON.stringify({ value }));
    } catch (error) {
      return context.newString(JSON.stringify({ error: host.failure(error) }));
    }
  });
  const out = context.newFunction("__out", (kind, text) => {
    host.out(context.getString(kind), context.getString(text));
  });
  context.setProp(context.global, "__call", call);
  context.setProp(context.global, "__out", out);
  call.dispose();
  out.dispose();
}

/**
 * Runs `prelude`, then `code` (named `filename` in what it throws); throws `ScriptError` when either does. `variant` is
 * QuickJS built for where it runs: Node's on the server, the browser's in the app.
 */
export async function runSandboxed(
  variant: QuickJSAsyncVariant,
  prelude: string,
  code: string,
  filename: string,
  host: Host,
) {
  const module = await newQuickJSAsyncWASMModuleFromVariant(variant);
  // A context made by the module owns its runtime and frees both; freeing a runtime made apart aborts on its functions.
  const context = module.newContext();
  context.runtime.setMemoryLimit(MEMORY_BYTES);
  context.runtime.setMaxStackSize(STACK_BYTES);
  context.runtime.setInterruptHandler(shouldInterruptAfterDeadline(Date.now() + DEADLINE_MS));
  try {
    expose(context, host);
    for (const [source, name] of [
      [prelude, "prelude.js"],
      [code, filename],
    ]) {
      const result = await context.evalCodeAsync(source, name);
      if (result.error) {
        const message = describe(context, result.error, name);
        result.error.dispose();
        throw new ScriptError(message);
      }
      result.value.dispose();
    }
  } finally {
    context.dispose();
  }
}
