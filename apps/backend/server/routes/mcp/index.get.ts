import { eventHandler, setResponseStatus } from "h3";

const METHOD_NOT_ALLOWED = 405;

/** No server-initiated stream: the spec's answer for a server that never sends one is 405. */
export default eventHandler((event) => {
  setResponseStatus(event, METHOD_NOT_ALLOWED);
  return null;
});
