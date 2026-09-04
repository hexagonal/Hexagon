import { describe, expect, test } from "vitest";

import { compileProject, Source } from "../index";
import { compileMain, projectDiagnostics, runMain } from "../support/test-project.js";

/**
 * Conformance for **the match catch expression** — `catch`'s second seat
 * (Exceptions §5.4, #500).
 *
 * The construct is one sentence: a `match` whose head begins its logical item
 * may take a `catch` clause at that head's column, after the arm block, and the
 * clause is in every respect §5.1's `catch`. Everything worth pinning follows
 * from the *window*: the emitted `try` covers the scrutinee's evaluation and
 * nothing else. So the tests below come in three groups.
 *
 * - **The window, executed.** A throw from the scrutinee reaches the clause; a
 *   throw from a data arm's guard or body, or from a catch arm's own body, does
 *   not. These are runtime observations on purpose — the composition
 *   `try (match …) catch` reads almost identically and has the *other*
 *   semantics, so only running the two apart tells them apart.
 * - **The two sections, each under its own law.** All bodies unify to one
 *   result type; the data arms alone carry the exhaustiveness demand; the catch
 *   arms carry §5.3's reachability and no exhaustiveness demand at all.
 * - **Attachment, by column and by item head.** Layout continues a `catch`
 *   after any item and stays agnostic (Lexer & Layout §2); the parser decides
 *   ownership, and every way of getting it wrong has its own §9 message.
 *
 * Plus the one new judgment the clause brings with it: a scrutinee that
 * provably cannot throw makes the whole clause dead (§5.4, Pattern Matching
 * §7.2), and the class is deliberately minimal enough that a call always
 * declines.
 *
 * The door of Exceptions §6 sits in this seat too (#509). The final group is
 * the foreign branch under all three arms that can reach it — `_`, a
 * domestic-only clause that must *not*, and `JsError(e)`, which binds the
 * thrown object itself. The door's own conformance is `js-error-door.test.ts`'s;
 * what this file owns is that the clause is in every respect §5.1's `catch`,
 * that arm included.
 */

/** A module that throws a declared exception, or does not, on demand. */
const preamble = "module Main\n\n" + "exception Boom(line: Int, message: String)\n" +
  "exception Late(message: String)\n" +
  "let source(fail: Bool): Option(Int) =\n" +
  "    if fail then throw(Boom(3, \"scrutinee\")) else Some(7)\n";

/** The `name` of whatever `call` threw, or `\"\"` when it returned. */
function thrownName(call: () => unknown): string {
  try {
    call();
  } catch (error) {
    return (error as { name?: string }).name ?? String(error);
  }
  return "";
}

describe("the clause parses, and is `try`'s catch in a second seat", () => {
  test("the spec's example: arms, then a `catch` at the match head's column", () => {
    const project = compileMain(
      preamble +
        "export let run(fail: Bool): Int =\n" +
        "    match source(fail)\n" +
        "        Some(n) => n\n" +
        "        None => 0\n" +
        "    catch\n" +
        "        Boom(line, _) => line\n",
    );

    expect(project.diagnostics.map(({ message }) => message)).toEqual([]);
    const main = project.modules.find(({ source }) => source.path === "/main.hex")!;
    const run = main.parsed.items.find(
      (item) => item.kind === "Let" && item.name.text === "run",
    );
    // The clause is a sibling of the arms on the one `Match` node, not a
    // wrapper around it: `catchArms` is where §5.4's second seat lives.
    expect(run).toMatchObject({
      kind: "Let",
      value: {
        kind: "Lambda",
        body: {
          kind: "Block",
          items: [{
            kind: "ExprItem",
            expression: {
              kind: "Match",
              scrutinee: { kind: "Call" },
              arms: [
                { pattern: { kind: "Constructor", name: { text: "Some" } } },
                { pattern: { kind: "Constructor", name: { text: "None" } } },
              ],
              catchArms: [
                { pattern: { kind: "Constructor", name: { text: "Boom" } } },
              ],
            },
          }],
        },
      },
    });
  });

  test("the clause takes the full catch grammar — guards, or-patterns, `as`", () => {
    expect(projectDiagnostics(
      preamble +
        "export let run(fail: Bool): Int =\n" +
        "    match source(fail)\n" +
        "        Some(n) => n\n" +
        "        None => 0\n" +
        "    catch\n" +
        "        Boom(line, _) when line > 1 => 1\n" +
        "        (Boom(_, _) | Late(_)) as caught => 2\n",
    )).toEqual([]);
  });

  test("a `match` without a clause is unchanged", () => {
    expect(projectDiagnostics(
      preamble +
        "export let run(fail: Bool): Int =\n" +
        "    match source(fail)\n" +
        "        Some(n) => n\n" +
        "        None => 0\n",
    )).toEqual([]);
  });
});

