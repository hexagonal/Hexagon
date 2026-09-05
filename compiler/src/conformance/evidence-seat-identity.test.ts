/**
 * Conformance for **which evidence parameter a use site reads** when two
 * constraints in one scope spell one word (#714).
 *
 * A constraint is its declaration (`spec/constraints.md` §5.1.1), and a name is
 * not a property of one at a module border: two modules may each declare a
 * `Describe`, and no third module can spell both *under that one word*. They
 * meet in one scope two ways, and both are specimens below: inside the imported
 * schemes of functions constrained by them, where the consumer names neither
 * constraint, and under an alias, where it names both and can write the binder
 * list itself.
 *
 * Everything upstream had already been moved to identity — the instance table,
 * the planner's editions, the CSE key — and the evidence seat had not, so the
 * two requirements minted two parameters and every lookup in the body collapsed
 * onto the one registered last. The result was the worst class of defect: no
 * diagnostic, an emission that reads plausibly, and a `TypeError` at run time
 * far from either import, with `useOne` holding the other module's dictionary.
 *
 * The seat is keyed by identity now. The *names* are unchanged and still
 * spelled from the constraint, so the two parameters differ by the numeric
 * probe alone — `__Describe_a` and `__Describe_a_1` — and reading the emitted
 * text is not enough to tell a correct routing from the defect. Every specimen
 * here therefore runs, and the arithmetic is chosen so each dictionary answers
 * differently: `one` adds 1 and `two` adds 2, so a program that reaches the
 * wrong one gets the wrong number rather than the right one by luck.
 *
 * Four doors seed the seats and all four are exercised: an inferred scheme's
 * binders, a written binder list over two aliased imports, an instance head's
 * own binders, and the route a demand takes when the constraint it asked for is
 * a *base* of the binder that answers. The last is why the `Num` projections
 * are pinned as well as the calls: `+` demands `Num`, which both `Describe`s
 * provide, and the seat it projects out of has to be the one the boundary
 * derivation named — the first kept binder in list order — rather than whichever
 * happens to be reachable.
 *
 * The final block is the fence. Nothing about a program whose constraint names
 * are unambiguous may move, so a representative generic body is pinned on its
 * exact emitted line, character for character.
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
 * A module declaring `Describe` and honoring it at `Int`, with a constrained
 * export under it. Every copy spells the constraint identically and answers
 * differently, which is the whole specimen: the word cannot tell them apart and
 * the arithmetic can.
 */
function describeLib(member: string, use: string, offset: number): string {
  return [
    "export constraint Describe<a: Num> =",
    `    ${member}(value: a): a`,
    "",
    "honor Describe<Int> =",
    `    ${member}(value) = value + ${offset}`,
    "",
    `export let ${use}<a: Describe>(n: a): a = ${member}(n)`,
    "",
  ].join("\n");
}

/** The same shape with no base constraint, for the instance-head specimen. */
function tagLib(member: string, use: string, answer: string): string {
  return [
    "export constraint Tag<a> =",
    `    ${member}(value: a): String`,
    "",
    "honor Tag<Int> =",
    `    ${member}(value) = "${answer}"`,
    "",
    `export let ${use}<a: Tag>(n: a): String = ${member}(n)`,
    "",
  ].join("\n");
}

const LIB1 = describeLib("one", "useOne", 1);
const LIB2 = describeLib("two", "useTwo", 2);
const LIB3 = describeLib("three", "useThree", 3);

/** `/main.hex`'s emitted text, with the graph required to be clean. */
function emittedMain(files: readonly (readonly [string, string])[]): string {
  const project = compileFiles(files);
  expect(project.diagnostics.map(({ message }) => message)).toEqual([]);
  return project.modules.find(({ source }) => source.path === "/main.hex")!.javascript.text;
}

