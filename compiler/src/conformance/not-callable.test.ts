/**
 * Conformance for the not-callable report (#385).
 *
 * A call whose callee is known and is *not* a function used to be reported as
 * an ordinary type mismatch against a demanded arrow — "type mismatch: expected
 * String, found (?433) ->? ?434" — and the arrow's colour was the complaint:
 * a report whose subject is *this is not a function* has no business printing
 * `->?`, a spelling that reads as a demand for an effect-polymorphic function
 * when nothing about effects is at issue. Worse, the same call registered a
 * mark obligation, so a marked non-call collected a second report about a mark
 * it could not owe.
 *
 * The fix splits the call elaboration's final arm on the pruned callee:
 *
 * - a **type variable** — a callee not yet *known* to be a function, mutual
 *   recursion inside an SCC included — keeps the fresh-effect unify, which is
 *   what carries the neighbour's colour until its own body speaks (Effects
 *   §3.4, the monomorphic knot);
 * - a **concrete non-function** takes this file's dedicated report, registers no
 *   mark obligation, and types the call as the error type;
 * - an **already-errored** callee keeps falling through silently, so a name that
 *   already failed does not fail twice.
 */

import { describe, expect, test } from "vitest";

import { AnalysisSession } from "../analysis/session.js";
import { compileFiles } from "../support/test-project.js";

/**
 * Through `compileProject`, prelude included: a prelude-free harness cannot type
 * the `Int` and `String` these probes are written over (`test-project.ts`).
 */
function diagnostics(
  files: readonly (readonly [string, string])[],
): readonly string[] {
  return compileFiles(files).diagnostics.map(({ message }) => message);
}

/** The common single-module shape. */
const main = (source: string): readonly string[] => diagnostics([["/main.hex", source]]);

/** What a hover where `needle` is written shows as the type there. */
function hoveredType(source: string, needle: string): string | undefined {
  const session = new AnalysisSession();
  session.setFile("/main.hex", source);
  return session.hover("/main.hex", source.indexOf(needle))?.displayedType;
}

/**
 * A user-written extern block: since #364's ruling 4 these are effectful by
 * default, which is the only way a fixture gets an impure face at all — and the
 * SCC pin below needs one.
 */
const world = `extern from "./world.js"
    export fun save(document: String): Unit
`;

// Proves this file's harness can observe a failure.
test("the harness reports a broken module rather than passing it", () => {
  expect(main("export let broken: Int = missing(1)\n").length).toBeGreaterThan(0);
});

describe("the report itself", () => {
  test("a named callee is named, with its type and the argument count", () => {
    expect(main('export let s: String = "text"\nexport let bad: Int = s(1)\n')).toEqual([
      "`s` is not a function — it has type `String`, and this call supplies 1 argument",
    ]);
  });

  test("it is an error, and it carets the whole call", () => {
    // An error, not a warning: nothing downstream of a call that cannot happen
    // is worth emitting. The caret covers the whole call, as the sibling arity
    // report's does — the callee alone would point at a name that is fine.
    const source = 'export let s: String = "text"\nexport let bad: Int = s(1)\n';
    const reported = compileFiles([["/main.hex", source]]).diagnostics;
    expect(reported).toHaveLength(1);
    expect(reported[0]!.severity).toBe("error");
    expect(source.slice(reported[0]!.primary.start.offset, reported[0]!.primary.end.offset))
      .toBe("s(1)");
  });

  test("no arrow reaches the message, in any diagnostic the module produces", () => {
    // The complaint #385 filed, pinned directly: the demanded arrow was never
    // the reader's business, and no spelling of it — `->`, `->?`, `->!` — may
    // appear in a report about code that contains no call at all.
    const messages = main('export let s: String = "text"\nexport let bad: Int = s(1)\n');
    for (const message of messages) {
      expect(message).not.toContain("->");
      expect(message).not.toContain("type mismatch");
    }
  });

  test("no arguments and two arguments each get their own count", () => {
    expect(main('export let s: String = "text"\nexport let bad: Int = s()\n')).toEqual([
      "`s` is not a function — it has type `String`, and this call supplies no arguments",
    ]);
    expect(main('export let s: String = "text"\nexport let bad: Int = s(1, 2)\n')).toEqual([
      "`s` is not a function — it has type `String`, and this call supplies 2 arguments",
    ]);
  });

  /**
   * The call's type is the **error** type, not the fresh result variable the
   * arm mints for the branch below. Diagnostics cannot tell the two apart —
   * an unbound variable absorbs a later demand as silently as the error type
   * does — but a binding does: a fresh variable generalizes, so the failed
   * call would hand the reader a polymorphic `a` where nothing was proved.
   */
  test("a failed call's result is the error type, not a variable that generalizes", () => {
    expect(hoveredType('export let s: String = "text"\nlet r = s(1)\n', "r =")).toBe("?");
  });

  test("a compound callee has no name to give, so the sentence names the callee", () => {
    expect(main('export let bad: Int = ("text")(1)\n')).toEqual([
      "this is not a function — the callee has type `String`, and this call " +
      "supplies 1 argument",
    ]);
  });

  /**
   * Method Syntax §7 row 3 asks for "ordinary type/arity errors phrased against
   * the field". No bespoke field-not-callable report exists in the checker — the
   * row's quoted string is an illustration, not a message the compiler ever
   * emitted — and before this change the case produced "type mismatch: expected
   * Int, found () ->? ?434", which is not phrased against the field at all. The
   * dedicated report is, so this is the row moving *toward* conformance rather
   * than away from it.
   */
  test("a dot callee is named by its member, as the mark reports name it", () => {
    expect(
      main(
        "type Box = { size: Int }\n" +
          "export let box: Box = { size = 1 }\n" +
          "export let bad: Int = box.size(1)\n",
      ),
    ).toEqual([
      "`.size` is not a function — it has type `Int`, and this call supplies 1 argument",
    ]);
  });
});

