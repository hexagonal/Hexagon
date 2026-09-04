import { describe, expect, test } from "vitest";

import { compileProject, Source } from "../index";
import { PRELUDE_MODULES } from "../prelude";

/**
 * Conformance for the prelude mechanism (Modules §5.5;
 * `spec/notes/seq-deintrinsification-plan.md` Phase 3).
 *
 * §5.5 makes the prelude a fixed, *ordered* list of ordinary `.hex` modules:
 * each member implicitly sees the members before it in the list, and only those.
 * Cycles are therefore impossible by construction, which is what makes the list
 * order normative rather than incidental (`Option` precedes `Seq`; `Seq`
 * precedes the collection modules that convert to it). Prelude source carries no
 * `import` lines — the visibility is implicit, exactly as it is for user code.
 *
 * Before Phase 3 the scope reached only *non*-prelude modules, so every member
 * saw nothing. Note the trap that makes: "a later member is invisible" passed
 * before the fix too, for the wrong reason. The discriminating pair is that a
 * *backward* reference must now compile while a *forward* one must not.
 *
 * `injectPrelude` prefers a project file that already supplies a prelude
 * basename over the embedded fallback, which is how these tests substitute their
 * own members; the first test pins that mechanism, since everything below rests
 * on it.
 */

function project(files: readonly (readonly [string, string])[]) {
  return compileProject(
    files.map(([path, text], index) => new Source.File(Source.fileId(index), path, text)),
  );
}

function diagnostics(files: readonly (readonly [string, string])[]): readonly string[] {
  return project(files).diagnostics.map((diagnostic) => diagnostic.message);
}

/**
 * Relative imports in the emitted JavaScript that name a module the project did
 * not emit — the general form of defect 8, and the invariant both its entry
 * channels serve. Empty is the only acceptable value.
 */
function danglingImports(compiled: ReturnType<typeof project>): readonly string[] {
  const emitted = new Set(compiled.modules.map(({ source }) => source.path));
  const dangling: string[] = [];
  for (const module of compiled.modules) {
    for (const match of module.javascript.text.matchAll(/from\s+"(\.[^"]+)"/gu)) {
      const specifier = match[1];
      if (specifier === undefined) continue;
      const target = `${specifier.replace(/\.js$/u, "")}.hex`.replace(/^\.\//u, "/");
      if (!emitted.has(target)) dangling.push(`${module.source.path} -> ${specifier}`);
    }
  }
  return dangling;
}

/** A stand-in prelude whose members are the project's own, in `PRELUDE_MODULES` order. */
const ORDERING = ["/Ordering.hex", "module Ordering\n\n" + "export union Ordering = Less | Equal | Greater\n"] as const;
const OPTION = ["/Option.hex", "module Option\n\n" + "export union Option(a) = Some(value: a) | None\n"] as const;
const RESULT = ["/Result.hex", "module Result\n\n" + "export union Result(a, e) = Ok(value: a) | Err(error: e)\n"] as const;
const ENTRY = ["/main.hex", "module Main\n\n" + "export let ok: Int = 1\n"] as const;

/** `Result` gaining a backward reference to `Option` — no import line, per §5.5. */
const RESULT_USING_OPTION = [
  "/Result.hex",
  "module Result\n\n" + "export union Result(a, e) = Ok(value: a) | Err(error: e)\n" +
  "export fun toOption(result: Result(a, e)): Option(a) =\n" +
  "    match result\n" +
  "        Ok(value) => Some(value)\n" +
  "        Err(_) => None\n",
] as const;

