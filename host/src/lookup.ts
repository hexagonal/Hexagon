/**
 * Where a package's `dependencies` are found, under npm's layout.
 *
 * Packages §4.1 keeps two things apart. What a package **is** — a directory
 * holding a manifest, identified by the manifest's `name` and by the
 * directory's canonical path — is the language's, and the compiler validates it
 * (`validatePackageSet`). How a package directory is **found** is a host's
 * mechanism, and this file is that mechanism: the walk Node itself makes for a
 * requested name, from the asking package's own directory outward.
 *
 * Three properties are load-bearing, and each is a rule the spec argues for
 * rather than an implementation choice:
 *
 * - **From the asking package's own place.** `Acme`'s entries resolve from
 *   `Acme`'s canonical directory, not the project's, which is why a hoisted
 *   workspace works and why a nested copy is *found* rather than searched for.
 * - **The nearest level answers.** A copy at a farther level is shadowed **for
 *   that walk** and is never read; it enters the program only where some other
 *   package's own lookup answers with it, which is how a program comes to hold
 *   two (§4.3).
 * - **Nothing is indexed.** A package nobody lists is never sought, and no
 *   directory without a `hexagon.json` is read at all (§8's rejected
 *   alternative 9). The one scan wider than a single name is `installedAt`,
 *   which decides one *diagnostic* (§3.3's not-a-dependency report) and enters
 *   no closure and draws no refusal.
 */

import { readdir } from "node:fs/promises";
import { join } from "node:path";
import type { UnreadableManifest } from "../../compiler/src/index.js";
import { MANIFEST_NAME, readManifest, type Manifest } from "./manifest.js";
import { messageOf, normalizePath, realPathOf } from "./paths.js";

/** One package root a level holds, read (Packages §4.1). */
export interface Candidate {
  /** The canonical directory — the package's identity (§4.3). */
  readonly directory: string;
  /** The directory as the walk reached it, for a report a reader can follow. */
  readonly path: string;
  /** The name its manifest declares, where this spec accepts one. */
  readonly name: string | undefined;
  readonly manifest: Manifest;
  readonly manifestPath: string;
  readonly manifestText: string;
}

/** One `node_modules` directory, scanned once (Packages §4.1). */
export interface Level {
  readonly directory: string;
  /** Every package root here, in directory order. */
  readonly candidates: readonly Candidate[];
  /** Manifests scanned here that could not be read or were unlawful. */
  readonly unreadable: readonly UnreadableManifest[];
}

/** What one lookup answered (`ResolvedEdge`'s two halves). */
export interface LookupResult {
  readonly candidates: readonly Candidate[];
  readonly unreadable: readonly UnreadableManifest[];
}

/**
 * One discovery run's view of the filesystem, with each level scanned at most
 * once.
 *
 * The cache is per run and not per process: a run answers over the disk as it
 * was when it started, and an `npm install` between two runs must be seen. It
 * is also what keeps the cost honest — a level is the unit of work, a name is
 * not, so resolving twenty entries against one `node_modules` reads it once.
 */
export class Lookup {
  readonly #levels = new Map<string, Promise<Level>>();
  readonly #onError: (message: string) => void;

  constructor(onError: (message: string) => void = () => {}) {
    this.#onError = onError;
  }

  /**
   * The levels a walk from `from` visits, nearest first: `from`'s own
   * `node_modules`, then each ancestor's, outward to the filesystem root, an
   * ancestor named `node_modules` skipped as Node skips it.
   */
  levelDirectories(from: string): readonly string[] {
    const normalized = normalizePath(from);
    const parts = normalized.split("/").filter((part) => part !== "");
    const directories: string[] = [];
    for (let depth = parts.length; depth >= 0; depth -= 1) {
      // Node's own rule: a path segment that *is* `node_modules` contributes no
      // level of its own — its parent's is the one that answers.
      if (depth > 0 && parts[depth - 1] === "node_modules") continue;
      const directory = `/${parts.slice(0, depth).join("/")}`;
      directories.push(join(directory === "/" ? "/" : directory, "node_modules"));
    }
    return directories;
  }

