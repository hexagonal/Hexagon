import { describe, expect, test } from "vitest";

import { AnalysisSession } from "../analysis/session.js";
import { compileFiles, runMain } from "../support/test-project.js";

/**
 * Conformance for where a failure starts and where it ends (Effects §3.6;
 * Exceptions §3, §5.3, §5.4; Phase 3 step 8c-i): `throw` reads its argument's
 * text, so an exception's throw may fail and a fault's is bare; a catch-all
 * handles what it guards, which joins the world colour and not the fail
 * colour, and handling is no demand; a sibling call a form guards makes no
 * member fail; and over a part that cannot fail, an arm that only catches
 * failures is refused.
 */

const HEADER = "module Main\n\n";
const WORLD =
  'extern from "./world.js"\n' +
  "    export fun log(s: String) ->~ Unit\n" +
  "    export fun parse(s: String) ->^ Int\n" +
  "    export fun save(s: String) ->! Unit\n" +
  "let noop(): Unit = ()\n" +
  "let log0(): Unit = log~(\"x\")\n" +
  "let save0(): Unit = save!(\"x\")\n" +
  "exception Oops\n" +
  "exception ParseError(line: Int)\n";

const text = (source: string): string => HEADER + WORLD + source;

const files = (source: string): [string, string][] => [
  ["/main.hex", text(source)],
  ["/world.js", ""],
];

/** Each report as `[the text its primary spans, its message]`. */
function reports(source: string): readonly (readonly [string, string])[] {
  const whole = text(source);
  return compileFiles(files(source)).diagnostics.map(({ primary, message }) =>
    [whole.slice(primary.start.offset, primary.end.offset), message] as const
  );
}

/** Each report's message. */
function messages(source: string): readonly string[] {
  return compileFiles(files(source)).diagnostics.map(({ message }) => message);
}

/** Each report's fixits as `[message, replacements]`. */
function fixes(source: string): readonly (readonly [string, readonly string[]])[] {
  return compileFiles(files(source)).diagnostics.flatMap(({ fixes: written }) =>
    (written ?? []).map(({ message, edits }) => [message, edits.map(({ replacement }) => replacement)] as const)
  );
}

/** What a hover on the binding `name` shows as its type. */
function face(source: string, name: string): string | undefined {
  const whole = text(source);
  const session = new AnalysisSession();
  session.setFile("/world.js", "");
  session.setFile("/main.hex", whole);
  return session.hover("/main.hex", whole.lastIndexOf(`let ${name}`) + 4)?.displayedType;
}

const ORZERO = "let orZero(f: () ->! Int): Int =\n    try\n        f!()\n    catch\n        _ => 0\n";