describe("ordered intra-prelude visibility", () => {
  test("a project file at a prelude basename replaces the embedded member", () => {
    // The substitution every test below depends on. `Ordering` is declared only
    // by the embedded `Prelude.hex`; supplying our own without it must make the
    // name unavailable, proving the embedded copy is genuinely out of play.
    expect(diagnostics([
      ["/Ordering.hex", "module Ordering\n\n" + "export union Direction = Up | Down\n"],
      ["/main.hex", "module Main\n\n" + "export fun compare(): Ordering = Ordering.Less\n"],
    ])).not.toEqual([]);
  });

  test("a later member sees an earlier one, with no import line", () => {
    expect(diagnostics([ORDERING, OPTION, RESULT_USING_OPTION, ENTRY])).toEqual([]);
  });

  test("an earlier member does NOT see a later one", () => {
    // The discriminator. Before Phase 3 this passed because members saw
    // *nothing*; it must now fail specifically because `Result` comes later.
    expect(diagnostics([
      ORDERING,
      // The error payload is a `String`, not an `Int`: this stand-in sits at
      // `Option.hex`'s seat, which is *before* `stdlib/Int.hex`'s (#344), so an
      // integer literal here would raise its own — true, and beside the point.
      ["/Option.hex",
        "module Option\n\n" + "export union Option(a) = Some(value: a) | None\n" +
        "export fun toResult(option: Option(a)): Result(a, String) =\n" +
        "    match option\n" +
        "        Some(value) => Ok(value)\n" +
        "        None => Err(\"none\")\n"],
      RESULT,
      ENTRY,
    ])).toEqual([
      "unknown generic type `Result`",
      "unknown name `Ok`",
      "unknown name `Err`",
    ]);
  });

  test("the first member sees nothing", () => {
    expect(diagnostics([
      ["/Prelude.hex",
        "module Prelude\n\n" + "export union Ordering = Less | Equal | Greater\n" +
        "export fun wrap(n: Int): Option(Int) = Some(n)\n"],
      OPTION,
      RESULT,
      ENTRY,
    ])).toEqual([
      "unknown generic type `Option`",
      "unknown name `Some`",
    ]);
  });

  test("visibility is strictly backward, so a cycle cannot be written", () => {
    // Both directions at once: whichever member is later wins, and the earlier
    // one's reference is an error. This is §5.5's "cycles are impossible by
    // construction" as an executable statement.
    expect(diagnostics([
      ORDERING,
      // No integer literal, for the reason the case above gives: this seat is
      // before `stdlib/Int.hex`'s.
      ["/Option.hex",
        "module Option\n\n" + "export union Option(a) = Some(value: a) | None\n" +
        "export fun peek(result: Result(Int, Int), fallback: Int): Int = fallback\n"],
      RESULT_USING_OPTION,
      ENTRY,
    ])).toEqual(["unknown generic type `Result`"]);
  });

  test("consumers still see every member, in any order", () => {
    expect(diagnostics([
      ORDERING, OPTION, RESULT,
      ["/main.hex",
        "module Main\n\n" + "export fun a(): Ordering = Ordering.Less\n" +
        "export fun b(): Option(Int) = Some(1)\n" +
        "export fun c(): Result(Int, Int) = Ok(1)\n"],
    ])).toEqual([]);
  });
});

