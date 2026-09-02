import { describe, expect, test } from "vitest";

import { compileFiles, projectDiagnostics } from "../support/test-project.js";

/**
 * Conformance for Modules §7.6's **diagnostic obligation** — the legal-homes
 * clause on a missing-instance report (#287, #633).
 *
 * The orphan rule (Constraints §5.3) makes "where could this instance live?" a
 * closed question with at most two answers: the module declaring the constraint,
 * and the module declaring the type. §7.6 obliges the report to name them, "so
 * the fix is a lookup, never a search" — and to name them *honestly*: a home is
 * offered as a seat only where the honor could be written in project source, a
 * prelude or compiler-supplied home is stated as fact, and where no offerable
 * home remains the report says the pair is closed rather than inventing a fixit
 * the reader cannot perform.
 *
 * **The head is Constraints §8's, not §7.6's.** §7.6's exemplar opens "no
 * `Ord<Config>` instance is in the program"; the unsatisfied-constraint row of
 * Constraints §8 owns the head shape ("`T` has no `Ord` instance"), and the
 * corpus's pins read it. What §7.6 obliges is the *clause*, and that is what
 * this file pins. Adjudicated once, here, rather than left for each reader.
 *
 * The Collections Part 5 §3.3 loop-head report is untouched and still wins where
 * it fires (`iterable-module.test.ts` owns it); this file pins the boundary.
 */

const messagesOf = (files: readonly (readonly [string, string])[]): readonly string[] =>
  compileFiles(files).diagnostics.map(({ message }) => message);

describe("the ordinary branch: both homes named, offerable ones offered", () => {
  test("two project homes are two paths, each with what it declares", () => {
    expect(messagesOf([
      ["/badge.hex", [
        "export constraint Badge<a> =",
        "    mark(subject: a): String",
        "",
      ].join("\n")],
      ["/token.hex", [
        "export record Token = {serial: Int}",
        "",
      ].join("\n")],
      ["/main.hex", [
        "import Badge from \"./badge\"",
        "import Token from \"./token\"",
        "",
        "export fun go(t: Token.Token): String = Badge.mark(t)",
        "",
      ].join("\n")],
    ])).toEqual([
      "type `Token` has no `Badge` instance; it could only be declared in " +
        "`./token.hex` (declares `Token`) or `./badge.hex` (declares `Badge`)",
    ]);
  });

  test("one home when they coincide — the file is named once, for both", () => {
    // §7.6's parenthesis: "the two legal homes (or the one home when they
    // coincide)". Naming `./kit.hex` twice would read as two places to look.
    expect(messagesOf([
      ["/kit.hex", [
        "export constraint Badge<a> =",
        "    mark(subject: a): String",
        "",
        "export record Token = {serial: Int}",
        "",
      ].join("\n")],
      ["/main.hex", [
        "import Kit from \"./kit\"",
        "",
        "export fun go(t: Kit.Token): String = Kit.mark(t)",
        "",
      ].join("\n")],
    ])).toEqual([
      "type `Token` has no `Badge` instance; it could only be declared in " +
        "`./kit.hex`, which declares both `Token` and `Badge`",
    ]);
  });

  test("a prelude constraint is stated as fact; the subject's home is offered", () => {
    // The asymmetry §7.6 spells out, and the one the §3.3 loop-head report
    // already kept: `./widget.hex` is a file the reader can open and write the
    // honor in, and `Show`'s home is not. Naming it with a path would offer a
    // repair in the prelude.
    //
    // `Show` is derivable, and `Widget` has a `derives` seat, so §7.6's
    // derivation fixit is appended here (#644 — `derivation-fixit.test.ts` owns
    // the family). The clause is untouched: at `Show` both homes may still hold
    // a hand-written honor, so the fixit is the cheaper repair beside them, not
    // a replacement for them.
    expect(messagesOf([
      ["/widget.hex", [
        "export record Widget = {size: Int}",
        "",
      ].join("\n")],
      ["/main.hex", [
        "import Widget from \"./widget\"",
        "",
        "export fun go(w: Widget.Widget): String = show(w)",
        "",
      ].join("\n")],
    ])).toEqual([
      "type `Widget` has no `Show` instance; it could only be declared in " +
        "`./widget.hex` (declares `Widget`) or the module declaring `Show`" +
        "; add `derives Show` to the declaration of `Widget`",
    ]);
  });

  test("a primitive subject keeps its one writable home: the constraint's", () => {
    // Constraints §5.3: a primitive's home is its fixed prelude companion, so
    // `honor Badge<Int>` is legal in exactly two files and only one of them is
    // the user's. That one is offered; the companion is stated (#287).
    expect(messagesOf([
      ["/badge.hex", [
        "export constraint Badge<a> =",
        "    mark(subject: a): String",
        "",
      ].join("\n")],
      ["/main.hex", [
        "import Badge from \"./badge\"",
        "",
        "export fun go(n: Int): String = Badge.mark(n)",
        "",
      ].join("\n")],
    ])).toEqual([
      "type `Int` has no `Badge` instance; it could only be declared in " +
        "`./badge.hex` (declares `Badge`) or `Int`'s prelude companion module",
    ]);
  });
});

