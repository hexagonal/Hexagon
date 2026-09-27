import { describe, expect, test } from "vitest";

import { compileProject, Source } from "../index";
import { INTRINSIC_INVENTORY } from "../intrinsics";
import { STDLIB_SOURCES } from "../stdlib-sources";
import { compileFiles, runMain } from "../support/test-project.js";

/**
 * Conformance for #1141, the domestic `Iterable` slice: `Vector`, `Map` and
 * `Set` honor `Iterable` in their own companions, over the traversals each
 * already declared, and `Seq`'s identity row is written in `Iterable.hex`, the
 * constraint's home, because `Seq.hex` seats before the constraint exists
 * (Collections Part 5 §4). With them the compiler provides no `Iterable` row at
 * all, and every standard instance is source.
 *
 * Elsewhere: the one-report orphan rule at every row is
 * `iterable-module.test.ts`'s (§7.3, #1131); the foreign three are
 * `foreign-type-rows.test.ts`'s.
 */

function compiled(source: string) {
  const project = compileFiles([["/main.hex", "module Main\n\n" + source]]);
  expect(project.diagnostics.map(({ message }) => message)).toEqual([]);
  return (path: string): string =>
    project.modules.find(({ source: file }) => file.path === path)!.javascript.text;
}

function diagnostics(source: string): readonly string[] {
  return compileFiles([["/main.hex", "module Main\n\n" + source]]).diagnostics
    .map(({ message }) => message);
}

/** A shipped module's own source with `extra` appended, compiled in its real seat. */
function inModule(name: string, extra: string, program: string): readonly string[] {
  return compileProject([
    new Source.File(Source.fileId(0), "/main.hex", "module Main\n\n" + program),
    new Source.File(Source.fileId(1), `/${name}.hex`, STDLIB_SOURCES[name]! + extra),
  ], { trustedStandardLibraryModules: new Set([name]) }).diagnostics
    .map(({ message }) => message);
}

describe("the rows are source", () => {
  test.each([
    ["Vector", "honor Iterable<Vector(a)> =\n    type Item = a\n    toSeq(values) = elements(values)\n"],
    ["Map", "honor Iterable<Map(k, v)> =\n    type Item = (k, v)\n    toSeq(map) = entries(map)\n"],
    ["Set", "honor Iterable<Set(a)> =\n    type Item = a\n    toSeq(s) = elements(s)\n"],
    ["Iterable", "honor Iterable<Seq(a)> =\n    type Item = a\n    toSeq(s) = s\n"],
  ])("`%s.hex` writes the row", (module, honor) => {
    expect(STDLIB_SOURCES[module]).toContain(honor);
  });

  /**
   * Each body is a traversal the companion already had. `Vector`'s and `Set`'s
   * stay unexported under their own names, which is what keeps `toSeq` the
   * member's spelling alone (Constraints §4.6); `Map`'s is the exported
   * `entries`, so `toSeq ≡ entries` (Part 4 §7.2) holds by construction.
   */
  test.each([
    ["vectorToSeq", "Vector", "fun vectorToSeq as elements(values: Vector(a)) -> Seq(a)", false],
    ["setElements", "Set", "fun setElements as elements(s: Set(a)) -> Seq(a)", false],
    ["mapEntries", "Map", "fun mapEntries as entries(map: Map(k, v)) -> Seq((k, v))", true],
  ])("`%s` is the body's door in `Hex.%s`", (key, module, row, exported) => {
    expect(INTRINSIC_INVENTORY.get(key)).toEqual({ grade: "operation", arity: 1 });
    expect(STDLIB_SOURCES[module]).toContain(`    ${exported ? "export " : ""}${row}\n`);
  });
});

