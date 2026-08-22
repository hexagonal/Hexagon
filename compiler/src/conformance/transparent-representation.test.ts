import { describe, expect, test } from "vitest";

import { compileFiles, projectDiagnostics, runProject } from "../support/test-project.js";

/**
 * Conformance for **transparent representations travelling with the type**
 * (Modules §4.2, §13 test (l); Products §3.2; #587).
 *
 * §4.2's sole-authority paragraph: outside `opaque`, "a record's fields are open
 * **wherever the type reaches**", and type-directed access — `p.x`,
 * `{p with x = e}`, the bare copy `{...p}` — "asks only what the receiver's type
 * is". Whether the accessing module imported the declaration, in any form or at
 * all, changes nothing. It is the same law Method Syntax §4.2 states for the
 * dot's operation set, which #585 enforced (`dot-companion-index.test.ts`), with
 * the representation as its second client.
 *
 * The defect was the same starved table, one judgment over: the field row came
 * from `module.records`, which holds what the *importer's* text put there. A
 * nominal that arrives as an imported function's result type — its home module
 * in the graph by reachability, its name written nowhere in the call site — was
 * in that listing not at all, so the row was empty and the checker refused the
 * access while enumerating nothing: "`Crate` has fields , not `n`".
 *
 * Both halves of #587 are pinned here, and they are separate claims:
 *
 * - the **reach**, which is the ruling — the fields are visible, and so are
 *   update and the bare copy, exactly as they are one import line away;
 * - the **renderer**, which was malformed no matter which way the ruling went —
 *   "an empty field enumeration is malformed output, never a compiler sentence",
 *   and a record with no fields at all is a legal declaration, so the empty case
 *   needed a sentence rather than a repair that made it merely unreachable.
 *
 * What the ruling deliberately does *not* move is pinned beside it, because a
 * reach implemented by leaking the declaration into the importer's scope would
 * pass every test in the first group and none in the last three: imports carry
 * **names**, so the constructor stays lexically scoped; `opaque` is the one
 * carve and is untouched; and Pattern Matching §2.4's nominal wall still stands
 * in front of a bare record pattern.
 *
 * Fixtures deliberately differ in their record names, their fields and their
 * numbers: two modules that emit byte-identical JavaScript share one ESM `data:`
 * module instance in the test linker, which would quietly make two programs one.
 */

/** Every message the project reported, in order. */
function messages(files: readonly (readonly [string, string])[]): readonly string[] {
  return compileFiles(files).diagnostics.map(({ message }) => message);
}

/**
 * #587's fixture, verbatim from the issue and from Modules §13(l): the home
 * module, and the intermediary that is the only module naming it.
 */
const CRATE = [
  ["/crate.hex", "export record Crate = {n: Float}\n"],
  ["/mid.hex",
    'import { Crate } from "./crate"\n' +
    "export fun make(value: Float): Crate = Crate({n = value})\n"],
] as const;

/** The call site: `mid` and nothing else, and `Crate` written nowhere. */
const FIXTURE = [
  ...CRATE,
  ["/main.hex",
    'import { make } from "./mid"\n' +
    "export let out: Float = make(1.5).n\n"],
] as const;

