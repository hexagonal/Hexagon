import { describe, expect, test } from "vitest";

import { compileFiles, projectDiagnostics, runProject } from "../support/test-project.js";

/**
 * Conformance for **the companion operation set's import-insensitivity**
 * (Method Syntax §4.2, §8.2; #585).
 *
 * §4.2 states the rule twice and in as many words: "No import adds or removes a
 * dot-callable operation", and the set "is import-insensitive… by construction".
 * The construction is `CompanionOf` (§4.1, Modules §7.2) — a nominal's
 * operations are its **home module's** exported subject-first declarations,
 * settled where the type is declared. The checker instead built the set from the
 * *importer's* symbol table, which holds whatever that module's imports happened
 * to carry, so the same call had two answers depending on which import line was
 * above it. That is exactly the "use-changes-methods spookiness" the sentence
 * says the design does not have.
 *
 * Two faces were measured, and both are pinned below in files of their own:
 *
 * - the **ordinary operation** — no constraint, no `widens`, one `export fun`
 *   whose first parameter is the record — refused with a message asserting that
 *   the companion exports no such operation, beside a companion that exported
 *   exactly it;
 * - the **widened member** — the honored member (coherence-keyed, and so
 *   correctly import-insensitive already) caught the dot alone and answered with
 *   the restriction's narrow seat, so a `Float` factor was refused against the
 *   constraint's `Int`.
 *
 * The prelude masked the whole defect for its own types: prelude symbols are
 * seeded into every module, so `(2.0).pow(0.5)` never noticed. The last suite
 * pins that control unmoved.
 *
 * Fixtures deliberately differ in their record names, their strings and their
 * numbers: two modules that emit byte-identical JavaScript share one ESM `data:`
 * module instance in the test linker, which would quietly make two programs one.
 */

/** Every message the project reported, in order. */
function messages(files: readonly (readonly [string, string])[]): readonly string[] {
  return compileFiles(files).diagnostics.map(({ message }) => message);
}

/**
 * The plainest exhibit there is: a record, one exported function taking it
 * first, and a call site that imported the *type* by name and nothing else.
 *
 * No constraint, no instance, no `widens` — nothing in this program but §4.2's
 * first clause. `Box({…}).double()` was refused here and accepted under
 * `import module`, which is the whole of #585 with every other mechanism
 * removed.
 */
const BOX = [
  "/box.hex",
  "export record Box = {n: Float}\n" +
    "export fun double(value: Box): Box = Box({n = value.n * 2.0})\n" +
    "export fun reading(value: Box): Float = value.n\n",
] as const;

/** The named-import call site, shared by the compile and the run below. */
const BOX_NAMED = [
  BOX,
  ["/main.hex",
    'import { Box, reading } from "./box"\n' +
    "export let out: Float = reading(Box({n = 1.5}).double())\n"],
] as const;

describe("the ordinary operation: one `export fun`, no constraint in sight (#585)", () => {
  test("a named import of the type alone reaches the companion's operation", () => {
    // The named import binds `Box` and `reading`; nothing in this file mentions
    // `double`. §4.2 says the dot reaches it anyway, because the set belongs to
    // `/box.hex`.
    expect(messages(BOX_NAMED)).toEqual([]);
  });

  test("— and the program runs, calling an operation it never imported", async () => {
    // Compiling is the smaller half (§8.2): the emitted file has to *import*
    // `double` from a module its source never named it in, or the call is a
    // `ReferenceError` after a clean compile. Read back, so a name that resolved
    // to nothing cannot pass.
    expect((await runProject(BOX_NAMED))["out"]).toBe(3);
  });

  test("the module-import spelling is the control, and it agrees", () => {
    // The spelling that always compiled. Compared against the named-import case
    // above rather than merely asserted clean: the claim is not "both work" but
    // "the import line does not decide", which is §4.2's sentence.
    expect(messages([
      BOX,
      ["/main.hex",
        'import module B from "./box"\n' +
        "export let out: Float = B.reading(B.Box({n = 1.5}).double())\n"],
    ])).toEqual([]);
  });
});

