import { describe, expect, test } from "vitest";

import { compileFiles, projectDiagnostics, runMain, runProject } from "../support/test-project.js";

/**
 * Conformance for Constraints §4.8, **honor knots and the honor group** (#1227,
 * #1392), with §4.6's member bindings and §8's rows.
 *
 * Every honor is a knot, as every `fun` is: its own body sees its instance, and
 * honors that need each other are declared as one honor group. Every use of an
 * instance this module declares stands below its honor's knot or inside it; a
 * `derives` clause's instances stand at their type's line as one knot; a
 * `widens` door stands above the honors that account for it, outside any knot.
 *
 * The knot's colours (Effects §13.3's inside-the-knot
 * bullet, §3.4). A call at an instance of the knot, from inside it, follows
 * the knot: the instance's own colour, its body with every callback silent,
 * solved with its siblings' and settled where the knot closes. Only own
 * colours wait; a call's callbacks are its own, so a recursive call at an
 * instance may hand any callback.
 */

const MAIN = "module Main\n\n";

/** §8's above-honor row, with its default advice. */
const above = (instance: string) =>
  `\`${instance}\` is used here, and its honor is declared below it; ` +
  "declarations are read top-down — move the honor above this use";

/** The same row's opening, for the advice that replaces the default. */
const opening = (instance: string) =>
  `\`${instance}\` is used here, and its honor is declared below it; declarations are read top-down — `;

const P = "record P = {x: Int}\n";
const SHOW_P = 'honor Show<P> =\n    show(p) = "P${p.x}"\n';
const EQ_P = "honor Eq<P> =\n    equals(a, b) = a.x == b.x\n";

describe("every honor is a knot (§4.8)", () => {
  test("a lone honor's body sees its own instance: a recursive instance needs no ceremony", async () => {
    const exports = await runMain(MAIN +
      "export union Tree = Leaf | Node(Tree, Int, Tree)\n" +
      "honor Show<Tree> =\n" +
      "    show(t) = match t\n" +
      '        Leaf => "."\n' +
      '        Node(l, n, r) => "(${l} ${n} ${r.show()})"\n' +
      "export let shown: String = Node(Leaf, 1, Node(Leaf, 2, Leaf)).show()\n");
    expect(exports["shown"]).toBe("(. 1 (. 2 .))");
  });

  test("the knot imposes no monotype: `Show<Nested(a)>` shows a `Nested(Vector(a))`", async () => {
    const exports = await runMain(MAIN +
      "union Nested(a) = Flat(a) | Nest(Nested(Vector(a)))\n" +
      "honor<a: Show> Show<Nested(a)> =\n" +
      "    show(n) = match n\n" +
      "        Flat(v) => v.show()\n" +
      '        Nest(inner) => "<${inner.show()}>"\n' +
      "export let shown: String = Nest(Flat([1, 2])).show()\n");
    expect(exports["shown"]).toBe("<[1, 2]>");
  });
});