describe("the closed pair: no offerable home, so no honor offered", () => {
  test("a prelude constraint at a primitive says the honored set is closed", () => {
    // Both legal homes sit outside project source. §7.6: "an impossible fixit
    // would be worse than none" — the actionable content is the two exits that
    // need no instance at all.
    expect(projectDiagnostics("export fun gap(a: Nat, b: Nat): Nat = a - b\n")).toEqual([
      "type `Nat` has no `Signed` instance; its only legal homes are the module " +
        "declaring `Signed` and `Nat`'s prelude companion module, both outside project " +
        "source, so this pair's honored set is closed — change the type, or go through " +
        "the operations those homes export",
    ]);
  });

  test("no `honor` and no file path appear in a closed-pair report", () => {
    // The negative half, pinned rather than assumed: the closed branch must not
    // leak the offering vocabulary of the branch above it.
    const [message] = projectDiagnostics("export fun gap(a: Nat, b: Nat): Nat = a - b\n");

    expect(message).not.toContain("honor ");
    expect(message).not.toContain(".hex");
    expect(message).not.toContain("could only be declared");
  });
});

describe("unexported is what licenses the sealed branch, not un-imported", () => {
  /**
   * §7.6's justification for naming the declaring module alone is that the
   * constraint is **unexported** — "reachable there by no import or alias". An
   * exported constraint the reporting module merely never imported is one
   * `import` away, so the subject's own module *is* a writable home and the
   * ordinary template is right.
   *
   * The distinction is not academic: taking the sealed branch here would deny
   * the home that works and direct the reader at one that cannot work, because
   * `./units.hex` can only name `Siren` by importing `./main.hex`, which §7.3's
   * acyclic-import rule forbids on this graph. §7.6 files this shape under its
   * discoverability *residue* (bullet (a)), never under the sealed branch.
   */
  test("an exported constraint this module never imported takes the ordinary branch", () => {
    expect(messagesOf([
      ["/units.hex", [
        "export constraint Loud<a> =",
        "    shout(subject: a): String",
        "",
      ].join("\n")],
      ["/middle.hex", [
        "import Units from \"./units\"",
        "",
        "export fun banner<a: Units.Loud>(subject: a): String = Units.shout(subject)",
        "",
      ].join("\n")],
      ["/main.hex", [
        "import Middle from \"./middle\"",
        "",
        "export record Siren = {pitch: Int}",
        "",
        "export fun run(): String = Middle.banner(Siren({pitch = 3}))",
        "",
      ].join("\n")],
    ])).toEqual([
      "type `Siren` has no `Loud` instance; it could only be declared in `./main.hex` " +
        "(declares `Siren`) or `./units.hex` (declares `Loud`)",
    ]);
  });

  test("an unexported constraint is still ordinary in the module that declares it", () => {
    // The other half of the pair: `Gate` is private, but *here* it is nameable,
    // so nothing is sealed away from this reader and the two homes stand.
    expect(messagesOf([
      ["/token.hex", [
        "export record Token = {serial: Int}",
        "",
      ].join("\n")],
      ["/gatekeeper.hex", [
        "import Token from \"./token\"",
        "",
        "constraint Gate<a> =",
        "    pass(subject: a): String",
        "",
        "export fun admit(t: Token.Token): String = pass(t)",
        "",
      ].join("\n")],
    ])).toEqual([
      "type `Token` has no `Gate` instance; it could only be declared in `./token.hex` " +
        "(declares `Token`) or `./gatekeeper.hex` (declares `Gate`)",
    ]);
  });
});

