/**
 * The Node host adapter, as far as project and package discovery goes
 * (`compiler/architecture/environment.md` §4).
 *
 * One adapter serves every Node-hosted tool: the language server today, the
 * command-line compiler when there is one. Hosts import this module; nothing
 * here is imported by a compiler pass, and nothing in a compiler pass spells
 * `node_modules`.
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
  excludes,
  hexagonFilesUnder,
  HEXAGON_EXTENSION,
  nothingSeen,
  NOTHING_EXCLUDED,
  SKIPPED_DIRECTORIES,
  type Exclusions,
  type FoundFile,
  type Seen,
  type Walked,
} from "./files.js";
export { Lookup, type Candidate, type Level, type LookupResult } from "./lookup.js";
export {
  discoverProgram,
  excludedBy,
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
export { directoryOf, messageOf, normalizePath, realPathOf } from "./paths.js";
