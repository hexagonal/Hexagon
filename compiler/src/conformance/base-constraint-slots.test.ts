/**
 * Conformance for **the dictionary slot a base constraint fills** (#718,
 * `spec/constraints.md` §6.2).
 *
 * A constraint is its declaration (§5.1.1), and a base slot follows the
 * identity, never a referencing spelling. The compiler minted the slot from two
 * different names instead. The write side — an honor block's base-evidence
 * properties — canonicalized, so it spelled the base declaration's own word; the
 * read side — the entailment path a projection is published with — took the word
 * the *extending* declaration wrote. A module importing `Weigh as Heft` and
 * declaring `constraint Both<a: Heft>` therefore wrote a `weigh:` slot and read
 * `.heft`, with no diagnostic anywhere and a `TypeError` at run time in a third
 * module that never mentioned either word. The qualified form `<a: L.Weigh>`
 * was the same defect wearing a dot: the read side projected `.l.Weigh`, a
 * two-hop path into an object one level deep.
 *
 * Both sides now mint through one function over the extending declaration's
 * recorded base list, keyed by identity. That single currency is what the
 * specimens here are about, and it is deliberately not observable from a name:
 * the slot spelling for an uncontested base is exactly what it always was, so
 * the fence at the bottom pins an unaliased emission character for character.
 *
 * Three further rules ride the same list, and each has a specimen:
 *
 * - **The contest.** Two bases can *want* one slot — two imported constraints
 *   each declared `Tag`, distinct by identity, which no importer can rename
 *   apart. Refusing that meeting would wall off composing two libraries over a
 *   word their importer does not own, so slots assign positionally instead and
 *   the second numbers around the first. The adversarial ordering is pinned on
 *   the minting function directly: a base declared `Tag_1` must keep its own
 *   spelling when a `Tag` collider stands ahead of it.
 * - **One entry per declaration.** A base list naming one declaration twice —
 *   through any pair of spellings — is a hard error at the extending
 *   declaration. Before the refusal, `<a: (Weigh, L.Weigh)>` emitted a module
 *   with the same `import { __weigh }` line twice: a load-time `SyntaxError`.
 * - **A member may not take a minted slot.** *Transitional.* §6.2 spells the
 *   slot verbatim, which makes the collision impossible by start class and
 *   retires this refusal entirely; until the case flip lands the two share a
 *   spelling space, and the guard is aimed at the minted slot rather than at the
 *   local word it used to reserve. Its mirror is that a member spelled like a
 *   local *alias* is legal now, and was refused before.
 *
 * Every runnable specimen runs, and the strings are chosen so a wrong slot is a
 * wrong answer rather than a lucky one: each honored dictionary reports a
 * different word, so a program that reads the wrong slot either throws or
 * prints the other library's answer.
 *
 * Emitted modules mount as `data:` URLs the registry caches by text, so the
 * executed graphs are made byte-distinct.
 */

import { describe, expect, test } from "vitest";

import { mintBaseConstraintSlots } from "../constraints.js";
import { compileFiles, runProject } from "../support/test-project.js";

/** Makes a graph's modules byte-distinct, so the test gets its own instances. */
function distinct(label: string): (path: string, javascript: string) => string {
  return (_path, javascript) => `// ${label}\n${javascript}`;
}

function diagnostics(
  files: readonly (readonly [string, string])[],
): readonly string[] {
  return compileFiles(files).diagnostics.map(({ message }) => message);
}

/** One module's emitted text, with the whole graph required to be clean. */
function emitted(
  files: readonly (readonly [string, string])[],
  path: string,
): string {
  const project = compileFiles(files);
  expect(project.diagnostics.map(({ message }) => message)).toEqual([]);
  return project.modules.find(({ source }) => source.path === path)!.javascript.text;
}

/**
 * A library declaring `Weigh` and honoring it at `Int`. The `Int` instance is
 * the decoy: it answers `"int"`, so a specimen that reached the wrong evidence
 * and still ran would say so.
 */
const WEIGH_LIB = [
  "export constraint Weigh<a> =",
  "    weigh(value: a): String",
  "",
  "honor Weigh<Int> =",
  '    weigh(value) = "int"',
  "",
].join("\n");

/** The consumer of an extending constraint, honoring both at its own record. */
const WEIGH_MAIN = [
  'import { Both, use } from "./mid.hex"',
  'import { Weigh } from "./lib.hex"',
  "",
  "record Wrap = {n: Int}",
  "",
  "honor Weigh<Wrap> =",
  '    weigh(value) = "wrap"',
  "",
  "honor Both<Wrap> =",
  '    label(value) = "wb"',
  "",
  "export let r: String = use(Wrap({n = 1}))",
  "",
].join("\n");