describe("the unnameable branch: the declaring module, alone (§7.6, #633)", () => {
  /**
   * Route (a) — a private **base** reached through an imported constraint's
   * declaration. `Tiny <- Small <- Big` with only `Big` exported (#287, and
   * `exported-constraints.test.ts` owns the chain's other properties).
   */
  test("a private middle link names its own module, never the subject's", () => {
    expect(messagesOf([
      ["/scales.hex", [
        "constraint Tiny<a> =",
        "    tiny(subject: a): String",
        "",
        "constraint Small<a: Tiny> =",
        "    small(subject: a): String",
        "",
        "export constraint Big<a: Small> =",
        "    big(subject: a): String",
        "",
      ].join("\n")],
      ["/main.hex", [
        "import Scales from \"./scales\"",
        "",
        "export record Ounce = {drams: Int}",
        "",
        "honor Scales.Big<Ounce> =",
        "    big(o) = \"ounce\"",
        "",
      ].join("\n")],
    ])).toEqual([
      "type `Ounce` has no `Small` instance; `Small` is not nameable here, so the " +
        "honor can only be written in `./scales.hex`, which declares it",
    ]);
  });

  /**
   * Route (b) — the **sealing idiom's gate**: a private constraint in an
   * exported binding's own constraint list (Modules §4.3, #626/#633). Nothing
   * unnameable lands in the consumer's hands; what the consumer can hit is this
   * refusal, and §7.6 owns it.
   */
  test("a private constraint gating an exported binding names its home", () => {
    expect(messagesOf([
      ["/gatekeeper.hex", [
        "constraint Gate<a> =",
        "    pass(subject: a): String",
        "",
        "export record Ticket = {serial: Int}",
        "",
        "honor Gate<Ticket> =",
        "    pass(t) = \"ticket\"",
        "",
        "export fun admit<a: Gate>(subject: a): String = pass(subject)",
        "",
      ].join("\n")],
      ["/main.hex", [
        "import Gatekeeper from \"./gatekeeper\"",
        "",
        "export record Badge = {serial: Int}",
        "",
        "export fun go(b: Badge): String = Gatekeeper.admit(b)",
        "",
      ].join("\n")],
    ])).toEqual([
      "type `Badge` has no `Gate` instance; `Gate` is not nameable here, so the " +
        "honor can only be written in `./gatekeeper.hex`, which declares it",
    ]);
  });

  /** Route (c) — a private **base of an exported constraint**, one hop (#633). */
  test("a sealed base of an exported constraint names its home", () => {
    expect(messagesOf([
      ["/seal.hex", [
        "constraint Sealed<a> =",
        "    seal(subject: a): String",
        "",
        "export constraint Face<a: Sealed> =",
        "    face(subject: a): String",
        "",
      ].join("\n")],
      ["/main.hex", [
        "import Seal from \"./seal\"",
        "",
        "export record Panel = {width: Int}",
        "",
        "honor Seal.Face<Panel> =",
        "    face(p) = \"panel\"",
        "",
      ].join("\n")],
    ])).toEqual([
      "type `Panel` has no `Sealed` instance; `Sealed` is not nameable here, so the " +
        "honor can only be written in `./seal.hex`, which declares it",
    ]);
  });

  test("the subject's own module is never offered as a seat here", () => {
    // The whole reason the two-home template is wrong for this branch: `/main.hex`
    // *is* a lawful home under the orphan rule, and the honor cannot be written
    // there, because no import or alias in it reaches the constraint's name.
    const [message] = messagesOf([
      ["/seal.hex", [
        "constraint Sealed<a> =",
        "    seal(subject: a): String",
        "",
        "export constraint Face<a: Sealed> =",
        "    face(subject: a): String",
        "",
      ].join("\n")],
      ["/main.hex", [
        "import Seal from \"./seal\"",
        "",
        "export record Panel = {width: Int}",
        "",
        "honor Seal.Face<Panel> =",
        "    face(p) = \"panel\"",
        "",
      ].join("\n")],
    ]);

    expect(message).not.toContain("./main.hex");
    expect(message).not.toContain("could only be declared");
  });

  /**
   * Sealed × **coincide** — the sealed analogue of "one home when they coincide",
   * and the one sealed shape whose repair needs no new import at all: `./gate.hex`
   * declares the constraint *and* the subject, so the honor can be written there
   * as it stands. The clause names that one module, which is what it always does
   * on this branch; the point of the pin is that the coinciding case is a record.
   */
  test("a sealed constraint whose subject shares its module names that module", () => {
    expect(messagesOf([
      ["/gate.hex", [
        "constraint Gate<a> =",
        "    pass(subject: a): String",
        "",
        "export record Ticket = {serial: Int}",
        "",
        "export fun admit<a: Gate>(subject: a): String = pass(subject)",
        "",
      ].join("\n")],
      ["/main.hex", [
        "import Gate from \"./gate\"",
        "",
        "export fun go(t: Gate.Ticket): String = Gate.admit(t)",
        "",
      ].join("\n")],
    ])).toEqual([
      "type `Ticket` has no `Gate` instance; `Gate` is not nameable here, so the honor " +
        "can only be written in `./gate.hex`, which declares it",
    ]);
  });

  /**
   * Sealed × the two nominal subjects the file had no sealed case for: a
   * **prelude-supplied** union and a **user** union. Both true — the subject's
   * own home is irrelevant on this branch, since it is the constraint that
   * cannot be named — and with the record cases already pinned above, every
   * sealed cell in the file is now a record.
   */
  test("a sealed constraint names its module at a prelude union and at a user union alike", () => {
    const gate = [
      "constraint Gate<a> =",
      "    pass(subject: a): String",
      "",
      "export fun admit<a: Gate>(subject: a): String = pass(subject)",
      "",
    ].join("\n");
    const sealed = (subject: string) =>
      `type \`${subject}\` has no \`Gate\` instance; \`Gate\` is not nameable here, ` +
      "so the honor can only be written in `./gate.hex`, which declares it";

    expect(messagesOf([
      ["/gate.hex", gate],
      ["/main.hex", [
        "import Gate from \"./gate\"",
        "",
        "export fun go(m: Option(Int)): String = Gate.admit(m)",
        "",
      ].join("\n")],
    ])).toEqual([sealed("Option(Int)")]);

    expect(messagesOf([
      ["/gate.hex", gate],
      ["/main.hex", [
        "import Gate from \"./gate\"",
        "",
        "export union Colour = Red | Green",
        "",
        "export fun go(c: Colour): String = Gate.admit(c)",
        "",
      ].join("\n")],
    ])).toEqual([sealed("Colour")]);
  });

  /**
   * §5.1.1's disambiguate-by-home remedy. The branch is right here — `./alpha.hex`'s
   * `Describe` is genuinely private — but "`Describe` is not nameable here" reads
   * as plainly false to a reader who has just written `constraint Describe` in
   * this very file. What they cannot name is the *declaration*; a constraint is
   * its declaration, and only the home module tells the two apart (#287's body
   * names this pairing: disambiguate by home, and name the legal homes).
   */
  test("a same-spelled local constraint gets the identity wording, not the name wording", () => {
    const messages = messagesOf([
      ["/alpha.hex", [
        "constraint Describe<a> =",
        "    describe(subject: a): String",
        "",
        "export fun render<a: Describe>(subject: a): String = describe(subject)",
        "",
      ].join("\n")],
      ["/main.hex", [
        "import Alpha from \"./alpha\"",
        "",
        "export constraint Describe<a> =",
        "    describe(subject: a): String",
        "",
        "export record Panel = {width: Int}",
        "",
        "honor Describe<Panel> =",
        "    describe(p) = \"panel\"",
        "",
        "export fun go(p: Panel): String = Alpha.render(p)",
        "",
      ].join("\n")],
    ]);

    expect(messages).toEqual([
      "type `Panel` has no `Describe` instance; the `Describe` required here is " +
        "`./alpha.hex`'s, not the one this module names; the honor can only be " +
        "written there",
    ]);
    // The claim the plain wording would have made, and which is false here.
    expect(messages.join("\n")).not.toContain("is not nameable here");
  });
});

