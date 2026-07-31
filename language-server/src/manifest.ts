/**
 * `hexagon.json` — how a project says what it is.
 *
 * Without one, a workspace root is just "every `.hex` file underneath, compiled
 * together", and that guess is wrong in two ways that a language server cannot
 * recover from on its own:
 *
 * - **Some modules are privileged.** `Node(a)`, the hidden fixed-32 trie node,
 *   resolves only inside a runtime module. The compiler has always modelled this
 *   (`ProjectOptions.runtimePaths`), but nothing could tell a *server* which
 *   files those are, so it reported every use of `Node` in the Hexagon
 *   repository's own `runtime/VectorTrie.hex` as an unknown type — 38 errors
 *   that are not errors.
 * - **Some files are not the project.** Generated output, deliberately-broken
 *   examples, a vendored copy. Compiling them alongside real source produces
 *   diagnostics about files nobody is working on.
 *
 * Guessing at either from a path — treating `runtime/` as privileged because of
 * its name — would be the same mistake as inferring meaning from a name
 * anywhere else. A project has to say so.
 *
 * The file is deliberately small. It answers "what is this project" and nothing
 * else: no dependency resolution, no build configuration, no compiler flags.
 * Those need designing rather than inventing, and nothing yet needs them.
 *
 * Reading it lives here rather than in the compiler because it is filesystem
 * work, and the compiler is deliberately free of a filesystem. The *shape*
 * mirrors `ProjectOptions`, so a future `hexc` can share the schema without
 * sharing the reader.
 */

import { readdir, readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { normalizePath } from "./positions.js";

export const MANIFEST_NAME = "hexagon.json";

export interface Manifest {
  /**
   * Paths compiled as privileged runtime modules, absolute, resolved against the
   * manifest's own directory.
   *
   * Files, one per module, and not directory prefixes — unlike `exclude`, which
   * takes either. Privilege is granted to a module rather than to a location,
   * and the compiler matches these by exact equality against the files it holds.
   * A directory here is reported rather than quietly matching nothing.
   */
  readonly runtimePaths: readonly string[];
  /**
   * Path prefixes that are not part of this project, absolute. Matching is by
   * directory prefix or exact file, not by glob: a glob language is a design
   * decision with its own edge cases, and prefixes answer every case that
   * motivated this without inventing one.
   */
  readonly exclude: readonly string[];
}

/** A problem with the manifest itself, reported against the manifest file. */
export interface ManifestProblem {
  readonly message: string;
  /** Zero-based line within `hexagon.json`, or 0 when the file did not parse. */
  readonly line: number;
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
}

const EMPTY: Manifest = { runtimePaths: [], exclude: [] };

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
    return { manifest: EMPTY, problems: [], present: false };
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
      problems: [{
        message: `${MANIFEST_NAME} is not valid JSON: ${
          error instanceof Error ? error.message : String(error)
        }`,
        line: 0,
        severity: "error",
      }],
    };
  }

  const problems: ManifestProblem[] = [];
  // Anchored to a key *position* — `"key"` followed by a colon — so a value that
  // happens to spell another key's name does not steal the report.
  const lineOf = (key: string): number => {
    const pattern = new RegExp(`^\\s*"${key}"\\s*:`, "u");
    const at = text.split("\n").findIndex((line) => pattern.test(line));
    return at < 0 ? 0 : at;
  };
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {
      manifest: EMPTY,
      present: true,
      problems: [{
        message: `${MANIFEST_NAME} must contain a JSON object`,
        line: 0,
        severity: "error",
      }],
    };
  }

  const record = parsed as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (key === "runtimePaths" || key === "exclude") continue;
    // Named rather than ignored: an unknown key is nearly always a misspelling
    // of a known one, and silence is what makes that expensive to find.
    problems.push({
      message: `unknown ${MANIFEST_NAME} key \`${key}\`; expected \`runtimePaths\` or \`exclude\``,
      line: lineOf(key),
      severity: "error",
    });
  }

  const readPaths = async (key: "runtimePaths" | "exclude"): Promise<readonly string[]> => {
    const value = record[key];
    if (value === undefined) return [];
    if (!Array.isArray(value)) {
      problems.push({
        message: `${MANIFEST_NAME} \`${key}\` must be an array of paths`,
        line: lineOf(key),
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
          line: lineOf(key),
          severity: "error",
        });
        continue;
      }
      // An entry that names nothing is the silent failure this file was written
      // to prevent, and the likeliest cause is a spelling the filesystem itself
      // forgives: macOS and Windows open `Trie.hex` when the file is `trie.hex`,
      // so the user's own editor gives them no hint, while path comparison here
      // is exact and the entry does nothing at all. A privileged module that is
      // not privileged brings back the very errors it was written to remove.
      if (!(await matchesExactly(rootPath, resolved))) {
        problems.push({
          message:
            `${MANIFEST_NAME} \`${key}\` entry ${JSON.stringify(entry)} matches no file or ` +
            "directory, so it has no effect (check the spelling, including its case)",
          line: lineOf(key),
          severity: "warning",
        });
      } else if (key === "runtimePaths" && await isDirectory(resolved)) {
        // The two fields are not symmetrical, and naming a directory here is the
        // natural mistake because `exclude` takes one. Privilege is granted to a
        // module, and a directory is not one: the entry would match no compiled
        // file, and the errors it was meant to remove would stay exactly as they
        // were with nothing pointing at the reason.
        problems.push({
          message:
            `${MANIFEST_NAME} \`runtimePaths\` entry ${JSON.stringify(entry)} is a directory; ` +
            "privilege is granted per module, so each file has to be listed",
          line: lineOf(key),
          severity: "error",
        });
        continue;
      }
      paths.push(resolved);
    }
    return paths;
  };

  return {
    // Sequential rather than concurrent so that problems are reported in the
    // order the fields are written, which is the order the user reads them in.
    manifest: {
      runtimePaths: await readPaths("runtimePaths"),
      exclude: await readPaths("exclude"),
    },
    problems,
    present: true,
  };
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
 * split the way `isExcluded` splits them — on `comparablePath`'s separator, not
 * the platform's — because the two have to agree about what a component is. A
 * second, nearly-identical notion of that is what `positions.ts` warns against,
 * and disagreeing here means reporting "has no effect" about an entry that
 * demonstrably does have one.
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

/** Whether anything at all is at this path, without caring what. */
async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/** Whether a path is a directory, following a link to ask what it points at. */
async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
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

/** A path with every link followed, or the path itself if it cannot resolve. */
async function realPathOf(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch {
    return path;
  }
}
