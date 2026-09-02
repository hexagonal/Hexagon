import { describe, expect, test } from "vitest";

import { compileFiles, compileMain, runProject } from "../support/test-project.js";

/**
 * Conformance for **one union representation** (issue #771, `spec/unions.md`
 * §6–§6.5).
 *
 * A union whose constructors are all nullary used to emit its values as bare
 * strings — `const Red = "Red";`, `switch (c)`, `type Colour = "Red" | …` —
 * while every other union emitted §6.1's string-tagged object. The two shapes
 * met at a *representation cliff*: adding the first payload-bearing constructor
 * silently changed the shape of every constructor already declared, and every
 * JavaScript consumer reading `"Red"` broke without a diagnostic anywhere.
 *
 * §6.2 retires the string form. Every union is the tagged object, each nullary
 * constructor the shared module-level constant, `match` a switch on `tag`, and
 * the `.d.ts` face the discriminated union. The one exception is the prelude
 * `Bool`, pinned to the JS `boolean` (#147), which the last section here pins
 * as untouched.
 *
 * What the ruling reaches beyond user declarations is the emitter's own runtime
 * code, because two prelude unions have only nullary constructors and the
 * compiler manufactures their values without a declaration in front of it:
 * `Ordering`, from every derived `compare` and every numeric comparator, and
 * `JsKind`, from `JsValue.kind`. Each emitting module hoists one constant per
 * tag it manufactures and reads it everywhere (B1, the last section here), and
 * consequently *tests* such a value by its tag rather than by `===` against a
 * constant, because the value may have come from another module's mint. Both
 * halves are pinned below, executed.
 *
 * Every program here is textually distinct on purpose: two programs whose
 * emitted JavaScript is byte-identical share one `data:` URL module instance, so
 * a copy of another test's source would silently assert against that test's
 * module.
 */

/** One module's emitted JavaScript, with the project's diagnostics asserted empty. */
function javascript(
  files: readonly (readonly [string, string])[],
  path = "/main.hex",
): string {
  const project = compileFiles(files as never);
  expect(project.diagnostics.map(({ message }) => message)).toEqual([]);
  return project.modules.find(({ source }) => source.path === path)!.javascript.text;
}

/** One module's emitted `.d.ts`, with the project's diagnostics asserted empty. */
function declarations(
  files: readonly (readonly [string, string])[],
  path = "/main.hex",
): string {
  const project = compileFiles(files as never);
  expect(project.diagnostics.map(({ message }) => message)).toEqual([]);
  return project.modules.find(({ source }) => source.path === path)!.declarations.text;
}

describe("at home: the declaration, the reference, the match, the face", () => {
  test("each constructor is §6.1's shared tagged constant", async () => {
    const source = "export union Colour = Red | Green | Blue\n" +
      "export let chosen: Colour = Green\n";

    expect(javascript([["/main.hex", source]])).toContain(
      'const Red = { tag: "Red" };\n' +
        'const Green = { tag: "Green" };\n' +
        'const Blue = { tag: "Blue" };\n' +
        "const chosen = Green;\n",
    );

    const main = await runProject([["/main.hex", source]]);
    expect(main["chosen"]).toEqual({ tag: "Green" });
    // Shared, not rebuilt: the reference reads the constant, allocating nothing
    // (§6.1). Identity is the only way to see that from here, and it is exactly
    // the property the section says no Hexagon program may rely on.
    expect(Object.is(main["chosen"], main["Green"])).toBe(true);
  });

  test("`match` lowers to a switch on the tag", async () => {
    const source = "export union Grade = Alpha | Beta | Gamma\n" +
      "export let letter(g: Grade): String = match g\n" +
      "    Alpha => \"a\"\n" +
      "    Beta => \"b\"\n" +
      "    Gamma => \"c\"\n";

    expect(javascript([["/main.hex", source]])).toContain(
      "const letter = g => {\n" +
        "  const __match = g;\n" +
        "  switch (__match.tag) {\n" +
        '    case "Alpha":\n      return "a";\n',
    );

    const main = await runProject([["/main.hex", source]]);
    const letter = main["letter"] as (g: unknown) => string;
    expect(letter(main["Alpha"])).toBe("a");
    expect(letter(main["Gamma"])).toBe("c");
    // The literal a JavaScript consumer writes is the same value (§6.2's
    // accepted cost: the object literal works because `Eq` is structural).
    expect(letter({ tag: "Beta" })).toBe("b");
  });

  test("the `.d.ts` face is the discriminated union, the constructors constants", () => {
    expect(declarations([["/main.hex",
      "export union Ink = Cyan | Magenta | Yellow\n" +
      "export let base: Ink = Cyan\n"]]))
      .toBe(
        'export type Ink = { tag: "Cyan" } | { tag: "Magenta" } | { tag: "Yellow" };\n' +
          "export declare const Cyan: Ink;\n" +
          "export declare const Magenta: Ink;\n" +
          "export declare const Yellow: Ink;\n" +
          "export declare const base: Ink;\n",
      );
  });

  test("export publishes the constants themselves", () => {
    const emitted = javascript([["/main.hex", "export union Tone = Flat | Sharp\n"]]);
    expect(emitted).toContain("export { Flat };");
    expect(emitted).toContain("export { Sharp };");
  });
});