describe("the field reaches through a home module the call site never imported (#587)", () => {
  test("the filed refusal is gone: `make(1.5).n` typechecks", () => {
    // Measured on the issue as "`Crate` has fields , not `n`" — the empty
    // enumeration and the refusal in one sentence.
    expect(messages(FIXTURE)).toEqual([]);
  });

  test("— and it is the `Float` the declaration says, read back from the run", async () => {
    // The annotation is `Float`, so a checker that answered with an error node
    // would have unified with it and typed this program too. Only the value
    // says the access landed on the field.
    expect((await runProject(FIXTURE))["out"]).toBe(1.5);
  });

  test("the module-import spelling agrees, as it must", () => {
    expect(messages([...CRATE, ["/main.hex",
      'import module M from "./mid"\n' +
      "export let out: Float = M.make(1.5).n\n"]])).toEqual([]);
  });

  test("importing the declaration too changes nothing — §4.2's own sentence", () => {
    // Not merely "this compiles": the claim is that the import line is not part
    // of the judgment, so the arrangement with the import and the arrangement
    // without it are compared, and both are silent.
    expect(messages([...CRATE, ["/main.hex",
      'import { Crate } from "./crate"\n' +
      'import { make } from "./mid"\n' +
      "export let out: Float = make(1.5).n\n"]])).toEqual([]);
  });

  test("two hops from the home module, and it makes no difference", async () => {
    // §4.2 grounds the reach on the compiler being whole-program — "the home
    // module is in the graph by reachability of the type" — which is a claim
    // about the graph rather than about one edge. `/main.hex` imports
    // `/relay.hex` and nothing else, and `/keg.hex` is two edges away.
    //
    // Every module between still names the type, because that is not the thing
    // under test: an exported signature must be complete (§4.1.1), so an
    // intermediary that returns a `Keg` writes `Keg`. What no module between
    // can do is hand the fields along or hold them back — that is the sentence
    // about intermediary re-abstraction, and it is why depth changes nothing.
    const files = [
      ["/keg.hex", "export record Keg = {litres: Float}\n"],
      ["/mid.hex",
        'import { Keg } from "./keg"\n' +
        "export fun tap(value: Float): Keg = Keg({litres = value})\n"],
      ["/relay.hex",
        'import { Keg } from "./keg"\n' +
        'import { tap } from "./mid"\n' +
        "export fun relay(value: Float): Keg = tap(value * 2.0)\n"],
      ["/main.hex",
        'import { relay } from "./relay"\n' +
        "export let out: Float = relay(3.0).litres\n"],
    ] as const;

    expect(messages(files)).toEqual([]);
    expect((await runProject(files))["out"]).toBe(6);
  });

  test("a parameterized record travels with its arguments substituted", async () => {
    // The row is elaborated against fresh parameters and then substituted, the
    // same way the importer's own row always was; a reach that skipped the
    // substitution would type `held` as the declaration's `a` rather than as
    // this occurrence's `String`, and the annotation below would refuse it.
    const files = [
      ["/carton.hex", "export record Carton(a) = {held: a, tag: Int}\n"],
      ["/pack.hex",
        'import { Carton } from "./carton"\n' +
        'export fun pack(value: String): Carton(String) = Carton({held = value, tag = 7})\n'],
      ["/main.hex",
        'import { pack } from "./pack"\n' +
        'export let out: String = pack("cargo").held\n'],
    ] as const;

    expect(messages(files)).toEqual([]);
    expect((await runProject(files))["out"]).toBe("cargo");
  });
});

describe("update and the bare copy travel with it too (#587)", () => {
  // §4.2 names all three type-directed forms in one breath, so all three are
  // pinned: a repair that reached only `p.x` would leave `{p with}` refusing
  // "record update cannot add fields" against a row it could not see, which is
  // the same defect wearing a second message.
  const CASK = [
    ["/cask.hex", "export record Cask = {volume: Float}\n"],
    ["/fill.hex",
      'import { Cask } from "./cask"\n' +
      "export fun fill(value: Float): Cask = Cask({volume = value})\n" +
      "export fun volumeOf(value: Cask): Float = value.volume\n"],
  ] as const;

  test("`{p with f = e}` on a transitively reached record", async () => {
    const files = [...CASK, ["/main.hex",
      'import { fill, volumeOf } from "./fill"\n' +
      "export let out: Float =\n" +
      "    let base = fill(1.0)\n" +
      "    volumeOf({base with volume = 4.0})\n"]] as const;

    expect(messages(files)).toEqual([]);
    expect((await runProject(files))["out"]).toBe(4);
  });

  test("the bare copy `{...p}`, and the structural value it produces", async () => {
    // Products §5.3's crossing, from a module with no name for the type: the
    // copy is structural, so the destructure §4.2 points at — "in a module
    // without the name, the destructure spelling is `let {n} = {...v}`" — is
    // the one spelling that reads a field out by pattern here.
    const files = [...CASK, ["/main.hex",
      'import { fill } from "./fill"\n' +
      "export let out: Float =\n" +
      "    let copied = {...fill(2.0)}\n" +
      "    let {volume} = copied\n" +
      "    volume\n"]] as const;

    expect(messages(files)).toEqual([]);
    expect((await runProject(files))["out"]).toBe(2);
  });
});

