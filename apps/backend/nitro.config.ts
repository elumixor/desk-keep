import { fileURLToPath } from "node:url";
import { defineNitroConfig } from "nitropack/config";

export default defineNitroConfig({
  compatibilityDate: "latest",
  srcDir: "server",
  imports: false,
  // @elumixor/devkit ships TypeScript sources, so it is transpiled like our own code.
  esbuild: { options: { exclude: /node_modules\/(?!\.bun\/@elumixor\+devkit|@elumixor\/devkit)/ } },
  // A release copies the web build here (`scripts/release.sh`): the app and the API share one origin.
  publicAssets: [{ dir: "../public" }],
  routeRules: {
    "/": { headers: { "cache-control": "no-cache" } },
    "/index.html": { headers: { "cache-control": "no-cache" } },
    "/_app/immutable/**": { headers: { "cache-control": "public, max-age=31536000, immutable" } },
  },
  errorHandler: fileURLToPath(new URL("server/error.ts", import.meta.url)),
  // Registered here, not as `routes/[...]`, which the generated API client would take for an endpoint.
  handlers: [
    { route: "/**", method: "get", handler: fileURLToPath(new URL("server/lib/http/shell.ts", import.meta.url)) },
  ],
});
