/**
 * Conformance for Constraints §5.1.1's **advised-spelling law** (#715, #716):
 * an advised constraint spelling resolves, at the advised position, to the
 * declaration required — and a diagnostic never prints one word for two
 * declarations.
 *
 * Two defects sat on one root. Both the completeness advice (Modules §4.1.1)
 * and the refusal family (Functions §10, Constraints §8) computed the kept
 * requirement set identity-side and then passed it through a **name**-side
 * sieve at the display step. That sieve resolved each word through this
 * module's own scope, so:
 *
 * - a local `constraint Heft<a: Ord>` shadowing an imported scheme's `Heft`
 *   absorbed the genuine `Ord` binder into the *shadow's* base list and advised
 *   `<a: Heft>` — a word naming the wrong declaration, whose retry reported
 *   "`a` is declared to honor `Heft`, but the body requires `Heft`" (#715); and
 * - two distinct imported `Describe`s deduplicated to one word, advising a
 *   binder that can declare at most one of them (#716).
 *
 * The repair is the law's tiers, walked per required declaration: a bare
 * spelling in scope that resolves to it (its own name, or the name a renaming
 * import bound), the qualified form through an in-scope module alias, and
 * otherwise the module route — the derived alias the clause's own edit binds,
 * with the witness route clause appended (Pattern Matching §7.3's third tier).
 * Past the routes lies the fourth tier: a constraint that is not exported has
 * no spelling and no route, and draws **no rewrite** at all.
 *
 * Every advised repair in this file is discharged rather than asserted — the
 * offered edit is written out verbatim and compiled — because the whole of the
 * Rewrite Rule's claim is that the next compile accepts it.
 */

import { describe, expect, test } from "vitest";

import { compileFiles, projectDiagnostics } from "../support/test-project.js";

/** Every diagnostic a whole graph produced. */
function graphDiagnostics(
  files: readonly (readonly [string, string])[],
): readonly string[] {
  return compileFiles(files).diagnostics.map(({ message }) => message);
}

/** An exported constraint in another module, and a function under it. */
const HEFT_LIB = [
  "export constraint Heft<a> =",
  "    heft(value: a): a",
  "export let useHeft<a: Heft>(n: a): a = heft(n)",
  "",
].join("\n");

/** Two modules exporting one word for two declarations (#716's specimen). */
const DESCRIBE_ONE = [
  "export constraint Describe<a: Num> =",
  "    one(value: a): a",
  "export let useOne<a: Describe>(v: a): a = one(v)",
  "",
].join("\n");
const DESCRIBE_TWO = [
  "export constraint Describe<a: Num> =",
  "    two(value: a): a",
  "export let useTwo<a: Describe>(v: a): a = two(v)",
  "",
].join("\n");

/** A private constraint gating an export — Modules §4.3's sealing idiom. */
const GATE_LIB = [
  "constraint Gate<a> =",
  "    gate(value: a): a",
  "",
  "honor Gate<Int> =",
  "    gate(n) = n + 1",
  "",
  "export let use<a: Gate>(x: a): a = gate(x)",
  "export let keep: Int = 0",
  "",
].join("\n");

/** Keeps a specimen module from being empty at the border. */
const KEEP = "export let keep: Int = 0\n";

const INCOMPLETE_CALLER =
  "exported function `caller` requires a complete signature; " +
  "add types for parameters `n`, `m` and a return type";

/** `<=` raises `Ord`; the calls raise lib.hex's `Heft`. Neither absorbs. */
const CALLER =
  "export let caller(n, m, stop: Bool) = if stop then n <= m else useHeft(n) <= useHeft(m)\n";

