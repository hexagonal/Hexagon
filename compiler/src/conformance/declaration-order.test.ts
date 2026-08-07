import { describe, expect, test } from "vitest";

import { compileFiles, projectDiagnostics, runProject } from "../support/test-project.js";

/**
 * Conformance for Functions §7.2–§7.3 and Method Syntax §4.4 (#293).
 *
 * Every term reference — a bare name and equally a dot call — targets a
 * declaration above it. The one exception is a contiguous run of `fun`s, whose
 * members' bodies see each other; a dot call does not even get that exception,
 * because dispatch is invisible to the reference graph the resolver and
 * inference both read.
 */

const DECLARED_LATER = (name: string): string =>
  `\`${name}\` is declared later in this block; declarations are read ` +
  "top-down — move its declaration above this use";

const SPLIT_GROUP = (name: string): string =>
  `\`${name}\` is declared later in this block; only an unbroken run of ` +
  "`fun`s recurses together — move the intervening declaration out of the run, " +
  `or move \`${name}\`'s declaration above this use`;

const DECLARED_BELOW = (type: string, name: string): string =>
  `\`${type}\`'s companion declares \`${name}\` below this call; declarations ` +
  "are read top-down — move the declaration above this call";

const BOX = "export record Box = {value: Int}\n";
const TWICE_LET = "export let twice(b: Box): Int = b.value * 2\n";
const TWICE_FUN = "export fun twice(b: Box): Int = b.value * 2\n";

function diagnostics(files: readonly (readonly [string, string])[]): readonly string[] {
  return compileFiles(files).diagnostics.map(({ message }) => message);
}

describe("a lexical reference reads top-down", () => {
  test("a module right-hand side cannot name a later `let`", () => {
    expect(projectDiagnostics(
      BOX + "export let use: Int = twice(Box({value = 3}))\n" + TWICE_LET,
    )).toEqual([DECLARED_LATER("twice")]);
  });

  test("...nor a later `fun`", () => {
    expect(projectDiagnostics(
      BOX + "export let use: Int = twice(Box({value = 3}))\n" + TWICE_FUN,
    )).toEqual([DECLARED_LATER("twice")]);
  });

  test("a lambda body is no exception, however late it runs", () => {
    expect(projectDiagnostics(
      BOX + "export let use(x: Box): Int = twice(x)\n" + TWICE_LET,
    )).toEqual([DECLARED_LATER("twice")]);
  });

  test("a `fun` body is no exception either", () => {
    expect(projectDiagnostics(
      BOX + "export fun use(x: Box): Int = twice(x)\n" + TWICE_LET +
      "export let out: Int = use(Box({value = 3}))\n",
    )).toEqual([DECLARED_LATER("twice")]);
  });

  test("a `fun` reaching a later `let` through another `fun`'s mention is refused too", () => {
    // The soundness hole this ruling closes. `capturer` mentioning `twice`
    // lexically used to be what gave the dot call in `use` a scheme to dispatch
    // against, while leaving `use`'s own capture set empty — so `out` ran before
    // `twice` was bound and the module threw `ReferenceError` on load with no
    // diagnostic at all.
    expect(projectDiagnostics(
      BOX +
      "export fun capturer(x: Box): Int = twice(x)\n" +
      "export fun use(x: Box): Int = x.twice()\n" +
      "export let out: Int = use(Box({value = 3}))\n" +
      TWICE_LET,
    )).toEqual([
      DECLARED_LATER("twice"),
      DECLARED_BELOW("Box", "twice"),
    ]);
  });

  test("the lexical control on the same shape reports once", () => {
    expect(projectDiagnostics(
      BOX +
      "export fun capturer(x: Box): Int = twice(x)\n" +
      "export fun use(x: Box): Int = twice(x)\n" +
      "export let out: Int = use(Box({value = 3}))\n" +
      TWICE_LET,
    )).toEqual([DECLARED_LATER("twice"), DECLARED_LATER("twice")]);
  });

  test("a `fun` whose own later reference is a plain value is refused at the reference", () => {
    expect(projectDiagnostics(
      BOX +
      "export fun scaled(b: Box): Int = b.value * factor\n" +
      "export fun use(x: Box): Int = scaled(x)\n" +
      "export let out: Int = use(Box({value = 3}))\n" +
      "export let factor: Int = 2\n",
    )).toEqual([DECLARED_LATER("factor")]);
  });

  test("both reference forms are reported when a body uses both", () => {
    expect(projectDiagnostics(
      BOX +
      "export fun use(x: Box): Int = twice(x) + x.twice()\n" +
      TWICE_LET +
      "export let out: Int = use(Box({value = 3}))\n",
    )).toEqual([DECLARED_LATER("twice"), DECLARED_BELOW("Box", "twice")]);
  });
});

