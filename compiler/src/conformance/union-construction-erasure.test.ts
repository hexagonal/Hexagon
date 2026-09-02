import { describe, expect, test } from "vitest";

import { emitJavaScript } from "../passes/emitter/emitter.js";
import type * as Core from "../syntax/core/index.js";
import type * as Resolved from "../syntax/resolved/index.js";
import { compileFiles, runProject } from "../support/test-project.js";

/**
 * Conformance for **#770** — a union construction erases into its object
 * literal at every seat, and a constructor's *function* is materialised only
 * where something demands one.
 *
 * Two rules, one arc. Unions §6.4 and Products §5.4 have said the first since
 * they were written ("never a function call"); the emitter kept a materialised
 * function and called it at every union seat, which is the gap this closes. The
 * second is the ruling's other half: the function exists at the two demand
 * sites — a constructor **referenced as a value**, and the **export** FFI Part 7
 * §3/§4 make mandatory — and nowhere else.
 *
 * What is *not* touched, and is pinned here so it stays that way: nullary
 * constructors of a mixed union (§6.1's shared constant), unions whose
 * constructors are all nullary (§6.2), the `Bool` pin (#147), and the `.d.ts`
 * face, which describes the type rather than the emitted binding.
 *
 * A nullary constructor is a **value**, whatever shape §6.2 gives it — and #771
 * changed that shape, retiring the bare-string form for §6.1's tagged object.
 * Nothing below pins that shape: what these pin is the property this arc owns,
 * that a nullary construction is a *read* and never an application to erase,
 * which is true on either side of #771.
 */

/** The emitted JavaScript of one module. */
function emitted(
  files: readonly (readonly [string, string])[],
  path = "/main.hex",
): string {
  const project = compileFiles(files as never);
  expect(project.diagnostics.map(({ message }) => message)).toEqual([]);
  return project.modules.find(({ source }) => source.path === path)!.javascript.text;
}

/** The emitted `.d.ts` of one module. */
function declarations(
  files: readonly (readonly [string, string])[],
  path = "/main.hex",
): string {
  const project = compileFiles(files as never);
  return project.modules.find(({ source }) => source.path === path)!.declarations.text;
}

