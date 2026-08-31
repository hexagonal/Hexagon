/**
 * Conformance for the **`fun` block** — mutual recursion's one spelling,
 * `fun`'s header-only rule, and the `var` function-type ban
 * (`spec/decisions-ml-dialect-fun-blocks-2026-08.md` §12; Functions §7.1/§7.3,
 * Modules §4.1/§4.1.1, Statements §6.1; #700).
 *
 * The machinery is `recursion-knot.test.ts`'s, and for its reason: the block's
 * whole point is to make a *constrained* knot spellable, so every claim about
 * one is pinned on **emitted JS and execution** as well as on the verdict —
 * emitted text says the dictionary argument is written, execution says the value
 * behind it is right. Executed graphs are made byte-distinct through `distinct`,
 * because emitted modules mount as `data:` URLs and the registry caches those by
 * text.
 */

import { describe, expect, test } from "vitest";

import {
  compileFiles,
  projectDiagnostics,
  runProject,
} from "../support/test-project.js";

/** Makes a graph's modules byte-distinct, so the test gets its own instances. */
function distinct(label: string): (path: string, javascript: string) => string {
  return (_path, javascript) => `// ${label}\n${javascript}`;
}

function compiled(source: string) {
  const project = compileFiles([["/main.hex", source]]);
  expect(project.diagnostics.map(({ message }) => message)).toEqual([]);
  return project.modules.find(({ source: file }) => file.path === "/main.hex")!;
}

function emitted(source: string): string {
  return compiled(source).javascript.text;
}

/**
 * A subject outside the fundamental set, so no monomorphic edition exists to
 * route a call to and the generic path — the one carrying the evidence suffix —
 * is what the assertions read. Eq only: #705 is live, so nothing here writes a
 * `Signed`-plus-`Num` shape.
 */
const BOX =
  "record Box = {v: Int}\n" +
  "honor Eq<Box> =\n" +
  "    equals(left, right) = left.v == right.v\n";

const EVEN_ODD =
  "fun\n" +
  "    even(n: Int): Bool = if n == 0 then True else odd(n - 1)\n" +
  "    odd(n: Int): Bool = if n == 0 then False else even(n - 1)\n";

describe("the block parses (§12.1)", () => {
  test("a bare head over two members", () => {
    expect(projectDiagnostics(`${EVEN_ODD}export let answer: Bool = even(4)\n`))
      .toEqual([]);
  });

  test("a binder head, annotations, and `export` members", () => {
    expect(
      projectDiagnostics(
        "fun<a: Eq>\n" +
          "    walk(x: a, y: a, n: Int): Int =\n" +
          "        if n <= 0 then 0 else if x == y then 1 + step(x, y, n - 1) else 0\n" +
          "    export search(x: a, y: a): Int = walk(x, y, 3)\n" +
          "    step(x: a, y: a, n: Int): Int = walk(x, y, n)\n",
      ),
    ).toEqual([]);
  });

  test("a single-member block, and the fused spelling beside it", () => {
    expect(
      projectDiagnostics(
        "fun\n" +
          "    twice(n: Int): Int = n * 2\n" +
          "fun thrice(n: Int): Int = n * 3\n" +
          "export let answer: Int = twice(1) + thrice(1)\n",
      ),
    ).toEqual([]);
  });

  test("blocks in inner scopes, and a block nested inside a member", () => {
    expect(
      projectDiagnostics(
        "export fun run(n: Int): Int =\n" +
          "    fun\n" +
          "        up(k: Int): Int = if k <= 0 then 0 else 1 + down(k - 1)\n" +
          "        down(k: Int): Int = if k <= 0 then 0 else up(k - 1)\n" +
          "    up(n)\n",
      ),
    ).toEqual([]);

    expect(
      projectDiagnostics(
        "fun\n" +
          "    outer(n: Int): Int =\n" +
          "        fun\n" +
          "            inner(k: Int): Int = if k <= 0 then 0 else inner(k - 1)\n" +
          "        inner(n)\n" +
          "export let answer: Int = outer(3)\n",
      ),
    ).toEqual([]);
  });

  test("two blocks back to back are two blocks, and both compile", () => {
    expect(
      projectDiagnostics(
        "fun\n" +
          "    a1(n: Int): Int = n\n" +
          "fun\n" +
          "    b1(n: Int): Int = a1(n)\n" +
          "export let answer: Int = b1(1)\n",
      ),
    ).toEqual([]);
  });
});

