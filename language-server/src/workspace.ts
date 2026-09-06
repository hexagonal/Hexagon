/**
 * The **programs** the server holds, and where their files come from.
 *
 * A Hexagon project is a module graph, so answering anything about one file
 * needs the others: a definition usually lives in a module the user has not
 * opened, and a diagnostic in an unopened module can be the reason the open one
 * fails. A session therefore holds a whole program, not just what is on screen.
 *
 * **One program per project directory** (`environment.md` §4, D1). A workspace
 * is not one compilation: two open folders are two projects and see each other
 * only through an installed dependency, a manifest nested beneath a project is
 * a package of its own and so a program of its own, and each program carries
 * its own dependency closure — the project's own sources plus every package
 * `host/` resolved for it. What is *shared* is file identity: one file has one
 * canonical identity in as many programs as hold it, its open buffer's text
 * reaches all of them, and each keeps its own analysis and its own failures.
 *
 * Two sources feed a file, and precedence between them is the whole point:
 *
 * - **Open documents win.** While a document is open the editor's buffer is the
 *   truth, unsaved edits included. Reading disk instead would answer about text
 *   the user cannot see.
 * - **Disk fills in the rest.** Files never opened, and files closed again,
 *   come from disk so the graph stays whole.
 *
 * The host package and this module are the only parts of the server that touch
 * a filesystem: `host/` answers what a program *is* on disk, and this decides
 * which text each program's session holds.
 */

import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import type { TextDocument } from "vscode-languageserver-textdocument";
import {
  AnalysisSession,
  type Diagnostics,
  type ProgramPackage,
  type SessionOptions,
  type Source,
} from "../../compiler/src/index.js";
import { fileSystemPath, UriPaths } from "./positions.js";
import {
  comparablePath,
  discoverPrograms,
  excludes,
  exclusionsOf,
  manifestPathOf,
  mergedExclusions,
  messageOf,
  NOTHING_EXCLUDED,
  realPathOf,
  type Exclusions,
  type SeatedProblem,
} from "../../host/src/index.js";

/** One program, as a host reads it back. */
export interface ProgramView {
  /** The project directory — the program's identity (D1). */
  readonly directory: string;
  readonly session: AnalysisSession;
  /** Whether this program holds `path` as the project's **own** source. */
  owns(path: string): boolean;
  /** Whether this program holds `path` at all, a dependency's source included. */
  holds(path: string): boolean;
}

/**
 * One diagnostic to publish, with the program that produced it.
 *
 * A span names its file by number, and the numbering is a *session's*, so a
 * report's secondary labels can only be resolved by the session that drew it.
 * Merging across programs therefore carries the resolver rather than the
 * numbers (D3).
 */
export interface PublishedDiagnostic {
  readonly diagnostic: Diagnostics.Diagnostic;
  readonly pathOfFile: (fileId: number) => string | undefined;
}

/** One package of a program, as this module holds it. */
interface HeldPackage {
  readonly directory: string;
  readonly record: ProgramPackage;
  readonly paths: Set<string>;
}

/** One program's whole state. */
interface Program {
  readonly directory: string;
  readonly session: AnalysisSession;
  /** Session paths held as the project's own source. */
  readonly own: Set<string>;
  /** Each package of the closure, with the session paths of its sources. */
  readonly packages: HeldPackage[];
  /** Every session path any package of the closure holds. */
  readonly held: Set<string>;
  /** This program's manifest reports, seated at the manifest carrying them. */
  problems: readonly SeatedProblem[];
  /** The project manifest's path and text, for the `dependencies` applied edit. */
  manifest: { path: string; text: string | undefined };
  /**
   * Everything but `packages` of what this program is configured with.
   *
   * Held because `configure` replaces the whole option set: a call that passed
   * only the package list would drop the project's `name` and rebrand every
   * module in it, so the two halves are always handed over together and this is
   * the half that does not change when a dependency's file does.
   */
  options: Omit<SessionOptions, "packages">;
}

