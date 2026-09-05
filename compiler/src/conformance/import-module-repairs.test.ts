import { describe, expect, test } from "vitest";

import { compileFiles } from "../support/test-project.js";
import { type ProjectOptions, resolveSpecifier, specifierFor } from "../project.js";
import { displayModuleName, type ImportRepair, moduleImportLine } from "../packages.js";
import { check } from "../passes/checker/checker.js";
import { applyLayout } from "../passes/layout/layout.js";
import { lex } from "../passes/lexer/lexer.js";
import { parse } from "../passes/parser/parser.js";
import { resolve } from "../passes/resolver/resolver.js";
import type * as Diagnostics from "../support/diagnostics.js";
import { ImportRepairs } from "../support/import-placement.js";
import * as Source from "../support/source.js";

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
 * **Rule 1's first two tests are read ahead of the term namespace** — the
 * reporting module's own default alias, and a type of the spelling in scope
 * (§5.1 rule 1: "`Name.` resolves in the module-alias namespace **first**"). The
 * #577 ruling's v1 carve read the term namespace first, and a record — which
 * declares a type *and* a constructor of one spelling — therefore never reached
 * the row §13(o)'s own specimen is written for. What survives of the carve is
 * the case rule 1 says nothing about: a term of the spelling that names no type
 * and is not the module's own alias, whose `.field` is an ordinary access and
 * whose inverted mismatch is #642's. The suite below pins both halves of that
 * line.
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
 * Rule 1's type-branch sentence where the pass has **not** reached the type's
 * home: the route is stated as a rule rather than as a line, and no edit is
 * carried — only an inventory can say which module exports the spelling, and
 * that offer is the workspace tier's (§5.1, §10).
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

  /**
   * §5.1 rule 1's **own-home carve** (#829's Ruling A, as #847 settled it). The
   * type is this module's own declaration, so the repair the row above would
   * name is `import Main` written inside `module Main` — §8.1's one-node cycle.
   * What the row takes instead is the own-alias row's *repair and condition*
   * while **keeping its own fact**: §10 writes the two rows separately for
   * exactly this, and the reader wrote a type's name — the sentence that says
   * so is the one they can act on.
   *
   * No repair clause here: `area` is not a binding this module holds, so there
   * is no bare spelling to drop the qualifier onto.
   */
  test("a type of the module's own keeps the type's fact, with the own-alias repair", () => {
    expect(messages([
      ["/main.hex",
        "module Main\n\n" + "union Shape = Circle(Float)\n" +
        "export let n: Float = Shape.area(1.0)\n"],
    ])).toEqual(["`Shape` is a type, not a module"]);
  });

  /** And with a binding of the name, the qualifier is dropped as the edit. */
  test("the qualifier is dropped where the module's own layer holds the spelling", () => {
    const text = "module Main\n\n" + "union Shape = Circle(Float)\n" +
      "let area(value: Float): Float = value\n" +
      "export let n: Float = Shape.area(1.0)\n";
    const [diagnostic, ...rest] = compileFiles([["/main.hex", text]]).diagnostics;
    expect(diagnostic?.message)
      .toBe("`Shape` is a type, not a module; write `area(1.0)`");
    // Never `import Main`, at the message or at the edit (§8.1's one-node cycle).
    expect(diagnostic?.message).not.toContain("import");
    expect(rest).toEqual([]);
    expect(applied(text, diagnostic)).toBe(
      "module Main\n\n" + "union Shape = Circle(Float)\n" +
        "let area(value: Float): Float = value\n" +
        "export let n: Float = area(1.0)\n",
    );
    expect(messages([["/main.hex", applied(text, diagnostic)]])).toEqual([]);
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

  test("nothing of the spelling anywhere is the plain unbound-alias report", () => {
    // The type branch is conditioned on a type existing — "mentioning the type
    // if one exists". With no type there is nothing to mention, and claiming
    // one would be false; what is left is rule 1's own report, with no repair
    // clause, because no module of the spelling is visible either (#829's
    // Ruling A). Before it, the receiver decayed to ``unknown name `Chevron` ``
    // — true of the term namespace, and silent about the namespace `Chevron.`
    // was actually read in.
    // The specimen is a word the prelude does not use at all: since #742's
    // qualified-only default, `Shape` is `JsConversionReason`'s constructor and
    // draws §5.5's refusal rather than the report this seat is about.
    expect(messages([
      ["/main.hex", "module Main\n\n" + "export let n: Float = Chevron.area(1.0)\n"],
    ])).toEqual(["no module alias `Chevron`"]);
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

  test("a headerless file carries the message and no edit — the header repair owns offset zero", () => {
    // Two applied edits would stand at offset zero: the parser's "every file
    // declares its module" insert, and this line. A host applying both at once
    // does not recompute the second, so the import can land above the header it
    // was meant to follow — "code outside a module" (§2.2), which is not what
    // §5.1's "placed so the file stays well-formed" allows. The placement
    // declines instead; once the header repair lands, this answers normally.
    //
    // The import sits *below* the use, which is what reaches the header
    // fallback at all: an import the use is already below anchors the edit at
    // an offset that is never zero, so nothing collides there and that shape
    // places as it always did.
    const text = "type Meters = P.Meters\n" +
      "export let n: Float = Meters.zero\n" + "import Lib as P\n";
    const reported = compileFiles([LIB, ["/main.hex", text]]).diagnostics;
    expect(reported.map(({ message }) => message)).toEqual([
      "every file declares its module; write `module Main`",
      "`Meters` is a type, not a module; `import Lib as Meters` and qualify through it",
    ]);
    expect(reported.map(({ fixes }) => (fixes ?? []).length)).toEqual([1, 0]);
    // And the header repair alone leaves a file this seat then repairs: the
    // second offer is not withheld, it is deferred to a file that has a module.
    const headed = applied(text, reported[0]);
    expect(headed).toBe(`module Main\n\n${text}`);
    const [second, ...rest] = compileFiles([LIB, ["/main.hex", headed]]).diagnostics;
    expect(rest).toEqual([]);
    expect(applied(headed, second)).toBe(
      "module Main\n\n" + "import Lib as Meters\n" + "type Meters = P.Meters\n" +
        "export let n: Float = Meters.zero\n" + "import Lib as P\n",
    );
  });

  test("the inserted line ends the way the file ends its own lines", () => {
    // A `\n` written into a CRLF file leaves one line ending that matches none
    // of its neighbours — a whitespace diff the author never wrote, carried in
    // by the repair (review round 3's NB4).
    const text = "module Main\r\n\r\nimport Lib\r\n" +
      "type Meters = Lib.Meters\r\n" + "export let n: Float = Meters.zero\r\n";
    const [diagnostic] = compileFiles([LIB, ["/main.hex", text]]).diagnostics;
    expect(applied(text, diagnostic)).toBe(
      "module Main\r\n\r\nimport Lib\r\nimport Lib as Meters\r\n" +
        "type Meters = Lib.Meters\r\n" + "export let n: Float = Meters.zero\r\n",
    );
    expect(messages([LIB, ["/main.hex", applied(text, diagnostic)]])).toEqual([]);
  });

  test("one line for one spelling, however many uses the module refuses", () => {
    // Two refused uses of `Meters.` want the identical line, computed from the
    // first — so it sits above them both, and applying every fix the file
    // reports writes one import, not two.
    const text = "module Main\n\n" + "import Lib\n" +
      "type Meters = Lib.Meters\n" +
      "export let a: Float = Meters.zero\n" +
      "export let b: Float = Meters.zero\n";
    const reported = compileFiles([LIB, ["/main.hex", text]]).diagnostics;
    // Every seat carries it, and every seat carries the *same* one: same range,
    // same text (§5.1, as #829 respelled the obligation). A host applying both
    // applies one import; a reader who fixes the second gets the same repair as
    // one who fixes the first, where before they got none at all.
    expect(reported.map(({ fixes }) => (fixes ?? []).length)).toEqual([1, 1]);
    const edits = reported.map(({ fixes }) => fixes![0]!.edits[0]!);
    expect(edits[1]!.replacement).toBe(edits[0]!.replacement);
    expect(edits[1]!.span.start.offset).toBe(edits[0]!.span.start.offset);
    expect(applied(text, reported[1])).toBe(applied(text, reported[0]));
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

  test("a record's own spelling reaches rule 1, constructor or no constructor", () => {
    // A record declares a **type and a constructor** of one spelling, and rule 1
    // reads the module-alias namespace first at both (§5.1 rule 1). The #577 v1
    // carve read the term namespace first and so never reached this row: the
    // writer of §13(o)'s own specimen was handed `type mismatch: expected
    // ({n: Int}) -> Shape, found {make: a, ...}` — a sentence about the field
    // access the recovery built, silent about the type standing one namespace
    // over, which is the whole content of the mistake.
    //
    // Written against the module's *own* record since #762: a bare constructor
    // abroad is rule 3's fallback, which puts a module alias at the spelling and
    // so answers `Shape.` before rule 1 is asked.
    const text = "module Main\n\n" + "export record Shape = {n: Int}\n" +
      "export fun make(n: Int): Shape = Shape({n = n})\n" +
      "export let s: Shape = Shape.make(3)\n";
    const [diagnostic, ...rest] = compileFiles([["/main.hex", text]]).diagnostics;
    expect(diagnostic?.message).toBe("`Shape` is a type, not a module; write `make(3)`");
    expect(rest).toEqual([]);
    expect(applied(text, diagnostic)).toBe(
      "module Main\n\n" + "export record Shape = {n: Int}\n" +
        "export fun make(n: Int): Shape = Shape({n = n})\n" +
        "export let s: Shape = make(3)\n",
    );
    expect(messages([["/main.hex", applied(text, diagnostic)]])).toEqual([]);
  });

  test("the carve that remains: a term of the spelling naming no type", () => {
    // Rule 1's first two tests are what the term namespace yields to — the
    // module's own alias, and a type of the spelling. Where **neither** answers
    // and a term does, the term reading stands and the #577 v1 carve with it: a
    // nullary constructor is a value, and `.at` against one is a field access
    // whose mismatch is #642's, not this family's.
    expect(messages([
      ["/main.hex",
        "module Main\n\n" + "export union Colour = Red | Green\n" +
        "export let n: Int = Red.at\n"],
    ])).toEqual([
      "type mismatch: expected Colour, found {at: a, ...}",
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

  /**
   * §5.1's applied-edit obligation names this seat among the ones it covers —
   * "the constraint seats whose rows Constraints §8 sends here" — and §10's row
   * says "the applied edit from the compiler tier, one edit per module".
   *
   * The seat used to hand back a bare message: the placement lived in the
   * resolver, the checker had none, and a reader who wrote `Scale.Scale` in a
   * binder got the line to type and nothing to apply, at either tier.
   */
  test("an unbound qualifier at the constraint seat carries the applied edit", () => {
    const text = "module Main\n\n" + "export fun go<a: Scale.Scale>(x: a): a = x\n";
    const [diagnostic, ...rest] = compileFiles([SCALE, ["/main.hex", text]]).diagnostics;
    expect(diagnostic?.message).toBe("no module alias `Scale`; `import Scale`");
    expect(rest).toEqual([]);
    expect(applied(text, diagnostic)).toBe(
      "module Main\n\n" + "import Scale\n" + "export fun go<a: Scale.Scale>(x: a): a = x\n",
    );
    expect(messages([SCALE, ["/main.hex", applied(text, diagnostic)]])).toEqual([]);
  });

  test("the constraint seat and a term seat of one spelling share one edit", () => {
    // §5.1's "one edit per module, however many seats draw the report: every
    // seat carries the same insert, the same range and the same text". The two
    // seats are reported by two *passes* — the checker here, the resolver at the
    // term — so the cache they mint from has to be the module's and not either
    // pass's, or a host applying both writes two import lines.
    //
    // Written with an **interleaved import** between the two seats, which is the
    // one shape where the placement differs between them: a cache per pass gives
    // the constraint seat the offset below the header and the term seat the one
    // below `import Other`, and a host applying both writes two lines. A cache
    // per module gives both the same one, which is what the sentence asks for.
    const text = "module Main\n\n" +
      "export fun go<a: Scale.Scale>(x: a): a = x\n" +
      "import Other\n" +
      "export let one: Int = Scale.unit + Other.n\n";
    const { diagnostics } = compileFiles([
      ["/scale.hex",
        "module Scale\n\n" + "export constraint Scale<a> =\n    scale(value: a, factor: Int): a\n" +
        "export let unit: Int = 1\n"],
      ["/other.hex", "module Other\n\n" + "export let n: Int = 1\n"],
      ["/main.hex", text],
    ]);
    expect(diagnostics.map(({ message }) => message)).toEqual([
      "no module alias `Scale`; `import Scale`",
      "no module alias `Scale`; `import Scale`",
    ]);
    const edits = diagnostics.map((diagnostic) => diagnostic.fixes?.[0]?.edits);
    expect(edits[0]).toBeDefined();
    expect(edits[1]).toEqual(edits[0]);
    // And the line the two of them share is a program: applying it once leaves
    // nothing to report at either seat.
    const edit = edits[0]![0]!;
    expect(
      messages([
        ["/scale.hex",
          "module Scale\n\n" + "export constraint Scale<a> =\n    scale(value: a, factor: Int): a\n" +
          "export let unit: Int = 1\n"],
        ["/other.hex", "module Other\n\n" + "export let n: Int = 1\n"],
        ["/main.hex",
          text.slice(0, edit.span.start.offset) + edit.replacement +
            text.slice(edit.span.end.offset)],
      ]),
    ).toEqual([]);
  });

  test("a refused import head above it takes the edit away, as at every other seat", () => {
    // §5.1: "a refused import head that offers the same line by its own rewrite
    // is that line already offered, and the seats below it carry none" — read at
    // the constraint seat too, or a miscased head has two lightbulbs writing one
    // import, the second into the middle of the line the first rewrites.
    const { diagnostics } = compileFiles([
      SCALE,
      ["/main.hex",
        "module Main\n\n" + "import scale\n" +
        "export fun go<a: Scale.Scale>(x: a): a = x\n"],
    ]);
    const seat = diagnostics.find(({ message }) => message.startsWith("no module alias"));
    expect(seat?.message).toBe("no module alias `Scale`; `import Scale`");
    expect(seat?.fixes).toBeUndefined();
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

/**
 * Rule 1's **type branch at the constraint seats** — §10's rows 533 and 534,
 * at the four seats the checker owns.
 *
 * §5.1 rule 1 asks three questions in order, and the third is the plain
 * unbound-alias report row 532 states with its own condition attached: "*where
 * no module alias `Rat` is bound, `Rat` is not the reporting module's own
 * alias, **and no type of the spelling is in scope***". The resolver's three
 * seats asked all three. The checker's four asked the first two and then
 * reported row 532 — with row 532's applied edit — at exactly the case its
 * condition excludes, which is not a missing sentence but a wrong repair: with
 * a project module of the spelling visible, the offered `import Shape` compiles
 * and silently moves the head off the type the reader named and onto a
 * module's constraint of the same spelling.
 *
 * The branch's own two rows are what belongs there instead. A type whose home
 * is **this module** keeps the type's fact and takes the own-alias row's repair
 * and condition (row 533) — never an import of the module into itself, §8.1's
 * one-node cycle. A type whose home is **abroad** names that home and carries
 * the import as the applied edit (row 534). Neither names an import of the
 * *qualifier's* spelling, which is the whole content of the fix.
 */
describe("a type of the spelling at a constraint seat (§5.1 rule 1's type branch)", () => {
  /**
   * The four seats. Written as one function of the reference so that the
   * matrix below is a matrix: each case says what the module declares and what
   * the qualified reference is, and all four seats are asked the same question
   * about it — a binder's obligation (Constraints §4.2), an `honor` head
   * (§4.1), a constrained hole (closure doc §4.4), and a parameterized head's
   * own prefix (§4.3).
   */
  const SEATS: readonly (readonly [string, (reference: string) => string])[] = [
    ["the binder", (reference) => `export fun go<a: ${reference}>(x: a): a = x\n`],
    ["the honor head", (reference) => `honor ${reference}<Box> =\n    describe(value) = "b"\n`],
    ["the hole binder", (reference) => `let f(x: _ : ${reference}): Int = 1\n`],
    [
      "the parameterized head prefix",
      (reference) => `honor<a: ${reference}> Own<Twin(a)> =\n    own(value) = 1\n`,
    ],
  ];

  /**
   * The declarations every seat needs in scope — a subject for the head, a
   * parameterized one for §4.3's, and a local constraint for the head that is
   * not the one under test. Rule 1 is indifferent to all of it; it is here so
   * the four seats differ in nothing but the seat.
   */
  const SCAFFOLD = "export record Box = {n: Int}\n" +
    "export record Twin(a) = {left: a, right: a}\n" +
    "export constraint Own<a> =\n    own(value: a): Int\n";

  /**
   * Rule 1's report, of however many the fixture drew.
   *
   * The seats sit inside declarations that raise complaints of their own — an
   * unresolved obligation leaves a binder unconstrained, an `honor` head whose
   * constraint never resolved infers no members — and none of those is what
   * this suite is about. Exactly one report of this family is expected at each
   * seat, which is itself part of the claim.
   */
  function ruleOne(
    files: readonly (readonly [string, string])[],
  ): Diagnostics.Diagnostic {
    const found = compileFiles(files).diagnostics.filter(({ message }) =>
      message.includes("is a type, not a module") ||
      message.includes("no module alias") ||
      message.includes("does not qualify through itself")
    );
    expect(found.map(({ message }) => message)).toHaveLength(1);
    return found[0]!;
  }

  /** A `module Main` of `declarations` with one seat written under them. */
  function main(declarations: string, seat: string): readonly [string, string] {
    return ["/main.hex", `module Main\n\n${declarations}${seat}`];
  }

  /** A module exporting a constraint *and* a type of its own name. */
  const SHAPE_HOME = [
    "/shape.hex",
    "module Shape\n\n" + "export union Shape = Circle(Float)\n" +
      "export constraint Describe<a> =\n    describe(value: a): String\n",
  ] as const;

  describe("row 533 — a type this module declares", () => {
    for (const [seat, write] of SEATS) {
      test(`${seat} keeps the type's fact and takes the own-alias repair`, () => {
        // The module declares the constraint too, so the bare spelling at this
        // use names the module's own binding and the drop is carried (§5.1's
        // condition, one namespace over from the term seat's).
        const declarations = SCAFFOLD + "export record Shape = {n: Int}\n" +
          "export constraint Describe<a> =\n    describe(value: a): String\n";
        const file = main(declarations, write("Shape.Describe"));
        const report = ruleOne([file]);
        expect(report.message).toBe("`Shape` is a type, not a module; write `Describe`");
        // Never an import, at the message or at the edit: `import Main` inside
        // `module Main` is §8.1's one-node cycle, and `import Shape` — which a
        // visible module of the spelling would make available — is the wrong
        // declaration.
        expect(report.message).not.toContain("import");
        expect(applied(file[1], report)).toBe(
          `module Main\n\n${declarations}${write("Describe")}`,
        );
      });
    }

    test("a project module of the spelling changes nothing — the type still wins", () => {
      // The review case, and the reason this is a defect rather than a gap:
      // `import Shape` is available here, it is what row 532 would have
      // offered, and applying it compiles. It also honours **module** `Shape`'s
      // `Describe` at the local record instead of naming the type the reader
      // wrote, which is why row 532 states "and no type of the spelling is in
      // scope" as part of its own condition.
      const declarations = SCAFFOLD + "export record Shape = {n: Int}\n";
      const file = main(declarations, "honor Shape.Describe<Shape> =\n    describe(value) = \"s\"\n");
      const report = ruleOne([SHAPE_HOME, file]);
      expect(report.message).toBe("`Shape` is a type, not a module");
      expect(report.fixes).toBeUndefined();
      // And the edit that is not offered would have been a program: this is the
      // measurement that makes the missing suppression a wrong repair rather
      // than a missing one.
      expect(
        messages([SHAPE_HOME, ["/main.hex", file[1].replace("module Main\n\n", "module Main\n\nimport Shape\n")]]),
      ).toEqual([]);
    });

    test("the repair clause stands down where the bare spelling is not the module's own", () => {
      // §5.1's condition from its failing side, at the type branch: `Describe`
      // is reached through an import, so dropping the qualifier would name
      // another module's declaration. The fact is still the type's.
      const report = ruleOne([
        ["/describe.hex",
          "module Describe\n\n" + "export constraint Describe<a> =\n    describe(value: a): String\n"],
        main("import Describe\nexport record Point = {x: Int}\n",
          "honor Point.Describe<Point> =\n    describe(value) = \"p\"\n"),
      ]);
      expect(report.message).toBe("`Point` is a type, not a module");
      expect(report.fixes).toBeUndefined();
    });
  });

  describe("row 534 — a type whose home is abroad", () => {
    /**
     * The one shape that carries a home across the border (`#typeHomeModule`):
     * a transparent alias of this module's own whose expansion is qualified
     * through an import. The type namespace holds `Shape`, and the module an
     * import would reach is the one the alias points at.
     */
    const DECLARATIONS = "import Shape as S\n" + "type Shape = S.Shape\n" + SCAFFOLD;

    for (const [seat, write] of SEATS) {
      test(`${seat} names the home and carries the import`, () => {
        const file = main(DECLARATIONS, write("Shape.Describe"));
        const report = ruleOne([SHAPE_HOME, file]);
        expect(report.message).toBe(
          "`Shape` is a type, not a module; `import Shape` and qualify through it",
        );
        // The applied edit, and it is a repair: the line makes the qualifier a
        // module alias, which is exactly what the sentence told the reader to do.
        expect(messages([SHAPE_HOME, ["/main.hex", applied(file[1], report)]])).toEqual([]);
      });
    }

    test("the import is the module's one edit, shared with a term seat of the spelling", () => {
      // §5.1's "one edit per module, however many seats draw the report" holds
      // across the branch too: the term seat is the resolver's and this one is
      // the checker's, and both mint from the module's `ImportRepairs`.
      const { diagnostics } = compileFiles([
        SHAPE_HOME,
        main(DECLARATIONS,
          "export fun go<a: Shape.Describe>(x: a): a = x\n" +
            "export let named: Float = Shape.area(1.0)\n"),
      ]);
      const edits = diagnostics
        .filter(({ message }) => message.includes("is a type, not a module"))
        .map(({ fixes }) => fixes?.[0]?.edits);
      expect(edits).toHaveLength(2);
      expect(edits[0]).toBeDefined();
      expect(edits[1]).toEqual(edits[0]);
    });
  });

  describe("row 532 — no type of the spelling, which is the row's own condition", () => {
    for (const [seat, write] of SEATS) {
      test(`${seat} keeps the plain report and its edit`, () => {
        const file = main(SCAFFOLD, write("Shape.Describe"));
        const report = ruleOne([SHAPE_HOME, file]);
        expect(report.message).toBe("no module alias `Shape`; `import Shape`");
        // And the edit is a repair: with no type of the spelling standing in
        // the way, the import is exactly the line the reader needed.
        expect(messages([SHAPE_HOME, ["/main.hex", applied(file[1], report)]])).toEqual([]);
      });
    }
  });

  test("a type in scope with no home reached names no import and carries no edit", () => {
    // The branch's third arm, and the floor the whole fix rests on: **no arm
    // inserts an import of the qualifier's own spelling where a type of it is
    // in scope**. Reached at the pass, by handing the checker the namespace a
    // later resolution would hand it — the same route the contested arm above
    // is pinned by, and for the same reason: the arm is a function of that
    // answer and of nothing else.
    //
    // Everything a repair needs is deliberately present — a module `Shape`
    // that `import Shape` would resolve to, and the module's own edit writer —
    // so that a report naming one would be reporting it, not failing to find it.
    const text = "module Main\n\n" + "export fun go<a: Shape.Describe>(x: a): a = x\n";
    const file = new Source.File(Source.fileId(0), "/main.hex", text);
    const parsed = parse(applyLayout(lex(file)));
    const typed = check({
      ...resolve(parsed, { text }),
      typeSpellings: new Map([["Shape", { own: false }]]),
    }, {
      importRepair: () => ({ kind: "Resolved", fullName: "Hex.Shape" }),
      repairs: new ImportRepairs(parsed, text, "/main.hex"),
    });
    const report = typed.diagnostics
      .find(({ message }) => message.includes("not a module") || message.includes("no module alias"));
    expect(report?.message).toBe(TYPE_NOT_A_MODULE);
    expect(report?.fixes).toBeUndefined();
  });

  describe("the report speaks about the qualifier, and underlines it", () => {
    // §5.1's reports at these seats are about the name that failed to bind, and
    // the resolver's three seats underline exactly that (`seat.qualifier.span`).
    // The item's own span — the whole binder, or `honor` through the end of the
    // head — is the span of the *obligation*, which is not what failed.
    function underlined(files: readonly (readonly [string, string])[], text: string): string {
      const report = ruleOne(files);
      return text.slice(report.primary.start.offset, report.primary.end.offset);
    }

    for (const [seat, write] of SEATS) {
      test(`${seat} underlines the qualifier alone`, () => {
        const file = main(SCAFFOLD, write("Shape.Describe"));
        expect(underlined([SHAPE_HOME, file], file[1])).toBe("Shape");
      });
    }

    test("spacing inside the reference does not widen it", () => {
      const file = main(SCAFFOLD, "export fun go<a: Shape . Describe>(x: a): a = x\n");
      expect(underlined([SHAPE_HOME, file], file[1])).toBe("Shape");
    });

    test("a constraint that merely failed to resolve keeps the item's span", () => {
      // The move is rule 1's, not the seat's: where the qualifier *binds*, the
      // spelling really is an unknown constraint of a known module, and the
      // reader has to look at the whole obligation.
      const text = "module Main\n\n" + 'import Shape as S\n' +
        "export fun go<a: S.NotThere>(x: a): a = x\n";
      const [report] = compileFiles([SHAPE_HOME, ["/main.hex", text]]).diagnostics;
      expect(report?.message).toBe("unknown constraint `S.NotThere`");
      expect(text.slice(report!.primary.start.offset, report!.primary.end.offset))
        .toBe("a: S.NotThere");
    });
  });

  test("a prelude companion binds the alias, and rule 1 never reaches the type", () => {
    // Rule 1 reads the module-alias namespace **first**, and §5.5 puts the
    // prelude's companions in it — so `Option.` is a module here, and the
    // refusal is the one a known module's missing constraint draws. Reading
    // only the module's written imports made `Option` bind nothing, which sent
    // the seat down to a later test: before the type branch, the plain report
    // offering `import Option` for a module already in scope.
    expect(messages([
      ["/main.hex",
        "module Main\n\n" + "export record Box = {n: Int}\n" +
        "honor Option.Describe<Box> =\n    describe(value) = \"b\"\n"],
    ])).toEqual(["unknown constraint `Option.Describe`"]);
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

/**
 * §5.1 rule 1's **first test**: the reporting module's own default alias — its
 * declared name's last segment (Modules §3.1).
 *
 * No alias binds a module's own name inside it, so a module cannot qualify
 * through itself, and the seat is tested ahead of every branch below for two
 * reasons that meet here. The companion idiom puts a same-spelled *type* in
 * scope in exactly this module, so the type branch would fire on the ordinary
 * case; and the repair every branch below names is an import, which written
 * here is `import Point` inside `module Point` — §8.1's one-node cycle.
 */
describe("a module does not qualify through itself (§5.1 rule 1, §3.1)", () => {
  test("the qualifier is dropped, and the message quotes the call's own arguments", () => {
    const text = "module Point\n\n" +
      "export let make(x: Float, y: Float): Float = x + y\n" +
      "export let one: Float = Point.make(1.0, 0.0)\n";
    const [diagnostic, ...rest] = compileFiles([["/point.hex", text]]).diagnostics;
    expect(diagnostic?.message)
      .toBe("a module does not qualify through itself; write `make(1.0, 0.0)`");
    // Never `import Point`, at the message or at the edit.
    expect(diagnostic?.message).not.toContain("import");
    expect(rest).toEqual([]);
    expect(applied(text, diagnostic)).toBe(
      "module Point\n\n" +
        "export let make(x: Float, y: Float): Float = x + y\n" +
        "export let one: Float = make(1.0, 0.0)\n",
    );
    expect(messages([["/point.hex", applied(text, diagnostic)]])).toEqual([]);
  });

  test("a head binder holding the spelling takes the sentence and no repair", () => {
    // §5.1: the edit is carried only where the bare spelling, read *at that
    // use*, names the module's own binding. Here `two` is the parameter, so
    // dropping the qualifier would silently name it — a repair that changes
    // what the program means is worse than no repair.
    const [diagnostic, ...rest] = compileFiles([["/shapes.hex",
      "module Shapes\n\n" +
      "export let two: Float = 2.0\n" +
      "export fun grow(two: Float): Float = Shapes.two * two\n",
    ]]).diagnostics;
    expect(diagnostic?.message).toBe("a module does not qualify through itself");
    expect(diagnostic?.fixes).toBeUndefined();
    expect(rest).toEqual([]);
  });

  test("the module's own layer, and not the prelude's, is what the repair reads", () => {
    // `show` is a prelude name in bare scope, and this module declares none of
    // its own — so there is nothing here to drop the qualifier onto, and the
    // sentence stands alone rather than rewriting to a prelude spelling.
    const [diagnostic, ...rest] = compileFiles([["/point.hex",
      "module Point\n\n" + 'export let one: String = Point.show(1)\n',
    ]]).diagnostics;
    expect(diagnostic?.message).toBe("a module does not qualify through itself");
    expect(diagnostic?.fixes).toBeUndefined();
    expect(rest).toEqual([]);
  });

  test("the seat is the declared name's **last segment**", () => {
    // `module Render.Geometry`'s default alias is `Geometry` (§3.1), so that is
    // the spelling this rule tests — and `Render.` is not it.
    expect(messages([["/geo.hex",
      "module Render.Geometry\n\n" +
      "export let scale: Float = 1.0\n" +
      "export let twice: Float = Geometry.scale * 2.0\n",
    ]])).toEqual(["a module does not qualify through itself; write `scale`"]);
  });

  test("it holds in type position too, and drops the qualifier there", () => {
    const text = "module Point\n\n" + "export type Meters = Float\n" +
      "export let one: Point.Meters = 1.0\n";
    const [diagnostic, ...rest] = compileFiles([["/point.hex", text]]).diagnostics;
    expect(diagnostic?.message)
      .toBe("a module does not qualify through itself; write `Meters`");
    expect(rest).toEqual([]);
    expect(applied(text, diagnostic)).toBe(
      "module Point\n\n" + "export type Meters = Float\n" +
        "export let one: Meters = 1.0\n",
    );
  });

  test("the constraint seat takes the same sentence, the same repair and the same edit", () => {
    // §5.1 names this seat among the ones the obligation covers ("the
    // constraint seats whose rows Constraints §8 sends here"), and §10's row
    // 531 says the drop is carried "*at any seat*". The seats below are the
    // checker's, not the resolver's — a binder's obligation and an `honor` head
    // are resolved there — so a report that stopped at the sentence here would
    // be rule 1 implemented at three of its four seats.
    const text = "module Scale\n\n" +
      "export constraint Scale<a> =\n    s(x: a): a\n" +
      "export fun go<a: Scale.Scale>(x: a): a = x\n";
    const [diagnostic, ...rest] = compileFiles([["/scale.hex", text]]).diagnostics;
    expect(diagnostic?.message).toBe("a module does not qualify through itself; write `Scale`");
    // Never `import Scale` inside `module Scale` — §8.1's one-node cycle.
    expect(diagnostic?.message).not.toContain("import");
    expect(rest).toEqual([]);
    expect(applied(text, diagnostic)).toBe(
      "module Scale\n\n" +
        "export constraint Scale<a> =\n    s(x: a): a\n" +
        "export fun go<a: Scale>(x: a): a = x\n",
    );
    // The dropped form is a program, which is what makes the drop the repair
    // §5.1 owes rather than a second way of writing the complaint.
    expect(messages([["/scale.hex", applied(text, diagnostic)]])).toEqual([]);
  });

  test("— and the drop reads the module's OWN constraint layer, not everything in scope", () => {
    // The condition, from its failing side: `#constraintNames` holds every
    // spelling the module can name, imports included, and that is not what §5.1
    // asks about. `Scale` here is reached through an import, so the bare
    // spelling at this use names another module's declaration and the sentence
    // stands alone.
    const [diagnostic, ...rest] = compileFiles([
      SCALE,
      ["/other.hex",
        "module Other\n\n" + "import Scale\n" +
        "export fun go<a: Other.Scale>(x: a): a = x\n"],
    ]).diagnostics;
    expect(diagnostic?.message).toBe("a module does not qualify through itself");
    expect(diagnostic?.fixes).toBeUndefined();
    expect(rest).toEqual([]);
  });

  test("the edit deletes the qualification as written, spacing and all", () => {
    // `Scale . Scale` normalizes to the same eleven characters in the resolved
    // spelling, so an edit measured from the *text* would leave `. Scale`
    // behind. The range travels from the parser instead, which is the only
    // reader that saw both names.
    const text = "module Scale\n\n" +
      "export constraint Scale<a> =\n    s(x: a): a\n" +
      "export fun go<a: Scale . Scale>(x: a): a = x\n";
    const [diagnostic] = compileFiles([["/scale.hex", text]]).diagnostics;
    expect(applied(text, diagnostic)).toBe(
      "module Scale\n\n" +
        "export constraint Scale<a> =\n    s(x: a): a\n" +
        "export fun go<a: Scale>(x: a): a = x\n",
    );
  });

  test("an import may still bind the spelling to another module", () => {
    // §3.1: `import Render.Point` inside `module Point` collides with nothing,
    // and `Point.` then means what it imports — so this rule fires only where
    // *nothing* binds the alias.
    expect(messages([
      ["/render.hex", "module Render.Point\n\n" + "export let origin: Float = 0.0\n"],
      ["/point.hex",
        "module Point\n\n" + "import Render.Point\n" +
        "export let zero: Float = Point.origin\n"],
    ])).toEqual([]);
  });
});

/**
 * §5.1's refused-head suppression, read **positionally**: "a refused import
 * head that offers the same line by its own rewrite is that line already
 * offered, and **the seats below it** carry none".
 *
 * *Below it* is the whole condition. A use above the head is not a seat the
 * head repairs — the alias its rewrite binds would sit under that use, where
 * §3's top-down half refuses it again — so the head offers that reader nothing
 * and the seat owes them its own line. Membership alone reads the sentence as
 * "anywhere in the module", which takes the repair away from a seat for a
 * reason nothing on the reader's screen states.
 */
describe("a refused head suppresses the seats below it, and only those", () => {
  /** A module with a plain function, reached only by an import line. */
  const GEOMETRY = [
    "/geometry.hex",
    "module Geometry\n\n" + "export fun area(r: Float): Float = r * r\n",
  ] as const;

  test("a use above the head keeps its edit; the same use below loses it", () => {
    const above = "module Main\n\n" +
      "export let a: Float = Geometry.area(2.0)\n" + "import geometry\n";
    const below = "module Main\n\n" +
      "import geometry\n" + "export let a: Float = Geometry.area(2.0)\n";
    const seatOf = (text: string) =>
      compileFiles([GEOMETRY, ["/main.hex", text]]).diagnostics
        .find(({ message }) => message.startsWith("no module alias"));

    // Same message either way — the line is named at both, because it is the
    // line either reader needs.
    expect(seatOf(above)?.message).toBe("no module alias `Geometry`; `import Geometry`");
    expect(seatOf(below)?.message).toBe("no module alias `Geometry`; `import Geometry`");

    expect(seatOf(below)?.fixes).toBeUndefined();
    // And the edit the upper seat keeps lands above itself, which is the whole
    // reason it is owed one: the head's own rewrite would bind the alias below.
    expect(applied(above, seatOf(above))).toBe(
      "module Main\n\n" + "import Geometry\n" +
        "export let a: Float = Geometry.area(2.0)\n" + "import geometry\n",
    );
  });

  test("the constraint seat reads the head the same way, from either side", () => {
    // The two passes must agree about one module's heads: the suppression lives
    // on the `ImportRepairs` they share, so this is the checker asking the same
    // question the resolver asked above.
    const above = "module Main\n\n" +
      "export fun go<a: Scale.Scale>(x: a): a = x\n" + "import scale\n";
    const below = "module Main\n\n" +
      "import scale\n" + "export fun go<a: Scale.Scale>(x: a): a = x\n";
    const seatOf = (text: string) =>
      compileFiles([SCALE, ["/main.hex", text]]).diagnostics
        .find(({ message }) => message.startsWith("no module alias"));

    expect(seatOf(below)?.fixes).toBeUndefined();
    expect(applied(above, seatOf(above))).toBe(
      "module Main\n\n" + "import Scale\n" +
        "export fun go<a: Scale.Scale>(x: a): a = x\n" + "import scale\n",
    );
  });
});

/**
 * §5.1 rule 1's **contested** repair clause (Packages §3.3), at the pass.
 *
 * Two visible packages have to provide the written name and the resolving one
 * must provide neither, and the package set is `{project, Hex}` until the host
 * slice that reads installed packages lands — so no program that can be written
 * today reaches this arm through `compileProject`. It is reached here instead,
 * by handing `resolve` the answer `resolveModuleName` will hand it the day a
 * dependency is in the set: the arm is a function of that answer and of nothing
 * else, so this is the whole of what there is to pin.
 */
describe("a contested spelling names every full one, and offers no edit", () => {
  function reportOf(repair: ImportRepair | undefined): Diagnostics.Diagnostic {
    const text = "module Main\n\n" + "export let n: Float = Geometry.area(2.0)\n";
    const file = new Source.File(Source.fileId(0), "/main.hex", text);
    const resolved = resolve(parse(applyLayout(lex(file))), {
      text,
      ...(repair === undefined ? {} : { importRepair: () => repair }),
    });
    const [only, ...rest] = resolved.diagnostics;
    expect(rest).toEqual([]);
    return only!;
  }

  test("every provider is named, in the order the resolution gave them", () => {
    const report = reportOf({
      kind: "Contested",
      fullNames: ["Acme.Geometry", "Hex.Geometry"],
    });
    expect(report.message).toBe(
      "no module alias `Geometry`; `import Acme.Geometry` or `import Hex.Geometry`",
    );
    // No edit: the compiler cannot choose, and a repair that picked one would be
    // the rank Packages §3.3 refuses to make.
    expect(report.fixes).toBeUndefined();
  });

  test("three providers are three spellings, none elided", () => {
    expect(
      reportOf({
        kind: "Contested",
        fullNames: ["Acme.Geometry", "Bolt.Geometry", "Hex.Geometry"],
      }).message,
    ).toBe(
      "no module alias `Geometry`; `import Acme.Geometry`, `import Bolt.Geometry`, " +
        "or `import Hex.Geometry`",
    );
  });

  test("the resolving arm names one line and carries the edit", () => {
    const report = reportOf({ kind: "Resolved", fullName: "Hex.Geometry" });
    expect(report.message).toBe("no module alias `Geometry`; `import Geometry`");
    expect(report.fixes?.[0]?.edits[0]?.replacement).toBe("import Geometry\n");
  });

  test("no answer at all is the report with no repair clause", () => {
    const report = reportOf(undefined);
    expect(report.message).toBe("no module alias `Geometry`");
    expect(report.fixes).toBeUndefined();
  });
});
