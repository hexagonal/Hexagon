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
 * - **It holds both compilation privileges** — `resolve`'s `runtime` flag, which
 *   makes `Node(a)` spellable, and `privileged`, which opens `spec/intrinsics.md`
 *   §5.2's intrinsic door. The second joined the first in #365, under §5.2's own
 *   trust model: privilege attaches to how the module is compiled. They stay two
 *   flags, because they do two different things — one puts a name in scope, the
 *   other admits a declaration form — and a prelude member holds the door
 *   without the `Node` fallback.
 * - **Only the emitter reaches it.** A program that uses no vectors emits no
 *   `VectorTrie.js`, exactly as a program that names no `Option` emits no
 *   `Option.js`: reachability is read back from what emission reported.
 *
 * What it shares with the prelude is the embedding, and since #829 the filing
 * too: a runtime module is an ordinary member of the package `Hex`, filed at
 * `stdlib/Runtime/` and embedded with the rest of the standard library
 * (`stdlib-sources.ts`, `npm run generate:prelude`), with a conformance test
 * asserting it never drifts from the canonical file. **Both privileges are
 * keyed by membership in this list**, never by a path: the folder under
 * `stdlib/` is our filing convention and the language reads no path (Modules
 * §9.2). A host may explicitly trust one supplied declaration to replace a
 * registered member, which is how the shipped-sources sweep compiles these files
 * in their real role.
 */

import { STDLIB_SOURCES } from "./stdlib-sources.js";

export interface RuntimeModule {
  /**
   * The module's **declared name** (Modules §1) — `Runtime.VectorTrie`, whose
   * full name is `Hex.Runtime.VectorTrie` and whose emitted file is
   * `Hex/Runtime/VectorTrie.js` (Packages §2.3, §6).
   */
  readonly name: string;
  /** Embedded fallback source, used unless the host grants a supplied replacement. */
  readonly source: string;
  /**
   * The prelude member this module takes its seat before, in the one injected
   * order. **Normative, not incidental** — it decides two things at once, and
   * they are the same thing seen from either end: what this module can see, and
   * what can see it.
   *
   * *(#927.)* **Absent** where the module needs nothing seated before the end of
   * the prelude and nothing before the end of the prelude names it. Such a
   * module takes the first seat after the prelude (`weaveInjected`), which is
   * the same guarantee stated the only other way it can be: everything is
   * emitted before it, and nothing it can name imports it. `Runtime.Regex` is
   * the first — `Hex.Regex`, its only consumer, is a library member seated later
   * still (`regex.md` §6), and no prelude member names the engine.
   *
   * `Runtime.VectorTrie` sits before `Vector` because `Vector`'s *emission*
   * imports the trie. That edge exists only in the emitted JavaScript — no
   * `Import` item records it — so the module graph's own acyclicity check
   * cannot police it, and the seat is what keeps it honest: everything the trie
   * can name is emitted before the trie, and nothing it can name imports it.
   *
   * That last clause is what the seat *buys*, and since #344 the trie collects
   * on it: its index arithmetic is `Integral<Int>`'s members at `stdlib/Int.hex`
   * now, so the emitted `VectorTrie.js` really does import — and every specifier
   * it carries names a member seated before this one, which is why the emission
   * cycle still cannot form.
   */
  readonly precedes?: string;
}

/**
 * The runtime module set, woven into `PRELUDE_MODULES` at the seats `precedes`
 * names. Each member sees the injected modules before it and only those, which
 * is `PRELUDE_MODULES`' law applied to one list rather than two.
 *
 * `Runtime.VectorTrie` is the persistent trie deque `Vector(a)` is (Collections
 * Part 3 §4), so it precedes `Vector`. `Runtime.HashTrie` is the persistent hash
 * array mapped trie `Map(k, v)` and `Set(a)` are (Part 4 §2.1), so it precedes
 * `Map`. That later seat remains acyclic: `String` and `Vector` do not import
 * the hash trie, while `Map` is its first emitted consumer. It also lets the
 * generic runtime be exercised at `String` after #924 moved that companion
 * behind `Vector` for its text-processing dependencies.
 *
 * `Runtime.Regex` is the regular-expression engine (`regex.md` §6), and it is
 * the first member with **no seat of its own**: nothing it needs is inside the
 * prelude and no prelude member names it, so it takes the seat after all of
 * them. Its consumer, `Hex.Regex`, is a library member and later still. At this
 * landing the module holds the `Buffer` storage rows alone (#927 arc 1); the
 * engine follows in the arc's later steps, and its dependencies — the whole
 * prelude's arithmetic and collections — are exactly what the last seat gives
 * it.
 */
export const RUNTIME_MODULES: readonly RuntimeModule[] = [
  { name: "Runtime.VectorTrie", precedes: "Vector" },
  { name: "Runtime.HashTrie", precedes: "Map" },
  { name: "Runtime.Regex" },
].map(({ name, precedes }) => ({
  name,
  ...(precedes === undefined ? {} : { precedes }),
  source: STDLIB_SOURCES[name]!,
}));

/** The runtime module `Vector(a)`'s emission is wired to. */
export const VECTOR_TRIE_MODULE = "Runtime.VectorTrie";
