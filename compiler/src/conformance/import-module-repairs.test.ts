import { describe, expect, test } from "vitest";

import { compileFiles } from "../support/test-project.js";
import { resolveSpecifier, specifierFor } from "../project.js";

/**
 * Conformance for the **`import module` repair family** — Modules §5.1 rule 1's
 * type-not-module seat and the two constraint seats Constraints §8 sends here
 * (#577).
 *
 * One shape, three refusals. An author reaches for a name through a route the
 * language spells with an import line, the name resolves nowhere, and before
 * this the three seats said only that: `` unknown name `Figure` ``,
 * `` unknown module `Scale` ``, `` unknown constraint `Scale` ``. Each is true
 * about the namespace it consulted and silent about the one line that would
 * have made the program work — and rule 1's sentence, promised verbatim in
 * §5.1 and §10 since the module rules were written, was implemented nowhere.
 *
 * **v1 is the failed-resolution shape and no more** (the #577 ruling). Where the
 * spelling resolves as a *term* — a record import binds its constructor, so
 * `Figure.make` is a field access on a constructor-typed head — nothing here
 * fires, and the inverted mismatch that writer meets is #642's. The suite below
 * pins both halves of that line: the messages at the seats that owe them, and
 * the untouched behaviour just past the boundary.
 *
 * The **workspace tier** — one applied code action for all three seats, where
 * exactly one module exports the spelling — is `analysis/code-actions.test.ts`,
 * for the reason the tiers are split at all: this file compiles a project, and
 * the compiler answers from the graph it was handed, never from a search.
 */

/** Every message the project reported, in order. */
function messages(files: readonly (readonly [string, string])[]): readonly string[] {
  return compileFiles(files).diagnostics.map(({ message }) => message);
}

/** Rule 1's sentence, as §5.1 and §10 both write it. */
const TYPE_NOT_A_MODULE = "`Figure` is a type, not a module; import its home " +
  "module with `import module` for qualified access, or import the " +
  "constructor/function you need";

/** A union and an ordinary function over it: the type-only import's fixture. */
const FIGURE = [
  "/figure.hex",
  "export union Figure = Circle(Float) | Square(Float)\n" +
    "export fun area(s: Figure): Float = 1.0\n",
] as const;

/** A user constraint, unimported: the arrival state both constraint seats own. */
const SCALE = [
  "/scale.hex",
  "export constraint Scale<a> =\n    scale(value: a, factor: Int): a\n",
] as const;

