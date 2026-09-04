import { describe, expect, test } from "vitest";

import { compileFiles, compileMain, projectDiagnostics, runMain }
  from "../support/test-project.js";
import { PRELUDE_SOURCES } from "../prelude-sources.js";
import {
  isPreRegisteredConstraint,
  NON_REDECLARABLE_CONSTRAINTS,
  STRUCTURAL_CONSTRAINTS,
} from "../constraints.js";

/**
 * Conformance for **Modules §5.5's inverted seeding and its closed bare set**
 * (#742).
 *
 * The prelude used to seed every export into every module's bare term scope.
 * §5.5 now seeds **nothing** there by default, and four channel rules put
 * sixteen names back: the eight exception constructors, the six constructors of
 * the open unions `Bool`/`Option`/`Result`, `ignore`, and `show`. Everything
 * else is reached by the dot or the qualified spelling, and a bare reference to
 * it draws §10's refusal with its routes named.
 *
 * ## What this file is for that the channel tests are not
 *
 * The companion suites (`vector-prelude-companion`, `float-companion`,
 * `js-kind-qualification`, …) each pin their own module's surface. This one pins
 * the **rule**: the set is exactly sixteen names and is closed, each channel
 * admits what it says it admits and nothing beside, and the refusal has one
 * shape across all three channels. The set pin is written against the *compiled
 * prelude* rather than a transcription, so drift in either direction — a name
 * leaving the layer, or a new stdlib export arriving in it — fails here.
 */

/**
 * Every name the prelude layer binds in an ordinary consumer.
 *
 * Read off the resolved module's outermost scope region, which **is** the
 * prelude layer (`Resolver#resolve` gives `#preludeScope` the module's span and
 * registers it first). Reading the compiler's manifests instead would pin the
 * lists against themselves; this reads what a program actually sees.
 */
function bareNames(source = "export let ok: Int = 1\n"): readonly string[] {
  const compiled = compileMain("module Main\n\n" + source);
  const main = compiled.modules.find(({ source: file }) => file.path === "/main.hex")!;
  return [...new Set(main.resolved.scopes[0]!.bindings.map(({ name }) => name))].sort();
}

/** The names the module's **own** layer binds — the scope inside the prelude's. */
function moduleNames(source: string): readonly string[] {
  const compiled = compileMain("module Main\n\n" + source);
  const main = compiled.modules.find(({ source: file }) => file.path === "/main.hex")!;
  return [...new Set(main.resolved.scopes[1]!.bindings.map(({ name }) => name))].sort();
}

/**
 * The bare set as the spec states it (§5.5), spelled out rather than derived.
 *
 * A derived expectation would agree with any implementation, including a wrong
 * one; the point of this list is that adding a prelude export cannot quietly
 * grow it and removing a channel cannot quietly shrink it. An addition here is a
 * design ruling argued against §5.5, never an edit.
 */
const BARE_SET = [
  // The eight exception constructors — a category, not a list (§5.5).
  "DivideByZeroError",
  "FloatRangeError",
  "IndexError",
  "JsError",
  "KeyError",
  "NegativeExponentError",
  "ReentrancyError",
  "SliceError",
  // The open unions' six constructors.
  "Err",
  "False",
  "None",
  "Ok",
  "Some",
  "True",
  // The pervasive term, and the one member.
  "ignore",
  "show",
].sort();

describe("the bare set is exactly sixteen names, and closed", () => {
  test("the prelude layer binds the set and nothing else", () => {
    expect(bareNames()).toEqual(BARE_SET);
  });

  test("sixteen is the count the section states", () => {
    expect(BARE_SET.length).toBe(16);
  });

  /**
   * **A `derives` clause seeds nothing** (#753 review). §5.5's in-module
   * carve-out is for a module that *binds* members — an `honor` block it wrote —
   * and a `derives` writes no block: the instance is the compiler's. Seeding off
   * the wider index §4.6's laws use gave a deriving module nineteen bare names
   * and let `compare(1, 2)` compile in it, which is ruling 4 undone by an
   * implementation detail. The layer is the plain sixteen here.
   */
  test("a module that derives seeds nothing of its own", () => {
    const source = "export record Box derives (Eq, Ord) = {n: Int}\n";
    expect(bareNames(source)).toEqual(BARE_SET);
    expect(projectDiagnostics("module Main\n\n" + `${source}export let o: Ordering = compare(1, 2)\n`))
      .toEqual(["no bare `compare`; write `(1).compare(2)` or `Ord.compare(1, 2)`"]);
  });

  /**
   * An `honor` block is the other half of the same rule, and its members do come
   * back — the completed set, defaults included, since an omitted default is
   * bound here too as the wrapper seat the emitter hoists for it.
   *
   * **Where they sit is measured, not assumed.** They are put back into the
   * *prelude* layer, because what goes back is the prelude's own polymorphic
   * member symbol; the module's own layer holds only what the module declares.
   * §5.5 describes them as module-level bindings, and the difference is visible
   * — a function-local `let equals` still shadows rather than colliding — so the
   * placement is pinned rather than left to be discovered.
   */
  test("an honoring module's member spellings sit in the prelude layer, not its own", () => {
    const source =
      "export record Box = {n: Int}\n" +
      "honor Eq<Box> =\n" +
      "    equals(left, right) = left.n == right.n\n";
    expect(bareNames(source))
      .toEqual([...BARE_SET, "equals", "notEquals"].sort());
    expect(moduleNames(source)).toEqual(["Box"]);
  });

  /**
   * The other direction of the same guard, at the channel that is hardest to see
   * from the list: **no prelude function is bare.** `empty`, `map`, `length`,
   * `log`, `isNan`, `fromSeq` are the vocabulary the measurements found the
   * prelude was spending, and every one of them is refused.
   */
  test.each([
    ["empty", "export let e: Vector(Int) = empty\n"],
    ["map", "export let f(xs: Seq(Int)): Seq(Int) = map(xs, x => x)\n"],
    ["length", "export let n(xs: Vector(Int)): Int = length(xs)\n"],
    ["log", 'export let u: Unit = log("hi")\n'],
    ["isNan", "export let b(x: Float): Bool = isNan(x)\n"],
    ["fromSeq", "export let s(xs: Seq(String)): String = fromSeq(xs)\n"],
  ])("bare `%s` is refused", (name, source) => {
    expect(projectDiagnostics("module Main\n\n" + source)[0]).toMatch(
      new RegExp(`^no bare \`${name}\`; write `, "u"),
    );
  });
});