/** How many times `needle` occurs in `text`. */
function occurrences(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

const SHAPE = [
  "/shape.hex",
  "export union Shape =\n" +
  "    | Circle(radius: Float)\n" +
  "    | Rect(width: Float, height: Float)\n" +
  "    | Point\n",
] as const;

const TREE = [
  "/tree.hex",
  "export union Tree = Node(Int, Int, Int) | Leaf\n",
] as const;

describe("§6.1's literal, at the home seat", () => {
  test("one named slot, two named slots, and unnamed slots as `item1…itemN`", () => {
    const javascript = emitted([
      SHAPE,
      TREE,
      ["/main.hex",
        'import Shape from "./shape"\n' +
        'import Tree from "./tree"\n' +
        "export let one: Shape.Shape = Shape.Circle(2.0)\n" +
        "export let two: Shape.Shape = Shape.Rect(3.0, 4.0)\n" +
        "export let three: Tree.Tree = Tree.Node(1, 2, 3)\n"],
    ]);
    expect(javascript).toContain('const one = { tag: "Circle", radius: 2.0 };');
    expect(javascript).toContain('const two = { tag: "Rect", width: 3.0, height: 4.0 };');
    expect(javascript).toContain(
      'const three = { tag: "Node", item1: 1, item2: 2, item3: 3 };',
    );
  });

  test("a field whose value is the same identifier takes shorthand", () => {
    // The general JavaScript-output rule §6.4 names, reached through the same
    // helper a record literal reaches it through — so the two forms agree
    // without either one restating the rule.
    expect(emitted([[
      "/main.hex",
      "union Shape = Circle(radius: Float)\n" +
      "let radius: Float = 5.0\n" +
      "export let one: Float = radius\n" +
      "fun make(): Shape = Circle(radius)\n" +
      "export let two: Float = one\n",
    ]])).toContain('return { tag: "Circle", radius };');
  });

  test("a nullary constructor of a mixed union is still the shared constant", async () => {
    const javascript = emitted([[
      "/main.hex",
      "export union Shape = Circle(radius: Float) | Point\n" +
      "export let flat: Shape = Point\n",
    ]]);
    expect(javascript).toContain('const Point = { tag: "Point" };');
    expect(javascript).toContain("const flat = Point;");
    const main = await runProject([[
      "/main.hex",
      "export union Shape = Circle(radius: Float) | Point\n" +
      "export let flat: Shape = Point\n",
    ]] as never);
    expect(main["flat"]).toEqual({ tag: "Point" });
  });

  test("a generic nullary constructor is still the one shared constant", () => {
    const javascript = emitted([[
      "/main.hex",
      "export let nothing: Option(Int) = None\n",
    ]]);
    expect(javascript).toContain('import { None } from "./Option.js";');
    expect(javascript).toContain("const nothing = None;");
  });

  test("an all-nullary constructor is read, not erased; `Bool` keeps its pin", () => {
    const javascript = emitted([[
      "/main.hex",
      "export union Colour = Red | Green | Blue\n" +
      "export let c: Colour = Red\n" +
      "export let yes: Bool = True\n",
    ]]);
    // The construction is a read of the shared constant the declaration bound,
    // whatever §6.2 makes that constant (#771 is changing it, and this pin
    // survives either answer because it names neither).
    expect(javascript).toContain("const c = Red;");
    expect(javascript).toMatch(/^const Red = .+;$/mu);
    // `Bool`'s pin is a representation commitment to one prelude declaration
    // and is unaffected by either arc (#147).
    expect(javascript).toContain("const yes = true;");
  });
});

describe("the same literal abroad, and through rule 3", () => {
  test("a qualified application erases; the nullary stays a qualified read", () => {
    const javascript = emitted([
      SHAPE,
      ["/main.hex",
        'import Shape from "./shape"\n' +
        "export let one: Shape.Shape = Shape.Circle(2.0)\n" +
        "export let flat: Shape.Shape = Shape.Point\n"],
    ]);
    expect(javascript).toContain('const one = { tag: "Circle", radius: 2.0 };');
    expect(javascript).toContain("const flat = Shape.Point;");
    expect(javascript).not.toContain("Shape.Circle(");
  });

  test("rule 3's bare constructor erases, and its value reference keeps the path", async () => {
    // Modules §13(k), both arms in one program. The construction names nothing;
    // the reference names the alias's qualified local, and calling it at run
    // time builds the same value the literal does.
    const files = [
      ["/tag.hex", "export union Tag = Tag(n: Int) | Other\n"],
      ["/main.hex",
        'import Tag from "./tag"\n' +
        "export let t: Tag.Tag = Tag(7)\n" +
        "export let mk: (Int) -> Tag.Tag = Tag\n"],
    ] as const;
    const javascript = emitted(files);
    expect(javascript).toContain('import * as Tag from "./tag.js";');
    expect(javascript).toContain('const t = { tag: "Tag", n: 7 };');
    expect(javascript).toContain("const mk = Tag.Tag;");
    expect(javascript).not.toContain("Tag(7)");

    const main = await runProject(files as never);
    expect(main["t"]).toEqual({ tag: "Tag", n: 7 });
    expect((main["mk"] as (n: number) => unknown)(7)).toEqual({ tag: "Tag", n: 7 });
  });
});

describe("the seats an object literal needs handling at", () => {
  test("arrow body, statement, scrutinee, argument, record field, and `==`", async () => {
    const source =
      "export union Shape derives Eq =\n" +
      "    | Circle(radius: Float)\n" +
      "    | Point\n" +
      "export record Holder = {shape: Shape}\n" +
      "fun scrutinizeOne(s: Shape): Float =\n" +
      "    match s\n" +
      "        Circle(r) => r\n" +
      "        Point => 0.0\n" +
      "export fun body(): (Float) -> Shape = (r: Float): Shape => Circle(r)\n" +
      "export fun statement(): Int =\n" +
      "    ignore(Circle(1.0))\n" +
      "    7\n" +
      "export fun scrutinee(): Float =\n" +
      "    match Circle(3.0)\n" +
      "        Circle(r) => r\n" +
      "        Point => 0.0\n" +
      "export fun argument(): Float = scrutinizeOne(Circle(4.0))\n" +
      "export let field: Holder = Holder({shape = Circle(5.0)})\n" +
      "export let same: Bool = Circle(6.0) == Circle(6.0)\n" +
      "export let differ: Bool = Circle(6.0) == Point\n";
    const javascript = emitted([["/main.hex", source]]);

    // The arrow body: a concise body starting with `{` is a block to
    // JavaScript, so the literal is parenthesized — the same repair a record
    // construction in that seat has always taken.
    expect(javascript).toContain('return r => ({ tag: "Circle", radius: r });');
    // Statement position: `{` at the head of a statement opens a block, so the
    // discarded construction is parenthesized — the repair the emitter already
    // made for a record literal in the same seat.
    expect(javascript).toContain('({ tag: "Circle", radius: 1.0 });');
    expect(javascript).toContain('const __match_1 = { tag: "Circle", radius: 3.0 };');
    expect(javascript).toContain('scrutinizeOne({ tag: "Circle", radius: 4.0 })');
    expect(javascript).toContain('const field = { shape: { tag: "Circle", radius: 5.0 } };');

    const main = await runProject([["/main.hex", source]] as never);
    expect(main["statement"]).toBeTypeOf("function");
    expect((main["statement"] as () => number)()).toBe(7);
    expect((main["scrutinee"] as () => number)()).toBe(3.0);
    expect((main["argument"] as () => number)()).toBe(4.0);
    expect((main["body"] as () => (r: number) => unknown)()(9.0))
      .toEqual({ tag: "Circle", radius: 9.0 });
    // Structural equality sees no difference between two erased literals.
    expect(main["same"]).toBe(true);
    expect(main["differ"]).toBe(false);
  });

  test("nested constructions erase recursively", async () => {
    const source = "export let deep: Option(Option(Int)) = Some(Some(1))\n";
    expect(emitted([["/main.hex", source]])).toContain(
      'const deep = { tag: "Some", value: { tag: "Some", value: 1 } };',
    );
    const main = await runProject([["/main.hex", source]] as never);
    expect(main["deep"]).toEqual({ tag: "Some", value: { tag: "Some", value: 1 } });
  });
});

describe("the two demand sites, and nothing else", () => {
  test("a private constructor only ever applied materialises no function", () => {
    const javascript = emitted([[
      "/main.hex",
      "union Shape = Circle(radius: Float) | Point\n" +
      "export fun area(): Float =\n" +
      "    match Circle(2.0)\n" +
      "        Circle(r) => r\n" +
      "        Point => 0.0\n",
    ]]);
    expect(javascript).not.toContain("const Circle =");
    expect(javascript).toContain('const Point = { tag: "Point" };');
    expect(javascript).toContain('{ tag: "Circle", radius: 2.0 }');
  });

  test("one value reference is all the demand there is: exactly one line", async () => {
    // `Seq.map` takes the constructor as a value, so the function has to exist;
    // the direct application beside it still erases, and the two agree at run
    // time because the function builds what the literal is.
    const source =
      "export union Shape derives Eq = Circle(radius: Float) | Point\n" +
      "export let mapped: Seq(Shape) = Seq.map(Seq.singleton(2.0), Circle)\n" +
      "export let direct: Shape = Circle(2.0)\n" +
      "export let agree: Bool =\n" +
      "    match Seq.next(mapped)\n" +
      "        Some((s, _)) => s == direct\n" +
      "        None => False\n";
    const javascript = emitted([["/main.hex", source]]);
    expect(occurrences(javascript, "const Circle = ")).toBe(1);
    expect(javascript).toContain('const Circle = radius => ({ tag: "Circle", radius });');
    expect(javascript).toContain('const direct = { tag: "Circle", radius: 2.0 };');

    const main = await runProject([["/main.hex", source]] as never);
    expect(main["agree"]).toBe(true);
  });

  test("a record constructor reads the same way, on both sides", () => {
    const applied = emitted([[
      "/main.hex",
      "record Point = {x: Float, y: Float}\n" +
      "export let n: Float = Point({x = 1.0, y = 2.0}).x\n",
    ]]);
    expect(applied).not.toContain("const Point = __record => __record;");
    expect(applied).toContain("const n = { x: 1.0, y: 2.0 }.x;");

    const referenced = emitted([[
      "/main.hex",
      "record Point = {x: Float, y: Float}\n" +
      "fun build(make: ({x: Float, y: Float}) -> Point): Point = make({x = 1.0, y = 2.0})\n" +
      "export let n: Float = build(Point).x\n",
    ]]);
    expect(occurrences(referenced, "const Point = __record => __record;")).toBe(1);
  });

  test("export is the other demand site, with no reference anywhere", async () => {
    const source =
      "export union Shape = Circle(radius: Float) | Point\n" +
      "export let inside: Shape = Circle(2.0)\n";
    const javascript = emitted([["/main.hex", source]]);
    // The export materialises the function and publishes it; the module's own
    // application still erases (FFI Part 7 §4, §12.2).
    expect(javascript).toContain('const Circle = radius => ({ tag: "Circle", radius });');
    expect(javascript).toContain("export { Circle };");
    expect(javascript).toContain('const inside = { tag: "Circle", radius: 2.0 };');
    // And the published function is a real ESM export a consumer can call.
    const main = await runProject([["/main.hex", source]] as never);
    expect((main["Circle"] as (r: number) => unknown)(2.0))
      .toEqual({ tag: "Circle", radius: 2.0 });
    expect(main["inside"]).toEqual({ tag: "Circle", radius: 2.0 });
  });

  test("an exported record's constructor is materialised the same way", () => {
    const javascript = emitted([[
      "/main.hex",
      "export record Point = {x: Float, y: Float}\n" +
      "export let p: Point = Point({x = 1.0, y = 2.0})\n",
    ]]);
    expect(javascript).toContain("const Point = __record => __record;");
    expect(javascript).toContain("export { Point };");
    expect(javascript).toContain("const p = { x: 1.0, y: 2.0 };");
  });

  test("`opaque union` exports the type alone and materialises nothing", () => {
    const files = [[
      "/main.hex",
      "opaque union Shape = Circle(radius: Float) | Point\n" +
      "export fun radius(s: Shape): Float =\n" +
      "    match s\n" +
      "        Circle(r) => r\n" +
      "        Point => 0.0\n" +
      "export let n: Float = radius(Circle(2.0))\n",
    ]] as const;
    const javascript = emitted(files);
    expect(javascript).not.toContain("const Circle =");
    expect(javascript).not.toContain("export { Circle };");
    expect(javascript).toContain('radius({ tag: "Circle", radius: 2.0 })');
    // The nullary constant is a value the body reads, so it stays — it is not
    // exported either.
    expect(javascript).toContain('const Point = { tag: "Point" };');
    expect(javascript).not.toContain("export { Point };");
    // §5's brand-only face: the type crosses, the constructors do not.
    expect(declarations(files)).not.toContain("Circle");
  });
});

describe("the two passes agree", () => {
  /** Every constructor symbol this module declares a function seat for. */
  function everyConstructor(module: Core.Module): ReadonlySet<Resolved.SymbolId> {
    return new Set([
      ...module.unions.flatMap(({ constructors }) =>
        constructors.map(({ symbol }) => symbol)
      ),
      ...module.records.map(({ constructor }) => constructor.symbol),
    ]);
  }

  test("forcing the second pass to run changes nothing it did not have to", () => {
    // The property that makes the discovery pass safe to build on: it leaves no
    // residue in the pass that ships. A module where every constructor is
    // demanded takes one pass; handing that same module the demand set it would
    // have computed forces the *second* pass to run, and the text has to come
    // out byte-identical — otherwise something rendering did on the first pass
    // would be leaking into the second's decisions.
    //
    // Measured across all 34 `stdlib/` and 2 `runtime/` modules when this
    // landed — forcing the second pass everywhere left every one of them
    // byte-identical — and one module here keeps it honest per commit.
    //
    // Only `materializedConstructors` is passed, because this source needs no
    // other option. A source that grew one — a runtime location, a
    // runtime-globals specifier — would make the forced pass differ from
    // `module.javascript` and fail here loudly, which is the right way round;
    // pass the rest of `module`'s options alongside if that day comes.
    const source =
      "export union Shape = Circle(radius: Float) | Point\n" +
      "export record Holder = {shape: Shape}\n" +
      "export let one: Shape = Circle(2.0)\n" +
      "export let two: (Float) -> Shape = Circle\n" +
      "export let three: Holder = Holder({shape = Point})\n";
    const module = compileFiles([["/main.hex", source]] as never)
      .modules.find(({ source: file }) => file.path === "/main.hex")!;

    const onePass = module.javascript.text;
    const forced = emitJavaScript(module.core, {
      materializedConstructors: everyConstructor(module.core),
    }).text;
    expect(forced).toBe(onePass);
    // And the module really does materialise everything, so `forced` is the
    // second pass rather than the first one under another name.
    expect(onePass).toContain('const Circle = radius => ({ tag: "Circle", radius });');
    expect(onePass).toContain("const Holder = __record => __record;");
  });
});

describe("a declaration that emits nothing shapes none of the page", () => {
  /**
   * The rule this pins is the emitter's, not the ruling's: an entry that emits
   * nothing is skipped when the vertical rhythm is measured, and it caps the
   * gap it left at one blank line. #770 is what made it reachable at a
   * *declaration* — before this arc every `union` and `record` emitted a line —
   * so the pins live here with the arc that needs them.
   */

  test("two comment blocks a vanished declaration stood between keep their blank line", () => {
    // The shape that fails when the skip is narrowed to declarations, reduced
    // from the two modules it was found in — the emitted `runtime/HashTrie.js`
    // and `runtime/VectorTrie.js`, where two unrelated comment blocks came out
    // welded into one.
    //
    // `a.div(b)` is what arms it. A concrete dot call registers a *candidate*
    // prelude term that the emitter then routes to `Int`'s member seat instead,
    // so the synthesized prelude import item exists and every one of its names
    // is filtered out (#263) — a zero-line `Import` entry. The resolver builds
    // that item from `module.span`, so its span runs from the module's first
    // token to its last: leaving it in the measurement puts `previousSpan` at
    // the foot of the module and makes every following gap compute as zero.
    // Skipping every zero-line entry, not only the vanished declaration, is
    // what keeps `previousSpan` on a line the output contains.
    expect(emitted([[
      "/main.hex",
      "// first block, about the declaration below\n" +
      "union Shape = Circle(radius: Float) | Rect(width: Float, height: Float)\n" +
      "\n" +
      "// second block, about something else entirely\n" +
      "export fun area(): Float =\n" +
      "    match Circle(2.0)\n" +
      "        Circle(r) => r\n" +
      "        Rect(w, h) => w\n" +
      "export fun half(a: Int, b: Int): Int = a.div(b)\n",
    ]])).toContain(
      "// first block, about the declaration below\n" +
      "\n" +
      "// second block, about something else entirely\n",
    );
  });

  test("a vanished union leaves one blank line, and later runs are left alone", () => {
    // Two properties, because the cap is per-gap and nothing else says so. The
    // `before`/`mid` gap is the one the vanished union stood in and is capped
    // to a single blank; the `mid`/`after` gap has no vanished entry in it and
    // keeps all three blank lines the source wrote. Making the cap *sticky* —
    // dropping the `collapsed = false` reset — leaves the first assertion green
    // and silently flattens every later gap in the module, which on the shipped
    // standard library removes several hundred blank lines.
    const javascript = emitted([[
      "/main.hex",
      "export let before: Int = 1\n\n\n\n" +
      "union Shape = Circle(radius: Float) | Rect(width: Float, height: Float)\n\n\n\n" +
      "export let mid: Int = 2\n\n\n\n" +
      "export let after: Int = 3\n\n\n\n" +
      "export fun area(): Float =\n" +
      "    match Circle(2.0)\n" +
      "        Circle(r) => r\n" +
      "        Rect(w, h) => w\n",
    ]]);
    expect(javascript).toContain("const before = 1;\n\nconst mid = 2;");
    expect(javascript).toContain("const mid = 2;\n\n\n\nconst after = 3;");
    expect(javascript).toContain("const after = 3;\n\n\n\nfunction area() {");
  });

  test("a vanished record leaves exactly one blank line too", () => {
    expect(emitted([[
      "/main.hex",
      "export let before: Int = 1\n\n\n\n" +
      "record Box = {n: Int}\n\n\n\n" +
      "export let after: Int = Box({n = 2}).n\n",
    ]])).toContain("const before = 1;\n\nconst after = { n: 2 }.n;");
  });

  test("the same cap collapses a run an entry that predates #770 stood in", () => {
    // A `type` alias has emitted nothing since long before this arc, and its
    // source span shaped the gap around it — a run of blank lines no source
    // wrote. The general rule owns that case too, which is a cosmetic
    // improvement to shipped output rather than anything the ruling asked for;
    // `stdlib/JsError.js` and `stdlib/JsValue.js` each carried nine consecutive
    // blank lines of it. It does not reach every such run: a `honor` block's is
    // untouched, because `Honor` items are filtered out before this loop sees
    // them (`stdlib/Int.js` still ships a 96-line run for that reason).
    expect(emitted([[
      "/main.hex",
      "export let before: Int = 1\n\n\n\n" +
      "type Alias = Int\n\n\n\n" +
      "export let after: Alias = 2\n",
    ]])).toContain("const before = 1;\n\nconst after = 2;");
  });
});

describe("the `.d.ts` face is unchanged by any of it", () => {
  test("an exported union still declares every constructor", () => {
    expect(declarations([[
      "/main.hex",
      "export union Shape = Circle(radius: Float) | Point\n",
    ]])).toBe(
      'export type Shape = { tag: "Circle"; radius: number } | { tag: "Point" };\n' +
      "export declare const Circle: (radius: number) => Shape;\n" +
      "export declare const Point: Shape;\n",
    );
  });
});
