import type { GeneratedSection } from "./protocol";

/** Groups editions by their originating Hexagon declaration for UI navigation. */
export function groupGeneratedSections(
  sections: readonly GeneratedSection[],
): ReadonlyMap<string, readonly GeneratedSection[]> {
  const groups = new Map<string, GeneratedSection[]>();
  for (const section of sections) {
    const existing = groups.get(section.sourceName) ?? [];
    existing.push(section);
    groups.set(section.sourceName, existing);
  }
  return groups;
}

/**
 * One edition as the build report shows it: the JavaScript body this module
 * renders, and the `.d.ts` face rendered from the same plan row.
 *
 * The two sizes are carried side by side and never summed. Zero-Cost
 * Fundamental Exports §10 accepts the Cartesian product on the condition that
 * "the emitted JS size and `.d.ts` size attributable to generated
 * specializations" are available, and the two artefacts grow differently with
 * the product — a total would hide the very difference the measurement is for.
 */
export interface ReportedEdition {
  readonly section: GeneratedSection;
  /**
   * What this edition's face and its documentation block weigh, or `undefined`
   * where the edition published no face at all.
   *
   * The absent case is ordinary here rather than exceptional: this pane previews
   * private editions, and a private declaration reaches no `.d.ts`. `undefined`
   * rather than `0` because "published nothing" and "published something empty"
   * are different claims, and only the first is true.
   */
  readonly declarationBytes: number | undefined;
}

/** Every edition one source declaration minted, with both artefacts' totals. */
export interface ReportedExport {
  readonly sourceName: string;
  readonly editions: readonly ReportedEdition[];
  readonly javaScriptBytes: number;
  /** The faces that were published, summed; `0` where none were. */
  readonly declarationBytes: number;
  /** How many of these editions published no face — all of them, or none. */
  readonly facesMissing: number;
}

/**
 * What the generated-sections panel has to show, independent of the tab gate the
 * host applies on top of it.
 *
 * `hasContent` is the whole point of the type. §3.4's list has to reach the
 * author in the case where nothing was generated — §16(h)'s `heaviest`, where
 * the module publishes no entry point and therefore no edition either — which is
 * exactly when a panel keyed on the edition list alone would not render.
 */
export interface GeneratedSectionsPanel {
  readonly exports: readonly ReportedExport[];
  readonly zeroEntryPointNote: string | undefined;
  readonly hasContent: boolean;
}

export function generatedSectionsPanel(
  javaScriptSections: readonly GeneratedSection[],
  declarationSections: readonly GeneratedSection[],
  zeroEntryPointExports: readonly string[],
): GeneratedSectionsPanel {
  const exports = reportGeneratedEditions(javaScriptSections, declarationSections);
  const zeroEntryPointNote = formatZeroEntryPointExports(zeroEntryPointExports);
  return {
    exports,
    zeroEntryPointNote,
    hasContent: exports.length > 0 || zeroEntryPointNote !== undefined,
  };
}

/**
 * Pairs the two artefacts' rows for the same edition, grouped by the declaration
 * they were minted from.
 *
 * The JavaScript list leads because it is the containing one — every face has a
 * body and the reverse fails for private editions — and the pairing key is the
 * generated name: both artefacts render from one plan, so a name identifies an
 * edition across them (Algorithm N, §6.1).
 *
 * Nothing pairs by position, and the difference is not merely one of length.
 * The `.d.ts` list omits every private edition wherever it sits, so a private
 * declaration rendered ahead of an exported one displaces every index after it
 * — and a positional pairing then credits the private declaration with the
 * exported one's faces while reporting the exported one as having published
 * none. The two lists measure equal whenever no constrained declaration is
 * private, which is why a length check is no guard at all.
 */
export function reportGeneratedEditions(
  javaScriptSections: readonly GeneratedSection[],
  declarationSections: readonly GeneratedSection[],
): readonly ReportedExport[] {
  const faces = new Map(
    declarationSections.map((section) => [section.generatedName, section.bytes]),
  );
  return [...groupGeneratedSections(javaScriptSections)].map(([sourceName, sections]) => {
    const editions = sections.map((section) => ({
      section,
      declarationBytes: faces.get(section.generatedName),
    }));
    return {
      sourceName,
      editions,
      // Summed from `bytes` on both sides. An offset span would be the same
      // number only for text that is entirely ASCII, and a doc comment is where
      // it would stop being.
      javaScriptBytes: editions.reduce((total, { section }) => total + section.bytes, 0),
      declarationBytes: editions.reduce(
        (total, { declarationBytes }) => total + (declarationBytes ?? 0),
        0,
      ),
      facesMissing: editions.filter(({ declarationBytes }) => declarationBytes === undefined)
        .length,
    };
  });
}

