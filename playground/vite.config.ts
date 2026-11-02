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
    // directory; Node's own loader links it, refusing a graph whose modules
    // disagree on a name as the browser does, where Vite's module runner would
    // load it.
    server: { deps: { external: [/[\\/]hex-example-/u] } },
  },
});