describe("the window covers the scrutinee's evaluation, and nothing else", () => {
  test("a throw from the scrutinee reaches the clause", async () => {
    const exports = await runMain(
      preamble +
        "export let run(fail: Bool): Int =\n" +
        "    match source(fail)\n" +
        "        Some(n) => n\n" +
        "        None => 0\n" +
        "    catch\n" +
        "        Boom(_, _) => 42\n",
    );

    const run = exports["run"] as (fail: boolean) => number;
    expect(run(false)).toBe(7);
    expect(run(true)).toBe(42);
  });

  test("a throw from a data arm's body propagates; the clause never sees it", async () => {
    const exports = await runMain(
      preamble +
        "export let run(fail: Bool): Int =\n" +
        "    match source(fail)\n" +
        "        Some(_) => throw(Late(\"from the data arm\"))\n" +
        "        None => 0\n" +
        "    catch\n" +
        "        Boom(_, _) => 1\n" +
        // The arm that would swallow it if the window covered the arms.
        "        Late(_) => 2\n",
    );

    const run = exports["run"] as (fail: boolean) => number;
    expect(thrownName(() => run(false))).toBe("Late");
  });

  test("a throw from a data arm's guard propagates too", async () => {
    const exports = await runMain(
      preamble +
        "let checked(n: Int): Bool = throw(Late(\"from the guard\"))\n" +
        "export let run(fail: Bool): Int =\n" +
        "    match source(fail)\n" +
        "        Some(n) when checked(n) => n\n" +
        "        _ => 0\n" +
        "    catch\n" +
        "        Late(_) => 2\n",
    );

    const run = exports["run"] as (fail: boolean) => number;
    expect(thrownName(() => run(false))).toBe("Late");
  });

  test("a throw from a catch arm's body propagates outward, as in `try`", async () => {
    const exports = await runMain(
      preamble +
        "export let run(fail: Bool): Int =\n" +
        "    match source(fail)\n" +
        "        Some(n) => n\n" +
        "        None => 0\n" +
        "    catch\n" +
        "        Boom(_, _) => throw(Late(\"from the catch arm\"))\n" +
        "        Late(_) => 2\n",
    );

    const run = exports["run"] as (fail: boolean) => number;
    expect(thrownName(() => run(true))).toBe("Late");
  });

  test("an unmatched exception is implicitly rethrown", async () => {
    const exports = await runMain(
      preamble +
        "export let run(fail: Bool): Int =\n" +
        "    match source(fail)\n" +
        "        Some(n) => n\n" +
        "        None => 0\n" +
        "    catch\n" +
        "        Late(_) => 2\n",
    );

    const run = exports["run"] as (fail: boolean) => number;
    expect(thrownName(() => run(true))).toBe("Boom");
  });

  test("the scrutinee is emitted once, so it is evaluated once", () => {
    const project = compileMain(
      preamble +
        "export let run(fail: Bool): Int =\n" +
        "    match source(fail)\n" +
        "        Some(n) => n\n" +
        "        None => 0\n" +
        "    catch\n" +
        "        Boom(_, _) => 0\n",
    );

    expect(project.diagnostics.map(({ message }) => message)).toEqual([]);
    const main = project.modules.find(({ source }) => source.path === "/main.hex")!;
    // The data arms read the binding the `try` filled, never the scrutinee
    // again: one occurrence of the call in the whole emitted module body.
    expect(main.javascript.text.split("source(fail)").length - 1).toBe(1);
  });
});

