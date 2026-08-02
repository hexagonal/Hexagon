/**
 * The replay seed for fast-check properties (`architecture/testing.md` §3.4).
 *
 * `vitest.setup.ts` is the only caller. The arithmetic lives here, under `src`,
 * because that is what `npm run check` type-checks and what a test can import —
 * the setup file itself is neither.
 */

/**
 * There is nothing special about 198 beyond naming the defect that pinned it
 * (#198). It was not chosen for what it finds: a seed shopped for until the
 * suite went green would mean the suite passes by selection, which is the
 * opposite of the point.
 */
export const BASE_PROPERTY_SEED = 198;

/**
 * A seed per test file, rather than one seed for the whole suite.
 *
 * Sharing a single seed would have quietly *narrowed* coverage rather than
 * merely freezing it. Seven of the nine compiler properties generate a bare
 * `fc.string()`, so one global seed makes all seven draw the identical 250
 * inputs — where unseeded they at least drew seven independent samples. Each
 * file therefore offsets the base by a hash of its own path.
 *
 * The path must be the repo-relative one with `/` separators. An absolute path
 * would seed differently on each machine, which is the property this whole
 * mechanism exists to provide.
 */
export function propertySeed(base: number, repoRelativePath: string): number {
  // FNV-1a, 32-bit. Any stable hash would do; this one is short and has no
  // dependency. `Math.imul` keeps the multiply in 32 bits.
  let hash = 0x811c9dc5;
  for (let index = 0; index < repoRelativePath.length; index += 1) {
    hash = Math.imul(hash ^ repoRelativePath.charCodeAt(index), 0x01000193);
  }
  // `>>> 0` first, so the offset is non-negative regardless of `base`'s sign.
  return base + ((hash >>> 0) % 100_000);
}

/**
 * What `vitest.setup.ts` actually handed to fast-check, so a test can check
 * that fast-check received it.
 *
 * That check is not ceremony. `fc.configureGlobal` validates nothing — it
 * assigns the object it is given — and the setup file sits outside
 * `tsconfig.json`'s `include`, so a misspelled key there is neither a type
 * error nor a test failure. The properties would simply go back to running
 * unseeded, which is #198 exactly, and silently.
 */
export function recordedPropertySeed(): number | undefined {
  return (globalThis as { [SEED_KEY]?: number })[SEED_KEY];
}

export function recordPropertySeed(seed: number): void {
  (globalThis as { [SEED_KEY]?: number })[SEED_KEY] = seed;
}

const SEED_KEY = "__hexagonPropertySeed";