describe("mutual recursion through a block runs (§12.2)", () => {
  test("the even/odd pair compiles, emits two declarations, and runs", async () => {
    const javascript = emitted(
      `${EVEN_ODD}export let answer: Bool = even(4)\n`,
    );
    expect(javascript).toContain("function even(n) {");
    expect(javascript).toContain("function odd(n) {");

    const exports = await runProject(
      [["/main.hex", `${EVEN_ODD}export let answer: Bool = even(4)\n`]],
      { transform: distinct("fun block: even/odd") },
    );
    expect(exports["answer"]).toBe(true);
  });

  /**
   * The headline the block exists for: a *constrained* knot, under one head,
   * run at a ground type. Both members take the head's dictionary parameter and
   * pass it on unchanged — §7.4's identity suffix, now across a block edge.
   */
  test("a constrained knot under a binder head carries the suffix and runs", async () => {
    const source = BOX +
      "fun<a: Eq>\n" +
      "    ping(x: a, y: a, n: Int): Int =\n" +
      "        if n <= 0 then 0 else if x == y then 1 + pong(x, y, n - 1) else 0\n" +
      "    pong(x: a, y: a, n: Int): Int = ping(x, y, n)\n" +
      "export let answer: Int = ping(Box({v = 1}), Box({v = 1}), 3)\n";

    const javascript = emitted(source);
    expect(javascript).toContain("function ping(x, y, n, __Eq_a) {");
    expect(javascript).toContain("function pong(x, y, n, __Eq_a) {");
    expect(javascript).toContain("pong(x, y, n - 1, __Eq_a)");
    expect(javascript).toContain("ping(x, y, n, __Eq_a)");

    const exports = await runProject([["/main.hex", source]], {
      transform: distinct("fun block: constrained knot"),
    });
    expect(exports["answer"]).toBe(3);
  });
});