describe("the completeness advice spells each constraint by its own declaration", () => {
  test("a local shadow neither absorbs a binder nor lends its word (#715)", () => {
    // The shadow declares `Ord` as a base. Resolving the *word* `Heft` here
    // reached that declaration, saw `Ord` among its bases, and dropped the
    // genuine `Ord` binder — for a constraint whose bases are empty. Both
    // halves of the advice were wrong: the list, and the word naming it.
    expect(graphDiagnostics([
      ["/lib.hex", HEFT_LIB],
      ["/main.hex", 'import { useHeft } from "./lib.hex"\n' +
        "constraint Heft<a: Ord> =\n    other(value: a): a\n" + CALLER],
    ])).toEqual([
      INCOMPLETE_CALLER,
      "exported function `caller` must declare every constraint in its signature; " +
      "write `<a: (Ord, Lib.Heft)>` — `Heft` is declared in `./lib`, and this module " +
      "binds another `Heft`; `import module Lib from \"./lib\"` and spell it `Lib.Heft`",
    ]);
  });

  test("and that advice is one the next compile accepts", () => {
    expect(graphDiagnostics([
      ["/lib.hex", HEFT_LIB],
      ["/main.hex", 'import { useHeft } from "./lib.hex"\n' +
        'import module Lib from "./lib"\n' +
        "constraint Heft<a: Ord> =\n    other(value: a): a\n" +
        "export let caller<a: (Ord, Lib.Heft)>(n: a, m: a, stop: Bool): Bool =\n" +
        "    if stop then n <= m else useHeft(n) <= useHeft(m)\n"],
    ])).toEqual([]);
  });

  test("the control keeps its bare word: no shadow, and the word is bound here", () => {
    // The first tier, and the fence around every message this law does not
    // touch: a spelling in scope that resolves to the required declaration is
    // printed exactly as it always was, with no clause.
    expect(graphDiagnostics([
      ["/lib.hex", HEFT_LIB],
      ["/main.hex", 'import { Heft, useHeft } from "./lib.hex"\n' + CALLER],
    ])).toEqual([
      INCOMPLETE_CALLER,
      "exported function `caller` must declare every constraint in its signature; " +
      "write `<a: (Ord, Heft)>`",
    ]);
  });

  test("an in-scope module alias is the second tier: qualified, and no clause", () => {
    // The alias is already a spelling this module holds, so there is nothing to
    // repair and no route to state — the advice qualifies and stops. The
    // resolver enters `L.Heft` into the name→identity map under that exact
    // spelling (Modules §3.3), which is what the tier reads.
    expect(graphDiagnostics([
      ["/lib.hex", HEFT_LIB],
      ["/main.hex", 'import { useHeft } from "./lib.hex"\n' +
        'import module L from "./lib"\n' + CALLER],
    ])).toEqual([
      INCOMPLETE_CALLER,
      "exported function `caller` must declare every constraint in its signature; " +
      "write `<a: (Ord, L.Heft)>`",
    ]);
  });

  test("and the second tier survives a local shadow: the alias still resolves", () => {
    // The shadow takes the *bare* word only. Tier 1 declines because `Heft`
    // here is another declaration; tier 2 answers, and no route is minted for a
    // module this file already has an alias for.
    expect(graphDiagnostics([
      ["/lib.hex", HEFT_LIB],
      ["/main.hex", 'import { useHeft } from "./lib.hex"\n' +
        'import module L from "./lib"\n' +
        "constraint Heft<a: Ord> =\n    other(value: a): a\n" + CALLER],
    ])).toEqual([
      INCOMPLETE_CALLER,
      "exported function `caller` must declare every constraint in its signature; " +
      "write `<a: (Ord, L.Heft)>`",
    ]);
  });

  test("two aliases onto one module: the first written is the one advised", () => {
    // Both spellings resolve, so the pick is the implementation's — and it is
    // pinned rather than left to luck, since an advised spelling that moved
    // between compiles would be a diff in every reader's error log. The
    // resolver lists aliases in source order and the first entry wins.
    expect(graphDiagnostics([
      ["/lib.hex", HEFT_LIB],
      ["/main.hex", 'import { useHeft } from "./lib.hex"\n' +
        'import module Second from "./lib"\n' +
        'import module Zeroth from "./lib"\n' + CALLER],
    ])).toEqual([
      INCOMPLETE_CALLER,
      "exported function `caller` must declare every constraint in its signature; " +
      "write `<a: (Ord, Second.Heft)>`",
    ]);
  });

  test("with no shadow and no import the word resolves to nothing, so it routes", () => {
    // The shadow is not what makes `Heft` unspellable — an import that binds
    // only `useHeft` binds no constraint at all (Modules §3.1), and the bare
    // word here is `unknown constraint \`Heft\``. The clause states the
    // shadowing half only where there is a shadow to state.
    expect(graphDiagnostics([
      ["/lib.hex", HEFT_LIB],
      ["/main.hex", 'import { useHeft } from "./lib.hex"\n' + CALLER],
    ])).toEqual([
      INCOMPLETE_CALLER,
      "exported function `caller` must declare every constraint in its signature; " +
      "write `<a: (Ord, Lib.Heft)>` — `Heft` is declared in `./lib`; " +
      "`import module Lib from \"./lib\"` and spell it `Lib.Heft`",
    ]);
  });
});

