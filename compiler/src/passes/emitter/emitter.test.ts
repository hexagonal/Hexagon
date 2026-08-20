import fc from "fast-check";
import { describe, expect, test } from "vitest";

import * as Source from "../../support/source.js";
import type * as Core from "../../syntax/core/index.js";
import { check } from "../checker/checker.js";
import { elaborate } from "../elaborator/elaborator.js";
import { applyLayout } from "../layout/layout.js";
import { lex } from "../lexer/lexer.js";
import { parse } from "../parser/parser.js";
import { resolve } from "../resolver/resolver.js";
import { compileProject } from "../../project.js";
import { compileFiles, runProject } from "../../support/test-project.js";
import {
  emitDeclarations,
  emitJavaScript,
  emitTypeScriptPreview,
} from "./emitter.js";

describe("emitJavaScript", () => {
  test("emits readable extern ESM bindings, stable adapters, and opaque declarations", () => {
    const module = preludeSource(
      "extern from \"tiny-json\"\n" +
        "    export type JsonValue\n" +
        "    export fun parse(text: String): JsonValue\n" +
        "    let VERSION as version: String\n" +
        "    export default fun createClient(): JsonValue\n" +
        "    fun stream(): Seq(Int)\n" +
        "    let values: Seq(Int)\n" +
        "    fun report(message: String): Unit\n" +
        "extern import \"telemetry/register\"\n" +
        "export let document: JsonValue = parse!(version)",
    );

    expect(module.diagnostics).toEqual([]);
    const output = emitJavaScript(module);
    expect(output.text).toContain('import { parse } from "tiny-json";');
    expect(output.text).toContain('import { VERSION as version } from "tiny-json";');
    expect(output.text).toContain('import createClient from "tiny-json";');
    expect(output.text).toMatch(/import \{ stream as \w+ \} from "tiny-json";/u);
    // Inbound `Seq` positions go through FFI Part 3 §2.2's door, which adapts a
    // foreign iterable and lets a genuine `Seq` coming home pass by identity.
    expect(output.text).toMatch(/const stream = \(\) => __seqInbound\(\w+\(\)\);/u);
    expect(output.text).toMatch(/const values = __seqInbound\(\w+\);/u);
    expect(output.text).toMatch(/const report = message => \{ \w+\(message\); \};/u);
    expect(output.text).toContain('import "telemetry/register";');
    expect(output.text).toContain("export { parse };");
    expect(output.text).toContain("export { createClient };");

    const declarations = emitDeclarations(module).text;
    expect(declarations).toMatch(/declare const \w+: unique symbol;/u);
    expect(declarations).toContain("export type JsonValue =");
    expect(declarations).toContain("export declare function parse(text: string): JsonValue;");
    expect(declarations).toContain("export declare function createClient(): JsonValue;");
    expect(declarations).not.toContain("VERSION");
    expect(output.diagnostics).toEqual([]);
  });
  test("emits vectors, structural hashes, vector patterns, and one-based access", () => {
    const module = coreSource(
      "export let values: Vector(Int) = [10, 20, 30]\n" +
        "export let second: Int = values[2]\n" +
        "export let window: Vector(Int) = values[2..99]\n" +
        "export let letter: String = \"héllo\"[2]\n" +
        "export let fingerprint: Int = hash((values, {name = \"hex\"}))\n" +
        "export let first: Int = match values\n" +
        "    [head, ...rest] => head\n" +
        "    [] => 0",
    );

    expect(module.diagnostics).toEqual([]);
    const output = emitJavaScript(module);
    // Collections Part 3 §2's literal is one fold over `append`, and §3.6's
    // pattern is a length test against the trie's own `size`. The bracket and
    // slice helpers are unmoved — each is a bounds assertion around one trie
    // operation — and `__stringIndex` is unmoved for the opposite reason:
    // a string is not a trie, so §9's codepoint reading stayed on arrays when
    // the vector one left them.
    expect(output.text).toContain("const values = __vectorOf([10, 20, 30]);");
    expect(output.text).toContain("__vectorIndex(values, 2)");
    expect(output.text).toContain("__vectorSlice(values, __range(2, 99))");
    expect(output.text).toContain('__stringIndex("héllo", 2)');
    expect(output.text).toContain("function __stableHash");
    expect(output.text).toContain("__trieSize(__match) >= 1");
    expect(emitDeclarations(module).text).toContain("Hex.Vector<number>");
    expect(output.diagnostics).toEqual([]);
  });

  /**
   * The representation core is `stdlib/Vector.hex`'s since the intrinsic-door
   * milestone (`spec/intrinsics.md` §9.2), so the lowerings are read off *that*
   * module and the consumer is read for what it now is: an ordinary ESM importer
   * of a prelude member. The representation is the Collections Part 3 §4 trie,
   * which `Vector.hex` reaches through one more ESM import — and still no HAMT
   * runtime, which remains `Map`/`Set`'s alone.
   */
  test("executes the Vector representation core without loading the HAMT runtime", async () => {
    const files = [[
      "/main.hex",
      "let values = [10, 20, 30]\n" +
      "let updated = Vector.set(values, 2, 25)\n" +
      "let replayed = Vector.fromSeq(Vector.toSeq(updated))\n" +
      "let joined = [1, 2] ++ [3, 4]\n" +
      "export let result: (Vector(Int), Vector(Int), Vector(Int), Int, Vector(Int)) =\n" +
      "    (values, updated, replayed, Vector.at(values, -1), joined)\n",
    ]] as const;
    const project = compileFiles(files);
    expect(project.diagnostics).toEqual([]);
    const text = (path: string): string =>
      project.modules.find((module) => module.source.path === path)!.javascript.text;

    expect(text("/main.hex")).not.toContain("const __persistentCollections");
    expect(text("/Vector.hex")).not.toContain("const __persistentCollections");
    // No `toSeq` in the import list since #353: `Vector.toSeq` is the provided
    // row's member, not an export of the companion, and a provided row is
    // rendered inline rather than imported (Collections Part 5 §4).
    expect(text("/main.hex")).toContain(
      'import { set, fromSeq, at } from "./Vector.js";',
    );
    // The forwarder is gone since #444: `Vector.toSeq(updated)` is a
    // source-written member call at a concrete head, and the head's ground
    // demand is compiler-built — a provided row, rendered rather than declared
    // — so Constraints §6.1's third arm reads the member off the §3.4 binding.
    // No module exports a seat for a row no module declares.
    expect(text("/main.hex")).not.toContain('from "./Iterable.js";');
    // Ground, so the row's dictionary is Dictionary Sharing §3.4's hoisted
    // module constant since #446 rather than a literal rebuilt at the call.
    expect(text("/main.hex")).toContain(
      "const __Iterable_Vector_Int = ({ toSeq: __seqFromIterable });",
    );
    expect(text("/main.hex")).toContain("__Iterable_Vector_Int.toSeq(updated)");
    // `fromSeq` lowers to the outbound driver in the module whose door declares
    // it; the inbound adapter is there too, because the unexported `elements`
    // row still crosses the same boundary.
    expect(text("/Vector.hex")).toContain("function __seqFromIterable");
    expect(text("/Vector.hex")).toContain("function __seqToIterable");
    expect(text("/Vector.hex")).toContain(
      "const fromSeq = __values => __vectorOf(__seqToIterable(__values));",
    );
    // The trie is the third module in the graph, and only `Vector.hex` and the
    // literal-holding consumer import it.
    expect(text("/Vector.hex")).toContain('} from "./VectorTrie.js";');
    expect(text("/VectorTrie.hex")).toContain("export { empty, size, get, set,");

    // The tuple crosses as a JS array; each `Vector` inside it is a trie, read
    // back through the representation contract's `[Symbol.iterator]`.
    const result = (await runProject(files))["result"] as unknown[];
    expect([
      [...(result[0] as Iterable<number>)],
      [...(result[1] as Iterable<number>)],
      [...(result[2] as Iterable<number>)],
      result[3],
      [...(result[4] as Iterable<number>)],
    ]).toEqual([
      [10, 20, 30],
      [10, 25, 30],
      [10, 25, 30],
      30,
      [1, 2, 3, 4],
    ]);
  });

  test("brands Vector.at failures and preserves the caller's signed index", async () => {
    const files = [["/main.hex", "let impossible = Vector.at([10, 20], -3)\n"]] as const;

    expect(compileFiles(files).diagnostics).toEqual([]);
    await expect(runProject(files)).rejects.toThrowError(
      expect.objectContaining({
        name: "IndexError",
        $hex: "Vector",
        index: -3,
        size: 2,
      }),
    );
  });

  /**
   * **The transitional helper is gone, entire** (#373). It was `Map`'s and
   * `Set`'s hand-written JavaScript HAMT; `Map`'s half retired at its milestone
   * (#370) and `Set`'s at this one, and the helper, its selector, and the
   * checker rows that typed both went with them. Both companions are Hexagon
   * source over `runtime/HashTrie.hex` now.
   *
   * Pinned as an absence *and* as a presence, because an absence alone would
   * pass if the operations had merely stopped being reached: the same module
   * that carries no helper must carry the calls into the companions, and must
   * still answer the same `.d.ts` faces. The faces are the part this milestone
   * deliberately does not move — `Hex.Map<k, v>` and `Hex.Set<a>` are what a
   * crossed value faced before the arc and what it faces after it.
   */
  test("the transitional helper is gone, and both companions are reached by call", () => {
    const module = coreSource(
      "let emptyMap: Map((Int, Int), String) = Map.empty\n" +
        "export let names: Map((Int, Int), String) = Map.set(emptyMap, (1, 2), \"first\")\n" +
        "export let replaced: Map((Int, Int), String) = Map.set(names, (1, 2), \"second\")\n" +
        "export let hasPair: Bool = Map.containsKey(replaced, (1, 2))\n" +
        "let blank: Set((Int, Int)) = Set.empty\n" +
        "export let pairs: Set((Int, Int)) = Set.add(blank, (3, 4))\n" +
        "export let hasPair2: Bool = Set.contains(pairs, (3, 4))",
    );

    expect(module.diagnostics).toEqual([]);
    const output = emitJavaScript(module);
    // The helper, by every name it went under.
    expect(output.text).not.toContain("__persistentCollections");
    expect(output.text).not.toContain("const emptySet =");
    expect(output.text).not.toContain("const setAdd =");
    expect(output.text).not.toContain("const setContains =");
    expect(output.text).not.toContain("const insert =");
    expect(output.text).not.toContain("__hash.eq.equals");
    // What stands in its place: imported companion bindings, called.
    expect(output.text).toContain('from "./Map.js";');
    expect(output.text).toContain('from "./Set.js";');
    expect(emitDeclarations(module).text).toContain("Hex.Map<[number, number], string>");
    expect(emitDeclarations(module).text).toContain("Hex.Set<[number, number]>");
  });

  /** And it is absent from a module of each kind on its own, not just from both. */
  test("the transitional helper is absent from map-only and set-only modules alike", () => {
    const mapOnly = coreSource(
      "let m: Map(Int, String) = Map.set(Map.empty, 1, \"one\")\n" +
        "export let held: Bool = Map.containsKey(m, 1)\n" +
        "export let looked: String = m[1]\n",
    );
    expect(mapOnly.diagnostics).toEqual([]);
    expect(emitJavaScript(mapOnly).text).not.toContain("__persistentCollections");

    const setOnly = coreSource(
      "let s: Set(Int) = Set.add(Set.empty, 1)\n" +
        "export let held: Bool = Set.contains(s, 1)\n" +
        "export let counted: Int = Set.size(s)\n",
    );
    expect(setOnly.diagnostics).toEqual([]);
    expect(emitJavaScript(setOnly).text).not.toContain("__persistentCollections");
  });

  test("executes persistent Map and Set updates, lookup, and bracket failure", async () => {
    // Linked and run rather than evaluated as one text with its imports
    // stripped. The stripping worked while every import this module carried was
    // a name nothing executed read; since #344 the `Hash<Int>` a `Map(Int, _)`
    // hashes its keys with is `stdlib/Int.hex`'s exported dictionary, which the
    // running code does read.
    const files = [["/main.hex",
      "let m0: Map(Int, String) = Map.empty\n" +
        "let m1 = Map.set(m0, 1, \"one\")\n" +
        "let m2 = Map.set(m1, 33, \"thirty-three\")\n" +
        "export let m3: Map(Int, String) = Map.set(m2, 1, \"replaced\")\n" +
        "export let unchanged: Map(Int, String) = Map.remove(m3, 99)\n" +
        "let s0: Set(Int) = Set.empty\n" +
        "let s1 = Set.add(Set.add(s0, 1), 33)\n" +
        "let s2 = Set.add(s1, 1)\n" +
        "export let looked: (String, String) = (m3[1], m3[33])\n" +
        "export let counted: (Int, Int, Int) = (Map.size(m0), Map.size(m3), Set.size(s2))\n" +
        "export let holds: Bool = Set.contains(s2, 33)\n",
    ]] as const;
    const exports = await runProject(files);

    expect(exports["looked"]).toEqual(["replaced", "thirty-three"]);
    expect(exports["counted"]).toEqual([0, 2, 2]);
    expect(exports["holds"]).toBe(true);
    // Removing an absent key answers the same map, not a copy of it.
    expect(exports["unchanged"]).toBe(exports["m3"]);

    const missing = await runProject([["/main.hex",
      "let values: Map(Int, String) = Map.empty\n" +
        "export let missing(): String = values[99]\n",
    ]]);
    expect(missing["missing"] as () => unknown).toThrowError(
      expect.objectContaining({ name: "KeyError" }),
    );
  });

  test("provides extensional Map and Set instances and the core algebra", async () => {
    const source =
      "let left = Map.fromVector([(1, \"one\"), (2, \"two\")])\n" +
        "let right = Map.fromVector([(2, \"two\"), (1, \"one\")])\n" +
        "fun mapFacts<k: Hash, v: Hash>(a: Map(k, v), b: Map(k, v)) = (a == b, hash(a) == hash(b))\n" +
        "fun setFacts<a: Hash>(a: Set(a), b: Set(a)) = (a == b, hash(a) == hash(b))\n" +
        "let first = Set.fromVector([1, 2, 3])\n" +
        "let second = Set.fromVector([3, 4])\n" +
        "let combined = Set.union(first, second)\n" +
        "let common = Set.intersect(first, second)\n" +
        "let rest = Set.difference(first, second)\n" +
        "let subset = Set.isSubsetOf(common, first)\n" +
        "let keys = Vector.fromSeq(Map.keys(left))\n" +
        "let mapEvidence = mapFacts(left, right)\n" +
        "let setEvidence = setFacts(first, Set.fromVector([3, 2, 1]))\n" +
        "export let result: (Bool, Bool, Int, Int, Int, Bool, Vector(Int), String, String, (Bool, Bool), (Bool, Bool)) =\n" +
        "    (left == right, hash(left) == hash(right), Set.size(combined), Set.size(common), Set.size(rest), subset, keys, \"${first}\", \"${left}\", mapEvidence, setEvidence)\n";
    const files = [["/main.hex", source]] as const;

    // Linked and run rather than evaluated as one text: `Vector.fromSeq` is an
    // import of the prelude `Vector.hex` now, not an inline lowering.
    expect(compileFiles(files).diagnostics).toEqual([]);
    const result = (await runProject(files))["result"] as unknown[];
    // `Map.keys` yields the prelude `Seq` record, so the test converts through
    // `Vector.fromSeq` rather than spreading it — a `Seq` is not itself a JS
    // iterable (see the exported-face note in `seq-unification.test.ts`).
    //
    // **Sorted, and it has to be.** Since #370 a `Map` is the real HAMT, so its
    // traversal order is placement order under a per-process seed (Collections
    // Part 4 §7.1) — deterministic for one value within one run and promised for
    // nothing else. An assertion on the literal order would be a snapshot of one
    // process's seed, which is exactly the test §7.1 forbids; the *contents* are
    // what the correspondence claim is about.
    expect([...(result[6] as Iterable<number>)].sort()).toEqual([1, 2]);
    // The two `show` renderings, for the same reason: the format is normative
    // (§8.3) and the order inside the brackets is not.
    expect(shownElements(result[7] as string, "Set.fromVector(")).toEqual(["1", "2", "3"]);
    expect(shownElements(result[8] as string, "Map.fromVector(")).toEqual([
      "(1, one)",
      "(2, two)",
    ]);
    expect([...result.slice(0, 6), ...result.slice(9)]).toEqual([
      true,
      true,
      4,
      1,
      2,
      true,
      [true, true],
      [true, true],
    ]);
  });

  test("iterates provided collections and concrete user Iterable instances", () => {
    const module = preludeSource(
      // No local `constraint Iterable` since #353: the prelude declares it, and
      // redeclaring it is refused. The instance below is unchanged, which is
      // what this test is about.
      "record Bag = {items: Seq(Int)}\n" +
        "honor Iterable<Bag> =\n" +
        "    type Item = Int\n" +
        "    toSeq(bag) = bag.items\n" +
        "let bag = Bag({items = Seq.take(Seq.iterate(1, x => x + 1), 2)})\n" +
        "for value in bag\n" +
        "    log(\"${value}\")\n" +
        "for value in [1, 2]\n" +
        "    log(\"${value}\")\n" +
        "let pairs: Map(Int, String) = Map.set(Map.empty, 1, \"one\")\n" +
        "for (key, value) in pairs\n" +
        "    log(\"${key} ${value}\")",
    );

    expect(module.diagnostics).toEqual([]);
    const output = emitJavaScript(module);
    expect(output.text).toContain("__Iterable_Bag.toSeq(bag)");
    // `for x in` over a vector asks for no `Iterable` evidence and never did:
    // it is a native `for…of`, and it keeps working over the trie because every
    // vector value carries `[Symbol.iterator]` as part of its representation.
    expect(output.text).toContain("for (const value of __vectorOf([1, 2]))");
    expect(output.text).toContain("for (const __item");
  });

  test("preserves Array and Nullable boundary types in exported declarations", () => {
    const module = coreSource(
      "export let count(xs: Array(Int)): Int =\n" +
        "    var total = 0\n" +
        "    for _ in xs\n" +
        "        total := total + 1\n" +
        "    total\n" +
        "export let keep(value: Nullable(String)): Nullable(String) = value",
    );

    expect(module.diagnostics).toEqual([]);
    const declarations = emitDeclarations(module).text;
    expect(declarations).toContain("export declare const count: (xs: ReadonlyArray<number>) => number;");
    expect(declarations).toContain("export declare const keep: (value: string | null | undefined) => string | null | undefined;");
    expect(emitJavaScript(module).text).toContain("for (const __item");
  });

  test("emits var, assignment, inclusive Range values, and while readably", () => {
    const module = coreSource(
      "fun countdown(start: Int) =\n" +
        "    var current = start\n" +
        "    let visited = 1..current\n" +
        "    while current > 0\n" +
        "        current := current - 1\n" +
        "    visited",
    );

    expect(module.diagnostics).toEqual([]);
    const javascript = emitJavaScript(module).text;
    expect(javascript).toContain("function __range(__start, __end)");
    expect(javascript).toContain("*[Symbol.iterator]()");
    expect(javascript).toContain("let current = start;");
    expect(javascript).toContain("const visited = __range(1, current);");
    expect(javascript).toContain("while (current > 0) {");
    expect(javascript).toContain("current = current - 1;");
    expect(javascript).toContain("return visited;");
  });

  test("probes generated helper names deterministically on an emitted collision", () => {
    const module = coreSource("let values = 1..2");
    const seeded: Core.Module = {
      ...module,
      symbols: module.symbols.map((symbol, index) =>
        index === 0 ? { ...symbol, name: "__range" } : symbol
      ),
    };

    // Lexer §3.2's probe: the preferred spelling is occupied by something the
    // compiler cannot rename, so the generated name takes numeric suffixes from
    // 1, separated by `_` like every other suffixed generated name (#425).
    const javascript = emitJavaScript(seeded).text;
    expect(javascript).toContain("function __range_1(__start, __end)");
    expect(javascript).toContain("const values = __range_1(1, 2);");
  });

  test("preserves exact, non-normalized identifier spellings as distinct names", () => {
    const module = coreSource("let é = 1\nlet é = 2");

    expect(module.diagnostics).toEqual([]);
    expect(emitJavaScript(module).text).toContain("const é = 1;\nconst é = 2;");
  });

  test("emits Range and String for loops as native for-of loops", () => {
    const module = coreSource(
      "fun visit(): Unit =\n" +
        "    for number in 1..3\n" +
        "        log(\"${number}\")\n" +
        "    for character in \"ab\"\n" +
        "        log(\"${character}\")",
    );

    expect(module.diagnostics).toEqual([]);
    const javascript = emitJavaScript(module).text;
    expect(javascript).toContain("for (const number of __range(1, 3)) {");
    expect(javascript).toContain('for (const character of "ab") {');
    expect(javascript).not.toContain("__item");
  });

  test("lowers Seq dot calls and pipelines through prelude companion dispatch", () => {
    // The `SeqOperation` family is deleted, not repointed (PR #85 finding F1).
    // These spellings must keep compiling with identical types through ordinary
    // companion dispatch against prelude `Seq.hex` — dot call, qualified call,
    // and pipeline all reaching the *same* imported functions.
    const module = preludeSource(
      "let numbers: Seq(Int) = Seq.iterate(1, number => number + 1)\n" +
        "export let selected: Seq(Int) =\n" +
        "    numbers\n" +
        "    .filter(number => number > 3)\n" +
        "    .map(number => number * 2)\n" +
        "    .take(5)\n" +
        "let selected2 = numbers |> Seq.filter(number => number > 3) |> Seq.map(number => number * 2) |> Seq.take(5)\n" +
        "for number in selected\n" +
        "    log(\"${number}\")",
    );

    const output = emitJavaScript(module);
    // Every operation is an imported prelude function, and the module imports
    // each one it names: emitting a call to a name that was never imported is
    // the silent failure this whole suite exists to catch.
    const imported = output.text.match(/^import \{([^}]*)\} from "\.\/Seq\.js";$/mu)?.[1] ?? "";
    for (const operation of ["iterate", "filter", "map", "take"]) {
      expect(imported.split(/[,\s]+/u)).toContain(operation);
    }
    expect(output.text).toContain("const numbers = iterate(1, number => number + 1);");
    expect(output.text).toContain("take(map(filter(numbers,");
    expect(output.text.match(/take\(map\(filter\(numbers,/gu)).toHaveLength(2);
    // No compiler-owned generator remains for these; the only Seq machinery in
    // the module is the outbound driver `for x in` needs (ruling R3).
    expect(output.text).not.toContain("__seqIterate");
    expect(output.text).not.toContain("__seqMap");
    expect(output.text).toContain("for (const number of __seqToIterable(selected)) {");
    expect(output.text).not.toContain("__item");
    expect(emitDeclarations(module).text).toContain(
      "export declare const selected: Iterable<number>;",
    );
    expect(output.diagnostics).toEqual([]);
  });

  /**
   * A helper the emitter writes *into this module*, because a local name can
   * only collide with one that is emitted here. Which helper that is has moved
   * twice as the doors moved: the `Set` round trip below used to inline the two
   * `Seq` bridge adapters, and since #373 `stdlib/Set.hex` owns that surface, so
   * the consumer imports `fromSeq`/`toSeq`/`fromVector` and names no bridge
   * adapter at all. What it does still emit is `vectorOf`, the vector literal's
   * own lowering, which is the emitter's to write wherever a literal appears.
   *
   * The renaming rule under test is unchanged and is the point: a user symbol
   * spelled like a helper does not move, and the generated name does — Lexer §3
   * owns `__`, and only the compiler's side of it is free to shift.
   */
  test("keeps helper names clear of a user-name collision", () => {
    const module = preludeSource(
      "let values: Set(Int) = Set.fromSeq(Set.toSeq(Set.fromVector([1, 2])))\n",
    );
    const seeded: Core.Module = {
      ...module,
      symbols: module.symbols.map((symbol, index) =>
        index === 0 ? { ...symbol, name: "__vectorOf" } : symbol
      ),
    };

    const javascript = emitJavaScript(seeded).text;
    expect(javascript).toContain("function __vectorOf_1(__source)");
    expect(javascript).toContain("__vectorOf_1([1, 2])");
  });

  test("expands nested or-patterns and emits exhaustive or-pattern bindings", () => {
    const module = coreSource(
      "union Side = Left(value: Int) | Right(value: Int)\n" +
        "union Box = Box(side: Side)\n" +
        "fun unbox(box: Box): Int = match box\n" +
        "    Box(Left(value) | Right(value)) => value\n" +
        "let True | False = True\n" +
        "let Left(amount) | Right(amount) = Left(42)",
    );

    expect(module.diagnostics).toEqual([]);
    const javascript = emitJavaScript(module).text;
    expect(javascript).toContain(
      '__match.side.tag === "Left"',
    );
    expect(javascript).toContain(
      'else if (__match.tag === "Box" && __match.side.tag === "Right")',
    );
    expect(javascript).toContain("let amount;");
    expect(javascript).toContain("amount = __match_1.value;");
  });

  test("emits negative, or, and single-constructor binding patterns", () => {
    const module = coreSource(
      "union Shape = Circle(radius: Float) | Rectangle(width: Float, height: Float) | Point\n" +
        "fun measure(shape: Shape): Float = match shape\n" +
        "    Circle(size) | Rectangle(size, _) when size > 0.0 => size\n" +
        "    Circle(_) | Rectangle(_, _) => 0.0\n" +
        "    Point => 0.0\n" +
        "fun sign(value: Int): String = match value\n" +
        '    -1 => "negative one"\n' +
        '    _ => "other"\n' +
        "union UserId = UserId(value: Int)\n" +
        "let UserId(value) = UserId(42)",
    );

    expect(module.diagnostics).toEqual([]);
    const javascript = emitJavaScript(module).text;
    expect(javascript).toContain('if (__match.tag === "Circle")');
    expect(javascript).toContain('else if (__match.tag === "Rectangle")');
    expect(javascript).toContain("if (__match_1 === -1)");
    expect(javascript).toContain("const { value } = UserId(42);");
  });

  test("emits Unit, as-pattern, tuple, and record matches through ordered tests", () => {
    const unit = emitJavaScript(coreSource(
      'fun describe(value: Unit): String = match value\n    () => "unit"',
    )).text;
    expect(unit).toContain("if (__match === undefined)");

    const shape = emitJavaScript(coreSource(
      "union Shape = Circle(radius: Float) | Point\n" +
        "fun preserve(shape: Shape): Shape = match shape\n" +
        "    Circle(_) as whole => whole\n" +
        "    Point as whole => whole",
    )).text;
    expect(shape).toContain("const whole = __match;");

    const structural = emitJavaScript(coreSource(
      'fun tupleLabel(pair: (Bool, Int)): String = match pair\n' +
        '    (True, count) => "active"\n' +
        '    (_, _) => "inactive"\n' +
        'fun recordName(user: {name: String, active: Bool}): String = match user\n' +
        '    {active = True, name} => name\n' +
        '    {name} => name',
    )).text;
    expect(structural).toContain("if (__match[0] === true)");
    expect(structural).toContain("const count = __match[1];");
    expect(structural).toContain("if (__match_1.active === true)");
    expect(structural).toContain("const name = __match_1.name;");
  });

  test("emits matching record fields as JavaScript shorthand", () => {
    const module = coreSource(
      'let guest = "Mira"\nlet seats = 3\nlet reservation = {guest, seats = seats}',
    );
    expect(module.diagnostics).toEqual([]);
    expect(emitJavaScript(module).text).toContain(
      "const reservation = { guest, seats };",
    );
  });

  test("emits literal matches and guarded constructor arms in source order", () => {
    const primitive = coreSource(
      'fun describe(flag: Bool): String = match flag\n    True => "yes"\n    False => "no"',
    );
    const primitiveJavaScript = emitJavaScript(primitive).text;
    // #147: a `Bool` match is a closed-union match, so it takes the same switch
    // path every other all-nullary union takes — over the pinned representation,
    // which is why the case labels are JavaScript booleans.
    expect(primitiveJavaScript).toContain("switch (flag) {");
    expect(primitiveJavaScript).toContain("case true:");
    expect(primitiveJavaScript).toContain("case false:");

    const guarded = coreSource(
      "union Shape = Circle(radius: Float) | Point\n" +
        "fun describe(shape: Shape): String = match shape\n" +
        '    Circle(radius) when radius > 0.0 => "positive"\n' +
        '    Circle(_) => "circle"\n' +
        '    Point => "point"',
    );
    expect(guarded.diagnostics).toEqual([]);
    const guardedJavaScript = emitJavaScript(guarded).text;
    expect(guardedJavaScript).toContain(
      'if (__match.tag === "Circle")',
    );
    expect(guardedJavaScript).toContain("const radius = __match.radius;");
    expect(guardedJavaScript).toContain(
      "if (__compareFloat(radius, 0.0) > 0)",
    );
  });

  test("emits nested tuple and renamed record constructor patterns", () => {
    const module = coreSource(
      // Not `Result`/`Ok`/`Err`: the prelude owns those names here.
      "export union Outcome = Fine(value: (String, Int)) | Bad(error: {context: {message: String}, code: Int})\n" +
        "export fun describe(outcome: Outcome): String = match outcome\n" +
        "    Fine((name, _)) => name\n" +
        "    Bad({context = {message = reason}}) => reason",
    );

    expect(module.diagnostics).toEqual([]);
    const javascript = emitJavaScript(module).text;
    expect(javascript).toContain("const [name, ] = __match.value;");
    expect(javascript).toContain(
      "const { context: { message: reason } } = __match.error;",
    );
  });

  test("renders shared named record tails in TypeScript declarations", () => {
    const module = coreSource(
      'export fun rename(r: {guest: String, ...rest}): {guest: String, ...rest} = {r with guest = "Renamed"}',
    );

    expect(module.diagnostics).toEqual([]);
    expect(emitDeclarations(module).text).toContain(
      "export declare function rename<a>(r: ({ guest: string } & a)): ({ guest: string } & a);",
    );
  });

  // Products §9.2/§9.5: `{p with x = e}` emits the same spread the retired spelling did —
  // the emitter translates the idiom, so the JavaScript is byte-identical to before.
  test("emits annotated record updates and open record destructuring readably", () => {
    const module = coreSource(
      "export let origin: {x: Float, y: Float} = {x = 0.0, y = 0.0}\n" +
        "fun move(p: {x: Float, y: Float}): {x: Float, y: Float} = {p with x = p.x + 1.0}\n" +
        "let moved = move(origin)\n" +
        "let {x, y} = moved",
    );

    expect(module.diagnostics).toEqual([]);
    expect(emitJavaScript(module).text).toBe(
      "const origin = { x: 0.0, y: 0.0 };\n" +
        "function move(p) {\n" +
        "  return { ...p, x: p.x + 1.0 };\n" +
        "}\n" +
        "const moved = move(origin);\n" +
        "const { x, y } = moved;\n" +
        "export { origin };\n",
    );
    expect(emitDeclarations(module).text).toBe(
      "export declare const origin: { x: number; y: number };\n",
    );
  });

  test("emits payload unions, constructor patterns, and structural row-polymorphic records", () => {
    const module = coreSource(
      "export union Shape = Circle(radius: Float) | Point\n" +
        "fun xOf(r) = r.x\n" +
        "let point = {x = 3, y = 4}\n" +
        "let x = xOf(point)\n" +
        "export fun radius(shape: Shape): Float = match shape\n" +
        "    Circle(value) => value\n" +
        "    Point => 0.0",
    );

    expect(module.diagnostics).toEqual([]);
    expect(emitJavaScript(module).text).toContain(
      'const Circle = radius => ({ tag: "Circle", radius });',
    );
    expect(emitJavaScript(module).text).toContain("const point = { x: 3, y: 4 };");
    expect(emitJavaScript(module).text).toContain("const value = __match.radius;");
    expect(emitDeclarations(module).text).toContain(
      'export type Shape = { tag: "Circle"; radius: number } | { tag: "Point" };',
    );
  });

  test("emits generic nominal unions, constructors, matches, and declarations", () => {
    const module = coreSource(
      // Spelled `Maybe`/`Present`/`Absent`: this compiles with the prelude now,
      // and `Option`/`Some`/`None` are its names. The shapes under test — a
      // generic union, its constructors, a match, and the declarations — are
      // unchanged.
      "export union Maybe(a) = Present(value: a) | Absent\n" +
        "export fun unwrapOr(value: Maybe(a), fallback: a): a = match value\n" +
        "    Present(found) => found\n" +
        "    Absent => fallback\n" +
        "export let answer: Int = unwrapOr(Present(42), 0)",
    );

    expect(module.diagnostics).toEqual([]);
    expect(emitJavaScript(module).text).toContain(
      'const Present = value => ({ tag: "Present", value });',
    );
    expect(emitDeclarations(module).text).toBe(
      'export type Maybe<a> = { tag: "Present"; value: a } | { tag: "Absent" };\n' +
        "export declare const Present: <a>(value: a) => Maybe<a>;\n" +
        "export declare const Absent: Maybe<never>;\n" +
        "export declare function unwrapOr<a>(value: Maybe<a>, fallback: a): a;\n" +
        "export declare const answer: number;\n",
    );
  });

  test("checks generic nominal records while preserving their POJO representation", () => {
    const module = coreSource(
      "export record Box(a) = {value: a}\n" +
        "export fun get(box: Box(a)): a = box.value\n" +
        "export let answer: Box(Int) = Box({value = 42})\n" +
        "export let changed: Box(Int) = {answer with value = 43}\n" +
        "export fun expose(box: Box(Int)): {value: Int} = {...box}",
    );

    expect(module.diagnostics).toEqual([]);
    const javascript = emitJavaScript(module).text;
    expect(javascript).toContain("const Box = __record => __record;");
    expect(javascript).toContain("const answer = { value: 42 };");
    expect(javascript).toContain("const changed = { ...answer, value: 43 };");
    expect(emitDeclarations(module).text).toContain(
      "export type Box<a> = { value: a };\n" +
        "export declare const Box: <a>(record: { value: a }) => Box<a>;",
    );
    expect(emitDeclarations(module).text).toContain(
      "export declare function get<a>(box: Box<a>): a;",
    );
  });

  test("emits branded Error exceptions, throwing, and expression-valued catches", () => {
    const module = coreSource(
      "export exception ParseError(line: Int, message: String)\n" +
        "export exception Note(message: String)\n" +
        "export exception Missing\n" +
        "export fun recover(value: Int): Int = try\n" +
        "    if value < 0 then throw(ParseError(value, \"bad\")) else value\n" +
        "catch\n" +
        "    ParseError(line, _) => 0 - line\n" +
        "export fun fail(): Int = throw(Missing)",
    );

    expect(module.diagnostics).toEqual([]);
    const javascript = emitJavaScript(module).text;
    expect(javascript).toContain(
      'return Object.assign(new Error(__message), { $hex: "main", name: __name }, __fields);',
    );
    expect(javascript).toContain(
      'const ParseError = (line, message) => __exception("ParseError", message, { line, message });',
    );
    expect(javascript).toContain(
      'const Note = message => __exception("Note", message, { message });',
    );
    expect(javascript).toContain(
      '$hex === "main" && __error.name === "ParseError"',
    );
    expect(javascript).toContain("throw Missing();");
    expect(emitDeclarations(module).text).toContain(
      'export type ParseError = Error & { readonly $hex: "main"; readonly name: "ParseError"; readonly line: number; readonly message: string };',
    );
    expect(emitDeclarations(module).text).toContain(
      "export declare function Missing(): Missing;",
    );
  });

  test("executes nested and guarded catch patterns with readable fallthrough", () => {
    const output = emitJavaScript(
      coreSource(
        "union Reason = Code(Int) | Other\n" +
          "exception Wrapped(reason: Reason)\n" +
          "fun recover(value: Int): Int = try\n" +
          "    if value < 0 then throw(Wrapped(Other)) else throw(Wrapped(Code(value)))\n" +
          "catch\n" +
          "    Wrapped(Code(code)) when code > 0 => code\n" +
          "    Wrapped(Code(_)) => 0\n" +
          "    Wrapped(Other) => -1\n" +
          "let positive = recover(3)\n" +
          "let zero = recover(0)\n" +
          "let negative = recover(-1)",
      ),
    );

    expect(output.text).toContain('$hex === "main"');
    expect(output.text).toContain('.reason.tag === "Code"');
    expect(output.text).toMatch(/if \(code > 0\)/u);
    const execute = Function(
      `${output.text}\nreturn [positive, zero, negative];`,
    ) as () => readonly [number, number, number];
    expect(execute()).toEqual([3, 0, -1]);
    expect(output.diagnostics).toEqual([]);
  });

  test("implicitly rethrows an unmatched exception after nested catch tests", () => {
    const output = emitJavaScript(
      coreSource(
        "union Reason = Code(Int)\n" +
          "exception Wrapped(reason: Reason)\n" +
          "exception Missing\n" +
          "let result = try\n" +
          "    throw(Missing)\n" +
          "catch\n" +
          "    Wrapped(Code(_)) => 0",
      ),
    );

    let thrown: unknown;
    try {
      Function(output.text)();
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).name).toBe("Missing");
    expect(output.diagnostics).toEqual([]);
  });

  test("resolves nominal dot calls to subject-first companion operations", () => {
    // `translate` is exported because Method Syntax §4.2 admits only exported
    // functions to a companion's operation set, "uniformly — including inside the
    // home module itself". It used to be private here and dispatched anyway,
    // which was the by-name table's doing (#267).
    const module = coreSource(
      "export record Point = {x: Int, y: Int}\n" +
        "export fun translate(point: Point, dx: Int): Point = {point with x = point.x + dx}\n" +
        "export let shifted: Point = Point({x = 1, y = 2}).translate(3)",
    );

    expect(module.diagnostics).toEqual([]);
    expect(emitJavaScript(module).text).toContain(
      "const shifted = translate({ x: 1, y: 2 }, 3);",
    );
    expect(emitDeclarations(module).text).toContain(
      "export declare const shifted: Point;",
    );
  });

  test("emits no host console call for the retired console.log form", () => {
    // The form compiled once (#417). What replaces it is a report and the
    // uniform unknown-name recovery, so a refused call reaches JavaScript as a
    // member read on `undefined` — byte for byte what any other absent global
    // emits, and not the host spelling the retired path used to write.
    expect(emitJavaScript(coreSource('console.log("answer")')).text).toBe(
      '(undefined.log)("answer");\n',
    );
    expect(emitJavaScript(coreSource('console.warn("answer")')).text).toBe(
      '(undefined.warn)("answer");\n',
    );
  });

  test("emits tuples as arrays, positional access, and TypeScript tuple types", () => {
    const module = coreSource(
      'export let pair: (String, Int) = ("answer", 42)\n' +
        "export let answer = pair.item2",
    );

    expect(emitJavaScript(module).text).toBe(
      'const pair = ["answer", 42];\n' +
        "const answer = pair[1];\n" +
        "export { pair };\n" +
        "export { answer };\n",
    );
    expect(emitDeclarations(module).text).toBe(
      "export declare const pair: [string, number];\n" +
        "export declare const answer: number;\n",
    );
  });

  test("emits tuple patterns as readable array destructuring", () => {
    const module = coreSource(
      'let (name, _, (x, y)) = ("point", True, (3, 4))\n' +
        "let total = x + y",
    );

    expect(emitJavaScript(module).text).toBe(
      'const [name, , [x, y]] = ["point", true, [3, 4]];\n' +
        "const total = x + y;\n",
    );
    expect(emitTypeScriptPreview(module).text).toBe(
      "declare const name: string;\n" +
        "declare const x: number;\n" +
        "declare const y: number;\n" +
        "declare const total: number;\n" +
        "export {};\n",
    );
  });

  test("emits nullary unions, exhaustive matches, and declaration surfaces", () => {
    const module = coreSource(
      "export union Suit = Clubs | Diamonds | Hearts | Spades\n" +
        "export let card = (10, Hearts)\n" +
        "export let color(suit: Suit): String = match suit\n" +
        '    Clubs => "black"\n    Diamonds => "red"\n' +
        '    Hearts => "red"\n    Spades => "black"',
    );

    expect(emitJavaScript(module).text).toBe(
      'const Clubs = "Clubs";\n' +
        'const Diamonds = "Diamonds";\n' +
        'const Hearts = "Hearts";\n' +
        'const Spades = "Spades";\n' +
        "const card = [10, Hearts];\n" +
        "const color = suit => {\n" +
        "  switch (suit) {\n" +
        '    case "Clubs":\n      return "black";\n' +
        '    case "Diamonds":\n      return "red";\n' +
        '    case "Hearts":\n      return "red";\n' +
        '    case "Spades":\n      return "black";\n' +
        '    default:\n      throw new RangeError("Unexpected pattern.");\n' +
        "  }\n};\n" +
        "export { Clubs };\nexport { Diamonds };\n" +
        "export { Hearts };\nexport { Spades };\n" +
        "export { card };\nexport { color };\n",
    );
    expect(emitDeclarations(module).text).toBe(
      'export type Suit = "Clubs" | "Diamonds" | "Hearts" | "Spades";\n' +
        "export declare const Clubs: Suit;\n" +
        "export declare const Diamonds: Suit;\n" +
        "export declare const Hearts: Suit;\n" +
        "export declare const Spades: Suit;\n" +
        "export declare const card: [number, Suit];\n" +
        "export declare const color: (suit: Suit) => string;\n",
    );
  });

  test("uses a source catch-all arm instead of an unreachable-pattern guard", () => {
    const module = coreSource(
      "union Suit = Clubs | Spades\n" +
        "let color(suit: Suit): String = match suit\n" +
        '    _ => "black"',
    );

    const output = emitJavaScript(module);

    expect(output.text).toContain("switch (suit) {");
    expect(output.text).not.toContain("__match");
    expect(output.text.match(/default:/gu)).toHaveLength(1);
    expect(output.text).not.toContain("Unexpected pattern.");
    expect(output.diagnostics).toEqual([]);
  });

  test("names a scrutinee only when a match arm binds the whole value", () => {
    const module = coreSource(
      "union Suit = Clubs | Spades\n" +
        "let identity(suit: Suit): Suit = match suit\n" +
        "    whole => whole",
    );

    const output = emitJavaScript(module);

    expect(output.text).toContain("const __match = suit;");
    expect(output.text).toContain("switch (__match) {");
    expect(output.text).toContain("const whole = __match;");
    expect(output.diagnostics).toEqual([]);
  });

  test("keeps an IIFE only when a match must remain an expression", () => {
    const module = coreSource(
      "union Suit = Clubs | Spades\n" +
        "let suit = Clubs\n" +
        "let color: String = match suit\n" +
        '    Clubs => "black"\n' +
        '    Spades => "black"',
    );

    expect(emitJavaScript(module).text).toContain(
      "const color = (() => {\n" +
        "  switch (suit) {\n" +
        '    case "Clubs":\n      return "black";\n' +
        '    case "Spades":\n      return "black";\n' +
        '    default:\n      throw new RangeError("Unexpected pattern.");\n' +
        "  }\n})();",
    );
  });

  test("emits a final block match as direct control flow", () => {
    const module = coreSource(
      "union Suit = Clubs | Spades\n" +
        "let color(suit: Suit): String =\n" +
        "    let selected = suit\n" +
        "    match selected\n" +
        '        Clubs => "black"\n' +
        '        Spades => "black"',
    );

    const output = emitJavaScript(module);

    expect(output.text).toContain(
      "const color = suit => {\n" +
        "  const selected = suit;\n" +
        "  switch (selected) {",
    );
    expect(output.text).not.toContain("(() =>");
    expect(output.diagnostics).toEqual([]);
  });

  test("emits recursive fun bindings as hoisted function declarations", () => {
    const module = coreSource(
      "export fun fact(n: Int): Int = " +
        "if n <= 1 then 1 else n * fact(n - 1)",
    );
    const javascript = emitJavaScript(module);
    const declarations = emitDeclarations(module);

    expect(javascript.text).toBe(
      "function fact(n) {\n" +
        "  return n <= 1 ? 1 : n * fact(n - 1);\n" +
        "}\n" +
        "export { fact };\n",
    );
    expect(declarations.text).toBe(
      "export declare function fact(n: number): number;\n",
    );
    expect(javascript.diagnostics).toEqual([]);
    expect(declarations.diagnostics).toEqual([]);
  });

  test("emits annotated primitive exports without dictionary evidence", () => {
    const module = coreSource("export let plus(x: Int, y: Int): Int = x + y");
    const javascript = emitJavaScript(module);
    const declarations = emitDeclarations(module);

    expect(javascript.text).toBe(
      "const plus = (x, y) => x + y;\n" +
        "export { plus };\n",
    );
    expect(declarations.text).toBe(
      "export declare const plus: (x: number, y: number) => number;\n",
    );
    expect(javascript.diagnostics).toEqual([]);
    expect(declarations.diagnostics).toEqual([]);
  });

  test("emits bare, inserted, and chained pipes as ordinary calls", () => {
    const output = emitJavaScript(
      coreSource(
        "let add(x: Int, y: Int) = x + y\n" +
          "let identity = x => x\n" +
          "let bare = 1 |> identity\n" +
          "let chained = 1 |> add(2) |> add(3)",
      ),
    );

    expect(output.text).toBe(
      "const add = (x, y) => x + y;\n" +
        "const identity = x => x;\n" +
        "const bare = identity(1);\n" +
        "const chained = add(add(1, 2), 3);\n",
    );
    expect(output.diagnostics).toEqual([]);
  });

  test("keeps exported single-argument string functions readable", () => {
    const module = coreSource(
      'export let greet(name) = "Hello, " ++ name ++ "!"',
    );

    expect(emitJavaScript(module).text).toBe(
      'const greet = name => "Hello, " + name + "!";\n' +
        "export { greet };\n",
    );
    expect(emitDeclarations(module).text).toBe(
      "export declare const greet: (name: string) => string;\n",
    );
  });

  test("keeps only parentheses required by JavaScript precedence", () => {
    const output = emitJavaScript(
      coreSource(
        "let product = (1 + 2) * 3\n" +
          "let difference = 1 - (2 - 3)\n" +
          "let logic = (True or False) and True\n" +
          "let sum = 1 + 2 * 3\n" +
          "let power = (-2.0) ** 3",
      ),
    );

    expect(output.text).toBe(
      "const product = (1 + 2) * 3;\n" +
        "const difference = 1 - (2 - 3);\n" +
        "const logic = (true || false) && true;\n" +
        "const sum = 1 + 2 * 3;\n" +
        "const power = (-2.0) ** 3;\n",
    );
    expect(output.diagnostics).toEqual([]);
  });

  test("emits readable private bindings, functions, calls, and arithmetic", () => {
    const output = emitJavaScript(
      coreSource(
        "let double = x => x * 2.0\n" +
          "let answer = double(3.0) + 1.0",
      ),
    );

    expect(output.text).toBe(
      "const double = x => x * 2.0;\n" +
        "const answer = double(3.0) + 1.0;\n",
    );
    expect(output.diagnostics).toEqual([]);
  });

  test("preserves blank lines between top-level items", () => {
    const output = emitJavaScript(
      coreSource(
        "fun fact(n: Int): Int =\n" +
          "    if n <= 1 then\n" +
          "        1\n" +
          "    else\n" +
          "        n * fact(n - 1)\n\n" +
          "let answer = 6 * 7",
      ),
    );

    expect(output.text).toBe(
      "function fact(n) {\n" +
        "  return n <= 1 ? 1 : n * fact(n - 1);\n" +
        "}\n\n" +
        "const answer = 6 * 7;\n",
    );
    expect(output.diagnostics).toEqual([]);
  });

  test("preserves top-level comments and their vertical spacing", () => {
    const output = emitJavaScript(
      coreSource(
        "// Card suits are a closed set.\n" +
          "union Suit = Clubs | Diamonds | Hearts | Spades\n\n" +
          "(* A card combines ordinary product and sum types. *)\n" +
          "let card = (10, Hearts) // the ten of hearts",
      ),
    );

    expect(output.text).toBe(
      "// Card suits are a closed set.\n" +
        'const Clubs = "Clubs";\n' +
        'const Diamonds = "Diamonds";\n' +
        'const Hearts = "Hearts";\n' +
        'const Spades = "Spades";\n\n' +
        "/* A card combines ordinary product and sum types. */\n" +
        "const card = [10, Hearts]; // the ten of hearts\n",
    );
    expect(output.diagnostics).toEqual([]);
  });

  test("translates block comments into a valid JavaScript spelling", () => {
    // spec/comments.md §6: JavaScript block comments do not nest, so an interior
    // `(*`/`*)` pair rides along as inert text while a body containing `*/` — which
    // would close the emitted comment early — becomes whole lines of `//`.
    const nested = emitJavaScript(
      coreSource("(* outer (* inner *) still outer *)\nlet x = 1"),
    );
    expect(nested.text).toBe("/* outer (* inner *) still outer */\nconst x = 1;\n");

    const unsafe = emitJavaScript(
      coreSource("(* the JavaScript closer */ inside\n   a second line *)\nlet x = 1"),
    );
    expect(unsafe.text).toBe(
      "// the JavaScript closer */ inside\n//   a second line\nconst x = 1;\n",
    );
    expect(unsafe.diagnostics).toEqual([]);

    // An unterminated comment is recorded alongside its lexical error, so the
    // translation has no closer to strip and must not take one anyway.
    expect(emitJavaScript(coreSource("(* opened, never closed\nlet x = 1")).text).toBe(
      "/* opened, never closed\nlet x = 1*/\n",
    );
  });

  test("omits an empty export marker from JavaScript", () => {
    expect(emitJavaScript(coreSource("let privateValue = 42")).text).toBe(
      "const privateValue = 42;\n",
    );
    expect(emitJavaScript(coreSource("")).text).toBe("");
  });

  test("passes dictionaries through constrained function bodies", () => {
    const output = emitJavaScript(coreSource("let addOne = x => x + 1"));

    // The dictionary parameter is spelled from the signature, not from a
    // counter (#425): the binding generalizes over one variable, the face prints
    // it `a`, and `Num`'s evidence for it is `__Num_a`. The whole text is
    // asserted because the name is now predictable.
    expect(output.text).toBe(
      "const addOne = (x, __Num_a) => __Num_a.add(x, __Num_a.fromNat(1));\n",
    );
    expect(output.diagnostics).toEqual([]);
  });

  test("preserves Float intent when an integer literal resolves to Float", () => {
    const output = emitJavaScript(
      coreSource("let temperature: Float = 20\nlet mixed = 20 + 1.5"),
    );

    expect(output.text).toContain("const temperature = 20.0;");
    expect(output.text).toContain("const mixed = 20.0 + 1.5;");
    expect(output.diagnostics).toEqual([]);
  });

  test("widens established Int values through the contextual Signed target", () => {
    const output = emitJavaScript(
      coreSource(
        "let count: Int = 3\n" +
          "let cost: Float = 1.50\n" +
          "let total = count * cost\n" +
          "let doubled = (count + count) * cost\n" +
          "let affordable = count < cost\n" +
          "let exact = count + count\n" +
          "let large: BigInt = count",
      ),
    );

    expect(output.text).toContain("const total = count * cost;");
    expect(output.text).toContain("const doubled = (count + count) * cost;");
    expect(output.text).toContain(
      "const affordable = __compareFloat(count, cost) < 0;",
    );
    expect(output.text).toContain("const exact = count + count;");
    expect(output.text).toContain("const large = BigInt(count);");
    expect(output.diagnostics).toEqual([]);
  });

  test("emits Nat as an unboxed number and widens it only through Num", () => {
    const output = emitJavaScript(
      coreSource(
        "let count: Nat = 3\n" +
          "let signed: Int = 2\n" +
          "let cost: Float = 1.5\n" +
          "let signedTotal = count * signed\n" +
          "let floatTotal = count * cost\n" +
          "let large: BigInt = count",
      ),
    );

    expect(output.text).toContain("const count = 3;");
    expect(output.text).toContain("const signedTotal = count * signed;");
    expect(output.text).toContain("const floatTotal = count * cost;");
    expect(output.text).toContain("const large = BigInt(count);");
    expect(output.diagnostics).toEqual([]);
  });

  test("rejects subtraction at Nat", () => {
    const module = coreSource("let left: Nat = 3\nlet right: Nat = 2\nleft - right");

    expect(module.diagnostics.map(({ message }) => message)).toContain(
      "type `Nat` has no `Signed` instance",
    );
  });

  test("widens Int call arguments before selecting a fundamental edition", () => {
    const output = emitJavaScript(
      coreSource(
        "export let plus<a: Num>(x: a, y: a): a = x + y\n" +
          "let count: Int = 3\n" +
          "let total = plus(count, 1.5)",
      ),
    );

    expect(output.text).toContain("const total = plusFloat(count, 1.5);");
    expect(output.text).not.toContain("fromInt(count)");
    expect(output.diagnostics).toEqual([]);
  });

  test("uses Signed evidence when widening Int into an established type variable", () => {
    const output = emitJavaScript(
      coreSource(
        "let scale<a: Signed>(count: Int, value: a): a = count * value",
      ),
    );

    expect(output.text).toMatch(
      /const scale = \(count, value, (__Signed_a)\) => \1\.num\.multiply\(\1\.fromInt\(count\), value\);/u,
    );
    expect(output.diagnostics).toEqual([]);
  });

  test("executes BigInt widening through a genuine primitive Signed dictionary", async () => {
    // The dictionary is `stdlib/BigInt.hex`'s `Signed<BigInt>` since #344, so
    // the widening slot is its `fromInt` member — the door binding over
    // `BigInt(x)` — reached through an import instead of a literal built here.
    const files = [["/main.hex",
      "let scale<a: Signed>(count: Int, value: a): a = count * value\n" +
        "let count: Int = 3\n" +
        "export let result: BigInt = scale(count, 2n)\n",
    ]] as const;
    const project = compileFiles(files);

    expect(project.diagnostics).toEqual([]);
    const text = project.modules.find(({ source }) => source.path === "/main.hex")!.javascript.text;
    expect(text).not.toContain("fromInt: __a => BigInt(__a)");
    expect(text).toContain("__Signed_BigInt");
    const companion = project.modules
      .find(({ source }) => source.path.endsWith("BigInt.hex"))!.javascript.text;
    expect(companion).toContain("const nativeFromInt = __a => BigInt(__a);");
    expect((await runProject(files))["result"]).toBe(6n);
  });

  test("preserves primitive Ord semantics through genuine dictionaries", async () => {
    // The comparators are `stdlib/Float.hex`'s and `stdlib/String.hex`'s since
    // #344's last landing, so the module is linked and run rather than
    // evaluated as one text — and the semantics they carry are the ones that
    // matter: NaN is the greatest `Float`, and `String` orders by code point,
    // where the host's own `<` would put the astral character first.
    const files = [["/main.hex",
      "let before<a: Ord>(left: a, right: a): Bool = left < right\n" +
        "export let finiteBeforeNaN: Bool = before(1.0, 0.0 / 0.0)\n" +
        'export let bmpBeforeAstral: Bool = before("\\u{FFFF}", "\\u{10000}")\n',
    ]] as const;
    const project = compileFiles(files);

    expect(project.diagnostics).toEqual([]);
    const companion = (basename: string): string =>
      project.modules.find(({ source }) => source.path.endsWith(basename))!.javascript.text;
    expect(companion("Float.hex")).toContain("function __compareFloat(");
    expect(companion("String.hex")).toContain("function __compareString(");
    const exports = await runProject(files);
    expect([exports["finiteBeforeNaN"], exports["bmpBeforeAstral"]]).toEqual([true, true]);
  });

  test("selects primitive base-constraint evidence through composed dictionaries", async () => {
    // A base-constraint slot is reached through the chain the dictionary
    // carries — `Ord`'s `eq`, `Frac`'s `signed` — and since #344 that chain is
    // built in `stdlib/Float.hex` rather than at the use site. `0.0 == -0.0` is
    // the case worth executing: SameValueZero says the two zeroes agree, and a
    // dictionary that lost the base link would answer through the wrong slot.
    const files = [["/main.hex",
      "let orderedEqual<a: Ord>(left: a, right: a): Bool = left == right\n" +
        "let addRatio<a: Frac>(left: a, right: a): a = left + right\n" +
        "export let result: (Bool, Float) = (orderedEqual(0.0, -0.0), addRatio(1.5, 2.5))\n",
    ]] as const;
    const project = compileFiles(files);

    expect(project.diagnostics).toEqual([]);
    const companion = project.modules
      .find(({ source }) => source.path.endsWith("Float.hex"))!.javascript.text;
    expect(companion).toContain("eq:");
    expect(companion).toContain("signed:");
    expect((await runProject(files))["result"]).toEqual([true, 4]);
  });

  test("executes the Float division family out of its companion module", async () => {
    // The last of the three families to leave the compiler (#344). `Float.rem`
    // is `stdlib/Float.hex`'s door binding over the bare `%` and `Float.mod` is
    // the Euclidean adjustment written above it, both plain exports rather than
    // members — `Float` is not `Integral` (Integral §3), so there is no `div`,
    // `quot`, or `gcd` here and never was. The `__floatMod`/`__floatRem`
    // helpers that used to carry them are gone with the whole family.
    const files = [["/main.hex",
      "export let result: (Float, Float) = (Float.mod(-7.0, 3.0), Float.rem(-7.0, 3.0))\n",
    ]] as const;
    const project = compileFiles(files);

    expect(project.diagnostics).toEqual([]);
    const text = project.modules.find(({ source }) => source.path === "/main.hex")!.javascript.text;
    expect(text).not.toContain("__float");
    expect(text).not.toContain("__int");
    expect(text).not.toContain("__bigInt");
    expect(text).toContain('from "./Float.js"');
    expect((await runProject(files))["result"]).toEqual([2, -1]);
  });

  test("a Bool edition renders the derived instances, not the host's", async () => {
    // `Bool` is fundamental but not primitive (#147): the specialization
    // planner names its editions all the same, and with the wired table gone
    // (#344) an edition's dictionary comes from the derived walk. The retired
    // table answered `String(__a)` here — the host's `"true"` where
    // `Show<Bool>` says `"True"` — so a monomorphic edition disagreed with
    // every other spelling of the same call. This run is the agreement,
    // measured through both spellings: the ground call and the edition itself.
    const files = [["/main.hex",
      "export let describe = (<a: Show>(value: a): String => show(value))\n" +
      "export let direct: String = describe(True)\n",
    ]] as const;
    const project = compileFiles(files);
    expect(project.diagnostics).toEqual([]);
    const module = project.modules.find(({ source }) => source.path === "/main.hex")!;
    expect(module.declarations.text).toContain("describeBool");
    const exports = await runProject(files);
    expect(exports["direct"]).toBe("True");
    expect((exports["describeBool"] as (value: boolean) => string)(true)).toBe("True");
  });

  test("executes the BigInt division family out of its companion module", async () => {
    // The same conventions the row above pinned, now measured where they live:
    // `stdlib/BigInt.hex`. Linked and run rather than evaluated as one text,
    // because the emitted module imports the members' forwarders and the
    // instance dictionary (#344).
    const files = [["/main.hex",
      "export let result: (BigInt, BigInt, BigInt, BigInt, BigInt, BigInt) = (\n" +
        "    BigInt.div(7n, -3n), BigInt.mod(7n, -3n), BigInt.quot(7n, -3n),\n" +
        "    BigInt.rem(7n, -3n), BigInt.gcd(-12n, 18n), BigInt.lcm(4n, 6n))\n",
    ]] as const;
    const project = compileFiles(files);

    expect(project.diagnostics).toEqual([]);
    const text = project.modules.find(({ source }) => source.path === "/main.hex")!.javascript.text;
    expect(text).not.toContain("__bigInt");
    expect(text).toContain('from "./BigInt.js"');
    expect((await runProject(files))["result"]).toEqual([-2n, 1n, -2n, 1n, 6n, 12n]);
  });

  test("executes the Int division family out of its companion module", async () => {
    // The row the `Int` half of the original case measured, at its new home
    // (#344): `stdlib/Int.hex`. The conventions are unchanged — Euclidean
    // `div`/`mod`, truncated `quot`/`rem`, non-negative `gcd` — and no
    // `__int*` helper survives to carry them.
    const files = [["/main.hex",
      "export let result: (Int, Int, Int, Int, Int) = (\n" +
        "    Int.div(-7, 3), Int.mod(-7, 3), Int.quot(-7, 3), Int.rem(-7, 3), Int.gcd(-12, 18))\n",
    ]] as const;
    const project = compileFiles(files);

    expect(project.diagnostics).toEqual([]);
    const text = project.modules.find(({ source }) => source.path === "/main.hex")!.javascript.text;
    expect(text).not.toContain("__int");
    expect(text).toContain('from "./Int.js"');
    expect((await runProject(files))["result"]).toEqual([-3, 2, -2, -1, 6]);
  });

  test("brands integer division by zero as DivideByZeroError", async () => {
    // The guard is `stdlib/Int.hex`'s Hexagon `throw` now, above a door binding
    // that is the raw `%` (#344), so the module is linked and run rather than
    // evaluated as one text — and the error is `$hex`-branded because it is an
    // ordinary `Integral.hex` exception rather than a helper's hand-built one.
    const files = [["/main.hex", "export let boom(): Int = Int.mod(1, 0)\n"]] as const;
    const boom = (await runProject(files))["boom"] as () => unknown;
    let thrown: unknown;
    try {
      boom();
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect(thrown).toMatchObject({ name: "DivideByZeroError", $hex: "Integral" });
    expect((thrown as Error).message).toBe("Int.mod: divisor is zero");
  });

  test("passes complete Integral dictionaries through generic code", async () => {
    // No declaration in the program: `stdlib/Integral.hex` is a prelude member
    // since #335, so `Integral` and its five members arrive the way `Num` and
    // `Ord` always did, and a module-level redeclaration is now refused. What
    // is measured is unchanged — a generic body reaching `gcd`/`quot` gets a
    // dictionary carrying every member and both base-constraint slots.
    //
    // Linked and run rather than evaluated as one text, for the reason the
    // Map/Set case above is: the bare members are imports of `./Integral.js`
    // now (the declaring module emits each member as an evidence-taking
    // function), so the emitted module is a real ES module.
    const files = [["/main.hex",
      "fun normalize<a: Integral>(n: a, d: a): (a, a) =\n" +
        "    let g = gcd(n, d)\n" +
        "    let n2 = quot(n, g)\n" +
        "    let d2 = quot(d, g)\n" +
        "    (n2, d2)\n" +
        "export let result: (BigInt, BigInt) = normalize(4n, 6n)\n",
    ]] as const;
    const project = compileFiles(files);

    expect(project.diagnostics).toEqual([]);
    const text = project.modules.find(({ source }) => source.path === "/main.hex")!.javascript.text;
    // The dictionary is `stdlib/BigInt.hex`'s since #344, so what crosses into
    // this module is the import of it rather than a literal built here — which
    // is the whole of the wired row's retirement, seen from the consumer.
    expect(text).toContain("__Integral_BigInt");
    expect(text).toContain('from "./BigInt.js"');
    const companion = project.modules
      .find(({ source }) => source.path.endsWith("BigInt.hex"))!.javascript.text;
    expect(companion).toContain("gcd:");
    expect(companion).toContain("ord:");
    expect(companion).toContain("num:");
    expect((await runProject(files))["result"]).toEqual([2n, 3n]);
  });

  test("executes Rat normalization and arithmetic through Euclidean BigInt machinery", async () => {
    // Linked and run since #344: `BigInt.gcd`/`BigInt.quot` are
    // `Integral<BigInt>`'s members in `stdlib/BigInt.hex`, so the emitted
    // module imports their forwarders and the instance rather than carrying a
    // helper. `DivideByZeroError` comes from the prelude's `Integral.hex` for
    // the same reason, so the program no longer declares one.
    const files = [["/main.hex",
      "record Rat derives Eq = {top: BigInt, bottom: BigInt}\n" +
          "let create(top: BigInt, bottom: BigInt): Rat =\n" +
          "    if bottom == 0n then\n" +
          "        throw(DivideByZeroError(\"Rat.create: bottom is zero\"))\n" +
          "    else\n" +
          "        let divisor = BigInt.gcd(top, bottom)\n" +
          "        let reducedTop = BigInt.quot(top, divisor)\n" +
          "        let reducedBottom = BigInt.quot(bottom, divisor)\n" +
          "        if reducedBottom < 0n then\n" +
          "            Rat({top = -reducedTop, bottom = -reducedBottom})\n" +
          "        else\n" +
          "            Rat({top = reducedTop, bottom = reducedBottom})\n" +
          "let add(left: Rat, right: Rat): Rat =\n" +
          "    create(left.top * right.bottom + right.top * left.bottom, left.bottom * right.bottom)\n" +
          "let half = create(1n, 2n)\n" +
          "let third = create(1n, 3n)\n" +
          "let fiveSixths = add(half, third)\n" +
          "let negative = create(1n, -2n)\n" +
          "export let result: (BigInt, BigInt, Bool, BigInt, BigInt, BigInt) = " +
          "(fiveSixths.top, fiveSixths.bottom, fiveSixths == create(10n, 12n), create(0n, -99n).bottom, negative.top, negative.bottom)\n",
    ]] as const;
    const project = compileFiles(files);

    expect(project.diagnostics).toEqual([]);
    const text = project.modules.find(({ source }) => source.path === "/main.hex")!.javascript.text;
    expect(text).not.toContain("__bigInt");
    expect(text).toContain("__Integral_BigInt");
    expect((await runProject(files))["result"]).toEqual([5n, 6n, true, 1n, -1n, 2n]);
  });

  test("checks negative exponents through a genuine Pow<Int> dictionary", async () => {
    // The `checkedPower` helper is gone entirely since #344's second landing:
    // the guard is Hexagon in `stdlib/Int.hex` now, above a door binding that
    // is the raw `**`, and the exception it throws is `Pow.hex`'s declaration.
    // Same message, same name, one implementation — and a `$hex`-branded one,
    // which the helper never was. Linked and run for that reason.
    const files = [["/main.hex",
      "let raise<a: Pow>(base: a, exponent: Int): a = base ** exponent\n" +
        "export let boom(): Int = raise(2, -1)\n",
    ]] as const;
    const project = compileFiles(files);

    expect(project.diagnostics).toEqual([]);
    const text = project.modules.find(({ source }) => source.path === "/main.hex")!.javascript.text;
    expect(text).not.toContain("__checkedPower");
    expect(text).toContain("__Pow_Int");
    const boom = (await runProject(files))["boom"] as () => unknown;
    let thrown: unknown;
    try {
      boom();
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect(thrown).toMatchObject({ name: "NegativeExponentError", $hex: "Pow" });
    expect((thrown as Error).message).toBe("an integer exponent cannot be negative");
  });

  test("checks negative exponents at BigInt through the companion's own guard", async () => {
    // The same, at `BigInt`, whose companion migrated one milestone earlier
    // (#344) — the guard is `stdlib/BigInt.hex`'s and throws the same
    // `Pow.hex` exception.
    const files = [["/main.hex",
      "let raise<a: Pow>(base: a, exponent: Int): a = base ** exponent\n" +
        "export let boom(): BigInt = raise(2n, -1)\n",
    ]] as const;
    const project = compileFiles(files);

    expect(project.diagnostics).toEqual([]);
    const text = project.modules.find(({ source }) => source.path === "/main.hex")!.javascript.text;
    expect(text).not.toContain("__checkedPower");
    expect(text).toContain("__Pow_BigInt");
    const boom = (await runProject(files))["boom"] as () => unknown;
    let thrown: unknown;
    try {
      boom();
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect(thrown).toMatchObject({
      name: "NegativeExponentError",
      message: "an integer exponent cannot be negative",
      $hex: "Pow",
    });
  });

  test("calls a nominal Signed instance when widening Int into its subject", () => {
    const output = emitJavaScript(
      coreSource(
        "record Box = {value: Int}\n" +
          "let create(value: Int): Box = Box({value})\n" +
          "honor Num<Box> =\n" +
          "    add(left, right) = Box({value = left.value + right.value})\n" +
          "    multiply(left, right) = Box({value = left.value * right.value})\n" +
          "    fromNat(value) = create(value)\n" +
          "honor Signed<Box> =\n" +
          "    subtract(left, right) = Box({value = left.value - right.value})\n" +
          "    negate(box) = Box({value = -box.value})\n" +
          "    fromInt(value) = Box({value})\n" +
          "let count: Int = 3\n" +
          "let box = Box({value = 2})\n" +
          "let combined = count + box",
      ),
    );

    expect(output.text).toMatch(
      /const combined = (__Num_Box\d*)\.add\((__Signed_Box\d*)\.fromInt\(count\), box\);/u,
    );
    expect(output.diagnostics).toEqual([]);
  });

  test("does not manufacture polymorphism solely to widen an Int", () => {
    const output = emitJavaScript(
      coreSource(
        "export let plus<a: Num>(x: a, y: a): a = x + y\n" +
          "let count: Int = 3\n" +
          "let exactCall = plus(count, 1)\n" +
          "let addCount = value => plus(count, value)",
      ),
    );

    expect(output.text).toContain("const exactCall = plusInt(count, 1);");
    expect(output.text).toContain("const addCount = value => plusInt(count, value);");
    expect(output.text).not.toMatch(/const addCount = \(value, __Signed_/u);
    expect(output.diagnostics).toEqual([]);
  });

  test("emits interpolation, conditionals, and structural logic", () => {
    const output = emitJavaScript(
      coreSource(
        'let message = "value: ${1}"\n' +
          "let choose = (condition, yes, no) => if condition then yes else no\n" +
          "let implication = (a, b) => a implies b",
      ),
    );

    expect(output.text).toBe(
      'const message = "value: " + String(1);\n' +
        "const choose = (condition, yes, no) => condition ? yes : no;\n" +
        "const implication = (a, b) => !a || b;\n",
    );
    expect(output.diagnostics).toEqual([]);
  });

  // Operators §11.4: statement/`Unit` position is plain `if`/`else if`/`else`.
  // The ternary is reserved for value position, which the case above covers.
  test("emits statement-position conditionals as plain if/else", () => {
    const output = emitJavaScript(
      coreSource(
        "fun classify(value: Int): Unit =\n" +
          "    var label = \"\"\n" +
          "    if value < 0 then\n" +
          "        label := \"negative\"\n" +
          "    else if value == 0 then\n" +
          "        label := \"zero\"\n" +
          "    else\n" +
          "        let suffix = \"!\"\n" +
          "        label := \"positive\" ++ suffix\n" +
          "    label := label ++ \".\"",
      ),
    );

    expect(output.text).toBe(
      "function classify(value) {\n" +
        "  let label = \"\";\n" +
        "  if (value < 0) {\n" +
        "    label = \"negative\";\n" +
        "  } else if (value === 0) {\n" +
        "    label = \"zero\";\n" +
        "  } else {\n" +
        "    const suffix = \"!\";\n" +
        "    label = \"positive\" + suffix;\n" +
        "  }\n" +
        "  label = label + \".\";\n" +
        "}\n",
    );
    expect(output.diagnostics).toEqual([]);
  });

  // §11.4: the `else ()` the parser inserts for an else-less conditional is
  // erased — never a synthetic `else`. The conditional here is also the
  // function's tail, so the statement form leaves it falling off the end.
  test("emits an else-less conditional without an else branch", () => {
    const output = emitJavaScript(
      coreSource(
        "fun bump(flag: Bool): Unit =\n" +
          "    var count = 0\n" +
          "    if flag then count := count + 1",
      ),
    );

    expect(output.text).toBe(
      "function bump(flag) {\n" +
        "  let count = 0;\n" +
        "  if (flag) {\n" +
        "    count = count + 1;\n" +
        "  }\n" +
        "}\n",
    );
    expect(output.diagnostics).toEqual([]);
  });

  test("emits block returns and immediately called lambdas", () => {
    const output = emitJavaScript(
      coreSource(
        "let compute = () =>\n    let value = 1\n    value\n" +
          "let immediate = (x => x)(2)",
      ),
    );

    expect(output.text).toBe(
      "const compute = () => {\n" +
        "  const value = 1;\n" +
        "  return value;\n" +
        "};\n" +
        "const immediate = (x => x)(2);\n",
    );
    expect(output.diagnostics).toEqual([]);
  });

  test("preserves comparison-chain evaluation and short circuiting", () => {
    const output = emitJavaScript(coreSource("let bounded = 1 < 2 <= 3"));

    expect(output.text).toBe(
      "const bounded = (() => {\n" +
        "  const __compare = 1;\n" +
        "  const __compare_1 = 2;\n" +
        "  if (!(__compare < __compare_1)) return false;\n" +
        "  const __compare_2 = 3;\n" +
        "  return __compare_1 <= __compare_2;\n" +
        "})();\n",
    );
    expect(output.diagnostics).toEqual([]);
  });

  test("materializes semantic helpers only when required", () => {
    const output = emitJavaScript(
      coreSource("let same = 0.0 == 0.0\nlet ordered = 0.0 < 1.0"),
    );

    expect(output.text).toContain("function __floatEquals(__left, __right)");
    expect(output.text).toContain("function __compareFloat(__left, __right)");
    expect(output.text).toContain(
      "const same = __floatEquals(0.0, 0.0);",
    );
    expect(output.text).toContain(
      "const ordered = __compareFloat(0.0, 1.0) < 0;",
    );
    expect(output.diagnostics).toEqual([]);
  });

  test("emits the remaining primitive operations and generic evidence", () => {
    const output = emitJavaScript(
      coreSource(
        "let negative = -1\n" +
          "let quotient = 4.0 / 2.0\n" +
          'let joined = "a" ++ "b"\n' +
          "let powered = 2n ** 3\n" +
          "let logic = not False and True or False\n" +
          'let display = x => "${x}"\n' +
          "let equal = x => x == x",
      ),
    );

    expect(output.text).toContain("const negative = -1;");
    expect(output.text).toContain("const quotient = 4.0 / 2.0;");
    expect(output.text).toContain('const joined = "a" + "b";');
    // `**` at `BigInt` reaches `Pow<BigInt>`'s member now, whose body is the
    // negative-exponent guard over the raw native (#344) — the helper the row
    // used to name is `Int`'s alone. The exponent crosses as the plain `Int`
    // the member's seat declares (#541); it is the *member's own body* that
    // converts, because JS `**` never mixes `bigint` and `number`.
    expect(output.text).not.toContain("__checkedPower");
    expect(output.text).toContain("const powered = __Pow_BigInt.pow(2n, 3);");
    expect(output.text).toContain(
      "const logic = !false && true || false;",
    );
    expect(output.text).toMatch(
      /const display = \(x, __Show_a\) => __Show_a\.show\(x\);/u,
    );
    expect(output.text).toMatch(
      /const equal = \(x, __Eq_a\) => __Eq_a\.equals\(x, x\);/u,
    );
    expect(output.diagnostics).toEqual([]);
  });

  test("emits primitive comparison variants without changing their semantics", () => {
    const output = emitJavaScript(
      coreSource(
        "let different = 1 != 2\n" +
          'let textOrder = "a" < "b"\n' +
          "let unitOrder = () <= ()",
      ),
    );

    expect(output.text).toContain("const different = !(1 === 2);");
    expect(output.text).toContain("function __compareString(__left, __right)");
    expect(output.text).toContain(
      'const textOrder = __compareString("a", "b") < 0;',
    );
    // `Unit` ordering is the structural tuple comparison at arity 0 (#159):
    // a constant compare over the `undefined` representation, with the
    // operands kept — the retired primitive fast path discarded them, which
    // mattered for effectful operands. The constant is `"Equal"` and the test
    // is `!== "Greater"`, because a dictionary's `compare` slot answers with an
    // `Ordering` and `<=` is a constructor test on it (#275). The record itself
    // is Dictionary Sharing §3.4's hoisted module constant since #446 — ground,
    // and §9.1's reduction declines because the body names neither parameter.
    expect(output.text).toContain(
      'const __Ord_Unit = ({ compare: (__left, __right) => "Equal" });',
    );
    expect(output.text).toContain(
      'const unitOrder = __Ord_Unit.compare(undefined, undefined) !== "Greater";',
    );
    expect(output.diagnostics).toEqual([]);
  });

  test("renames JavaScript-reserved source identifiers deterministically", () => {
    const output = emitJavaScript(coreSource("let await = 1\nawait"));

    expect(output.text).toBe("const __binding0 = 1;\n__binding0;\n");
    expect(output.diagnostics).toEqual([]);
  });

  test("calls an emitted fundamental edition at a concrete constrained call site", () => {
    const output = emitJavaScript(
      coreSource("export let addOne<a: Num>(x: a): a = x + 1\naddOne(2)"),
    );

    expect(output.text).toContain("addOneInt(2);");
    expect(output.text).not.toContain("addOne(2, ({");
    expect(output.diagnostics).toEqual([]);
  });

  test("calls the emitted edition for explicit constrained binders", () => {
    const module = coreSource(
      "export let plus<a: Num>(left: a, right: a): a = left + right\n" +
        "let answer = plus(20, 22)",
    );

    expect(module.diagnostics).toEqual([]);
    const output = emitJavaScript(module);
    expect(output.text).toMatch(
      /const plus = \(left, right, __Num_a\) => __Num_a\.add\(left, right\);/u,
    );
    expect(output.text).toContain("const answer = plusInt(20, 22);");
    expect(output.text).not.toContain("const answer = plus(20, 22, ({");
    expect(output.diagnostics).toEqual([]);
  });

  test("calls a private preview edition without concrete dictionary evidence", () => {
    const output = emitJavaScript(
      coreSource(
        "let plus<a: Num>(left: a, right: a): a = left + right\n" +
          "let answer = plus(20, 22)",
      ),
      { previewPrivateSpecializations: true },
    );

    expect(output.text).toContain("const answer = plusInt(20, 22);");
    expect(output.text).not.toContain("const answer = plus(20, 22, ({");
    expect(output.diagnostics).toEqual([]);
  });

  test("keeps trailing evidence for genuinely polymorphic calls", () => {
    const output = emitJavaScript(
      coreSource(
        "export let plus<a: Num>(left: a, right: a): a = left + right\n" +
          "let double = value => plus(value, value)",
      ),
    );

    expect(output.text).toMatch(
      /const double = \(value, (__Num_a)\) => plus\(value, value, \1\);/u,
    );
    expect(output.diagnostics).toEqual([]);
  });

  test("declares user constraint members as generic dictionary dispatch", () => {
    const module = coreSource(
      "constraint Render<a> =\n" +
        "    render(value: a): String\n" +
        "let display<a: Render>(value: a): String = render(value)",
    );

    expect(module.diagnostics).toEqual([]);
    const output = emitJavaScript(module);
    expect(output.text).toMatch(
      /const render = \(value, __Render_a\) => __Render_a\.render\(value\);/u,
    );
    expect(output.text).toMatch(
      /const display = \(value, __Render_a\) => render\(value, __Render_a\);/u,
    );
    expect(output.diagnostics).toEqual([]);
  });

  test("checks ground honor declarations and selects their dictionaries", () => {
    const module = coreSource(
      "constraint Render<a> =\n" +
        "    render(value: a): String\n" +
        "record Point = {x: Int}\n" +
        "honor Render<Point> =\n" +
        '    render(point) = "Point(${point.x})"\n' +
        "let display<a: Render>(value: a): String = render(value)\n" +
        "export let text: String = display(Point({x = 3}))",
    );

    expect(module.diagnostics).toEqual([]);
    const output = emitJavaScript(module);
    // The member's implementation hoists to its own seat and the record's slot
    // references it by name (Constraints §6.1, #444).
    expect(output.text).toContain(
      'const __Render_Point_render = point => "Point(" + String(point.x) + ")";',
    );
    expect(output.text).toContain(
      "const __Render_Point = { render: __Render_Point_render };",
    );
    expect(output.text).toContain(
      "const text = display({ x: 3 }, __Render_Point);",
    );
    expect(output.diagnostics).toEqual([]);
  });

  test("emits inherited defaults through the instance dictionary", () => {
    const module = coreSource(
      "constraint Same<a> =\n" +
        "    same(left: a, right: a): Bool\n" +
        "    different(left: a, right: a): Bool = not same(left, right)\n" +
        "record Token = {value: Int}\n" +
        "honor Same<Token> =\n" +
        "    same(left, right) = left.value == right.value\n" +
        "export let changed: Bool = different(Token({value = 1}), Token({value = 2}))",
    );

    expect(module.diagnostics).toEqual([]);
    const output = emitJavaScript(module);
    expect(output.diagnostics).toEqual([]);
    // The inherited default's materialized body takes a seat of its own, like
    // every other member of the completed set (Constraints §6.1, #444): the
    // instance *has* `different`, and default-versus-override never reaches
    // emitted shape. Its body still reads the slot through the forwarder,
    // because a default is checked in the constraint's generic context and its
    // member references are dictionary reads, not name references (§4.6).
    expect(output.text).toContain(
      "const __Same_Token_different = (left, right) => !same(left, right, __Same_Token);",
    );
    expect(output.text).toContain(
      "const __Same_Token = { same: __Same_Token_same, different: __Same_Token_different };",
    );
    // The call site is concrete, so it reaches the seat directly (§6.1's
    // ground-declared-instance arm) rather than the forwarder.
    expect(output.text).toContain(
      "__Same_Token_different({ value: 1 }, { value: 2 })",
    );
    expect(output.diagnostics).toEqual([]);
  });

  test("emits base-constraint slots and selects them as generic evidence", () => {
    const module = coreSource(
      "constraint Same<a> =\n" +
        "    same(left: a, right: a): Bool\n" +
        "constraint Labeled<a: Same> =\n" +
        "    label(value: a): String\n" +
        "record Token = {value: Int}\n" +
        "honor Same<Token> =\n" +
        "    same(left, right) = left.value == right.value\n" +
        "honor Labeled<Token> =\n" +
        '    label(value) = "token"\n' +
        "fun agrees<a: Labeled>(left: a, right: a): Bool = same(left, right)\n" +
        "export let yes: Bool = agrees(Token({value = 1}), Token({value = 1}))",
    );

    expect(module.diagnostics).toEqual([]);
    const output = emitJavaScript(module);
    expect(output.diagnostics).toEqual([]);
    expect(output.text).toContain(
      "const __Labeled_Token = { same: __Same_Token, label: __Labeled_Token_label };",
    );
    expect(output.text).toContain(
      'const __Labeled_Token_label = value => "token";',
    );
    expect(output.text).toMatch(/same\(left, right, __Labeled_a\.same\)/u);
    expect(output.diagnostics).toEqual([]);
  });

  test("emits parameterized honors as dictionary factories", () => {
    const module = coreSource(
        "constraint Render<a> =\n" +
        "    render(value: a): String\n" +
        "honor Render<Int> =\n" +
        '    render(value) = "${value}"\n' +
        "record Box(a) = {value: a}\n" +
        "honor<a: Render> Render<Box(a)> =\n" +
        // The dot call is the ruled recursion spelling (Constraints §4.6): the
        // member's own name is refused in its own body, and `box.value: a`
        // dispatches through the factory's own evidence parameter.
        '    render(box) = "Box(${box.value.render()})"\n' +
        // The annotation is required, not decorative: the literal's variable
        // carries `Render` as well as `Num`, and `Render` is outside §4's
        // closed defaultable set, so nothing defaults it to `Int` — a user
        // `honor Render<Int>` deliberately does not make it defaultable.
        "let boxed: Box(Int) = Box({value = 42})\n" +
        "export let text: String = render(boxed)",
    );

    expect(module.diagnostics).toEqual([]);
    const output = emitJavaScript(module);
    expect(output.diagnostics).toEqual([]);
    expect(output.text).toMatch(
      /const __Render_Box = __Render_a => \{/u,
    );
    // Dictionary Sharing §3.1's own example (#449): the application is a
    // module-level binding, and the use site references it by name.
    expect(output.text).toContain(
      "const __Render_Box_Int = __Render_Box(__Render_Int);",
    );
    // A parameterized instance at a ground head has no evidence-free binding to
    // call — its member closes over element evidence — so Constraints §6.1's
    // second arm reads the member off the hoisted application (#444).
    expect(output.text).toContain("__Render_Box_Int.render(boxed)");
    expect(output.text).not.toContain("render(boxed, __Render_Box(");
    expect(output.diagnostics).toEqual([]);
  });

  test("threads instance evidence through pattern-bound members and recursive instances", () => {
    const module = coreSource(
      "constraint Describe<a> =\n" +
        "    describe(value: a): String\n" +
        "honor Describe<Int> =\n" +
        '    describe(value) = "${value}"\n' +
        "union Tree(a) = Leaf | Node(left: Tree(a), item: a, right: Tree(a))\n" +
        "honor<a: Describe> Describe<Tree(a)> =\n" +
        "    describe(tree) = match tree\n" +
        '        Leaf => "leaf"\n' +
        // Rewritten for #304/#335: the member's own name is refused in its own
        // body (Constraints §4.6), and the dot call is the ruled form. `left`
        // and `right` are `Tree(a)`, so they dispatch through this instance
        // under construction; `item` is the declared variable `a`, so it
        // dispatches through the binder — Method Syntax §3.4's bounds row,
        // exercised here at the rigid position that forced that row to exist
        // (§16.2's exhibit). Every expectation below is unchanged, which is the
        // point of §8.1: member dispatch emits what the bare call emitted.
        '        Node(left, item, right) => "(${left.describe()} ${item.describe()} ${right.describe()})"\n' +
        "let tree: Tree(Int) = Node(Leaf, 1, Leaf)\n" +
        "export let text: String = describe(tree)",
    );

    expect(module.diagnostics).toEqual([]);
    const output = emitJavaScript(module);
    expect(output.diagnostics).toEqual([]);
    // A pattern-bound occurrence of the instance parameter reads the factory's
    // own evidence parameter. Before the parameter was rigid, the first
    // concrete use bound it to `Int` and this evidence emitted as a primitive
    // fallback — `({})` — that threw at runtime after a clean compile.
    expect(output.text).toMatch(/describe\(item, __Describe_a\)/u);
    // The recursive occurrence is the instance record under construction
    // (Dictionary Sharing §3.2, #449). It used to re-apply the factory to that
    // same parameter — one dictionary allocated per node visited — and the
    // textual half of §11.2 is that no such application survives.
    expect(output.text).toMatch(/describe\(left, __instance\)/u);
    expect(output.text).toMatch(/describe\(right, __instance\)/u);
    expect(output.text).not.toContain("__Describe_Tree(__Describe_a)");
    // A concrete use still applies the factory to the selected element instance
    // — never passes the unapplied factory as the dictionary — but the
    // application is now the one hoisted binding of §3.1 and the use site names
    // it.
    expect(output.text).toContain(
      "const __Describe_Tree_Int = __Describe_Tree(__Describe_Int);",
    );
    expect(output.text).toContain("__Describe_Tree_Int.describe(tree)");
    expect(output.text).not.toContain("describe(tree, __Describe_Tree)");
  });

  test("resolves copied default bodies against each instance's own dictionary", () => {
    const module = coreSource(
      "union Held(a) = Missing | Held2(value: a)\n" +
        "constraint Pick<a> =\n" +
        "    pick(value: a): a\n" +
        "    pickHeld(fallback: a, held: Held(a)): a = match held\n" +
        "        Missing => fallback\n" +
        "        Held2(value) => pick(value)\n" +
        "honor Pick<Int> =\n" +
        "    pick(value) = value\n" +
        "honor Pick<String> =\n" +
        "    pick(value) = value\n" +
        "export let picked: Int = pickHeld(0, Held2(42))\n" +
        'export let name: String = pickHeld("x", Held2("y"))',
    );

    expect(module.diagnostics).toEqual([]);
    const output = emitJavaScript(module);
    expect(output.diagnostics).toEqual([]);
    // Before the constraint's subject was rigid, the first use bound it to
    // `Int`; the String instance's copied default then baked in the Int
    // dictionary, and both use sites passed no evidence at all.
    expect(output.text).toContain("pick(value, __Pick_Int)");
    expect(output.text).toContain("pick(value, __Pick_String)");
    // Both call sites are concrete, so each reaches its own instance's seat for
    // the inherited default (#444) — which is where the copy now lives.
    expect(output.text).toContain("__Pick_Int_pickHeld(0, Held2(42))");
    expect(output.text).toContain('__Pick_String_pickHeld("x", Held2("y"))');
  });

  test("expands derives headers into structural dictionaries", () => {
    const module = coreSource(
      "record Point derives Eq = {x: Int, y: Int}\n" +
        "export let same: Bool = Point({x = 1, y = 2}) == Point({x = 1, y = 2})",
    );

    expect(module.diagnostics).toEqual([]);
    const output = emitJavaScript(module);
    // A derived instance is an ordinary instance thereafter (Constraints §4.5),
    // so its generated members take seats like any others (#444).
    expect(output.text).toContain(
      "const __Eq_Point_equals = (__left, __right) => __left.x === __right.x && __left.y === __right.y;",
    );
    expect(output.text).toContain(
      "const __Eq_Point = { equals: __Eq_Point_equals, notEquals: __Eq_Point_notEquals };",
    );
    // The `==` operator is a comparison lowering, not a source-written member
    // call, so it keeps reading the slot (§6.1's last sentence).
    expect(output.text).toContain("__Eq_Point.equals(");
    expect(output.diagnostics).toEqual([]);
  });

  test("derives parameterized Eq, Ord, and Show dictionaries structurally", () => {
    const module = coreSource(
      "record Box(a) derives (Eq, Ord, Show) = {value: a}\n" +
        "export let ordered: Bool = Box({value = 2}) < Box({value = 10})\n" +
        'export let text: String = "${Box({value = 42})}"',
    );

    expect(module.diagnostics).toEqual([]);
    const output = emitJavaScript(module);
    expect(output.text).toMatch(/const __Eq_Box = __Eq_a => \{/u);
    expect(output.text).toMatch(/const __Ord_Box = __Ord_a => \{/u);
    expect(output.text).toContain("__left.value");
    expect(output.text).toContain('"{" + "value = " +');
    expect(output.diagnostics).toEqual([]);
  });

  test("erases implied type bindings while emitting their instance dictionary", () => {
    const module = coreSource(
      "constraint Source<a> =\n" +
        "    type Item\n" +
        "    get(value: a): Item\n" +
        "record Box = {value: Int}\n" +
        "honor Source<Box> =\n" +
        "    type Item = Int\n" +
        "    get(box) = box.value\n" +
        "export let answer: Int = get(Box({value = 42}))",
    );

    expect(module.diagnostics).toEqual([]);
    const output = emitJavaScript(module);
    expect(output.text).toContain("const __Source_Box_get = box => box.value;");
    expect(output.text).toContain(
      "const __Source_Box = { get: __Source_Box_get };",
    );
    expect(output.text).toContain("const answer = __Source_Box_get({ value: 42 });");
    expect(output.text).not.toContain("Item");
    expect(output.diagnostics).toEqual([]);
  });

  // 250 full compiles, emitted twice over for the determinism half: since #147 put
  // `Bool` in the prelude, every run loads the project rather than calling the
  // passes directly. That is ~3s in the full suite here and 5708ms on the runner
  // that took the Pages deploy down with it (#160, #163) — barely over the default
  // 5s budget, which had been thin since #147. Explicit per test rather than a
  // global testTimeout, so the other 680 keep the tight default.
  //
  // Raised to 60s with #344's last landing: `Float.hex` and `String.hex` joined
  // the prelude, so each of these 250 compiles carries two more modules and the
  // test measures ~25s alone against the old 30s budget — passing in isolation
  // and failing under the full suite's parallel load, which is the same thin
  // margin the note above was written about, one prelude growth later.
  test("is deterministic and bounded for arbitrary compiler input", () => {
    fc.assert(
      fc.property(fc.string(), (text) => {
        const module = coreSource(text);
        const first = emitJavaScript(module);
        const second = emitJavaScript(module);

        expect(first).toEqual(second);
        expect(first.text === "" || first.text.endsWith("\n")).toBe(true);
        for (const diagnostic of first.diagnostics) {
          expect(diagnostic.primary.start.offset).toBeGreaterThanOrEqual(0);
          expect(diagnostic.primary.end.offset).toBeLessThanOrEqual(text.length);
        }
      }),
      { numRuns: 250 },
    );
  }, 60_000);
});

describe("emitDeclarations", () => {
  test("keeps private bindings out of the declaration surface", () => {
    const output = emitDeclarations(coreSource("let privateValue = 42"));

    expect(output).toMatchObject({
      kind: "Declarations",
      text: "export {};\n",
      diagnostics: [],
    });
  });

  test("emits exported primitive and polymorphic function types", () => {
    const module = coreSource(
      "export let answer: Int = 42\n" +
        "export let identity<a>(x: a): a = x\n" +
        "export let noop(): Unit = ()",
    );
    const javascript = emitJavaScript(module);
    const declarations = emitDeclarations(module);

    expect(javascript.text).toContain("export { answer };");
    expect(javascript.text).toContain("export { identity };");
    expect(javascript.text).toContain("export { noop };");
    expect(declarations.text).toBe(
      "export declare const answer: number;\n" +
      "export declare const identity: <a>(x: a) => a;\n" +
        "export declare const noop: () => void;\n",
    );
    expect(javascript.diagnostics).toEqual([]);
    expect(declarations.diagnostics).toEqual([]);
  });

  test("maps every implemented primitive and nested function type honestly", () => {
    const declarations = emitDeclarations(
      coreSource(
        "export let ratio: Float = 1.5\n" +
          "export let flag: Bool = True\n" +
          'export let text: String = "hello"\n' +
          "export let exact: BigInt = 2n\n" +
          "export let unit: Unit = ()\n" +
          "export let apply<a, b>(f: a -> b): a -> b = x => f(x)",
      ),
    );

    expect(declarations.text).toContain("export declare const ratio: number;");
    expect(declarations.text).toContain("export declare const flag: boolean;");
    expect(declarations.text).toContain("export declare const text: string;");
    expect(declarations.text).toContain("export declare const exact: bigint;");
    expect(declarations.text).toContain("export declare const unit: undefined;");
    expect(declarations.text).toContain(
      "export declare const apply: <a, b>(f: (arg0: a) => b) => (x: a) => b;",
    );
    expect(declarations.diagnostics).toEqual([]);
  });

  test("emits declarations from explicit higher-order function annotations", () => {
    const declarations = emitDeclarations(
      coreSource(
        "export let run(callback: (Int, String) -> Bool, fallback: () -> Bool): Bool = " +
          "if callback(1, \"ok\") then True else fallback()",
      ),
    );

    expect(declarations.text).toBe(
      "export declare const run: (callback: (arg0: number, arg1: string) => boolean, fallback: () => boolean) => boolean;\n",
    );
    expect(declarations.diagnostics).toEqual([]);
  });

  test("emits direct fundamental editions for an inferred Num export", () => {
    const module = coreSource("export let plus<a: Num>(x: a, y: a): a = x + y");
    const javascript = emitJavaScript(module);
    const declarations = emitDeclarations(module);

    expect(javascript.text).toMatch(
      /const plus = \(x, y, __Num_a\) => __Num_a\.add\(x, y\);/u,
    );
    expect(javascript.text).toContain(
      "function plusNat(x, y) {\n  return x + y;\n}",
    );
    expect(javascript.text).toContain(
      "function plusInt(x, y) {\n  return x + y;\n}",
    );
    expect(javascript.text).toContain(
      "function plusFloat(x, y) {\n  return x + y;\n}",
    );
    expect(javascript.text).toContain(
      "function plusBigInt(x, y) {\n  return x + y;\n}",
    );
    expect(javascript.text).toContain("export { plusInt };");
    expect(javascript.text).toContain("export { plusNat };");
    expect(javascript.text).toContain("export { plusFloat };");
    expect(javascript.text).toContain("export { plusBigInt };");
    expect(javascript.text).not.toContain("export { plus };");
    expect(javascript.generatedSections).toMatchObject([
      { sourceName: "plus", generatedName: "plusNat", typeArguments: ["Nat"] },
      { sourceName: "plus", generatedName: "plusInt", typeArguments: ["Int"] },
      { sourceName: "plus", generatedName: "plusFloat", typeArguments: ["Float"] },
      { sourceName: "plus", generatedName: "plusBigInt", typeArguments: ["BigInt"] },
    ]);
    expect(declarations.text).toBe(
      "export declare function plusNat(x: number, y: number): number;\n" +
        "export declare function plusInt(x: number, y: number): number;\n" +
        "export declare function plusFloat(x: number, y: number): number;\n" +
        "export declare function plusBigInt(x: bigint, y: bigint): bigint;\n",
    );
    expect(javascript.diagnostics).toEqual([]);
    expect(declarations.diagnostics).toEqual([]);
  });

  test("rejects a generated specialization colliding with an explicit export", () => {
    const module = coreSource(
      "export let plusInt(x: Int, y: Int): Int = x + y\n" +
        "export let plus<a: Num>(x: a, y: a): a = x + y",
    );
    const output = emitJavaScript(module);

    expect(output.diagnostics.map(({ message }) => message)).toContain(
      "generated specialization `plusInt` conflicts with exported `plusInt`; rename one of the exports",
    );
  });

  test("specializes constrained literals and equality with concrete semantics", () => {
    const increment = emitJavaScript(
      coreSource("export let increment<a: Num>(x: a): a = x + 1"),
    );
    const equal = emitJavaScript(
      coreSource("export let equal<a: Eq>(left: a, right: a): Bool = left == right"),
    );

    expect(increment.text).toContain(
      "function incrementFloat(x) {\n  return x + 1.0;\n}",
    );
    expect(increment.text).toContain(
      "function incrementBigInt(x) {\n  return x + 1n;\n}",
    );
    expect(equal.text).toContain(
      "function equalInt(left, right) {\n  return left === right;\n}",
    );
    expect(equal.text).toContain("function equalFloat(left, right)");
    expect(equal.text).toContain("__floatEquals(left, right)");
    // The `Unit` edition is the one that reads a dictionary, and what it reads
    // is a module constant rather than an argument: `Eq<Unit>`'s `equals` names
    // neither parameter, so §9.1's reduction declines and §3.4's binding stands
    // in its place (#446). The claim below is about evidence *arriving* at an
    // edition, and this is not that.
    expect(equal.text).toContain(
      "function equalUnit(left, right) {\n  return __Eq_Unit.equals(left, right);\n}",
    );
    for (const section of [...increment.generatedSections, ...equal.generatedSections]) {
      const body = (section.sourceName === "increment" ? increment : equal).text.slice(
        section.startOffset,
        section.endOffset,
      );
      // A monomorphic edition takes no evidence *parameter*, so nothing in it is
      // spelled from the `__<Constraint>_<variable>` family the generic body
      // threads (#425) — whose second half is the source type variable's own
      // lowercase spelling, `__Eq_a`. Lowercase-stemmed helpers like
      // `__floatEquals` are not that family and are expected here, and neither
      // is `__Eq_Unit`, whose second half is a *type* spelling (§5).
      expect(body).not.toMatch(/__[A-Z][A-Za-z0-9]*_[a-z]/u);
    }
    expect(increment.diagnostics).toEqual([]);
    expect(equal.diagnostics).toEqual([]);
  });
});

describe("emitTypeScriptPreview", () => {
  test("describes private top-level bindings without exporting them", () => {
    const output = emitTypeScriptPreview(
      coreSource(
        'let greet(name) = "Hello, " ++ name\n' +
          "let plus(x: Int, y) = x + y\n" +
          "let answer = 42",
      ),
    );

    expect(output).toMatchObject({
      kind: "TypeScriptPreview",
      text:
        "declare const greet: (name: string) => string;\n" +
        "declare const plus: (x: number, y: number) => number;\n" +
        "declare const answer: number;\n" +
        "export {};\n",
      diagnostics: [],
    });
  });

  test("includes private recursive functions without exporting them", () => {
    const output = emitTypeScriptPreview(
      coreSource(
        "fun fact(n: Int): Int = if n <= 1 then 1 else n * fact(n - 1)",
      ),
    );

    expect(output.text).toBe(
      "declare function fact(n: number): number;\n" +
        "export {};\n",
    );
    expect(output.diagnostics).toEqual([]);
  });

  test("previews private fundamental editions without exporting them", () => {
    const output = emitTypeScriptPreview(
      coreSource("let plus(x, y) = x + y\nlet answer = 42"),
    );

    expect(output.text).toBe(
      "declare function plusNat(x: number, y: number): number;\n" +
        "declare function plusInt(x: number, y: number): number;\n" +
        "declare function plusFloat(x: number, y: number): number;\n" +
        "declare function plusBigInt(x: bigint, y: bigint): bigint;\n" +
        "declare const answer: number;\n" +
        "export {};\n",
    );
    expect(output.diagnostics).toEqual([]);
  });
});

// Through the whole project, prelude included. Since #147 `Bool` is a prelude
// declaration, so a module assembled by calling the passes directly cannot type
// a condition, a guard, a comparison, or a logic operator.
function coreSource(text: string): Core.Module {
  const project = compileProject([new Source.File(Source.fileId(0), "/main.hex", text)]);
  return project.modules.find((module) => module.source.path === "/main.hex")!.core;
}

/**
 * The same, but through `compileProject`, so the prelude is present.
 *
 * `Seq(a)` is a prelude *declaration* now, not a compiler intrinsic (Loops
 * §6.6), so a module assembled by calling the passes directly cannot see it —
 * the `unknown generic type \`Seq\`` such a module reports is correct, not a
 * regression. Every test that mentions `Seq` uses this instead.
 */
function preludeSource(text: string): Core.Module {
  const project = compileProject([new Source.File(Source.fileId(0), "/main.hex", text)]);
  expect(project.diagnostics).toEqual([]);
  return project.modules.find((module) => module.source.path === "/main.hex")!.core;
}

/**
 * The elements of a constructor-shaped `show` rendering, sorted.
 *
 * `Show<Map>`/`Show<Set>` render entries in the value's own iteration order
 * (Collections Part 4 §8.3), which is deterministic within one execution and
 * unspecified beyond it — so a test may assert the *format* and the *contents*
 * and never the sequence. An element is a parenthesized tuple or a bare token —
 * enough for the specimens here, and nothing more general is wanted, because a
 * real parser would start agreeing with the emitter about the format.
 */
function shownElements(rendering: string, prefix: string): readonly string[] {
  expect(rendering.startsWith(`${prefix}[`)).toBe(true);
  expect(rendering.endsWith("])")).toBe(true);
  const inner = rendering.slice(prefix.length + 1, -2);
  return [...inner.matchAll(/\([^)]*\)|[^,\s][^,]*/gu)]
    .map((match) => match[0].trim())
    .sort();
}