describe("two imported constraints sharing a word take two seats", () => {
  const files = (main: string) => [
    ["/lib1.hex", "module Lib1\n\n" + LIB1],
    ["/lib2.hex", "module Lib2\n\n" + LIB2],
    ["/main.hex", "module Main\n\n" + main],
  ] as const;

  const INFERRED = [
    'import Lib1',
    'import Lib2',
    "",
    "let both(v) = Lib1.useOne(v) + Lib2.useTwo(v)",
    "export let r: Int = both(1)",
    "",
  ].join("\n");

  test("each call is handed the dictionary of its own constraint", () => {
    // The defect's emission, for contrast, read `__Describe_a_1` in all three
    // positions: two parameters minted, one of them dead, and `useOne` calling
    // `lib2`'s dictionary — `__Describe_a.one is not a function`.
    expect(emittedMain(files(INFERRED))).toContain(
      "const both = (v, __Describe_a, __Describe_a_1) => " +
        "__Describe_a.Num.add(__useOne(v, __Describe_a), __useTwo(v, __Describe_a_1));",
    );
  });

  test("and the caller fills both seats in the scheme's own order", () => {
    expect(emittedMain(files(INFERRED))).toContain(
      "const r = both(1, __Describe_Int_1, __Describe_Int_2);",
    );
  });

  test("so the program computes what its source says", async () => {
    const exports = await runProject([...files(INFERRED)], {
      transform: distinct("seat-identity-inferred"),
    });
    expect(exports["r"]).toBe(5);
  });

  test("the absorbed `Num` demand projects out of the first binder kept", async () => {
    // `+` raises `Num`, which both `Describe`s provide, so the demand is a
    // projection rather than a seat of its own. Which binder it comes out of is
    // decided by list order at the Typed boundary, and the answer has to be the
    // *same* dictionary the source's own first call reads — `lib1`'s.
    const main = [
      'import Lib1',
      'import Lib2',
      "",
      "let sum(v) = Lib1.useOne(v) + Lib2.useTwo(v) + v",
      "export let r: Int = sum(1)",
      "",
    ].join("\n");
    expect(emittedMain(files(main))).toContain(
      "const sum = (v, __Describe_a, __Describe_a_1) => " +
        "__Describe_a.Num.add(__Describe_a.Num.add(" +
        "__useOne(v, __Describe_a), __useTwo(v, __Describe_a_1)), v);",
    );
    const exports = await runProject([...files(main)], {
      transform: distinct("seat-identity-route"),
    });
    expect(exports["r"]).toBe(6);
  });

  test("a third declaration of the word is a third seat", async () => {
    // Two seats can be got right by accident — a swap and a shadow look alike
    // when there are only two names to hand out. Three cannot.
    const main = [
      'import Lib1',
      'import Lib2',
      'import Lib3',
      "",
      "let all(v) = Lib1.useOne(v) + Lib2.useTwo(v) + Lib3.useThree(v)",
      "export let r: Int = all(1)",
      "",
    ].join("\n");
    const graph = [
      ["/lib1.hex", "module Lib1\n\n" + LIB1],
      ["/lib2.hex", "module Lib2\n\n" + LIB2],
      ["/lib3.hex", "module Lib3\n\n" + LIB3],
      ["/main.hex", "module Main\n\n" + main],
    ] as const;
    expect(emittedMain(graph)).toContain(
      "const all = (v, __Describe_a, __Describe_a_1, __Describe_a_2) => " +
        "__Describe_a.Num.add(__Describe_a.Num.add(" +
        "__useOne(v, __Describe_a), __useTwo(v, __Describe_a_1)), " +
        "__useThree(v, __Describe_a_2));",
    );
    const exports = await runProject([...graph], {
      transform: distinct("seat-identity-three"),
    });
    expect(exports["r"]).toBe(9);
  });
});

describe("the binders a signature writes down seat the same way", () => {
  // The block above seeds every seat from an *inferred* scheme. A module that
  // aliases one of the two imports can spell both constraints and write the
  // binder list itself, which is a different door into `#evidenceParameters` —
  // and the one whose two words are visibly distinct in source while the
  // emitted parameters are not.
  const files = (main: string) => [
    ["/lib1.hex", "module Lib1\n\n" + LIB1],
    ["/lib2.hex", "module Lib2\n\n" + LIB2],
    ["/main.hex", "module Main\n\n" + main],
  ] as const;

  // Under #762 an import binds a module alias and nothing smaller, so neither
  // constraint can be renamed by the import line any more (`Describe as
  // Describe2` has no seat left) — both are reached through their module
  // aliases instead, `Lib1.Describe` and `Lib2.Describe`, which is what makes
  // this door distinct from the inferred block above: the binder list is
  // *written*, and only the qualified spelling can write two same-named
  // constraints into one.
  const WRITTEN = [
    'import Lib1',
    'import Lib2',
    "",
    "let both<a: (Lib1.Describe, Lib2.Describe)>(n: a): a = " +
      "Lib1.useOne(n) + Lib2.useTwo(n)",
    "export let r: Int = both(1)",
    "",
  ].join("\n");

  test("a written two-binder list mints two parameters and reads both", () => {
    // The alias is the importer's word and never reaches the output: both
    // parameters are spelled from the declarations' own name, and the second
    // takes the probe's suffix.
    expect(emittedMain(files(WRITTEN))).toContain(
      "const both = (n, __Describe_a, __Describe_a_1) => " +
        "__Describe_a.Num.add(__useOne(n, __Describe_a), __useTwo(n, __Describe_a_1));",
    );
  });

  test("and the written form runs to the same answer as the inferred one", async () => {
    const exports = await runProject([...files(WRITTEN)], {
      transform: distinct("seat-identity-written"),
    });
    expect(exports["r"]).toBe(5);
  });
});