export class Workspace {
  readonly uris = new UriPaths();
  #programs: Program[] = [];
  /** URIs whose text the editor currently owns, so disk must not overwrite them. */
  readonly #openUris = new Set<string>();
  /** The same set as `#openUris`, by session path — see the walk in `setRoots`. */
  readonly #openPaths = new Set<string>();
  /** Open buffers' text by session path, so a rediscovery re-seats them. */
  readonly #openTexts = new Map<string, string>();
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
   * one entry, or the file compiles twice and every declaration in it is
   * reported as a duplicate of itself. The walk already dedupes by real path;
   * this is the same rule for the names an editor opens, which the walk never
   * chose. Cached because resolving is a syscall and an edit must not pay one.
   */
  readonly #pathByUri = new Map<string, string>();
  /** Session path for each real path the walk resolved — see `#pathOf`. */
  readonly #pathsByRealPath = new Map<string, string>();
  /** Every project's exclusions, merged, under both the names they can wear. */
  #exclude: Exclusions = NOTHING_EXCLUDED;
  /** Tail of the `setRoots` queue — see the comment there. */
  #queue: Promise<void> = Promise.resolve();
  /** The answer for a workspace with no program: a session holding nothing. */
  readonly #empty = new AnalysisSession();

  /**
   * The one program's session.
   *
   * A convenience for the ordinary shape — a workspace of one project — and
   * nothing more: a host answering about a *file* asks `sessionFor`, because in
   * a workspace of several programs the answer depends on which one owns it.
   * An empty workspace answers with a session holding nothing, so a caller
   * never has to spell the absent case.
   */
  get session(): AnalysisSession {
    return this.#programs[0]?.session ?? this.#empty;
  }

  get programs(): readonly ProgramView[] {
    return this.#programs.map(viewOf);
  }

  /**
   * The program that answers for a file.
   *
   * The one holding it as **project source**, which is the program whose repairs
   * and renames the file's author can act on. A file held only as a dependency's
   * source — one under a real `node_modules`, which no editor root owns — is
   * answered by the first program holding it, in root order, so hover and
   * definition work inside a dependency rather than not at all.
   */
  programFor(path: string): ProgramView | undefined {
    const owner = this.#programs.find((program) => program.own.has(path));
    if (owner !== undefined) return viewOf(owner);
    const holder = this.#programs.find((program) => program.held.has(path));
    return holder === undefined ? undefined : viewOf(holder);
  }

  /** `programFor`'s session, or nothing where no program holds the file. */
  sessionFor(path: string): AnalysisSession | undefined {
    return this.programFor(path)?.session;
  }

  /**
   * Every program's diagnostics, merged per file (D3).
   *
   * Identical reports appear once and genuinely different ones each appear, so
   * two programs holding one dependency's file do not double every error in it
   * while still each saying what only they can see. A file every program is
   * silent about arrives with an empty list, which is how an editor learns its
   * previous errors are gone — the clearing is a publication, never an
   * omission.
   */
  allDiagnostics(): ReadonlyMap<string, readonly PublishedDiagnostic[]> {
    const merged = new Map<string, PublishedDiagnostic[]>();
    const seen = new Map<string, Set<string>>();
    for (const program of this.#programs) {
      const pathOfFile = (fileId: number): string | undefined =>
        program.session.pathOfFile(fileId as Source.FileId);
      for (const [path, diagnostics] of program.session.allDiagnostics()) {
        const at = merged.get(path) ?? [];
        merged.set(path, at);
        const keys = seen.get(path) ?? new Set<string>();
        seen.set(path, keys);
        for (const diagnostic of diagnostics) {
          const key = identityOf(diagnostic);
          if (keys.has(key)) continue;
          keys.add(key);
          at.push({ diagnostic, pathOfFile });
        }
      }
    }
    return merged;
  }

  /**
   * Every manifest report, from every program, seated at the manifest carrying
   * the entry — a dependency's own `hexagon.json` under `node_modules` included
   * (D3). Deduped by seat and sentence, because two programs sharing a
   * dependency read its manifest twice and it is broken once.
   */
  manifestProblems(): readonly SeatedProblem[] {
    const seen = new Set<string>();
    const problems: SeatedProblem[] = [];
    for (const program of this.#programs) {
      for (const problem of program.problems) {
        const key = `${problem.path} ${problem.line} ${problem.message}`;
        if (seen.has(key)) continue;
        seen.add(key);
        problems.push(problem);
      }
    }
    return problems;
  }