describe("the function channel: none, and `ignore`", () => {
  test("`ignore` is bare, and is the whole of the channel's survivors", async () => {
    expect(projectDiagnostics("module Main\n\n" + "export let u: Unit = ignore(1)\n")).toEqual([]);
    const main = await runMain("module Main\n\n" + "export let discarded: Unit = ignore(41)\nexport let n: Int = 1\n",
    );
    expect(main["n"]).toBe(1);
  });

  /**
   * The routes are spelled **with the call's own arguments** (§5.5): dot form
   * first where the function is dot-callable, then every visible exporter's
   * qualified spelling in prelude order, with no elision. §10's own exemplars,
   * run.
   */
  test("a call's refusal names the dot form and every exporter, in the program's words", () => {
    expect(projectDiagnostics("module Main\n\n" + "export let f(things: Seq(Int), g: Int -> Int): Seq(Int) = map(things, g)\n",
    )).toEqual([
      "no bare `map`; write `things.map(g)`, `Seq.map(things, g)`, " +
      "or `Stream.map(things, g)`",
    ]);
  });

  test("a single-homed dot-callable function names two routes", () => {
    expect(projectDiagnostics("module Main\n\n" + "export let b(reading: Float): Bool = isNan(reading)\n"))
      .toEqual(["no bare `isNan`; write `reading.isNan()` or `Float.isNan(reading)`"]);
  });

  /**
   * Not dot-callable, because its first parameter is `Seq`-headed and `Seq.hex`
   * exports no `fromSeq` — so no route can be written with a receiver, and the
   * message names the qualified spellings alone.
   */
  test("a function that is not dot-callable names the qualified spellings alone", () => {
    expect(projectDiagnostics("module Main\n\n" + "export let s(pairs: Seq(String)): String = fromSeq(pairs)\n"))
      .toEqual([
        "no bare `fromSeq`; write `String.fromSeq(pairs)`, `Vector.fromSeq(pairs)`, " +
        "`Map.fromSeq(pairs)`, `Set.fromSeq(pairs)`, `Stream.fromSeq(pairs)`, " +
        "`JsMap.fromSeq(pairs)`, or `JsSet.fromSeq(pairs)`",
      ]);
  });

  /**
   * **A route that does not mean the call is not a route.** The receiver seat is
   * the one place the program's own words cannot be pasted verbatim: the dot
   * binds tighter than a prefix minus and reaches into a bare numeric literal,
   * so `-7` written there is a *different operation* — `-7.div(2)` parses as
   * `-(7.div(2))` and answers −3 where `Integral.div(-7, 2)` answers −4. The
   * message parenthesises the receiver wherever the grammar would misread it, so
   * the two routes one message offers are always the same operation.
   *
   * Both halves are pinned, because either alone passes for the wrong reason:
   * parenthesising everything would satisfy the negative shapes, and
   * parenthesising nothing would satisfy the positive ones.
   */
  test.each([
    ["a negative integer literal", "export let n: Int = div(-7, 2)\n",
      "no bare `div`; write `(-7).div(2)` or `Integral.div(-7, 2)`"],
    ["a float literal", "export let o: Ordering = compare(2.5, 1.5)\n",
      "no bare `compare`; write `(2.5).compare(1.5)` or `Ord.compare(2.5, 1.5)`"],
    ["a `BigInt` literal", "export let n: BigInt = pow(2n, 10)\n",
      "no bare `pow`; write `(2n).pow(10)` or `Pow.pow(2n, 10)`"],
    ["a prefix-operator expression", "export let n(x: Int): Int = hash(-x)\n",
      "no bare `hash`; write `(-x).hash()` or `Hash.hash(-x)`"],
    ["an infix expression", "export let n(a: Int, b: Int): Int = hash(a + b)\n",
      "no bare `hash`; write `(a + b).hash()` or `Hash.hash(a + b)`"],
    ["an index read", "export let n(v: Vector(Int)): Int = hash(v[1])\n",
      "no bare `hash`; write `(v[1]).hash()` or `Hash.hash(v[1])`"],
  ])("%s receiver is parenthesised", (_shape, source, message) => {
    expect(projectDiagnostics("module Main\n\n" + source)).toEqual([message]);
  });

  test.each([
    ["a plain name", "export let n(x: Int): Int = hash(x)\n",
      "no bare `hash`; write `x.hash()` or `Hash.hash(x)`"],
    ["a dot chain", "export let n: Int = length(Seq.empty)\n",
      "no bare `length`; write `Seq.empty.length()`, `Seq.length(Seq.empty)`, " +
      "`Vector.length(Seq.empty)`, or `Array.length(Seq.empty)`"],
    ["a call", "export let n(g: Int -> Int): Int = hash(g(1))\n",
      "no bare `hash`; write `g(1).hash()` or `Hash.hash(g(1))`"],
    ["an already-grouped expression", "export let n: Int = div((-7), 2)\n",
      "no bare `div`; write `(-7).div(2)` or `Integral.div((-7), 2)`"],
    ["an ascription", "export let n(a: Int): Int = hash((a: Int))\n",
      "no bare `hash`; write `(a: Int).hash()` or `Hash.hash((a: Int))`"],
    ["a nominal constructor call",
      "export record R derives (Eq, Hash) = {x: Int}\nexport let n: Int = hash(R({x = 1}))\n",
      "no bare `hash`; write `R({x = 1}).hash()` or `Hash.hash(R({x = 1}))`"],
  ])("%s receiver is left as written", (_shape, source, message) => {
    expect(projectDiagnostics("module Main\n\n" + source)).toEqual([message]);
  });

  /**
   * And the routes one message offers are **the same operation** — the property
   * the parentheses exist for, executed rather than reasoned about. `div` is the
   * discriminating case: without them the dot route answers −3.
   */
  test("the dot route and the qualified route agree, at every parenthesised shape", async () => {
    const main = await runMain("module Main\n\n" + "let v: Vector(Int) = [10, 20, 30]\n" +
      "export let quotient: Bool = (-7).div(2) == Integral.div(-7, 2)\n" +
      "export let euclid: Int = (-7).div(2)\n" +
      "export let ordering: Bool =\n" +
      "    \"${(2.5).compare(1.5)}\" == \"${Ord.compare(2.5, 1.5)}\"\n" +
      "export let raised: Bool = (2n).pow(10) == Pow.pow(2n, 10)\n" +
      "export let negated: Bool = (-5).hash() == Hash.hash(-5)\n" +
      "export let summed: Bool = (3 + 4).hash() == Hash.hash(3 + 4)\n" +
      "export let indexed: Bool = (v[1]).hash() == Hash.hash(v[1])\n" +
      "export let ascribed: Bool = (5: Int).hash() == Hash.hash((5: Int))\n",
    );
    expect(main["euclid"]).toBe(-4);
    for (const key of ["quotient", "ordering", "raised", "negated", "summed", "indexed", "ascribed"]) {
      expect([key, main[key]]).toEqual([key, true]);
    }
  });

  /**
   * **A structural value has no dot form to be offered** (§5.5's rider; Method
   * Syntax §5). Dot dispatch reads the receiver's type and looks for the
   * operation in that type's home module, and a tuple, `()`, or a record
   * literal has none — `(1, 2).hash()` cannot resolve however it is spelled, so
   * offering it would be a route that is not one.
   */
  test.each([
    ["a tuple", "export let n: Int = hash((1, 2))\n",
      "no bare `hash`; write `Hash.hash((1, 2))`"],
    ["`()`", "export let n: Int = hash(())\n",
      "no bare `hash`; write `Hash.hash(())`"],
    ["a record literal", "export let n(r: {x: Int}): Int = hash({x = 1})\n",
      "no bare `hash`; write `Hash.hash({x = 1})`"],
    ["a tuple in a two-argument call", "export let b: Bool = equals((1, 2), (1, 2))\n",
      "no bare `equals`; write `Eq.equals((1, 2), (1, 2))`"],
  ])("%s receiver takes the qualified route alone", (_shape, source, message) => {
    expect(projectDiagnostics("module Main\n\n" + source)).toEqual([message]);
  });

  /** And the route it names is one that works, where the dot form would not. */
  test("the qualified route at a structural value compiles; the dot form does not", () => {
    expect(projectDiagnostics("module Main\n\n" + "export let n: Int = Hash.hash((1, 2))\n")).toEqual([]);
    expect(projectDiagnostics("module Main\n\n" + "export let n: Int = (1, 2).hash()\n"))
      .toEqual(["type mismatch: expected (a, b), found {hash: a, ...}"]);
  });

  /**
   * **A vector literal has a dot, but not for `Eq`, `Ord` and `Hash`'s members.**
   * `Vector` is not a structural *value* the way a tuple is — it has a companion
   * module, and `([1, 2]).length()` compiles — but its instances of the
   * structurally-instanced constraints are automatic (Constraints §4.5) and so
   * are not in Method Syntax §4.2's honored table. The dot does not fire for
   * those members even though the constraint is satisfied, so the narrowing is
   * **per route**, not per receiver: the member routes lose the dot, the
   * companion and `Iterable` routes keep it.
   *
   * Adding `Vector` to the structural-receiver test would have been wrong in the
   * other direction, and the two rows below are what say so.
   */
  test.each([
    ["`Hash`'s member", "export let n: Int = hash([1, 2])\n",
      "no bare `hash`; write `Hash.hash([1, 2])`"],
    ["`Eq`'s member", "export let b: Bool = equals([1], [1])\n",
      "no bare `equals`; write `Eq.equals([1], [1])`"],
    ["`Eq`'s defaulted member", "export let b: Bool = notEquals([1], [1])\n",
      "no bare `notEquals`; write `Eq.notEquals([1], [1])`"],
    ["`Ord`'s member", "export let o: Ordering = compare([1], [1])\n",
      "no bare `compare`; write `Ord.compare([1], [1])`"],
  ])("a vector literal takes the qualified route alone for %s", (_seat, source, message) => {
    expect(projectDiagnostics("module Main\n\n" + source)).toEqual([message]);
  });

  test.each([
    ["a companion function", "export let n: Int = length([1, 2])\n",
      "no bare `length`; write `([1, 2]).length()`, `Seq.length([1, 2])`, " +
      "`Vector.length([1, 2])`, or `Array.length([1, 2])`"],
    ["`Iterable`'s member", "export let s: Seq(Int) = toSeq([1, 2])\n",
      "no bare `toSeq`; write `([1, 2]).toSeq()` or `Iterable.toSeq([1, 2])`"],
  ])("a vector literal keeps the dot form for %s", (_seat, source, message) => {
    expect(projectDiagnostics("module Main\n\n" + source)).toEqual([message]);
  });

  /**
   * Both halves executed, which is the only way to know the narrowing is drawn
   * where dispatch actually stops: the four suppressed forms are refused by the
   * checker and the two kept ones compile.
   */
  test("the suppressed dot forms do not dispatch, and the kept ones do", () => {
    for (const [source, member] of [
      ["export let n: Int = ([1, 2]).hash()\n", "hash"],
      ["export let b: Bool = ([1]).equals([1])\n", "equals"],
      ["export let b: Bool = ([1]).notEquals([1])\n", "notEquals"],
      ["export let o: Ordering = ([1]).compare([1])\n", "compare"],
    ] as const) {
      expect(projectDiagnostics("module Main\n\n" + source)).toEqual([
        `\`Vector(a)\` has no field \`${member}\`, its companion exports no operation ` +
        `\`${member}\`, and no constraint honored at \`Vector(a)\` has a subject-first ` +
        `member \`${member}\`; call an available subject-first function explicitly`,
      ]);
    }
    expect(projectDiagnostics("module Main\n\n" + "export let n: Int = ([1, 2]).length()\n")).toEqual([]);
    expect(projectDiagnostics("module Main\n\n" + "export let s: Seq(Int) = ([1, 2]).toSeq()\n")).toEqual([]);
    // And the routes the four are sent to are the ones that work.
    expect(projectDiagnostics("module Main\n\n" + "export let n: Int = Hash.hash([1, 2])\n")).toEqual([]);
    expect(projectDiagnostics("module Main\n\n" + "export let b: Bool = Eq.equals([1], [1])\n")).toEqual([]);
    expect(projectDiagnostics("module Main\n\n" + "export let o: Ordering = Ord.compare([1], [1])\n")).toEqual([]);
  });

  /**
   * **The narrowing is keyed by the declaring constraint's identity, and it
   * gates the whole dot form.**
   *
   * Two claims, and one program tests both. A second *prelude* constraint
   * declaring a member spelled `hash` gives the name a second route, which is
   * not structural — its instances are written, not automatic. If the flag were
   * keyed by the spelling, that route would be marked structural too; if the
   * gate asked only whether *some* route qualifies, it would find the
   * non-structural one and put `([1, 2]).hash()` back, which is the form the
   * checker refuses. Suppression holds, and the message names both homes in
   * prelude order.
   *
   * A **user's** constraint is not this case and needs no pin: its member
   * occludes the prelude layer whole (§5.4), so no refusal is reached at all.
   *
   * `Result.hex` is supplied by the project with the second declaration
   * appended — the idiom the `show` seat's identity pin uses, its real source
   * extended rather than replaced.
   */
  /**
   * **Why a spelling-keyed implementation is currently indistinguishable, and
   * what would make it distinguishable again.**
   *
   * The route's flag is keyed by the declaring constraint's identity. A version
   * keyed by "is this spelling in a structural constraint's member table"
   * marks a *superset* — a second prelude constraint's `hash` too — and with the
   * dot gated on **any** structural route, that superset changes no message: no
   * program tells the two apart. That is not an accident of the tests, it is a
   * property of the inventory, and this row is the property.
   *
   * Every structural constraint is **pre-registered and non-redeclarable**, so
   * its identity is `hex:<Name>` and no other declaration can claim it: a
   * structural member's spelling is always declared by its own structural
   * constraint, which is always seated. The moment that stops holding — a
   * structural constraint that is not pre-registered — the two keyings part, and
   * the identity is the one that stays right. Pinned here so that change arrives
   * with a red row rather than as a silent widening.
   */
  test("every structural constraint is pre-registered and non-redeclarable", () => {
    for (const constraint of STRUCTURAL_CONSTRAINTS) {
      expect([constraint, isPreRegisteredConstraint(constraint)]).toEqual([constraint, true]);
      expect([constraint, NON_REDECLARABLE_CONSTRAINTS.includes(constraint)])
        .toEqual([constraint, true]);
    }
  });

  test("a second prelude constraint spelling `hash` does not restore the dot form", () => {
    const second: readonly [string, string] = [
      "/Result.hex",
      "module Result\n\n" + `${PRELUDE_SOURCES["Result.hex"]!}\n` +
      "export constraint Digest<a> =\n" +
      "    hash(value: a): Int\n",
    ];
    const messages = (main: string) =>
      compileFiles([["/main.hex", "module Main\n\n" + main], second]).diagnostics.map(({ message }) => message);

    // The supplied member is reachable and the module compiles, so the second
    // route genuinely exists rather than being quietly dropped.
    expect(messages("export let ok: Int = 1\n")).toEqual([]);

    expect(messages("export let n: Int = hash([1, 2])\n"))
      .toEqual(["no bare `hash`; write `Hash.hash([1, 2])` or `Result.hash([1, 2])`"]);

    // And the narrowing stays the literal's: a name receiver keeps its dot, with
    // both qualified homes beside it.
    expect(messages("export let n(v: Vector(Int)): Int = hash(v)\n"))
      .toEqual(["no bare `hash`; write `v.hash()`, `Hash.hash(v)`, or `Result.hash(v)`"]);
  });

  /**
   * The narrowing is **the literal's**, not the type's, and the boundary is
   * measured on both sides. A name bound to a vector keeps its dot form — the
   * resolver has no types, and §5.5 leaves that case to the checker — while a
   * grouped literal is still a literal. A primitive receiver is untouched
   * throughout: `Int` honors these constraints with real `honor` blocks, so
   * `(5).hash()` is a form that works.
   */
  test("the narrowing reads the written literal, not the receiver's type", () => {
    expect(projectDiagnostics("module Main\n\n" + "export let n(v: Vector(Int)): Int = hash(v)\n"))
      .toEqual(["no bare `hash`; write `v.hash()` or `Hash.hash(v)`"]);
    expect(projectDiagnostics("module Main\n\n" + "export let n: Int = hash(([1, 2]))\n"))
      .toEqual(["no bare `hash`; write `Hash.hash(([1, 2]))`"]);
    expect(projectDiagnostics("module Main\n\n" + "export let n: Int = hash(5)\n"))
      .toEqual(["no bare `hash`; write `(5).hash()` or `Hash.hash(5)`"]);
    expect(projectDiagnostics("module Main\n\n" + "export let n: Int = (5).hash()\n")).toEqual([]);
  });

  /**
   * A **name** of structural type keeps its dot form. Resolution has no types,
   * so the rule reads the written expression and nothing else; guessing would be
   * wrong in the other direction, and the qualified route beside it is correct
   * either way. A nominal constructor call is a real dot receiver and keeps its
   * form for the better reason.
   */
  test("a name of structural type, and a nominal constructor call, keep the dot form", () => {
    expect(projectDiagnostics("module Main\n\n" + "export let n(t: (Int, Int)): Int = hash(t)\n"))
      .toEqual(["no bare `hash`; write `t.hash()` or `Hash.hash(t)`"]);
    expect(projectDiagnostics("module Main\n\n" + "export let n(t: (Int, Int)): Int = Hash.hash(t)\n"))
      .toEqual([]);
    expect(projectDiagnostics("module Main\n\n" + "export record R derives (Eq, Hash) = {x: Int}\n" +
      "export let n: Int = hash(R({x = 1}))\n",
    )).toEqual([
      "no bare `hash`; write `R({x = 1}).hash()` or `Hash.hash(R({x = 1}))`",
    ]);
    expect(projectDiagnostics("module Main\n\n" + "export record R derives (Eq, Hash) = {x: Int}\n" +
      "export let n: Int = R({x = 1}).hash()\n",
    )).toEqual([]);
  });

  /**
   * **A pipe stage's written arguments are not the call's own.** `xs |> map(f)`
   * writes `map(f)`, whose one argument is the transform; the receiver is the
   * pipe's left operand, which the callee's node cannot see. Rendering it as an
   * ordinary call turned `map(f)` into `f.map()` — the wrong value in the wrong
   * seat — so a stage drops to the non-call shape, which is what a bare stage
   * (`xs |> length`) has always drawn.
   */
  test.each([
    ["a stage with an argument",
      "export let s(xs: Seq(Int), f: Int -> Int): Seq(Int) = xs |> map(f)\n",
      ["no bare `map`; write `Seq.map` or `Stream.map`"]],
    ["a stage at a literal", "export let n: Int = 2 |> pow(10)\n",
      ["no bare `pow`; write `Pow.pow`"]],
    ["two stages",
      "export let n(xs: Seq(Int), f: Int -> Int): Int = xs |> map(f) |> length()\n",
      ["no bare `map`; write `Seq.map` or `Stream.map`",
        "no bare `length`; write `Seq.length`, `Vector.length`, or `Array.length`"]],
    ["a bare stage", "export let n(xs: Seq(Int)): Int = xs |> length\n",
      ["no bare `length`; write `Seq.length`, `Vector.length`, or `Array.length`"]],
  ])("%s reads as a reference, not a call", (_shape, source, messages) => {
    expect(projectDiagnostics("module Main\n\n" + source)).toEqual(messages);
  });

  /**
   * Two shapes where rebuilding the call would answer a mistake with a second
   * one: a **wrong arity**, where the dot form would drop an argument or invent
   * a receiver, and a **multi-line argument**, whose newline has no place in a
   * diagnostic. Both name the routes without pretending to rebuild the call.
   */
  test.each([
    ["no arguments", "export let n: Int = hash()\n",
      "no bare `hash`; write `Hash.hash()`"],
    ["too many arguments", "export let n(a: Int, b: Int): Int = hash(a, b)\n",
      "no bare `hash`; write `Hash.hash(a, b)`"],
    ["an argument spanning lines",
      "export let n(a: Int): Int =\n    hash(if a > 0 then\n        1\n    else\n        2)\n",
      "no bare `hash`; write `Hash.hash`"],
  ])("%s drops the dot form", (_shape, source, message) => {
    expect(projectDiagnostics("module Main\n\n" + source)[0]).toBe(message);
  });

  /** At a reference that is not a call, the qualified names alone. */
  test("a non-call reference names bare qualified spellings", () => {
    expect(projectDiagnostics("module Main\n\n" + "export let e: Vector(Int) = empty\n")).toEqual([
      "no bare `empty`; write `Seq.empty`, `Vector.empty`, `Map.empty`, or `Set.empty`",
    ]);
  });

  /** And the message never names an import route (ruling 5; #750 holds the design). */
  test("no route named is an import", () => {
    const messages = projectDiagnostics("module Main\n\n" + "export let e: Vector(Int) = empty\n" +
      'export let u: Unit = log("x")\n' +
      "export let n(xs: Vector(Int)): Int = length(xs)\n",
    );
    expect(messages).toHaveLength(3);
    for (const message of messages) {
      expect(message).not.toContain("import");
    }
  });
});

