/**
 * `hexagon.json` — how a project says what it is.
 *
 * Without one, a root is just "every `.hex` file underneath, compiled
 * together", and that guess is wrong in a way no host can recover
 * from on its own: **some files are not the project** — generated output,
 * deliberately-broken examples, a vendored copy. Compiling them alongside real
 * source produces diagnostics about files nobody is working on, and guessing
 * from a path which those are would be the same mistake as inferring meaning
 * from a name anywhere else. A project has to say so.
 *
 * It once answered a second question — *which modules are privileged*, the
 * `runtimePaths` field, without which the server reported every use of `Node`
 * in the Hexagon repository's own `runtime/VectorTrie.hex` as an unknown type.
 * Since #829 the standard library is the package `Hex` in full and those two
 * modules are members of it (`stdlib/Runtime/VectorTrie.hex` declaring `module
 * Runtime.VectorTrie`), so both privileges follow from the name the header
 * declares rather than from a grant a host writes down, and the field went with
 * the question. Nothing here reads it, and a manifest that still carries one
 * draws the unknown-key report like any other stale key.
 *
 * The file is deliberately small. It answers "what is this project" and nothing
 * else: no build configuration, no compiler flags. Those need designing rather
 * than inventing, and nothing yet needs them.
 *
 * Two of its three fields are the *language's* rather than the host's — `name`
 * and `dependencies` (Packages §2.1) — and this reader validates them exactly
 * as far as one manifest can be read alone: `name` against §2.1's rule, each
 * `dependencies` entry against §2.4 and §4.4. It **resolves** nothing, and that
 * is a boundary rather than a stage: deciding that a listed name is installed,
 * or is installed twice, or closes a cycle needs every installed package's
 * manifest, and `lookup.ts` and `packages.ts` beside it are what read them.
 * A reader that guessed here would report "no installed package declares
 * `Bolt`" about a package sitting in `node_modules`, so it reads one file and
 * answers about one file.
 *
 * `scope` on each report is the same line drawn a second time, for the reader
 * of a manifest that is **not** the project's: a dependency publishes its
 * language reports and keeps the host's to itself (§4.1).
 *
 * Reading it lives here rather than in the compiler because it is filesystem
 * work, and the compiler is deliberately free of a filesystem. The *shape*
 * mirrors `ProjectOptions`, so a future `hexc` can share the schema without
 * sharing the reader — and the *judgement* is the compiler's own
 * (`packageNameRefusal`, `dependencyRefusal`), read through
 * `compiler/src/index.ts` as every other cross-package import in this directory
 * is. A reader reaching past the entry point pins itself to a file layout it
 * does not own, and a second answer to "is this a lawful package name" is how
 * a host comes to accept a name the compiler refuses.
 */