describe("the type seat (Modules §5.1 rule 1)", () => {
  test("a type-only import qualified as a module is told which namespace it is in", () => {
    // The filing's own probe. `import { Figure }` of a *union* binds the type and
    // no term, so `Figure.` finds no module alias, no term, and a type — which is
    // exactly the state rule 1's sentence is written about.
    expect(messages([
      FIGURE,
      ["/main.hex",
        'import { Figure } from "./figure"\n' +
        "export fun go(s: Figure): Float = Figure.area(s)\n"],
    ])).toEqual([TYPE_NOT_A_MODULE]);
  });

  test("the module's own type reads the same — the seat is the namespace, not the import", () => {
    expect(messages([
      ["/main.hex",
        "union Figure = Circle(Float)\n" +
        "export let n: Float = Figure.area(1.0)\n"],
    ])).toEqual([TYPE_NOT_A_MODULE]);
  });

  test("a transparent alias is a type too, and says so under its own name", () => {
    expect(messages([
      ["/lib.hex", "export type Meters = Float\n"],
      ["/main.hex",
        'import { Meters } from "./lib"\n' +
        "export let n: Float = Meters.zero\n"],
    ])).toEqual([
      "`Meters` is a type, not a module; import its home module with " +
        "`import module` for qualified access, or import the constructor/function you need",
    ]);
  });

  test("one use, one sentence — the receiver reports and the call does not cascade", () => {
    // The refused receiver answers with an error node, exactly as an unknown
    // name does, so the checker sees a poisoned callee rather than a second
    // fault to describe.
    expect(messages([
      FIGURE,
      ["/main.hex",
        'import { Figure } from "./figure"\n' +
        "export fun go(s: Figure): Float = Figure.area(s) + Figure.area(s)\n"],
    ])).toEqual([TYPE_NOT_A_MODULE, TYPE_NOT_A_MODULE]);
  });

  test("nothing of the spelling anywhere keeps the bare unknown name", () => {
    // The sentence is conditioned on a type existing — "mentioning the type if
    // one exists". With no type there is nothing to mention, and claiming one
    // would be false.
    expect(messages([
      ["/main.hex", "export let n: Float = Figure.area(1.0)\n"],
    ])).toEqual(["unknown name `Figure`"]);
  });

  test("a non-uppercase receiver is not rule 1's at all", () => {
    // Rule 1 is "uppercase immediately followed by `.`". A lowercase receiver is
    // an ordinary value, and its miss is an ordinary unknown name.
    expect(messages([
      ["/main.hex",
        "export union Figure = Circle(Float)\n" +
        "export let n: Float = shape.area(1.0)\n"],
    ])).toEqual(["unknown name `shape`"]);
  });

  test("a lowercase spelling the compiler kept anyway is still not rule 1's", () => {
    // An `extern` block's `type foo` is refused for its alias and *registered*
    // regardless, so the type namespace holds a lowercase spelling. Rule 1 is
    // "uppercase immediately followed by `.`", and the second sentence would be
    // a report about the recovery rather than about the source.
    expect(messages([
      ["/main.hex",
        'extern from "./x.js"\n    type foo\n' +
        "export let n: Int = foo.bar(1)\n"],
    ])).toEqual([
      "foreign type `foo` needs an uppercase-start local alias; write " +
        "`type foo as Tfoo`",
      "unknown name `foo`",
    ]);
  });

  test("a prelude spelling never reaches the seat — its alias is always standing", () => {
    // `Int` is a type *and* a module (Modules §6.4 gives every prelude member a
    // qualified home), so `Int.` resolves before rule 1's refusal is consulted.
    expect(messages([
      ["/main.hex", "export let n: String = Int.show(3)\n"],
    ])).toEqual([]);
  });

  test("a declaration below the use keeps the truer sentence", () => {
    // A record binds its constructor, so `Figure` *is* a term — one declared
    // below this line. "Declared later" names the fix; "is a type, not a module"
    // would be a false classification of a name that resolves fine one line down.
    expect(messages([
      ["/main.hex",
        "export let n: Int = Figure.make(3)\n" +
        "export record Figure = {n: Int}\n"],
    ])).toEqual([
      "`Figure` is declared later in this block; declarations are read top-down " +
        "— move its declaration above this use",
    ]);
  });

  test("the constructor-bound shape is untouched — v1 is failed resolution only", () => {
    // The #577 ruling's carve-out, pinned so the boundary is visible rather than
    // implied: a record import binds the constructor, `Figure` resolves as a
    // term, and `.make` is a field access against it. The inverted mismatch that
    // results is #642's, not this one's — what this test asserts is that nothing
    // here reclassified it.
    const reported = messages([
      ["/figure.hex",
        "export record Figure = {n: Int}\n" +
        "export fun make(n: Int): Figure = Figure({n = n})\n"],
      ["/main.hex",
        'import { Figure } from "./figure"\n' +
        "export let s: Figure = Figure.make(3)\n"],
    ]);
    // The claim is that the writer is shown a *mismatch*, with the constructor
    // on the expected side. The field's type is an unsolved variable, which
    // #649 spells `a` rather than the allocation counter this pin used to have
    // to match.
    expect(reported).toEqual([
      "type mismatch: expected ({n: Int}) -> Figure, found {make: a, ...}",
    ]);
  });
});

