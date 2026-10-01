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
 * - every arrow a use receives, not only the outermost, read by variance
 *   (Swift's rule, #1169, in place of R.c); a value a `match` or a `for` reads
 *   in place is taken apart, and only its own arrow is re-opened;
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
  "was fixed before it arrived — by another use, by a type written where it was made, inside an " +
  "argument read invariantly, or in a parameter's type — so it cannot fit as a function used here does; " +
  "write the arrow where it was fixed";

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
    // Its colour is a slack still open, so its variable is inferred (#1170):
    // refused in either order of the arm's lines.
    const reversed = [pinned[1]!, pinned[0]!];
    for (const lines of [
      ["match Some(noop)", "    Some(f) =>", ...pinned, "    None => ()"],
      ["match Some(noop)", "    Some(f) =>", ...reversed, "    None => ()"],
      ["for f in [noop]", ...pinned.map((line) => line.slice(4))],
      ["for f in [noop]", ...reversed.map((line) => line.slice(4))],
    ]) {
      expect([lines, reports(outer(lines)).map(([, message]) => message)]).toEqual([lines, [SOLVED_PURE]]);
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

describe("a colour left open where the binding is made (#1170)", () => {
  // `make`'s `run` keeps its colour on the spine (§2.4), so `make()` hands back
  // a function whose one colour is both its callback's and its own arrow's,
  // which the call does not generalize (Functions §8).
  const prefix = "let ident(x: a): a = x\n" +
    "let make() =\n    let run = ident((f) => f!())\n    run!(() => ())\n    (run, 1)\n" +
    "let makeRecord() =\n    let run = ident((f) => f!())\n    run!(() => ())\n    { run = run, n = 1 }\n" +
    "let makeOption() =\n    let run = ident((f) => f!())\n    run!(() => ())\n    Some(run)\n" +
    "let both(g: a, h: a): Vector(a) = [g, h]\n" +
    "export record Holder = { run: (() -> Unit) ->! Unit }\n";
  const routes: Record<string, (uses: readonly string[]) => string[]> = {
    pattern: (uses) => ["let (r, _) = make()", ...uses],
    field: (uses) => ["let m = makeRecord()", "let r = m.run", ...uses],
    "field read": (uses) => ["let m = makeRecord()", ...uses.map((use) => use.replaceAll(/\br\b/gu, "(m.run)"))],
    match: (uses) => ["match makeOption()", "    None => ()", "    Some(r) =>", ...uses.map((use) => `        ${use}`), "        ()"],
  };
  const program = (lines: readonly string[]): string =>
    prefix + "export let use(): Unit =\n" + lines.map((line) => `    ${line}\n`).join("") + "    ()\n";
  const call = "r(() => ())";
  const seats: Record<string, string> = {
    annotation: "let h: (() -> Unit) ->! Unit = r",
    ascription: "let h = (r : (() -> Unit) ->! Unit)",
    "declared field": "let hd = Holder({ run = r })",
    "result type": "let give(): (() -> Unit) ->! Unit = r",
  };
  const merges: Record<string, string> = {
    vector: 'let v = [r, (g) => save!("y")]',
    if: 'let v = if True then r else (g) => save!("y")',
    option: 'let v = if True then Some(r) else Some((g) => save!("y"))',
    helper: 'let v = both(r, (g) => save!("y"))',
  };

  test("a pure callback and a `->!` arrow at one seat, in either order beside a pure call", () => {
    for (const [routeName, route] of Object.entries(routes)) {
      for (const [seatName, seat] of Object.entries(seats)) {
        for (const uses of [[seat, call], [call, seat]]) {
          const lines = route(uses);
          expect([routeName, seatName, lines, reports(program(lines))]).toEqual([routeName, seatName, lines, []]);
        }
      }
    }
  });

  test("beside an effectful function, the slack takes the effect and a pure call stays bare, in either order", () => {
    // The call first is the order a slack could have stood in for the value's
    // own colour, which the merge would then have made effectful.
    for (const [routeName, route] of Object.entries(routes)) {
      for (const [mergeName, merge] of Object.entries(merges)) {
        for (const uses of [[merge, call], [call, merge]]) {
          const lines = route(uses);
          expect([routeName, mergeName, lines, reports(program(lines))]).toEqual([routeName, mergeName, lines, []]);
        }
      }
    }
  });

  test("the colour is the value's own: one colour for the callbacks every use hands it, in either order", () => {
    for (const [routeName, route] of Object.entries(routes)) {
      const verdicts = [
        ['r!(() => save!("z"))', "let p: (() -> Unit) ->! Unit = r"],
        ["let p: (() -> Unit) ->! Unit = r", 'r!(() => save!("z"))'],
      ].map((uses) => reports(program(route(uses))).length > 0);
      expect([routeName, verdicts]).toEqual([routeName, [true, true]]);
    }
    // A bare call after an effectful callback wants `!`, as any shared colour does.
    expect(reports(program(routes.pattern!(['r!(() => save!("z"))', call])))).toEqual([
      [call, "this call may touch the world, so `r` wants `!`, not no mark"],
    ]);
  });

  test("a callback handed to it leaves room a later use never takes: the merge's effect stays off the face", () => {
    // The slack the handed callback brought is the value's room to grow: were
    // the merge's effect to land there, `outer` would read `->!` in one order
    // and `->?` in the other.
    const merge = 'let v = [r, (g) => save!("y")]';
    for (const [routeName, route] of Object.entries(routes)) {
      for (const uses of [["r!(action)", merge], [merge, "r!(action)"]]) {
        const source = prefix + "export let outer(action: () ->! Unit): Unit =\n" +
          route(uses).map((line) => `    ${line}\n`).join("") + "    ()\n";
        expect([routeName, uses, reports(source)]).toEqual([routeName, uses, []]);
        expect([routeName, uses, hovered(source, "outer(")]).toEqual([routeName, uses, "(() ->! Unit) ->? Unit"]);
      }
    }
  });

  test("callbacks handed to it stay independent: no tie, and the face follows them, in either order", () => {
    const outer = (params: string, uses: readonly string[]): string =>
      prefix + `export let outer(${params}): Unit =\n    let (r, _) = make()\n` +
      uses.map((use) => `    ${use}\n`).join("") + "    ()\n";
    const two = "a1: () ->! Unit, a2: () ->! Unit";
    // Two callbacks handed in turn: the value's colour is their join, never one
    // made equal to the other, so a caller handing two untyped callbacks meets
    // no tie.
    for (const uses of [["r!(a1)", "r!(a2)"], ["r!(a2)", "r!(a1)"]]) {
      const source = outer(two, uses) + "let user(p, q) = outer!(p, q)\n";
      expect([uses, reports(source)]).toEqual([uses, []]);
      expect([uses, hovered(source, "outer(")]).toEqual([uses, "(() ->! Unit, () ->! Unit) ->? Unit"]);
    }
    // A lambda running both beside one callback, or beside a decided pure
    // function, which a use re-opens: `->?`, and a bare call of `outer` on pure
    // functions stays bare, in either order.
    const both = "r!(() => if True then a1!() else a2!())";
    for (const other of ["r!(a1)", "r!(ident(noop))", "r!(fs[1])"]) {
      for (const uses of [[both, other], [other, both]]) {
        const lines = other.includes("fs[1]") ? ["let fs = [noop]", ...uses] : uses;
        const source = outer(two, lines) + "export let top(): Unit = outer(noop, noop)\n";
        expect([uses, reports(source)]).toEqual([uses, []]);
        expect([uses, hovered(source, "outer(")]).toEqual([uses, "(() ->! Unit, () ->! Unit) ->? Unit"]);
      }
    }
  });

  test("room the value took in is taken last, whatever the order of the uses that meet it", () => {
    const outer = (uses: readonly string[]): string =>
      prefix + "export let outer(a1: () ->! Unit, a2: () ->! Unit): Unit =\n    let (r, _) = make()\n" +
      uses.map((use) => `    ${use}\n`).join("") + "    ()\n";
    // A decided pure function handed to `r` leaves room in `r`'s colour; the
    // merge's own slack takes `a2`'s colour, so `r` stays pure and `outer` too.
    for (const uses of [["r(ident(noop))", "let v = [r, (g) => a2!()]"], ["let v = [r, (g) => a2!()]", "r(ident(noop))"]]) {
      expect([uses, reports(outer(uses))]).toEqual([uses, []]);
      expect([uses, hovered(outer(uses), "outer(")]).toEqual([uses, "(() ->! Unit, () ->! Unit) -> Unit"]);
    }
    // A slack a slack of the value took in is the value's too.
    const uses = ["r!(() => if True then a1!() else a2!())", "r!(a1)", 'let w = [r, (g) => save!("y")]'];
    for (const order of [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]]) {
      const lines = order.map((index) => uses[index]!);
      expect([lines, reports(outer(lines))]).toEqual([lines, []]);
      expect([lines, hovered(outer(lines), "outer(")]).toEqual([lines, "(() ->! Unit, () ->! Unit) ->? Unit"]);
    }
  });

  test("a body nested in its owner never decides its colour at its own close, in either order", () => {
    // The owner decides the value's colour from every use: a lambda calling
    // it, closing first, does not settle it pure before a later effectful use.
    const lambda = "let t = () => r!(() => ())";
    const effectful = 'r!(() => save!("z"))';
    for (const route of [routes.pattern!, routes.field!]) {
      for (const uses of [[lambda, effectful], [effectful, lambda]]) {
        const lines = route(uses);
        expect([lines, reports(program(lines))]).toEqual([lines, []]);
      }
    }
    // The body that made the value settles it where only a nested body calls
    // it: `mk`'s face and its result's behaviour agree (pure), and nothing of
    // the value's colour reaches `mk`'s scheme unsettled.
    const maker = prefix + "let mk() =\n    let (q, _) = make()\n    let u = () => q(noop)\n    (q, u)\n";
    const caller = maker + "export let use(): Unit =\n    let (q, uu) = mk()\n    uu()\n";
    expect(reports(caller)).toEqual([]);
    expect(hovered(caller, "mk(")).toBe("() -> ((() -> Unit) -> Unit, () -> Unit)");
    // Handed an effectful callback, `q` is what `mk`'s face says, pure, so the
    // callback is pinned, as for any `->` callback slot.
    const handed = maker + "export let use(a1: () ->! Unit): Unit =\n    let (q, uu) = mk()\n    q(a1)\n    uu()\n";
    expect(hovered(handed, "q, uu")).toBe("(() -> Unit) -> Unit");
    expect(reports(handed).map(([, message]) => message)).toContain(
      "the parameter `a1` is written `->!`, which accepts any function, and this accepts only a pure one — write `a1`'s arrow `->`",
    );
    // Nor the room a callback it hands the value leaves: the two callbacks
    // stay two colours, whichever is handed first.
    const handing = "let t2 = () => r!(a2)";
    for (const tail of [[], ['let w = [r, (g) => save!("y")]']]) {
      for (const uses of [["r!(a1)", handing, ...tail], [handing, "r!(a1)", ...tail]]) {
        const source = prefix + "export let outer(a1: () ->! Unit, a2: () ->! Unit): Unit =\n    let (r, _) = make()\n" +
          uses.map((use) => `    ${use}\n`).join("") + "    ()\nlet user(p, q) = outer!(p, q)\n";
        expect([uses, reports(source)]).toEqual([uses, []]);
        expect([uses, hovered(source, "outer(")]).toEqual([uses, "(() ->! Unit, () ->! Unit) ->? Unit"]);
      }
    }
  });

  test("a colour captured from an enclosing callback fits beside it, in either order", () => {
    const captured = "let mk(a: () ->! Unit) = (() => a!(), 1)\n";
    for (const uses of [
      ["tieTwo(action, f)", "let q: () ->! Unit = f"],
      ["let q: () ->! Unit = f", "tieTwo(action, f)"],
    ]) {
      const source = captured + "export let outer(action: () ->! Unit): Unit =\n    let (f, _) = mk(action)\n" +
        uses.map((use) => `    ${use}\n`).join("") + "    ()\n";
      expect([uses, reports(source)]).toEqual([uses, []]);
    }
  });
});

describe("a bracket read is the call it stands for (#1139)", () => {
  test("`fs[1]` fits where `Vector.at(fs, 1)` does, and a keyed read where `Map.get`'s part does", () => {
    for (const read of ["fs[1]", "Vector.at(fs, 1)"]) {
      const source = `export let outer(action: () ->! Unit): Unit =\n    let fs = [noop]\n    tieTwo(action, ${read})\n`;
      expect([read, reports(source)]).toEqual([read, []]);
    }
    const keyed = 'export let outer(action: () ->! Unit): Unit =\n    let m = Map.set(Map.empty, "k", noop)\n' +
      '    tieTwo(action, m["k"])\n';
    expect(reports(keyed)).toEqual([]);
  });

  test("made from a parameter with no written type, it is inferred, in either order", () => {
    for (const lines of [["pureOnly(fs[1])", "tieTwo(action, fs[1])"], ["tieTwo(action, fs[1])", "pureOnly(fs[1])"]]) {
      const source = "export let outer(action: () ->! Unit): Unit =\n    let k = (cb) =>\n        let fs = [cb]\n" +
        lines.map((line) => `        ${line}\n`).join("") + "        ()\n    ()\n";
      expect([lines, reports(source).map(([, message]) => message)]).toEqual([lines, [SOLVED_PURE]]);
    }
  });
});

describe("every arrow a use receives (Swift's rule, #1169)", () => {
  const makers = "let make3() = (() => (), 1)\n" +
    'let mkE() = (() => save!("x"), 1)\n' +
    "let applyImp(k: (() ->! Unit) -> Unit): Unit = k(save0)\n";

  test("a pure function inside a value fits where the use asks for more, however the value was made", () => {
    const programs = [
      // A `let`-bound value, merged: its `Option`'s function is re-opened.
      "export let go(flag: Bool): Unit =\n    let p = Some(noop)\n    let h = if flag then Some(save0) else p\n    ()\n",
      // Built where it is used, as before.
      "export let go(flag: Bool): Unit =\n    let h = if flag then Some(save0) else Some(noop)\n    ()\n",
      // A parameter's written type, at a seat and in a merge.
      "export let go(p: Option(() -> Unit)): Unit =\n    let q: Option(() ->! Unit) = p\n    ()\n",
      'export let go(b: Bool, p: (() -> Unit, Int)): Unit =\n    let w = if b then p else (() => save!("y"), 2)\n    ()\n',
      // A record, a function's result, a vector, an ascription.
      "export let go(): Unit =\n    let r = { f = noop, n = 1 }\n    let q: {f: () ->! Unit, n: Int} = r\n    ()\n",
      "export let go(): Unit =\n    let f2: () -> (() -> Unit) = () => () => ()\n    let q: () -> (() ->! Unit) = f2\n    ()\n",
      "export let go(): Unit =\n    let v = [noop]\n    let w: Vector(() ->! Unit) = v\n    ()\n",
      makers + "export let go(): Unit =\n    let q = (make3() : (() ->! Unit, Int))\n    ()\n",
      // A call's result, at a seat and in a merge, and a `let`-bound one met at two colours.
      makers + "export let go(): Unit =\n    let p: (() ->! Unit, Int) = make3()\n    ()\n",
      makers + 'export let go(b: Bool): Unit =\n    let w = if b then make3() else (() => save!("y"), 2)\n    ()\n',
      makers + "export let go(): Unit =\n    let p = make3()\n    let q1: (() ->! Unit, Int) = p\n    let q2: (() -> Unit, Int) = p\n    ()\n",
    ];
    for (const source of programs) expect([source, reports(source)]).toEqual([source, []]);
    expect(hovered(programs[0]!.replace("let h =", "let hh ="), "hh =")).toBe("Option(() ->! Unit)");
  });

  test("what does not fit is still refused, where the lie is", () => {
    // An effectful function where purity is demanded; a missing mark; a
    // function accepting only pure callbacks where any is handed; and a merge
    // that then meets a pure demand.
    expect(reports(makers + "export let go(): Unit =\n    let p: (() -> Unit, Int) = mkE()\n    ()\n"))
      .toEqual([["(() -> Unit, Int)", PURITY]]);
    expect(reports(makers + "export let go(): Unit =\n    let (g, _) = mkE()\n    g()\n"))
      .toEqual([["g()", "this call may touch the world, so `g` wants `!`, not no mark"]]);
    expect(reports(makers + "export let go(): Unit = applyImp(pureOnly)\n")).toEqual([["applyImp(pureOnly)", PURITY]]);
    expect(reports(
      'export let go(b: Bool, p: (() -> Unit, Int)): Unit =\n    let w = if b then p else (() => save!("y"), 2)\n' +
        "    let z: (() -> Unit, Int) = w\n    ()\n",
    )).toEqual([["(() -> Unit, Int)", PURITY]]);
  });

  test("an argument read invariantly is left whole", () => {
    // Correct at run time (an `Array` is a snapshot that never changes), but
    // `Array` is invariant in v1 for want of a variance ruling.
    expect(reports("export let go(): Unit =\n    let a = Vector.toArray([noop])\n    let w: Array(() ->! Unit) = a\n    ()\n"))
      .toEqual([["Array(() ->! Unit)", FIXED_BEFORE]]);
  });

  test("a value a `match` reads in place is taken apart: its parts are re-opened at their own uses, in either order", () => {
    const make = "let ident(x: a): a = x\n" +
      "let make() =\n    let run = ident((f) => f!())\n    run!(() => ())\n    (run, () => ())\n";
    const uses = ["g()", "let h: () ->! Unit = g", "pureOnly(g)", "r(() => ())", "let k: (() -> Unit) ->! Unit = r"];
    for (const first of uses) {
      for (const second of uses) {
        if (first === second) continue;
        const source = make + "export let go(): Unit =\n    match make()\n        (r, g) =>\n" +
          `            ${first}\n            ${second}\n            ()\n    ()\n`;
        expect([first, second, reports(source)]).toEqual([first, second, []]);
      }
    }
  });

  test("so is a value a `for` reads in place: the loop variable is re-opened at its own uses, in either order", () => {
    const makers = "let mkV() = [() => ()]\nlet mkP() = [(() => (), 1)]\n";
    for (const head of ["for f in mkV()", "for (f, _) in mkP()"]) {
      for (const lines of [["let h: () ->! Unit = f", "pureOnly(f)"], ["pureOnly(f)", "let h: () ->! Unit = f"]]) {
        const source = makers + `export let go(): Unit =\n    ${head}\n` +
          lines.map((line) => `        ${line}\n`).join("") + "        ()\n";
        expect([head, lines, reports(source)]).toEqual([head, lines, []]);
      }
    }
  });
});

describe("beneath its own arrow, only what the text decides is re-opened (#1169 review)", () => {
  test("a value that captures or is made from an inferred one re-opens its own arrow only, in either order", () => {
    // Each value's own arrow is decided (a lambda's, a function's, a call's
    // that returns a lambda), but the arrow beneath it is `p`'s, which is
    // inferred from its uses, or a type the lines after it fill.
    const cases: [string, string, string][] = [
      ["let go(p) =\n", "    let k = () => p\n    let h: () -> (() ->! Unit) = k", "    p()"],
      ["let go(p) =\n", "    let k() = p\n    let h: () -> (() ->! Unit) = k", "    p()"],
      ["let wrap(f) = () => f\nlet go(p) =\n", "    let h: () -> (() ->! Unit) = wrap(p)", "    p()"],
      ["let wrap(f: a): () -> a = () => f\nlet go(p) =\n", "    let h: () -> (() ->! Unit) = wrap(p)", "    p()"],
      ["let go(p) =\n", "    let k = () => p\n    let w = if True then k else () => save0", "    p()"],
      ["let go(): Unit =\n    let x = ident((k) => ())\n", "    let a: ((() -> Unit) -> Unit) -> Unit = x",
        "    let b: ((() ->! Unit) -> Unit) -> Unit = x"],
    ];
    for (const [head, first, second] of cases) {
      const one = reports("let ident(x: a): a = x\n" + head + first + "\n" + second + "\n    ()\n").length > 0;
      const other = reports("let ident(x: a): a = x\n" + head + second + "\n" + first + "\n    ()\n").length > 0;
      expect([head, first, one]).toEqual([head, first, other]);
    }
  });

  test("a lambda's written types are the text's, and are re-opened where the lambda is used", () => {
    // Its result annotation fixed what its body's value became, and its
    // parameters' types are its own: neither is its body's value.
    const programs = [
      "let takeT(t: () -> (() ->! Unit, Int)): Unit =\n    let (f, _) = t()\n    f!()\n" +
        "export let go(): Unit = takeT!((): (() -> Unit, Int) => (noop, 1))\n",
      "export let go(b: Bool): Unit =\n    let w = if b then (): (() -> Unit, Int) => (noop, 1) else () => (save0, 2)\n    ()\n",
      "export let go(b: Bool): Unit =\n    let w = if b then (q: (() -> Unit) -> Unit) => q(noop) else (q: (() ->! Unit) -> Unit) => q(save0)\n    ()\n",
      "export let go(): Unit =\n    let w = [(q: (() -> Unit) -> Unit) => q(noop), (q: (() ->! Unit) -> Unit) => q(save0)]\n    ()\n",
    ];
    for (const source of programs) expect([source, reports(source)]).toEqual([source, []]);
  });

  test("a lambda's result is its body's value: a deep chain of lambdas compiles in time", () => {
    // Its body's use re-opened it; re-opening it again at each enclosing
    // lambda stacked a slack per level on every arrow beneath.
    const start = Date.now();
    expect(reports("export let go(p: () -> Unit): Unit =\n    let k = " + "() => ".repeat(600) + "p\n    ()\n"))
      .toEqual([]);
    expect(Date.now() - start).toBeLessThan(3000);
  });

  test("a type written whole decides every arrow beneath it", () => {
    const source = "let go(p) =\n    let (f, _) = p\n    f()\n    let q: (() ->! Unit, Int) = (p : (() -> Unit, Int))\n    ()\n";
    expect(reports(source)).toEqual([]);
  });

  test("a value built where a `match` or a `for` reads it is taken apart as a `let`'s would be", () => {
    const make = "let make() =\n    let run = ident((f) => f!())\n    run!(() => ())\n    (run, () => ())\n";
    const heads: [string, string, string][] = [
      ["    match Some(make())\n        Some((r, g)) =>\n", "            ", "        None => ()\n"],
      ["    match ident(make())\n        (r, g) =>\n", "            ", ""],
      ["    match { p = make() }\n        { p = (r, g) } =>\n", "            ", ""],
      ["    match [make()]\n        [(r, g)] =>\n", "            ", "        _ => ()\n"],
      ["    for (r, g) in [make()]\n", "        ", ""],
    ];
    const pairs = [["g()", "let h: () ->! Unit = g"], ["pureOnly(g)", "let h: () ->! Unit = g"],
      ["r(() => ())", "let k: (() -> Unit) ->! Unit = r"]];
    for (const [head, pad, tail] of heads) {
      for (const [a, b] of pairs) {
        for (const lines of [[a, b], [b, a]]) {
          const source = "let ident(x: a): a = x\n" + make + "export let go(): Unit =\n" + head +
            lines.map((line) => pad + line + "\n").join("") + pad + "()\n" + tail + "    ()\n";
          expect([head, lines, reports(source)]).toEqual([head, lines, []]);
        }
      }
    }
  });
});

describe("a colour no parameter holds is published function by function (#1169)", () => {
  const ident = "let ident(x: a): a = x\n";
  const offSpine = ident + "let make() =\n    let run = ident((f) => f!())\n    let go = () => run!(() => ())\n    (run, go)\n";
  const onSpine = ident +
    "let make() =\n    let run = ident((f) => f!())\n    run!(() => ())\n    let go = () => run!(() => ())\n    (run, go)\n";

  test("a function that runs its sibling only with a pure function is pure, in either order", () => {
    for (const lines of [["r!(save0)", "g()"], ["g()", "r!(save0)"]]) {
      const source = offSpine + "export let go(): Unit =\n    let (r, g) = make()\n" +
        lines.map((line) => `    ${line}\n`).join("");
      expect([lines, reports(source)]).toEqual([lines, []]);
    }
    expect(hovered(offSpine, "make() =")).toBe("() -> ((() ->! Unit) ->? Unit, () -> Unit)");
    // A mark on it is now a mark on a pure call.
    expect(reports(offSpine + "export let go(): Unit =\n    let (r, g) = make()\n    r!(save0)\n    g!()\n"))
      .toEqual([["!", "this call is pure, so `g` wants no mark, not `!`"]]);
  });

  test("two functions that hold it get a colour each, in either order", () => {
    const two = ident + "let make() =\n    let run = ident((f) => f!())\n    (run, (h: () ->! Unit) => run!(h))\n";
    for (const lines of [["r!(save0)", "g(() => ())"], ["g(() => ())", "r!(save0)"]]) {
      const source = two + "export let go(): Unit =\n    let (r, g) = make()\n" +
        lines.map((line) => `    ${line}\n`).join("");
      expect([lines, reports(source)]).toEqual([lines, []]);
    }
  });

  test("a function published pure still meets `->!` in the result's data and in a merge", () => {
    expect(reports(onSpine + "export let go(): Unit =\n    let p: ((() ->! Unit) ->! Unit, () ->! Unit) = make()\n    ()\n"))
      .toEqual([]);
    expect(reports(onSpine + 'export let go(b: Bool): Unit =\n    let p = if b then make() else ((f) => f!(), () => save!("x"))\n    ()\n'))
      .toEqual([]);
    expect(hovered(onSpine, "make() =")).toBe("() -> ((() ->! Unit) ->? Unit, () -> Unit)");
    // A function that holds its colour: a pure callback, and an arrow that may touch the world.
    expect(reports(ident + "let make() =\n    let run = ident((f) => f!())\n    run!(() => ())\n    (run, 1)\n" +
      "export let go(): Unit =\n    let p: ((() -> Unit) ->! Unit, Int) = make()\n    ()\n")).toEqual([]);
  });

  test("a face written `->` where the inferred one shows `->` means the same", () => {
    for (const make of ["let make() = (() => (), 1)\n", "let make(): (() -> Unit, Int) = (() => (), 1)\n"]) {
      for (const use of [
        "let p: (() ->! Unit, Int) = make()",
        'let w = if True then make() else (() => save!("y"), 2)',
        "let (g, _) = make()\n    g()\n    let h: () ->! Unit = g",
      ]) {
        expect([make, use, reports(make + `export let go(): Unit =\n    ${use}\n    ()\n`)]).toEqual([make, use, []]);
      }
    }
  });

  test("a record carries its functions as a tuple does", () => {
    const source = ident + "let make() =\n    let run = ident((f) => f!())\n    let go = () => run!(() => ())\n" +
      "    { run = run, go = go }\nexport let go(): Unit =\n    let m = make()\n    (m.run)!(save0)\n    (m.go)()\n";
    expect(reports(source)).toEqual([]);
    expect(hovered(source, "make() =")).toBe("() -> {run: (() ->! Unit) ->? Unit, go: () -> Unit}");
  });
});

describe("where a use hands something, a `->!` the value's own written type spells accepts any function (#1174)", () => {
  const holders = "export record Holder = { run: (() ->! Unit) -> Unit }\n" +
    "export record HolderP = { run: (() -> Unit) -> Unit }\n" +
    "export record HolderT = { run: ((() ->! Unit, Int)) -> Unit }\n" +
    "export record HolderR = { run: (() ->! (() ->! Unit)) -> Unit }\n" +
    "export record HolderD = { run: ((() ->! Unit) -> Unit) -> Unit }\n" +
    "let applyPure(k: (() -> Unit) -> Unit): Unit = k(() => ())\n" +
    "let applyImp(k: (() ->! Unit) -> Unit): Unit = k(save0)\n" +
    "let hold = Holder({ run = (f) => () })\n";

  test("a field, a parameter, a function's face and a callee's written result, at an argument, a seat and a merge", () => {
    const programs = [
      "export let go(h: Holder): Unit = applyPure(h.run)\n",
      "let applyPureT(k: ((() -> Unit, Int)) -> Unit): Unit = k((() => (), 1))\n" +
        "export let go(h: HolderT): Unit = applyPureT(h.run)\n",
      "let applyPureR(k: (() -> (() -> Unit)) -> Unit): Unit = k(() => () => ())\n" +
        "export let go(h: HolderR): Unit = applyPureR(h.run)\n",
      // A callback's own parameter, and an arrow under a constructor in a parameter's type.
      "export let go(k: (() ->! Unit) -> Unit): Unit =\n    applyPure(k)\n    applyImp(k)\n",
      "export let go(o: Option((() ->! Unit) -> Unit)): Unit =\n    let q: Option((() -> Unit) -> Unit) = o\n    ()\n",
      // At a seat, in a merge with a function that accepts only pure ones, and through a `let`.
      "export let go(h: Holder): Unit =\n    let k: (() -> Unit) -> Unit = h.run\n    k(noop)\n",
      "export let go(b: Bool, h: Holder): Unit =\n    let m = if b then h.run else pureOnly\n    m(noop)\n",
      "export let go(h: Holder): Unit =\n    let x = h.run\n    applyPure(x)\n",
      // A function's own written face, and the result type a callee writes.
      "let hand(k: () -> Option(() ->! Unit)): Unit = ()\n" +
        "export let go(): Unit =\n    let s: (() -> Option(() -> Unit)) -> Unit = hand\n    ()\n",
      "let applyPureT(k: ((() -> Unit, Int)) -> Unit): Unit = k((() => (), 1))\n" +
        "let getRun(h: HolderT): ((() ->! Unit, Int)) -> Unit = h.run\nexport let go(h: HolderT): Unit = applyPureT(getRun(h))\n",
      // A `let`'s own written type.
      "export let go(o: Option((() ->! Unit) -> Unit)): Unit =\n    let s: Option((() ->! Unit) -> Unit) = o\n" +
        "    let q: Option((() -> Unit) -> Unit) = s\n    ()\n",
    ];
    for (const source of programs) expect([source, reports(holders + source)]).toEqual([source, []]);
  });

  test("what does not fit is still refused, where the lie is", () => {
    // The function hands its own callback an effectful function, and the seat
    // will hand it one that accepts only pure ones.
    expect(reports(holders + "let applyPureD(k: ((() -> Unit) -> Unit) -> Unit): Unit = k((f) => f())\n" +
      "export let go(h: HolderD): Unit = applyPureD(h.run)\n")).toEqual([["applyPureD(h.run)", PURITY]]);
    // A field that accepts only pure functions, where any is handed.
    expect(reports(holders + "export let go(h: HolderP): Unit = applyImp(h.run)\n"))
      .toEqual([["applyImp(h.run)", PURITY]]);
    // The merge accepts only what `pureOnly` accepts, and an effectful function is handed to it.
    expect(reports(holders + "export let go(b: Bool, h: Holder): Unit =\n    let m = if b then h.run else pureOnly\n    m(save0)\n"))
      .toEqual([["m(save0)", PURITY]]);
  });

  test("a callback's own `->!` is its colour, not the constant, so one every use shares reads alike in either order", () => {
    // The annotation's callback colour is one colour for every use of `s`,
    // since its right-hand side does not generalize: the first use solves it.
    const head = "let ident(x: a): a = x\nexport let go(): Unit =\n    let s: (() ->! Unit) -> Unit = ident((f) => ())\n";
    const one = reports(holders + head + "    applyImp(s)\n    applyPure(s)\n    ()\n");
    const other = reports(holders + head + "    applyPure(s)\n    applyImp(s)\n    ()\n");
    expect(one.length).toBeGreaterThan(0);
    expect(other.length).toBeGreaterThan(0);
  });

  test("a constant inference solved is left as it stands, in either order, and writing the type fits", () => {
    const orders = [["holdId(q)", "hold.run(q)"], ["hold.run(q)", "holdId(q)"]];
    for (const [first, second] of orders) {
      const source = holders + "let holdId(f: () ->! Unit): Unit = ()\n" +
        `let lam(q) =\n    ${first}\n    ${second}\nexport let go(): Unit = applyPure(lam)\n`;
      expect([first, reports(source)]).toEqual([first, [["applyPure(lam)", FIXED_BEFORE]]]);
    }
    expect(reports(holders + "let takeAny(k) = hold.run(k)\nexport let go(): Unit = applyPure(takeAny)\n"))
      .toEqual([["applyPure(takeAny)", FIXED_BEFORE]]);
    expect(reports(holders + "let takeAny(k: () ->! Unit) = hold.run(k)\nexport let go(): Unit = applyPure(takeAny)\n"))
      .toEqual([]);
  });

  test("a colour every use of a value shares is left as it stands, in either order, and the marked wrapper fits", () => {
    const make = "let ident(x: a): a = x\n" +
      "let make() =\n    let run = ident((f) => f!())\n    let go = () => run!(() => ())\n    (run, go)\n";
    const lines = ['r!(() => save!("z"))', "let h: (() -> Unit) ->! Unit = r"];
    for (const order of [lines, [...lines].reverse()]) {
      const body = order.map((line) => `    ${line}\n`).join("");
      expect(reports(make + "export let go(): Unit =\n    let (r, _) = make()\n" + body + "    ()\n").length)
        .toBeGreaterThan(0);
      const wrapped = body.replace("= r\n", "= (f) => r!(f)\n");
      expect([order, reports(make + "export let go(): Unit =\n    let (r, _) = make()\n" + wrapped + "    ()\n")])
        .toEqual([order, []]);
    }
  });
});

describe("the text decides a lambda's written types, its parameters under a written type, and a ground result (#1174)", () => {
  const holders = "export record Holder = { run: (() ->! Unit) -> Unit }\n" +
    "export record HolderP = { run: (() -> Unit) -> Unit }\n" +
    "let applyK(k: ((() ->! Unit) -> Unit) -> Unit): Unit = k((f) => ())\n" +
    "let applyPure(k: (() -> Unit) -> Unit): Unit = k(() => ())\n";

  test("a lambda's written types meet the expectation that lands on it as a use reads them", () => {
    const programs = [
      "export let go(): Unit =\n    let h: () -> (() ->! Unit, Int) = (): (() -> Unit, Int) => (noop, 1)\n    ()\n",
      "export let go(): Unit =\n    let h: ((() ->! Unit) -> Unit) -> Unit = (q: (() -> Unit) -> Unit) => q(noop)\n    ()\n",
      "export let go(): Unit = applyK((q: (() -> Unit) -> Unit) => q(noop))\n",
    ];
    for (const source of programs) expect([source, reports(holders + source)]).toEqual([source, []]);
    // The lambda hands its callback an effectful function the seat's will not accept,
    // and a face that may touch the world meets a pure demand.
    expect(reports(holders + "export let go(): Unit =\n    let h: ((() -> Unit) -> Unit) -> Unit = " +
      "(q: (() ->! Unit) -> Unit) => q(save0)\n    ()\n").map(([, message]) => message)).toContain(PURITY);
    expect(reports(holders + "export let go(): Unit =\n    let h: () -> (() -> Unit, Int) = (): (() ->! Unit, Int) => (noop, 1)\n    ()\n"))
      .toEqual([["() -> (() -> Unit, Int)", PURITY]]);
  });

  test("a call whose written result type is ground is decided whatever it is handed, in place and through a `let`", () => {
    const makers = "let mkPair(q): (() -> Unit, Int) = (noop, 1)\nlet mkPairE(q): (() ->! Unit, Int) = (save0, 1)\n" +
      "let mkVar(q: a): (() -> Unit, a) = (noop, q)\n";
    expect(reports(makers + "let use(p): Unit =\n    let w: (() ->! Unit, Int) = mkPair(p)\n    ()\n")).toEqual([]);
    expect(reports(makers + "let use(p): Unit =\n    let x = mkPair(p)\n    let w: (() ->! Unit, Int) = x\n    ()\n"))
      .toEqual([]);
    expect(reports(makers + "let use(p): Unit =\n    let w: (() -> Unit, Int) = mkPairE(p)\n    ()\n"))
      .toEqual([["(() -> Unit, Int)", PURITY]]);
    // A written result with a variable an argument fills decides only its own arrow.
    expect(reports(makers + "let use(p): Unit =\n    let w: (() ->! Unit, Int) = mkVar(p)\n    ()\nexport let go(): Unit = use(1)\n"))
      .toEqual([["(() ->! Unit, Int)", FIXED_BEFORE]]);
  });

  test("a lambda's untyped parameter under a type written whole is decided, as under a callee's signature", () => {
    const programs = [
      "export let go(h: Holder): Unit =\n    let k: (() -> Unit) -> Unit = (f) => h.run(f)\n    k(noop)\n",
      "export let go(h: Holder): Unit =\n    let k = ((f) => h.run(f) : (() -> Unit) -> Unit)\n    k(noop)\n",
      "let mk(h: Holder): (() -> Unit) -> Unit = (f) => h.run(f)\nexport let go(h: Holder): Unit = mk(h)(noop)\n",
      "export let go(h: Holder): Unit =\n    let hp = HolderP({ run = (f) => h.run(f) })\n    hp.run(noop)\n",
      // Under a callee's signature, its declaration's written type is the parameter's own.
      "export let go(): Unit = applyK((f) => applyPure(f))\n",
    ];
    for (const source of programs) expect([source, reports(holders + source)]).toEqual([source, []]);
    // The field accepts only pure functions, and the lambda would hand it any.
    expect(reports(holders + "export let go(hp: HolderP): Unit =\n    let hq = Holder({ run = (f) => hp.run(f) })\n    hq.run(save0)\n")
      .length).toBeGreaterThan(0);
  });
});

describe("a written `->!` a use reads as any function belongs to that use alone (#1174)", () => {
  const holders = "export record Holder = { run: (() ->! Unit) -> Unit }\n" +
    "export record HolderT = { run: ((() ->! Unit, Int)) -> Unit }\n" +
    "let applyPure(k: (() -> Unit) -> Unit): Unit = k(() => ())\n" +
    "let applyImp(k: (() ->! Unit) -> Unit): Unit = k(save0)\n" +
    "let applyPureT(k: ((() -> Unit, Int)) -> Unit): Unit = k((() => (), 1))\n" +
    "let getRun(h: HolderT): ((() ->! Unit, Int)) -> Unit = h.run\n" +
    "let mkH(h: Holder): Holder = h\n";

  test("a binding that does not generalize it keeps the written constant, so its uses agree in every order", () => {
    const cases: [string, string, string[]][] = [
      ["h: Holder", "let x = h.run", ["applyImp(x)", "applyPure(x)"]],
      ["h: Holder", "let x = h.run", ["x(save0)", "applyPure(x)"]],
      ["h: Holder", "let x = mkH(h).run", ["applyImp(x)", "applyPure(x)"]],
      ["h: HolderT", "let x = getRun(h)", ["x((save0, 1))", "applyPureT(x)"]],
    ];
    for (const [parameter, binding, uses] of cases) {
      for (const order of [uses, [...uses].reverse()]) {
        const source = holders + `export let go(${parameter}): Unit =\n    ${binding}\n` +
          order.map((use) => `    ${use}\n`).join("");
        expect([binding, order, reports(source)]).toEqual([binding, order, []]);
      }
    }
  });

  test("an untyped callback such a binding is handed still accepts any function", () => {
    for (const body of [
      "    let run = getRun(h)\n    run((k, 1))\n",
      "    let x = mkH(hh).run\n    x(k)\n",
      "    let (x, _) = (mkH(hh).run, 1)\n    x(k)\n",
    ]) {
      const source = holders + `let f(h: HolderT, hh: Holder, k) =\n${body}` +
        "export let g(h: HolderT, hh: Holder): Unit = f(h, hh, save0)\n";
      expect([body, reports(source)]).toEqual([body, []]);
    }
  });

  test("a colour the environment also holds is left to it, so a binding made from it reads alike in either order", () => {
    const head = holders + "let tieRet(x: t, y: t): t = x\n";
    for (const binding of [
      ["    let y = tieRet(p, h.run)"],
      ["    let (y, _) = (tieRet(p, h.run), 1)"],
    ]) {
      for (const lines of [["    applyPure(p)", ...binding], [...binding, "    applyPure(p)"]]) {
        const source = head + "let f(h: Holder, p) =\n" + lines.join("\n") + "\n    ()\n" +
          "export let go(h: Holder, p: (() -> Unit) -> Unit): Unit = f(h, p)\n";
        expect([lines, reports(source)]).toEqual([lines, []]);
      }
    }
  });

  test("a call to a member of a knot still open is not decided by its written result, in either order", () => {
    const use = ["    useIt(p): Unit =", "        let w: (() ->! Unit, Int) = mkPair(p)", "        ()"];
    const make = ["    mkPair(q): (() -> Unit, Int) =", "        useIt(q)", "        (noop, 1)"];
    const verdicts = [[...use, ...make], [...make, ...use]].map((members) =>
      reports("fun\n" + members.join("\n") + "\n").length > 0
    );
    expect(verdicts).toEqual([true, true]);
  });

  test("a function's written callback is its colour, though a recursive call pinned it, in either order", () => {
    const head = "let applyPure2(k: (() -> Unit, Bool) -> Unit): Unit = k(() => (), True)\n";
    const a = "    a(n: Int): Unit = if n > 0 then applyPure2(f) else ()";
    const f = "    f(k: () ->! Unit, n: Bool): Unit = if n then f(save0, n) else a(1)";
    const verdicts = [[a, f], [f, a]].map((members) =>
      reports(head + "fun\n" + members.join("\n") + "\n").length > 0
    );
    expect(verdicts).toEqual([true, true]);
  });
});

describe("an imported function's written types are read as this module's are (#1174)", () => {
  const other = "module Other\n\n" +
    "export record Holder = { run: (() ->! Unit) -> Unit }\n" +
    "let noop(): Unit = ()\n" +
    "export record HolderT = { run: ((() ->! Unit, Int)) -> Unit }\n" +
    "export let getRun(h: HolderT): ((() ->! Unit, Int)) -> Unit = h.run\n" +
    "export let hand(k: () -> Option(() ->! Unit)): Unit = ()\n" +
    "export let mkPair(q: Int): (() -> Unit, Int) = (noop, q)\n" +
    "export let applyK(k: ((() ->! Unit) -> Unit) -> Unit): Unit = k((f) => ())\n";
  const main = "module Main\n\nimport Other\n\n" +
    "let applyPure(k: (() -> Unit) -> Unit): Unit = k(() => ())\n" +
    "let applyPureT(k: ((() -> Unit, Int)) -> Unit): Unit = k((() => (), 1))\n";

  test("a callee's written result, a function's face, a ground result and a landed parameter", () => {
    for (const body of [
      "export let go(h: Other.HolderT): Unit = applyPureT(Other.getRun(h))\n",
      "export let go(): Unit =\n    let s: (() -> Option(() -> Unit)) -> Unit = Other.hand\n    ()\n",
      "let use(p): Unit =\n    let w: (() ->! Unit, Int) = Other.mkPair(p)\n    ()\nexport let go(): Unit = use(1)\n",
      "export let go(): Unit = Other.applyK((f) => applyPure(f))\n",
    ]) {
      const diagnostics = compileFiles([["/other.hex", other], ["/main.hex", main + body]]).diagnostics;
      expect([body, diagnostics.map(({ message }) => message)]).toEqual([body, []]);
    }
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
