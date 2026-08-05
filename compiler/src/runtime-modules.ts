/**
 * The implicit **runtime** modules injected into every compiled project.
 *
 * A runtime module is Hexagon source the *emitted program* runs on rather than
 * source a Hexagon program can name. It differs from a prelude module (see
 * `prelude.ts`) in every direction that matters:
 *
 * - **Nothing it declares is in scope anywhere.** A prelude member's exports are
 *   implicitly available in every module; a runtime module's are available in
 *   none. It exports nothing at the Hexagon level and could not — every
 *   operation's type names a private record — so no `import` can reach it
 *   either. The emitter writes the emitted module's JavaScript export list.
 * - **It is privileged the way `resolve`'s `runtime` flag means** (`Node(a)` is
 *   spellable), not the way prelude membership means (`spec/intrinsics.md` §5.2's
 *   intrinsic door). The two privileges are separate and this takes only the one
 *   it needs.
 * - **Only the emitter reaches it.** A program that uses no vectors emits no
 *   `VectorTrie.js`, exactly as a program that names no `Option` emits no
 *   `Option.js`: reachability is read back from what emission reported.
 *
 * What it shares with the prelude is the embedding: `compileProject` is
 * filesystem-free, so the text is generated into `runtime-sources.ts` (`npm run
 * generate:prelude`) and a conformance test asserts it never drifts from the
 * canonical file. A project supplying its own file at the injection basename
 * wins, which is what lets the shipped-sources sweep compile `runtime/*.hex` in
 * its real role.
 */

import { RUNTIME_SOURCES } from "./runtime-sources.js";

export interface RuntimeModule {
  /** Basename placed at the common root of a project's sources. */
  readonly basename: string;
  /** Embedded fallback source, used only when the project supplies no file at the path. */
  readonly source: string;
  /**
   * The prelude member this module takes its seat before, in the one injected
   * order. **Normative, not incidental** — it decides two things at once, and
   * they are the same thing seen from either end: what this module can see, and
   * what can see it.
   *
   * `VectorTrie.hex` sits before `Vector.hex` because `Vector.hex`'s *emission*
   * imports the trie. That edge exists only in the emitted JavaScript — no
   * `Import` item records it — so the module graph's own acyclicity check
   * cannot police it, and the seat is what keeps it honest: everything the trie
   * can name is emitted before the trie, and nothing it can name imports it.
   */
  readonly precedes: string;
}

/**
 * The runtime module set, woven into `PRELUDE_MODULES` at the seats `precedes`
 * names. Each member sees the injected modules before it and only those, which
 * is `PRELUDE_MODULES`' law applied to one list rather than two.
 *
 * `VectorTrie.hex` is the persistent trie deque `Vector(a)` is (Collections
 * Part 3 §4).
 */
export const RUNTIME_MODULES: readonly RuntimeModule[] = [
  { basename: "VectorTrie.hex", precedes: "Vector.hex" },
].map(({ basename, precedes }) => ({
  basename,
  precedes,
  source: RUNTIME_SOURCES[basename]!,
}));

/** The runtime module `Vector(a)`'s emission is wired to. */
export const VECTOR_TRIE_BASENAME = "VectorTrie.hex";
