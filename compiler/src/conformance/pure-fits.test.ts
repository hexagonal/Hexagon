import { describe, expect, test } from "vitest";

import { AnalysisSession } from "../analysis/session.js";
import { compileFiles } from "../support/test-project.js";

/**
 * Conformance for **a pure function fits wherever a function is expected**
 * (#1119): Effects §2.6, §3.4, §4.2, §4.3.
 *
 * Each use of a pure function reads its outer arrow as a fresh colour, which
 * ordinary unification then decides: a `->?` makes it that variable, a `->!`
 * the impure constant, a `->` pure, and a colour only pure functions reached is
 * pure again where it settles. The function's own colour is untouched — it is
 * what its body does (§2.6, #947) — so hover still shows `->`. The ruling's
 * refinements, each pinned below:
 *
 * - R.a: `->!` positions accept a pure function too;
 * - R.b: only a colour the program's text decides is re-opened — a function's
 *   own, a written type, a name no local binding introduces, a value made only
 *   from these and settled where it is bound — so a parameter with no written
 *   type, a `var`, and whatever is made from one are inferred from all their
 *   uses together, in whatever order they come;
 * - R.c: the outermost arrow only — a value already built keeps its type;
 * - a written face may claim more effect than its body performs, never less:
 *   `->` is an exact promise, `->!` and `->?` allowances (ruling (c), in place
 *   of R.d).
 */

const HEADER = "module Main\n\n";
const FIXTURES =
  'extern from "./world.js"\n    export fun save(document: String) ->! Unit\n' +
  'let save0(): Unit = save!("x")\n' +
  "let noop(): Unit = ()\n" +
  "export let apply2(f: () ->! Unit, g: () ->! Unit): Unit =\n    f!()\n    g!()\n" +
  "export let pureOnly(f: () -> Unit): Unit = f()\n" +
  "export let impureOnly(f: () ->! Unit): Unit = f!()\n" +
  // Two values of one type: their colours meet, as `apply2`'s callbacks' do not.
  "export let tieTwo(x: a, y: a): Unit = ()\n";

const files = (source: string): [string, string][] => [
  ["/main.hex", HEADER + FIXTURES + source],
  ["/world.js", ""],
];

/** Each report as `[the text its primary spans, its message]`. */
function reports(source: string): readonly (readonly [string, string])[] {
  const text = HEADER + FIXTURES + source;
  return compileFiles(files(source)).diagnostics.map(({ primary, message }) =>
    [text.slice(primary.start.offset, primary.end.offset), message] as const
  );
}

/** What a hover at the last place `needle` is written shows as the type there. */
function hovered(source: string, needle: string): string | undefined {
  const text = HEADER + FIXTURES + source;
  const session = new AnalysisSession();
  session.setFile("/world.js", "");
  session.setFile("/main.hex", text);
  return session.hover("/main.hex", text.lastIndexOf(needle))?.displayedType;
}

/** §4.2's lie of generality at `action`, the callback every R.b witness below ties a value to. */
const SOLVED_PURE = "the parameter `action` is written `->!`, which accepts any function, and this " +
  "accepts only a pure one — write `action`'s arrow `->`";
const SOLVED_IMPURE = "this signature's `->?` promises a colour the caller chooses, but the body " +
  "solves it to the impure constant — a function that performs its own unconditional effects " +
  "rounds up, and its face is `->!`";
const PURITY = "a `->` arrow promises purity, and this function may touch the world — the demand " +
  "is written `->`, the function's face `->!` or `->?`";
const FIXED_BEFORE = "this position's arrow is the impure constant, and the pure `->` meeting it " +
  "was fixed before it arrived — inside a value already built, or by another use — so it " +
  "cannot fit as a function used here does; write the arrow where it was fixed";