describe("the head's variable is one rigid (§12.3)", () => {
  test("two members writing `a` share it, and the knot compiles", () => {
    expect(
      projectDiagnostics(
        "fun<a: Eq>\n" +
          "    isEven(x: a, y: a, n: Int): Bool =\n" +
          "        if n <= 0 then x == y else isOdd(x, y, n - 1)\n" +
          "    isOdd(x: a, y: a, n: Int): Bool =\n" +
          "        if n <= 0 then False else isEven(x, y, n - 1)\n" +
          "export let answer: Bool = isEven(1, 1, 4)\n",
      ),
    ).toEqual([]);
  });

  /**
   * The §4.2 contract, checked per member: the head's list is one list stated
   * once, and a member whose body demands more than it is refused — naming the
   * member whose demand exceeded it, never silently strengthening the head.
   *
   * The refusal respells to the head, because that is where the repair goes: a
   * member line takes no binder list (§7.3), so the fused row's `write <a: …>`
   * would advise a spelling the next compile rejects.
   */
  test("a member whose body exceeds the head's list is refused, at the head", () => {
    // One list, stated once, checked **per member**: `left` uses the variable
    // within the head's `Eq` and says nothing, `right` demands `Show` and is
    // refused. The head is never silently strengthened.
    expect(
      projectDiagnostics(
        "fun<a: Eq>\n" +
          "    left(x: a, n: Int): String =\n" +
          '        if n <= 0 then "" else right(x, n - 1)\n' +
          "    right(x: a, n: Int): String = show(x)\n",
      ),
    ).toEqual([
      "`a` is declared to honor `Eq` on the block head, but `right`'s body requires " +
        "`Show`; widen the head: `fun<a: (Eq, Show)>`, or remove the head's constraint " +
        "to let it be inferred",
    ]);

    // And the head's own list governs: widen it as advised and the same block
    // compiles — the Rewrite Rule made checkable.
    expect(
      projectDiagnostics(
        "fun<a: (Eq, Show)>\n" +
          "    left(x: a, n: Int): String =\n" +
          '        if n <= 0 then "" else right(x, n - 1)\n' +
          "    right(x: a, n: Int): String = show(x)\n",
      ),
    ).toEqual([]);
  });

  /**
   * The member name is what makes the report actionable: the head is shared, so
   * "the body" would name nothing in a block of several. Two members under one
   * head, each exceeding it in its own way, are told apart by name.
   */
  test("the report names which member exceeded the head", () => {
    expect(
      projectDiagnostics(
        "fun<a: Eq>\n" +
          "    shows(x: a, n: Int): String =\n" +
          '        if n <= 0 then show(x) else hashes(x, n - 1)\n' +
          "    hashes(x: a, n: Int): String =\n" +
          '        if n <= 0 then "" else Int.show(hash(x))\n',
      ),
    ).toEqual([
      "`a` is declared to honor `Eq` on the block head, but `shows`'s body requires " +
        "`Show`; widen the head: `fun<a: (Eq, Show)>`, or remove the head's constraint " +
        "to let it be inferred",
      "`a` is declared to honor `Eq` on the block head, but `hashes`'s body requires " +
        "`Hash`; widen the head: `fun<a: Hash>`, or remove the head's constraint to let " +
        "it be inferred",
    ]);
  });

  /**
   * The fused spelling keeps its own wording: its binder *is* its head, so
   * `write <a: …>` is the legal repair there and the respelling would be noise.
   */
  test("the fused spelling's refusal is untouched", () => {
    expect(
      projectDiagnostics("fun right<a: Eq>(x: a, n: Int): String = show(x)\n"),
    ).toEqual([
      "`a` is declared to honor `Eq`, but the body requires `Show`; write " +
        "`<a: (Eq, Show)>`, or remove the constraint annotation to let it be inferred",
    ]);
  });

  /**
   * The converse, and the guard on §10.1's decisive rejection: under a **bare**
   * head two members writing one spelling share **nothing**. Sharing is the
   * head's alone, so a knot linking their own rigids is the ordinary
   * rigid-vs-rigid refusal — which is exactly what alternative B would have
   * silently accepted.
   */
  test("under a bare head, one spelling in two members shares nothing", () => {
    expect(
      projectDiagnostics(
        "fun\n" +
          "    isEven(x: a, n: Int): Bool =\n" +
          "        if n <= 0 then True else isOdd(x, n - 1)\n" +
          "    isOdd(x: a, n: Int): Bool =\n" +
          "        if n <= 0 then False else isEven(x, n - 1)\n",
      ),
    ).toEqual([
      "`a` declared on `isEven` and `a` declared on `isOdd` are distinct declared type " +
        "variables, but members of a recursive knot are checked together at not-yet-general " +
        "types; declare one head on the `fun` block that both members write, drop the " +
        "members' own variable annotations and let inference link the knot, or move the " +
        "contract to a non-recursive wrapper",
    ]);
  });

  /**
   * A member's own variable meeting the **head's** is the same refusal, and §10
   * says the head side is qualified by the head rather than by a name it does
   * not have.
   */
  test("a member's own variable meeting the head's names the head", () => {
    expect(
      projectDiagnostics(
        "fun<a: Eq>\n" +
          "    top(x: a, n: Int): Bool =\n" +
          "        if n <= 0 then x == x else bottom(x, n - 1)\n" +
          "    bottom(x: b, n: Int): Bool =\n" +
          "        if n <= 0 then False else top(x, n - 1)\n",
      ),
    ).toEqual([
      "`a` declared on the `fun` block head and `b` declared on `bottom` are distinct " +
        "declared type variables, but members of a recursive knot are checked together at " +
        "not-yet-general types; declare one head on the `fun` block that both members " +
        "write, or move the contract to a non-recursive wrapper",
    ]);
  });
});

