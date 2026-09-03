import { describe, expect, test } from "vitest";

import { compileFiles, projectDiagnostics, runMain, runProject } from "../support/test-project.js";

/**
 * Conformance for the **literal form of `extern enum`** — Foreign Enums §2.4,
 * and the §9 acceptance tests 13–17 it added (issue #773).
 *
 * The form is a module-scope declaration whose members are JavaScript values
 * written in place of foreign member names: `extern enum Direction = "up" as Up
 * | "down" as Down`. Nothing is read, so it is the FFI's one module-free
 * `extern` head (Part 4 §2.2), and it is an ordinary declaration of the module
 * it appears in.
 *
 * Four claims are pinned here, and each is a sentence of the spec.
 *
 * - **It is a union** (§2.4, §4). The local type is nominal and monomorphic, the
 *   constructors are nullary and enter the term namespace, and matching,
 *   exhaustiveness, the constructor door and derivation are the ordinary union's
 *   in every respect. What differs is only where the runtime values come from.
 * - **The values are the declaration's own** (§7.1). Each constructor is a
 *   constant holding the literal itself, with nothing imported and no tag,
 *   wrapper or brand created at runtime; a match lowers to a `switch` on the
 *   scrutinee, which §4 licenses because `===` and `Object.is` agree on every
 *   kind of member a declaration may write.
 * - **Nullish members are legal here** (§2.4), because nothing is read. An enum
 *   naming *both* `null` and `undefined` is a designated nullish-absorbing type
 *   — `Nullable(T) ≡ T` (Part 2 §2.1, Part 11 §8) — and one naming exactly one
 *   of them is refused under `Nullable`, with the section's own rewrite.
 * - **The face is the literal union** (§7.2), with no brand: the values are
 *   known exactly, so the brand's opacity has nothing to cover.
 *
 * The object-reading form is not implemented (#779); its refusal is pinned here
 * once, unchanged.
 */

/** The emitted JavaScript of a one-module program at `/main.hex`. */
function javascript(source: string): string {
  const compiled = compileFiles([["/main.hex", source]]);
  expect(compiled.diagnostics).toEqual([]);
  return compiled.modules.find(({ source: file }) => file.path === "/main.hex")!
    .javascript.text;
}

/** The emitted `.d.ts` text of a one-module program at `/main.hex`. */
function declarations(source: string): string {
  const compiled = compileFiles([["/main.hex", source]]);
  expect(compiled.diagnostics).toEqual([]);
  return compiled.modules.find(({ source: file }) => file.path === "/main.hex")!
    .declarations.text;
}

const TRI = "export extern enum Tri derives (Eq, Ord, Show, Hash) =\n" +
  "    | true as Yes\n" +
  "    | false as No\n" +
  "    | null as Unknown\n" +
  "    | undefined as Missing\n";

describe("the declaration (§2.4)", () => {
  /**
   * §9 test 13's first row: the four literal kinds, mixed freely within one
   * declaration, each becoming the constant it names (§7.1).
   */
  test("string, integer, boolean and mixed members each bind their literal", () => {
    const emitted = javascript(
      "export extern enum Direction = \"up\" as Up | \"down\" as Down\n" +
        "export extern enum Level = 0 as Low | 1 as High\n" +
        "export extern enum Flag = true as On | false as Off\n" +
        "export extern enum Mixed = \"a\" as A | 7 as Seven | false as No | null as Nil\n",
    );
    expect(emitted).toContain('const Up = "up";');
    expect(emitted).toContain('const Down = "down";');
    expect(emitted).toContain("const Low = 0;");
    expect(emitted).toContain("const High = 1;");
    expect(emitted).toContain("const On = true;");
    expect(emitted).toContain("const Off = false;");
    expect(emitted).toContain('const A = "a";');
    expect(emitted).toContain("const Seven = 7;");
    expect(emitted).toContain("const Nil = null;");
    // §7.1: "with nothing imported" — no enum object, reverse table, string
    // remapping, wrapper class or brand is created at runtime.
    expect(emitted).not.toContain('tag: "Up"');
    expect(emitted).not.toContain("import");
  });

  /** §2.4: the sign is part of an integer literal, as it is in a pattern. */
  test("an integer member may carry a leading sign", () => {
    expect(javascript(
      "export extern enum Offset = -1 as Back | 0 as Still | 1 as Forward\n",
    )).toContain("const Back = -1;");
  });

  /**
   * §2.4's compact and multi-line spellings are one grammar: the head may end at
   * `=` and continue on indented `|` lines, exactly as a union's does.
   */
  test("the head lays out on one line or over many", () => {
    expect(projectDiagnostics(
      "export extern enum One = \"a\" as A | \"b\" as B\n" +
        "export extern enum Many =\n" +
        "    | \"c\" as C\n" +
        "    | \"d\" as D\n" +
        "export extern enum NoLeadingBar =\n" +
        "    \"e\" as E\n" +
        "    | \"f\" as F\n",
    )).toEqual([]);
  });

  /**
   * §4: "Two extern enums listing identically named or identical-looking foreign
   * values remain distinct nominal types."
   */
  test("two enums over the same values are distinct types", () => {
    expect(projectDiagnostics(
      "export extern enum Left = \"a\" as LeftA\n" +
        "export extern enum Right = \"a\" as RightA\n" +
        "export let mix(x: Left): Right = x\n",
    )).toEqual(["type mismatch: expected Right, found Left"]);
  });

  /**
   * §4: "Constructors are values, not nullary functions" — the ordinary nullary
   * constructor diagnostic, unchanged.
   */
  test("a member is a value, not a nullary function", () => {
    expect(projectDiagnostics(
      "export extern enum Direction = \"up\" as Up\n" +
        "export let go(): Direction = Up()\n",
    )).toEqual(["`Up` is a value, not a function; write it without `()`"]);
  });
});