/**
 * **Every exemplar the section spells out, run.** Modules §5.5 and §10 quote ten
 * messages between them; a message shape can drift from its own specification
 * one clause at a time, and each of these is a sentence the spec's reader is
 * entitled to see in their editor character for character.
 *
 * Kept as one table rather than scattered through the channels above, so that a
 * spec edit has one place to land — and so that "the message matches the spec"
 * is a claim something checks rather than one somebody made.
 */
describe("§5.5 and §10's exemplars, character for character", () => {
  test.each([
    ["§5.5, §10: a multi-homed dot-callable function",
      "export let f(things: Seq(Int), f: Int -> Int): Seq(Int) = map(things, f)\n",
      "no bare `map`; write `things.map(f)`, `Seq.map(things, f)`, " +
      "or `Stream.map(things, f)`"],
    ["§10: single-homed and dot-callable",
      "export let b(reading: Float): Bool = isNan(reading)\n",
      "no bare `isNan`; write `reading.isNan()` or `Float.isNan(reading)`"],
    ["§10: not dot-callable",
      "export let s(pairs: Seq(String)): String = fromSeq(pairs)\n",
      "no bare `fromSeq`; write `String.fromSeq(pairs)`, `Vector.fromSeq(pairs)`, " +
      "`Map.fromSeq(pairs)`, `Set.fromSeq(pairs)`, `Stream.fromSeq(pairs)`, " +
      "`JsMap.fromSeq(pairs)`, or `JsSet.fromSeq(pairs)`"],
    ["§10: a reference that is not a call", "export let e: Vector(Int) = empty\n",
      "no bare `empty`; write `Seq.empty`, `Vector.empty`, `Map.empty`, " +
      "or `Set.empty`"],
    ["§5.5, §10: a receiver the grammar would misread", "export let n: Int = div(-7, 2)\n",
      "no bare `div`; write `(-7).div(2)` or `Integral.div(-7, 2)`"],
    ["§5.5: a receiver with no companion", "export let n: Int = hash((1, 2))\n",
      "no bare `hash`; write `Hash.hash((1, 2))`"],
    ["§10: the member row", "export let o(a: Int, b: Int): Ordering = compare(a, b)\n",
      "no bare `compare`; write `a.compare(b)` or `Ord.compare(a, b)`"],
    ["§10: the constructor row", "export let a: Ordering = Less\n",
      "no bare `Less`; write `Ordering.Less`"],
    ["§5.5: a structurally-instanced member at a vector literal",
      "export let n: Int = hash([1, 2])\n",
      "no bare `hash`; write `Hash.hash([1, 2])`"],
    ["§5.5: a companion function at the same literal",
      "export let n: Int = length([1, 2])\n",
      "no bare `length`; write `([1, 2]).length()`, `Seq.length([1, 2])`, " +
      "`Vector.length([1, 2])`, or `Array.length([1, 2])`"],
  ])("%s", (_seat, source, message) => {
    expect(projectDiagnostics("module Main\n\n" + source)[0]).toBe(message);
  });
});

