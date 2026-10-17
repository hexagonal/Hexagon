import { describe, expect, test } from "vitest";

import { AnalysisSession } from "../analysis/session.js";
import { compileFiles, runMain } from "../support/test-project.js";

/**
 * Conformance for the forms that end a failure besides a catch-all (Effects
 * §3.1, §3.6, §7; Exceptions §8.2, §8.3; Lexer §8.1, §8.3; Phase 3 step
 * 8c-ii): the reading `?` / `~?` at a call, which gives the call's value as an
 * `Option`, and the body forms `attempt`, which gives a `Result`, and `assume`,
 * which turns a failure into `AssumptionFault`. Each handles what it guards:
 * the world colour passes through, and the fail colour joins nothing.
 */

const HEADER = "module Main\n\n";
const WORLD =
  'extern from "./world.js"\n' +
  "    export fun log(s: String) ->~ Unit\n" +
  "    export fun parse(s: String) ->^ Int\n" +
  "    export fun save(s: String) ->! Unit\n" +
  "let noop(): Unit = ()\n" +
  "exception Oops\n";

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
  return session.hover("/main.hex", whole.lastIndexOf(`let ${name}(`) + 4)?.displayedType;
}

describe("Effects §3.1: the reading `?` and `~?`", () => {
  test("a reading's value is an `Option`, and it handles the call's failure", () => {
    const source = "let a() = parse?(\"1\")\nlet b() = save~?(\"x\")\nlet c(): Option(Int) = parse?(\"2\")\n";
    expect(messages(source)).toEqual([]);
    expect(face(source, "a")).toBe("() -> Option(Int)");
    expect(face(source, "b")).toBe("() ->~ Option(Unit)");
  });

  test("a reading runs the callee's colours under a mark: it decides nothing, and its bare world part is a fact", () => {
    const source = "let quietly(f) = f~?()\nlet check(f) = f?()\n";
    expect(face(source, "quietly")).toBe("(() ->! a) >~> Option(a)");
    expect(face(source, "check")).toBe("(() ->^ a) -> Option(a)");
  });

  test("the reading takes the mark's fail part, and its world part is checked as any mark's", () => {
    expect(reports("let a() = save?(\"x\")\n")).toEqual([["?", "this call is impure, so `save` wants `~?`, not `?`"]]);
    expect(fixes("let a() = save?(\"x\")\n")).toEqual([["mark the call `~?`", ["~?"]]]);
  });

  test("a reading on a call that cannot fail is refused, keeping the value's type", () => {
    expect(reports("let a() = noop?()\nlet b() = log~?(\"x\")\n")).toEqual([
      ["?", "this call cannot fail, so `noop` wants no `?`"],
      ["~?", "this call cannot fail, so `log` wants `~`, not `~?`"],
    ]);
    expect(fixes("let a() = noop?()\nlet b() = log~?(\"x\")\n")).toEqual([
      ["keep the value: `Some(noop())`", ["Some(noop())"]],
      ["keep the value: `Some(log~(\"x\"))`", ["Some(log~(\"x\"))"]],
    ]);
  });

  test("a reading of a tower member's call is a call, not a number its tree holds", () => {
    expect(messages("let a(): Option(Int) = Int.add?(1, 2)\nlet b(x: Int): Option(Int) = x.add?(2)\n")).toEqual([
      "this call cannot fail, so `add` wants no `?`",
      "this call cannot fail, so `.add` wants no `?`",
    ]);
    // Spelled through its constraint, a tower member's call is an interior node
    // of its tree; read, it is a call whose value is an `Option`, no number.
    expect(messages("let c(): Int = 1 + Num.add?(1, 2)\n")).toContain("this call cannot fail, so `add` wants no `?`");
    expect(messages("let d(): Option(Int) = Num.add?(1, 2)\n")).toEqual(["this call cannot fail, so `add` wants no `?`"]);
  });

  test("`!?` and `^?` are no readings: one report each, read as the reading meant", () => {
    expect(messages("let a() = parse^?(\"1\")\nlet b() = save!?(\"x\")\nlet c() = parse!?(\"1\")\n")).toEqual([
      "a reading takes the mark's fail part: write `f~?(x)` for a call that is impure, `f?(x)` for one that is pure",
      "a reading takes the mark's fail part: write `f~?(x)` for a call that is impure, `f?(x)` for one that is pure",
      "a reading takes the mark's fail part: write `f~?(x)` for a call that is impure, `f?(x)` for one that is pure",
    ]);
  });

  test("`??` and `?.` are no tokens", () => {
    expect(messages("let a(x: Option(Int)) = x ?? 1\n")).toContain(
      "Hexagon has no optional chaining or coalescing: `Option.defaultValue`, `Option.map`, or a `match`",
    );
  });

  test("a pipe stage reads as the call it rewrites to", () => {
    const source = "let a() = \"1\" |> parse?\n";
    expect(messages(source)).toEqual([]);
    expect(face(source, "a")).toBe("() -> Option(Int)");
  });

  test("the callee and the arguments are evaluated outside the reading, so their failures stand", () => {
    expect(face("let a() = parse?(Int.show(parse^(\"1\")))\n", "a")).toBe("() ->^ Option(Int)");
  });

  test("a reading leaves nothing for a catch-all around it to handle", () => {
    expect(messages("let a(): Option(Int) =\n    try\n        parse?(\"1\")\n    catch\n        _ => None\n")).toEqual([
      "this arm can never run: nothing in this `try` may fail — a fault passes `_`; to catch one, name it or write `fault e`",
    ]);
  });

  test("at run time: `Some` of the value, `None` for an exception or a foreign throw, and a fault passes through", async () => {
    const exports = await runMain(
      "module Main\n\nexception Oops\n" +
        "let risky(n: Int): Int = if n == 0 then throw^(Oops) else if n < 0 then throw(IndexFault(n, 0)) else n\n" +
        "let argument(n: Int): Int = if n == 9 then throw^(Oops) else n\n" +
        "export let read(n: Int): Option(Int) = risky?(n)\n" +
        "export let outside(n: Int): Option(Int) = risky?(argument^(n))\n",
    );
    const read = exports["read"] as (n: number) => unknown;
    expect(read(3)).toEqual({ tag: "Some", value: 3 });
    expect(read(0)).toEqual({ tag: "None" });
    expect(() => read(-1)).toThrow();
    // The argument is evaluated outside the reading: its failure is no `None`.
    expect(() => (exports["outside"] as (n: number) => unknown)(9)).toThrow();
    expect((exports["outside"] as (n: number) => unknown)(0)).toEqual({ tag: "None" });
    expect((() => {
      try {
        read(-1);
        return undefined;
      } catch (error) {
        return (error as { name?: string }).name;
      }
    })()).toBe("IndexFault");
  });
});

