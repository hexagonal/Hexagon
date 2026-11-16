import { describe, expect, test } from "vitest";

import { compileMain, runMain } from "../support/test-project.js";

/**
 * The #335 pilot's three **executed** recursion pins (the direction note's §5
 * item 9). The governing line, proven by the `Vector(Vector(a))` faults
 * (commit `6a34584`): anything an instance needs before its own `const`
 * finishes initializing is a fault; anything inside a member's lambda is safe.
 * Both #306 faults were clean compiles found only when a pin finally executed
 * the nested shape — which is why every test here runs the emitted JavaScript
 * rather than stopping at diagnostics.
 *
 * The recursive step in each body is spelled with string interpolation
 * (`"${kid}"`), which reaches `Show` evidence and names no binding. That was PR
 * α's only sanctioned spelling; since PR γ the dot call (`kid.show()`) and the
 * qualified form (`Show.show(kid)`) exist beside it, and so does a bare
 * `show(kid)`, the prelude's `show` selecting the instance at the kid's type —
 * see the bottom describe (Constraints §4.6, #757).
 * Interpolation stays here unchanged: these three are emission pins, and the
 * fault line they measure is about *when* an instance is read, not how it is
 * spelled.
 */

describe("a recursive member executes (pin 1)", () => {
  test("`Show<Tree>` recursing into `Vector(Tree)` kids", async () => {
    const exports = await runMain([
      "module Main",
      "",
      "export record Tree = {value: Int, kids: Vector(Tree)}",
      "",
      "honor Show<Tree> =",
      "    show(tree) =",
      "        tree.kids.toSeq().fold(\"Tree(${tree.value}\", (line, kid) => line ++ \" ${kid}\") ++ \")\"",
      "",
      "export let leafy: String = show(Tree({value = 9, kids = []}))",
      "export let nested: String =",
      "    show(Tree({value = 1, kids = [Tree({value = 2, kids = []}), Tree({value = 3, kids = []})]}))",
      "",
    ].join("\n"));

    expect(exports.leafy).toBe("Tree(9)");
    expect(exports.nested).toBe("Tree(1 Tree(2) Tree(3))");
  });
});

describe("mutually recursive instances execute (pin 2)", () => {
  /**
   * `Show` has one member, so the note's "mutually recursive members of one
   * block" has no Show form; the substitute is the cross-instance shape — two
   * records whose instances reference each other through interpolation. Each
   * dictionary names the other inside a member lambda, which is the safe side
   * of the §5 item 9 fault line whatever order the consts initialize in.
   */
  test("`Show<Ping>` and `Show<Pong>` reference each other", async () => {
    const exports = await runMain([
      "module Main",
      "",
      "export record Ping = {label: Int, next: Option(Pong)}",
      "export record Pong = {label: Int, back: Option(Ping)}",
      "",
      // Instances that use each other are one knot: an honor group
      // (Constraints §4.8).
      "honor",
      "    Show<Ping> =",
      "        show(ping) = match ping.next with",
      "            Some(pong) => \"Ping(${ping.label} ${pong})\"",
      "            None => \"Ping(${ping.label})\"",
      "",
      "    Show<Pong> =",
      "        show(pong) = match pong.back with",
      "            Some(ping) => \"Pong(${pong.label} ${ping})\"",
      "            None => \"Pong(${pong.label})\"",
      "",
      "export let chain: String =",
      "    show(Ping({label = 1, next = Some(Pong({label = 2, back = Some(Ping({label = 3, next = None}))}))}))",
      "",
    ].join("\n"));

    expect(exports.chain).toBe("Ping(1 Pong(2 Ping(3)))");
  });
});

