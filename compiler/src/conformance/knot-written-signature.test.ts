import { describe, expect, test } from "vitest";

import { compileFiles } from "../support/test-project.js";

/**
 * Conformance for **a member's written signature, read where its knot opens**
 * (Effects §3.4, Functions §7.4; #1279).
 *
 * Before any member's body is checked, each member's type is the function type
 * its declaration writes: its written parameter and result types, every part
 * the text leaves open (a hole, an unwritten parameter) fresh, its declared
 * variables rigid, its own arrow's colours left to its body and the knot's
 * close. It is one monotype, never a scheme (annotations §9.11). Every use a
 * sibling makes therefore meets what the text wrote, whichever member's body is
 * checked first: each program below is checked in both member orders, and the
 * two verdicts, and the reports, are one.
 *
 * What a sibling's *body* works out is not read here (#1278): a seat that meets
 * an unwritten result still follows member order, and these tests do not pin it.
 */

const world = `extern from "./world.js"
    export fun save(document: String) ->! Unit
let noop2(): Unit = ()
let save0(): Unit = save!("x")
`;

interface Report {
  readonly at: string;
  readonly message: string;
}

function reports(source: string): readonly Report[] {
  const text = "module Main\n\n" + world + source;
  return compileFiles([["/world.js", ""], ["/main.hex", text]]).diagnostics.map(({ primary, message }) => ({
    at: text.slice(primary.start.offset, primary.end.offset),
    message,
  }));
}

/** The program with its knot's two members in each order; `head` is the block's first line. */
function bothOrders(first: string, second: string, after: string, head = "fun"): readonly string[] {
  return [`${head}\n${first}${second}${after}`, `${head}\n${second}${first}${after}`];
}

/** Every order's reports, each beside its program so a failure names the order. */
function inEveryOrder(programs: readonly string[]): readonly (readonly [string, readonly Report[]])[] {
  return programs.map((program) => [program, reports(program)] as const);
}

function expectInEveryOrder(programs: readonly string[], expected: readonly Report[]): void {
  expect(inEveryOrder(programs)).toEqual(programs.map((program) => [program, expected]));
}