import { readdirSync, readFileSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { dependencyRefusal, packageNameRefusal } from "../../compiler/src/index.js";
import { messageOf, normalizePath, realPathOf } from "./paths.js";

export const MANIFEST_NAME = "hexagon.json";

/**
 * The package name a manifest's `name` value declares, where this spec accepts
 * it (Packages §2.1), and nothing otherwise.
 *
 * Shared with the level scan, which reads a manifest for this field alone: the
 * judgement is the compiler's (`packageNameRefusal`) and it must be one
 * judgement, or a lookup would answer with a name the compiler refuses.
 */
export function packageName(value: string): string | undefined {
  return packageNameRefusal(value) === undefined ? value : undefined;
}

/** The keys this reader knows, in the order §2.1 introduces them. */
const KNOWN_KEYS = ["name", "dependencies", "exclude"] as const;

export interface Manifest {
  /**
   * The package's name (Packages §2.1) — one uppercase-start identifier, and
   * the namespace segment of every module's full name (§2.3).
   *
   * Absent for a project that declares none, which is the ordinary case: a
   * project that is never published needs no name, and its modules' full names
   * are their declared names (§2.5). Absent too where the manifest declared one
   * this reader refused, so that a rejected name never silently rebrands every
   * module and every exception in the project.
   */
  readonly name: string | undefined;
  /**
   * The Hexagon packages this one's modules may import (Packages §2.1, §3.1).
   *
   * Validated in shape only — a name that is not one uppercase-start
   * identifier, and `"Hex"`, are refused here. Whether an installed package
   * declares each name is not asked: nothing here reads `node_modules`, so a
   * listed name contributes to the program's package set and supplies no
   * modules.
   */
  readonly dependencies: readonly string[];
  /**
   * Path prefixes that are not part of this project, absolute. Matching is by
   * directory prefix or exact file, not by glob: a glob language is a design
   * decision with its own edge cases, and prefixes answer every case that
   * motivated this without inventing one.
   */
  readonly exclude: readonly string[];
  /**
   * The npm version of the package sitting at this directory, where its
   * `package.json` declares one (Packages §4.2, §4.3).
   *
   * Read from `package.json` and never from `hexagon.json`: versions are npm's,
   * this spec designs none, and §4.3's installed-twice report is the one place
   * a version is printed — "the version where the npm manifest declares one".
   * Absent leaves the report naming the directory alone.
   */
  readonly version: string | undefined;
}

/** A problem with the manifest itself, reported against the manifest file. */
export interface ManifestProblem {
  readonly message: string;
  /** Zero-based line within `hexagon.json`, or 0 when the file did not parse. */
  readonly line: number;
  /**
   * Whose rule this report is: the **language's** or the **host's**.
   *
   * Packages §2.1 draws the line — "Two of its three fields are the *language's*
   * rather than the host's — `name` and `dependencies`. Other fields are the
   * host's" — and §4.1 says what a manifest that is not the project's is checked
   * for: "What a package that enters the set is checked for is its own
   * `dependencies`". So a dependency's manifest publishes its language reports
   * and keeps the host's to itself: an `exclude` entry naming a build directory
   * npm did not publish, or a field some other host reads, is not a fault its
   * consumer can act on, and `node_modules` is not a place anyone edits.
   */
  readonly scope: "language" | "host";
  /**
   * Whether this is a mistake or merely an entry that currently matches nothing.
   *
   * A misspelled key or a value of the wrong type is always wrong. An entry
   * naming a path that does not exist is a weaker claim: it does nothing today,
   * which is nearly always a typo, but `exclude: ["dist"]` in a fresh clone is
   * legitimately ahead of the build that creates it. Reporting both at the same
   * volume would either cry wolf on the second or stay silent on the first.
   */
  readonly severity: "error" | "warning";
}

export interface ManifestResult {
  readonly manifest: Manifest;
  readonly problems: readonly ManifestProblem[];
  /** False when the root has no manifest at all, which is not a problem. */
  readonly present: boolean;
  /**
   * False where a manifest **exists** and could not be read as a JSON object.
   *
   * The lookup needs the two apart (Packages §4.1). A manifest it cannot read is
   * "a candidate for no name" that is *named* in the unresolvable-name report of
   * the lookup that scanned it; one that reads and declares no name this spec
   * accepts is a candidate for no name that is **named nowhere**, "nothing about
   * it is broken". Telling them apart by looking for a parse message in
   * `problems` would make a sentence a reader sees into an interface a pass
   * depends on.
   */
  readonly readable: boolean;
  /**
   * The manifest's own text, so a report seated at one of its keys can be
   * placed on the right line. Empty where the file is absent.
   */
  readonly text: string;
}

const EMPTY: Manifest = { name: undefined, dependencies: [], exclude: [], version: undefined };

/**
 * Reads the manifest at a workspace root.
 *
 * A missing manifest is the ordinary case and yields defaults silently. A
 * *malformed* one is reported rather than ignored: a typo in a field name that
 * silently did nothing would leave a user staring at diagnostics they thought
 * they had configured away, with no indication why.
 */
export async function readManifest(rootPath: string): Promise<ManifestResult> {
  const path = join(rootPath, MANIFEST_NAME);
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch {
    return { manifest: EMPTY, problems: [], present: false, readable: false, text: "" };
  }

  let parsed: unknown;
  try {
    // VS Code writes a byte-order mark when `files.encoding` is `utf8bom`, and
    // `JSON.parse` rejects it with a message about an invisible character.
    parsed = JSON.parse(text.replace(/^\uFEFF/u, ""));
  } catch (error) {
    return {
      manifest: EMPTY,
      present: true,
      readable: false,
      text,
      problems: [{
        message: `${MANIFEST_NAME} is not valid JSON: ${
          error instanceof Error ? error.message : String(error)
        }`,
        line: 0,
        // The file that cannot be read at all: no `name` and no `dependencies`
        // can be read out of it, so the language's own reading has failed.
        scope: "language",
        severity: "error",
      }],
    };
  }

  const problems: ManifestProblem[] = [];
  const lineOf = (key: string): number => manifestKeyLine(text, key);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {
      manifest: EMPTY,
      present: true,
      readable: false,
      text,
      problems: [{
        message: `${MANIFEST_NAME} must contain a JSON object`,
        line: 0,
        scope: "language",
        severity: "error",
      }],
    };
  }

  const record = parsed as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if ((KNOWN_KEYS as readonly string[]).includes(key)) continue;
    // Named rather than ignored: an unknown key is nearly always a misspelling
    // of a known one, and silence is what makes that expensive to find.
    problems.push({
      message: `unknown ${MANIFEST_NAME} key \`${key}\`; expected ${
        KNOWN_KEYS.map((known) => `\`${known}\``).join(", ")
      }`,
      line: lineOf(key),
      scope: "host",
      severity: "error",
    });
  }

  /**
   * The package's own name (Packages §2.1), or nothing.
   *
   * A refused name yields `undefined` rather than the written string: the name
   * is the first segment of every module's full name and of every exception
   * brand (§2.3), so honouring one the spec refuses would carry the mistake
   * into every diagnostic and every emitted artefact instead of into one report
   * against the manifest.
   */
  const readName = (): string | undefined => {
    const value = record["name"];
    if (value === undefined) return undefined;
    if (typeof value !== "string") {
      problems.push({
        message: `${MANIFEST_NAME} \`name\` must be a string`,
        line: lineOf("name"),
        scope: "language",
        severity: "error",
      });
      return undefined;
    }
    const refusal = packageNameRefusal(value);
    if (refusal === undefined) return value;
    problems.push({ message: refusal, line: lineOf("name"), scope: "language", severity: "error" });
    return undefined;
  };

  /** The Hexagon packages this one lists (Packages §2.1), shape-checked only. */
  const readDependencies = (): readonly string[] => {
    const value = record["dependencies"];
    if (value === undefined) return [];
    if (!Array.isArray(value)) {
      problems.push({
        message: `${MANIFEST_NAME} \`dependencies\` must be an array of package names`,
        line: lineOf("dependencies"),
        scope: "language",
        severity: "error",
      });
      return [];
    }
    const names: string[] = [];
    for (const entry of value) {
      if (typeof entry !== "string") {
        problems.push({
          message: `${MANIFEST_NAME} \`dependencies\` entries must be strings`,
          line: lineOf("dependencies"),
          scope: "language",
          severity: "error",
        });
        continue;
      }
      const refusal = dependencyRefusal(entry);
      if (refusal !== undefined) {
        problems.push({
          message: refusal,
          line: manifestKeyLine(text, "dependencies", entry),
          scope: "language",
          severity: "error",
        });
        continue;
      }
      // A name listed twice is one dependency written twice, not two packages;
      // the second entry says nothing the first did not, so it is dropped
      // rather than reported — §2.1 makes the field a set of names.
      if (!names.includes(entry)) names.push(entry);
    }
    return names;
  };

  const readPaths = async (key: "exclude"): Promise<readonly string[]> => {
    const value = record[key];
    if (value === undefined) return [];
    if (!Array.isArray(value)) {
      problems.push({
        message: `${MANIFEST_NAME} \`${key}\` must be an array of paths`,
        line: lineOf(key),
        scope: "host",
        severity: "error",
      });
      return [];
    }
    const paths: string[] = [];
    for (const entry of value) {
      if (typeof entry !== "string") {
        problems.push({
          message: `${MANIFEST_NAME} \`${key}\` entries must be strings`,
          line: lineOf(key),
          scope: "host",
          severity: "error",
        });
        continue;
      }
      // Relative to the manifest, which is the only reading that survives the
      // project being checked out anywhere else.
      const resolved = resolve(rootPath, entry);
      if (key === "exclude" && await coversRoot(resolved, rootPath)) {
        // Testing equality alone is a line too narrow: `""`, `"."` and `"./"`
        // resolve *to* the root, but `".."` and `"/"` resolve above it and
        // exclude it just as totally — every file gone, nothing published
        // anywhere, and no explanation. The predicate has to be "is or contains
        // the root", not "is the root".
        problems.push({
          message:
            `${MANIFEST_NAME} \`exclude\` entry ${JSON.stringify(entry)} covers the workspace ` +
            "root, which would exclude the whole project",
          line: manifestKeyLine(text, key, entry),
          scope: "host",
          severity: "error",
        });
        continue;
      }
      // A directory holding a `hexagon.json` of its own is a package of its
      // own, and §2.2 already keeps every file of it out of this package — so
      // an entry naming one names nothing of this package's, and there is
      // nothing for it to do. Said out loud rather than dropped in silence,
      // because the user wrote the entry to make something stop happening and
      // nothing about it will: the nested package keeps its own program, its
      // own diagnostics and its own place in the editor, and the only file that
      // can bound it is its own manifest.
      //
      // The entry goes no further than this report. Left in the list it would
      // decide nothing — the walk reports the boundary whether the directory is
      // excluded or not — but it would still be a rule sitting in the manifest
      // that two readers could disagree about, and this way the warning's own
      // sentence is exactly true.
      if (key === "exclude" && await holdsManifest(resolved)) {
        problems.push({
          message:
            `${MANIFEST_NAME} \`exclude\` entry ${JSON.stringify(entry)} names a package of ` +
            `its own (it holds a \`${MANIFEST_NAME}\`), which is never part of this project; ` +
            "the entry has no effect",
          line: manifestKeyLine(text, key, entry),
          scope: "host",
          severity: "warning",
        });
        continue;
      }
      // An entry that names nothing is the silent failure this file was written
      // to prevent, and the likeliest cause is a spelling the filesystem itself
      // forgives: macOS and Windows open `Trie.hex` when the file is `trie.hex`,
      // so the user's own editor gives them no hint, while path comparison here
      // is exact and the entry does nothing at all. An `exclude` that excludes
      // nothing leaves in the project exactly the files it was written to keep
      // out, and reports that nowhere.
      if (!(await matchesExactly(rootPath, resolved))) {
        problems.push({
          message:
            `${MANIFEST_NAME} \`${key}\` entry ${JSON.stringify(entry)} matches no file or ` +
            "directory, so it has no effect (check the spelling, including its case)",
          line: manifestKeyLine(text, key, entry),
          scope: "host",
          severity: "warning",
        });
      }
      paths.push(resolved);
    }
    return paths;
  };

  return {
    // Sequential rather than concurrent so that problems are reported in the
    // order the fields are written, which is the order the user reads them in.
    manifest: {
      name: readName(),
      dependencies: readDependencies(),
      exclude: await readPaths("exclude"),
      version: await readVersion(rootPath),
    },
    problems,
    present: true,
    readable: true,
    text,
  };
}