describe("abroad: the qualified reference and the imported match", () => {
  test("a reference through the module alias reads the exporter's constant", async () => {
    const files = [
      ["/palette.hex", "export union Palette = Scarlet | Olive | Indigo\n"],
      ["/main.hex",
        'import Palette from "./palette"\n' +
        "export let picked: Palette.Palette = Palette.Olive\n"],
    ] as const;

    expect(javascript(files)).toContain("const picked = Palette.Olive;");

    const main = await runProject(files as never);
    expect(main["picked"]).toEqual({ tag: "Olive" });
  });

  test("a match over an imported union switches on the same tag", async () => {
    const files = [
      ["/signals.hex", "export union Lamp = Amber | Emerald\n" +
        "export let first: Lamp = Amber\n"],
      ["/main.hex",
        'import Signals from "./signals"\n' +
        "export let word(l: Signals.Lamp): String = match l\n" +
        "    Amber => \"wait\"\n" +
        "    Emerald => \"go\"\n" +
        "export let atFirst: String = word(Signals.first)\n"],
    ] as const;

    expect(javascript(files)).toContain("  switch (__match.tag) {");
    const main = await runProject(files as never);
    expect(main["atFirst"]).toBe("wait");
    expect((main["word"] as (l: unknown) => string)({ tag: "Emerald" })).toBe("go");
  });
});

describe("the derived instances, executed", () => {
  test("`Eq`, `Ord`, `Show` and `Hash` all read the tag", async () => {
    // `Rust | Amber | Green` is deliberately not in alphabetical order: derived
    // `Ord` is *declaration* order (§7's implementer note), which the retired
    // string form could have got right by accident and the tag table cannot.
    const main = await runProject([["/main.hex",
      "export union Beacon derives (Eq, Ord, Show, Hash) = Rust | Amber | Green\n" +
      "export let sameValue: Bool = Rust == Rust\n" +
      "export let differentValues: Bool = Rust != Green\n" +
      "export let declaredOrder: Bool = Rust < Amber and Amber < Green\n" +
      "export let notAlphabetical: Bool = Rust < Amber\n" +
      "export let shown: String = show(Amber)\n" +
      "export let equalHash: Bool = Hash.hash(Rust) == Hash.hash(Rust)\n" +
      "export let unequalHash: Bool = Hash.hash(Rust) != Hash.hash(Green)\n"]]);

    expect(main["sameValue"]).toBe(true);
    expect(main["differentValues"]).toBe(true);
    expect(main["declaredOrder"]).toBe(true);
    // Alphabetically `Amber < Green < Rust`, so this is `false` under a name
    // comparison and `true` under the declaration-index table.
    expect(main["notAlphabetical"]).toBe(true);
    expect(main["shown"]).toBe("Amber");
    expect(main["equalHash"]).toBe(true);
    expect(main["unequalHash"]).toBe(true);
  });

  test("the derived bodies are the tag walks, with no switch left to decide", () => {
    // The four reductions in one place. Each is the payload-carrying walk with
    // its arms folded away — every arm of `Eq`'s switch answers `true`, of
    // `Show`'s the tag, of `Hash`'s the same tag's hash, and of `Ord`'s `Equal`
    // — so what remains is the tag test the walk would have reached anyway.
    const emitted = javascript([["/main.hex",
      "export union Coin derives (Eq, Ord, Show, Hash) = Copper | Silver\n" +
      "export let one: Coin = Copper\n"]]);

    expect(emitted).toContain(
      "const __Eq_Coin_equals = (__left, __right) => __left.tag === __right.tag;",
    );
    expect(emitted).toContain("const __Show_Coin_show = __value => __value.tag;");
    expect(emitted).toContain(
      "const __Hash_Coin_hash = __value => __stableHash(__value.tag);",
    );
    expect(emitted).toContain(
      "const __Ord_Coin_compare = (__left, __right) => __ordering(" +
        '(__left.tag === "Copper" ? 0 : __left.tag === "Silver" ? 1 : -1) - ' +
        '(__right.tag === "Copper" ? 0 : __right.tag === "Silver" ? 1 : -1));',
    );
  });
});