describe("sharing is opt-in, and grouping bounds visibility only (§12.4)", () => {
  /**
   * A member that does not write the head's variable is untouched by it, and
   * independent members do not restrict each other's generality: `pick` is used
   * at two types below the block, which only a generalized scheme allows.
   */
  test("a member outside the knot generalizes independently", () => {
    expect(
      projectDiagnostics(
        "fun<a: Eq>\n" +
          "    same(x: a, y: a): Bool = x == y\n" +
          "    pick(x: b, y: b): b = x\n" +
          "export let one: Int = pick(1, 2)\n" +
          'export let two: String = pick("a", "b")\n' +
          "export let three: Bool = same(1, 1)\n",
      ),
    ).toEqual([]);
  });

  /**
   * "A head variable no member mentions is governed by §4.2's contract
   * machinery **exactly as on a fused `fun`**" (§7.3) — so the pin is the
   * agreement, not a verdict of its own: whatever the fused spelling says of an
   * unmentioned binder, the block says too.
   */
  test("a head variable no member mentions behaves as on a fused `fun`", () => {
    const blocked = projectDiagnostics(
      "fun<a: Eq>\n" +
        "    plain(n: Int): Int = n + 1\n" +
        "export let answer: Int = plain(1)\n",
    );
    const fused = projectDiagnostics(
      "fun plain<a: Eq>(n: Int): Int = n + 1\n" +
        "export let answer: Int = plain(1)\n",
    );
    expect(blocked).toEqual(fused);
    // The agreement has to be an agreement about something: two empty lists
    // would satisfy the line above and say nothing, and the shared verdict is
    // §4.2's contract machinery reaching a binder no body mentions.
    expect(blocked).toEqual([
      "`a` is a declared type variable, but the body requires `Int`; change the annotation " +
        "to `Int`, or remove it to let the type be inferred",
    ]);
  });
});

describe("the exported constrained knot (§12.5)", () => {
  const SOURCE = BOX +
    "fun<a: Eq>\n" +
    "    export countUp(x: a, y: a, n: Int): Int =\n" +
    "        if n <= 0 then 0 else if x == y then 1 + countDown(x, y, n - 1) else 0\n" +
    "    export countDown(x: a, y: a, n: Int): Int = countUp(x, y, n)\n";

  test("two `export` members under one head compile and emit a complete `.d.ts`", () => {
    const module = compiled(SOURCE);
    expect(module.javascript.text).toContain("function countUp(x, y, n, __Eq_a) {");
    expect(module.javascript.text).toContain("function countDown(x, y, n, __Eq_a) {");
    // Constrained exports cross as the generic definition plus its editions,
    // which is the ordinary export emission and no business of the block's.
    expect(module.javascript.text).toContain("export { countUp as __countUp };");
    expect(module.javascript.text).toContain("export { countDown as __countDown };");

    // Complete, and complete in kind: the block does not cross, so each member
    // publishes the faces an exported constrained function publishes — one per
    // fundamental specialization, both members alike.
    const declarations = module.declarations.text;
    expect(declarations).toContain(
      "export declare function countUpInt(x: number, y: number, n: number): number;",
    );
    expect(declarations).toContain(
      "export declare function countDownInt(x: number, y: number, n: number): number;",
    );
    expect(declarations).toContain(
      "export declare function countUpString(x: string, y: string, n: number): number;",
    );
    expect(declarations).toContain(
      "export declare function countDownString(x: string, y: string, n: number): number;",
    );
  });

  test("the exported knot runs at a ground type", async () => {
    const exports = await runProject(
      [[
        "/main.hex",
        `${SOURCE}export let answer: Int = countUp(Box({v = 2}), Box({v = 2}), 3)\n`,
      ]],
      { transform: distinct("fun block: exported knot") },
    );
    expect(exports["answer"]).toBe(3);
  });

  /**
   * The head's list is one written thing at one span, so Modules §4.1.1's
   * maximality check is asked of it **once per block** — not once per exporting
   * member, which repeated the report word for word at the same characters, one
   * copy per export.
   */
  test("a defective head list is reported once, however many members export", () => {
    const defective = (members: string): readonly string[] =>
      projectDiagnostics(`fun<a: (Eq, Hash)>\n${members}`);
    const report = "exported function `first` must omit base constraint `Eq` from `a`; " +
      "`Hash` already provides it";

    expect(defective("    export first(x: a): Int = hash(x)\n")).toEqual([report]);
    expect(
      defective(
        "    export first(x: a): Int = hash(x)\n" +
          "    export second(x: a): Int = hash(x)\n",
      ),
    ).toEqual([report]);
    expect(
      defective(
        "    export first(x: a): Int = hash(x)\n" +
          "    export second(x: a): Int = hash(x)\n" +
          "    export third(x: a): Int = hash(x)\n",
      ),
    ).toEqual([report]);
  });

  /**
   * The head's list is published **whole** (Modules §4.1.1): a member mentioning
   * the variable exports under every constraint the head writes, even where its
   * own body demands fewer — §4.2's deliberate-restriction reading.
   */
  test("a member demanding fewer constraints than the head still compiles", () => {
    expect(
      projectDiagnostics(
        "fun<a: Eq>\n" +
          "    export keep(x: a): a = x\n" +
          "    export compare(x: a, y: a): Bool = x == y\n",
      ),
    ).toEqual([]);
  });
});

