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
 * - R.b: only a colour that is decided — by a body's close or a written face —
 *   is re-opened, so a parameter with no written type is inferred from all its
 *   uses together, in whatever order they come;
 * - R.c: the outermost arrow only — a value already built keeps its type;
 * - R.d: a binding annotation directly over a lambda literal is that lambda's
 *   face, checked as one (§4.2).
 */

const HEADER = "module Main\n\n";
const FIXTURES =
  'extern from "./world.js"\n    export fun save(document: String) ->! Unit\n' +
  'let save0(): Unit = save!("x")\n' +
  "let noop(): Unit = ()\n" +
  "export let apply2(f: () ->? Unit, g: () ->? Unit): Unit =\n    f?()\n    g?()\n" +
  "export let pureOnly(f: () -> Unit): Unit = f()\n";

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

const SOLVED_PURE = "this signature's `->?` promises a colour the caller chooses, but the body " +
  "solves it to the pure constant — the honest face is `->`";
const SOLVED_IMPURE = "this signature's `->?` promises a colour the caller chooses, but the body " +
  "solves it to the impure constant — a function that performs its own unconditional effects " +
  "rounds up, and its face is `->!`";
const PURITY = "a `->` arrow promises purity, and this function performs effects — the demand " +
  "is written `->`, the function's face `->?` or `->!`";
const FIXED_BEFORE = "this position's arrow is the impure constant, and the pure `->` meeting it " +
  "was fixed before it arrived — inside a value already built, or by another use — so it " +
  "cannot fit as a pure function fits where it is used; write the arrow where it was fixed";

