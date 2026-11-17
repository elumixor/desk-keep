import { defineEventHandler, handleCors } from "h3";
import { isProduction } from "~/lib/env";

/**
 * Who may call this API from a page on another origin: our own sites under example.com (pai, Balance) showing
 * `<keep-pill>` and `<keep-page>` with the visitor's Keep cookie, and dev servers outside production.
 */
const OURS = /^https:\/\/([a-z0-9-]+\.)*example\.com$/;
const DEV = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

const allowed = (origin: string) => OURS.test(origin) || (!isProduction && DEV.test(origin));

export default defineEventHandler((event) => {
  handleCors(event, {
    origin: allowed,
    credentials: true,
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization", "X-Keep-Client"],
  });
});
