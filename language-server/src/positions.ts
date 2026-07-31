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
 * the protocol names them by URI, and the mapping is not reliably reversible by
 * string surgery — `file:///c:/A` and `file:///C:/a` can be the same file. The
 * server therefore remembers the URI it was given for every path it hands the
 * compiler, and converts back by lookup rather than by construction.
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
 * A path is derived from a URI once and then reused, so two spellings of one URI
 * cannot become two files in the session. Converting a path back to a URI is a
 * lookup, falling back to construction only for a file the server never saw —
 * which cannot normally happen, since every path the compiler knows arrived
 * through here.
 */
export class UriPaths {
  readonly #pathsByUri = new Map<string, string>();
  readonly #urisByPath = new Map<string, string>();

  /** The compiler path for a document URI, remembering the pairing. */
  toPath(uri: string): string {
    const known = this.#pathsByUri.get(uri);
    if (known !== undefined) return known;
    const path = normalize(fileSystemPath(uri));
    this.#pathsByUri.set(uri, path);
    // First URI seen for a path wins, so the pairing cannot flip underneath a
    // client that spells the same file two ways.
    if (!this.#urisByPath.has(path)) this.#urisByPath.set(path, uri);
    return path;
  }

  /** The URI a compiler path came from, or the one it would have. */
  toUri(path: string): string {
    const known = this.#urisByPath.get(path);
    if (known !== undefined) return known;
    return pathToFileURL(path).toString();
  }

  forget(uri: string): void {
    const path = this.#pathsByUri.get(uri);
    if (path === undefined) return;
    this.#pathsByUri.delete(uri);
    if (this.#urisByPath.get(path) === uri) this.#urisByPath.delete(path);
  }
}

/**
 * The filesystem path a URI names. `file:` URIs percent-encode and can spell a
 * drive letter either way, so this defers to Node rather than parsing; anything
 * that is not a `file:` URI is used verbatim, which keeps an untitled or virtual
 * document a distinct key instead of an error.
 */
function fileSystemPath(uri: string): string {
  if (!uri.startsWith("file:")) return uri;
  try {
    return fileURLToPath(uri);
  } catch {
    return uri;
  }
}

/** The session's own spelling: `/`-separated, `.` and `..` resolved. */
function normalize(path: string): string {
  const forward = path.replaceAll("\\", "/");
  const absolute = forward.startsWith("/");
  const parts: string[] = [];
  for (const part of forward.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return `${absolute ? "/" : ""}${parts.join("/")}`;
}
