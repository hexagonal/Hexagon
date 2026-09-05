import { describe, expect, test } from "vitest";

import { compileFiles } from "../support/test-project.js";
import { type ProjectOptions, resolveSpecifier, specifierFor } from "../project.js";
import { displayModuleName, moduleImportLine } from "../packages.js";
import type * as Diagnostics from "../support/diagnostics.js";

/**
 * Conformance for the **module-import repair family** — Modules §5.1 rule 1's
 * type-not-module seat and the two constraint seats Constraints §8 sends here
 * (#577), each respelt for the one import form there is (#762).
 *
 * One shape, three refusals. An author reaches for a name through a route the
 * language spells with an import line, the name resolves nowhere, and before
 * this the three seats said only that: `` unknown name `Shape` ``,
 * `` unknown module `Scale` ``, `` unknown constraint `Scale` ``. Each is true
 * about the namespace it consulted and silent about the one line that would
 * have made the program work — and rule 1's sentence, promised verbatim in
 * §5.1 and §10 since the module rules were written, was implemented nowhere.
 *
 * **v1 is the failed-resolution shape and no more** (the #577 ruling). Where the
 * spelling resolves as a *term* — a record import binds its constructor, so
 * `Shape.make` is a field access on a constructor-typed head — nothing here
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
function messages(
  files: readonly (readonly [string, string])[],
  options: ProjectOptions = {},
): readonly string[] {
  return compileFiles(files, options).diagnostics.map(({ message }) => message);
}

/**
 * Rule 1's sentence where the checker has **not** reached the type's home —
 * the module's own declaration, which no import repairs (§5.1, §10).
 */
const TYPE_NOT_A_MODULE = "`Shape` is a type, not a module; import its home " +
  "module to qualify through it";

/**
 * The same seat where the home **is** reached: "*the type's home named*"
 * (§10's row, as #829 respelled it). The alias clause goes where the module's
 * own name is already the spelling, the rule every line a tier writes keeps.
 */
const SHAPE_HOME_NAMED = "`Shape` is a type, not a module; `import Shape` " +
  "and qualify through it";

/** A union and an ordinary function over it: the type-only import's fixture. */
const SHAPE = [
  "/shape.hex",
  "module Shape\n\n" + "export union Shape = Circle(Float) | Square(Float)\n" +
    "export fun area(s: Shape): Float = 1.0\n",
] as const;

/**
 * A module exporting a transparent alias and a value under it — the one shape
 * that carries a type's **home** across the border (`#typeHomeModule`), and so
 * the one where the compiler tier can write the import line itself.
 */
const LIB = [
  "/lib.hex",
  "module Lib\n\n" + "export type Meters = Float\n" + "export let zero: Float = 0.0\n",
] as const;

/**
 * One file's text with every edit of one diagnostic's sole fix applied — the
 * proof that a rewrite is the repair and not a gesture at one (Declarations
 * Preamble §1.1). Edits are applied last-first so earlier spans keep their
 * offsets.
 */
function applied(text: string, diagnostic: Diagnostics.Diagnostic | undefined): string {
  const [fix, ...rest] = diagnostic?.fixes ?? [];
  expect(rest).toEqual([]);
  return [...fix?.edits ?? []]
    .sort((left, right) => right.span.start.offset - left.span.start.offset)
    .reduce(
      (document, { span, replacement }) =>
        document.slice(0, span.start.offset) + replacement + document.slice(span.end.offset),
      text,
    );
}

/** A user constraint, unimported: the arrival state both constraint seats own. */
const SCALE = [
  "/scale.hex",
  "module Scale\n\n" + "export constraint Scale<a> =\n    scale(value: a, factor: Int): a\n",
] as const;

