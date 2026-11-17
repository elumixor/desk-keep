import { defineConfig } from "vite";

/**
 * `<keep-pill>` and `<keep-page>` as one script, `/elements.js`, for any page on another origin that shows Keep
 * content, classic rather than a module because a module needs CORS headers the static host does not send. Built
 * after the app, into the same output.
 */
export default defineConfig({
  build: {
    outDir: "build",
    emptyOutDir: false,
    lib: { entry: "src/elements/index.ts", name: "KeepElements", formats: ["iife"], fileName: () => "elements.js" },
  },
});
