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
 * specimens here are about, and the spelling it mints is the base declaration's
 * own name **verbatim** — `{ Eq: … }`, `dict.Num.add` — which the block at the
 * bottom pins on an unaliased emission from both directions at once.
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
 * - **A member cannot take a minted slot.** §6.2 spells the slot verbatim, so it
 *   is uppercase-start and a function member's name is not: the two spelling
 *   spaces are disjoint by start class, there is no rule left to check, and the
 *   specimen that used to be a refusal — a member `weigh` under an aliased base
 *   `Heft` — is a positive that runs, `weigh` and `Weigh` answering separately
 *   out of one dictionary literal.
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

import {
  mintBaseConstraintSlots,
  PRE_REGISTERED_BASE_CONSTRAINTS,
  preRegisteredBaseSlots,
  preRegisteredConstraintIdentity,
} from "../constraints.js";
import { applyLayout } from "../passes/layout/layout.js";
import { lex } from "../passes/lexer/lexer.js";
import { parse } from "../passes/parser/parser.js";
import { PRELUDE_MODULES } from "../prelude.js";
import * as Source from "../support/source.js";
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
  'import Mid',
  'import Lib',
  "",
  "record Wrap = {n: Int}",
  "",
  "honor Lib.Weigh<Wrap> =",
  '    weigh(value) = "wrap"',
  "",
  "honor Mid.Both<Wrap> =",
  '    label(value) = "wb"',
  "",
  "export let r: String = Mid.use(Wrap({n = 1}))",
  "",
].join("\n");

function weighGraph(mid: string): readonly (readonly [string, string])[] {
  return [
    ["/lib.hex", "module Lib\n\n" + WEIGH_LIB],
    ["/mid.hex", "module Mid\n\n" + mid],
    ["/main.hex", "module Main\n\n" + WEIGH_MAIN],
  ];
}

