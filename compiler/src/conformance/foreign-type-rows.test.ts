import { describe, expect, test } from "vitest";

import { compileProject, Source } from "../index";
import { INTRINSIC_INVENTORY } from "../intrinsics";
import { STDLIB_SOURCES } from "../stdlib-sources";
import { compileFiles, publicRowClaims, runMain } from "../support/test-project.js";
import { typeScriptErrors } from "../support/typescript-check.js";

/**
 * Conformance for #1076 and the foreign `Iterable` slice: `Array`, `JsMap`, and
 * `JsSet` are declared by their companions' **public** intrinsic `type` rows
 * (`spec/intrinsics.md` §3.3), as `Vector`, `Map`, and `Set` are (#1071). Each
 * row binds the name to the built-in kind its key names, and the companion is
 * then the type's home: it honors `Iterable` at it in source, over a private
 * traversal door, and the compiler's provided rows for the three are gone.
 *
 * `Array`'s row is seen earlier than the rest of `Array.hex`: `Vector.toArray`
 * names the type and `Array.toVector` builds a `Vector`, so the row takes a
 * data seat just before `Vector.hex` (Modules §5.5), as `Option`'s union does.
 *
 * Elsewhere: the faces stay TypeScript's read-only types
 * (`array-readonly-face.test.ts`, `js-map-set.test.ts`); the loop heads stay
 * native `for…of` (`array-capture.test.ts`, `js-map-set.test.ts`).
 */

function diagnostics(source: string): readonly string[] {
  return compileFiles([["/main.hex", "module Main\n\n" + source]]).diagnostics
    .map(({ message }) => message);
}

function javascript(source: string): string {
  const project = compileFiles([["/main.hex", "module Main\n\n" + source]]);
  expect(project.diagnostics.map(({ message }) => message)).toEqual([]);
  return project.modules.find(({ source: file }) => file.path === "/main.hex")!.javascript.text;
}

/** A program that reaches each companion's emitted module. */
const REACHES: Readonly<Record<string, string>> = {
  Array: "export let n(xs: Array(Int)): Seq(Int) = Array.toSeq(xs)\n",
  JsMap: "export let n(m: JsMap(Int, Int)): Seq((Int, Int)) = JsMap.toSeq(m)\n",
  JsSet: "export let n(s: JsSet(Int)): Seq(Int) = JsSet.toSeq(s)\n",
};

/** A shipped companion's own source with `extra` appended, compiled in its real seat. */
function inCompanion(companion: string, extra: string, program = REACHES[companion]!) {
  return compileProject([
    new Source.File(Source.fileId(0), "/main.hex", "module Main\n\n" + program),
    new Source.File(Source.fileId(1), `/${companion}.hex`, STDLIB_SOURCES[companion]! + extra),
  ], { trustedStandardLibraryModules: new Set([companion]) });
}

function messages(project: ReturnType<typeof compileProject>): readonly string[] {
  return project.diagnostics.map(({ message }) => message);
}

describe("the rows (§3.3, §4.1)", () => {
  test.each([
    ["array", "Array", "export type array as Array(a)", 1],
    ["jsMap", "JsMap", "export type jsMap as JsMap(k, v)", 2],
    ["jsSet", "JsSet", "export type jsSet as JsSet(a)", 1],
  ])("`%s` is public, declared by `Hex.%s` alone, with no representation", (key, companion, row, arity) => {
    const entry = INTRINSIC_INVENTORY.get(key);
    expect(entry).toMatchObject({
      grade: "type",
      arity,
      declarers: [companion],
      reach: "public",
      kind: companion,
    });
    expect(entry).not.toHaveProperty("representation");
    expect(STDLIB_SOURCES[companion]).toContain(`    ${row}\n`);
  });

  /** A bare parameter is invariant (the opaque-declaration rule), so the rows claim nothing. */
  test.each([
    ["Array", ["inv"]],
    ["JsMap", ["inv", "inv"]],
    ["JsSet", ["inv"]],
  ])("`%s`'s row writes no claim: it is invariant", (companion, claims) => {
    const project = inCompanion(companion, "");
    expect(messages(project)).toEqual([]);
    expect(publicRowClaims(project, `/${companion}.hex`, companion)).toEqual(claims);
  });

  test("a trusted module other than the companion may not declare a public key", () => {
    const refused = compileProject([
      new Source.File(Source.fileId(0), "/main.hex", "module Main\n\n" + "export let ok: Int = 1\n"),
      new Source.File(
        Source.fileId(1),
        "/Debug.hex",
        "module Debug\n\n" + 'extern from "hex:intrinsic"\n' + "    type jsMap as M(k, v)\n",
      ),
    ], { trustedStandardLibraryModules: new Set(["Debug"]) }).diagnostics
      .map(({ message }) => message);
    expect(refused).toEqual([
      "`jsMap` may be declared only in `Hex.JsMap`; the type is reached from there, as `JsMap`",
    ]);
  });
});