describe("a pure function fits wherever a function is expected (#1119)", () => {
  test("beside a callback, where a callee's `->?` is shared", () => {
    for (const other of ["() => ()", "noop"]) {
      for (const call of [`apply2?(action, ${other})`, `apply2?(${other}, action)`]) {
        const source = `export let outer(action: () ->? Unit): Unit = ${call}\n`;
        expect([call, reports(source)]).toEqual([call, []]);
        expect(hovered(source, "outer(")).toBe("(() ->? Unit) ->? Unit");
      }
    }
  });

  test("at a monomorphic `->?`, seen from inside its body", () => {
    const source = "export let outer(g: (() ->? String) -> String): String = g((): String => \"x\")\n";
    expect(reports(source)).toEqual([]);
    expect(hovered(source, "outer(")).toBe("((() ->? String) -> String) -> String");
  });

  test("on a path of a form, beside a callback — no written face needed", () => {
    for (const form of ["if flag then action else () => ()", "if flag then () => () else action"]) {
      const source = `export let outer(action: () ->? Unit, flag: Bool): () ->? Unit =
    let h = ${form}
    h?()
    h
`;
      expect([form, reports(source)]).toEqual([form, []]);
      expect(hovered(source, "h?(")).toBe("() ->? Unit");
    }
  });

  test("at a `->!` field and a `->!` parameter (R.a)", () => {
    expect(reports(`export record Holder = { run: () ->! Unit }
export let make(): Holder = Holder({ run = () => () })
`)).toEqual([]);
    expect(reports(`export let run(action: () ->! Unit): Unit = action!()
export let go(): Unit =
    run!(() => ())
    run!(noop)
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
      .toEqual([["apply2(save0, noop)", "this call runs effects, so `apply2` wants `!`, not no mark"]]);
  });

  test("a call's declared pure result and a record's declared pure field fit too", () => {
    expect(reports(`let mk(): () -> Unit = noop
export let outer(action: () ->? Unit): Unit = apply2?(action, mk())
`)).toEqual([]);
    expect(reports(`export record Box = { step: () -> Unit }
export let outer(action: () ->? Unit, box: Box): Unit = apply2?(action, box.step)
`)).toEqual([]);
  });

  test("a pattern variable over a written pure function fits", () => {
    expect(reports(`export let outer(action: () ->? Unit, o: Option(() -> Unit)): Unit =
    match o
        Some(f) => apply2?(action, f)
        None => ()
`)).toEqual([]);
  });
});

describe("the function keeps its own colour, and no variable is published", () => {
  test("hover shows the body's colour wherever the function was used", () => {
    const source = `export let outer(action: () ->? Unit): Unit =
    let f = noop
    apply2?(action, f)
`;
    expect(reports(source)).toEqual([]);
    expect(hovered(source, "f =")).toBe("() -> Unit");
    expect(hovered(source, "noop\n")).toBe("() -> Unit");
  });

  test("an opened colour nothing claimed closes to pure before a scheme is built", () => {
    const source = `let pick(value: a): a = value
let defer(action: () ->? Unit) = () => action?()
export let d: () -> Unit = defer(noop)
export let mk(): () -> Unit = pick(noop)
let k = pick(noop)
`;
    expect(reports(source)).toEqual([]);
    expect(hovered(source, "k =")).toBe("() -> Unit");
    // Purity is the silent one: a face with no colour publishes no line (§10),
    // so the only colour lines are the fixtures' `save` and `apply2`.
    const main = compileFiles(files(source)).modules.find((module) => module.source.path === "/main.hex");
    expect((main?.declarations.text ?? "").match(/Hexagon:.*/gu)).toEqual([
      "Hexagon: `String ->! Unit` */",
      "Hexagon: `(() ->? Unit, () ->? Unit) ->? Unit` */",
    ]);
  });

  test("the reverse direction stays refused: an effectful function where purity is demanded", () => {
    expect(reports("export let outer(action: () ->? Unit): Unit = pureOnly(action)\n"))
      .toEqual([["action", SOLVED_PURE]]);
    expect(reports("export let outer(action: () ->? Unit): Unit = apply2?(action, save0)\n"))
      .toEqual([["save0", SOLVED_IMPURE]]);
    expect(reports("export let go(): Unit = pureOnly(save0)\n")).toEqual([["pureOnly(save0)", PURITY]]);
  });
});

describe("only a decided colour is re-opened (R.b)", () => {
  const uses = (first: string, second: string): string =>
    `export let outer(action: () ->? Unit): Unit =
    let k = (cb) =>
        ${first}
        ${second}
    ()
`;

  test("a parameter with no written type is inferred from all its uses, in either order", () => {
    const one = reports(uses("pureOnly(cb)", "apply2?(action, cb)"));
    const two = reports(uses("apply2?(action, cb)", "pureOnly(cb)"));
    expect(one.map(([, message]) => message)).toEqual([SOLVED_PURE]);
    expect(two.map(([, message]) => message)).toEqual([SOLVED_PURE]);
  });

  test("so does an alias of one, and a call handing one back", () => {
    for (const [first, second] of [
      ["let f = cb\n        pureOnly(cb)", "apply2?(action, f)"],
      ["let f = cb\n        apply2?(action, f)", "pureOnly(cb)"],
      ["pureOnly(cb)", "apply2?(action, pickUp(cb))"],
      ["apply2?(action, pickUp(cb))", "pureOnly(cb)"],
    ]) {
      const source = "let pickUp(value: a): a = value\n" + uses(first!, second!);
      expect([first, reports(source).map(([, message]) => message)]).toEqual([first, [SOLVED_PURE]]);
    }
  });

  test("writing the parameter's type decides it, and it fits", () => {
    const written = `export let outer(action: () ->? Unit): Unit =
    let k = (cb: () -> Unit) =>
        apply2?(action, cb)
        pureOnly(cb)
    ()
`;
    expect(reports(written)).toEqual([]);
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

describe("a binding annotation directly over a lambda is that lambda's face (R.d)", () => {
  test("`->!` over a pure lambda over-claims; over a pure name it is a use, and fits", () => {
    expect(reports("export let go(): Unit =\n    let h: () ->! Unit = () => ()\n    h!()\n")).toEqual([
      ["->!", "this face is the impure constant `->!`, but the body performs no effect — its face is `->`"],
    ]);
    expect(reports("export let go(): Unit =\n    let h: () ->! Unit = noop\n    h!()\n")).toEqual([]);
  });

  test("the linked face #947 asked for is still honoured, and no longer needed", () => {
    const written = `export let orNoop(flag: Bool, action: () ->? Unit): () ->? Unit =
    let noop2: () ->? Unit = () => ()
    if flag then action else noop2
`;
    const direct = `export let orNoop(flag: Bool, action: () ->? Unit): () ->? Unit =
    if flag then action else () => ()
`;
    expect(reports(written)).toEqual([]);
    expect(reports(direct)).toEqual([]);
    expect(hovered(direct, "orNoop(")).toBe(hovered(written, "orNoop("));
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
    ping(action: () ->? Unit, n: Int): Unit = if n == 0 then apply2?(action, pong) else pong()
    pong(): Unit = ()

export let outer(action: () ->? Unit): Unit = ping?(action, 3)
`)).toEqual([]);
  });
});