describe("a pure function fits wherever a function is expected (#1119)", () => {
  test("beside a callback, where a callee's `->?` is shared", () => {
    for (const other of ["() => ()", "noop"]) {
      for (const call of [`apply2!(action, ${other})`, `apply2!(${other}, action)`]) {
        const source = `export let outer(action: () ->! Unit): Unit = ${call}\n`;
        expect([call, reports(source)]).toEqual([call, []]);
        expect(hovered(source, "outer(")).toBe("(() ->! Unit) ->? Unit");
      }
    }
  });

  test("at a monomorphic `->?`, seen from inside its body", () => {
    const source = "export let outer(g: (() ->! String) -> String): String = g((): String => \"x\")\n";
    expect(reports(source)).toEqual([]);
    expect(hovered(source, "outer(")).toBe("((() ->! String) -> String) -> String");
  });

  test("on a path of a form, beside a callback — no written face needed", () => {
    for (const form of ["if flag then action else () => ()", "if flag then () => () else action"]) {
      const source = `export let outer(action: () ->! Unit, flag: Bool): () ->? Unit =
    let h = ${form}
    h!()
    h
`;
      expect([form, reports(source)]).toEqual([form, []]);
      expect(hovered(source, "h!(")).toBe("() ->? Unit");
    }
  });

  test("at a `->!` field and a `->!` parameter (R.a)", () => {
    expect(reports(`export record Holder = { run: () ->! Unit }
export let make(): Holder = Holder({ run = () => () })
`)).toEqual([]);
    // A callback written `->!` has a colour of its own, so a pure argument
    // makes the call bare; the constant stands under a constructor (§2.4).
    expect(reports(`export let run(action: () ->! Unit): Unit = action!()
export let go(): Unit =
    run(() => ())
    run(noop)
`)).toEqual([]);
    expect(reports(`export let runOne(o: Option(() ->! Unit)): Unit =
    match o
        Some(f) => f!()
        None => ()
export let go(): Unit =
    runOne!(Some(() => ()))
    runOne!(Some(noop))
`)).toEqual([]);
  });

  test("merged with an effectful function, in either order, the merge is effectful", () => {
    for (const form of ["if flag then save0 else () => ()", "if flag then () => () else save0"]) {
      const source = `export let go(flag: Bool): Unit =
    let h = ${form}
    h!()
`;
      expect([form, reports(source)]).toEqual([form, []]);
      expect(hovered(source, "h!(")).toBe("() ->! Unit");
    }
    for (const elements of ["[save0, () => ()]", "[() => (), save0]", "[noop, save0]"]) {
      const source = `export let go(): Int =\n    let hs = ${elements}\n    Vector.length(hs)\n`;
      expect([elements, reports(source)]).toEqual([elements, []]);
      expect(hovered(source, "hs =")).toBe("Vector(() ->! Unit)");
    }
    expect(reports("export let go(flag: Bool): Unit =\n" +
      "    let h = if flag then Some(save0) else Some(() => ())\n    ()\n")).toEqual([]);
  });

  test("a call a pure function joins is marked by what else reaches it", () => {
    expect(reports("export let go(): Unit = apply2!(save0, () => ())\n")).toEqual([]);
    expect(reports("export let go(): Unit = apply2!(() => (), save0)\n")).toEqual([]);
    expect(reports("export let go(): Unit = apply2(noop, () => ())\n")).toEqual([]);
    expect(reports("export let go(): Unit = apply2!(noop, noop)\n"))
      .toEqual([["!", "this call is pure, so `apply2` wants no mark, not `!`"]]);
    expect(reports("export let go(): Unit = apply2(save0, noop)\n"))
      .toEqual([["apply2(save0, noop)", "this call may touch the world, so `apply2` wants `!`, not no mark"]]);
  });

  test("a call's declared pure result and a record's declared pure field fit too", () => {
    expect(reports(`let mk(): () -> Unit = noop
export let outer(action: () ->! Unit): Unit = apply2!(action, mk())
`)).toEqual([]);
    expect(reports(`export record Box = { step: () -> Unit }
export let outer(action: () ->! Unit, box: Box): Unit = apply2!(action, box.step)
`)).toEqual([]);
  });

  test("a pattern variable over a written pure function fits", () => {
    expect(reports(`export let outer(action: () ->! Unit, o: Option(() -> Unit)): Unit =
    match o
        Some(f) => apply2!(action, f)
        None => ()
`)).toEqual([]);
  });
});

describe("the function keeps its own colour, and no variable is published", () => {
  test("hover shows the body's colour wherever the function was used", () => {
    const source = `export let outer(action: () ->! Unit): Unit =
    let f = noop
    apply2!(action, f)
`;
    expect(reports(source)).toEqual([]);
    expect(hovered(source, "f =")).toBe("() -> Unit");
    expect(hovered(source, "noop\n")).toBe("() -> Unit");
  });

  test("an opened colour nothing claimed closes to pure before a scheme is built", () => {
    const source = `let pick(value: a): a = value
let defer(action: () ->! Unit) = () => action!()
export let d: () -> Unit = defer(noop)
export let mk(): () -> Unit = pick(noop)
let k = pick(noop)
`;
    expect(reports(source)).toEqual([]);
    expect(hovered(source, "k =")).toBe("() -> Unit");
    // Purity is the silent one: a face with no colour publishes no line (§10),
    // so the only colour lines are the fixtures' `save`, `apply2`, and `impureOnly`.
    const main = compileFiles(files(source)).modules.find((module) => module.source.path === "/main.hex");
    expect((main?.declarations.text ?? "").match(/Hexagon:.*/gu)).toEqual([
      "Hexagon: `String ->! Unit` */",
      "Hexagon: `(() ->! Unit, () ->! Unit) ->? Unit` */",
      "Hexagon: `(() ->! Unit) ->? Unit` */",
    ]);
  });

  test("the reverse direction stays refused: an effectful function where purity is demanded", () => {
    expect(reports("export let outer(action: () ->! Unit): Unit = pureOnly(action)\n"))
      .toEqual([["action", SOLVED_PURE]]);
    // An effectful function beside the callback fixes nothing of the callback's:
    // each callback of `apply2` has a colour of its own (§2.4).
    expect(reports("export let outer(action: () ->! Unit): Unit = apply2!(action, save0)\n"))
      .toEqual([]);
    expect(reports("export let go(): Unit = pureOnly(save0)\n")).toEqual([["pureOnly(save0)", PURITY]]);
  });
});

