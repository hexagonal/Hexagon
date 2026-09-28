/**
 * Conformance for **a body held until its dot-call goals settle** (#378).
 *
 * A dot call whose receiver is still an unsolved variable is a goal (Method
 * Syntax §3): it resolves when the receiver's head arrives — later in its owner
 * region, or at the region's deadline — and only then is its call, and the
 * colour that call carries, registered into the body it was written in. A body
 * that closes with such a goal pending cannot decide its colour at its close,
 * the moment Effects §3.4 decides a lambda's: the call it has not yet absorbed
 * may be the one that makes it a source. Deciding it anyway lost the effect —
 * the lambda read pure, its callers were told to drop the `!`, and a `->`
 * demand accepted it.
 *
 * So such a body is **held**, as a knot holds a lambda whose calls reach a
 * sibling (§3.4's knot bullet): its colour and its calls' are decided at the
 * goals' deadline, right after they settle, and a demand its colour meets in
 * the meantime is recorded and compared then, never choosing it. A body that
 * calls a held one is held with it, and a `fun` knot whose bodies wait for a
 * goal, or call a held body, is held whole. The specimens below either lost
 * an effect before the hold or are what the hold must leave as it was.
 */

import { describe, expect, test } from "vitest";
import { compileFiles } from "../support/test-project.js";
import * as Typed from "../syntax/typed/index.js";

const world = "extern from \"./world.js\"\n" +
  "    export fun save(document: String) ->! Unit\n\n";

function compile(body: string) {
  return compileFiles([["/main.hex", "module Main\n\n" + world + body]]);
}

function refusals(body: string): readonly string[] {
  return compile(body).diagnostics.map(({ message }) => message);
}

/** The scheme a top-level binding was given, as the checker renders it. */
function typeOf(body: string, name: string): string {
  const compiled = compile(body);
  expect(compiled.diagnostics.map(({ message }) => message)).toEqual([]);
  const typed = compiled.modules.find(({ source }) => source.path === "/main.hex")!.typed;
  const symbol = typed.symbols.find(
    (candidate) => candidate.name === name && candidate.bindingSpan.fileId === typed.fileId,
  );
  if (symbol === undefined) throw new Error(`no symbol \`${name}\``);
  return Typed.displayScheme(symbol.scheme);
}

/** A lambda whose one dot call settles only when a later line fixes `source`. */
const heldLambda = (use: string): string =>
  "let run(source) =\n" +
  "    let act = () => source.forEach!((value) => save!(value))\n" +
  "    let pinned: Seq(String) = source\n" +
  `    ${use}\n`;

/** A `Store` whose `Int` instance saves, reached through a receiver only defaulting settles. */
const store = "constraint Store<s> =\n" +
  "    put(x: s) ->! Unit\n\n" +
  "honor Store<Int> =\n" +
  "    put(x) = save!(\"x\")\n\n" +
  "let f(n) =\n" +
  "    let k = n + 1\n" +
  "    n.put!()\n";

describe("a goal that settles after its body closes keeps its colour", () => {
  test("the control: a goal settling inside its own open body", () => {
    expect(typeOf(
      "let run(source): Seq(String) =\n" +
        "    source.forEach!((value) => save!(value))\n" +
        "    let pinned: Seq(String) = source\n" +
        "    pinned\n",
      "run",
    )).toBe("Seq(String) ->! Seq(String)");
  });

  test("a lambda closed before its receiver was known is impure", () => {
    expect(typeOf(heldLambda("act"), "run")).toBe("Seq(String) -> () ->! Unit");
  });

  test("calling it takes `!`, and its caller is a source", () => {
    expect(typeOf(heldLambda("act!()"), "run")).toBe("Seq(String) ->! Unit");
    expect(refusals(heldLambda("act()"))).toEqual([
      "this call runs effects, so `act` wants `!`, not no mark",
    ]);
  });

  test("an inner function is held the same way", () => {
    const inner = (use: string): string =>
      "let run(source) =\n" +
      "    let inner() = source.forEach!((value) => save!(value))\n" +
      "    let pinned: Seq(String) = source\n" +
      `    ${use}\n`;
    expect(typeOf(inner("inner"), "run")).toBe("Seq(String) -> () ->! Unit");
    expect(refusals(inner("inner()"))).toEqual([
      "this call runs effects, so `inner` wants `!`, not no mark",
    ]);
  });

  test("a `fun` member's goals settle before its knot decides it", () => {
    expect(typeOf(
      "fun go(v) =\n" +
        "    let act = () => v.forEach!((value) => save!(value))\n" +
        "    let pinned: Seq(String) = v\n" +
        "    act\n",
      "go",
    )).toBe("Seq(String) -> () ->! Unit");
  });

  test("a goal settled by defaulting at its owner's deadline", () => {
    expect(typeOf(store, "f")).toBe("Int ->! Unit");
    expect(refusals(store + "\nlet g() = f(1)\n")).toEqual([
      "this call runs effects, so `f` wants `!`, not no mark",
    ]);
  });
});