/**
 * FFI Part 7 §2.3: the three are pinned, so their faces are TypeScript's own
 * read-only types, and each companion's seat aliases its face rather than a
 * runtime interface. `Array.d.ts` shadows the global `Array` in that file
 * alone, and no face there spells the global, so the file still checks.
 */
test("each seat aliases its read-only face, and the declaration files check", async () => {
  const project = compileFiles([[
    "/main.hex",
    "module Main\n\n" +
      "export let a(xs: Array(Int)): Seq(Int) = Array.toSeq(xs)\n" +
      "export let m(m: JsMap(String, Int)): Seq((String, Int)) = JsMap.entries(m)\n" +
      "export let s(s: JsSet(Int)): Seq(Int) = JsSet.toSeq(s)\n" +
      "export let v(xs: Array(Int)): Vector(Int) = Array.toVector(xs)\n",
  ]]);
  expect(messages(project)).toEqual([]);
  const declarations = (name: string) =>
    project.modules.find((module) => module.name === name)!.declarations.text;
  expect(declarations("Hex.Array")).toContain("export type Array<a> = ReadonlyArray<a>;\n");
  expect(declarations("Hex.JsMap")).toContain("export type JsMap<k, v> = ReadonlyMap<k, v>;\n");
  expect(declarations("Hex.JsSet")).toContain("export type JsSet<a> = ReadonlySet<a>;\n");
  for (const name of ["Hex.Array", "Hex.JsMap", "Hex.JsSet"]) {
    expect(declarations(name)).not.toMatch(/\bHex\./u);
  }
  expect(declarations("Main")).toContain(
    "export declare const a: (xs: ReadonlyArray<number>) => Iterable<number>;",
  );
  const files: Record<string, string> = {};
  for (const module of project.modules) {
    files[module.path.replace(/^\//u, "").replace(/\.hex$/u, ".d.ts")] = module.declarations.text;
  }
  if (project.runtimeDeclarations !== undefined) {
    files[project.runtimeDeclarations.path.replace(/^\//u, "")] = project.runtimeDeclarations.text;
  }
  expect(await typeScriptErrors(files)).toEqual([]);
});

describe("every route to the name reaches the kind", () => {
  test("bare, through the prelude's seed", () => {
    expect(diagnostics(
      "export let a(): Array(Int) = Vector.toArray([1])\n" +
        "export let m(): JsMap(String, Int) = JsMap.fromSeq(Seq.empty)\n" +
        "export let s(): JsSet(Int) = JsSet.fromSeq(Seq.empty)\n",
    )).toEqual([]);
  });

  /** The companion is the type's home, so `Array.Array` names it; it did not before (#1076). */
  test("qualified through the companion", () => {
    expect(diagnostics(
      "export let a(): Array.Array(Int) = Vector.toArray([1])\n" +
        "export let m(): JsMap.JsMap(String, Int) = JsMap.fromSeq(Seq.empty)\n" +
        "export let s(): JsSet.JsSet(Int) = JsSet.fromSeq(Seq.empty)\n",
    )).toEqual([]);
  });

  test("each route states the kind's arity", () => {
    expect(diagnostics("let a: Array = Vector.toArray([1])\n"))
      .toEqual(["type `Array` expects 1 argument, but 0 were provided"]);
    expect(diagnostics("let m: JsMap(Int) = JsMap.fromSeq(Seq.empty)\n"))
      .toEqual(["type `JsMap` expects 2 arguments, but 1 were provided"]);
    expect(diagnostics("let s: JsSet.JsSet(Int, Int) = JsSet.fromSeq(Seq.empty)\n"))
      .toEqual(["type `JsSet` expects 1 argument, but 2 were provided"]);
  });

  /** The name is an ordinary declaration's, so a module's own `Array` occludes it (Modules §5.4). */
  test("a module's own declaration of the spelling wins", () => {
    expect(diagnostics(
      "record Array(a) = { x: a }\n" + "export let v: Array(Int) = Array({ x = 1 })\n",
    )).toEqual([
      "exported binding `v` exposes private type `Array`; export the type, " +
        "perhaps opaquely, or keep the binding private",
    ]);
  });
});

/**
 * Modules §5.5. `Vector.hex` sits between the row's data seat and `Array.hex`'s
 * full seat: it may spell `Array`, which `Vector.toArray` needs, and nothing
 * else of the companion is in view there — not its functions, and not its
 * `Iterable` instance. What the kind gives every module is untouched: a loop
 * and a bracket at an `Array` need no instance.
 */
describe("Array's data seat", () => {
  test("`Vector.toArray` names the type, and `Vector.js` takes no load edge to `Array.js`", () => {
    // `Array.toVector` reaches `Vector.js` through `append`; the door calls inline.
    const project = compileFiles([
      ["/main.hex", "module Main\n\n" + "export let v(): Vector(Int) = Array.toVector(Vector.toArray([1, 2]))\n"],
    ]);
    expect(messages(project)).toEqual([]);
    const vector = project.modules.find(({ name }) => name === "Hex.Vector")!;
    expect(vector.javascript.text).not.toContain("Array.js");
    expect(vector.declarations.text).not.toContain("Array.js");
    expect(vector.declarations.text).toContain(
      "export declare function toArray<a>(values: Vector<a>): ReadonlyArray<a>;",
    );
  });

  test.each([
    ["the name", "export let n(xs: Array(Int)): Int = 1\n", []],
    [
      "a loop and a bracket",
      "export let n(xs: Array(Int)): Int =\n    var t = xs[1]\n    for x in xs\n        t := t + x\n    t\n",
      [],
    ],
    [
      "a qualified function",
      "export let n(xs: Array(Int)): Int = Array.length(xs)\n",
      ["module `Array` does not export `length`"],
    ],
    [
      "the instance's member",
      "export let n(xs: Array(Int)): Seq(Int) = Array.toSeq(xs)\n",
      ["module `Array` does not export `toSeq`"],
    ],
  ])("a module between the seats sees %s", (_, extra, expected) => {
    expect(messages(inCompanion("Vector", "\n" + extra, "export let z: Int = Vector.length([1])\n")))
      .toEqual(expected);
  });

  /** `JsMap` and `JsSet` need no data seat: no module before theirs spells them. */
  test("a module before `JsMap.hex` does not see the name", () => {
    expect(messages(inCompanion(
      "Vector",
      "\nexport let n(m: JsMap(Int, Int)): Int = 1\n",
      "export let z: Int = Vector.length([1])\n",
    ))).toEqual(["unknown generic type `JsMap`"]);
  });
});

/**
 * The foreign `Iterable` slice. Each companion honors `Iterable` at its own
 * type over an unexported traversal door — the native iterator's inbound
 * adapter, as `stringToSeq` and `rangeToSeq` are — so the provided rows are
 * gone, and FFI Part 2 §9's `Array.toSeq` compiles for the first time.
 */
describe("the companions honor Iterable in source", () => {
  test.each([
    ["Array", "honor Iterable<Array(a)> =\n    type Item = a\n    toSeq(values) = nativeToSeq(values)\n"],
    ["JsMap", "honor Iterable<JsMap(k, v)> =\n    type Item = (k, v)\n    toSeq(map) = nativeToSeq(map)\n"],
    ["JsSet", "honor Iterable<JsSet(a)> =\n    type Item = a\n    toSeq(s) = nativeToSeq(s)\n"],
  ])("`%s.hex` writes the row", (companion, honor) => {
    expect(STDLIB_SOURCES[companion]).toContain(honor);
  });

  test.each([
    ["arrayToSeq", "Array", "fun arrayToSeq as nativeToSeq(values: Array(a)) -> Seq(a)"],
    ["jsMapToSeq", "JsMap", "fun jsMapToSeq as nativeToSeq(map: JsMap(k, v)) -> Seq((k, v))"],
    ["jsSetToSeq", "JsSet", "fun jsSetToSeq as nativeToSeq(s: JsSet(a)) -> Seq(a)"],
  ])("`%s` is an unexported operation row of `Hex.%s`", (key, companion, row) => {
    expect(INTRINSIC_INVENTORY.get(key)).toEqual({ grade: "operation", arity: 1 });
    expect(STDLIB_SOURCES[companion]).toContain(`    ${row}\n`);
    expect(STDLIB_SOURCES[companion]).not.toContain(`export ${row}`);
  });

  test("every spelling of the walk reaches the member, and it walks the collection", async () => {
    const main = await runMain(
      "module Main\n\n" +
        "let xs: Vector(Int) = [3, 1, 2]\n" +
        "let map(): JsMap(String, Int) = JsMap.fromSeq(Vector.toSeq([(\"b\", 2), (\"a\", 1)]))\n" +
        "let set(): JsSet(Int) = JsSet.fromSeq(Vector.toSeq([5, 4, 5]))\n" +
        "let arr(): Array(Int) = Vector.toArray(xs)\n" +
        "let back(s: Seq(a)): Array(a) = Vector.toArray(Vector.fromSeq(s))\n" +
        "export let a1(): Array(Int) = back(Array.toSeq(arr()))\n" +
        "export let a2(): Array(Int) = back(arr().toSeq())\n" +
        "export let a3(): Array(Int) = back(Iterable.toSeq(arr()))\n" +
        "export let m1(): Array((String, Int)) = back(JsMap.toSeq(map()))\n" +
        "export let m2(): Array((String, Int)) = back(JsMap.entries(map()))\n" +
        "export let m3(): Array((String, Int)) = back(map().toSeq())\n" +
        "export let s1(): Array(Int) = back(JsSet.toSeq(set()))\n" +
        "export let s2(): Array(Int) = back(set().toSeq())\n",
    );
    const call = (name: string) => (main[name] as () => unknown)();
    for (const name of ["a1", "a2", "a3"]) expect(call(name)).toEqual([3, 1, 2]);
    for (const name of ["m1", "m2", "m3"]) expect(call(name)).toEqual([["b", 2], ["a", 1]]);
    for (const name of ["s1", "s2"]) expect(call(name)).toEqual([5, 4]);
  });

  /**
   * Before and after, as text. A `toSeq` call used to build the provided row's
   * dictionary inline at the use — `({ toSeq: __seqFromIterable }).toSeq(xs)` —
   * and now imports the companion's member, as `Range`'s does. The loops never
   * consulted the row and still emit native `for…of` (FFI Part 2 §8.2, Part 10
   * §6).
   */
  test("a `toSeq` call imports the companion's member; a loop stays native", () => {
    const text = javascript(
      "export let a(xs: Array(Int)): Seq(Int) = xs.toSeq()\n" +
        "export let m(m: JsMap(String, Int)): Seq((String, Int)) = m.toSeq()\n" +
        "export let s(s: JsSet(Int)): Seq(Int) = JsSet.toSeq(s)\n" +
        "export let sum(xs: Array(Int), m: JsMap(String, Int), s: JsSet(Int)): Int =\n" +
        "    var t = 0\n" +
        "    for x in xs\n        t := t + x\n" +
        "    for (k, v) in m\n        t := t + v\n" +
        "    for x in s\n        t := t + x\n" +
        "    t\n",
    );
    expect(text).toContain('import { __Iterable_Array_toSeq } from "./Hex/Array.js";');
    expect(text).toContain('import { __Iterable_JsMap_toSeq } from "./Hex/JsMap.js";');
    expect(text).toContain('import { __Iterable_JsSet_toSeq } from "./Hex/JsSet.js";');
    expect(text).toContain("const a = xs => __Iterable_Array_toSeq(xs);");
    expect(text).toContain("const m = m => __Iterable_JsMap_toSeq(m);");
    expect(text).toContain("const s = s => __Iterable_JsSet_toSeq(s);");
    expect(text).not.toContain("seqFromIterable");
    expect(text).toContain("for (const x of xs) {");
    expect(text).toContain("for (const __item of m) {");
    expect(text).toContain("for (const x of s) {");
  });

  test.each(["Array", "JsMap", "JsSet"])("`%s.js`'s member is its door, the inbound adapter", (companion) => {
    const project = inCompanion(companion, "");
    expect(messages(project)).toEqual([]);
    const text = project.modules.find(({ source }) => source.path === `/${companion}.hex`)!
      .javascript.text;
    expect(text).toContain("const nativeToSeq = __seqFromIterable;");
    expect(text).toMatch(new RegExp(`^const __Iterable_${companion}_toSeq = \\w+ => nativeToSeq\\(\\w+\\);$`, "mu"));
    expect(text).not.toMatch(/export \{[^}]*nativeToSeq/u);
  });

  /**
   * The companion honoring the row twice is an ordinary duplicate now: the
   * compiler no longer fills the slot, so `#compilerProvidedSlot` has nothing
   * to say about it. (Each later prelude module that imports both rows repeats
   * the report, as it does at `Range` on `main`; only the standard library can
   * write this.)
   */
  test("a second row in the companion is a plain duplicate", () => {
    const reported = messages(inCompanion(
      "JsSet",
      "\nhonor Iterable<JsSet(a)> =\n    type Item = a\n    toSeq(s) = nativeToSeq(s)\n",
      "export let n(s: JsSet(Int)): Int = JsSet.size(s)\n",
    ));
    expect(new Set(reported)).toEqual(new Set(["duplicate instance of `Iterable<JsSet(a)>`"]));
  });

  /**
   * A program's own row at the three is an orphan, and the hint no longer says
   * the prelude provides one: the slot is the companion's source row now.
   * #1131 (open) is why the duplicate report follows the orphan one, as it does
   * at `String` and `Range`.
   */
  test.each([
    ["Array(a)", "a"],
    ["JsMap(k, v)", "(k, v)"],
    ["JsSet(a)", "a"],
  ])("a program's own `Iterable<%s>` is an orphan", (head, item) => {
    const reported = diagnostics(`honor Iterable<${head}> =\n    type Item = ${item}\n    toSeq(x) = Seq.empty\n`);
    expect(reported[0]).toBe(
      "orphan instance: this module declares neither `Iterable` nor the instance subject",
    );
    expect(reported.join("\n")).not.toContain("already provides");
  });
});

/**
 * The companion is the type's home in every sense a declared type has one
 * (Intrinsics §3.3), so a program's own constraint may be honored at the three
 * — a head the law refused before, as not naming a nominal constructor.
 */
test("a program's own constraint is honored at the captured collections", async () => {
  const main = await runMain(
    "module Main\n\n" +
      "constraint Describe<t> =\n    describe(x: t) -> String\n\n" +
      "honor Describe<Array(a)> =\n    describe(x) = \"array of \" ++ show(Array.length(x))\n\n" +
      "honor Describe<JsMap(k, v)> =\n    describe(x) = \"map of \" ++ show(JsMap.size(x))\n\n" +
      "honor Describe<JsSet(a)> =\n    describe(x) = \"set of \" ++ show(JsSet.size(x))\n\n" +
      "export let all(): String =\n" +
      "    describe(Vector.toArray([1, 2])) ++ \", \" ++\n" +
      "        describe(JsMap.fromSeq(Vector.toSeq([(1, 1)]))) ++ \", \" ++\n" +
      "        describe(JsSet.fromSeq(Vector.toSeq([1, 2, 3])))\n",
  );
  expect((main.all as () => string)()).toBe("array of 2, map of 1, set of 3");
});

/**
 * Modules §5.3's qualified read of an honored member pins the member at the
 * head, and every variable the head binds is fresh at the use — the head's own
 * as well as the `<...>` prefix's (#390). Before #1076 only the prefix's were,
 * so a bare head read from another module turned its variable rigid: the case
 * below was refused ("`a` is a declared type variable, but the body requires
 * `Int`") on `main`, and `Array.toSeq(xs)` would have been.
 */
test("a bare head's variable is fresh at a qualified read from another module", () => {
  expect(compileFiles([
    ["/bag.hex", "module Bag\n\nexport record Bag(a) = { items: Vector(a) }\n\n" +
      "honor Iterable<Bag(a)> =\n    type Item = a\n    toSeq(b) = b.items.toSeq()\n"],
    ["/main.hex", "module Main\n\nimport Bag\n\n" +
      "export let n(b: Bag(Int)): Seq(Int) = Bag.toSeq(b)\n" +
      "export let m(b: Bag(String)): Seq(String) = Bag.toSeq(b)\n"],
  ]).diagnostics.map(({ message }) => message)).toEqual([]);
});