describe("every spelling of the walk reaches the member", () => {
  test("the member, the dot call, the constraint's own spelling, and `entries`", async () => {
    const main = await runMain(
      "module Main\n\n" +
        "let v: Vector(Int) = [3, 1, 2]\n" +
        "let m: Map(String, Int) = Map.fromVector([(\"b\", 2), (\"a\", 1)])\n" +
        "let s: Set(Int) = Set.fromVector([5, 4, 5])\n" +
        "let q: Seq(Int) = Seq.prepend(Seq.prepend(Seq.empty, 8), 9)\n" +
        "let all(xs: Seq(a)): Vector(a) = Vector.fromSeq(xs)\n" +
        "export let vs(): Vector(Vector(Int)) = [all(Vector.toSeq(v)), all(v.toSeq()), all(Iterable.toSeq(v))]\n" +
        "export let ms(): Vector(Vector((String, Int))) =\n" +
        "    [all(Map.toSeq(m)), all(m.toSeq()), all(Iterable.toSeq(m)), all(Map.entries(m))]\n" +
        "export let ss(): Vector(Vector(Int)) = [all(Set.toSeq(s)), all(s.toSeq()), all(Iterable.toSeq(s))]\n" +
        "export let qs(): Vector(Vector(Int)) = [all(q.toSeq()), all(Iterable.toSeq(q))]\n",
    );
    const read = (name: string): unknown[][] =>
      [...(main[name] as () => Iterable<Iterable<unknown>>)()].map((row) => [...row]);
    expect(read("vs")).toEqual([[3, 1, 2], [3, 1, 2], [3, 1, 2]]);
    const [map, ...maps] = read("ms");
    expect(new Set(map!.map((pair) => JSON.stringify(pair)))).toEqual(new Set(['["b",2]', '["a",1]']));
    for (const other of maps) expect(other).toEqual(map);
    const [set, ...sets] = read("ss");
    expect(new Set(set)).toEqual(new Set([4, 5]));
    for (const other of sets) expect(other).toEqual(set);
    expect(read("qs")).toEqual([[9, 8], [9, 8]]);
  });

  /**
   * The qualified read is Modules §5.3's honored member at the companion, and a
   * bare head's variable is fresh at each read (#1142's fix), so one module may
   * read it at two element types.
   */
  test("a qualified read is fresh at each use", () => {
    expect(diagnostics(
      "export let a: Int = Vector.toSeq([1, 2]).length()\n" +
        "export let b: Int = Vector.toSeq([\"x\"]).length()\n" +
        "export let c: Int = Map.toSeq(Map.singleton(1, \"x\")).length()\n" +
        "export let d: Int = Map.toSeq(Map.singleton(\"x\", 1)).length()\n",
    )).toEqual([]);
  });
});

describe("the walk is the one the loop takes", () => {
  /**
   * A `Map`'s or `Set`'s own JavaScript iterator — what `for (k, v) in m` and
   * `for x in s` drive — delegates to the runtime's `entries`/`members`, and
   * the rows' bodies are those same walks without the iterator between. So the
   * order is equal by construction, which is what this pins: a body that
   * walked anything else would disagree somewhere across a few hundred keys.
   */
  test("`toSeq` visits a map's and a set's elements in loop order", async () => {
    const main = await runMain(
      "module Main\n\n" +
        "let keys: Vector(Int) = Vector.fromSeq((1..300).toSeq().map((n) => Int.mod(n * 7919, 100003)))\n" +
        "let m: Map(Int, String) = Map.fromSeq(keys.toSeq().map((k) => (k, \"${k}\")))\n" +
        "let s: Set(String) = Set.fromSeq(keys.toSeq().map((k) => \"${k}\"))\n" +
        "let key(pair: (Int, String)): Int =\n" +
        "    let (k, _) = pair\n" +
        "    k\n" +
        "export let mapWalks(): (Vector(Int), Vector(Int), Vector(Int)) =\n" +
        "    var looped: Vector(Int) = []\n" +
        "    for (k, _) in m\n" +
        "        looped := looped.append(k)\n" +
        "    let walked = Vector.fromSeq(m.toSeq().map(key))\n" +
        "    let listed = Vector.fromSeq(Map.keys(m))\n" +
        "    (looped, walked, listed)\n" +
        "export let setWalks(): (Vector(String), Vector(String)) =\n" +
        "    var looped: Vector(String) = []\n" +
        "    for x in s\n" +
        "        looped := looped.append(x)\n" +
        "    (looped, Vector.fromSeq(s.toSeq()))\n",
    );
    const [looped, walked, listed] = (main["mapWalks"] as () => Iterable<unknown>[])().map((row) => [...row]);
    expect(looped).toHaveLength(300);
    expect(walked).toEqual(looped);
    expect(listed).toEqual(looped);
    const [setLooped, setWalked] = (main["setWalks"] as () => Iterable<unknown>[])().map((row) => [...row]);
    expect(setLooped).toHaveLength(300);
    expect(setWalked).toEqual(setLooped);
  });

  /** A `Seq` is persistent: walking a map's twice replays it rather than finding it spent. */
  test("a map's `toSeq` is re-traversable", async () => {
    const main = await runMain(
      "module Main\n\n" +
        "let addValue(total: Int, pair: (Int, Int)): Int =\n" +
        "    let (_, v) = pair\n" +
        "    total + v\n" +
        "export let twice(): Int =\n" +
        "    let pairs = Map.fromVector([(1, 10), (2, 20), (3, 30)]).toSeq()\n" +
        "    pairs.length() + pairs.fold(0, addValue)\n",
    );
    expect((main["twice"] as () => number)()).toBe(63);
  });
});

