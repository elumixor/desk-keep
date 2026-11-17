import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createError, defineEventHandler, setResponseHeader } from "h3";

const API = /^\/(api|mcp|health|\.well-known)(\/|\?|$)/;

/** The web app's shell, which a release puts beside the built server (`public/`); none under `nitro dev`, where Vite serves the app. */
const shell = readFile(resolve(dirname(process.argv[1] ?? "."), "../public/index.html"), "utf8").catch(() => null);

/** The app is one client-rendered bundle: a path that is no file and no API route answers with its shell, and the router sorts it out. */
export default defineEventHandler(async (event) => {
  const html = API.test(event.path) ? null : await shell;
  if (html === null) throw createError({ statusCode: 404, statusMessage: "Not Found" });
  setResponseHeader(event, "content-type", "text/html; charset=utf-8");
  setResponseHeader(event, "cache-control", "no-cache");
  return html;
});