describe("`Ordering` end to end", () => {
  test("a `compare` answers with the tagged constant, and `==`/`show` agree", async () => {
    const main = await runProject([["/main.hex",
      "export let lesser: Ordering = Ord.compare(1, 2)\n" +
      "export let isLess: Bool = Ord.compare(1, 2) == Ordering.Less\n" +
      "export let named: String = show(Ord.compare(1, 2))\n" +
      "export let matched: String = match Ord.compare(3, 2)\n" +
      "    Ordering.Less => \"lt\"\n" +
      "    Ordering.Equal => \"eq\"\n" +
      "    Ordering.Greater => \"gt\"\n"]]);

    expect(main["lesser"]).toEqual({ tag: "Less" });
    expect(main["isLess"]).toBe(true);
    expect(main["named"]).toBe("Less");
    expect(main["matched"]).toBe("gt");
  });

  test("every seat that manufactures an `Ordering` answers one", async () => {
    // One export per emitter site that writes an `Ordering` with no declaration
    // in front of it. Each goes through `Ord.compare` rather than `<`, because
    // the relational operators at a primitive take Operators §5.1's fast path
    // and consume a sign that never becomes an `Ordering` at all — the test
    // below is the one that covers those.
    //
    //   `atInt`/`atNat`/`atBigInt`      the primop comparators
    //   `atFloat`/`atText`              those two through the `ordering` helper
    //   `atBool`                        the `Bool` pin's own compare
    //   `atRecord`                      the inline primitive ternary, and the
    //                                   lexicographic composition over it
    //   `atTuple`                       the same composition at a tuple
    //   `atUnit`                        that composition over no components
    //   `atVector`                      the `Vector` walk
    //   `atUnionTag`/`atUnionPayload`   a union's tag order and its payload path
    const main = await runProject([["/main.hex",
      "export record Switch derives (Eq, Ord) = {on: Bool}\n" +
      "export record Ledger derives (Eq, Ord) = {rows: Int, note: String}\n" +
      "export union Token derives (Eq, Ord) = Blank | Marked(weight: Int)\n" +
      "export let atInt: Ordering = Ord.compare(1, 2)\n" +
      "export let atNat: Ordering = Ord.compare((1: Nat), (2: Nat))\n" +
      "export let atFloat: Ordering = Ord.compare(1.5, 2.5)\n" +
      "export let atText: Ordering = Ord.compare(\"a\", \"b\")\n" +
      "export let atBigInt: Ordering = Ord.compare(1n, 2n)\n" +
      "export let atBool: Ordering = " +
        "Ord.compare(Switch({on = False}), Switch({on = True}))\n" +
      "export let atRecord: Ordering = Ord.compare(" +
        "Ledger({rows = 1, note = \"a\"}), Ledger({rows = 1, note = \"b\"}))\n" +
      "export let atTuple: Ordering = Ord.compare((1, 2), (1, 3))\n" +
      "export let atUnit: Ordering = Ord.compare((), ())\n" +
      "export let atVector: Ordering = Ord.compare([1, 2], [1, 3])\n" +
      "export let atUnionTag: Ordering = Ord.compare(Blank, Marked(0))\n" +
      "export let atUnionPayload: Ordering = Ord.compare(Marked(1), Marked(2))\n"]]);

    for (
      const name of [
        "atInt",
        "atNat",
        "atFloat",
        "atText",
        "atBigInt",
        "atBool",
        "atRecord",
        "atTuple",
        "atVector",
        "atUnionTag",
        "atUnionPayload",
      ]
    ) {
      expect([name, main[name]]).toEqual([name, { tag: "Less" }]);
    }
    // The composition over no components — the one seat whose whole answer is a
    // bare `Ordering`, and so the one that used to need parenthesising when the
    // answer was an object literal: `(__left, __right) => { tag: "Equal" }`
    // parses that object as a block. Under B1 the answer is a *name*, which can
    // never open a block, so the parentheses are retired; the seat keeps its
    // pin (`ordering-representation.test.ts` reads its emitted text) because it
    // is still the one an object literal would break.
    expect(main["atUnit"]).toEqual({ tag: "Equal" });
  });

  test("the relational four still read the answer at every type", async () => {
    // Operators §5.1's constructor test, at the fast paths (`Int`, `Nat`,
    // `Float`, `String`, `BigInt`, and the `Bool` pin, which compare operands
    // directly) and at the four that go through a `compare` and read its tag.
    const main = await runProject([["/main.hex",
      "export record Reading derives (Eq, Ord) = {step: Int}\n" +
      "export union Phase derives (Eq, Ord) = Warm | Cold(depth: Int)\n" +
      "export let ints: Bool = 1 < 2\n" +
      "export let nats: Bool = (1: Nat) <= (2: Nat)\n" +
      "export let floats: Bool = 2.5 > 1.5\n" +
      "export let texts: Bool = \"a\" < \"b\"\n" +
      "export let bigs: Bool = 2n >= 1n\n" +
      "export let bools: Bool = False < True\n" +
      "export let tuples: Bool = (1, 2) < (1, 3)\n" +
      "export let records: Bool = Reading({step = 1}) < Reading({step = 2})\n" +
      "export let vectors: Bool = [1, 2] < [1, 3]\n" +
      "export let unions: Bool = Warm < Cold(0)\n"]]);

    for (
      const name of [
        "ints",
        "nats",
        "floats",
        "texts",
        "bigs",
        "bools",
        "tuples",
        "records",
        "vectors",
        "unions",
      ]
    ) {
      expect([name, main[name]]).toEqual([name, true]);
    }
  });

  test("a function returning `Ordering` faces the prelude's type", () => {
    expect(declarations([["/main.hex",
      "export let rank(a: Int, b: Int): Ordering = Ord.compare(a, b)\n"]]))
      .toBe(
        'import type { Ordering } from "./Ordering.js";\n' +
          "export declare const rank: (a: number, b: number) => Ordering;\n",
      );
  });

  test("the prelude's own `Ordering` module carries the constants and the face", () => {
    const project = compileFiles([["/main.hex",
      "export let side(a: Int, b: Int): Ordering = Ord.compare(b, a)\n"]]);
    expect(project.diagnostics).toEqual([]);
    const ordering = project.modules.find(({ source }) => source.path === "/Ordering.hex")!;

    expect(ordering.javascript.text).toContain(
      'const Less = { tag: "Less" };\n' +
        'const Equal = { tag: "Equal" };\n' +
        'const Greater = { tag: "Greater" };\n',
    );
    expect(ordering.declarations.text).toContain(
      'export type Ordering = { tag: "Less" } | { tag: "Equal" } | { tag: "Greater" };',
    );
    // `Ordering.hex` manufactures no `Ordering` of its own — it derives only
    // `Eq` and `Show` — so it hoists nothing. The three object literals in it
    // are the *declarations*, which is why they are bare-named.
    expect(ordering.javascript.text).not.toContain("__Less");
  });
});

