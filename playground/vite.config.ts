/// <reference types="vitest/config" />
import { defineConfig } from "vite";

export default defineConfig({
  server: {
    fs: {
      // The browser worker consumes the platform-neutral compiler source.
      allow: [".."],
    },
  },
  test: {
    // `src/examples/run-modules.ts` runs a program from a `hex-example-`
    // directory, and the execution worker's tests from `hex-object-url-` files
    // (`src/execution-worker-harness.ts`); Node's own loader links both,
    // refusing a graph whose modules disagree on a name as the browser does,
    // where Vite's module runner would load it.
    server: { deps: { external: [/[\\/]hex-example-/u, /[\\/]hex-object-url-/u] } },
  },
});
