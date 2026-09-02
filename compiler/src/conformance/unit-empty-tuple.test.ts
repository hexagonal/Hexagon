import { describe, expect, test } from "vitest";

import { compileMain, projectDiagnostics, runMain } from "../support/test-project.js";

/**
 * Conformance for `Unit` as the empty tuple (ruling #159,
 * `spec/decisions-ml-dialect-unit-2026-07.md`).
 *
 * The ruling's whole claim is that nothing observable changes: `Unit` leaves
 * the primitive set and becomes the arity-0 member of the tuple family, its
 * constraints become the automatic structural instances (vacuous at zero
 * components), and its representation becomes the arity-0 clause of the
 * arity-indexed tuple rule — same `undefined`, same constants. So half of
 * these tests pin outputs that must *not* move (§5's verified table), and the
 * other half pin the places where the tuple machinery now answers where a
 * decree used to: the K = 0 arity error, exhaustiveness through the tuple
 * clause, the type-position redirect, and user-closure under `honor`.
 *
 * The Functions §5.3 boundary — `() -> T` versus `Unit -> T`, the ruling's
 * §3.1 regression guard — keeps its own conformance file,
 * `nullary-unit.test.ts`, which must stay green alongside this one.
 */
describe("the §5 constants: zero observable change", () => {
  test("`show ()` is `\"()\"`, alone and inside a composite", async () => {
    const module = await runMain(
      'export let shown: String = "${()}"\n' +
        'export let composite: String = "${((), 1)}"\n',
    );

    expect(module.shown).toBe("()");
    expect(module.composite).toBe("((), 1)");
  });

  test("equality and ordering are the vacuous structural answers", async () => {
    const module = await runMain(
      "export let equal: Bool = () == ()\n" +
        "export let strict: Bool = () < ()\n" +
        "export let loose: Bool = () <= ()\n",
    );

    expect(module.equal).toBe(true);
    expect(module.strict).toBe(false);
    expect(module.loose).toBe(true);
  });

  test("ordering reaches `Unit` through a dictionary too", async () => {
    // The generic path hands the call a structural `Ord` dictionary built at
    // arity 0, rather than inlining the comparison — same answer either way.
    const module = await runMain(
      "export let order<a: Ord>(left: a, right: a): Bool = left <= right\n" +
        "export let ordered: Bool = order((), ())\n",
    );

    expect(module.ordered).toBe(true);
  });

  test("`Hash.hash(())` is `0`, the empty `mixHash` fold's seed", async () => {
    // The §5 continuity fact: `stableHash(undefined)` and the zero-element
    // structural fold produce the *same* constant, so hashes persisted under
    // the primitive regime stay valid under the structural one.
    const module = await runMain("export let hashed: Int = Hash.hash(())\n");

    expect(module.hashed).toBe(0);
  });
});

describe("the tuple machinery answers at arity 0 (#159 §2)", () => {
  test("`itemN` on `Unit` is the ordinary arity error at K = 0", () => {
    expect(projectDiagnostics("export let broken: Int = ().item1\n")).toContain(
      "this tuple has 0 components; there is no item1",
    );
  });

  test("a `match` on `Unit` with a `()` arm is exhaustive with no `_`", () => {
    expect(
      projectDiagnostics(
        "export fun tag(u: Unit): Int =\n" +
          "    match u\n" +
          "        () => 1\n",
      ),
    ).toEqual([]);
  });

  test("`let () = e` destructures by running `e`, not `const [] = e`", async () => {
    // The finding-4 hazard: a generic arity-0 array destructure of the
    // `undefined` representation is a runtime TypeError. The pattern must
    // evaluate its right-hand side as a bare statement instead — pinned in the
    // emitted text, and executed to prove it does not throw.
    const source =
      "export fun effect(): Unit = ()\n" +
      "let () = effect()\n" +
      "export let after: Int = 1\n";
    const module = await runMain(source);
    expect(module.after).toBe(1);

    const emitted = compileMain(source).modules
      .find(({ source: file }) => file.path === "/main.hex")!.javascript.text;
    expect(emitted).toContain("effect();");
    expect(emitted).not.toContain("const [] =");
  });

  test("`honor` cannot target `Unit`: structural types are user-closed", () => {
    expect(
      projectDiagnostics(
        "honor Show<Unit> =\n" +
          '    show(value) = "nope"\n',
      ),
    ).toContain(
      "instances are keyed on type constructors; tuples and structural records " +
        "have compiler-derived instances only — declare a nominal `record` or " +
        "`union` for a type you control",
    );
  });

  test("a mismatch against `Unit` names `Unit`, never a 0-tuple", () => {
    // §2.2's display rule: the reclassification is spec vocabulary; a user
    // sees the type's one name, not tuple-arity talk.
    const messages = projectDiagnostics("export let wrong: Unit = (1, 2)\n");

    expect(messages.some((message) => message.includes("Unit"))).toBe(true);
    expect(messages.join("\n")).not.toContain("tuple arity mismatch");
  });
});

describe("`()` in type position (Products §6, #159 §3)", () => {
  test("a bare `()` redirects to `Unit`", () => {
    expect(projectDiagnostics("export let broken: () = ()\n")).toContain(
      "the empty tuple's type is written `Unit`; `()` in type syntax is only " +
        "the zero-parameter domain `() -> T`",
    );
  });

  test("`() -> T` stays the zero-parameter domain", () => {
    expect(
      projectDiagnostics(
        "let thunk: () -> Int = () => 5\n" +
          "export let five: Int = thunk()\n",
      ),
    ).toEqual([]);
  });
});

describe("the representation's arity-0 clause (#159 §4)", () => {
  const javascript = (source: string): string =>
    compileMain(source).modules.find(({ source: file }) => file.path === "/main.hex")!
      .javascript.text;

  const declarations = (source: string): string =>
    compileMain(source).modules.find(({ source: file }) => file.path === "/main.hex")!
      .declarations.text;

  test("`()` emits `undefined`, never `[]`", () => {
    expect(javascript("export let unit: Unit = ()\n")).toContain(
      "const unit = undefined;",
    );
  });

  test("the `.d.ts` face is `void` in return position and `undefined` elsewhere", () => {
    const rendered = declarations(
      "export fun ping(): Unit = ()\n" +
        "export let unit: Unit = ()\n" +
        "export fun consume(value: Unit): Int = 1\n",
    );

    expect(rendered).toContain("(): void;");
    expect(rendered).toContain("unit: undefined;");
    expect(rendered).toContain("value: undefined");
    expect(rendered).not.toContain("[]");
  });
});
