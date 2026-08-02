import fc from "fast-check";

/**
 * The fixed replay seed for every fast-check property in the compiler
 * (`architecture/testing.md` §3.4, §5).
 *
 * There is nothing special about 198 beyond naming the defect that pinned it.
 * It was not chosen for what it finds: a seed that had to be shopped for would
 * mean the suite was passing by selection, which is the opposite of the point.
 * The only claim made for it is that the suite passes on it, and that it is the
 * same on every machine and every run.
 */
const DEFAULT_SEED = 198;

/**
 * Unseeded, fast-check draws a fresh seed per run, so each of the nine compiler
 * properties sampled a different set of inputs every time. That is accidental
 * fuzzing, and it cost the project a real signal: the elaborator property
 * failed once during the review of #197, named an input in output nobody kept,
 * and could not be reproduced in 77 further runs. A test that fails only
 * sometimes, and cannot say on what, is not a test. (That one was eventually
 * recovered by sweeping seeds, and the fault was the property's own forbidden
 * list rather than the elaborator — see `elaborator.test.ts`.)
 *
 * Pinning trades the drift away. Coverage is now whatever these inputs cover,
 * and it stops growing on its own — so a run that *wants* the drift sets
 * `HEXAGON_PROPERTY_SEED` and records what it used. That is the seam a
 * scheduled fuzz job needs; without it there is no way to unpin at all. Note
 * it deliberately takes a seed rather than a "randomize" flag, so anything the
 * drift turns up arrives already reproducible.
 */
// Empty counts as unset: `HEXAGON_PROPERTY_SEED= npm test` is how a shell says
// "not this time", and `Number("")` is 0, which would silently be a real seed.
const override = process.env["HEXAGON_PROPERTY_SEED"] || undefined;
const seed = override === undefined ? DEFAULT_SEED : Number(override);

if (!Number.isInteger(seed)) {
  throw new Error(`HEXAGON_PROPERTY_SEED must be an integer; got ${JSON.stringify(override)}`);
}

fc.configureGlobal({ seed });