describe("Effects §3.6: a catch-all handles what it guards", () => {
  test("`orZero` passes the world colour through and cannot fail", () => {
    expect(messages(ORZERO)).toEqual([]);
    expect(face(ORZERO, "orZero")).toBe("(() ->! Int) >~> Int");
  });

  test("a bare-variable arm handles as `_` does, and so does a catch-all under `as` or in an or-pattern", () => {
    for (const arm of ["e => 0", "(_ as e) => 0", "Oops | _ => 0"]) {
      const source = `let h(f: () ->! Int): Int =\n    try\n        f!()\n    catch\n        ${arm}\n`;
      expect(face(source, "h")).toBe("(() ->! Int) >~> Int");
    }
  });

  test("a guarded catch-all, a `catch` naming only exceptions, and `fault e` end nothing", () => {
    for (const arm of ["_ when True => 0", "ParseError(_) => 0", "JsError(_) => 0", "fault e => 0"]) {
      const source = `let h(f: () ->! Int): Int =\n    try\n        f!()\n    catch\n        ${arm}\n`;
      expect(face(source, "h")).toBe("(() ->! Int) >-> Int");
    }
  });

  test("handling is no demand: the callback's call keeps its mark, and `->!` is no lie of generality", () => {
    expect(messages(ORZERO + "let a(): Int = orZero~(() => 1)\n")).toEqual([
      "this call is pure, so `orZero` wants no mark, not `~`",
    ]);
    expect(messages(ORZERO + "let b(): Int = orZero(() => parse^(\"1\"))\n")).toEqual([]);
    expect(messages(ORZERO + "let d(): Int = orZero~(() =>\n    save0!()\n    1)\n")).toEqual([]);
  });

  test("a catch arm is an ordinary position: an arm that throws may fail", () => {
    const source = "let h(f: () ->! Int): Int =\n    try\n        f!()\n    catch\n        e => throw^(e)\n";
    expect(face(source, "h")).toBe("(() ->! Int) >~>^ Int");
  });

  test("a `match`'s clause guards the scrutinee alone; its data arms join both colours", () => {
    const clause = "let h(f: () ->! Int): Int =\n    match f!()\n        0 => 1\n        n => n\n    catch\n        _ => 0\n";
    expect(face(clause, "h")).toBe("(() ->! Int) >~> Int");
    const arms = "let h(f: () ->! Int, g: () ->^ Int): Int =\n    match f!()\n        0 => g^()\n        n => n\n" +
      "    catch\n        _ => 0\n";
    expect(face(arms, "h")).toBe("(() ->! Int, () ->^ Int) >-> Int");
  });

  test("a lambda written in a guarded part is a body of its own, run where it is called", () => {
    const source = "let h(f: () ->! Int) =\n    try\n        () => f!()\n    catch\n        _ => () => 0\n";
    expect(face(source, "h")).toBe("(() ->! Int) -> () >-> Int");
  });

  test("what an inner `try` lets through reaches the outer one", () => {
    const source = "let h(f: () ->! Int): Int =\n    try\n        try\n            f!()\n        catch\n            ParseError(_) => 1\n" +
      "    catch\n        _ => 0\n";
    expect(face(source, "h")).toBe("(() ->! Int) >~> Int");
    expect(messages(source)).toEqual([]);
  });

  test("an untyped parameter run under a catch-all keeps its own fail colour; its bare world part is a fact", () => {
    const source = "let h(f): Int =\n    try\n        f^()\n    catch\n        _ => 0\n";
    expect(face(source, "h")).toBe("(() ->^ Int) -> Int");
    expect(messages(source)).toEqual([]);
  });

  test("the standard library's `Result.attempt` is a catch-all, so it follows the world colour only", () => {
    const source = "let r = Result.attempt\n";
    expect(face(source, "r")).toBe("(() ->! a) >~> Result(a, Exn)");
  });
});

describe("Effects §3.6: a sibling call a form guards makes no member fail", () => {
  test("a knot member that handles its sibling's failure cannot fail, and the sibling may", () => {
    const source =
      "fun\n    a(n: Int): Int =\n        try\n            b^(n)\n        catch\n            _ => 0\n" +
      "    b(n: Int): Int =\n        if n > 9 then throw^(Oops) else a(n + 1)\n" +
      "let ra(): Int = a(1)\nlet rb(): Int = b^(1)\n";
    expect(messages(source)).toEqual([]);
    expect(face(source, "ra")).toBe("() -> Int");
    expect(face(source, "rb")).toBe("() ->^ Int");
  });

  test("the world colour still crosses a guarded sibling call", () => {
    const source =
      "fun\n    a(n: Int): Int =\n        try\n            b!(n)\n        catch\n            _ => 0\n" +
      "    b(n: Int): Int =\n        if n > 9 then throw^(Oops) else\n            log0~()\n            a~(n + 1)\n" +
      "let ra(): Int = a~(1)\n";
    expect(messages(source)).toEqual([]);
    expect(face(source, "ra")).toBe("() ->~ Int");
  });
});

