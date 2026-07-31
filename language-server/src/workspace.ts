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
import { pathToFileURL } from "node:url";
import type { TextDocument } from "vscode-languageserver-textdocument";
import { AnalysisSession } from "../../compiler/src/index.js";
import { fileSystemPath, UriPaths } from "./positions.js";
import {
  comparablePath,
  isExcluded,
  readManifest,
  type Manifest,
  type ManifestResult,
} from "./manifest.js";

const HEXAGON_EXTENSION = ".hex";

/** Directories never worth walking, whatever a workspace root contains. */
const SKIPPED_DIRECTORIES = new Set([".git", "node_modules", "dist", "coverage", ".vscode"]);

export class Workspace {
  readonly session = new AnalysisSession();
  readonly uris = new UriPaths();
  /** URIs whose text the editor currently owns, so disk must not overwrite them. */
  readonly #openUris = new Set<string>();
  /** The same set as `#openUris`, by session path — see the walk in `setRoots`. */
  readonly #openPaths = new Set<string>();
  /**
   * What each session path resolves to through symlinks, once anything has had
   * to ask. Exclusion consults it because a link is a second name for a file,
   * and a name is exactly what `exclude` matches: with `gen -> generated` beside
   * an excluded `generated/`, the walk reaches the same file under a spelling
   * the exclusion never mentions. Cached rather than resolved on demand because
   * the sync callers are per-keystroke and must not make a syscall.
   */
  readonly #realPathOfPath = new Map<string, string>();
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
  /** Each workspace root's `hexagon.json`, merged into the session by `#applyManifests`. */
  readonly #manifests = new Map<string, Manifest>();
  /** Every root's exclusions, merged, under both the names they can wear. */
  #exclude: Exclusions = NOTHING_EXCLUDED;

