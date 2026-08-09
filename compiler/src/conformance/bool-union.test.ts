import { describe, expect, test } from "vitest";

import { compileFiles, compileMain, projectDiagnostics, runMain } from "../support/test-project.js";

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

  test("`false` in name position gets no constructor fixit either", () => {
    const messages = projectDiagnostics("fun false() = 1\n");

    expect(messages).toContain("`false` is reserved and cannot be used as a name");
    expect(messages.join("\n")).not.toContain("write `False`");
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
        "export let agree(a: Bool, b: Bool): Bool = a iff b\n" +
        "export let promise(a: Bool, b: Bool): Bool = a implies b\n",
    );

    expect(emitted).toContain("a && !b");
    expect(emitted).toContain("a || b");
    // `implies` desugars to `not a or b` before checking (Operators §4.1).
    expect(emitted).toContain("!a || b");
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

describe("`Bool` inside a composite (#147, regression)", () => {
  // The pinned `Show` is a ternary, and `+` binds tighter than `?:`. Unparenthesized
  // it made the accumulated string prefix the ternary's condition, so any composite
  // containing a `Bool` displayed as `"True"` — the wrong value, with no diagnostic.
  // Found in review of the commit that introduced it.
  test("a record field, a tuple element, and a payload all display in place", async () => {
    const module = await runMain(
      "record Flagged derives (Show) = {on: Bool, count: Int}\n" +
        "union Wrap derives (Show) = Wrapped(flag: Bool)\n" +
        "export let inRecord: String = \"${Flagged({on = False, count = 2})}\"\n" +
        "export let inTuple: String = \"${(True, 1)}\"\n" +
        "export let inPayload: String = \"${Wrapped(True)}\"\n",
    );

    expect(module.inRecord).toBe("{count = 2, on = False}");
    expect(module.inTuple).toBe("(True, 1)");
    expect(module.inPayload).toBe("Wrapped(True)");
  });

  test("`Bool` works as a `Set` element and a `Map` key", async () => {
    const module = await runMain(
      "let flags: Set(Bool) = Set.add(Set.add(Set.empty, True), False)\n" +
        "export let size: Int = Set.size(flags)\n" +
        "export let hasTrue: Bool = Set.contains(flags, True)\n" +
        "let byFlag: Map(Bool, String) = Map.set(Map.empty, True, \"yes\")\n" +
        "export let looked: String = byFlag[True]\n",
    );

    expect(module.size).toBe(2);
    expect(module.hasTrue).toBe(true);
    expect(module.looked).toBe("yes");
  });
});

describe("the declaration's shape is verified, not trusted (#147 §3.5/§7)", () => {
  // The pin is granted to a declaration, so the compiler checks that the
  // declaration is the one the pin was ruled for. `stdlib/Bool.hex` is embedded
  // in the compiler and no program can reach it, so this is an integrity check on
  // the compiler's own stdlib copy — but it is load-bearing rather than
  // ceremonial: the emitter maps the constructor named `True` to `true`, and
  // derived `Ord` leans on the declaration order.
  const shapeError = (source: string): string | undefined =>
    projectDiagnostics(source).find((message) =>
      message.startsWith("compiler integrity: the prelude `Bool`")
    );

  test("the shipped prelude passes", () => {
    expect(shapeError("export let flag: Bool = True\n")).toBeUndefined();
  });

  test("a project supplying a wrong `Bool.hex` at the injection path is refused", () => {
    // Compiling the stdlib itself is the one way to substitute a prelude module
    // (`injectPrelude` prefers a project file at the injection path), so it is
    // also the way to prove the check runs.
    const reversed = compileFiles([
      ["/Bool.hex", "export union Bool derives (Eq, Ord, Show, Hash) =\n    | True\n    | False\n"],
      ["/main.hex", "export let flag: Bool = True\n"],
    ]);

    expect(reversed.diagnostics.map(({ message }) => message).join("\n")).toContain(
      "in that constructor order",
    );
  });

  test("a third constructor is refused", () => {
    const extra = compileFiles([
      ["/Bool.hex", "export union Bool derives (Eq, Ord, Show, Hash) =\n    | False\n    | True\n    | Maybe\n"],
      ["/main.hex", "export let flag: Bool = True\n"],
    ]);

    expect(extra.diagnostics.map(({ message }) => message).join("\n")).toContain(
      "compiler integrity: the prelude `Bool`",
    );
  });
});

describe("the pin is granted to one declaration, not to a name (#147 §3.1)", () => {
  // "No user declaration can request a pin; there is no annotation, no syntax, no
  // extension point." A union a user happens to name `Bool` occludes the spelling
  // (Modules §5.4) and gets none of the privilege: ordinary all-nullary strings,
  // an ordinary `.d.ts` face, and no claim on what `if` accepts.
  test("a user union named `Bool` gets the string representation, not the pin", () => {
    const project = compileMain(
      "export union Bool = Naw | Aye\n" +
        "export let pick: Bool = Aye\n",
    );
    const main = project.modules.find(({ source }) => source.path === "/main.hex")!;

    expect(main.javascript.text).toContain('const Aye = "Aye";');
    expect(main.declarations.text).toContain('export type Bool = "Naw" | "Aye";');
  });

  test("conditions still demand the prelude's `Bool`", () => {
    // The occluding declaration cannot make its own type a condition type.
    // (The message itself is poor — both sides render as `Bool` — which is #156.)
    expect(
      projectDiagnostics(
        "union Bool = Naw | Aye\n" +
          "let f(b: Bool): Int = if b then 1 else 0\n",
      ).join("\n"),
    ).toContain("type mismatch");
  });
});