describe("two declarations sharing a word are two binders (#716)", () => {
  const BOTH = "export let both(v) = useOne(v) + useTwo(v)\n";
  const INCOMPLETE_BOTH =
    "exported function `both` requires a complete signature; " +
    "add type for parameter `v` and a return type";

  test("neither spellable here: both route, one clause per declaring module", () => {
    expect(graphDiagnostics([
      ["/lib1.hex", DESCRIBE_ONE],
      ["/lib2.hex", DESCRIBE_TWO],
      ["/main.hex", 'import { useOne } from "./lib1.hex"\n' +
        'import { useTwo } from "./lib2.hex"\n' + BOTH],
    ])).toEqual([
      INCOMPLETE_BOTH,
      "exported function `both` must declare every constraint in its signature; " +
      "write `<a: (Lib1.Describe, Lib2.Describe)>` — `Describe` is declared in `./lib1`; " +
      "`import module Lib1 from \"./lib1\"` and spell it `Lib1.Describe`" +
      " — `Describe` is declared in `./lib2`; " +
      "`import module Lib2 from \"./lib2\"` and spell it `Lib2.Describe`",
    ]);
  });

  test("and the pair of edits it offers compiles", () => {
    expect(graphDiagnostics([
      ["/lib1.hex", DESCRIBE_ONE],
      ["/lib2.hex", DESCRIBE_TWO],
      ["/main.hex", 'import { useOne } from "./lib1.hex"\n' +
        'import { useTwo } from "./lib2.hex"\n' +
        'import module Lib1 from "./lib1"\n' +
        'import module Lib2 from "./lib2"\n' +
        "export let both<a: (Lib1.Describe, Lib2.Describe)>(v: a): a = useOne(v) + useTwo(v)\n"],
    ])).toEqual([]);
  });

  test("a member the module can already spell keeps its word", () => {
    // The contested-group rule: no *new* named import is advised for anyone in
    // the group, but a spelling already bound here that resolves to a required
    // declaration is still the first tier. The other member routes, and the
    // clause states the word this module binds as the reason.
    expect(graphDiagnostics([
      ["/lib1.hex", DESCRIBE_ONE],
      ["/lib2.hex", DESCRIBE_TWO],
      ["/main.hex", 'import { Describe, useOne } from "./lib1.hex"\n' +
        'import { useTwo } from "./lib2.hex"\n' + BOTH],
    ])).toEqual([
      INCOMPLETE_BOTH,
      "exported function `both` must declare every constraint in its signature; " +
      "write `<a: (Describe, Lib2.Describe)>` — `Describe` is declared in `./lib2`, " +
      "and this module binds another `Describe`; " +
      "`import module Lib2 from \"./lib2\"` and spell it `Lib2.Describe`",
    ]);
  });

  test("and that mixed binder compiles too", () => {
    expect(graphDiagnostics([
      ["/lib1.hex", DESCRIBE_ONE],
      ["/lib2.hex", DESCRIBE_TWO],
      ["/main.hex", 'import { Describe, useOne } from "./lib1.hex"\n' +
        'import { useTwo } from "./lib2.hex"\n' +
        'import module Lib2 from "./lib2"\n' +
        "export let both<a: (Describe, Lib2.Describe)>(v: a): a = useOne(v) + useTwo(v)\n"],
    ])).toEqual([]);
  });

  test("two declaring modules with one basename mint distinct aliases", () => {
    // "The aliases one message binds are chosen mutually distinct, as well as
    // distinct from every spelling in scope, so the advised edits compose."
    // Both files are named `lib.hex`, so the second alias takes the suffix the
    // module-route repair already mints for a taken spelling.
    expect(graphDiagnostics([
      ["/a/lib.hex", DESCRIBE_ONE],
      ["/b/lib.hex", DESCRIBE_TWO],
      ["/main.hex", 'import { useOne } from "./a/lib.hex"\n' +
        'import { useTwo } from "./b/lib.hex"\n' + BOTH],
    ])).toEqual([
      INCOMPLETE_BOTH,
      "exported function `both` must declare every constraint in its signature; " +
      "write `<a: (Lib.Describe, Lib_1.Describe)>` — `Describe` is declared in `./a/lib`; " +
      "`import module Lib from \"./a/lib\"` and spell it `Lib.Describe`" +
      " — `Describe` is declared in `./b/lib`; " +
      "`import module Lib_1 from \"./b/lib\"` and spell it `Lib_1.Describe`",
    ]);
  });

  test("and the two aliases the one message minted compile side by side", () => {
    expect(graphDiagnostics([
      ["/a/lib.hex", DESCRIBE_ONE],
      ["/b/lib.hex", DESCRIBE_TWO],
      ["/main.hex", 'import { useOne } from "./a/lib.hex"\n' +
        'import { useTwo } from "./b/lib.hex"\n' +
        'import module Lib from "./a/lib"\n' +
        'import module Lib_1 from "./b/lib"\n' +
        "export let both<a: (Lib.Describe, Lib_1.Describe)>(v: a): a = useOne(v) + useTwo(v)\n"],
    ])).toEqual([]);
  });
});