describe("the type seat (Modules §5.1 rule 1)", () => {
  test("a bare type qualified as a module is told which namespace it is in", () => {
    // The filing's own probe, respelt for #762: a transparent alias of this
    // module's own puts `Shape` in the type namespace and no term (§3.2), so
    // `Shape.` finds no module alias, no term, and a type — which is exactly
    // the state rule 1's sentence is written about.
    expect(messages([
      SHAPE,
      ["/main.hex",
        "module Main\n\n" + 'import Shape as S\n' +
        "type Shape = S.Shape\n" +
        "export fun go(s: Shape): Float = Shape.area(s)\n"],
    ])).toEqual([SHAPE_HOME_NAMED]);
  });

  test("the module's own type reads the same — the seat is the namespace, not the import", () => {
    expect(messages([
      ["/main.hex",
        "module Main\n\n" + "union Shape = Circle(Float)\n" +
        "export let n: Float = Shape.area(1.0)\n"],
    ])).toEqual([TYPE_NOT_A_MODULE]);
  });

  test("a transparent alias is a type too, and says so under its own name", () => {
    expect(messages([
      ["/lib.hex", "module Lib\n\n" + "export type Meters = Float\n"],
      ["/main.hex",
        "module Main\n\n" + 'import Lib\n' +
        "type Meters = Lib.Meters\n" +
        "export let n: Float = Meters.zero\n"],
    ])).toEqual([
      // The home is the qualifier the alias's expansion was written through,
      // realiased so the bare spelling resolves (§5.1 rule 2's door).
      "`Meters` is a type, not a module; `import Lib as Meters` and qualify through it",
    ]);
  });

  test("one use, one sentence — the receiver reports and the call does not cascade", () => {
    // The refused receiver answers with an error node, exactly as an unknown
    // name does, so the checker sees a poisoned callee rather than a second
    // fault to describe.
    expect(messages([
      SHAPE,
      ["/main.hex",
        "module Main\n\n" + 'import Shape as S\n' +
        "type Shape = S.Shape\n" +
        "export fun go(s: Shape): Float = Shape.area(s) + Shape.area(s)\n"],
    ])).toEqual([SHAPE_HOME_NAMED, SHAPE_HOME_NAMED]);
  });

  test("nothing of the spelling anywhere keeps the bare unknown name", () => {
    // The sentence is conditioned on a type existing — "mentioning the type if
    // one exists". With no type there is nothing to mention, and claiming one
    // would be false.
    // The specimen is a word the prelude does not use at all: since #742's
    // qualified-only default, `Shape` is `JsConversionReason`'s constructor and
    // draws §5.5's refusal rather than the unknown name this seat is about.
    expect(messages([
      ["/main.hex", "module Main\n\n" + "export let n: Float = Chevron.area(1.0)\n"],
    ])).toEqual(["unknown name `Chevron`"]);
  });

  test("a non-uppercase receiver is not rule 1's at all", () => {
    // Rule 1 is "uppercase immediately followed by `.`". A lowercase receiver is
    // an ordinary value, and its miss is an ordinary unknown name.
    expect(messages([
      ["/main.hex",
        "module Main\n\n" + "export union Shape = Circle(Float)\n" +
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
        "module Main\n\n" + 'extern from "./x.js"\n    type foo\n' +
        "export let n: Int = foo.bar(1)\n"],
    ])).toEqual([
      "foreign type `foo` needs an uppercase-start local alias; write " +
        "`type foo as Tfoo`",
      "unknown name `foo`",
    ]);
  });

  /**
   * §5.1's **applied-edit obligation**, at the tier that owes it (§10's row:
   * "*the type's home named, the applied edit carried*"; #829, ruled onto this
   * PR).
   *
   * Before #829 a module import carried a path, which only a workspace could
   * supply, so the whole family's edit sat at the LSP tier. A module import now
   * names a module, and where the *home is reached* the compiler already spells
   * the line in its own sentence — so it writes it as an edit too, and a batch
   * compile carries the repair a session used to have to compute.
   *
   * The placement is §5.1's own: below the last import line above the use.
   */
  test("the home named, the applied edit carried — from the compiler's own diagnostics", () => {
    const text = "module Main\n\n" + "import Lib\n" +
      "type Meters = Lib.Meters\n" + "export let n: Float = Meters.zero\n";
    const [diagnostic, ...rest] = compileFiles([LIB, ["/main.hex", text]]).diagnostics;
    expect(diagnostic?.message).toBe(
      "`Meters` is a type, not a module; `import Lib as Meters` and qualify through it",
    );
    expect(rest).toEqual([]);
    const repaired = applied(text, diagnostic);
    expect(repaired).toBe(
      "module Main\n\n" + "import Lib\n" + "import Lib as Meters\n" +
        "type Meters = Lib.Meters\n" + "export let n: Float = Meters.zero\n",
    );
    // The standard the family is held to: the offered line is the repair, so
    // the file it produces draws nothing (Declarations Preamble §1.1).
    expect(messages([LIB, ["/main.hex", repaired]])).toEqual([]);
  });

  test("the edit belongs to the module holding the use, not to the file's first", () => {
    // A file may hold several modules (§2.2), and each is resolved on its own —
    // so the header the fallback is measured from is *this* module's. Measuring
    // from the file's first header would write the import into a stranger, and
    // measuring from offset zero would write it above every header, which is
    // "code outside a module" (§2.2) rather than a badly-placed import.
    //
    // The import line here sits *below* the use, so it is not one the new alias
    // could sit under (§5.1's local reading) and the header fallback is what
    // answers — which is the only shape in this family that reaches it, the
    // home being known through an import in the first place.
    const text = "module Other\n\n" + "export let a: Int = 1\n\n" +
      "end module Other\n\n" +
      "module Main\n\n" + "type Meters = P.Meters\n" +
      "export let n: Float = Meters.zero\n" +
      "import Lib as P\n";
    const [diagnostic, ...rest] = compileFiles([LIB, ["/f.hex", text]]).diagnostics
      .filter(({ message }) => message.includes("is a type, not a module"));
    expect(diagnostic?.message).toBe(
      "`Meters` is a type, not a module; `import Lib as Meters` and qualify through it",
    );
    expect(rest).toEqual([]);
    expect(applied(text, diagnostic)).toBe(
      "module Other\n\n" + "export let a: Int = 1\n\n" +
        "end module Other\n\n" +
        "module Main\n\n" + "import Lib as Meters\n" +
        "type Meters = P.Meters\n" +
        "export let n: Float = Meters.zero\n" +
        "import Lib as P\n",
    );
  });

  test("one line for one spelling, however many uses the module refuses", () => {
    // Three refused uses of `Meters.` want the identical line, and the first
    // carries it — so it sits above them all and applying every fix the file
    // reports writes one import, not three.
    const text = "module Main\n\n" + "import Lib\n" +
      "type Meters = Lib.Meters\n" +
      "export let a: Float = Meters.zero\n" +
      "export let b: Float = Meters.zero\n";
    const reported = compileFiles([LIB, ["/main.hex", text]]).diagnostics;
    expect(reported.map(({ fixes }) => (fixes ?? []).length)).toEqual([1, 0]);
  });

  test("a prelude spelling never reaches the seat — its alias is always standing", () => {
    // `Int` is a type *and* a module (Modules §6.4 gives every prelude member a
    // qualified home), so `Int.` resolves before rule 1's refusal is consulted.
    expect(messages([
      ["/main.hex", "module Main\n\n" + "export let n: String = Int.show(3)\n"],
    ])).toEqual([]);
  });

  test("a declaration below the use keeps the truer sentence", () => {
    // A record binds its constructor, so `Shape` *is* a term — one declared
    // below this line. "Declared later" names the fix; "is a type, not a module"
    // would be a false classification of a name that resolves fine one line down.
    expect(messages([
      ["/main.hex",
        "module Main\n\n" + "export let n: Int = Shape.make(3)\n" +
        "export record Shape = {n: Int}\n"],
    ])).toEqual([
      "`Shape` is declared later in this block; declarations are read top-down " +
        "— move its declaration above this use",
    ]);
  });

  test("the constructor-bound shape is untouched — v1 is failed resolution only", () => {
    // The #577 ruling's carve-out, pinned so the boundary is visible rather than
    // implied: a record declaration binds the constructor, `Shape` resolves as a
    // term, and `.make` is a field access against it. The inverted mismatch that
    // results is #642's, not this one's — what this test asserts is that nothing
    // here reclassified it. Written against the module's *own* record since
    // #762: a bare constructor abroad is rule 3's fallback, which puts a module
    // alias at the spelling and so answers `Shape.` before rule 1 is asked.
    const reported = messages([
      ["/main.hex",
        "module Main\n\n" + "export record Shape = {n: Int}\n" +
        "export let s: Shape = Shape.make(3)\n"],
    ]);
    // The claim is that the writer is shown a *mismatch*, with the constructor
    // on the expected side. The field's type is an unsolved variable, which
    // #649 spells `a` rather than the allocation counter this pin used to have
    // to match.
    expect(reported).toEqual([
      "type mismatch: expected ({n: Int}) -> Shape, found {make: a, ...}",
    ]);
  });
});