describe("every shape of concrete non-function reaches it", () => {
  test("a record", () => {
    expect(
      main(
        "type Box = { size: Int }\n" +
          "export let box: Box = { size = 1 }\n" +
          "export let bad: Int = box(1)\n",
      ),
    ).toEqual([
      "`box` is not a function — it has type `{size: Int}`, and this call supplies 1 argument",
    ]);
  });

  test("a union value", () => {
    expect(
      main(
        "export union Colour = Red | Green\n" +
          "export let colour: Colour = Red\n" +
          "export let bad: Int = colour(1)\n",
      ),
    ).toEqual([
      "`colour` is not a function — it has type `Colour`, and this call supplies 1 argument",
    ]);
  });

  test("a tuple", () => {
    expect(
      main("export let pair: (Int, Int) = (1, 2)\nexport let bad: Int = pair(1)\n"),
    ).toEqual([
      "`pair` is not a function — it has type `(Int, Int)`, and this call supplies 1 argument",
    ]);
  });

  test("a primitive, and `Unit` by its own name", () => {
    expect(main("export let n: Int = 5\nexport let bad: Int = n(1)\n")).toEqual([
      "`n` is not a function — it has type `Int`, and this call supplies 1 argument",
    ]);
    expect(main("export let u: Unit = ()\nexport let bad: Int = u()\n")).toEqual([
      "`u` is not a function — it has type `Unit`, and this call supplies no arguments",
    ]);
  });

  test("an extern type", () => {
    expect(
      diagnostics([["/world.js", ""], ["/main.hex", `extern from "./world.js"
    export type Handle
    export let handle: Handle

export let bad: Int = handle(1)
`]]),
    ).toEqual([
      "`handle` is not a function — it has type `Handle`, and this call supplies 1 argument",
    ]);
  });
});

describe("no mark obligation is minted for a non-call", () => {
  /**
   * The bonus the split buys. Registering the call used to hand the mark
   * machinery a fresh, unsolvable colour; it defaulted to pure, and a written
   * `!` then collected "this call is pure, so `s` wants no mark, not `!`" —
   * a second report advising a fix to a call that does not exist.
   */
  test("a `!` on a non-call adds nothing to the one report", () => {
    expect(main('export let s: String = "text"\nexport let bad: Int = s!(1)\n')).toEqual([
      "`s` is not a function — it has type `String`, and this call supplies 1 argument",
    ]);
  });

  test("a `?` on a non-call adds nothing either", () => {
    expect(main('export let s: String = "text"\nexport let bad: Int = s?(1)\n')).toEqual([
      "`s` is not a function — it has type `String`, and this call supplies 1 argument",
    ]);
  });
});