describe("a use stands below its honor (§4.8, §8)", () => {
  test("every spelling of a member call above its honor is refused, once each", () => {
    for (const call of ["Show.show(p)", "p.show()", "p |> Show.show"]) {
      expect(projectDiagnostics(MAIN + P + `let early(p: P): String = ${call}\n` + SHOW_P))
        .toEqual([above("Show<P>")]);
      expect(projectDiagnostics(MAIN + P + SHOW_P + `let late(p: P): String = ${call}\n`)).toEqual([]);
    }
    // The bare spelling names the member binding (§4.6), which enters the
    // order with its honor's knot: the declared-later error, and only it.
    expect(projectDiagnostics(MAIN + P + "let early(p: P): String = show(p)\n" + SHOW_P)).toEqual([
      "`show` is bound by the `Show` instance below this use; declarations are read top-down — " +
      "move the instance above this use",
    ]);
  });

  test("an operator, interpolation, and evidence handed to generic code are uses", () => {
    expect(projectDiagnostics(MAIN + P + "let same(p: P): Bool = p == p\n" + EQ_P))
      .toEqual([above("Eq<P>")]);
    expect(projectDiagnostics(MAIN + P + 'let said(p: P): String = "${p}"\n' + SHOW_P))
      .toEqual([above("Show<P>")]);
    expect(projectDiagnostics(MAIN + P +
      "fun describe<a: Show>(v: a): String = v.show()\n" +
      "let early(p: P): String = describe(p)\n" + SHOW_P +
      "let late(p: P): String = describe(p)\n")).toEqual([above("Show<P>")]);
  });

  test("a `for` head at the type is a use", () => {
    const bag = "record Bag = { items: Vector(Int) }\n";
    const iterable = "honor Iterable<Bag> =\n    type Item = Int\n    toSeq(b) = b.items.toSeq()\n";
    const loop = "let total(b: Bag): Int =\n    var sum = 0\n    for n in b\n        sum := sum + n\n    sum\n";
    expect(projectDiagnostics(MAIN + bag + loop + iterable)).toEqual([above("Iterable<Bag>")]);
    expect(projectDiagnostics(MAIN + bag + iterable + loop)).toEqual([]);
  });

  test("an annotation, a bound, and a demand that stays generic are not uses", () => {
    expect(projectDiagnostics(MAIN + P +
      "fun describe<a: Show>(v: a): String = v.show()\n" +
      "let keep(p: P): P = p\n" +
      "let generic(v) = describe(v)\n" + SHOW_P)).toEqual([]);
  });

  test("a base obligation is a use: an extending honor stands below its base", () => {
    const ord = "honor Ord<P> =\n    compare(a, b) = a.x.compare(b.x)\n";
    expect(projectDiagnostics(MAIN + P + ord + EQ_P)).toEqual([above("Eq<P>")]);
    expect(projectDiagnostics(MAIN + P + EQ_P + ord)).toEqual([]);
  });

  test("an instance another module declares stands above every use in this one", () => {
    expect(compileFiles([
      ["/lib.hex", "module Lib\n\nexport record Q = {x: Int}\nhonor Show<Q> =\n    show(q) = \"Q\"\n"],
      ["/main.hex", MAIN + "import Lib\n\nexport let s: String = Lib.Q({x = 1}).show()\n"],
    ]).diagnostics).toEqual([]);
  });

  test("a use above its honor is told once, in the law's words, whatever its colour", () => {
    // The narrow #1228 refusal of a call following a body below it is retired
    // into this one report (§8).
    const R = "constraint R<a> =\n    read(s: a) ->! String\n";
    expect(projectDiagnostics(MAIN + R + P + "let early(p: P): String = read!(p)\n" +
      "honor R<P> =\n    read(s) = \"r\"\n")).toEqual([above("R<P>")]);
  });
});

describe("the honor group (§4.8)", () => {
  const PING_PONG = "export record Ping = {label: Int, next: Option(Pong)}\n" +
    "export record Pong = {label: Int, back: Option(Ping)}\n";
  const ping = "    Show<Ping> =\n        show(ping) = match ping.next\n" +
    '            Some(pong) => "Ping(${ping.label} ${pong})"\n' +
    '            None => "Ping(${ping.label})"\n';
  const pong = "    Show<Pong> =\n        show(pong) = match pong.back\n" +
    '            Some(ping) => "Pong(${pong.label} ${ping})"\n' +
    '            None => "Pong(${pong.label})"\n';
  const chain = "export let chain: String =\n" +
    "    Ping({label = 1, next = Some(Pong({label = 2, back = Some(Ping({label = 3, next = None}))}))}).show()\n";

  test("honors that need each other are one group, and its items see each other in either order", async () => {
    for (const items of [ping + pong, pong + ping]) {
      const exports = await runMain(MAIN + PING_PONG + "honor\n" + items + chain);
      expect(exports["chain"]).toBe("Ping(1 Pong(2 Ping(3)))");
    }
  });

  test("as two lone honors, the advice is the group, naming both", () => {
    const lone = (item: string) => "honor " + item.slice(4).replace(/\n {4}/gu, "\n");
    expect(projectDiagnostics(MAIN + PING_PONG + lone(ping) + lone(pong))).toEqual([
      opening("Show<Pong>") +
      "`Show<Pong>`'s honor uses `Show<Ping>` too — declare `Show<Ping>` and `Show<Pong>` in one honor group",
    ]);
  });

  test("a cycle of any length is named whole", () => {
    const three = "record A = {b: Option(B)}\nrecord B = {c: Option(C)}\nrecord C = {a: Option(A)}\n" +
      'honor Show<A> =\n    show(v) = "A${v.b}"\n' +
      'honor Show<B> =\n    show(v) = "B${v.c}"\n' +
      'honor Show<C> =\n    show(v) = "C${v.a}"\n';
    expect(projectDiagnostics(MAIN + three)).toEqual([
      opening("Show<B>") + "`Show<B>`'s honor uses `Show<C>`, which uses `Show<A>` too — " +
      "declare `Show<A>`, `Show<B>` and `Show<C>` in one honor group",
      opening("Show<C>") + "`Show<C>`'s honor uses `Show<A>`, which uses `Show<B>` too — " +
      "declare `Show<A>`, `Show<B>` and `Show<C>` in one honor group",
    ]);
  });

  test("a function and an honor that need each other: the function recurses by itself", () => {
    expect(projectDiagnostics(MAIN + P + "let describe(p: P): String = p.show()\n" +
      "honor Show<P> =\n    show(p) = describe(p)\n")).toEqual([
      opening("Show<P>") +
      "`Show<P>`'s honor uses `describe` too — let the function recurse by itself, and call it from the honor",
    ]);
  });

  test("each item declares its own binders", async () => {
    const exports = await runMain(MAIN +
      "union Tree2(a) = Tip(item: a) | Branch(kids: Forest(a))\n" +
      "union Forest(a) = Nil2 | More(head: Tree2(a), rest: Forest(a))\n" +
      "honor\n" +
      "    <a: Show> Show<Tree2(a)> =\n" +
      "        show(t) = match t\n" +
      "            Tip(v) => v.show()\n" +
      '            Branch(f) => "[${f.show()}]"\n' +
      "    <a: Show> Show<Forest(a)> =\n" +
      "        show(f) = match f\n" +
      '            Nil2 => ""\n' +
      '            More(h, r) => "${h}${r}"\n' +
      "export let text: String = Branch(More(Tip(1), More(Tip(2), Nil2))).show()\n");
    expect(exports["text"]).toBe("[12]");
  });

  test("a group bounds visibility, not reference; a one-item group is the lone honor", async () => {
    const exports = await runMain(MAIN + "export record P = {x: Int}\n" +
      "honor\n    Show<P> =\n        show(p) = \"P\"\n" +
      "honor\n    Eq<P> =\n        equals(a, b) = a.x == b.x\n    Ord<P> =\n        compare(a, b) = a.x.compare(b.x)\n" +
      "export let shown: String = \"${P({x = 1})}\"\n" +
      "export let less: Bool = P({x = 1}) < P({x = 2})\n");
    expect(exports["shown"]).toBe("P");
    expect(exports["less"]).toBe(true);
  });

  test("an item may be a derived instance, and an extending honor may come first", async () => {
    const exports = await runMain(MAIN + "export record P = {x: Int}\n" +
      "honor\n    Ord<P> = derive\n    Eq<P> = derive\n" +
      "export let less: Bool = P({x = 1}) < P({x = 2})\n");
    expect(exports["less"]).toBe(true);
  });
});