describe("visibility and export (§2.3)", () => {
  /**
   * §9 test 13: the private surface. §2.3's default — an unprefixed declaration
   * is private to the binding module — reaches the JavaScript export list and
   * the `.d.ts` alike (Modules §11.4: a private type gets no line of any kind).
   */
  test("a private enum exports nothing and faces nothing", () => {
    const source = "extern enum Direction = \"up\" as Up | \"down\" as Down\n" +
      "export let go(): String = match Up\n" +
      "    Up => \"u\"\n" +
      "    Down => \"d\"\n";
    const emitted = javascript(source);
    expect(emitted).toContain('const Up = "up";');
    expect(emitted).not.toContain("export { Up }");
    expect(emitted).not.toContain("export { fromJsDirection }");
    const face = declarations(source);
    expect(face).not.toContain("Direction");
    expect(face).not.toContain("fromJsDirection");
  });

  /**
   * §2.3: `export extern enum` exports the local nominal type, every local
   * constructor, **and** the generated conversion bindings of §5.2.
   */
  test("`export extern enum` exports the type, the members and the conversions", () => {
    const source = "export extern enum Direction = \"up\" as Up | \"down\" as Down\n";
    const emitted = javascript(source);
    expect(emitted).toContain("export { Up };");
    expect(emitted).toContain("export { Down };");
    expect(emitted).toContain("export { fromJsDirection };");
    expect(emitted).toContain("export { toJsDirection };");
  });
});

describe("documentation", () => {
  /**
   * The head is a documentable declaration, and each member is documentable as a
   * union's constructor is (`spec/doc-comments.md` §4, §7.1). This matters
   * because `extern from`'s header is *not* one — a doc block over it draws the
   * extern-header message — and the two heads share their first word.
   */
  test("the declaration and its members take doc blocks", () => {
    const source = "(** Which way the cursor moves. *)\n" +
      "export extern enum Direction =\n" +
      "    (** Toward the top of the document. *)\n" +
      "    | \"up\" as Up\n" +
      "    (** Toward the bottom. *)\n" +
      "    | \"down\" as Down\n";
    const emitted = javascript(source);
    expect(emitted).toContain("Toward the top of the document.");
    expect(emitted).toContain("Toward the bottom.");
    const face = declarations(source);
    expect(face).toContain("Which way the cursor moves.");
    expect(face).toContain("Toward the bottom.");
  });
});

describe("matching (§4)", () => {
  /**
   * §9 test 15, and §4's own example: the literal form is the proven-identical
   * case of the `Object.is` rule, so a match lowers to a `switch` **on the
   * scrutinee** — not on a `.tag` it does not carry — with the members' own
   * values as case labels.
   */
  test("a match lowers to a `switch` on the scrutinee", () => {
    expect(javascript(
      "export extern enum Order = \"asc\" as Ascending | \"desc\" as Descending\n" +
        "export let describe(order: Order): String =\n" +
        "    match order\n" +
        "        Ascending => \"ascending\"\n" +
        "        Descending => \"descending\"\n",
    )).toContain(
      "  switch (order) {\n" +
        '    case "asc":\n' +
        '      return "ascending";\n' +
        '    case "desc":\n' +
        '      return "descending";\n',
    );
  });

  /** A nullish member's case label is the nullish value itself. */
  test("a nullish member takes its own `switch` case", () => {
    const emitted = javascript(
      TRI + "export let name(t: Tri): String =\n" +
        "    match t\n" +
        "        Yes => \"yes\"\n" +
        "        No => \"no\"\n" +
        "        Unknown => \"unknown\"\n" +
        "        Missing => \"missing\"\n",
    );
    expect(emitted).toContain("case null:");
    expect(emitted).toContain("case undefined:");
  });

  /**
   * A guard sends the arm through the conditional lowering instead, where the
   * test is `===` against the same value. The two lowerings must agree about
   * what a member *is*.
   */
  test("a guarded arm tests the member value with `===`", () => {
    expect(javascript(
      "export extern enum Order = \"asc\" as Ascending | \"desc\" as Descending\n" +
        "export let describe(order: Order, loud: Bool): String =\n" +
        "    match order\n" +
        "        Ascending when loud => \"ASC\"\n" +
        "        _ => \"other\"\n",
    )).toContain('=== "asc"');
  });

  /** Exhaustiveness reads the declared local constructor set, as for any union. */
  test("exhaustiveness reads the declared member set", () => {
    expect(projectDiagnostics(
      "export extern enum Direction = \"up\" as Up | \"down\" as Down\n" +
        "export let go(d: Direction): String =\n" +
        "    match d\n" +
        "        Up => \"u\"\n",
    )).toEqual(["match is missing cases: `Down`"]);
  });

  /** Reachability likewise. */
  test("a repeated member is an unreachable arm", () => {
    expect(projectDiagnostics(
      "export extern enum Direction = \"up\" as Up | \"down\" as Down\n" +
        "export let go(d: Direction): String =\n" +
        "    match d\n" +
        "        Up => \"u\"\n" +
        "        Down => \"d\"\n" +
        "        Up => \"u again\"\n",
    )).toEqual(["this case is unreachable; `Up` is already handled above"]);
  });

  /**
   * §4: "a foreign function falsely declared as returning `Direction` may return
   * an out-of-set value… Hexagon need not add a hidden default arm to every
   * match." The behaviour is the ordinary exhaustive-match lowering's: the
   * `switch` falls through to the arm the emitter already writes for a value no
   * declared case matched, which throws.
   *
   * The false declaration is simulated by rewriting the binding module's emitted
   * JavaScript, which is exactly what an untrue `extern` row would have produced.
   */
  test("an out-of-set foreign value falls through to the emitted default", async () => {
    const exports = await runProject([
      ["/bindings.hex",
        "export extern enum Sign = \"pos\" as Pos | null as Zero\n" +
          "export let current(): Sign = Pos\n"],
      ["/main.hex",
        "import Bindings from \"./bindings\"\n" +
          "export let read(): String =\n" +
          "    match Bindings.current()\n" +
          "        Bindings.Pos => \"pos\"\n" +
          "        Bindings.Zero => \"zero\"\n"],
    ], {
      transform: (path, text) =>
        path === "/bindings.hex"
          ? text.replace("const current = () => Pos;", "const current = () => undefined;")
          : text,
    });
    expect(() => (exports["read"] as () => string)()).toThrow(RangeError);
  });
});

