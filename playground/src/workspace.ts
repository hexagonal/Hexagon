/**
 * The Playground's editor buffer, laid out as the files a compiler sees, and the
 * map back.
 *
 * Nothing the user types is a compiled file. One buffer becomes N of them: a
 * virtual `/Name.hex` per `module` / `end module` block, the hosted library
 * sources, and a synthesized `/main.hex` whose text is the rest of the buffer
 * behind a prefix of imports the user never wrote. Every offset crossing that
 * boundary — in either direction — has to be translated, and the translation is
 * partial in both directions: a buffer position can name a `module` header line
 * that is in no file's text, and a compiler position can name the synthesized
 * prefix or a hosted library the buffer has no room for.
 *
 * So the map answers with `undefined` rather than a nearby offset. A refusal is
 * a correct answer here — a rename with one edit silently moved to offset zero
 * corrupts the document, where a rename that declines to run does not. The one
 * exception is `anchor`, which exists for diagnostics and is documented there.
 */

import type { PlaygroundDiagnostic } from "./protocol";
import { hostedModules, playgroundEquipment } from "./playground-equipment";
import { parseWorkspaceSource } from "./workspace-source";

/** The entry the Playground compiles and runs; the buffer's own text lives here. */
export const entryPath = "/main.hex";

/** One file as the compiler will see it. */
export interface VirtualFile {
  readonly path: string;
  readonly source: string;
}

/** A position in the virtual file set: which file, and how far into its text. */
export interface FilePosition {
  readonly path: string;
  readonly offset: number;
}

/** A half-open region of the editor buffer. */
export interface BufferRange {
  readonly startOffset: number;
  readonly endOffset: number;
}

export interface WorkspaceLayout {
  readonly files: readonly VirtualFile[];
  readonly map: WorkspaceMap;
  /** Errors in the Playground's own module notation; empty when it parsed. */
  readonly diagnostics: readonly PlaygroundDiagnostic[];
}

interface BufferFile {
  /** Where this file's text starts in the buffer. */
  readonly bufferStart: number;
  /** How much synthesized text precedes the buffer's own inside this file. */
  readonly prefixLength: number;
  readonly length: number;
}

/**
 * Translates between editor-buffer offsets and virtual-file positions.
 *
 * Only files carrying the user's text are in the table. A hosted library is a
 * real file to the compiler and no part of the buffer, so it maps in neither
 * direction — which is why go-to-definition on `Vector.append` reports nothing
 * rather than jumping somewhere that is not on screen.
 */
export class WorkspaceMap {
  readonly #files: ReadonlyMap<string, BufferFile>;
  readonly #bufferLength: number;

  constructor(files: ReadonlyMap<string, BufferFile>, bufferLength: number) {
    this.#files = files;
    this.#bufferLength = bufferLength;
  }