describe("the constructor channel: the open unions only", () => {
  test("the six open constructors are bare in an expression and a pattern", async () => {
    expect(projectDiagnostics("module Main\n\n" + "export let a: Option(Int) = Some(1)\n" +
      "export let b: Option(Int) = None\n" +
      "export let c: Result(Int, String) = Ok(1)\n" +
      "export let d: Result(Int, String) = Err(\"e\")\n" +
      "export let e: Bool = True\n" +
      "export let f: Bool = False\n" +
      "export fun g(o: Option(Int)): Int =\n" +
      "    match o\n" +
      "        Some(v) => v\n" +
      "        None => 0\n" +
      "export fun h(r: Result(Int, String), flag: Bool): Int =\n" +
      "    match (r, flag)\n" +
      "        (Ok(v), True) => v\n" +
      "        (Ok(_), False) => 0\n" +
      "        (Err(_), _) => -1\n",
    )).toEqual([]);
    const main = await runMain("module Main\n\n" + "export fun pick(o: Option(Int)): Int =\n" +
      "    match o\n" +
      "        Some(v) => v\n" +
      "        None => 0\n" +
      "export let some: Int = pick(Some(7))\n" +
      "export let none: Int = pick(None)\n",
    );
    expect([main["some"], main["none"]]).toEqual([7, 0]);
  });

  /**
   * `Ordering` is not an open union (ruling 2: `<`, `==` and `>` already carry
   * the comparison vocabulary), so its three constructors are qualified-only in
   * *expression* position — §10's refusal. #763's door reaches them bare in a
   * pattern regardless, exactly as it reaches any other union's constructors
   * (pinned below); the qualified spelling stays legal there too.
   */
  test("`Ordering`'s constructors are qualified in both positions", async () => {
    expect(projectDiagnostics("module Main\n\n" + "export let a: Ordering = Ordering.Less\n" +
      "export fun f(o: Ordering): Int =\n" +
      "    match o\n" +
      "        Ordering.Less => -1\n" +
      "        Ordering.Equal => 0\n" +
      "        Ordering.Greater => 1\n",
    )).toEqual([]);
    const main = await runMain("module Main\n\n" + "export fun sign(o: Ordering): Int =\n" +
      "    match o\n" +
      "        Ordering.Less => -1\n" +
      "        Ordering.Equal => 0\n" +
      "        Ordering.Greater => 1\n" +
      "export let below: Int = sign(Ordering.Less)\n" +
      "export let above: Int = sign(Ordering.Greater)\n",
    );
    expect([main["below"], main["above"]]).toEqual([-1, 1]);
  });

  test("the bare spelling is refused in expression position; #763's door reaches it in a pattern", () => {
    // §10's "both positions" is no longer one refusal: #763 gave a pattern's
    // head a door — scope, then the pattern's expected type — and the door
    // reaches every union alike, including a prelude qualified-only one, so
    // `Less` bare in a `match` over `Ordering` now resolves through it. There
    // is no expression-side door, so the expression position is unchanged.
    expect(projectDiagnostics("module Main\n\n" + "export let a: Ordering = Less\n"))
      .toEqual(["no bare `Less`; write `Ordering.Less`"]);
    expect(projectDiagnostics("module Main\n\n" + "export fun f(o: Ordering): Int =\n" +
      "    match o\n" +
      "        Less => -1\n" +
      "        _ => 0\n",
    )).toEqual([]);
  });

  /**
   * `Ordering.hex` exists so that spelling has a module to name (#742's seat
   * ruling). `Prelude.hex` keeps `ignore` alone, so the union is not there.
   */
  test("`Ordering` is the union's home, and `Prelude` is not", () => {
    expect(projectDiagnostics("module Main\n\n" + "export let a: Ordering = Prelude.Less\n"))
      .toEqual(["module `Prelude` does not export `Less`"]);
  });

  /**
   * The four boundary utility unions fall out of the default with no list entry
   * (`spec/ffi.md` §12 reduced to a note), and they draw §5.5's refusal rather
   * than the bare `unknown constructor` they drew before.
   */
  test("the boundary unions' constructors draw the refusal in expression position; the door reaches them in a pattern", () => {
    expect(projectDiagnostics("module Main\n\n" + "export let k: JsKind = Null\n"))
      .toEqual(["no bare `Null`; write `JsKind.Null`"]);
    // #763's door reaches a prelude qualified-only constructor the same way it
    // reaches a project one — `JsKind.Null` bare over a `JsKind` is the
    // brief's own example.
    expect(projectDiagnostics("module Main\n\n" + "export fun f(k: JsKind): Int =\n" +
      "    match k\n" +
      "        Null => 1\n" +
      "        _ => 0\n",
    )).toEqual([]);
    expect(projectDiagnostics("module Main\n\n" + "export let r: JsConversionReason = Shape\n"))
      .toEqual(["no bare `Shape`; write `JsConversionReason.Shape`"]);
  });

  /** A name the prelude does not bind at all still gets the plain sentence. */
  test("an unknown name keeps its own message", () => {
    expect(projectDiagnostics("module Main\n\n" + "export let n: Int = frobnicate\n"))
      .toEqual(["unknown name `frobnicate`"]);
    // #763: the pattern's expected type is known here (`Option(Int)`, from the
    // scrutinee) and its constructor set lacks the spelling, so the door's
    // closed-door refusal fires — naming the type, not the bare
    // "unknown constructor" a pattern with no determined expected type draws.
    expect(projectDiagnostics("module Main\n\n" + "export fun f(o: Option(Int)): Int =\n" +
      "    match o\n" +
      "        Frobnicate => 1\n" +
      "        _ => 0\n",
    )[0]).toBe("`Option(Int)` has no constructor `Frobnicate`");
  });
});

