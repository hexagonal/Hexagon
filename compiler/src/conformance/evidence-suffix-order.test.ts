/**
 * Conformance for the call site's evidence **order** (#447, and #350 — the same
 * defect found twice, from two directions): a callee's trailing evidence suffix
 * is ordered by *(type-variable ordinal, constraint name)* — FFI Part 9 §6.2,
 * restated for the internal convention at Constraints §6.1 — and a call must
 * supply its arguments under that same key.
 *
 * A **sibling** of `evidence-slot-arity.test.ts` rather than an extension of it,
 * because that file pins a different claim and its own "what must not change"
 * section fences this axis off by name: #443 made the *grouping* per ABI slot
 * and deliberately left the order within and across slots alone. Arity defects
 * are caught by a length guard (`#specializedCallee`'s, for one); ordering
 * defects are at correct arity and no guard sees them, so the two need different
 * failure stories and different pins. The `POINT`-style non-fundamental record
 * and the `distinct` transform are borrowed from that file for the same reasons
 * it gives: an edition would route around a call at a fundamental type, and
 * emitted modules mount as `data:` URLs that the registry caches by text, so
 * **every executed graph here is made byte-distinct**.
 *
 * The two divergences this pins dead, both silent miscompiles at `5089b72`:
 *
 * 1. *Within one variable.* The call site published conjuncts in the order the
 *    head spelled them; the ABI wants them alphabetical. `<a: (Show, Num)>` got
 *    the `Show` dictionary in the `Num` slot and died at `.add`. The canonical
 *    #410 spelling is already alphabetical, which is why the corpus never saw it.
 * 2. *Across variables.* The call site published variables in the order they
 *    occur in the *type*; the ABI wants declared-head order. `<b: Show, a:
 *    Show>(x: a, y: b)` swapped two dictionaries of identical shape — no crash,
 *    a **wrong answer**.
 *
 * Axis 2 has a second half that only shows up once a scheme is *copied*: an
 * ordinal is carried by the variable's id, and both places that renumber a
 * scheme's variables — `#instantiate`'s freshening and `#importScheme`'s — used
 * to mint in `scheme.variables` array order, which is generalization's
 * type-occurrence order. So a cross-module call, and an alias whose consumers key
 * on the alias's own ids, were misordered even with the sort in place. Read the
 * parameter *positions*, never the letters: `__Show_a` and `__Show_b` are the
 * canonical display letters of Functions §5.1, not the source binder names, and
 * §6.2 is explicit that alpha-renaming cannot move the ABI.
 *
 * The last `describe` block guards the interaction with Part 8, which reads the
 * same scheme under a *third* convention and must keep reading it that way; see
 * its own comment for why those shapes pass on the broken build and are pinned
 * anyway.
 */

import { describe, expect, test } from "vitest";

import { compileFiles, runProject } from "../support/test-project.js";
import * as Typed from "../syntax/typed/index.js";

/** Makes a graph's modules byte-distinct, so the test gets its own instances. */
function distinct(label: string): (path: string, javascript: string) => string {
  return (_path, javascript) => `// ${label}\n${javascript}`;
}

function emitted(
  files: readonly (readonly [string, string])[],
  path = "/main.hex",
): string {
  const project = compileFiles(files);
  expect(project.diagnostics.map(({ message }) => message)).toEqual([]);
  const module = project.modules.find(({ source }) => source.path === path);
  if (module === undefined) {
    throw new Error(
      `no emitted module at ${path}; emitted: ${
        project.modules.map(({ source }) => source.path).join(", ")
      }`,
    );
  }
  return module.javascript.text;
}

/** #447's own program: conjuncts spelled against the alphabet. */
const TWICE = "let twice<a: (Show, Num)>(x: a): String = show(x + x)\n";

/** Axis 2's minimal shape: the head's binder order is not the type's. */
const MIX = "let mix<b: Show, a: Show>(x: a, y: b): String = show(x) ++ show(y)\n";

/** The same function alpha-renamed into the canonical head order. */
const MIX_CANONICAL =
  "let mix<a: Show, b: Show>(x: a, y: b): String = show(x) ++ show(y)\n";

/**
 * A type outside Part 8's fundamental set with two constraints honored on it, so
 * no edition can route a call away from the generic path — and #350's second
 * "wanted" bullet, a two-constraint bound whose members are *both* called, has a
 * nominal subject to be called at. `Describe` sorts before `Show`, so the head
 * `<a: (Show, Describe)>` below is spelled against the ABI on purpose.
 */