/** `plusInt · Int · 148 B JS · 96 B .d.ts` — one edition, both artefacts. */
export function formatEditionLabel({ section, declarationBytes }: ReportedEdition): string {
  return [
    section.generatedName,
    section.typeArguments.join(", "),
    `${section.bytes} B JS`,
    declarationBytes === undefined ? "no .d.ts face" : `${declarationBytes} B .d.ts`,
  ].join(" · ");
}

/** `plus (4, 592 B JS · 384 B .d.ts)` — one declaration's editions, totalled. */
export function formatExportLabel(entry: ReportedExport): string {
  return `${entry.sourceName} (${entry.editions.length}, ` +
    `${entry.javaScriptBytes} B JS · ${formatDeclarationTotal(entry)})`;
}

function formatDeclarationTotal(entry: ReportedExport): string {
  if (entry.facesMissing === 0) return `${entry.declarationBytes} B .d.ts`;
  // Every edition of one declaration publishes a face or none of them does — the
  // two artefacts plan from the same rows and differ only over whether private
  // declarations are planned at all. The mixed wording is written anyway rather
  // than asserted away, because a total that quietly omitted some editions would
  // be the one reading a §10 measurement must not have.
  if (entry.facesMissing === entry.editions.length) {
    return entry.editions.length === 1 ? "no .d.ts face" : "no .d.ts faces";
  }
  return `${entry.declarationBytes} B .d.ts, ${entry.facesMissing} without a face`;
}

/**
 * §3.4's list in one line, or nothing where every export publishes an entry
 * point.
 *
 * The absence is stated the way the spec's own visibility obligation states it —
 * the export "currently has no JavaScript entry points" — because that is the
 * fact an author targeting JS consumers came to inspect. It is not a warning:
 * the export is legal, and it remains a working Hexagon export that another
 * module imports, honors the constraint for, and calls (§3.4, §16(h)).
 */
export function formatZeroEntryPointExports(
  exports: readonly string[],
): string | undefined {
  if (exports.length === 0) return undefined;
  return `No JavaScript entry points: ${exports.join(", ")}`;
}

/** Renders one non-semantic view over the compiler's complete JavaScript artefact. */
export function renderGeneratedCodeView(
  javascript: string,
  sections: readonly GeneratedSection[],
  view: string,
): string {
  if (view === "complete" || sections.length === 0) return javascript;
  if (view.startsWith("specialization:")) {
    const name = view.slice("specialization:".length);
    const section = sections.find(({ generatedName }) => generatedName === name);
    if (section !== undefined) {
      const heading =
        `// ${section.generatedName} — ${section.sourceName}<${section.typeArguments.join(", ")}> · ${section.bytes} B\n`;
      return heading + javascript.slice(section.startOffset, section.endOffset) + "\n";
    }
  }

  let sourceShaped = javascript;
  const groups = [...groupGeneratedSections(sections)].map(
    ([sourceName, editions]) => ({
      sourceName,
      editions,
      startOffset: Math.min(...editions.map(({ startOffset }) => startOffset)),
      endOffset: Math.max(...editions.map(({ endOffset }) => endOffset)),
      bytes: editions.reduce((total, edition) => total + edition.bytes, 0),
    }),
  ).sort((left, right) => right.startOffset - left.startOffset);
  for (const group of groups) {
    const summary =
      `// ${group.sourceName} — ${group.editions.length} generated specializations hidden (${group.bytes} B)`;
    sourceShaped =
      sourceShaped.slice(0, group.startOffset) + summary +
      sourceShaped.slice(group.endOffset);
  }
  for (const section of sections) {
    sourceShaped = sourceShaped.replace(
      new RegExp(`^export \\{ ${escapeRegularExpression(section.generatedName)} \\};\\n?`, "mu"),
      "",
    );
  }
  sourceShaped = sourceShaped.replace(INTERNAL_CONSTRAINED_EXPORT, "");
  return sourceShaped;
}

/**
 * The Hexagon-to-Hexagon export of a constrained binding — the trailing-evidence
 * edition, which no `.d.ts` face admits and no reader of the source-shaped view
 * wrote.
 *
 * Keyed on the **alias**, because the local no longer predicts it: since #430
 * the alias is the binding's own name under Lexer §3.2's reserved prefix
 * (`export { plus as __plus };`), and either side may carry a collision suffix
 * independently. What separates this family from the other aliased exports is
 * the character after the prefix. Hexagon terms are non-uppercase-start, so a
 * `__`-alias that continues in lower case is one of these; the dictionary
 * exports beside it are `__<Constraint>_<Type>` and continue in upper case
 * (Dictionary Sharing §5). A specialization or a boundary wrapper aliases to an
 * ordinary source name and carries no prefix at all.
 */
const INTERNAL_CONSTRAINED_EXPORT =
  /^export \{ [$_\p{ID_Start}][\p{ID_Continue}$\u200c\u200d]* as __(?![\p{Lu}\p{Lt}])[$_\p{ID_Start}][\p{ID_Continue}$\u200c\u200d]* \};\n?/gmu;

function escapeRegularExpression(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