  /**
   * Replaces the workspace with these roots: reads each one's `hexagon.json`,
   * reads every Hexagon file they describe, and drops whatever is no longer
   * among them — newly excluded, under a dropped root, or deleted from disk.
   * Failures are reported rather than thrown, so a workspace with one unreadable
   * directory still gives language support for the rest of itself.
   *
   * Returns each manifest's own problems so the caller can publish them against
   * the manifest file. They are not errors in anyone's Hexagon.
   */
  async setRoots(
    roots: readonly string[],
    onError: (message: string) => void,
  ): Promise<{ added: number; manifests: ReadonlyMap<string, ManifestResult> }> {
    // Every manifest is read and applied before any walk, so the walk skips
    // what any root excludes rather than adding files the sweep then removes.
    this.#manifests.clear();
    const manifests = new Map<string, ManifestResult>();
    for (const root of roots) {
      const result = await readManifest(root);
      manifests.set(root, result);
      this.#manifests.set(root, result.manifest);
    }
    await this.#applyManifests();

    let added = 0;
    const walked = new Set<string>();
    for (const root of roots) {
      for (const { path: found, realPath } of await hexagonFilesUnder(root, this.#exclude, onError)) {
        // Route the disk path through the URI mapping rather than handing it to
        // the session directly, so a file discovered here and the same file
        // opened later are one entry under one spelling.
        const uri = pathToFileURL(found).toString();
        const path = this.uris.toPath(uri);
        // By path, not by URI: a client opens a buffer under its own spelling,
        // and matching the string means every rescan clobbers that buffer with
        // disk text on any platform whose URIs differ from `pathToFileURL`'s.
        if (this.#openPaths.has(path)) continue;
        try {
          this.session.setFile(path, await readFile(found, "utf8"));
          this.#pathsByRealPath.set(realPath, path);
          this.#realPathOfPath.set(path, realPath);
          walked.add(path);
          added += 1;
        } catch (error) {
          onError(`could not read ${found}: ${messageOf(error)}`);
        }
      }
    }

    // A walk only ever adds, so anything that has *left* the project has to be
    // taken out here or it outlives the decision that removed it. Three ways to
    // leave: an exclusion widened, a root was dropped, or the file was deleted
    // on disk between walks — the last of which no watcher event covers after a
    // branch switch. A file the editor holds open is not gone; its buffer is
    // the truth and no walk was ever going to find it.
    //
    // This trailing sweep, rather than the order manifests are read in, is what
    // makes the result independent of the order the roots arrive in.
    for (const path of this.session.paths) {
      if (this.#isExcluded(path)) {
        this.session.removeFile(path);
        continue;
      }
      // The walk skips what the editor holds open, so an open file is never in
      // `walked` — absence there says nothing about it. Exclusion is the only
      // reason to drop one, and the host is told so rather than left guessing.
      if (!this.#openPaths.has(path) && !walked.has(path)) this.session.removeFile(path);
    }
    return { added, manifests };
  }

  /** Whether this URI is excluded, for a host deciding what to tell the user. */
  isExcludedUri(uri: string): boolean {
    return this.#isExcluded(this.#pathByUri.get(uri) ?? this.uris.toPath(uri));
  }

  /**
   * Hands every root's manifest to the session, merged.
   *
   * Roots are merged rather than replaced because a multi-root workspace has one
   * session: the modules of all of them compile together, so a file privileged
   * by its own project stays privileged.
   */
  async #applyManifests(): Promise<void> {
    // Both fields take the same one spelling, `comparablePath`, rather than
    // going through `uris.toPath` — which for an absolute path is that same
    // function wrapped in two conversions that cancel out, and which would also
    // *register* the manifest's URI spelling for the file. First URI seen wins,
    // so registering here would let a path nobody opened decide the spelling
    // the server later reports locations in.
    const literal = [...this.#manifests.values()].flatMap(({ exclude }) =>
      exclude.map(comparablePath)
    );
    // The resolved spelling of each exclusion, so that a resolved *file* path
    // has something in its own terms to match against. Comparing a resolved
    // path to an unresolved exclusion is a bug that hides wherever no symlink
    // happens to be — and then appears wholesale on macOS, where `/var` is a
    // link to `/private/var` and so every path under a temporary directory
    // resolves to a prefix no manifest ever writes.
    const real = await Promise.all(
      literal.map(async (entry) => comparablePath(await realPathOf(entry))),
    );
    this.#exclude = { literal, real };
    this.session.configure({
      runtimePaths: [...this.#manifests.values()].flatMap(({ runtimePaths }) =>
        runtimePaths.map(comparablePath)
      ),
    });
  }

  /**
   * Whether this path is excluded, under any name it is reachable by.
   *
   * Both names have to be tried. Matching only the literal path lets a symlink
   * defeat the exclusion — the walk follows links deliberately, so an excluded
   * directory reappears under a link's spelling with all its diagnostics. And
   * matching only the resolved path breaks the opposite case, where the link
   * itself is what the manifest excludes and the target is a legitimate part of
   * the project under its own name.
   */
  #isExcluded(path: string): boolean {
    return excludes(this.#exclude, path, this.#realPathOfPath.get(path));
  }

  /** Takes over a file's contents from the editor, unsaved edits included. */
  async openDocument(document: TextDocument): Promise<void> {
    this.#openUris.add(document.uri);
    const path = await this.#pathOf(document.uri);
    this.#openPaths.add(path);
    // Excluding a file has to hold at every way into the session, not only at
    // the walk. A walk-time-only check means opening the file, or a watcher
    // firing on it, quietly puts it back — and it then stays, so the exclusion
    // a user configured lasts until the next thing touches the file.
    if (this.#isExcluded(path)) return;
    this.session.setFile(path, document.getText());
  }

  updateDocument(document: TextDocument): void {
    // Never resolves: an edit arrives per keystroke, and the path was settled
    // when the document opened. A URI that was never opened falls back to its
    // literal path, which is the same answer the walk would have given it.
    const path = this.#pathByUri.get(document.uri) ?? this.uris.toPath(document.uri);
    if (this.#isExcluded(path)) return;
    this.session.setFile(path, document.getText());
  }

  /**
   * Hands a file back to disk. The buffer may have been closed without saving,
   * so the on-disk text is re-read rather than assumed to match; a file that has
   * no on-disk text — it was never saved — leaves the session with it.
   */
  async closeDocument(uri: string): Promise<void> {
    this.#openUris.delete(uri);
    this.#openPaths.delete(await this.#pathOf(uri));
    await this.#reloadFromDisk(uri);
  }

  /** A file the editor reports as created or changed on disk, outside any buffer. */
  async refreshFromDisk(uri: string): Promise<void> {
    if (this.#openUris.has(uri)) return;
    await this.#reloadFromDisk(uri);
  }

  async #reloadFromDisk(uri: string): Promise<void> {
    const path = await this.#pathOf(uri);
    if (this.#isExcluded(path)) {
      this.session.removeFile(path);
      return;
    }
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
    const path = await this.#pathOf(uri);
    this.#openPaths.delete(path);
    this.session.removeFile(path);
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
    const realPath = await realPathOf(fileSystemPath(uri));
    const path = this.#pathsByRealPath.get(realPath) ?? literal;
    this.#pathByUri.set(uri, path);
    // Recorded even when the walk never saw this file, because the walk skips
    // what is excluded — so for exactly the files `#isExcluded` most needs to
    // resolve, this is the only place the resolution ever happens.
    this.#realPathOfPath.set(path, realPath);
    return path;
  }
}

/** A discovered file, with the identity that makes two names for it one file. */
interface FoundFile {
  readonly path: string;
  readonly realPath: string;
}

/**
 * The merged exclusions, held under both names a path can be reached by.
 *
 * A symlink means one file has two names, and `exclude` matches names. Keeping
 * only one spelling makes the check depend on which name the walk happened to
 * arrive by, which is the sort of thing that works everywhere the author tested
 * and nowhere else.
 */
interface Exclusions {
  /** As written in the manifest, resolved against it but not through links. */
  readonly literal: readonly string[];
  /** The same entries with every link followed, to compare against real paths. */
  readonly real: readonly string[];
}

const NOTHING_EXCLUDED: Exclusions = { literal: [], real: [] };

/** Whether a path is excluded under either of the two names it can have. */
function excludes(
  exclude: Exclusions,
  path: string,
  realPath: string | undefined,
): boolean {
  if (exclude.literal.length === 0) return false;
  if (isExcluded(path, exclude.literal)) return true;
  return realPath !== undefined && isExcluded(realPath, exclude.real);
}

async function hexagonFilesUnder(
  root: string,
  exclude: Exclusions,
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
    // Excluded under the name it resolves to, not only the name it was reached
    // by. `gen -> generated` beside an excluded `generated/` is one directory
    // with two names, and the walk follows links on purpose, so checking the
    // literal path alone lets every file in it back into the project under a
    // spelling the manifest never mentions. Free here: the resolution above is
    // already paid for by cycle detection. The root itself cannot be caught by
    // this — `readManifest` rejects an `exclude` entry that covers it.
    if (excludes(exclude, directory, directoryIdentity)) continue;
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      onError(`could not list ${directory}: ${messageOf(error)}`);
      continue;
    }
    for (const entry of entries) {
      const path = join(directory, entry.name);
      // By literal name only, to keep the common case free of a syscall per
      // entry; a link's resolved name is checked below, where its resolution is
      // needed anyway.
      if (excludes(exclude, path, undefined)) continue;
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
        // The same second name a directory can have, for a link to a single
        // file. Also already paid for — deduplication needs the resolution.
        if (excludes(exclude, path, realPath)) continue;
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

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
