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
import {
  emitDeclarations,
  emitJavaScript,
  emitTypeScriptPreview,
} from "./emitter.js";

describe("emitJavaScript", () => {
  test("emits readable extern ESM bindings, stable adapters, and opaque declarations", () => {
    const module = coreSource(
      "extern from \"tiny-json\"\n" +
        "    export type JsonValue\n" +
        "    export fun parse(text: String): JsonValue\n" +
        "    let VERSION as version: String\n" +
        "    export default fun createClient(): JsonValue\n" +
        "    fun stream(): Seq(Int)\n" +
        "    let values: Seq(Int)\n" +
        "    fun report(message: String): Unit\n" +
        "extern import \"telemetry/register\"\n" +
        "export let document = parse(version)",
    );

    expect(module.diagnostics).toEqual([]);
    const output = emitJavaScript(module);
    expect(output.text).toContain('import { parse } from "tiny-json";');
    expect(output.text).toContain('import { VERSION as version } from "tiny-json";');
    expect(output.text).toContain('import createClient from "tiny-json";');
    expect(output.text).toMatch(/import \{ stream as \w+ \} from "tiny-json";/u);
    expect(output.text).toMatch(/const stream = \(\) => __hex_seq\(\w+\(\)\);/u);
    expect(output.text).toMatch(/const values = __hex_seq\(\w+\);/u);
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
        "export let second = values[2]\n" +
        "export let window = values[2..99]\n" +
        "export let letter = \"héllo\"[2]\n" +
        "export let fingerprint = hash((values, {name: \"hex\"}))\n" +
        "export let first = match values\n" +
        "    [head, ...rest] => head\n" +
        "    [] => 0",
    );

    expect(module.diagnostics).toEqual([]);
    const output = emitJavaScript(module);
    expect(output.text).toContain("const values = [10, 20, 30];");
    expect(output.text).toContain("__hex_vectorIndex(values, 2)");
    expect(output.text).toContain("__hex_vectorSlice(values, __hex_range(2, 99))");
    expect(output.text).toContain('__hex_stringIndex("héllo", 2)');
    expect(output.text).toContain("function __hex_stableHash");
    expect(output.text).toContain(".length >= 1");
    expect(emitDeclarations(module).text).toContain("ReadonlyArray<number>");
    expect(output.diagnostics).toEqual([]);
  });

  test("emits persistent Map and Set core operations with structural key equality", () => {
    const module = coreSource(
      "let emptyMap: Map((Int, Int), String) = Map.empty()\n" +
        "export let names = Map.set(emptyMap, (1, 2), \"first\")\n" +
        "export let replaced = Map.set(names, (1, 2), \"second\")\n" +
        "export let hasPair = Map.containsKey(replaced, (1, 2))\n" +
        "let emptySet: Set((Int, Int)) = Set.empty()\n" +
        "export let pairs = Set.add(emptySet, (3, 4))\n" +
        "export let hasPair2 = Set.contains(pairs, (3, 4))",
    );

    expect(module.diagnostics).toEqual([]);
    const output = emitJavaScript(module);
    expect(output.text).toContain("const __hex_persistentCollections");
    expect(output.text).toContain("__hex_hash.eq.equals");
    expect(output.text).toContain("const insert =");
    expect(emitDeclarations(module).text).toContain("ReadonlyMap<[number, number], string>");
    expect(emitDeclarations(module).text).toContain("ReadonlySet<[number, number]>");
  });

  test("executes persistent Map and Set updates, lookup, and bracket failure", () => {
    const module = coreSource(
      "let m0: Map(Int, String) = Map.empty()\n" +
        "let m1 = Map.set(m0, 1, \"one\")\n" +
        "let m2 = Map.set(m1, 33, \"thirty-three\")\n" +
        "let m3 = Map.set(m2, 1, \"replaced\")\n" +
        "let unchanged = Map.remove(m3, 99)\n" +
        "let s0: Set(Int) = Set.empty()\n" +
        "let s1 = Set.add(Set.add(s0, 1), 33)\n" +
        "let s2 = Set.add(s1, 1)\n" +
        "let result = (m3[1], m3[33], Map.size(m0), Map.size(m3), unchanged, m3, Set.size(s2), Set.contains(s2, 33))",
    );

    expect(module.diagnostics).toEqual([]);
    const output = emitJavaScript(module);
    const execute = Function(`${output.text}\nreturn result;`) as () => unknown;
    const result = execute() as unknown[];
    expect(result.slice(0, 4)).toEqual(["replaced", "thirty-three", 0, 2]);
    expect(result[4]).toBe(result[5]);
    expect(result.slice(6)).toEqual([2, true]);

    const missingModule = coreSource(
      "let values: Map(Int, String) = Map.empty()\n" +
        "let missing = values[99]",
    );
    expect(missingModule.diagnostics).toEqual([]);
    const missingOutput = emitJavaScript(missingModule);
    expect(() => Function(missingOutput.text)()).toThrowError(
      expect.objectContaining({ name: "KeyError" }),
    );
  });

  test("provides extensional Map and Set instances and the core algebra", () => {
    const module = coreSource(
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
        "let keys = Map.keys(left)\n" +
        "let mapEvidence = mapFacts(left, right)\n" +
        "let setEvidence = setFacts(first, Set.fromVector([3, 2, 1]))\n" +
        "let result = (left == right, hash(left) == hash(right), Set.size(combined), Set.size(common), Set.size(rest), subset, keys, \"${first}\", \"${left}\", mapEvidence, setEvidence)",
    );

    expect(module.diagnostics).toEqual([]);
    const output = emitJavaScript(module);
    const execute = Function(`${output.text}\nreturn result;`) as () => unknown;
    const result = execute() as unknown[];
    expect([...result[6] as Iterable<unknown>]).toEqual([1, 2]);
    expect([...result.slice(0, 6), ...result.slice(7)]).toEqual([
      true,
      true,
      4,
      1,
      2,
      true,
      "Set.fromVector([1, 2, 3])",
      "Map.fromVector([(1, one), (2, two)])",
      [true, true],
      [true, true],
    ]);
  });

  test("iterates provided collections and concrete user Iterable instances", () => {
    const module = coreSource(
      "constraint Iterable<c> =\n" +
        "    type Item\n" +
        "    iterate(value: c): Seq(Item)\n" +
        "record Bag = {items: Seq(Int)}\n" +
        "honor Iterable<Bag> =\n" +
        "    type Item = Int\n" +
        "    iterate(bag) = bag.items\n" +
        "let bag = Bag({items: Seq.iterate(1, x => x + 1).take(2)})\n" +
        "for value in bag\n" +
        "    console.log(value)\n" +
        "for value in [1, 2]\n" +
        "    console.log(value)\n" +
        "let pairs: Map(Int, String) = Map.set(Map.empty(), 1, \"one\")\n" +
        "for (key, value) in pairs\n" +
        "    console.log(key, value)",
    );

    expect(module.diagnostics).toEqual([]);
    const output = emitJavaScript(module);
    expect(output.text).toContain("__hex_instance_Iterable_Bag.iterate(bag)");
    expect(output.text).toContain("for (const value of [1, 2])");
    expect(output.text).toContain("for (const __hex_item");
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
    expect(declarations).toContain("export declare const count: (xs: Array<number>) => number;");
    expect(declarations).toContain("export declare const keep: (value: string | null | undefined) => string | null | undefined;");
    expect(emitJavaScript(module).text).toContain("for (const __hex_item");
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
    expect(javascript).toContain("function __hex_range(__hex_start, __hex_end)");
    expect(javascript).toContain("*[Symbol.iterator]()");
    expect(javascript).toContain("let current = start;");
    expect(javascript).toContain("const visited = __hex_range(1, current);");
    expect(javascript).toContain("while (current > 0) {");
    expect(javascript).toContain("current = current - 1;");
    expect(javascript).toContain("return visited;");
  });

  test("probes generated helper names deterministically on an emitted collision", () => {
    const module = coreSource("let values = 1..2");
    const seeded: Core.Module = {
      ...module,
      symbols: module.symbols.map((symbol, index) =>
        index === 0 ? { ...symbol, name: "__hex_range" } : symbol
      ),
    };

    const javascript = emitJavaScript(seeded).text;
    expect(javascript).toContain("function __hex_range1(__hex_start, __hex_end)");
    expect(javascript).toContain("const values = __hex_range1(1, 2);");
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
        "        console.log(number)\n" +
        "    for character in \"ab\"\n" +
        "        console.log(character)",
    );

    expect(module.diagnostics).toEqual([]);
    const javascript = emitJavaScript(module).text;
    expect(javascript).toContain("for (const number of __hex_range(1, 3)) {");
    expect(javascript).toContain('for (const character of "ab") {');
    expect(javascript).not.toContain("__hex_item");
  });

  test("emits aligned multiline Seq dot calls and pipelines through JavaScript generators", () => {
    const module = coreSource(
      "let numbers: Seq(Int) = Seq.iterate(1, number => number + 1)\n" +
        "export let selected =\n" +
        "    numbers\n" +
        "    .filter(number => number > 3)\n" +
        "    .map(number => number * 2)\n" +
        "    .take(5)\n" +
        "let selected2 = numbers |> Seq.filter(number => number > 3) |> Seq.map(number => number * 2) |> Seq.take(5)\n" +
        "for number in selected\n" +
        "    console.log(number)",
    );

    expect(module.diagnostics).toEqual([]);
    const output = emitJavaScript(module);
    expect(output.text).toContain("function* ()");
    expect(output.text).toContain("*[Symbol.iterator]()");
    expect(output.text).toContain("const numbers = __hex_seqIterate(1, number => number + 1);");
    expect(output.text).toContain("__hex_seqTake(__hex_seqMap(__hex_seqFilter(numbers,");
    expect(output.text.match(/__hex_seqTake\(__hex_seqMap\(__hex_seqFilter\(numbers,/gu)).toHaveLength(2);
    expect(output.text).toContain("for (const number of selected) {");
    expect(output.text).not.toContain("__hex_item");
    expect(emitDeclarations(module).text).toContain(
      "export declare const selected: Iterable<number>;",
    );
    expect(output.diagnostics).toEqual([]);
  });

  test("probes Seq helper names consistently on a user-name collision", () => {
    const module = coreSource("let seed = 1\nlet numbers = Seq.iterate(seed, number => number + 1)");
    const seeded: Core.Module = {
      ...module,
      symbols: module.symbols.map((symbol, index) =>
        index === 0 ? { ...symbol, name: "__hex_seq" } : symbol
      ),
    };

    expect(module.diagnostics).toEqual([]);
    const javascript = emitJavaScript(seeded).text;
    expect(javascript).toContain("function __hex_seq1(__hex_source)");
    expect(javascript).toContain("return __hex_seq1((function* () {");
  });

  test("expands nested or-patterns and emits exhaustive or-pattern bindings", () => {
    const module = coreSource(
      "union Side = Left(value: Int) | Right(value: Int)\n" +
        "union Box = Box(side: Side)\n" +
        "fun unbox(box: Box): Int = match box\n" +
        "    Box(Left(value) | Right(value)) => value\n" +
        "let true | false = true\n" +
        "let Left(amount) | Right(amount) = Left(42)",
    );

    expect(module.diagnostics).toEqual([]);
    const javascript = emitJavaScript(module).text;
    expect(javascript).toContain(
      '__hex_match0.side.tag === "Left"',
    );
    expect(javascript).toContain(
      'else if (__hex_match0.tag === "Box" && __hex_match0.side.tag === "Right")',
    );
    expect(javascript).toContain("let amount;");
    expect(javascript).toContain("amount = __hex_match1.value;");
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
    expect(javascript).toContain('if (__hex_match0.tag === "Circle")');
    expect(javascript).toContain('else if (__hex_match0.tag === "Rectangle")');
    expect(javascript).toContain("if (__hex_match1 === -1)");
    expect(javascript).toContain("const { value } = UserId(42);");
  });

  test("emits Unit, as-pattern, tuple, and record matches through ordered tests", () => {
    const unit = emitJavaScript(coreSource(
      'fun describe(value: Unit): String = match value\n    () => "unit"',
    )).text;
    expect(unit).toContain("if (__hex_match0 === undefined)");

    const shape = emitJavaScript(coreSource(
      "union Shape = Circle(radius: Float) | Point\n" +
        "fun preserve(shape: Shape): Shape = match shape\n" +
        "    Circle(_) as whole => whole\n" +
        "    Point as whole => whole",
    )).text;
    expect(shape).toContain("const whole = __hex_match0;");

    const structural = emitJavaScript(coreSource(
      'fun tupleLabel(pair: (Bool, Int)): String = match pair\n' +
        '    (true, count) => "active"\n' +
        '    (_, _) => "inactive"\n' +
        'fun recordName(user: {name: String, active: Bool}): String = match user\n' +
        '    {active: true, name} => name\n' +
        '    {name} => name',
    )).text;
    expect(structural).toContain("if (__hex_match0[0] === true)");
    expect(structural).toContain("const count = __hex_match0[1];");
    expect(structural).toContain("if (__hex_match1.active === true)");
    expect(structural).toContain("const name = __hex_match1.name;");
  });

  test("emits matching record fields as JavaScript shorthand", () => {
    const module = coreSource(
      'let guest = "Mira"\nlet seats = 3\nlet reservation = {guest, seats: seats}',
    );
    expect(module.diagnostics).toEqual([]);
    expect(emitJavaScript(module).text).toContain(
      "const reservation = { guest, seats };",
    );
  });

  test("emits literal matches and guarded constructor arms in source order", () => {
    const primitive = coreSource(
      'fun describe(flag: Bool): String = match flag\n    true => "yes"\n    false => "no"',
    );
    const primitiveJavaScript = emitJavaScript(primitive).text;
    expect(primitiveJavaScript).toContain("if (__hex_match0 === true)");
    expect(primitiveJavaScript).toContain("if (__hex_match0 === false)");

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
      'if (__hex_match0.tag === "Circle")',
    );
    expect(guardedJavaScript).toContain("const radius = __hex_match0.radius;");
    expect(guardedJavaScript).toContain(
      "if (__hex_compareFloat(radius, 0.0) > 0)",
    );
  });

  test("emits nested tuple and renamed record constructor patterns", () => {
    const module = coreSource(
      "export union Result = Ok(value: (String, Int)) | Err(error: {context: {message: String}, code: Int})\n" +
        "export fun describe(result: Result): String = match result\n" +
        "    Ok((name, _)) => name\n" +
        "    Err({context: {message: reason}}) => reason",
    );

    expect(module.diagnostics).toEqual([]);
    const javascript = emitJavaScript(module).text;
    expect(javascript).toContain("const [name, ] = __hex_match0.value;");
    expect(javascript).toContain(
      "const { context: { message: reason } } = __hex_match0.error;",
    );
  });

  test("renders shared named record tails in TypeScript declarations", () => {
    const module = coreSource(
      'export fun rename(r: {guest: String, ...rest}): {guest: String, ...rest} = {...r, guest: "Renamed"}',
    );

    expect(module.diagnostics).toEqual([]);
    expect(emitDeclarations(module).text).toContain(
      "export declare function rename<a>(r: ({ guest: string } & a)): ({ guest: string } & a);",
    );
  });

  test("emits annotated record updates and open record destructuring readably", () => {
    const module = coreSource(
      "export let origin: {x: Float, y: Float} = {x: 0.0, y: 0.0}\n" +
        "fun move(p: {x: Float, y: Float}): {x: Float, y: Float} = {...p, x: p.x + 1.0}\n" +
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
        "let point = {x: 3, y: 4}\n" +
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
    expect(emitJavaScript(module).text).toContain("const value = __hex_match0.radius;");
    expect(emitDeclarations(module).text).toContain(
      'export type Shape = { tag: "Circle"; radius: number } | { tag: "Point" };',
    );
  });

  test("emits generic nominal unions, constructors, matches, and declarations", () => {
    const module = coreSource(
      "export union Option(a) = Some(value: a) | None\n" +
        "export fun unwrapOr(value: Option(a), fallback: a): a = match value\n" +
        "    Some(found) => found\n" +
        "    None => fallback\n" +
        "export let answer = unwrapOr(Some(42), 0)",
    );

    expect(module.diagnostics).toEqual([]);
    expect(emitJavaScript(module).text).toContain(
      'const Some = value => ({ tag: "Some", value });',
    );
    expect(emitDeclarations(module).text).toBe(
      'export type Option<a> = { tag: "Some"; value: a } | { tag: "None" };\n' +
        "export declare const Some: <a>(value: a) => Option<a>;\n" +
        "export declare const None: Option<never>;\n" +
        "export declare function unwrapOr<a>(value: Option<a>, fallback: a): a;\n" +
        "export declare const answer: number;\n",
    );
  });

  test("checks generic nominal records while preserving their POJO representation", () => {
    const module = coreSource(
      "export record Box(a) = {value: a}\n" +
        "export fun get(box: Box(a)): a = box.value\n" +
        "export let answer = Box({value: 42})\n" +
        "export let changed = {...answer, value: 43}\n" +
        "export fun expose(box: Box(Int)): {value: Int} = {...box}",
    );

    expect(module.diagnostics).toEqual([]);
    const javascript = emitJavaScript(module).text;
    expect(javascript).toContain("const Box = __hex_record => __hex_record;");
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
      "return Object.assign(new Error(__hex_message), { $hex: true, name: __hex_name }, __hex_fields);",
    );
    expect(javascript).toContain(
      'const ParseError = (line, message) => __hex_exception("ParseError", message, { line, message });',
    );
    expect(javascript).toContain(
      'const Note = message => __hex_exception("Note", message, { message });',
    );
    expect(javascript).toContain(
      '$hex === true && __hex_error0.name === "ParseError"',
    );
    expect(javascript).toContain("throw Missing();");
    expect(emitDeclarations(module).text).toContain(
      'export type ParseError = Error & { readonly $hex: true; readonly name: "ParseError"; readonly line: number; readonly message: string };',
    );
    expect(emitDeclarations(module).text).toContain(
      "export declare const Missing: () => Missing;",
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

    expect(output.text).toContain('$hex === true');
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
    const module = coreSource(
      "export record Point = {x: Int, y: Int}\n" +
        "fun translate(point: Point, dx: Int): Point = {...point, x: point.x + dx}\n" +
        "export let shifted = Point({x: 1, y: 2}).translate(3)",
    );

    expect(module.diagnostics).toEqual([]);
    expect(emitJavaScript(module).text).toContain(
      "const shifted = translate({ x: 1, y: 2 }, 3);",
    );
    expect(emitDeclarations(module).text).toContain(
      "export declare const shifted: Point;",
    );
  });

  test("emits the host console operation as ordinary readable JavaScript", () => {
    const module = coreSource('console.log("answer", 42, true)');

    expect(emitJavaScript(module)).toMatchObject({
      text: 'console.log("answer", 42, true);\n',
      diagnostics: [],
    });
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
      'let (name, _, (x, y)) = ("point", true, (3, 4))\n' +
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
    expect(output.text).not.toContain("__hex_match");
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

    expect(output.text).toContain("const __hex_match0 = suit;");
    expect(output.text).toContain("switch (__hex_match0) {");
    expect(output.text).toContain("const whole = __hex_match0;");
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
    const module = coreSource("export let plus(x: Int, y) = x + y");
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
          "let logic = (true or false) and true\n" +
          "let sum = 1 + 2 * 3\n" +
          "let power = (-2.0) ** 3.0",
      ),
    );

    expect(output.text).toBe(
      "const product = (1 + 2) * 3;\n" +
        "const difference = 1 - (2 - 3);\n" +
        "const logic = (true || false) && true;\n" +
        "const sum = 1 + 2 * 3;\n" +
        "const power = (-2.0) ** 3.0;\n",
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
          "    if n <= 1\n" +
          "    then 1\n" +
          "    else n * fact(n - 1)\n\n" +
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
          "/* A card combines ordinary product and sum types. */\n" +
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

  test("omits an empty export marker from JavaScript", () => {
    expect(emitJavaScript(coreSource("let privateValue = 42")).text).toBe(
      "const privateValue = 42;\n",
    );
    expect(emitJavaScript(coreSource("")).text).toBe("");
  });

  test("passes dictionaries through constrained function bodies", () => {
    const output = emitJavaScript(coreSource("let addOne = x => x + 1"));

    expect(output.text).toBe(
      "const addOne = (x, __hex_dictNum_1) => " +
        "__hex_dictNum_1.add(x, __hex_dictNum_1.fromNat(1));\n",
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
      "const affordable = __hex_compareFloat(count, cost) < 0;",
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
        "export let plus(x, y) = x + y\n" +
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
      /const scale = \(count, value, (__hex_dictSigned_\d+)\) => \1\.num\.multiply\(\1\.fromInt\(count\), value\);/u,
    );
    expect(output.diagnostics).toEqual([]);
  });

  test("executes BigInt widening through a genuine primitive Signed dictionary", () => {
    const output = emitJavaScript(
      coreSource(
        "let scale<a: Signed>(count: Int, value: a): a = count * value\n" +
          "let count: Int = 3\n" +
          "let result = scale(count, 2n)",
      ),
    );

    expect(output.text).toContain("fromInt: __hex_a => BigInt(__hex_a)");
    const execute = Function(`${output.text}\nreturn result;`) as () => bigint;
    expect(execute()).toBe(6n);
    expect(output.diagnostics).toEqual([]);
  });

  test("preserves primitive Ord semantics through genuine dictionaries", () => {
    const output = emitJavaScript(
      coreSource(
        "let before<a: Ord>(left: a, right: a): Bool = left < right\n" +
          "let finiteBeforeNaN = before(1.0, 0.0 / 0.0)\n" +
          'let bmpBeforeAstral = before("\\u{FFFF}", "\\u{10000}")',
      ),
    );

    expect(output.text).toContain("function __hex_compareFloat(");
    expect(output.text).toContain("function __hex_compareString(");
    const execute = Function(
      `${output.text}\nreturn [finiteBeforeNaN, bmpBeforeAstral];`,
    ) as () => readonly [boolean, boolean];
    expect(execute()).toEqual([true, true]);
    expect(output.diagnostics).toEqual([]);
  });

  test("selects primitive superconstraint evidence through composed dictionaries", () => {
    const output = emitJavaScript(
      coreSource(
        "let orderedEqual<a: Ord>(left: a, right: a): Bool = left == right\n" +
          "let addRatio<a: Frac>(left: a, right: a): a = left + right\n" +
          "let result = (orderedEqual(0.0, -0.0), addRatio(1.5, 2.5))",
      ),
    );

    expect(output.diagnostics).toEqual([]);
    expect(output.text).toContain("eq:");
    expect(output.text).toContain("signed:");
    const execute = Function(`${output.text}\nreturn result;`) as () => readonly unknown[];
    expect(execute()).toEqual([true, 4]);
  });

  test("executes the primitive division families with their specified conventions", () => {
    const output = emitJavaScript(
      coreSource(
        "let result = (" +
          "Int.div(-7, 3), Int.mod(-7, 3), Int.quot(-7, 3), Int.rem(-7, 3), " +
          "BigInt.div(7n, -3n), BigInt.mod(7n, -3n), BigInt.gcd(-12n, 18n), BigInt.lcm(4n, 6n), " +
          "Float.mod(-7.0, 3.0), Float.rem(-7.0, 3.0))",
      ),
    );

    expect(output.diagnostics).toEqual([]);
    expect(output.text).toContain("const __hex_bigIntGcd");
    expect(output.text).toContain("const __hex_bigIntLcm");
    expect(output.text).not.toContain("const __hex_bigIntRem");
    const execute = Function(`${output.text}\nreturn result;`) as () => readonly unknown[];
    expect(execute()).toEqual([-3, 2, -2, -1, -2n, 1n, 6n, 12n, 2, -1]);
  });

  test("brands integer division by zero as DivideByZeroError", () => {
    const output = emitJavaScript(coreSource("Int.mod(1, 0)"));
    let thrown: unknown;
    try {
      Function(output.text)();
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect(thrown).toMatchObject({ name: "DivideByZeroError", $hex: true });
  });

  test("passes complete Integral dictionaries through generic code", () => {
    const output = emitJavaScript(
      coreSource(
        "constraint Integral<a: (Num, Ord)> =\n" +
          "    div(x: a, y: a): a\n" +
          "    mod(x: a, y: a): a\n" +
          "    quot(x: a, y: a): a\n" +
          "    rem(x: a, y: a): a\n" +
          "    gcd(x: a, y: a): a\n" +
          "fun normalize<a: Integral>(n: a, d: a): (a, a) =\n" +
          "    let g = gcd(n, d)\n" +
          "    let n2 = quot(n, g)\n" +
          "    let d2 = quot(d, g)\n" +
          "    (n2, d2)\n" +
          "let result = normalize(4n, 6n)",
      ),
    );

    expect(output.diagnostics).toEqual([]);
    expect(output.text).toContain("gcd:");
    expect(output.text).toContain("ord:");
    expect(output.text).toContain("num:");
    const execute = Function(`${output.text}\nreturn result;`) as () => readonly bigint[];
    expect(execute()).toEqual([2n, 3n]);
  });

  test("executes Rat normalization and arithmetic through Euclidean BigInt machinery", () => {
    const output = emitJavaScript(
      coreSource(
        "record Rat derives Eq = {top: BigInt, bottom: BigInt}\n" +
          "exception DivideByZeroError(message: String)\n" +
          "let create(top: BigInt, bottom: BigInt): Rat =\n" +
          "    if bottom == 0n\n" +
          "        throw(DivideByZeroError(\"Rat.create: bottom is zero\"))\n" +
          "    else\n" +
          "        let divisor = BigInt.gcd(top, bottom)\n" +
          "        let reducedTop = BigInt.quot(top, divisor)\n" +
          "        let reducedBottom = BigInt.quot(bottom, divisor)\n" +
          "        if reducedBottom < 0n\n" +
          "            Rat({top: -reducedTop, bottom: -reducedBottom})\n" +
          "        else Rat({top: reducedTop, bottom: reducedBottom})\n" +
          "let add(left: Rat, right: Rat): Rat =\n" +
          "    create(left.top * right.bottom + right.top * left.bottom, left.bottom * right.bottom)\n" +
          "let half = create(1n, 2n)\n" +
          "let third = create(1n, 3n)\n" +
          "let fiveSixths = add(half, third)\n" +
          "let negative = create(1n, -2n)\n" +
          "let result = (fiveSixths.top, fiveSixths.bottom, fiveSixths == create(10n, 12n), create(0n, -99n).bottom, negative.top, negative.bottom)",
      ),
    );

    expect(output.diagnostics).toEqual([]);
    expect(output.text).toContain("const __hex_bigIntGcd");
    expect(output.text).toContain("const __hex_bigIntQuot");
    expect(output.text).not.toContain("const __hex_bigIntLcm");
    const execute = Function(`${output.text}\nreturn result;`) as () => readonly unknown[];
    expect(execute()).toEqual([5n, 6n, true, 1n, -1n, 2n]);
  });

  test.each([
    ["Int", "2", "-1"],
    ["BigInt", "2n", "-1n"],
  ])(
    "checks negative exponents through a genuine Pow<%s> dictionary",
    (_, base, exponent) => {
      const output = emitJavaScript(
        coreSource(
          "let raise<a: Pow>(base: a, exponent: a): a = base ** exponent\n" +
            `let result = raise(${base}, ${exponent})`,
        ),
      );

      expect(output.text).toContain("function __hex_checkedPower(");
      let thrown: unknown;
      try {
        Function(output.text)();
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(Error);
      expect((thrown as Error).name).toBe("NegativeExponentError");
      expect(output.diagnostics).toEqual([]);
    },
  );

  test("calls a nominal Signed instance when widening Int into its subject", () => {
    const output = emitJavaScript(
      coreSource(
        "record Box = {value: Int}\n" +
          "let create(value: Int): Box = Box({value})\n" +
          "honor Num<Box> =\n" +
          "    add(left, right) = Box({value: left.value + right.value})\n" +
          "    multiply(left, right) = Box({value: left.value * right.value})\n" +
          "    fromNat(value) = create(value)\n" +
          "honor Signed<Box> =\n" +
          "    subtract(left, right) = Box({value: left.value - right.value})\n" +
          "    negate(box) = Box({value: -box.value})\n" +
          "    fromInt(value) = Box({value})\n" +
          "let count: Int = 3\n" +
          "let box = Box({value: 2})\n" +
          "let combined = count + box",
      ),
    );

    expect(output.text).toMatch(
      /const combined = (__hex_instance_Num_Box\d*)\.add\((__hex_instance_Signed_Box\d*)\.fromInt\(count\), box\);/u,
    );
    expect(output.diagnostics).toEqual([]);
  });

  test("does not manufacture polymorphism solely to widen an Int", () => {
    const output = emitJavaScript(
      coreSource(
        "export let plus(x, y) = x + y\n" +
          "let count: Int = 3\n" +
          "let exactCall = plus(count, 1)\n" +
          "let addCount = value => plus(count, value)",
      ),
    );

    expect(output.text).toContain("const exactCall = plusInt(count, 1);");
    expect(output.text).toContain("const addCount = value => plusInt(count, value);");
    expect(output.text).not.toMatch(/const addCount = \(value, __hex_dictSigned_/u);
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
        "  const __hex_compare0 = 1;\n" +
        "  const __hex_compare1 = 2;\n" +
        "  if (!(__hex_compare0 < __hex_compare1)) return false;\n" +
        "  const __hex_compare2 = 3;\n" +
        "  return __hex_compare1 <= __hex_compare2;\n" +
        "})();\n",
    );
    expect(output.diagnostics).toEqual([]);
  });

  test("materializes semantic helpers only when required", () => {
    const output = emitJavaScript(
      coreSource("let same = 0.0 == 0.0\nlet ordered = 0.0 < 1.0"),
    );

    expect(output.text).toContain("function __hex_floatEquals(__hex_left, __hex_right)");
    expect(output.text).toContain("function __hex_compareFloat(__hex_left, __hex_right)");
    expect(output.text).toContain(
      "const same = __hex_floatEquals(0.0, 0.0);",
    );
    expect(output.text).toContain(
      "const ordered = __hex_compareFloat(0.0, 1.0) < 0;",
    );
    expect(output.diagnostics).toEqual([]);
  });

  test("emits the remaining primitive operations and generic evidence", () => {
    const output = emitJavaScript(
      coreSource(
        "let negative = -1\n" +
          "let quotient = 4.0 / 2.0\n" +
          'let joined = "a" ++ "b"\n' +
          "let powered = 2n ** 3n\n" +
          "let logic = not false and true or false\n" +
          'let display = x => "${x}"\n' +
          "let equal = x => x == x",
      ),
    );

    expect(output.text).toContain("const negative = -1;");
    expect(output.text).toContain("const quotient = 4.0 / 2.0;");
    expect(output.text).toContain('const joined = "a" + "b";');
    expect(output.text).toContain("function __hex_checkedPower(__hex_base, __hex_exponent)");
    expect(output.text).toContain("const powered = __hex_checkedPower(2n, 3n);");
    expect(output.text).toContain(
      "const logic = !false && true || false;",
    );
    expect(output.text).toMatch(
      /const display = \(x, __hex_dictShow_\d+\) => __hex_dictShow_\d+\.show\(x\);/u,
    );
    expect(output.text).toMatch(
      /const equal = \(x, __hex_dictEq_\d+\) => __hex_dictEq_\d+\.equals\(x, x\);/u,
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
    expect(output.text).toContain("function __hex_compareString(__hex_left, __hex_right)");
    expect(output.text).toContain(
      'const textOrder = __hex_compareString("a", "b") < 0;',
    );
    expect(output.text).toContain("const unitOrder = 0 <= 0;");
    expect(output.diagnostics).toEqual([]);
  });

  test("renames JavaScript-reserved source identifiers deterministically", () => {
    const output = emitJavaScript(coreSource("let await = 1\nawait"));

    expect(output.text).toBe("const __hex_binding0 = 1;\n__hex_binding0;\n");
    expect(output.diagnostics).toEqual([]);
  });

  test("calls an emitted fundamental edition at a concrete constrained call site", () => {
    const output = emitJavaScript(
      coreSource("export let addOne = x => x + 1\naddOne(2)"),
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
      /const plus = \(left, right, __hex_dictNum_\d+\) => __hex_dictNum_\d+\.add\(left, right\);/u,
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
      /const double = \(value, (__hex_dictNum_\d+)\) => plus\(value, value, \1\);/u,
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
      /const render = \(value, __hex_dictRender_\d+\) => __hex_dictRender_\d+\.render\(value\);/u,
    );
    expect(output.text).toMatch(
      /const display = \(value, __hex_dictRender_\d+\) => render\(value, __hex_dictRender_\d+\);/u,
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
        "export let text = display(Point({x: 3}))",
    );

    expect(module.diagnostics).toEqual([]);
    const output = emitJavaScript(module);
    expect(output.text).toContain(
      'const __hex_instance_Render_Point = { render: point => "Point(" + String(point.x) + ")" };',
    );
    expect(output.text).toContain(
      "const text = display({ x: 3 }, __hex_instance_Render_Point);",
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
        "export let changed = different(Token({value: 1}), Token({value: 2}))",
    );

    expect(module.diagnostics).toEqual([]);
    const output = emitJavaScript(module);
    expect(output.diagnostics).toEqual([]);
    expect(output.text).toContain(
      "different: (left, right) => !same(left, right, __hex_instance_Same_Token)",
    );
    expect(output.text).toContain(
      "different({ value: 1 }, { value: 2 }, __hex_instance_Same_Token)",
    );
    expect(output.diagnostics).toEqual([]);
  });

  test("emits superconstraint slots and selects them as generic evidence", () => {
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
        "export let yes = agrees(Token({value: 1}), Token({value: 1}))",
    );

    expect(module.diagnostics).toEqual([]);
    const output = emitJavaScript(module);
    expect(output.diagnostics).toEqual([]);
    expect(output.text).toContain(
      "const __hex_instance_Labeled_Token = { same: __hex_instance_Same_Token, label: value => \"token\" };",
    );
    expect(output.text).toMatch(/same\(left, right, __hex_dictLabeled_\d+\.same\)/u);
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
        '    render(box) = "Box(${render(box.value)})"\n' +
        "export let text = render(Box({value: 42}))",
    );

    expect(module.diagnostics).toEqual([]);
    const output = emitJavaScript(module);
    expect(output.diagnostics).toEqual([]);
    expect(output.text).toMatch(
      /const __hex_instance_Render_Box = __hex_dictRender_\d+ => \{/u,
    );
    expect(output.text).toContain(
      "__hex_instance_Render_Box(__hex_instance_Render_Int)",
    );
    expect(output.diagnostics).toEqual([]);
  });

  test("expands derives headers into structural dictionaries", () => {
    const module = coreSource(
      "record Point derives Eq = {x: Int, y: Int}\n" +
        "export let same = Point({x: 1, y: 2}) == Point({x: 1, y: 2})",
    );

    expect(module.diagnostics).toEqual([]);
    const output = emitJavaScript(module);
    expect(output.text).toContain(
      "const __hex_instance_Eq_Point = { equals: (__hex_left, __hex_right) => __hex_left.x === __hex_right.x && __hex_left.y === __hex_right.y",
    );
    expect(output.text).toContain("__hex_instance_Eq_Point.equals(");
    expect(output.diagnostics).toEqual([]);
  });

  test("derives parameterized Eq, Ord, and Show dictionaries structurally", () => {
    const module = coreSource(
      "record Box(a) derives (Eq, Ord, Show) = {value: a}\n" +
        "export let ordered = Box({value: 2}) < Box({value: 10})\n" +
        'export let text = "${Box({value: 42})}"',
    );

    expect(module.diagnostics).toEqual([]);
    const output = emitJavaScript(module);
    expect(output.text).toMatch(/const __hex_instance_Eq_Box = __hex_dictEq_\d+ => \{/u);
    expect(output.text).toMatch(/const __hex_instance_Ord_Box = __hex_dictOrd_\d+ => \{/u);
    expect(output.text).toContain("__hex_left.value");
    expect(output.text).toContain('"{" + "value: " +');
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
        "export let answer: Int = get(Box({value: 42}))",
    );

    expect(module.diagnostics).toEqual([]);
    const output = emitJavaScript(module);
    expect(output.text).toContain(
      "const __hex_instance_Source_Box = { get: box => box.value };",
    );
    expect(output.text).toContain(
      "const answer = get({ value: 42 }, __hex_instance_Source_Box);",
    );
    expect(output.text).not.toContain("Item");
    expect(output.diagnostics).toEqual([]);
  });

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
  });
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
      "export let answer = 42\n" +
        "export let identity = x => x\n" +
        "export let noop = () => ()",
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
        "export let ratio = 1.5\n" +
          "export let flag = true\n" +
          'export let text = "hello"\n' +
          "export let exact = 2n\n" +
          "export let unit = ()\n" +
          "export let apply = f => x => f(x)",
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
          "if callback(1, \"ok\") then true else fallback()",
      ),
    );

    expect(declarations.text).toBe(
      "export declare const run: (callback: (arg0: number, arg1: string) => boolean, fallback: () => boolean) => boolean;\n",
    );
    expect(declarations.diagnostics).toEqual([]);
  });

  test("emits direct fundamental editions for an inferred Num export", () => {
    const module = coreSource("export let plus(x, y) = x + y");
    const javascript = emitJavaScript(module);
    const declarations = emitDeclarations(module);

    expect(javascript.text).toMatch(
      /const plus = \(x, y, __hex_dictNum_\d+\) => __hex_dictNum_\d+\.add\(x, y\);/u,
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
        "export let plus(x, y) = x + y",
    );
    const output = emitJavaScript(module);

    expect(output.diagnostics.map(({ message }) => message)).toContain(
      "generated specialization `plusInt` conflicts with exported `plusInt`; rename one of the exports",
    );
  });

  test("specializes constrained literals and equality with concrete semantics", () => {
    const increment = emitJavaScript(
      coreSource("export let increment(x) = x + 1"),
    );
    const equal = emitJavaScript(
      coreSource("export let equal(left, right) = left == right"),
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
    expect(equal.text).toContain("__hex_floatEquals(left, right)");
    for (const section of [...increment.generatedSections, ...equal.generatedSections]) {
      const body = (section.sourceName === "increment" ? increment : equal).text.slice(
        section.startOffset,
        section.endOffset,
      );
      expect(body).not.toContain("__hex_dict");
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

function coreSource(text: string): Core.Module {
  const source = new Source.File(Source.fileId(0), "test.hex", text);
  return elaborate(check(resolve(parse(applyLayout(lex(source))))));
}