describe("a dot call reads top-down too (Method Syntax §4.4)", () => {
  test("a deferred dot call to a later operation is refused as declared-below", () => {
    expect(projectDiagnostics(
      BOX + "export let use(x: Box): Int = x.twice()\n" + TWICE_LET,
    )).toEqual([DECLARED_BELOW("Box", "twice")]);
  });

  test("an immediate dot call to a later operation, likewise", () => {
    expect(projectDiagnostics(
      BOX + "export let use: Int = Box({value = 3}).twice()\n" + TWICE_LET,
    )).toEqual([DECLARED_BELOW("Box", "twice")]);
  });

  test("from a `fun` body, likewise", () => {
    expect(projectDiagnostics(
      BOX +
      "export fun use(x: Box): Int = x.twice()\n" +
      TWICE_LET +
      "export let out: Int = use(Box({value = 3}))\n",
    )).toEqual([DECLARED_BELOW("Box", "twice")]);
  });

  test("a `fun` body dot-calls a `let`-header operation declared above it", async () => {
    // The filed defect (#293): the operation had no scheme when dispatch asked,
    // because `fun` bodies were checked before any textual `let` was reached.
    const main = await runProject([["/main.hex",
      BOX + TWICE_LET +
      "export fun use(x: Box): Int = x.twice()\n" +
      "export let out: Int = use(Box({value = 3}))\n",
    ]]);

    expect(main["out"]).toBe(6);
  });

  test("a `let` lambda body dot-calls a `let`-header operation declared above it", async () => {
    const main = await runProject([["/main.hex",
      BOX + TWICE_LET +
      "export let use(x: Box): Int = x.twice()\n" +
      "export let out: Int = use(Box({value = 3}))\n",
    ]]);

    expect(main["out"]).toBe(6);
  });

  test("declaration order is irrelevant to a call site in another module", async () => {
    // §4.2's import-insensitivity: an importer sees the whole exported surface,
    // so where `twice` sits in its home file is not the importer's business.
    const main = await runProject([
      ["/main.hex",
        "import * as Boxes from \"./boxes\"\n" +
        "export let out: Int = Boxes.Box({value = 3}).twice()\n",
      ],
      ["/boxes.hex",
        "export record Box = {value: Int}\n" +
        "export let unrelated: Int = 1\n" +
        "export fun twice(b: Box): Int = b.value * 2\n",
      ],
    ]);

    expect(main["out"]).toBe(6);
  });
});

describe("a dot call cannot make a `let` recursive (Functions §6)", () => {
  // The scheme is seeded when the item is inferred, so a candidate that has none
  // while still declared above the call can only be the operation whose own
  // right-hand side the call sits in. Reporting that as a missing operation
  // would be false — the companion declares it.
  const SELF =
    "`dup` is not in scope in its own `let` definition; `let` is non-recursive — use `fun`.";

  test("a self dot call takes the non-recursive-`let` report", () => {
    expect(projectDiagnostics(
      BOX + "export let dup(b: Box): Box = b.dup()\n",
    )).toEqual([SELF]);
  });

  test("...from an inner block of the same right-hand side too", () => {
    expect(projectDiagnostics(
      BOX +
      "export let dup(b: Box): Box =\n" +
      "    let again = b.dup()\n" +
      "    again\n",
    )).toEqual([SELF]);
  });

  test("a genuinely absent operation keeps its own report", () => {
    expect(projectDiagnostics(
      BOX + "export let use(b: Box): Int = b.nope()\n",
    )).toEqual([
      "`Box` has no field `nope`, its companion exports no operation `nope`, " +
      "and no constraint honored at `Box` has a subject-first member `nope`; " +
      "call an available subject-first function explicitly",
    ]);
  });
});

describe("a contiguous `fun` run is one group (Functions §7.3)", () => {
  test("mutual recursion inside the run compiles and runs", async () => {
    const main = await runProject([["/main.hex",
      "fun even(n: Int): Bool = if n == 0 then True else odd(n - 1)\n" +
      "fun odd(n: Int): Bool = if n == 0 then False else even(n - 1)\n" +
      "export let fourIsEven: Bool = even(4)\n" +
      "export let threeIsEven: Bool = even(3)\n",
    ]]);

    expect(main["fourIsEven"]).toBe(true);
    expect(main["threeIsEven"]).toBe(false);
  });

  test("an item between the members ends the run, and the report says so", () => {
    expect(projectDiagnostics(
      "fun even(n: Int): Bool = if n == 0 then True else odd(n - 1)\n" +
      "let gap: Int = 1\n" +
      "fun odd(n: Int): Bool = if n == 0 then False else even(n - 1)\n" +
      "export let fourIsEven: Bool = even(4)\n",
    )).toEqual([SPLIT_GROUP("odd")]);
  });

  test("a comment does not end the run", async () => {
    const main = await runProject([["/main.hex",
      "fun even(n: Int): Bool = if n == 0 then True else odd(n - 1)\n" +
      "// the parity pair\n" +
      "(** Answers whether `n` is odd. *)\n" +
      "fun odd(n: Int): Bool = if n == 0 then False else even(n - 1)\n" +
      "export let fourIsEven: Bool = even(4)\n",
    ]]);

    expect(main["fourIsEven"]).toBe(true);
  });

  test("adjacency does not monomorphize an independent member", async () => {
    // §7.3: grouping bounds visibility, not typing. The knot is the SCC of the
    // references actually written, so `ident` generalizes before `atInt`'s body
    // is checked and its use at `Int` there costs it nothing.
    const main = await runProject([["/main.hex",
      "fun ident(value) = value\n" +
      "fun atInt(n: Int): Int = ident(n)\n" +
      "export let text: String = ident(\"hex\")\n" +
      "export let number: Int = atInt(7)\n",
    ]]);

    expect(main["text"]).toBe("hex");
    expect(main["number"]).toBe(7);
  });

  test("a member outside the run is reachable by dot once declared", async () => {
    const main = await runProject([["/main.hex",
      BOX + TWICE_FUN +
      "export let out: Int = Box({value = 3}).twice()\n",
    ]]);

    expect(main["out"]).toBe(6);
  });
});