describe("Exceptions §8.2: `attempt` gives a failure as data", () => {
  test("its value is a `Result`, and it handles its body's failure", () => {
    const source = "let a() = attempt parse^(\"1\")\nlet b(f: () ->! Int) = attempt f!()\n" +
      "let c() =\n    attempt\n        let n = parse^(\"1\")\n        n + 1\n";
    expect(messages(source)).toEqual([]);
    expect(face(source, "a")).toBe("() -> Result(Int, Exn)");
    expect(face(source, "b")).toBe("(() ->! Int) >~> Result(Int, Exn)");
    expect(face(source, "c")).toBe("() -> Result(Int, Exn)");
  });

  test("it eats to the right, and stands after a `match` head", () => {
    const source = "let a(): Result(Int, Exn) = attempt parse^(\"1\") |> ((n) => n + 1)\n" +
      "let b(): Int =\n    match attempt parse^(\"2\")\n        Ok(n) => n\n        Err(_) => 0\n";
    expect(messages(source)).toEqual([]);
  });

  test("over a body that cannot fail it is refused, and the fixit keeps the value's type", () => {
    expect(reports("let a() = attempt noop()\n")).toEqual([
      ["attempt", "nothing here may fail, so `attempt` has nothing to catch"],
    ]);
    expect(fixes("let a() = attempt noop()\n")).toEqual([["write the value as `Ok(…)`", ["Ok(noop())"]]]);
  });

  test("an untyped parameter's bare call is the fact that makes the body unable to fail", () => {
    expect(messages("let a(f) = attempt f()\n")).toEqual([
      "nothing here may fail, so `attempt` has nothing to catch — `f` is called bare, which makes it unable to fail",
    ]);
    expect(fixes("let a(f) = attempt f()\n")).toEqual([
      ["write the value as `Ok(…)`", ["Ok(f())"]],
      ["mark the call of `f` `^`", ["^"]],
    ]);
  });

  test("with no body, or named as a value, it is the one parse error", () => {
    const report = "`attempt` is followed by the code it guards, on the same line or in an indented block";
    expect(messages("let a() = attempt\n")).toContain(report);
    expect(messages("let a() = Option.map(Some(1), attempt)\n")).toContain(report);
  });

  test("at run time: `Ok` on return, `Err` on an exception, and a fault passes through", async () => {
    const exports = await runMain(
      "module Main\n\nexception Oops\n" +
        "let risky(n: Int): Int = if n == 0 then throw^(Oops) else if n < 0 then throw(IndexFault(n, 0)) else n\n" +
        "export let attempted(n: Int): Result(Int, Exn) = attempt risky^(n)\n",
    );
    const attempted = exports["attempted"] as (n: number) => { tag: string };
    expect(attempted(3)).toEqual({ tag: "Ok", value: 3 });
    expect(attempted(0).tag).toBe("Err");
    expect(() => attempted(-1)).toThrow();
  });
});

