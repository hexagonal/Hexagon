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
 * no `Source.FileId` — there is none to carry. `path` is the artefact's own,
 * in the same path universe as the project's sources; a host writes the text
 * there. No `hex.js` accompanies it: every import of it is type-only and
 * erases (§8.3).
 */
export interface RuntimeDeclarations {
  readonly kind: "RuntimeDeclarations";
  readonly path: string;
  readonly text: string;
}