/**
 * The npm version of the package at this directory, from its `package.json`.
 *
 * Silent about every failure, and deliberately: a missing, unreadable, or
 * malformed `package.json` beside a lawful `hexagon.json` is a package with no
 * version to print, which §4.3's report already has a shape for. This reader
 * answers what a package *is*; npm's file is not its to validate, and a report
 * about it would be a report about a field this spec designs none of (§4.2).
 */
async function readVersion(rootPath: string): Promise<string | undefined> {
  let text: string;
  try {
    text = await readFile(join(rootPath, "package.json"), "utf8");
  } catch {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(text.replace(/^\uFEFF/u, ""));
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
    const version = (parsed as Record<string, unknown>)["version"];
    return typeof version === "string" ? version : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The zero-based line a manifest key sits on, and the line its `entry` sits on
 * where one is named.
 *
 * Anchored to a key *position* — `"key"` followed by a colon — so a value that
 * happens to spell another key's name does not steal the report. An `entry` is
 * then sought at or below that line, which is what puts a `dependencies` report
 * on the entry a reader has to edit rather than on the field's own line.
 *
 * Exported because a report the *package set* draws (Packages §7) is seated at
 * a manifest and a key, and the manifest it names is often not the one being
 * read — a dependency's own `hexagon.json` under `node_modules` (D3).
 */
export function manifestKeyLine(text: string, key: string, entry?: string): number {
  const lines = text.split("\n");
  const at = lines.findIndex((line) => keyPattern(key).test(line));
  if (at < 0) return 0;
  if (entry === undefined) return at;
  const quoted = JSON.stringify(entry);
  const within = lines.findIndex((line, index) => index >= at && line.includes(quoted));
  return within < 0 ? at : within;
}

/**
 * Escaped, because unknown keys are user-typed and land in a regex: a bracket in
 * a misspelling — `"exclude["` — is otherwise a syntax error thrown from the
 * very report meant to explain it, and the throw takes language support down
 * with the manifest, the one thing a broken manifest must never do.
 */
function keyPattern(key: string): RegExp {
  const literal = key.replace(/[$()*+.?[\\\]^{|}]/gu, "\\$&");
  return new RegExp(`^\\s*"${literal}"\\s*:`, "u");
}

/**
 * Whether this path names something, spelled exactly as the filesystem spells
 * it.
 *
 * Asking `stat` would be the obvious test and is the wrong one: macOS and
 * Windows open `Trie.hex` when the file is `trie.hex`, so `stat` reports
 * success for exactly the entry that will then match nothing, since path
 * comparison here is exact. Reading each directory and looking for the literal
 * name is what makes the two agree. `realpath` would also reveal the true case
 * on macOS, but it resolves symlinks at the same time, so an entry that
 * legitimately names a link would come back as a mismatch.
 *
 * Components are checked from the root down, because the wrong case can be in
 * any of them and only the last one is visible in an error otherwise. They are
 * split on `/` after separator conversion, which is what `isExcluded` compares
 * on, because the two have to agree about what a component is — disagreeing
 * means reporting "has no effect" about an entry that demonstrably has one.
 * Conversion only, though, and not `comparablePath`: see below.
 */
async function matchesExactly(rootPath: string, resolved: string): Promise<boolean> {
  // Separators only. `comparablePath` would be the tempting reuse and is wrong
  // on a *relative* path: it resolves `..` by popping a component, and popping
  // an empty stack drops it, so `../vendor` arrives as `vendor` — the check
  // then walks down from the root instead of the parent, and every entry
  // outside the root is judged against the wrong directory in both directions.
  const within = relative(rootPath, resolved).replaceAll("\\", "/");
  if (within === "" || within === ".") return true;
  // Outside the root there is no chain to walk down from anywhere the user can
  // be assumed to be able to read, so existence is all that can be said —
  // which does mean a mis-cased entry outside the root goes unreported on a
  // filesystem that ignores case. `".."` is compared as a whole component: a
  // directory named `..foo` is inside the root and starts with the same two
  // characters.
  const parts = within.split("/");
  if (parts[0] === ".." || isAbsolute(within)) return await exists(resolved);
  let at = rootPath;
  for (const part of parts) {
    let entries: readonly string[];
    try {
      entries = await readdir(at);
    } catch {
      return false;
    }
    if (!entries.includes(part)) return false;
    at = join(at, part);
  }
  return true;
}

/**
 * Whether a `hexagon.json` sits at this directory — the one test that makes a
 * directory a package of its own (Packages §2.2) and a program of its own
 * (`environment.md` §4, D1).
 *
 * Spelled once, and here rather than beside any caller, because "is there a
 * manifest at this directory" is asked by four of them — the climb to a project
 * directory, an `exclude` entry naming a package, the walk, which asks it of
 * entries it has already read, and `packageUnderNodeModules`, which asks the
 * sync twin below.
 *
 * The directory is **read**, rather than the file `stat`ed, for
 * `matchesExactly`'s reason: macOS and Windows open `hexagon.json` when the file
 * on disk is `Hexagon.json`, so `stat` answers `true` for a directory this
 * host's own exact comparisons then treat as holding nothing — a project with a
 * manifest every later reader fails to find. Reading the directory and looking
 * for the literal name is what makes the answer and the filesystem agree. A
 * *directory* of that name is not a manifest either, and answering `true` for
 * one would make an ordinary folder a project with no file behind it.
 */
export async function holdsManifest(directory: string): Promise<boolean> {
  try {
    return (await readdir(directory, { withFileTypes: true })).some(isManifestEntry);
  } catch {
    return false;
  }
}

/**
 * `holdsManifest`, asked without waiting.
 *
 * One caller needs it: the language server's stranded-buffer notice, which is
 * decided inside a synchronous publication and has to know whether a package
 * sits under a `node_modules` before it can promise a `dependencies` entry
 * would reach the file. It is asked of a handful of directories, once per
 * stranded buffer per publication, and never of a `node_modules` itself.
 *
 * The two spellings share `isManifestEntry` rather than each testing the entry,
 * because the whole point of one predicate is that a second reader cannot come
 * to a different answer about the same directory.
 */
export function holdsManifestSync(directory: string): boolean {
  try {
    return readdirSync(directory, { withFileTypes: true }).some(isManifestEntry);
  } catch {
    return false;
  }
}

/**
 * What a manifest says its package's name is — the field a `dependencies` entry
 * has to match (Packages §4.1).
 *
 * Three answers and not two, because the two ways there is no name to write are
 * not the same fact: a manifest that parses and declares none is a lawful
 * package a lookup answers for nothing (§4.1), while one that could not be read
 * is a fault §7 names, with the parser's own message. Both readers of this field
 * need both, and neither needs the rest of the manifest — a real `node_modules`
 * level holds hundreds of packages nothing will ever resolve to.
 */
export type DeclaredPackageName =
  /** It parses and declares a name §2.1 accepts: the entry that reaches it. */
  | { readonly kind: "name"; readonly name: string }
  /** It parses, and declares no name this spec accepts — §4.1's no candidate. */
  | { readonly kind: "unnamed" }
  /** Not readable as a JSON object at all, with the reason §7 would print. */
  | { readonly kind: "unreadable"; readonly reason: string };

/**
 * That field, read out of a manifest's **text**.
 *
 * The text and not the path, so that the level scan — which waits — and the
 * language server's stranded-buffer sentence — which cannot — are one reader
 * and not two. They differ only in how the bytes arrive, and the field they
 * disagreed about would be the one deciding whether a `dependencies` entry
 * reaches a package.
 */
export function nameInManifest(text: string): DeclaredPackageName {
  let parsed: unknown;
  try {
    // VS Code writes a byte-order mark when `files.encoding` is `utf8bom`, and
    // `JSON.parse` rejects it with a message about an invisible character.
    parsed = JSON.parse(text.replace(/^\uFEFF/u, ""));
  } catch (error) {
    return { kind: "unreadable", reason: `${MANIFEST_NAME} is not valid JSON: ${messageOf(error)}` };
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { kind: "unreadable", reason: `${MANIFEST_NAME} must contain a JSON object` };
  }
  const declared = (parsed as Record<string, unknown>)["name"];
  if (typeof declared !== "string") return { kind: "unnamed" };
  const accepted = packageName(declared);
  return accepted === undefined ? { kind: "unnamed" } : { kind: "name", name: accepted };
}

/**
 * A package root's declared name, read without waiting and throwing nothing.
 *
 * The same caller `holdsManifestSync` has, one step further on: the language
 * server decides a stranded buffer's sentence inside a synchronous publication,
 * and "add it to `dependencies`" is only a repair where there is a name to add.
 * It is asked of **one** directory — the package root `packageUnderNodeModules`
 * already named — and only where the sentence would otherwise carry that
 * repair, so no publication reads a manifest it does not need and the walk's own
 * read-free path is untouched.
 *
 * Every failure is an answer rather than a throw: a manifest that is a
 * directory, one too large or malformed to parse, one holding a JSON array, one
 * that vanished between the `readdir` and this read. A publication is not a
 * place an exception can be handled.
 */
export function declaredPackageNameSync(directory: string): DeclaredPackageName {
  try {
    return nameInManifest(readFileSync(join(directory, MANIFEST_NAME), "utf8"));
  } catch (error) {
    return { kind: "unreadable", reason: messageOf(error) };
  }
}

/**
 * The one test of a directory entry that makes its directory a package.
 *
 * Exported for the walk, which asks it of entries it has already read: the two
 * questions "is there a manifest here" and "was that entry the manifest" have
 * to have one answer, and they did not when the walk carried a predicate of its
 * own beside this one.
 */
export function isManifestEntry(entry: { name: string; isDirectory(): boolean }): boolean {
  return entry.name === MANIFEST_NAME && !entry.isDirectory();
}

/** Whether anything at all is at this path, without caring what. */
async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Whether a path is excluded, by exact match or by lying inside a directory.
 *
 * Both sides are brought to one spelling first, and it is deliberately the
 * *session's* spelling rather than a second one of this module's own. The
 * callers genuinely disagree — the walk builds native-separator paths with
 * `join`, the manifest with `resolve`, and the session normalizes — so any
 * private notion of "comparable" agrees with the session only for the path
 * shapes its author happened to try, and fails silently on the rest.
 */
export function isExcluded(path: string, exclude: readonly string[]): boolean {
  const target = comparablePath(path);
  return exclude.some((entry) => {
    const prefix = comparablePath(entry);
    if (target === prefix) return true;
    // A root prefix already ends in the separator; appending another would ask
    // for `//` and match nothing.
    return target.startsWith(prefix.endsWith("/") ? prefix : `${prefix}/`);
  });
}

/** One spelling for path comparison — the same one the session keys by. */
export const comparablePath = normalizePath;

/**
 * Whether excluding this path would take the workspace root with it.
 *
 * Under both of the root's names. A user who pastes an absolute path pastes
 * whatever their shell showed them, and on macOS that is the resolved one —
 * `/private/tmp/…` for a project under `/tmp`. Comparing against the literal
 * root alone lets that entry through, and the walk, which resolves as it goes,
 * then matches it and empties the project: no files, no errors, and a warning
 * saying the entry has no effect at the moment it removed everything.
 */
async function coversRoot(resolved: string, rootPath: string): Promise<boolean> {
  if (isExcluded(rootPath, [resolved])) return true;
  return isExcluded(await realPathOf(rootPath), [resolved]);
}