function weighGraph(mid: string): readonly (readonly [string, string])[] {
  return [
    ["/lib.hex", WEIGH_LIB],
    ["/mid.hex", mid],
    ["/main.hex", WEIGH_MAIN],
  ];
}

describe("a base constraint's slot follows its declaration, not the spelling", () => {
  const ALIASED = [
    'import { Weigh as Heft } from "./lib.hex"',
    "",
    "export constraint Both<a: Heft> =",
    "    label(value: a): String",
    "",
    'export let use<a: Both>(n: a): String = "${weigh(n)}/${label(n)}"',
    "",
  ].join("\n");

  test("an importer's alias does not move the slot it reads", () => {
    // The defect's emission read `__Both_a.heft` on this line while `/main.hex`
    // wrote `weigh:` — no diagnostic, and `Cannot read properties of undefined`
    // at run time from a module that spells neither word.
    expect(emitted(weighGraph(ALIASED), "/mid.hex")).toContain(
      'const use = (n, __Both_a) => weigh(n, __Both_a.weigh) + "/" + label(n, __Both_a);',
    );
  });

  test("and the aliased program runs", async () => {
    const exports = await runProject([...weighGraph(ALIASED)], {
      transform: distinct("base-slot-alias"),
    });
    expect(exports["r"]).toBe("wrap/wb");
  });

  const QUALIFIED = [
    'import module L from "./lib.hex"',
    "",
    "export constraint Both<a: L.Weigh> =",
    "    label(value: a): String",
    "",
    'export let use<a: Both>(n: a): String = "${L.weigh(n)}/${label(n)}"',
    "",
  ].join("\n");

  test("nor does the qualified form, which used to project a two-hop path", () => {
    // `.l.Weigh` — the module alias lowercased into a slot, then a second hop
    // for the name. Nothing in the dictionary was ever one level deeper.
    const text = emitted(weighGraph(QUALIFIED), "/mid.hex");
    expect(text).toContain(
      'const use = (n, __Both_a) => __weigh(n, __Both_a.weigh) + "/" + label(n, __Both_a);',
    );
    expect(text).not.toContain(".l.Weigh");
  });

  test("and the qualified program runs", async () => {
    const exports = await runProject([...weighGraph(QUALIFIED)], {
      transform: distinct("base-slot-qualified"),
    });
    expect(exports["r"]).toBe("wrap/wb");
  });
});

describe("two same-spelled bases both stay reachable", () => {
  // The one contest that survives the ruling: two *distinct* declarations, each
  // named `Tag`, meeting in one base list. Neither can be renamed by the module
  // that composes them, so the slots number around each other in written order.
  function tagLib(member: string, answer: string): string {
    return [
      "export constraint Tag<a> =",
      `    ${member}(value: a): String`,
      "",
      "honor Tag<Int> =",
      `    ${member}(value) = "int"`,
      "",
    ].join("\n");
  }

  const MID = [
    'import { Tag } from "./lib1.hex"',
    'import { Tag as Tag2 } from "./lib2.hex"',
    "",
    "export constraint Both<a: (Tag, Tag2)> =",
    "    label(value: a): String",
    "",
    'export let use<a: Both>(n: a): String = "${one(n)}/${two(n)}/${label(n)}"',
    "",
  ].join("\n");

  const MAIN = [
    'import { Both, use } from "./mid.hex"',
    'import { Tag } from "./lib1.hex"',
    'import { Tag as Tag2 } from "./lib2.hex"',
    "",
    "record Wrap = {n: Int}",
    "",
    "honor Tag<Wrap> =",
    '    one(value) = "first"',
    "",
    "honor Tag2<Wrap> =",
    '    two(value) = "second"',
    "",
    "honor Both<Wrap> =",
    '    label(value) = "both"',
    "",
    "export let r: String = use(Wrap({n = 1}))",
    "",
  ].join("\n");

  const GRAPH: readonly (readonly [string, string])[] = [
    ["/lib1.hex", tagLib("one", "first")],
    ["/lib2.hex", tagLib("two", "second")],
    ["/mid.hex", MID],
    ["/main.hex", MAIN],
  ];

  test("the second numbers around the first, in written order", () => {
    // One dictionary, two `Tag` bases, two distinct properties. Before the
    // contest the honor block wrote `tag:` twice and the second silently won.
    expect(emitted(GRAPH, "/main.hex")).toContain(
      "const __Both_Wrap = { tag: __Tag_Wrap_1, tag_1: __Tag_Wrap_2, label: __Both_Wrap_label };",
    );
  });

  test("and each base's demand reads its own slot", () => {
    expect(emitted(GRAPH, "/mid.hex")).toContain(
      "const use = (n, __Both_a) => " +
        'one(n, __Both_a.tag) + "/" + two(n, __Both_a.tag_1) + "/" + label(n, __Both_a);',
    );
  });

  test("so both libraries answer, and neither answers for the other", async () => {
    const exports = await runProject([...GRAPH], {
      transform: distinct("base-slot-contest"),
    });
    expect(exports["r"]).toBe("first/second/both");
  });

  test("a base declared `Tag_1` keeps its own slot against a `Tag` collider", () => {
    // The adversarial ordering from the ruling's review, asked of the minting
    // function directly: the third entry's canonical spelling is reserved for
    // it, so the second entry's probe steps over `tag_1` rather than taking it.
    expect(mintBaseConstraintSlots(["Tag", "Tag", "Tag_1"]))
      .toEqual(["tag", "tag_2", "tag_1"]);
    // The same three in a different written order, which is the whole input.
    expect(mintBaseConstraintSlots(["Tag_1", "Tag", "Tag"]))
      .toEqual(["tag_1", "tag", "tag_2"]);
    expect(mintBaseConstraintSlots(["Tag", "Tag_1", "Tag"]))
      .toEqual(["tag", "tag_1", "tag_2"]);
    // An uncontested list is untouched, which is the byte-identity bar in
    // miniature.
    expect(mintBaseConstraintSlots(["Eq"])).toEqual(["eq"]);
    expect(mintBaseConstraintSlots(["Num", "Ord"])).toEqual(["num", "ord"]);
  });
});