describe("abroad (§2.3, §9 test 13)", () => {
  /**
   * §2.4: the declaration is "reached from other modules through their import of
   * that module, exactly as an `extern from` block's declarations are". The
   * members are reached as `Bindings.Up`, matched abroad, and reached bare in a
   * pattern through Pattern Matching §2.2's constructor door.
   */
  test("the type, its members and a match all cross the module boundary", async () => {
    const exports = await runProject([
      ["/bindings.hex",
        "export extern enum Direction = \"up\" as Up | \"down\" as Down\n"],
      ["/main.hex",
        "import Bindings from \"./bindings\"\n" +
          "export let qualified(): String =\n" +
          "    match Bindings.Up\n" +
          "        Bindings.Up => \"u\"\n" +
          "        Bindings.Down => \"d\"\n" +
          "export let door(d: Bindings.Direction): String =\n" +
          "    match d\n" +
          "        Up => \"u\"\n" +
          "        Down => \"d\"\n" +
          "export let value(): Bindings.Direction = Bindings.Down\n"],
    ]);
    expect((exports["qualified"] as () => string)()).toBe("u");
    expect((exports["value"] as () => string)()).toBe("down");
    expect(
      (exports["door"] as (d: unknown) => string)((exports["value"] as () => string)()),
    ).toBe("d");
  });

  /**
   * §7.1: "When public, constructors are ordinary named ESM exports whose
   * runtime values remain… the literals." A consumer therefore imports the
   * constant like any other exported name; the reference is the constant's own
   * spelling, not the literal inlined at the use site.
   */
  test("a member reached abroad is imported, not inlined", async () => {
    const project = compileFiles([
      ["/bindings.hex", "export extern enum Direction = \"up\" as Up | \"down\" as Down\n"],
      ["/main.hex",
        "import Bindings from \"./bindings\"\n" +
          "export let go(): Bindings.Direction = Bindings.Up\n"],
    ]);
    expect(project.diagnostics).toEqual([]);
    const main = project.modules.find(({ source }) => source.path === "/main.hex")!;
    expect(main.javascript.text).toContain('import * as Bindings from "./bindings.js";');
    expect(main.javascript.text).toContain("const go = () => Bindings.Up;");
  });
});