describe("the branches the split must leave alone", () => {
  /**
   * The hazard the one-line fix in #385's description walked into. Inside an
   * SCC a neighbour is a not-yet-generalized monotype variable when a caller's
   * body is checked, so `pong!` takes the variable branch and the fresh effect
   * variable is what carries the colour until `pong`'s own body settles. Both
   * bodies perform effects, both calls wear `!`, and the module is clean.
   */
  test("effectful mutual recursion inside an SCC stays clean", () => {
    expect(
      diagnostics([["/world.js", ""], ["/main.hex", `${world}
export fun ping(n: Int): Unit =
    save!("ping")
    if n == 0 then () else pong!(n - 1)

export fun pong(n: Int): Unit =
    save!("pong")
    if n == 0 then () else ping!(n - 1)
`]]),
    ).toEqual([]);
  });

  test("a rigid callee still gets Functions §8's declared-variable report", () => {
    // A declared type variable prunes to a *variable*, not to a concrete
    // non-function, so it never reaches the new report — the annotation's own
    // diagnostic keeps the case.
    const messages = main("export let apply(f: a, x: Int): Int = f(x)\n");
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("`a` is a declared type variable");
    expect(messages[0]).not.toContain("is not a function — it has type");
  });

  test("a wrong-arity call on a real function keeps its arity report", () => {
    expect(main("let f(a: Int): Int = a\nexport let bad: Int = f(1, 2)\n")).toEqual([
      "function expects 1 arguments, got 2",
    ]);
  });

  test("a genuine argument mismatch on a real function keeps its mismatch", () => {
    expect(main('let f(a: Int): Int = a\nexport let bad: Int = f("x")\n')).toEqual([
      "type mismatch: expected Int, found String",
    ]);
  });

  test("a constructor call keeps the arity report constructors have always had", () => {
    expect(
      main("export union Wrap = Wrap(Int)\nexport let bad: Wrap = Wrap(1, 2)\n"),
    ).toEqual(["function expects 1 arguments, got 2"]);
  });

  test("an already-errored callee produces no second report", () => {
    expect(main("export let bad: Int = nope(1)\n")).toEqual(["unknown name `nope`"]);
  });

  test("a call on an already-failed call produces no second report", () => {
    // The inner call is the not-callable one; the outer call's callee is the
    // error type it produced, and the error type falls through silently.
    expect(main('export let s: String = "text"\nexport let bad: Int = s(1)(2)\n')).toEqual([
      "`s` is not a function — it has type `String`, and this call supplies 1 argument",
    ]);
  });

  /**
   * Unions §2.2's targeted hint for a called nullary constructor (#413):
   * "`None` is a value, not a function; write it without `()`". The generic
   * report's type display would print the instantiation's fresh variable —
   * `Option(a)`, and `Option(?433)` before #649 — noise about a value the
   * writer named either way, so the hint
   * displaces the whole sentence, type and argument count included. The fixit
   * deletes the empty argument list; a call that *supplies* arguments keeps
   * the sentence but offers no fixit, because deleting `(x)` deletes an
   * expression, and where that expression belongs is the writer's decision.
   */
  test("a called union nullary constructor takes Unions §2.2's targeted hint", () => {
    expect(main("export let bad: Option(Int) = None()\n")).toEqual([
      "`None` is a value, not a function; write it without `()`",
    ]);
  });

  test("the hint's fixit deletes exactly the argument list", () => {
    const source = "export let bad: Option(Int) = None()\n";
    const [diagnostic] = compileFiles([["/main.hex", source]]).diagnostics;
    expect(diagnostic?.fixes).toHaveLength(1);
    const fix = diagnostic!.fixes![0]!;
    expect(fix.message).toBe("delete the `()`");
    expect(fix.edits).toHaveLength(1);
    const edit = fix.edits[0]!;
    expect(edit.replacement).toBe("");
    expect(source.slice(edit.span.start.offset, edit.span.end.offset)).toBe("()");
  });

  test("a locally declared nullary constructor takes the same hint", () => {
    expect(
      main("export union Colour = Red | Mixed(Int)\nexport let bad: Colour = Red()\n"),
    ).toEqual(["`Red` is a value, not a function; write it without `()`"]);
  });

  test("a nullary constructor called with arguments keeps the hint, minus the fixit", () => {
    const source = "export let bad: Option(Int) = None(1)\n";
    const [diagnostic] = compileFiles([["/main.hex", source]]).diagnostics;
    expect(diagnostic?.message).toBe(
      "`None` is a value, not a function; write it without `()`",
    );
    expect(diagnostic?.fixes).toBeUndefined();
  });

  test("a binding holding a constructor's value keeps the generic report", () => {
    // The hint is about the constructor *written* with parens; a `let` bound to
    // `None` is an ordinary value whose name carries no argument list to
    // delete, so its call keeps #385's sentence, fresh variable and all.
    const messages = main("let n = None\nexport let bad: Option(Int) = n()\n");
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("`n` is not a function — it has type `Option(");
    expect(messages[0]).toContain("and this call supplies no arguments");
  });

  test("a nullary exception keeps its own targeted hint", () => {
    // The hint fires before the callee is inferred at all, so the new report
    // can never displace it (Exceptions §2.1, Unions §2.2 — one sentence, the
    // union rules restated for closure).
    expect(
      main("export exception Missing\nexport let bad: Exn = Missing()\n"),
    ).toEqual(["`Missing` is a value, not a function; write it without `()`"]);
  });

  test("an imported nullary exception takes the exception hint, not the constructor one", () => {
    // The exception short-circuit above reads `#exceptions`, which held only
    // local declarations until #469 widened it to every exception constructor
    // in scope — so an imported nullary exception now reaches it and gets
    // Exceptions §2.1's sentence, the flip #439 asked for and the ledger row
    // §9 draws with no local/imported distinction.
    //
    // What stays pinned is the boundary the split has to keep either way: this
    // is the exception arm and not the union-constructor one, so no fixit
    // deleting the `()` rides along — that offer belongs to §2.2's hint.
    const compiled = compileFiles([
      ["/lib.hex", "export exception Missing\n"],
      ["/main.hex", 'import { Missing } from "./lib"\nexport let bad: Exn = Missing()\n'],
    ]);
    expect(compiled.diagnostics.map(({ message }) => message)).toEqual([
      "`Missing` is a value, not a function; write it without `()`",
    ]);
    expect(compiled.diagnostics[0]?.fixes).toBeUndefined();
  });

  test("an imported nullary constructor is caught, with the fixit in the caller's file", () => {
    // `#constructorUnions` carries imported unions because `module.unions`
    // does; this is the only pin on that channel, and on the fixit landing in
    // the file the call was written in — `AnalysisSession` drops a code action
    // whose file does not resolve, silently.
    const mainSource = 'import { Colour, Red } from "./lib"\nexport let bad: Colour = Red()\n';
    const compiled = compileFiles([
      ["/lib.hex", "export union Colour = Red | Mixed(Int)\n"],
      ["/main.hex", mainSource],
    ]);
    expect(compiled.diagnostics.map(({ message }) => message)).toEqual([
      "`Red` is a value, not a function; write it without `()`",
    ]);
    const diagnostic = compiled.diagnostics[0]!;
    const edit = diagnostic.fixes![0]!.edits[0]!;
    expect(edit.span.fileId).toBe(diagnostic.primary.fileId);
    expect(mainSource.slice(edit.span.start.offset, edit.span.end.offset)).toBe("()");
  });

  test("a piped call with a written `()` keeps the hint but earns no fixit", () => {
    // The pipeline stage supplies the piped value as an argument, so the
    // argument-count conjunct — not the two-character gap, which IS exactly
    // `()` here — is what withholds the fixit: deleting the written parens
    // would leave `1 |> None`, still an error. The one shape where the gate's
    // two halves disagree, so the only pin the count conjunct has.
    const [diagnostic, ...rest] = compileFiles([
      ["/main.hex", "export let bad: Int = 1 |> None()\n"],
    ]).diagnostics;
    expect(rest).toEqual([]);
    expect(diagnostic?.message).toBe(
      "`None` is a value, not a function; write it without `()`",
    );
    expect(diagnostic?.fixes).toBeUndefined();
  });

  test("an argument list that is not exactly `()` keeps the hint but earns no fixit", () => {
    // "delete the `()`" must delete exactly the two characters it names. A gap
    // holding anything more — whitespace, a comment, a glued effect mark — is
    // the writer's text, so the sentence stands alone there.
    for (const call of ["None ()", "None((* why *))", "None!()"]) {
      const [diagnostic, ...rest] = compileFiles([
        ["/main.hex", `export let bad: Option(Int) = ${call}\n`],
      ]).diagnostics;
      expect(rest).toEqual([]);
      expect(diagnostic?.message).toBe(
        "`None` is a value, not a function; write it without `()`",
      );
      expect(diagnostic?.fixes).toBeUndefined();
    }
  });
});