describe("the refusal family qualifies by home, and only on a collision", () => {
  test("a same-spelled pair qualifies each side and routes the rewrite (#715)", () => {
    // The retry the advice used to send the author into: the declared word and
    // the required constraint are two declarations sharing a spelling, and the
    // message could not say so — "`a` is declared to honor `Heft`, but the body
    // requires `Heft`; write `<a: Heft>`", which is the text already written.
    expect(graphDiagnostics([
      ["/lib.hex", HEFT_LIB],
      ["/main.hex", 'import { useHeft } from "./lib.hex"\n' +
        "constraint Heft<a> =\n    other(value: a): a\n" +
        "let g<a: Heft>(x: a): a = useHeft(x)\n" + KEEP],
    ])).toEqual([
      "`a` is declared to honor this module's `Heft`, but the body requires " +
      "the `Heft` declared in `./lib.hex`; write `<a: (Heft, Lib.Heft)>` — " +
      "`import module Lib from \"./lib\"` and spell it `Lib.Heft`, " +
      "or remove the constraint annotation to let it be inferred",
    ]);
  });

  test("and the widened binder it offers compiles, the body untouched", () => {
    // Verbatim is the whole claim: the two edits the message named — the import
    // line and the widened binder — and *nothing else*. A discharge that also
    // rewrote the body would prove only that some program compiles.
    expect(graphDiagnostics([
      ["/lib.hex", HEFT_LIB],
      ["/main.hex", 'import { useHeft } from "./lib.hex"\n' +
        'import module Lib from "./lib"\n' +
        "constraint Heft<a> =\n    other(value: a): a\n" +
        "let g<a: (Heft, Lib.Heft)>(x: a): a = useHeft(x)\n" + KEEP],
    ])).toEqual([]);
  });

  test("no collision, no qualification: the message is the one it always was", () => {
    // Qualification is the collision's resolution, never the default (§5.1.1).
    expect(projectDiagnostics(
      "let g<a: Eq>(x: a, y: a): Bool = x <= y\n" + KEEP,
    )).toEqual([
      "`a` is declared to honor `Eq`, but the body requires `Ord`; " +
      "write `<a: Ord>`, or remove the constraint annotation to let it be inferred",
    ]);
  });

  test("no collision but no spelling either: the clause stands whole", () => {
    // Nothing in this message has named the declaring module, so the route
    // clause keeps its "declared in" half — the elision licence is spent only
    // where the collision qualification already spent it.
    expect(graphDiagnostics([
      ["/lib.hex", HEFT_LIB],
      ["/main.hex", 'import { useHeft } from "./lib.hex"\n' +
        "let g<a: Ord>(x: a): a = useHeft(x)\n" + KEEP],
    ])).toEqual([
      "`a` is declared to honor `Ord`, but the body requires `Heft`; " +
      "write `<a: (Ord, Lib.Heft)>` — `Heft` is declared in `./lib`; " +
      "`import module Lib from \"./lib\"` and spell it `Lib.Heft`, " +
      "or remove the constraint annotation to let it be inferred",
    ]);
  });

  test("the block-head arm composes the same law, never a member binder", () => {
    // §7.3 refuses a per-member binder, so the widen respells to the head — and
    // carries the route clause exactly as the fused arm does.
    expect(graphDiagnostics([
      ["/lib.hex", HEFT_LIB],
      ["/main.hex", 'import { useHeft } from "./lib.hex"\n' +
        "constraint Heft<a> =\n    other(value: a): a\n" +
        "fun<a: Heft>\n" +
        "    left(x: a, n: Int): a =\n" +
        "        if n <= 0 then other(x) else right(x, n - 1)\n" +
        "    right(x: a, n: Int): a = useHeft(x)\n" + KEEP],
    ])).toEqual([
      "`a` is declared to honor this module's `Heft` on the block head, but `right`'s " +
      "body requires the `Heft` declared in `./lib.hex`; widen the head: " +
      "`fun<a: (Heft, Lib.Heft)>` — `import module Lib from \"./lib\"` and spell it " +
      "`Lib.Heft`, or remove the head's constraint to let it be inferred",
    ]);
  });

  test("and the widened head compiles", () => {
    expect(graphDiagnostics([
      ["/lib.hex", HEFT_LIB],
      ["/main.hex", 'import { useHeft } from "./lib.hex"\n' +
        'import module Lib from "./lib"\n' +
        "constraint Heft<a> =\n    other(value: a): a\n" +
        "fun<a: (Heft, Lib.Heft)>\n" +
        "    left(x: a, n: Int): a =\n" +
        "        if n <= 0 then other(x) else right(x, n - 1)\n" +
        "    right(x: a, n: Int): a = useHeft(x)\n" + KEEP],
    ])).toEqual([]);
  });

  test("the honor-header arm carries the clause into its own seat", () => {
    // An `honor` binder's constraints are written, never inferred, so the arm
    // has no "let it be inferred" tail. The clause follows the seat rather than
    // splitting the binder from the header it goes on.
    expect(graphDiagnostics([
      ["/lib.hex", HEFT_LIB],
      ["/main.hex", 'import { useHeft } from "./lib.hex"\n' +
        "constraint Heft<a> =\n    other(value: a): a\n" +
        "record Box(a) = { value: a }\n" +
        "constraint Wrapped<b> =\n    wrapped(value: b): b\n" +
        "honor<a: Heft> Wrapped<Box(a)> =\n" +
        "    wrapped(box) = Box({ value = useHeft(box.value) })\n" + KEEP],
    ])).toEqual([
      "`a` is declared to honor this module's `Heft`, but the body requires " +
      "the `Heft` declared in `./lib.hex`; write `<a: (Heft, Lib.Heft)>` on the " +
      "`honor` header — `import module Lib from \"./lib\"` and spell it `Lib.Heft`",
    ]);
  });

  test("the subject arm merges into the base list, and routes there too", () => {
    // A default body reaches only its own constraint and that constraint's
    // bases, so the rewrite merges into the *declared base list* — a constraint
    // cannot list itself as a base. The law applies to that list exactly as it
    // does to a binder: the demand is spelled by what resolves here, and the
    // route clause rides the same message.
    expect(graphDiagnostics([
      ["/lib.hex", HEFT_LIB],
      ["/main.hex", 'import { useHeft } from "./lib.hex"\n' +
        "constraint Labelled<a: Ord> =\n" +
        "    label(value: a): a\n" +
        "    shown(value: a): a = useHeft(value)\n" + KEEP],
    ])).toEqual([
      "`a` is `Labelled`'s subject, so the body reaches only `Labelled` and its base " +
      "constraints, but it requires `Heft`; add `Heft` as a base constraint — write " +
      "`constraint Labelled<a: (Ord, Lib.Heft)>` — `Heft` is declared in `./lib`; " +
      "`import module Lib from \"./lib\"` and spell it `Lib.Heft`",
    ]);
  });

  test("and the base list it advises compiles verbatim", () => {
    expect(graphDiagnostics([
      ["/lib.hex", HEFT_LIB],
      ["/main.hex", 'import { useHeft } from "./lib.hex"\n' +
        'import module Lib from "./lib"\n' +
        "constraint Labelled<a: (Ord, Lib.Heft)> =\n" +
        "    label(value: a): a\n" +
        "    shown(value: a): a = useHeft(value)\n" + KEEP],
    ])).toEqual([]);
  });

  test("a third same-spelled demand is a third refusal, not a swallowed one", () => {
    // The suppression that keeps one variable from reporting the same demand
    // twice is keyed on the **declaration** (#716). Keyed on the word, the
    // second `Describe` here was silently dropped — a constraint no other
    // report in the file names.
    expect(graphDiagnostics([
      ["/lib1.hex", DESCRIBE_ONE],
      ["/lib2.hex", DESCRIBE_TWO],
      ["/main.hex", 'import { useOne } from "./lib1.hex"\n' +
        'import { useTwo } from "./lib2.hex"\n' +
        "let g<a: Ord>(x: a): a = useOne(useTwo(x))\n" + KEEP],
    ])).toEqual([
      "`a` is declared to honor `Ord`, but the body requires `Describe`; " +
      "write `<a: (Ord, Lib1.Describe)>` — `Describe` is declared in `./lib1`; " +
      "`import module Lib1 from \"./lib1\"` and spell it `Lib1.Describe`, " +
      "or remove the constraint annotation to let it be inferred",
      "`a` is declared to honor `Ord`, but the body requires `Describe`; " +
      "write `<a: (Ord, Lib2.Describe)>` — `Describe` is declared in `./lib2`; " +
      "`import module Lib2 from \"./lib2\"` and spell it `Lib2.Describe`, " +
      "or remove the constraint annotation to let it be inferred",
    ]);
  });
});