describe("the no-such-operation diagnostic tells the truth again (#585)", () => {
  test("a genuinely absent name still refuses, with the full three-clause message", () => {
    // The refusal itself is untouched: `Crate` has no `quadrupled` anywhere, and
    // every clause of §9's message is true of this program. Pinned beside the
    // now-compiling `Box.double` so that the repair is visibly a narrowing of
    // *when* the message fires and not a weakening of the message.
    expect(messages([
      ["/crate.hex",
        "export record Crate = {n: Float}\n" +
        "export fun tripled(value: Crate): Float = value.n * 3.0\n"],
      ["/main.hex",
        'import { Crate } from "./crate"\n' +
        "export let out: Float = Crate({n = 1.0}).quadrupled()\n"],
    ])).toEqual([
      "`Crate` has no field `quadrupled`, its companion exports no operation " +
      "`quadrupled`, and no constraint honored at `Crate` has a subject-first " +
      "member `quadrupled`; call an available subject-first function explicitly",
    ]);
  });

  test("the clause `its companion exports no operation` is now only said when true", () => {
    // The false clause was the defect's own voice. `/tin.hex` exports `flatten`
    // with a `Tin` first parameter, so the middle clause was a statement about
    // the companion that the companion contradicted — and the message was the
    // *only* thing the user could see, since the operation was one import line
    // away from working. No message at all is the pin.
    expect(messages([
      ["/tin.hex",
        "export record Tin = {depth: Float}\n" +
        "export fun flatten(value: Tin): Tin = Tin({depth = 0.0})\n" +
        "export fun depthOf(value: Tin): Float = value.depth\n"],
      ["/main.hex",
        'import { Tin, depthOf } from "./tin"\n' +
        "export let out: Float = depthOf(Tin({depth = 7.0}).flatten())\n"],
    ])).toEqual([]);
  });
});

/**
 * The issue's title case: a companion that **widens** a constraint member
 * (Constraints §4.7, #546) at a type an importer reaches by name.
 *
 * `/gauge.hex` declares the constraint with an `Int` factor; `/panel.hex`
 * declares `Panel`, widens the member to a `Float` factor, and honors the
 * constraint with `scale = widened`. Method Syntax §6.1's one-claimant carve
 * then gives the dot to the *companion operation* — the widest face — rather
 * than to the honored member, and the carve fires off the `widens` flag riding
 * the symbol. Starve the companion index and the member catches the dot alone,
 * which is how a `Float` factor came to be refused against an `Int` seat.
 */
const GAUGE = [
  "/gauge.hex",
  "export constraint Gauge<a> =\n    stretch(value: a, factor: Int): a\n",
] as const;

const PANEL = [
  "/panel.hex",
  'import module G from "./gauge"\n' +
    "export record Panel = {span: Float}\n" +
    "widens G.stretch(value: Panel, factor: Float): Panel = " +
    "Panel({span = value.span * factor})\n" +
    "honor G.Gauge<Panel> =\n    stretch = widened\n" +
    "export fun panel(span: Float): Panel = Panel({span = span})\n" +
    "export fun spanOf(value: Panel): Float = value.span\n" +
    "export let dotHere: Float = spanOf(Panel({span = 2.0}).stretch(1.5))\n" +
    "export let bareHere: Float = spanOf(stretch(Panel({span = 2.0}), 1.5))\n",
] as const;

/** The one call, written the three ways an importer can arrange its imports. */
const NAMED_ONLY = [
  GAUGE,
  PANEL,
  ["/main.hex",
    'import { Panel, spanOf } from "./panel"\n' +
    "export let out: Float = spanOf(Panel({span = 1.5}).stretch(2.5))\n"],
] as const;

describe("the widened member reached across a module boundary (#585)", () => {
  test("the home module's own dot and bare call are clean, as they always were", () => {
    // `/panel.hex`'s two module-level bindings are checked whenever the module
    // is compiled; nothing here imports it. The control that says the fixture's
    // widened body is well-formed before any importer is involved.
    expect(messages([GAUGE, PANEL, ["/main.hex", "export let n: Int = 1\n"]])).toEqual([]);
  });

  test("a named import of the type alone: the `Float` factor is accepted", () => {
    // The filed refusal was `type mismatch: expected Int, found Float` at this
    // exact call — the member's restriction answering, because the companion
    // operation was missing from the index and so lost §6.1's carve.
    expect(messages(NAMED_ONLY)).toEqual([]);
  });

  test("— under a module import, which is the spelling that always compiled", () => {
    expect(messages([
      GAUGE,
      PANEL,
      ["/main.hex",
        'import module P from "./panel"\n' +
        "export let out: Float = P.spanOf(P.panel(1.5).stretch(2.5))\n"],
    ])).toEqual([]);
  });

  test("— and under both import lines at once", () => {
    // The arrangement that made the defect unmistakable: adding an import that
    // the call does not use changed whether the call typechecked.
    expect(messages([
      GAUGE,
      PANEL,
      ["/main.hex",
        'import module P from "./panel"\n' +
        'import { Panel, spanOf } from "./panel"\n' +
        "export let out: Float = spanOf(Panel({span = 1.5}).stretch(2.5))\n"],
    ])).toEqual([]);
  });

  test("the qualified route through the companion is clean too", () => {
    // `P.stretch` is the `widens` binding itself — qualifiable, not a bare
    // export (Constraints §4.7) — so the qualified spelling and the dot are the
    // same call by §1, and both take the `Float`.
    expect(messages([
      GAUGE,
      PANEL,
      ["/main.hex",
        'import module P from "./panel"\n' +
        "export let out: Float = P.spanOf(P.stretch(P.panel(1.5), 2.5))\n"],
    ])).toEqual([]);
  });

  test("the widened body is what runs, factor and all", async () => {
    // The load-bearing read-back. A restriction that had somehow answered would
    // be `Int`-seated and could not have multiplied by 2.5 at all; 1.5 × 2.5 is
    // the widened body and nothing else.
    expect((await runProject(NAMED_ONLY))["out"]).toBe(3.75);
  });
});