describe("the fused spelling is the one-member block (§12.7)", () => {
  const FUSED = "fun countdown(n: Int): Int = if n <= 0 then 0 else countdown(n - 1)\n";
  const BLOCKED =
    "fun\n    countdown(n: Int): Int = if n <= 0 then 0 else countdown(n - 1)\n";

  /**
   * Blank lines aside, the emitted modules are the same text. The one
   * difference is the head's own line, which the emitter preserves as vertical
   * separation exactly as it preserves the author's blank lines — the block is
   * invisible in *code*, which is what §9's row says.
   */
  const code = (javascript: string): readonly string[] =>
    javascript.split("\n").filter((line) => line !== "");

  test("both spellings emit the same JavaScript and self-recurse", () => {
    const fused = emitted(`${FUSED}export let answer: Int = countdown(3)\n`);
    const blocked = emitted(`${BLOCKED}export let answer: Int = countdown(3)\n`);
    expect(code(blocked)).toEqual(code(fused));
    expect(fused).toContain("function countdown(n) {");
    expect(fused).toContain("countdown(n - 1)");
  });

  test("both spellings infer the same scheme, binder and all", () => {
    const scheme = (source: string): unknown => {
      const module = compiled(`${source}export let answer: Int = countdown(3)\n`);
      return module.typed.symbols.find(({ name }) => name === "countdown")?.scheme;
    };
    expect(scheme(BLOCKED)).toEqual(scheme(FUSED));

    // The binder rides the head in both spellings, and the constrained face is
    // the same one — read off the emitted evidence parameter, which is what a
    // scheme's constraint list becomes.
    const fusedEvidence = emitted(
      BOX +
        "fun tally<a: Eq>(x: a, y: a, n: Int): Int =\n" +
        "    if n <= 0 then 0 else if x == y then 1 + tally(x, y, n - 1) else 0\n" +
        "export let answer: Int = tally(Box({v = 1}), Box({v = 1}), 2)\n",
    );
    const blockedEvidence = emitted(
      BOX +
        "fun<a: Eq>\n" +
        "    tally(x: a, y: a, n: Int): Int =\n" +
        "        if n <= 0 then 0 else if x == y then 1 + tally(x, y, n - 1) else 0\n" +
        "export let answer: Int = tally(Box({v = 1}), Box({v = 1}), 2)\n",
    );
    expect(code(blockedEvidence)).toEqual(code(fusedEvidence));
  });
});

