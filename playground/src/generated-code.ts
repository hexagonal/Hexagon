import type { GeneratedJavaScriptSection } from "./protocol";

/** Groups editions by their originating Hexagon declaration for UI navigation. */
export function groupGeneratedSections(
  sections: readonly GeneratedJavaScriptSection[],
): ReadonlyMap<string, readonly GeneratedJavaScriptSection[]> {
  const groups = new Map<string, GeneratedJavaScriptSection[]>();
  for (const section of sections) {
    const existing = groups.get(section.sourceName) ?? [];
    existing.push(section);
    groups.set(section.sourceName, existing);
  }
  return groups;
}

/** Renders one non-semantic view over the compiler's complete JavaScript artefact. */
export function renderGeneratedCodeView(
  javascript: string,
  sections: readonly GeneratedJavaScriptSection[],
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
  sourceShaped = sourceShaped.replace(
    /^export \{ [$_\p{ID_Start}][\p{ID_Continue}$\u200c\u200d]* as __hex_export\d+ \};\n?/gmu,
    "",
  );
  return sourceShaped;
}

function escapeRegularExpression(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
