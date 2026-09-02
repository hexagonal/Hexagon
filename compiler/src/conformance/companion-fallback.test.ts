import { describe, expect, test } from "vitest";

import { compileFiles, runProject } from "../support/test-project.js";

/**
 * Conformance for **the companion fallback** — Modules §5.1 rule 2, both
 * namespaces (#531; §13 test (d)).
 *
 * A bare `Name` in type or constraint position that its own namespace has
 * nothing for resolves through a visible module alias `Name` whose module
 * exports a same-spelled type or constraint. §5.3's blessed companion consumer
 * is what it exists for: before the fallback, that example did not compile, and
 * a consumer had to write the module's name twice — once for the alias, once
 * for a named import of the type.
 *
 * The three properties every test below is a reading of:
 *
 * - It **answers, never binds.** Nothing enters either namespace, so a
 *   same-spelled declaration or import wins outright, with no collision report
 *   and no refusal.
 * - It is **last but one.** Only the compiler-owned boundary types sit behind
 *   it (§5.5's parenthetical), which is the one place it re-means a program
 *   that already resolved.
 * - It **carries no members.** A constraint's members are reached through the
 *   alias or by the dot (§3.2, #762); the constraint half brings the name and
 *   nothing else.
 *
 * The *other* spelling of a constraint an alias reaches — the qualified
 * `honor D.Describe<Box>`, admitted by Constraints §4.1 (#567) — is pinned by
 * `qualified-honor-head.test.ts`, which is also where the two spellings meet:
 * that they name one declaration is what keeps this fallback and that head from
 * being two instances of the same constraint.
 */

/** Every message the project reported, in order. */
function messages(files: readonly (readonly [string, string])[]): readonly string[] {
  return compileFiles(files).diagnostics.map(({ message }) => message);
}

/** The companion module §5.3's example is written against. */
const POINT = [
  "/point.hex",
  "opaque record Point = {x: Float, y: Float}\n" +
    "export fun make(x: Float, y: Float): Point = Point({x = x, y = y})\n" +
    "export fun getX(p: Point): Float = p.x\n",
] as const;

/** A user constraint reached the way a companion is. */
const RENDER = [
  "/render.hex",
  "export constraint Render<a> =\n    render(value: a): String\n",
] as const;