describe("an instance head's own binders", () => {
  // The third seeding door: `honor`'s type parameters, whose constraints used
  // to cross the Typed boundary as bare names with no identity beside them.
  // That was the one gap where the identity could not simply be threaded — it
  // had to be resolved, which the declaring module is the authority for, a
  // header being able to spell only what is in scope where it is written.
  const HONOR = [
    'import Lib1',
    'import Lib2',
    "",
    "record Box(x) = {value: x}",
    "",
    "honor<x: (Lib1.Tag, Lib2.Tag)> Lib1.Tag<Box(x)> =",
    '    one(box) = "${Lib1.useOne(box.value)}/${Lib2.useTwo(box.value)}"',
    "",
    "let box: Box(Int) = Box({value = 1})",
    "export let r: String = Lib1.useOne(box)",
    "",
  ].join("\n");

  const files = [
    ["/lib1.hex", "module Lib1\n\n" + tagLib("one", "useOne", "one")],
    ["/lib2.hex", "module Lib2\n\n" + tagLib("two", "useTwo", "two")],
    ["/main.hex", "module Main\n\n" + HONOR],
  ] as const;

  test("hand each member body the dictionary its own constraint demanded", () => {
    expect(emittedMain(files)).toContain(
      "const __instance = { one: box => " +
        '__useOne(box.value, __Tag_x) + "/" + __useTwo(box.value, __Tag_x_1) };',
    );
  });

  test("and the instance runs", async () => {
    const exports = await runProject([...files], {
      transform: distinct("seat-identity-honor"),
    });
    expect(exports["r"]).toBe("one/two");
  });
});

describe("a program whose constraint names are unambiguous is unmoved", () => {
  test("a generic body with two binders and an absorbed demand is unchanged", () => {
    // The fence. `<=` raises `Ord` and a literal `Num`; `-` raises `Signed`,
    // which absorbs the `Num`. Nothing here shares a word with anything, so
    // every seat resolved by name before and by identity now, and the emitted
    // text is required to be the same character for character.
    const project = compileFiles([
      ["/main.hex", "module Main\n\n" + "let d1(n) = if n <= 0 then 0 else n - 1\nexport let keep: Int = d1(3)\n"],
    ]);
    expect(project.diagnostics.map(({ message }) => message)).toEqual([]);
    expect(
      project.modules.find(({ source }) => source.path === "/main.hex")!.javascript.text,
    ).toContain(
      "const d1 = (n, __Ord_a, __Signed_a) => " +
        '__Ord_a.compare(n, __Signed_a.Num.fromNat(0)).tag !== "Greater" ' +
        "? __Signed_a.Num.fromNat(0) " +
        ": __Signed_a.subtract(n, __Signed_a.Num.fromNat(1));",
    );
  });

  test("and a constrained export under a single imported constraint is too", () => {
    // One `Describe` and no twin, reached through an imported scheme exactly as
    // the specimens above reach theirs: one parameter, no suffix.
    expect(
      emittedMain([
        ["/lib1.hex", "module Lib1\n\n" + LIB1],
        ["/main.hex", "module Main\n\n" + [
          'import Lib1',
          "",
          "let once(v) = Lib1.useOne(v) + v",
          "export let r: Int = once(1)",
          "",
        ].join("\n")],
      ]),
    ).toContain(
      "const once = (v, __Describe_a) => __Describe_a.Num.add(__useOne(v, __Describe_a), v);",
    );
  });
});