describe("only a colour the program's text decides is re-opened (R.b)", () => {
  const uses = (first: string, second: string): string =>
    `export let outer(action: () ->! Unit): Unit =
    let k = (cb) =>
        ${first}
        ${second}
    ()
`;

  test("a parameter with no written type is inferred from all its uses, in either order", () => {
    const one = reports(uses("pureOnly(cb)", "tieTwo(action, cb)"));
    const two = reports(uses("tieTwo(action, cb)", "pureOnly(cb)"));
    expect(one.map(([, message]) => message)).toEqual([SOLVED_PURE]);
    expect(two.map(([, message]) => message)).toEqual([SOLVED_PURE]);
  });

  test("so does an alias of one, and a call handing one back", () => {
    for (const [first, second] of [
      ["let f = cb\n        pureOnly(cb)", "tieTwo(action, f)"],
      ["let f = cb\n        tieTwo(action, f)", "pureOnly(cb)"],
      ["pureOnly(cb)", "tieTwo(action, pickUp(cb))"],
      ["tieTwo(action, pickUp(cb))", "pureOnly(cb)"],
    ]) {
      const source = "let pickUp(value: a): a = value\n" + uses(first!, second!);
      expect([first, reports(source).map(([, message]) => message)]).toEqual([first, [SOLVED_PURE]]);
    }
  });

  test("an alias, a destructure, and a match made from one are inferred too, whichever comes first", () => {
    const k = (lines: readonly string[]): string =>
      "export let outer(action: () ->! Unit): Unit =\n    let k = (p) =>\n" +
      lines.map((line) => `        ${line}\n`).join("") + "        ()\n    ()\n";
    const refusedBothWays = (first: readonly string[], second: readonly string[]): void => {
      const one = reports(k(first)).map(([, message]) => message);
      const two = reports(k(second)).map(([, message]) => message);
      expect([first, one]).toEqual([first, two]);
      expect(one).toHaveLength(1);
    };
    refusedBothWays(["pureOnly(p)", "let f = p", "tieTwo(action, f)"], ["let f = p", "pureOnly(p)", "tieTwo(action, f)"]);
    refusedBothWays(["pureOnly(p)", "let f = p", "impureOnly!(f)"], ["let f = p", "pureOnly(p)", "impureOnly!(f)"]);
    refusedBothWays(
      ["let w: (() -> Unit, Int) = p", "let (a, b) = p", "tieTwo(action, a)"],
      ["let (a, b) = p", "tieTwo(action, a)", "let w: (() -> Unit, Int) = p"],
    );
    refusedBothWays(
      ["let w: Option(() -> Unit) = p", "match p\n            Some(f) => tieTwo(action, f)\n            None => ()"],
      ["match p\n            Some(f) => tieTwo(action, f)\n            None => ()", "let w: Option(() -> Unit) = p"],
    );
  });

  test("a parameter joined with a pure function stays open for its other uses, in either order", () => {
    const k = (first: string, second: string): string =>
      `export let outer(action: () ->! Unit): Unit =\n    let k = (cb) =>\n        ${first}\n        ${second}\n        ()\n    ()\n`;
    const tie = [["tieTwo(action, cb)", "`cb`'s colour is tied to `action`'s here, and no written type can say that — write `cb`'s type"]];
    for (const join of ["let g = if True then cb else noop", "let g = [cb, noop]"]) {
      // Handed beside `action` at one type, the untyped callback's colour is
      // `action`'s, which no written type can say (§3.4's tie), in either order;
      // run by a callee that takes any function, it is its own.
      for (const [use, expected] of [["tieTwo(action, cb)", tie], ["impureOnly!(cb)", []]] as const) {
        expect([join, use, reports(k(join, use))]).toEqual([join, use, expected]);
        expect([use, join, reports(k(use, join))]).toEqual([use, join, expected]);
      }
    }
  });

  test("so is a join of one with a decided pure function, whichever side and line come first", () => {
    const k = (lines: readonly string[]): string =>
      "let pickTwo(x: a, y: a): a = x\nexport let outer(action: () ->! Unit): Unit =\n    let k = (cb) =>\n" +
      lines.map((line) => `        ${line}\n`).join("") + "        ()\n    ()\n";
    for (const join of [
      "let g = if True then noop else cb",
      "let g = if True then cb else noop",
      "let g = pickTwo(noop, cb)",
      "let g = pickTwo(cb, noop)",
    ]) {
      for (const use of ["tieTwo(action, g)", "impureOnly!(g)"]) {
        for (const lines of [["pureOnly(cb)", join, use], [join, use, "pureOnly(cb)"]]) {
          expect([lines, reports(k(lines)).length]).toEqual([lines, 1]);
        }
      }
    }
  });

  test("a function whose own body pinned its parameter is decided like any other", () => {
    for (const k of [
      "let k = (f) =>\n    pureOnly(f)\n    f\n",
      "let k(f: () -> Unit): () -> Unit = f\n",
    ]) {
      expect(reports(`${k}export let outer(action: () ->! Unit): Unit = tieTwo(action, k(noop))\n`)).toEqual([]);
    }
    // A function that hands back an untyped parameter is made from it, in either order.
    for (const lines of [
      ["pureOnly(cb)", "let get = () => cb", "tieTwo(action, get())"],
      ["let get = () => cb", "tieTwo(action, get())", "pureOnly(cb)"],
    ]) {
      const source = "export let outer(action: () ->! Unit): Unit =\n    let k = (cb) =>\n" +
        lines.map((line) => `        ${line}\n`).join("") + "        ()\n    ()\n";
      expect([lines, reports(source).length]).toEqual([lines, 1]);
    }
  });

  test("a lambda written where it is passed takes its parameter's type from the callee", () => {
    const takes = "export let takesD(f: (() -> Unit) ->! Unit): Unit = f!(noop)\n";
    expect(reports(`${takes}export let outer(action: () ->! Unit): Unit = takesD((cb) => tieTwo(action, cb))\n`))
      .toEqual([]);
    expect(reports(`${takes}export let outer(action: () ->! Unit): Unit =\n    let h = (cb) => tieTwo(action, cb)\n    takesD(h)\n`))
      .toHaveLength(1);
    expect(reports(`${takes}export let outer(action: () ->! Unit): Unit =\n    let h = (cb: () -> Unit) => tieTwo(action, cb)\n    takesD(h)\n`))
      .toEqual([]);
  });

  test("writing the parameter's type decides it, and it fits", () => {
    const written = `export let outer(action: () ->! Unit): Unit =
    let k = (cb: () -> Unit) =>
        tieTwo(action, cb)
        pureOnly(cb)
    ()
`;
    expect(reports(written)).toEqual([]);
  });
});

