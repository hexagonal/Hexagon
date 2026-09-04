import { describe, expect, test } from "vitest";

import { compileFiles, projectDiagnostics, runMain, runProject } from "../support/test-project.js";

/**
 * Conformance for the binders a parameterized `honor` head introduces (#390).
 *
 * The ruling in one sentence: the head declares its own binders, and the
 * `<...>` prefix exists only to constrain them. So `honor Iterable<Bag(a)>` is
 * the canonical unconstrained spelling, `honor<a: Eq> Eq<Pair(a, b)>` is a
 * lawful partial prefix, `honor<a> Iterable<Bag(a)>` stays legal without being
 * canonical, and a declared binder the head never mentions is refused.
 *
 * Binder-less heads compiled before this — by accident, not by rule. The
 * subject's own elaboration minted their variables into the live binder map
 * *after* the registration loop had run, so those variables reached neither
 * `#quantified` nor `#honorBinderVariables`, and `#checkInstanceHead`'s
 * head-lawfulness law was gated on the prefix being non-empty and so never ran
 * for them at all. Two heads no law was watching are pinned below as
 * regressions: `Pair(a, a)` and `Box(Int)` both compiled clean on `main`.
 *
 * `Bag(String)` where `Bag(Int)` would read the same is deliberate throughout:
 * with `Int` elements a *skipped* discharge leaves the loop variable
 * unconstrained and numeric defaulting lands it on `Int`, so the test passes
 * for the wrong reason.
 */

const messagesOf = (files: readonly (readonly [string, string])[]): readonly string[] =>
  compileFiles(files).diagnostics.map(({ message }) => message);

const HEAD_LAW =
  "a parameterized instance head must be a nominal constructor applied once to each distinct instance parameter";

/**
 * Nothing, since #353 — and the emptiness is the point rather than an
 * economy. These fixtures declared their own `Iterable` because the compiler
 * held none; `stdlib/Iterable.hex` is a prelude member now, so the name is
 * simply in scope and a source redeclaration is refused (Constraints §5.1.1).
 * Kept as a binding rather than deleted at each site so that what every test
 * below pins — the *head's* binders, and nothing about where the declaration
 * comes from — is visibly unchanged from when they were written.
 */
const iterable = "";

/** The canonical spelling: no prefix, the head binds `a`. */
const bag = "record Bag(a) = {items: Vector(a)}\n" +
  "\n" +
  "honor Iterable<Bag(a)> =\n" +
  "    type Item = a\n" +
  "    toSeq(bag) = Vector.toSeq(bag.items)\n" +
  "\n";

const pair = "record Pair(a, b) = {left: a, right: b}\n";

const sh = "constraint Sh<a> =\n" +
  "    sh(x: a): String\n";

describe("the head introduces its own binders", () => {
  test("a binder-less parameterized instance checks", () => {
    expect(projectDiagnostics(iterable + bag)).toEqual([]);
  });

  test("`for` over a Bag(String) discharges through the binder-less instance", async () => {
    // End to end: evidence selection, the `Item` projection instantiating to
    // `String`, and the emitted dictionary. `++` is `Concat<String>`, so a
    // projection that failed to instantiate could not type this body.
    const main = await runMain(iterable + bag +
      "export fun run(ignored: Int): String =\n" +
      "    var out = \"\"\n" +
      "    for word in Bag({items = [\"a\", \"b\", \"c\"]})\n" +
      "        out := out ++ word\n" +
      "    out\n");
    expect((main["run"] as (ignored: number) => string)(0)).toBe("abc");
  });

  test("the projection at Bag(String) is String, so summing it is refused", () => {
    // The negative half of the same fact: this diagnostic exists only if `Item`
    // really instantiated to `String` at the use.
    expect(projectDiagnostics(iterable + bag +
      "fun total(bag: Bag(String)): Int =\n" +
      "    var sum = 0\n" +
      "    for number in bag\n" +
      "        sum := sum + number\n" +
      "    sum\n")).toContain("type mismatch: expected Int, found String");
  });

  test("a bare prefix stays legal, though it is no longer canonical", () => {
    expect(projectDiagnostics(iterable +
      "record Bag(a) = {items: Vector(a)}\n" +
      "\n" +
      "honor<a> Iterable<Bag(a)> =\n" +
      "    type Item = a\n" +
      "    toSeq(bag) = Vector.toSeq(bag.items)\n")).toEqual([]);
  });

  test("a head binder is a real binder, so the body's requirement names the header", () => {
    // The registration this pins: a head-minted variable that is in
    // `#honorBinderVariables` and carries an empty declared-constraint list
    // gets §4.1's `honor`-header rewrite. Before #390 it was in neither, so the
    // requirement went unrefused, defaulting settled the variable on `Int`, and
    // the report blamed an annotation the source does not contain:
    // "`a` is a declared type variable, but the body requires `Int`; change the
    // annotation to `Int`, or remove it to let the type be inferred".
    expect(projectDiagnostics("module Main\n\n" + "record Box(a) = {value: a}\n" + sh +
        "honor Sh<Box(a)> =\n" +
        "    sh(x) = Show.show(x.value)\n",
    )).toEqual([
      "`a` is declared without constraints, but the body requires `Show`; " +
        "write `<a: Show>` on the `honor` header",
    ]);
  });
});