describe("a goal owned further out holds the body until that region closes", () => {
  test("a `fun` member whose goal is on a receiver from outside its block", () => {
    expect(typeOf(
      "let run(source) =\n" +
        "    fun go() = source.forEach!((value) => save!(value))\n" +
        "    let pinned: Seq(String) = source\n" +
        "    go\n",
      "run",
    )).toBe("Seq(String) -> () ->! Unit");
    expect(typeOf(
      "fun outer(v) =\n" +
        "    fun inner() = v.forEach!((value) => save!(value))\n" +
        "    let pinned: Seq(String) = v\n" +
        "    inner\n",
      "outer",
    )).toBe("Seq(String) -> () ->! Unit");
  });

  test("a nested `fun` whose receiver only defaulting settles", () => {
    const nested = store.replace(
      "let f(n) =\n    let k = n + 1\n    n.put!()\n",
      "let f(n) =\n    fun g() = n.put!()\n    let k = n + 1\n    g\n",
    );
    expect(typeOf(nested, "f")).toBe("Int -> () ->! Unit");
  });

  test("a lambda a knot holds, waiting on a receiver from outside the block", () => {
    expect(typeOf(
      "let run(source) =\n" +
        "    fun\n" +
        "        ping(n: Int): Int =\n" +
        "            let act = () =>\n" +
        "                source.forEach!((value) => save!(value))\n" +
        "                pong!(n)\n" +
        "            act!()\n" +
        "        pong(n: Int): Int = if n > 0 then ping!(n - 1) else 0\n" +
        "    let pinned: Seq(String) = source\n" +
        "    ping!(1)\n",
      "run",
    )).toBe("Seq(String) ->! Int");
  });

  test("a goal whose receiver moved out after the body was held", () => {
    expect(typeOf(
      "let run(source) =\n" +
        "    let helper(x) =\n" +
        "        let act = () => x.forEach!((value) => save!(value))\n" +
        "        let same = [x, source]\n" +
        "        act\n" +
        "    let pinned: Seq(String) = source\n" +
        "    helper(source)\n",
      "run",
    )).toBe("Seq(String) -> () ->! Unit");
  });
});

describe("a body that calls a held one settles beside it", () => {
  test("a held pure callee beside a written `->?` conduit stays pure", () => {
    expect(typeOf(
      "let run(source, cb: () ->? Unit) =\n" +
        "    let a = () => source.size()\n" +
        "    let n = a()\n" +
        "    cb?()\n" +
        "    n\n",
      "run",
    )).toBe("({size: () -> a, ...b}, () ->? Unit) ->? a");
  });

  test("a pure and an impure held callee keep their own colours", () => {
    expect(typeOf(
      "let outer(source) =\n" +
        "    let a = () => source.forEach!((value) => save!(value))\n" +
        "    let b = () => source.length()\n" +
        "    a!()\n" +
        "    let k = b()\n" +
        "    let pinned: Seq(String) = source\n" +
        "    k\n",
      "outer",
    )).toBe("Seq(String) ->! Int");
  });

  test("an impure held callee leaves a written `->?` beside it as written", () => {
    expect(typeOf(
      "let outer(source, cb: () ->? Unit) =\n" +
        "    let a = () => source.forEach!((value) => save!(value))\n" +
        "    a!()\n" +
        "    cb?()\n" +
        "    let pinned: Seq(String) = source\n" +
        "    ()\n",
      "outer",
    )).toBe("(Seq(String), () ->? Unit) ->! Unit");
  });
});

