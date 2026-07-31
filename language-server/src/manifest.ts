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

import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

export const MANIFEST_NAME = "hexagon.json";

export interface Manifest {
  /**
   * Paths compiled as privileged runtime modules, absolute, resolved against the
   * manifest's own directory.
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
    parsed = JSON.parse(text);
  } catch (error) {
    return {
      manifest: EMPTY,
      present: true,
      problems: [{
        message: `${MANIFEST_NAME} is not valid JSON: ${
          error instanceof Error ? error.message : String(error)
        }`,
        line: 0,
      }],
    };
  }

  const problems: ManifestProblem[] = [];
  const lineOf = (key: string): number => {
    const at = text.split("\n").findIndex((line) => line.includes(`"${key}"`));
    return at < 0 ? 0 : at;
  };
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {
      manifest: EMPTY,
      present: true,
      problems: [{ message: `${MANIFEST_NAME} must contain a JSON object`, line: 0 }],
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
    });
  }

  const readPaths = (key: "runtimePaths" | "exclude"): readonly string[] => {
    const value = record[key];
    if (value === undefined) return [];
    if (!Array.isArray(value)) {
      problems.push({ message: `${MANIFEST_NAME} \`${key}\` must be an array of paths`, line: lineOf(key) });
      return [];
    }
    const paths: string[] = [];
    for (const entry of value) {
      if (typeof entry !== "string") {
        problems.push({ message: `${MANIFEST_NAME} \`${key}\` entries must be strings`, line: lineOf(key) });
        continue;
      }
      // Relative to the manifest, which is the only reading that survives the
      // project being checked out anywhere else.
      paths.push(resolve(rootPath, entry));
    }
    return paths;
  };

  return {
    manifest: { runtimePaths: readPaths("runtimePaths"), exclude: readPaths("exclude") },
    problems,
    present: true,
  };
}

/** Whether a path is excluded, by exact match or by lying inside a directory. */
export function isExcluded(path: string, exclude: readonly string[]): boolean {
  return exclude.some((entry) => path === entry || path.startsWith(`${entry}/`));
}