describe("the fourth tier: no spelling, no route, no rewrite", () => {
  test("an export over a sealed gate is told the truth, not a binder", () => {
    // Modules §4.3's sealing idiom seen from outside: the constraint is private
    // to its home, so no spelling exists here and no import can make one. A
    // rewrite would be an advised repair the next compile refuses.
    expect(graphDiagnostics([
      ["/lib.hex", GATE_LIB],
      ["/main.hex", 'import { use } from "./lib.hex"\n' +
        "export let g(x) = use(x)\n"],
    ])).toEqual([
      "exported function `g` requires a complete signature; add type for parameter `x` and a return type",
      "exported function `g` requires the constraint `Gate`, declared in `./lib.hex` " +
      "and not exported; a complete signature cannot be written here — use the " +
      "constrained operation at a concrete type, keep `g` private, or export `Gate` " +
      "from `./lib.hex`",
    ]);
  });

  test("a sealed fun-block member names no call — the sibling is not one", () => {
    // The requirement carries the `fun` member whose *body* raised it (#700's
    // field), which is either the function under report or a sibling under one
    // head — never the operation that demanded the constraint. Naming it here
    // would advise the author to call the very thing being refused, so the seat
    // states the constrained operation and guesses at no name.
    const messages = graphDiagnostics([
      ["/lib.hex", GATE_LIB],
      ["/main.hex", 'import { use } from "./lib.hex"\n' +
        "fun\n" +
        "    left(x, n: Int) = if n <= 0 then use(x) else right(x, n - 1)\n" +
        "    export right(x, n: Int) = left(x, n - 1)\n"],
    ]);
    // Measured, not assumed: this requirement's `demandedBy` is `left`, so the
    // deleted branch really did print "call `left` at a concrete type" here.
    expect(messages).toEqual([
      "exported function `right` requires a complete signature; add type for parameter `x` and a return type",
      "exported function `right` requires the constraint `Gate`, declared in `./lib.hex` " +
      "and not exported; a complete signature cannot be written here — use the " +
      "constrained operation at a concrete type, keep `right` private, or export " +
      "`Gate` from `./lib.hex`",
    ]);
    // The fence: no message in the report reaches for the sibling's name.
    expect(messages.filter((message) => message.includes("`left`"))).toEqual([]);
  });

  test("and the exits it names are real: the concrete call, and the private keep", () => {
    expect(graphDiagnostics([
      ["/lib.hex", GATE_LIB],
      ["/main.hex", 'import { use } from "./lib.hex"\n' +
        "export let g(x: Int): Int = use(x)\n"],
    ])).toEqual([]);
    expect(graphDiagnostics([
      ["/lib.hex", GATE_LIB],
      ["/main.hex", 'import { use } from "./lib.hex"\n' +
        "let g(x) = use(x)\nexport let answer: Int = g(1)\n"],
    ])).toEqual([]);
  });

  test("at a private function with a written binder, the standing exit stands", () => {
    // No rewrite here either — the report names the gate and leaves the row's
    // own exit, which is the one that works: inference carries what no binder
    // here can spell.
    expect(graphDiagnostics([
      ["/lib.hex", GATE_LIB],
      ["/main.hex", 'import { use } from "./lib.hex"\n' +
        "let g<a: Ord>(x: a): a = use(x)\n" + KEEP],
    ])).toEqual([
      "`a` is declared to honor `Ord`, but the body requires the constraint `Gate`, " +
      "declared in `./lib.hex` and not exported; no constraint list here can name it " +
      "— remove the constraint annotation to let it be inferred",
    ]);
  });

  test("a subject whose default body reaches a gate is offered no base either", () => {
    // The subject arm's own fourth tier: the rewrite it would otherwise merge
    // into the base list cannot be spelled, so the message stops at the gate.
    expect(graphDiagnostics([
      ["/lib.hex", GATE_LIB],
      ["/main.hex", 'import { use } from "./lib.hex"\n' +
        "constraint Labelled<a: Ord> =\n" +
        "    label(value: a): a\n" +
        "    shown(value: a): a = use(value)\n" + KEEP],
    ])).toEqual([
      "`a` is `Labelled`'s subject, so the body reaches only `Labelled` and its base " +
      "constraints, but it requires the constraint `Gate`, declared in `./lib.hex` and " +
      "not exported; no constraint list here can name it",
    ]);
  });

  test("and taking that exit compiles", () => {
    expect(graphDiagnostics([
      ["/lib.hex", GATE_LIB],
      ["/main.hex", 'import { use } from "./lib.hex"\n' +
        "let g(x) = use(x)\nexport let answer: Int = g(1)\n"],
    ])).toEqual([]);
  });

  test("the home module still spells its own private constraint", () => {
    // The gate is unnameable *elsewhere*; where it is declared it is an
    // ordinary word, and the advice is the ordinary one.
    expect(projectDiagnostics(
      "constraint Gate<a> =\n    gate(value: a): a\n" +
        "export let g(x) = gate(x)\n",
    )).toEqual([
      "exported function `g` requires a complete signature; add type for parameter `x` and a return type",
      "exported function `g` must declare every constraint in its signature; write `<a: Gate>`",
    ]);
  });
});