describe("the generated conversions (§5.2)", () => {
  /**
   * §5.2: "`fromJsDirection` evaluates its input once, compares it with the
   * declared members… in declaration order… and returns the corresponding
   * constructor in `Some`; otherwise it returns `None`." §7.1 emits it as a
   * small identity-membership chain, which §4 licenses as a `switch`.
   */
  test("`fromJsT` is a membership chain and `toJsT` is the identity", () => {
    const emitted = javascript(
      "export extern enum Direction = \"up\" as Up | \"down\" as Down\n",
    );
    expect(emitted).toContain(
      "const fromJsDirection = __value => {\n" +
        "  switch (__value) {\n" +
        '    case "up": return { tag: "Some", value: Up };\n' +
        '    case "down": return { tag: "Some", value: Down };\n' +
        '    default: return { tag: "None" };\n' +
        "  }\n" +
        "};",
    );
    expect(emitted).toContain("const toJsDirection = __value => __value;");
  });

  /** §9 test 7 and 8, at the literal form: every member, and a miss. */
  test("`fromJsT` answers `Some` for every member and `None` otherwise", async () => {
    const exports = await runMain(
      "export extern enum Direction = \"up\" as Up | \"down\" as Down\n" +
        "export let read(v: JsValue): String =\n" +
        "    match fromJsDirection(v)\n" +
        "        Some(Up) => \"up\"\n" +
        "        Some(Down) => \"down\"\n" +
        "        None => \"none\"\n",
    );
    const read = exports["read"] as (value: unknown) => string;
    expect(read("up")).toBe("up");
    expect(read("down")).toBe("down");
    expect(read("sideways")).toBe("none");
    expect(read(3)).toBe("none");
    expect(read(null)).toBe("none");
  });

  /** A nullish member is found by `fromJsT` like any other. */
  test("`fromJsT` finds a nullish member", async () => {
    const exports = await runMain(
      TRI + "export let read(v: JsValue): String =\n" +
        "    match fromJsTri(v)\n" +
        "        Some(t) => show(t)\n" +
        "        None => \"none\"\n",
    );
    const read = exports["read"] as (value: unknown) => string;
    expect(read(null)).toBe("Unknown");
    expect(read(undefined)).toBe("Missing");
    expect(read(true)).toBe("Yes");
    expect(read("other")).toBe("none");
  });

  /** §5.2: `toJsT` "is an identity widening… it does not allocate or encode". */
  test("`toJsT` preserves the value", async () => {
    const exports = await runMain(
      "export extern enum Level = 0 as Low | 1 as High\n" +
        "export let out(): JsValue = toJsLevel(High)\n",
    );
    expect((exports["out"] as () => unknown)()).toBe(1);
  });

  /**
   * §5.2: "Either generated name colliding with an explicit or generated term
   * binding is a hard compile error naming both origins… No silent suffix is
   * permitted."
   */
  test("a collision with an explicit binding is a hard error", () => {
    // Both origins in one sentence, whichever order they were written in: the
    // line the other declaration sits on, and the `extern enum` that generates
    // the contested name. A reader pointed at one of the two has to be able to
    // tell which is which without knowing §5.2 already.
    expect(projectDiagnostics(
      "extern enum Direction = \"up\" as Up\n" +
        "export let fromJsDirection(v: JsValue): Int = 1\n",
    )).toEqual([
      "`fromJsDirection` is already bound (line 1); `extern enum Direction` " +
      "generates it (Foreign Enums §5.2) — rename the enum type, or the other " +
      "declaration.",
    ]);
    expect(projectDiagnostics(
      "export let toJsDirection(v: Int): Int = v\n" +
        "extern enum Direction = \"up\" as Up\n",
    )).toEqual([
      "`toJsDirection` is already bound (line 1); `extern enum Direction` " +
      "generates it (Foreign Enums §5.2) — rename the enum type, or the other " +
      "declaration.",
    ]);
    // Two enums whose derived names would collide is the same fault, and §5.2
    // names it in the same breath as the explicit one.
    expect(projectDiagnostics(
      "extern enum Direction = \"up\" as Up\n" +
        "extern enum Direction = \"down\" as Down\n",
    )).toContain(
      "`fromJsDirection` is already bound (line 1); `extern enum Direction` " +
      "generates it (Foreign Enums §5.2) — rename the enum type, or the other " +
      "declaration.",
    );
  });

  /** Two enums in one binding module keep their own conversions (§5.2). */
  test("several enums in one module each get their own pair", () => {
    const emitted = javascript(
      "export extern enum Direction = \"up\" as Up\n" +
        "export extern enum Level = 0 as Low\n",
    );
    for (const name of ["fromJsDirection", "toJsDirection", "fromJsLevel", "toJsLevel"]) {
      expect(emitted).toContain(`export { ${name} };`);
    }
  });

  /** The conversions cross the module boundary as ordinary exported terms. */
  test("the conversions are reached abroad through the module alias", async () => {
    const exports = await runProject([
      ["/bindings.hex",
        "export extern enum Direction derives (Show) = \"up\" as Up | \"down\" as Down\n"],
      ["/main.hex",
        "import Bindings from \"./bindings\"\n" +
          "export let read(v: JsValue): String =\n" +
          "    match Bindings.fromJsDirection(v)\n" +
          "        Some(d) => show(d)\n" +
          "        None => \"none\"\n" +
          "export let out(): JsValue = Bindings.toJsDirection(Bindings.Up)\n"],
    ]);
    const read = exports["read"] as (value: unknown) => string;
    expect(read("up")).toBe("Up");
    expect(read("nope")).toBe("none");
    expect((exports["out"] as () => unknown)()).toBe("up");
  });
});

