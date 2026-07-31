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
import { basename, dirname, join } from "node:path";
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
  /** Tail of the `setRoots` queue — see the comment there. */
  #queue: Promise<void> = Promise.resolve();
  /** The privileged spellings currently configured — see `#applyRuntimePaths`. */
  readonly #runtimePaths = new Set<string>();
  /** What those entries resolve to, so a file arriving later can be recognized. */
  readonly #runtimeRealPaths = new Set<string>();

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
    // Serialized against itself. The caller is a notification handler, and
    // `vscode-jsonrpc` does not await one before delivering the next, so two
    // quick saves of `hexagon.json` can put a second run's `#manifests.clear()`
    // in the middle of the first one's walk — which then walks with exclusions
    // belonging to neither manifest. Queueing is enough because the whole method
    // is a replacement: the later call's answer is the one that should win.
    const run = this.#queue.then(() => this.#setRoots(roots, onError));
    this.#queue = run.then(() => {}, () => {});
    return await run;
  }

  async #setRoots(
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
    // Exclusions before the walk, so it skips what any root excludes rather
    // than adding files the sweep then removes. Privileged modules after it —
    // see `#applyRuntimePaths`, which needs to know what the walk called them.
    await this.#applyExclusions();

    let added = 0;
    const walked = new Set<string>();
    // Identity is shared across roots, not restarted at each one. Two roots can
    // reach one file — a monorepo folder opened beside a link into it — and a
    // per-root memory would compile it twice, under two names, reporting every
    // declaration in it as a duplicate of itself and publishing each of its
    // diagnostics against both paths.
    const seen: Seen = { directories: new Set(), files: new Set() };
    for (const root of roots) {
      for (const { path: found, realPath } of await hexagonFilesUnder(root, this.#exclude, seen, onError)) {
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
          const text = await readFile(found, "utf8");
          // Asked again on the other side of the read, immediately before the
          // write it guards. `openDocument` is not serialized behind this scan,
          // so the file can be opened while the read is in flight — and the
          // disk text would then land on top of the user's unsaved edits.
          if (this.#openPaths.has(path)) continue;
          this.session.setFile(path, text);
          this.#pathsByRealPath.set(realPath, path);
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
    await this.#applyRuntimePaths();
    return { added, manifests };
  }

  /** Whether this URI is excluded, for a host deciding what to tell the user. */
  isExcludedUri(uri: string): boolean {
    return this.#isExcluded(this.#pathByUri.get(uri) ?? this.uris.toPath(uri));
  }

  /**
   * The merged exclusions, in the two spellings a walked file can be matched by.
   *
   * The second spelling exists because the walk follows symlinks, so a file's
   * resolved path can have a prefix no manifest ever writes — on macOS `/var` is
   * a link to `/private/var`, which is every path under a temporary directory.
   * Only the *root* is resolved to bridge that: an entry's own components are
   * left exactly as written.
   *
   * Resolving those components as well is a mistake this made once. It looks
   * symmetrical and it silently deletes source: excluding a link `alias.hex`
   * resolves to the file it points at, so the target leaves the project under
   * its own legitimate name — taking real code out of the module graph and
   * producing `cannot resolve module` errors in whatever imported it. An
   * exclusion names a name; only the part of it the user did not write is safe
   * to rewrite.
   */
  async #applyExclusions(): Promise<void> {
    const literal: string[] = [];
    const real: string[] = [];
    for (const [root, manifest] of this.#manifests) {
      const rootPath = comparablePath(root);
      const realRoot = comparablePath(await realPathOf(root));
      for (const entry of manifest.exclude) {
        const written = comparablePath(entry);
        literal.push(written);
        real.push(rebase(written, rootPath, realRoot));
      }
    }
    this.#exclude = { literal, real };
  }

  /**
   * Hands every root's privileged modules to the session, after the walk.
   *
   * After, because the compiler matches `runtimePaths` by exact equality with
   * the key a file is held under, and the walk is what chooses that key: a
   * runtime module reached through a linked directory is keyed by the link's
   * spelling, which no manifest mentions. Privilege would then be silently lost
   * and `unknown generic type \`Node\`` — the whole reason this file exists —
   * would come back, depending on nothing more than the order `readdir`
   * happened to return.
   *
   * Roots are merged rather than replaced because a multi-root workspace has one
   * session: the modules of all of them compile together, so a file privileged
   * by its own project stays privileged.
   */
  async #applyRuntimePaths(): Promise<void> {
    this.#runtimePaths.clear();
    this.#runtimeRealPaths.clear();
    for (const { runtimePaths } of this.#manifests.values()) {
      for (const entry of runtimePaths) {
        // The spelling as written, and then the ones identity supplies. The
        // written name looks redundant and is not: `#grantIfRuntime` fires from
        // `#pathOf`, which answers from a cache after the first time it sees a
        // URI, so a grant is a once-per-URI event — while this method rebuilds
        // the set from scratch on every manifest change. Without the written
        // name, a module that was open when its privilege was granted loses it
        // at the next save of `hexagon.json` and cannot get it back, because the
        // walk skips open files and so records no spelling to restore it from.
        this.#runtimePaths.add(comparablePath(entry));
        const realPath = await realPathOf(entry);
        this.#runtimeRealPaths.add(realPath);
        // And the same name with only its *directory* resolved. A manifest may
        // name a module that does not exist yet — the file arrives with a branch
        // switch — and an absent path resolves to itself, keeping a prefix the
        // file will not have once it is there. Its directory does exist, and the
        // prefix is the whole of the difference.
        this.#runtimeRealPaths.add(
          join(await realPathOf(dirname(entry)), basename(entry)),
        );
        const walked = this.#pathsByRealPath.get(realPath);
        if (walked !== undefined) this.#runtimePaths.add(walked);
      }
    }
    this.session.configure({ runtimePaths: [...this.#runtimePaths] });
  }

  /**
   * Grants privilege to a file the walk never saw, if the manifest names it.
   *
   * A runtime module created after the scan — by a branch switch, or by the
   * user — arrives through the watcher or an open buffer, and is keyed by
   * whatever name that route gave it. Under a linked directory that is the
   * link's spelling, which no manifest mentions, so the module would silently
   * lose the privilege and report `unknown generic type \`Node\`` until the next
   * manifest change. Identity is the resolved path, which is the one thing both
   * routes agree on.
   */
  #grantIfRuntime(path: string, realPath: string): void {
    if (!this.#runtimeRealPaths.has(realPath)) return;
    if (this.#runtimePaths.has(path)) return;
    this.#runtimePaths.add(path);
    this.session.configure({ runtimePaths: [...this.#runtimePaths] });
  }

  /**
   * Whether this path is excluded, under either name it can be reached by.
   *
   * Both have to be tried. Matching only the literal path lets a symlink defeat
   * the exclusion — the walk follows links deliberately, so an excluded
   * directory reappears under a link's spelling with all its diagnostics.
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
    // when the document opened. Until `openDocument` has settled it there is
    // nothing safe to write to — guessing the literal path adds a second
    // session entry whenever the settled path turns out to be another name for
    // the file, and that duplicate then outlives the race that made it. An
    // edit declined here is not lost: `openDocument` reads the buffer's
    // *current* text the moment it settles.
    const path = this.#pathByUri.get(document.uri);
    if (path === undefined) return;
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
    let text: string;
    try {
      // The session is keyed by the compiler's spelling of the path; the read
      // uses the platform's, which is what the URI actually names.
      text = await readFile(fileSystemPath(uri), "utf8");
    } catch {
      this.session.removeFile(path);
      return;
    }
    // Both guards asked again on the other side of the read, immediately
    // before the write. Neither a manifest rescan nor a document open is
    // serialized behind this reload, so while the read was in flight the
    // exclusions can have changed — the rescan's sweep has already retired
    // this file, and writing it back would resurrect it under an exclusion the
    // user just wrote — and the file can have been reopened, in which case its
    // buffer, not this disk text, is now the truth.
    if (this.#isExcluded(path)) {
      this.session.removeFile(path);
      return;
    }
    if (this.#openUris.has(uri)) return;
    this.session.setFile(path, text);
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
    this.#grantIfRuntime(path, realPath);
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
  /** The same entries under the root's *resolved* name, links below it intact. */
  readonly real: readonly string[];
}

/**
 * An entry re-expressed under the root's resolved name, so that it can be
 * compared with a resolved file path.
 *
 * Only the prefix moves. What the user wrote below the root is left alone,
 * because that is the part they meant as a name — see `#applyExclusions`.
 */
function rebase(entry: string, rootPath: string, realRoot: string): string {
  if (rootPath === realRoot) return entry;
  if (entry === rootPath) return realRoot;
  const prefix = rootPath.endsWith("/") ? rootPath : `${rootPath}/`;
  return entry.startsWith(prefix) ? realRoot + entry.slice(rootPath.length) : entry;
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

/**
 * What a walk has already been to, by resolved path.
 *
 * Following symlinks means the tree is a graph: `ln -s . loop` makes a
 * directory contain itself, and a walk with no memory descends it until the
 * path length stops it, turning one file into dozens of modules that all shadow
 * each other. Identity has to be the resolved path, since two links to one
 * place are two names for it — and the same for files, where compiling one
 * twice reports every declaration in it as a duplicate of itself.
 *
 * Shared across roots rather than restarted at each, because two roots can
 * reach one file and the duplicate does not care which walk found it.
 */
interface Seen {
  readonly directories: Set<string>;
  readonly files: Set<string>;
}

async function hexagonFilesUnder(
  root: string,
  exclude: Exclusions,
  seen: Seen,
  onError: (message: string) => void,
): Promise<readonly FoundFile[]> {
  const found: FoundFile[] = [];
  const pending = [root];
  const walked = seen.directories;
  const collected = seen.files;
  for (let directory = pending.pop(); directory !== undefined; directory = pending.pop()) {
    const directoryIdentity = await realPathOf(directory);
    // Excluded under the name it resolves to, not only the name it was reached
    // by. `gen -> generated` beside an excluded `generated/` is one directory
    // with two names, and the walk follows links on purpose, so checking the
    // literal path alone lets every file in it back into the project under a
    // spelling the manifest never mentions. Free here: the resolution is
    // already paid for by cycle detection. The root itself is kept out of this
    // by `readManifest`, which refuses an `exclude` entry covering it under
    // either of the root's names — the resolved one included, since that is the
    // one a user pastes.
    //
    // Before the cycle check claims the identity, not after: an excluded link
    // would otherwise mark its target as already walked, and the target — a
    // real directory under its own name — would be skipped as though it had
    // been visited, taking every module in it out of the project.
    if (excludes(exclude, directory, directoryIdentity)) continue;
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
        // Excluded before deduplicated, not after. An excluded name that is a
        // link would otherwise claim its target's identity on the way out, and
        // the target — a legitimate file under its own name, reached later in
        // the same walk — would be dropped as a duplicate of something that is
        // not in the project at all.
        if (excludes(exclude, path, realPath)) continue;
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

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