describe("a recursive parameterized instance executes (pin 3)", () => {
  /**
   * The dangerous cousin: `Show<Rose(a)>` needs `Show<a>` for the item and
   * *itself* for the kids. Kept inside the member's lambda both are call-time
   * reads; pre-composed outside it this is the #306 crash wearing evidence
   * clothes — a clean compile and a load-time `ReferenceError`.
   */
  test("hand-written `honor<a: Show> Show<Rose(a)>`", async () => {
    const exports = await runMain([
      "module Main",
      "",
      "export union Rose(a) = Leaf | Branch(item: a, kids: Vector(Rose(a)))",
      "",
      "honor<a: Show> Show<Rose(a)> =",
      "    show(rose) = match rose with",
      "        Leaf => \"leaf\"",
      "        Branch(item, kids) =>",
      "            kids.toSeq().fold(\"(${item}\", (line, kid) => line ++ \" ${kid}\") ++ \")\"",
      "",
      "export let flat: String = show(Branch(7, []))",
      "export let deep: String = show(Branch(1, [Branch(2, [Leaf]), Leaf]))",
      "",
    ].join("\n"));

    expect(exports.flat).toBe("(7)");
    expect(exports.deep).toBe("(1 (2 leaf) leaf)");
  });

  /**
   * The derived flavor of the same shape. #274 records that
   * `union Tree(a) derives Eq` already crashes the emitter; whether the Show
   * sibling shares the fault is measured here rather than assumed.
   */
  test("derived `Show` on a recursive parameterized union", async () => {
    const exports = await runMain([
      "module Main",
      "",
      "export union DTree(a) derives Show = DLeaf | DBranch(item: a, kids: Vector(DTree(a)))",
      "",
      "export let shown: String = show(DBranch(1, [DLeaf]))",
      "",
    ].join("\n"));

    expect(exports.shown).toBe("DBranch(1, [DLeaf])");
  });
});

describe("a member's own name in its own body (Constraints §4.6)", () => {
  /**
   * A member's own name is pending in its body and reaches nothing there, so a
   * bare spelling in the body reads as it reads anywhere in the module — and
   * honoring binds no bare name (#757). Bare `show` is therefore the prelude's
   * `show`, as in every module: at `wrap.inner` it selects `Show<Int>` by
   * ordinary dispatch, and nothing about the body being `Show<Wrap>`'s own
   * changes that. The own-name refusal this test used to pin is gone with the
   * reading that needed it.
   */
  test("bare `show` inside `Show<Wrap>`'s body is the prelude's `show`", async () => {
    const exports = await runMain([
      "module Main",
      "",
      "export record Wrap = {inner: Int}",
      "",
      "honor Show<Wrap> =",
      "    show(wrap) = \"Wrap(\" ++ show(wrap.inner) ++ \")\"",
      "",
      "export let shown: String = show(Wrap({inner = 5}))",
      "",
    ].join("\n"));

    expect(exports.shown).toBe("Wrap(5)");
  });

  /**
   * At the honored type the same bare spelling is the recursion: the prelude's
   * `show` at `Wrap` selects the instance being defined, a use of the instance
   * inside its own knot (§4.8) — one of the routes §4.6 lists beside the dot.
   */
  test("bare `show` at the honored type inside its own body recurses through the instance", async () => {
    const exports = await runMain([
      "module Main",
      "",
      "export union Nest = Leaf | Wrapped(Nest)",
      "",
      "honor Show<Nest> =",
      "    show(nest) = match nest with",
      "        Leaf => \"leaf\"",
      "        Wrapped(inner) => \"(\" ++ show(inner) ++ \")\"",
      "",
      "export let shown: String = show(Wrapped(Wrapped(Leaf)))",
      "",
    ].join("\n"));

    expect(exports.shown).toBe("((leaf))");
  });

  /** The sanctioned rewrite, executed — a refusal whose fixit does not run is half a ruling. */
  test("the ruled dot-call rewrite compiles and runs", async () => {
    const exports = await runMain([
      "module Main",
      "",
      "export record Wrap = {inner: Int}",
      "",
      "honor Show<Wrap> =",
      "    show(wrap) = \"Wrap(\" ++ wrap.inner.show() ++ \")\"",
      "",
      "export let shown: String = show(Wrap({inner = 5}))",
      "",
    ].join("\n"));

    expect(exports.shown).toBe("Wrap(5)");
  });

  /**
   * The exemption in the same bullet: a constraint *declaration's* default body
   * is not an honor block. Its member references reach whichever instance
   * completes it, at call time — an evidence route, which names no binding — so
   * a default that names its own member is as legal as it ever was.
   */
  test("a declaration default naming its own member is not refused", async () => {
    const exports = await runMain([
      "module Main",
      "",
      "constraint Countdown<a> =",
      "    step(value: a) -> a",
      "    down(value: a, times: Int) -> a =",
      "        if times <= 0 then value else down(step(value), times - 1)",
      "",
      "honor Countdown<Int> =",
      "    step(value) = value - 1",
      "",
      "export let landed: Int = down(10, 4)",
      "",
    ].join("\n"));

    expect(exports.landed).toBe(6);
  });
});