describe("what the program's text decides, in any line order (R.b)", () => {
  const body = (lines: readonly string[], prefix = ""): string =>
    prefix + "export let outer(action: () ->! Unit): Unit =\n" +
    lines.map((line) => `    ${line}\n`).join("") + "    ()\n";
  const inK = (lines: readonly string[]): string[] => ["let k = (cb) =>", ...lines.map((line) => `    ${line}`), "    ()"];
  /**
   * One route's verdict, the same in every line order: `"fits"`, or `"refused"`
   * with the lie-of-generality report, or a tie's (§3.4), among each order's
   * reports. Which of the two a refused program draws, and what else it
   * reports, may follow which unification failed first, as it always has: a
   * pin that lands before an untyped parameter's body closes leaves no tie to
   * refuse. The verdict may not.
   */
  const verdict = (orders: readonly (readonly string[])[], prefix = ""): "fits" | "refused" => {
    const answers = orders.map((lines) => reports(body(lines, prefix)).map(([, message]) => message));
    const fits = answers.map((answer) => answer.length === 0);
    expect([orders[0], fits]).toEqual([orders[0], orders.map(() => fits[0])]);
    if (fits[0]) return "fits";
    for (const [index, answer] of answers.entries()) {
      const refused = answer.includes(SOLVED_PURE) ||
        answer.some((message) => message.includes("'s colour is tied to `action`'s here"));
      expect([orders[index], refused]).toEqual([orders[index], true]);
    }
    return "refused";
  };

  test("a lambda's colour and a named function's are their marks', whatever they capture", () => {
    const pin = "pureOnly(cb)";
    for (const [make, use] of [
      ["let run = () => cb()", "tieTwo(action, run)"],
      ["let make = () => () => cb()", "tieTwo(action, make())"],
    ] as const) {
      expect(verdict([inK([pin, make, use]), inK([make, pin, use]), inK([make, use, pin])])).toEqual("fits");
    }
    expect(verdict([inK([pin, "tieTwo(action, () => cb())"]), inK(["tieTwo(action, () => cb())", pin])]))
      .toEqual("fits");
    // A returned lambda whose call claims `cb` takes its colour from `cb`, which
    // the pin makes pure: the `!` is then a mark on a pure call, in either order.
    for (const lines of [
      inK([pin, "let make = () => () => cb!()", "tieTwo(action, make())"]),
      inK(["let make = () => () => cb!()", "tieTwo(action, make())", pin]),
    ]) {
      expect(reports(body(lines)).map(([, message]) => message)).toEqual([
        "this call is pure, so `cb` wants no mark, not `!`",
      ]);
    }
  });

  test("a value made only from the text fits: a call on decided arguments, a field, an alias", () => {
    for (const lines of [
      ["let f = pickUp(noop)", "tieTwo(action, f)"],
      ["let r = { f = noop }", "tieTwo(action, r.f)"],
      ["let f = () => ()", "let g = f", "tieTwo(action, g)"],
      ["let t = (noop, 1)", "let (a, b) = t", "tieTwo(action, a)"],
    ]) {
      expect([lines, reports(body(lines, "let pickUp(value: a): a = value\n"))]).toEqual([lines, []]);
    }
  });

  test("a capture made before the pin is made from the parameter, in either order", () => {
    for (const [make, use] of [
      ["let get = () => cb", "tieTwo(action, get())"],
      ["let r = { f = cb }", "tieTwo(action, r.f)"],
      ["let t = Some(cb)", "match t\n            Some(f) => tieTwo(action, f)\n            None => ()"],
      ["let t = (cb, 1)", "let (a, b) = t\n        tieTwo(action, a)"],
    ] as const) {
      const answer = verdict([
        inK(["pureOnly(cb)", make, use]),
        inK([make, "pureOnly(cb)", use]),
        inK([make, use, "pureOnly(cb)"]),
      ]);
      expect([make, answer]).toEqual([make, "refused"]);
    }
  });

  test("a `var` is inferred from its uses, in either order", () => {
    const answer = verdict([
      ["var z = { f = noop }", "pureOnly(z.f)", "tieTwo(action, z.f)"],
      ["var z = { f = noop }", "tieTwo(action, z.f)", "pureOnly(z.f)"],
    ]);
    expect(answer).toEqual("refused");
  });

  test("a binding whose type later lines fill is inferred from its uses, in either order", () => {
    const use = ["match JsMap.get(m, 1)", "    Some(f) => tieTwo(action, f)", "    None => ()"];
    const fill = "let ok: JsMap(Int, () -> Unit) = m";
    for (const made of ["let m = JsMap.fromSeq(Seq.empty)", "let (m, n) = (JsMap.fromSeq(Seq.empty), 1)"]) {
      const answer = verdict([[made, fill, ...use], [made, ...use, fill]]);
      expect([made, answer]).toEqual([made, "refused"]);
    }
  });

  test("a `match` over an unsettled scrutinee makes every arm's variables inferred, whatever the arms' order", () => {
    const scrutinee = "match JsMap.get(JsMap.fromSeq(Seq.empty), 1)";
    const answer = verdict([
      [scrutinee, "    Some(f) when True => pureOnly(f)", "    Some(g) => tieTwo(action, g)", "    None => ()"],
      [scrutinee, "    Some(g) when True => tieTwo(action, g)", "    Some(f) => pureOnly(f)", "    None => ()"],
    ]);
    expect(answer).toEqual("refused");
  });

  test("a lambda argument's parameter is decided only where the callee's signature spells its type whole", () => {
    const signatures =
      "export let applyWith(x: a, f: (a) ->! Unit, g: () ->! Unit): Unit =\n    f!(x)\n    g!()\n" +
      "export let withRelease(x: a, body: (() -> Unit) ->! Unit): Unit = body!(noop)\n" +
      "export let pureOnly2(f: (Int, (() -> Unit) -> Unit) -> Unit): Unit = ()\n";
    // Spelled whole in the signature: decided, in either order.
    expect(verdict([
      inK(["pureOnly(cb)", "withRelease(cb, (release) => tieTwo(action, release))"]),
      inK(["withRelease(cb, (release) => tieTwo(action, release))", "pureOnly(cb)"]),
    ], signatures)).toEqual("fits");
    // A variable an argument fills, or a callee inferred from its uses: not decided, in either order.
    expect(verdict([
      inK(["pureOnly(cb)", "applyWith(cb, (h) => tieTwo(action, h), noop)"]),
      inK(["applyWith(cb, (h) => tieTwo(action, h), noop)", "pureOnly(cb)"]),
    ], signatures)).toEqual("refused");
    expect(verdict([
      inK(["pureOnly2(cb)", "cb(1, (g) => tieTwo(action, g))"]),
      inK(["cb(1, (g) => tieTwo(action, g))", "pureOnly2(cb)"]),
    ], signatures)).toEqual("refused");
  });
});