describe("an honor group's own rows (§8)", () => {
  test("a binder list on the group's head is refused, naming the items that use it", () => {
    expect(projectDiagnostics(MAIN + "union Rose(a) = Rose(a, Vector(Rose(a)))\n" +
      "honor<a: Show>\n    Show<Rose(a)> =\n        show(r) = \"rose\"\n")).toEqual([
      "an honor group's instances declare their own binders — write `<a: Show>` on the item that uses it: " +
      "`Show<Rose(a)>`",
    ]);
  });

  test("anything but an honor is a parse error, with the fundamental spelling where there is one", () => {
    const group = (item: string) => MAIN + P + "honor\n" + '    Show<P> =\n        show(p) = "P"\n' + item;
    expect(projectDiagnostics(group("    fun helper(p: P): String = \"h\"\n"))).toEqual([
      "an honor group holds honors only — let the function recurse by itself, and call it from the honor",
    ]);
    expect(projectDiagnostics(group("    helper(p: P): String = \"h\"\n"))).toEqual([
      "an honor group holds honors only — let the function recurse by itself, and call it from the honor",
    ]);
    expect(projectDiagnostics(group("    let n: Int = 1\n"))).toEqual(["an honor group holds honors only"]);
  });

  test("a `widens` door is no item: it stands above the honor, outside the group", () => {
    expect(compileFiles([
      ["/lib.hex", "module Lib\n\nexport constraint R<a> =\n    tag(s: a, n: Int) -> String\n"],
      ["/main.hex", MAIN + "import Lib\n\nexport record P = { name: String }\n" +
        "honor\n    widens Lib.tag(s: P, n: BigInt): String = s.name\n    Lib.R<P> =\n        tag = widened\n"],
    ]).diagnostics.map(({ message }) => message)).toContain(
      "an honor group holds honors only — a `widens` door stands above the honor that accounts for it, outside the group",
    );
  });

  test("an empty group is a parse error", () => {
    expect(projectDiagnostics(MAIN + "honor\nexport let x: Int = 1\n"))
      .toContain("an honor group needs at least one honor");
  });
});

