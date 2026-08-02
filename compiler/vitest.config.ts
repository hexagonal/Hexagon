import { defineConfig } from "vitest/config";

// The suite ran on Vitest's defaults until #198. It still does, except for the
// one thing defaults cannot supply: a fixed fast-check seed, which
// `architecture/testing.md` §5 places in test infrastructure rather than at
// each call site — precisely so a property test added later cannot forget it.
export default defineConfig({
  test: {
    setupFiles: ["./vitest.setup.ts"],
  },
});
