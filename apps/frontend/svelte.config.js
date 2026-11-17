import adapter from "@sveltejs/adapter-static";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter({ pages: "build", assets: "build", fallback: "index.html" }),
    alias: { $model: "../backend/server/model" },
    // Unit tests run under Bun (`bun test`), whose types the app does not load.
    typescript: { config: (tsconfig) => ({ ...tsconfig, exclude: [...tsconfig.exclude, "../src/**/*.test.ts"] }) },
  },
};

export default config;