describe("derived instances (§4.8)", () => {
  test("a `derives` clause's instances are one knot at their type's line", async () => {
    const exports = await runMain(MAIN +
      "export union Tree derives (Show, Ord, Eq) = Leaf | Node(Tree, Int, Tree)\n" +
      "export let shown: String = Node(Leaf, 1, Leaf).show()\n" +
      "export let less: Bool = Leaf < Node(Leaf, 1, Leaf)\n");
    expect(exports["shown"]).toBe("Node(Leaf, 1, Leaf)");
    expect(exports["less"]).toBe(true);
  });

  test("a component derived below is refused, the advice the declaration", () => {
    expect(projectDiagnostics(MAIN +
      "record Box derives Show = {value: Thing}\nrecord Thing derives Show = {n: Int}\n")).toEqual([
      opening("Show<Thing>") +
      "`Show<Thing>` is derived by `Thing`'s declaration, below this use — move the declaration above this use",
    ]);
    expect(projectDiagnostics(MAIN +
      "record Thing derives Show = {n: Int}\nrecord Box derives Show = {value: Thing}\n")).toEqual([]);
  });

  test("two instances used at one spot are two uses, each reported", () => {
    expect(projectDiagnostics(MAIN +
      "record Box derives Show = {a: A, b: B}\nrecord A derives Show = {n: Int}\nrecord B derives Show = {n: Int}\n")).toEqual([
      opening("Show<A>") +
      "`Show<A>` is derived by `A`'s declaration, below this use — move the declaration above this use",
      opening("Show<B>") +
      "`Show<B>` is derived by `B`'s declaration, below this use — move the declaration above this use",
    ]);
  });

  test("one clause's instances used at one spot are reported one each", () => {
    const diagnostics = projectDiagnostics(MAIN +
      "let both<x: (Show, Eq)>(v: x): String = if v == v then \"${v}\" else \"\"\n" +
      "let early(a: A): String = both(a)\n" +
      "record A derives (Show, Eq) = {n: Int}\n");
    expect(diagnostics).toHaveLength(2);
    expect(diagnostics.some((message) => message.startsWith(opening("Show<A>")))).toBe(true);
    expect(diagnostics.some((message) => message.startsWith(opening("Eq<A>")))).toBe(true);
  });

  test("an instance another module declares is never this module's to order, code outside a module included", () => {
    expect(projectDiagnostics("let stray: Int = 1\nmodule Main\n\nexport let p: Int = 2\n")).toEqual([
      "code outside a module: a module begins with its header; move `module Main` above this item",
    ]);
  });

  test("two types whose derived instances need each other derive them in one honor group", async () => {
    expect(projectDiagnostics(MAIN +
      "record Ping derives Show = {next: Option(Pong)}\nrecord Pong derives Show = {back: Option(Ping)}\n"))
      .toEqual([
        opening("Show<Pong>") + "`Show<Pong>`'s honor uses `Show<Ping>` too — " +
        "derive them in one honor group: `Show<Ping> = derive` and `Show<Pong> = derive`",
      ]);
    const exports = await runMain(MAIN +
      "export record Ping = {next: Option(Pong)}\nexport record Pong = {back: Option(Ping)}\n" +
      "honor\n    Show<Ping> = derive\n    Show<Pong> = derive\n" +
      "export let shown: String = Ping({next = Some(Pong({back = None}))}).show()\n");
    expect(exports["shown"]).toBe("{next = Some({back = None})}");
  });

  test("the derivation fixit moves a declaration standing below the use above it", () => {
    expect(projectDiagnostics(MAIN + "export let same(t: T): Bool = t == t\nexport record T = {n: Int}\n")).toEqual([
      "type `T` has no `Eq` instance; it could only be declared in module `Main` (declares `T`) or the module " +
      "declaring `Eq`; add `derives Eq` to the declaration of `T`, and move the declaration above this use",
    ]);
    expect(projectDiagnostics(MAIN + "export record T = {n: Int}\nexport let same(t: T): Bool = t == t\n")).toEqual([
      "type `T` has no `Eq` instance; it could only be declared in module `Main` (declares `T`) or the module " +
      "declaring `Eq`; add `derives Eq` to the declaration of `T`",
    ]);
  });
});

describe("member bindings enter the order with their knot (§4.6)", () => {
  test("inside a knot a bare member name is visible earlier and later; its own name stays refused", () => {
    expect(projectDiagnostics(MAIN + P +
      "honor\n" +
      '    Show<P> =\n        show(p) = "P${equals(p, p)}"\n' +
      "    Eq<P> =\n        equals(a, b) = a.x == b.x\n" +
      "let f(p: P): Bool = equals(p, p)\n")).toEqual([]);
    expect(projectDiagnostics(MAIN + P + 'honor Show<P> =\n    show(p) = show(p.x)\n')).toEqual([
      "`show` is this member's own name, and a member cannot call itself bare; recursion is spelled " +
      "through dispatch — write the dot call `value.show()`, or qualify the instance you mean: `Show.show(…)`",
    ]);
  });

  test("outside its knot, above the knot's last line, a bare member name is the declared-later error", () => {
    expect(projectDiagnostics(MAIN + P + "let f(p: P): Bool = equals(p, p)\n" + EQ_P)).toEqual([
      "`equals` is bound by the `Eq` instance below this use; declarations are read top-down — " +
      "move the instance above this use",
    ]);
  });
});

