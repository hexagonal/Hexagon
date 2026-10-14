import { describe, expect, test } from "vitest";

import { AnalysisSession } from "../analysis/session.js";
import { compileFiles } from "../support/test-project.js";

/**
 * Conformance for the fail colour's spellings (Effects §1–§4, §10, §13; Phase 3
 * step 8b-ii): the arrows `->^` and `->~` beside `->` and `->!`, the call marks
 * `^` and `~` beside bare and `!`, each colour read on its own, and the places
 * where the two colours meet: a mark and an arrow read both (§3.1, §10), a face
 * whose colours do not both follow widens the one that follows (§2.4's D1, at
 * a binding, at a known instance and in a captured display: D3), a call in
 * error on one colour is checked on the other (§3.5's D2), and a report about
 * one colour names only that colour (§9).
 */

const HEADER = "module Main\n\n";
const WORLD =
  'extern from "./world.js"\n' +
  "    export fun log(s: String) ->~ Unit\n" +
  "    export fun parse(s: String) ->^ Int\n" +
  "    export fun save(s: String) ->! Unit\n" +
  "    export fun check(n: Int) ->^ Bool\n" +
  "let noop(): Unit = ()\n";

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

/** Each report's fixits as `[message, replacements]`. */
function fixes(source: string): readonly (readonly [string, readonly string[]])[] {
  return compileFiles(files(source)).diagnostics.flatMap(({ fixes: written }) =>
    (written ?? []).map(({ message, edits }) => [message, edits.map(({ replacement }) => replacement)] as const)
  );
}

/** Each report's notes, flattened. */
function notes(source: string): readonly string[] {
  return compileFiles(files(source)).diagnostics.flatMap(({ notes: written }) => written ?? []);
}

/** What a hover on the binding `name` shows as its type. */
function face(source: string, name: string): string | undefined {
  const whole = text(source);
  const session = new AnalysisSession();
  session.setFile("/world.js", "");
  session.setFile("/main.hex", whole);
  return session.hover("/main.hex", whole.lastIndexOf(`let ${name}`) + 4)?.displayedType;
}

describe("Effects §1, §3.1: four marks, each a part for each colour", () => {
  test("a call wears the mark its two colours give it, and no other", () => {
    expect(reports(
      "export let a(): Unit = log~(\"x\")\n" +
        "export let b(): Int = parse^(\"1\")\n" +
        "export let c(): Unit = save!(\"x\")\n" +
        "export let d(): Unit = noop()\n",
    )).toEqual([]);
  });

  test("§4.1's sentences name what the call does on each colour whose part is wrong", () => {
    expect(reports(
      "export let a(): Unit = save(\"x\")\n" +
        "export let b(): Int = parse(\"1\")\n" +
        "export let c(): Unit = log!(\"x\")\n" +
        "export let d(): Unit = noop!()\n" +
        "export let e(): Int = parse!(\"1\")\n" +
        "export let f(): Unit = save~(\"x\")\n",
    )).toEqual([
      ["save(\"x\")", "this call may touch the world and may fail, so `save` wants `!`, not no mark"],
      ["parse(\"1\")", "this call may fail, so `parse` wants `^`, not no mark"],
      ["!", "this call cannot fail, so `log` wants `~`, not `!`"],
      ["!", "this call is pure and cannot fail, so `noop` wants no mark, not `!`"],
      ["!", "this call is pure, so `parse` wants `^`, not `!`"],
      ["~", "this call may fail, so `save` wants `!`, not `~`"],
    ]);
  });

  test("each fixit writes the mark the call wants", () => {
    expect(fixes(
      "export let a(): Int = parse(\"1\")\n" +
        "export let b(): Unit = log!(\"x\")\n" +
        "export let c(): Unit = noop^()\n",
    )).toEqual([
      ["mark the call `^`", ["^"]],
      ["mark the call `~`", ["~"]],
      ["remove the mark", [""]],
    ]);
  });

  test("a callback has a colour on each colour its own arrow marks, and is silent on the other", () => {
    const source = "export let run(f: () ->~ Unit): Unit = f~()\n" +
      "export let check1(f: () ->^ Bool): Bool = f^()\n";
    expect(reports(
      source +
        "export let a(): Unit = run(noop)\n" +
        "export let b(): Unit = run~(() => log~(\"x\"))\n" +
        "export let c(): Bool = check1^(() => check^(1))\n" +
        "export let d(): Unit = run!(noop)\n",
    )).toEqual([
      ["!", "this call is pure and cannot fail, so `run` wants no mark, not `!`"],
    ]);
    expect(reports("export let r(f: () ->~ Unit): Unit = f!()\n")).toEqual([
      ["!", "this call cannot fail, so `f` wants `~`, not `!`"],
    ]);
  });
});

