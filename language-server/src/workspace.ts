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
import type { TextDocument } from "vscode-languageserver-textdocument";
import {
  AnalysisSession,
  Source,
  type Diagnostics,
  type ProgramPackage,
  type SessionOptions,
} from "../../compiler/src/index.js";
import { fileSystemPath, UriPaths } from "./positions.js";
import {
  comparablePath,
  discoverPrograms,
  excludes,
  exclusionsOf,
  manifestKeyLine,
  MANIFEST_NAME,
  manifestPathOf,
  messageOf,
  normalizePath,
  NOTHING_EXCLUDED,
  packageUnderNodeModules,
  settledPathSync,
  skippedDirectoryBetween,
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

/**
 * Why a file is nobody's source — which of Packages §2.2's three bounds
 * decided, taken as the one that would still be standing after every repair the
 * others offer. That bound is four sentences and not three, because a reader
 * who can write the `dependencies` entry and one who cannot are told different
 * things about the same `node_modules`.
 *
 * Two of the four carry a way out, and each carries it only where taking it
 * *works*: a sentence telling a user to add a `dependencies` entry that another
 * bound below defeats is worse than one that names the bound and offers
 * nothing, because they write the entry, get the same silence, and are left
 * with a manifest that now draws a report of its own.
 */
export type OutsideEveryPackage =
  /**
   * Directly inside a package under this project's own `node_modules` that the
   * project does not list — the one shape a `dependencies` entry reaches
   * (§2.2, §4.1).
   */
  | { readonly kind: "unlisted-dependency" }
  /**
   * Under a `node_modules` whose packages no manifest the reader can edit
   * reaches: a dependency's own `node_modules`, or one with no package holding
   * the file at all. Named as a bound, with no repair, because there is none.
   */
  | {
    readonly kind: "unreached-node-modules";
    /** The package whose `node_modules` it is, where this server holds one. */
    readonly inside: string | undefined;
  }
  /** Under `dist`, `.git`, or another name this host never reads. */
  | { readonly kind: "skipped-directory"; readonly directory: string }
  /** Beneath a `hexagon.json` of its own that no open project reaches (§2.2). */
  | { readonly kind: "other-package"; readonly manifest: string };

/**
 * A directory whose files §2.2 bounds, and the package boundaries beneath it —
 * a project's own directory or a package of a closure, asked the same way.
 */
interface Bounded {
  readonly directory: string;
  readonly nested: readonly string[];
  /**
   * Whose directory it is, which decides what a sentence about it may promise.
   *
   * A project's `hexagon.json` is a file the reader has open and can edit, so a
   * `dependencies` entry is a repair they can make. A package of a closure's is
   * a file under a `node_modules`, which no entry of theirs reaches — so a
   * bound of *its* is named and left at that, with the package's own declared
   * name, which is the only part of it the reader would recognise.
   */
  readonly owner:
    | { readonly kind: "project" }
    | { readonly kind: "package"; readonly name: string | undefined };
}

/** A project's own directory, which needs no boundary list — see `outsideEveryPackage`. */
const NO_BOUNDARIES: readonly string[] = [];

/** One package of a program, as this module holds it. */
interface HeldPackage {
  readonly directory: string;
  readonly record: ProgramPackage;
  readonly paths: Set<string>;
  /**
   * The package boundaries the walk met beneath it: a directory with a
   * `hexagon.json` of its own is a package of its own, and its files are its
   * alone (Packages §2.2). Carried so that `#adopters` can apply that bound to
   * a file the walk never handed it.
   */
  readonly nested: readonly string[];
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
   * The session path each URI resolves to, and the identity that path stands
   * for, remembered from the first time the URI was seen. Two names for one
   * file — a symlink and its target — must reach one entry, or the file compiles
   * twice and every declaration in it is reported as a duplicate of itself. The
   * walk already dedupes by real path; this is the same rule for the names an
   * editor opens, which the walk never chose. Cached because resolving is a
   * syscall and an edit must not pay one.
   *
   * The identity is kept **beside** the path rather than only written into
   * `#realPathOfPath`, because that map is emptied of a file that leaves the
   * workspace (`#erase`). A URI answered from this cache would otherwise come
   * back with no identity behind it, and `#isExcluded` — which needs the
   * resolved name to catch an exclusion reached through a link — would be
   * asking about one spelling where the file has two.
   */
  readonly #pathByUri = new Map<string, { readonly path: string; readonly realPath: string }>();
  /** Session path for each real path the walk resolved — see `pathFor`. */
  readonly #pathsByRealPath = new Map<string, string>();
  /**
   * Each **package's** own exclusions, against the directory whose manifest
   * wrote them, under both the names an entry can wear — a project and an
   * installed dependency alike.
   *
   * **One manifest's `exclude` is about that package's own files**, which is
   * what the walk does: `filesOf` walks each package of the closure with that
   * package's exclusions and nobody else's. Both halves of that matter, and a
   * single merged set gets both wrong:
   *
   * - a *project's* entry must not reach a dependency's files. `node_modules`
   *   lies inside the project directory, so `exclude: ["node_modules"]` — the
   *   shape of every `.gitignore` — would empty every dependency of source,
   *   with no manifest report and every import of them refused for a reason
   *   nothing names;
   * - a *dependency's* entry must reach its own. A package excludes a
   *   `generated/` it does not ship as source, the walk honours it, and a door
   *   that did not would add the module by the accident of a user opening one
   *   file inside a dependency — flipping a report in the user's own source.
   *
   * The same reading keeps a parent project's `exclude: ["lib/generated"]` from
   * emptying the *nested* project that owns `lib/generated`, and one editor
   * root's manifest out of its sibling's files.
   */
  #exclusions: readonly { readonly directory: string; readonly exclude: Exclusions }[] = [];
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
        // Separators written as escapes, never as literal control bytes: a
        // source file carrying one is binary to every text tool a reader has.
        const key = `${problem.path}\u0000${problem.line}\u0000${problem.message}`;
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
    // How the client spells each root, against what discovery resolves it to.
    // Every path inside the session is the resolved one; this is the one place
    // that knows the other spelling, and it is what sends a location back under
    // the folder the client actually opened.
    for (const root of roots) {
      this.uris.rootSpelling(normalizePath(settledPathSync(root)), normalizePath(root));
    }
    const discovered = await discoverPrograms(roots, onError);
    // Exclusions before any text is read, so a file a manifest excludes is
    // never put into a session and then swept out of it — and one entry per
    // **package**, project and installed dependency alike, because that is the
    // unit the walk reads them for. Deduped by directory: two programs sharing
    // a hoisted dependency read its manifest twice and it excludes one thing.
    const exclusions = new Map<string, Exclusions>();
    for (const program of discovered) {
      if (!exclusions.has(program.directory)) {
        exclusions.set(
          program.directory,
          await exclusionsOf(program.directory, program.manifest),
        );
      }
      for (const dependency of program.packages) {
        if (exclusions.has(dependency.directory)) continue;
        exclusions.set(
          dependency.directory,
          await exclusionsOf(dependency.directory, dependency.manifest),
        );
      }
    }
    this.#exclusions = [...exclusions].map(([directory, exclude]) => ({ directory, exclude }));
    /** Every project directory of this discovery, for the sweep's own seat test. */
    const projectDirectories = discovered.map(({ directory }) => directory);

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
        packages.push({
          directory: dependency.directory,
          // The manifest, seated in this session so a report can point at it
          // (D3): Modules §2.2's whole-program refusal names a package whose
          // only text a reader can act on is its `hexagon.json`.
          record: {
            ...dependency.record,
            manifest: manifestNameSpan(
              session.referenceFile(dependency.manifestPath, dependency.manifestText),
            ),
          },
          paths,
          nested: dependency.nested,
        });
      }
      for (const path of own) held.add(path);
      // A walk only ever adds, so anything that has *left* a program has to be
      // taken out here or it outlives the decision that removed it. Three ways
      // to leave: an exclusion widened, a root was dropped, or the file was
      // deleted on disk between walks — the last of which no watcher event
      // covers after a branch switch.
      for (const path of session.paths) {
        // Still walked, and nothing excludes it: it stays.
        if (held.has(path) && !this.#isExcluded(path)) continue;
        // A file the editor holds open is not gone, whatever the walk found —
        // a branch switch deletes files that stay open, dirty, and restorable
        // with a save, and the buffer is the truth until the client says it
        // closed. The exclusion still wins over it, because a user who excludes
        // a file they have open has to see it leave; that asymmetry is the
        // whole reason this is a second test rather than an `||` on the first.
        if (this.#openPaths.has(path) && !this.#isExcluded(path)) {
          // Put back into the lists the walk rebuilds, and not merely left in
          // the session. `own`, `held` and each package's files are made fresh
          // from what this walk saw, so a file only the buffer knows about
          // would sit in a session no program admits to holding: `programFor`
          // finds neither owner nor holder, and hover, definition, references
          // and rename all answer `null` in a buffer the user is looking at,
          // until a keystroke happens to re-adopt it.
          //
          // **Put back where this walk says it goes**, never where the last one
          // did. Copying the previous program's lists reads a buffer as proof
          // of membership, and the two are different facts: a dependency
          // dropped from `dependencies`, a `hexagon.json` appearing beside the
          // file, a widened exclusion all change where the file belongs while
          // the buffer sits open and unchanged. Copied, the file survived as
          // `held` with no package behind it — which is how a session compiles
          // the project's *own* source, so a dependency's module was compiled
          // under the project's name and answered the very import Packages §7
          // exists to refuse. So the same two questions the doors ask, against
          // the lists this walk just built. Both are pure path tests and touch
          // no disk, which is what keeps the deleted-but-open file — the case
          // this clause exists for — working.
          if (this.#projectOwning(projectDirectories, path) === found.directory) {
            own.add(path);
            held.add(path);
            continue;
          }
          const holder = this.#packageHolding(packages, path);
          if (holder !== undefined) {
            holder.paths.add(path);
            held.add(path);
            continue;
          }
          // And where this walk gives it to neither, the buffer does not save
          // it: a file no package of this program holds is not this program's
          // to compile, and it leaves through the sweep below like any other.
        }
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
    // The session's own spelling, and no URI: the walk finds files the client
    // has never named, and inventing a URI for one here would make this
    // server's spelling of it the one every later location comes back under
    // (`UriPaths`).
    const path = normalizePath(file);
    // Normalized on the way in, because `pathFor` normalizes what it looks up
    // with: two spellings of one resolved path are two keys, and the miss is
    // silent. Recorded under the session path too, so exclusion can match the
    // walked file under *both* its names without asking the filesystem again.
    const resolved = normalizePath(realPath);
    this.#pathsByRealPath.set(resolved, path);
    this.#realPathOfPath.set(path, resolved);
    if (this.#isExcluded(path)) return undefined;
    // By path, not by URI: a client opens a buffer under its own spelling, and
    // matching the string means every rescan clobbers that buffer with disk text
    // on any platform whose URIs differ from the ones this server builds.
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
    return this.#isExcluded(this.pathFor(uri));
  }

  /**
   * Which of §2.2's bounds puts this file outside every package, where one
   * does — and nothing where the file is held, is excluded, or lies outside
   * every project the editor has open.
   *
   * Asked so that a host can *say* it. A file no program holds gets no
   * diagnostics, no hover and no navigation, and none of that looks any
   * different from a server that is broken: the grammar still colours the
   * buffer, the status bar still says the server is running, and the user's
   * next move is to file a bug rather than to open `hexagon.json`. §2.1's
   * `exclude` already had that sentence; the three bounds §2.2 states did not,
   * and they are the ones a user cannot see, because each is a fact about a
   * directory somewhere above the file rather than a line anyone wrote.
   *
   * **Both bounds can answer, and which one to say is a precedence.** The
   * boundary is always the outer of the two: the walk prunes the skipped names,
   * so a boundary it reported is never behind one, and therefore any skipped
   * name lies between that boundary and the file. The bound to *name* is the
   * one that would be there last — the innermost — because each sentence's way
   * out only moves the file to the next bound down, and a sentence whose repair
   * the next bound defeats sends the reader to do work that changes nothing:
   * opening the folder of `node_modules/acme/vendor` leaves a file in
   * `vendor/dist` exactly as stranded, under a different sentence.
   */
  outsideEveryPackage(uri: string): OutsideEveryPackage | undefined {
    const path = this.pathFor(uri);
    if (this.#programs.some((program) => program.held.has(path))) return undefined;
    // `exclude` has a sentence of its own, and it is the better one: it names a
    // line the user wrote.
    if (this.#isExcluded(path)) return undefined;
    const containing: readonly Bounded[] = [
      // A project's own directory carries no boundary list because it needs
      // none: every `hexagon.json` beneath a project that the walk can reach is
      // a program of its own (D1), so a file under one is held rather than
      // outside. The boundaries that strand a file are the ones inside a
      // dependency, which is nobody's project.
      ...this.#programs.map(({ directory }) => ({
        directory,
        nested: NO_BOUNDARIES,
        owner: { kind: "project" } as const,
      })),
      ...this.#programs.flatMap(({ packages }) =>
        packages.map(({ directory, nested, record }) => ({
          directory,
          nested,
          owner: { kind: "package", name: record.name } as const,
        }))
      ),
    ];
    let deepest: Bounded | undefined;
    for (const candidate of containing) {
      if (!within(candidate.directory, path)) continue;
      if (deepest === undefined || candidate.directory.length > deepest.directory.length) {
        deepest = candidate;
      }
    }
    if (deepest === undefined) return undefined;
    const boundary = deepestContaining(deepest.nested, path);
    // A boundary with nothing below it: opening that folder makes it a program
    // and the file its source, so the sentence may say so.
    if (boundary !== undefined && skippedDirectoryBetween(boundary, path) === undefined) {
      return { kind: "other-package", manifest: this.#displayPath(manifestPathOf(boundary)) };
    }
    // Otherwise the bound below it answers — asked of the boundary where there
    // was one, which is the same answer as asking the owner (no skipped name
    // lies above a boundary) and the clearer spelling of why.
    const under = boundary ?? deepest.directory;
    const skipped = skippedDirectoryBetween(under, path);
    if (skipped === undefined) return undefined;
    if (skipped !== "node_modules") return { kind: "skipped-directory", directory: skipped };
    return this.#underNodeModules(deepest, under, path);
  }

  /**
   * Which bound stands last under a `node_modules`, and so what the sentence
   * about it may offer.
   *
   * Only one shape can be repaired by the reader: a file directly inside a
   * package of **this project's own** `node_modules`, which a `dependencies`
   * entry in a manifest they have open reaches. Every other shape under one is
   * named and left there, and each was measured rather than reasoned about:
   *
   * - `node_modules/.cache/junk.hex` — no package holds it, so there is nothing
   *   to list;
   * - `node_modules/acme/node_modules/extra/extra.hex` — the bound is *Acme's*
   *   `node_modules`, and the manifest that could list `Extra` is Acme's, which
   *   sits under a `node_modules` and is not the reader's to edit. Writing
   *   `Extra` into the project's own `dependencies` leaves the file exactly as
   *   stranded and adds an entry that draws a Packages §7 report;
   * - `node_modules/loose/dist/built.hex` — listing `Loose` would leave the
   *   file under `Loose`'s own `dist`, which no manifest can argue with;
   * - `node_modules/acme/vendor/inside.hex` with `acme` unlisted — the file is
   *   inside the vendored package, so listing `Acme` would not reach it; that
   *   package's folder can be opened, which is the sentence it gets.
   */
  #underNodeModules(deepest: Bounded, under: string, path: string): OutsideEveryPackage {
    const unreached = (inside: string | undefined): OutsideEveryPackage => ({
      kind: "unreached-node-modules",
      inside,
    });
    // A vendored package's own `node_modules`: the bound belongs to the
    // boundary, whose name this server never read — it stopped the walk, it
    // never entered a closure — so the sentence names no package.
    if (under !== deepest.directory) return unreached(undefined);
    // A dependency's own `node_modules`. Named, with the package's name where
    // the closure knows one, and nothing offered.
    if (deepest.owner.kind === "package") return unreached(deepest.owner.name);
    const holding = packageUnderNodeModules(under, path);
    if (holding === undefined) return unreached(undefined);
    // Inside the package, but behind a bound of the package's own.
    const beneath = skippedDirectoryBetween(holding.root, path);
    if (beneath !== undefined) {
      return beneath === "node_modules"
        ? unreached(undefined)
        : { kind: "skipped-directory", directory: beneath };
    }
    if (holding.nested !== undefined) {
      return {
        kind: "other-package",
        manifest: this.#displayPath(manifestPathOf(holding.nested)),
      };
    }
    return { kind: "unlisted-dependency" };
  }

  /**
   * A path as a sentence should spell it: relative to the project it lies in,
   * and absolute where no open project contains it.
   *
   * A message carrying a whole temporary-directory prefix is a message a reader
   * skips, and the part that identifies the file is the part below their own
   * project directory.
   */
  #displayPath(path: string): string {
    const project = deepestContaining(
      this.#programs.map(({ directory }) => directory),
      path,
    );
    if (project === undefined) return path;
    // A root directory already ends in its separator; taking one more character
    // off would eat the first component of the name being shown.
    return path.slice(project.endsWith("/") ? project.length : project.length + 1);
  }

  /**
   * Whether this path is excluded, under either name it can be reached by.
   *
   * Both have to be tried. Matching only the literal path lets a symlink defeat
   * the exclusion — the walk follows links deliberately, so an excluded
   * directory reappears under a link's spelling with all its diagnostics.
   */
  #isExcluded(path: string): boolean {
    return excludes(this.#exclusionsFor(path), path, this.#realPathOfPath.get(path));
  }

  /**
   * The exclusions that decide about a path: the **deepest package directory**
   * containing it, and no other — the package whose source the file would be.
   *
   * The deepest, because a manifest of its own makes a directory a package of
   * its own and the file beneath it is that package's: its `exclude` is the one
   * about this file, its parent's is about the parent's own sources. That is
   * one rule for three cases the walk already reads the same way — a nested
   * project inside a project, an installed dependency inside a project's
   * `node_modules`, and a dependency nested inside another dependency. A path
   * no package directory contains at all — a `node_modules` no closure reached
   * — is excluded by nobody, and nobody holds it either.
   */
  #exclusionsFor(path: string): Exclusions {
    const realPath = this.#realPathOfPath.get(path);
    let deepest: { readonly directory: string; readonly exclude: Exclusions } | undefined;
    for (const scoped of this.#exclusions) {
      // Under either name the file can be reached by, for the reason
      // `#isExcluded` matches under both: a link is a second name for a file,
      // and the project it lies in can be reachable under only one of them.
      const holds = within(scoped.directory, path)
        || (realPath !== undefined && within(scoped.directory, realPath));
      if (!holds) continue;
      if (deepest === undefined || scoped.directory.length > deepest.directory.length) {
        deepest = scoped;
      }
    }
    return deepest?.exclude ?? NOTHING_EXCLUDED;
  }

  /** Takes over a file's contents from the editor, unsaved edits included. */
  async openDocument(document: TextDocument): Promise<void> {
    this.#openUris.add(document.uri);
    const path = this.pathFor(document.uri);
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
    // Settled here like everywhere else, rather than looked up. `pathFor`
    // answers synchronously, so an edit that arrives before its own open has
    // been processed still reaches the one entry the file has — where guessing
    // the URI's own path would add a second entry whenever the settled path
    // turns out to be another name for the file, and the duplicate would
    // outlive the race that made it, reporting every declaration in the file as
    // a duplicate of itself.
    const path = this.pathFor(document.uri);
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
    const path = this.pathFor(uri);
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
    const path = this.pathFor(uri);
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
    // remains the truth until the client says it closed, and its edits keep
    // landing on the entry it already has.
    if (this.#openUris.has(uri)) return;
    const path = this.pathFor(uri);
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
    // **A session holds Hexagon source.** A `hexagon.json` reaches the compiler
    // as a record (Packages §4.1) and never as a file, and the editor does send
    // one: the manifest is synchronised so that the `dependencies` repair is
    // measured against the buffer it lands in. Its text is read there, at the
    // moment the edit is built, and seated nowhere — which is also what keeps a
    // keystroke in the manifest from invalidating the whole program's analysis
    // and re-compiling it. One place, because this is the one door a file's
    // text arrives by: the open, the edit, the close and the disk reload all
    // come through here.
    if (path.slice(path.lastIndexOf("/") + 1) === MANIFEST_NAME) return;
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

  /** Removes a file from every program holding it, and its path's identity with it. */
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
    // The session path's identity goes with it: the entry is keyed by a path
    // the session no longer holds, and no removal used to reach it, so a
    // long-running server kept one per file it had ever seen.
    // Nothing observable turns on the removal, and that is by construction —
    // `pathFor` re-establishes the entry from the URI cache, which is what makes
    // dropping it safe (see the field's comment). Where it is *not* safe is one
    // map further on: `#pathsByRealPath` is the spelling the **walk** chose for
    // a resolved file, which is a fact about the workspace rather than about
    // whether the file exists this second. Measured, dropping it means a file
    // deleted and restored — which `git checkout` does to whole directories —
    // arrives under its other name as a path the project does not contain, and
    // stays out of the program until the next rediscovery. So it stays.
    this.#realPathOfPath.delete(path);
  }

  /**
   * The programs a file no program holds yet belongs to, and what each of them
   * takes it as.
   *
   * Asked **per program**, because one file is two things at once often enough
   * to be ordinary: a package a user opens as an editor root is that program's
   * own source and its neighbour's dependency in the same moment (D1). Owning
   * comes first — the enclosing project directory takes the file as its own
   * source, the **deepest** one, since a nested manifest is a project of its
   * own and lies inside its parent — and every *other* program whose closure
   * holds the file's package takes it as that package's source, which is what
   * makes a newly created file compile in all of them without a rediscovery.
   * A program that never owns the file and never holds its package does not
   * adopt it at all.
   *
   * Both routes apply the walk's bounds, because a door that seats what the
   * walk left out makes the walk's answer advisory. A package's files are the
   * `.hex` beneath its manifest with `node_modules`, this host's output
   * directories, and every directory holding a `hexagon.json` of its own
   * excluded (Packages §2.2), so:
   *
   * - a file under a skipped directory joins nothing. An installed package
   *   nobody listed in `dependencies` sits under a `node_modules` no closure
   *   reaches, and adopting one of its files would compile its module under
   *   the enclosing package's name and silently answer the very import
   *   Packages §7's not-a-dependency report exists to refuse;
   * - a file beneath a nested manifest joins nothing here either — it is that
   *   package's, and that package is in no closure yet;
   * - and the package a file does join is the **deepest** one containing it.
   *   npm nests one install inside another, so two packages of one closure can
   *   both contain a file; giving it to both gives one file two full names —
   *   `Acme.Lib` and `Bolt.Lib` — and Modules §2.2 then reports a module
   *   declared twice, naming two files under `node_modules` that the reader
   *   did not write and cannot correct.
   *
   * So a file the bounds put outside every package belongs to no program at
   * all, and stays out of every session until the package that owns it enters
   * some closure and a rediscovery seats it as that package's source.
   *
   * §2.1's `exclude` is the fourth bound and is not asked here, because it is
   * already asked earlier on every route into this: `openDocument`,
   * `updateDocument` and `#reloadFromDisk` each test `#isExcluded` immediately
   * before `#write`, and `#isExcluded` asks the manifest of the package the
   * file would join. That keeps the two questions where they answer best — one
   * about a *name* a manifest wrote, one about the shape of the tree — and
   * neither of them optional.
   */
  #adopters(path: string): readonly Program[] {
    // The project whose own walk would have reached the file. The bound is
    // asked of the deepest one and never falls back to a shallower project: a
    // file inside a package is that package's alone, so a project that cannot
    // reach it does not get it by being further away.
    const ownedBy = this.#projectOwning(
      this.#programs.map(({ directory }) => directory),
      path,
    );
    const owner = ownedBy === undefined
      ? undefined
      : this.#programs.find((program) => program.directory === ownedBy);
    const adopted: Program[] = [];
    for (const program of this.#programs) {
      if (program === owner) {
        program.own.add(path);
        adopted.push(program);
        continue;
      }
      const holder = this.#packageHolding(program.packages, path);
      if (holder === undefined) continue;
      holder.paths.add(path);
      // Once for the program, not once per package of it: a package's file list
      // is an option, `configure` replaces the whole set, and one file joins
      // exactly one package.
      this.#reconfigure(program);
      adopted.push(program);
    }
    return adopted;
  }

  /**
   * The project directory holding `path` as its **own** source, out of these,
   * or nothing where §2.2's bounds put it outside every one of them.
   *
   * `#packageHolding`'s sibling, and here for the same reason: the rule has two
   * halves, one about a package of a closure and one about a project's own
   * files, and each half is asked from two places — the rediscovery sweep and
   * the door an editor event arrives through. Written out at each site instead,
   * the two spellings agree only for as long as both are remembered, which is
   * the family of defect this file spent four review rounds closing.
   *
   * Two bounds, and no more: the **deepest** of the directories containing the
   * path, never widened to a shallower one when that answer refuses it, and
   * nothing skipped lying between the two — a `.hex` under a project's
   * `node_modules` is some dependency's source, and joining it to the project
   * would compile it under the project's package name. The list is a parameter
   * rather than `#programs` because the sweep asks about the directories a walk
   * has just produced, before any program exists to be asked.
   */
  #projectOwning(directories: readonly string[], path: string): string | undefined {
    const ownedBy = deepestContaining(directories, path);
    if (ownedBy === undefined) return undefined;
    return skippedDirectoryBetween(ownedBy, path) === undefined ? ownedBy : undefined;
  }

  /**
   * The package of a closure whose source `path` would be, or nothing where
   * §2.2's bounds put it outside every one of them.
   *
   * Takes the package list rather than the program, because the rediscovery
   * sweep asks it of the list a walk has just built, before any program exists
   * to hold it — which is the point: one question, one answer, whether a file
   * arrives through a door or survives a rediscovery in a buffer.
   */
  #packageHolding(packages: readonly HeldPackage[], path: string): HeldPackage | undefined {
    let holder: HeldPackage | undefined;
    for (const dependency of packages) {
      if (!within(dependency.directory, path)) continue;
      if (holder === undefined || dependency.directory.length > holder.directory.length) {
        holder = dependency;
      }
    }
    if (holder === undefined) return undefined;
    if (skippedDirectoryBetween(holder.directory, path) !== undefined) return undefined;
    // A `hexagon.json` beneath the package ends the package there. The walk
    // reports the boundaries it stopped at, so this asks what the walk saw
    // rather than looking for manifests of its own and disagreeing with it.
    if (holder.nested.some((boundary) => within(boundary, path))) return undefined;
    return holder;
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
   * **The session path a URI names** — the one boundary between what a client
   * spells and what this server holds, and the only place the two are related.
   *
   * Normally the answer is the URI's own path. The exception is a second name
   * for a file the walk already found, and there are two ways to get one: a
   * symlink beside its target, and — since discovery settles a project by its
   * canonical directory — a *root* reached through a link, which on macOS is
   * every project under a temporary directory and `/var`, and anywhere is a
   * symlinked checkout or `$HOME`. Both make one file two names. Keying by the
   * client's name alone would put one file into a session twice, or, where the
   * walk got there first, find nothing at all: a request handler would then
   * answer `null` for hover, definition, references, rename and the rest, in a
   * workspace that looks perfectly ordinary.
   *
   * So every way in asks this — the open, the watcher, the delete, and each of
   * the request handlers — and it is resolved against what the walk recorded
   * rather than by rewriting the path, so a scanned file keeps the spelling the
   * workspace uses and one the walk never saw takes its resolved name.
   *
   * The answer is handed to `UriPaths` as well as kept here, so the two agree
   * from the first time a URI is seen: `uris.toPath` on a URI this has settled
   * returns what this settled, and nothing downstream can pick up the URI's own
   * spelling by asking the wrong one of them.
   *
   * Synchronous, because the request handlers are, and one `realpath` per
   * distinct URI is the price of answering them at all; the answer is
   * remembered, so an edit pays nothing.
   */
  pathFor(uri: string): string {
    const known = this.#pathByUri.get(uri);
    if (known !== undefined) {
      // Re-asserted rather than assumed. `#erase` takes a removed file's
      // identity out of `#realPathOfPath`, and a URI answered from this cache
      // would then reach `#isExcluded` with only one of the file's two names —
      // so an exclusion written against the name a link resolves to would stop
      // matching for exactly the files that have just come back.
      this.#realPathOfPath.set(known.path, known.realPath);
      return known.path;
    }
    const realPath = normalizePath(settledPathSync(fileSystemPath(uri)));
    // The resolved spelling, where the walk has not already chosen one — never
    // the URI's own. One spelling inside the session is the whole rule: a file
    // the walk has not reached yet is reached under the same name the walk will
    // give it, so a newly created file joins the program it lies in and a
    // deleted one is erased from every program that held it.
    const path = this.#pathsByRealPath.get(realPath) ?? realPath;
    this.#pathByUri.set(uri, { path, realPath });
    // The client's own spelling of this file, so a location the server reports
    // goes back the way the editor asked for it even where the walk reached the
    // file first under a resolved name.
    this.uris.remember(uri, path);
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

/**
 * The **deepest** of these directories that contains `path`, or nothing where
 * none does.
 *
 * Deepest, everywhere it is asked: a package nested inside another contains the
 * same file as the one around it, and Packages §2.2 gives it to the inner one —
 * "its files belong to it alone, so no file ever has two full names". The
 * answer is never widened to a shallower directory when the deepest turns out
 * to refuse the file, for the same reason: a file inside a package is that
 * package's, and a project that cannot reach it does not get it by being
 * further away.
 */
function deepestContaining(
  directories: readonly string[],
  path: string,
): string | undefined {
  let deepest: string | undefined;
  for (const directory of directories) {
    if (!within(directory, path)) continue;
    if (deepest === undefined || directory.length > deepest.length) deepest = directory;
  }
  return deepest;
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
 *
 * The separators are written as escapes, never as literal control bytes: a
 * source file carrying one is binary to every text tool a reader has, and every
 * symbol in the file stops answering `grep`.
 */
function identityOf(diagnostic: Diagnostics.Diagnostic): string {
  const range = (span: Source.Span): string =>
    `${span.start.line}:${span.start.column}-${span.end.line}:${span.end.column}`;
  const labels = (diagnostic.labels ?? [])
    .map((label) => `${range(label.span)}|${label.message}`)
    .join("\u0000");
  return [
    diagnostic.severity,
    diagnostic.message,
    range(diagnostic.primary),
    labels,
    (diagnostic.notes ?? []).join("\u0000"),
  ].join("\u0001");
}

/**
 * Where a manifest **declares its name**, as a span: the `"name"` line, or the
 * file's first line where it has none.
 *
 * The line rather than the value, because the value is what a reader changes and
 * the key is how they find it — and because a manifest with no `name` at all is
 * still the file the report is sending them to.
 */
function manifestNameSpan(file: Source.File): Source.Span {
  const lines = file.text.split("\n");
  const at = manifestKeyLine(file.text, "name");
  const start = lines.slice(0, at).reduce((offset, line) => offset + line.length + 1, 0);
  // `\r` trimmed from the end alone: the offsets above count it, and a range
  // that included it would highlight past the end of the line.
  const end = start + (lines[at] ?? "").replace(/\r$/u, "").length;
  return file.span(start, end);
}

async function readText(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return undefined;
  }
}
