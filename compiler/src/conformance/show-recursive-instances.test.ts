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
 * (`"${kid}"`), which reaches `Show` evidence. In PR α that is the sanctioned
 * recursion spelling; the dot-call and honoring-module-qualified forms the
 * note's §5 item 8 names arrive with later PRs, and the own-name refusal that
 * ruling also carries is deferred with them — see the bare-spelling pin at the
 * bottom for what the spelling means today.
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

describe("what the bare member spelling means inside an instance body today", () => {
  /**
   * The note's §5 item 8 rules that a member's own bare spelling is refused in
   * its own body (#293's non-`fun` law applied to members), rewriting to the
   * dot-call or qualified forms. Those forms arrive with later PRs, and until
   * they exist the refusal would leave recursion with no spelling at all — so
   * PR α defers it, and this pin is the baseline it will overturn: today the
   * bare spelling inside the body is the polymorphic export, evidence-selected
   * at the argument's type (the note's rejected reading (i)), exactly as the
   * pre-existing `Describe<Tree(a)>` emitter pin already relies on.
   */
  test("bare `show` inside `Show<Wrap>`'s body evidence-selects today", async () => {
    const exports = await runMain([
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
});