  /**
   * The text a `dependencies` entry would be added to, and where it lives.
   *
   * Packages §7's not-a-dependency report names a manifest edit as its repair,
   * and the compiler marks the report rather than writing it (the manifest is
   * not a file the compiler holds). This answers the manifest of the project
   * whose module drew it — **only** a project the editor holds, never a
   * directory under `node_modules`, whose files a user did not write and must
   * not be asked to edit.
   */
  projectManifestOf(path: string): { path: string; text: string | undefined } | undefined {
    const owner = this.#programs.find((program) => program.own.has(path));
    return owner === undefined ? undefined : owner.manifest;
  }

  /**
   * Replaces the workspace with these roots: discovers every program they
   * describe, reads every file each program holds, and drops whatever is no
   * longer among them — newly excluded, under a dropped root, or deleted from
   * disk. Failures are reported rather than thrown, so a workspace with one
   * unreadable directory still gives language support for the rest of itself.
   */
  async setRoots(
    roots: readonly string[],
    onError: (message: string) => void,
  ): Promise<{ added: number }> {
    // Serialized against itself. The caller is a notification handler, and
    // `vscode-jsonrpc` does not await one before delivering the next, so two
    // quick saves of `hexagon.json` can put a second run's discovery in the
    // middle of the first one's walk — which then walks with exclusions
    // belonging to neither manifest. Queueing is enough because the whole method
    // is a replacement: the later call's answer is the one that should win.
    const run = this.#queue.then(() => this.#setRoots(roots, onError));
    this.#queue = run.then(() => {}, () => {});
    return await run;
  }