/**
 * B1, ruled by James (2026-09-03): a manufactured tagged value is **one shared
 * constant per emitting module**, hoisted and referenced, not a fresh literal at
 * each site.
 *
 * What the ruling buys is Unions §6.1's own words — a nullary constructor is a
 * shared constant and a construction of it allocates nothing — held by the
 * values the emitter manufactures for itself, and the three spec sentences that
 * call those values shared constants outright (Operators §4.5, Intrinsics'
 * `bigIntCompare` note, FFI Part 11 §3). What it does not buy, and never
 * promised, is identity *across* modules: §6.1 says identity is never observed,
 * so two modules' `Less` are equal, matchable and showable alike and separable
 * only by `===`, which no Hexagon program can write.
 */
describe("a manufactured value is one hoisted constant per module", () => {
  test("the constant is emitted once, however many sites read it", () => {
    // Four seats in one module reach `Less`: two derived `compare` bodies and
    // the two comparisons over them.
    const emitted = javascript([["/main.hex",
      "export record Reading derives (Eq, Ord) = {step: Int}\n" +
      "export record Sample derives (Eq, Ord) = {mark: Int}\n" +
      "export let a: Bool = Reading({step = 1}) < Reading({step = 2})\n" +
      "export let b: Bool = Sample({mark = 1}) < Sample({mark = 2})\n"]]);

    expect(emitted.match(/const __Less = \{ tag: "Less" \};/gu)).toHaveLength(1);
    expect(emitted.match(/const __Equal = \{ tag: "Equal" \};/gu)).toHaveLength(1);
    expect(emitted.match(/const __Greater = \{ tag: "Greater" \};/gu)).toHaveLength(1);
    // And every seat reads the name: no site rebuilds the object.
    expect(emitted).not.toMatch(/=> \{ tag: "Less" \}|\? \{ tag: "Less" \}|\(\{ tag: "Less" \}\)/u);
    expect(emitted).toContain("__Less");
  });

  test("a module that manufactures none mints none", () => {
    // No derivation, no comparison, no `kind` — nothing to hoist. The constants
    // are on `#useHelper`'s shape: minted on demand, never speculatively.
    const emitted = javascript([["/main.hex",
      "export union Colour = Ochre | Slate\n" +
      "export let picked: Colour = Slate\n"]]);

    expect(emitted).not.toContain("__Less");
    expect(emitted).not.toContain("__Equal");
    expect(emitted).not.toContain("__Greater");
    expect(emitted).toContain('const Ochre = { tag: "Ochre" };');
  });

  test("no manufactured value is an object literal inside a function body", () => {
    // The sweep, over the whole compiled prelude: every `Ordering`/`JsKind`
    // literal in the emitted standard library is a module-level `const`
    // declaration — either a hoisted constant (`__Less`) or, in the two
    // declaring modules, the constructor's own binding (`Less`).
    const project = compileFiles([["/main.hex",
      "export record Tick derives (Eq, Ord) = {at: Int}\n" +
      "export let ordered: Bool = Tick({at = 1}) < Tick({at = 2})\n" +
      "export let ranked: Ordering = Ord.compare(1.5, 2.5)\n" +
      "export let sized: Ordering = Ord.compare(\"a\", \"b\")\n" +
      "export let counted: Ordering = Ord.compare(1n, 2n)\n" +
      "export let kindOf(v: JsValue): JsKind = JsValue.kind(v)\n"]]);
    expect(project.diagnostics).toEqual([]);

    const tags =
      "Less|Equal|Greater|Undefined|Null|Bool|Number|BigInt|String|Symbol|Function|Array|Object";
    const stray: string[] = [];
    for (const { source, javascript: emitted } of project.modules) {
      for (const line of emitted.text.split("\n")) {
        if (!new RegExp(`\\{ tag: "(?:${tags})" \\}`, "u").test(line)) continue;
        if (new RegExp(`^const (?:__)?[A-Za-z0-9_]+ = \\{ tag: "(?:${tags})" \\};$`, "u").test(line)) {
          continue;
        }
        stray.push(`${source.path}: ${line.trim()}`);
      }
    }
    expect(stray).toEqual([]);
  });

  test("two compares in one module answer the identical object", async () => {
    // The property the hoist exists for, observed the only way it can be: from
    // JavaScript, by `===`. Within a module every `Less` is one object, so a
    // comparison-heavy body allocates no `Ordering` at all.
    const main = await runProject([["/main.hex",
      "export record Gauge derives (Eq, Ord) = {tick: Int}\n" +
      "export let first: Ordering = Ord.compare(Gauge({tick = 1}), Gauge({tick = 2}))\n" +
      "export let second: Ordering = Ord.compare(Gauge({tick = 3}), Gauge({tick = 9}))\n" +
      "export let level: Ordering = Ord.compare(Gauge({tick = 4}), Gauge({tick = 4}))\n"]]);

    expect(main["first"]).toEqual({ tag: "Less" });
    expect(Object.is(main["first"], main["second"])).toBe(true);
    expect(Object.is(main["first"], main["level"])).toBe(false);
  });

  test("identity stops at the module boundary, and nothing in the language sees it", async () => {
    // The non-promise, stated as a test so it cannot be mistaken for a bug: the
    // prelude's own `Ordering.Less` and a compare's answer are different
    // objects and the same value. Every question Hexagon can ask agrees.
    const main = await runProject([["/main.hex",
      "export let computed: Ordering = Ord.compare(1, 2)\n" +
      "export let written: Ordering = Ordering.Less\n" +
      "export let same: Bool = Ord.compare(1, 2) == Ordering.Less\n" +
      "export let shown: String = show(Ord.compare(1, 2))\n" +
      "export let matched: Bool = match Ord.compare(1, 2)\n" +
      "    Ordering.Less => True\n" +
      "    _ => False\n"]]);

    expect(main["same"]).toBe(true);
    expect(main["shown"]).toBe("Less");
    expect(main["matched"]).toBe(true);
    expect(main["computed"]).toEqual(main["written"]);
    // Different objects — the one difference, and unobservable from Hexagon.
    expect(Object.is(main["computed"], main["written"])).toBe(false);
  });

  test("a hoisted name that a reserved capture already holds takes the `_1` probe", () => {
    // `__Number`, `__String`, `__Array`, `__Object`, `__Symbol` and `__BigInt`
    // are seeded in *every* module for FFI Part 7 §1.2's captures, contested or
    // not, so six of the ten `JsKind` constants meet #425's probe. Pinned
    // because it is the one place the hoist's spelling is not the plain one.
    const project = compileFiles([["/main.hex",
      "export let classify(v: JsValue): JsKind = JsValue.kind(v)\n"]]);
    expect(project.diagnostics).toEqual([]);
    const text = project.modules
      .find(({ source }) => source.path === "/JsValue.hex")!.javascript.text;

    expect(text).toContain('const __Null = { tag: "Null" };');
    expect(text).toContain('const __Number_1 = { tag: "Number" };');
    expect(text).toContain('const __Object_1 = { tag: "Object" };');
  });
});