describe("the head-lawfulness law runs without a prefix (the regressions)", () => {
  test("a repeated head variable is refused", () => {
    // Compiles clean on `main`: one variable in two argument positions, so a
    // single `Pair` instance answered for every `Pair(t, t)` and for nothing
    // else, with no law consulted.
    expect(projectDiagnostics(pair + sh +
      "honor Sh<Pair(a, a)> =\n" +
      '    sh(x) = "b"\n')).toEqual([HEAD_LAW]);
  });

  test("a concrete head argument is refused", () => {
    // Also clean on `main`. `#instanceKey` keys on the head *constructor*, so a
    // ground argument is a promise coherence cannot keep.
    expect(projectDiagnostics("module Main\n\n" + "record Box(a) = {value: a}\n" + sh +
        "honor Sh<Box(Int)> =\n" +
        '    sh(x) = "b"\n',
    )).toEqual([HEAD_LAW]);
  });

  test("a prefixed head is still held to the same shape", () => {
    // The law's older half, unchanged: dropping the count-against-the-prefix
    // clause must not drop the shape clause with it.
    expect(projectDiagnostics(pair + sh +
      "honor<a> Sh<Pair(a, a)> =\n" +
      '    sh(x) = "b"\n')).toEqual([HEAD_LAW]);
  });
});

describe("the prefix exists to constrain, so a partial prefix is legal", () => {
  const constrained = pair +
    "honor<a: Show> Sh<Pair(a, b)> =\n" +
    "    sh(x) = Show.show(x.left)\n";

  test("`honor<a: Show> Sh<Pair(a, b)>` checks", () => {
    // Refused before #390 by the count clause (one declared, two in the head).
    expect(projectDiagnostics(sh + constrained)).toEqual([]);
  });

  test("the constrained binder's evidence reaches the member at a concrete use", async () => {
    const main = await runMain(sh + constrained +
      "export fun run(ignored: Int): String =\n" +
      "    sh(Pair({left = \"L\", right = 1}))\n");
    expect((main["run"] as (ignored: number) => string)(0)).toBe("L");
  });

  test("the unconstrained head binder really is unconstrained", () => {
    // `b` is bound by the head and nothing more, so a body that requires
    // anything of it is refused with the header rewrite — the same fixit the
    // declared binders get, which is the whole claim that they are one kind of
    // thing.
    expect(projectDiagnostics(sh + pair +
      "honor<a: Show> Sh<Pair(a, b)> =\n" +
      "    sh(x) = Show.show(x.right)\n")).toEqual([
      "`b` is declared without constraints, but the body requires `Show`; " +
        "write `<b: Show>` on the `honor` header",
    ]);
  });

  test("a declared binder absent from the head is refused", () => {
    // Before #390 this drew the shape message, which described a head that is
    // not what is wrong here.
    expect(projectDiagnostics(sh + pair +
      "honor<c: Show> Sh<Pair(a, b)> =\n" +
      '    sh(x) = "b"\n')).toEqual([
      "instance binder `c` does not appear in the head; a binder exists to " +
        "constrain one of the head's type variables — remove it, or spell the " +
        "head with `c`",
    ]);
  });
});

describe("an implied type binding sees the head's binders and nothing more", () => {
  test("`type Item = a` names the head's own `a`", () => {
    expect(projectDiagnostics(iterable + bag)).toEqual([]);
  });

  test("a name the binding itself would mint is still refused (§5.3)", () => {
    // #388's closed set, under #390's minting: pre-minting the head's variables
    // must not turn `#storeInstanceImpliedTypes`'s mint detection off.
    expect(projectDiagnostics(iterable +
      "record Bag(a) = {items: Vector(a)}\n" +
      "\n" +
      "honor Iterable<Bag(a)> =\n" +
      "    type Item = b\n" +
      "    toSeq(bag) = Vector.toSeq(bag.items)\n")).toContain(
      "`b` is not one of this instance's binders; an implied type " +
        "binding may mention only in-scope type names and the instance's own binders",
    );
  });
});

describe("the binder-less instance crosses the module boundary", () => {
  // The module alias reaches `Bag`; no import binds a bare name at all now
  // (#762), so there is no question of `Iterable` colliding with the
  // name-only pre-registration — and the instance travels with its subject
  // regardless, which is exactly the seeding path under test.
  const library = ["/bags.hex", iterable.replace("constraint", "export constraint") +
    "export record Bag(a) = {items: Vector(a)}\n" +
    "\n" +
    "honor Iterable<Bag(a)> =\n" +
    "    type Item = a\n" +
    "    toSeq(bag) = Vector.toSeq(bag.items)\n"] as const;

  test("an importer's `for` over Bag(String) discharges against the imported instance", async () => {
    const main = await runProject([
      library,
      ["/main.hex", "module Main\n\n" + "import Bags\n" +
        "\n" +
        "export fun run(ignored: Int): String =\n" +
        "    var out = \"\"\n" +
        "    for word in Bags.Bag({items = [\"x\", \"y\"]})\n" +
        "        out := out ++ word\n" +
        "    out\n"],
    ]);
    expect((main["run"] as (ignored: number) => string)(0)).toBe("xy");
  });

  test("the imported projection at Bag(String) is String, not defaulted", () => {
    expect(messagesOf([
      library,
      ["/main.hex", "module Main\n\n" + "import Bags\n" +
        "\n" +
        "fun total(bag: Bags.Bag(String)): Int =\n" +
        "    var sum = 0\n" +
        "    for number in bag\n" +
        "        sum := sum + number\n" +
        "    sum\n"],
    ])).toContain("type mismatch: expected Int, found String");
  });

  test("the importer is not blamed for the instance it imported", () => {
    // `report` is false on the seeding path, and the minting must not open a
    // new channel for home-module facts to be re-reported here: the whole
    // project is silent, not merely free of the messages this file names.
    expect(messagesOf([
      library,
      ["/main.hex", "module Main\n\n" + "import Bags\n" +
        "\n" +
        "export fun joined(bag: Bags.Bag(String)): String =\n" +
        "    var out = \"\"\n" +
        "    for word in bag\n" +
        "        out := out ++ word\n" +
        "    out\n"],
    ])).toEqual([]);
  });
});
