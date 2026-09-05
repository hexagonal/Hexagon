/**
 * The Playground's editor buffer, laid out as the files a compiler sees, and the
 * map back.
 *
 * **The buffer is one file.** Since #829 a module is a named declaration and a
 * file holds as many as it writes (Modules §2.2), so the buffer goes to the
 * compiler as itself and the parser does the splitting: `module Helper` … `end
 * module Helper` is the language's own notation, not the Playground's, and
 * everything the old splitter did *besides* splitting — auto-importing a
 * block's siblings, accepting `module foo`, reading a header inside a string —
 * is now the language's answer, reported by the compiler at the offset the user
 * is looking at.
 *
 * What is left to map is therefore small. The buffer's own text needs no
 * translation at all: a compiler offset in it *is* an editor offset, because
 * nothing is prepended and nothing is masked. The hosted library sources
 * (`hosted-library.ts`) are the one file set the buffer has no room for, and
 * they map in neither direction — which is why go-to-definition on
 * `Vector.append` reports nothing rather than jumping somewhere off screen.
 *
 * So the map answers with `undefined` rather than a nearby offset. A refusal is
 * a correct answer here — a rename with one edit silently moved to offset zero
 * corrupts the document, where a rename that declines to run does not. The one
 * exception is `anchor`, which exists for diagnostics and is documented there.
 */

import { hostedLibrary } from "./hosted-library";

/**
 * The path the buffer is handed to the compiler under.
 *
 * A convenience of the host's and no part of the program: a module's identity is
 * the name its header declares, and the compiler reads no path (Modules §1,
 * §2.1). The one place the spelling is load-bearing is the repair for a buffer
 * that declares no module at all, whose fixit derives a name from the basename —
 * `main.hex` gives "write `module Main`", which is the name the examples use.
 */
export const bufferPath = "/main.hex";

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
}

/**
 * Translates between editor-buffer offsets and virtual-file positions.
 *
 * Only the buffer's own file is in the table. A hosted library is a real file to
 * the compiler and no part of the buffer, so it maps in neither direction.
 */
export class WorkspaceMap {
  readonly #bufferLength: number;

  constructor(bufferLength: number) {
    this.#bufferLength = bufferLength;
  }

  /**
   * Which file a buffer offset is in, and where — always the buffer's own, at
   * the offset it was asked about.
   *
   * The identity is the whole of the translation since #829, and it is stated as
   * a method rather than dropped because the *bounds* are still a question a
   * host request can get wrong, and because the callers ask one question ("where
   * does this editor position live?") whose answer used to be several files and
   * may be again.
   */
  locate(bufferOffset: number): FilePosition | undefined {
    if (bufferOffset < 0 || bufferOffset > this.#bufferLength) return undefined;
    return { path: bufferPath, offset: bufferOffset };
  }

  /** Where a virtual-file offset falls in the buffer, or nothing when it does not. */
  toBuffer(path: string, offset: number): number | undefined {
    if (path !== bufferPath) return undefined;
    if (offset < 0 || offset > this.#bufferLength) return undefined;
    return offset;
  }

  /**
   * A virtual-file span as a buffer range, or nothing when either end refuses.
   *
   * Both ends, deliberately: a span half outside the buffer has no honest range,
   * and clamping the missing end would produce one that selects text the span
   * never covered.
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
   * not compile. So a message from a hosted library is anchored at the nearest
   * position the buffer has rather than discarded. Requests answer through
   * `toBuffer`, which refuses instead.
   */
  anchor(path: string, offset: number): number {
    if (path !== bufferPath) return 0;
    return Math.max(0, Math.min(this.#bufferLength, offset));
  }
}

/**
 * The buffer as virtual files, with the map between them.
 *
 * Both the whole-program compile and the interactive session take their files
 * from here, so the two never disagree about what the user's program is.
 */
export function layOutWorkspace(source: string): WorkspaceLayout {
  return {
    files: [...hostedLibrary, { path: bufferPath, source }],
    map: new WorkspaceMap(source.length),
  };
}