describe("emission: the block is invisible (§12.8)", () => {
  test("members emit in member order at the block's position", () => {
    const javascript = emitted(
      "let before: Int = 1\n" +
        "fun\n" +
        "    first(n: Int): Int = second(n)\n" +
        "    second(n: Int): Int = n\n" +
        "export let answer: Int = first(before)\n",
    );
    const before = javascript.indexOf("const before");
    const first = javascript.indexOf("function first(");
    const second = javascript.indexOf("function second(");
    const answer = javascript.indexOf("const answer");
    expect(before).toBeGreaterThanOrEqual(0);
    expect(first).toBeGreaterThan(before);
    expect(second).toBeGreaterThan(first);
    expect(answer).toBeGreaterThan(second);
  });

  test("an `export` member takes the ordinary export emission", () => {
    const javascript = emitted(
      "fun\n" +
        "    worker(n: Int): Int = n * 2\n" +
        "    export face(n: Int): Int = worker(n)\n",
    );
    expect(javascript).toContain("function worker(n) {");
    expect(javascript).toContain("function face(n) {");
    expect(javascript).toContain("export { face };");
    expect(javascript).not.toContain("export { worker");
  });

  test("a retired form emits nothing for the refused binding", () => {
    const project = compileFiles([["/main.hex", "fun f = (n) => n\n"]]);
    expect(project.diagnostics.map(({ message }) => message)).toEqual([
      "`fun` defines functions by header; write `fun f(n) = …`",
    ]);
    const module = project.modules.find(({ source }) => source.path === "/main.hex");
    expect(module?.javascript.text ?? "").not.toContain("function f");
    expect(module?.javascript.text ?? "").not.toContain("const f");
  });
});

