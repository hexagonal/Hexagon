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
   * clean and emits `import … from "./Hex/Prelude.js"` beside no `Prelude.js`.
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
   * The specifiers of the modules this file imports an **object-reading `extern
   * enum`'s members** from (Foreign Enums §3, §7.1) — empty for every file that
   * matches on none.
   *
   * The fourth channel that can name a module the tree does not mention, and it
   * arises for the reason the third does one namespace over: a constructor
   * pattern's head may be resolved against the *expected type* (Pattern Matching
   * §2.2), so a module can match on an enum whose home it never imported — and
   * this is the one construct whose pattern test needs the constructor's runtime
   * value rather than a tag.
   */
  readonly enumMemberImports: readonly string[];
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
  /**
   * Whether this file imports reserved captures from the program's **runtime
   * module** — true exactly when the module binds a runtime-vocabulary spelling
   * (FFI Part 7 §1.2 rule 2, #666).
   *
   * A flag rather than a specifier, because the target is program-scoped: there
   * is one runtime module per program and `compileProject` already knows where
   * it sits. Carried for `Declarations.importsRuntimeTypes`' reason — the
   * program emits `hex.js` iff some emitted file says `true` here — and with the
   * same consequence if it were missing, one file worse: `hex.js` is
   * *executable*, so a contested program without it emits an `import` of a file
   * that was never written and dies at its first import.
   */
  readonly importsRuntimeGlobals: boolean;
}

/**
 * One emitted edition of a constrained export, located in the file it was
 * rendered into: a generated *body* in `JavaScript`, a generated *face* with its
 * own documentation in `Declarations`.
 *
 * The §10 measurement in the shape §10 asks for — "the emitted JS size and
 * `.d.ts` size attributable to generated specializations (count and bytes), per
 * emitted module" — with the count being the array's length and the bytes each
 * row's own, so no artefact carries a total that could disagree with its rows.
 * `bytes` is UTF-8, the encoding the file is written in; the offsets are into
 * `text` as JavaScript indexes it, so `text.slice(startOffset, endOffset)` is
 * the rendered edition and `bytes` is what it weighs on disk.
 *
 * The same row also lets an interactive host present a generated body
 * separately from the source-derived text around it.
 */
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
   * `JavaScript.generatedSections`' `.d.ts` half (Zero-Cost Fundamental Exports
   * §10): one row per edition rendered into this file, in the order they appear
   * in `text`.
   *
   * A row spans the edition's **documentation block and its face**, not the face
   * alone. A constrained export has no single `.d.ts` declaration, so its doc
   * block is re-emitted once per edition, each carrying that specialization's
   * own Hexagon face — text that exists only because the editions exist, which
   * is what "attributable to generated specializations" asks for and where most
   * of a documented module's Cartesian growth actually sits. The JavaScript side
   * has no counterpart: there the item's documentation precedes the whole
   * rendered block once, source binding and editions together.
   *
   * The two artefacts' rows are the same plan read twice, so they agree on
   * count, `sourceName`, `generatedName` and `typeArguments` for every module
   * that emits both. What differs is `bytes`, and that is the point of measuring
   * both rather than summing them: the two artefacts grow differently with the
   * product, and §10 asks for the two sizes.
   */
  readonly generatedSections: readonly GeneratedSection[];
  /**
   * The exported declarations this module publishes **no typed entry point** for
   * — Zero-Cost Fundamental Exports §3.4's zero-entry-point case, by source
   * name, and the list §10's report is required to carry beside the byte
   * accounting above.
   *
   * The predicate is an emission fact rather than a re-derivation of §3.4's
   * trigger: a §3.1-eligible export that published zero faces here. Nothing
   * re-runs Algorithm S and nothing implements §4's trigger to ask whether the
   * generic edition would have covered the export — Algorithm G is unimplemented
   * and #423 has yet to settle whether it would carry a `.d.ts` face at all, and
   * a predicate phrased on what was published stays true either way.
   *
   * It sits on the **declarations** and not on the JavaScript because that is
   * where §3.4's absence is literal. The emitted ESM may still carry the
   * export's evidence-taking form as cross-module plumbing (§3.4's second
   * bullet, Modules §11.5); what the exception removes is the *typed, supported*
   * surface, which is this file. A §10 report needs both artefacts anyway —
   * `CompiledModule` carries them together — so one home is enough.
   *
   * See `SpecializationPlan.zeroEntryPointExports` for what is and is not
   * listed; in particular private declarations never are.
   */
  readonly zeroEntryPointExports: readonly string[];
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
  /**
   * Specifiers of the modules this file **mints** a type-only named import from
   * (FFI Part 7 §2.4 rung 5), in source form.
   *
   * `preludeTypeImports`' sibling, one rung down and with a wider reach: rung 5
   * names a module the source never imported at all — the shape a type alias's
   * expansion reaches, where the importer binds the alias and nothing the
   * expansion mentions (#618). Those edges count toward what gets emitted on
   * exactly the same footing, or the declarations import from a file that was
   * never written. Declaration-side only: no JavaScript import is added.
   */
  readonly mintedTypeImports: readonly string[];
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
 * declarations to disk, so this seat is new and currently unoccupied. Every
 * import of it is type-only and erases (§8.3); a `hex.js` may or may not sit
 * beside it, emitted on its own independent condition (`RuntimeGlobals`).
 */
export interface RuntimeDeclarations {
  readonly kind: "RuntimeDeclarations";
  readonly path: string;
  readonly text: string;
}

/**
 * The program-scoped runtime **module** (FFI Part 7 §1.2, #666): one `hex.js`
 * per compiled program, holding the globals capture a contested module cannot
 * perform for itself.
 *
 * `RuntimeDeclarations`' sibling at the seat FFI Part 1 §8.3 reserved, under the
 * same probed stem — one module identity, not a second — and emitted on its own
 * independent condition: some emitted module of the program binds a
 * runtime-vocabulary spelling. Its text depends on the vocabulary alone, so it
 * is byte-identical across every program that owes it.
 *
 * The one obligation the type-only artefact never carried: **this one is
 * executable**. Every host's execution set has to load it on the same footing as
 * a prelude module, or every contested program dies at its first import.
 */
export interface RuntimeGlobals {
  readonly kind: "RuntimeGlobals";
  readonly path: string;
  readonly text: string;
}