describe("a base list names each declaration once", () => {
  test("two spellings of one declaration are refused, naming both and the home", () => {
    // Emitted before the refusal: `import { __weigh } from "./lib.js"` twice in
    // one module — `Identifier '__weigh' has already been declared`, at load.
    const mid = [
      'import { Weigh } from "./lib.hex"',
      'import module L from "./lib.hex"',
      "",
      "export constraint Both<a: (Weigh, L.Weigh)> =",
      "    label(value: a): String",
      "",
      'export let use<a: Both>(n: a): String = "${weigh(n)}/${label(n)}"',
      "",
    ].join("\n");
    expect(diagnostics(weighGraph(mid))).toEqual([
      "`Weigh` and `L.Weigh` both name the constraint declared `Weigh` in " +
        "`./lib.hex`; remove one",
    ]);
  });

  test("an alias is the same refusal, and reports the word that was written", () => {
    // Both currencies show in one message: the two *spellings* the author must
    // choose between, and the declaration they turned out to share.
    const mid = [
      'import { Weigh as Heft } from "./lib.hex"',
      'import module L from "./lib.hex"',
      "",
      "export constraint Both<a: (Heft, L.Weigh)> =",
      "    label(value: a): String",
      "",
      'export let use<a: Both>(n: a): String = "${weigh(n)}/${label(n)}"',
      "",
    ].join("\n");
    expect(diagnostics(weighGraph(mid))).toEqual([
      "`Heft` and `L.Weigh` both name the constraint declared `Weigh` in " +
        "`./lib.hex`; remove one",
    ]);
  });

  test("the bare repeat is refused too, with no home to name", () => {
    // A pre-registered constraint's declaration is the prelude's, and §7.6
    // withholds that path everywhere for the same reason: the reader cannot
    // edit it. The sentence carries both spellings and the declared name, which
    // is all the repair needs.
    expect(diagnostics([[
      "/main.hex",
      "export constraint Loud<a: (Show, Show)> =\n    boom(value: a): String\n",
    ]])).toEqual([
      "`Show` and `Show` both name the constraint declared `Show`; remove one",
    ]);
  });

  test("an entry that names no declaration is not half of a duplicate", () => {
    // The refusal is an identity claim, so it needs an identity to be about.
    // Two unknown spellings agree on the identity the *name* mints, which is
    // not a shared declaration — reporting them as naming one would be untrue,
    // and the repair it offers is not the repair the reader needs.
    const mid = [
      "export constraint Both<a: (Bogus, Bogus)> =",
      "    label(value: a): String",
      "",
    ].join("\n");
    expect(diagnostics([["/mid.hex", mid]])).toEqual([
      "unknown base constraint `Bogus`",
      "unknown base constraint `Bogus`",
    ]);
  });

  test("but a resolved pair beside an unknown entry is refused as it would be alone", () => {
    // The stand-down is per *entry*. An unrelated unknown third spelling neither
    // suppresses the pair's refusal nor joins it.
    const mid = [
      'import { Weigh as Heft } from "./lib.hex"',
      'import module L from "./lib.hex"',
      "",
      "export constraint Both<a: (Heft, L.Weigh, Bogus)> =",
      "    label(value: a): String",
      "",
    ].join("\n");
    expect(diagnostics([["/lib.hex", WEIGH_LIB], ["/mid.hex", mid]])).toEqual([
      "unknown base constraint `Bogus`",
      "`Heft` and `L.Weigh` both name the constraint declared `Weigh` in " +
        "`./lib.hex`; remove one",
    ]);
  });

  test("two genuinely distinct bases of one spelling are not this refusal", () => {
    // The contest above, asked as a negative: identity is what the rule keys on,
    // so a same-*spelled* pair passes where a same-*declaration* pair does not.
    const mid = [
      'import { Tag } from "./lib1.hex"',
      'import { Tag as Tag2 } from "./lib2.hex"',
      "",
      "export constraint Both<a: (Tag, Tag2)> =",
      "    label(value: a): String",
      "",
    ].join("\n");
    const tagLib = [
      "export constraint Tag<a> =",
      "    tag(value: a): String",
      "",
    ].join("\n");
    expect(diagnostics([
      ["/lib1.hex", tagLib],
      ["/lib2.hex", tagLib.replace("tag(", "tag2(")],
      ["/mid.hex", mid],
    ])).toEqual([]);
  });
});

