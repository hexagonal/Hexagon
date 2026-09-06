/**
 * The Node host adapter, as far as project and package discovery goes
 * (`compiler/architecture/environment.md` §4).
 *
 * One adapter serves every Node-hosted tool: the language server today, the
 * command-line compiler when there is one. Hosts import this module; nothing
 * here is imported by a compiler pass, and nothing in a compiler pass spells
 * `node_modules`.
 *
 * The surface is what answers "what is this program on disk" and nothing more.
 * A walk's own vocabulary — which directories it skips, what a level of the
 * lookup holds, how a path's directory is spelled — stays inside, because a
 * published name is a promise, and the cheapest time to make fewer of them is
 * before anything depends on them.
 */

export {
  comparablePath,
  isExcluded,
  manifestKeyLine,
  MANIFEST_NAME,
  readManifest,
  type Manifest,
  type ManifestProblem,
  type ManifestResult,
} from "./manifest.js";
export {
  crossesSkippedDirectory,
  excludes,
  hexagonFilesUnder,
  nothingSeen,
  NOTHING_EXCLUDED,
  type Exclusions,
  type FoundFile,
  type Seen,
  type Walked,
} from "./files.js";
// `Candidate` and `LookupResult` travel with `Lookup` because they are what its
// one public answer *is*; `Level` is the scan's own bookkeeping and stays in.
export { Lookup, type Candidate, type LookupResult } from "./lookup.js";
export {
  discoverProgram,
  discoverPrograms,
  exclusionsOf,
  mergedExclusions,
  type DiscoveredPackage,
  type Program,
  type SeatedProblem,
} from "./packages.js";
export {
  enclosingManifestDirectory,
  manifestPathOf,
  projectDirectories,
  type ProjectDirectory,
} from "./projects.js";
export { messageOf, normalizePath, realPathOf, settledPathSync } from "./paths.js";