describe("typing and the two sections' laws", () => {
  test("every body — data arm and catch arm alike — unifies to one result type", () => {
    expect(projectDiagnostics(
      preamble +
        "export let run(fail: Bool): Int =\n" +
        "    match source(fail)\n" +
        "        Some(n) => n\n" +
        "        None => 0\n" +
        "    catch\n" +
        "        Boom(_, _) => \"recovered\"\n",
    )).toEqual(["type mismatch: expected Int, found String"]);
  });

  test("the data arms alone must be exhaustive; the clause discharges nothing", () => {
    expect(projectDiagnostics(
      preamble +
        "export let run(fail: Bool): Int =\n" +
        "    match source(fail)\n" +
        "        Some(n) => n\n" +
        "    catch\n" +
        "        Boom(_, _) => 0\n",
    )).toEqual(["match is missing cases: `None`"]);
  });

  test("the catch arms carry no exhaustiveness demand — the sum is open", () => {
    expect(projectDiagnostics(
      preamble +
        "export let run(fail: Bool): Int =\n" +
        "    match source(fail)\n" +
        "        Some(n) => n\n" +
        "        None => 0\n" +
        "    catch\n" +
        "        Boom(_, _) => 1\n",
    )).toEqual([]);
  });

  test("reachability inside the clause is §5.3's, unchanged: an arm after `_`", () => {
    expect(projectDiagnostics(
      preamble +
        "export let run(fail: Bool): Int =\n" +
        "    match source(fail)\n" +
        "        Some(n) => n\n" +
        "        None => 0\n" +
        "    catch\n" +
        "        _ => 1\n" +
        "        Boom(_, _) => 2\n",
    )).toEqual(["this catch arm is unreachable because an earlier arm catches everything"]);
  });

  test("a constructor already caught above is unreachable in the clause too", () => {
    expect(projectDiagnostics(
      preamble +
        "export let run(fail: Bool): Int =\n" +
        "    match source(fail)\n" +
        "        Some(n) => n\n" +
        "        None => 0\n" +
        "    catch\n" +
        "        Boom(_, _) => 1\n" +
        "        Boom(_, _) => 2\n",
    )).toEqual(["exception `Boom` is already caught above"]);
  });

  test("reachability is per-section: the sections never shadow each other", () => {
    // A `_` data arm covers the whole scrutinee type and a `_` catch arm covers
    // the whole open sum; neither makes the other unreachable, because the two
    // sets never compete for one evaluation.
    expect(projectDiagnostics(
      preamble +
        "export let run(fail: Bool): Int =\n" +
        "    match source(fail)\n" +
        "        _ => 1\n" +
        "    catch\n" +
        "        _ => 2\n",
    )).toEqual([]);
  });

  test("the `Exn`-scrutinee ban is untouched by the clause", () => {
    // Both reports, pinned as a decision rather than hidden behind a
    // `toContain`: the ban is the checker's, and the cannot-throw judgment runs
    // afterwards and independently, on an elaborated scrutinee that happens to
    // be a bare variable read. Two true statements about one line; neither
    // suppresses the other, and the ban is the one that names the fix.
    expect(projectDiagnostics(
      preamble +
        "export let run(error: Exn): Int =\n" +
        "    match error\n" +
        "        _ => 1\n" +
        "    catch\n" +
        "        Boom(_, _) => 2\n",
    )).toEqual([
      "match requires a closed type; exceptions are inspected with `try`/`catch`",
      "this `catch` can never run: evaluating error cannot throw",
    ]);
  });
});