describe("knots, and the value a `match` or a `for` reads (R.b, review round 4)", () => {
  test("nothing lands from a knot member while its knot is open, whichever member is written first", () => {
    const a = [
      "    a(g: (() -> Unit) ->! Unit, action: () ->! Unit, n: Int): Unit =",
      "        g!(noop)",
      "        if n == 0 then () else b!(action, n - 1)",
    ];
    const b = ["    b(action: () ->! Unit, n: Int): Unit = a!((release) => tieTwo(action, release), action, n)"];
    const one = reports(["fun", ...a, ...b].join("\n") + "\n").length > 0;
    const two = reports(["fun", ...b, ...a].join("\n") + "\n").length > 0;
    expect([one, two]).toEqual([true, true]);
    // Written on the lambda, the parameter's type is decided, in either order.
    const typed = ["    b(action: () ->! Unit, n: Int): Unit = a!((release: () -> Unit) => tieTwo(action, release), action, n)"];
    expect(reports(["fun", ...a, ...typed].join("\n") + "\n")).toEqual([]);
    expect(reports(["fun", ...typed, ...a].join("\n") + "\n")).toEqual([]);
  });

  test("a knot's members are read once each: a large knot compiles in time", () => {
    const n = 18;
    const members = Array.from({ length: n }, (_, i) =>
      `    m${i}(x: Int): Int = if x == 0 then m${(i + 1) % n}(x - 1) else if x == 1 then m${(i + 2) % n}(x - 2) else m${(i + 3) % n}(x - 3)`
    );
    // A synchronous compile outlives any test timeout, so the time is read
    // outright: each member read once is milliseconds; read along every path
    // through the knot, as before round 4, it was minutes.
    const start = Date.now();
    expect(reports(["fun", ...members].join("\n") + "\n")).toEqual([]);
    expect(Date.now() - start).toBeLessThan(3000);
  });

  test("a `match` or a `for` reads a value written in place at the form's own level", () => {
    // Held after review round 6: read one level in, the value's colours
    // escaped to a `let` inside and generalized there. The cost, recorded for
    // #1135: an arm that pins the part pure and hands it beside a `->?` is
    // refused where the same value bound by a `let` first fits.
    const outer = (lines: readonly string[]): string =>
      "export let outer(action: () ->! Unit): Unit =\n" + lines.map((line) => `    ${line}\n`).join("") + "    ()\n";
    const pinned = ["        pureOnly(f)", "        tieTwo(action, f)"];
    expect(reports(outer(["let t = Some(noop)", "match t", "    Some(f) =>", ...pinned, "    None => ()"]))).toEqual([]);
    expect(reports(outer(["match Some(noop)", "    Some(f) => tieTwo(action, f)", "    None => ()"]))).toEqual([]);
    for (const lines of [
      ["match Some(noop)", "    Some(f) =>", ...pinned, "    None => ()"],
      ["for f in [noop]", ...pinned.map((line) => line.slice(4))],
    ]) {
      expect([lines[0], reports(outer(lines)).map(([, message]) => message)]).toEqual([lines[0], [SOLVED_PURE]]);
    }
  });

  test("a `let` inside an arm or a loop body never generalizes the form's colours", () => {
    // Review round 6: an impure function reached a `->` function this way.
    const world = 'extern from "./world.js"\n' +
      "    export fun setFn(map: JsMap(Int, (() ->! Unit) ->! Unit), key: Int, value: (() ->! Unit) ->! Unit) ->! Unit\n" +
      "    export fun impure1(f: () ->! Unit) ->! Unit\n" +
      "export let call1(f: () ->! Unit): Unit = f!()\n" +
      "export let usePure(m: JsMap(Int, (() -> Unit) -> Unit)): Unit =\n" +
      "    match JsMap.get(m, 1)\n        Some(h) => h(() => ())\n        None => ()\n";
    const use = ["let g = m", "setFn!(g, 1, impure1)", "usePure(g)"];
    for (const source of [
      "export let bad(): Unit =\n    for m in [JsMap.fromSeq(Seq.singleton((1, call1)))]\n" +
        use.map((line) => `        ${line}\n`).join(""),
      "export let bad(): Unit =\n    match (JsMap.fromSeq(Seq.singleton((1, call1))), 0)\n        (m, _) =>\n" +
        use.map((line) => `            ${line}\n`).join(""),
    ]) {
      expect(reports(world + source).map(([, message]) => message)).toContain(PURITY);
    }
  });

  test("a `let` inside an arm or a loop body never generalizes the value's types", () => {
    // Review round 5: left one level in, `g` generalized to `JsMap(k, v)` and
    // read a `String` back as an `Int`; the literal's `Nat` defaulted to `Int`.
    const setStr = 'extern from "./world.js"\n    export fun setStr(map: JsMap(Int, String), key: Int, value: String) ->! Unit\n';
    const readBack = (indent: string): string =>
      [
        "let g = m",
        'setStr!(g, 1, "x")',
        "match JsMap.get(g, 1)",
        "    Some(n) => out := n + 1",
        "    None => ()",
      ].map((line) => `${indent}${line}\n`).join("");
    const viaFor = setStr + "let bad(): Int =\n    var out = 0\n    for m in [JsMap.fromSeq(Seq.empty)]\n" +
      readBack("        ") + "    out\n";
    const viaMatch = setStr + "let bad(): Int =\n    var out = 0\n" + [
      "match Some(JsMap.fromSeq(Seq.empty))",
      "    o =>",
      "        let g = o",
      "        match g",
      '            Some(w) => setStr!(w, 1, "x")',
      "            None => ()",
      "        match g",
      "            Some(r) =>",
      "                match JsMap.get(r, 1)",
      "                    Some(n) => out := n + 1",
      "                    None => ()",
      "            None => ()",
    ].map((line) => `    ${line}\n`).join("") + "    out\n";
    for (const source of [viaFor, viaMatch]) {
      expect(reports(source).map(([, message]) => message)).toContain("type mismatch: expected Int, found String");
    }
    const nat = "let useNat(v: Nat): Nat = v\nexport let total(): Nat =\n    var sum = 0\n";
    expect(reports(nat + "    for i in [1, 2, 3]\n        let j = i\n        sum := sum + useNat(j)\n    sum\n"))
      .toEqual([]);
    expect(reports(
      nat + "    match (1, 2)\n        p =>\n            let q = p\n            match q\n" +
        "                (a, b) => sum := sum + useNat(a)\n    sum\n",
    )).toEqual([]);
  });
});