describe("the exception channel: all of them, as a category", () => {
  /**
   * The eight shipped exceptions, bare in a catch arm and in an expression, and
   * reachable qualified beside it. The category rule is what makes a future
   * prelude exception bare without a ruling — the `…Error` suffix is its own
   * qualifier — so the list is asserted whole rather than sampled.
   */
  test.each([
    ["NegativeExponentError", "Pow", "(m)"],
    ["DivideByZeroError", "Integral", "(m)"],
    ["FloatRangeError", "Float", "(m)"],
    ["ReentrancyError", "Seq", ""],
    ["IndexError", "Vector", "(i, n)"],
    ["SliceError", "Vector", "(a, b)"],
    ["KeyError", "Map", ""],
    ["JsError", "JsError", "(e)"],
  ])("`%s` is bare in a catch arm, and qualified through `%s`", (name, home, slots) => {
    expect(projectDiagnostics("module Main\n\n" + "export fun f(n: Int): Int =\n" +
      "    try\n" +
      "        n\n" +
      "    catch\n" +
      `        ${name}${slots} => 0\n`,
    )).toEqual([]);
    expect(projectDiagnostics("module Main\n\n" + "export fun f(n: Int): Int =\n" +
      "    try\n" +
      "        n\n" +
      "    catch\n" +
      `        ${home}.${name}${slots} => 0\n`,
    )).toEqual([]);
  });

  /** And an exception constructor is bare in expression position too. */
  test("`throw` takes the bare constructor", () => {
    expect(projectDiagnostics("module Main\n\n" + "export fun f(): Int = throw(KeyError)\n",
    )).toEqual([]);
    expect(projectDiagnostics("module Main\n\n" + "export fun f(): Int = throw(Map.KeyError)\n",
    )).toEqual([]);
  });
});

