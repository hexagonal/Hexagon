/**
 * Conformance for **the constraint gates that used to read a spelling** (#727,
 * `spec/constraints.md` §5.1.1, §8; `spec/modules.md` §7.6).
 *
 * A constraint is its declaration, and every gate over the pre-registered
 * inventory is a question about a declaration. Several of them asked about a
 * word instead, on a premise the corpus had already refuted: that §5.1.1's ban
 * on redeclaring a pre-registered name makes the spelling decisive. The ban bars
 * a rival *declaration*, not a second *spelling* — and the prelude's modules are
 * ordinary modules injected at the source common root, so a project file can
 * reach one of their declarations under a word of its own.
 *
 * **One channel does that** — Modules §3.3's qualifier:
 *
 *     import M from "./Hash.hex"
 *     honor M.Hash<P> = ...
 *
 * `M.Hash` is a second spelling of `hex:Hash`, bound with no redeclaration
 * anywhere and no rename in sight: the module alias `M` is whatever this file
 * chose to write, and the constraint's own word is untouched. (An import
 * binding a bare `Eq` to itself once needed a rename — #762 retired that whole
 * route: an import binds a module and nothing smaller, so there is no second
 * *bare* spelling of a pre-registered name left to mint at all. The gates below
 * are keyed on the *identity*, which is what makes them robust to the qualifier
 * regardless of which word this file picks for the alias — so several specimens
 * below reuse a different alias letter per constraint (`H`, `E`, `S`, `C`, `I`,
 * `M`) rather than one, and pin that the canonical and qualified spellings of
 * one program are answered identically.
 *
 * What the qualifier cannot do is reach a `derives` entry: a `derives` entry is
 * a single bare `UpperName` by grammar (#726), so `derives (Eq, M.Hash)` is a
 * parse error by design. Nothing else supplies a *bare* second spelling of a
 * pre-registered name either — the compiler already seeds the canonical word
 * bare in every module — so "an aliased `derives` entry" has no program left to
 * write; that property is pinned only where the grammar refuses it, and the
 * derivability gate's other pins run on `Hash` reached bare, unaliased.
 *
 * Three defect classes, all measured on the code this file was written against:
 *
 * - **False refusals.** A call defaulting under `<a: S.Show>` reported
 *   ``\`S\` is not a defaultable constraint``; and every structural arm —
 *   tuples, records, vectors, `Set`, `Map`, the pinned `Bool`, `Concat` on a
 *   vector spine — declined under a qualifier and sent the requirement to the
 *   instance table to fail for want of an `S` instance no module can write.
 * - **A refusal bypass**, the severe one. `honor H.Hash<P>` compiled a
 *   hand-written `Hash` with *zero* diagnostics while `honor Hash<P>` was
 *   refused, so the hash-agrees-with-`Eq` law (Collections Part 2 §4.1/§4.3) had
 *   a spelling that walked around it.
 * - **A dropped repair.** The implied-type binder refusal keeps its fixit under
 *   a qualifier, where it used to print the reason alone.
 *
 * What does *not* change is what the reader sees: every message still names the
 * word the source wrote. Identity decides, spelling reports.
 *
 * The emission block is the arc's other half. A spelling is not a property of a
 * constraint at a module border (#714, #718), so the qualified program's emitted
 * dictionary must be the one the canonical spelling emits — same binding name,
 * same slots — and the pins below hold that against the program that differs
 * from it in the one written word.
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

function diagnostics(source: string): readonly string[] {
  return compileFiles([["/main.hex", source]]).diagnostics.map(({ message }) => message);
}

/** One module's emitted text, with the module required to compile clean. */
function emitted(source: string): string {
  const project = compileFiles([["/main.hex", source]]);
  expect(project.diagnostics.map(({ message }) => message)).toEqual([]);
  return project.modules.find(({ source: file }) => file.path === "/main.hex")!.javascript.text;
}

async function runs(label: string, source: string): Promise<Record<string, unknown>> {
  return await runProject([["/main.hex", source]], { transform: distinct(label) });
}