describe("Exceptions §3: `throw` reads its argument's text", () => {
  test("an exception's throw may fail, and a fault's is bare", () => {
    expect(reports(
      "let a(): Int = throw(Oops)\n" +
        "let b(): Int = throw^(IndexFault(1, 2))\n" +
        "let c(): Int = throw^(ParseError(3))\n" +
        "let d(): Int = throw(Map.KeyFault)\n" +
        "let e(): Int = throw((IndexFault(1, 2)))\n",
    )).toEqual([
      ["throw(Oops)", "this call may fail, so `throw` wants `^`, not no mark"],
      ["^", "this call cannot fail, so `throw` wants no mark, not `^`"],
    ]);
  });

  test("`throw` is pure: a world mark on it is the wrong mark", () => {
    expect(reports("let a(): Int = throw!(Oops)\nlet b(): Int = throw~(IndexFault(1, 2))\n")).toEqual([
      ["!", "this call is pure, so `throw` wants `^`, not `!`"],
      ["~", "this call is pure, so `throw` wants no mark, not `~`"],
    ]);
  });

  test("`JsError` and a value whose kind the text does not show may fail", () => {
    expect(messages(
      "let a(v: JsValue): Int = throw^(JsError(v))\n" +
        "let b(e: Exn): Int = throw^(e)\n" +
        "let c(): Int =\n    let e = IndexFault(1, 2)\n    throw^(e)\n",
    )).toEqual([]);
  });

  test("a catch arm's binder whose pattern matches only faults proves a fault", () => {
    const arms = (arm: string): string =>
      `let h(f: () ->! Int): Int =\n    try\n        f!()\n    catch\n        ${arm}\n        _ => 0\n`;
    expect(messages(arms("fault e => throw(e)"))).toEqual([]);
    expect(messages(arms("IndexFault(_, _) as e => throw(e)"))).toEqual([]);
    expect(messages(arms("(KeyFault | SliceFault(_, _)) as e => throw(e)"))).toEqual([]);
    expect(messages("let h(f: () ->! Int): Int =\n    try\n        f!()\n    catch\n        e => throw(e)\n"))
      .toEqual(["this call may fail, so `throw` wants `^`, not no mark"]);
    expect(messages(arms("(KeyFault | ParseError(_)) as e => throw(e)")))
      .toEqual(["this call may fail, so `throw` wants `^`, not no mark"]);
  });

  test("the binding proves the kind, not the spelling: a `let` naming the binder proves nothing", () => {
    const source = "let h(f: () ->! Int): Int =\n    try\n        f!()\n    catch\n" +
      "        fault e =>\n            let other = e\n            throw(other)\n";
    expect(messages(source)).toEqual(["this call may fail, so `throw` wants `^`, not no mark"]);
    const shadowed = "let h(f: () ->! Int): Int =\n    try\n        f!()\n    catch\n" +
      "        fault e => ((e: Exn) => throw^(e))^(ParseError(1))\n";
    expect(messages(shadowed)).toEqual([]);
  });

  test("a pipe stage is the call it rewrites to", () => {
    expect(reports("let a(): Int = IndexFault(1, 2) |> throw\nlet b(): Int = Oops |> throw\nlet c(): Int = Oops |> throw^\n"))
      .toEqual([["Oops |> throw", "this call may fail, so `throw` wants `^`, not no mark"]]);
    expect(fixes("let b(): Int = Oops |> throw\n")).toEqual([["mark the call `^`", ["^"]]]);
  });

  test("`throw` named as a value has no argument to read, and is `(Exn) ->^ a`", () => {
    const source = "let fire = throw\nlet a(): Int = (throw)(IndexFault(1, 2))\n";
    expect(face(source, "fire")).toBe("Exn ->^ a");
    expect(messages(source)).toEqual(["this call may fail, so this call wants `^`, not no mark"]);
  });

  test("the value form throws what it is handed, at run time", async () => {
    const exports = await runMain(
      "module Main\n\nexception Oops\nlet fire = throw\n" +
        "export let caught(): Int =\n    try\n        fire^(Oops)\n    catch\n        Oops => 7\n",
    );
    expect((exports["caught"] as () => number)()).toBe(7);
  });
});

