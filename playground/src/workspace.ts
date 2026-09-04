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

import { Source, lex } from "../../compiler/src/index";

import type { PlaygroundDiagnostic } from "./protocol";
import { hostedModules, playgroundEquipment } from "./playground-equipment";
import { parseWorkspaceSource } from "./workspace-source";

/** The entry the Playground compiles and runs; the buffer's own text lives here. */
export const entryPath = "/main.hex";

/**
 * The module every virtual file has to declare since #829 (Modules §2.1), as
 * synthesized text the buffer does not contain.
 *
 * The Playground's notation writes a module's *name* on its `module` line and
 * nothing else, and that line is masked out of every file — so the header a
 * file's own text now owes is minted here rather than taken from the buffer,
 * and counted into `prefixLength` like the import prefix beside it. The
 * entry's name is `Main`, after the path it has always been compiled at.
 *
 * **Indented to the body's own first line**, which is not cosmetic: the layout
 * pass takes a file's baseline from its first item (Lexer & Layout §5), and a
 * block whose body the user indented under the `module` line — the ordinary way
 * to write one — would otherwise have every item read as a continuation of a
 * header standing at column zero. Matching the body puts the header *at* the
 * baseline the body already establishes, so the file lays out exactly as the
 * block's text did before it had a header at all.
 */
