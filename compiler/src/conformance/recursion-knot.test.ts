/**
 * Conformance for the **monomorphic knot's evidence and its two refusals**
 * (Functions §7.4 and §10's polymorphic-recursion row; #368).
 *
 * A reference that resolves inside a `fun` block's strongly-connected component
 * sees the member at its not-yet-generalized monotype, so instantiating it
 * yields no requirements — and an empty requirement list is exactly what an
 * unconstrained call looks like. Every constrained recursive call therefore
 * emitted with its dictionary suffix **dropped**: a clean compile, and a
 * `TypeError` on the first descent when the callee read a member off
 * `undefined`. The suffix a knot reference owes is the identity one — the
 * caller's own dictionary parameters, unchanged, in the callee's order.
 *
 * **Every claim about a knot is pinned on emitted JS *and* execution.** The arc
 * began as a silent miscompile, and a test that only reads the text is the same
 * instrument that missed it: emitted JS assertions say the argument is written,
 * execution says the value behind it is the right one. Executed graphs are made
 * byte-distinct through `distinct`, because emitted modules mount as `data:`
 * URLs and the registry caches those by text.
 */

import { describe, expect, test } from "vitest";

import { compileFiles, projectDiagnostics, runProject } from "../support/test-project.js";

/** Makes a graph's modules byte-distinct, so the test gets its own instances. */
function distinct(label: string): (path: string, javascript: string) => string {
  return (_path, javascript) => `// ${label}\n${javascript}`;
}

function emitted(source: string): string {
  const project = compileFiles([["/main.hex", "module Main\n\n" + source]]);
  expect(project.diagnostics.map(({ message }) => message)).toEqual([]);
  return project.modules.find(({ source: file }) => file.path === "/main.hex")!.javascript.text;
}

/**
 * A subject outside Part 8's fundamental set, so no monomorphic edition exists
 * to route a call to and the generic path — the one carrying the suffix — is
 * what every assertion below reads.
 */
const BOX =
  "record Box = {v: Int}\n" +
  "honor Show<Box> =\n" +
  '    show(value) = "B" ++ Show.show(value.v)\n' +
  "honor Eq<Box> =\n" +
  "    equals(left, right) = left.v == right.v\n";

describe("self-recursion carries the identity suffix", () => {
  const COUNTDOWN =
    "fun countdown<a: Eq>(left: a, right: a, n: Int): Int =\n" +
    "    if n <= 0 then 0 else if left == right then 1 + countdown(left, right, n - 1) else 0\n";

  test("the recursive call is written with the definition's own dictionary", () => {
    const javascript = emitted(
      BOX + COUNTDOWN +
        "export let answer: Int = countdown(Box({v = 1}), Box({v = 1}), 3)\n",
    );

    expect(javascript).toContain("function countdown(left, right, n, __Eq_a) {");
    expect(javascript).toContain("countdown(left, right, n - 1, __Eq_a)");
  });

  /**
   * The headline repro, executed. Before the fix the descent reached
   * `countdown(left, right, n - 1)` with `__Eq_a` undefined and died reading
   * `.equals` off it, so the answer this asserts could not be produced at all.
   */
  test("the headline repro runs to its answer", async () => {
    const exports = await runProject(
      [[
        "/main.hex",
        "module Main\n\n" + BOX + COUNTDOWN +
          "export let answer: Int = countdown(Box({v = 1}), Box({v = 1}), 3)\n",
      ]],
      { transform: distinct("recursion knot: countdown") },
    );

    expect(exports["answer"]).toBe(3);
  });

  /**
   * Two variables, and a head whose binder order is *not* the order the binders
   * occur in the parameter list. The suffix is FFI Part 9 §6.2's — declared-head
   * ordinal, then constraint name — at both ends, so the recursive call's
   * argument list is the definition's own parameter list, position for position.
   */
  test("multi-constraint order agrees with the head, not the parameter list", () => {
    const javascript = emitted(
      BOX +
        "fun walk<b: Show, a: Eq>(x: a, y: b, n: Int): String =\n" +
        '    if n <= 0 then show(y) else if x == x then walk(x, y, n - 1) else ""\n' +
        "export let answer: String = walk(Box({v = 1}), Box({v = 2}), 2)\n",
    );

    expect(javascript).toContain("function walk(x, y, n, __Show_b, __Eq_a) {");
    expect(javascript).toContain("walk(x, y, n - 1, __Show_b, __Eq_a)");
  });

  test("multi-constraint recursion runs", async () => {
    const exports = await runProject(
      [[
        "/main.hex",
        "module Main\n\n" + BOX +
          "fun walk<b: Show, a: Eq>(x: a, y: b, n: Int): String =\n" +
          '    if n <= 0 then show(y) else if x == x then walk(x, y, n - 1) else ""\n' +
          "export let answer: String = walk(Box({v = 1}), Box({v = 2}), 2)\n",
      ]],
      { transform: distinct("recursion knot: walk") },
    );

    expect(exports["answer"]).toBe("B2");
  });

  /** One variable, two constraints: the tie-break inside a slot is the name's. */
  test("two constraints on one variable keep both slots, alphabetically", () => {
    const javascript = emitted(
      BOX +
        "fun tally<a: (Show, Eq)>(x: a, n: Int): String =\n" +
        '    if n <= 0 then show(x) else if x == x then tally(x, n - 1) else ""\n' +
        "export let answer: String = tally(Box({v = 1}), 2)\n",
    );

    expect(javascript).toContain("function tally(x, n, __Eq_a, __Show_a) {");
    expect(javascript).toContain("tally(x, n - 1, __Eq_a, __Show_a)");
  });
});