const DESCRIBE =
  "export constraint Describe<a> =\n" +
  "    tag(value: a): String\n" +
  "\n" +
  "export record Point = {x: Int}\n" +
  "\n" +
  "honor Show<Point> =\n" +
  "    show(value) = \"P\"\n" +
  "\n" +
  "honor Describe<Point> =\n" +
  "    tag(value) = \"pt\"\n" +
  "\n" +
  "honor Describe<Int> =\n" +
  "    tag(value) = \"int\"\n";

const BOTH_MEMBERS =
  "let both<a: (Show, Describe)>(x: a): String = show(x) ++ tag(x)\n";

describe("conjuncts on one variable follow the alphabet, not the spelling", () => {
  test("#447's own program runs", async () => {
    const exports = await runProject(
      [["/main.hex", TWICE + "export let answer: String = twice(2)\n"]],
      { transform: distinct("evidence suffix order: the issue's twice") },
    );

    expect(exports["answer"]).toBe("4");
  });

  /**
   * The text is the claim: the parameter list is alphabetical within the one
   * variable, and the argument list has to be read in the same direction. Before
   * the fix this emitted `twice(2, __Show_Int, __Num_Int)` against exactly this
   * parameter list, and threw `__Num_a.add is not a function`.
   */
  test("#447's own program emits the suffix alphabetically at both ends", () => {
    const javascript = emitted([[
      "/main.hex",
      TWICE + "export let answer: String = twice(2)\n",
    ]]);

    expect(javascript).toContain(
      "const twice = (x, __Num_a, __Show_a) => show(__Num_a.add(x, x), __Show_a);",
    );
    expect(javascript).toContain("const answer = twice(2, __Num_Int, __Show_Int);");
  });

  /**
   * #350's own program, which reached the same defect through *interpolation*
   * and *dot calls* rather than bare calls. Re-checked at `5089b72` after #444's
   * member-call routing: it still reproduced, throwing `__Show_a.show is not a
   * function` — the swapped seat read from the other end.
   */
  test("#350's own program runs, at Int", async () => {
    const exports = await runProject(
      [[
        "/main.hex",
        "let describe<a: (Show, Integral)>(left: a, right: a): String =\n" +
          '    "${left.show()} gcd ${left.gcd(right)}"\n' +
          "export let answer: String = describe(12, 18)\n",
      ]],
      { transform: distinct("evidence suffix order: #350 at Int") },
    );

    expect(exports["answer"]).toBe("12 gcd 6");
  });

  /** #350 was filed from `BigInt`; it is the same suffix at a second subject. */
  test("#350's own program runs, at BigInt", async () => {
    const exports = await runProject(
      [[
        "/main.hex",
        "let describe<a: (Show, Integral)>(left: a, right: a): String =\n" +
          '    "${left.show()} gcd ${left.gcd(right)}"\n' +
          "export let answer: String = describe(12n, 18n)\n",
      ]],
      { transform: distinct("evidence suffix order: #350 at BigInt") },
    );

    expect(exports["answer"]).toBe("12 gcd 6");
  });

  test("three conjuncts on one variable are all three sorted", () => {
    const javascript = emitted([[
      "/main.hex",
      "let tri<a: (Show, Ord, Num)>(x: a): String =\n" +
        "    if x < x + x then show(x) else show(x + x)\n" +
        "export let answer: String = tri(2)\n",
    ]]);

    expect(javascript).toContain("const tri = (x, __Num_a, __Ord_a, __Show_a) =>");
    expect(javascript).toContain(
      "const answer = tri(2, __Num_Int, __Ord_Int, __Show_Int);",
    );
  });

  test("three conjuncts run", async () => {
    const exports = await runProject(
      [[
        "/main.hex",
        "let tri<a: (Show, Ord, Num)>(x: a): String =\n" +
          "    if x < x + x then show(x) else show(x + x)\n" +
          "export let answer: String = tri(2)\n",
      ]],
      { transform: distinct("evidence suffix order: three conjuncts") },
    );

    expect(exports["answer"]).toBe("2");
  });
});

