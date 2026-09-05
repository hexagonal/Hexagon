import { describe, expect, test } from "vitest";

import { compileFiles, projectDiagnostics, runMain } from "../support/test-project.js";

/**
 * Conformance for the **qualified-only constructors** of Part 11's three
 * utility unions — `spec/ffi.md` §12's global naming audit and its #511
 * extension, cited by FFI Part 11 §3 and §5.1 (issue #511).
 *
 * §12's original finding is one collision: `Undefined` and `Null` are
 * constructors of *both* `NullableCase(a)` (Part 2 §3) and `JsKind` (Part 11
 * §3), which the prelude cannot auto-import unqualified (Modules §5.5). Its
 * resolution is wider than the collision — **all** constructors of the whole
 * union are qualified-only, so a union's constructor surface stays one rule
 * rather than two.
 *
 * §12's **extension** carries the same rule to `JsConversionReason` and
 * `JsPathSegment` on different grounds: not collision but **user vocabulary**.
 * `Shape`, `Range`, `Cycle`, `Field`, `Index`, `MapKey`, `MapValue` and
 * `SetElement` are ordinary names for a user's own declarations, and occlusion
 * does not save that user — it is per-namespace, so a `union Shape = Circle |
 * Square` introduces no *constructor* `Shape` and would leave the prelude's
 * standing in term position, where the message it draws names a union that
 * appears nowhere in the program.
 *
 * So this is the exception to "every prelude export is in bare scope", and it
 * has to be exactly as wide as §12 draws it and no wider. The file pins:
 *
 * - **the twenty-one constructors are unreachable bare in expressions**, with
 *   the ordinary unknown-name refusals §12 leaves them to; **in a pattern**
 *   they are reachable bare wherever #763's door applies — the scrutinee's
 *   type is known and is the constructor's own union — because the door
 *   reaches every union alike, this qualified-only prelude set included;
 * - **the qualified spelling works everywhere** a constructor can stand, which
 *   is Modules §3.3's existing `Geo.Circle(r)` door and nothing new;
 * - **the eight words are given back**, including the two occlusion shapes the
 *   extension was argued from: a user's `record Shape` (which *does* declare a
 *   same-spelled constructor) and a user's data-armed `union Shape` (which does
 *   not) now behave identically, because there is no bare prelude constructor
 *   for either to occlude;
 * - **nothing else is qualified** — `JsConversionError` is a record whose
 *   constructor is its own type's spelling, not common user vocabulary, and it
 *   stays an ordinary bare prelude term.
 *
 * And the whole thing is a **source-namespace** rule: §12 says in as many words
 * that runtime representations are unchanged, so the emitted values are pinned
 * too — the tagged objects of Unions §6.1 since #771.
 */

