import { globSync } from "node:fs";

import { defineConfig } from "vitest/config";

// The suite ran on Vitest's defaults until #198. It still does, except in four
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
//
// The fourth is who shares a process. `compileProject` keeps the checked
// standard library for the life of the process (#987), and Vitest's default
// gives every test file a fresh one, so the suite checked the standard library
// once per file — about a third of all its work. With isolation off, Vitest
// keeps a worker for the next file of the same project, so the cache stays warm
// across them.
//
// A shared worker also keeps what a file leaves behind, and executed programs
// leave their whole module graph: Node's loader never unloads a module. Run
// unbroken, the suite's files retain several gigabytes in all, past Node's
// default heap on a 16 GB runner. So the shared files are dealt round-robin
// into `SHARES` projects; Vitest runs projects in turn and retires a worker
// when the next file belongs to another project, so each worker carries about
// an eighth of the suite's leftovers, and the standard library is checked a few
// dozen times instead of once per file. Even an eighth peaked near 1.8 GB on a
// four-core machine, close to Node's default limit there, so the shared
// workers get 4 GB of heap; three of them still fit a 16 GB runner.
//
// `standard-library-cache.test.ts` resets and freezes the cache and counts its
// seats, so it alone keeps a process of its own. `architecture/testing.md` §5
// says what a shared process asks of a test.
const ISOLATED = ["src/standard-library-cache.test.ts"];
const SHARES = 8;

// Vitest's own default pattern, so a test file is found wherever and however a
// default configuration would have found it. The list is read once, when the
// configuration loads: watch mode needs a restart to see a new file.
const shared = globSync("**/*.{test,spec}.?(c|m)[jt]s?(x)", {
  cwd: import.meta.dirname,
  exclude: (path) => path === "node_modules" || path === "dist" || path.startsWith("."),
})
  .map((path) => path.replaceAll("\\", "/"))
  .filter((path) => !ISOLATED.includes(path))
  .sort();

// Continuous integration runs the suite as several jobs on separate machines.
// `HEXAGON_TEST_SHARD=k/n` keeps every n-th project, starting at the k-th, so
// the n jobs between them run each project exactly once, whatever SHARES is,
// and a project is never split across machines: its files still share one
// warm worker. Unset, every project runs.
const projects = [
  ...Array.from({ length: SHARES }, (_, share) => ({
    extends: true as const,
    test: {
      name: `shared-${share + 1}`,
      isolate: false,
      execArgv: ["--max-old-space-size=4096"],
      include: shared.filter((_, index) => index % SHARES === share),
    },
  })),
  {
    extends: true as const,
    test: { name: "isolated", include: ISOLATED },
  },
];

function selectShard<T>(all: T[], spec: string | undefined): T[] {
  if (spec === undefined || spec === "") return all;
  const match = /^([1-9][0-9]*)\/([1-9][0-9]*)$/u.exec(spec);
  const part = Number(match?.[1]);
  const parts = Number(match?.[2]);
  if (match === null || part > parts || parts > all.length) {
    throw new Error(
      `HEXAGON_TEST_SHARD must be k/n with 1 <= k <= n <= ${all.length}, not "${spec}"`,
    );
  }
  return all.filter((_, index) => index % parts === part - 1);
}

export default defineConfig({
  test: {
    setupFiles: ["./vitest.setup.ts"],
    testTimeout: 30_000,
    server: { deps: { external: [/[\\/]hex-run-/u] } },
    projects: selectShard(projects, process.env.HEXAGON_TEST_SHARD),
  },
});