describe("a base constraint's slot follows its declaration, not the spelling", () => {
  // Under #762 an import binds a module alias and nothing smaller, so the old
  // `import { Weigh as Heft }` — a *bare local rename* of the constraint — has
  // no seat left: nothing renames a constraint any more, only the module alias
  // qualifying it can be spelled however the importer likes. `Heft` here is
  // that alias, chosen to look nothing like `Weigh`, so the claim is the same
  // one the old fixture pinned: the module alias's own spelling never moves
  // the slot, which is minted from the base declaration's identity.
  const ALIASED = [
    'import Lib as Heft',
    "",
    "export constraint Both<a: Heft.Weigh> =",
    "    label(value: a): String",
    "",
    'export let use<a: Both>(n: a): String = "${Heft.weigh(n)}/${label(n)}"',
    "",
  ].join("\n");

  test("an importer's alias does not move the slot it reads", () => {
    // The defect's emission read `__Both_a.heft` on this line while `/main.hex`
    // wrote `weigh:` — no diagnostic, and `Cannot read properties of undefined`
    // at run time from a module that spells neither word.
    expect(emitted(weighGraph(ALIASED), "/mid.hex")).toContain(
      'const use = (n, __Both_a) => __weigh(n, __Both_a.Weigh) + "/" + label(n, __Both_a);',
    );
  });

  test("and the aliased program runs", async () => {
    const exports = await runProject([...weighGraph(ALIASED)], {
      transform: distinct("base-slot-alias"),
    });
    expect(exports["r"]).toBe("wrap/wb");
  });

  const QUALIFIED = [
    'import Lib as L',
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
      'const use = (n, __Both_a) => __weigh(n, __Both_a.Weigh) + "/" + label(n, __Both_a);',
    );
    expect(text).not.toContain(".L.Weigh");
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
    'import Lib1',
    'import Lib2',
    "",
    "export constraint Both<a: (Lib1.Tag, Lib2.Tag)> =",
    "    label(value: a): String",
    "",
    'export let use<a: Both>(n: a): String = ' +
      '"${Lib1.one(n)}/${Lib2.two(n)}/${label(n)}"',
    "",
  ].join("\n");

  const MAIN = [
    'import Mid',
    'import Lib1',
    'import Lib2',
    "",
    "record Wrap = {n: Int}",
    "",
    "honor Lib1.Tag<Wrap> =",
    '    one(value) = "first"',
    "",
    "honor Lib2.Tag<Wrap> =",
    '    two(value) = "second"',
    "",
    "honor Mid.Both<Wrap> =",
    '    label(value) = "both"',
    "",
    "export let r: String = Mid.use(Wrap({n = 1}))",
    "",
  ].join("\n");

  const GRAPH: readonly (readonly [string, string])[] = [
    ["/lib1.hex", tagLib("one", "first")],
    ["/lib2.hex", tagLib("two", "second")],
    ["/mid.hex", "module Mid\n\n" + MID],
    ["/main.hex", "module Main\n\n" + MAIN],
  ];

  test("the second numbers around the first, in written order", () => {
    // One dictionary, two `Tag` bases, two distinct properties. Before the
    // contest the honor block wrote `Tag:` twice and the second silently won.
    expect(emitted(GRAPH, "/main.hex")).toContain(
      "const __Both_Wrap = { Tag: __Tag_Wrap_1, Tag_1: __Tag_Wrap_2, label: __Both_Wrap_label };",
    );
  });

  test("and each base's demand reads its own slot", () => {
    expect(emitted(GRAPH, "/mid.hex")).toContain(
      "const use = (n, __Both_a) => " +
        '__one(n, __Both_a.Tag) + "/" + __two(n, __Both_a.Tag_1) + "/" + label(n, __Both_a);',
    );
  });

  test("so both libraries answer, and neither answers for the other", async () => {
    const exports = await runProject([...GRAPH], {
      transform: distinct("base-slot-contest"),
    });
    expect(exports["r"]).toBe("first/second/both");
  });

  test("the adversarial ordering compiles, and both sides agree on it", async () => {
    // The assertion below is on the minting function; this one is on the
    // compiler. Three libraries — `Tag`, `Tag`, `Tag_1` — composed in that
    // written order, so the second must step *over* the third's own spelling.
    // Pinned on the write side (the honor block's properties) and the read side
    // (the projections the extending module's body takes) together, which is
    // what makes "both sites consume one helper output positionally" a measured
    // claim rather than a design intention.
    function lib(constraint: string, member: string): string {
      return [
        `export constraint ${constraint}<a> =`,
        `    ${member}(value: a): String`,
        "",
      ].join("\n");
    }
    const mid = [
      'import Lib1',
      'import Lib2',
      'import Lib3',
      "",
      "export constraint Both<a: (Lib1.Tag, Lib2.Tag, Lib3.Tag_1)> =",
      "    label(value: a): String",
      "",
      'export let use<a: Both>(n: a): String = ' +
        '"${Lib1.one(n)}/${Lib2.two(n)}/${Lib3.three(n)}/${label(n)}"',
      "",
    ].join("\n");
    const main = [
      'import Mid',
      'import Lib1',
      'import Lib2',
      'import Lib3',
      "",
      "record Wrap = {n: Int}",
      "",
      "honor Lib1.Tag<Wrap> =",
      '    one(value) = "first"',
      "",
      "honor Lib2.Tag<Wrap> =",
      '    two(value) = "second"',
      "",
      "honor Lib3.Tag_1<Wrap> =",
      '    three(value) = "third"',
      "",
      "honor Mid.Both<Wrap> =",
      '    label(value) = "both"',
      "",
      "export let r: String = Mid.use(Wrap({n = 1}))",
      "",
    ].join("\n");
    const graph: readonly (readonly [string, string])[] = [
      ["/lib1.hex", lib("Tag", "one")],
      ["/lib2.hex", lib("Tag", "two")],
      ["/lib3.hex", lib("Tag_1", "three")],
      ["/mid.hex", "module Mid\n\n" + mid],
      ["/main.hex", "module Main\n\n" + main],
    ];
    // Write side: `Tag`, then `Tag_2` stepping over the third entry's claim,
    // then `Tag_1` kept by the base that is actually declared `Tag_1`.
    expect(emitted(graph, "/main.hex")).toContain(
      "const __Both_Wrap = { Tag: __Tag_Wrap_1, Tag_2: __Tag_Wrap_2, " +
        "Tag_1: __Tag_1_Wrap, label: __Both_Wrap_label };",
    );
    // Read side: the same three spellings, projected out of the one binder.
    expect(emitted(graph, "/mid.hex")).toContain(
      "const use = (n, __Both_a) => " +
        '__one(n, __Both_a.Tag) + "/" + __two(n, __Both_a.Tag_2) + "/" + ' +
        '__three(n, __Both_a.Tag_1) + "/" + label(n, __Both_a);',
    );
    const exports = await runProject([...graph], {
      transform: distinct("base-slot-flattening"),
    });
    expect(exports["r"]).toBe("first/second/third/both");
  });

  test("a base declared `Tag_1` keeps its own slot against a `Tag` collider", () => {
    // The adversarial ordering from the ruling's review, asked of the minting
    // function directly: the third entry's canonical spelling is reserved for
    // it, so the second entry's probe steps over `Tag_1` rather than taking it.
    expect(mintBaseConstraintSlots(["Tag", "Tag", "Tag_1"]))
      .toEqual(["Tag", "Tag_2", "Tag_1"]);
    // The same three in a different written order, which is the whole input.
    expect(mintBaseConstraintSlots(["Tag_1", "Tag", "Tag"]))
      .toEqual(["Tag_1", "Tag", "Tag_2"]);
    expect(mintBaseConstraintSlots(["Tag", "Tag_1", "Tag"]))
      .toEqual(["Tag", "Tag_1", "Tag_2"]);
    // An uncontested list is the declaration's own names and nothing else,
    // which is the shape of every base list in the prelude.
    expect(mintBaseConstraintSlots(["Eq"])).toEqual(["Eq"]);
    expect(mintBaseConstraintSlots(["Num", "Ord"])).toEqual(["Num", "Ord"]);
  });
});