describe("type position: §5.3's consumer, compiling", () => {
  test("the namespace import alone covers the annotation", () => {
    expect(messages([
      POINT,
      ["/main.hex",
        'import Point from "./point"\n' +
        "export fun norm(p: Point): Float = Point.getX(p)\n"],
    ])).toEqual([]);
  });

  test("the emitted route runs", async () => {
    // The fallback resolves to the same declaration `Point.Point` resolves to,
    // so emission has nothing new to do — pinned because "resolves" and "runs"
    // are different claims, and only the second proves the annotation reached a
    // real type rather than an error node that unified with everything.
    const module = await runProject([
      POINT,
      ["/main.hex",
        'import Point from "./point"\n' +
        "export fun norm(p: Point): Float = Point.getX(p)\n" +
        "export let answer: Float = norm(Point.make(3.0, 4.0))\n"],
    ]);
    expect(module["answer"]).toBe(3);
  });

  test("opacity is untouched — the fallback is the same type, not a looser one", () => {
    expect(messages([
      POINT,
      ["/main.hex",
        'import Point from "./point"\n' +
        "export fun leak(p: Point): Float = p.x\n"],
    ])).toEqual([
      "cannot access field `x` of opaque record `Point`; " +
        "use an operation exported by its home module",
    ]);
  });

  test("a parameterized companion type applies through the fallback", () => {
    expect(messages([
      ["/box.hex", "export record Box(a) = {item: a}\n"],
      ["/main.hex",
        'import Box from "./box"\n' +
        "export fun unwrap(b: Box(Int)): Int = b.item\n"],
    ])).toEqual([]);
  });

  test("the arity report comes from the declaration it resolved to", () => {
    expect(messages([
      ["/box.hex", "export record Box(a) = {item: a}\n"],
      ["/main.hex",
        'import Box from "./box"\n' +
        "export fun unwrap(b: Box): Int = 1\n"],
    ])).toEqual(["type `Box` expects 1 argument, but 0 were provided"]);
  });

  test("a type alias and a union answer too — every type-namespace export does", () => {
    expect(messages([
      ["/name.hex", "export type Name = String\n"],
      ["/main.hex",
        'import Name from "./name"\n' +
        "export fun greet(n: Name): String = n\n"],
    ])).toEqual([]);
    expect(messages([
      ["/shape.hex", "export union Shape = Dot | Line(Int)\n"],
      ["/main.hex",
        'import Shape from "./shape"\n' +
        "export fun width(s: Shape): Int = 0\n"],
    ])).toEqual([]);
  });

  test("an extern type answers too — the fourth type-namespace export", () => {
    expect(messages([
      ["/host.hex",
        'extern from "./host.js"\n' +
        "    export type Host\n" +
        "    export fun make(): Host\n"],
      ["/main.hex",
        'import Host from "./host"\n' +
        "export fun pass(h: Host): Host = h\n" +
        "export let one: Host = Host.make!()\n"],
    ])).toEqual([]);
  });

  test("the alias's own qualified spellings keep working beside it", () => {
    expect(messages([
      POINT,
      ["/main.hex",
        'import Point from "./point"\n' +
        "export fun norm(p: Point.Point): Float = Point.getX(p)\n"],
    ])).toEqual([]);
  });

  test("the annotation may stand above the import line", () => {
    // A type-namespace reading is order-insensitive (§3), and the fallback is a
    // type-namespace reading: it must not acquire a top-down law of its own.
    expect(messages([
      POINT,
      ["/main.hex",
        "export fun norm(p: Point): Float = 0.0\n" +
        'import Point from "./point"\n'],
    ])).toEqual([]);
  });
});

describe("occlusion: the fallback answers only where the namespace is empty", () => {
  test("the module's own record wins, with no diagnostic at all", () => {
    // Zero diagnostics is the assertion, not just "no error at the annotation":
    // the alias binds nothing, so there is no second meaning for a collision
    // rule to find, and §5.2's "module alias vs type name" stays legal.
    //
    // Both meanings stay live in the one module — `Point.` the module, `Point`
    // in types this module's record — and the resolved shape says so: `mine`
    // reads a field `./point`'s opaque `Point` does not have, and `far` calls
    // through the alias. (Only the *checker's* verdict is asserted here. What
    // the shape *emits* was its own defect — `import * as Point` beside `const
    // Point`, one JavaScript binding for two Hexagon namespaces — with nothing
    // to do with the fallback; it was filed as #569 and is pinned, program for
    // program, by `namespace-alias-collision.test.ts`.)
    expect(messages([
      POINT,
      ["/main.hex",
        'import Point from "./point"\n' +
        "export record Point = {n: Int}\n" +
        "export fun mine(p: Point): Int = p.n\n" +
        "export let far: Float = Point.getX(Point.make(1.0, 2.0))\n"],
    ])).toEqual([]);
  });

  test("a declaration of the same spelling wins the same way", () => {
    // What stands where the named import stood (§3.2, #762): a name wanted bare
    // in the importer is an ordinary declaration, and it wins outright.
    expect(messages([
      ["/other.hex", "export record Point = {n: Int}\n"],
      POINT,
      ["/main.hex",
        'import Point from "./point"\n' +
        'import Other from "./other"\n' +
        "type Mine = Other.Point\n" +
        "export fun mine(p: Mine): Int = p.n\n"],
    ])).toEqual([]);
  });

  test("a prelude type of the alias's spelling still wins", () => {
    // `Option` is a prelude declaration, so the type namespace answers before
    // the fallback is consulted and the alias's own `Option` never surfaces.
    expect(messages([
      ["/option.hex", "export record Option = {n: Int}\n"],
      ["/main.hex",
        'import Option from "./option"\n' +
        "export fun mine(o: Option(Int)): Int = 1\n"],
    ])).toEqual([]);
  });
});

