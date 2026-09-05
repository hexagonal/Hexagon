/**
 * Conformance for how a two-seat scheme **travels** once #714's rule has seated
 * it: across a module border, through a pass-through, through a value-position
 * reference, around a recursion knot, and into a parameterized instance's
 * factory — and for the order the seats are in when it gets there.
 *
 * A **sibling** of `evidence-seat-identity.test.ts` rather than an extension of
 * it. That file pins where a seat is *seeded*: it names four doors into
 * `#evidenceParameters` and walks each one, and every one of its specimens
 * declares and consumes *the two-seat scheme* inside a single module — its
 * graphs do cross module borders, but only ever to import the one-seat halves a
 * consuming module then seats itself. The claim here is the one it leaves
 * alone — that a scheme already carrying two seats keyed to two declarations
 * survives *copying*. Every copy is a renumbering (`#instantiate`'s freshening,
 * `#importScheme`'s), and a renumbering is exactly where an identity key can be
 * dropped back onto a name without any seeding site being wrong. The
 * two need different failure stories, so they get different files. These rows
 * come out of the #286 closing audit, which probed the travel shapes the #714
 * suite does not reach.
 *
 * The specimens are two library modules that each declare a constraint spelled
 * `Fancy`, honor it at `Int`, and export a function constrained by their own.
 * The words collide and the answers do not: one member prefixes `A`, the other
 * `B`, so a program that reads the wrong seat returns `"B7|A7"` rather than
 * throwing, and only an executed pin catches it. A head meets such a pair and
 * spells it with the **qualified form** `<u: (LibA.Fancy, LibB.Fancy)>`
 * (Modules §3.3) — under #762 an import binds a module alias and nothing
 * smaller, so this is now the *only* route: the alias-through-a-named-import
 * spelling FFI Part 9 §6.2 used to offer as a second option (`import { Fancy as
 * Fancy2 }`, open only where the two constraints' member spellings do not
 * collide) has no seat left to stand in, named imports being gone entirely.
 * The two libraries' module aliases, `LibA` and `LibB`, are what the binder list
 * and every member call spell out instead. The ordering claim below is a claim
 * about the written conjunction, and is unaffected by which spelling names each
 * constraint.
 *
 * The ordering claim is the second half. Constraints §6.1 orders the evidence
 * suffix by *(type-variable ordinal, constraint name)*, and two constraints that
 * spell one word tie on both components; the tie-break is the **written
 * conjunction's own order** — the resolution §6.2's base-slot contest already
 * takes on a declaration's base list, carried onto the suffix by #731. So `<u:
 * (LibA.Fancy, LibB.Fancy)>` and `<u: (LibB.Fancy, LibA.Fancy)>` are two
 * different ABIs over one type, and both ends have to read the same one. Both
 * arrangements are emitted *and* executed here, and executed through a caller
 * that is itself generic, because a saturated call at `Int` is routed to a
 * specialized edition that takes no evidence at all and so cannot tell a correct
 * routing from a swapped one.
 *
 * What must not change: nothing. Every row is additive — no emission is asked to
 * differ from what `13b86d0` produces, and the two neighbouring files' pins on
 * the seeding sites and on the suffix's sort key are untouched.
 *
 * Emitted modules mount as `data:` URLs the registry caches by text, so the
 * executed graphs are made byte-distinct.
 */

import { describe, expect, test } from "vitest";

import { compileFiles, runProject } from "../support/test-project.js";

/** Makes a graph's modules byte-distinct, so the test gets its own instances. */
function distinct(label: string): (path: string, javascript: string) => string {
  return (_path, javascript) => `// ${label}\n${javascript}`;
}

/**
 * A module declaring `Fancy`, honoring it at `Int`, and exporting a function
 * constrained by it. Both copies spell the constraint identically — the word is
 * not what tells them apart — and prefix their answers differently, so a seat
 * read from the wrong end is a wrong string rather than a lucky one.
 */
function fancyLib(member: string, use: string, tag: string): string {
  return [
    "export constraint Fancy<t> =",
    `    ${member}(value: t): String`,
    "",
    "honor Fancy<Int> =",
    `    ${member}(value) = "${tag}\${value}"`,
    "",
    `export let ${use}<t: Fancy>(v: t): String = ${member}(v)`,
    "",
  ].join("\n");
}

const LIB_A = fancyLib("fancyA", "useA", "A");
const LIB_B = fancyLib("fancyB", "useB", "B");

