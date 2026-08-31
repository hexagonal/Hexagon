/**
 * Conformance for the **route a demand takes to the evidence in scope** when
 * the constraint it demanded is absorbed by a sibling on the same variable
 * (#705).
 *
 * A variable's binders are the constraints maximal under entailment (Modules
 * §4.1.1 read ABI-side), so `Num` beside `Signed` on one variable is one
 * parameter, `__Signed_a`, and every `Num` demand has to be written as the
 * projection `__Signed_a.num`. Which constraints survive is not knowable while
 * the demands are still arriving — the last one may absorb everything before it
 * — so the route is derived once, at the Typed boundary, off the finished
 * requirement list. It used to be *stamped* on each requirement as it arrived,
 * and a point-in-time answer about a list that keeps growing was wrong in three
 * ways, each an ICE on a module the checker had accepted:
 *
 * 1. **The duplicate dropped before the absorber arrives.** `Num` arrives
 *    twice; the second is dropped as a duplicate and carries no stamp; `Signed`
 *    arrives later and re-stamps only the resident. The dropped object is the
 *    one an expression's elaboration is holding, and it published a bare `Num`
 *    demand against a binder list that has no `Num` seat.
 * 2. **The duplicate dropped after.** Same shape, opposite order: the drop
 *    happened without even copying the resident's stamp.
 * 3. **The stale stamp.** A `Num` stamped through `Signed` at birth, and then a
 *    `Frac` arrives and absorbs `Signed` in turn. The binder is `__Frac_a`
 *    alone; the stamp still named `Signed`.
 *
 * The neighbours in the second block are the fence: each was already correct,
 * and each is pinned on its **exact emitted line**, because the claim is not
 * that they still compile but that the derivation reproduces the projection
 * they already had, character for character.
 *
 * The surviving set is asked for by three readers, and the third — the binder
 * an exported signature is told to write — has a fence of its own, because a
 * *name*-side answer passes every specimen whose constraints this module can
 * spell and fails the moment one arrives inside an imported scheme. Its block
 * carries the unspellable, the aliased and the shadowed case, and discharges
 * the Rewrite Rule by compiling the binder the report offered.
 *
 * Execution, not only text: the flagship casualty is Functions §3.3's own
 * unannotated factorial, and a suffix that is merely *written* can still be
 * written wrong. Emitted modules mount as `data:` URLs the registry caches by
 * text, so the executed graphs are made byte-distinct.
 */

import { describe, expect, test } from "vitest";

import { compileFiles, projectDiagnostics, runProject } from "../support/test-project.js";

/** Makes a graph's modules byte-distinct, so the test gets its own instances. */
function distinct(label: string): (path: string, javascript: string) => string {
  return (_path, javascript) => `// ${label}\n${javascript}`;
}

function emitted(source: string): string {
  const project = compileFiles([["/main.hex", source]]);
  expect(project.diagnostics.map(({ message }) => message)).toEqual([]);
  return project.modules.find(({ source: file }) => file.path === "/main.hex")!.javascript.text;
}

/** Every diagnostic a whole graph produced, for the cross-module specimens. */
function graphDiagnostics(
  files: readonly (readonly [string, string])[],
): readonly string[] {
  return compileFiles(files).diagnostics.map(({ message }) => message);
}

/** A user constraint whose subject is `Signed`, so `Loud` absorbs both. */
const LOUD = "constraint Loud<a: Signed> =\n    loud(value: a): a\n";

/**
 * A constraint over `Num` in another module, and a function under it, so a
 * caller's requirement list holds a constraint the caller may not be able to
 * spell — and one that absorbs a `Num` the caller raised for itself.
 */
const HEFT_LIB = [
  "export constraint Heft<a: Num> =",
  "    heft(value: a): a",
  "export let useHeft<a: Heft>(n: a): a = heft(n)",
  "",
].join("\n");

/** Keeps a specimen module from being empty at the border. */
const KEEP = "export let keep: Int = 0\n";

