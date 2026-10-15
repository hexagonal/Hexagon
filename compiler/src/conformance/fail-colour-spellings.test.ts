import { describe, expect, test } from "vitest";

import { AnalysisSession } from "../analysis/session.js";
import { compileFiles } from "../support/test-project.js";

/**
 * Conformance for the fail colour's spellings (Effects §1–§4, §10, §13; Phase 3
 * step 8b-ii): the arrows `->^` and `->~` beside `->` and `->!`, the following
 * arrows `>->`, `>~>`, `>~>^`, `>^>` and `>^>~` (§2.2: between the `>`s the
 * colours that pass through, after them the colour done on the function's own
 * account), the call marks `^` and `~` beside bare and `!`, each colour read on
 * its own, and the places where the two colours meet: a mark and an arrow read
 * both (§3.1, §10), a face follows all its callbacks or none on each colour and
 * nothing widens to a constant (§2.4), a call in error on one colour is checked
 * on the other (§3.5), and a report about one colour names only that colour (§9).
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

/** A function that touches the world and cannot fail, and one that may fail and touches no world. */
const ONES = "let log0(): Unit = log~(\"x\")\n" +
  "let oops0(): Unit =\n    let n = parse^(\"1\")\n    ()\n";

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

/** What a hover on the binding `name` reads in words beside its type (Effects §10's gloss). */
function gloss(source: string, name: string): readonly string[] | undefined {
  const whole = text(source);
  const session = new AnalysisSession();
  session.setFile("/world.js", "");
  session.setFile("/main.hex", whole);
  return session.hover("/main.hex", whole.lastIndexOf(`let ${name}`) + 4)?.colourOwners;
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
      ["save(\"x\")", "this call is impure and may fail, so `save` wants `!`, not no mark"],
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

describe("Effects §10: an arrow shows from its two colours, each in its own state", () => {
  test("the four constants, a callback's marks, and the colours a face passes through", () => {
    const source = "export let quiet(): Unit = log~(\"x\")\n" +
      "export let risky(): Int = parse^(\"1\")\n" +
      "export let run(f: () ->~ Unit): Unit = f~()\n" +
      "export let ask(f: () ->^ Bool): Bool = f^()\n" +
      "export let both(f: () ->! Unit): Unit = f!()\n";
    expect(face(source, "quiet")).toBe("() ->~ Unit");
    expect(face(source, "risky")).toBe("() ->^ Int");
    expect(face(source, "run")).toBe("(() ->~ Unit) >~> Unit");
    expect(face(source, "ask")).toBe("(() ->^ Bool) >^> Bool");
    expect(face(source, "both")).toBe("(() ->! Unit) >-> Unit");
  });

  test("hover reads the outer arrow's two colours in words, naming the callbacks a colour follows", () => {
    const source = "export let quiet(): Unit = log~(\"x\")\n" +
      "export let calm(): Unit = noop()\n" +
      "export let timed(f: () ->! Int): Int =\n    log~(\"start\")\n    f!()\n" +
      "export let pick(f: () ->! Unit, g: () ->! Unit): Unit = f!()\n";
    expect(gloss(source, "quiet")).toEqual(["impure; cannot fail"]);
    expect(gloss(source, "calm")).toBeUndefined();
    expect(gloss(source, "timed")).toEqual(["impure; may fail only if `f` may"]);
    expect(gloss(source, "pick")).toEqual(["impure only if `f` or `g` is; may fail only if `f` or `g` may"]);
  });
});

describe("Effects §2.2, §2.4: each colour passes through, or not, on its own", () => {
  const source =
    "export record Handler = { run: () ->! Unit }\n" +
    "export let timed(f: () ->! Int): Int =\n    log~(\"start\")\n    f!()\n" +
    "export let decodeOne(s: String, item: (Int) ->! Int): Int = item!(parse^(s))\n" +
    "export let register(validate: () ->^ Bool, onEvent: () ->! Unit): Option(Handler) =\n" +
    "    if validate^() then Some(Handler({ run = onEvent })) else None\n" +
    "export let quietRun(f: () ->~ Unit, g: () ->^ Unit): Unit = f~()\n";

  test("§2.4's shapes, each spelled", () => {
    expect(face(source, "timed")).toBe("(() ->! Int) >^>~ Int");
    expect(face(source, "decodeOne")).toBe("(String, Int ->! Int) >~>^ Int");
    expect(face(source, "register")).toBe("(() ->^ Bool, () ->! Unit) >^> Option(Handler)");
    expect(face(source, "quietRun")).toBe("(() ->~ Unit, () ->^ Unit) >~> Unit");
  });

  test("a call is marked for what the callee does and what it is handed, and nothing more", () => {
    expect(reports(
      source +
        "export let t1(): Int = timed(() => 1)\n" +
        "export let t2(): Int = timed~(() => 1)\n" +
        "export let t3(): Int = timed!(() => parse^(\"1\"))\n" +
        "export let d1(): Int = decodeOne^(\"1\", (n) => n)\n" +
        "export let r1(): Option(Handler) = register(() => True, noop)\n" +
        "export let q1(): Unit = quietRun(noop, noop)\n",
    )).toEqual([
      ["timed(() => 1)", "this call is impure, so `timed` wants `~`, not no mark"],
    ]);
  });

  test("a face that follows some of the callbacks handed by then follows all of them", () => {
    expect(reports(
      "let pick(f: () ->! Unit, g: () ->! Unit) = f!()\n" +
        "let save0(): Unit = save!(\"x\")\n" +
        "export let pk(): Unit = pick(noop, save0)\n",
    )).toEqual([
      ["pick(noop, save0)", "this call is impure and may fail, so `pick` wants `!`, not no mark"],
    ]);
  });

  test("a colour no parameter holds is published silent, and the other keeps its state", () => {
    const published = ONES +
      "let ident(x: a): a = x\n" +
      "let mk3(k: () ->~ Unit, unused: () ->^ Unit) =\n" +
      "    let run = ident((f) => f!())\n    k~()\n    run!(() => ())\n";
    expect(face(published, "mk3")).toBe("(() ->~ Unit, () ->^ Unit) >~> Unit");
    expect(reports(published + "export let u(): Unit = mk3(noop, noop)\n")).toEqual([]);
  });

  test("a call's result reads as the `let` that names it does", () => {
    const made = ONES + "let mk(a: () ->! Unit) = (g) =>\n    a!()\n    g!()\n";
    expect(reports(
      made +
        "export let q1(): Unit = mk(log0)~(() => ())\n" +
        "export let q2(): Unit =\n    let r = mk(log0)\n    r~(() => ())\n" +
        "export let q3(): Unit = mk(log0)!(() => ())\n",
    )).toEqual([
      ["!", "this call cannot fail, so this call wants `~`, not `!`"],
    ]);
  });

  test("the following arrows are written, and each is checked against the body", () => {
    expect(reports(
      "let h2: (() ->~ Unit) >~>^ Unit = (f) =>\n    let n = parse^(\"1\")\n    f~()\n" +
        "let h3: (() ->! Unit) >^>~ Unit = (f) =>\n    log~(\"x\")\n    f!()\n" +
        "let h4: (() ->^ Bool) >^> Bool = (c) => c^()\n" +
        "let h5: (() ->! Unit) >~> Unit = (f) => ()\n",
    )).toEqual([]);
  });

  test("a following arrow that passes through a colour nothing handed has is refused, colour by colour", () => {
    const source = "let g1: (() ->^ Bool) >-> Bool = (c) => c^()\n" +
      "let g2: (() ->~ Unit) >~>^ Unit = (f) => f~()\n";
    // The colour with nothing to pass becomes the function's own (§4.4):
    // only its dependence on a callback cannot be true.
    expect(reports(source)).toEqual([
      [
        ">->",
        "`>->` passes the world colour through, and no callback handed by then is impure — write `>^>~`, or " +
          "`>^>` if the function is pure on its own account",
      ],
    ]);
    expect(fixes(source)).toEqual([["write `>^>~`", [">^>~"]]]);
    expect(face(source, "g1")).toBe("(() ->^ Bool) >^>~ Bool");
  });

  test("an arrow names each colour once: `>->~` is no arrow", () => {
    expect(reports("let z: (() ->! Unit) >->~ Unit = (f) => f!()\n").length).toBeGreaterThan(0);
  });
});

describe("Effects §2.4: a callback's colours live on its own arrows, what it returns included", () => {
  test("a returned arrow's mark is the callback's colour there, though the outer arrow does not mark it", () => {
    const source = ONES +
      "let run1(f: () ->~ () ->^ Unit) =\n    let inner = f~()\n    inner^()\n" +
      "let run6(f: () -> () ->! Unit) =\n    let inner = f()\n    inner!()\n";
    expect(face(source, "run1")).toBe("(() ->~ () ->^ Unit) >-> Unit");
    expect(face(source, "run6")).toBe("(() -> () ->! Unit) >-> Unit");
    expect(reports(
      source +
        "export let c1(): Unit = run1^(() => oops0)\n" +
        "export let c2(): Unit = run1(() => noop)\n" +
        "export let c6(): Unit = run6(() => noop)\n" +
        "export let c7(): Unit = run6!(() => () => save!(\"x\"))\n",
    )).toEqual([]);
  });
});

describe("Effects §13.3: a known instance's call is marked for what the instance does and what it is handed", () => {
  test("an instance that may fail on its own beside a callback it runs", () => {
    expect(reports(
      "export record Job = { n: Int }\n" +
        "export record Checked = { n: Int }\n" +
        "constraint Run<r> =\n    run(runner: r, action: () ->! Unit) ->! Unit\n" +
        "honor Run<Job> =\n    run(job, action) = action!()\n" +
        "honor Run<Checked> =\n    run(c, action) =\n        let ok = check^(c.n)\n        action!()\n" +
        "export let a(j: Job): Unit = run(j, noop)\n" +
        "export let b(c: Checked): Unit = run(c, noop)\n" +
        "export let d(c: Checked): Unit = run^(c, noop)\n",
    )).toEqual([
      ["run(c, noop)", "this call may fail, so `run` wants `^`, not no mark"],
    ]);
  });

  test("a colour the instance leaves silent stays silent, whatever its callbacks mark", () => {
    expect(reports(
      "export record Job = { n: Int }\n" +
        "constraint Run2<r> =\n    run2(runner: r, action: () ->~ Unit, check1: () ->^ Unit) ->~ Unit\n" +
        "honor Run2<Job> =\n    run2(job, action, check1) = action~()\n" +
        "export let a(j: Job): Unit = run2(j, () => (), () => ())\n" +
        "export let b(j: Job): Unit = run2~(j, () => (), () => ())\n",
    )).toEqual([
      ["~", "this call is pure, so `run2` wants no mark, not `~`"],
    ]);
  });
});

describe("Effects §10: a captured colour passes through in the display, and its owner is named", () => {
  test("the note names the owner on the colour that passes through", () => {
    const source = "export let outer(action: () ->^ Unit): Unit =\n" +
      "    let local() =\n        log~(\"x\")\n        action^()\n" +
      "    let n: Int = local\n    ()\n";
    expect(reports(source)).toEqual([["Int", "type mismatch: expected Int, found () >^>~ Unit"]]);
    expect(notes(source)).toEqual(["may fail only if `outer`'s `action` may"]);
  });
});

describe("Effects §3.5 (D2): a call in error on one colour is checked on the other", () => {
  const source = "let finish(): Unit =\n    nope!()\n    log~(\"done\")\n";

  test("the report names only what every repair leaves true", () => {
    expect(reports(source + "export let a(): Unit = finish()\nexport let b(): Unit = finish^()\n")).toEqual([
      ["nope", "unknown name `nope`"],
      ["finish()", "this call is impure, so `finish` wants `~` or `!`, not no mark"],
      ["^", "this call is impure, so `finish` wants `!`, not `^`"],
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
        "this call is impure, and the enclosing function's face is the pure arrow `->` — a pure face " +
          "cannot run effects",
      ],
    ]);
  });

  test("§4.3's demand is the arrow written", () => {
    expect(reports("let risky(): Int = parse^(\"1\")\nlet k: () -> Int = risky\n")).toEqual([
      [
        "() -> Int",
        "a `->` arrow promises the function cannot fail, and this function may fail — the demand is written " +
          "`->`",
      ],
    ]);
  });

  test("§4.3's demand at a callback's own arrow is that arrow, written", () => {
    expect(reports(
      ONES +
        "let takesF(f: () ->^ Unit): Unit = f^()\n" +
        "export let u1(): Unit = takesF(log0)\n" +
        "let takesG(g: () ->~ Unit): Unit = g~()\n" +
        "export let u2(): Unit = takesG(oops0)\n" +
        "let chk(cb: () ->^ Unit): Unit = cb^()\n" +
        "let apply(k: (() ->~ Unit) -> Unit): Unit = k(log0)\n" +
        "export let a1(): Unit = apply(chk)\n",
    )).toEqual([
      [
        "takesF(log0)",
        "a `->^` arrow promises purity, and this function is impure — the demand is written " +
          "`->^`",
      ],
      [
        "takesG(oops0)",
        "a `->~` arrow promises the function cannot fail, and this function may fail — the demand is written " +
          "`->~`",
      ],
      [
        "apply(chk)",
        "a `->^` arrow promises purity, and this function is impure — the demand is written " +
          "`->^`",
      ],
    ]);
  });

  test("a demand and its reverse at one span are two reports, and so are two arrows at one span", () => {
    expect(reports("let arr2(a: Array(() ->~ Unit)): Array(() ->^ Unit) = a\n")).toEqual([
      [
        "Array(() ->^ Unit)",
        "a `->^` arrow promises purity, and this function is impure — the demand is written " +
          "`->^`",
      ],
      [
        "Array(() ->^ Unit)",
        "this position's arrow says the function may fail, and the arrow meeting it, which cannot fail, was " +
          "fixed before it arrived — by another use, by a type written where it was made, inside an argument " +
          "read invariantly, or in a parameter's type — so it cannot fit as a function used here does; write " +
          "the arrow where it was fixed",
      ],
    ]);
    expect(reports(ONES + "let pairF: (() ->^ Unit, () ->~ Unit) = (log0, oops0)\n")).toEqual([
      [
        "(() ->^ Unit, () ->~ Unit)",
        "a `->^` arrow promises purity, and this function is impure — the demand is written " +
          "`->^`",
      ],
      [
        "(() ->^ Unit, () ->~ Unit)",
        "a `->~` arrow promises the function cannot fail, and this function may fail — the demand is written " +
          "`->~`",
      ],
    ]);
  });

  test("one call that acts on its own account on one colour and runs a captured colour on the other", () => {
    // Each colour's report names every colour refused on the arrow, so the
    // two fixits agree, with each other and with what the arrow reads as.
    expect(reports(
      "export let outer(action: () ->^ Unit): Unit =\n" +
        "    let local() =\n        log~(\"x\")\n        action^()\n" +
        "    let h: (() ->! Unit) >-> Unit = (f) =>\n        local!()\n        f!()\n" +
        "    h!(noop)\n",
    )).toEqual([
      [
        "local!()",
        "this call is impure on its own account, and this face's `>->` promises the function is only " +
          "as effectful as what it is handed — write `->!`",
      ],
      [
        "local!()",
        "this call runs `outer`'s `action`, which this signature is not handed, and this face's `>->` promises " +
          "the function is only as effectful as what it is handed — write `->!`",
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
        "the parameter `cb` is written `->^`, which accepts any function that is pure, and this " +
          "accepts only one that cannot fail — write `cb`'s arrow `->`",
      ],
    ]);
  });

  test("a following arrow over a body that may fail on its own is fixed to the arrow §4.2 writes", () => {
    expect(reports("let g: (() ->^ Bool) >^> Bool = (check1) => parse^(\"1\") > 0\n")).toEqual([
      [
        "parse^(\"1\")",
        "this call may fail on its own account, and this face's `>^>` promises the function is only as " +
          "effectful as what it is handed — write `->^`",
      ],
    ]);
  });

  test("the fix names the colour the body acts on, and keeps passing the other through", () => {
    // From outside the refused arrow reads as its fix, `>~>^`, colour by colour:
    // a caller handing a pure callback wears `^` alone.
    expect(reports(
      "let h: (() ->! Unit) >-> Unit = (f) =>\n    let n = parse^(\"1\")\n    f!()\n" +
        "export let c(): Unit = h^(noop)\n",
    )).toEqual([
      [
        "parse^(\"1\")",
        "this call may fail on its own account, and this face's `>->` promises the function is only as " +
          "effectful as what it is handed — write `>~>^`",
      ],
    ]);
  });

  test("a refusal that leaves no colour passing through reads as the constant its fix writes", () => {
    const refused = [
      ">^>",
      "`>^>` passes the fail colour through, and no callback handed by then may fail — write `->^`, or `->` if " +
        "the function cannot fail on its own account",
    ];
    expect(reports("let h4: (() ->~ Unit) >^> Unit = (f) => f~()\n")).toEqual([
      refused,
      [
        "f~()",
        "this callback is written `->~`, which accepts any function that cannot fail, and this accepts only a " +
          "pure one — write its arrow `->`",
      ],
    ]);
    expect(reports("let h6: (() ->~ Unit) >^> Unit = (f) => log~(\"x\")\n")).toEqual([
      refused,
      [
        "log~(\"x\")",
        "this call is impure, and the enclosing function's face is `->^`, which is pure — a pure face cannot run " +
          "effects",
      ],
    ]);
  });

  test("a refused arrow reads as its fix: a colour nothing handed has is the function's own before the body is read", () => {
    const source = "let h: (() ->~ Unit) >-> Unit = (f) =>\n    let n = parse^(\"1\")\n    f~()\n" +
      "export let c(): Unit = h^(noop)\n";
    expect(reports(source)).toEqual([
      [
        ">->",
        "`>->` passes the fail colour through, and no callback handed by then may fail — write `>~>^`, or `>~>` " +
          "if the function cannot fail on its own account",
      ],
    ]);
    expect(face(source, "h")).toBe("(() ->~ Unit) >~>^ Unit");
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
        "`run`'s contract accepts any `action` that is pure, and this instance accepts only one that " +
          "cannot fail — an instance accepts everything its contract promises to accept — do not narrow " +
          "`action` here, or, if the constraint is yours, write the member's `action` arrow `->`",
      ],
    ]);
  });

  test("a seat whose contract is `->^` says the contract is pure", () => {
    expect(reports(
      "export record R = { n: Int }\n" +
        "constraint Read<a> =\n    read(x: a) ->^ Int\n" +
        "honor Read<R> =\n    read(r) =\n        log~(\"x\")\n        1\n",
    )).toEqual([
      [
        "log~(\"x\")",
        "this call is impure, and `read`'s contract is `->^`, which is pure — an instance does no " +
          "more than its contract permits — keep this body pure, or, if the constraint is yours, write `->!` on " +
          "the member",
      ],
    ]);
  });

  test("an extern `let` of a function type is advised as the `fun` its own arrow spells", () => {
    expect(reports(
      "extern from \"./world.js\"\n" +
        "    export let p: (String) ->^ Int\n" +
        "    export let q: (String) ->~ Unit\n",
    ).map(([, message]) => message.slice(message.lastIndexOf(")") + 1))).toEqual([" ->^ Int`", " ->~ Unit`"]);
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

describe("Effects §3.4: a refused tie reads as its fix, on each colour", () => {
  test("the fix marks only a colour the claims leave the parameter's own", () => {
    const tied = "let t3(f: () ->~ Unit, g) =\n    let h = if True then f else g\n    h~()\n";
    expect(reports(tied)).toEqual([
      [
        "if True then f else g",
        "`g`'s colour is tied to `f`'s here, and no written type can say that — write `g`'s type",
      ],
    ]);
    expect(fixes(tied)).toEqual([["write `g`'s type", [": () ->~ Unit"]]]);
    expect(reports(tied.replace("g) =", "g: () ->~ Unit) ="))).toEqual([]);
  });

  test("the reading from outside is the fixed function's face, so its callers meet what the fix gives", () => {
    const tied = "let t5(f: () ->^ Unit, g) =\n    g^()\n    let h = if True then f else g\n    h^()\n" +
      "export let c1(): Unit = t5(noop, noop)\n";
    const fixed = tied.replace("g) =", "g: () ->^ Unit) =");
    expect(fixes(tied)).toEqual([["write `g`'s type", [": () ->^ Unit"]]]);
    expect(face(tied, "t5")).toBe("(() ->^ Unit, () ->^ Unit) >^> Unit");
    expect(face(fixed, "t5")).toBe("(() ->^ Unit, () ->^ Unit) >^> Unit");
    expect(reports(tied).map(([, message]) => message)).toEqual([
      "`g`'s colour is tied to `f`'s here, and no written type can say that — write `g`'s type",
    ]);
    expect(reports(fixed)).toEqual([]);
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

  test("glued between two operands, `^` and `~` stand where an operator would", () => {
    expect(reports(
      "export let x: Int = 2\n" +
        "export let b: Int = 3\n" +
        "export let p: Int = x^2\n" +
        "export let q: Int = x^b\n",
    ).map(([, message]) => message)).toEqual([
      "Hexagon spells bitwise exclusive or `bxor`; a power is `**`",
      "Hexagon spells bitwise exclusive or `bxor`; a power is `**`",
    ]);
    expect(reports("export let x: Int = 2\nexport let b: Int = 3\nexport let r: Int = x~b\n")[0]).toEqual([
      "~",
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

describe("Effects §4.4: a refusal's fix removes only the part of the claim that cannot be true", () => {
  test("in every position, a colour passed through with nothing to pass is the constant, and the rest stay as written", () => {
    const source = "record R = { f: () >^> Unit }\n" +
      "type Al = () >~> Unit\n" +
      "let c1(k: () >^> Unit): Unit = k^()\n" +
      "let c2(k: (() >^> Unit) -> Unit): Unit = k(noop)\n" +
      "let c3: (Int) >^> Int = (n) => n\n" +
      "let c4(x: Int): Int =\n    let g: () >~> Unit = () => ()\n    x\n" +
      "extern from \"./world.js\"\n    export fun each(n: Int) >^> Int\n";
    const nothing = (arrow: string) => `\`${arrow}\` means only as effectful as what it is handed, and nothing is handed here — `;
    const caret = "; write `->^` for a function that is pure and may fail, or `->` for one that is pure and cannot fail";
    const unhanded = "no callback of this signature has been handed over by the time this arrow runs";
    expect(reports(source)).toEqual([
      [">^>", nothing(">^>") + "a `record` field is data, not a signature" + caret],
      [
        ">~>",
        nothing(">~>") + "an alias is a type fragment, not a signature; write `->~` for a function that is impure " +
          "and cannot fail, or `->` for one that is pure and cannot fail",
      ],
      [
        ">^>",
        "a callback's arrow says what the function accepts, and the function follows it — `->^` accepts any " +
          "function that is pure, and `->` one that is pure and cannot fail",
      ],
      [">^>", nothing(">^>") + "an arrow inside a parameter type, other than a callback's own, is a constant" + caret],
      [">^>", nothing(">^>") + unhanded + caret],
      [
        ">~>",
        nothing(">~>") + "this annotation has no callbacks of its own, and a local `>~>` does not borrow the " +
          "enclosing function's — leave its type to inference, or write `->~`",
      ],
      [
        ">^>",
        nothing(">^>") + unhanded + caret +
          " — write the callback parameter this row runs, with `->^`, or write `->^` on the row",
      ],
    ]);
    expect(fixes(source).map(([, edits]) => edits)).toEqual([["->^"], ["->~"], ["->^"], ["->^"], ["->^"], ["->~"], ["->^"]]);
    // A callback's own arrow reads as the constant's marks: `k` may fail and is pure.
    expect(face(source, "c1")).toBe("(() ->^ Unit) >^> Unit");
    // A refused callback arrow carries the callback's colour only where its constant marks.
    expect(reports("let c5(k: () >^> () ->~ Unit): Unit =\n    let r = k^()\n    r~()\n").map(([at]) => at))
      .toEqual([">^>"]);
    // An alias reads as its constant wherever it is used: `k` is impure and cannot fail.
    expect(reports("type Al = () >~> Unit\nlet useAl(k: Al): Unit = k~()\n").map(([at]) => at)).toEqual([">~>"]);
  });
});

describe("Effects §2.4, §3.4: an untyped callback's own arrows are decided one by one", () => {
  test("a call through the function an untyped callback returns claims that arrow's colour alone", () => {
    const source = ONES +
      "let once(g) =\n    let k = g()\n    k^()\n" +
      "let twice(g) =\n    let k = g~()\n    k^()\n" +
      "export let v1(): Unit = once^(() => oops0)\n" +
      "export let v2(): Unit = once(() => noop)\n";
    expect(reports(source)).toEqual([]);
    expect(face(source, "once")).toBe("(() -> () ->^ a) >^> a");
    expect(face(source, "twice")).toBe("(() ->~ () ->^ a) >-> a");
    // A world-only program: the arrows a bare call read stay pure, three deep.
    const deep = "let deep(g) =\n    let a = g()\n    let b = a()\n    b~()\n";
    expect(reports(deep)).toEqual([]);
    expect(face(deep, "deep")).toBe("(() -> () -> () ->~ a) >~> a");
  });

  test("a tie's fix marks each own arrow on its own colours, and the report stands at the merge", () => {
    const body = (f: string, g: string, call: string) =>
      `(f: ${f}, g${g}) =\n    let h = if True then f else g\n    let k = h${call}()\n    k^()\n`;
    const tied = "let tq" + body("() -> () ->^ Unit", "", "") + "let tw" + body("() ->~ () ->^ Unit", "", "~");
    const written = "let tq" + body("() -> () ->^ Unit", ": () -> () ->^ Unit", "") +
      "let tw" + body("() ->~ () ->^ Unit", ": () ->~ () ->^ Unit", "~");
    const callers = "export let u1(): Unit = tq^(() => oops0, () => noop)\n" +
      "export let u2(): Unit = tw(() => noop, () => noop)\n";
    const message = "`g`'s colour is tied to `f`'s here, and no written type can say that — write `g`'s type";
    expect(reports(ONES + tied + callers)).toEqual([
      ["if True then f else g", message],
      ["if True then f else g", message],
    ]);
    expect(fixes(ONES + tied + callers).map(([, edits]) => edits)).toEqual([
      [": () -> () ->^ Unit"],
      [": () ->~ () ->^ Unit"],
    ]);
    // The fix is a repair, and the refused parameters read as it from outside.
    expect(reports(ONES + written + callers)).toEqual([]);
    expect(face(ONES + tied + callers, "tq")).toBe("(() -> () ->^ Unit, () -> () ->^ Unit) >^> Unit");
  });
});

describe("Effects §3.4: only a value made from a parameter passes a mark on to it (#1261)", () => {
  test("a function that runs the callback is no value made from it: the calls in its body decide", () => {
    // `run!()` is a mark on `run`, checked against what `run`'s body does;
    // the bare `g()` inside is the call that reaches `g`.
    const source = "let h2(g, f) =\n    let run = () =>\n        g()\n        f!()\n    run!()\n" +
      "let hl(g) =\n    let run = () =>\n        let k = g()\n        k~()\n    run~()\n";
    expect(reports(source)).toEqual([]);
    expect(face(source, "h2")).toBe("(() -> Unit, () ->! a) >-> a");
    expect(face(source, "hl")).toBe("(() -> () ->~ a) >~> a");
  });

  test("where the two disagree, the outer mark is the wrong one", () => {
    const over = (callee: string) => [
      "!",
      `this call is pure and cannot fail, so ${callee} wants no mark, not \`!\``,
    ];
    expect(reports(
      "let y(g) =\n    let run = () => g()\n    run!()\n" +
        "let nf(g) =\n    let run() = g()\n    run!()\n" +
        "let inplace(g) =\n    (() => g())!()\n",
    )).toEqual([over("`run`"), over("`run`"), over("this call")]);
  });

  test("a function handed on is no value made from the callback its body runs", () => {
    const twice = "let twice(h: () ->~ Unit) =\n    h~()\n    h~()\n";
    expect(reports(twice + "let hand(g) = twice~(() => g())\n")).toEqual([
      ["~", "this call is pure, so `twice` wants no mark, not `~`"],
    ]);
    expect(face(twice + "let hand(g) = twice(() => g())\n", "hand")).toBe("(() -> Unit) -> Unit");
    // An extern row is a function a declaration defines, and an alias of a
    // lambda is that lambda.
    expect(reports(
      "extern from \"./world.js\"\n    export fun each(f: () ->! Unit) >-> Unit\n" +
        "let viaExtern(g) = each!(() => g())\n" +
        "let viaAlias(g) =\n    let run = () => g()\n    let k = run\n    k!()\n",
    )).toEqual([
      ["!", "this call is pure and cannot fail, so `each` wants no mark, not `!`"],
      ["!", "this call is pure and cannot fail, so `k` wants no mark, not `!`"],
    ]);
    // A dot call is the bare call (Method Syntax §7): its method is a function
    // a declaration defines, and the lambda it is handed runs `g` bare.
    expect(reports(
      "let viaDot(g) = Some(1).map!((x) => g())\nlet viaBare(g) = Option.map!(Some(1), (x) => g())\n",
    )).toEqual([
      ["!", "this call is pure and cannot fail, so `.map` wants no mark, not `!`"],
      ["!", "this call is pure and cannot fail, so `map` wants no mark, not `!`"],
    ]);
  });

  test("a value made only from lambdas is no value made from the callback: a merge, a call's result, a part", () => {
    const over = (callee: string) => [
      "!",
      `this call is pure and cannot fail, so ${callee} wants no mark, not \`!\``,
    ];
    expect(reports(
      "let pq(g, c: Bool) =\n    let (r, n) = if c then (() => g(), 1) else (() => g(), 2)\n    r!()\n" +
        "let lid(g) =\n    let idl = (x) => x\n    idl(() => g())!()\n",
    )).toEqual([over("`r`"), over("this call")]);
    expect(reports(
      "let mg(g, c: Bool) =\n    let run = if c then () => g() else () => g()\n    run!()\n" +
        "let mk(g) =\n    let m = () => () => g()\n    m()!()\n" +
        "let pp(g) =\n    let pair = (() => g(), 1)\n    let (r, n) = pair\n    r!()\n" +
        "let fr2(g) =\n    let r = { run = () => g() }\n    r.run!()\n",
    )).toEqual([over("`run`"), over("this call"), over("`r`"), over("`.run`")]);
    // The ruling's own shape, behind a merge and behind a call, as written
    // types would have it.
    const hidden = "let e1(g, f, c: Bool) =\n    let run =\n        if c then\n            () =>\n" +
      "                g()\n                f!()\n        else\n            () => f!()\n    run!()\n" +
      "let e2(g, f) =\n    let m = () => () =>\n        g()\n        f!()\n    m()!()\n";
    expect(reports(hidden)).toEqual([]);
    expect(face(hidden, "e2")).toBe("(() -> Unit, () ->! a) >-> a");
    // What `idf` returns is its parameter, which stands for the lambda handed;
    // what `get` returns is `g`. A dot call's receiver made from `g` hands it
    // on, and its method is the bare call's function.
    expect(reports(
      "let idf(x: t): t = x\nlet viaId(g) = idf(() => g())!()\n" +
        "let ret2(g) =\n    let get = () => g\n    g()\n    get()!()\n" +
        "let f1(g) = Some(g).map!((h) => h())\nlet f2(g) = Option.map!(Some(g), (h) => h())\n",
    )).toEqual([
      over("this call"),
      ["g()", "this call is impure and may fail, so `g` wants `!`, not no mark"],
      over("`.map`"),
      over("`map`"),
    ]);
  });

  test("what a call returns: a function written in the body by what it returns, any other by its signature", () => {
    // `mk` returns a lambda whatever it is handed, and `apply`, a declared
    // function with a written type, is no value made from a parameter.
    const mk = (parameter: string, argument: string) =>
      `    let mk = (${parameter}) => () =>\n        g()\n        f!()\n    mk(${argument})!()\n`;
    const accepted = "let oc(g, f, n: Int) =\n" + mk("k: Int", "n") + "let td(g, f) =\n" + mk("k", "f") +
      "let apply: (() ->! Unit) >-> Unit = (h) => h!()\n" +
      "let wa(g, f) =\n    apply!(() =>\n        g()\n        f!())\n";
    expect(reports(accepted)).toEqual([]);
    expect(face(accepted, "wa")).toBe("(() -> Unit, () ->! Unit) >-> Unit");
    // A lambda taken out of a tuple returns `g`; `pick`, declared outside the
    // body, is read by its signature and may return `h`.
    expect(reports(
      "let up(g) =\n    let (r, n) = (() => g, 1)\n    g()\n    r()!()\n" +
        "let pick(x: a, y: a): a = x\nlet pk(g, h) = pick(() => g(), h)!()\n" +
        "let ident2(x: a, n: Int): a = x\nlet vi2(g, n: Int) = ident2(() => g(), n)!()\n",
    )).toEqual([
      ["g()", "this call is impure and may fail, so `g` wants `!`, not no mark"],
      ["pick(() => g(), h)", "`h`'s colour is tied to `g`'s here, and no written type can say that — write `h`'s type"],
      ["g()", "`g`'s colour is tied to `h`'s here, and no written type can say that — write `g`'s type"],
      ["g()", "this call is impure and may fail, so `g` wants `!`, not no mark"],
      // `n` holds no arrow, so `ident2` cannot return a value made from it.
      ["!", "this call is pure and cannot fail, so this call wants no mark, not `!`"],
    ]);
  });

  test("the parameter itself, an alias of it, and the parameter handed on still take the mark", () => {
    const source = "let twice(h: () ->~ Unit) =\n    h~()\n    h~()\n" +
      "let z(g) =\n    g()\n    g!()\n" +
      "let al(g) =\n    let k = g\n    k!()\n" +
      "let only(g) =\n    let run = () => g!()\n    run()\n" +
      "let handG(g) = twice~(g)\n" +
      "let ret(g) =\n    let get = () => g\n    get()!()\n" +
      "let ap2(f) =\n    let k = f()\n    k~()\nlet use1(g) =\n    ap2~(g)\n    g()()\n" +
      "let mBlock(g) =\n    let run =\n        let x = g\n        x\n    g()\n    run!()\n" +
      "let mIfAlt(g, c: Bool) =\n    let run = if c then () => () else g\n    g()\n    run!()\n" +
      "let mAccess(g) =\n    let r = { run = g }\n    g()\n    r.run!()\n" +
      "let hd(g) =\n    g()\n    Some(g).defaultValue(() => ())!()\n";
    // A function that returns `g` returns a value made from it; and a mark on
    // a call handed `g` claims the arrows of what `g` returns too.
    expect(reports(source)).toEqual([
      ["g()", "this call is impure and may fail, so `g` wants `!`, not no mark"],
      ["run()", "this call is impure and may fail, so `run` wants `!`, not no mark"],
      ["g()()", "this call is impure, so this call wants `~`, not no mark"],
      // A block's value, a merge's other arm, a field, and a dot call's
      // receiver each carry the mark to `g`.
      ["g()", "this call is impure and may fail, so `g` wants `!`, not no mark"],
      ["g()", "this call is impure and may fail, so `g` wants `!`, not no mark"],
      ["g()", "this call is impure and may fail, so `g` wants `!`, not no mark"],
      ["g()", "this call is impure and may fail, so `g` wants `!`, not no mark"],
    ]);
    expect(face(source, "ret")).toBe("(() ->! a) >-> a");
    expect(face(source, "al")).toBe("(() ->! a) >-> a");
    expect(face(source, "handG")).toBe("(() ->~ Unit) >~> Unit");
  });
});

describe("Effects §4.2: a following arrow's silent colour, and a value meeting it", () => {
  test("a body acting on a colour the arrow leaves silent takes the silent face's words, and pins no callback", () => {
    const source = ONES +
      "let w5: (() ->! Unit) >^> Unit = (f) =>\n    log~(\"x\")\n    f!()\n" +
      "let r5(): (() ->! Unit) >^> Unit = (f) =>\n    log~(\"x\")\n    f!()\n" +
      "export let k1(): Unit = w5!(() => save!(\"x\"))\n" +
      "export let k2(): Unit = r5()!(() => save!(\"x\"))\n";
    const silent = "this call is impure, and the enclosing function's face is `>^>`, which is pure — a pure face " +
      "cannot run effects — write `>^>~`";
    expect(reports(source)).toEqual([["log~(\"x\")", silent], ["log~(\"x\")", silent]]);
    expect(fixes(source).map(([, edits]) => edits)).toEqual([[">^>~"], [">^>~"]]);
    expect(face(source, "w5")).toBe("(() ->! Unit) >^>~ Unit");
  });

  test("a value following a callback on a colour the arrow leaves silent: the fix passes it through, and the arrow reads so", () => {
    const source = ONES +
      "let both(f: () ->! Unit) = f!()\n" +
      "let h2: (() ->! Unit) >^> Unit = both\n" +
      "export let c2(): Unit = h2~(log0)\n";
    expect(reports(source)).toEqual([[
      "both",
      "this function is impure where what it is handed is, and this face's `>^>` is pure there — write `>->`, " +
        "which passes that through",
    ]]);
    expect(fixes(source).map(([, edits]) => edits)).toEqual([[">->"]]);
    expect(face(source, "h2")).toBe("(() ->! Unit) >-> Unit");
  });

  test("a binding annotation over a named function reads a refused arrow as its fix", () => {
    const source = "let timed(f: () ->! Unit) =\n    log~(\"x\")\n    f!()\n" +
      "let h3: (() ->! Unit) >-> Unit = timed\n" +
      "export let c4(): Unit = h3~(noop)\n";
    expect(reports(source)).toEqual([[
      "timed",
      "this function is impure on its own account, and this face's `>->` promises the function is only as " +
        "effectful as what it is handed — write `>^>~`",
    ]]);
    expect(face(source, "h3")).toBe("(() ->! Unit) >^>~ Unit");
  });

  test("the lie of generality drops the colour from a following arrow that followed only that callback", () => {
    const source = "let tp(k: () ->^ Unit) = k^()\nlet g1: (() ->! Unit) >-> Unit = (f) => tp^(f)\n";
    expect(fixes(source)).toEqual([["write `->^`", ["->^", ">^>"]]]);
    expect(face(source, "g1")).toBe("(() ->^ Unit) >^> Unit");
    // An arrow that leaves the colour silent is no part of the repair.
    expect(fixes("let tp(k: () ->^ Unit) = k^()\nlet g3: (() ->! Unit) >^> Unit = (f) => tp^(f)\n"))
      .toEqual([["write `->^`", ["->^"]]]);
  });
});

describe("Effects §13.2: a seat names the contract's arrow as written", () => {
  test("its advice moves each colour concerned to the member's own account, and keeps the rest", () => {
    const seat = (member: string, arrow: string, callback: string, body: string) =>
      `constraint C${member}<r> =\n    ${member}(runner: r, action: () ${callback} Unit) ${arrow} Unit\n` +
      `honor C${member}<Job> =\n    ${member}(job, action) =\n        ${body}\n        action${callback.slice(2)}()\n`;
    expect(reports(
      "export record Job = { n: Int }\n" +
        seat("thr", ">^>", "->^", "log~(\"x\")") +
        seat("own", ">^>~", "->^", "let n = parse^(\"1\")") +
        seat("run", ">->", "->!", "log~(\"x\")"),
    ).map(([, message]) => message)).toEqual([
      "this call is impure, and `thr`'s contract is `>^>`, which is pure — an instance does no more than its " +
        "contract permits — keep this body pure, or, if the constraint is yours, write `>^>~` on the member",
      "this call may fail on its own account, and `own`'s contract is `>^>~` — an instance is only as effectful as " +
        "what it is handed — move the effect behind a callback, or, if the constraint is yours, write `->!` on the " +
        "member",
      "this call is impure on its own account, and `run`'s contract is `>->` — an instance is only as effectful as " +
        "what it is handed — move the effect behind a callback, or, if the constraint is yours, write `>^>~` on " +
        "the member",
    ]);
    // In the result position, the silent colour is named too.
    expect(reports(
      "export record J = { n: Int }\nconstraint D<r> =\n    d1(x: r) -> ((() ->! Unit) >^> Unit)\n" +
        "honor D<J> =\n    d1(j) = (f) =>\n        log~(\"x\")\n        f!()\n",
    ).map(([, message]) => message)).toEqual([
      "the function this instance returns is impure, and `d1`'s contract returns a `>^>` function, which is pure — " +
        "an instance does no more than its contract permits — keep this body pure, or, if the constraint is yours, " +
        "write `>^>~` on the arrow the contract returns",
    ]);
  });
});

describe("Effects §10: the gloss names every callback it can", () => {
  test("an untyped callback, and a lambda's parameter under a binding annotation, are named", () => {
    const source = "let runU(f) = f!()\n" +
      "let mixed(g: () ->! Unit, f) =\n    g!()\n    f!()\n" +
      "let hA: (() ->^ Unit) >^> Unit = (f) => f^()\n";
    expect(gloss(source, "runU")).toEqual(["impure only if `f` is; may fail only if `f` may"]);
    expect(gloss(source, "mixed")).toEqual(["impure only if `g` or `f` is; may fail only if `g` or `f` may"]);
    expect(gloss(source, "hA")).toEqual(["pure; may fail only if `f` may"]);
    // A named callback beside an unnamed one: the gloss names what it can.
    expect(gloss("let hB: (() ->! Unit, () ->! Unit) >-> Unit = (f, _) => f!()\n", "hB"))
      .toEqual(["impure only if `f` or what it is handed is; may fail only if `f` or what it is handed may"]);
    // A copy is instantiated, and its callbacks' names stay with the original.
    expect(gloss("let both(f: () ->! Unit) = f!()\nlet copy = both\n", "copy"))
      .toEqual(["impure only if what it is handed is; may fail only if what it is handed may"]);
  });

  test("completion detail glosses a face in a module with no callback colour", () => {
    const whole = text("let save0(): Unit = save!(\"x\")\nlet probe: Int = 1\n");
    const session = new AnalysisSession();
    session.setFile("/world.js", "");
    session.setFile("/main.hex", whole);
    const offered = session.completions("/main.hex", whole.length - 1).find(({ name }) => name === "save0");
    expect(offered?.detail).toBe("() ->! Unit — impure; may fail");
  });
});

describe("Effects §13.3: a `widens` door under a following member wears what it passes through", () => {
  const lib = (arrow: string) => "module Lib\n\n" +
    `export constraint R<a> =\n    run(s: a, n: Int, action: () ->! Unit) ${arrow} Unit\n`;
  const main = (body: string, calls: string) => "module Main\n\nimport Lib\n\n" + WORLD +
    "export record P = { name: String }\n" +
    `widens Lib.run(s: P, n: BigInt, action: () ->! Unit): Unit = ${body}\n` +
    "honor Lib.R<P> =\n    run = widened\n" + calls;
  const messages = (arrow: string, body: string, calls: string) =>
    compileFiles([["/lib.hex", lib(arrow)], ["/main.hex", main(body, calls)], ["/world.js", ""]])
      .diagnostics.map(({ message }) => message);

  test("a colour the member passes through is the callbacks' join at the door", () => {
    expect(messages(">->", "action!()",
      "export let a(p: P): Unit = run(p, 2n, noop)\n" +
        "export let b(p: P): Unit = run!(p, 2n, () => save!(\"x\"))\n")).toEqual([]);
  });

  test("a colour the member leaves silent is silent at the door, whatever the callbacks do", () => {
    expect(messages(">^>", "()", "export let a(p: P, cb: () ->! Unit): Unit = run^(p, 2n, cb)\n")).toEqual([]);
  });
});
