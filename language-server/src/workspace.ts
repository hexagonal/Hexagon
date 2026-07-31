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

import { readFile, readdir, stat } from "node:fs/promises";
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
   * Reads every Hexagon file under a workspace root. Failures are reported
   * rather than thrown: a workspace with one unreadable directory should still
   * give language support for the rest of itself.
   */
  async addRoot(rootPath: string, onError: (message: string) => void): Promise<number> {
    let added = 0;
    for (const found of await hexagonFilesUnder(rootPath, onError)) {
      // Route the disk path through the URI mapping rather than handing it to
      // the session directly, so a file discovered here and the same file opened
      // later are one entry under one spelling.
      const uri = pathToFileURL(found).toString();
      if (this.#openUris.has(uri)) continue;
      try {
        this.session.setFile(this.uris.toPath(uri), await readFile(found, "utf8"));
        added += 1;
      } catch (error) {
        onError(`could not read ${found}: ${messageOf(error)}`);
      }
    }
    return added;
  }

  /** Takes over a file's contents from the editor, unsaved edits included. */
  openDocument(document: TextDocument): void {
    this.#openUris.add(document.uri);
    this.session.setFile(this.uris.toPath(document.uri), document.getText());
  }

  updateDocument(document: TextDocument): void {
    this.session.setFile(this.uris.toPath(document.uri), document.getText());
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
    const path = this.uris.toPath(uri);
    try {
      // The session is keyed by the compiler's spelling of the path; the read
      // uses the platform's, which is what the URI actually names.
      this.session.setFile(path, await readFile(fileSystemPath(uri), "utf8"));
    } catch {
      this.session.removeFile(path);
    }
  }

  deleteFile(uri: string): void {
    this.#openUris.delete(uri);
    this.session.removeFile(this.uris.toPath(uri));
  }
}

async function hexagonFilesUnder(
  root: string,
  onError: (message: string) => void,
): Promise<readonly string[]> {
  const found: string[] = [];
  const pending = [root];
  for (let directory = pending.pop(); directory !== undefined; directory = pending.pop()) {
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
        found.push(path);
      }
    }
  }
  return found;
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