describe("the cannot-throw judgment (§5.4; Pattern Matching §7.2)", () => {
  const clause = (scrutinee: string): string =>
    preamble +
    "export let run(o: Option(Int), n: Int, s: String): Int =\n" +
    `    match ${scrutinee}\n` +
    "        _ => 1\n" +
    "    catch\n" +
    "        Boom(_, _) => 2\n";

  test("fires on a bare variable read, quoting the scrutinee", () => {
    expect(projectDiagnostics(clause("o")))
      .toEqual(["this `catch` can never run: evaluating o cannot throw"]);
  });

  test("fires on an Int literal, whose elaboration erases to a primitive", () => {
    // Ascribed so the literal resolves — an unresolved `Num a => a` scrutinee
    // has no constructors to match on and dies of that first. The ascription
    // erases (Ascription §4), so the elaborated scrutinee is the bare `Number`
    // node the judgment reads, and its span is still the literal's.
    expect(projectDiagnostics(clause("(3 : Int)")))
      .toEqual(["this `catch` can never run: evaluating 3 cannot throw"]);
  });

  test("fires on a hole-free String literal", () => {
    expect(projectDiagnostics(clause("\"fixed\"")))
      .toEqual(["this `catch` can never run: evaluating \"fixed\" cannot throw"]);
  });

  test("fires on the `Unit` literal", () => {
    expect(projectDiagnostics(
      preamble +
        "export let run(ignored: Int): Int =\n" +
        "    match ()\n" +
        "        () => 1\n" +
        "    catch\n" +
        "        Boom(_, _) => 2\n",
    )).toEqual(["this `catch` can never run: evaluating () cannot throw"]);
  });

  test("fires on a Float literal", () => {
    // The judgment's own report, alone. *(#513.)* This list used to open with
    // "cannot match on `Float` yet" — a refusal no spec sentence licensed:
    // Pattern Matching §6.1 admits any scrutinee but its two permanent
    // exclusions, and §2.5 bans the Float *literal pattern* alone (the parser's
    // job, with its own guard fixit). The `_` arm here was always legal, so the
    // match now checks and the exact list is one entry — the point being
    // unchanged: a Float literal carries no elaboration evidence at all.
    expect(projectDiagnostics(clause("1.5"))).toEqual([
      "this `catch` can never run: evaluating 1.5 cannot throw",
    ]);
  });

  test("fires on a BigInt literal, which folds to a `kn` literal", () => {
    expect(projectDiagnostics(clause("3n"))).toEqual([
      "cannot match on `BigInt` yet",
      "this `catch` can never run: evaluating 3n cannot throw",
    ]);
  });

  test("fires on a nullary constructor — a plain reference, evidence-free", () => {
    expect(projectDiagnostics(
      preamble +
        "export let run(ignored: Int): Int =\n" +
        "    match None\n" +
        "        Some(n) => n\n" +
        "        None => 0\n" +
        "    catch\n" +
        "        Boom(_, _) => 2\n",
    )).toEqual(["this `catch` can never run: evaluating None cannot throw"]);
  });

  test("declines where a user `Num` instance's `fromNat` does the elaborating", () => {
    // The load-bearing decline. `3` at `Ratio` elaborates to a `ConvertNat`
    // calling this module's own `fromNat`, which is pure and may still throw:
    // its totality is a documented law of `Num`, not a checked property. The
    // judgment declines rather than lean on it.
    expect(projectDiagnostics("module Main\n\n" + "exception Boom(line: Int, message: String)\n" +
        "union Ratio = Whole(Int) | Part(Int, Int)\n" +
        "honor Num<Ratio> =\n" +
        "    add(left, right) = left\n" +
        "    multiply(left, right) = right\n" +
        "    fromNat(value) = Whole(value)\n" +
        "export let run(ignored: Int): Int =\n" +
        "    match (3 : Ratio)\n" +
        "        Whole(_) => 1\n" +
        "        Part(_, _) => 2\n" +
        "    catch\n" +
        "        Boom(_, _) => 3\n",
    )).toEqual([]);
  });

  test("declines on a call — no throw analysis reaches through one", () => {
    expect(projectDiagnostics(clause("source(True)"))).toEqual([]);
  });

  test("declines on an interpolated String: a hole runs a `Show` call", () => {
    expect(projectDiagnostics(clause("\"n is ${n}\""))).toEqual([]);
  });

  test("declines on a composite literal: its sub-expressions run arbitrary code", () => {
    expect(projectDiagnostics(clause("[n, n]"))).toEqual([]);
    expect(projectDiagnostics(clause("(n, s)"))).toEqual([]);
  });

  test("declines on an operator application, which is an evidence call", () => {
    expect(projectDiagnostics(clause("n + n"))).toEqual([]);
  });

  test("a bare variable scrutinee is fine without a clause", () => {
    expect(projectDiagnostics(
      preamble +
        "export let run(o: Option(Int)): Int =\n" +
        "    match o\n" +
        "        _ => 1\n",
    )).toEqual([]);
  });
});

