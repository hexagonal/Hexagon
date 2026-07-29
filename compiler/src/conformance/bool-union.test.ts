import { describe, expect, test } from "vitest";

import { compileMain, projectDiagnostics, runMain } from "../support/test-project.js";

/**
 * Conformance for `Bool` as a prelude union (ruling #147,
 * `spec/decisions-ml-dialect-bool-2026-07.md`).
 *
 * Two things are under test and they pull in opposite directions. `Bool` must be
 * an *ordinary* union in every semantic respect — declared in real prelude
 * source, matched by constructor patterns, exhaustive by closed-constructor
 * checking, derived rather than decreed. And its representation must be *pinned*
 * to the JavaScript `boolean`, which is the single exception to the all-nullary
 * string rule (Unions §6.2) and the thing that lets the logic operators and
 * `if`/`while` conditions eliminate a `Bool` natively.
 *
 * The pin is invisible from inside the language, so every test that observes it
 * has to look at the emitted JavaScript or the `.d.ts`.
 */
describe("Bool is a prelude union (#147 §2)", () => {
  test("`True` and `False` are nullary constructors, used bare", async () => {
    const module = await runMain(
      "export let yes: Bool = True\n" +
        "export let no: Bool = False\n",
    );

    expect(module.yes).toBe(true);
    expect(module.no).toBe(false);
  });

  test("a match over both constructors is exhaustive with no `_`", () => {
    // §4.1's acceptance test, respelled: it now exercises the union path rather
    // than the deleted finite-literal-domain carve-out.
    expect(
      projectDiagnostics(
        "export let label(flag: Bool): String =\n" +
          "    match flag\n" +
          "        True => \"on\"\n" +
          "        False => \"off\"\n",
      ),
    ).toEqual([]);
  });

  test("a match missing a constructor is the ordinary missing-case error", () => {
    expect(
      projectDiagnostics(
        "export let label(flag: Bool): String =\n" +
          "    match flag\n" +
          "        True => \"on\"\n",
      ),
    ).toContain("match is missing cases: `False`");
  });

  test("`show` and interpolation render the constructor name", async () => {
    // The ruling's one silent behaviour change (§2.3): previously legal programs
    // that displayed a `Bool` now print `True`/`False` rather than JavaScript's
    // lowercase form, with no diagnostic, because nothing is wrong — the display
    // form changed. Pinned here so the flip cannot drift back unnoticed.
    const module = await runMain(
      "export let shown: String = \"${True} and ${False}\"\n",
    );

    expect(module.shown).toBe("True and False");
  });

  test("derived `Ord` puts `False` before `True`", async () => {
    const module = await runMain(
      "export let ordered: Bool = False < True\n" +
        "export let reversed: Bool = True < False\n",
    );

    expect(module.ordered).toBe(true);
    expect(module.reversed).toBe(false);
  });
});

describe("the reserved redirect words (#147 §2.2)", () => {
  test("`true` in value position redirects to the constructor", () => {
    expect(projectDiagnostics("export let flag: Bool = true\n")).toContain(
      "`true` is reserved; Bool's constructors are `True` and `False` — write `True`",
    );
  });

  test("`false` in value position redirects to its own constructor", () => {
    expect(projectDiagnostics("export let flag: Bool = false\n")).toContain(
      "`false` is reserved; Bool's constructors are `True` and `False` — write `False`",
    );
  });

  test("`true` in name position gets no constructor fixit", () => {
    // "write `True`" would be wrong here: `let True = ...` is a refutable
    // constructor pattern and errors again. The position-aware split is the
    // parser's, per Lexer §4.1.
    const messages = projectDiagnostics("let true = 1\n");

    expect(messages).toContain("`true` is reserved and cannot be used as a name");
    expect(messages.join("\n")).not.toContain("write `True`");
  });
});

describe("the representation pin (#147 §3)", () => {
  const javascript = (source: string): string =>
    compileMain(source).modules.find(({ source: file }) => file.path === "/main.hex")!
      .javascript.text;

  const declarations = (source: string): string =>
    compileMain(source).modules.find(({ source: file }) => file.path === "/main.hex")!
      .declarations.text;

  test("`True` emits `true` and `False` emits `false`", () => {
    const emitted = javascript("export let flag: Bool = True\n");

    expect(emitted).toContain("const flag = true;");
    expect(emitted).not.toContain('"True"');
  });

  test("a `Bool` match emits on the boolean itself", () => {
    const emitted = javascript(
      "export let label(flag: Bool): String =\n" +
        "    match flag\n" +
        "        True => \"on\"\n" +
        "        False => \"off\"\n",
    );

    expect(emitted).toContain("case true:");
    expect(emitted).toContain("case false:");
    expect(emitted).not.toContain('case "True":');
  });

  test("the logic operators emit natively, which is what the pin licenses", () => {
    const emitted = javascript(
      "export let combine(a: Bool, b: Bool): Bool = a and not b\n" +
        "export let either(a: Bool, b: Bool): Bool = a or b\n" +
        "export let agree(a: Bool, b: Bool): Bool = a iff b\n",
    );

    expect(emitted).toContain("a && !b");
    expect(emitted).toContain("a || b");
    // `iff` is `Eq<Bool>`, which over the pinned representation is `===`.
    expect(emitted).toContain("a === b");
  });

  test("derived `Ord` needs no declaration-index table", () => {
    // The Unions §7 implementer note for the string case does not apply: JS `<`
    // on booleans already agrees with the declaration order `False | True`, so
    // the emitted comparison is arithmetic on the booleans and mentions neither
    // constructor name.
    const emitted = javascript("export let ordered: Bool = False < True\n");

    expect(emitted).not.toContain('"False"');
    expect(emitted).not.toContain('"True"');
  });

  test("the `.d.ts` face is `boolean`, not a two-string union", () => {
    const emitted = declarations(
      "export let flag: Bool = True\n" +
        "export let negate(value: Bool): Bool = not value\n",
    );

    expect(emitted).toContain("export declare const flag: boolean;");
    expect(emitted).toContain("export declare const negate: (value: boolean) => boolean;");
    expect(emitted).not.toContain('"True"');
  });

  test("the boundary is zero-cost in both directions", async () => {
    // FFI §3.3: the boundary was `Bool ↔ boolean` before the ruling and the
    // pin's whole purpose is that it still is. A foreign predicate's result
    // flows into a `match` and back out through an export with no conversion.
    const project = compileMain(
      "extern from \"host\"\n" +
        "    export fun isReady(): Bool\n" +
        "export let describe(): String =\n" +
        "    match isReady()\n" +
        "        True => \"ready\"\n" +
        "        False => \"waiting\"\n",
    );

    expect(project.diagnostics).toEqual([]);
    const main = project.modules.find(({ source }) => source.path === "/main.hex")!;
    expect(main.javascript.text).not.toContain("__hex_toBool");
    expect(main.declarations.text).toContain("boolean");
  });
});