describe("Effects §10: an arrow shows from its two colours", () => {
  test("the four constants, a callback's marks, and a face that follows its callbacks", () => {
    const source = "export let quiet(): Unit = log~(\"x\")\n" +
      "export let risky(): Int = parse^(\"1\")\n" +
      "export let run(f: () ->~ Unit): Unit = f~()\n" +
      "export let ask(f: () ->^ Bool): Bool = f^()\n" +
      "export let both(f: () ->! Unit): Unit = f!()\n";
    expect(face(source, "quiet")).toBe("() ->~ Unit");
    expect(face(source, "risky")).toBe("() ->^ Int");
    expect(face(source, "run")).toBe("(() ->~ Unit) >-> Unit");
    expect(face(source, "ask")).toBe("(() ->^ Bool) >-> Bool");
    expect(face(source, "both")).toBe("(() ->! Unit) >-> Unit");
  });
});

describe("Effects §2.4 (D1): where the two colours do not both follow, the one that follows widens", () => {
  const source =
    "export record Handler = { run: () ->! Unit }\n" +
    "export let timed(f: () ->! Int): Int =\n    log~(\"start\")\n    f!()\n" +
    "export let decodeOne(s: String, item: (Int) ->! Int): Int = item!(parse^(s))\n" +
    "export let register(validate: () ->^ Bool, onEvent: () ->! Unit): Option(Handler) =\n" +
    "    if validate^() then Some(Handler({ run = onEvent })) else None\n" +
    "export let quietRun(f: () ->~ Unit, g: () ->^ Unit): Unit = f~()\n";

  test("each of §2.4's shapes that 8b-ii can write", () => {
    expect(face(source, "timed")).toBe("(() ->! Int) ->! Int");
    expect(face(source, "decodeOne")).toBe("(String, Int ->! Int) ->! Int");
    expect(face(source, "register")).toBe("(() ->^ Bool, () ->! Unit) ->^ Option(Handler)");
    expect(face(source, "quietRun")).toBe("(() ->~ Unit, () ->^ Unit) ->~ Unit");
  });

  test("the widened face is what a call wears, whatever it is handed", () => {
    expect(reports(source + "export let use(): Int = timed(() => 1)\n")).toEqual([
      ["timed(() => 1)", "this call may touch the world and may fail, so `timed` wants `!`, not no mark"],
    ]);
  });
});

describe("Effects §13.3 (D3): a known instance's call face widens as every face does", () => {
  test("an instance that may fail on its own beside a callback it runs is `->!` at every call", () => {
    expect(reports(
      "export record Job = { n: Int }\n" +
        "export record Checked = { n: Int }\n" +
        "constraint Run<r> =\n    run(runner: r, action: () ->! Unit) ->! Unit\n" +
        "honor Run<Job> =\n    run(job, action) = action!()\n" +
        "honor Run<Checked> =\n    run(c, action) =\n        let ok = check^(c.n)\n        action!()\n" +
        "export let a(j: Job): Unit = run(j, noop)\n" +
        "export let b(c: Checked): Unit = run(c, noop)\n" +
        "export let d(c: Checked): Unit = run!(c, noop)\n",
    )).toEqual([
      ["run(c, noop)", "this call may touch the world and may fail, so `run` wants `!`, not no mark"],
    ]);
  });
});

describe("Effects §10 (D3): a captured colour beside a constant shows the constant, and says what it follows", () => {
  test("the owner line names the colour the face follows its owner on", () => {
    const source = "export let outer(action: () ->^ Unit): Unit =\n" +
      "    let local() =\n        log~(\"x\")\n        action^()\n" +
      "    let n: Int = local\n    ()\n";
    expect(reports(source)).toEqual([["Int", "type mismatch: expected Int, found () ->! Unit"]]);
    expect(notes(source)).toEqual(["may fail as `outer`'s `action` does"]);
  });
});

describe("Effects §3.5 (D2): a call in error on one colour is checked on the other", () => {
  const source = "let finish(): Unit =\n    nope!()\n    log~(\"done\")\n";

  test("the report names only what every repair leaves true", () => {
    expect(reports(source + "export let a(): Unit = finish()\nexport let b(): Unit = finish^()\n")).toEqual([
      ["nope", "unknown name `nope`"],
      ["finish()", "this call may touch the world, so `finish` wants `~` or `!`, not no mark"],
      ["^", "this call may touch the world, so `finish` wants `!`, not `^`"],
    ]);
  });

  test("its fixit adds the known colour's part, and leaves the other as written", () => {
    expect(fixes(source + "export let a(): Unit = finish()\nexport let b(): Unit = finish^()\n")).toEqual([
      ["mark the call `~`", ["~"]],
      ["mark the call `!`", ["!"]],
    ]);
  });
});