describe("nullish members (§2.4, §9 test 14)", () => {
  /**
   * §2.4: an enum naming **both** `null` and `undefined` is a designated
   * nullish-absorbing type, so `Nullable(T) ≡ T` — a foreign `T | null |
   * undefined` is received as `T` with no conversion. The collapse is
   * definitional, so the wrapped and unwrapped spellings are one type.
   */
  test("an enum naming both nullish values absorbs `Nullable`", () => {
    expect(projectDiagnostics(
      TRI + "export let through(x: Nullable(Tri)): Tri = x\n" +
        "export let back(x: Tri): Nullable(Tri) = x\n" +
        "export let twice(x: Nullable(Nullable(Tri))): Tri = x\n",
    )).toEqual([]);
  });

  /**
   * The collapse is definitional, so it survives a generic substitution and does
   * not depend on the order the arguments solve in — Part 2 §2.1's requirement,
   * and the shape `js-value-boundary.test.ts` pins for `JsValue`. This is the
   * seat that makes the designated set's third member behave like its second.
   */
  test("the collapse survives substitution, in either argument order", () => {
    expect(projectDiagnostics(
      TRI + "let witnessFirst(witness: a, value: Nullable(a)): Nullable(a) = value\n" +
        "let valueFirst(value: Nullable(a), witness: a): Nullable(a) = value\n" +
        "export let before(t: Tri): Tri = witnessFirst(t, t)\n" +
        "export let after(t: Tri): Tri = valueFirst(t, t)\n",
    )).toEqual([]);
    // With no witness at all, `Nullable(?a)` meets `Tri` with `?a` unsolved.
    // There is one solution, because the designated set is closed and every
    // member of it is ground, so the unifier commits it.
    expect(projectDiagnostics(
      TRI + "let alone(value: Nullable(a)): Nullable(a) = value\n" +
        "export let solved(t: Tri): Tri = alone(t)\n",
    )).toEqual([]);
  });

  /**
   * §2.4: "each nullish value is the constructor it names". The pin is the
   * runtime half of `Nullable(T) ≡ T`: an arriving `null` or `undefined` *is* a
   * member, matched like any other, with no wrapper anywhere.
   */
  test("an arriving nullish value is the member it names", async () => {
    const exports = await runMain(
      TRI + "export let ask(t: Nullable(Tri)): String = show(t)\n",
    );
    const ask = exports["ask"] as (t: unknown) => string;
    expect(ask(true)).toBe("Yes");
    expect(ask(null)).toBe("Unknown");
    expect(ask(undefined)).toBe("Missing");
  });

  /**
   * §2.4's refusal, `null`-only shape: the message names the declared form, the
   * member that names it, and the missing form's exemplar.
   */
  test("`Nullable` over a `null`-only enum is refused", () => {
    expect(projectDiagnostics(
      "export extern enum Tri = true as Yes | false as No | null as Unknown\n" +
        "export let f(x: Nullable(Tri)): Bool = Yes == Yes\n",
    )).toContain(
      "`Tri` already names `null`; `Nullable(Tri)` cannot tell absence from " +
        "`Unknown` — name both nullish values (`undefined as Missing`) or neither",
    );
  });

  /** The mirror shape, `undefined`-only: the same message names its own form. */
  test("`Nullable` over an `undefined`-only enum is refused", () => {
    expect(projectDiagnostics(
      "export extern enum Slot = \"ready\" as Ready | undefined as Missing\n" +
        "export let f(x: Nullable(Slot)): Bool = Ready == Ready\n",
    )).toContain(
      "`Slot` already names `undefined`; `Nullable(Slot)` cannot tell absence " +
        "from `Missing` — name both nullish values (`null as Absent`) or neither",
    );
  });

  /**
   * The refusal's seat is `Nullable`'s **one construction site**, which every
   * written wrapper passes through. The three groups below are that claim,
   * spelled out: a signature, a declaration's slot, and the two routes that put
   * the enum under the wrapper without writing the pair adjacently.
   */
  const ONE_NULLISH = "export extern enum Tri = true as Yes | null as Unknown\n";
  const REFUSAL =
    "`Tri` already names `null`; `Nullable(Tri)` cannot tell absence from " +
    "`Unknown` — name both nullish values (`undefined as Missing`) or neither";

  test("the refusal covers a binding's annotation and a signature", () => {
    expect(projectDiagnostics(`${ONE_NULLISH}let a: Nullable(Tri) = Yes\n`))
      .toContain(REFUSAL);
    expect(projectDiagnostics(`${ONE_NULLISH}let b(x: Nullable(Tri)): Bool = Yes == Yes\n`))
      .toContain(REFUSAL);
    expect(projectDiagnostics(`${ONE_NULLISH}let c(): Nullable(Tri) = Yes\n`))
      .toContain(REFUSAL);
  });

  test("the refusal covers an extern signature and a declaration's slot", () => {
    expect(projectDiagnostics(
      `${ONE_NULLISH}extern from "./x.js"\n    fun d(v: Nullable(Tri)): Int\n`,
    )).toContain(REFUSAL);
    expect(projectDiagnostics(`${ONE_NULLISH}record Box = { slot: Nullable(Tri) }\n`))
      .toContain(REFUSAL);
    expect(projectDiagnostics(`${ONE_NULLISH}union Holder = Holds(Nullable(Tri))\n`))
      .toContain(REFUSAL);
  });

  /**
   * One report per **written seat**, not one per enum: each wrapper is a
   * separate thing the author has to remove, and reporting only the first would
   * leave the rest to be found one compile at a time. A seat is a span, so an
   * annotation elaborated twice — once for its face, once for its check — still
   * reports once.
   */
  test("every wrapped seat is reported, and each of them once", () => {
    expect(projectDiagnostics(
      `${ONE_NULLISH}let a: Nullable(Tri) = Yes\n` +
        "let b(x: Nullable(Tri)): Int = 1\n" +
        "let c(): Nullable(Tri) = Yes\n",
    ).filter((message) => message.startsWith("`Tri` already names"))).toHaveLength(3);
  });

  test("the refusal covers an alias, an ascription and a nested position", () => {
    // A **generic** alias applied at the enum is the substitution route: the
    // wrapper and its argument are never written adjacently, so a rewrite of the
    // spelling alone could not reach it.
    expect(projectDiagnostics(
      `${ONE_NULLISH}type Maybe(a) = Nullable(a)\nlet g(x: Maybe(Tri)): Int = 1\n`,
    )).toContain(REFUSAL);
    expect(projectDiagnostics(`${ONE_NULLISH}let h = (Yes: Nullable(Tri))\n`))
      .toContain(REFUSAL);
    expect(projectDiagnostics(`${ONE_NULLISH}let f(x: Vector(Nullable(Tri))): Int = 1\n`))
      .toContain(REFUSAL);
  });

  /**
   * §2.4: "Receiving a foreign `T | null` as `T` needs no wrapper: `null` is a
   * member, and an arriving `undefined` is out of set like any undeclared
   * value." An enum naming only one nullish form is an ordinary enum in every
   * other respect — it is only `Nullable` over it that is refused.
   */
  test("a one-nullish enum is ordinary except under `Nullable`", async () => {
    const exports = await runMain(
      "export extern enum Sign = \"pos\" as Pos | null as Zero\n" +
        "export let read(v: JsValue): String =\n" +
        "    match fromJsSign(v)\n" +
        "        Some(Pos) => \"pos\"\n" +
        "        Some(Zero) => \"zero\"\n" +
        "        None => \"none\"\n",
    );
    const read = exports["read"] as (value: unknown) => string;
    expect(read("pos")).toBe("pos");
    expect(read(null)).toBe("zero");
    // The undeclared nullish form is out of set, exactly like any other
    // undeclared value.
    expect(read(undefined)).toBe("none");
  });

  /**
   * Part 11 §8's negative half, restated for this addition: the designated set
   * stays **explicit and closed**. An enum naming *no* nullish value does not
   * absorb, however ordinary it looks.
   */
  test("an enum naming no nullish value does not absorb", () => {
    expect(projectDiagnostics(
      "export extern enum Direction = \"up\" as Up | \"down\" as Down\n" +
        "export let f(x: Nullable(Direction)): Direction = x\n",
    )).toEqual(["type mismatch: expected Direction, found Nullable(Direction)"]);
  });
});