describe("the `widens` head seat (Constraints §8's row)", () => {
  test("a head whose qualifier names nothing carries the route", () => {
    expect(messages([
      SCALE,
      ["/main.hex",
        "export record Metre = {m: Float}\n" +
        "widens Scale.scale(value: Metre, factor: Float): Metre = value\n"],
    ])).toEqual([
      "unknown module `Scale`; a `widens` head names its member through a " +
        "module alias; import the member's home module with `import module Scale`",
    ]);
  });

  test("the route is the alias's own spelling, whatever it is", () => {
    expect(messages([
      ["/main.hex",
        "export record Metre = {m: Float}\n" +
        "widens Sizing.scale(value: Metre, factor: Float): Metre = value\n"],
    ])).toEqual([
      "unknown module `Sizing`; a `widens` head names its member through a " +
        "module alias; import the member's home module with `import module Sizing`",
    ]);
  });

  test("a qualifier that *is* a module keeps the member refusal it always had", () => {
    // The second arm is untouched: the module answered, the member did not.
    expect(messages([
      SCALE,
      ["/main.hex",
        'import module Scale from "./scale"\n' +
        "export record Metre = {m: Float}\n" +
        "widens Scale.stretch(value: Metre, factor: Float): Metre = value\n"],
    ])).toEqual([
      "`Scale.stretch` is not a constraint member; a `widens` head names one",
    ]);
  });
});

describe("the bare constraint seat (Constraints §8's row)", () => {
  test("an `honor` head over an unimported constraint carries the route", () => {
    expect(messages([
      SCALE,
      ["/main.hex",
        "export record Metre = {m: Float}\n" +
        "honor Scale<Metre> =\n    scale(value, factor) = value\n"],
    ])).toEqual([
      "unknown constraint `Scale`; import its home module with " +
        "`import module Scale` for qualified access, or import the constraint by name",
    ]);
  });

  test("a binder reads identically — one message, both positions", () => {
    expect(messages([
      SCALE,
      ["/main.hex", "export fun go<a: Scale>(x: a): a = x\n"],
    ])).toEqual([
      "unknown constraint `Scale`; import its home module with " +
        "`import module Scale` for qualified access, or import the constraint by name",
    ]);
  });

  test("both routes the sentence names compile", () => {
    // The message earns its two clauses: each is a program.
    expect(messages([
      SCALE,
      ["/main.hex",
        'import module Scale from "./scale"\n' +
        "export fun go<a: Scale.Scale>(x: a): a = x\n"],
    ])).toEqual([]);
    expect(messages([
      SCALE,
      ["/main.hex",
        'import { Scale } from "./scale"\n' +
        "export fun go<a: Scale>(x: a): a = x\n"],
    ])).toEqual([]);
  });

  test("the alias-bearing arms are byte-identical to what they always said", () => {
    // The realias repair (#531) and the several-constraints form: an alias *is*
    // standing at the spelling, so the family signpost never gets its turn, and
    // these two sentences are the ones this change must not have moved.
    expect(messages([
      ["/render.hex", "export constraint Render<a> =\n    render(value: a): String\n"],
      ["/main.hex",
        'import module R from "./render"\n' +
        "export fun label<a: R>(x: a): String = R.render(x)\n"],
    ])).toContain(
      "unknown constraint `R`; `R` is a module alias — write `R.Render` for the " +
        'constraint it exports, name it bare with `import { Render } from "./render"`, ' +
        "or realias as `import module Render`",
    );
    expect(messages([
      ["/lib.hex",
        "export constraint One<a> =\n    one(value: a): Int\n" +
        "export constraint Two<a> =\n    two(value: a): Int\n"],
      ["/main.hex",
        'import module Lib from "./lib"\n' +
        "export fun size<a: Lib>(x: a): Int = 1\n"],
    ])).toContain(
      "unknown constraint `Lib`; `Lib` is a module alias — the constraints it " +
        "exports are reached through it, as `Lib.Name`",
    );
  });

  test("a qualified head keeps the plain refusal — its repair is not an import line", () => {
    // §4.1's `Alias.Name` spelling arrives under its whole dotted name. That
    // writer already holds an alias; `import module D.NotThere` names no module.
    expect(messages([
      ["/describe.hex", "export constraint Describe<a> =\n    describe(value: a): String\n"],
      ["/main.hex",
        'import module D from "./describe"\n' +
        "export record Box = {n: Int}\n" +
        'honor D.NotThere<Box> =\n    describe(value) = "x"\n'],
    ])).toEqual(["unknown constraint `D.NotThere`"]);
  });

  test("the eleven pre-registered spellings cannot reach either seat", () => {
    // Constraints §5.1.1: they always resolve, so neither silent seat is
    // reachable at one. No case is carved for that in the implementation; this
    // pins that none is needed — and it is the record correction on #577, whose
    // seat inventory reached for `Pow` before the spellings were measured.
    //
    // `Pow` has a prelude home, so §6.4's qualified home makes `Pow.` a module:
    // the `widens` head resolves and fails one step further on, at the honor.
    expect(messages([
      ["/main.hex",
        "export record Box = {value: Float}\n" +
        "widens Pow.pow(value: Box, exponent: Float): Box = value\n"],
    ])).toEqual(["`Pow.pow` is not a member this module honors at its own type"]);
    // The constraint namespace holds all eleven, so the bare spellings resolve:
    // a binder compiles, and an `honor` head reaches its own later failure —
    // here §4.2's base obligation — rather than an unknown-constraint refusal.
    //
    // What the third case is *for* is the noun: a missing **instance**, not an
    // unknown constraint and not an unknown module. Matched whole rather than by
    // prefix so that a message which drifted into either signpost's shape would
    // fail here; the legal-homes clause it now carries is #638's (§7.6), naming
    // the subject's own module and stating `Num`'s prelude home as fact rather
    // than offering it.
    expect(messages([
      ["/main.hex", "export fun go<a: Pow>(x: a): a = x\n"],
    ])).toEqual([]);
    expect(messages([
      ["/main.hex",
        "export record Box = {value: Float}\n" +
        "honor Pow<Box> =\n    pow(value, exponent) = value\n"],
    ])).toEqual([
      "type `Box` has no `Num` instance; it could only be declared in " +
        "`./main.hex` (declares `Box`) or the module declaring `Num`",
    ]);
  });
});

