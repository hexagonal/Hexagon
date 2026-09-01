import { describe, expect, test } from "vitest";

import { compileFiles, projectDiagnostics, runMain } from "../support/test-project.js";

/**
 * Conformance for the **qualified-only constructors** of `JsKind` — `spec/
 * ffi.md` §12's global naming audit, cited by FFI Part 11 §3 (issue #511).
 *
 * §12's finding is one collision: `Undefined` and `Null` are constructors of
 * *both* `NullableCase(a)` (Part 2 §3) and `JsKind` (Part 11 §3), which the
 * prelude cannot auto-import unqualified (Modules §5.5). Its resolution is
 * wider than the collision — **all** constructors of both utility unions are
 * qualified-only, so each union's constructor surface stays one rule rather
 * than two.
 *
 * That makes this the first exception to "every prelude export is in bare
 * scope", and the exception has to be exactly as narrow as §12 draws it. So the
 * file pins three things, and the third is the one a slip would take:
 *
 * - **the ten constructors are unreachable bare**, in expressions and in
 *   patterns alike, with the ordinary unknown-name refusals §12 leaves them to;
 * - **the qualified spelling works everywhere** a constructor can stand, which
 *   is Modules §3.3's existing `Geo.Circle(r)` door and nothing new;
 * - **nothing else is qualified.** `JsConversionReason` and `JsPathSegment`
 *   were audited and passed — §12 lists `Range` the type beside
 *   `JsConversionReason`'s `Range` constructor as *clean* cross-namespace
 *   coexistence — so their constructors stay ordinary bare prelude terms.
 *
 * And the whole thing is a **source-namespace** rule: §12 says in as many words
 * that runtime representations are unchanged, so the emitted strings are pinned
 * too.
 */

/** The emitted JavaScript of a one-module program at `/main.hex`. */
function javascript(source: string): string {
  const compiled = compileFiles([["/main.hex", source]]);
  expect(compiled.diagnostics).toEqual([]);
  return compiled.modules.find(({ source: file }) => file.path === "/main.hex")!
    .javascript.text;
}

const KINDS = [
  "Undefined",
  "Null",
  "Bool",
  "Number",
  "BigInt",
  "String",
  "Symbol",
  "Function",
  "Array",
  "Object",
] as const;

describe("the ten constructors are not bare prelude terms (ffi.md §12)", () => {
  /**
   * Expression position. The refusal is the ordinary unknown-name error: §12
   * designs no diagnostic of its own, because the constructor is simply not in
   * scope — there is nothing special to say about a name that was never bound.
   */
  test.each(KINDS)("bare `%s` in an expression is an unknown name", (constructor) => {
    expect(projectDiagnostics(`export let k: JsKind = ${constructor}\n`))
      .toEqual([`unknown name \`${constructor}\``]);
  });

  /**
   * Pattern position, which Modules §5.4 reads as one scope with value
   * position — so the same absence produces the pattern wording. This is the
   * seat that matters most: a capitalized name in a pattern is a *constructor*
   * pattern, never a binder, so an unbound one is refused rather than silently
   * matching everything.
   */
  test.each(KINDS)("bare `%s` in a pattern is an unknown constructor", (constructor) => {
    expect(projectDiagnostics(
      "export let f(k: JsKind): Int = match k\n" +
        `    ${constructor} => 1\n` +
        "    _ => 2\n",
    )[0]).toBe(`unknown constructor \`${constructor}\``);
  });

  /**
   * The rule is about *bare scope*, not about the name: a module that binds the
   * spelling itself is untouched, because there was never a prelude binding to
   * collide with. This is the property §12's resolution buys — ten common words
   * that no longer stand in every program's way.
   */
  test("a module may bind the spellings freely", () => {
    expect(projectDiagnostics(
      "export union Answer = Null | Object | Number(value: Int)\n" +
        "export let n(a: Answer): Int = match a\n" +
        "    Null => 0\n" +
        "    Object => 1\n" +
        "    Number(value) => value\n",
    )).toEqual([]);
  });
});

