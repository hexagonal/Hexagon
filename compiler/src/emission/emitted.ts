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
}

/** Inspection-only declarations for every representable top-level binding. */
export interface TypeScriptPreview extends Output {
  readonly kind: "TypeScriptPreview";
}