describe("the adjacent non-defect stays refused (#585)", () => {
  test("the constraint module's own `stretch` is the member, and takes an `Int`", () => {
    // `G` aliases the *constraint's* home, whose `stretch` is the member
    // forwarder — the restriction, `Int`-seated by declaration. Refusing a
    // `Float` there is the design, recorded on the issue as not part of the
    // repair: nothing about the companion index reaches this spelling, and a
    // fix that made this compile would have widened a constraint member by
    // accident.
    expect(messages([
      GAUGE,
      PANEL,
      ["/main.hex",
        'import module G from "./gauge"\n' +
        'import { Panel } from "./panel"\n' +
        "export let out: Panel = G.stretch(Panel({span = 1.5}), 2.5)\n"],
    ])).toEqual(["type mismatch: expected Int, found Float"]);
  });
});

/**
 * §4.2's transitive claim, which is the half no import line can be added to
 * repair: "the compiler is whole-program; the home module is in the graph by
 * reachability of the type".
 *
 * `/main.hex` below imports `/depot.hex` and nothing else. `Barrel` arrives as
 * the *result type* of `stock`, its home module unnamed anywhere in the call
 * site's text — so its operations cannot come from anything this file imported,
 * and its `import { fill } from "./barrel.js"` is a dependency emission adds
 * (§8.2) rather than one the source wrote.
 */
const TRANSITIVE = [
  ["/barrel.hex",
    "export record Barrel = {litres: Float}\n" +
    "export fun fill(value: Barrel): Float = value.litres + 10.0\n"],
  ["/depot.hex",
    'import { Barrel } from "./barrel"\n' +
    "export fun stock(litres: Float): Barrel = Barrel({litres = litres})\n"],
  ["/main.hex",
    'import { stock } from "./depot"\n' +
    "export let out: Float = stock(4.0).fill()\n"],
] as const;

describe("a type whose home module the call site never imported at all (#585)", () => {
  test("the dot resolves through the result type's home module", () => {
    expect(messages(TRANSITIVE)).toEqual([]);
  });

  test("— and the emitted file imports the operation it was never given a name for", () => {
    // §8.2's own words: "the emitter adds whatever dependency the resolved
    // declaration's lowering requires — normally the companion's named import
    // under Modules §11". Pinned as an import of `./barrel.js` appearing in a
    // file whose source names `./depot` and nothing else.
    const main = compileFiles(TRANSITIVE).modules
      .find(({ source }) => source.path === "/main.hex")!;
    expect(main.javascript.text).toContain('from "./barrel.js"');
    expect(main.javascript.companionOperationImports).toEqual(["./barrel"]);
  });

  test("— and it runs", async () => {
    expect((await runProject(TRANSITIVE))["out"]).toBe(14);
  });
});

/**
 * The added import's second face: a **constrained** operation, whose exported
 * name is the internal trailing-evidence one (FFI Part 7 §7).
 *
 * `labelled` takes a `Show` bound, so `/bag.hex` publishes it as `__labelled`
 * and a caller supplies the dictionary after the written arguments. An import
 * synthesized under the plain spelling would bind nothing at all, so this is
 * where §8.2's "whatever dependency the resolved declaration's lowering
 * requires" has more than one answer — and both sides compute the spelling from
 * the exporter's own enumeration (`internalNameInputs`) rather than predicting
 * each other.
 */
const BAG = [
  ["/bag.hex",
    "export record Bag = {n: Int}\n" +
    'export fun labelled<a: Show>(value: Bag, extra: a): String = "${value.n}/${show(extra)}"\n'],
  ["/main.hex",
    'import { Bag } from "./bag"\n' +
    "export let out: String = Bag({n = 2}).labelled(7)\n"],
] as const;

describe("a constrained companion operation reached the same way (#585)", () => {
  test("the dot is clean and the evidence still travels", () => {
    expect(messages(BAG)).toEqual([]);
  });

  test("— the import binds the exporter's internal spelling, and the call runs", async () => {
    const main = compileFiles(BAG).modules.find(({ source }) => source.path === "/main.hex")!;
    expect(main.javascript.text).toContain('import { __labelled as labelled } from "./bag.js";');
    expect((await runProject(BAG))["out"]).toBe("2/7");
  });
});

describe("the prelude control, unmoved", () => {
  test("`(2.0).pow(0.5)` is clean, as it was before the index changed", () => {
    // The prelude never exhibited the defect — its symbols are seeded into every
    // module, so the importer's table already held the whole companion — which
    // is why this call worked throughout and why it is the control rather than a
    // repair. It is here so that a change to the nominal half that disturbed the
    // built-in and primitive channels would be visible.
    expect(projectDiagnostics("export let root: Float = (2.0).pow(0.5)\n")).toEqual([]);
  });
});