describe("the qualified spelling works everywhere (Modules §3.3)", () => {
  /** Expression position, all ten. */
  test("every constructor is reachable as `JsKind.<Name>`", () => {
    expect(projectDiagnostics(
      `export let all: Vector(JsKind) = [${
        KINDS.map((kind) => `JsKind.${kind}`).join(", ")
      }]\n`,
    )).toEqual([]);
  });

  /** Pattern position, all ten, exhaustively — which also pins the inventory. */
  test("every constructor is reachable in a pattern, and the ten are exhaustive", () => {
    expect(projectDiagnostics(
      "export let name(k: JsKind): String = match k\n" +
        KINDS.map((kind) => `    JsKind.${kind} => "${kind}"\n`).join(""),
    )).toEqual([]);
  });

  /**
   * A missing arm is still a missing arm: the qualification changes no
   * judgment. And the message names the missing cases the *only* way a reader
   * can write them — qualified — which is what makes the refusal actionable
   * under §12's rule.
   */
  test("exhaustiveness still counts the arms, and names them qualified", () => {
    expect(projectDiagnostics(
      "export let name(k: JsKind): String = match k\n" +
        "    JsKind.Null => \"Null\"\n",
    )).toEqual([
      "match is missing cases: `JsKind.Undefined`, `JsKind.Bool`, `JsKind.Number` …and 6 more",
    ]);
  });

  /**
   * `JsKind` the *type* is an ordinary exported prelude union, so the bare type
   * spelling resolves — it is the constructors alone that §12 qualifies.
   */
  test("the type name itself is bare, as any prelude union's is", () => {
    expect(projectDiagnostics("export let f(k: JsKind): JsKind = k\n")).toEqual([]);
  });
});

describe("the runtime representation is unchanged (ffi.md §12, Unions §6.2)", () => {
  /**
   * §12: "Runtime representations are unchanged." `JsKind` is all-nullary, so
   * each constructor *is* its own name-string, and qualification is a
   * source-namespace fact that reaches no emitted byte.
   */
  test("each constructor emits as its name-string, and matching is a `switch` on it", () => {
    const text = javascript(
      "export let name(k: JsKind): String = match k\n" +
        "    JsKind.Null => \"null\"\n" +
        "    JsKind.Array => \"array\"\n" +
        "    _ => \"other\"\n",
    );
    expect(text).toContain('case "Null":');
    expect(text).toContain('case "Array":');
  });

  test("the values compare equal to their strings at run time", async () => {
    const main = await runMain(
      "export let nullKind: JsKind = JsKind.Null\n" +
        "export let objectKind: JsKind = JsKind.Object\n" +
        "export let classify(v: JsValue): JsKind = JsValue.kind(v)\n",
    );
    expect(main["nullKind"]).toBe("Null");
    expect(main["objectKind"]).toBe("Object");
    expect((main["classify"] as (v: unknown) => unknown)(null)).toBe("Null");
  });
});

describe("the exception is exactly §12's, and no wider", () => {
  /**
   * §12's audit passed `JsConversionReason` and `JsPathSegment`: the only
   * same-namespace collision it found was `Undefined`/`Null`, and `Range` the
   * type beside `JsConversionReason`'s `Range` constructor is listed as *clean*
   * cross-namespace coexistence. So these constructors are ordinary bare
   * prelude terms, in expressions and in patterns.
   */
  test("`JsConversionReason` and `JsPathSegment` constructors stay bare", () => {
    expect(projectDiagnostics(
      "export let reasons: Vector(JsConversionReason) = [Shape, Range, Cycle([])]\n" +
        "export let segments: Vector(JsPathSegment) =\n" +
        "    [Field(\"f\"), Index(1), MapKey(1), MapValue(1), SetElement(1)]\n" +
        "export let which(r: JsConversionReason): Int = match r\n" +
        "    Shape => 0\n" +
        "    Range => 1\n" +
        "    Cycle(_) => 2\n",
    )).toEqual([]);
  });

  /**
   * The `Range` row of §12's clean list, run: the *type* `Range` and the
   * *constructor* `Range` coexist in one module because Hexagon's term and type
   * namespaces are separate (Modules §5).
   */
  test("the `Range` type and the `Range` constructor coexist", () => {
    expect(projectDiagnostics(
      "export let span: Range = 1..3\n" +
        "export let reason: JsConversionReason = Range\n",
    )).toEqual([]);
  });

  /**
   * The other half of §12's clean list, and the reason it is clean: `Array`,
   * `String`, `Bool` and `BigInt` are *types* and `JsKind`'s constructors of
   * those spellings are *constructors*. The qualification keeps the two from
   * ever needing to be told apart by position.
   */
  test("the type spellings `JsKind` reuses are untouched", () => {
    expect(projectDiagnostics(
      "export let a(v: Array(Int)): Array(Int) = v\n" +
        "export let s(v: String): String = v\n" +
        "export let b(v: Bool): Bool = v\n" +
        "export let i(v: BigInt): BigInt = v\n" +
        "export let k: JsKind = JsKind.Array\n",
    )).toEqual([]);
  });

  /**
   * Membership is the prelude inventory's, not the spelling's: a *user* union
   * named `JsKind` is an ordinary declaration whose constructors are bare, and
   * it occludes the prelude's (Modules §5.4).
   */
  test("a user's own union named `JsKind` keeps bare constructors", () => {
    expect(projectDiagnostics(
      "export union JsKind = Yes | No\n" +
        "export let k: JsKind = Yes\n" +
        "export let f(k: JsKind): Int = match k\n" +
        "    Yes => 1\n" +
        "    No => 0\n",
    )).toEqual([]);
  });
});