describe("emission", () => {
  /**
   * A `toSeq` call used to build a provided row's dictionary inline at every
   * use — `({ toSeq: __seqFromIterable })`, and `({ toSeq: __source =>
   * __source })` at a `Seq` — and now imports the companion's member, as
   * `Range`'s and `Array`'s do. The loops never consulted the rows and still
   * emit native `for…of`, with `for x in seq` the constant-stack driver.
   */
  test("a `toSeq` call imports the member; loops are unchanged", () => {
    const text = compiled(
      "export let a(v: Vector(Int)): Seq(Int) = v.toSeq()\n" +
        "export let b(m: Map(String, Int)): Seq((String, Int)) = Map.toSeq(m)\n" +
        "export let c(s: Set(Int)): Seq(Int) = s.toSeq()\n" +
        "export let d(q: Seq(Int)): Seq(Int) = Iterable.toSeq(q)\n" +
        "export let sum(v: Vector(Int), m: Map(String, Int), s: Set(Int), q: Seq(Int)): Int =\n" +
        "    var t = 0\n" +
        "    for x in v\n        t := t + x\n" +
        "    for (k, y) in m\n        t := t + y\n" +
        "    for x in s\n        t := t + x\n" +
        "    for x in q\n        t := t + x\n" +
        "    t\n",
    )("/main.hex");
    expect(text).toContain('import { __Iterable_Vector_toSeq } from "./Hex/Vector.js";');
    expect(text).toContain('import { __Iterable_Map_toSeq } from "./Hex/Map.js";');
    expect(text).toContain('import { __Iterable_Set_toSeq } from "./Hex/Set.js";');
    expect(text).toContain('import { __Iterable_Seq_toSeq } from "./Hex/Iterable.js";');
    expect(text).toContain("const a = v => __Iterable_Vector_toSeq(v);");
    expect(text).toContain("const b = m => __Iterable_Map_toSeq(m);");
    expect(text).toContain("const c = s => __Iterable_Set_toSeq(s);");
    expect(text).toContain("const d = q => __Iterable_Seq_toSeq(q);");
    expect(text).not.toContain("({ toSeq:");
    expect(text).toContain("for (const x of v) {");
    expect(text).toContain("for (const __item of m) {");
    expect(text).toContain("for (const x of s) {");
    expect(text).toContain("for (const x of __seqToIterable(q)) {");
  });

  /**
   * A loop alone never asks for the row, so a module that only loops over a
   * map or a set imports nothing from its companion (Vector's twin of this is
   * `iterable-module.test.ts`'s native-loop pin).
   */
  test("a lone map or set loop imports nothing from the companion", () => {
    const text = compiled(
      "export let total(m: Map(String, Int), s: Set(Int)): Int =\n" +
        "    var t = 0\n" +
        "    for (k, y) in m\n        t := t + y\n" +
        "    for x in s\n        t := t + x\n" +
        "    t\n",
    )("/main.hex");
    expect(text).not.toContain("./Hex/Map.js");
    expect(text).not.toContain("./Hex/Set.js");
    expect(text).not.toContain("./Hex/Iterable.js");
    expect(text).toContain("for (const __item of m) {");
    expect(text).toContain("for (const x of s) {");
  });

  /**
   * Each member is its door, and the doors are what they were: `Vector`'s the
   * inbound adapter over the vector's own traversal, `Map`'s and `Set`'s the
   * runtime's walks. `Seq`'s is the identity, so normalizing a sequence costs a
   * call and builds nothing.
   */
  test("each member is its companion's traversal", () => {
    const text = compiled(
      "export let a(v: Vector(Int)): Seq(Int) = v.toSeq()\n" +
        "export let b(m: Map(String, Int)): Seq((String, Int)) = m.toSeq()\n" +
        "export let c(s: Set(Int)): Seq(Int) = s.toSeq()\n" +
        "export let d(q: Seq(Int)): Seq(Int) = q.toSeq()\n",
    );
    expect(text("/Hex/Vector.hex")).toContain("const __Iterable_Vector_toSeq = values => elements(values);");
    expect(text("/Hex/Vector.hex")).toContain("const elements = __seqFromIterable;");
    expect(text("/Hex/Map.hex")).toContain("const __Iterable_Map_toSeq = map => entries(map);");
    expect(text("/Hex/Map.hex")).toMatch(/^const entries = __hashTrieEntries;$/mu);
    expect(text("/Hex/Set.hex")).toContain("const __Iterable_Set_toSeq = s => elements(s);");
    expect(text("/Hex/Set.hex")).toMatch(/^const elements = __hashTrieMembers;$/mu);
    expect(text("/Hex/Iterable.hex")).toContain("const __Iterable_Seq_toSeq = s => s;");
    for (const path of ["/Hex/Vector.hex", "/Hex/Set.hex"]) {
      expect(text(path)).not.toMatch(/export \{[^}]*\belements\b/u);
    }
  });
});