describe("bodies that reach several holds settle together", () => {
  test("two held pure callees beside a written `->?` conduit stay pure", () => {
    // Settled in one hold, neither callee is the caller's conduit.
    expect(typeOf(
      "let run(s1, s2, cb: () ->? Unit) =\n" +
        "    let a = () => s1.size()\n" +
        "    let b = () => s2.size()\n" +
        "    let n = a()\n" +
        "    let m = b()\n" +
        "    cb?()\n" +
        "    n\n",
      "run",
    )).toBe("({size: () -> a, ...b}, {size: () -> c, ...d}, () ->? Unit) ->? a");
  });

  test("a pure held callee and an impure one, in either order", () => {
    expect(typeOf(
      "let run(s1, s2) =\n" +
        "    let a = () => s1.length()\n" +
        "    let b = () => s2.forEach!((v) => save!(v))\n" +
        "    let c = () =>\n" +
        "        let k = a()\n" +
        "        b!()\n" +
        "        k\n" +
        "    let p1: Seq(String) = s1\n" +
        "    let p2: Seq(String) = s2\n" +
        "    c\n",
      "run",
    )).toBe("(Seq(String), Seq(String)) -> () ->! Int");
  });

  test("a knot whose member calls a held body settles with it", () => {
    const knot = (member: string): string =>
      "let run(source) =\n" +
      "    let a = () => source.forEach!((v) => save!(v))\n" +
      "    fun\n" +
      `        ping(n: Int): Int =\n${member}` +
      "        pong(n: Int): Int = if n > 0 then ping!(n - 1) else 0\n" +
      "    let pinned: Seq(String) = source\n" +
      "    ping!(1)\n";
    expect(typeOf(knot("            a!()\n            pong!(n)\n"), "run")).toBe("Seq(String) ->! Int");
    expect(typeOf(knot(
      "            let c = () =>\n" +
        "                a!()\n" +
        "                pong!(n)\n" +
        "            c!()\n",
    ), "run")).toBe("Seq(String) ->! Int");
  });
});

describe("a held colour is not generalized before it settles", () => {
  // A lambda waiting for a goal cannot be quantified: each use would take a
  // copy of its colour that the goal's call, settling later, never reaches —
  // #378 again. So until the goal settles its uses share one colour, as a
  // knot-held lambda's do — ruled on #1148; the Effects redesign's joins may
  // lift it (#1144). Settling the receiver first, or annotating it, keeps the
  // polymorphism. A `Seq` seat does not settle it — a source whose head is
  // unknown waits for its owner's close there (Collections Part 5 §3.5) — so the
  // settling line joins it with a sequence instead.
  const act = (settle: string, annotate: string): string =>
    `let run(source${annotate}) =\n${settle}` +
    "    let act = (cb: () ->? Unit) =>\n" +
    "        cb?()\n" +
    "        source.length()\n" +
    "    let x = act!(() => save!(\"a\"))\n" +
    "    let y = act(() => ())\n" +
    (settle === "" && annotate === "" ? "    let pinned: Seq(String) = source\n" : "") +
    "    y\n";

  test("a waiting lambda used at two colours is refused", () => {
    expect(refusals(act("", ""))).toEqual([
      "this signature's `->?` promises a colour the caller chooses, but the body solves it to the " +
        "impure constant — a function that performs its own unconditional effects rounds up, and " +
        "its face is `->!`",
    ]);
  });

  test("settling the receiver first, or annotating it, keeps it polymorphic", () => {
    expect(refusals(act("    let pinned = [source, Iterable.toSeq([\"a\"])]\n", ""))).toEqual([]);
    expect(refusals(act("", ": Seq(String)"))).toEqual([]);
  });
});

describe("what a held colour meets before it settles is compared after", () => {
  test("the goals a knot settles at its close meet its members' colours as the knot does", () => {
    // The knot waits for `xs`'s goal, so it is held whole: a sibling's colour
    // meeting the `->` parameter of `map` meanwhile is a recorded demand, `b`
    // keeps `->!`, and the report stands at the demand.
    expect(refusals(
      "fun\n" +
        "    a(xs, n: Int): Unit =\n" +
        "        ignore(xs.map(b))\n" +
        "    b(s: String): Int =\n" +
        "        save!(s)\n" +
        "        a!(Seq.singleton(s), 1)\n" +
        "        0\n",
    )).toEqual([
      "a `->` arrow promises purity, and this function performs effects — the demand is " +
        "written `->`, the function's face `->?` or `->!`",
      "this call is pure, so `a` wants no mark, not `!`",
    ]);
  });

  test("a `->` demand is refused at the demand", () => {
    expect(refusals(heldLambda("let quiet: () -> Unit = act\n    quiet"))).toEqual([
      "a `->` arrow promises purity, and this function performs effects — the demand is " +
        "written `->`, the function's face `->?` or `->!`",
    ]);
  });

  test("a held body whose goal is pure stays pure", () => {
    expect(refusals(
      "let run(source) =\n" +
        "    let act = () => source.length()\n" +
        "    let pinned: Seq(String) = source\n" +
        "    act!()\n",
    )).toEqual(["this call is pure, so `act` wants no mark, not `!`"]);
  });
});
