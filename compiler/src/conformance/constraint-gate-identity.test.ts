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
 * **Two channels do that, not one**, and both were live defect routes:
 *
 *     import { Hash as H } from "./Hash.hex"      // the named-import alias
 *     import module M from "./Hash.hex"           // Modules §3.3's qualifier
 *
 * `H` and `M.Hash` are each a second spelling of `hex:Hash`, bound with no
 * redeclaration anywhere. The qualified channel is not a variation on the first:
 * it needs no alias at all, and `honor M.Hash<P>` compiled a hand-written `Hash`
 * with zero diagnostics on its own. What the gates below are keyed on is the
 * *identity*, which is what makes them robust to the channel rather than robust
 * to one of them — so the specimens exercise both, and pin that the canonical,
 * aliased and qualified spellings of one program are answered identically.
 *
 * What an import cannot do is bind a pre-registered name to **itself**
 * (`constraint \`Eq\` is already declared or imported`), which is why every
 * second spelling is a renaming one. The two channels differ in reach: a
 * `derives` entry is a single bare `UpperName` by grammar (#726), so the alias
 * reaches that seat and the qualifier does not — `derives (Eq, M.Hash)` is a
 * parse error by design, and the specimen below pins that rather than working
 * around it.
 *
 * Three defect classes, all measured on the code this file was written against:
 *
 * - **False refusals.** `derives (Eq, H)` was refused as underivable while the
 *   identical program spelled `Hash` compiled; a call defaulting under `<a: S>`
 *   reported ``\`S\` is not a defaultable constraint``; and every structural arm
 *   — tuples, records, vectors, `Set`, `Map`, the pinned `Bool`, `Concat` on a
 *   vector spine — declined under an alias and sent the requirement to the
 *   instance table to fail for want of an `S` instance no module can write.
 * - **A refusal bypass**, the severe one, and reachable through *either* channel
 *   independently. `honor H<P>` and `honor M.Hash<P>` each compiled a
 *   hand-written `Hash` with *zero* diagnostics while `honor Hash<P>` was
 *   refused, so the hash-agrees-with-`Eq` law (Collections Part 2 §4.1/§4.3) had
 *   two spellings that walked around it.
 * - **A dropped repair.** The implied-type binder refusal keeps its fixit under
 *   an alias, where it used to print the reason alone.
 *
 * What does *not* change is what the reader sees: every message still names the
 * word the source wrote. Identity decides, spelling reports.
 *
 * The emission block is the arc's other half. A spelling is not a property of a
 * constraint at a module border (#714, #718), so the aliased program's emitted
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

describe("a pre-registered constraint has two second-spelling channels", () => {
  test("a named import may not bind one under its own name, so it renames", () => {
    expect(
      diagnostics('import { Eq } from "./Eq.hex"\nrecord P derives (Eq) = {x: Int}\n'),
    ).toEqual(["constraint `Eq` is already declared or imported"]);
  });

  test("but `import module` binds the qualified form with no alias at all", () => {
    // Modules §3.3. No renaming, no `as`, and the word `Hash` is untouched —
    // which is why "nothing can occlude `Hash`" was never the question the
    // gates needed answered.
    expect(
      diagnostics(
        'import module M from "./Show.hex"\n' +
          "export fun render<a: M.Show>(value: a): String = show(value)\n" +
          'export let r: String = render("x")\n',
      ),
    ).toEqual([]);
  });

  test("a `derives` entry is a bare name by grammar, so only the alias reaches it", () => {
    // #726's §2.3 sentence: a `derives` entry is a single bare `UpperName` and
    // no qualified form parses. Pinned rather than worked around — it is the one
    // asymmetry between the two channels, and it is a grammar fact, not a gate.
    expect(
      diagnostics(
        'import module M from "./Hash.hex"\nrecord P derives (Eq, M.Hash) = {x: Int}\n',
      ),
    ).toEqual([
      "expected `)` after `derives` constraints",
      "expected `=` after record name",
    ]);
  });
});

describe("the derivability gate reads the declaration", () => {
  const ALIASED = 'import { Hash as H } from "./Hash.hex"\n' +
    "record P derives (Eq, H) = {x: Int}\n" +
    "export let seen: Bool = " +
    "Set.contains(Set.fromVector([P({x = 1}), P({x = 1})]), P({x = 1}))\n";

  const CANONICAL = "record P derives (Eq, Hash) = {x: Int}\n" +
    "export let seen: Bool = " +
    "Set.contains(Set.fromVector([P({x = 1}), P({x = 1})]), P({x = 1}))\n";

  test("an aliased derives entry is accepted", () => {
    // Was: "`H` cannot be derived; only `Eq`, `Ord`, `Show`, and `Hash` have
    // derivable forms" — of the constraint that *is* `Hash`.
    expect(diagnostics(ALIASED)).toEqual([]);
  });

  test("and the derived hash it emits is the canonical one, byte for byte", () => {
    // #718's law reaching the newly-legal program: the dictionary is `__Hash_P`
    // and its base slot is `Eq`, both minted from the declaration's own name.
    // The resolver used to mint the binding from the *written* word and emitted
    // `__H_P`, an alias leaking into the output of a module nothing imports.
    expect(emitted(ALIASED)).toContain("const __Hash_P = { Eq: __Eq_P, hash: __Hash_P_hash };");
    expect(emitted(ALIASED)).not.toContain("__H_P");
    expect(emitted(ALIASED)).toBe(emitted(CANONICAL));
  });

  test("and the program runs, the derived hash agreeing with derived equality", async () => {
    const exports = await runs("alias-derives-hash", ALIASED);
    expect(exports["seen"]).toBe(true);
  });

  const ALIASED_THREE = 'import { Eq as E } from "./Eq.hex"\n' +
    'import { Ord as O } from "./Ord.hex"\n' +
    'import { Show as S } from "./Show.hex"\n' +
    "record P derives (E, O, S) = {x: Int}\n" +
    'export let r: String = "${show(P({x = 1}))}"\n';

  test("the other three derive under an alias too, and emit their own names", () => {
    expect(diagnostics(ALIASED_THREE)).toEqual([]);
    const text = emitted(ALIASED_THREE);
    for (const dictionary of ["__Eq_P", "__Ord_P", "__Show_P"]) {
      expect(text).toContain(`const ${dictionary} = `);
    }
    expect(text).not.toMatch(/__[EOS]_P\b/u);
  });

  test("and that program runs", async () => {
    const exports = await runs("alias-derives-three", ALIASED_THREE);
    expect(exports["r"]).toBe("{x = 1}");
  });

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
  const BYPASS = 'import { Hash as H } from "./Hash.hex"\n' +
    "record P derives (Eq) = {x: Int}\n" +
    "honor H<P> =\n" +
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
    // Hash` is writable in every module while `derives H` is writable only in
    // one that happens to hold this import — the same reason #644's use-site
    // fixit canonicalizes.
    expect(diagnostics(BYPASS)).toEqual(diagnostics(CANONICAL));
  });

  test("and the advice it offers is takeable, spelled canonically", async () => {
    const exports = await runs(
      "alias-hash-repair",
      'import { Hash as H } from "./Hash.hex"\n' +
        "record P derives (Eq, Hash) = {x: Int}\n" +
        "export let seen: Bool = " +
        "Set.contains(Set.fromVector([P({x = 1})]), P({x = 1}))\n",
    );
    expect(exports["seen"]).toBe(true);
  });

  // The second channel, at the same seat. `import module M` renames nothing and
  // binds no alias, so this program was the bypass reached without ever writing
  // `as` — and it is why the closure has to be keyed on the identity rather than
  // on "the word here is not `Hash`".
  const QUALIFIED_BYPASS = 'import module M from "./Hash.hex"\n' +
    "record P derives (Eq) = {x: Int}\n" +
    "honor M.Hash<P> =\n" +
    "    hash(value) = 7\n";

  test("the qualified hand-written instance is refused too", () => {
    expect(diagnostics(QUALIFIED_BYPASS)).toEqual([
      "`Hash` instances must be derived; add `Hash` to `P`'s `derives` list",
    ]);
  });

  test("with the same sentence again — one law, three spellings", () => {
    expect(diagnostics(QUALIFIED_BYPASS)).toEqual(diagnostics(CANONICAL));
    expect(diagnostics(QUALIFIED_BYPASS)).toEqual(diagnostics(BYPASS));
  });

  const QUALIFIED_DERIVE = 'import module M from "./Hash.hex"\n' +
    "record P derives (Eq) = {x: Int}\n" +
    "honor M.Hash<P> = derive\n" +
    "export let seen: Bool = " +
    "Set.contains(Set.fromVector([P({x = 1})]), P({x = 1}))\n";

  test("and the qualified spelling of the *derived* form is accepted and runs", async () => {
    // The positive on the second channel: §4.5's core `= derive` body reached
    // through the qualifier, which the `derives` header sugar cannot spell.
    expect(diagnostics(QUALIFIED_DERIVE)).toEqual([]);
    expect(emitted(QUALIFIED_DERIVE)).toContain("const __Hash_P = { Eq: __Eq_P, hash:");
    const exports = await runs("qualified-derive-hash", QUALIFIED_DERIVE);
    expect(exports["seen"]).toBe(true);
  });

  test("a derived `Hash` under an alias still requires derived equality", () => {
    // Latent while the gate above refused `derives (H)` first, and live the
    // moment it stopped: the pair is `hex:Hash` and `hex:Eq` however this module
    // spells either of them.
    expect(
      diagnostics(
        'import { Hash as H } from "./Hash.hex"\n' +
          "record P = {x: Int}\n" +
          "honor Eq<P> =\n" +
          "    equals(left, right) = left.x == right.x\n" +
          "honor H<P> = derive\n",
      ),
    ).toEqual([
      "cannot derive `Hash<P>`: the subject has a hand-written `Eq` instance; " +
        "a derived hash requires derived equality",
    ]);
  });
});

