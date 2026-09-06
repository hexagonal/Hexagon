/**
 * The one place LSP coordinates and compiler coordinates meet.
 *
 * Both systems count UTF-16 code units and number lines from zero, which is not
 * a coincidence: `compiler/src/support/source.ts` chose that representation so
 * spans could cross this boundary without a lossy conversion. So the compiler to
 * LSP direction is a rename, not a computation — a `Source.Span` already carries
 * the line and column LSP asks for.
 *
 * The other direction is the one that needs text. LSP asks about a line and a
 * character; the compiler wants an absolute offset, and only the document's own
 * line index can relate them. That is why the conversion lives here and takes a
 * `TextDocument`: the rest of the server never holds both coordinate systems at
 * once, which is what `language-server/README.md` asks for.
 *
 * URIs are the other half of the boundary. The compiler names files by path and
 * the protocol names them by URI, and reconstructing a URI from a path does not
 * reliably reproduce the one the client sent — percent-encoding and drive-letter
 * case both vary. The server therefore remembers the URI it was given for every
 * path it hands the compiler and converts back by lookup, so a location it
 * returns is spelled the way the client spells that file. For the files the
 * client has never named — most of a project, since a walk finds every module
 * nobody opened — the URI is built from the client's spelling of the workspace
 * folder the file lies in, which is the same rule reaching one level further out.
 */

import { fileURLToPath, pathToFileURL } from "node:url";
import type { Position, Range } from "vscode-languageserver";
import type { TextDocument } from "vscode-languageserver-textdocument";
import type { Source } from "../../compiler/src/index.js";

/** A compiler span rendered as the protocol's range. Total, and allocation only. */
export function rangeOfSpan(span: Source.Span): Range {
  return {
    start: { line: span.start.line, character: span.start.column },
    end: { line: span.end.line, character: span.end.column },
  };
}

/** The absolute offset an LSP position names in this document. */
export function offsetOfPosition(document: TextDocument, position: Position): number {
  return document.offsetAt(position);
}

/**
 * Remembers which URI produced which compiler path, in both directions.
 *
 * Only URIs the **client** sent are remembered. A path the server found itself
 * — the great majority, since a walk finds every module the user has not opened
 * — has no client URI, and one is built for it on demand, under the client's
 * own spelling of the root it lies in (`rootSpelling`). Storing a
 * server-built URI as though the client had sent it is the mistake this
 * separation exists to prevent: the walk runs before any document is opened, so
 * it would own every spelling, and every location the server reported would
 * come back under a path the user's editor does not recognise as theirs.
 *
 * Deciding *which file* a URI names is not this class's job and is deliberately
 * elsewhere: `Workspace.pathFor` settles that, once, for every way into the
 * server, and hands the answer back here through `remember`.
 */
export class UriPaths {
  readonly #urisByPath = new Map<string, string>();
  /** The client's spelling of each resolved root — see `rootSpelling`. */
  readonly #roots = new Map<string, string>();

  /**
   * Pairs a client's URI with the session path the workspace settled on for it.
   *
   * One direction only, and deliberately: URI-to-path is `Workspace.pathFor`'s,
   * because deciding which file a URI names needs the filesystem and the walk's
   * own answers, neither of which belongs here. This is told the answer.
   *
   * First URI seen for a path wins, so a location the server reports keeps the
   * spelling the client used rather than flipping between two of them.
   */
  remember(uri: string, path: string): void {
    if (!this.#urisByPath.has(path)) this.#urisByPath.set(path, uri);
  }

  /**
   * How the client spells a directory this server resolved — its workspace
   * folder, against the canonical path discovery settled it to.
   *
   * Registered per root, and read by `toUri` for a file the client has never
   * named. Without it, "go to definition" on a module the user has not opened
   * would answer with a location outside the folder they opened — `/private/var`
   * beside a workspace at `/var`, a resolved checkout beside a symlinked one —
   * which an editor shows as a second, unrelated file.
   */
  rootSpelling(canonical: string, literal: string): void {
    if (canonical === literal) return;
    this.#roots.set(canonical, literal);
  }

  /** The URI a compiler path came from, or the one it would have. */
  toUri(path: string): string {
    const known = this.#urisByPath.get(path);
    if (known !== undefined) return known;
    return pathToFileURL(this.#asClientSpells(path)).toString();
  }

  /** `path` under the client's spelling of the deepest root containing it. */
  #asClientSpells(path: string): string {
    let best: { canonical: string; literal: string } | undefined;
    for (const [canonical, literal] of this.#roots) {
      if (path !== canonical && !path.startsWith(`${canonical}/`)) continue;
      if (best === undefined || canonical.length > best.canonical.length) {
        best = { canonical, literal };
      }
    }
    return best === undefined ? path : best.literal + path.slice(best.canonical.length);
  }
}

/**
 * The filesystem path a URI names. `file:` URIs percent-encode and can spell a
 * drive letter either way, so this defers to Node rather than parsing; anything
 * that is not a `file:` URI is used verbatim, which keeps an untitled or virtual
 * document a distinct key instead of an error.
 */
export function fileSystemPath(uri: string): string {
  if (!uri.startsWith("file:")) return uri;
  try {
    return fileURLToPath(uri);
  } catch {
    return uri;
  }
}