describe("constraint position: the same reading, one namespace over", () => {
  test("a binder's constraint list resolves through the alias", () => {
    expect(messages([
      RENDER,
      ["/main.hex",
        'import Render from "./render"\n' +
        "export fun label<a: Render>(x: a): String = Render.render(x)\n"],
    ])).toEqual([]);
  });

  test("an `honor` head resolves through the alias", () => {
    expect(messages([
      RENDER,
      ["/main.hex",
        'import Render from "./render"\n' +
        "export record Box = {n: Int}\n" +
        "honor Render<Box> =\n    render(value) = \"box\"\n"],
    ])).toEqual([]);
  });

  test("the head and the binder meet: an honored type satisfies the bare bound", async () => {
    const module = await runProject([
      RENDER,
      ["/main.hex",
        'import Render from "./render"\n' +
        "export record Box = {n: Int}\n" +
        "honor Render<Box> =\n    render(value) = \"box ${value.n}\"\n" +
        "export fun label<a: Render>(x: a): String = Render.render(x)\n" +
        "export let shown: String = label(Box({n = 7}))\n"],
    ]);
    expect(module["shown"]).toBe("box 7");
  });

  test("the fallback carries no members: the bare member spelling still fails", () => {
    // §5.1 rule 2's own sentence. The named import remains the members-carrying
    // idiom, and the member stays reachable through the alias.
    expect(messages([
      RENDER,
      ["/main.hex",
        'import Render from "./render"\n' +
        "export fun label<a: Render>(x: a): String = render(x)\n"],
    ])).toEqual(["unknown name `render`"]);
  });

  test("a `widens` head still reaches the constraint through the alias", () => {
    // The generalisation law's own route (§5.3: to widen a member, import the
    // module, not the constraint). The `widens` head's member path stays
    // module-alias qualified — Constraints §4.7 admits no other spelling — and
    // the *honor* head beside it is now the bare one, which is the cost
    // Modules §12.4 records as retired by this fallback.
    expect(messages([
      ["/scale.hex",
        "export constraint Scale<a> =\n    scale(value: a, factor: Int): a\n"],
      ["/main.hex",
        'import Scale from "./scale"\n' +
        "export record Matrix = {n: Float}\n" +
        "widens Scale.scale(value: Matrix, factor: Float): Matrix = " +
        "Matrix({n = value.n * factor})\n" +
        "honor Scale<Matrix> =\n    scale = widened\n" +
        "export fun grow<a: Scale>(value: a): a = Scale.scale(value, 2)\n"],
    ])).toEqual([]);
  });

  test("the module's own constraint of the same name wins, silently", () => {
    expect(messages([
      RENDER,
      ["/main.hex",
        'import Render from "./render"\n' +
        "export constraint Render<a> =\n    draw(value: a): Int\n" +
        "export fun size<a: Render>(x: a): Int = draw(x)\n"],
    ])).toEqual([]);
  });

  test("— and wins with the import line *below* it, where order could decide", () => {
    // The sharp form. A constraint name is type-namespace and so order-free
    // (§3), which means "the declaration wins" cannot be an accident of the
    // import happening to come first: the bare `Render` in the binder must
    // denote *this* module's declaration either way. Written the other way
    // round, `draw` — the local declaration's member — would not be the member
    // the binder's constraint carries, and the body would stop typechecking.
    expect(messages([
      RENDER,
      ["/main.hex",
        "export constraint Render<a> =\n    draw(value: a): Int\n" +
        'import Render from "./render"\n' +
        "export fun size<a: Render>(x: a): Int = draw(x)\n"],
    ])).toEqual([]);
  });

  test("the module's own declaration wins over a second alias, silently", () => {
    // The constraint half's occlusion case, respelt for #762: no import binds a
    // constraint name, so the only rival a bare spelling can have here is a
    // declaration of this module's own — and it wins outright, above the alias
    // line and below it alike.
    expect(messages([
      RENDER,
      ["/main.hex",
        'import Render from "./render"\n' +
        "constraint Render<a> =\n    draw(value: a): Int\n" +
        "export fun size<a: Render>(x: a): Int = draw(x)\n"],
    ])).toEqual([]);
    expect(messages([
      RENDER,
      ["/main.hex",
        "constraint Render<a> =\n    draw(value: a): Int\n" +
        'import Render from "./render"\n' +
        "export fun size<a: Render>(x: a): Int = draw(x)\n"],
    ])).toEqual([]);
  });

  test("the eleven pre-registered names are never reached", () => {
    // Constraints §5.1.1: they are always present, so the fallback cannot fire
    // at one — and a module exporting a rival `Show` is refused at its own
    // declaration, long before any importer could name it.
    expect(messages([
      ["/show.hex", "export constraint Show<a> =\n    show(value: a): Int\n"],
      ["/main.hex",
        'import Show from "./show"\n' +
        "export fun size<a: Show>(x: a): String = show(x)\n"],
    ])).toEqual(["constraint `Show` is pre-registered and cannot be redeclared"]);
  });

  test("a renamed alias over one exported constraint names both repairs", () => {
    // A renamed alias answers no bare spelling at all: neither the constraint's
    // own name (nothing binds it) nor the alias's (the module exports no `R`).
    // The first has no *alias* repairs to name — no alias of that spelling is
    // standing there — so it takes the family signpost instead (#577), whose
    // alias-bearing import is the realias the second arm spells out in full.
    expect(messages([
      RENDER,
      ["/main.hex",
        'import R from "./render"\n' +
        "export fun label<a: Render>(x: a): String = R.render(x)\n"],
    ])).toContain(
      "unknown constraint `Render`; import its home module under the alias " +
        "`Render` for qualified access",
    );
    expect(messages([
      RENDER,
      ["/main.hex",
        'import R from "./render"\n' +
        "export fun label<a: R>(x: a): String = R.render(x)\n"],
    ])).toContain(
      "unknown constraint `R`; `R` is a module alias — write `R.Render` for the constraint " +
        'it exports, or realias as `import Render from "./render"`',
    );
  });

  test("both repairs the constraint message names compile", () => {
    expect(messages([
      RENDER,
      ["/main.hex",
        'import R from "./render"\n' +
        "export fun label<a: R.Render>(x: a): String = R.render(x)\n"],
    ])).toEqual([]);
    expect(messages([
      RENDER,
      ["/main.hex",
        'import Render from "./render"\n' +
        "export fun label<a: Render>(x: a): String = Render.render(x)\n"],
    ])).toEqual([]);
  });

  test("an alias over several constraints keeps the general form", () => {
    expect(messages([
      ["/lib.hex",
        "export constraint One<a> =\n    one(value: a): Int\n" +
        "export constraint Two<a> =\n    two(value: a): Int\n"],
      ["/main.hex",
        'import Lib from "./lib"\n' +
        "export fun size<a: Lib>(x: a): Int = 1\n"],
    ])).toContain(
      "unknown constraint `Lib`; `Lib` is a module alias — the constraints it exports " +
        "are reached through it, as `Lib.Name`",
    );
  });

  test("a name that is nothing at all carries the family signpost", () => {
    // The fallback declined and no alias is standing there, so the refusal is
    // the #577 seat's: nothing of the spelling is in scope, and the two routes
    // that reach a constraint are named (Constraints §8's row).
    expect(messages([
      ["/main.hex", "export fun size<a: Nope>(x: a): Int = 1\n"],
    ])).toContain(
      "unknown constraint `Nope`; import its home module under the alias " +
        "`Nope` for qualified access",
    );
  });
});