describe("a `widens` door stands above its honor, outside its knot (§4.8)", () => {
  const LIB = ["/lib.hex", "module Lib\n\nexport constraint R<a> =\n    tag(s: a, n: Int) -> String\n"] as const;
  const order = (items: string) => [
    LIB,
    ["/main.hex", MAIN + "import Lib\n\nexport record P = { name: String }\n" + items],
  ] as const;
  const messages = (items: string) => compileFiles(order(items)).diagnostics.map(({ message }) => message);
  const door = "widens Lib.tag(s: P, n: BigInt): String = s.name\n";
  const honor = "honor Lib.R<P> =\n    tag = widened\n";

  test("the door's binding is visible below it, before the honor; the instance below the honor", async () => {
    expect(messages(door + "export let early(p: P): String = tag(p, 2n) ++ p.tag(2)\n" + honor)).toEqual([]);
    expect(messages(door + "export let early(p: P): String = Lib.tag(p, 2)\n" + honor))
      .toEqual([above("Lib.R<P>")]);
    const exports = await runProject(order(door + honor + 'export let late: String = Lib.tag(P({name = "n"}), 2)\n'));
    expect(exports["late"]).toBe("n");
  });

  test("a door below the honor that accounts for it is refused at the accounting line", () => {
    expect(messages(honor + door)).toEqual([
      "`tag = widened` names the `widens` door declared below it; declarations are read top-down — " +
      "move the door above this honor",
    ]);
  });

  test("a reference to the door above it is the declared-later error", () => {
    expect(messages("export let early(p: P): String = tag(p, 2n)\n" + door + honor)).toEqual([
      "`tag` is declared later in this block; declarations are read top-down — move its declaration above this use",
    ]);
  });

  test("a door cannot call itself, in any spelling", () => {
    for (const call of ["tag(s, 0n)", "s.tag(0)"]) {
      expect(messages(`widens Lib.tag(s: P, n: BigInt): String = if n == 0n then s.name else ${call}\n` + honor))
        .toEqual(["a `widens` door cannot call itself — let a function recurse by itself, and call it from the door"]);
    }
  });

  test("a door cannot use the instance it supplies", () => {
    expect(messages("widens Lib.tag(s: P, n: BigInt): String = if n == 0n then s.name else Lib.tag(s, 0)\n" + honor))
      .toEqual([
        opening("Lib.R<P>") +
        "a door cannot use the instance it supplies; let a function recurse by itself, and call it from the door",
      ]);
    expect(messages(
      "fun tagged(s: P, n: BigInt): String = if n == 0n then s.name else tagged(s, 0n)\n" +
        "widens Lib.tag(s: P, n: BigInt): String = tagged(s, n)\n" + honor,
    )).toEqual([]);
  });

  test("a door listing several members stands above each honor, and the honors need no group", () => {
    expect(compileFiles([
      LIB,
      ["/lib2.hex", "module Lib2\n\nexport constraint Q<a> =\n    tag(s: a, n: Int) -> String\n"],
      ["/main.hex", MAIN + "import Lib\nimport Lib2\n\nexport record P = { name: String }\n" +
        "widens Lib.tag, Lib2.tag(s: P, n: BigInt): String = s.name\n" +
        "honor Lib2.Q<P> =\n    tag = widened\n" +
        "export let mid(p: P): String = tag(p, 2n) ++ Lib2.tag(p, 2)\n" +
        honor + "export let late(p: P): String = Lib.tag(p, 2)\n"],
    ]).diagnostics).toEqual([]);
  });
});