describe("Exceptions §8.3: `assume` says a failure cannot happen here", () => {
  test("its value is its body's, and it handles its body's failure", () => {
    const source = "let a() = assume parse^(\"1\")\nlet b(f: () ->! Int) = assume f!()\n";
    expect(messages(source)).toEqual([]);
    expect(face(source, "a")).toBe("() -> Int");
    expect(face(source, "b")).toBe("(() ->! Int) >~> Int");
  });

  test("over a body that cannot fail it is refused, and the fixit removes the word", () => {
    expect(reports("let a() = assume noop()\n")).toEqual([
      ["assume", "nothing here may fail, so there is nothing to assume"],
    ]);
    expect(fixes("let a() = assume noop()\n")).toEqual([["remove `assume`", [""]]]);
  });

  test("at run time: the value, or `AssumptionFault` with the failure as its cause", async () => {
    const exports = await runMain(
      "module Main\n\nexception Oops\n" +
        "let risky(n: Int): Int = if n == 0 then throw^(Oops) else n\n" +
        "export let assumed(n: Int): Int = assume risky^(n)\n",
    );
    const assumed = exports["assumed"] as (n: number) => number;
    expect(assumed(3)).toBe(3);
    const thrown = (() => {
      try {
        assumed(0);
        return undefined;
      } catch (error) {
        return error as { name?: string; cause?: { name?: string } };
      }
    })();
    expect(thrown?.name).toBe("AssumptionFault");
    expect(thrown?.cause?.name).toBe("Oops");
  });
});

describe("Effects §7: a lazy `Seq` position names where a mark sees a failure", () => {
  test("a function that may fail at a lazy position draws the three ways", () => {
    expect(messages("let lines: Seq(String) = Seq.empty\nlet a() = Seq.map(lines, parse)\n")).toEqual([
      "a `->` arrow promises the function cannot fail, and this function may fail — the demand is written `->`; " +
        "a lazy `Seq` would throw it at a later pull, so keep it where a mark sees it: a strict operation " +
        "(`Vector.map^`), a strict consumer (`Seq.fold^`), or elements that carry it as data (`(x) => f?(x)` " +
        "gives `Option`s, and `attempt` in the function gives `Result`s)",
    ]);
  });

  test("an impure function there draws the plain demand, and elements carrying the failure are accepted", () => {
    expect(messages("let lines: Seq(String) = Seq.empty\nlet a() = Seq.map(lines, log)\n")).toEqual([
      "a `->` arrow promises purity, and this function is impure — the demand is written `->`",
    ]);
    expect(messages(
      "let lines: Seq(String) = Seq.empty\nlet a() = Seq.map(lines, (l) => parse?(l))\n" +
        "let b() = Seq.map(lines, (l) => attempt parse^(l))\n",
    )).toEqual([]);
  });
});