describe("the missing-field diagnostic names the fields it knows (#587)", () => {
  test("§13(l)'s second line: `make(1.5).m` names `n`", () => {
    // The message family is Products §3.2's — "name the known fields" — and it
    // is the *same* sentence the importing module has always got. The empty
    // enumeration was this message with nothing to enumerate.
    expect(messages([...CRATE, ["/main.hex",
      'import { make } from "./mid"\n' +
      "export let out: Float = make(1.5).m\n"]])).toEqual([
      "`Crate` has fields `n`, not `m`",
    ]);
  });

  test("— and the module that imported the declaration gets it word for word", () => {
    expect(messages([...CRATE, ["/main.hex",
      'import { Crate } from "./crate"\n' +
      'import { make } from "./mid"\n' +
      "export let out: Float = make(1.5).m\n"]])).toEqual([
      "`Crate` has fields `n`, not `m`",
    ]);
  });
});

describe("an empty field enumeration is unprintable (#587, half one)", () => {
  // The ruling makes the *starved* row unreachable, but not the genuinely empty
  // one: `record Empty = {}` is a legal declaration, so "has fields , not `x`"
  // still had a caller. `missingFieldMessage` answers it with a sentence of its
  // own, and writes the enumerating clause only inside the arm that has already
  // taken a first name off the list — so there is no path that renders the join
  // of nothing.
  test("a nominal record with no fields refuses in words", () => {
    expect(projectDiagnostics(
      "record Hollow = {}\n" +
      "let empty = Hollow({})\n" +
      "let reading = empty.depth\n",
    )).toEqual(["`Hollow` has no fields, so it has no field `depth`"]);
  });

  test("the structural empty row keeps the sentence it already had", () => {
    // Unmoved: the two arms now share one renderer, and this is the pin that
    // says the sharing did not reword the arm that was already correct.
    expect(projectDiagnostics("let reading = {}.depth\n"))
      .toEqual(["the empty record has no field `depth`"]);
  });

  test("a non-empty structural row keeps its wording too", () => {
    expect(projectDiagnostics("let reading = {a = 1, b = 2}.c\n"))
      .toEqual(["record has fields `a`, `b`, not `c`"]);
  });
});

describe("imports still carry names: the constructor does not leak (#587)", () => {
  // The load-bearing negatives. §4.2 is explicit that "imports carry *names* —
  // the constructor among them, so construction and constructor patterns want
  // the name in scope like any name", and a reach implemented by putting the
  // declaration into the importer's symbol table would silently make all three
  // of these compile.
  test("construction still wants `Crate` in scope", () => {
    expect(messages([...CRATE, ["/main.hex",
      'import { make } from "./mid"\n' +
      "export let out: Float = Crate({n = 1.0}).n\n"]])).toEqual([
      "unknown name `Crate`",
    ]);
  });

  test("a constructor pattern still wants it too", () => {
    // A weaker pin than it looks, and deliberately kept: a *record* constructor
    // pattern refuses with "unknown constructor" in the home module too, so the
    // form §4.2 calls the nominal record's eliminator is not one the resolver
    // knows anywhere yet. What this pins is only that the reach did not put
    // `Crate` into a namespace it was not in before — which is the thing a
    // repair by symbol-table injection would break, and it would break it here
    // first.
    expect(messages([...CRATE, ["/main.hex",
      'import { make } from "./mid"\n' +
      "export fun reading(): Float =\n" +
      "    let Crate(r) = make(1.5)\n" +
      "    r.n\n"]])).toEqual([
      "unknown constructor `Crate`",
      "unknown name `r`",
    ]);
  });

  test("and so does the type name in an annotation", () => {
    expect(messages([...CRATE, ["/main.hex",
      'import { make } from "./mid"\n' +
      "export fun reading(value: Crate): Float = value.n\n"]])).toEqual([
      "unknown type `Crate`",
    ]);
  });
});