/**
 * The middle module: the only one that can spell both constraints, and so the
 * only one that can write the conjunction whose order is the ABI.
 */
function mid(conjunction: string): string {
  return [
    'module Mid',
    '',
    'import Liba as LibA',
    'import Libb as LibB',
    "",
    `export let both<u: ${conjunction}>(v: u): String = ` +
      '"${LibA.useA(v)}|${LibB.useB(v)}"',
    "",
  ].join("\n");
}

const DECLARED = "(LibA.Fancy, LibB.Fancy)";
const FLIPPED = "(LibB.Fancy, LibA.Fancy)";

/** A saturated call at `Int`, which Part 8 routes to an edition. */
const CALLS_DIRECTLY = [
  'import Mid',
  "",
  "let seven: Int = 7",
  "export let r: String = Mid.both(seven)",
  "",
].join("\n");

/** The same call from an inferred generalized function, which is not routed. */
const CALLS_THROUGH_WRAPPER = [
  'import Mid',
  "",
  "let wrap(v) = Mid.both(v)",
  "let seven: Int = 7",
  "export let r: String = wrap(seven)",
  "",
].join("\n");

/** The same call through a value-position reference of the imported function. */
const CALLS_THROUGH_ALIAS = [
  'import Mid',
  "",
  "let alias = Mid.both",
  "let seven: Int = 7",
  "export let r: String = alias(seven)",
  "",
].join("\n");

function graph(
  conjunction: string,
  main: string,
): readonly (readonly [string, string])[] {
  return [
    ["/liba.hex", "module Liba\n\n" + LIB_A],
    ["/libb.hex", "module Libb\n\n" + LIB_B],
    ["/mid.hex", mid(conjunction)],
    ["/main.hex", "module Main\n\n" + main],
  ];
}

/** One module's emitted text, with the whole graph required to be clean. */
function emitted(
  files: readonly (readonly [string, string])[],
  path = "/main.hex",
): string {
  const project = compileFiles(files);
  expect(project.diagnostics.map(({ message }) => message)).toEqual([]);
  const module = project.modules.find(({ source }) => source.path === path);
  if (module === undefined) throw new Error(`no emitted module at ${path}`);
  return module.javascript.text;
}

async function answer(
  files: readonly (readonly [string, string])[],
  label: string,
): Promise<unknown> {
  return (await runProject(files, { transform: distinct(label) }))["r"];
}

describe("a two-seat scheme crosses a module border", () => {
  /**
   * What is new here is not `#importScheme` — the seeding file imports schemes
   * too — but the **two-seat** copy through it: `#importScheme` renumbers the
   * imported scheme's variables, the consumer keys on the numbers it just
   * minted, and a pair that shares a word is where those numbers are the only
   * thing keeping the two apart. `both` is defined where both constraints are
   * nameable and consumed where neither is.
   */
  const files = graph(DECLARED, CALLS_DIRECTLY);

  test("the definer mints two parameters and reads each member out of its own", () => {
    expect(emitted(files, "/mid.hex")).toContain(
      "const both = (v, __Fancy_a, __Fancy_a_1) => " +
        '__useA(v, __Fancy_a) + "|" + __useB(v, __Fancy_a_1);',
    );
  });

  /**
   * The consumer's saturated call is Part 8's to route, and the edition it
   * reaches takes no evidence — which is the reason this block's executed pin
   * is a check that the two producers agree rather than a check on the seats.
   * The seats themselves are executed by every block below.
   */
  test("a saturated call at Int is routed to the edition, evidence and all", () => {
    expect(emitted(files, "/mid.hex")).toContain(
      'return useAInt(v) + "|" + useBInt(v);',
    );
    expect(emitted(files)).toContain("const r = bothInt(seven);");
  });

  test("and the program answers what its source says", async () => {
    expect(await answer(files, "seat-travel-cross-module")).toBe("A7|B7");
  });
});