describe("an absorbed demand projects out of the surviving binder", () => {
  test("a duplicate dropped before the absorber arrives still routes", () => {
    // `<=` raises `Ord` and a literal `Num`; the `then` arm's literal raises
    // `Num` a second time; `-` raises `Signed` last and swallows both.
    expect(emitted("let d1(n) = if n <= 0 then 0 else n - 1\n" + KEEP)).toContain(
      "const d1 = (n, __Ord_a, __Signed_a) => " +
        '__Ord_a.compare(n, __Signed_a.num.fromNat(0)) !== "Greater" ' +
        "? __Signed_a.num.fromNat(0) " +
        ": __Signed_a.subtract(n, __Signed_a.num.fromNat(1));",
    );
  });

  test("a duplicate dropped after the absorber arrives still routes", () => {
    expect(emitted("let d3(n, stop: Bool) = if stop then n + 0 else n - 1\n" + KEEP)).toContain(
      "const d3 = (n, stop, __Signed_a) => stop " +
        "? __Signed_a.num.add(n, __Signed_a.num.fromNat(0)) " +
        ": __Signed_a.subtract(n, __Signed_a.num.fromNat(1));",
    );
    // The mirror ordering, which reached the same ICE by the other door.
    expect(emitted("let d4(n, stop: Bool) = if stop then n - 1 else n + 0\n" + KEEP)).toContain(
      "const d4 = (n, stop, __Signed_a) => stop " +
        "? __Signed_a.subtract(n, __Signed_a.num.fromNat(1)) " +
        ": __Signed_a.num.add(n, __Signed_a.num.fromNat(0));",
    );
  });

  test("a stamp made stale by a later absorber routes through the last binder", () => {
    // `+` raises `Num`, which `-`'s `Signed` covers; then `/` raises `Frac` and
    // covers `Signed`. Only `__Frac_a` is passed, so both older demands have to
    // be read back down through it.
    expect(
      emitted("let h1(n, stop: Bool) = if stop then (n - 1) + 0 else n / n\n" + KEEP),
    ).toContain(
      "const h1 = (n, stop, __Frac_a) => stop " +
        "? __Frac_a.signed.num.add(" +
        "__Frac_a.signed.subtract(n, __Frac_a.signed.num.fromNat(1)), " +
        "__Frac_a.signed.num.fromNat(0)) " +
        ": __Frac_a.divide(n, n);",
    );
    expect(
      emitted("let h2(n, stop: Bool) = if stop then n / n else (n - 1) + 0\n" + KEEP),
    ).toContain(
      "const h2 = (n, stop, __Frac_a) => stop " +
        "? __Frac_a.divide(n, n) " +
        ": __Frac_a.signed.num.add(" +
        "__Frac_a.signed.subtract(n, __Frac_a.signed.num.fromNat(1)), " +
        "__Frac_a.signed.num.fromNat(0));",
    );
  });

  test("a user constraint absorbs the same way a prelude one does", () => {
    // Not `Frac` again: the rule is entailment, not a hard-coded numeric tower,
    // so a constraint declared in this module — with its own member, called
    // beside an independent `Num` demand — has to reach the same projection.
    const javascript = emitted(
      LOUD + "let l4(n, stop: Bool) = if stop then n + n else n + loud(n) - n\n" + KEEP,
    );
    expect(javascript).toContain(
      "const l4 = (n, stop, __Loud_a) => stop " +
        "? __Loud_a.signed.num.add(n, n) " +
        ": __Loud_a.signed.subtract(__Loud_a.signed.num.add(n, loud(n, __Loud_a)), n);",
    );
  });

  test("a component of a structurally satisfied type routes too", () => {
    // The demand reaches the route through `#publicComponents`, one recursion
    // deeper than a demand the body wrote: `==` on a tuple is satisfied
    // structurally, and each component raises its own `Eq` on the element
    // variable — which `<=`'s `Ord` absorbs. The first component's `Eq` is the
    // resident and the second is the dropped duplicate, so the tuple used to
    // emit one working slot beside one `undefined.equals`.
    expect(
      emitted("let f(n, m, stop: Bool) = if stop then (n, n) == (m, m) else n <= m\n" + KEEP),
    ).toContain(
      "const f = (n, m, stop, __Ord_a) => stop ? ({ " +
        "equals: (__left, __right) => __Ord_a.eq.equals(__left[0], __right[0]) && " +
        "__Ord_a.eq.equals(__left[1], __right[1]), " +
        "notEquals: (__left, __right) => !(__Ord_a.eq.equals(__left[0], __right[0]) && " +
        "__Ord_a.eq.equals(__left[1], __right[1])) " +
        '}).equals([n, n], [m, m]) : __Ord_a.compare(n, m) !== "Greater";',
    );
  });

  test("either binding can be the one that raised the absorbed demand", () => {
    // Two parameters unified into one variable, so the requirement list is
    // assembled across both. Which of them the surviving binder came from must
    // not matter, and both directions are pinned because they used to fail
    // differently — two ICEs one way round, one the other.
    expect(
      emitted("let both(x, y, stop: Bool) = if stop then x + 0 else y - 1\n" + KEEP),
    ).toContain(
      "const both = (x, y, stop, __Signed_a) => stop " +
        "? __Signed_a.num.add(x, __Signed_a.num.fromNat(0)) " +
        ": __Signed_a.subtract(y, __Signed_a.num.fromNat(1));",
    );
    expect(
      emitted("let both2(x, y, stop: Bool) = if stop then x - 1 else y + 0\n" + KEEP),
    ).toContain(
      "const both2 = (x, y, stop, __Signed_a) => stop " +
        "? __Signed_a.subtract(x, __Signed_a.num.fromNat(1)) " +
        ": __Signed_a.num.add(y, __Signed_a.num.fromNat(0));",
    );
  });

  test("the unannotated factorial compiles and carries the identity suffix", () => {
    const javascript = emitted(
      "fun fact(n) = if n <= 1 then 1 else n * fact(n - 1)\n" +
        "export let atInt: Int = fact(5)\n",
    );
    // Functions §3.3's own example, verbatim. Its recursive call is a knot
    // reference, so the suffix it passes is the caller's own parameters (#368),
    // and every `Num` inside the body is a projection off `__Signed_a`.
    expect(javascript).toContain("function fact(n, __Ord_a, __Signed_a) {");
    expect(javascript).toContain(
      'return __Ord_a.compare(n, __Signed_a.num.fromNat(1)) !== "Greater" ' +
        "? __Signed_a.num.fromNat(1) " +
        ": __Signed_a.num.multiply(n, fact(" +
        "__Signed_a.subtract(n, __Signed_a.num.fromNat(1)), __Ord_a, __Signed_a));",
    );
  });
});

