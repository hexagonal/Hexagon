import fc from "fast-check";
import { beforeEach } from "vitest";

import {
  BASE_PROPERTY_SEED,
  propertySeed,
  recordPropertySeed,
} from "./src/support/property-seed.js";

/**
 * Fixes the fast-check replay seed for every property in the compiler
 * (`architecture/testing.md` §3.4, §5).
 *
 * Unseeded, fast-check draws a fresh seed per run, so each property sampled
 * different inputs every time. That is accidental fuzzing, and it cost the
 * project a real signal: the elaborator property failed once during the review
 * of #197, named an input in output nobody kept, and could not be reproduced in
 * 77 further runs. A test that fails only sometimes, and cannot say on what, is
 * not a test. (That one was eventually recovered by sweeping seeds, and the
 * fault was the property's own forbidden list rather than the elaborator — see
 * `elaborator.test.ts`.)
 *
 * Central rather than per-`fc.assert`, so a property test added later cannot
 * omit it. `propertySeed` then varies it per file; see its own comment for why
 * one seed for the whole suite would have been worse than the drift it replaces.
 *
 * Pinning does trade the drift away: coverage is now whatever these inputs
 * cover, and it stops growing on its own. A run that *wants* the drift sets
 * `HEXAGON_PROPERTY_SEED`, which is the seam a scheduled fuzz job needs —
 * without it there is no way to unpin at all. It deliberately takes a seed
 * rather than a "randomize" flag, so anything the drift turns up arrives
 * already reproducible.
 */

// Empty or blank counts as unset. `HEXAGON_PROPERTY_SEED= npm test` is how a
// shell says "not this time", and `Number("")` and `Number(" ")` are both 0,
// which would otherwise be a real seed chosen by accident.
const override = process.env["HEXAGON_PROPERTY_SEED"]?.trim() || undefined;
const base = override === undefined ? BASE_PROPERTY_SEED : Number(override);

if (!Number.isSafeInteger(base)) {
  throw new Error(
    `HEXAGON_PROPERTY_SEED must be a safe integer; got ${JSON.stringify(override)}`,
  );
}

// An override changes what the gate tests, so it says so. Exported from a shell
// profile or a CI environment it would otherwise be invisible in the output.
if (override !== undefined) {
  process.stderr.write(`fast-check base seed overridden: ${base} (HEXAGON_PROPERTY_SEED)\n`);
}

// `import.meta.dirname` is this file's directory, which is the compiler root —
// so stripping it leaves the repo-relative path `propertySeed` requires. The
// separator swap keeps a Windows checkout on the same seeds as a POSIX one.
const root = import.meta.dirname;

beforeEach((context) => {
  const path = context.task.file.filepath.slice(root.length + 1).replaceAll("\\", "/");
  const seed = propertySeed(base, path);

  recordPropertySeed(seed);
  // Note this *replaces* fast-check's global configuration rather than merging
  // into it. Nothing else sets one; anything that starts to must set it here.
  fc.configureGlobal({ seed });
});