/**
 * **Order-freedom, exhaustively** (R.b). A parameter with no written type is
 * pinned pure by one of six routes and reaches a `->?` beside the caller's
 * callback by one of twelve; every line order of each pair gets one answer, and
 * since the parameter is pinned and used beside a `->?`, that answer is a report.
 */
describe("every pin and every route from an untyped parameter, in every line order (R.b)", () => {
  const prefix = "let pickUp(x: a): a = x\n" +
    "export let pureOnlyPair(p: (() -> Unit, Int)): Unit = ()\n" +
    "export record Box = { step: () -> Unit }\n";
  const pins: Record<string, readonly string[]> = {
    call: ["pureOnly(cb)"],
    annotation: ["let q: () -> Unit = cb"],
    ascription: ["let q = (cb : () -> Unit)"],
    "nested annotation": ["let w: Option(() -> Unit) = Some(cb)"],
    "declared field": ["let bx = Box({ step = cb })"],
    "tuple demand": ["pureOnlyPair((cb, 1))"],
  };
  const routes: Record<string, readonly [readonly string[], readonly string[]]> = {
    direct: [[], ["tieTwo(action, cb)"]],
    alias: [["let f = cb"], ["tieTwo(action, f)"]],
    thunk: [["let get = () => cb"], ["tieTwo(action, get())"]],
    function: [["let m = (x: Int) => cb"], ["tieTwo(action, m(1))"]],
    record: [["let r = { f = cb }"], ["tieTwo(action, r.f)"]],
    option: [["let t = Some(cb)"], ["match t", "    Some(f) => tieTwo(action, f)", "    None => ()"]],
    tuple: [["let t = (cb, 1)"], ["let (a, b) = t", "tieTwo(action, a)"]],
    generic: [["let g = pickUp(cb)"], ["tieTwo(action, g)"]],
    join: [["let g = if True then cb else noop"], ["tieTwo(action, g)"]],
    nested: [["let h = () =>", "    let inner = cb", "    inner"], ["tieTwo(action, h())"]],
    var: [["var z = { f = cb }"], ["tieTwo(action, z.f)"]],
    curried: [["let c = (x: Int) => (y: Int) => cb"], ["tieTwo(action, c(1)(2))"]],
  };
  for (const [pinName, pin] of Object.entries(pins)) {
    test(`pinned by ${pinName}`, () => {
      for (const [routeName, [made, use]] of Object.entries(routes)) {
        const orders = made.length === 0
          ? [[...pin, ...use], [...use, ...pin]]
          : [[...pin, ...made, ...use], [...made, ...pin, ...use], [...made, ...use, ...pin]];
        const verdicts = orders.map((lines) => {
          const source = prefix + "export let outer(action: () ->! Unit): Unit =\n    let k = (cb) =>\n" +
            lines.map((line) => `        ${line}\n`).join("") + "        ()\n    ()\n";
          return reports(source).length > 0;
        });
        expect([routeName, verdicts]).toEqual([routeName, orders.map(() => true)]);
      }
    });
  }
});