describe("a pre-registered constraint has a second-spelling channel", () => {
  test("an import binds the qualified form with no rename at all", () => {
    // Modules §3.3. The alias is this file's own word, the constraint's word
    // (`Show`) is untouched, and nothing declares anything — which is why
    // "nothing can occlude `Show`" was never the question the gates needed
    // answered.
    expect(
      diagnostics(
        'import M from "./Show.hex"\n' +
          "export fun render<a: M.Show>(value: a): String = show(value)\n" +
          'export let r: String = render("x")\n',
      ),
    ).toEqual([]);
  });

  test("a `derives` entry is a bare name by grammar, so the qualifier cannot reach it", () => {
    // #726's §2.3 sentence: a `derives` entry is a single bare `UpperName` and
    // no qualified form parses. Pinned rather than worked around — it is the
    // reason the derivability gate below is pinned only at the canonical,
    // unaliased spelling: nothing supplies a second *bare* word for a
    // pre-registered name, so there is no aliased `derives` entry to write.
    expect(
      diagnostics(
        'import M from "./Hash.hex"\nrecord P derives (Eq, M.Hash) = {x: Int}\n',
      ),
    ).toEqual([
      "expected `)` after `derives` constraints",
      "expected `=` after record name",
    ]);
  });
});

describe("the derivability gate reads the declaration", () => {
  // #762 retired the one route that could put a *bare* second spelling of a
  // pre-registered name in scope (a named import's own alias), and a `derives`
  // entry admits no qualified form (the grammar pin just above). So there is no
  // program left in which the derivability gate could be asked about `Hash`
  // under any spelling but its own — the aliased specimens this block used to
  // hold (`derives (Eq, H)` and its three-constraint sibling) have no seat
  // remaining and are removed rather than re-aimed. What is left is the control
  // the gate must still answer correctly: a constraint that really cannot be
  // derived, by its own unaliased word.
  test("a constraint that is genuinely underivable is still refused, by its own word", () => {
    expect(
      diagnostics(
        "constraint Weigh<a> =\n" +
          "    weigh(value: a): String\n" +
          "record P derives (Weigh) = {x: Int}\n",
      ),
    ).toEqual([
      "`Weigh` cannot be derived; only `Eq`, `Ord`, `Show`, and `Hash` have derivable forms",
    ]);
  });
});