describe("the specifier the workspace tier writes (`specifierFor`)", () => {
  /**
   * The helper the applied edit's import line is built from, pinned where the
   * family is rather than beside its inverse: what makes it correct is that the
   * compiler reads back exactly the module it was asked to name, and the round
   * trip is the only statement of that worth making. Absolute importers only:
   * every path the compiler carries is one, and `resolveSpecifier` absolutizes
   * a relative importer on its own, so a bare `main.hex` never round-trips and
   * never arrives.
   */
  test("the round trip through `resolveSpecifier` is the identity", () => {
    for (
      const [importer, target] of [
        ["/main.hex", "/scale.hex"],
        ["/src/main.hex", "/lib/scale.hex"],
        ["/src/main.hex", "/src/deep/nested/scale.hex"],
        ["/a/b/c/main.hex", "/scale.hex"],
        ["/src/main.hex", "/src/scale.hex"],
      ] as const
    ) {
      expect(resolveSpecifier(importer, specifierFor(importer, target))).toBe(target);
    }
  });

  test("a relative specifier is always spelled as one", () => {
    // Modules §12.1: a bare specifier is a package import, and those are
    // refused — so a same-directory target keeps its `./`.
    expect(specifierFor("/src/main.hex", "/src/scale.hex")).toBe("./scale");
    expect(specifierFor("/src/main.hex", "/lib/deep/scale.hex")).toBe("../lib/deep/scale");
    expect(specifierFor("/main.hex", "/lib/scale.hex")).toBe("./lib/scale");
  });
});