describe("`JsKind`", () => {
  test("`kind` answers the tagged constant, and a match reads three of them", async () => {
    const main = await runProject([["/main.hex",
      "export let isNull(v: JsValue): Bool = JsValue.kind(v) == JsKind.Null\n" +
      "export let label(v: JsValue): String = match JsValue.kind(v)\n" +
      "    JsKind.Null => \"null\"\n" +
      "    JsKind.Number => \"number\"\n" +
      "    JsKind.String => \"string\"\n" +
      "    _ => \"other\"\n" +
      "export let named(v: JsValue): String = show(JsValue.kind(v))\n"]]);

    const isNull = main["isNull"] as (v: unknown) => boolean;
    const label = main["label"] as (v: unknown) => string;
    const named = main["named"] as (v: unknown) => string;

    expect(isNull(null)).toBe(true);
    expect(isNull(1)).toBe(false);
    expect(label(null)).toBe("null");
    expect(label(1)).toBe("number");
    expect(label("a")).toBe("string");
    expect(label({})).toBe("other");
    expect(named(undefined)).toBe("Undefined");
  });

  test("the `kind` ladder answers with the module's hoisted constants", () => {
    const project = compileFiles([["/main.hex",
      "export let classify(v: JsValue): JsKind = JsValue.kind(v)\n"]]);
    expect(project.diagnostics).toEqual([]);
    const text = project.modules
      .find(({ source }) => source.path === "/JsValue.hex")!.javascript.text;

    expect(text).toContain('const __Null = { tag: "Null" };');
    expect(text).toContain("if (__value === null) return __Null;");
    expect(text).toContain('if (__type === "bigint") return __BigInt_1;');
    expect(text).toContain("    return __Object_1;");
  });
});

