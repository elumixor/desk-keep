import { type H3Event, isError, send, setResponseHeader, setResponseStatus } from "h3";
import { answerable } from "~/lib/http/answerable";

const INTERNAL_ERROR = 500;
const INTERNAL_MESSAGE = "Something went wrong on our side";

/** The one place an error becomes a response: an `ApiError` goes through as written, anything else is logged and hidden. */
export default async function errorHandler(error: Error & { cause?: unknown }, event: H3Event) {
  const { status, message } = describe(error, event);
  setResponseStatus(event, status);
  setResponseHeader(event, "content-type", "application/json");
  await send(event, JSON.stringify({ error: message }));
}

function describe(error: Error & { cause?: unknown }, event: H3Event) {
  const answer = answerable(error) ?? answerable(error.cause);
  if (answer) return { status: answer.status, message: answer.message };
  if (isError(error) && error.statusCode < INTERNAL_ERROR) {
    return { status: error.statusCode, message: validationMessage(error.data) ?? error.message };
  }
  console.error(`[${event.method} ${event.path}]`, error.cause ?? error);
  return { status: INTERNAL_ERROR, message: INTERNAL_MESSAGE };
}

function validationMessage(data: unknown): string | null {
  if (typeof data !== "object" || data === null || !("issues" in data) || !Array.isArray(data.issues)) return null;
  const issue = data.issues[0] as { path?: (string | number)[]; message?: string } | undefined;
  if (!issue?.message) return null;
  const path = issue.path?.join(".");
  return path ? `${path}: ${issue.message}` : issue.message;
}
