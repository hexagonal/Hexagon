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
 * qualified form (`Show.show(kid)`) exist beside it, and the own-name refusal
 * α deferred has landed — see the bottom describe, which replaces α's
 * deliberately-overturnable baseline pin with the ruling it was waiting for.
 * Interpolation stays here unchanged: these three are emission pins, and the
 * fault line they measure is about *when* an instance is read, not how it is
 * spelled.
 */

describe("a recursive member executes (pin 1)", () => {
  test("`Show<Tree>` recursing into `Vector(Tree)` kids", async () => {
    const exports = await runMain([
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
      "export record Ping = {label: Int, next: Option(Pong)}",
      "export record Pong = {label: Int, back: Option(Ping)}",
      "",
      "honor Show<Ping> =",
      "    show(ping) = match ping.next",
      "        Some(pong) => \"Ping(${ping.label} ${pong})\"",
      "        None => \"Ping(${ping.label})\"",
      "",
      "honor Show<Pong> =",
      "    show(pong) = match pong.back",
      "        Some(ping) => \"Pong(${pong.label} ${ping})\"",
      "        None => \"Pong(${pong.label})\"",
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
      "export union Rose(a) = Leaf | Branch(item: a, kids: Vector(Rose(a)))",
      "",
      "honor<a: Show> Show<Rose(a)> =",
      "    show(rose) = match rose",
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
   * PR α pinned the opposite of this — the note's reading (i), where the bare
   * spelling inside the body was the polymorphic export, evidence-selected at
   * the argument's type — as an explicit baseline for PR γ to overturn once the
   * rewrites the refusal names existed. They do now, so the refusal lands:
   * a member definition is a `let` header, not a `fun` (#293's non-`fun` law),
   * and its own body may not call its own name.
   *
   * The refusal is what makes recursion *spelled*. Under reading (i) the same
   * spelling would evidence-select a different instance depending on the
   * argument's type inside its own definition — a subtlety wearing an innocent
   * face, which is exactly what James ruled against.
   */
  test("bare `show` inside `Show<Wrap>`'s body is refused with the rewrite", () => {
    const project = compileMain([
      "export record Wrap = {inner: Int}",
      "",
      "honor Show<Wrap> =",
      "    show(wrap) = \"Wrap(\" ++ show(wrap.inner) ++ \")\"",
      "",
    ].join("\n"));

    expect(project.diagnostics.map(({ message }) => message)).toEqual([
      "`show` is this member's own name, and a member cannot call itself bare; " +
      "recursion is spelled through dispatch — write the dot call `value.show()`, " +
      "or qualify the instance you mean: `Show.show(…)`",
    ]);
  });

  /** The sanctioned rewrite, executed — a refusal whose fixit does not run is half a ruling. */
  test("the ruled dot-call rewrite compiles and runs", async () => {
    const exports = await runMain([
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
      "constraint Countdown<a> =",
      "    step(value: a): a",
      "    down(value: a, times: Int): a =",
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