describe("defaulting reads the declaration", () => {
  const ALIASED = 'import { Show as S } from "./Show.hex"\n' +
    "export fun render<a: S>(value: a): String = show(value)\n" +
    "export let r: String = render(7)\n";

  test("a literal under an aliased binder defaults", () => {
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
  const RENDER = 'import { Show as S } from "./Show.hex"\n' +
    "export fun render<a: S>(value: a): String = show(value)\n";

  // Each row is a separate arm of the requirement walk, and each one declined
  // under an alias and reported `type \`…\` has no \`S\` instance`.
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
    test(`${what} satisfies an aliased constraint`, () => {
      expect(diagnostics(RENDER + use)).toEqual([]);
    });

    test(`${what} answers with the structural instance at run time`, async () => {
      const exports = await runs(`alias-structural-${answer}`, RENDER + use);
      expect(exports["r"]).toBe(answer);
    });
  }

  const QUALIFIED_TUPLE = 'import module M from "./Show.hex"\n' +
    "export fun render<a: M.Show>(value: a): String = show(value)\n" +
    "export let r: String = render((1, 2))\n";

  test("the qualified channel reaches the structural arms as well", () => {
    expect(diagnostics(QUALIFIED_TUPLE)).toEqual([]);
  });

  test("and answers with the same structural instance", async () => {
    const exports = await runs("qualified-structural-tuple", QUALIFIED_TUPLE);
    expect(exports["r"]).toBe("(1, 2)");
  });

  const JOIN = 'import { Concat as C } from "./Concat.hex"\n' +
    "export fun join<a: C>(x: a, y: a): a = x ++ y\n" +
    "export let r: String = show(join([1], [2]))\n";

  test("a vector spine satisfies an aliased `Concat`", () => {
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
  const RENDER = 'import { Show as S } from "./Show.hex"\n' +
    "export fun render<a: S>(value: a): String = show(value)\n";

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
        'import { Hash as H } from "./Hash.hex"\n' +
          "record K derives (Eq, Hash) = {k: Int}\n" +
          "record V derives (Eq) = {v: Int}\n" +
          "export fun keyed<a: H>(value: a): Int = 0\n" +
          "let m: Map(K, V) = Map.fromVector([(K({k = 1}), V({v = 2}))])\n" +
          "export let r: Int = keyed(m)\n",
      ),
    ).toEqual([
      "type `V` has no `Hash` instance; `Hash` instances must be derived, so the " +
        "only repair is adding `Hash` to `V`'s `derives` list in `./main.hex`",
    ]);
  });
});