describe("attachment: line-initial match heads only (§5.4, §9)", () => {
  test("`match e` followed directly by `catch` is the armless error", () => {
    expect(projectDiagnostics(
      preamble +
        "export let run(fail: Bool): Int =\n" +
        "    match source(fail)\n" +
        "    catch\n" +
        "        Boom(_, _) => 1\n",
    )).toContain("`match` requires at least one arm; to handle only exceptions, use `try`/`catch`");
  });

  test("a `catch` indented as a match arm gets the alignment fixit", () => {
    expect(projectDiagnostics(
      preamble +
        "export let run(fail: Bool): Int =\n" +
        "    match source(fail)\n" +
        "        Some(n) => n\n" +
        "        None => 0\n" +
        "        catch\n" +
        "            Boom(_, _) => 1\n",
    )).toEqual(["align `catch` with `match` to attach a catch clause"]);
  });

  test("a mid-line `match` head takes no clause: the two-branch alignment error", () => {
    expect(projectDiagnostics(
      preamble +
        "export let run(fail: Bool): Int =\n" +
        "    let x =\n" +
        "        let y = match source(fail)\n" +
        "            Some(n) => n\n" +
        "            None => 0\n" +
        "        catch\n" +
        "            Boom(_, _) => 1\n" +
        "        y\n" +
        "    x\n",
    )).toEqual([
      "a `catch` clause must align with a `match` that begins its line — align the " +
      "`catch` with the `match`'s column; if the `match` head is mid-line, move it " +
      "onto its own line",
    ]);
  });

  test("a `catch` at an enclosing item's column is the same alignment error", () => {
    // The `match` here does begin *its* line, but the `catch` is at the outer
    // `let`'s column, and that column belongs to the `let`.
    expect(projectDiagnostics(
      preamble +
        "export let run(fail: Bool): Int =\n" +
        "    let y =\n" +
        "        match source(fail)\n" +
        "            Some(n) => n\n" +
        "            None => 0\n" +
        "    catch\n" +
        "        Boom(_, _) => 1\n" +
        "    y\n",
    )).toEqual([
      "a `catch` clause must align with a `match` that begins its line — align the " +
      "`catch` with the `match`'s column; if the `match` head is mid-line, move it " +
      "onto its own line",
    ]);
  });

  test("the rewrap the fixit names — one indent — compiles", () => {
    expect(projectDiagnostics(
      preamble +
        "export let run(fail: Bool): Int =\n" +
        "    let y =\n" +
        "        match source(fail)\n" +
        "            Some(n) => n\n" +
        "            None => 0\n" +
        "        catch\n" +
        "            Boom(_, _) => 1\n" +
        "    y\n",
    )).toEqual([]);
  });

  /**
   * The three member blocks with loops of their own. Layout continues a `catch`
   * after an item in *any* block, so each of these can be handed one — and a
   * loop that does not ask reads the keyword as the start of its next member,
   * reports whatever that block's shape rule says, and truncates the module.
   * The pins are the message and the survival of what follows.
   */
  describe("a member block's own loop asks the same question", () => {
    const survives = (source: string): readonly string[] => {
      const project = compileMain("module Main\n\n" + source);
      const main = project.modules.find(({ source: file }) => file.path === "/main.hex")!;
      // The declaration after the offending block still compiled and emitted:
      // the report is local, not a cascade that eats the rest of the file.
      expect(main.javascript.text).toContain("const after = 1;");
      return project.diagnostics.map(({ message }) => message);
    };

    const alignment = "a `catch` clause must align with a `match` that begins its line — " +
      "align the `catch` with the `match`'s column; if the `match` head is mid-line, " +
      "move it onto its own line";

    test("an `honor` member block", () => {
      expect(survives(
        "exception Boom(line: Int)\n" +
          "record Ratio = {top: Int, bottom: Int}\n" +
          "honor Show<Ratio> =\n" +
          "    show(r) =\n" +
          "        match r.top\n" +
          "            _ => \"r\"\n" +
          "    catch\n" +
          "        Boom(_) => \"boom\"\n" +
          "export let after: Int = 1\n",
      )).toEqual([alignment]);
    });

    test("a `constraint` member block", () => {
      expect(survives(
        "exception Boom(line: Int)\n" +
          "constraint Sizey<a> =\n" +
          "    size(x: a): Int\n" +
          "    doubled(x: a): Int =\n" +
          "        match size(x)\n" +
          "            n => n\n" +
          "    catch\n" +
          "        Boom(_) => 0\n" +
          "export let after: Int = 1\n",
      )).toEqual([alignment]);
    });

    test("an `extern` block", () => {
      // At the *member* column, which is the one the extern loop itself reads.
      // The block's own "expected a newline or `;` between extern declarations"
      // complaint stands between the declaration and the loop top, so the
      // question has to be asked ahead of it — as `#parseItems` asks it — or
      // that complaint fires and synchronizes past the rest of the file.
      expect(survives(
        'extern from "m"\n' +
          "    fun f(): Int\n" +
          "    catch\n" +
          "        _ => 1\n" +
          "export let after: Int = 1\n",
      )).toEqual([alignment]);
    });

    test("a `catch` after an `extern` block, at the module's column", () => {
      // The same source one dedent out. This one never reaches the extern loop
      // — layout closes the block first, so it is `#parseItems`'s guard that
      // answers. Kept as the pair to the test above, which is the extern
      // loop's own.
      expect(survives(
        'extern from "m"\n' +
          "    fun f(): Int\n" +
          "catch\n" +
          "    _ => 1\n" +
          "export let after: Int = 1\n",
      )).toEqual([alignment]);
    });
  });

  test("`try` wins when it heads the item, even with a `match` body", async () => {
    // The composition, not the clause: this `try` wraps the arms too, so an
    // exception thrown *in a data arm* is caught here — the exact contrast
    // §5.4 exists to make available.
    const exports = await runMain(
      preamble +
        "export let run(fail: Bool): Int =\n" +
        "    try match source(fail)\n" +
        "        Some(_) => throw(Late(\"from the data arm\"))\n" +
        "        None => 0\n" +
        "    catch\n" +
        "        Late(_) => 2\n",
    );

    const run = exports["run"] as (fail: boolean) => number;
    expect(run(false)).toBe(2);
  });

  test("nested: an inner clause and an outer `try` both attach", async () => {
    const exports = await runMain(
      preamble +
        "export let run(fail: Bool): Int =\n" +
        "    try\n" +
        "        match source(fail)\n" +
        "            Some(_) => throw(Late(\"from the data arm\"))\n" +
        "            None => 0\n" +
        "        catch\n" +
        "            Boom(_, _) => 1\n" +
        "    catch\n" +
        "        Late(_) => 2\n",
    );

    const run = exports["run"] as (fail: boolean) => number;
    // The scrutinee threw: the inner clause has it.
    expect(run(true)).toBe(1);
    // The data arm threw: the inner clause is out of the window, the outer
    // `try` is not.
    expect(run(false)).toBe(2);
  });

  test("a clause attaches inside an arm body block, and two siblings coexist", async () => {
    // Each clause's scrutinee binding is a fresh generated name, so the two
    // `let`s can sit in sibling `case` bodies of one emitted `switch` without
    // redeclaring anything.
    const exports = await runMain(
      preamble +
        "export let run(outer: Bool, fail: Bool): Int =\n" +
        "    match outer\n" +
        "        True =>\n" +
        "            match source(fail)\n" +
        "                Some(n) => n\n" +
        "                None => 0\n" +
        "            catch\n" +
        "                Boom(line, _) => line\n" +
        "        False =>\n" +
        "            match source(fail)\n" +
        "                Some(n) => n * 2\n" +
        "                None => 0\n" +
        "            catch\n" +
        "                Boom(line, _) => line * 2\n",
    );

    const run = exports["run"] as (outer: boolean, fail: boolean) => number;
    expect([run(true, false), run(true, true), run(false, false), run(false, true)])
      .toEqual([7, 3, 14, 6]);
  });
});