describe("opacity is the one carve, and it is unaffected (#587)", () => {
  // The half the ruling explicitly keeps: "the only 'representation not visible
  // here' refusal is the opaque one, which names the home module". This case
  // was *also* answering with the empty enumeration before the repair — the
  // visibility predicate read `undefined` declaration as visible — so it is a
  // fix in its own right and not merely a control.
  const SEALED = [
    ["/vaulted.hex",
      "export opaque record Ingot = {grams: Float}\n" +
      "export fun cast(value: Float): Ingot = Ingot({grams = value})\n" +
      "export fun weigh(value: Ingot): Float = value.grams\n"],
    ["/foundry.hex",
      'import { Ingot, cast, weigh } from "./vaulted"\n' +
      "export fun forge(value: Float): Ingot = cast(value)\n" +
      "export fun weighed(value: Ingot): Float = weigh(value)\n"],
  ] as const;

  test("a transitively reached opaque record refuses field access by name", () => {
    expect(messages([...SEALED, ["/main.hex",
      'import { forge } from "./foundry"\n' +
      "export let out: Float = forge(1.5).grams\n"]])).toEqual([
      "cannot access field `grams` of opaque record `Ingot`; use an operation " +
      "exported by its home module",
    ]);
  });

  test("— and refuses the update, with the update's own message", () => {
    expect(messages([...SEALED, ["/main.hex",
      'import { forge, weighed } from "./foundry"\n' +
      "export fun heavier(): Float =\n" +
      "    let bar = forge(1.5)\n" +
      "    weighed({bar with grams = 2.0})\n"]])).toEqual([
      "cannot update opaque record `Ingot`; use an operation exported by its home module",
    ]);
  });

  test("the home module still sees its own", () => {
    expect(messages([...SEALED, ["/main.hex", "export let n: Int = 1\n"]])).toEqual([]);
  });
});

describe("the nominal wall still stands in front of a bare record pattern (#587)", () => {
  test("a nominal scrutinee refuses `{n}` — Pattern Matching §2.4", () => {
    // §4.2 says so in the same breath as the reach: "a nominal record's pattern
    // eliminator is the constructor pattern". Opening the representation is not
    // opening the pattern.
    //
    // *(The refusal was the raw unification mismatch until #591 built the
    // eliminator; now that there is a spelling to send the reader to, §2.4's
    // redirect is what fires. The wall is the same wall — the diagnostic just
    // stopped being the unifier's own report of it.)*
    expect(messages([...CRATE, ["/main.hex",
      'import { make } from "./mid"\n' +
      "export fun reading(): Float =\n" +
      "    let {n} = make(1.5)\n" +
      "    n\n"]])).toEqual([
      "`Crate` is a nominal record; destructure it with `Crate({n})`",
    ]);
  });
});

describe("emission asks the representation for nothing (#587)", () => {
  test("a field access adds no import — the fields are POJO properties", () => {
    // The contrast with #585 is the point. A companion *operation* reached the
    // same way is a name the emitted file must import (Method Syntax §8.2, and
    // `javascript.companionOperationImports` is where it says so); a field is a
    // property of the value already in hand, so the emitted `/main.hex` names
    // `./mid.js` and nothing else. A repair that had routed the row through the
    // operation channel would show up here as a spurious `./crate.js`.
    const main = compileFiles(FIXTURE).modules
      .find(({ source }) => source.path === "/main.hex")!;

    expect(main.javascript.text).not.toContain("./crate.js");
    expect(main.javascript.companionOperationImports).toEqual([]);
    expect(main.javascript.text).toContain('import { make } from "./mid.js";');
    expect(main.javascript.text).toContain("make(1.5).n");
  });
});
