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
   * Specifiers of the modules this file calls a **fundamental specialization**
   * in (#440), in source form — the FFI Part 8 editions a known-concrete call
   * site reaches instead of the generic edition and its evidence.
   *
   * Carried for the reason `preludeTermImports` is, and it is not covered by
   * it: choosing an edition is exactly what removes the generic edition's own
   * name from the import, so a synthesized prelude import can end with every
   * name spent and report no term edge, while the file still imports the
   * edition from that module. A source-written import reports its edge from the
   * tree either way; a prelude one has only this.
   */
  readonly specializationImports: readonly string[];
  /**
   * Specifiers of the modules this file calls a **member seat** in (#444), in
   * source form — the honoring module's per-member bindings a concrete
   * constraint-member call reaches instead of the forwarder and its evidence
   * (Constraints §6.1).
   *
   * A channel of its own rather than a widening of the one above, because it is
   * the one edge that can name a module the tree does not mention at all: an
   * instance reached through a chain of re-exports is *declared* somewhere the
   * importer never spelled, and the seats live only there — a transit module
   * re-exports the dictionary, not its seats. Missing it is defect 8 exactly.
   */
  readonly memberSeatImports: readonly string[];
  /**
   * Specifiers of the modules this file calls a **companion operation** in that
   * no `Import` item here names (Method Syntax §8.2, #585) — the operations
   * §4.2's import-insensitivity puts within a dot call's reach whether or not
   * the call site imported their home module.
   *
   * The third channel that can name a module the tree does not mention, beside
   * `memberSeatImports` and the runtime modules, and for the plainest reason of
   * the three: a type reached through a re-export or an imported function's
   * result brings its whole companion with it, and the emitted call has to
   * import the operation from a file this one never spelled.
   */
  readonly companionOperationImports: readonly string[];
  /**
   * The specifiers of the runtime modules this file imports operations from, in
   * source form — empty when it imports none, which is every file that touches
   * neither a `Vector(a)` nor a `Map(k, v)`.
   *
   * The fourth channel decided during emission rather than declared as an
   * `Import` item, after `preludeInstanceImports`, `preludeTermImports`, and
   * `Declarations.preludeTypeImports`, and carried for the same reason. A
   * runtime module exports nothing at the Hexagon level, so there is no `Import`
   * item anywhere in the program to read the edge from — this is the only record
   * that the module has to be written at all.
   */
  readonly runtimeImports: readonly string[];
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