describe("the knot's colours (Effects §13.3, §3.4)", () => {
  /** A world door, so a body has a genuine effect to perform, on each colour. */
  const IO = 'extern from "./io.js"\n    export fun readIt(path: String) ->! String\n' +
    "    export fun clock() ->~ Int\n    export fun check(n: Int) ->^ Int\n\n";
  const colours = (source: string): readonly string[] =>
    compileFiles([["/main.hex", MAIN + IO + source], ["/io.js", ""]]).diagnostics.map(({ message }) => message);
  const wants = (callee: string, mark = "!", does = "is impure and may fail") =>
    `this call ${does}, so \`${callee}\` wants \`${mark}\`, not no mark`;
  /** A mark claiming more than its call does is hedged, and only the first such report is given. */
  const overMarked = (callee: string) =>
    `this call is pure and cannot fail, so \`${callee}\` wants no mark, not \`!\` — perhaps the mark is wrong; ` +
    "or, if this call is impure and may fail, something makes it pure and unable to fail that this report does not name";
  /** A body that reads the disk, as a match arm's block. */
  const READS = (indent: string) => `\n${indent}let z = readIt!("x")\n${indent}0`;
  const SIZE = "constraint Size<a> =\n    size(x: a) ->! Int\n";

  const tree = (mark: string, leaf: string, below: string) => SIZE +
    "union T = Leaf | Node(T, T)\nhonor Size<T> =\n    size(t) = match t\n" +
    `        Leaf => ${leaf}\n        Node(l, r) => l.size${mark}() + r.size${mark}()\n` +
    `let k(t: T): Int = ${below}\n`;

  test("a recursive `->!` instance whose body touches nothing is bare inside and below", async () => {
    expect(colours(tree("", "0", "size(t)"))).toEqual([]);
    expect(colours(tree("!", "0", "size(t)"))).toEqual([overMarked(".size")]);
    expect(colours(tree("", "0", "size!(t)"))).toEqual([overMarked("size")]);
    const exports = await runMain(MAIN + SIZE + "export union T = Leaf | Node(T, T)\nhonor Size<T> =\n" +
      "    size(t) = match t\n        Leaf => 1\n        Node(l, r) => l.size() + r.size()\n" +
      "export let n: Int = size(Node(Leaf, Node(Leaf, Leaf)))\n");
    expect(exports["n"]).toBe(3);
  });

  test("one whose body reads the world wears `!` inside and below", () => {
    expect(colours(tree("!", READS("            "), "size!(t)"))).toEqual([]);
    expect(colours(tree("", READS("            "), "size!(t)"))).toEqual([wants(".size"), wants(".size")]);
    expect(colours(tree("!", READS("            "), "size(t)"))).toEqual([wants("size")]);
  });

  test("`->^` and `->~` contracts follow the knot on the colour they mark", () => {
    const count = (arrow: string, leaf: string, mark: string, below: string) =>
      `constraint Count<a> =\n    count(x: a) ${arrow} Int\nunion T = Leaf | Node(T)\n` +
      `honor Count<T> =\n    count(t) = match t\n        Leaf => ${leaf}\n        Node(k) => 1 + k.count${mark}()\n` +
      `let k(t: T): Int = ${below}\n`;
    expect(colours(count("->^", "0", "", "count(t)"))).toEqual([]);
    expect(colours(count("->^", "check^(1)", "^", "count^(t)"))).toEqual([]);
    expect(colours(count("->^", "check^(1)", "", "count(t)")))
      .toEqual([wants(".count", "^", "may fail"), wants("count", "^", "may fail")]);
    expect(colours(count("->~", "0", "", "count(t)"))).toEqual([]);
    expect(colours(count("->~", "clock~()", "~", "count~(t)"))).toEqual([]);
    expect(colours(count("->~", "clock~()", "", "count(t)")))
      .toEqual([wants(".count", "~", "is impure"), wants("count", "~", "is impure")]);
  });

  test("a group of two `->!` honors calling each other settles together, in either order", () => {
    const group = (mark: string, bLeaf: string, aFirst: boolean) => {
      const a = `    Size<A> =\n        size(a) = match a\n            ANil => 0\n            ACons(b) => b.size${mark}()\n`;
      const b = `    Size<B> =\n        size(b) = match b\n            BNil => ${bLeaf}\n            BCons(a) => a.size${mark}()\n`;
      return SIZE + "union A = ANil | ACons(B)\nunion B = BNil | BCons(A)\nhonor\n" + (aFirst ? a + b : b + a) +
        `let k(a: A, b: B): Int = size${mark}(a) + size${mark}(b)\n`;
    };
    for (const aFirst of [true, false]) {
      expect(colours(group("", "0", aFirst))).toEqual([]);
      // `Size<B>` reads the disk, and `Size<A>` reaches it.
      expect(colours(group("!", READS("                "), aFirst))).toEqual([]);
      expect(colours(group("", READS("                "), aFirst)))
        .toEqual([wants(".size"), wants(".size"), wants("size"), wants("size")]);
    }
  });

  test("a `->` member of the group follows the `->!` sibling it calls, and its seat compares after", () => {
    const shown = (leaf: string, sizeFirst: boolean) => {
      const size = `    Size<T> =\n        size(t) = match t\n            Leaf => ${leaf}\n` +
        `            Node(k) => 1 + k.size${leaf === "0" ? "" : "!"}()\n`;
      const show = '    Show<T> =\n        show(t) = "${t.size()}"\n';
      return SIZE + "union T = Leaf | Node(T)\nhonor\n" + (sizeFirst ? size + show : show + size) +
        "let k(t: T): String = show(t)\n";
    };
    for (const sizeFirst of [true, false]) {
      expect(colours(shown("0", sizeFirst))).toEqual([]);
      expect(colours(shown(READS("                "), sizeFirst))).toEqual([
        "this call is impure and may fail, and `show`'s contract is the pure arrow `->`, which cannot fail — " +
        "an instance does no more than its contract permits — keep this body pure and handle the failure in it, " +
        "or, if the constraint is yours, write `->!` on the member",
        wants(".size"),
      ]);
    }
  });

  test("only own colours wait: a recursive call may hand any callback, marked by what it hands", () => {
    const run = (inner: string, below: string) =>
      "constraint Run<a> =\n    run(r: a, action: () ->! Unit) ->! Unit\nunion T = Leaf | Node(T)\n" +
      "honor Run<T> =\n    run(t, action) = match t\n        Leaf => action!()\n" +
      `        Node(k) => ${inner}\nlet k(t: T): Unit = ${below}\n`;
    // Handing on its own callback, or a fresh pure one: the instance is silent.
    expect(colours(run("k.run!(action)", "run(t, () => ())"))).toEqual([]);
    expect(colours(run("k.run(() => ())", "run(t, () => ())"))).toEqual([]);
    expect(colours(run("k.run(action)", "run(t, () => ())"))).toEqual([wants(".run")]);
    // A fresh impure callback: allowed, and the call wears `!` for it. The
    // body then touches the world on its own account, so calls below wear it.
    const loud = 'k.run!(() => ignore(readIt!("x")))';
    expect(colours(run(loud, "run!(t, () => ())"))).toEqual([]);
    expect(colours(run(loud, "run(t, () => ())"))).toEqual([wants("run")]);
    expect(colours(run('k.run(() => ignore(readIt!("x")))', "run!(t, () => ())"))).toEqual([wants(".run")]);
  });

  test("an honor with two members where only one recurses", () => {
    const two = (leaf: string, mark: string, below: string) =>
      "constraint Two<a> =\n    size(x: a) ->! Int\n    name(x: a) ->! String\nunion T = Leaf | Node(T)\n" +
      `honor Two<T> =\n    size(t) = match t\n        Leaf => ${leaf}\n        Node(k) => 1 + k.size${mark}()\n` +
      `    name(t) = "t"\nlet k(t: T): String = ${below}\n`;
    expect(colours(two("0", "", '"${size(t)}${name(t)}"'))).toEqual([]);
    expect(colours(two(READS("            "), "!", '"${size!(t)}${name(t)}"'))).toEqual([]);
    expect(colours(two(READS("            "), "!", '"${size!(t)}${name!(t)}"'))).toEqual([overMarked("name")]);
  });

  test("a parameterized instance follows its knot", () => {
    const list = (leaf: string, mark: string, below: string) =>
      SIZE + "union L(a) = Nil | Cons(a, L(a))\n" +
      `honor Size<L(a)> =\n    size(l) = match l\n        Nil => ${leaf}\n        Cons(_, t) => 1 + t.size${mark}()\n` +
      `let k(l: L(Int)): Int = ${below}\n`;
    expect(colours(list("0", "", "size(l)"))).toEqual([]);
    expect(colours(list(READS("            "), "!", "size!(l)"))).toEqual([]);
    expect(colours(list(READS("            "), "", "size(l)"))).toEqual([wants(".size"), wants("size")]);
  });

  test("a lambda that calls the instance waits with the knot, whatever the order of the lines", () => {
    const folded = (leaf: string, mark: string) => SIZE + "union T = Leaf | Node(Vector(T))\n" +
      `honor Size<T> =\n    size(t) = match t\n        Leaf => ${leaf}\n` +
      `        Node(ks) => Seq.fold${mark}(ks, 0, (n, k) => n + k.size${mark}())\n` +
      `let k(t: T): Int = size${mark}(t)\n`;
    expect(colours(folded("0", ""))).toEqual([]);
    expect(colours(folded(READS("            "), "!"))).toEqual([]);
    // A pure demand on such a lambda is compared once the knot settles it.
    const demanded = (leaf: string) => SIZE + "union T = Leaf | Node(T)\n" +
      `honor Size<T> =\n    size(t) = match t\n        Leaf => ${leaf}\n        Node(k) =>\n` +
      `            let f: () -> Int = () => k.size${leaf === "0" ? "" : "!"}()\n            f()\n`;
    expect(colours(demanded("0"))).toEqual([]);
    expect(colours(demanded(READS("            ")))).toEqual([
      "this call is impure and may fail, and the enclosing function's face is the pure arrow `->`, which cannot fail " +
      "— a pure face cannot run effects, and a face that cannot fail cannot run a call that may, unless it handles the failure",
    ]);
  });

  test("a body in error leaves its calls owing no mark; a default member follows the default's own colour", () => {
    const failing = SIZE + "union T = Leaf | Node(T)\nhonor Size<T> =\n    size(t) = match t\n" +
      "        Leaf => nope()\n        Node(k) => 1 + k.size()\nlet k(t: T): Int = size(t)\nlet j(t: T): Int = size!(t)\n";
    expect(colours(failing)).toEqual(["unknown name `nope`"]);
    // `twice`'s default calls `base` through the constraint, so its own colour
    // is the contract's, whichever instance uses it (§13.3).
    const defaulted = (mark: string) => "constraint D<a> =\n    base(x: a) ->! Int\n" +
      "    twice(x: a) ->! Int = base!(x) + base!(x)\nunion T = Leaf | Node(T)\nhonor D<T> =\n" +
      `    base(t) = match t\n        Leaf => 0\n        Node(k) => k.twice${mark}()\nlet k(t: T): Int = base!(t)\n`;
    expect(colours(defaulted("!"))).toEqual([]);
    expect(colours(defaulted(""))).toEqual([wants(".twice")]);
  });

  test("a function the member returns follows the contract inside the knot (a named limit, Effects §13.3)", () => {
    // The outer arrow follows the knot (`k.make()` is bare); the returned
    // function's arrow keeps the contract's colour inside the knot, and so
    // the instance's own colour there is impure below it too.
    const made = (leaf: string, mark: string) => "constraint Mk<a> =\n    make(x: a) ->! () ->! Int\n" +
      "union T = Leaf | Node(T)\nhonor Mk<T> =\n    make(t) = match t\n" +
      `        Leaf => () => ${leaf}\n        Node(k) => () => k.make()${mark}()\nlet k(t: T): Int = make(t)${mark}()\n`;
    expect(colours(made("0", "!"))).toEqual([]);
    expect(colours(made('String.length(readIt!("x"))', "!"))).toEqual([]);
    expect(colours(made("0", ""))).toEqual([wants("this call"), wants("this call")].map((each) =>
      each.replace("`this call`", "this call")
    ));
  });

  test("a held lambda merged with the honor's own callback keeps the callback the seat's (review r3 of #1226)", () => {
    const B = "record B = { m: Int }\nlet loudB(b: B): Int =\n    let z = readIt!(\"x\")\n    0\nunion T = Leaf | Node(T)\n";
    const run = (body: string, below: string) => B +
      "constraint R<a> =\n    run(s: a, f: (B) ->! Int) ->! Int\nhonor R<T> =\n    run(t, f) = match t\n" +
      `        Leaf => 0\n        Node(k) =>\n${body}${below}`;
    const held = "            let g = if True then f else (b: B) => k.run((c: B) => 1)\n";
    const merged = "            let h = if True then f else loudB\n";
    const below = "export let p1(): Int = run(Node(Leaf), (b: B) => 7)\n";
    // The body runs `loudB` on its own account in either order of the merges.
    for (const body of [held + merged, merged + held]) {
      expect(colours(run(body + "            h!(B({ m = 1 }))\n", below))).toEqual([wants(".run"), wants("run")]);
    }
    // Running only the merge of `f` with the held lambda: the instance is
    // silent, and a caller's callback marks its call.
    expect(colours(run(held + "            g!(B({ m = 1 }))\n", below + "export let p2(): Int = run(Node(Leaf), loudB)\n")))
      .toEqual([wants("run")]);
    // Two callbacks merged beside the held lambda: the merge runs either.
    const two = B + "constraint R<a> =\n    run(s: a, f: (B) ->! Int, j: (B) ->! Int) ->! Int\nhonor R<T> =\n" +
      "    run(t, f, j) = match t\n        Leaf => 0\n        Node(k) =>\n" +
      "            let g = if True then f else (b: B) => k.run((c: B) => 1, j)\n" +
      "            let h = if True then f else j\n            h(B({ m = 1 }))\n" +
      "export let p1(): Int = run(Node(Leaf), (b: B) => 7, (b: B) => 8)\n";
    expect(colours(two)).toEqual([wants(".run"), wants("h")]);
    // The callback stored in a pure field after the merge narrows the instance.
    const boxed = B + "record Box = { g: (B) -> Int }\nconstraint R<a> =\n    wrap(s: a, f: (B) ->! Int) ->! Box\n" +
      "honor R<T> =\n    wrap(t, f) = match t\n        Leaf => Box({ g = (b) => 0 })\n        Node(k) =>\n" +
      "            let x = if True then f else (b: B) => k.wrap((c: B) => 1).g(b)\n            Box({ g = f })\n";
    expect(colours(boxed)).toEqual([
      "`wrap`'s contract accepts any `f`, and this instance accepts only one that is pure and cannot fail — " +
      "an instance accepts everything its contract promises to accept — do not narrow `f` here, or, if the " +
      "constraint is yours, write the member's `f` arrow `->`",
    ]);
    // A held lambda merged with an impure function, either side.
    for (const merge of [
      "if True then (b: B) => k.run((c: B) => 1) else loudB",
      "if True then loudB else (b: B) => k.run((c: B) => 1)",
    ]) {
      expect(colours(run(`            let g = ${merge}\n            g!(B({ m = 1 }))\n`, below)))
        .toEqual([wants(".run"), wants("run")]);
    }
  });
});