describe("variables follow the declared ordinal, not the type's occurrence order", () => {
  /**
   * The wrong-answer half, and the reason this axis needs *executed* pins: both
   * dictionaries have the same shape, so swapping them crashes nothing. Before
   * the fix this answered `"Truetrue"`.
   */
  test("a head spelled against its type's occurrence order runs", async () => {
    const exports = await runProject(
      [["/main.hex", MIX + "export let out: String = mix(2, True)\n"]],
      { transform: distinct("evidence suffix order: mix declared b then a") },
    );

    expect(exports["out"]).toBe("2True");
  });

  /** The control: the same function with the head in the canonical order. */
  test("the canonically spelled head runs, and always did", async () => {
    const exports = await runProject(
      [["/main.hex", MIX_CANONICAL + "export let out: String = mix(2, True)\n"]],
      { transform: distinct("evidence suffix order: mix declared a then b") },
    );

    expect(exports["out"]).toBe("2True");
  });

  /**
   * Positions, not letters. The callee is conforming in both spellings — its
   * first evidence parameter answers the *first declared* binder — so the two
   * calls differ, and must differ, in which dictionary they put first.
   */
  test("the two spellings emit mirrored argument lists against mirrored parameters", () => {
    const declared = emitted([[
      "/main.hex",
      MIX + "export let out: String = mix(2, True)\n",
    ]]);
    const canonical = emitted([[
      "/main.hex",
      MIX_CANONICAL + "export let out: String = mix(2, True)\n",
    ]]);

    expect(declared).toContain("const mix = (x, y, __Show_b, __Show_a) =>");
    expect(declared).toContain("const out = mix(2, true, __Show_Bool, __Show_Int);");
    expect(canonical).toContain("const mix = (x, y, __Show_a, __Show_b) =>");
    expect(canonical).toContain("const out = mix(2, true, __Show_Int, __Show_Bool);");
  });

  /**
   * Both axes at once: two variables spelled out of ordinal order, each carrying
   * two conjuncts spelled out of alphabetical order. `2` lands on `a` and `3.5`
   * on `b`, so `b`'s pair — declared first — leads with `Float`.
   */
  test("both axes composed run", async () => {
    const exports = await runProject(
      [[
        "/main.hex",
        "let both<b: (Show, Num), a: (Show, Num)>(x: a, y: b): String =\n" +
          "    show(x + x) ++ show(y + y)\n" +
          "export let out: String = both(2, 3.5)\n",
      ]],
      { transform: distinct("evidence suffix order: both axes") },
    );

    expect(exports["out"]).toBe("47");
  });

  test("both axes composed emit one interleaved suffix", () => {
    const javascript = emitted([[
      "/main.hex",
      "let both<b: (Show, Num), a: (Show, Num)>(x: a, y: b): String =\n" +
        "    show(x + x) ++ show(y + y)\n" +
        "export let out: String = both(2, 3.5)\n",
    ]]);

    expect(javascript).toContain(
      "const both = (x, y, __Num_b, __Show_b, __Num_a, __Show_a) =>",
    );
    expect(javascript).toContain(
      "const out = both(2, 3.5, __Num_Float, __Show_Float, __Num_Int, __Show_Int);",
    );
  });
});

describe("the display is canonical and does not track the suffix across variables", () => {
  /**
   * Functions §5.1, and the counterpart to everything above: the display's
   * letters follow the *type*, while the suffix's ordinal is a **declared**
   * position, so the two faces answer different questions and part company the
   * moment a head is spelled in an order the type does not share. Three
   * spellings, one display, two suffixes — which is why §5.1 no longer says a
   * display previews the order the dictionaries arrive in, and why nothing may
   * read an ABI off a hover.
   */
  function displayed(source: string): string {
    const project = compileFiles([["/main.hex", source]]);
    expect(project.diagnostics.map(({ message }) => message)).toEqual([]);
    const typed = project.modules.find(({ source: file }) => file.path === "/main.hex")!.typed;
    const symbol = typed.symbols.find(
      (candidate) => candidate.name === "f" && candidate.kind !== "parameter",
    );
    if (symbol === undefined) throw new Error("no symbol `f`");
    return Typed.displayScheme(symbol.scheme);
  }

  const TAIL = "export let out: String = f(2, True)\n";
  const CANONICAL = "let f<a: Show, b: Show>(x: a, y: b): String = show(x) ++ show(y)\n";
  /** The head's order is not the type's. */
  const HEAD_SWAPPED = "let f<b: Show, a: Show>(x: a, y: b): String = show(x) ++ show(y)\n";
  /** Neither is it here, reached from the other side — the head is alphabetical. */
  const TYPE_SWAPPED = "let f<a: Show, b: Show>(x: b, y: a): String = show(x) ++ show(y)\n";

  test("all three spellings display one canonical bracket", () => {
    const canonical = "<a: Show, b: Show> (a, b) -> String";

    expect(displayed(CANONICAL + TAIL)).toBe(canonical);
    expect(displayed(HEAD_SWAPPED + TAIL)).toBe(canonical);
    expect(displayed(TYPE_SWAPPED + TAIL)).toBe(canonical);
  });

  test("they do not all emit one suffix", () => {
    expect(emitted([["/main.hex", CANONICAL + TAIL]]))
      .toContain("const f = (x, y, __Show_a, __Show_b) =>");
    expect(emitted([["/main.hex", HEAD_SWAPPED + TAIL]]))
      .toContain("const f = (x, y, __Show_b, __Show_a) =>");
    expect(emitted([["/main.hex", TYPE_SWAPPED + TAIL]]))
      .toContain("const f = (x, y, __Show_b, __Show_a) =>");
  });

  /** Both faces speak the same canonical letters, and still disagree. */
  test("each spelling answers, whichever face one reads", async () => {
    for (const [label, source] of [
      ["canonical", CANONICAL],
      ["head swapped", HEAD_SWAPPED],
    ] as const) {
      const exports = await runProject(
        [["/main.hex", source + TAIL]],
        { transform: distinct(`display vs suffix: ${label}`) },
      );

      expect(exports["out"]).toBe("2True");
    }

    const swapped = await runProject(
      [["/main.hex", TYPE_SWAPPED + "export let out: String = f(True, 2)\n"]],
      { transform: distinct("display vs suffix: type swapped") },
    );

    expect(swapped["out"]).toBe("True2");
  });
});

