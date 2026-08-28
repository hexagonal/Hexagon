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
        "import { Badge } from \"./badge\"",
        "import { Token } from \"./token\"",
        "",
        "export fun go(t: Token): String = mark(t)",
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
        "import { Badge, Token } from \"./kit\"",
        "",
        "export fun go(t: Token): String = mark(t)",
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
    expect(messagesOf([
      ["/widget.hex", [
        "export record Widget = {size: Int}",
        "",
      ].join("\n")],
      ["/main.hex", [
        "import { Widget } from \"./widget\"",
        "",
        "export fun go(w: Widget): String = show(w)",
        "",
      ].join("\n")],
    ])).toEqual([
      "type `Widget` has no `Show` instance; it could only be declared in " +
        "`./widget.hex` (declares `Widget`) or the module declaring `Show`",
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
        "import { Badge } from \"./badge\"",
        "",
        "export fun go(n: Int): String = mark(n)",
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
        "import { Big } from \"./scales\"",
        "",
        "export record Ounce = {drams: Int}",
        "",
        "honor Big<Ounce> =",
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
        "import { admit } from \"./gatekeeper\"",
        "",
        "export record Badge = {serial: Int}",
        "",
        "export fun go(b: Badge): String = admit(b)",
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
        "import { Face } from \"./seal\"",
        "",
        "export record Panel = {width: Int}",
        "",
        "honor Face<Panel> =",
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
        "import { Face } from \"./seal\"",
        "",
        "export record Panel = {width: Int}",
        "",
        "honor Face<Panel> =",
        "    face(p) = \"panel\"",
        "",
      ].join("\n")],
    ]);

    expect(message).not.toContain("./main.hex");
    expect(message).not.toContain("could only be declared");
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
        "import { Badge } from \"./badge\"",
        "",
        "export fun go(p: (Int, Int)): String = mark(p)",
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
        "import { Badge } from \"./badge\"",
        "",
        "export fun go(f: ((Int) -> Int)): String = mark(f)",
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