describe("mutual recursion carries it across the cross-calls", () => {
  // *(#700.)* Mutual recursion is spelled by the block, and only by the block.
  const PING_PONG =
    "fun\n" +
    "    ping(x, y, n: Int): Int =\n" +
    "        if n <= 0 then 0 else if x == y then pong(x, y, n - 1) else 0\n" +
    "    pong(x, y, n: Int): Int = if n <= 0 then 1 else ping(x, y, n - 1)\n";

  /**
   * Unannotated on both sides: the `Eq` the knot accumulates is one variable's,
   * so both members take one dictionary parameter and each cross-call passes the
   * caller's own — which is the identity, the two schemes sharing the variable.
   */
  test("both cross-calls are written with the caller's dictionary", () => {
    const javascript = emitted(
      BOX + PING_PONG +
        "export let answer: Int = ping(Box({v = 1}), Box({v = 1}), 3)\n",
    );

    expect(javascript).toContain("function ping(x, y, n, __Eq_a) {");
    expect(javascript).toContain("function pong(x, y, n, __Eq_a) {");
    expect(javascript).toContain("pong(x, y, n - 1, __Eq_a)");
    expect(javascript).toContain("ping(x, y, n - 1, __Eq_a)");
  });

  test("the mutual pair runs", async () => {
    const exports = await runProject(
      [[
        "/main.hex",
        "module Main\n\n" + BOX + PING_PONG +
          "export let answer: Int = ping(Box({v = 1}), Box({v = 1}), 3)\n",
      ]],
      { transform: distinct("recursion knot: ping pong") },
    );

    expect(exports["answer"]).toBe(1);
  });
});

describe("a recursive occurrence in value position", () => {
  const SELF =
    "fun repeat<a: Show>(x: a, n: Int): String =\n" +
    "    let self = repeat\n" +
    '    if n <= 0 then "" else show(x) ++ self(x, n - 1)\n';

  /**
   * Constraints §6.1's evidence-in-scope shape, reached by a knot reference: the
   * occurrence eta-expands and the wrapper closes over the definition's own
   * dictionary. `let self = repeat` cannot generalize — inside the knot `repeat`
   * is a monotype — so the wrapper is the only seat the evidence has.
   */
  test("the occurrence eta-expands over the enclosing dictionary", () => {
    const javascript = emitted(
      BOX + SELF + "export let answer: String = repeat(Box({v = 1}), 2)\n",
    );

    expect(javascript).toContain(
      "const self = (__arg0, __arg1) => repeat(__arg0, __arg1, __Show_a);",
    );
  });

  test("the value-position occurrence runs", async () => {
    const exports = await runProject(
      [[
        "/main.hex",
        "module Main\n\n" + BOX + SELF + "export let answer: String = repeat(Box({v = 1}), 2)\n",
      ]],
      { transform: distinct("recursion knot: value position") },
    );

    expect(exports["answer"]).toBe("B1B1");
  });
});