describe("the diagnostics family (§12.6)", () => {
  test("the retired lambda right-hand side", () => {
    expect(projectDiagnostics("fun fact = (n) => n\n")).toContain(
      "`fun` defines functions by header; write `fun fact(n) = …`",
    );
    // Read through the pure wrappers: the same right-hand side, written two
    // other ways, is the same spelling and takes the same rewrite.
    expect(projectDiagnostics("fun identity = ((x) => x)\n")).toContain(
      "`fun` defines functions by header; write `fun identity(x) = …`",
    );
    expect(projectDiagnostics("fun identity =\n    (x) => x\n")).toContain(
      "`fun` defines functions by header; write `fun identity(x) = …`",
    );
  });

  test("the retired match-function right-hand side", () => {
    expect(
      projectDiagnostics(
        "fun size = match\n" +
          "    0 => 1\n" +
          "    _ => 2\n",
      ),
    ).toContain(
      "`fun` defines functions by header; write `fun size(x) = match x …` — a match " +
        "function stays legal on a `let` and at call sites",
    );
  });

  test("any other `fun name =`", () => {
    expect(projectDiagnostics("fun x = 5\n")).toContain(
      "`fun` defines functions by header; write `fun x(params) = …`, or bind the value " +
        "with `let`",
    );
    expect(
      projectDiagnostics("let memoize(f: (Int) -> Int): (Int) -> Int = f\nfun fib = memoize(f)\n"),
    ).toContain(
      "`fun` defines functions by header; write `fun fib(params) = …`, or bind the value " +
        "with `let`",
    );
  });

  test("the wrap rewrite on two separate `fun`s", () => {
    expect(
      projectDiagnostics(
        "fun even(n: Int): Int = odd(n - 1)\n" +
          "fun odd(n: Int): Int = even(n - 1)\n",
      ),
    ).toContain(
      "`odd` is declared later in this block; only members of one `fun` block recurse " +
        "together; wrap both definitions as its members",
    );

    // And with an item between them: adjacency is no longer load-bearing, so
    // the same program draws the same message either way.
    expect(
      projectDiagnostics(
        "fun even(n: Int): Int = odd(n - 1)\n" +
          "let gap: Int = 1\n" +
          "fun odd(n: Int): Int = even(n - 1)\n",
      ),
    ).toContain(
      "`odd` is declared later in this block; only members of one `fun` block recurse " +
        "together; wrap both definitions as its members",
    );
  });

  test("`export` before a block head", () => {
    expect(
      projectDiagnostics("export fun\n    f(n: Int): Int = n\n"),
    ).toContain("`export` marks members: put it on each member to export");

    // Below module level the per-member advice would be wrong twice over — an
    // inner block's members take no marker either — so that seat takes Modules
    // §4.1's own refusal.
    expect(
      projectDiagnostics(
        "export fun run(n: Int): Int =\n" +
          "    export fun\n" +
          "        helper(k: Int): Int = k\n" +
          "    helper(n)\n",
      ),
    ).toContain(
      "`export` marks module-level declarations; a local binding cannot be exported",
    );
  });

  test("a binder list on a member line", () => {
    expect(
      projectDiagnostics(
        "fun\n" +
          "    parse<b: Show>(x: b): String = show(x)\n",
      ),
    ).toContain(
      "members take no binder lists; declare the variable on the block head: `fun<b: Show>`",
    );
  });

  test("an empty `fun` block", () => {
    expect(projectDiagnostics("fun\nlet x: Int = 1\n")).toContain(
      "a `fun` block needs at least one member; write one, or remove the head",
    );
    expect(projectDiagnostics("fun<a: Eq>\nlet x: Int = 1\n")).toContain(
      "a `fun` block needs at least one member; write one, or remove the head",
    );
  });

  test("`export` on an inner block's member, and on a function-body binding", () => {
    expect(
      projectDiagnostics(
        "export fun run(n: Int): Int =\n" +
          "    fun\n" +
          "        export helper(k: Int): Int = k\n" +
          "    helper(n)\n",
      ),
    ).toContain(
      "`export` marks module-level declarations; a local binding cannot be exported",
    );

    expect(
      projectDiagnostics(
        "export fun run(n: Int): Int =\n" +
          "    export let k: Int = n\n" +
          "    k\n",
      ),
    ).toContain(
      "`export` marks module-level declarations; a local binding cannot be exported",
    );
  });

  /**
   * Modules §4.1.1's advice follows the spelling: a knot member writes its
   * binders on the head, so the completeness report names the head form and
   * never a per-member binder the knot would refuse.
   */
  test("the §4.1.1 advice on a knot member names the block head", () => {
    expect(
      projectDiagnostics(
        "fun\n" +
          "    export countdown(x: a, y: a, n: Int): Bool =\n" +
          "        if n <= 0 then x == y else countdown(x, y, n - 1)\n",
      ),
    ).toContain(
      "exported function `countdown` must declare every constraint in its signature; " +
        "declare the constraint on the block head: `fun<a: Eq>`",
    );

    // The fused spelling *is* the head, so its advice stays the binder form —
    // the advice follows the spelling, which is the whole of the carve-out.
    expect(
      projectDiagnostics(
        "export fun countdown(x: a, y: a, n: Int): Bool =\n" +
          "    if n <= 0 then x == y else countdown(x, y, n - 1)\n",
      ),
    ).toContain(
      "exported function `countdown` must declare every constraint in its signature; " +
        "write `<a: Eq>`",
    );
  });

  test("a doc comment on the block head documents nothing", () => {
    expect(
      projectDiagnostics(
        "(** The pair. *)\n" +
          "fun\n" +
          "    up(n: Int): Int = n\n",
      ),
    ).toContain(
      "documentation attaches to a `fun` block's members, not to the block — move it " +
        "above the member it describes, or make it an ordinary comment (`(* ... *)`).",
    );
  });

  test("a doc comment on a member attaches to that member", () => {
    // Doc Comments §4.2: attachment is per member, through the `export` marker
    // exactly as through a declaration's — and it reaches both emitted seats.
    const module = compiled(
      "fun\n" +
        "    (** Doubles. *)\n" +
        "    export up(n: Int): Int = n * 2\n" +
        "    (** Halves. *)\n" +
        "    export down(n: Int): Int = n + 2\n",
    );
    expect(module.javascript.text).toContain("/** Doubles. */\nfunction up(n) {");
    expect(module.javascript.text).toContain("/** Halves. */\nfunction down(n) {");
    expect(module.declarations.text).toContain("/** Doubles. */\nexport declare function up(");
    expect(module.declarations.text).toContain("/** Halves. */\nexport declare function down(");
  });

  test("a dot call cannot target the caller's own block", () => {
    expect(
      projectDiagnostics(
        "export record Box2 = {value: Int}\n" +
          "fun\n" +
          "    export twice(b: Box2): Int = b.value * 2\n" +
          "    export once(b: Box2): Int = b.twice()\n",
      ),
    ).toContain(
      "a dot call cannot target its own `fun` block; spell the call by name: `twice(b)`",
    );
  });
});