describe("emission (§7.4's narrowed `try`)", () => {
  test("the emitted `try` wraps the scrutinee assignment and nothing else", () => {
    const project = compileMain(
      preamble +
        "export let run(fail: Bool): Int =\n" +
        "    match source(fail)\n" +
        "        Some(n) => n\n" +
        "        None => 0\n" +
        "    catch\n" +
        "        Boom(line, _) => line\n",
    );

    expect(project.diagnostics.map(({ message }) => message)).toEqual([]);
    const main = project.modules.find(({ source }) => source.path === "/main.hex")!;
    expect(main.javascript.text).toContain(
      [
        "const run = fail => {",
        "  let __scrutinee;",
        "  try {",
        "    __scrutinee = source(fail);",
        "  } catch (__error) {",
        "    if (__error != null && __error.$hex === \"Main\" && __error.name === \"Boom\") {",
        "      const line = __error.line;",
        "      return line;",
        "    }",
        "    throw __error;",
        "  }",
        "  switch (__scrutinee.tag) {",
        "    case \"Some\":",
        "      const n = __scrutinee.value;",
        "      return n;",
        "    case \"None\":",
        "      return 0;",
      ].join("\n"),
    );
  });

  test("an expression position takes the IIFE rung, with the same narrow `try`", () => {
    const project = compileMain(
      preamble +
        "export let first: Int =\n" +
        "    match source(False)\n" +
        "        Some(n) => n\n" +
        "        None => 0\n" +
        "    catch\n" +
        "        Boom(_, _) => 1\n",
    );

    expect(project.diagnostics.map(({ message }) => message)).toEqual([]);
    const main = project.modules.find(({ source }) => source.path === "/main.hex")!;
    expect(main.javascript.text).toContain(
      [
        "const first = (() => {",
        "  let __scrutinee;",
        "  try {",
        "    __scrutinee = source(false);",
        "  } catch (__error) {",
      ].join("\n"),
    );
  });

  test("a guarded clause emits its guard inside the JS catch, never in the `try`", () => {
    const project = compileMain(
      preamble +
        "export let run(fail: Bool): Int =\n" +
        "    match source(fail)\n" +
        "        Some(n) => n\n" +
        "        None => 0\n" +
        "    catch\n" +
        "        Boom(line, _) when line > 1 => 1\n",
    );

    expect(project.diagnostics.map(({ message }) => message)).toEqual([]);
    const main = project.modules.find(({ source }) => source.path === "/main.hex")!;
    const text = main.javascript.text;
    const tryBlock = text.slice(text.indexOf("try {"), text.indexOf("} catch ("));
    expect(tryBlock).toBe("try {\n    __scrutinee = source(fail);\n  ");
    expect(text).toContain("if (line > 1) {");
  });
});

