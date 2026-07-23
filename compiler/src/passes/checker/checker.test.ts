import fc from "fast-check";
import { describe, expect, test } from "vitest";

import * as Source from "../../support/source.js";
import type * as Typed from "../../syntax/typed/index.js";
import { applyLayout } from "../layout/layout.js";
import { lex } from "../lexer/lexer.js";
import { parse } from "../parser/parser.js";
import { resolve } from "../resolver/resolver.js";
import { check } from "./checker.js";

describe("check", () => {
  test("checks monomorphic extern schemes and opaque foreign types", () => {
    const module = checkSource(
      "extern from \"tiny-json\"\n" +
        "    export type JsonValue\n" +
        "    export fun parse(text: String): JsonValue\n" +
        "    let VERSION as version: String\n" +
        "let document = parse(version)",
    );

    expect(letSymbol(module, "document").scheme.type).toMatchObject({
      kind: "ExternType",
      name: "JsonValue",
    });
    expect(module.diagnostics).toEqual([]);
  });

  test("rejects generic externs and adapter-requiring nested positions", () => {
    const module = checkSource(
      "extern from \"streams\"\n" +
        "    fun generic(value: a): a\n" +
        "    fun nested(): Array(Seq(Int))\n" +
        "    fun callback(run: (() -> Seq(Int))): Unit",
    );
    const messages = module.diagnostics.map(({ message }) => message);

    expect(messages).toContain("generic extern declarations are not part of Hexagon v1");
    expect(messages.filter((message) => message.includes("requires adaptation inside a direct value"))).toHaveLength(2);
  });
  test("expands order-independent aliases and checks mutual recursion", () => {
    const module = checkSource(
      "type Coordinates = Point\n" +
        "record Point = {x: Int, y: Int}\n" +
        "type Pair(a) = (a, a)\n" +
        "fun even(n: Int): Bool = if n == 0 then true else odd(n - 1)\n" +
        "fun odd(n: Int): Bool = if n == 0 then false else even(n - 1)\n" +
        "let origin: Coordinates = Point({x: 0, y: 0})\n" +
        "let flags: Pair(Bool) = (even(4), odd(3))",
    );

    expect(module.diagnostics).toEqual([]);
    expect(letSymbol(module, "origin").scheme.type).toMatchObject({ kind: "NominalRecord", name: "Point" });
    expect(letSymbol(module, "flags").scheme.type).toMatchObject({
      kind: "Tuple",
      elements: [{ name: "Bool" }, { name: "Bool" }],
    });
  });

  test("rejects recursive aliases, unused parameters, and private public types", () => {
    const module = checkSource(
      "type Loop = Loop\n" +
        "type Unused(a) = Int\n" +
        "record Secret = {value: Int}\n" +
        "export fun reveal(secret: Secret): Int = secret.value",
    );
    const messages = module.diagnostics.map(({ message }) => message);
    expect(messages.some((message) => message.startsWith("recursive type alias cycle:"))).toBe(true);
    expect(messages).toContain("type parameter `a` is not used by alias `Unused`");
    expect(messages).toContain(
      "exported binding `reveal` exposes private type `Secret`; export the type, perhaps opaquely, or keep the binding private",
    );
  });

  test("tracks refutable constructor payloads before marking a case covered", () => {
    const complete = checkSource(
      "union Flagged = Flagged(value: Bool) | Empty\n" +
        "fun describe(flagged: Flagged): String = match flagged\n" +
        '    Flagged(true) => "yes"\n' +
        '    Flagged(false) => "no"\n' +
        '    Empty => "empty"',
    );
    expect(complete.diagnostics).toEqual([]);

    const incomplete = checkSource(
      "union Flagged = Flagged(value: Bool) | Empty\n" +
        "fun describe(flagged: Flagged): String = match flagged\n" +
        '    Flagged(true) => "yes"\n' +
        '    Empty => "empty"',
    );
    expect(incomplete.diagnostics.map(({ message }) => message)).toContain(
      "match is missing cases: `Flagged`",
    );

    const unreachable = checkSource(
      "union Flagged = Flagged(value: Bool) | Empty\n" +
        "fun describe(flagged: Flagged): String = match flagged\n" +
        '    Flagged(true) => "yes"\n' +
        '    Flagged(false) => "no"\n' +
        '    Flagged(_) => "impossible"\n' +
        '    Empty => "empty"',
    );
    expect(unreachable.diagnostics.map(({ message }) => message)).toContain(
      "this case is unreachable; `Flagged` is already handled above",
    );
  });

  test("checks nested or-patterns and exhaustive or-pattern let bindings", () => {
    const module = checkSource(
      "union Side = Left(value: Int) | Right(value: Int)\n" +
        "union Box = Box(side: Side)\n" +
        "fun unbox(box: Box): Int = match box\n" +
        "    Box(Left(value) | Right(value)) => value\n" +
        "let true | false = true\n" +
        "let Left(amount) | Right(amount) = Left(42)\n" +
        "let answer = amount",
    );

    expect(module.diagnostics).toEqual([]);
    expect(letSymbol(module, "answer").scheme.type).toMatchObject({
      kind: "Primitive",
      name: "Int",
    });

    const incomplete = checkSource("let true | true = false");
    expect(incomplete.diagnostics.map(({ message }) => message)).toContain(
      "this or-pattern does not cover every possible value and cannot be used in `let`; use `match`",
    );
  });

  test("checks negative integer and top-level or-pattern coverage", () => {
    const module = checkSource(
      "union Shape = Circle(radius: Float) | Rectangle(width: Float, height: Float) | Point\n" +
        "fun measure(shape: Shape): Float = match shape\n" +
        "    Circle(size) | Rectangle(size, _) when size > 0.0 => size\n" +
        "    Circle(_) | Rectangle(_, _) => 0.0\n" +
        "    Point => 0.0\n" +
        "fun sign(value: Int): String = match value\n" +
        '    -1 => "negative one"\n' +
        '    _ => "other"',
    );

    expect(module.diagnostics).toEqual([]);
    const sizes = module.symbols.filter(({ name }) => name === "size");
    expect(sizes).toHaveLength(1);
    expect(sizes[0]?.scheme.type).toMatchObject({
      kind: "Primitive",
      name: "Float",
    });

    const mismatched = checkSource(
      "union Shape = Circle(radius: Float) | Point\n" +
        "fun measure(shape: Shape): Float = match shape\n" +
        "    Circle(radius) | Point => radius\n" +
        "    _ => 0.0",
    );
    expect(mismatched.diagnostics.map(({ message }) => message)).toContain(
      "`radius` must be bound in every alternative of an or-pattern",
    );
  });

  test("allows irrefutable single-constructor union patterns in let bindings", () => {
    const module = checkSource(
      "union UserId = UserId(value: Int)\n" +
        "let UserId(value) = UserId(42)\n" +
        "let answer = value",
    );

    expect(module.diagnostics).toEqual([]);
    expect(letSymbol(module, "answer").scheme.type).toMatchObject({
      kind: "Primitive",
      name: "Int",
    });

    const refutable = checkSource(
      "union Maybe = Some(value: Int) | None\n" +
        "let Some(value) = Some(42)",
    );
    expect(refutable.diagnostics.map(({ message }) => message)).toContain(
      "a constructor pattern is refutable and cannot be used in `let`",
    );
  });

  test("checks Unit patterns as exhaustive and irrefutable", () => {
    const module = checkSource(
      'fun describe(value: Unit): String = match value\n    () => "unit"\n' +
        "let () = ()",
    );
    expect(module.diagnostics).toEqual([]);
  });

  test("checks as-patterns and binds the whole matched value", () => {
    const module = checkSource(
      "union Shape = Circle(radius: Float) | Point\n" +
        "fun preserve(shape: Shape): Shape = match shape\n" +
        "    Circle(_) as whole => whole\n" +
        "    Point as whole => whole",
    );

    expect(module.diagnostics).toEqual([]);
    const wholes = module.symbols.filter(({ name }) => name === "whole");
    expect(wholes).toHaveLength(2);
    expect(wholes.every(({ scheme }) => scheme.type.kind === "Union")).toBe(true);
  });

  test("matches tuple and structural-record scrutinees directly", () => {
    const module = checkSource(
      'fun tupleLabel(pair: (Bool, Int)): String = match pair\n' +
        '    (true, count) => "active"\n' +
        '    (_, _) => "inactive"\n' +
        'fun recordName(user: {name: String, active: Bool}): String = match user\n' +
        '    {active: true, name} => name\n' +
        '    {name} => name',
    );

    expect(module.diagnostics).toEqual([]);

    const incomplete = checkSource(
      'fun tupleLabel(pair: (Bool, Int)): String = match pair\n    (true, _) => "active"',
    );
    expect(incomplete.diagnostics.map(({ message }) => message)).toContain(
      "match on `(Bool, Int)` needs a catch-all structural pattern",
    );
  });

  test("infers punned record construction fields", () => {
    const module = checkSource(
      'let guest = "Mira"\nlet seats = 3\nlet reservation = {guest, seats}',
    );

    expect(module.diagnostics).toEqual([]);
    expect(letSymbol(module, "reservation").scheme.type).toMatchObject({
      kind: "Record",
      fields: [
        { name: "guest", type: { kind: "Primitive", name: "String" } },
        { name: "seats", type: { kind: "Primitive", name: "Int" } },
      ],
    });
  });

  test("checks exhaustive Bool literal matches and catch-alls for infinite primitives", () => {
    const module = checkSource(
      'fun describe(flag: Bool): String = match flag\n    true => "yes"\n    false => "no"\n' +
        'fun count(n: Int): String = match n\n    0 => "none"\n    1 => "one"\n    _ => "many"',
    );
    expect(module.diagnostics).toEqual([]);

    const strings = checkSource(
      'fun agrees(answer: String): Bool = match answer\n    "yes" => true\n    _ => false',
    );
    expect(strings.diagnostics).toEqual([]);

    const incomplete = checkSource(
      'fun count(n: Int): String = match n\n    0 => "none"',
    );
    expect(incomplete.diagnostics.map(({ message }) => message)).toContain(
      "a match on `Int` needs a catch-all pattern",
    );
  });

  test("checks guards after pattern bindings without counting them as coverage", () => {
    const module = checkSource(
      "union Shape = Circle(radius: Float) | Point\n" +
        "fun describe(shape: Shape): String = match shape\n" +
        '    Circle(radius) when radius > 0.0 => "positive"\n' +
        '    Circle(_) => "circle"\n' +
        '    Point => "point"',
    );
    expect(module.diagnostics).toEqual([]);

    const guardedOnly = checkSource(
      'fun describe(flag: Bool): String = match flag\n    true when flag => "yes"\n    false => "no"',
    );
    expect(guardedOnly.diagnostics.map(({ message }) => message)).toContain(
      "match is missing case `true`",
    );

    const wrongGuard = checkSource(
      'fun describe(flag: Bool): String = match flag\n    true when 1 => "yes"\n    _ => "no"',
    );
    expect(wrongGuard.diagnostics.map(({ message }) => message)).toContain(
      "integer literal cannot have type `Bool`",
    );
  });

  test("preserves a named record tail between parameter and result annotations", () => {
    const module = checkSource(
      'fun rename(r: {guest: String, ...rest}): {guest: String, ...rest} = {...r, guest: "Renamed"}\n' +
        'let updated = rename({guest: "Mira", seats: 3})\n' +
        "let seats = updated.seats",
    );

    expect(module.diagnostics).toEqual([]);
    expect(typeName(letSymbol(module, "seats").scheme.type)).toBe("Int");
  });

  test("checks nested tuple and renamed record patterns in constructor payloads", () => {
    const module = checkSource(
      "union Result = Ok(value: (String, Int)) | Err(error: {context: {message: String}, code: Int})\n" +
        "fun describe(result: Result): String = match result\n" +
        "    Ok((name, _)) => name\n" +
        "    Err({context: {message: reason}}) => reason",
    );

    expect(module.diagnostics).toEqual([]);
    expect(typeName(module.symbols.find(({ name }) => name === "reason")!.scheme.type)).toBe("String");
  });

  test("checks closed and open structural record annotations", () => {
    const open = checkSource(
      "fun getX(r: {x: Int, ...}): Int = r.x\n" +
        "let first = getX({x: 1})\n" +
        "let second = getX({x: 2, y: true})",
    );
    expect(open.diagnostics).toEqual([]);

    const closed = checkSource(
      "fun getX(r: {x: Int}): Int = r.x\n" +
        "let extra = getX({x: 1, y: true})",
    );
    expect(closed.diagnostics.map(({ message }) => message)).toContain(
      "record fields do not match; unexpected `y`",
    );
  });

  test("checks immutable record updates without permitting field addition", () => {
    const valid = checkSource(
      "let point = {x: 1.0, y: 2.0}\n" +
        "let moved = {...point, x: 3.0}\n" +
        "let copied = {...moved}",
    );
    expect(valid.diagnostics).toEqual([]);
    expect(letSymbol(valid, "moved").scheme.type).toMatchObject({
      kind: "Record",
      fields: [
        { name: "x", type: { kind: "Primitive", name: "Float" } },
        { name: "y", type: { kind: "Primitive", name: "Float" } },
      ],
    });

    const invalid = checkSource(
      "let point = {x: 1}\nlet moved = {...point, y: 2}",
    );
    expect(invalid.diagnostics.map(({ message }) => message)).toContain(
      "record update cannot add fields; the input has no field `y`",
    );
  });

  test("binds fields from an open structural record pattern", () => {
    const module = checkSource(
      'let reservation = {guest: "Mira", seats: 3, confirmed: true}\n' +
        "let {guest, seats} = reservation\n" +
        "let label = guest\nlet count = seats",
    );

    expect(module.diagnostics).toEqual([]);
    expect(typeName(letSymbol(module, "guest").scheme.type)).toBe("String");
    expect(typeName(letSymbol(module, "seats").scheme.type)).toBe("Int");
  });

  test("types primitive literals and defaults bare integers to Int", () => {
    const module = checkSource(
      'let count = 1\nlet ratio = 1.5\nlet exact = 1n\nlet flag = true\nlet text = "hello"\nlet unit = ()',
    );

    expect(module.symbols.map(({ name, scheme }) => [name, typeName(scheme.type)])).toEqual([
      ["count", "Int"],
      ["ratio", "Float"],
      ["exact", "BigInt"],
      ["flag", "Bool"],
      ["text", "String"],
      ["unit", "Unit"],
    ]);
    expect(module.items[0]).toMatchObject({
      kind: "Let",
      value: {
        kind: "FromNat",
        type: { kind: "Primitive", name: "Int" },
        requirement: {
          name: "Num",
          type: { kind: "Primitive", name: "Int" },
        },
      },
    });
    expect(module.diagnostics).toEqual([]);
  });

  test("types console.log arguments and returns Unit", () => {
    const module = checkSource('console.log("answer", 42, true)');
    const logged = expression(module);

    expect(logged).toMatchObject({
      kind: "ConsoleLog",
      type: { kind: "Primitive", name: "Unit" },
      arguments: [
        { type: { kind: "Primitive", name: "String" } },
        { type: { kind: "Primitive", name: "Int" } },
        { type: { kind: "Primitive", name: "Bool" } },
      ],
    });
    expect(module.diagnostics).toEqual([]);
  });

  test("generalizes let-bound identity and instantiates each use", () => {
    const module = checkSource(
      'let identity = x => x\nlet one = identity(1)\nlet text = identity("a")',
    );
    const identity = letSymbol(module, "identity");

    expect(identity?.scheme.variables).toHaveLength(1);
    expect(identity?.scheme.constraints).toEqual([]);
    expect(identity?.scheme.type).toMatchObject({
      kind: "Function",
      parameters: [{ kind: "Variable" }],
      result: { kind: "Variable" },
    });
    expect(typeName(letSymbol(module, "one").scheme.type)).toBe("Int");
    expect(typeName(letSymbol(module, "text").scheme.type)).toBe("String");
    expect(module.diagnostics).toEqual([]);
  });

  test("checks direct recursion monomorphically and generalizes afterward", () => {
    const module = checkSource(
      "fun choose(value) = if true then value else choose(value)\n" +
        "let number = choose(1)\n" +
        'let text = choose("a")',
    );
    const choose = module.symbols.find(
      ({ kind, name }) => kind === "fun" && name === "choose",
    );

    expect(choose?.scheme).toMatchObject({
      variables: [expect.any(Number)],
      constraints: [],
      type: {
        kind: "Function",
        parameters: [{ kind: "Variable" }],
        result: { kind: "Variable" },
      },
    });
    expect(typeName(letSymbol(module, "number").scheme.type)).toBe("Int");
    expect(typeName(letSymbol(module, "text").scheme.type)).toBe("String");
    expect(module.diagnostics).toEqual([]);
  });

  test("checks annotated numeric recursion", () => {
    const module = checkSource(
      "fun fact(n: Int): Int = if n <= 1 then 1 else n * fact(n - 1)",
    );
    const fact = module.symbols.find(
      ({ kind, name }) => kind === "fun" && name === "fact",
    );

    expect(fact?.scheme).toMatchObject({
      variables: [],
      constraints: [],
      type: {
        kind: "Function",
        parameters: [{ kind: "Primitive", name: "Int" }],
        result: { kind: "Primitive", name: "Int" },
      },
    });
    expect(module.diagnostics).toEqual([]);
  });

  test("infers structural tuple types and checks positional access", () => {
    const module = checkSource(
      'let pair = ("answer", 42)\n' +
        "let answer = pair.item2\n" +
        "let duplicate = value => (value, value)\n" +
        "let swap(value: (String, Int)): (Int, String) = (value.item2, value.item1)",
    );

    expect(letSymbol(module, "pair").scheme.type).toMatchObject({
      kind: "Tuple",
      elements: [
        { kind: "Primitive", name: "String" },
        { kind: "Primitive", name: "Int" },
      ],
    });
    expect(typeName(letSymbol(module, "answer").scheme.type)).toBe("Int");
    expect(letSymbol(module, "duplicate").scheme).toMatchObject({
      variables: [expect.any(Number)],
      type: {
        kind: "Function",
        parameters: [{ kind: "Variable" }],
        result: {
          kind: "Tuple",
          elements: [{ kind: "Variable" }, { kind: "Variable" }],
        },
      },
    });
    expect(letSymbol(module, "swap").scheme.type).toMatchObject({
      kind: "Function",
      parameters: [{ kind: "Tuple" }],
      result: { kind: "Tuple" },
    });
    expect(module.diagnostics).toEqual([]);
  });

  test("reports tuple arity mismatches directly", () => {
    const module = checkSource(
      "let choose(flag) = if flag then (1, 2) else (1, 2, 3)",
    );

    expect(module.diagnostics.map(({ message }) => message)).toContain(
      "tuple arity mismatch: 2 and 3",
    );
  });

  test("types tuple pattern bindings and makes them available sequentially", () => {
    const module = checkSource(
      'let (name, _, (x, y)) = ("point", true, (3, 4))\n' +
        "let total = x + y",
    );

    expect(typeName(letSymbol(module, "name").scheme.type)).toBe("String");
    expect(typeName(letSymbol(module, "x").scheme.type)).toBe("Int");
    expect(typeName(letSymbol(module, "y").scheme.type)).toBe("Int");
    expect(typeName(letSymbol(module, "total").scheme.type)).toBe("Int");
    expect(module.diagnostics).toEqual([]);
  });

  test("diagnoses duplicate and rebinding names in tuple patterns", () => {
    const module = checkSource(
      "let existing = 1\n" +
        "let (existing, duplicate, duplicate) = (2, 3, 4)",
    );

    expect(module.diagnostics.map(({ message }) => message)).toEqual([
      "`existing` is already bound (line 1); Hexagon does not allow rebinding — choose a different name.",
      "`duplicate` is bound twice in this pattern",
    ]);
  });

  test("types nullary union constructors, tuples containing them, and matches", () => {
    const module = checkSource(
      "union Suit = Clubs | Diamonds | Hearts | Spades\n" +
        "let card = (10, Hearts)\n" +
        "let color(suit: Suit): String = match suit\n" +
        '    Clubs => "black"\n    Diamonds => "red"\n' +
        '    Hearts => "red"\n    Spades => "black"',
    );

    expect(letSymbol(module, "card").scheme.type).toMatchObject({
      kind: "Tuple",
      elements: [
        { kind: "Primitive", name: "Int" },
        { kind: "Union", name: "Suit" },
      ],
    });
    expect(letSymbol(module, "color").scheme.type).toMatchObject({
      kind: "Function",
      parameters: [{ kind: "Union", name: "Suit" }],
      result: { kind: "Primitive", name: "String" },
    });
    expect(module.diagnostics).toEqual([]);
  });

  test("checks union match exhaustiveness and reachability exactly", () => {
    const missing = checkSource(
      "union Suit = Clubs | Diamonds | Hearts | Spades\n" +
        "let color(suit: Suit) = match suit\n" +
        '    Clubs => "black"\n    Hearts => "red"',
    );
    const unreachable = checkSource(
      "union Suit = Clubs | Hearts\n" +
        "let color(suit: Suit) = match suit\n" +
        '    _ => "known"\n    Hearts => "red"',
    );

    expect(missing.diagnostics.map(({ message }) => message)).toContain(
      "match is missing cases: `Diamonds`, `Spades`",
    );
    expect(unreachable.diagnostics.map(({ message }) => message)).toContain(
      "this match arm is unreachable; an earlier pattern matches everything",
    );
  });

  test("diagnoses invalid and insufficiently known tuple access", () => {
    const module = checkSource(
      "let pair = (1, 2)\n" +
        "let zero = pair.item0\n" +
        "let missing = pair.item3\n" +
        "let unknown = value => value.item1",
    );

    expect(module.diagnostics.map(({ message }) => message)).toEqual([
      "tuple components are numbered from 1",
      "this tuple has 2 components; there is no item3",
      "tuple access needs a known tuple type; add a tuple annotation",
    ]);
  });

  test("checks complete and partial primitive annotations", () => {
    const module = checkSource(
      "let complete(x: Int, y: Int): Int = x + y\n" +
        "let partial(x: Int, y) = x + y\n" +
        "let negate = (value: Float): Float => -value",
    );

    for (const name of ["complete", "partial"]) {
      expect(letSymbol(module, name).scheme).toMatchObject({
        variables: [],
        constraints: [],
        type: {
          kind: "Function",
          parameters: [
            { kind: "Primitive", name: "Int" },
            { kind: "Primitive", name: "Int" },
          ],
          result: { kind: "Primitive", name: "Int" },
        },
      });
    }
    expect(letSymbol(module, "negate").scheme.type).toMatchObject({
      kind: "Function",
      parameters: [{ kind: "Primitive", name: "Float" }],
      result: { kind: "Primitive", name: "Float" },
    });
    const complete = module.items[0];
    expect(complete).toMatchObject({ kind: "Let", value: { kind: "Lambda" } });
    if (complete?.kind !== "Let" || complete.value.kind !== "Lambda") {
      throw new Error("expected the complete binding to contain a lambda");
    }
    expect(complete.value).not.toHaveProperty("returnAnnotation");
    for (const parameter of complete.value.parameters) {
      expect(parameter).not.toHaveProperty("annotation");
    }
    expect(module.diagnostics).toEqual([]);
  });

  test("reports parameter and return annotation mismatches", () => {
    const module = checkSource(
      "let takesString(value: String) = value\n" +
        "let wrongParameter(x: Int) = takesString(x)\n" +
        "let wrongResult(x: Int): String = x + 1",
    );

    expect(module.diagnostics.map(({ message }) => message)).toEqual([
      "type mismatch: expected String, found Int",
      "type mismatch: expected String, found Int",
    ]);
  });

  test("keeps declared function type variables rigid while inferring their constraints", () => {
    const rejected = checkSource(
      "let takesInt(value: Int) = value\n" +
        "let takesInts(values: Vector(Int)) = values\n" +
        "let implicit(thing: a) = takesInt(thing)\n" +
        "let explicit<a>(thing: a) = takesInt(thing)\n" +
        "let nested(things: Vector(a)) = takesInts(things)\n" +
        "let result(): a = takesInt(1)\n" +
        "let same(left: a, right: b) = if true then left else right",
    );

    expect(rejected.diagnostics.map(({ message }) => message)).toEqual([
      "`a` is a declared type variable, but the body requires `Int`; change the annotation to `Int`, or remove it to let the type be inferred",
      "`a` is a declared type variable, but the body requires `Int`; change the annotation to `Int`, or remove it to let the type be inferred",
      "`a` is a declared type variable, but the body requires `Int`; change the annotation to `Int`, or remove it to let the type be inferred",
      "`a` is a declared type variable, but the body requires `Int`; change the annotation to `Int`, or remove it to let the type be inferred",
      "`a` and `b` are distinct declared type variables, but the body requires them to be the same; use one type variable name in both annotations, or remove an annotation to let the type be inferred",
    ]);

    const accepted = checkSource(
      'let numeric(thing: a) = thing + 1\n' +
        'let display(thing: a) = "${thing}"\n' +
        "let choose(thing: a, fallback) = if true then thing else fallback\n" +
        "let takesInt(value: Int) = value\n" +
        "let inferred(thing) = takesInt(thing)",
    );

    expect(letSymbol(accepted, "numeric").scheme).toMatchObject({
      variables: [expect.any(Number)],
      constraints: [{ name: "Num", type: { kind: "Variable" } }],
      type: {
        kind: "Function",
        parameters: [{ kind: "Variable" }],
        result: { kind: "Variable" },
      },
    });
    expect(letSymbol(accepted, "display").scheme).toMatchObject({
      variables: [expect.any(Number)],
      constraints: [{ name: "Show", type: { kind: "Variable" } }],
      type: {
        kind: "Function",
        parameters: [{ kind: "Variable" }],
        result: { kind: "Primitive", name: "String" },
      },
    });
    expect(letSymbol(accepted, "choose").scheme.type).toMatchObject({
      kind: "Function",
      parameters: [{ kind: "Variable" }, { kind: "Variable" }],
      result: { kind: "Variable" },
    });
    expect(letSymbol(accepted, "inferred").scheme).toMatchObject({
      variables: [],
      constraints: [],
      type: {
        kind: "Function",
        parameters: [{ kind: "Primitive", name: "Int" }],
        result: { kind: "Primitive", name: "Int" },
      },
    });
    expect(accepted.diagnostics).toEqual([]);
  });

  test("checks inferred demands against declared function constraints", () => {
    const rejected = checkSource(
      "export let fingerprint<a: Eq>(thing: a): Int = hash(thing)\n" +
        "let numeric<a>(thing: a) = thing + 1",
    );

    expect(rejected.diagnostics.map(({ message }) => message)).toEqual([
      "`a` is declared to honor `Eq`, but the body requires `Hash`; write `<a: Hash>`, or remove the constraint annotation to let it be inferred",
      "`a` is declared without constraints, but the body requires `Num`; write `<a: Num>`, or remove the explicit type parameter to let it be inferred",
    ]);

    const accepted = checkSource(
      "export let fingerprint<a: Hash>(thing: a): Int = hash(thing)\n" +
        "export let same<a: Hash>(left: a, right: a): Bool = left == right",
    );

    expect(letSymbol(accepted, "fingerprint").scheme.constraints).toEqual([
      expect.objectContaining({ name: "Hash" }),
    ]);
    expect(letSymbol(accepted, "same").scheme.constraints).toEqual([
      expect.objectContaining({ name: "Hash" }),
    ]);
    expect(accepted.diagnostics).toEqual([]);
  });

  test("checks explicit nullary, n-ary, tuple-domain, and higher-order function types", () => {
    const module = checkSource(
      "type Mapper(a, b) = a -> b\n" +
        "let callAlias(callback: Mapper(Int, String)): String = callback(1)\n" +
        "let callNullary(callback: () -> String): String = callback()\n" +
        "let callBinary(callback: (Int, String) -> Bool): Bool = callback(1, \"ok\")\n" +
        "let callTuple(callback: ((Int, String)) -> Bool): Bool = callback((1, \"ok\"))\n" +
        "let callHigher(callback: (Int -> String) -> Bool, render: Int -> String): Bool = callback(render)",
    );

    expect(letSymbol(module, "callAlias").scheme.type).toMatchObject({
      parameters: [{ kind: "Function", parameters: [{ kind: "Primitive", name: "Int" }] }],
      result: { kind: "Primitive", name: "String" },
    });
    expect(letSymbol(module, "callNullary").scheme.type).toMatchObject({
      kind: "Function",
      parameters: [{ kind: "Function", parameters: [], result: { kind: "Primitive", name: "String" } }],
      result: { kind: "Primitive", name: "String" },
    });
    expect(letSymbol(module, "callBinary").scheme.type).toMatchObject({
      parameters: [{ kind: "Function", parameters: [{}, {}] }],
    });
    expect(letSymbol(module, "callTuple").scheme.type).toMatchObject({
      parameters: [{ kind: "Function", parameters: [{ kind: "Tuple", elements: [{}, {}] }] }],
    });
    expect(letSymbol(module, "callHigher").scheme.type).toMatchObject({
      parameters: [
        { kind: "Function", parameters: [{ kind: "Function" }] },
        { kind: "Function", parameters: [{ kind: "Primitive", name: "Int" }] },
      ],
    });
    expect(module.diagnostics).toEqual([]);
  });

  test("checks nested, guarded, or-, and as-patterns in catch arms", () => {
    const module = checkSource(
      "union Reason = Code(Int) | Other\n" +
        "exception Wrapped(reason: Reason)\n" +
        "exception Backup(reason: Reason)\n" +
        "let recover(value: Int): Int = try\n" +
        "    throw(Wrapped(Code(value)))\n" +
        "catch\n" +
        "    Wrapped(Code(code) as reason) when code > 0 => code\n" +
        "    Wrapped(Other) | Backup(Other) => 0\n" +
        "    _ as whole => -1",
    );

    expect(letSymbol(module, "recover").scheme.type).toMatchObject({
      kind: "Function",
      parameters: [{ kind: "Primitive", name: "Int" }],
      result: { kind: "Primitive", name: "Int" },
    });
    expect(module.diagnostics).toEqual([]);
  });

  test("keeps guarded catch patterns out of reachability coverage", () => {
    const reachable = checkSource(
      "union Reason = Code(Int) | Other\n" +
        "exception Wrapped(reason: Reason)\n" +
        "fun choose(reason: Reason): Int = try\n" +
        "    throw(Wrapped(reason))\n" +
        "catch\n" +
        "    Wrapped(_) when false => 1\n" +
        "    Wrapped(Code(_)) => 2",
    );
    const unreachable = checkSource(
      "union Reason = Code(Int) | Other\n" +
        "exception Wrapped(reason: Reason)\n" +
        "fun choose(reason: Reason): Int = try\n" +
        "    throw(Wrapped(reason))\n" +
        "catch\n" +
        "    Wrapped(_) => 1\n" +
        "    Wrapped(Code(_)) => 2",
    );

    expect(reachable.diagnostics).toEqual([]);
    expect(unreachable.diagnostics.map(({ message }) => message)).toContain(
      "exception `Wrapped` is already caught above",
    );
  });

  test("enforces concrete exception payloads and exception-specific rewrites", () => {
    const module = checkSource(
      "exception Generic(value: a)\n" +
        "exception WrongMessage(message: Int)\n" +
        "exception Missing\n" +
        "let called = Missing()\n" +
        "fun inspect(error: Exn): Int = match error\n" +
        "    _ => 0\n" +
        "fun field(error: Exn) = error.name",
    );
    const messages = module.diagnostics.map(({ message }) => message);

    expect(messages).toContain("exception payloads must have concrete types");
    expect(messages).toContain("exception field `message` must have type `String`");
    expect(messages).toContain("`Missing` is a value; write it without `()`");
    expect(messages).toContain(
      "match requires a closed type; exceptions are inspected with `try`/`catch`",
    );
    expect(messages).toContain("exceptions are inspected with `try`/`catch`");
  });

  test("retains polymorphic constraints when they govern an input", () => {
    const module = checkSource(
      'let addOne = x => x + 1\nlet display = x => "${x}"',
    );

    expect(letSymbol(module, "addOne").scheme).toMatchObject({
      variables: [expect.any(Number)],
      constraints: [{ name: "Num", type: { kind: "Variable" } }],
      type: {
        kind: "Function",
        parameters: [{ kind: "Variable" }],
        result: { kind: "Variable" },
      },
    });
    expect(letSymbol(module, "display").scheme).toMatchObject({
      variables: [expect.any(Number)],
      constraints: [{ name: "Show", type: { kind: "Variable" } }],
      type: {
        kind: "Function",
        parameters: [{ kind: "Variable" }],
        result: { kind: "Primitive", name: "String" },
      },
    });
    expect(module.diagnostics).toEqual([]);
  });

  test("enforces n-ary calls, Bool conditions, and matching branches", () => {
    const good = checkSource(
      "let choose = (condition, yes, no) => if condition then yes else no\n" +
        "choose(true, 1, 2)",
    );
    const bad = checkSource(
      'let pair = (x, y) => x\npair(1)\nif "yes" then 1 else true',
    );

    expect(typeName(expression(good).type)).toBe("Int");
    expect(good.diagnostics).toEqual([]);
    expect(bad.diagnostics.map(({ message }) => message)).toEqual([
      "function expects 2 arguments, got 1",
      "type mismatch: expected String, found Bool",
      "integer literal cannot have type `Bool`",
    ]);
  });

  test("rewrites pipes to first-argument calls before inference", () => {
    const module = checkSource(
      "let add(x: Int, y: Int) = x + y\n" +
        "let identity = x => x\n" +
        "let bare = 1 |> identity\n" +
        "let inserted = 1 |> add(2)\n" +
        "let chained = 1 |> add(2) |> add(3)",
    );

    for (const name of ["bare", "inserted", "chained"]) {
      expect(typeName(letSymbol(module, name).scheme.type)).toBe("Int");
    }
    expect(module.items[2]).toMatchObject({
      kind: "Let",
      value: { kind: "Call", arguments: [{ kind: "FromNat" }] },
    });
    expect(module.items[3]).toMatchObject({
      kind: "Let",
      value: {
        kind: "Call",
        arguments: [{ kind: "FromNat" }, { kind: "FromNat" }],
      },
    });
    expect(module.items[4]).toMatchObject({
      kind: "Let",
      value: {
        kind: "Call",
        arguments: [{ kind: "Call" }, { kind: "FromNat" }],
      },
    });
    expect(module.diagnostics).toEqual([]);
  });

  test("reports discarded values and block-final bindings with source vocabulary", () => {
    const module = checkSource(
      "let discarded = () =>\n    1\n    2\n" +
        "let unfinished = () =>\n    let answer = 42",
    );

    expect(module.diagnostics.map(({ message }) => message)).toEqual([
      "this expression's value is discarded — its type is Int; wrap it in `ignore(...)` if discarding is intentional",
      "a block cannot end with a `let`; did you mean to return `answer`?",
    ]);
  });

  test("checks primitive constraint instances", () => {
    const module = checkSource(
      'let divided = 4.0 / 2.0\nlet joined = "a" ++ "b"\nlet impossible = "a" - "b"',
    );

    expect(typeName(letSymbol(module, "divided").scheme.type)).toBe("Float");
    expect(typeName(letSymbol(module, "joined").scheme.type)).toBe("String");
    expect(module.diagnostics.map(({ message }) => message)).toContain(
      "type `String` has no `Signed` instance",
    );
  });

  test("keeps compiler-supported constraint subjects universally quantified", () => {
    const module = checkSource(
      "constraint Integral<a: (Num, Ord)> =\n" +
        "    gcd(left: a, right: a): a",
    );
    const gcd = module.symbols.find(({ name }) => name === "gcd");

    expect(gcd?.scheme).toMatchObject({
      variables: [expect.any(Number)],
      constraints: [{ name: "Integral", type: { kind: "Variable" } }],
      type: {
        kind: "Function",
        parameters: [{ kind: "Variable" }, { kind: "Variable" }],
        result: { kind: "Variable" },
      },
    });
    expect(module.diagnostics).toEqual([]);
  });

  test("checks implied type instances and resolves concrete member results", () => {
    const module = checkSource(
      "constraint Source<a> =\n" +
        "    type Item\n" +
        "    get(value: a): Item\n" +
        "record Box = {value: Int}\n" +
        "honor Source<Box> =\n" +
        "    type Item = Int\n" +
        "    get(box: Box) = box.value\n" +
        "let answer: Int = get(Box({value: 42}))",
    );

    expect(module.diagnostics).toEqual([]);
    expect(letSymbol(module, "answer").scheme.type).toEqual({
      kind: "Primitive",
      name: "Int",
    });
  });

  test("enforces implied type completeness and the v1 binder ban", () => {
    const module = checkSource(
      "constraint Source<a> =\n" +
        "    type Item\n" +
        "    get(value: a): Item\n" +
        "honor Source<Int> =\n" +
        "    get(value) = value\n" +
        "let generic<a: Source>(value: a) = get(value)",
    );

    expect(module.diagnostics.map(({ message }) => message)).toEqual(
      expect.arrayContaining([
        "instance is missing implied type `Item`",
        "`Source` declares an implied type and cannot constrain a type variable in v1",
      ]),
    );
  });

  test("checks monomorphic mutation, Range, and while as Unit", () => {
    const module = checkSource(
      "fun countdown(start: Int): Unit =\n" +
        "    var current = start\n" +
        "    let visited = 1..current\n" +
        "    while current > 0\n" +
        "        current := current - 1",
    );
    expect(module.diagnostics).toEqual([]);
    expect(module.symbols.find(({ name }) => name === "visited")?.scheme.type)
      .toEqual({ kind: "Range" });

    const invalid = checkSource(
      "fun bad(): Unit =\n" +
        "    let fixed = 1\n" +
        "    fixed := 2\n" +
        "    while true\n" +
        "        42",
    );
    expect(invalid.diagnostics.map(({ message }) => message)).toContain(
      "`fixed` is not mutable; declare it with `var` if you need to update it",
    );
    expect(invalid.diagnostics.map(({ message }) => message)).toContain(
      "the final expression of a loop body produces a value that is discarded on every iteration; use `ignore(...)` if intended",
    );
  });

  test("checks Range and String for loops with their concrete item types", () => {
    const module = checkSource(
      "fun visit(): Unit =\n" +
        "    for number in 1..3\n" +
        "        let next: Int = number + 1\n" +
        "        console.log(next)\n" +
        "    for character in \"ab\"\n" +
        "        let copy: String = character\n" +
        "        console.log(copy)",
    );
    expect(module.diagnostics).toEqual([]);

    const invalid = checkSource(
      "fun bad(): Unit =\n" +
        "    for true in 1..3\n" +
        "        ()\n" +
        "    for item in 42\n" +
        "        console.log(item)",
    );
    expect(invalid.diagnostics.map(({ message }) => message)).toContain(
      "this loop pattern can fail; bind an irrefutable pattern and use `match` inside the loop",
    );
    expect(invalid.diagnostics.map(({ message }) => message)).toContain(
      "type `Int` has no `Iterable` instance",
    );
  });

  test("recovers from arbitrary resolved trees without unbounded public spans", () => {
    fc.assert(
      fc.property(fc.string(), (text) => {
        const module = checkSource(text);

        for (const diagnostic of module.diagnostics) {
          expect(diagnostic.primary.start.offset).toBeGreaterThanOrEqual(0);
          expect(diagnostic.primary.end.offset).toBeLessThanOrEqual(text.length);
        }
        for (const symbol of module.symbols) visitType(symbol.scheme.type);
      }),
      { numRuns: 250 },
    );
  });
});

function checkSource(text: string): Typed.Module {
  const source = new Source.File(Source.fileId(0), "test.hex", text);
  return check(resolve(parse(applyLayout(lex(source)))));
}

function expression(module: Typed.Module): Typed.Expr {
  const item = module.items.at(-1);
  if (item?.kind !== "ExprItem") throw new Error("expected an expression item");
  return item.expression;
}

function typeName(type: Typed.Type): string {
  return type.kind === "Primitive" ? type.name : type.kind;
}

function letSymbol(module: Typed.Module, name: string): Typed.Symbol {
  const symbol = module.symbols.find(
    (candidate) => candidate.kind === "let" && candidate.name === name,
  );
  if (symbol === undefined) throw new Error(`expected let symbol ${name}`);
  return symbol;
}

function visitType(type: Typed.Type): void {
  if (type.kind === "Variable") expect(Number(type.id)).toBeGreaterThanOrEqual(0);
  if (type.kind === "Tuple") {
    for (const element of type.elements) visitType(element);
  }
  if (type.kind === "Function") {
    for (const parameter of type.parameters) visitType(parameter);
    visitType(type.result);
  }
}