describe("a member's written signature is read where its knot opens (#1279)", () => {
  /** Verdict Table row 50: a ground written result, at a `->!` seat a sibling holds. */
  test("a written ground result decides a sibling's seat in either order (row 50)", () => {
    const use = "    useIt(p): Unit =\n        let w: (() ->! Unit, Int) = mkP(p)\n        ()\n";
    const make = "    mkP(q): (() -> Unit, Int) =\n        useIt(q)\n        (noop2, 1)\n";
    expectInEveryOrder(bothOrders(use, make, "export let user(): Unit = useIt(1)\n"), []);
  });

  /**
   * Rows 104/104b: a written result that is itself a function type lands too.
   * It is the member's face, a fact its own body meets at its own seat ("a
   * member is its value", #1232): a body that breaks it is refused there, in
   * either order.
   */
  test("a written function-typed result decides a sibling's seat, and binds its own body (rows 104, 104b)", () => {
    const use = "    useF(p: Int): Unit =\n        let f: () ->! Unit = mkF(p)\n        ()\n";
    const make = (value: string): string => `    mkF(q: Int): () -> Unit =\n        useF(q)\n        ${value}\n`;
    const after = "export let user(): Unit = useF(1)\n";
    expectInEveryOrder(bothOrders(use, make("noop2"), after), []);
    expectInEveryOrder(bothOrders(use, make("save0"), after), [{
      at: "() -> Unit",
      message: "a `->` arrow promises purity and that the function cannot fail, and this function is impure " +
        "and may fail — the demand is written `->`",
    }]);
  });

  /**
   * A written `>->` result follows the member's own written callbacks from the
   * opening, as the member's face does (Effects §2.4): a sibling's `->!` seat
   * reads it so, and never pins it before the face links it.
   */
  test("a written `>->` result follows the member's callbacks at a sibling's seat", () => {
    const make = "    mkF(k: () ->! Unit, q: Int): () >-> Unit =\n        useF(q, k)\n        () => k!()\n";
    const after = "export let user(): Unit = useF(1, save0)\n";
    for (const seat of [
      "        let f: () ->! Unit = mkF(k, p)\n",
      "        let g = mkF(k, p)\n        let f: () ->! Unit = g\n",
    ]) {
      const use = `    useF(p: Int, k: () ->! Unit): Unit =\n${seat}        ()\n`;
      expectInEveryOrder(bothOrders(use, make, after), []);
    }
  });

  /** Rows 105/105b: a written `Int` result is a solved type at a sibling's `Float` seat, which widens it. */
  test("a written numeric result widens at a sibling's seat in either order (rows 105, 105b)", () => {
    const a = "    a(n: Int): Float =\n        let x: Float = b(n)\n        0.0\n";
    const b = "    b(n: Int): Int =\n        let y = if n == 0 then 0.0 else a(n - 1)\n        n\n";
    expectInEveryOrder(bothOrders(a, b, "export let user(): Unit =\n    let r = a(2)\n    ()\n"), []);
  });

  /**
   * A member of the block that an earlier component already closed is not
   * open: a call to it is decided by its written result type as any
   * function's is, whichever order the open knot's members come in.
   */
  test("a written result of a member an earlier component closed decides a forwarder's value in every order", () => {
    const other = "    other(q: Int): (() -> Unit, Int) =\n        let z = q\n        (noop2, 1)\n";
    const use = "    useF(p: Int): Unit =\n        let f: (() ->! Unit, Int) = mk(p)\n        ()\n";
    const mk = "    mk(q) =\n        useF(q)\n        other(q)\n";
    const orders = [[other, use, mk], [other, mk, use], [use, other, mk], [use, mk, other], [mk, other, use], [mk, use, other]];
    expectInEveryOrder(orders.map((members) => `fun\n${members.join("")}export let user(): Unit = useF(1)\n`), []);
  });

  /**
   * Writing the forwarder's result type is a spelling of the same program,
   * and compiles in every order too.
   */
  test("a forwarder whose result type is written compiles in every order", () => {
    const other = "    other(q: Int): (() -> Unit, Int) =\n        let z = q\n        (noop2, 1)\n";
    const use = "    useF(p: Int): Unit =\n        let f: (() ->! Unit, Int) = mk(p)\n        ()\n";
    const mk = "    mk(q): (() -> Unit, Int) =\n        useF(q)\n        other(q)\n";
    const orders = [[other, use, mk], [other, mk, use], [use, other, mk], [use, mk, other], [mk, other, use], [mk, use, other]];
    expectInEveryOrder(orders.map((members) => `fun\n${members.join("")}export let user(): Unit = useF(1)\n`), []);
  });

  /**
   * What a sibling's body works out is not read while the knot is open
   * (Effects §3.4): a call to a member whose declaration writes no result type
   * is not made from the text, so the value it hands back is not re-opened
   * at a seat, in either order. Writing the member's result type is the
   * spelling that works, in either order.
   */
  test("a call to a member that writes no result type is not re-opened at a sibling's seat, in either order", () => {
    const use = "    useF(p: Int, k: () -> Unit): Unit =\n        let f: () ->! Unit = pass(k, p)\n        ()\n";
    const pass = (result: string): string => `    pass(k, n)${result} =\n        useF(n, k)\n        k\n`;
    const after = "export let user(): Unit = useF(1, noop2)\n";
    const fixed = "this position's arrow says the function is impure and may fail, and the pure arrow meeting it, " +
      "which cannot fail, was fixed before it arrived — by another use, by a type written where it was made, " +
      "inside an argument read invariantly, or in a parameter's type — so it cannot fit as a function used here " +
      "does; write the arrow where it was fixed";
    // Where the one report stands still follows which body is checked first.
    expect(inEveryOrder(bothOrders(use, pass(""), after)).map(([program, found]) =>
      [program, found.map(({ message }) => message)]
    )).toEqual(bothOrders(use, pass(""), after).map((program) => [program, [fixed]]));
    expectInEveryOrder(bothOrders(use, pass(": () -> Unit"), after), []);
  });

  /** A written result with a hole still decides the arrow it spells, at a sibling's seat. */
  test("a written result's arrow decides a sibling's seat though the result holds a hole", () => {
    const use = "    useF(p) =\n        let f: () ->! Unit = mk(p)\n        ()\n";
    const mk = "    mk(q: Int): () -> _ =\n        useF(q)\n        noop2\n";
    expectInEveryOrder(bothOrders(use, mk, "export let user(): Unit = useF(1)\n"), []);
  });

  /** A result written with the block head's variable is that rigid variable at every sibling's seat. */
  test("a result written with a block head's variable decides a sibling's seat", () => {
    const use = "    useIt(x: a): Unit =\n        let w: (() ->! Unit, a) = mkP(x)\n        ()\n";
    const make = "    mkP(x: a): (() -> Unit, a) =\n        useIt(x)\n        (noop2, x)\n";
    expectInEveryOrder(bothOrders(use, make, "export let user(): Unit = useIt(1)\n", "fun<a>"), []);
  });

  /**
   * #1236: a call that disagrees with a sibling's written parameter type is a
   * demand, refused at that call, in either order; the sibling's own text is
   * never what is blamed.
   */
  test("a call that disagrees with a sibling's written types is refused at the call (#1236)", () => {
    const a = "    a(): Int = b(\"x\")\n";
    const b = "    b(n: Int): Int = if n > 0 then a() else 2\n";
    expectInEveryOrder(bothOrders(a, b, ""), [{ at: "b(\"x\")", message: "type mismatch: expected Int, found String" }]);
  });

  /**
   * #1045's first seat: a self-recursive call's argument meets the declared
   * variable its member writes, which is a widening target there as anywhere in
   * the body (Numeric Literals §5.1).
   */
  test("a self-recursive call's argument widens into the member's declared variable (#1045)", () => {
    expect(reports("fun f<t: Num>(x: t, n: Nat, go: Bool): t = if go then f(n, 0, False) else x\n")).toEqual([]);
  });

  /**
   * Method Syntax §3.1: a dot on a sibling's call is decided where the
   * sibling's declaration writes its result type, in either order; a result
   * its body works out is not decided while the knot is open (#1278), so the
   * dot keeps its refusal in either order.
   */
  test("a dot on a sibling's written result is decided, and on an unwritten one is refused, in either order", () => {
    const a = "    a(n: Int): Bool = if n == 0 then True else b(n - 1).isEmpty()\n";
    const written = "    b(n: Int): Vector(Int) = if n == 0 then [] else if a(n - 1) then [n] else []\n";
    const unwritten = "    b(n: Int) = if n == 0 then [] else if a(n - 1) then [n] else [1]\n";
    expectInEveryOrder(bothOrders(a, written, ""), []);
    // Its head is what a dot reads: a hole in the element leaves it decided.
    const hole = "    b(n: Int): Vector(_) = if n == 0 then [] else if a(n - 1) then [n] else []\n";
    expectInEveryOrder(bothOrders(a, hole, ""), []);
    expectInEveryOrder(bothOrders(a, unwritten, ""), [{
      at: "isEmpty",
      message: "the program's text does not decide the subject's type here, so `.isEmpty(…)` cannot tell whose " +
        "`isEmpty` it is — write the subject's type, or call the operation by its module " +
        "(`Module.isEmpty(…, …)`); a record's field is called as `(….isEmpty)(…)`",
    }]);
  });

  /**
   * A lambda handed to a member of a knot still open takes its parameter's
   * type from what the member's declaration writes, so a dot on it is decided
   * in either order. Inside the knot such a call is a recursive one, which
   * hands on only the callbacks it was given (Effects §3.4, L3), so that is the
   * one report: the dot draws none.
   */
  test("a lambda handed to an open member reads its written parameter type at a dot", () => {
    const made = "this function is not one `go` was given, and a recursive call hands on only the callbacks it was given";
    expect(reports(
      "fun go(n: Int, k: (Vector(Int)) -> Int): Int = if n == 0 then k([]) else go(n - 1, (r) => k(r.append(n)))\n",
    )).toEqual([{ at: "(r) => k(r.append(n))", message: made }]);
    const go = "    go(n: Int, k: (Vector(Int)) -> Int): Int = if n == 0 then k([]) else go2(n - 1, (r) => k(r.append(n)))\n";
    const go2 = "    go2(n: Int, k: (Vector(Int)) -> Int): Int = go(n, k)\n";
    expectInEveryOrder(bothOrders(go, go2, ""), [{ at: "(r) => k(r.append(n))", message: made }]);
  });

  /**
   * A member an earlier component of the block has closed is generalized: a
   * lambda handed to it from a later component takes its untyped parameter's
   * type, the callback's colour among it, from that member's written
   * signature, as under any function's (#1119 R.b). Only a member of a knot
   * still open lands nothing.
   */
  test("a member an earlier component closed lands its written parameter type on a later component's lambda", () => {
    const tools = "let applyPure(k: (() -> Unit) -> Unit): Unit = k(() => ())\n";
    const applyK = "    applyK(k: ((() ->! Unit) -> Unit) -> Unit): Unit = k((f) => ())\n";
    const go = "    go(): Unit = applyK((f) => applyPure(f))\n";
    expectInEveryOrder(bothOrders(applyK, go, "", tools + "fun"), []);
  });
});