describe("a hand-written instance of an aliased constraint stays legal", () => {
  const SHOW = 'import { Show as S } from "./Show.hex"\n' +
    "record P = {x: Int}\n" +
    "honor S<P> =\n" +
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

  const EQ = 'import { Eq as E } from "./Eq.hex"\n' +
    "record P = {x: Int}\n" +
    "honor E<P> =\n" +
    "    equals(left, right) = left.x == right.x\n" +
    "export let differs: Bool = P({x = 1}) != P({x = 2})\n";

  test("an omitted `notEquals` is still completed under an alias", async () => {
    expect(diagnostics(EQ)).toEqual([]);
    const exports = await runs("alias-eq-honor", EQ);
    expect(exports["differs"]).toBe(true);
  });
});

describe("the implied-type binder refusal keeps its repair under an alias", () => {
  test("`Iterable` reached by an alias still says what to write instead", () => {
    // The reason and the repair parted company here: the message naming the
    // written word dropped the `Seq` clause while the loop-head report beside
    // it — where the compiler spells the constraint itself — still printed it.
    expect(
      diagnostics(
        'import { Iterable as I } from "./Iterable.hex"\n' +
          "export fun count<c: I>(xs: c): Int = 0\n",
      ),
    ).toEqual([
      "`I` declares an implied type and cannot constrain a type variable in v1; " +
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