/** The emitted JavaScript of a one-module program at `/main.hex`. */
function javascript(source: string): string {
  const compiled = compileFiles([["/main.hex", "module Main\n\n" + source]]);
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

/**
 * The eight words §12's extension gives back (#511) — `JsConversionReason`'s
 * three and `JsPathSegment`'s five, which are the reason the extension exists.
 */
const UTILITY_CONSTRUCTORS = [
  "Shape",
  "Range",
  "Cycle",
  "Field",
  "Index",
  "MapKey",
  "MapValue",
  "SetElement",
] as const;

/** Which union each of the eight is spelled through (Modules §5.5). */
const UTILITY_HOMES: Readonly<Record<string, string>> = {
  Shape: "JsConversionReason",
  Range: "JsConversionReason",
  Cycle: "JsConversionReason",
  Field: "JsPathSegment",
  Index: "JsPathSegment",
  MapKey: "JsPathSegment",
  MapValue: "JsPathSegment",
  SetElement: "JsPathSegment",
};

describe("the ten constructors are not bare prelude terms (ffi.md §12)", () => {
  /**
   * Expression position. Since #742 the refusal is §5.5's own, not an
   * unknown-name error: the constructor is qualified-only by the prelude's
   * default rather than absent, and the message says so and names the spelling
   * that works. `unknown name \`Null\`` was the wording until the inversion, and
   * it said nothing about the union standing one qualifier away.
   */
  test.each(KINDS)("bare `%s` in an expression names its qualified spelling", (constructor) => {
    expect(projectDiagnostics("module Main\n\n" + `export let k: JsKind = ${constructor}\n`))
      .toEqual([`no bare \`${constructor}\`; write \`JsKind.${constructor}\``]);
  });

  /**
   * Pattern position is where #763's door lives, and it reaches every union
   * alike — this qualified-only prelude set included: the scrutinee's type is
   * `JsKind`, which is exactly the union each of these ten constructs, so a
   * bare head in the pattern resolves through the door rather than drawing
   * §12's expression-position refusal. Reading a capitalized pattern head as a
   * constructor first, and only refusing when neither scope nor the door
   * answers, is what the door *is* — this is the seat it was built for.
   */
  test.each(KINDS)("bare `%s` in a pattern resolves through the door (#763)", (constructor) => {
    expect(projectDiagnostics("module Main\n\n" + "export let f(k: JsKind): Int = match k\n" +
        `    ${constructor} => 1\n` +
        "    _ => 2\n",
    )).toEqual([]);
  });

  /**
   * The rule is about *bare scope*, not about the name: a module that binds the
   * spelling itself is untouched, because there was never a prelude binding to
   * collide with. This is the property §12's resolution buys — ten common words
   * that no longer stand in every program's way.
   */
  test("a module may bind the spellings freely", () => {
    expect(projectDiagnostics("module Main\n\n" + "export union Answer = Null | Object | Number(value: Int)\n" +
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
    expect(projectDiagnostics("module Main\n\n" + `export let all: Vector(JsKind) = [${
        KINDS.map((kind) => `JsKind.${kind}`).join(", ")
      }]\n`,
    )).toEqual([]);
  });

  /** Pattern position, all ten, exhaustively — which also pins the inventory. */
  test("every constructor is reachable in a pattern, and the ten are exhaustive", () => {
    expect(projectDiagnostics("module Main\n\n" + "export let name(k: JsKind): String = match k\n" +
        KINDS.map((kind) => `    JsKind.${kind} => "${kind}"\n`).join(""),
    )).toEqual([]);
  });

  /**
   * A missing arm is still a missing arm: the qualification changes no
   * judgment. Pattern Matching §7.3's counterexample renderer prints the
   * *barest pastable spelling* (#763), and for a qualified-only prelude union
   * that is the bare constructor name itself — reachable through §2.2's door
   * at this very seat — not the qualified spelling §12 forces in an
   * expression. The witness names how a reader would *paste it back into this
   * `match`*, which is bare.
   */
  test("exhaustiveness still counts the arms, and names them by their barest pastable spelling", () => {
    expect(projectDiagnostics("module Main\n\n" + "export let name(k: JsKind): String = match k\n" +
        "    JsKind.Null => \"Null\"\n",
    )).toEqual([
      "match is missing cases: `Undefined`, `Bool`, `Number` …and 6 more",
    ]);
  });

  /**
   * §7.2's *other* report does not agree with §7.1's above, by design (#763):
   * the unreachable-arm report names the arm exactly as the user wrote it —
   * qualified, here, since §12 forces the qualified spelling in an expression
   * and a pattern head is written the same way this module already spells it
   * — while §7.3's counterexample renderer prints the barest pastable
   * spelling instead. One `match`, two reports, two rules, each in its own
   * section of the spec; they coincide for an ordinary union and diverge here.
   */
  test("the duplicate-arm report names the constructor qualified too", () => {
    expect(projectDiagnostics("module Main\n\n" + "export let name(k: JsKind): String = match k\n" +
        "    JsKind.Null => \"a\"\n" +
        "    JsKind.Null => \"b\"\n" +
        "    _ => \"c\"\n",
    )).toEqual(["this case is unreachable; `JsKind.Null` is already handled above"]);
    // And for the two unions the extension added, payload and all.
    expect(projectDiagnostics("module Main\n\n" + "export let depth(s: JsPathSegment): Int = match s\n" +
        "    JsPathSegment.Index(i) => i\n" +
        "    JsPathSegment.Index(j) => j\n" +
        "    _ => 0\n",
    )).toEqual([
      "this case is unreachable; `JsPathSegment.Index` is already handled above",
    ]);
  });

  /**
   * `JsKind` the *type* is an ordinary exported prelude union, so the bare type
   * spelling resolves — it is the constructors alone that §12 qualifies.
   */
  test("the type name itself is bare, as any prelude union's is", () => {
    expect(projectDiagnostics("module Main\n\n" + "export let f(k: JsKind): JsKind = k\n")).toEqual([]);
  });
});

describe("`JsKind derives (Eq, Show)` (Part 11 §3)", () => {
  /**
   * §3's ruling, and the sentence it was ruled on: "the single-kind test
   * `kind(v) == JsKind.Number` is the surface's most common question". Both
   * instances are lawful and trivial on an all-nullary union, and neither
   * touches `JsValue` — a kind is ordinary domestic data *about* a foreign
   * value, which is why deriving here does not contradict §2's "no instances".
   */
  test("a kind compares and shows", () => {
    expect(projectDiagnostics("module Main\n\n" + "export let isNumber(k: JsKind): Bool = k == JsKind.Number\n" +
        "export let differs(k: JsKind): Bool = k != JsKind.Null\n" +
        "export let rendered(k: JsKind): String = show(k)\n",
    )).toEqual([]);
  });

  /** And the same three, run. */
  test("the instances answer correctly at run time", async () => {
    const main = await runMain("module Main\n\n" + "export let isNumber(v: JsValue): Bool = JsValue.kind(v) == JsKind.Number\n" +
        "export let rendered(v: JsValue): String = show(JsValue.kind(v))\n",
    );
    const isNumber = main["isNumber"] as (v: unknown) => boolean;
    const rendered = main["rendered"] as (v: unknown) => string;
    expect(isNumber(1)).toBe(true);
    expect(isNumber("1")).toBe(false);
    expect(isNumber(null)).toBe(false);
    // Derived `Show` on a union of nullary constructors renders the tag, which
    // is the constructor name.
    expect(rendered(1)).toBe("Number");
    expect(rendered(null)).toBe("Null");
    expect(rendered([])).toBe("Array");
  });

  /**
   * §2 stands untouched: `JsValue` itself still has **no** instances, so the
   * derivation on the kinds buys the foreign value nothing.
   */
  test("`JsValue` gains nothing from it", () => {
    expect(projectDiagnostics("module Main\n\n" + "export let same(a: JsValue, b: JsValue): Bool = a == b\n")[0])
      .toContain("JsValue");
    expect(projectDiagnostics("module Main\n\n" + "export let s(v: JsValue): String = show(v)\n")[0])
      .toContain("JsValue");
  });

  /**
   * §3 again: the representation is unchanged by the derivation. Deriving adds
   * dictionaries, and a dictionary is not a representation — the emitted value
   * is still the shared tagged constant and the `.d.ts` face is still the
   * discriminated union (#771).
   */
  test("neither the emitted representation nor the `.d.ts` face moves", () => {
    const compiled = compileFiles([["/main.hex",
      "module Main\n\n" + "export let k(v: JsValue): JsKind = JsValue.kind(v)\n"]]);
    expect(compiled.diagnostics).toEqual([]);
    const kindModule = compiled.modules
      .find(({ source }) => source.path === "/Hex/JsKind.hex")!;
    expect(kindModule.declarations.text).toContain(
      'export type JsKind = { tag: "Undefined" } | { tag: "Null" } | { tag: "Bool" }' +
        ' | { tag: "Number" } | { tag: "BigInt" } | { tag: "String" } | { tag: "Symbol" }' +
        ' | { tag: "Function" } | { tag: "Array" } | { tag: "Object" };',
    );
  });
});

describe("the runtime representation is unchanged (ffi.md §12, Unions §6.2)", () => {
  /**
   * §12: "Runtime representations are unchanged." Every `JsKind` constructor is
   * nullary, so each is the shared tagged constant Unions §6.1 gives one
   * (#771), and qualification is a source-namespace fact that reaches no
   * emitted byte.
   */
  test("each constructor emits as its shared constant, and matching switches on the tag", () => {
    const text = javascript(
      "export let name(k: JsKind): String = match k\n" +
        "    JsKind.Null => \"null\"\n" +
        "    JsKind.Array => \"array\"\n" +
        "    _ => \"other\"\n",
    );
    expect(text).toContain("switch (__match.tag) {");
    expect(text).toContain('case "Null":');
    expect(text).toContain('case "Array":');
  });

  test("the values are the tagged objects at run time", async () => {
    const main = await runMain("module Main\n\n" + "export let nullKind: JsKind = JsKind.Null\n" +
        "export let objectKind: JsKind = JsKind.Object\n" +
        "export let classify(v: JsValue): JsKind = JsValue.kind(v)\n",
    );
    expect(main["nullKind"]).toEqual({ tag: "Null" });
    expect(main["objectKind"]).toEqual({ tag: "Object" });
    expect((main["classify"] as (v: unknown) => unknown)(null)).toEqual({ tag: "Null" });
  });
});

describe("the extension gives the eight words back (§12's extension, #511)", () => {
  /**
   * The bare refusals, expression position. Eight ordinary words that no longer
   * stand in any program's way — which is the whole of what the extension buys,
   * so it is asserted name by name.
   */
  test.each(UTILITY_CONSTRUCTORS)(
    "bare `%s` in an expression names its qualified spelling",
    (constructor) => {
      expect(projectDiagnostics("module Main\n\n" + `export let n: Int = ${constructor}\n`)[0])
        .toBe(`no bare \`${constructor}\`; write \`${UTILITY_HOMES[constructor]}.${constructor}\``);
    },
  );

  /**
   * Pattern position, where #763's door reaches these two nullary
   * constructors the same way it reaches `JsKind`'s: the scrutinee's type is
   * `JsConversionReason`, so the bare head resolves with no diagnostic at all.
   */
  test.each(["Shape", "Range"] as const)(
    "bare `%s` in a pattern resolves through the door (#763)",
    (constructor) => {
      expect(projectDiagnostics("module Main\n\n" + "export let f(r: JsConversionReason): Int = match r\n" +
          `    ${constructor} => 1\n` +
          "    _ => 2\n",
      )).toEqual([]);
    },
  );

  /**
   * `Cycle` carries a payload, so a head with no argument list is not the
   * refused-bare-head shape at all: the door still resolves the head (there is
   * no "no bare `Cycle`" refusal), and what remains is the ordinary arity
   * report a nullary write of a unary constructor always draws.
   */
  test("bare `Cycle(_)` in a pattern resolves through the door (#763)", () => {
    expect(projectDiagnostics("module Main\n\n" + "export let f(r: JsConversionReason): Int = match r\n" +
        "    Cycle(_) => 1\n" +
        "    _ => 2\n",
    )).toEqual([]);
  });

  test("bare `Cycle` with no argument list still draws the arity report", () => {
    expect(projectDiagnostics("module Main\n\n" + "export let f(r: JsConversionReason): Int = match r\n" +
        "    Cycle => 1\n" +
        "    _ => 2\n",
    )).toEqual(["constructor pattern `Cycle` expects 1 arguments, got 0"]);
  });

  /** And they are reachable qualified, in expressions and in patterns. */
  test("every constructor of both unions is reachable qualified", () => {
    expect(projectDiagnostics("module Main\n\n" + "export let reasons: Vector(JsConversionReason) = [\n" +
        "    JsConversionReason.Shape,\n" +
        "    JsConversionReason.Range,\n" +
        "    JsConversionReason.Cycle([]),\n" +
        "]\n" +
        "export let segments: Vector(JsPathSegment) = [\n" +
        "    JsPathSegment.Field(\"f\"),\n" +
        "    JsPathSegment.Index(1),\n" +
        "    JsPathSegment.MapKey(1),\n" +
        "    JsPathSegment.MapValue(1),\n" +
        "    JsPathSegment.SetElement(1),\n" +
        "]\n" +
        "export let which(r: JsConversionReason): Int = match r\n" +
        "    JsConversionReason.Shape => 0\n" +
        "    JsConversionReason.Range => 1\n" +
        "    JsConversionReason.Cycle(_) => 2\n" +
        "export let depth(s: JsPathSegment): Int = match s\n" +
        "    JsPathSegment.Field(_) => 0\n" +
        "    JsPathSegment.Index(i) => i\n" +
        "    JsPathSegment.MapKey(p) => p\n" +
        "    JsPathSegment.MapValue(p) => p\n" +
        "    JsPathSegment.SetElement(p) => p\n",
    )).toEqual([]);
  });

  /**
   * The occlusion argument the extension was made from, run in both of its
   * shapes — and the point is that they now agree.
   *
   * A `record Shape` declares a same-spelled *constructor*, so before the
   * extension it occluded the prelude's; a data-armed `union Shape = Circle |
   * Square` declares none, so it did not, and a bare `Shape` in that author's
   * own module still meant a prelude constructor of a union appearing nowhere in
   * their program (Modules §5.4, read per namespace). With no bare prelude
   * constructor left to occlude, both are ordinary declarations of an ordinary
   * word.
   */
  test("a user's `record Shape` and a user's `union Shape` behave identically", () => {
    expect(projectDiagnostics("module Main\n\n" + "export record Shape = {sides: Int}\n" +
        "export let area(s: Shape): Int = s.sides\n" +
        "export let unit: Shape = Shape({sides = 3})\n",
    )).toEqual([]);
    expect(projectDiagnostics("module Main\n\n" + "export union Shape = Circle | Square\n" +
        "export let name(s: Shape): String = match s\n" +
        "    Circle => \"circle\"\n" +
        "    Square => \"square\"\n" +
        "export let unit: Shape = Circle\n",
    )).toEqual([]);
  });

  /**
   * And the misuse each shape draws is the ordinary one, named against the
   * user's own declaration. Before the extension the union case could not even
   * get here: the bare `Shape` resolved to the prelude constructor and the
   * mismatch named `JsConversionReason`.
   */
  test("misuse of either is refused against the user's own declaration", () => {
    expect(projectDiagnostics("module Main\n\n" + "export union Shape = Circle | Square\n" +
        "export let n: Int = Circle\n",
    )).toEqual(["type mismatch: expected Int, found Shape"]);
    // Rule 1's sentence (Modules §5.1) is reachable again for this spelling,
    // which is the degraded-diagnostic half of the same restoration.
    expect(projectDiagnostics("module Main\n\n" + "union Shape = Circle(Float)\n" +
        "export let n: Float = Shape.area(1.0)\n",
    )).toEqual([
      "`Shape` is a type, not a module; import its home module to qualify through it",
    ]);
  });

  /**
   * `JsConversionError` is a **record**, not one of the three unions, and its
   * constructor is its own type's spelling rather than a common word. Until #742
   * that difference bought it a bare binding; the inverted default reads a
   * record's constructor as a constructor like any other, so it is spelled
   * through its home too — and the *type* name stays bare, which is the half a
   * user's annotation needs.
   */
  test("`JsConversionError` is spelled through `JsValue`, its type name bare", () => {
    expect(projectDiagnostics("module Main\n\n" + "export let e: JsConversionError =\n" +
        "    JsValue.JsConversionError({ reason = JsConversionReason.Shape, path = [] })\n",
    )).toEqual([]);
    expect(projectDiagnostics("module Main\n\n" + "export let e: JsConversionError =\n" +
        "    JsConversionError({ reason = JsConversionReason.Shape, path = [] })\n",
    )).toEqual([
      "no bare `JsConversionError`; write " +
        "`JsValue.JsConversionError({ reason = JsConversionReason.Shape, path = [] })`",
    ]);
  });
});

describe("the exception is exactly §12's, and no wider", () => {
  /**
   * The `Range` row of §12's clean list, run: the *type* `Range` and the
   * qualified *constructor* `Range` coexist in one module because Hexagon's
   * term and type namespaces are separate (Modules §5). The extension moved
   * the constructor behind its companion, and the type is untouched by that.
   */
  test("the `Range` type and the `Range` constructor coexist", () => {
    expect(projectDiagnostics("module Main\n\n" + "export let span: Range = 1..3\n" +
        "export let reason: JsConversionReason = JsConversionReason.Range\n",
    )).toEqual([]);
  });

  /**
   * The other half of §12's clean list, and the reason it is clean: `Array`,
   * `String`, `Bool` and `BigInt` are *types* and `JsKind`'s constructors of
   * those spellings are *constructors*. The qualification keeps the two from
   * ever needing to be told apart by position.
   */
  test("the type spellings `JsKind` reuses are untouched", () => {
    expect(projectDiagnostics("module Main\n\n" + "export let a(v: Array(Int)): Array(Int) = v\n" +
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
    expect(projectDiagnostics("module Main\n\n" + "export union JsKind = Yes | No\n" +
        "export let k: JsKind = Yes\n" +
        "export let f(k: JsKind): Int = match k\n" +
        "    Yes => 1\n" +
        "    No => 0\n",
    )).toEqual([]);
  });
});