/**
 * §7.4's other half of the corollary: a constrained variable of the callee's
 * scheme that is **not** among the caller's own. The knot can put one there —
 * `outer` compares its parameter, `inner` takes only an `Int` and calls `outer`
 * — and no call site of `inner` could ever determine it. Quantifying it hands
 * `inner` a dictionary parameter it does not have, and the two shapes below are
 * what that produced: an internal compiler error, and a cross-call one argument
 * short. Neither mints a new instantiation now; the variable resolves under §8's
 * ordinary rules.
 */
describe("the asymmetric knot", () => {
  const ASYMMETRIC =
    "fun\n" +
    "    outer(x, n: Int): Int =\n" +
    "        if n <= 0 then 0 else if x == x then inner(n - 1) else 0\n";

  /**
   * Defaultable: `Eq` and `Num` both admit `Int` (Numeric Literals §4 as #344
   * amends it — the prelude supplies the `Int` instance), so the variable
   * defaults and the cross-call passes ground evidence. This was
   * "internal compiler error: missing `Num` evidence during JavaScript emission".
   */
  test("a defaultable callee-only variable compiles", () => {
    const javascript = emitted(
      ASYMMETRIC +
        "    inner(n: Int): Int = if n <= 0 then 1 else outer(0, n - 1)\n" +
        "export let answer: Int = outer(1, 3)\n",
    );

    expect(javascript).toContain("function outer(x, n) {");
    expect(javascript).toContain("outer(0, n - 1)");
  });

  test("and runs", async () => {
    const exports = await runProject(
      [[
        "/main.hex",
        "module Main\n\n" + ASYMMETRIC +
          "    inner(n: Int): Int = if n <= 0 then 1 else outer(0, n - 1)\n" +
          "export let answer: Int = outer(1, 3)\n",
      ]],
      { transform: distinct("recursion knot: asymmetric defaultable") },
    );

    expect(exports["answer"]).toBe(1);
  });

  /**
   * The same shape at a `Vector`, whose element variable nothing in the knot
   * fixes. Its constraints still admit the default, so this is the pinned
   * "defaulted" outcome and not the refusal — the cross-call emitted
   * `outer(__trieEmpty, n - 1)` against a three-parameter `outer` before, which
   * is the under-application the run below would have caught.
   */
  test("an unfixed element variable defaults, and the cross-call is not short", async () => {
    const source = ASYMMETRIC +
      "    inner(n: Int): Int = if n <= 0 then 1 else outer([], n - 1)\n" +
      "export let answer: Int = outer([1], 3)\n";
    const javascript = emitted(source);

    expect(javascript).toContain("function outer(x, n) {");
    expect(javascript).toContain("outer(__trieEmpty, n - 1)");

    const exports = await runProject([["/main.hex", "module Main\n\n" + source]], {
      transform: distinct("recursion knot: asymmetric vector"),
    });

    expect(exports["answer"]).toBe(1);
  });

  /**
   * And where the constraints admit no default, the variable takes the ambiguity
   * path (`decisions-ml-dialect-generalization-2026-08.md` §5.3; Numeric
   * Literals §6) — a refusal that names the annotation repair, never a scheme
   * the caller cannot supply. A user constraint is never defaultable however it
   * is honored (the pre-registered test), so `Blip` is the shape that reaches it.
   */
  test("a non-defaultable callee-only variable is refused on the ambiguity path", () => {
    const messages = projectDiagnostics("module Main\n\n" + "constraint Blip<a> =\n" +
        "    blip(x: a): Int\n" +
        "record Crate(a) = {items: Vector(a)}\n" +
        "honor<a: Blip> Blip<Crate(a)> =\n" +
        "    blip(x) = 1\n" +
        "honor Blip<String> =\n" +
        "    blip(x) = 2\n" +
        "fun\n" +
        "    outer(x, n: Int): Int =\n" +
        "        if n <= 0 then 0 else if blip(x) > 0 then inner(n - 1) else 0\n" +
        "    inner(n: Int): Int =\n" +
        "        if n <= 0 then 1 else outer(Crate({items = []}), n - 1)\n" +
        "export let answer: Int = inner(3)\n",
    );

    expect(messages).toContain(
      "this expression's type cannot default to `Int`: `Blip` is not a defaultable " +
        "constraint; add a type annotation to pin the type",
    );
  });
});