describe("the neighbours that already routed correctly are unmoved", () => {
  test("a lone `Signed` still reaches its own base projection", () => {
    expect(emitted("let a1(n) = n - 1\n" + KEEP)).toContain(
      "const a1 = (n, __Signed_a) => __Signed_a.subtract(n, __Signed_a.num.fromNat(1));",
    );
  });

  test("two incomparable binders stay two parameters", () => {
    // `Num` and `Ord` absorb neither each other nor anything else, so nothing
    // here is a projection and both seats survive.
    expect(emitted("let a4(n) = if n <= 0 then n + 1 else n\n" + KEEP)).toContain(
      "const a4 = (n, __Num_a, __Ord_a) => " +
        '__Ord_a.compare(n, __Num_a.fromNat(0)) !== "Greater" ' +
        "? __Num_a.add(n, __Num_a.fromNat(1)) : n;",
    );
  });

  test("`Ord` beside `Signed` with no standalone `Num` demand is unchanged", () => {
    expect(emitted("let a2(n, m) = if n <= m then n - m else m - n\n" + KEEP)).toContain(
      "const a2 = (n, m, __Ord_a, __Signed_a) => " +
        '__Ord_a.compare(n, m) !== "Greater" ' +
        "? __Signed_a.subtract(n, m) : __Signed_a.subtract(m, n);",
    );
  });

  test("a two-step projection through `Frac` is unchanged", () => {
    expect(emitted("let h3(n) = (n - 1) / n\n" + KEEP)).toContain(
      "const h3 = (n, __Frac_a) => __Frac_a.divide(" +
        "__Frac_a.signed.subtract(n, __Frac_a.signed.num.fromNat(1)), n);",
    );
  });
});

describe("two binders that both provide the demand", () => {
  test("route through the first of them, in the order the list holds them", () => {
    // Neither `Alpha` nor `Beta` absorbs the other, so both are binders and both
    // carry a `num` slot down to the *same* `Num` instance for the subject — the
    // choice is between two spellings of one dictionary, not between two
    // answers. It still has to be made the same way on every compile, so it is
    // made positionally, and pinned here rather than left to fall out.
    const javascript = emitted(
      "constraint Alpha<a: Num> =\n    alpha(value: a): a\n" +
        "constraint Beta<a: Num> =\n    beta(value: a): a\n" +
        "let w(n, s1: Bool, s2: Bool) = if s1 then n + n else if s2 then alpha(n) else beta(n)\n" +
        KEEP,
    );
    expect(javascript).toContain(
      "const w = (n, s1, s2, __Alpha_a, __Beta_a) => s1 " +
        "? __Alpha_a.num.add(n, n) " +
        ": s2 ? alpha(n, __Alpha_a) : beta(n, __Beta_a);",
    );
  });
});