  async #setRoots(
    roots: readonly string[],
    onError: (message: string) => void,
  ): Promise<{ added: number }> {
    const discovered = await discoverPrograms(roots, onError);
    // Exclusions before any text is read, so a file a manifest excludes is
    // never put into a session and then swept out of it.
    const all: Exclusions[] = [];
    for (const program of discovered) all.push(await exclusionsOf(program.directory, program.manifest));
    this.#exclude = all.length === 0 ? NOTHING_EXCLUDED : mergedExclusions(all);

    // Sessions are kept across a rediscovery, keyed by project directory. A
    // session owns file identity — one path, one `Source.FileId`, held even
    // across a removal — so throwing one away because `node_modules` changed
    // would make every span in every open buffer a span in a different file.
    const kept = new Map(this.#programs.map((program) => [program.directory, program]));
    const programs: Program[] = [];
    let added = 0;
    for (const found of discovered) {
      const existing = kept.get(found.directory);
      const session = existing?.session ?? new AnalysisSession();
      const own = new Set<string>();
      const held = new Set<string>();
      const packages: HeldPackage[] = [];
      for (const file of found.files) {
        const path = await this.#seat(file.path, file.realPath, session, onError);
        if (path === undefined) continue;
        own.add(path);
        added += 1;
      }
      for (const dependency of found.packages) {
        const paths = new Set<string>();
        for (const file of dependency.files) {
          const path = await this.#seat(file.path, file.realPath, session, onError);
          if (path === undefined) continue;
          paths.add(path);
          held.add(path);
          added += 1;
        }
        packages.push({ directory: dependency.directory, record: dependency.record, paths });
      }
      for (const path of own) held.add(path);
      // A walk only ever adds, so anything that has *left* a program has to be
      // taken out here or it outlives the decision that removed it. Three ways
      // to leave: an exclusion widened, a root was dropped, or the file was
      // deleted on disk between walks — the last of which no watcher event
      // covers after a branch switch. A file the editor holds open is not gone;
      // its buffer is the truth and no walk was ever going to find it.
      for (const path of session.paths) {
        if (held.has(path) && !this.#isExcluded(path)) continue;
        if (this.#openPaths.has(path) && held.has(path)) continue;
        session.removeFile(path);
        own.delete(path);
        held.delete(path);
        for (const dependency of packages) dependency.paths.delete(path);
      }
      const options: Omit<SessionOptions, "packages"> = {
        ...(found.manifest.name === undefined ? {} : { packageName: found.manifest.name }),
        ...(found.manifest.dependencies.length === 0
          ? {}
          : { dependencies: found.manifest.dependencies }),
        ...(found.installed.size === 0 ? {} : { installed: found.installed }),
      };
      session.configure({
        ...options,
        ...(packages.length === 0
          ? {}
          : {
            packages: packages.map(({ record, paths }) => ({ record, paths: [...paths] })),
          }),
      });
      programs.push({
        directory: found.directory,
        session,
        own,
        packages,
        held,
        options,
        problems: found.problems,
        manifest: {
          path: manifestPathOf(found.directory),
          text: found.hasManifest ? await readText(manifestPathOf(found.directory)) : undefined,
        },
      });
    }
    this.#programs = programs;
    return { added };
  }

  /**
   * Puts one discovered file into a session under the workspace's spelling of
   * its path, preferring an open buffer's text to disk.
   */
  async #seat(
    file: string,
    realPath: string,
    session: AnalysisSession,
    onError: (message: string) => void,
  ): Promise<string | undefined> {
    // Route the disk path through the URI mapping rather than handing it to the
    // session directly, so a file discovered here and the same file opened
    // later are one entry under one spelling.
    const uri = pathToFileURL(file).toString();
    const path = this.uris.toPath(uri);
    this.#pathsByRealPath.set(realPath, path);
    if (this.#isExcluded(path)) return undefined;
    // By path, not by URI: a client opens a buffer under its own spelling, and
    // matching the string means every rescan clobbers that buffer with disk text
    // on any platform whose URIs differ from `pathToFileURL`'s.
    const buffered = this.#openPaths.has(path) ? this.#openTexts.get(path) : undefined;
    if (buffered !== undefined) {
      session.setFile(path, buffered);
      return path;
    }
    try {
      const text = await readFile(file, "utf8");
      // Asked again on the other side of the read, immediately before the write
      // it guards. `openDocument` is not serialized behind this scan, so the
      // file can be opened while the read is in flight — and the disk text would
      // then land on top of the user's unsaved edits.
      const now = this.#openPaths.has(path) ? this.#openTexts.get(path) : undefined;
      session.setFile(path, now ?? text);
      return path;
    } catch (error) {
      onError(`could not read ${file}: ${messageOf(error)}`);
      return undefined;
    }
  }

  /** Whether this URI is excluded, for a host deciding what to tell the user. */
  isExcludedUri(uri: string): boolean {
    return this.#isExcluded(this.#pathByUri.get(uri) ?? this.uris.toPath(uri));
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
    this.#openTexts.set(path, document.getText());
    this.#write(path, document.getText());
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
    this.#openTexts.set(path, document.getText());
    this.#write(path, document.getText());
  }

  /**
   * Hands a file back to disk. The buffer may have been closed without saving,
   * so the on-disk text is re-read rather than assumed to match; a file that has
   * no on-disk text — it was never saved — leaves the programs with it.
   */
  async closeDocument(uri: string): Promise<void> {
    this.#openUris.delete(uri);
    const path = await this.#pathOf(uri);
    this.#openPaths.delete(path);
    this.#openTexts.delete(path);
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
      this.#erase(path);
      return;
    }
    let text: string;
    try {
      // A session is keyed by the compiler's spelling of the path; the read uses
      // the platform's, which is what the URI actually names.
      text = await readFile(fileSystemPath(uri), "utf8");
    } catch {
      this.#erase(path);
      return;
    }
    // Both guards asked again on the other side of the read, immediately
    // before the write. Neither a rediscovery nor a document open is serialized
    // behind this reload, so while the read was in flight the exclusions can
    // have changed — the sweep has already retired this file, and writing it
    // back would resurrect it under an exclusion the user just wrote — and the
    // file can have been reopened, in which case its buffer, not this disk
    // text, is now the truth.
    if (this.#isExcluded(path)) {
      this.#erase(path);
      return;
    }
    if (this.#openUris.has(uri)) return;
    this.#write(path, text);
  }

  async deleteFile(uri: string): Promise<void> {
    // Open documents win here too. A branch switch deletes files the editor
    // keeps open — dirty, visible, and restorable with a save — so the buffer
    // remains the truth until the client says it closed. Dropping the file
    // *and* its URI mapping here would do worse than lose the text: every
    // later edit finds no settled path and is declined, so the open buffer
    // silently loses language support until it is closed and reopened.
    if (this.#openUris.has(uri)) return;
    const path = await this.#pathOf(uri);
    this.#erase(path);
    this.#pathByUri.delete(uri);
  }

  /**
   * Writes one file's text into **every program that holds it**.
   *
   * One file, one identity, in as many programs as hold it (D1): a dependency's
   * source can sit in two programs' closures at once, and an editor buffer over
   * it is the truth for both. A file no program holds yet is seated in the one
   * whose project directory encloses it, or in every program holding the package
   * it belongs to, which is what makes a newly created file compile without a
   * rediscovery.
   */
  #write(path: string, text: string): void {
    let seated = false;
    for (const program of this.#programs) {
      if (!program.held.has(path)) continue;
      program.session.setFile(path, text);
      seated = true;
    }
    if (seated) return;
    for (const program of this.#adopters(path)) {
      program.session.setFile(path, text);
      program.held.add(path);
    }
  }

  /** Removes a file from every program holding it. */
  #erase(path: string): void {
    for (const program of this.#programs) {
      if (!program.held.has(path)) continue;
      program.session.removeFile(path);
      program.held.delete(path);
      program.own.delete(path);
      for (const dependency of program.packages) {
        if (!dependency.paths.delete(path)) continue;
        // A package's file list is an option, so dropping one has to be told to
        // the session rather than merely forgotten here.
        this.#reconfigure(program);
      }
    }
  }

  /**
   * The programs a file no program holds yet belongs to.
   *
   * A file beneath a package of some program's closure joins that package —
   * `node_modules` is nobody's project source, so the enclosing project would be
   * the wrong answer. Otherwise the enclosing project directory owns it, the
   * deepest one winning, since a nested project lies inside its parent.
   */
  #adopters(path: string): readonly Program[] {
    const withinPackage = this.#programs.filter((program) =>
      program.packages.some((dependency) => within(dependency.directory, path))
    );
    if (withinPackage.length > 0) {
      for (const program of withinPackage) {
        for (const dependency of program.packages) {
          if (!within(dependency.directory, path)) continue;
          dependency.paths.add(path);
          this.#reconfigure(program);
        }
      }
      return withinPackage;
    }
    let owner: Program | undefined;
    for (const program of this.#programs) {
      if (!within(program.directory, path)) continue;
      if (owner === undefined || program.directory.length > owner.directory.length) {
        owner = program;
      }
    }
    if (owner === undefined) return [];
    owner.own.add(path);
    return [owner];
  }

  /**
   * Hands a program its option set again, after a package's file list changed.
   *
   * Always both halves: `configure` replaces the set, so passing the packages
   * alone would drop the project's `name` and rebrand every module in it.
   */
  #reconfigure(program: Program): void {
    const packages = program.packages.map(({ record, paths }) => ({
      record,
      paths: [...paths],
    }));
    program.session.configure({
      ...program.options,
      ...(packages.length === 0 ? {} : { packages }),
    });
  }

  /**
   * The session path for a URI.
   *
   * Normally this is just the URI's own path. The exception is a second name for
   * a file the walk already found — a symlink beside its target — where the walk
   * kept one name and the editor may open the other. Keying the buffer by its
   * own URI would put one file into a session twice, and every declaration in it
   * would then be reported as a duplicate of itself.
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

function viewOf(program: Program): ProgramView {
  return {
    directory: program.directory,
    session: program.session,
    owns: (path) => program.own.has(path),
    holds: (path) => program.held.has(path),
  };
}

/** Whether `path` lies beneath `directory`, by whole path component. */
function within(directory: string, path: string): boolean {
  const prefix = comparablePath(directory);
  const target = comparablePath(path);
  return target.startsWith(prefix.endsWith("/") ? prefix : `${prefix}/`);
}

/**
 * What makes two reports the same report, for D3's merge.
 *
 * Positions rather than file numbers: a span names its file by a *session's*
 * number, so two programs reporting the identical fault in one file carry two
 * different numbers for it. Severity, sentence, range, and the related
 * locations' ranges and sentences are what a reader would call the same report.
 */
function identityOf(diagnostic: Diagnostics.Diagnostic): string {
  const range = (span: Source.Span): string =>
    `${span.start.line}:${span.start.column}-${span.end.line}:${span.end.column}`;
  const labels = (diagnostic.labels ?? [])
    .map((label) => `${range(label.span)}|${label.message}`)
    .join(" ");
  return [
    diagnostic.severity,
    diagnostic.message,
    range(diagnostic.primary),
    labels,
    (diagnostic.notes ?? []).join(" "),
  ].join("");
}

async function readText(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return undefined;
  }
}
