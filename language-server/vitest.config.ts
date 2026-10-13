import { defineConfig } from "vitest/config";

// The test budget, as the compiler's (`compiler/vitest.config.ts`,
// `compiler/architecture/testing.md` §11): these tests start a server over a
// real workspace, and those that trust a standard-library project compile the
// whole standard library from source first. On a slow continuous-integration
// runner that alone sits within a second or two of Vitest's 5000 ms default,
// so the budget is what the work costs rather than what the runner happens to
// ship. A genuinely hung test now takes 30 s to fail instead of 5.
export default defineConfig({
  test: {
    testTimeout: 30_000,
  },
});
