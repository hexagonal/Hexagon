/** Text artefacts produced by the platform-neutral compiler core. */

import type * as Diagnostics from "../support/diagnostics.js";
import type * as Source from "../support/source.js";

interface Output {
  readonly fileId: Source.FileId;
  readonly text: string;
  readonly diagnostics: readonly Diagnostics.Diagnostic[];
}

export interface JavaScript extends Output {
  readonly kind: "JavaScript";
  readonly generatedSections: readonly GeneratedSection[];
  /**
   * Specifiers of prelude modules this file imports *only* for instance
   * evidence (#153), in source form — the same spelling an `Import` item
   * carries, not the emitted `.js` one.
   *
   * Carried for the same reason `Declarations.importsRuntimeTypes` is, and with
   * the same consequence if it were missing: a prelude module is emitted only
   * when something emitted imports it, and this channel's imports are decided
   * during emission rather than declared as `Import` items, so reachability
   * cannot see them by reading the tree. Without this the project compiles
   * clean and emits `import … from "./Prelude.js"` beside no `Prelude.js`.
   */
  readonly preludeInstanceImports: readonly string[];
  /**
   * Specifiers of prelude modules this file imports for their *terms* (#263),
   * in source form — the same spelling the synthesized `Import` item carries.
   *
   * Carried for the same reason `preludeInstanceImports` is. The synthesized
   * item's name list is an over-approximation until emission filters it to what
   * the body references, so a resolved `Import` item is no longer evidence that
   * anything is imported: reachability that read the tree would keep emitting a
   * prelude module nothing imports, which is the cost this reports away.
   */
  readonly preludeTermImports: readonly string[];
  /**
   * The specifier of the vector trie runtime module this file imports trie
   * operations from, in source form — empty when it imports none, which is
   * every file that touches no `Vector(a)`.
   *
   * The fourth channel decided during emission rather than declared as an
   * `Import` item, after `preludeInstanceImports`, `preludeTermImports`, and
   * `Declarations.preludeTypeImports`, and carried for the same reason.
   * `runtime/VectorTrie.hex` exports nothing at the Hexagon level, so there is
   * no `Import` item anywhere in the program to read the edge from — this is
   * the only record that the module has to be written at all.
   */
  readonly vectorRuntimeImports: readonly string[];
}

/** A generated body that an interactive host may present separately. */
export interface GeneratedSection {
  readonly kind: "FundamentalSpecialization";
  readonly sourceName: string;
  readonly generatedName: string;
  readonly typeArguments: readonly string[];
  readonly startOffset: number;
  readonly endOffset: number;
  readonly bytes: number;
}

export interface Declarations extends Output {
  readonly kind: "Declarations";
  /**
   * Whether this file imports the program's runtime declaration module — true
   * exactly when a `Hex.*` face was rendered into it (FFI Part 1 §8.3
   * obligation 2). The program emits that module iff some file says `true`
   * here (obligation 3), which is why the flag is carried rather than
   * recovered by searching the text.
   */
  readonly importsRuntimeTypes: boolean;
  /**
   * Specifiers of prelude modules this file takes a type-only named import from
   * (#227, FFI Part 7 §2.4), in source form — the same spelling an `Import` item
   * carries, not the emitted `.js` one.
   *
   * The third channel decided during emission rather than declared as an
   * `Import` item, after `JavaScript.preludeInstanceImports` and
   * `preludeTermImports`, and carried for the same reason: reachability reads
   * what emission reported, because reading the tree cannot see these edges. It
   * is the *declarations* that need the target, though — a face naming `Option`
   * without touching an `Option` term produces no JavaScript edge at all — so
   * without this the project compiles clean and emits `import type … from
   * "./Option.js"` beside no `Option.d.ts`, which is #227's own failure in a
   * new dress.
   */
  readonly preludeTypeImports: readonly string[];
}

/** Inspection-only declarations for every representable top-level binding. */
export interface TypeScriptPreview extends Output {
  readonly kind: "TypeScriptPreview";
}

/**
 * The program-scoped runtime declaration module (FFI Part 1 §8.3): one
 * `hex.d.ts` per compiled program, declaring the `Hex.*` collection faces.
 *
 * It is the first emission artefact belonging to no source file, so it carries
 * no `Source.FileId` — there is none to carry. `path` is derived from the
 * project's source paths the same way the injected prelude modules' are, and
 * inherits their one quirk: sources with no directory component at all yield a
 * common root of `""`, so this reads `/hex.d.ts` where those sources read
 * `main.hex`. A host should resolve it as it resolves a prelude module's — a
 * prescription, not a description: the repo has no host that writes emitted
 * declarations to disk, so this seat is new and currently unoccupied. No
 * `hex.js` accompanies it: every import of it is type-only and erases (§8.3).
 */
export interface RuntimeDeclarations {
  readonly kind: "RuntimeDeclarations";
  readonly path: string;
  readonly text: string;
}
