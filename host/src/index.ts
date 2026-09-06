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
 * A walk's own vocabulary — which directories it skips, what it remembers
 * having been to, what a level of the lookup holds, which directory of a set of
 * roots is a project — stays inside, because a published name is a promise, and
 * the cheapest time to make fewer of them is before anything depends on them.
 * So this list is what a host **calls**, plus the types it needs to name what a
 * call answers with; a module inside this package imports its neighbour
 * directly, and the tests here do the same.
 */

export {
  comparablePath,
  manifestKeyLine,
  MANIFEST_NAME,
  // Named by `Program.manifest` and taken by `exclusionsOf`.
  type Manifest,
} from "./manifest.js";
export {
  excludes,
  NOTHING_EXCLUDED,
  skippedDirectoryBetween,
  type Exclusions,
  // Named by `Program.files` and `DiscoveredPackage.files`.
  type FoundFile,
} from "./files.js";
// `lookup.ts` publishes nothing at all. `Lookup` is `discoverProgram`'s
// parameter, and `discoverProgram` is not on this list — so no host outside this
// package can reach the class, and its answer types are names promised to
// nobody. A host that one day wants the lookup on its own publishes it then,
// with `Candidate` and `LookupResult` beside it.
export {
  discoverPrograms,
  exclusionsOf,
  type DiscoveredPackage,
  type Program,
  type SeatedProblem,
} from "./packages.js";
export { manifestPathOf } from "./projects.js";
export { messageOf, normalizePath, settledPathSync } from "./paths.js";
