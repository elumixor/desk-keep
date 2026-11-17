import { eventHandler, readBody, setResponseHeader, setResponseStatus } from "h3";
import { resolveCaller } from "~/lib/auth/caller";
import { handleMessage } from "~/lib/mcp/protocol";

const ACCEPTED = 202;

/** The MCP endpoint: stateless JSON-RPC, one POST one answer; the key in the request says who is asking. */
export default eventHandler(async (event) => {
  const caller = await resolveCaller(event);
  const body = await readBody(event);
  setResponseHeader(event, "cache-control", "no-store");
  const messages: unknown[] = Array.isArray(body) ? body : [body];
  const answers = (await Promise.all(messages.map((message) => handleMessage(message, caller)))).filter(
    (a) => a !== null,
  );
  if (!answers.length) {
    setResponseStatus(event, ACCEPTED);
    return null;
  }
  return Array.isArray(body) ? answers : answers[0];
});