describe("the foreign branch, where `JsError` sits (§6, §7.4)", () => {
  /** Minimal ESM linker: compiler-owned relative imports become data-URL modules. */
  function resolveModulePath(importer: string, specifier: string): string | undefined {
    if (!specifier.startsWith("./") && !specifier.startsWith("../")) return undefined;
    const directory = importer.slice(0, Math.max(0, importer.lastIndexOf("/")));
    const parts: string[] = [];
    for (const part of `${directory}/${specifier}`.split("/")) {
      if (part === "" || part === ".") continue;
      if (part === "..") parts.pop();
      else parts.push(part);
    }
    const path = `/${parts.join("/")}`;
    return path.endsWith(".js") ? `${path.slice(0, -3)}.hex` : path;
  }

  function link(
    javascript: string,
    importerPath: string,
    moduleUrls: ReadonlyMap<string, string>,
  ): string {
    return javascript.replace(
      /^(\s*import(?:[^;\n]*?\sfrom)?\s+)(["'])([^"']+)\2;/gmu,
      (statement, prefix: string, _quote: string, specifier: string) => {
        const target = resolveModulePath(importerPath, specifier) ?? specifier;
        const url = moduleUrls.get(target) ?? moduleUrls.get(specifier);
        return url === undefined ? statement : `${prefix}${JSON.stringify(url)};`;
      },
    );
  }

  /**
   * A `data:` URL is a module *identity*, so two runs whose emitted text is
   * byte-identical share one instantiated module. Each run is stamped.
   */
  let runTag = 0;

  async function run(
    source: string,
    foreign: Readonly<Record<string, string>>,
  ): Promise<Record<string, unknown>> {
    const project = compileProject([new Source.File(Source.fileId(0), "/main.hex", "module Main\n\n" + source)]);
    expect(project.diagnostics.map(({ message }) => message)).toEqual([]);
    runTag += 1;
    const url = (text: string): string =>
      `data:text/javascript;charset=utf-8,${encodeURIComponent(text)}#foreign${runTag}`;
    const moduleUrls = new Map<string, string>();
    for (const [specifier, text] of Object.entries(foreign)) moduleUrls.set(specifier, url(text));
    for (const module of project.modules) {
      moduleUrls.set(
        module.source.path,
        url(link(module.javascript.text, module.source.path, moduleUrls)),
      );
    }
    return (await import(/* @vite-ignore */ moduleUrls.get("/main.hex")!)) as Record<
      string,
      unknown
    >;
  }

  const foreign = {
    thrower: [
      "export function reading() {",
      "  throw new TypeError('from JavaScript');",
      "}",
    ].join("\n"),
  };

  test("a `_` arm in the clause catches a foreign throwable too", async () => {
    const exports = await run(
      'extern from "thrower"\n' +
        "    fun reading(): Option(Int)\n" +
        "\n" +
        "export let run(ignored: Int): Int =\n" +
        "    match reading!()\n" +
        "        Some(n) => n\n" +
        "        None => 0\n" +
        "    catch\n" +
        "        _ => 5\n",
      foreign,
    );

    expect((exports["run"] as (ignored: number) => number)(0)).toBe(5);
  });

  test("a domestic-only clause rethrows the original foreign value, unwrapped", async () => {
    const exports = await run(
      "exception Boom(message: String)\n" +
        'extern from "thrower"\n' +
        "    fun reading(): Option(Int)\n" +
        "\n" +
        "export let run(ignored: Int): Int =\n" +
        "    match reading!()\n" +
        "        Some(n) => n\n" +
        "        None => 0\n" +
        "    catch\n" +
        "        Boom(_) => 5\n",
      foreign,
    );

    const call = exports["run"] as (ignored: number) => number;
    let caught: unknown;
    try {
      call(0);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(TypeError);
    expect((caught as Error).message).toBe("from JavaScript");
  });

  /**
   * The door, in this seat (#509). The clause is §5.1's `catch` in every
   * respect, so the arm that *is* §7.4's foreign branch is written here exactly
   * as it is in a `try` — and it binds the thrown value itself, which is the
   * claim the two tests above could only approach from outside.
   */
  test("a `JsError(e)` arm in the clause reaches the foreign throwable", async () => {
    const exports = await run(
      'extern from "thrower"\n' +
        "    fun reading(): Option(Int)\n" +
        "\n" +
        "export let run(ignored: Int): String =\n" +
        "    match reading!()\n" +
        "        Some(n) => Int.show(n)\n" +
        "        None => \"none\"\n" +
        "    catch\n" +
        "        JsError(e) => JsError.message(e)\n",
      foreign,
    );

    expect((exports["run"] as (ignored: number) => string)(0)).toBe("from JavaScript");
  });

  /**
   * And the arm changes nothing about the window. The stage-1 binding it needs
   * sits in the JS `catch` beside the discrimination, so the `try` still wraps
   * the scrutinee's evaluation and nothing else — §5.4's whole observable
   * contract, re-checked against the one arm that adds a line to that block.
   */
  test("the arm adds nothing to the protected region", () => {
    const project = compileMain(
      preamble +
        "export let run(fail: Bool): String =\n" +
        "    match source(fail)\n" +
        "        Some(n) => Int.show(n)\n" +
        "        None => \"none\"\n" +
        "    catch\n" +
        "        JsError(e) => JsError.message(e)\n",
    );

    expect(project.diagnostics.map(({ message }) => message)).toEqual([]);
    const text = project.modules.find(({ source }) => source.path === "/main.hex")!.javascript.text;
    const tryBlock = text.slice(text.indexOf("try {"), text.indexOf("} catch ("));
    expect(tryBlock).toBe("try {\n    __scrutinee = source(fail);\n  ");
    expect(text).toContain(
      'const __foreign = __error == null || typeof __error.$hex !== "string";',
    );
  });
});