describe("what one shape does not change", () => {
  test("the `Bool` pin stands: `true`/`false`, `boolean`, and no tag anywhere", async () => {
    // §6.2's one exception, and the only union whose `match` still switches on
    // the value rather than on a tag — so it is also the only one that still
    // needs no temporary to name the scrutinee by.
    const source = "export let yes: Bool = True\n" +
      "export let no: Bool = False\n" +
      "export let flip(b: Bool): Bool = match b\n" +
      "    True => False\n" +
      "    False => True\n" +
      "export let pick(b: Bool): Int = if b then 1 else 0\n";

    const emitted = javascript([["/main.hex", source]]);
    expect(emitted).toContain("const yes = true;\nconst no = false;\n");
    expect(emitted).toContain(
      "const flip = b => {\n  switch (b) {\n    case true:\n      return false;\n",
    );
    expect(emitted).toContain("const pick = b => b ? 1 : 0;");
    expect(emitted).not.toContain(".tag");

    expect(declarations([["/main.hex", source]])).toBe(
      "export declare const yes: boolean;\n" +
        "export declare const no: boolean;\n" +
        "export declare const flip: (b: boolean) => boolean;\n" +
        "export declare const pick: (b: boolean) => number;\n",
    );

    const main = await runProject([["/main.hex", source]]);
    expect(main["yes"]).toBe(true);
    expect((main["flip"] as (b: boolean) => boolean)(true)).toBe(false);
    expect((main["pick"] as (b: boolean) => number)(false)).toBe(0);
  });

  test("a nullary constructor of a mixed union is the same constant it always was", () => {
    expect(javascript([["/main.hex",
      "export union Figure = Vertex | Segment(length: Float)\n" +
      "export let origin: Figure = Vertex\n"]]))
      .toContain('const Vertex = { tag: "Vertex" };');
  });

  test("adding a payload constructor moves no existing constructor's bytes", () => {
    // The cliff, measured: the constructors already declared keep their emitted
    // lines and their `.d.ts` arms, character for character, across the edit
    // that used to change the shape of every one of them.
    const before = "export union Relic = Urn | Coin\n" +
      "export let held: Relic = Urn\n";
    const after = "export union Relic = Urn | Coin | Tablet(rows: Int)\n" +
      "export let held: Relic = Urn\n";

    const constructorLines = (text: string): readonly string[] =>
      text.split("\n").filter((line) => /^const (?:Urn|Coin) = /u.test(line));
    const arms = (text: string): readonly string[] =>
      text
        .split("\n")
        .find((line) => line.startsWith("export type Relic = "))!
        .slice("export type Relic = ".length, -1)
        .split(" | ");

    const beforeProject = compileFiles([["/main.hex", before]]);
    const afterProject = compileFiles([["/main.hex", after]]);
    expect(beforeProject.diagnostics).toEqual([]);
    expect(afterProject.diagnostics).toEqual([]);
    const emitted = (project: typeof beforeProject) =>
      project.modules.find(({ source }) => source.path === "/main.hex")!;

    expect(constructorLines(emitted(beforeProject).javascript.text)).toEqual([
      'const Urn = { tag: "Urn" };',
      'const Coin = { tag: "Coin" };',
    ]);
    expect(constructorLines(emitted(afterProject).javascript.text))
      .toEqual(constructorLines(emitted(beforeProject).javascript.text));

    expect(arms(emitted(beforeProject).declarations.text))
      .toEqual(['{ tag: "Urn" }', '{ tag: "Coin" }']);
    expect(arms(emitted(afterProject).declarations.text).slice(0, 2))
      .toEqual(arms(emitted(beforeProject).declarations.text));
    // And the rows below the type keep their text too.
    expect(emitted(afterProject).declarations.text)
      .toContain("export declare const Urn: Relic;\nexport declare const Coin: Relic;\n");
  });

  test("a union of nullary constructors is no longer a `.d.ts` string union", () => {
    const text = declarations([["/main.hex", "export union Mood = Calm | Wild\n"]]);
    expect(text).not.toContain('"Calm" | "Wild"');
    expect(compileMain("export union Mood = Calm | Wild\n").diagnostics).toEqual([]);
  });
});