describe("a member may not take a minted slot (transitional)", () => {
  // Deleted by the case flip: a verbatim slot is uppercase-start and a function
  // member is not, so §6.2 says there is nothing left to check. Until then the
  // guard has to read the *minted* slot — reserving the local spelling is what
  // let this program compile clean and emit one object literal with `weigh`
  // written twice, the second key silently winning.
  const LIB = [
    "export constraint Weigh<a> =",
    "    heaviness(value: a): String",
    "",
    "honor Weigh<Int> =",
    '    heaviness(value) = "int"',
    "",
  ].join("\n");

  test("a member spelled like the base declaration's slot is refused", () => {
    const mid = [
      'import { Weigh as Heft } from "./lib.hex"',
      "",
      "export constraint Both<a: Heft> =",
      "    weigh(value: a): String",
      "",
    ].join("\n");
    expect(diagnostics([["/lib.hex", LIB], ["/mid.hex", mid]])).toEqual([
      "member `weigh` conflicts with the `Weigh` dictionary slot; rename the member",
    ]);
  });

  test("a member spelled like the local alias is legal", () => {
    // The mirror, and a behaviour change: `heft` was refused before, and no slot
    // of that spelling has ever existed.
    const mid = [
      'import { Weigh as Heft } from "./lib.hex"',
      "",
      "export constraint Both<a: Heft> =",
      "    heft(value: a): String",
      "",
    ].join("\n");
    expect(diagnostics([["/lib.hex", LIB], ["/mid.hex", mid]])).toEqual([]);
  });
});

describe("the fence: an uncontested slot is spelled exactly as before", () => {
  test("`Hash`'s `Eq` base is still `eq`, on its emitted line", () => {
    // Every program with no alias, no qualified base, no same-spelled meeting
    // and no duplicate is unmoved by this change — which is all of stdlib, the
    // prelude, and the rest of this suite. `Hash` extends `Eq`, both canonical,
    // so the derived walk's projection is the byte it always was.
    const main = [
      "record Point derives (Eq, Hash) = {x: Int, y: Int}",
      "",
      "export let r: Int = hash(Point({x = 1, y = 2}))",
      "",
    ].join("\n");
    const text = emitted([["/main.hex", main]], "/main.hex");
    expect(text).toContain("const __Hash_Point = { eq: __Eq_Point,");
  });

  test("a user constraint's own base is spelled from its declaration", () => {
    const main = [
      "constraint Weigh<a> =",
      "    weigh(value: a): String",
      "",
      "constraint Both<a: Weigh> =",
      "    label(value: a): String",
      "",
      "record Wrap = {n: Int}",
      "",
      "honor Weigh<Wrap> =",
      '    weigh(value) = "wrap"',
      "",
      "honor Both<Wrap> =",
      '    label(value) = "wb"',
      "",
      'export let use<a: Both>(n: a): String = "${weigh(n)}/${label(n)}"',
      "export let r: String = use(Wrap({n = 1}))",
      "",
    ].join("\n");
    expect(emitted([["/main.hex", main]], "/main.hex")).toContain(
      "const __Both_Wrap = { weigh: __Weigh_Wrap, label: __Both_Wrap_label };",
    );
  });
});