describe("`Seq`'s row, in `Iterable.hex`", () => {
  /**
   * Ruling D1 (2026-09-25): the row's home is the constraint's, and the one
   * spelling that costs is `Seq.toSeq(s)`, which resolved only through the
   * provided-row table. `Seq.hex` honors nothing, so the qualifier names a
   * module with no such member; the dot call and the constraint's own spelling
   * are unaffected, being reads of the instance wherever it is declared. The
   * refusal names both (James's ruling (b), 2026-09-28): it is the spelling a
   * reader reaches for by analogy with `Vector.toSeq`.
   */
  test("`Seq.toSeq` is refused, naming the two routes; both resolve", () => {
    expect(diagnostics("export let a(q: Seq(Int)): Seq(Int) = Seq.toSeq(q)\n")).toEqual([
      "`Seq` has no `toSeq` — its `Iterable` instance is declared in module " +
        "`Iterable`; use `Iterable.toSeq`, or call `toSeq` by the dot",
    ]);
    expect(diagnostics(
      "export let b(q: Seq(Int)): Seq(Int) = q.toSeq()\n" +
        "export let c(q: Seq(Int)): Seq(Int) = Iterable.toSeq(q)\n",
    )).toEqual([]);
  });

  /**
   * The hint is the prelude seat's, not the spelling's: a project's own
   * `module Seq` that lacks the member is refused plainly, and an alias of the
   * seated file keeps the hint.
   */
  test("the hint follows the seated module, not the name", () => {
    const own = compileFiles([
      ["/seq.hex", "module Seq\n\nexport let size: Int = 0\n"],
      ["/main.hex", "module Main\n\nimport Seq\n\nexport let n: Int = Seq.toSeq\n"],
    ]).diagnostics.map(({ message }) => message);
    expect(own).toContain("module `Seq` does not export `toSeq`");
    expect(own.join("\n")).not.toContain("has no `toSeq`");
    expect(diagnostics("import Hex.Seq as S\n\nexport let a(q: Seq(Int)): Seq(Int) = S.toSeq(q)\n"))
      .toEqual([
        "`Seq` has no `toSeq` — its `Iterable` instance is declared in module " +
          "`Iterable`; use `Iterable.toSeq`, or call `toSeq` by the dot",
      ]);
  });

  /**
   * The seed the row replaced sat in the same slot, and a hand-written row
   * there was **dropped without a diagnostic**: the orphan rule lifts in the
   * constraint's own module and `Seq` is a record, not a public kind. The seed
   * is gone, so a second row is the ordinary duplicate it looks like.
   */
  test("a second row in `Iterable.hex` is reported, not dropped", () => {
    const reported = inModule(
      "Iterable",
      "\nhonor Iterable<Seq(a)> =\n    type Item = a\n    toSeq(s) = s\n",
      "export let d(q: Seq(Int)): Seq(Int) = Iterable.toSeq(q)\n",
    );
    expect(new Set(reported)).toEqual(new Set(["duplicate instance of `Iterable<Seq(a)>`"]));
  });

  /** The loop never asks for the row (ruling R3), so it reaches no `Iterable.js`. */
  test("`for x in q` imports nothing from `Iterable.js`", () => {
    const text = compiled(
      "export let sum(q: Seq(Int)): Int =\n" +
        "    var t = 0\n" +
        "    for x in q\n        t := t + x\n" +
        "    t\n",
    )("/main.hex");
    expect(text).not.toContain("Iterable.js");
    expect(text).toContain("for (const x of __seqToIterable(q)) {");
  });
});