describe("the `widens` head seat (Constraints §8's row)", () => {
  test("a head whose qualifier names nothing carries the route", () => {
    expect(messages([
      SCALE,
      ["/main.hex",
        "module Main\n\n" + "export record Metre = {m: Float}\n" +
        "widens Scale.scale(value: Metre, factor: Float): Metre = value\n"],
    ])).toEqual([
      "unknown module `Scale`; a `widens` head names its member through a " +
        "module alias; import the member's home module under the alias `Scale`",
    ]);
  });

  test("the route is the alias's own spelling, whatever it is", () => {
    expect(messages([
      ["/main.hex",
        "module Main\n\n" + "export record Metre = {m: Float}\n" +
        "widens Sizing.scale(value: Metre, factor: Float): Metre = value\n"],
    ])).toEqual([
      "unknown module `Sizing`; a `widens` head names its member through a " +
        "module alias; import the member's home module under the alias `Sizing`",
    ]);
  });

  test("a qualifier that *is* a module keeps the member refusal it always had", () => {
    // The second arm is untouched: the module answered, the member did not.
    expect(messages([
      SCALE,
      ["/main.hex",
        "module Main\n\n" + 'import Scale\n' +
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
        "module Main\n\n" + "export record Metre = {m: Float}\n" +
        "honor Scale<Metre> =\n    scale(value, factor) = value\n"],
    ])).toEqual([
      "unknown constraint `Scale`; import its home module under the alias " +
        "`Scale` for qualified access",
    ]);
  });

  test("a binder reads identically — one message, both positions", () => {
    expect(messages([
      SCALE,
      ["/main.hex", "module Main\n\n" + "export fun go<a: Scale>(x: a): a = x\n"],
    ])).toEqual([
      "unknown constraint `Scale`; import its home module under the alias " +
        "`Scale` for qualified access",
    ]);
  });

  test("both spellings the route opens compile", () => {
    // The message earns its clause: the line it names is a program, and it
    // opens both spellings the alias reaches — the qualified one, and the bare
    // one §5.1 rule 2's companion fallback answers where the alias is spelled
    // like the constraint.
    expect(messages([
      SCALE,
      ["/main.hex",
        "module Main\n\n" + 'import Scale\n' +
        "export fun go<a: Scale.Scale>(x: a): a = x\n"],
    ])).toEqual([]);
    expect(messages([
      SCALE,
      ["/main.hex",
        "module Main\n\n" + 'import Scale\n' +
        "export fun go<a: Scale>(x: a): a = x\n"],
    ])).toEqual([]);
  });

  test("the alias-bearing arms are byte-identical to what they always said", () => {
    // The realias repair (#531) and the several-constraints form: an alias *is*
    // standing at the spelling, so the family signpost never gets its turn, and
    // these two sentences are the ones this change must not have moved.
    //
    // The realias clause goes through `moduleImportLine` (packages.ts) like
    // every other realias seat, so it names a module and carries no path
    // (Modules §10). It cannot read the import's `specifier`, which since #829
    // holds the *emitted* JS path for the edge (§11.2) and no module name.
    expect(messages([
      ["/render.hex", "module Render\n\n" + "export constraint Render<a> =\n    render(value: a): String\n"],
      ["/main.hex",
        "module Main\n\n" + 'import Render as R\n' +
        "export fun label<a: R>(x: a): String = R.render(x)\n"],
    ])).toContain(
      "unknown constraint `R`; `R` is a module alias — write `R.Render` for the " +
        'constraint it exports, or realias as `import Render`',
    );
    expect(messages([
      ["/lib.hex",
        "module Lib\n\n" + "export constraint One<a> =\n    one(value: a): Int\n" +
        "export constraint Two<a> =\n    two(value: a): Int\n"],
      ["/main.hex",
        "module Main\n\n" + 'import Lib\n' +
        "export fun size<a: Lib>(x: a): Int = 1\n"],
    ])).toContain(
      "unknown constraint `Lib`; `Lib` is a module alias — the constraints it " +
        "exports are reached through it, as `Lib.Name`",
    );
  });

  test("a qualified head keeps the plain refusal — its repair is not an import line", () => {
    // §4.1's `Alias.Name` spelling arrives under its whole dotted name. That
    // writer already holds an alias; `import D.NotThere` names no module.
    expect(messages([
      ["/describe.hex", "module Describe\n\n" + "export constraint Describe<a> =\n    describe(value: a): String\n"],
      ["/main.hex",
        "module Main\n\n" + 'import Describe as D\n' +
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
        "module Main\n\n" + "export record Box = {value: Float}\n" +
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
      ["/main.hex", "module Main\n\n" + "export fun go<a: Pow>(x: a): a = x\n"],
    ])).toEqual([]);
    expect(messages([
      ["/main.hex",
        "module Main\n\n" + "export record Box = {value: Float}\n" +
        "honor Pow<Box> =\n    pow(value, exponent) = value\n"],
    ])).toEqual([
      "type `Box` has no `Num` instance; it could only be declared in " +
        "module `Main` (declares `Box`) or the module declaring `Num`",
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

/**
 * **The line a repair offers resolves where it lands** (Packages §3.3, §2.5;
 * Declarations Preamble §1.1's Rewrite Rule).
 *
 * Packages §3.3 is flat about it — "a package's own modules are imported by
 * their declared names" — and §3.2 answers `import Lib` inside `Acme` from the
 * declared name alone, while `import Acme.Lib` there is the self-qualified
 * refusal. So an import line this family prints for a project module has to
 * elide the *resolving* package's segment and keep every other package's, which
 * is `resolveModuleName` read backwards (`displayModuleName`).
 *
 * Every case below is the same two files compiled twice, once unnamed and once
 * under a manifest `name`. That is the shape the fault took: the full name went
 * into the line, so an unnamed project — every test the corpus had — was right
 * and a named one offered `import Acme.Lib`, a line the compiler refuses. The
 * repaired file recompiled to zero reports is what makes each case an
 * obligation rather than a spelling preference.
 */
describe("the resolving package's own segment (Packages §3.3)", () => {
  /** The two option sets every case below is measured under. */
  const SHAPES = [{}, { packageName: "Acme" }] as const;

  test("the type seat's message names the module as this package must write it", () => {
    for (const options of SHAPES) {
      expect(messages([
        ["/lib.hex", "module Lib\n\n" + "export type Meters = Float\n"],
        ["/main.hex",
          "module Main\n\n" + "import Lib\n" +
          "type Meters = Lib.Meters\n" +
          "export let n: Float = Meters.zero\n"],
      ], options)).toEqual([
        "`Meters` is a type, not a module; `import Lib as Meters` and qualify through it",
      ]);
    }
  });

  test("the type seat's applied edit repairs the file under a manifest `name`", () => {
    const text = "module Main\n\n" + "import Lib\n" +
      "type Meters = Lib.Meters\n" + "export let n: Float = Meters.zero\n";
    for (const options of SHAPES) {
      const [diagnostic, ...rest] = compileFiles([LIB, ["/main.hex", text]], options).diagnostics;
      expect(rest).toEqual([]);
      const repaired = applied(text, diagnostic);
      expect(repaired).toBe(
        "module Main\n\n" + "import Lib\n" + "import Lib as Meters\n" +
          "type Meters = Lib.Meters\n" + "export let n: Float = Meters.zero\n",
      );
      // The standard: the offered edit *repairs*. With the package segment in
      // the line this drew two reports instead of none — the unresolved
      // `Acme.Lib`, and the original refusal the repair did not repair.
      expect(messages([LIB, ["/main.hex", repaired]], options)).toEqual([]);
    }
  });

  test("the alias-is-not-a-type realias names the module as this package must write it", () => {
    for (const options of SHAPES) {
      expect(messages([
        ["/render.hex", "module Render\n\n" + "opaque record Point = {x: Int}\n"],
        ["/main.hex",
          "module Main\n\n" + "import Render as R\n" +
          "export let f(p: R): Int = 1\n"],
      ], options)).toContain(
        "`R` is a module alias, not a type; write `R.Point` for the type it exports, " +
          "name it bare with `type Point = R.Point`, or realias as `import Render as Point`",
      );
    }
  });

  test("the constraint alias's realias names the module as this package must write it", () => {
    for (const options of SHAPES) {
      expect(messages([
        ["/render.hex",
          "module Render\n\n" + "export constraint Render<a> =\n    render(value: a): String\n"],
        ["/main.hex",
          "module Main\n\n" + "import Render as R\n" +
          "export fun label<a: R>(x: a): String = R.render(x)\n"],
      ], options)).toContain(
        "unknown constraint `R`; `R` is a module alias — write `R.Render` for the " +
          "constraint it exports, or realias as `import Render`",
      );
    }
  });

  test("another package's segment is kept — only the reader's own is elided", () => {
    // The rule has two halves and only one of them is an elision. `Hex.` is the
    // half that was always implemented, and it is the same rule from the other
    // side: the standard library is always someone else's package, so a reader
    // in `Acme` writes its modules bare because the prelude is in scope under
    // exactly that spelling (Packages §2.4), not because the segment is theirs.
    expect(displayModuleName("Acme.Lib", "Acme")).toBe("Lib");
    expect(displayModuleName("Bolt.Lib", "Acme")).toBe("Bolt.Lib");
    expect(displayModuleName("Hex.Ord", "Acme")).toBe("Ord");
    expect(displayModuleName("Acme.Lib")).toBe("Acme.Lib");
    expect(moduleImportLine("Acme.Metric", "Scale", "Acme")).toBe("import Metric as Scale");
    expect(moduleImportLine("Bolt.Metric", "Scale", "Acme")).toBe("import Bolt.Metric as Scale");
  });
});
