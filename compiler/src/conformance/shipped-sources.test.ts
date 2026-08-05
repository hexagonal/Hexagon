import { describe, expect, test } from "vitest";

import { compileFiles } from "../support/test-project.js";
import { PRELUDE_MODULES } from "../prelude.js";
import * as Source from "../support/source.js";

/**
 * Every `.hex` file this repository ships is a compiler input (#218).
 *
 * The gap this closes: `stdlib/Vector.hex` — the canonical public `Vector`
 * companion (Collections Part 3 §7) and the home of the prelude `IndexError`/
 * `SliceError` exceptions — was compiled by *nothing*. It is not embedded in the
 * prelude, no conformance test loaded it, and no CI step typechecked `stdlib/`.
 * A `.hex` file no build step reads can drift arbitrarily from the language it
 * is written in and nothing reports it; during the `size` -> `length` rename the
 * file was edited throughout and every suite stayed green regardless of whether
 * the edit was correct. `runtime/VectorTrie.hex` was only incidentally covered,
 * by `vector-trie.test.ts` appending probes to its source.
 *
 * The sweep is a *glob*, not a list, so a new `stdlib/` or `runtime/` module is
 * covered the moment it lands rather than when someone remembers to add it here.
 *
 * ## One project per file
 *
 * Each file is compiled as its own project rather than all of them as one. That
 * is the shape a consumer actually compiles a standard-library module in, it
 * attributes a failure to one file without a second file's errors in the way,
 * and it keeps modules that occlude one another's exported names (Modules §5.4 —
 * `Vector.hex` exports `length` and `prepend`, both prelude `Seq` names) from
 * inventing coupling the real compile does not have.
 *
 * ## Prelude members need no special case
 *
 * Five of these files are also embedded in the compiler as prelude sources
 * (`PRELUDE_MODULES`), and a prelude module sees the members before it and never
 * itself — so compiling one as an *ordinary* project module would report
 * diagnostics that say nothing about the file. This test never has to know which
 * files those are, because `injectPrelude` prefers a project's own file over the
 * embedded fallback *by basename, wherever that file sits* (pinned by
 * `prelude-mechanism.test.ts`, "a project file at a prelude basename replaces
 * the embedded member"). Supplying `Bool.hex` therefore compiles it in its real
 * prelude role, and supplying `Vector.hex` compiles it as an ordinary module —
 * each in whatever role the compiler assigns its basename, with the right
 * visibility either way. That is why nothing here enumerates today's five
 * basenames, and why this keeps working unchanged when `stdlib/Vector.hex` joins
 * the prelude set: the file's role changes, the case does not.
 *
 * A prelude member reached by nothing is compiled and checked but not *emitted*
 * (`CompiledProject.modules` holds only what the project would write), so these
 * projects are measured by their diagnostics, never by their module list.
 *
 * ## Runtime privilege
 *
 * `runtime/*.hex` compiles clean only as a privileged runtime module — the
 * `Node(a)` spelling is gated on `resolve`'s `runtime` flag, and unprivileged
 * `VectorTrie.hex` reports 38 diagnostics. The project manifest `hexagon.json`
 * grants exactly that, by listing `runtime/VectorTrie.hex` under `runtimePaths`;
 * the sweep grants it to the whole `runtime/` directory, which is the rule the
 * manifest is written from.
 */

const STDLIB_SOURCES = import.meta.glob("../../../stdlib/*.hex", {
  eager: true,
  query: "?raw",
  import: "default",
});

const RUNTIME_SOURCES = import.meta.glob("../../../runtime/*.hex", {
  eager: true,
  query: "?raw",
  import: "default",
});

interface Subject {
  /** Repository-relative path — the test's name, and what a failure points at. */
  readonly label: string;
  /** Path inside the compiled project: the basename at the root, which is where
   *  a prelude member's own file has to sit to replace the embedded copy. */
  readonly path: string;
  readonly source: string;
  /** Compiled with `runtime` privilege (the `Node(a)` gate). */
  readonly privileged: boolean;
}

function subjects(
  sources: Record<string, string>,
  directory: string,
  privileged: boolean,
): readonly Subject[] {
  return Object.entries(sources)
    .map(([globPath, source]) => {
      const basename = globPath.slice(globPath.lastIndexOf("/") + 1);
      return { label: `${directory}/${basename}`, path: `/${basename}`, source, privileged };
    })
    .sort((left, right) => left.label.localeCompare(right.label));
}

const SUBJECTS: readonly Subject[] = [
  ...subjects(STDLIB_SOURCES, "stdlib", false),
  ...subjects(RUNTIME_SOURCES, "runtime", true),
];

function compile(subject: Subject, source: string): ReturnType<typeof compileFiles> {
  return compileFiles(
    [[subject.path, source]],
    subject.privileged ? { runtimePaths: [subject.path] } : {},
  );
}

/**
 * Diagnostics rendered with file and position. A bare message is unreadable
 * here: the project holds the injected prelude too, so which file failed is half
 * the information. The subject is the project's only supplied file, so it holds
 * file id 0 (`compileFiles` numbers what it is handed from zero, and
 * `injectPrelude` allocates above the highest supplied id); the rest of the map
 * comes from the emitted modules, and anything left over is a prelude member the
 * project did not emit.
 */
function report(project: ReturnType<typeof compileFiles>, subject: Subject): readonly string[] {
  const paths = new Map<Source.FileId, string>([
    [Source.fileId(0), subject.path],
    ...project.modules.map(({ source }) => [source.id, source.path] as const),
  ]);
  return project.diagnostics.map(({ severity, message, primary }) =>
    `${paths.get(primary.fileId) ?? "<unemitted prelude module>"}:${primary.start.line + 1}:` +
    `${primary.start.column + 1} ${severity}: ${message}`,
  );
}

describe("every shipped .hex file compiles", () => {
  test.each(SUBJECTS.map((subject) => [subject.label, subject] as const))(
    "%s reports no diagnostics",
    (_label, subject) => {
      expect(report(compile(subject, subject.source), subject)).toEqual([]);
    },
  );

  test.each(SUBJECTS.map((subject) => [subject.label, subject] as const))(
    "%s is genuinely compiled: a break in it is reported",
    (_label, subject) => {
      // The assertion above passes just as well on a file the compiler never
      // looked at, and one route to that is silent: a project whose only source
      // is a prelude basename emits nothing at all, so no module list can
      // witness the work. Appending an unresolvable name is the cheapest thing
      // that must be reported by every role a subject can hold — prelude member,
      // ordinary module, or privileged runtime module.
      const broken = `${subject.source}\nlet vacuityProbe: Int = noSuchNameProbe\n`;
      expect(report(compile(subject, broken), subject)).not.toEqual([]);
    },
  );

  test("the sweep reaches the files it exists for", () => {
    // A glob that matched nothing would make every case above disappear rather
    // than fail — `test.each([])` is not an error. Naming the two files #218 was
    // written about pins the floor; the prelude set is checked against the sweep
    // rather than restated in it, so a member joining `PRELUDE_MODULES` without a
    // `stdlib/` original fails here.
    const labels = SUBJECTS.map(({ label }) => label);
    expect(labels).toContain("stdlib/Vector.hex");
    expect(labels).toContain("runtime/VectorTrie.hex");
    for (const { basename } of PRELUDE_MODULES) expect(labels).toContain(`stdlib/${basename}`);
  });
});