describe("a first-use constrained variable takes no specified position", () => {
  /**
   * FFI Part 9 §6.2.1. The ordinal is a position in the *declared* list, and
   * Functions §4.2.1 makes a second introduction form canonical, so a private
   * function can carry a constrained variable that no declared list names —
   * here `a`, whose `Show` comes from `show(x)` and from nowhere else.
   *
   * What is pinned is what the spec promises: the two ends agree, so the call
   * answers. Where `a`'s dictionary sits in the suffix is deliberately **not**
   * pinned — §6.2.1 leaves it to the implementation, and a pin here would make
   * an unobservable mint order into a conformance obligation. The reason it is
   * unobservable is the export refusal below: writing the binder that makes
   * this function exportable is the same act that gives `a` an ordinal.
   */
  const HALF = "let mix<b: Show>(x: a, y: b): String = show(x) ++ show(y)\n";

  test("the half-declared function answers", async () => {
    const exports = await runProject(
      [["/main.hex", HALF + "export let out: String = mix(2, True)\n"]],
      { transform: distinct("evidence suffix order: mix declares b only") },
    );

    expect(exports["out"]).toBe("2True");
  });

  test("both arguments reach the member they belong to", async () => {
    const exports = await runProject(
      [["/main.hex", HALF + "export let out: String = mix(True, 2)\n"]],
      { transform: distinct("evidence suffix order: mix declares b only, swapped") },
    );

    expect(exports["out"]).toBe("True2");
  });

  test("exporting it is refused, which is why the position is unobservable", () => {
    const project = compileFiles([[
      "/main.hex",
      "export " + HALF,
    ]]);

    expect(project.diagnostics.map(({ message }) => message)).toEqual([
      "exported function `mix` must declare every constraint in its signature; write `<a: Show>`",
    ]);
  });
});