describe("Exceptions §5.3: over a part that cannot fail, an arm that only catches failures can never run", () => {
  test("a catch-all and an exception's arm are refused; a fault's arm, `fault e` and `JsError(e)` stand", () => {
    expect(reports(
      "let a(): Unit =\n    try\n        noop()\n    catch\n        Oops => ()\n        IndexFault(_, _) => ()\n" +
        "        JsError(_) => ()\n        fault e => ()\n        _ => ()\n",
    )).toEqual([
      ["Oops => ()", "this arm can never run: nothing in this `try` may fail"],
      ["_ => ()", "this arm can never run: nothing in this `try` may fail — a fault passes `_`; to catch one, name it or write `fault e`"],
    ]);
  });

  test("a `match`'s clause over a scrutinee that cannot fail", () => {
    expect(reports("let a(): Int =\n    match noop()\n        () => 1\n    catch\n        Oops => 2\n")).toEqual([
      ["Oops => 2", "this arm can never run: evaluating the scrutinee cannot fail"],
    ]);
    expect(fixes("let a(): Int =\n    match noop()\n        () => 1\n    catch\n        Oops => 2\n"))
      .toEqual([["remove the `catch` clause", [""]]]);
  });

  test("the fixit removes the arm, or, where no arm would remain, the `try` and its `catch`", () => {
    expect(fixes("let a(): Unit =\n    try\n        noop()\n    catch\n        Oops => ()\n        fault e => ()\n"))
      .toEqual([["remove the arm", [""]]]);
    expect(fixes("let a(): Unit =\n    try\n        noop()\n    catch\n        _ => ()\n"))
      .toEqual([["remove the `try` and its `catch`, keeping the body", ["", ""]]]);
    expect(fixes("let a(x: Int): Int =\n    try\n        let y = x + 1\n        y * 2\n    catch\n        _ => 0\n"))
      .toEqual([["remove the `try` and its `catch`, keeping the body", ["let y = x + 1\n    y * 2"]]]);
  });

  test("an untyped parameter called bare is a fact, so the report names the call and offers to mark it", () => {
    const source = "let a(f): Int =\n    try\n        f()\n    catch\n        _ => 0\n";
    expect(messages(source)).toEqual([
      "this arm can never run: nothing in this `try` may fail — a fault passes `_`; to catch one, name it or write " +
        "`fault e` — `f` is called bare, which makes it unable to fail",
    ]);
    expect(fixes(source)).toEqual([
      ["remove the `try` and its `catch`, keeping the body", ["", ""]],
      ["mark the call of `f` `^`", ["^"]],
    ]);
  });

  test("where another bare call also makes the parameter unable to fail, marking this one is no repair", () => {
    const source = "let a(f): Int =\n    let x = f()\n    try\n        f()\n    catch\n        _ => x\n";
    expect(messages(source)).toEqual([
      "this arm can never run: nothing in this `try` may fail — a fault passes `_`; to catch one, name it or write " +
        "`fault e` — `f` is called bare, which makes it unable to fail",
    ]);
    expect(fixes(source)).toEqual([["remove the `try` and its `catch`, keeping the body", ["", ""]]]);
  });

  test("a callback's colour is not silent, so a catch-all around it stands at every instantiation", () => {
    expect(messages(ORZERO + "let a(): Int = orZero(() => 1)\n")).toEqual([]);
  });

  test("a guarded part in error owes nothing", () => {
    expect(messages("let a(): Int =\n    try\n        missing()\n    catch\n        _ => 0\n"))
      .toEqual(["unknown name `missing`"]);
  });

  test("the refusal is read once the colours settle, whatever order the lines come in", () => {
    const inner = "    let inner(): Int =\n        try\n            g~()\n        catch\n            _ => 0\n";
    const before = `let a(g) =\n    let x = g~()\n${inner}    inner~()\n`;
    const after = `let a(g) =\n${inner}    let x = g~()\n    inner~()\n`;
    expect(messages(before)).toEqual(messages(after));
    expect(messages(before)).toEqual([
      "this arm can never run: nothing in this `try` may fail — a fault passes `_`; to catch one, name it or write " +
        "`fault e` — `g` is called `~`, which makes it unable to fail",
    ]);
  });
});