describe("the member channel: `show` only", () => {
  test("`show` is bare, dot, and qualified alike", async () => {
    const main = await runMain("module Main\n\n" + "export let bare: String = show(1)\n" +
      "export let dotted: String = 1.show()\n" +
      "export let qualified: String = Show.show(1)\n" +
      "export let companion: String = Int.show(1)\n",
    );
    expect([main["bare"], main["dotted"], main["qualified"], main["companion"]])
      .toEqual(["1", "1", "1", "1"]);
  });

  /**
   * The seat is keyed by `Show.hex`'s **declaration identity**, not by the
   * spelling (§5.5), so a *second prelude constraint* declaring a member spelled
   * `show` seeds nothing — and the collided-name rule therefore never meets a
   * second exporter of the one bare member.
   *
   * The second declaration has to be a prelude member's for the question to
   * arise at all, so `Result.hex` is supplied by the project with one appended:
   * the idiom the injection path already carries, its real source extended
   * rather than replaced.
   */
  test("a second prelude constraint spelling `show` seeds nothing", () => {
    const compiled = compileFiles([
      ["/main.hex", "module Main\n\n" + "export let s: String = show(1)\n"],
      [
        "/Result.hex",
        "module Result\n\n" + `${PRELUDE_SOURCES["Result.hex"]!}\n` +
        "export constraint Loud<a> =\n" +
        "    show(value: a): String\n",
      ],
    ]);

    // No ambiguity refusal: bare `show` still has exactly one seat, `Show.hex`'s
    // declaration, because the second is a different identity.
    expect(compiled.diagnostics.map(({ message }) => message)).toEqual([]);
  });

  test("every other member is refused, naming the dot and the declaring module", () => {
    expect(projectDiagnostics("module Main\n\n" + "export let o(a: Int, b: Int): Ordering = compare(a, b)\n"))
      .toEqual(["no bare `compare`; write `a.compare(b)` or `Ord.compare(a, b)`"]);
    expect(projectDiagnostics("module Main\n\n" + "export let n(x: Int): Int = hash(x)\n"))
      .toEqual(["no bare `hash`; write `x.hash()` or `Hash.hash(x)`"]);
    expect(projectDiagnostics("module Main\n\n" + "export let b(x: Int, y: Int): Bool = equals(x, y)\n"))
      .toEqual(["no bare `equals`; write `x.equals(y)` or `Eq.equals(x, y)`"]);
  });

  /** A receiver-less member has no dot form, so the message names one route. */
  test("a receiver-less member names the declaring module alone", () => {
    expect(projectDiagnostics("module Main\n\n" + "export let n(v: Nat): Int = fromNat(v)\n"))
      .toEqual(["no bare `fromNat`; write `Num.fromNat(v)`"]);
  });

  /**
   * **A member's in-module spelling is untouched** (§5.5's own carve-out): an
   * honoring module binds its members at module level, and every Constraints
   * §4.6 law about that spelling is written against it resolving.
   */
  test("an honoring module still writes its member's spelling bare", async () => {
    const main = await runMain("module Main\n\n" + "export record Span = {lo: Int, hi: Int}\n" +
      "\n" +
      "honor Eq<Span> =\n" +
      "    equals(left, right) = left.lo == right.lo and left.hi == right.hi\n" +
      "\n" +
      "export let same: Bool = equals(Span({lo = 1, hi = 2}), Span({lo = 1, hi = 2}))\n",
    );
    expect(main["same"]).toBe(true);
  });

  /**
   * **The §4.6 monomorphic-denotation gap, at a spelling #742 newly routes
   * through the carve-out.** Constraints §4.6 rules that a bare use elsewhere in
   * the honoring module means *this binding* — monomorphic, at the honored type
   * — so `compare(1, 2)` in a module honoring `Ord<Box>` should be refused: the
   * binding is at `Box` and `1` is not one.
   *
   * It compiles, because what the carve-out puts back is the prelude's
   * *polymorphic* member symbol and a member binding has no represented scheme
   * to put back instead. That is the same gap
   * `constraint-member-dispatch.test.ts`'s deferred baseline records at `Show`,
   * reached at a second constraint now that `compare` has no other bare route.
   * Pinned so the flip is a visible change to a stated expectation rather than a
   * discovery; the follow-up owns the reversal.
   */
  test("a bare use at another type still resolves polymorphically — the §4.6 gap", () => {
    const honoring =
      "export record Box derives (Eq) = {n: Int}\n" +
      "honor Ord<Box> =\n" +
      "    compare(left, right) = Ord.compare(left.n, right.n)\n";
    expect(projectDiagnostics("module Main\n\n" + `${honoring}export let own: Ordering = compare(Box({n = 1}), Box({n = 2}))\n`,
    )).toEqual([]);
    // Under §4.6's ruled reading this line has no meaning and the module is
    // refused. Today it dispatches `Ord<Int>`.
    expect(projectDiagnostics("module Main\n\n" + `${honoring}export let other: Ordering = compare(1, 2)\n`))
      .toEqual([]);
  });

  /** And a module that honors nothing of the name keeps the refusal. */
  test("a module honoring nothing still meets the refusal", () => {
    expect(projectDiagnostics("module Main\n\n" + "export record Span = {lo: Int}\n" +
      "export let same(a: Int, b: Int): Bool = equals(a, b)\n",
    )).toEqual(["no bare `equals`; write `a.equals(b)` or `Eq.equals(a, b)`"]);
  });
});