describe("derivation (§6)", () => {
  /**
   * §6: "`Ord` follows declaration order, never numeric/string/object
   * ordering." The enum below is written so that value order and declaration
   * order disagree, which is the only shape that can tell the two apart.
   */
  test("`Ord` follows declaration order, not value order", async () => {
    const exports = await runMain(
      "export extern enum Level derives (Eq, Ord, Show, Hash) = 2 as Low | 1 as High\n" +
        "export let order(): String = show(Ord.compare(Low, High))\n" +
        "export let reverse(): String = show(Ord.compare(High, Low))\n" +
        "export let same(): String = show(Ord.compare(Low, Low))\n",
    );
    // `Low` holds 2 and `High` holds 1, so a comparison by value would answer
    // `Greater`. Declaration order puts `Low` first, so it is `Less`.
    expect((exports["order"] as () => string)()).toBe("Less");
    expect((exports["reverse"] as () => string)()).toBe("Greater");
    expect((exports["same"] as () => string)()).toBe("Equal");
  });

  /** §6: "`Show` uses the local constructor name… not a foreign string value." */
  test("`Show` gives the local constructor name", async () => {
    const exports = await runMain(
      TRI + "export let names(): String =\n" +
        "    show(Yes) ++ show(No) ++ show(Unknown) ++ show(Missing)\n",
    );
    expect((exports["names"] as () => string)()).toBe("YesNoUnknownMissing");
  });

  /** §6: "`Eq` compares constructors", which for these values is `===`. */
  test("`Eq` compares members", async () => {
    const exports = await runMain(
      TRI + "export let same(): Bool = Yes == Yes\n" +
        "export let different(): Bool = Unknown == Missing\n" +
        "export let alsoDifferent(): Bool = Yes == No\n",
    );
    expect((exports["same"] as () => boolean)()).toBe(true);
    // `null` and `undefined` are two members, not one absence.
    expect((exports["different"] as () => boolean)()).toBe(false);
    expect((exports["alsoDifferent"] as () => boolean)()).toBe(false);
  });

  /**
   * §6: "`Hash` hashes the declaration index, not… foreign numeric magnitude."
   * The pin is both halves: consistency with `Eq`, and independence from the
   * values — two enums whose members hold different values but occupy the same
   * declaration positions hash alike.
   */
  test("`Hash` hashes the declaration index and agrees with `Eq`", async () => {
    const exports = await runMain(
      "export extern enum Level derives (Eq, Hash) = 2 as Low | 1 as High\n" +
        "export extern enum Other derives (Eq, Hash) = \"x\" as First | \"y\" as Second\n" +
        "export let a(): Int = Hash.hash(Low)\n" +
        "export let b(): Int = Hash.hash(Low)\n" +
        "export let c(): Int = Hash.hash(High)\n" +
        "export let d(): Int = Hash.hash(First)\n",
    );
    const hash = (name: string) => (exports[name] as () => number)();
    expect(hash("a")).toBe(hash("b"));
    expect(hash("a")).not.toBe(hash("c"));
    // Position, not payload: `Low` holds `2` and `First` holds `"x"`, and both
    // are the first member of their declaration.
    expect(hash("a")).toBe(hash("d"));
  });

  /** A derived instance travels as any union's does. */
  test("a derived instance is usable abroad", async () => {
    const exports = await runProject([
      ["/bindings.hex",
        "export extern enum Direction derives (Eq, Show) = \"up\" as Up | \"down\" as Down\n"],
      ["/main.hex",
        "import Bindings from \"./bindings\"\n" +
          "export let shown(): String = show(Bindings.Down)\n" +
          "export let equal(): Bool = Bindings.Up == Bindings.Up\n"],
    ]);
    expect((exports["shown"] as () => string)()).toBe("Down");
    expect((exports["equal"] as () => boolean)()).toBe(true);
  });
});