describe("the hand-written `Hash` refusal reads the declaration", () => {
  // The severe finding: this program compiled with no diagnostic at all, so
  // Collections Part 2 §4.1's derivable-only law had a spelling that bypassed
  // it — and the instance it admitted was a hash under no obligation to agree
  // with the subject's equality.
  const BYPASS = 'import H from "./Hash.hex"\n' +
    "record P derives (Eq) = {x: Int}\n" +
    "honor H.Hash<P> =\n" +
    "    hash(value) = 7\n";

  const CANONICAL = "record P derives (Eq) = {x: Int}\n" +
    "honor Hash<P> =\n" +
    "    hash(value) = 7\n";

  test("the aliased hand-written instance is refused", () => {
    expect(diagnostics(BYPASS)).toEqual([
      "`Hash` instances must be derived; add `Hash` to `P`'s `derives` list",
    ]);
  });

  test("with the same sentence the canonical spelling takes", () => {
    // #647's five-row law and #644's offers-only-accepted-seats discipline are
    // one voice across the family, so the two spellings of one program are owed
    // one message. The advice names the **canonical** word because the seat it
    // sends the reader to is a `derives` list on a declaration, and `derives
    // Hash` is writable in every module while `derives H.Hash` does not even
    // parse there (the grammar pin above) — the same reason #644's use-site
    // fixit canonicalizes.
    expect(diagnostics(BYPASS)).toEqual(diagnostics(CANONICAL));
  });

  test("and the advice it offers is takeable, spelled canonically", async () => {
    const exports = await runs(
      "alias-hash-repair",
      'import H from "./Hash.hex"\n' +
        "record P derives (Eq, Hash) = {x: Int}\n" +
        "export let seen: Bool = " +
        "Set.contains(Set.fromVector([P({x = 1})]), P({x = 1}))\n",
    );
    expect(exports["seen"]).toBe(true);
  });

  // The same channel again, an unrelated alias word at the same seat: the
  // closure has to be keyed on the identity rather than on "the word here is
  // not `Hash`", and this and BYPASS above are the measurement of that —
  // two different alias spellings answering alike.
  const QUALIFIED_BYPASS = 'import M from "./Hash.hex"\n' +
    "record P derives (Eq) = {x: Int}\n" +
    "honor M.Hash<P> =\n" +
    "    hash(value) = 7\n";

  test("the qualified hand-written instance is refused too, under a second alias word", () => {
    expect(diagnostics(QUALIFIED_BYPASS)).toEqual([
      "`Hash` instances must be derived; add `Hash` to `P`'s `derives` list",
    ]);
  });

  test("with the same sentence again — one law, one channel, two alias words", () => {
    expect(diagnostics(QUALIFIED_BYPASS)).toEqual(diagnostics(CANONICAL));
    expect(diagnostics(QUALIFIED_BYPASS)).toEqual(diagnostics(BYPASS));
  });

  const QUALIFIED_DERIVE = 'import M from "./Hash.hex"\n' +
    "record P derives (Eq) = {x: Int}\n" +
    "honor M.Hash<P> = derive\n" +
    "export let seen: Bool = " +
    "Set.contains(Set.fromVector([P({x = 1})]), P({x = 1}))\n";

  test("and the qualified spelling of the *derived* form is accepted and runs", async () => {
    // The positive on the channel: §4.5's core `= derive` body reached through
    // the qualifier, which the `derives` header sugar cannot spell.
    expect(diagnostics(QUALIFIED_DERIVE)).toEqual([]);
    expect(emitted(QUALIFIED_DERIVE)).toContain("const __Hash_P = { Eq: __Eq_P, hash:");
    const exports = await runs("qualified-derive-hash", QUALIFIED_DERIVE);
    expect(exports["seen"]).toBe(true);
  });

  test("a derived `Hash` under an alias still requires derived equality", () => {
    // Latent while the gate above refused `derives (H.Hash)` (it does not even
    // parse), and live once the honor-block bypass is what is measured: the
    // pair is `hex:Hash` and `hex:Eq` however this module spells either of
    // them.
    expect(
      diagnostics(
        'import H from "./Hash.hex"\n' +
          "record P = {x: Int}\n" +
          "honor Eq<P> =\n" +
          "    equals(left, right) = left.x == right.x\n" +
          "honor H.Hash<P> = derive\n",
      ),
    ).toEqual([
      "cannot derive `Hash<P>`: the subject has a hand-written `Eq` instance; " +
        "a derived hash requires derived equality",
    ]);
  });
});

describe("defaulting reads the declaration", () => {
  const ALIASED = 'import S from "./Show.hex"\n' +
    "export fun render<a: S.Show>(value: a): String = show(value)\n" +
    "export let r: String = render(7)\n";

  test("a literal under a qualified binder defaults", () => {
    // Was: "the literal `7` cannot default to `Int`: `S` is not a defaultable
    // constraint; add a type annotation to pin the type". The gate minted
    // `hex:S` from the written word and compared it against the requirement's
    // `hex:Show`, which is a spelling test wearing an identity's clothes.
    expect(diagnostics(ALIASED)).toEqual([]);
  });

  test("and defaults to the same `Int` the canonical spelling does", async () => {
    const exports = await runs("alias-defaulting", ALIASED);
    expect(exports["r"]).toBe("7");
  });

  test("a user constraint honored at `Int` is still not defaultable", () => {
    // The belt of §4's closed set, unmoved: the gate now asks whether the
    // identity is the compiler's, which a declared `hex:`-less one is not.
    expect(
      diagnostics(
        "constraint Weigh<a> =\n" +
          "    weigh(value: a): String\n" +
          "honor Weigh<Int> =\n" +
          '    weigh(value) = "int"\n' +
          "export fun render<a: Weigh>(value: a): String = weigh(value)\n" +
          "export let r: String = render(7)\n",
      ),
    ).toEqual([
      "the literal `7` cannot default to `Int`: `Weigh` is not a defaultable " +
        "constraint; add a type annotation to pin the type",
    ]);
  });
});