describe("Effects §9: a report about one colour names that colour, and the arrow as written", () => {
  test("a face silent on a colour, over a body that is not", () => {
    expect(reports(
      "let quietF: () ->~ Int = () => parse^(\"1\")\n" +
        "let pureF: () -> Unit = () => log~(\"x\")\n",
    )).toEqual([
      [
        "parse^(\"1\")",
        "this call may fail, and the enclosing function's face is `->~`, which cannot fail — a face that cannot " +
          "fail cannot run a call that may, unless it handles the failure",
      ],
      [
        "log~(\"x\")",
        "this call may touch the world, and the enclosing function's face is the pure arrow `->` — a pure face " +
          "cannot run effects",
      ],
    ]);
  });

  test("§4.3's demand is the arrow written", () => {
    expect(reports("let risky(): Int = parse^(\"1\")\nlet k: () -> Int = risky\n")).toEqual([
      [
        "() -> Int",
        "a `->` arrow promises the function cannot fail, and this function may fail — the demand is written " +
          "`->`, the function's face `->!` or `>->`",
      ],
    ]);
  });

  test("the lie of generality reads the callback's own arrow, and its fix keeps what the body accepts", () => {
    expect(reports(
      "let strict(f: () -> Unit): Unit = f()\n" +
        "export let lie(cb: () ->^ Unit): Unit = strict(cb)\n",
    )).toEqual([
      [
        "cb",
        "the parameter `cb` is written `->^`, which accepts any function that touches no world, and this " +
          "accepts only one that cannot fail — write `cb`'s arrow `->`",
      ],
    ]);
  });

  test("a `>->` over a body that may fail on its own is fixed to the arrow §4.2 writes", () => {
    expect(reports("let g: (() ->^ Bool) >-> Bool = (check1) => parse^(\"1\") > 0\n")).toEqual([
      [
        "parse^(\"1\")",
        "this call may fail on its own account, and this face's `>->` promises the function is only as " +
          "effectful as what it is handed — write `->^`",
      ],
    ]);
  });

  test("the fix marks a colour a handed callback has, though the body fails only on its own", () => {
    expect(reports(
      "let h: (() ->~ Unit) >-> Unit = (f) =>\n    let n = parse^(\"1\")\n    f~()\n",
    )).toEqual([
      [
        "parse^(\"1\")",
        "this call may fail on its own account, and this face's `>->` promises the function is only as " +
          "effectful as what it is handed — write `->!`",
      ],
    ]);
  });

  test("a seat reads its contract as written: what it does more than, and what it accepts less than", () => {
    expect(reports(
      "export record R = { n: Int }\n" +
        "constraint Read<a> =\n    read(x: a) ->~ Int\n" +
        "honor Read<R> =\n    read(r) = parse^(\"1\")\n" +
        "constraint Run<a> =\n    run(x: a, action: () ->^ Unit) ->! Unit\n" +
        "let strictPure(f: () -> Unit): Unit = f()\n" +
        "honor Run<R> =\n    run(r, action) = strictPure(action)\n",
    )).toEqual([
      [
        "parse^(\"1\")",
        "this call may fail, and `read`'s contract is `->~`, which cannot fail — an instance does no more " +
          "than its contract permits — handle the failure in this body, or, if the constraint is yours, write " +
          "`->!` on the member",
      ],
      [
        "strictPure(action)",
        "`run`'s contract accepts any `action` that touches no world, and this instance accepts only one that " +
          "cannot fail — an instance accepts everything its contract promises to accept — do not narrow " +
          "`action` here, or, if the constraint is yours, write the member's `action` arrow `->`",
      ],
    ]);
  });

  test("a failed seat holds back the mark reports on the colour it condemned, and only that colour", () => {
    expect(reports(
      "export record R = { n: Int }\n" +
        "constraint Guard<a> =\n    guard(x: a, action: () ->! Unit) ->~ Unit\n" +
        "honor Guard<R> =\n    guard(r, action) = action~()\n",
    )).toEqual([
      [
        "action~()",
        "this call may fail, and `guard`'s contract is `->~`, which cannot fail — an instance does no more " +
          "than its contract permits — handle the failure in this body, or, if the constraint is yours, write " +
          "`->!` on the member",
      ],
    ]);
  });

  test("a pattern's `view` reads the head's demand, and its own face", () => {
    expect(reports(
      "export record Box = { text: String }\n" +
        "pattern number(value: Int): Box\n    view(box) = parse^(box.text)\n",
    )).toEqual([
      [
        "view(box) = parse^(box.text)",
        "a pattern's `view` is run by matching, so it is pure and cannot fail — the demand is the pattern " +
          "head's, and this function's face is `->^`",
      ],
    ]);
  });
});

describe("Lexer §8.3: `^` and `~` are marks, and the bitwise redirect where an operator would stand", () => {
  test("`x ^ 3`, `x^(3 + 1)` on a value, and `~x`", () => {
    expect(reports(
      "export let x: Int = 2\n" +
        "export let a: Int = x^(3 + 1)\n" +
        "export let b: Int = x ^ 3\n" +
        "export let c: Int = ~x\n",
    ).map(([, message]) => message)).toEqual([
      "Hexagon spells bitwise exclusive or `bxor`; a power is `**`",
      "Hexagon spells bitwise exclusive or `bxor`; a power is `**`",
      "Hexagon spells bitwise complement `bnot`",
    ]);
  });

  test("a mark not glued into its seat takes the mark-position error", () => {
    expect(reports("export let a(): Unit = log~ (\"x\")\n").map(([, message]) => message)).toEqual([
      "a call mark governs an argument list; write it immediately before `(`, or (in a `|>` stage) at the end " +
        "of the stage — a reference carries no colour",
    ]);
  });
});
