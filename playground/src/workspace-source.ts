import { Source, lex } from "../../compiler/src/index";

import type { PlaygroundDiagnostic } from "./protocol";

export interface WorkspaceModule {
  readonly name: string;
  readonly path: string;
  readonly text: string;
  /** Adds a module-local compiler offset back into the combined document. */
  readonly sourceOffset: number;
  readonly headerOffset: number;
}

export interface WorkspaceSource {
  readonly mainText: string;
  readonly mainPrefixLength: number;
  readonly modules: readonly WorkspaceModule[];
  readonly diagnostics: readonly PlaygroundDiagnostic[];
}

interface OpenModule {
  readonly name: string;
  readonly nameStart: number;
  readonly headerStart: number;
  readonly bodyStart: number;
}

interface Line {
  readonly start: number;
  readonly contentEnd: number;
  readonly end: number;
  readonly text: string;
}

/**
 * Splits the playground's single-document workspace notation into real virtual
 * Hexagon files. This is a host extension; `module` and `end` remain ordinary
 * names in `.hex` files compiled outside the playground.
 */
export function parseWorkspaceSource(source: string): WorkspaceSource {
  const diagnostics: PlaygroundDiagnostic[] = [];
  const modules: WorkspaceModule[] = [];
  const maskedRanges: { readonly start: number; readonly end: number }[] = [];
  const names = new Set<string>();
  let open: OpenModule | undefined;

  for (const line of sourceLines(source)) {
    const opener = /^module[ \t]+(\S(?:.*?\S)?)[ \t]*$/u.exec(line.text);
    const closer = /^end[ \t]+module[ \t]+(\S(?:.*?\S)?)[ \t]*$/u.exec(line.text);

    if (open === undefined) {
      if (closer !== null) {
        diagnostics.push(diagnostic(
          "`end module` has no matching module block",
          line.start,
          line.contentEnd,
        ));
        continue;
      }
      if (opener === null) continue;

      const name = opener[1]!;
      const nameStart = line.start + line.text.indexOf(name);
      if (!isUpperName(name)) {
        diagnostics.push(diagnostic(
          "a playground module name must be an uppercase-start identifier",
          nameStart,
          nameStart + name.length,
        ));
      }
      if (names.has(name)) {
        diagnostics.push(diagnostic(
          `playground module \`${name}\` is declared more than once`,
          nameStart,
          nameStart + name.length,
        ));
      }
      names.add(name);
      open = {
        name,
        nameStart,
        headerStart: line.start,
        bodyStart: line.end,
      };
      continue;
    }

    if (opener !== null) {
      diagnostics.push(diagnostic(
        "playground module blocks cannot nest; close the current module first",
        line.start,
        line.contentEnd,
      ));
      continue;
    }
    if (closer === null) continue;

    const closingName = closer[1]!;
    const closingNameStart = line.start + line.text.lastIndexOf(closingName);
    if (closingName !== open.name) {
      diagnostics.push(diagnostic(
        `module block opened as \`${open.name}\` but closes as \`${closingName}\``,
        closingNameStart,
        closingNameStart + closingName.length,
      ));
    }
    modules.push({
      name: open.name,
      path: `/${open.name}.hex`,
      text: source.slice(open.bodyStart, line.start),
      sourceOffset: open.bodyStart,
      headerOffset: open.headerStart,
    });
    maskedRanges.push({ start: open.headerStart, end: line.end });
    open = undefined;
  }

  if (open !== undefined) {
    diagnostics.push(diagnostic(
      `module \`${open.name}\` is missing \`end module ${open.name}\``,
      open.nameStart,
      open.nameStart + open.name.length,
    ));
  }

  const imports = modules.map(({ name }) =>
    `import * as ${name} from ${JSON.stringify(`./${name}`)}`
  );
  const prefix = imports.length === 0 ? "" : `${imports.join("\n")}\n`;
  return {
    mainText: `${prefix}${maskSource(source, maskedRanges)}`,
    mainPrefixLength: prefix.length,
    modules,
    diagnostics,
  };
}

function isUpperName(name: string): boolean {
  const file = new Source.File(Source.fileId(0), "module-name.hex", name);
  const result = lex(file);
  return result.diagnostics.length === 0 && result.tokens.length === 2 &&
    result.tokens[0]?.kind === "UpperName";
}

function sourceLines(source: string): readonly Line[] {
  const lines: Line[] = [];
  let start = 0;
  while (start < source.length) {
    let contentEnd = start;
    while (contentEnd < source.length && source[contentEnd] !== "\n" && source[contentEnd] !== "\r") {
      contentEnd += 1;
    }
    let end = contentEnd;
    if (source[end] === "\r" && source[end + 1] === "\n") end += 2;
    else if (source[end] === "\r" || source[end] === "\n") end += 1;
    lines.push({ start, contentEnd, end, text: source.slice(start, contentEnd) });
    start = end;
  }
  if (source.length === 0) lines.push({ start: 0, contentEnd: 0, end: 0, text: "" });
  return lines;
}

function maskSource(
  source: string,
  ranges: readonly { readonly start: number; readonly end: number }[],
): string {
  if (ranges.length === 0) return source;
  const characters = source.split("");
  // Split into UTF-16 code units so indexes remain compiler/LSP offsets even
  // when a masked module body contains astral string or comment characters.
  for (const { start, end } of ranges) {
    for (let offset = start; offset < end; offset += 1) {
      if (source[offset] !== "\n" && source[offset] !== "\r") characters[offset] = " ";
    }
  }
  return characters.join("");
}

function diagnostic(
  message: string,
  startOffset: number,
  endOffset: number,
): PlaygroundDiagnostic {
  return { severity: "error", message, startOffset, endOffset };
}