describe("the written conjunction's order is the ABI", () => {
  /**
   * Two spellings of one function over one type, and they are not the same
   * function to the linker: the tie in §6.1's sort key is broken by the order
   * the author wrote the conjunction in, so `useA` reads the *first* seat when
   * `Fancy` is written first and the *second* when it is written second. Read
   * the positions, not the letters — both parameters are spelled from the
   * declarations' own name and differ by the numeric probe alone, exactly as in
   * the seeding file.
   */
  test("the declared order puts each member on the seat its own list names", () => {
    expect(emitted(graph(DECLARED, CALLS_THROUGH_WRAPPER), "/mid.hex")).toContain(
      "const both = (v, __Fancy_a, __Fancy_a_1) => " +
        '__useA(v, __Fancy_a) + "|" + __useB(v, __Fancy_a_1);',
    );
  });

  test("flipping the list flips which seat each body lookup reads", () => {
    // The parameter *list* is unmoved — a suffix is positional and its spellings
    // are minted by the probe, not by the author. What moves is which position
    // each lookup reads out of, which is the whole of the claim.
    expect(emitted(graph(FLIPPED, CALLS_THROUGH_WRAPPER), "/mid.hex")).toContain(
      "const both = (v, __Fancy_a, __Fancy_a_1) => " +
        '__useA(v, __Fancy_a_1) + "|" + __useB(v, __Fancy_a);',
    );
  });

  /**
   * The other end of the same claim, and the half that makes the two runs below
   * able to disagree: the caller hands the two `Int` dictionaries over in
   * mirrored orders, because the callee it is calling is a different ABI. A
   * build that dropped the tie-break would emit one argument list for both.
   *
   * Scope, for this row and the run below it: what is being read is `wrap`'s
   * suffix, and `wrap` is *inferred* and module-private, so its own order is a
   * same-named pair that took no declared position — which Constraints §6.1
   * leaves unspecified, on FFI Part 9 §6.2.1's terms. That this implementation
   * inherits it from `both`'s declared list is a fact about the implementation,
   * not an obligation the spec imposes; the rows are load-bearing all the same,
   * because both ends of the call have to agree whatever the order is. The
   * spec-clean bearer of the ABI claim is the alias row two blocks down:
   * `alias = both` emits as the bare name and appends `both`'s **own declared**
   * suffix, which is the order §6.1 does specify.
   */
  test("the caller's argument list mirrors whichever list the callee wrote", () => {
    expect(emitted(graph(DECLARED, CALLS_THROUGH_WRAPPER))).toContain(
      "const r = wrap(seven, __Fancy_Int_1, __Fancy_Int_2);",
    );
    expect(emitted(graph(FLIPPED, CALLS_THROUGH_WRAPPER))).toContain(
      "const r = wrap(seven, __Fancy_Int_2, __Fancy_Int_1);",
    );
  });

  /**
   * And the point of the whole exercise: an author who reorders a binder list
   * has changed an ABI and not a program. Both arrangements run, through a
   * generic wrapper so the generic suffix is what executes, and both answer the
   * same. A swap at either end alone answers `"B7|A7"`.
   */
  test("both arrangements execute the generic suffix to one answer", async () => {
    expect(
      await answer(graph(DECLARED, CALLS_THROUGH_WRAPPER), "seat-travel-declared"),
    ).toBe("A7|B7");
    expect(
      await answer(graph(FLIPPED, CALLS_THROUGH_WRAPPER), "seat-travel-flipped"),
    ).toBe("A7|B7");
  });
});

describe("a generic pass-through forwards both seats", () => {
  /**
   * `wrap` is inferred, so its own binder list is minted by generalization from
   * a requirement copied off the imported scheme — two requirements that share a
   * word, in a module that can name neither constraint. It forwards the pair
   * positionally and must not collapse them.
   */
  const files = graph(DECLARED, CALLS_THROUGH_WRAPPER);

  test("the wrapper takes two seats and passes them in its own order", () => {
    expect(emitted(files)).toContain(
      "const wrap = (v, __Fancy_a, __Fancy_a_1) => __both(v, __Fancy_a, __Fancy_a_1);",
    );
  });

  test("and the pass-through answers", async () => {
    expect(await answer(files, "seat-travel-wrapper")).toBe("A7|B7");
  });
});