describe("the binder set an export is told to write", () => {
  test("names the surviving constraints and never the absorbed ones", () => {
    // The third reader of the same set. `Num` is absorbed, so the advice must
    // not offer it — a binder list naming a base constraint beside the one that
    // provides it is refused by the very next compile.
    expect(projectDiagnostics("export let d1(n) = if n <= 0 then 0 else n - 1\n")).toEqual([
      "exported function `d1` requires a complete signature; add type for parameter `n` and a return type",
      "exported function `d1` must declare every constraint in its signature; write `<a: (Ord, Signed)>`",
    ]);
    expect(
      projectDiagnostics("export let h1(n, stop: Bool) = if stop then (n - 1) + 0 else n / n\n"),
    ).toEqual([
      "exported function `h1` requires a complete signature; add type for parameter `n` and a return type",
      "exported function `h1` must declare every constraint in its signature; write `<a: Frac>`",
    ]);
  });

  test("absorbs by identity, so an unspellable absorber still absorbs", () => {
    // The specimens above resolve every constraint they name in this module, so
    // they cannot tell absorption decided identity-side from absorption decided
    // on the printed spellings. This one can: `Heft` reaches the caller only
    // inside an imported scheme's requirement, and asking *this* module for the
    // bases of the word `Heft` answers nothing at all — under which `Num`
    // survives into the advice and the offered binder is refused by the very
    // next compile (`must omit base constraint \`Num\``).
    const caller =
      "export let caller(n, stop: Bool) = if stop then n + n else useHeft(n)\n";
    expect(graphDiagnostics([
      ["/lib.hex", HEFT_LIB],
      ["/main.hex", 'import { useHeft } from "./lib.hex"\n' + caller],
    ])).toEqual([
      "exported function `caller` requires a complete signature; add type for parameter `n` and a return type",
      "exported function `caller` must declare every constraint in its signature; write `<a: Heft>`",
    ]);
    // Spellable, but not under the declaration's own word.
    expect(graphDiagnostics([
      ["/lib.hex", HEFT_LIB],
      ["/main.hex", 'import { Heft as Weigh, useHeft } from "./lib.hex"\n' + caller],
    ])).toEqual([
      "exported function `caller` requires a complete signature; add type for parameter `n` and a return type",
      "exported function `caller` must declare every constraint in its signature; write `<a: Heft>`",
    ]);
    // Spellable, and the word means something else here entirely (§5.1.1).
    expect(graphDiagnostics([
      ["/lib.hex", HEFT_LIB],
      ["/main.hex", 'import { useHeft } from "./lib.hex"\n' +
        "constraint Heft<a> =\n    other(value: a): a\n" + caller],
    ])).toEqual([
      "exported function `caller` requires a complete signature; add type for parameter `n` and a return type",
      "exported function `caller` must declare every constraint in its signature; write `<a: Heft>`",
    ]);
  });

  test("and the advice it gives is one the next compile accepts", () => {
    // The Rewrite Rule, discharged rather than asserted: the binder the report
    // offered is written out and compiled, and the `Num` demand it no longer
    // names is emitted as the projection off the binder it does.
    const project = compileFiles([
      ["/lib.hex", HEFT_LIB],
      ["/main.hex", [
        'import { Heft, useHeft } from "./lib.hex"',
        "export let caller<a: Heft>(n: a, stop: Bool): a =",
        "    if stop then n + n else useHeft(n)",
        "",
      ].join("\n")],
    ]);
    expect(project.diagnostics.map(({ message }) => message)).toEqual([]);
    expect(
      project.modules.find(({ source: file }) => file.path === "/main.hex")!.javascript.text,
    ).toContain("return stop ? __Heft_a.num.add(n, n) : useHeft(n, __Heft_a);");
  });
});

describe("the factorial runs", () => {
  test("at `Int`", async () => {
    const exports = await runProject(
      [["/main.hex", "fun fact(n) = if n <= 1 then 1 else n * fact(n - 1)\n" +
        "export let answer: Int = fact(5)\n"]],
      { transform: distinct("fact-int") },
    );
    expect(exports["answer"]).toBe(120);
  });

  test("at `BigInt`, through the same generic body", async () => {
    // One definition, two instantiations: the run says the projections read the
    // dictionary that was actually passed, not one the emitter guessed at.
    const exports = await runProject(
      [["/main.hex", "fun fact(n) = if n <= 1 then 1 else n * fact(n - 1)\n" +
        "export let atInt: Int = fact(5)\n" +
        "export let atBig: BigInt = fact(5n)\n"]],
      { transform: distinct("fact-both") },
    );
    expect(exports["atInt"]).toBe(120);
    expect(exports["atBig"]).toBe(120n);
  });
});