/**
 * §10's polymorphic-recursion row, both message families and both their fences.
 */
describe("the declared-heads refusal", () => {
  /**
   * *(#700.)* The two heads are the members' **own annotation variables** —
   * rigidity is independent of the binder (§4.2.1), and a block's member lines
   * take no binder list of their own (§7.3). `x == x` is what puts a defaultable
   * `Eq` on each, which is what makes the fence below reachable at all.
   */
  const TWO_HEADS =
    "fun\n" +
    "    isEven(x: a, n: Int): Bool = if n <= 0 then x == x else isOdd(x, n - 1)\n" +
    "    isOdd(x: a, n: Int): Bool = if n <= 0 then False else isEven(x, n - 1)\n";

  /**
   * The hint, and the fence on the *other* family in one assertion: exactly one
   * diagnostic. The second used to be "`a` is a declared type variable, but the
   * body requires `Int`" on a program with no `Int` in it — defaulting's
   * proposal on a variable the refusal had already errored, reported as a demand
   * of the body.
   */
  test("two heads the knot links get the SCC hint, and nothing else", () => {
    expect(
      projectDiagnostics("module Main\n\n" + TWO_HEADS + "export let answer: Bool = isEven(1, 3)\n"),
    ).toEqual([
      "`a` declared on `isEven` and `a` declared on `isOdd` are distinct declared type " +
        "variables, but members of a recursive knot are checked together at not-yet-general " +
        "types; declare one head on the `fun` block that both members write, drop the " +
        "members' own variable annotations and let inference link the knot, or move the " +
        "contract to a non-recursive wrapper",
    ]);
  });

  /**
   * The advice the generic message carries — one name in both annotations — is
   * what this program already writes, which is why the row fences it out.
   */
  test("the hint never offers the same-name advice", () => {
    for (const message of projectDiagnostics("module Main\n\n" + TWO_HEADS)) {
      expect(message).not.toContain("use one type variable name in both annotations");
    }
  });

  /** Distinct spellings: the qualification is per member, not a de-duplicator. */
  test("each side is qualified by its declaring member", () => {
    expect(
      projectDiagnostics("module Main\n\n" + "fun\n" +
          "    isEven(x: p, n: Int): Bool = if n <= 0 then x == x else isOdd(x, n - 1)\n" +
          "    isOdd(x: q, n: Int): Bool = if n <= 0 then False else isEven(x, n - 1)\n",
      ),
    ).toEqual([
      "`p` declared on `isEven` and `q` declared on `isOdd` are distinct declared type " +
        "variables, but members of a recursive knot are checked together at not-yet-general " +
        "types; declare one head on the `fun` block that both members write, drop the " +
        "members' own variable annotations and let inference link the knot, or move the " +
        "contract to a non-recursive wrapper",
    ]);
  });

  /**
   * *(#700.)* And the side declared on the **block head** is qualified by the
   * head, which binds no name: §10 says to locate it by its span, which the
   * report's label does.
   */
  test("a side declared on the block head is qualified by the head", () => {
    expect(
      projectDiagnostics("module Main\n\n" + "fun<p: Eq>\n" +
          "    isEven(x: p, n: Int): Bool = if n <= 0 then x == x else isOdd(x, n - 1)\n" +
          "    isOdd(x: q, n: Int): Bool = if n <= 0 then False else isEven(x, n - 1)\n",
      ),
    ).toEqual([
      "`p` declared on the `fun` block head and `q` declared on `isOdd` are distinct " +
        "declared type variables, but members of a recursive knot are checked together at " +
        "not-yet-general types; declare one head on the `fun` block that both members " +
        "write, or move the contract to a non-recursive wrapper",
    ]);
  });

  /**
   * The refusal is the **knot's**, and §10 states it in the singular — "the
   * refusal takes the SCC hint". Three headed members produce one collision that
   * names two of them, and the third head is left for defaulting to bind to
   * `Int` and the rigid-vs-concrete message to report as a body demand — on a
   * program with no `Int` in it. `Eq` is what makes the leak reachable: the head
   * has to carry a *defaultable* constraint for defaulting to take it at all.
   */
  test("a three-member knot is refused once, and leaves no head to default", () => {
    expect(
      projectDiagnostics("module Main\n\n" + "fun\n" +
          "    t1(x: a, n: Int): Bool = if n <= 0 then x == x else t2(x, n - 1)\n" +
          "    t2(x: b, n: Int): Bool = if n <= 0 then x == x else t3(x, n - 1)\n" +
          "    t3(x: c, n: Int): Bool = if n <= 0 then x == x else t1(x, n - 1)\n",
      ),
    ).toEqual([
      "`a` declared on `t1` and `b` declared on `t2` are distinct declared type variables, " +
        "but members of a recursive knot are checked together at not-yet-general types; " +
        "declare one head on the `fun` block that both members write, drop the members' own " +
        "variable annotations and let inference link the knot, or move the contract to a " +
        "non-recursive wrapper",
    ]);
  });

  /**
   * Where two functions of one knot must export, Modules §4.1.1 requires a
   * complete signature on each, so neither may drop its annotations — and the
   * two spellings left are the block head *(#700)* and the wrapper. The head is
   * offered first, and it is the spelling #700 exists for: before the block, the
   * wrapper was the only one, and the next test compiles the head.
   */
  test("two exporting members are offered the head and the wrapper", () => {
    const messages = projectDiagnostics("module Main\n\n" + "fun\n" +
        "    export isEven(x: a, n: Int): Bool =\n" +
        "        if n <= 0 then True else isOdd(x, n - 1)\n" +
        "    export isOdd(x: a, n: Int): Bool =\n" +
        "        if n <= 0 then False else isEven(x, n - 1)\n",
    );

    expect(messages).toEqual([
      "`a` declared on `isEven` and `a` declared on `isOdd` are distinct declared type " +
        "variables, but members of a recursive knot are checked together at not-yet-general " +
        "types; declare one head on the `fun` block that both members write, or move the " +
        "contract to a non-recursive wrapper over an unexported knot",
    ]);
  });

  /**
   * *(#700.)* And the offered head **compiles, and runs** — the spelling #700
   * filed as unwritable, an exported constrained knot with no wrapper in sight.
   */
  test("the offered head spelling compiles for two exporting members", () => {
    expect(
      projectDiagnostics("module Main\n\n" + "fun<a: Eq>\n" +
          "    export isEven(x: a, n: Int): Bool =\n" +
          "        if n <= 0 then x == x else isOdd(x, n - 1)\n" +
          "    export isOdd(x: a, n: Int): Bool =\n" +
          "        if n <= 0 then False else isEven(x, n - 1)\n",
      ),
    ).toEqual([]);
  });

  /**
   * One exporting member is the third arm, and the reason it exists is the
   * Rewrite Rule: the headless knot is not a spelling this program can take, and
   * offering it advised a repair that does not compile. What is legal is §7.4's
   * middle spelling — the exporting member keeps its head, the sibling drops
   * its own and reaches it generically — and the next test compiles exactly
   * that, in both source orders.
   */
  test("one exporting member is offered the single-head spelling", () => {
    const message = (source: string): readonly string[] => projectDiagnostics("module Main\n\n" + source);
    const expected = (plain: string, exporting: string): string =>
      `\`a\` declared on \`isEven\` and \`a\` declared on \`isOdd\` are distinct declared type ` +
      "variables, but members of a recursive knot are checked together at not-yet-general " +
      "types; declare one head on the `fun` block that both members write, or drop " +
      `\`${plain}\`'s own variable annotations and let it reach \`${exporting}\` generically, ` +
      "or move the contract to a non-recursive wrapper";

    expect(
      message(
        "fun\n" +
          "    isEven(x: a, n: Int): Bool =\n" +
          "        if n <= 0 then True else isOdd(x, n - 1)\n" +
          "    export isOdd(x: a, n: Int): Bool =\n" +
          "        if n <= 0 then False else isEven(x, n - 1)\n",
      ),
    ).toEqual([expected("isEven", "isOdd")]);

    expect(
      message(
        "fun\n" +
          "    export isEven(x: a, n: Int): Bool =\n" +
          "        if n <= 0 then True else isOdd(x, n - 1)\n" +
          "    isOdd(x: a, n: Int): Bool =\n" +
          "        if n <= 0 then False else isEven(x, n - 1)\n",
      ),
    ).toEqual([expected("isOdd", "isEven")]);
  });

  /**
   * The Rewrite Rule made checkable: the spelling the message above names
   * compiles, and the one it withholds does not.
   */
  test("both offered repairs compile, and the un-offered one does not", () => {
    // Drop the plain member's own annotations: it reaches the exporting one
    // generically, and the exporting member keeps the head it must write — which
    // is the head on the block, since a member line takes no binder (#700).
    expect(
      projectDiagnostics("module Main\n\n" + "fun<a: Eq>\n" +
          "    isEven(x, n: Int): Bool = if n <= 0 then True else isOdd(x, n - 1)\n" +
          "    export isOdd(x: a, n: Int): Bool =\n" +
          "        if n <= 0 then x == x else isEven(x, n - 1)\n",
      ),
    ).toEqual([]);

    expect(
      projectDiagnostics("module Main\n\n" + "fun<a: Eq>\n" +
          "    export isEven(x: a, n: Int): Bool =\n" +
          "        if n <= 0 then x == x else isOdd(x, n - 1)\n" +
          "    isOdd(x, n: Int): Bool = if n <= 0 then False else isEven(x, n - 1)\n",
      ),
    ).toEqual([]);

    // And the annotation-free knot is not a spelling an *export* can take: the
    // Rewrite Rule's own failure is what the arm above exists to avoid.
    expect(
      projectDiagnostics("module Main\n\n" + "fun\n" +
          "    isEven(x, n: Int): Bool = if n <= 0 then True else isOdd(x, n - 1)\n" +
          "    export isOdd(x, n: Int): Bool =\n" +
          "        if n <= 0 then False else isEven(x, n - 1)\n",
      ),
    ).toContain(
      "exported function `isOdd` requires a complete signature; add type for parameter `x`",
    );
  });

  /**
   * The other family, and it is correct in kind: a sibling using a headed member
   * at a concrete type is the ordinary §7.4 failure, and `String` is a type this
   * body really does demand. Only the phantom is fenced, never this.
   */
  test("a concrete use of a headed member inside the knot keeps its own message", () => {
    expect(
      projectDiagnostics("module Main\n\n" + "fun<a: Show>\n" +
          "    alpha(x: a, n: Int): String =\n" +
          "        if n <= 0 then show(x) else beta(x, n - 1)\n" +
          "    beta(x, n: Int): String =\n" +
          '        if n <= 0 then "" else alpha("s", n - 1)\n' +
          "export let answer: String = alpha(1, 3)\n",
      ),
    ).toEqual([
      "`a` is a declared type variable, but the body requires `String`; change the " +
        "annotation to `String`, or remove it to let the type be inferred",
    ]);
  });

  /**
   * And it keeps it *after* the refusal has fired, which is why the heads stay
   * live until the component's end rather than being errored where the collision
   * reported. `r1`/`r2` collide; `r3`'s `let z: String = x` then forces the type
   * `r2`'s head still stands in, and `String` is a demand this body really makes
   * — the fence is on defaulting's proposal, never on a body's.
   *
   * The two reports are what separates this from erroring the heads at the
   * collision, which silences the second and leaves the author repairing the
   * knot only to meet the annotation error on the next compile.
   */
  test("a head errored by the refusal still reports its own body's demand", () => {
    expect(
      projectDiagnostics("module Main\n\n" + "fun\n" +
          "    r1(x: a, n: Int): String =\n" +
          "        if n <= 0 then show(x) else r2(x, n - 1)\n" +
          "    r2(x: b, n: Int): String =\n" +
          "        if n <= 0 then show(x) else r3(x, n - 1)\n" +
          "    r3(x, n: Int): String =\n" +
          "        let z: String = x\n" +
          '        if n <= 0 then "" else r1(x, n - 1)\n',
      ),
    ).toEqual([
      "`a` declared on `r1` and `b` declared on `r2` are distinct declared type variables, " +
        "but members of a recursive knot are checked together at not-yet-general types; " +
        "declare one head on the `fun` block that both members write, drop the members' own " +
        "variable annotations and let inference link the knot, or move the contract to a " +
        "non-recursive wrapper",
      "`b` is a declared type variable, but the body requires `String`; change the " +
        "annotation to `String`, or remove it to let the type be inferred",
    ]);
  });

  /**
   * The refusal is the knot's, not every annotation's: one member's own two
   * heads meeting is an ordinary collision, and the general message's advice —
   * one name in both annotations — is apt.
   */
  test("one member's own two heads keep the general message", () => {
    expect(
      projectDiagnostics("module Main\n\n" + "fun same<a>(x: a, y: a): Bool = True\n" +
          "fun cross<b, c>(x: b, y: c): Bool = same(x, y)\n",
      ),
    ).toContain(
      "`b` and `c` are distinct declared type variables, but the body requires them to be " +
        "the same; use one type variable name in both annotations, or remove an annotation " +
        "to let the type be inferred",
    );
  });

  /**
   * And *different* members' heads meeting outside any one knot. Nesting is what
   * makes this reachable: a `fun` block written inside another member's body puts
   * two components on the stack at once, both with live heads, and the inner
   * body can unify them. No recursion links `f` and `g`, they share no
   * component, and the hint's account — "members of a recursive knot" — would be
   * false of them. This is what the component test in `#knotHeadCollision`
   * decides; the same-member guard above never reaches it.
   */
  test("different members' heads outside one component keep the general message", () => {
    expect(
      projectDiagnostics("module Main\n\n" + "fun f<a>(x: a): a =\n" +
          "    fun g<b>(y: b): b = x\n" +
          "    g(x)\n",
      ),
    ).toContain(
      "`b` and `a` are distinct declared type variables, but the body requires them to be " +
        "the same; use one type variable name in both annotations, or remove an annotation " +
        "to let the type be inferred",
    );
  });

  /** A single head every sibling reaches generically is untouched, and runs. */
  test("a single head the siblings reach generically still compiles and runs", async () => {
    const exports = await runProject(
      [[
        "/main.hex",
        "module Main\n\n" + BOX +
          "fun<a: Show>\n" +
          "    alpha(x: a, n: Int): String =\n" +
          "        if n <= 0 then show(x) else beta(x, n - 1)\n" +
          "    beta(x, n: Int): String =\n" +
          '        if n <= 0 then "" else alpha(x, n - 1)\n' +
          "export let answer: String = alpha(Box({v = 7}), 2)\n",
      ]],
      { transform: distinct("recursion knot: single head") },
    );

    expect(exports["answer"]).toBe("B7");
  });
});

/**
 * The specialization planner reads the call's evidence to decide whether a site
 * can reach a monomorphic edition. With the suffix missing, a recursive call
 * inside an edition fell back to the generic definition — and to the generic
 * definition's *unsupplied* dictionary parameters.
 */
describe("editions", () => {
  test("an edition's recursive call reaches the edition", () => {
    const javascript = emitted(
      "export fun repeat<a: Show>(x: a, n: Int): String =\n" +
        '    if n <= 0 then "" else show(x) ++ repeat(x, n - 1)\n',
    );

    expect(javascript).toContain(
      'function repeatInt(x, n) {\n  return n <= 0 ? "" : __Show_Int_show(x) + repeatInt(x, n - 1);\n}',
    );
  });
});