describe("`var` may not have a function type (§7, §12.6)", () => {
  test("at the declaration, annotated and inferred alike", () => {
    expect(
      projectDiagnostics(
        "export fun run(n: Int): Int =\n" +
          "    var step: (Int) -> Int = (k) => k\n" +
          "    step(n)\n",
      ),
    ).toContain(
      "`step` is a `var`, and a `var` cannot hold a function — vars accumulate data; " +
        "model changing behavior as a union and `match` on it",
    );

    expect(
      projectDiagnostics(
        "export fun run(n: Int): Int =\n" +
          "    var step = (k: Int) => k\n" +
          "    step(n)\n",
      ),
    ).toContain(
      "`step` is a `var`, and a `var` cannot hold a function — vars accumulate data; " +
        "model changing behavior as a union and `match` on it",
    );
  });

  /**
   * The leaky speed bump the type-level rule replaces: no lambda is written at
   * the `var` at all, and the ban still fires because the *type* is an arrow.
   */
  test("`var f = identity(x => x)` does not walk past it", () => {
    expect(
      projectDiagnostics(
        "let identity(f: (Int) -> Int): (Int) -> Int = f\n" +
          "export fun run(n: Int): Int =\n" +
          "    var f = identity(x => x)\n" +
          "    f(n)\n",
      ),
    ).toContain(
      "`f` is a `var`, and a `var` cannot hold a function — vars accumulate data; " +
        "model changing behavior as a union and `match` on it",
    );
  });

  /** The other arm: the monotype is unsolved at the declaration, and a later
   * use settles it to an arrow. The report lands at that use. */
  test("at the pinning use", () => {
    expect(
      projectDiagnostics(
        "let nothing<a>(): Vector(a) = []\n" +
          "export fun run(n: Int): Int =\n" +
          "    var slot = Vector.at(nothing(), 0)\n" +
          "    slot := (k: Int) => k\n" +
          "    n\n",
      ),
    ).toContain(
      "`slot` is a `var`, and a `var` cannot hold a function — vars accumulate data; " +
        "model changing behavior as a union and `match` on it",
    );
  });

  test("functions inside data stay legal", () => {
    expect(
      projectDiagnostics(
        "let onOpen(n: Int): Int = n\n" +
          "let onClose(n: Int): Int = n + 1\n" +
          "export fun run(n: Int): Int =\n" +
          "    var handlers = [onOpen, onClose]\n" +
          "    handlers := [onClose, onOpen]\n" +
          "    Vector.length(handlers) + n\n",
      ),
    ).toEqual([]);

    expect(
      projectDiagnostics(
        "let onOpen(n: Int): Int = n\n" +
          "export fun run(n: Int): Int =\n" +
          "    var slot = {handle = onOpen}\n" +
          "    slot.handle(n)\n",
      ),
    ).toEqual([]);
  });

  test("an ordinary data `var` is untouched", () => {
    expect(
      projectDiagnostics(
        "export fun run(n: Int): Int =\n" +
          "    var total = 0\n" +
          "    total := total + n\n" +
          "    total\n",
      ),
    ).toEqual([]);
  });
});