describe("emission follows the new dependency edge", () => {
  const USES_RESULT = [
    "/main.hex",
    "module Main\n\n" + "import Result as R\n" +
    "export fun use(r: Result(Int, Int)): Option(Int) = R.toOption(r)\n",
  ] as const;

  /**
   * The same dependency written explicitly rather than left implicit. This is a
   * *distinct entry channel* into the emission walk, and the one that makes
   * defect 8 predate Phase 3: an import line between project-supplied
   * prelude-basename files needs no §5.5 visibility, and was always legal.
   *
   * Its well-formedness is dated. §5.5's "no `import` lines in prelude source"
   * is currently a convention with no diagnostic behind it; should that become
   * an error, this configuration stops being writable and the synthesized
   * channel above becomes the only one. The invariant both channels serve does
   * not depend on the answer.
   */
  const RESULT_IMPORTING_OPTION = [
    "/Result.hex",
    "module Result\n\n" + "import Option as O\n" +
    "export union Result(a, e) = Ok(value: a) | Err(error: e)\n" +
    "export fun toOption(result: Result(a, e)): O.Option(a) =\n" +
    "    match result\n" +
    "        Ok(value) => O.Some(value)\n" +
    "        Err(_) => O.None\n",
  ] as const;

  test("a member imported only by another member is still emitted", () => {
    // Emitting a prelude module only when a *consumer* imports it was correct
    // while members could not reference each other. Once they can, dropping a
    // module reachable only through another prelude module leaves the emitted
    // JavaScript importing a file that was never written — and the project
    // compiles clean, so the failure is silent. Reachability, not one hop.
    const compiled = project([ORDERING, OPTION, RESULT_USING_OPTION, USES_RESULT]);
    expect(compiled.diagnostics).toEqual([]);
    const paths = compiled.modules.map(({ source }) => source.path);
    expect(paths).toContain("/Option.hex");
    expect(paths).toContain("/Result.hex");
    // Untouched by anything reachable, so still absent — the economy is intact.
    expect(paths).not.toContain("/Prelude.hex");
  });

  test("every import in the emitted output names an emitted module", () => {
    // The general form of the bug above, stated as an invariant over the whole
    // project rather than one path.
    expect(danglingImports(project([ORDERING, OPTION, RESULT_USING_OPTION, USES_RESULT])))
      .toEqual([]);
  });

  test("a project touching no prelude member emits none of them", () => {
    const compiled = project([ORDERING, OPTION, RESULT, ENTRY]);
    expect(compiled.diagnostics).toEqual([]);
    expect(compiled.modules.map(({ source }) => source.path)).toEqual(["/main.hex"]);
  });

  test("defect 8's reproduction: the dependency written as an explicit import", () => {
    // On `main` this compiled clean, emitted ["/Result.hex", "module Result\n\n" + "/main.hex"], and
    // wrote `import ... from "./Hex/Option.js"` into Result.js — unloadable output
    // reported as success, with no Phase 3 machinery involved.
    const compiled = project([ORDERING, OPTION, RESULT_IMPORTING_OPTION, USES_RESULT]);
    expect(compiled.diagnostics).toEqual([]);
    expect(compiled.modules.map(({ source }) => source.path)).toContain("/Option.hex");
  });

  test("the invariant holds on the explicit channel too", () => {
    const compiled = project([ORDERING, OPTION, RESULT_IMPORTING_OPTION, USES_RESULT]);
    expect(danglingImports(compiled)).toEqual([]);
  });
});

describe("drift guard: the embedded prelude matches stdlib/", () => {
  // `compiler/src/prelude.ts` embeds a copy of each canonical `stdlib/` file so
  // that `compileProject` stays filesystem-free, and its header has always
  // claimed "a test asserts the two never drift" — but no such test existed.
  // Written generically over `PRELUDE_MODULES` rather than over three names, so
  // a member joining the set (Phase 4's `Seq.hex`) is covered with no edit here,
  // which is what the work order asks for.
  const stdlibSources = import.meta.glob("../../../stdlib/*.hex", {
    eager: true,
    query: "?raw",
    import: "default",
  }) as Record<string, string>;

  test("every prelude member has a canonical stdlib original", () => {
    const missing = PRELUDE_MODULES
      .map(({ basename }) => basename)
      .filter((basename) =>
        !Object.keys(stdlibSources).some((path) => path.endsWith(`/${basename}`)),
      );
    expect(missing).toEqual([]);
  });

  test.each(PRELUDE_MODULES.map(({ basename, source }) => [basename, source] as const))(
    "%s is byte-identical to its stdlib original",
    (basename, source) => {
      const entry = Object.entries(stdlibSources)
        .find(([path]) => path.endsWith(`/${basename}`));
      expect(entry?.[1]).toBe(source);
    },
  );
});