describe("a dot call never targets its own `fun` group (§9 row 13)", () => {
  test("a sibling member is refused with the name spelling", () => {
    expect(projectDiagnostics(
      BOX +
      TWICE_FUN +
      "export fun quadruple(b: Box): Int = b.twice() * 2\n",
    )).toEqual([
      "a dot call cannot target its own `fun` group; spell the call by name: `twice(b)`",
    ]);
  });

  test("the member itself is refused too — recursion is spelled by name", () => {
    expect(projectDiagnostics(
      BOX +
      "export fun countDown(b: Box): Int =\n" +
      "    if b.value == 0 then 0 else Box({value = b.value - 1}).countDown()\n",
    )).toEqual([
      "a dot call cannot target its own `fun` group; spell the call by name: `countDown(…)`",
    ]);
  });

  test("a `let` read from inside a group is not a group member", async () => {
    // The ban is membership, not enclosure: a body inside the group may still
    // dot-call anything declared above the group.
    const main = await runProject([["/main.hex",
      BOX + TWICE_LET +
      "export fun go(b: Box, n: Int): Int =\n" +
      "    if n == 0 then b.twice() else go(b, n - 1)\n" +
      "export let out: Int = go(Box({value = 3}), 2)\n",
    ]]);

    expect(main["out"]).toBe(6);
  });

  test("an earlier group is not the caller's own group", async () => {
    const main = await runProject([["/main.hex",
      BOX +
      TWICE_FUN +
      "let boundary: Int = 0\n" +
      "export fun quadruple(b: Box): Int = b.twice() * 2\n" +
      "export let out: Int = quadruple(Box({value = 3}))\n",
    ]]);

    expect(main["out"]).toBe(12);
  });
});

describe("the term names a type declaration binds read top-down (§7.2)", () => {
  test("a type-position mention above the declaration is free", () => {
    expect(diagnostics([["/main.hex",
      "export fun unwrap(b: Box): Int = b.value\n" +
      "export record Box = {value: Int}\n",
    ]])).toEqual([]);
  });

  test("...but a value-position constructor use is not", () => {
    expect(diagnostics([["/main.hex",
      "export fun wrap(n: Int): Box = Box({value = n})\n" +
      "export record Box = {value: Int}\n",
    ]])).toEqual([DECLARED_LATER("Box")]);
  });

  test("a union constructor is the same", () => {
    expect(diagnostics([["/main.hex",
      "export let here: Spot = Origin\n" +
      "export union Spot = Origin | Away(Int)\n",
    ]])).toEqual([DECLARED_LATER("Origin")]);
  });

  test("a constraint member is the same", () => {
    expect(diagnostics([["/main.hex",
      "export record Box = {value: Int}\n" +
      "export let label: Int = render(Box({value = 1}))\n" +
      "export constraint Render<a> =\n" +
      "    render(value: a): Int\n" +
      "honor Render<Box> =\n" +
      "    render(value) = value.value\n",
    ]])).toEqual([DECLARED_LATER("render")]);
  });

  test("an exception constructor is the same", () => {
    expect(diagnostics([["/main.hex",
      "export let e: Exn = Bad(1)\n" +
      "exception Bad(Int)\n",
    ]])).toEqual([DECLARED_LATER("Bad")]);
  });

  test("a match arm above the union names the union as the move", () => {
    expect(diagnostics([["/main.hex",
      "export fun distance(s: Spot): Int = match s\n" +
      "    Origin => 0\n" +
      "    Away(n) => n\n" +
      "export union Spot = Origin | Away(Int)\n",
    ]])[0]).toBe(
      "`Origin` is declared later in this block; declarations are read " +
      "top-down — move the union's declaration above this use",
    );
  });

  test("a catch arm above the exception names the exception", () => {
    expect(diagnostics([["/main.hex",
      "export fun safe(): Int =\n" +
      "    try\n" +
      "        1\n" +
      "    catch\n" +
      "        Bad(n) => n\n" +
      "exception Bad(Int)\n",
    ]])[0]).toBe(
      "`Bad` is declared later in this block; declarations are read " +
      "top-down — move the exception's declaration above this use",
    );
  });

  test("a constructor named in a `fun` body above the union is the same", () => {
    expect(diagnostics([["/main.hex",
      "export fun start(): Spot = Origin\n" +
      "export union Spot = Origin | Away(Int)\n",
    ]])).toEqual([DECLARED_LATER("Origin")]);
  });
});