describe("the ordinal survives every copy of the scheme", () => {
  /**
   * `let alias = twice` emits as the **bare name** (Constraints §6.1), so the
   * alias answers to `twice`'s suffix while its own consumers key on the alias's
   * scheme — a scheme whose variables `#instantiate` minted fresh. Freshening
   * therefore has to preserve the ordinal, or the two ends of one call disagree
   * about a function neither of them declared.
   */
  test("an alias's consumers use the aliased function's suffix, axis 1", async () => {
    const exports = await runProject(
      [[
        "/main.hex",
        TWICE + "let alias = twice\n" + "export let answer: String = alias(2)\n",
      ]],
      { transform: distinct("evidence suffix order: alias axis 1") },
    );

    expect(exports["answer"]).toBe("4");
  });

  /**
   * The same claim on axis 2, which is the one that catches a *renumbering*
   * rather than a mis-sort: minting the alias's fresh variables in
   * `scheme.variables` array order relabels `<b, a>` as `<a, b>`, after which
   * sorting by id is sorting by the wrong ordinal and this answers `"Truetrue"`.
   */
  test("an alias's consumers use the aliased function's suffix, axis 2", async () => {
    const exports = await runProject(
      [[
        "/main.hex",
        MIX + "let alias = mix\n" + "export let answer: String = alias(2, True)\n",
      ]],
      { transform: distinct("evidence suffix order: alias axis 2") },
    );

    expect(exports["answer"]).toBe("2True");
  });

  test("the alias's argument list mirrors the aliased parameter list", () => {
    const javascript = emitted([[
      "/main.hex",
      MIX + "let alias = mix\n" + "export let answer: String = alias(2, True)\n",
    ]]);

    expect(javascript).toContain("const mix = (x, y, __Show_b, __Show_a) =>");
    expect(javascript).toContain("const alias = mix;");
    expect(javascript).toContain(
      "const answer = alias(2, true, __Show_Bool, __Show_Int);",
    );
  });

  /**
   * A polymorphic forwarder is misordered at *both* hops, so the two errors
   * cancel and the graph runs: `outer(2)` answered `"4"` on the broken build
   * while every entry point into it was wrong. The emitted text is the whole
   * claim here — an executed pin cannot tell the two builds apart.
   */
  test("a forwarder is right at both hops, not merely cancelling", () => {
    const javascript = emitted([[
      "/main.hex",
      TWICE +
        "let outer<z: (Show, Num)>(v: z): String = twice(v)\n" +
        "export let answer: String = outer(2)\n",
    ]]);

    expect(javascript).toMatch(
      /const outer = \(v, (__Num_a), (__Show_a)\) => twice\(v, \1, \2\);/u,
    );
    expect(javascript).toContain("const answer = outer(2, __Num_Int, __Show_Int);");
  });
});

describe("across a module boundary, at a type no edition covers", () => {
  /**
   * The import boundary is the second place a scheme's variables are renumbered,
   * and the only one a same-module test cannot reach. `Point` is outside Part 8's
   * fundamental set, so the call cannot be routed to an edition that takes no
   * evidence at all — the generic suffix is what runs.
   */
  test("a cross-module call at a nominal type runs, axis 2", async () => {
    const exports = await runProject(
      [
        ["/describe.hex", DESCRIBE],
        ["/mix.hex", `export ${MIX}`],
        [
          "/main.hex",
          'import { Point } from "./describe"\n' +
            'import { mix } from "./mix"\n' +
            "export let answer: String = mix(Point({x = 1}), True)\n",
        ],
      ],
      { transform: distinct("evidence suffix order: cross-module axis 2") },
    );

    expect(exports["answer"]).toBe("PTrue");
  });

  test("the cross-module argument list mirrors the imported parameter list", () => {
    const files = [
      ["/describe.hex", DESCRIBE],
      ["/mix.hex", `export ${MIX}`],
      [
        "/main.hex",
        'import { Point } from "./describe"\n' +
          'import { mix } from "./mix"\n' +
          "export let answer: String = mix(Point({x = 1}), True)\n",
      ],
    ] as const;

    expect(emitted(files, "/mix.hex")).toContain(
      "const mix = (x, y, __Show_b, __Show_a) =>",
    );
    expect(emitted(files)).toContain(
      "const answer = mix({ x: 1 }, true, __Show_Bool, __Show_Point);",
    );
  });

  /**
   * #350's second "wanted" bullet: a two-constraint bound with **both** members
   * called, executed at a nominal subject. `Describe` is imported, so the
   * requirement copied onto the callee's variable carries an identity this module
   * reads back through `#canonicalConstraintName` — the same name the callee's
   * own `dictionaryEntries` sorted under.
   */
  test("a two-constraint bound calling both members runs at a nominal type", async () => {
    const exports = await runProject(
      [
        ["/describe.hex", DESCRIBE],
        [
          "/main.hex",
          'import { Describe, Point } from "./describe"\n' +
            BOTH_MEMBERS +
            "export let answer: String = both(Point({x = 1}))\n",
        ],
      ],
      { transform: distinct("evidence suffix order: both members nominal") },
    );

    expect(exports["answer"]).toBe("Ppt");
  });

  /** The same bound at a primitive subject — the other half of that bullet. */
  test("a two-constraint bound calling both members runs at a primitive", async () => {
    const exports = await runProject(
      [
        ["/describe.hex", DESCRIBE],
        [
          "/main.hex",
          'import { Describe } from "./describe"\n' +
            BOTH_MEMBERS +
            "let seven: Int = 7\n" +
            "export let answer: String = both(seven)\n",
        ],
      ],
      { transform: distinct("evidence suffix order: both members primitive") },
    );

    expect(exports["answer"]).toBe("7int");
  });

  test("the imported constraint's dictionary leads, being the alphabetically first", () => {
    const javascript = emitted([
      ["/describe.hex", DESCRIBE],
      [
        "/main.hex",
        'import { Describe, Point } from "./describe"\n' +
          BOTH_MEMBERS +
          "export let answer: String = both(Point({x = 1}))\n",
      ],
    ]);

    expect(javascript).toContain(
      "const both = (x, __Describe_a, __Show_a) => show(x, __Show_a) + tag(x, __Describe_a);",
    );
    expect(javascript).toContain(
      "const answer = both({ x: 1 }, __Describe_Point, __Show_Point);",
    );
  });
});