describe("structural satisfaction reads the declaration", () => {
  const RENDER = 'import S from "./Show.hex"\n' +
    "export fun render<a: S.Show>(value: a): String = show(value)\n";

  // Each row is a separate arm of the requirement walk, and each one declined
  // under a qualifier and reported `type \`…\` has no \`S\` instance`.
  const ROWS: readonly (readonly [string, string, string])[] = [
    ["a tuple", "export let r: String = render((1, 2))\n", "(1, 2)"],
    ["a structural record", "export let r: String = render({n = 1})\n", "{n = 1}"],
    ["a vector", "export let r: String = render([1, 2])\n", "[1, 2]"],
    [
      "a set",
      "let xs: Set(Int) = Set.fromVector([1])\nexport let r: String = render(xs)\n",
      "Set.fromVector([1])",
    ],
    [
      "a map",
      "let m: Map(Int, Int) = Map.fromVector([(1, 2)])\nexport let r: String = render(m)\n",
      "Map.fromVector([(1, 2)])",
    ],
    // The pinned `Bool` takes its own arm (#147), and it is the one that
    // reported the closed-pair clause rather than the bare head: the message
    // offered `Bool`'s prelude home as the place to write an `S` instance.
    ["the pinned `Bool`", "export let r: String = render(True)\n", "True"],
  ];

  for (const [what, use, answer] of ROWS) {
    test(`${what} satisfies a qualified constraint`, () => {
      expect(diagnostics(RENDER + use)).toEqual([]);
    });

    test(`${what} answers with the structural instance at run time`, async () => {
      const exports = await runs(`alias-structural-${answer}`, RENDER + use);
      expect(exports["r"]).toBe(answer);
    });
  }

  // The tuple row above already exercises this exact channel (a module alias
  // dotted through to the constraint it declares); a second alias word over
  // the same arm would measure nothing the rows do not already show.

  const JOIN = 'import C from "./Concat.hex"\n' +
    "export fun join<a: C.Concat>(x: a, y: a): a = x ++ y\n" +
    "export let r: String = show(join([1], [2]))\n";

  test("a vector spine satisfies a qualified `Concat`", () => {
    expect(diagnostics(JOIN)).toEqual([]);
  });

  test("and the concatenation runs", async () => {
    const exports = await runs("alias-concat-vector", JOIN);
    expect(exports["r"]).toBe("[1, 2]");
  });
});

