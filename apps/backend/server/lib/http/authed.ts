import { type BaseContext, type ExecutableEventHandler, handler } from "@elumixor/nitro-client/server";
import type { ZodType, z } from "zod";
import { type Caller, resolveCaller } from "~/lib/auth/caller";

type SchemaInput = Record<string, ZodType>;
type Schemas = { body?: SchemaInput; query?: SchemaInput };
type InferSchema<S extends SchemaInput> = { [K in keyof S]: z.infer<S[K]> };
type Inferred<S extends Schemas> = { [K in keyof S]: S[K] extends SchemaInput ? InferSchema<S[K]> : never };

type AuthedContext = BaseContext & { readonly caller: Caller };
type Authed<R> = ExecutableEventHandler<Promise<Awaited<R>>>;
type Fn = (context: AuthedContext) => unknown;

const isGenerator = (fn: Fn): fn is (context: AuthedContext) => AsyncGenerator =>
  fn.constructor.name === "AsyncGeneratorFunction";

/**
 * `handler` for a route that needs a caller: resolved before the body runs, a request without one never reaches it.
 * A route written as `async function*` streams what it yields (`handler` sends it as events) once the caller is known.
 */
export function authed<S extends Schemas, R>(schemas: S, fn: (context: Inferred<S> & AuthedContext) => R): Authed<R>;
export function authed<R>(fn: (context: AuthedContext) => R): Authed<R>;
export function authed(schemasOrFn: Schemas | Fn, maybeFn?: Fn): ExecutableEventHandler<Promise<unknown>> {
  const fn = typeof schemasOrFn === "function" ? schemasOrFn : (maybeFn as Fn);
  if (isGenerator(fn)) {
    const streaming = async function* (context: BaseContext) {
      yield* fn({ ...context, caller: await resolveCaller(context.event) });
    };
    const streamed = typeof schemasOrFn === "function" ? handler(streaming) : handler(schemasOrFn, streaming);
    // `handler` types a streaming route by what it yields; callers of `authed` see the generator they wrote.
    return streamed as unknown as ExecutableEventHandler<Promise<unknown>>;
  }
  const plain = async (context: BaseContext) => fn({ ...context, caller: await resolveCaller(context.event) });
  return typeof schemasOrFn === "function" ? handler(plain) : handler(schemasOrFn, plain);
}