describe("reports read the colours as they stand", () => {
  test("a callback joined with a pure function shows as its own `->?`, in either order", () => {
    for (const join of ["apply2!(action, noop)", "apply2!(noop, action)"]) {
      expect(reports(`export let outer(action: () ->! Unit): Unit =\n    ${join}\n    let x: Int = action\n    ()\n`))
        .toEqual([["Int", "type mismatch: expected Int, found () ->? Unit"]]);
    }
  });

  test("an opening spends no letter a type's own variables would take", () => {
    expect(reports("let x: Int = (noop, 1)\n"))
      .toEqual([["Int", "type mismatch: expected Int, found (() -> Unit, a)"]]);
  });

  test("at a parameter's arrow, a function's demand and a position's supply are read the right way round", () => {
    // The callback's `->!` accepts any function, and `pureOnly` accepts only a
    // pure one: the lie of generality, at the value that brought the constant
    // (§4.2's own example).
    expect(reports("let g: (() ->! Unit) -> Unit = pureOnly\n")).toEqual([[
      "pureOnly",
      "this callback is written `->!`, which accepts any function, and this accepts only a pure one — write its arrow `->`",
    ]]);
    // And a function whose callback is written `->!` accepts the pure one this
    // position hands it: the demand reads the parameter's arrow as what it
    // accepts, and the outer `->!` claims more than it runs, an allowance.
    expect(reports("let g: (() -> Unit) ->! Unit = impureOnly\n")).toEqual([]);
  });

  test("the recovery decides a colour it shares with a pure function at module level too (#1115 D2)", () => {
    const source = "type Step = () ->? Unit\nlet s: Step = noop\nexport let r: Unit = apply2!(s, noop)\n";
    expect(reports(source).map(([at]) => at)).toEqual(["->?"]);
  });
});

