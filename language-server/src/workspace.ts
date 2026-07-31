/**
 * The file set the compiler analyses, and where its contents come from.
 *
 * A Hexagon project is a module graph, so answering anything about one file
 * needs the others: a definition usually lives in a module the user has not
 * opened, and a diagnostic in an unopened module can be the reason the open one
 * fails. The session therefore holds the whole workspace, not just what is on
 * screen.
 *
 * Two sources feed it, and precedence between them is the whole point:
 *
 * - **Open documents win.** While a document is open the editor's buffer is the
 *   truth, unsaved edits included. Reading disk instead would answer about text
 *   the user cannot see.
 * - **Disk fills in the rest.** Files never opened, and files closed again,
 *   come from disk so the graph stays whole.
 *
 * This is also the only part of the server that touches a filesystem. The
 * compiler is deliberately free of one, so deciding what a workspace contains is
 * the host's job, and it stops here.
 */

import { readFile, readdir, realpath, stat } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { TextDocument } from "vscode-languageserver-textdocument";
import { AnalysisSession } from "../../compiler/src/index.js";
import { UriPaths } from "./positions.js";

const HEXAGON_EXTENSION = ".hex";

/** Directories never worth walking, whatever a workspace root contains. */
const SKIPPED_DIRECTORIES = new Set([".git", "node_modules", "dist", "coverage", ".vscode"]);

export class Workspace {
  readonly session = new AnalysisSession();
  readonly uris = new UriPaths();
  /** URIs whose text the editor currently owns, so disk must not overwrite them. */
  readonly #openUris = new Set<string>();
  /**
   * The session path each URI resolves to, remembered from the first time the
   * URI was seen. Two names for one file — a symlink and its target — must reach
   * one session entry, or the file compiles twice and every declaration in it is
   * reported as a duplicate of itself. The walk already dedupes by real path;
   * this is the same rule for the names an editor opens, which the walk never
   * chose. Cached because resolving is a syscall and an edit must not pay one.
   */
  readonly #pathByUri = new Map<string, string>();
  /** Session path for each real path the walk resolved — see `#pathOf`. */
  readonly #pathsByRealPath = new Map<string, string>();