describe("a structural subject has no home under either branch (§5.4, §9.3)", () => {
  /**
   * The sealed branch is scoped by §7.6's subject clause exactly as the ordinary
   * one is. Constraints §5.4/§9.3 refuse a structural instance head outright, so
   * `honor Gate<(Int, Int)>` is legal in *no* file — naming `./gate.hex` would be
   * an impossible fixit, which is the one thing §7.6 rules out by name.
   */
  test("a sealed constraint at a tuple subject still keeps the bare head", () => {
    expect(messagesOf([
      ["/gate.hex", [
        "constraint Gate<a> =",
        "    pass(subject: a): String",
        "",
        "export fun admit<a: Gate>(subject: a): String = pass(subject)",
        "",
      ].join("\n")],
      ["/main.hex", [
        "import Gate from \"./gate\"",
        "",
        "export fun go(p: (Int, Int)): String = Gate.admit(p)",
        "",
      ].join("\n")],
    ])).toEqual(["type `(Int, Int)` has no `Gate` instance"]);
  });

  test("a sealed constraint at a primitive subject keeps its clause — a primitive has a home", () => {
    // The boundary the fix must not overshoot: `honor Gate<Int>` in `./gate.hex`
    // is lawful (Constraints §5.3 gives `Int` a home, and the constraint's own
    // module is always a legal seat), so this one is genuinely directed.
    expect(messagesOf([
      ["/gate.hex", [
        "constraint Gate<a> =",
        "    pass(subject: a): String",
        "",
        "export fun admit<a: Gate>(subject: a): String = pass(subject)",
        "",
      ].join("\n")],
      ["/main.hex", [
        "import Gate from \"./gate\"",
        "",
        "export fun go(n: Int): String = Gate.admit(n)",
        "",
      ].join("\n")],
    ])).toEqual([
      "type `Int` has no `Gate` instance; `Gate` is not nameable here, so the honor " +
        "can only be written in `./gate.hex`, which declares it",
    ]);
  });
});