  /**
   * Resolves one `dependencies` entry from a package's own canonical directory.
   *
   * The **nearest** level holding a manifest that declares the requested name
   * answers, with everything that level held under that name: none, one, or the
   * two canonical directories §4.3 refuses. Every manifest scanned on the way
   * that could not be read travels with the answer, because §7's
   * unresolvable-name report is the one place they are named.
   */
  async lookup(name: string, from: string): Promise<LookupResult> {
    const unreadable: UnreadableManifest[] = [];
    for (const directory of this.levelDirectories(from)) {
      const level = await this.#level(directory);
      unreadable.push(...level.unreadable);
      const declaring = level.candidates.filter((candidate) => candidate.name === name);
      if (declaring.length === 0) continue;
      // Two links at one level to one canonical directory are one candidate;
      // two canonical directories are §4.3's refusal, and the caller draws it.
      const byDirectory = new Map(declaring.map((candidate) => [candidate.directory, candidate]));
      return { candidates: [...byDirectory.values()], unreadable };
    }
    return { candidates: [], unreadable };
  }

  /**
   * The names a package at `from` is **installed** for (Packages §4.1's sense):
   * every name its own lookup would answer with, one candidate at the nearest
   * level declaring it.
   *
   * This is the diagnostic set alone — Modules §2.3's not-a-dependency report
   * reads it and nothing else does. It enters no closure, refuses nothing, and
   * a name two roots declare at one level is **not** in it, since that lookup
   * answers with no package (round 5's reading).
   */
  async installedAt(from: string): Promise<ReadonlySet<string>> {
    const installed = new Set<string>();
    const answered = new Set<string>();
    for (const directory of this.levelDirectories(from)) {
      const level = await this.#level(directory);
      const byName = new Map<string, Set<string>>();
      for (const candidate of level.candidates) {
        if (candidate.name === undefined) continue;
        const seated = byName.get(candidate.name);
        if (seated === undefined) byName.set(candidate.name, new Set([candidate.directory]));
        else seated.add(candidate.directory);
      }
      for (const [name, directories] of byName) {
        // A nearer level has already answered for this name, one way or the
        // other; a farther copy is shadowed for this walk (§4.1).
        if (answered.has(name)) continue;
        answered.add(name);
        if (directories.size === 1) installed.add(name);
      }
    }
    return installed;
  }

  #level(directory: string): Promise<Level> {
    const known = this.#levels.get(directory);
    if (known !== undefined) return known;
    const scanned = this.#scan(directory);
    this.#levels.set(directory, scanned);
    return scanned;
  }

  /**
   * One level's package roots: the level's entries, and the entries of any
   * `@scope` entry, that hold a `hexagon.json` — nothing deeper.
   *
   * `.bin` and `.package-lock.json` are not roots because they hold no
   * manifest, and a nested `node_modules` is a level of another package's walk
   * — the nearest one for the package that holds it. A directory with no
   * `hexagon.json` is a JavaScript package (§4.4) and is read for nothing.
   */
  async #scan(directory: string): Promise<Level> {
    const roots = await this.#packageRoots(directory);
    const candidates: Candidate[] = [];
    const unreadable: UnreadableManifest[] = [];
    for (const path of roots) {
      const result = await readManifest(path);
      if (!result.present) continue;
      const manifestPath = join(path, MANIFEST_NAME);
      if (!result.readable) {
        // Named only inside the unresolvable-name report of a lookup that
        // scanned it (§4.1): a broken manifest that answered nothing broke
        // nothing in the program.
        unreadable.push({
          path: normalizePath(manifestPath),
          reason: result.problems[0]?.message ?? "could not be read",
        });
        continue;
      }
      candidates.push({
        directory: normalizePath(await realPathOf(path)),
        path: normalizePath(path),
        // A manifest that parses and declares no name this spec accepts — a
        // linked project's, `"Hex"`, `"acme"` — is a candidate for no name, and
        // is named nowhere: nothing about it is broken (§4.1).
        name: result.manifest.name,
        manifest: result.manifest,
        manifestPath: normalizePath(manifestPath),
        manifestText: result.text,
      });
    }
    return { directory, candidates, unreadable };
  }

  async #packageRoots(directory: string): Promise<readonly string[]> {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      // A level that is not there is not an error: most ancestors have no
      // `node_modules`, and a walk that reported each one would report on every
      // directory between a project and the filesystem root.
      return [];
    }
    const roots: string[] = [];
    for (const entry of entries) {
      if (entry.name.startsWith("@")) {
        try {
          const scoped = await readdir(join(directory, entry.name), { withFileTypes: true });
          for (const inner of scoped) roots.push(join(directory, entry.name, inner.name));
        } catch (error) {
          this.#onError(`could not list ${join(directory, entry.name)}: ${messageOf(error)}`);
        }
        continue;
      }
      roots.push(join(directory, entry.name));
    }
    return roots;
  }
}
