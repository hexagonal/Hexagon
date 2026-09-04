import fc from "fast-check";
import { describe, expect, test } from "vitest";

import * as Source from "../../support/source.js";
import type * as Typed from "../../syntax/typed/index.js";
import { applyLayout } from "../layout/layout.js";
import { lex } from "../lexer/lexer.js";
import { parse } from "../parser/parser.js";
import { resolve } from "../resolver/resolver.js";
import { compileProject } from "../../project.js";
import { check } from "./checker.js";

describe("check", () => {
  test("checks monomorphic extern schemes and opaque foreign types", () => {
    const module = checkSource(
      "extern from \"tiny-json\"\n" +
        "    export type JsonValue\n" +
        "    export fun parse(text: String): JsonValue\n" +
        "    let VERSION as version: String\n" +
        "let document = parse!(version)",
    );

    expect(letSymbol(module, "document").scheme.type).toMatchObject({
      kind: "ExternType",
      name: "JsonValue",
    });
    expect(module.diagnostics).toEqual([]);
  });

  test("rejects generic externs and adapter-requiring nested positions", () => {
    const module = checkProject(
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
        "fun\n" +
        "    even(n: Int): Bool = if n == 0 then True else odd(n - 1)\n" +
        "    odd(n: Int): Bool = if n == 0 then False else even(n - 1)\n" +
        "let origin: Coordinates = Point({x = 0, y = 0})\n" +
        "let flags: Pair(Bool) = (even(4), odd(3))",
    );

    expect(module.diagnostics).toEqual([]);
    expect(letSymbol(module, "origin").scheme.type).toMatchObject({ kind: "NominalRecord", name: "Point" });
    expect(letSymbol(module, "flags").scheme.type).toMatchObject({
      kind: "Tuple",
      elements: [{ name: "Bool" }, { name: "Bool" }],
    });
  });

  test("body-local annotations share the function's declared type variables (functions.md §4.1)", () => {
    // A `let`/`var` annotation naming `a` is a repeated occurrence of the
    // signature's `a` and must denote the same type — not a fresh one. Regression
    // for #63 (the checker previously minted a distinct `a` and rejected these).
    const module = checkSource(
      "fun id<a>(x: a): a =\n" +
        "    let y: a = x\n" +
        "    y\n" +
        "fun wrap<a>(x: a): Vector(a) =\n" +
        "    var ys: Vector(a) = [x]\n" +
        "    ys\n" +
        "fun nested<a>(x: a): a =\n" +
        "    let f = () =>\n" +
        "        let y: a = x\n" +
        "        y\n" +
        "    f()\n",
    );
    expect(module.diagnostics).toEqual([]);
  });

  // Issue #65: the lambda form of Functions §4.2 makes lambda-side type-parameter
  // shadowing reachable for the first time. The checker's nested-lambda seeding was
  // already correct and waiting for it (noted while reviewing #64).
  test("a type-parameter lambda shadows an enclosing declared type variable", () => {
    const module = checkSource(
      "fun outer<a: Ord>(x: a): a =\n" +
        "    let inner = <a: Ord>(y: a): a => y\n" +
        "    inner(x)\n",
    );

    expect(module.diagnostics).toEqual([]);
  });

  test("a type-parameter lambda carries its declared constraint into the body", () => {
    const satisfied = checkSource("let least = <a: Ord>(x: a, y: a): a => if x > y then x else y");
    expect(satisfied.diagnostics).toEqual([]);

    // And the written list is still a contract, exactly as on the header form.
    const unsatisfied = checkSource("let least = <a: Eq>(x: a, y: a): a => if x > y then x else y");
    expect(unsatisfied.diagnostics.map(({ message }) => message).join(" ")).toContain(
      "but the body requires `Ord`",
    );
  });

  test("a body-local annotation still holds a declared type variable rigid", () => {
    // The scope fix must not weaken rigidity: forcing `a` to a concrete type in the
    // body is still an error (functions.md §4.1 — the annotation is a contract).
    const module = checkSource(
      "fun f<a>(x: a): a =\n" +
        "    let y: a = 5\n" +
        "    x\n",
    );
    expect(module.diagnostics.length).toBeGreaterThan(0);
    expect(module.diagnostics[0]!.message).toContain("declared");
  });

  test("generic functions compose across call sites via let-generalization (functions.md §4.2, #66)", () => {
    // A generic function used from another function's body is generalized before
    // its callers are checked (dependency order), so each use instantiates fresh —
    // whether the type variable is declared or inferred, and at differing types.
    //
    // *(#700.)* The forward reference is inside one block, which is the only
    // place a forward reference among terms exists at all (§7.3).
    const module = checkSource(
      "fun wrap<a>(x: a): Vector(a) = [x]\n" +
        "fun rewrap<a>(x: a): Vector(a) = wrap(x)\n" +
        "fun useInt(): Vector(Int) = wrap(1)\n" +
        "fun useText(): Vector(String) = wrap(\"s\")\n" +
        "fun\n" +
        "    idThrough(x) = through(x)\n" +
        "    through(x) = x\n", // forward reference, inferred generic
    );
    expect(module.diagnostics).toEqual([]);
  });

  test("genuine mutual recursion still shares one monomorphic knot", () => {
    // *(#700.)* Mutual recursion demands the `fun` block: two adjacent `fun`s
    // are two blocks and would draw §7.3's wrap rewrite.
    const module = checkSource(
      "fun\n" +
        "    even(n: Int): Bool = if n == 0 then True else odd(n - 1)\n" +
        "    odd(n: Int): Bool = if n == 0 then False else even(n - 1)\n",
    );
    expect(module.diagnostics).toEqual([]);
  });

  test("a mutually recursive pair with declared type variables is rejected", () => {
    // Within one strongly-connected component the shared type is monomorphic
    // (Functions §7.4); two declarations' rigids can never be one variable, and
    // the acceptance that would make this legal — a member participating at its
    // declared scheme — is rejected doctrine, not a gap (annotations decision
    // §9.11). The report is §10's SCC hint; `conformance/recursion-knot.test.ts`
    // owns the message's own fences.
    const module = checkSource(
      "fun\n" +
        "    f(x: a): a = g(x)\n" +
        "    g(x: a): a = f(x)\n",
    );
    expect(module.diagnostics.map(({ message }) => message)).toContain(
      "`a` declared on `f` and `a` declared on `g` are distinct declared type variables, but " +
        "members of a recursive knot are checked together at not-yet-general types; declare " +
        "one head on the `fun` block that both members write, drop the members' own variable " +
        "annotations and let inference link the knot, or move the contract to a " +
        "non-recursive wrapper",
    );
  });

  test("rejects recursive aliases, unused parameters, and private public types", () => {
    const source = "type Loop = Loop\n" +
      "type Unused(a) = Int\n" +
      "record Secret = {value: Int}\n" +
      "export fun reveal(secret: Secret): Int = secret.value";
    const module = checkSource(source);
    const messages = module.diagnostics.map(({ message }) => message);
    expect(messages.some((message) => message.startsWith("recursive type alias cycle:"))).toBe(true);
    expect(messages).toContain("type parameter `a` is not used by alias `Unused`");
    expect(messages).toContain(
      "exported binding `reveal` exposes private type `Secret`; export the type, perhaps opaquely, or keep the binding private",
    );
    // Every member of §4.3's family labels the private type's declaration — the
    // binding's included (#621), which is where the one-keyword fix goes, so the
    // fix is a lookup rather than a search.
    const exposure = module.diagnostics.find(({ message }) =>
      message.startsWith("exported binding `reveal` exposes")
    );
    expect(exposure?.labels?.map(({ message }) => message)).toEqual([
      "`Secret` is declared private here",
    ]);
    const label = exposure!.labels![0]!.span;
    expect(source.slice(label.start.offset, label.end.offset)).toBe(
      "record Secret = {value: Int}",
    );
    // The primary stays at the binding, whose signature is one seat already.
    expect(source.slice(exposure!.primary.start.offset, exposure!.primary.end.offset))
      .toBe("reveal");
  });

  test("tracks refutable constructor payloads before marking a case covered", () => {
    const complete = checkSource(
      "union Flagged = Flagged(value: Bool) | Empty\n" +
        "fun describe(flagged: Flagged): String = match flagged\n" +
        '    Flagged(True) => "yes"\n' +
        '    Flagged(False) => "no"\n' +
        '    Empty => "empty"',
    );
    expect(complete.diagnostics).toEqual([]);

    const incomplete = checkSource(
      "union Flagged = Flagged(value: Bool) | Empty\n" +
        "fun describe(flagged: Flagged): String = match flagged\n" +
        '    Flagged(True) => "yes"\n' +
        '    Empty => "empty"',
    );
    // §7.3's witness, not the bare constructor name the listing used to print
    // (#594): `Flagged` carries a slot, so the shallowest missing shape names it.
    expect(incomplete.diagnostics.map(({ message }) => message)).toContain(
      "match is missing cases: `Flagged(False)`",
    );

    const unreachable = checkSource(
      "union Flagged = Flagged(value: Bool) | Empty\n" +
        "fun describe(flagged: Flagged): String = match flagged\n" +
        '    Flagged(True) => "yes"\n' +
        '    Flagged(False) => "no"\n' +
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
        "let True | False = True\n" +
        "let Left(amount) | Right(amount) = Left(42)\n" +
        "let answer = amount",
    );

    expect(module.diagnostics).toEqual([]);
    expect(letSymbol(module, "answer").scheme.type).toMatchObject({
      kind: "Primitive",
      name: "Int",
    });

    const incomplete = checkSource("let True | True = False");
    // §5.3's one sentence for every gated position (#594): the or-pattern's own
    // wording is retired with the rest of the per-form family.
    expect(incomplete.diagnostics.map(({ message }) => message)).toContain(
      "this pattern can fail: `False`; use `match`",
    );
  });

  test("checks negative integer and top-level or-pattern coverage", () => {
    const module = checkSource(
      "union Shape = Circle(radius: Float) | Rectangle(width: Float, height: Float) | Point\n" +
        "fun measure(shape: Shape): Float = match shape\n" +
        "    Circle(extent) | Rectangle(extent, _) when extent > 0.0 => extent\n" +
        "    Circle(_) | Rectangle(_, _) => 0.0\n" +
        "    Point => 0.0\n" +
        "fun sign(value: Int): String = match value\n" +
        '    -1 => "negative one"\n' +
        '    _ => "other"',
    );

    expect(module.diagnostics).toEqual([]);
    // `extent` rather than `size`: `stdlib/Map.hex` exports a prelude `size`
    // since #370, and this filter runs over every symbol the module can see.
    const extents = module.symbols.filter(({ name }) => name === "extent");
    expect(extents).toHaveLength(1);
    expect(extents[0]?.scheme.type).toMatchObject({
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
      "this pattern can fail: `None`; use `match`",
    );
  });

  // Pattern Matching §6.5, issue #83. The paren-free spelling desugars to the same
  // parameter the parenthesized one does, so it inherits the gate and the row rules
  // rather than needing its own.
  test("gates a paren-free pattern parameter for refutability", () => {
    const irrefutable = checkSource(
      "union UserId = UserId(value: Int)\n" +
        "let unwrap = UserId(n) => n\n" +
        "let answer = unwrap(UserId(42))",
    );

    expect(irrefutable.diagnostics).toEqual([]);
    expect(letSymbol(irrefutable, "answer").scheme.type).toMatchObject({
      kind: "Primitive",
      name: "Int",
    });

    const refutable = checkSource(
      "union Maybe = Some(value: Int) | None\n" +
        "let unwrap = Some(value) => value",
    );
    // The gate is unchanged by #505; at a lambda parameter the refusal now names
    // the construct that does what this writer meant (Pattern Matching §6.7).
    expect(refutable.diagnostics.map(({ message }) => message)).toContain(
      "this pattern can fail: `None`; use `match` — for a match function, write `match` with arms",
    );
  });

  test("infers a paren-free record parameter row-polymorphically, exactly like `p.x`", () => {
    // §6.5's row pin: `{x} => x` constrains its parameter the way field access does,
    // so a wider record still fits.
    const module = checkSource(
      "let getX = {x} => x\n" +
        "let first = getX({x = 1})\n" +
        "let second = getX({x = 2, y = True})",
    );

    expect(module.diagnostics).toEqual([]);
    expect(letSymbol(module, "first").scheme.type).toMatchObject({
      kind: "Primitive",
      name: "Int",
    });
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
        '    (True, count) => "active"\n' +
        '    (_, _) => "inactive"\n' +
        'fun recordName(user: {name: String, active: Bool}): String = match user\n' +
        '    {active = True, name} => name\n' +
        '    {name} => name',
    );

    expect(module.diagnostics).toEqual([]);

    // #594: the tuple is a finite-shape domain, so its arms are checked exactly
    // rather than made to write a catch-all. Four exact arms cover `(Bool, Bool)`;
    // here the second component is `Int`, so the witness names the missing half
    // and leaves the infinite half `_`.
    const exact = checkSource(
      'fun corners(pair: (Bool, Bool)): Int = match pair\n' +
        "    (True, True) => 0\n" +
        "    (True, False) => 1\n" +
        "    (False, True) => 2\n" +
        "    (False, False) => 3",
    );
    expect(exact.diagnostics).toEqual([]);

    const incomplete = checkSource(
      'fun tupleLabel(pair: (Bool, Int)): String = match pair\n    (True, _) => "active"',
    );
    expect(incomplete.diagnostics.map(({ message }) => message)).toContain(
      "match is missing cases: `(False, _)`",
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
      'fun describe(flag: Bool): String = match flag\n    True => "yes"\n    False => "no"\n' +
        'fun count(n: Int): String = match n\n    0 => "none"\n    1 => "one"\n    _ => "many"',
    );
    expect(module.diagnostics).toEqual([]);

    const strings = checkSource(
      'fun agrees(answer: String): Bool = match answer\n    "yes" => True\n    _ => False',
    );
    expect(strings.diagnostics).toEqual([]);

    const incomplete = checkSource(
      'fun count(n: Int): String = match n\n    0 => "none"',
    );
    // The infinite domains report through §7.3's one sentence too (#594): no set
    // of literals completes them, so the witness is `_` — which is exactly what
    // "a catch-all is required" means.
    expect(incomplete.diagnostics.map(({ message }) => message)).toContain(
      "match is missing cases: `_`",
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
      'fun describe(flag: Bool): String = match flag\n    True when flag => "yes"\n    False => "no"',
    );
    expect(guardedOnly.diagnostics.map(({ message }) => message)).toContain(
      "match is missing cases: `True`",
    );

    const wrongGuard = checkSource(
      'fun describe(flag: Bool): String = match flag\n    True when 1 => "yes"\n    _ => "no"',
    );
    expect(wrongGuard.diagnostics.map(({ message }) => message)).toContain(
      "integer literal cannot have type `Bool`",
    );
  });

  test("preserves a named record tail between parameter and result annotations", () => {
    const module = checkSource(
      'fun rename(r: {guest: String, ...rest}): {guest: String, ...rest} = {r with guest = "Renamed"}\n' +
        'let updated = rename({guest = "Mira", seats = 3})\n' +
        "let seats = updated.seats",
    );

    expect(module.diagnostics).toEqual([]);
    expect(typeName(letSymbol(module, "seats").scheme.type)).toBe("Int");
  });

  test("checks nested tuple and renamed record patterns in constructor payloads", () => {
    const module = checkSource(
      // Named `Outcome`/`Fine`/`Bad`, not `Result`/`Ok`/`Err`: this now compiles
      // with the prelude, whose `Result` owns those constructor names.
      "union Outcome = Fine(value: (String, Int)) | Bad(error: {context: {message: String}, code: Int})\n" +
        "fun describe(outcome: Outcome): String = match outcome\n" +
        "    Fine((name, _)) => name\n" +
        "    Bad({context = {message = reason}}) => reason",
    );

    expect(module.diagnostics).toEqual([]);
    expect(typeName(module.symbols.find(({ name }) => name === "reason")!.scheme.type)).toBe("String");
  });

  test("checks closed and open structural record annotations", () => {
    const open = checkSource(
      "fun getX(r: {x: Int, ...}): Int = r.x\n" +
        "let first = getX({x = 1})\n" +
        "let second = getX({x = 2, y = True})",
    );
    expect(open.diagnostics).toEqual([]);

    const closed = checkSource(
      "fun getX(r: {x: Int}): Int = r.x\n" +
        "let extra = getX({x = 1, y = True})",
    );
    expect(closed.diagnostics.map(({ message }) => message)).toContain(
      "record fields do not match; unexpected `y`",
    );
  });

  test("checks immutable record updates without permitting field addition", () => {
    const valid = checkSource(
      "let point = {x = 1.0, y = 2.0}\n" +
        "let moved = {point with x = 3.0}\n" +
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
      "let point = {x = 1}\nlet moved = {point with y = 2}",
    );
    expect(invalid.diagnostics.map(({ message }) => message)).toContain(
      "record update cannot add fields; the input has no field `y`",
    );
  });

  test("binds fields from an open structural record pattern", () => {
    const module = checkSource(
      'let reservation = {guest = "Mira", seats = 3, confirmed = True}\n' +
        "let {guest, seats} = reservation\n" +
        "let label = guest\nlet count = seats",
    );

    expect(module.diagnostics).toEqual([]);
    expect(typeName(letSymbol(module, "guest").scheme.type)).toBe("String");
    expect(typeName(letSymbol(module, "seats").scheme.type)).toBe("Int");
  });

  test("types primitive literals and defaults bare integers to Int", () => {
    const module = checkSource(
      'let count = 1\nlet ratio = 1.5\nlet exact = 1n\nlet flag = True\nlet text = "hello"\nlet unit = ()',
    );

    // By name: `True` names a prelude constructor, so the module's symbol list
    // now carries the prelude's own symbols alongside these six.
    for (const [name, expected] of [
      ["count", "Int"],
      ["ratio", "Float"],
      ["exact", "BigInt"],
      ["flag", "Bool"],
      ["text", "String"],
      ["unit", "Unit"],
    ] as const) {
      expect([name, typeName(letSymbol(module, name).scheme.type)]).toEqual([name, expected]);
    }
    expect(module.items.find(({ kind }) => kind === "Let")).toMatchObject({
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

  test("adds nothing of its own to the retired console.log form", () => {
    const module = checkSource('console.log("answer", 42, True)');

    // The resolver's report is the whole of it (#417): the call keeps the shape
    // any absent global recovers to, with only its receiver poisoned, so the
    // checker reads a member access on the error type and says nothing further.
    expect(expression(module)).toMatchObject({
      kind: "Call",
      callee: {
        kind: "Access",
        receiver: { kind: "ErrorExpr" },
        field: { text: "log" },
      },
    });
    expect(module.diagnostics.map(({ message }) => message)).toEqual([
      "`console.log` is not a Hexagon operation; the debugging probe is `Debug.log`",
    ]);
  });

  test("still reports what a refused console.log call's arguments say", () => {
    const module = checkSource('console.log(nmae)');

    // The arguments are received, so a defect written inside them is reported
    // once and by its own name. Exactly two sentences: a recovery that swallowed
    // the argument list would leave the typo for the writer to find at runtime.
    expect(module.diagnostics.map(({ message }) => message)).toEqual([
      "`console.log` is not a Hexagon operation; the debugging probe is `Debug.log`",
      "unknown name `nmae`",
    ]);
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
      "fun choose(value) = if True then value else choose(value)\n" +
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
      'let (name, _, (x, y)) = ("point", True, (3, 4))\n' +
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
        "let same(left: a, right: b) = if True then left else right",
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
        "let choose(thing: a, fallback) = if True then thing else fallback\n" +
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
      "export let fingerprint<a: Eq>(thing: a): Int = Hash.hash(thing)\n" +
        "let numeric<a>(thing: a) = thing + 1",
    );

    // Not source order, and that is the ordinary order for a constraint member:
    // since `stdlib/Hash.hex` joined the prelude (#335), `hash(thing)` is a call
    // to the member export rather than the resolver's wired `hash` form (which
    // yields to any binding of the name), so its rejection arrives with the
    // deferred requirement discharges instead of during item 1's inference. The
    // same program written with `show(thing)` under `<a: Eq>` — a member that
    // never had a wired form — reports in exactly this order too.
    expect(rejected.diagnostics.map(({ message }) => message)).toEqual([
      "`a` is declared without constraints, but the body requires `Num`; write `<a: Num>`, or remove the explicit type parameter to let it be inferred",
      "`a` is declared to honor `Eq`, but the body requires `Hash`; write `<a: Hash>`, or remove the constraint annotation to let it be inferred",
    ]);

    const accepted = checkSource(
      "export let fingerprint<a: Hash>(thing: a): Int = Hash.hash(thing)\n" +
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

  test("requires complete signatures on exported values and functions", () => {
    const module = checkSource(
      "export let answer = 42\n" +
        "export let greet(name) = \"Hello, \" ++ name\n" +
        "export fun choose<a>(left: a, right): a = left\n" +
        "let privateAnswer = 42\n" +
        "let privateGreeting(name) = \"Hello, \" ++ name",
    );

    expect(module.diagnostics.map(({ message }) => message)).toEqual([
      "exported value `answer` requires a type annotation",
      "exported function `greet` requires a complete signature; add type for parameter `name` and a return type",
      "exported function `choose` requires a complete signature; add type for parameter `right`",
    ]);
  });

  test("requires explicit maximal constraints on exported function signatures", () => {
    const module = checkSource(
      "export let inferred(value: a): Bool = value == value\n" +
        "export let redundant<a: (Eq, Hash)>(value: a): Int = Hash.hash(value)\n" +
        "export let complete<a: Hash>(value: a): Bool = value == value\n" +
        "let private(value: a) = value == value",
    );

    expect(module.diagnostics.map(({ message }) => message)).toEqual([
      "exported function `inferred` must declare every constraint in its signature; write `<a: Eq>`",
      "exported function `redundant` must omit base constraint `Eq` from `a`; `Hash` already provides it",
    ]);
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
        "    Wrapped(_) when False => 1\n" +
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
    expect(messages).toContain("`Missing` is a value, not a function; write it without `()`");
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
        "choose(True, 1, 2)",
    );
    const bad = checkSource(
      'let pair = (x, y) => x\npair(1)\nif "yes" then 1 else True',
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
      "this expression's value is discarded — its type is `Int`; wrap it in `ignore(...)` if discarding is intentional",
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
      "type `String` has no `Signed` instance; its only legal homes are the module " +
        "declaring `Signed` and `String`'s prelude companion module, both outside project " +
        "source, so this pair's honored set is closed — change the type, or go through " +
        "the operations those homes export",
    );
  });

  test("keeps compiler-supported constraint subjects universally quantified", () => {
    // Spelled with names of the module's own since #335 banned redeclaring
    // `Integral` — the compiler holds its declaration now (`stdlib/Integral.hex`
    // is a prelude member, and so is a `gcd` this lookup would find first). The
    // observation is unchanged and is about the *bases*: a subject constrained
    // by the compiler's own pre-registered constraints is still universally
    // quantified, not pinned to a specimen.
    const module = checkSource(
      "constraint Divisor<a: (Num, Ord)> =\n" +
        "    greatest(left: a, right: a): a",
    );
    const greatest = module.symbols.find(({ name }) => name === "greatest");

    expect(greatest?.scheme).toMatchObject({
      variables: [expect.any(Number)],
      constraints: [{ name: "Divisor", type: { kind: "Variable" } }],
      type: {
        kind: "Function",
        parameters: [{ kind: "Variable" }, { kind: "Variable" }],
        result: { kind: "Variable" },
      },
    });
    expect(module.diagnostics).toEqual([]);
  });

  test("keeps an instance parameter rigid across pattern-bound occurrences", () => {
    const module = checkSource(
      "constraint Describe<a> =\n" +
        "    describe(value: a): String\n" +
        "union Wrap(a) = Empty | Full(value: a)\n" +
        "honor<a: Describe> Describe<Wrap(a)> =\n" +
        "    describe(wrap) = match wrap\n" +
        '        Empty => "empty"\n' +
        // The dot call, not the bare own name: Constraints §4.6 refuses a
        // member's own spelling in its own body, and `value: a` dispatches
        // through the instance's binder evidence — which is the occurrence this
        // test is about.
        '        Full(value) => "full(${value.describe()})"',
    );

    // A match pattern's fresh variable unifies with the instance parameter;
    // the parameter must stay its class's representative, or the requirement
    // lands on an undischargeable variable — this module used to report a
    // blocked default ("cannot default to `Int`") with no use site, and to
    // absorb the first use site's concrete type with one.
    expect(module.diagnostics).toEqual([]);
  });

  test("rejects an instance body demanding a constraint the header does not declare", () => {
    const module = checkSource(
      "constraint Describe<a> =\n" +
        "    describe(value: a): String\n" +
        "record Box(a) = {value: a}\n" +
        "honor<a: Describe> Describe<Box(a)> =\n" +
        '    describe(box) = "${box.value + 1}"',
    );

    // Rigidity makes the demand reportable — at the body expression that made
    // it, naming the header rewrite — instead of silently binding `a` to the
    // first use's type: interpolation demands `Show`, arithmetic demands
    // `Num`, and the header declares only `Describe`.
    expect(module.diagnostics).toMatchObject([
      {
        message:
          "`a` is declared to honor `Describe`, but the body requires `Show`; " +
          "write `<a: (Describe, Show)>` on the `honor` header",
      },
      {
        message:
          "`a` is declared to honor `Describe`, but the body requires `Num`; " +
          "write `<a: (Describe, Num)>` on the `honor` header",
      },
    ]);
  });

  test("rejects a default body demanding a constraint the subject does not reach", () => {
    const module = checkSource(
      "constraint MyEq<a> =\n" +
        "    eq(left: a, right: a): Bool\n" +
        "constraint Labelled<a: MyEq> =\n" +
        "    label(value: a): String\n" +
        '    shown(value: a): String = "${value}"',
    );

    // The rewrite must be legal at the declaration site: a constraint cannot
    // list itself as a base, so the message merges the demand into the
    // declared base list rather than into a `<a: (…)>` binder.
    expect(module.diagnostics).toMatchObject([
      {
        message:
          "`a` is `Labelled`'s subject, so the body reaches only `Labelled` and its " +
          "base constraints, but it requires `Show`; add `Show` as a base constraint — " +
          "write `constraint Labelled<a: (MyEq, Show)>`",
      },
    ]);
  });

  test("keeps a constraint subject rigid through default member bodies", () => {
    const module = checkSource(
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
        "let picked: Int = pickHeld(0, Held2(42))\n" +
        'let name: String = pickHeld("x", Held2("y"))',
    );

    // The default body's pattern variable used to absorb the subject, and the
    // first use then bound the shared subject to `Int` — making the second,
    // String-typed use report a type mismatch against a well-typed program.
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
        "let answer: Int = get(Box({value = 42}))",
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
        "    while True\n" +
        "        42",
    );
    expect(invalid.diagnostics.map(({ message }) => message)).toContain(
      "`fixed` is not mutable; declare it with `var` if you need to update it",
    );
    expect(invalid.diagnostics.map(({ message }) => message)).toContain(
      "the final expression of a loop body produces a value that is discarded on every iteration; use `ignore(...)` if intended",
    );
  });

  test("accepts an else-less `if` with a Unit then-branch (`else ()` sugar)", () => {
    const module = checkSource(
      "let update(cond: Bool): Unit =\n" +
        "    var status = \"waiting\"\n" +
        "    if cond then\n" +
        "        status := \"finished\"",
    );
    expect(module.diagnostics).toEqual([]);

    const invalid = checkSource(
      "let pick(cond: Bool): String =\n" +
        "    if cond then\n" +
        "        \"yes\"",
    );
    expect(invalid.diagnostics.map(({ message }) => message)).toContain(
      "an `if` without `else` produces `Unit`; its `then` branch is " +
        "`String` — add an `else` branch to produce a value",
    );
  });

  test("reports the else-less fixit for a numeric-literal then-branch", () => {
    // A polymorphic literal would unify with the synthesized `Unit`
    // structurally and succeed, leaving the literal's own `Num` failure to
    // report `integer literal cannot have type `Unit`` at that binding; the
    // then-branch settles to `Int` first so §11.2's fixit fires instead.
    for (
      const text of [
        "let y(c: Bool) = if c then 5",
        "let y(c: Bool): Unit = if c then 5",
        "fun y(c: Bool): Unit =\n" +
          "    if c then\n" +
          "        5",
        // Statement position: the `if` is a non-final block item.
        "fun y(c: Bool): Unit =\n" +
          "    if c then\n" +
          "        5\n" +
          "    ()",
        // The literal's variable is shared with a binder outside the `if`.
        "let y(c: Bool) = x => if c then x + 1",
        "let y(c: Bool) =\n" +
          "    let n = 1\n" +
          "    if c then\n" +
          "        n",
      ]
    ) {
      expect(checkSource(text).diagnostics.map(({ message }) => message))
        .toEqual([
          "an `if` without `else` produces `Unit`; its `then` branch is " +
            "`Int` — add an `else` branch to produce a value",
        ]);
    }

    // Monomorphic literals never had the defect — they elaborate concrete —
    // but the fixit must still name them.
    for (const [text, type] of [
      ["let y(c: Bool) = if c then 5.5", "Float"],
      ["let y(c: Bool) = if c then 5n", "BigInt"],
      ["let y(c: Bool) = if c then -5", "Int"],
    ] as const) {
      expect(checkSource(text).diagnostics.map(({ message }) => message))
        .toEqual([
          "an `if` without `else` produces `Unit`; its `then` branch is " +
            `\`${type}\` — add an \`else\` branch to produce a value`,
        ]);
    }
  });

  test("never settles a declared type variable at a `Unit` demand", () => {
    // A declared variable is pinned by its annotation. Settling it would
    // report the annotation as requiring the `Int` the settling itself
    // invented — a mandatory fixit naming a rewrite that repairs nothing.
    expect(
      checkSource("fun f<a: Num>(c: Bool, x: a): Unit = if c then x").diagnostics
        .map(({ message }) => message),
    ).toEqual([
      "`a` is a declared type variable, but the body requires `Unit`; " +
        "change the annotation to `Unit`, or remove it to let the type be inferred",
    ]);
    // Structured too, where the settling is otherwise certain to fire — and
    // the declared variable is named, not shown as an inference variable.
    expect(
      checkSource("fun f<a: Num>(c: Bool, x: a) = if c then (1, x)").diagnostics
        .map(({ message }) => message),
    ).toEqual([
      "an `if` without `else` produces `Unit`; its `then` branch is " +
        "`(Int, a)` — add an `else` branch to produce a value",
    ]);
  });

  test("`honor` cannot target `Unit`, which is structural (#159)", () => {
    // This test used to accept `honor Conjure<Unit>` and pin that a constraint
    // honored at `Unit` blocked settling. `Unit` is now the empty tuple, and
    // structural types are user-closed (Constraints §9.3), so the premise is
    // no longer spellable: the honor itself is the error, and settling's
    // `Unit`-side answer is the structural tuple one, with no user door.
    const honored = "constraint Conjure<a> =\n" +
      "    make(): a\n" +
      "honor Conjure<Int> =\n" +
      "    make() = 1\n" +
      "honor Conjure<Unit> =\n" +
      "    make() = ()\n";
    expect(
      checkSource(honored + "let n: Int = make()").diagnostics
        .map(({ message }) => message),
    ).toContain(
      "instances are keyed on type constructors; tuples and structural records " +
        "have compiler-derived instances only — declare a nominal `record` or " +
        "`union` for a type you control",
    );
  });

  test("settles and reports a constraint the demanded `Unit` cannot satisfy", () => {
    // Settling asks whether the variable can be `Int` and cannot be the
    // demanded `Unit` (Numeric Literals §6). `Unit`'s instances are exactly
    // the structural tuple set, so a user constraint is never satisfiable
    // there and the demand site's own report fires, naming `Int`.
    const intOnly = "constraint Conjure<a> =\n" +
      "    make(): a\n" +
      "honor Conjure<Int> =\n" +
      "    make() = 1\n";
    expect(
      checkSource(intOnly + "let y(c: Bool): Unit = if c then make()").diagnostics
        .map(({ message }) => message),
    ).toEqual([
      "an `if` without `else` produces `Unit`; its `then` branch is " +
        "`Int` — add an `else` branch to produce a value",
    ]);
  });

  test("keeps §4's defaultable set closed against user `honor` instances", () => {
    // A user `honor Conjure<Int>` must not make `Conjure` defaultable:
    // Numeric Literals §4's list is hard-coded "not user-extensible", and §7
    // rejects extensible defaulting as a design. Nothing pins `v`, so this is
    // §4's ambiguity error rather than a silent `v : Int`.
    const conjure = "constraint Conjure<a> =\n" +
      "    make(): a\n" +
      "honor Conjure<Int> =\n" +
      "    make() = 1\n";
    const ambiguous = checkSource(conjure + "let v = make()");
    expect(ambiguous.diagnostics.map(({ message }) => message)).toEqual([
      "this expression's type cannot default to `Int`: `Conjure` is not a " +
        "defaultable constraint; add a type annotation to pin the type",
    ]);
    expect(letSymbol(ambiguous, "v").scheme.type).toMatchObject({ kind: "Variable" });
    // …carets the use, not `make`'s declaration. A requirement copied out of a
    // scheme inherits the definition's span, which for an imported constraint
    // is another module's source; §6 asks for the location of the literal or
    // expression whose type is stuck.
    expect(ambiguous.diagnostics[0]?.primary).toMatchObject({
      start: { line: 4, column: 8 },
      end: { line: 4, column: 12 },
    });

    // The annotation §6 names is the repair, and it compiles.
    expect(checkSource(conjure + "let v: Int = make()").diagnostics).toEqual([]);

    // A literal under a user constraint is §4's `{Num α, SomeUserConstraint α}`
    // case: it is the user constraint that blocks, not `Num`, and §6 requires
    // the report to name the blocking constraint at the literal's location.
    const literal = checkSource(
      "constraint Tag<a> =\n" +
        "    label(value: a): String\n" +
        "honor Tag<Int> =\n" +
        "    label(value) = \"int\"\n" +
        "let text = label(1)",
    );
    expect(literal.diagnostics.map(({ message }) => message)).toEqual([
      "the literal `1` cannot default to `Int`: `Tag` is not a defaultable " +
        "constraint; add a type annotation to pin the type",
    ]);
    expect(literal.diagnostics[0]?.primary).toMatchObject({
      start: { line: 4, column: 17 },
      end: { line: 4, column: 18 },
    });

    // Literals that unify share one blocked variable, and their duplicate
    // `Num` requirements collapse to one — so the report fires once, naming
    // the literal its own caret points at rather than one of them each.
    const shared = checkSource(
      "constraint Pairable<a> =\n" +
        "    pair(left: a, right: a): String\n" +
        "honor Pairable<Int> =\n" +
        "    pair(left, right) = \"pair\"\n" +
        "let text = pair(4, 6)",
    );
    expect(shared.diagnostics.map(({ message }) => message)).toEqual([
      "the literal `6` cannot default to `Int`: `Pairable` is not a " +
        "defaultable constraint; add a type annotation to pin the type",
    ]);
    expect(shared.diagnostics[0]?.primary).toMatchObject({
      start: { line: 4, column: 19 },
      end: { line: 4, column: 20 },
    });

    // A declared type variable never defaulted, so nothing about it is
    // blocked — the annotation already pins it, and the report would name a
    // rewrite that repairs nothing.
    expect(
      checkSource(conjure + "fun f<a: Conjure>(): a = make()\nlet used: Int = f()")
        .diagnostics,
    ).toEqual([]);
  });

  test("defaults through the compiler's own `Int` instances", () => {
    // The closed set is the compiler's table, so the builtin constraints on it
    // still default — including `Integral`, whose bare-call literal case its
    // own spec (Integral §8) expects to resolve to `Int` as usual.
    //
    // The bare `gcd` needs no declaration to reach any more, which is the
    // spelling Integral §8 always described: `stdlib/Integral.hex` is a prelude
    // member since #335, so its members are exports in bare scope and a
    // module-level redeclaration is refused.
    const integral = checkSource("let common = Integral.gcd(4, 6)");
    expect(integral.diagnostics).toEqual([]);
    expect(letSymbol(integral, "common").scheme.type).toEqual({
      kind: "Primitive",
      name: "Int",
    });

    // And §4's own consequence list: `{Num}` and `{Num, Show}` both default.
    const plain = checkSource("let count = 1\nlet text = \"${1 + 2}\"");
    expect(plain.diagnostics).toEqual([]);
    expect(letSymbol(plain, "count").scheme.type).toEqual({
      kind: "Primitive",
      name: "Int",
    });
  });

  test("quantifies a parameterized instance's own type parameter", () => {
    // `honor<a: Render>` binds `a`; it is not an unresolved variable for
    // defaulting to settle — nor one for the blocked-defaulting report to
    // name, which is how the absent quantification became visible.
    const module = checkSource(
      "constraint Render<a> =\n" +
        "    render(value: a): String\n" +
        "honor Render<Int> =\n" +
        "    render(value) = \"int\"\n" +
        "record Box(a) = {value: a}\n" +
        "honor<a: Render> Render<Box(a)> =\n" +
        "    render(box) = \"box\"\n" +
        "let boxed: Box(Int) = Box({value = 42})\n" +
        "let text: String = render(boxed)",
    );
    expect(module.diagnostics).toEqual([]);
  });

  test("names concrete types when a discarded branch is structured", () => {
    // A structured branch can never be the demanded `Unit`, so its literals
    // would otherwise reach a mandatory fixit as raw variables — `(?0, ?1)`.
    expect(
      checkSource("let y(c: Bool) = if c then (1, 2)").diagnostics
        .map(({ message }) => message),
    ).toEqual([
      "an `if` without `else` produces `Unit`; its `then` branch is " +
        "`(Int, Int)` — add an `else` branch to produce a value",
    ]);
    expect(
      checkSource("let y(c: Bool) = if c then [1, 2]").diagnostics
        .map(({ message }) => message),
    ).toEqual([
      "an `if` without `else` produces `Unit`; its `then` branch is " +
        "`Vector(Int)` — add an `else` branch to produce a value",
    ]);
    expect(
      checkSource("fun y(): Unit =\n    (1, 2)\n    ()").diagnostics
        .map(({ message }) => message),
    ).toEqual([
      "this expression's value is discarded — its type is `(Int, Int)`; " +
        "wrap it in `ignore(...)` if discarding is intentional",
    ]);

    // §4 refuses to settle a component a non-defaultable constraint blocks, so
    // one survives into the fixit — and §6 requires survivors there to be
    // named, not numbered: `(a, Int)`, never `(?2, Int)`.
    const conjure = "constraint Conjure<a> =\n" +
      "    make(): a\n" +
      "honor Conjure<Int> =\n" +
      "    make() = 1\n";
    expect(
      checkSource(conjure + "fun y(): Unit =\n    (make(), 2)\n    ()").diagnostics
        .map(({ message }) => message),
    ).toContain(
      "this expression's value is discarded — its type is `(a, Int)`; " +
        "wrap it in `ignore(...)` if discarding is intentional",
    );
    expect(
      checkSource(conjure + "let y(c: Bool) = if c then (make(), 2)").diagnostics
        .map(({ message }) => message),
    ).toContain(
      "an `if` without `else` produces `Unit`; its `then` branch is " +
        "`(a, Int)` — add an `else` branch to produce a value",
    );
  });

  test("checks Range and String for loops with their concrete item types", () => {
    const module = checkSource(
      "fun visit(): Unit =\n" +
        "    for number in 1..3\n" +
        // Not `next`: that is a prelude term (`Seq.next`), and a *local* binding
        // of a prelude name is currently rejected as rebinding — a pre-existing
        // compiler defect this test would otherwise trip over now that it
        // compiles with the prelude.
        "        let incremented: Int = number + 1\n" +
        "        Debug.log(\"${incremented}\")\n" +
        "    for character in \"ab\"\n" +
        "        let copy: String = character\n" +
        "        Debug.log(copy)",
    );
    expect(module.diagnostics).toEqual([]);

    const invalid = checkSource(
      "fun bad(): Unit =\n" +
        "    for True in 1..3\n" +
        "        ()\n" +
        "    for item in 42\n" +
        "        ()",
    );
    // #607: `True` fails to type against the `Int` item, and Pattern Matching
    // §7.3's error-program obligation reaches the `for..in` gate — the broken
    // pattern reads as `_`, so every repair of it is irrefutable and the gate
    // has nothing left to report. The deeper fault leads, and it is the one
    // below.
    expect(invalid.diagnostics.map(({ message }) => message)).toContain(
      "type mismatch: expected Int, found Bool",
    );
    expect(invalid.diagnostics.map(({ message }) => message)).not.toContain(
      "this pattern can fail: `_`; use `match`",
    );
    expect(invalid.diagnostics.map(({ message }) => message)).toContain(
      "type `Int` has no `Iterable` instance; its only legal homes are the module " +
        "declaring `Iterable` and `Int`'s prelude companion module, both outside project " +
        "source, so this pair's honored set is closed — change the type, or go through " +
        "the operations those homes export",
    );
  });

  test("a for head with no module path keeps the generic requirement failure", () => {
    // §3.3's report names a file, and a module assembled by calling the passes
    // directly has no path to name one from — so it falls back rather than
    // inventing a route (#395).
    expect(
      checkModule(
        "record Bag = {size: Int}\n" +
          "let bag: Bag = Bag({size = 1})\n" +
          "fun run(): Unit =\n" +
          "    for item in bag\n" +
          "        ()\n",
      ).diagnostics.map(({ message }) => message),
    ).toContain("type `Bag` has no `Iterable` instance");
  });

  // 250 full compiles: since #147 put `Bool` in the prelude, every run loads the
  // project rather than calling the passes directly. That is ~3s in the full suite
  // here and 5573ms on the runner that took the Pages deploy down with it (#160,
  // #163) — barely over the default 5s budget, which had been thin since #147.
  // Explicit per test rather than a global testTimeout, so the other 680 keep the
  // tight default.
  //
  // Raised to 60s with #344's last landing: `Float.hex` and `String.hex` joined
  // the prelude, so each of these 250 compiles carries two more modules and the
  // test measures ~25s alone against the old 30s budget — passing in isolation
  // and failing under the full suite's parallel load, which is the same thin
  // margin the note above was written about, one prelude growth later.
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
  }, 60_000);
});

/**
 * Since #147 made `Bool` a prelude union rather than a primitive, a module
 * assembled by calling the passes directly cannot type a condition, a guard, a
 * comparison, or a logic operator — the declaration those name lives in
 * `stdlib/Bool.hex`. Everything therefore goes through the project, which
 * injects the prelude; `checkModule` below is what remains for the handful of
 * cases that genuinely test a prelude-free module.
 */
function checkSource(text: string): Typed.Module {
  return checkProject(text);
}

/** A single module checked with no prelude at all. */
function checkModule(text: string): Typed.Module {
  const source = new Source.File(Source.fileId(0), "test.hex", "module Test\n\n" + text);
  return check(resolve(parse(applyLayout(lex(source)))));
}

/**
 * The same, through `compileProject`, so the prelude is present. `Seq(a)` is a
 * prelude declaration (Loops §6.6), so a module assembled by calling the passes
 * directly cannot name it.
 */
function checkProject(text: string): Typed.Module {
  const project = compileProject([new Source.File(Source.fileId(0), "/main.hex", "module Main\n\n" + text)]);
  return project.modules.find((module) => module.source.path === "/main.hex")!.typed;
}

function expression(module: Typed.Module): Typed.Expr {
  const item = module.items.at(-1);
  if (item?.kind !== "ExprItem") throw new Error("expected an expression item");
  return item.expression;
}

function typeName(type: Typed.Type): string {
  // Unions report their name too, so `Bool` reads as `Bool` rather than as
  // `Union` now that #147 made it one. The arity-0 tuple reads as `Unit` for
  // the same reason, now that #159 made it that.
  if (type.kind === "Primitive" || type.kind === "Union") return type.name;
  if (type.kind === "Tuple" && type.elements.length === 0) return "Unit";
  return type.kind;
}

// The module's own `let`, never a prelude one of the same name: a project-checked
// module carries the prelude's symbols too, and the stdlib shares plain vocabulary
// (`first`, `empty`, `get`, …) with the sources these tests write.
function letSymbol(module: Typed.Module, name: string): Typed.Symbol {
  const symbol = module.symbols.find(
    (candidate) =>
      candidate.kind === "let" &&
      candidate.name === name &&
      candidate.bindingSpan.fileId === module.fileId,
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