  /**
   * Reads every Hexagon file under a workspace root. Failures are reported
   * rather than thrown: a workspace with one unreadable directory should still
   * give language support for the rest of itself.
   */
  async addRoot(rootPath: string, onError: (message: string) => void): Promise<number> {
    let added = 0;
    for (const { path: found, realPath } of await hexagonFilesUnder(rootPath, onError)) {
      // Route the disk path through the URI mapping rather than handing it to
      // the session directly, so a file discovered here and the same file opened
      // later are one entry under one spelling.
      const uri = pathToFileURL(found).toString();
      if (this.#openUris.has(uri)) continue;
      const path = this.uris.toPath(uri);
      try {
        this.session.setFile(path, await readFile(found, "utf8"));
        this.#pathsByRealPath.set(realPath, path);
        added += 1;
      } catch (error) {
        onError(`could not read ${found}: ${messageOf(error)}`);
      }
    }
    return added;
  }

  /** Takes over a file's contents from the editor, unsaved edits included. */
  async openDocument(document: TextDocument): Promise<void> {
    this.#openUris.add(document.uri);
    this.session.setFile(await this.#pathOf(document.uri), document.getText());
  }

  updateDocument(document: TextDocument): void {
    // Never resolves: an edit arrives per keystroke, and the path was settled
    // when the document opened. A URI that was never opened falls back to its
    // literal path, which is the same answer the walk would have given it.
    this.session.setFile(
      this.#pathByUri.get(document.uri) ?? this.uris.toPath(document.uri),
      document.getText(),
    );
  }

  /**
   * Hands a file back to disk. The buffer may have been closed without saving,
   * so the on-disk text is re-read rather than assumed to match; a file that has
   * no on-disk text — it was never saved — leaves the session with it.
   */
  async closeDocument(uri: string): Promise<void> {
    this.#openUris.delete(uri);
    await this.#reloadFromDisk(uri);
  }

  /** A file the editor reports as created or changed on disk, outside any buffer. */
  async refreshFromDisk(uri: string): Promise<void> {
    if (this.#openUris.has(uri)) return;
    await this.#reloadFromDisk(uri);
  }

  async #reloadFromDisk(uri: string): Promise<void> {
    const path = await this.#pathOf(uri);
    try {
      // The session is keyed by the compiler's spelling of the path; the read
      // uses the platform's, which is what the URI actually names.
      this.session.setFile(path, await readFile(fileSystemPath(uri), "utf8"));
    } catch {
      this.session.removeFile(path);
    }
  }

  async deleteFile(uri: string): Promise<void> {
    this.#openUris.delete(uri);
    this.session.removeFile(await this.#pathOf(uri));
    this.#pathByUri.delete(uri);
  }

  /**
   * The session path for a URI.
   *
   * Normally this is just the URI's own path. The exception is a second name for
   * a file the walk already found — a symlink beside its target — where the walk
   * kept one name and the editor may open the other. Keying the buffer by its
   * own URI would put one file into the session twice, and every declaration in
   * it would then be reported as a duplicate of itself.
   *
   * Resolution happens against what the walk recorded rather than by rewriting
   * the path, so a scanned file keeps the spelling the workspace uses and a file
   * the walk never saw keeps its own.
   */
  async #pathOf(uri: string): Promise<string> {
    const known = this.#pathByUri.get(uri);
    if (known !== undefined) return known;
    const literal = this.uris.toPath(uri);
    const scanned = this.#pathsByRealPath.get(await realPathOf(fileSystemPath(uri)));
    const path = scanned ?? literal;
    this.#pathByUri.set(uri, path);
    return path;
  }
}

/** A discovered file, with the identity that makes two names for it one file. */
interface FoundFile {
  readonly path: string;
  readonly realPath: string;
}

async function hexagonFilesUnder(
  root: string,
  onError: (message: string) => void,
): Promise<readonly FoundFile[]> {
  const found: FoundFile[] = [];
  const pending = [root];
  // Directories already walked, by the real path they resolve to. Following
  // symlinks means the tree is a graph: `ln -s . loop` makes a directory contain
  // itself, and a walk with no memory descends it until the path length stops
  // it, turning one file into dozens of modules that all shadow each other.
  // Identity has to be the resolved path, since two links to one directory are
  // two names for the same place.
  const walked = new Set<string>();
  // The same, for files: two links to one source file are one module, and
  // compiling it twice would report every declaration in it as a duplicate.
  const collected = new Set<string>();
  for (let directory = pending.pop(); directory !== undefined; directory = pending.pop()) {
    const directoryIdentity = await realPathOf(directory);
    if (walked.has(directoryIdentity)) continue;
    walked.add(directoryIdentity);
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      onError(`could not list ${directory}: ${messageOf(error)}`);
      continue;
    }
    for (const entry of entries) {
      const path = join(directory, entry.name);
      // A symlink reports as neither a file nor a directory, so a workspace that
      // links its source tree in — a common monorepo layout — would otherwise
      // get no language support at all, silently. `stat` follows the link to ask
      // what it actually points at.
      const kind = entry.isSymbolicLink() ? await resolvedKind(path) : entryKind(entry);
      if (kind === "directory") {
        if (SKIPPED_DIRECTORIES.has(entry.name)) continue;
        pending.push(path);
      } else if (kind === "file" && entry.name.endsWith(HEXAGON_EXTENSION)) {
        const realPath = await realPathOf(path);
        if (collected.has(realPath)) continue;
        collected.add(realPath);
        found.push({ path, realPath });
      }
    }
  }
  return found;
}

/** A path's identity for cycle detection; the path itself if it cannot resolve. */
async function realPathOf(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch {
    return path;
  }
}

type EntryKind = "file" | "directory" | "other";

function entryKind(entry: { isFile(): boolean; isDirectory(): boolean }): EntryKind {
  if (entry.isDirectory()) return "directory";
  return entry.isFile() ? "file" : "other";
}

/** What a symlink points at, or `other` when it dangles or cannot be read. */
async function resolvedKind(path: string): Promise<EntryKind> {
  try {
    return entryKind(await stat(path));
  } catch {
    return "other";
  }
}

function fileSystemPath(uri: string): string {
  if (!uri.startsWith("file:")) return uri;
  try {
    return fileURLToPath(uri);
  } catch {
    return uri;
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