  /**
   * Which file a buffer offset is in, and where.
   *
   * A module body wins over `/main.hex`, which holds spaces in its place. The
   * `module` and `end module` lines are masked out of `/main.hex` as well, so
   * they land on whitespace and no request finds anything at one — which is the
   * answer the Playground's own notation should give.
   *
   * A body claims its own end offset — the `<=` — and that is not arbitrary,
   * though nothing is *found* at it. `codeActions` refuses a selection whose
   * two ends land in different files, so a selection running from inside a
   * block to the start of its `end module` line is answered only if that last
   * offset is still the block's. Under `<` it is `/main.hex`'s, and the whole
   * request is dropped.
   *
   * The other end is exclusive: a body starts after the opener's line break, so
   * no offset is ever claimed by two bodies at once.
   */
  locate(bufferOffset: number): FilePosition | undefined {
    if (bufferOffset < 0 || bufferOffset > this.#bufferLength) return undefined;
    for (const [path, file] of this.#files) {
      if (path === entryPath) continue;
      const local = bufferOffset - file.bufferStart;
      if (local >= 0 && local <= file.length) return { path, offset: local };
    }
    const main = this.#files.get(entryPath);
    if (main === undefined) return undefined;
    return { path: entryPath, offset: bufferOffset + main.prefixLength };
  }

  /** Where a virtual-file offset falls in the buffer, or nothing when it does not. */
  toBuffer(path: string, offset: number): number | undefined {
    const file = this.#files.get(path);
    if (file === undefined) return undefined;
    const local = offset - file.prefixLength;
    if (local < 0 || local > file.length) return undefined;
    return file.bufferStart + local;
  }

  /**
   * A virtual-file span as a buffer range, or nothing when either end refuses.
   *
   * Both ends, deliberately: a span half inside the synthesized import prefix
   * has no honest buffer range, and clamping the missing end would produce one
   * that selects text the span never covered.
   */
  toBufferRange(
    path: string,
    span: { readonly start: number; readonly end: number },
  ): BufferRange | undefined {
    const startOffset = this.toBuffer(path, span.start);
    const endOffset = this.toBuffer(path, span.end);
    if (startOffset === undefined || endOffset === undefined) return undefined;
    return { startOffset, endOffset };
  }

  /**
   * Somewhere in the buffer to show a diagnostic, always.
   *
   * The one place a refusal is the wrong answer. A compile that fails must show
   * the user why it failed, and a message dropped for having no buffer position
   * leaves the Errors tab claiming there is nothing wrong with source that will
   * not compile. So a message from a hosted library, or from the synthesized
   * prefix, is anchored at the nearest position the buffer has rather than
   * discarded. Requests answer through `toBuffer`, which refuses instead.
   */
  anchor(path: string, offset: number): number {
    const file = this.#files.get(path);
    if (file === undefined) return 0;
    const local = offset - file.prefixLength;
    return file.bufferStart + Math.max(0, Math.min(file.length, local));
  }
}

/**
 * The buffer as virtual files, with the map between them.
 *
 * Both the whole-program compile and the interactive session take their files
 * from here, so the two never disagree about what the user's program is.
 */
export function layOutWorkspace(source: string): WorkspaceLayout {
  const workspace = parseWorkspaceSource(source);
  const shadowedCompanions = new Set(workspace.modules.map(({ name }) => name));
  const hosted = hostedModules.filter(
    ({ companion }) => !shadowedCompanions.has(companion),
  );
  // Auto-import only the equipment a buffer mentions; hosted prelude sources
  // (Option, Vector) are supplied for resolution but stay implicit via the
  // compiler's prelude, and equipment the buffer never names would cost every
  // program an import line and an instance inventory it does not use.
  const spelled = spelledWords(source);
  const declaredTypes = declaredTypeNames(source);
  const equipmentPrefix = hosted
    .filter(({ companion }) =>
      playgroundEquipment.includes(companion) && spelled.has(companion)
    )
    .map(({ companion, path }) => {
      const specifier = JSON.stringify(`.${path.slice(0, -".hex".length)}`);
      // Both halves of the companion idiom: the alias reaches `Rat.create`, and
      // the named import is what makes the bare `Rat` face writable in an
      // annotation — a namespace import binds no type name (Modules §5.1).
      // The named half is dropped where the buffer declares that type itself,
      // which is a same-namespace collision at the import line rather than a
      // shadowing; a `module Rat` block never reaches here, having already left
      // `hosted` through `shadowedCompanions`.
      const named = declaredTypes.has(companion)
        ? []
        : [`import { ${companion} } from ${specifier}`];
      return [`import * as ${companion} from ${specifier}`, ...named].join("\n");
    }).join("\n");
  const mainPrefix = equipmentPrefix.length === 0 ? "" : `${equipmentPrefix}\n`;

  const files: VirtualFile[] = hosted.map(({ path, source: hostedSource }) => ({
    path,
    source: hostedSource,
  }));
  const buffered = new Map<string, BufferFile>();
  for (const module of workspace.modules) {
    files.push({ path: module.path, source: module.text });
    buffered.set(module.path, {
      bufferStart: module.sourceOffset,
      prefixLength: 0,
      length: module.text.length,
    });
  }
  files.push({ path: entryPath, source: `${mainPrefix}${workspace.mainText}` });
  // `/main.hex` is the whole buffer, masked and prefixed: `parseWorkspaceSource`
  // replaces each module block with spaces rather than removing it, so offsets
  // past a module are still the buffer's own.
  buffered.set(entryPath, {
    bufferStart: 0,
    prefixLength: mainPrefix.length + workspace.mainPrefixLength,
    length: source.length,
  });

  return {
    files,
    map: new WorkspaceMap(buffered, source.length),
    diagnostics: workspace.diagnostics,
  };
}

/**
 * Every maximal run of identifier characters in the buffer.
 *
 * The gate this feeds has to over-approximate. A name spelled only in a comment
 * or a string buys a spare import — which is what every workspace carried
 * unconditionally before — while a missed mention fails a compile against an
 * import the buffer does not contain and the user cannot add by looking at it.
 *
 * A run is the lexer's identifier continuation set rather than `\b`'s ASCII
 * word characters, so `Ratio` and a companion's name inside a non-ASCII
 * identifier are not mentions. The runs are taken over the whole buffer and not
 * `/main.hex`'s masked text, so which side of a `module` line a name is spelled
 * on cannot change the answer — a block's own file never carries the prefix,
 * but its values reach the entry, and the cheap gate does not model that.
 */
function spelledWords(source: string): ReadonlySet<string> {
  return new Set(source.match(/[\p{ID_Continue}$]+/gu) ?? []);
}

/**
 * Every name the buffer appears to declare as a type.
 *
 * This gate over-approximates in the *opposite* direction to `spelledWords`,
 * and for the same reason: a name spelled after `record` inside a comment costs
 * the buffer the named half of one equipment import, and the annotation that
 * wanted it draws a message naming both working spellings. A missed declaration
 * costs the buffer its own `record Rat`, colliding with an import line the user
 * cannot see, cannot move, and cannot delete.
 */
function declaredTypeNames(source: string): ReadonlySet<string> {
  const heads = source.matchAll(
    /(?<![\p{ID_Continue}$])(?:record|union|type)\s+([\p{ID_Start}_][\p{ID_Continue}$]*)/gu,
  );
  return new Set([...heads].map(([, name]) => name!));
}