function headerFor(name: string, body: string): string {
  const firstContent = body.split("\n").find((line) => line.trim() !== "") ?? "";
  const indent = /^[ \t]*/u.exec(firstContent)![0];
  return `${indent}module ${name}\n\n`;
}

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
      // `prefixLength` back on, which is `toBuffer` read the other way: a block's
      // file carries a synthesized `module Name` header since #829, so its own
      // offsets are that much further along than the buffer's.
      if (local >= 0 && local <= file.length) {
        return { path, offset: local + file.prefixLength };
      }
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
  const aliased = aliasedModules(workspace.mainText);
  const equipmentPrefix = hosted
    .filter(({ companion }) =>
      playgroundEquipment.includes(companion) && spelled.has(companion) &&
      !aliased.has(companion)
    )
    .map(({ companion }) => {
      // **One line**, the companion idiom's own (Modules §5.3). The alias
      // reaches `Rat.create`, and since §5.1 rule 2's companion fallback (#531)
      // the same alias answers the bare `Rat` face in an annotation — so the
      // named half this used to inject beside it, and the declared-type gate
      // that had to drop it where the buffer declared its own `Rat`, are both
      // gone. In the type namespace the alias binds nothing, so a buffer's own
      // `record Rat` — or its own `import { Rat }` — simply wins with nothing
      // to collide against. The alias namespace is the one it does claim, and
      // there a second alias of one name is that namespace's own collision
      // rule (Modules §5.2), which is what `aliasedModules` steps out of.
      //
      // The line carries no path since #829 (Modules §3.1): the hosted module
      // declares its own name, and that name is the whole of what an import
      // writes.
      return `import ${companion}`;
    }).join("\n");
  const mainPrefix = equipmentPrefix.length === 0 ? "" : `${equipmentPrefix}\n`;

  const files: VirtualFile[] = hosted.map(({ path, source: hostedSource }) => ({
    path,
    source: hostedSource,
  }));
  const buffered = new Map<string, BufferFile>();
  for (const module of workspace.modules) {
    const header = headerFor(module.name, module.text);
    files.push({ path: module.path, source: `${header}${module.text}` });
    buffered.set(module.path, {
      bufferStart: module.sourceOffset,
      prefixLength: header.length,
      length: module.text.length,
    });
  }
  const mainHeader = headerFor("Main", workspace.mainText);
  files.push({ path: entryPath, source: `${mainHeader}${mainPrefix}${workspace.mainText}` });
  // `/main.hex` is the whole buffer, masked and prefixed: `parseWorkspaceSource`
  // replaces each module block with spaces rather than removing it, so offsets
  // past a module are still the buffer's own.
  buffered.set(entryPath, {
    bufferStart: 0,
    prefixLength: mainHeader.length + mainPrefix.length + workspace.mainPrefixLength,
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
 * Every name the entry's own text binds as a module alias.
 *
 * This gate runs the other way round from `spelledWords`: a name found here
 * *drops* an import rather than adding one. A miss leaves two `import Rat`
 * lines in one file — the alias namespace's collision rule (Modules §5.2),
 * reported at the line the user wrote, beneath the line no buffer shows.
 *
 * So it reads tokens rather than text, because a legal alias import is not a
 * line: comments are trivia between its tokens (`import (* why *) Rat`),
 * and the head may break across lines. What the buffer *shows* is not the shape
 * the compiler reads, and a gate whose whole job is to agree with the compiler
 * has to read what it reads. The lexer settles the near misses for free, each
 * in the direction it wants: a commented-out `// import Rat` is trivia and
 * binds nothing, and an import head spelled inside a string literal is part of
 * that one token — neither suppresses anything.
 *
 * A buffer that does not lex at all — an unterminated string or block comment
 * swallowing the rest of it — yields fewer heads rather than phantom ones, so
 * the direction a mid-edit buffer fails in is the mild one, and that buffer
 * carries a lex error of its own and compiles no further either way. The scan's
 * diagnostics are dropped for that reason: every one of them is the compile's
 * to report, against the same text.
 *
 * Keyed on the alias rather than on the module it names, because the collision
 * is over the bound name: `import Helper as Rat` claims `Rat` just
 * as firmly, and the prefix has to stay out of its way. And it reads
 * `/main.hex`'s masked text where `spelledWords` reads the whole buffer, which
 * is the same fact told twice: a block's own file never carries the prefix, so
 * a name spelled inside a block can still want one, and an alias bound inside
 * one collides with nothing and must not take it away. That text carries the
 * block imports `parseWorkspaceSource` synthesizes, so the scan reads those
 * too — a block named for a companion has already taken that companion out of
 * `hosted`, so the two never meet.
 */
function aliasedModules(mainText: string): ReadonlySet<string> {
  const { tokens } = lex(new Source.File(Source.fileId(0), entryPath, mainText));
  const aliases = new Set<string>();
  for (const [index, token] of tokens.entries()) {
    if (token.kind !== "Import") continue;
    // The head names a module and binds an alias, and the two are the same
    // token only when the head writes no `as` (Modules §3.1): `import Geometry`
    // binds `Geometry`, `import Helper as Rat` binds `Rat`, and a dotted name
    // binds its last segment. What is bound is what collides, so the scan reads
    // the whole head — an `as` after the module name moves the answer, and
    // reading the first token alone would let `import Helper as Rat` past a
    // gate whose whole job is to see it.
    //
    // Uppercase-start mandatorily — a lowercase alias is the parser's error to
    // report and binds no companion's name whatever it does with it. The
    // Playground's own `module X` header is no near miss here: it is rewritten
    // to a synthesized `import X` line before this scan runs and is
    // masked out of the text everywhere else.
    const written = tokens[index + 1];
    if (written?.kind !== "UpperName") continue;
    const as = tokens[index + 2];
    const renamed = tokens[index + 3];
    if (as?.kind === "NonUpperName" && as.text === "as") {
      if (renamed?.kind === "UpperName") aliases.add(renamed.text);
      continue;
    }
    // The default alias is the written name's last segment; the lexer splits a
    // dotted head into names and dots, so the *written* token here is already
    // the first segment and the last is whatever the dot run ends on.
    let last = written.text;
    let at = index + 1;
    for (;;) {
      const dot = tokens[at + 1];
      const segment = tokens[at + 2];
      if (dot?.kind !== "Dot" || segment?.kind !== "UpperName") break;
      last = segment.text;
      at += 2;
    }
    aliases.add(last);
  }
  return aliases;
}

