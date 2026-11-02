import { defineConfig } from "vitest/config";

// The suite ran on Vitest's defaults until #198. It still does, except in three
// places. The first is the thing defaults cannot supply: a fixed fast-check
// seed, which `architecture/testing.md` §5 places in test infrastructure rather
// than at each call site — precisely so a property test added later cannot
// forget it.
//
// The second is the test budget. These tests compile whole projects, and under
// parallel load on a two-core runner many of them sit near Vitest's 5000 ms
// default — near enough that the ones which crossed it crossed by scheduling,
// not by computing a wrong answer. Every red the default produced was a
// timeout; none was a failed assertion. The budget is therefore what the work
// costs rather than what the runner happens to ship. A genuinely hung test now
// takes 30 s to fail instead of 5, which is the accepted price of not reading
// an honest test as a broken one. Budgets written at a call site stay as
// written and still apply wherever they are larger.
//
// The third is who links an executed program. `support/test-project.ts` writes
// the emitted modules to a `hex-run-` directory and imports the entry, and
// externalizing that directory hands the graph to Node's own loader. Vite's
// module runner would turn its imports into property reads, so a module
// importing a name its dependency never exported would load and fail only
// where the name was called; Node refuses the graph at link time, as any host
// does.
export default defineConfig({
  test: {
    setupFiles: ["./vitest.setup.ts"],
    testTimeout: 30_000,
    server: { deps: { external: [/[\\/]hex-run-/u] } },
  },
});