describe("a value-position reference of a two-seat function", () => {
  /**
   * `let alias = both` emits as the bare name (Constraints §6.1), so the alias
   * answers to `both`'s suffix while its consumers key on the alias's own
   * scheme — a scheme `#instantiate` minted fresh. This is the residual-evidence
   * eta path: nothing here is applied, and the two seats have to survive a copy
   * that no call site witnessed.
   */
  const files = graph(DECLARED, CALLS_THROUGH_ALIAS);

  test("the alias is the bare name and its call site fills both seats", () => {
    expect(emitted(files)).toContain("const alias = __both;");
    expect(emitted(files)).toContain(
      "const r = alias(seven, __Fancy_Int_1, __Fancy_Int_2);",
    );
  });

  test("and the alias answers", async () => {
    expect(await answer(files, "seat-travel-alias")).toBe("A7|B7");
  });

  /** The flipped ABI travels through the alias too, in mirrored order. */
  test("the flipped callee's alias hands its dictionaries over mirrored", async () => {
    const flipped = graph(FLIPPED, CALLS_THROUGH_ALIAS);
    expect(emitted(flipped)).toContain(
      "const r = alias(seven, __Fancy_Int_2, __Fancy_Int_1);",
    );
    expect(await answer(flipped, "seat-travel-alias-flipped")).toBe("A7|B7");
  });
});

describe("a recursion knot agrees with itself about both seats", () => {
  /**
   * `#knotEvidence`'s tie: a recursive call is typed against the function's own
   * not-yet-generalized scheme, so the seats the body's self-call passes are
   * minted before the seats the header ends up declaring. Two requirements
   * spelling one word is where a knot that re-resolved by name would tie them
   * together — and the self-call would then hand one dictionary twice, which is
   * `"A7|A7"` and not a crash.
   */
  const KNOT = [
    'import Liba as LibA',
    'import Libb as LibB',
    "",
    "fun walk<u: (LibA.Fancy, LibB.Fancy)>(v: u, n: Int): String =",
    '    if n <= 0 then "${LibA.useA(v)}|${LibB.useB(v)}" else walk(v, n - 1)',
    "",
    "let seven: Int = 7",
    "export let r: String = walk(seven, 3)",
    "",
  ].join("\n");

  const files = [
    ["/liba.hex", "module Liba\n\n" + LIB_A],
    ["/libb.hex", "module Libb\n\n" + LIB_B],
    ["/main.hex", "module Main\n\n" + KNOT],
  ] as const;

  test("the self-call forwards the two seats it was handed, in order", () => {
    expect(emitted([...files])).toContain(
      'return n <= 0 ? __useA(v, __Fancy_a) + "|" + __useB(v, __Fancy_a_1) ' +
        ": walk(v, n - 1, __Fancy_a, __Fancy_a_1);",
    );
  });

  test("and three descents reach the same two dictionaries as none", async () => {
    expect(await answer([...files], "seat-travel-knot")).toBe("A7|B7");
  });
});

describe("a parameterized instance's factory takes the head's flipped list", () => {
  /**
   * The seeding file's instance-head specimen writes its conjunction in declared
   * order; this is the flipped pairing, which is where the factory's parameters
   * and its *application* have to disagree with the reading order of the body to
   * both be right. The head honors the first library's `Fancy`, so `Box(t)`'s
   * own member is `fancyA` — and its body calls both libraries' members on the
   * element.
   */
  const HONOR = [
    'import Liba as LibA',
    'import Libb as LibB',
    "",
    "record Box(t) = {value: t}",
    "",
    "honor<t: (LibB.Fancy, LibA.Fancy)> LibA.Fancy<Box(t)> =",
    '    fancyA(box) = "${LibA.useA(box.value)}|${LibB.useB(box.value)}"',
    "",
    "let seven: Int = 7",
    "let box: Box(Int) = Box({value = seven})",
    "export let r: String = LibA.useA(box)",
    "",
  ].join("\n");

  const files = [
    ["/liba.hex", "module Liba\n\n" + LIB_A],
    ["/libb.hex", "module Libb\n\n" + LIB_B],
    ["/main.hex", "module Main\n\n" + HONOR],
  ] as const;

  test("the body reads the seat the head's own list names, not the first", () => {
    // `Fancy2` is written first, so the first factory parameter is the second
    // library's — and `useA`, wanting the first library's, reads `__Fancy_t_1`.
    expect(emitted([...files])).toContain(
      "const __instance = { fancyA: box => " +
        '__useA(box.value, __Fancy_t_1) + "|" + __useB(box.value, __Fancy_t) };',
    );
  });

  test("and the factory is applied in the same flipped order", () => {
    expect(emitted([...files])).toContain(
      "const __Fancy_Box_Int_2_Int_1 = __Fancy_Box(__Fancy_Int_2, __Fancy_Int_1);",
    );
  });

  test("so the instance answers as its source reads", async () => {
    expect(await answer([...files], "seat-travel-honor-flipped")).toBe("A7|B7");
  });
});