/**
 * A **third** producer reads the same scheme under a third convention, and it is
 * not the evidence order: Part 8's specialization planner walks
 * `scheme.variables` in array order to name its editions, so `<b: Show, a:
 * Show>(x: a, y: b)` names them by *(a, b)* — `mixIntBool` — while
 * `dictionaryEntries` orders evidence by *(b, a)*. Two different orders over one
 * list, both correct, and `#specializedCallee` sits between them: it zips the
 * call's evidence against `dictionaryEntries` to learn which variable is ground
 * at which fundamental, then matches a candidate by *(variable, type)* pairs.
 *
 * These shapes ran correctly on the unfixed build, by cancellation — the
 * misordered evidence list was zipped against the ABI-ordered entries and came
 * back out right. They are kept as an interaction guard, and they are not idle:
 * an intermediate build of this fix that renumbered the imported scheme's
 * *array* as well as its ids routed `mix(2, True)` to `mixBoolInt` — the
 * transposed edition, a clean compile and a wrong answer. Read the edition
 * *name* as well as the answer; the name is where that build first diverged.
 */
describe("Part 8 routing reads the same scheme by a different key", () => {
  test("a routed call reaches the edition the definer emitted", () => {
    const javascript = emitted([
      ["/mix.hex", `export ${MIX}`],
      [
        "/main.hex",
        'import { mix } from "./mix"\n' + "export let out: String = mix(2, True)\n",
      ],
    ]);

    expect(javascript).toContain("const out = mixIntBool(2, true);");
  });

  test("the routed call computes the right answer", async () => {
    const exports = await runProject(
      [
        ["/mix.hex", `export ${MIX}`],
        [
          "/main.hex",
          'import { mix } from "./mix"\n' + "export let out: String = mix(2, True)\n",
        ],
      ],
      { transform: distinct("evidence suffix order: routed mix") },
    );

    expect(exports["out"]).toBe("2True");
  });

  /** Three binders, so a transposition cannot be a coincidence of two. */
  test("three misordered binders route to the edition named in array order", async () => {
    const files = [
      [
        "/trio.hex",
        "export let t<c: Show, b: Show, a: Show>(x: a, y: b, z: c): String =\n" +
          "    show(x) ++ show(y) ++ show(z)\n",
      ],
      [
        "/main.hex",
        'import { t } from "./trio"\n' + 'export let out: String = t(1, True, "s")\n',
      ],
    ] as const;

    expect(emitted(files)).toContain('const out = tIntBoolString(1, true, "s");');
    const exports = await runProject(files, {
      transform: distinct("evidence suffix order: routed trio"),
    });

    expect(exports["out"]).toBe("1Trues");
  });

  /**
   * The dot spelling of the same call (Method Syntax §1: the two spellings are
   * one call), which reaches `#instantiate` through a different collecting site.
   */
  test("a dot call routes and answers the same as the bare call", async () => {
    const files = [
      [
        "/box.hex",
        "export record Box = {v: Int}\n" +
          "honor Show<Box> =\n    show(value) = \"B\"\n" +
          "export let tell<b: Show, a: Show>(self: Box, x: a, y: b): String =\n" +
          "    show(x) ++ show(y)\n",
      ],
      [
        "/main.hex",
        'import { Box, tell } from "./box"\n' +
          "export let out: String = Box({v = 1}).tell(2, True)\n",
      ],
    ] as const;

    expect(emitted(files)).toContain("const out = tellIntBool({ v: 1 }, 2, true);");
    const exports = await runProject(files, {
      transform: distinct("evidence suffix order: routed dot call"),
    });

    expect(exports["out"]).toBe("2True");
  });
});