/**
 * **Every iterable keeps a spellable conversion.** `toSeq` left the bare layer
 * with the rest of the member channel, so the two routes §5.5 names have to
 * reach every `Iterable` — including the ones with no companion module of their
 * own.
 *
 * `Range` is the case to verify rather than assume, and it is a **finding**: the
 * dot form does *not* work at a `Range`, with or without an annotation, because
 * `Range` has no module the dot can dispatch to (Method Syntax §4.1's table has
 * no row for it). `Iterable.toSeq(1..10)` is the spelling, and `for x in 1..10`
 * is untouched — the loop reads evidence, never this layer.
 */
describe("`toSeq` is reachable at every iterable", () => {
  test("the dot form answers wherever the receiver has a companion", async () => {
    const main = await runMain("module Main\n\n" + "export let text: Int = Seq.length(\"Hexagon\".toSeq())\n" +
      "export let vector: Int = Seq.length([1, 2, 3].toSeq())\n",
    );
    expect([main["text"], main["vector"]]).toEqual([7, 3]);
  });

  test("the declaring constraint's spelling answers everywhere, `Range` included", async () => {
    const main = await runMain("module Main\n\n" + "export let range: Int = Seq.length(Iterable.toSeq(1..10))\n" +
      "export let text: Int = Seq.length(Iterable.toSeq(\"Hexagon\"))\n" +
      "export let vector: Int = Seq.length(Iterable.toSeq([1, 2, 3]))\n",
    );
    expect([main["range"], main["text"], main["vector"]]).toEqual([10, 7, 3]);
  });

  /**
   * The finding, pinned so it cannot change unnoticed: a `Range` receiver has no
   * dot dispatch, and the diagnostic it draws already names `Iterable.toSeq(…)`
   * as the route. If a `Range` companion ever lands this row is what says so.
   */
  test("a `Range` receiver has no dot dispatch, and is told the route", () => {
    expect(projectDiagnostics("module Main\n\n" + "export let n(r: Range): Int = Seq.length(r.toSeq())\n"))
      .toEqual([
        "this value's type was inferred as a record with a `toSeq` field because " +
        "its type was unknown where it was written; `Range` is not a record. " +
        "Annotate it to use dispatch, or call `Iterable.toSeq(…)` directly.",
      ]);
  });

  test("`for..in` over a range is untouched — it reads evidence, not this layer", async () => {
    const main = await runMain("module Main\n\n" + "export fun total(): Int =\n" +
      "    var t = 0\n" +
      "    for x in 1..4\n" +
      "        t := t + x\n" +
      "    t\n" +
      "export let sum: Int = total()\n",
    );
    expect(main["sum"]).toBe(10);
  });
});

describe("the collided-name rule survives for the set, and is vacuous in it", () => {
  /**
   * §10 keeps the ambiguity row "for the set". It is vacuous in the shipped
   * inventory — exception names are unique across the prelude, and the `show`
   * seat is identity-keyed, so no second member ever enters bare scope — and
   * that vacuity is what this row measures: no name in the layer has two homes.
   */
  test("no name in the bare set is exported by two prelude members", () => {
    // A bare use of every one of the sixteen, compiled: the ambiguity refusal
    // names itself in its own words, so its absence here is the whole claim.
    const uses = BARE_SET
      .map((name, index) => `export let n${index} = ${name}\n`)
      .join("");
    for (const message of projectDiagnostics("module Main\n\n" + uses)) {
      expect(message).not.toContain("is ambiguous: exported by");
    }
  });
});