describe("the outermost arrow only (R.c)", () => {
  test("a pure function already inside a value keeps the type the value was built with", () => {
    const source = `export let go(flag: Bool): Unit =
    let p = Some(noop)
    let h = if flag then Some(save0) else p
    ()
`;
    expect(reports(source)).toEqual([["if flag then Some(save0) else p", FIXED_BEFORE]]);
    // Built where it is used, it fits.
    expect(reports(source.replace("else p", "else Some(noop)"))).toEqual([]);
  });
});

describe("a written face may claim more effect than its body performs, never less (ruling (c))", () => {
  test("`->!` over a pure lambda, over a pure name, as an ascription, or as a result type", () => {
    for (const source of [
      "export let go(): Unit =\n    let h: () ->! Unit = () => ()\n    h!()\n",
      "export let go(): Unit =\n    let h: () ->! Unit = noop\n    h!()\n",
      "export let go(): Unit =\n    let h = ((() => ()) : () ->! Unit)\n    h!()\n",
      "let mk(): () ->! Unit = () => ()\nexport let go(): Unit = mk()!()\n",
      "let stub: (Int) ->! Int = (n) => n\nexport let use(): Int = stub!(1)\n",
    ]) {
      expect([source, reports(source)]).toEqual([source, []]);
    }
    // The face is the colour the calls read: a bare call through it is refused.
    expect(reports("export let go(): Unit =\n    let h: () ->! Unit = () => ()\n    h()\n"))
      .toEqual([["h()", "this call may touch the world, so `h` wants `!`, not no mark"]]);
  });

  test("never less: a `->` face over an effectful body is still refused", () => {
    expect(reports("export let go(): Unit =\n    let h: () -> Unit = () => save!(\"x\")\n    h()\n").map(([, m]) => m))
      .toEqual(["this call may touch the world, and the enclosing function's face is the pure arrow `->` — a pure face cannot run effects"]);
  });

  test("the face #947 asked for is no longer needed, and a local `->?` borrows nothing", () => {
    const inferred = `export let orNoop(flag: Bool, action: () ->! Unit): () ->? Unit =
    let noop2 = () => ()
    if flag then action else noop2
`;
    const direct = `export let orNoop(flag: Bool, action: () ->! Unit): () ->? Unit =
    if flag then action else () => ()
`;
    expect(reports(inferred)).toEqual([]);
    expect(reports(direct)).toEqual([]);
    expect(hovered(direct, "orNoop(")).toBe(hovered(inferred, "orNoop("));
  });
});

describe("the issues #1119 dissolves", () => {
  test("#1109: a merge of a pure and an impure function, in either order", () => {
    for (const form of ["if flag then save0 else noop", "if flag then noop else save0"]) {
      expect(reports(`export let go(flag: Bool): Unit =\n    let p = ${form}\n    p!()\n`)).toEqual([]);
      // Under a written `->`, the one report stands at the seat, whichever path is first.
      expect(reports(`export let go(flag: Bool): Unit =\n    let p: () -> Unit = ${form}\n    ()\n`))
        .toEqual([["() -> Unit", PURITY]]);
    }
  });

  test("#892: a named pure function and an inline lambda read alike at a seat", () => {
    const seat = (argument: string, bind: string): string =>
      `constraint C<r> =
    go(runner: r, b: () ->! Unit) -> Unit
record R = { id: Int }
let pickTwo<a>(x: a, y: a): a = x
honor C<R> =
    go(runner, b) =
${bind}        let f = ${argument}
        f()
`;
    const expected = reports(seat("pickTwo((() => ()), b)", ""));
    expect(expected).toHaveLength(1);
    for (const [argument, bind] of [
      ["pickTwo(noop, b)", ""],
      ["pickTwo(b, noop)", ""],
      ["pickTwo(g, b)", "        let g = () => ()\n"],
    ]) {
      expect([argument, reports(seat(argument!, bind!))]).toEqual([argument, expected]);
    }
  });

  test("a knot sibling handed on as a value, beside a callback", () => {
    expect(reports(`fun
    ping(action: () ->! Unit, n: Int): Unit = if n == 0 then apply2!(action, pong) else pong()
    pong(): Unit = ()

export let outer(action: () ->! Unit): Unit = ping!(action, 3)
`)).toEqual([]);
  });
});