describe("a base list names each declaration once", () => {
  test("two spellings of one declaration are refused, naming both and the home", () => {
    // Emitted before the refusal: `import { __weigh } from "./lib.js"` twice in
    // one module — `Identifier '__weigh' has already been declared`, at load.
    //
    // The bare entry is the companion fallback (§5.1 rule 2), open because the
    // module alias is spelled exactly `Weigh`, the same word `/lib.hex` exports
    // — the one bare route #762 leaves standing here — beside the qualified
    // entry through a second alias, `L`, for the same module.
    const mid = [
      'import Lib as Weigh',
      'import Lib as L',
      "",
      "export constraint Both<a: (Weigh, L.Weigh)> =",
      "    label(value: a): String",
      "",
      'export let use<a: Both>(n: a): String = "${L.weigh(n)}/${label(n)}"',
      "",
    ].join("\n");
    expect(diagnostics(weighGraph(mid))).toEqual([
      "`Weigh` and `L.Weigh` both name the constraint declared `Weigh` in " +
        "`./lib.hex`; remove one",
    ]);
  });

  test("two aliases of one module are the same refusal, and report the words written", () => {
    // Both currencies show in one message: the two *spellings* the author must
    // choose between, and the declaration they turned out to share. Under #762
    // neither spelling can be a bare rename any more (`import { Weigh as Heft }`
    // has no seat left), so this is the two-alias shape instead: `W` and `L`
    // name the one module, and neither is the module's own bare-fallback name,
    // so the message quotes both qualified spellings rather than one of them
    // bare.
    const mid = [
      'import Lib as W',
      'import Lib as L',
      "",
      "export constraint Both<a: (W.Weigh, L.Weigh)> =",
      "    label(value: a): String",
      "",
      'export let use<a: Both>(n: a): String = "${W.weigh(n)}/${label(n)}"',
      "",
    ].join("\n");
    expect(diagnostics(weighGraph(mid))).toEqual([
      "`W.Weigh` and `L.Weigh` both name the constraint declared `Weigh` in " +
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
      "module Main\n\n" + "export constraint Loud<a: (Show, Show)> =\n    boom(value: a): String\n",
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
    expect(diagnostics([["/mid.hex", "module Mid\n\n" + mid]])).toEqual([
      "unknown base constraint `Bogus`",
      "unknown base constraint `Bogus`",
    ]);
  });

  test("but a resolved pair beside an unknown entry is refused as it would be alone", () => {
    // The stand-down is per *entry*. An unrelated unknown third spelling neither
    // suppresses the pair's refusal nor joins it.
    const mid = [
      'import Lib as W',
      'import Lib as L',
      "",
      "export constraint Both<a: (W.Weigh, L.Weigh, Bogus)> =",
      "    label(value: a): String",
      "",
    ].join("\n");
    expect(diagnostics([["/lib.hex", "module Lib\n\n" + WEIGH_LIB], ["/mid.hex", "module Mid\n\n" + mid]])).toEqual([
      "unknown base constraint `Bogus`",
      "`W.Weigh` and `L.Weigh` both name the constraint declared `Weigh` in " +
        "`./lib.hex`; remove one",
    ]);
  });

  test("two genuinely distinct bases of one spelling are not this refusal", () => {
    // The contest above, asked as a negative: identity is what the rule keys on,
    // so a same-*spelled* pair passes where a same-*declaration* pair does not.
    const mid = [
      'import Lib1',
      'import Lib2',
      "",
      "export constraint Both<a: (Lib1.Tag, Lib2.Tag)> =",
      "    label(value: a): String",
      "",
    ].join("\n");
    const tagLib = [
      "export constraint Tag<a> =",
      "    tag(value: a): String",
      "",
    ].join("\n");
    expect(diagnostics([
      ["/lib1.hex", "module Lib1\n\n" + tagLib],
      ["/lib2.hex", tagLib.replace("tag(", "tag2(")],
      ["/mid.hex", "module Mid\n\n" + mid],
    ])).toEqual([]);
  });
});

describe("a member cannot take a minted slot, and needs no rule saying so", () => {
  // A slot is uppercase-start and a function member's name is not (§2), so the
  // two spelling spaces are disjoint and the refusal that used to police them is
  // gone. The specimen that was that refusal is the interesting one, so it is
  // kept and run: `weigh` the member and `Weigh` the slot differ by one letter's
  // case, sit in one object literal, and must both answer.
  const LIB = [
    "export constraint Weigh<a> =",
    "    heaviness(value: a): String",
    "",
    "honor Weigh<Int> =",
    '    heaviness(value) = "int"',
    "",
  ].join("\n");

  const MID = [
    'import Lib as Weigh',
    "",
    "export constraint Both<a: Weigh> =",
    "    weigh(value: a): String",
    "",
    'export let use<a: Both>(n: a): String = "${Weigh.heaviness(n)}/${weigh(n)}"',
    "",
  ].join("\n");

  const MAIN = [
    'import Mid',
    'import Lib',
    "",
    "record Wrap = {n: Int}",
    "",
    "honor Lib.Weigh<Wrap> =",
    '    heaviness(value) = "base"',
    "",
    "honor Mid.Both<Wrap> =",
    '    weigh(value) = "member"',
    "",
    "export let r: String = Mid.use(Wrap({n = 1}))",
    "",
  ].join("\n");

  const GRAPH: readonly (readonly [string, string])[] = [
    ["/lib.hex", "module Lib\n\n" + LIB],
    ["/mid.hex", "module Mid\n\n" + MID],
    ["/main.hex", "module Main\n\n" + MAIN],
  ];

  test("a member spelled like the base declaration's name is legal", () => {
    expect(diagnostics(GRAPH)).toEqual([]);
  });

  test("and the two keys are distinct in the one dictionary literal", () => {
    // The whole rule, on one line. `Weigh` is the base slot, minted from the
    // declaration through the alias; `weigh` is this constraint's own member.
    expect(emitted(GRAPH, "/main.hex")).toContain(
      "const __Both_Wrap = { Weigh: __Weigh_Wrap, weigh: __Both_Wrap_weigh };",
    );
  });

  test("and both are reachable, each answering for itself", async () => {
    // Text is not enough here: a literal with two keys one case apart is exactly
    // the shape that collapses if anything downstream folds case, and the answer
    // would then be one word twice. `"base"` comes through the slot, `"member"`
    // off the member seat.
    const exports = await runProject([...GRAPH], {
      transform: distinct("base-slot-member-neighbour"),
    });
    expect(exports["r"]).toBe("base/member");
  });

  test("a member spelled like the local alias is legal too", () => {
    // The mirror, and a behaviour change from before #719: `heft` was refused,
    // and no slot of that spelling has ever existed. `Heft` is the module
    // alias's own spelling here (not the base's — #762 leaves no bare rename to
    // reach for), so this is the same claim: the alias's word is not the slot.
    const mid = [
      'import Lib as Heft',
      "",
      "export constraint Both<a: Heft.Weigh> =",
      "    heft(value: a): String",
      "",
    ].join("\n");
    expect(diagnostics([["/lib.hex", "module Lib\n\n" + LIB], ["/mid.hex", "module Mid\n\n" + mid]])).toEqual([]);
  });
});

describe("an uncontested slot is the base declaration's name, verbatim", () => {
  test("`Hash`'s `Eq` base is `Eq`, on its emitted line", () => {
    // The write side, on a program with no alias, no qualified base, no
    // same-spelled meeting and no duplicate — the shape of all of stdlib, the
    // prelude, and the rest of this suite. `Hash` extends `Eq`, both canonical,
    // so the derived walk's projection is the declaration's own word unchanged.
    const main = [
      "record Point derives (Eq, Hash) = {x: Int, y: Int}",
      "",
      "export let r: Int = Hash.hash(Point({x = 1, y = 2}))",
      "",
    ].join("\n");
    const text = emitted([["/main.hex", "module Main\n\n" + main]], "/main.hex");
    expect(text).toContain("const __Hash_Point = { Eq: __Eq_Point,");
    // The same slot from the other direction. The derived-equality walks read a
    // component's equality off a `Hash` dictionary with no `Hash` declaration in
    // view, and used to append a literal; they ask this instead. The two
    // assertions together are the agreement: the dictionary above was written
    // from the *declaration*, and this is what the reader will spell.
    expect(preRegisteredBaseSlots("Hash").get("Eq")).toBe("Eq");
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
    expect(emitted([["/main.hex", "module Main\n\n" + main]], "/main.hex")).toContain(
      "const __Both_Wrap = { Weigh: __Weigh_Wrap, label: __Both_Wrap_label };",
    );
  });
});

describe("the pre-registered base table agrees with the prelude it stands in for", () => {
  /**
   * Every base list the prelude's own constraint declarations write, keyed by
   * the identity each of them takes, read out of the stdlib sources themselves.
   *
   * The compiler's own front end rather than a regex: `PRELUDE_MODULES` carries
   * embedded copies of `stdlib/*.hex` (a conformance test of its own pins them
   * against the originals), and each is lexed, laid out and parsed here exactly
   * as a compile would. A base list is `Parsed.ConstraintItem.baseConstraints`,
   * and a prelude declaration writes its bases as bare names in its own module's
   * scope — the currency `PRE_REGISTERED_BASE_CONSTRAINTS` is written in.
   *
   * Not read off a compiled project: `CompiledProject.modules` is an emission
   * set, so which prelude modules appear there depends on what the specimen
   * program happens to reach, and a row could go unguarded for that reason
   * alone. The sources are always all of them.
   */
  function preludeBaseConstraints(): ReadonlyMap<string, readonly string[]> {
    const declared = new Map<string, readonly string[]>();
    PRELUDE_MODULES.forEach(({ basename, source }, index) => {
      const file = new Source.File(Source.fileId(index), `/${basename}`, source);
      const module = parse(applyLayout(lex(file)));
      expect(module.diagnostics.map(({ message }) => message), basename).toEqual([]);
      for (const item of module.items) {
        if (item.kind !== "ConstraintDeclaration") continue;
        declared.set(
          preRegisteredConstraintIdentity(item.name.text),
          item.baseConstraints.map(({ text }) => text),
        );
      }
    });
    return declared;
  }

  test("each row is the base list of the declaration it fronts for", () => {
    // `PRE_REGISTERED_BASE_CONSTRAINTS` is the answer for readers that hold no
    // declaration — `preRegisteredBaseSlots`, which the emitter's wired-in
    // `Hash` walks ask, and the checker's base walk where a prelude constraint
    // has not been resolved from source. Only the `Hash` row had a guard, and it
    // was incidental: the suite's derived-`Hash` pins would part company with
    // the emitted dictionaries if that one drifted. The other five rows could be
    // edited to anything at all and nothing would notice, so they are measured
    // here against what the prelude actually declares.
    const declared = preludeBaseConstraints();
    for (const [identity, bases] of Object.entries(PRE_REGISTERED_BASE_CONSTRAINTS)) {
      expect(declared.get(identity), `${identity} is declared by the prelude`)
        .toBeDefined();
      expect(declared.get(identity), `${identity}'s base list`).toEqual(bases);
    }
  });

  test("and every prelude constraint that has bases has a row", () => {
    // The other direction, which is the one a *new* prelude constraint trips: a
    // declaration gaining a base with no row here leaves the declaration-free
    // readers answering "no bases", which is a wrong answer rather than a
    // missing one.
    const withBases = [...preludeBaseConstraints()]
      .filter(([, bases]) => bases.length > 0)
      .map(([identity]) => identity)
      .sort();
    expect(withBases).toEqual(Object.keys(PRE_REGISTERED_BASE_CONSTRAINTS).sort());
  });
});