describe("what the clause does not reach", () => {
  test("a structural subject keeps the bare message — no home to name", () => {
    // §7.6 scopes the obligation to "subjects that have a declaring module to
    // name"; a tuple has none, so nothing is appended.
    expect(messagesOf([
      ["/badge.hex", [
        "export constraint Badge<a> =",
        "    mark(subject: a): String",
        "",
      ].join("\n")],
      ["/main.hex", [
        "import Badge from \"./badge\"",
        "",
        "export fun go(p: (Int, Int)): String = Badge.mark(p)",
        "",
      ].join("\n")],
    ])).toEqual(["type `(Int, Int)` has no `Badge` instance"]);
  });

  test("a function subject keeps its own message", () => {
    expect(messagesOf([
      ["/badge.hex", [
        "export constraint Badge<a> =",
        "    mark(subject: a): String",
        "",
      ].join("\n")],
      ["/main.hex", [
        "import Badge from \"./badge\"",
        "",
        "export fun go(f: ((Int) -> Int)): String = Badge.mark(f)",
        "",
      ].join("\n")],
    ])).toEqual(["functions have no `Badge` instance"]);
  });

  test("a literal-origin failure keeps the numeric-literal message", () => {
    // Numeric Literals §6 owns this seat, and §7.6's clause has no business on
    // it: the fault is the literal's type, not a missing home.
    expect(projectDiagnostics("export let flag: Bool = 1\n"))
      .toEqual(["integer literal cannot have type `Bool`"]);
  });

  test("the §3.3 loop-head report still wins at a user nominal", () => {
    // Collections Part 5 §3.3 is the more specific report and is untouched: it
    // already keeps the offering discipline §7.6 generalised.
    const messages = projectDiagnostics(
      "export record Bag = {size: Int}\n" +
        "export fun run(bag: Bag): Unit =\n" +
        "    for item in bag\n" +
        "        ()\n",
    );

    expect(messages.join("\n")).toContain("`Bag` is not iterable.");
    expect(messages.join("\n")).not.toContain("could only be declared");
  });
});