describe("a container walk demands of its contents what the identity says", () => {
  /**
   * The rows above satisfy the container arms at `Int` elements, which honor all
   * of `Eq`, `Ord`, `Show` and `Hash` — so they prove the arm *fires* and prove
   * nothing about **which** constraint it then demands of the contents. That
   * second question has its own read of the spelling (`Show` walks keys and
   * values, `Hash` and `Eq` walk them differently), and getting it wrong is not a
   * refusal: it is a dictionary whose element evidence answers the wrong
   * constraint, which type-checks clean and throws at the first slot read.
   *
   * Each specimen below is an element type that honors one side of the pick and
   * not the other, so the wrong pick is *accepted* where the right one refuses.
   * Under the name-keyed read, `render(xs)` at a `Set(P)` demanded `Hash` of `P`
   * instead of `Show`, emitted `{ show: … __Hash_P … }`, and threw
   * `TypeError: __Hash_P.show is not a function`.
   */
  const SHOWLESS = "record P derives (Eq, Hash) = {x: Int}\n";
  const RENDER = 'import S from "./Show.hex"\n' +
    "export fun render<a: S.Show>(value: a): String = show(value)\n";

  test("a `Set`'s element is asked for `Show` when `Show` is what was demanded", () => {
    expect(
      diagnostics(
        RENDER + SHOWLESS +
          "let xs: Set(P) = Set.fromVector([P({x = 1})])\n" +
          "export let r: String = render(xs)\n",
      ),
    ).toEqual([
      "type `P` has no `Show` instance; it could only be declared in `./main.hex` " +
        "(declares `P`) or the module declaring `Show`; add `Show` to the `derives` list of `P`",
    ]);
  });

  test("and a `Map`'s key and value are both asked, not hashed", () => {
    // Two reports, one per component: the `Show` arm walks the pair, while the
    // pick the mutation takes walks a `Hash` key and an `Eq` value — both of
    // which `P` honors, so the whole program was accepted.
    const reports = diagnostics(
      RENDER + SHOWLESS +
        "let m: Map(P, P) = Map.fromVector([(P({x = 1}), P({x = 2}))])\n" +
        "export let r: String = render(m)\n",
    );
    expect(reports).toHaveLength(2);
    expect(new Set(reports)).toEqual(
      new Set([
        "type `P` has no `Show` instance; it could only be declared in `./main.hex` " +
          "(declares `P`) or the module declaring `Show`; add `Show` to the `derives` list of `P`",
      ]),
    );
  });

  test("and a `Map` demanded for `Hash` asks its value for `Hash`, not `Eq`", () => {
    // The mirror, and the one that discriminates the *other* branch of the same
    // ternary: a value honoring `Eq` and not `Hash` is accepted by the `Eq` pick
    // and refused by the right one.
    expect(
      diagnostics(
        'import H from "./Hash.hex"\n' +
          "record K derives (Eq, Hash) = {k: Int}\n" +
          "record V derives (Eq) = {v: Int}\n" +
          "export fun keyed<a: H.Hash>(value: a): Int = 0\n" +
          "let m: Map(K, V) = Map.fromVector([(K({k = 1}), V({v = 2}))])\n" +
          "export let r: Int = keyed(m)\n",
      ),
    ).toEqual([
      "type `V` has no `Hash` instance; `Hash` instances must be derived, so the " +
        "only repair is adding `Hash` to `V`'s `derives` list in `./main.hex`",
    ]);
  });
});

describe("a hand-written instance of a qualified constraint stays legal", () => {
  const SHOW = 'import S from "./Show.hex"\n' +
    "record P = {x: Int}\n" +
    "honor S.Show<P> =\n" +
    '    show(value) = "p!"\n' +
    "export let r: String = show(P({x = 1}))\n";

  test("it compiles", () => {
    expect(diagnostics(SHOW)).toEqual([]);
  });

  test("its dictionary carries the declaration's own name", () => {
    expect(emitted(SHOW)).toContain("const __Show_P = ");
    expect(emitted(SHOW)).not.toContain("__S_P");
  });

  test("and the member it binds is the one the call reaches", async () => {
    const exports = await runs("alias-show-honor", SHOW);
    expect(exports["r"]).toBe("p!");
  });

  const EQ = 'import E from "./Eq.hex"\n' +
    "record P = {x: Int}\n" +
    "honor E.Eq<P> =\n" +
    "    equals(left, right) = left.x == right.x\n" +
    "export let differs: Bool = P({x = 1}) != P({x = 2})\n";

  test("an omitted `notEquals` is still completed under a qualifier", async () => {
    expect(diagnostics(EQ)).toEqual([]);
    const exports = await runs("alias-eq-honor", EQ);
    expect(exports["differs"]).toBe(true);
  });
});

describe("the implied-type binder refusal keeps its repair under a qualifier", () => {
  test("`Iterable` reached by a qualifier still says what to write instead", () => {
    // The reason and the repair parted company here: the message naming the
    // written word dropped the `Seq` clause while the loop-head report beside
    // it — where the compiler spells the constraint itself — still printed it.
    expect(
      diagnostics(
        'import I from "./Iterable.hex"\n' +
          "export fun count<c: I.Iterable>(xs: c): Int = 0\n",
      ),
    ).toEqual([
      "`I.Iterable` declares an implied type and cannot constrain a type variable in v1; " +
        "take a `Seq(a)` parameter instead",
    ]);
  });

  test("and a user constraint with an implied type takes the reason alone", () => {
    expect(
      diagnostics(
        "constraint Holds<c> =\n" +
          "    type Item\n" +
          "    first(source: c): Item\n" +
          "export fun peek<c: Holds>(source: c): Int = 0\n",
      ),
    ).toEqual([
      "`Holds` declares an implied type and cannot constrain a type variable in v1",
    ]);
  });
});
