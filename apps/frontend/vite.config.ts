import { resolve } from "node:path";
import { sveltekit } from "@sveltejs/kit/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, loadEnv } from "vite";

const API_PORT = 3240;

/** A build without the sign-in key would sign nobody in; it is refused here, by name. */
function required(env: Record<string, string | undefined>, key: string) {
  const value = env[key];
  if (!value) throw new Error(`${key} is not set — the build has nothing to put in it`);
  return value;
}

/**
 * `monaco-vim` imports Monaco's files by their old deep paths (`monaco-editor/esm/vs/…`), which Monaco's package
 * exports no longer map; they are pointed at the files themselves, the same modules the app's Monaco is made of.
 */
const MONACO_FILES = resolve(process.cwd(), "../../node_modules/monaco-editor/esm/vs");

export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), "VITE_"), ...process.env };
  // The browser suite points this at the backend it booted; everyone else talks to `nitro dev`.
  const api = process.env.KEEP_URL ?? `http://localhost:${API_PORT}`;
  // A release is served by the deployment that owns `/api`, so it talks to its own origin; dev proxies to Nitro.
  return {
    plugins: [tailwindcss(), sveltekit()],
    resolve: { alias: [{ find: /^monaco-editor\/esm\/vs\/(.*?)(\.js)?$/, replacement: `${MONACO_FILES}/$1.js` }] },
    server: { port: 5240, proxy: { "/api": api, "/mcp": api } },
    preview: { proxy: { "/api": api, "/mcp": api } },
    define: {
      "import.meta.env.VITE_CLERK_PUBLISHABLE_KEY": JSON.stringify(required(env, "VITE_CLERK_PUBLISHABLE_KEY")),
      // People, where people live: production's, develop's, or the fake one the test runner boots.
      "import.meta.env.VITE_PEOPLE_URL": JSON.stringify(required(env, "VITE_PEOPLE_URL")),
    },
  };
});