describe("the TypeScript face (§7.2, §9 test 16)", () => {
  /**
   * §7.2: "**The literal form faces as the literal union its values spell**" —
   * and takes **no brand**: the values are known exactly, so the brand's opacity
   * has nothing to cover. The constructors and the conversions are typed by the
   * alias.
   */
  test("an exported enum faces as its literal union, with no brand", () => {
    const face = declarations(
      "export extern enum Direction = \"up\" as Up | \"down\" as Down\n",
    );
    expect(face).toContain('export type Direction = "up" | "down";');
    expect(face).toContain("export declare const Up: Direction;");
    expect(face).toContain("export declare const Down: Direction;");
    expect(face).toContain(
      "export declare function fromJsDirection(value: unknown): Option<Direction>;",
    );
    expect(face).toContain(
      "export declare function toJsDirection(value: Direction): unknown;",
    );
    expect(face).not.toContain("unique symbol");
    expect(face).not.toContain("Brand");
  });

  /** The mixed and nullish kinds face as TypeScript spells them. */
  test("boolean, integer and nullish members face as their own literals", () => {
    expect(declarations(TRI)).toContain(
      "export type Tri = true | false | null | undefined;",
    );
    expect(declarations("export extern enum Level = 0 as Low | 1 as High\n"))
      .toContain("export type Level = 0 | 1;");
  });

  /** Modules §11.4: a private enum publishes no line of any kind. */
  test("a private enum faces nothing", () => {
    const face = declarations(
      "extern enum Direction = \"up\" as Up\n" +
        "export let go(): String =\n" +
        "    match Up\n" +
        "        Up => \"u\"\n",
    );
    expect(face).not.toContain("Direction");
    expect(face).not.toContain("Up");
  });
});

