import { describe, expect, test } from "vitest";

import { compileProject, Source } from "../index";

/**
 * Conformance for the qualified reachability of prelude names (Modules §6.4;
 * `spec/notes/compiler-conformance-defects.md` defect 10).
 *
 * §6.4 exists to underwrite §5.4: "The occlusion rule's *prelude version stays
 * reachable qualified* only works if every prelude name has a qualified home — a
 * companion module it also lives in." §5.4 leans on exactly that, promising that
 * after a module occludes `show`, "the prelude's version remains reachable
 * qualified."
 *
 * The prelude was seeded as *bare* names only. Terms went into a fallback scope
 * and type identities were registered, but the member module itself could not be
 * named, so no qualified path to it existed at all — `Option.Some` reported
 * `unknown name \`Option\``.
 *
 * Nothing depended on it while a module-level binder could not occlude a prelude
 * value (defect 9): no program could shadow `Some`, so the escape hatch had
 * nothing to protect. Fixing defect 9 made occlusion real, which makes this the
 * half that has to work.
 *
 * A prelude member is addressable as a **fallback** layer: an explicit
 * `import * as` of the same name is a module-level binding and wins (§5.4).
 */

function diagnostics(source: string): readonly string[] {
  return compileProject([new Source.File(Source.fileId(0), "/main.hex", source)])
    .diagnostics.map((diagnostic) => diagnostic.message);
}

function withModule(path: string, text: string, entry: string): readonly string[] {
  return compileProject([
    new Source.File(Source.fileId(1), path, text),
    new Source.File(Source.fileId(0), "/main.hex", entry),
  ]).diagnostics.map((diagnostic) => diagnostic.message);
}

describe("a prelude member is reachable by name", () => {
  test("its terms are, with no import line", () => {
    expect(diagnostics(
      "export let a: Option(Int) = Option.Some(1)\n" +
      "export let b: Option(Int) = Option.None\n" +
      "export let c: Result(Int, String) = Result.Ok(1)\n" +
      "export let d: Ordering = Prelude.Less\n",
    )).toEqual([]);
  });

  test("its types are", () => {
    expect(diagnostics(
      "export let a: Option.Option(Int) = Some(1)\n" +
      "export let b: Result.Result(Int, String) = Ok(1)\n",
    )).toEqual([]);
  });

  test("the bare spellings are untouched", () => {
    expect(diagnostics(
      "export let a: Option(Int) = Some(1)\n" +
      "export let b: Result(Int, String) = Ok(1)\n" +
      "export let c: Ordering = Less\n",
    )).toEqual([]);
  });

  test("a member that does not export the name still says so", () => {
    // The qualifier resolves; the *member* is what rejects the field. Before the
    // fix this reported `unknown name \`Option\`` — a different, misleading error.
    expect(diagnostics("export let a: Int = Option.notThere(1)\n")).toEqual([
      "module `Option` does not export `notThere`",
    ]);
  });
});

describe("qualified access is what makes occlusion survivable (§5.4 + §6.4)", () => {
  test("an occluding module still reaches the prelude version qualified", () => {
    // The whole point of §6.4. `Some` is occluded module-wide by a local
    // binding; `Option.Some` must still be the prelude's constructor.
    expect(withModule(
      "/Result.hex",
      "export union Result(a, e) = Ok(value: a) | Err(error: e)\n" +
      "export let tally: Int = 7\n",
      "export let tally: String = \"mine\"\n" +
      "export let local: String = tally\n" +
      "export let prelude: Int = Result.tally\n",
    )).toEqual([]);
  });
});

describe("an explicit alias is a module-level binding and wins", () => {
  test("`import * as Option` of a different module shadows the prelude member", () => {
    // §5.4: explicit imports enter the same layer as local bindings. The prelude
    // member is only a fallback, so this must resolve to the imported module —
    // and must not collide, which is what a same-layer registration would cause.
    expect(withModule(
      "/mine.hex",
      "export let greet(name: String): String = name\n",
      "import * as Option from \"./mine\"\n" +
      "export let a: String = Option.greet(\"x\")\n",
    )).toEqual([]);
  });

  test("the shadowed prelude type is still nameable unqualified", () => {
    expect(withModule(
      "/mine.hex",
      "export let greet(name: String): String = name\n",
      "import * as Option from \"./mine\"\n" +
      "export let a: Option(Int) = Some(1)\n" +
      "export let b: String = Option.greet(\"x\")\n",
    )).toEqual([]);
  });
});