describe("diagnostics (§2.4, §9 test 17)", () => {
  /** §2.4's closed list of literal kinds, refused in the section's own words. */
  const NOT_A_LITERAL =
    "a literal enum member is a string, integer, boolean, `null` or `undefined` literal";

  test("a float member is refused", () => {
    // §2.4's reason: `NaN` and signed zero separate `Object.is` from `===`, and
    // §4's `switch` lowering rests on the two agreeing.
    expect(projectDiagnostics("extern enum Bad = 1.5 as Half | 2 as Two\n"))
      .toEqual([NOT_A_LITERAL]);
  });

  test("an expression member is refused", () => {
    // The value's head parses; what follows it is not `as`, so the member was
    // the start of an expression.
    expect(projectDiagnostics("extern enum Bad = 1 + 1 as Two\n"))
      .toEqual([NOT_A_LITERAL]);
    // A bare name is no literal at all.
    expect(projectDiagnostics("extern enum Bad = \"a\" as A | b as B\n"))
      .toEqual([NOT_A_LITERAL]);
    // §2.4 names interpolation among the non-literals: its value is not known
    // at the declaration.
    expect(projectDiagnostics("extern enum Bad = \"a${b}\" as A\n"))
      .toEqual([NOT_A_LITERAL]);
  });

  /**
   * §2.4: "`as` is mandatory. Every value is written." The refusal has to reach
   * the slip it is *for*: an author who wrote both halves and dropped the word
   * between them — `"up" Up` — needs the sentence about `as`, not the one about
   * literals, because the value they wrote is a literal. That is also the case
   * that pins the rule: with `as` optional, `extern enum D = "up" Up` would
   * compile clean and every other test here would still pass.
   */
  test("a member with no `as` is refused", () => {
    const named = ["every literal enum member is named: `\"up\" as Up`"];
    expect(projectDiagnostics("extern enum Bad = \"a\"\n")).toEqual(named);
    expect(projectDiagnostics("extern enum Bad = \"a\" as A | \"b\"\n")).toEqual(named);
    // The name is present and only `as` is missing — for each literal kind that
    // can be followed by a name.
    expect(projectDiagnostics("extern enum Bad = \"up\" Up | \"down\" as Down\n"))
      .toEqual(named);
    expect(projectDiagnostics("extern enum Bad = 1 One\n")).toEqual(named);
    expect(projectDiagnostics("extern enum Bad = null Nil\n")).toEqual(named);
    expect(projectDiagnostics("extern enum Bad = true Yes\n")).toEqual(named);
  });

  /** §2.4/§3 rule 5: the values are pairwise distinct under `Object.is`. */
  test("a duplicate value is refused, naming both members", () => {
    expect(projectDiagnostics("extern enum Bad = \"a\" as A | \"a\" as B\n"))
      .toEqual([
        "`A` already names this value; a literal enum's members are distinct " +
        "under `Object.is`",
      ]);
    // §2.4: "`-0` denotes `0`, so `0 as A | -0 as B` is the duplicate-value
    // refusal, and no signed zero ever reaches §4's `switch`."
    expect(projectDiagnostics("extern enum Bad = 0 as A | -0 as B\n"))
      .toEqual([
        "`A` already names this value; a literal enum's members are distinct " +
        "under `Object.is`",
      ]);
  });

  /**
   * The kinds are part of the identity, as they are for `Object.is`: `"1"` and
   * `1` are two values, and so are `0` and `false`.
   */
  test("values of different kinds are distinct", () => {
    expect(projectDiagnostics(
      "export extern enum Fine = \"1\" as Text | 1 as Number | false as Off | 0 as Zero\n",
    )).toEqual([]);
  });

  /** §2.2's duplicate-constructor rule, unchanged. */
  test("a repeated local constructor is refused", () => {
    expect(projectDiagnostics("extern enum Bad = \"a\" as A | \"b\" as A\n"))
      .toEqual(["duplicate constructor `A`"]);
  });

  /** §2.2: local constructor names must be uppercase-start. */
  test("a non-uppercase member name is refused", () => {
    expect(projectDiagnostics("extern enum Bad = \"a\" as a\n"))
      .toEqual(["union constructors must be uppercase-start names"]);
  });

  /** §2.1: "The body permits nullary members only." */
  test("a payload slot is refused", () => {
    expect(projectDiagnostics("extern enum Bad = \"a\" as A(Int)\n"))
      .toEqual([
        "foreign enums contain stable values only; use `extern type` plus " +
        "explicit operations for structured foreign values",
      ]);
  });

  /** §2.1: "Foreign enum declarations are monomorphic." */
  test("a type-parameter list is refused", () => {
    expect(projectDiagnostics("extern enum Bad(a) = \"a\" as A\n"))
      .toEqual(["a foreign enum is monomorphic; `extern enum` takes no type parameters"]);
  });

  /**
   * The head still needs a name, and an uppercase-start one — under `export`
   * too, which is why `#atExternEnumHead` reads two tokens and not three: a
   * three-token test would hand `export extern enum` to `export`'s own "must be
   * followed by a declaration", which is not the fault.
   */
  test("a missing or mis-cased type name is refused", () => {
    const named = ["`extern enum` requires an uppercase type name"];
    expect(projectDiagnostics("extern enum = \"a\" as A\n")).toEqual(named);
    expect(projectDiagnostics("extern enum direction = \"a\" as A\n")).toEqual(named);
    expect(projectDiagnostics("extern enum\n")).toEqual(named);
    expect(projectDiagnostics("export extern enum\n")).toEqual(named);
    expect(projectDiagnostics("export extern enum = \"a\" as A\n")).toEqual(named);
  });

  /**
   * §2.4: "A `from`-less `extern` block is not a spelling: the head is `extern
   * enum`, or `extern from` with an enum read inside it." The `extern` head's
   * three continuations are named in one sentence.
   */
  test("a `from`-less `extern` block is refused", () => {
    expect(projectDiagnostics("extern\n    fun f(): Int\n"))
      .toEqual(["expected `from`, `import` or `enum` after `extern`"]);
  });

  /**
   * The two forms are told apart by where the values come from, and the block
   * **reads** them (§2.4, §9 test 17). A literal written in a member's place is
   * therefore the module-scope head put inside a block, and the rewrite is that
   * head. The object-reading form the block does admit is #779's, pinned in
   * `extern-enum-object.test.ts`.
   */
  test("a literal member inside an `extern from` block is refused", () => {
    expect(projectDiagnostics("extern from \"x\"\n    enum E = \"a\" as A\n"))
      .toEqual([
        "an `extern from` block reads members, never writes them — a literal enum is " +
        'the module-scope form `extern enum T = "up" as Up`',
      ]);
  });

  /** A head with no members at all. */
  test("a declaration with no members is refused", () => {
    expect(projectDiagnostics("extern enum Bad =\n"))
      .toEqual(["a literal enum needs at least one member"]);
  });

  /**
   * §2.4's head has one visibility slot and `export` is the only thing that
   * fills it: a foreign enum's representation is its declaration, so there is
   * nothing for `opaque` to hide. `export opaque` draws the ordinary
   * two-subjects refusal and the declaration below it is still read, which is
   * why the members do not cascade.
   */
  test("`opaque` does not apply to the head", () => {
    expect(projectDiagnostics("export opaque extern enum Bad = \"a\" as A\n"))
      .toEqual(["`opaque` applies to `record` and `union` declarations"]);
  });

  /** The head stands at module level, like every other `extern`. */
  test("the head is refused below module level", () => {
    expect(projectDiagnostics(
      "export let f(): Int =\n    extern enum Bad = \"a\" as A\n    1\n",
    )).toEqual(["foreign declarations are made at module level"]);
  });
});

describe("`true` and `false` in member position (Lexer §4.1)", () => {
  /**
   * §4.1's exception, added by #773: "As the member value of a literal `extern
   * enum`… the parser reads the keyword as the JavaScript boolean the member
   * names, and no redirect fires."
   */
  test("the redirect does not fire on a member value", () => {
    expect(projectDiagnostics(
      "export extern enum Flag = true as On | false as Off\n",
    )).toEqual([]);
  });

  /** And it still fires everywhere else — value position and binder alike. */
  test("the redirect still fires in value and binder position", () => {
    expect(projectDiagnostics("export let flag: Bool = true\n")).toEqual([
      "`true` is reserved; Bool's constructors are `True` and `False` — write `True`",
    ]);
    expect(projectDiagnostics("export let true = 1\n")).toEqual([
      "`true` is reserved and cannot be used as a name",
    ]);
  });
});
