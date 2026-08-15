/**
 * Conformance for Dictionary Sharing §9.1's literal-member rule and §11
 * obligation 7 (#425, item C).
 *
 * The rule is a **spelling** rule: where the emitter itself builds a derived
 * dictionary literal and the surrounding expression immediately selects one
 * member and applies it, the emitted text is the member's body with the
 * arguments substituted — selection out of a literal whose construction
 * evaluates nothing (Constraints §6.3), then beta-reduction of the arrow. No
 * evidence changes: the same instance is selected, hoisting and the letrec are
 * untouched, and every assertion here that pins text also runs the program.
 *
 * The guard is where the correctness lives, so the refusals are pinned as hard
 * as the reductions. A reduction moves an argument expression from argument
 * position — where it is evaluated once, before the member body runs — into the
 * body, so it may fire only where the body reads each parameter exactly once,
 * in parameter order, and in a position the body evaluates once and
 * unconditionally. `Vector`'s `equals` reads its left operand twice, `Unit`'s
 * `show` reads its operand not at all, and both refuse: a reduction there would
 * duplicate or drop an effectful argument's evaluation, silently.
 *
 * §9.1's graduation (#446) changed what a refusal falls back *to*, and nothing
 * about when it fires. At a **ground** shape the dictionary is now §3.4's
 * module-level binding and the refused site reads its member off that
 * (`__Show_Unit.show(value)`); the inline literal survives only where a free
 * component keeps the dictionary unhoistable. So the refusal pins below assert
 * the binding shape, and the reduction pins are untouched — that separation is
 * the point of obligation 7's amendment.
 *
 * Every graph below is byte-distinct, and deliberately so: emitted modules
 * mount as `data:` URLs cached by their full text, so two tests compiling the
 * same program would share one module instance — and one probe collector.
 */

import { describe, expect, test } from "vitest";

import { compileFiles, runProject } from "../support/test-project.js";

/** `/main.hex`'s emitted JavaScript, with the project asserted clean. */
function emitted(source: string): string {
  const project = compileFiles([["/main.hex", source]]);
  expect(project.diagnostics.map(({ message }) => message)).toEqual([]);
  return project.modules.find(({ source: file }) => file.path === "/main.hex")!
    .javascript.text;
}

/**
 * Makes a graph's modules byte-distinct, so each probing test gets its own
 * `stdlib/Debug.hex` instance rather than the first loader's captured sink.
 */
function distinct(label: string): (path: string, javascript: string) => string {
  return (_path, javascript) => `// ${label}\n${javascript}`;
}

/**
 * The sink `stdlib/Debug.hex`'s probe writes to, reached off `globalThis`
 * because `lib` is `ES2024` and declares no console.
 */
const host = globalThis as unknown as {
  console: { log: (...values: unknown[]) => void };
};

/** What the probe wrote while `body` ran, with the global restored after. */
async function written(body: () => Promise<void>): Promise<unknown[]> {
  const lines: unknown[] = [];
  const original = host.console.log;
  host.console.log = (...values: unknown[]) => {
    lines.push(values[0]);
  };
  try {
    await body();
  } finally {
    host.console.log = original;
  }
  return lines;
}

describe("the headline: `Show<Bool>` selected and applied in place", () => {
  const source = 'export let flag: Bool = 1 == 1\n' +
    'export let line: String = "Does 1 = 1? ${flag}"\n';

  test("the literal is gone and the ternary keeps its parentheses", () => {
    const javascript = emitted(source);

    // The whole rule in one line: no record is built, and the ternary that
    // replaces it is parenthesized inside the concatenation.
    expect(javascript).toContain(
      'const line = "Does 1 = 1? " + (flag ? "True" : "False");',
    );
    expect(javascript).not.toContain("({ show:");
    expect(javascript).not.toContain(".show(");
  });

  /**
   * The parentheses, behaviourally. `+` binds tighter than `?:`, so a bare
   * ternary here reads the accumulated string prefix as its condition and the
   * answer becomes `"True"` — the whole value, silently wrong, which is the
   * hazard the emitter's `Bool` `Show` arm memorializes. This assertion fails
   * on that regression where a text pin might be edited to match it.
   */
  test("the concatenation answers the string, not the condition", async () => {
    const module = await runProject([["/main.hex", source]]);

    expect(module["line"]).toBe("Does 1 = 1? True");
  });
});

describe("structural evidence reduces where the guard allows it", () => {
  /**
   * `show` at a `Vector` reads its operand once, to spread it. The literal is
   * the emitter's own, selected in place, so the body stands where the call
   * did — parenthesized, because it is a `+`-chain landing in a `+`-chain.
   */
  test("`show` at a `Vector` becomes the body", async () => {
    const source = 'export let text: String = "v = ${[1, 2, 3]}"\n';
    const javascript = emitted(source);

    expect(javascript).toContain(
      'const text = "v = " + ("[" + [...__vectorOf([1, 2, 3])]',
    );
    expect(javascript).not.toContain("({ show:");

    expect((await runProject([["/main.hex", source]]))["text"])
      .toBe("v = [1, 2, 3]");
  });

  /**
   * A one-field record's structural `equals` reads each operand once, in
   * order, so both arguments are substituted where they stood. The record
   * literals gain the parentheses their new position needs — `{…}.n` at the
   * head of an expression is a block, not a field read.
   */
  test("`equals` at a one-field record becomes the comparison", async () => {
    const source = "export let same: Bool = {n = 1} == {n = 1}\n" +
      "export let differ: Bool = {n = 1} == {n = 2}\n";
    const javascript = emitted(source);

    expect(javascript).toContain(
      "const same = (({ n: 1 }).n === ({ n: 1 }).n);",
    );
    expect(javascript).not.toContain("({ equals:");

    const module = await runProject([["/main.hex", source]]);
    expect(module["same"]).toBe(true);
    expect(module["differ"]).toBe(false);
  });
});

describe("the guard refuses, and the selection reads off the binding", () => {
  /**
   * §11 obligation 7's twice-read member. A tuple's `equals` reads `__left`
   * once per element, so substituting would evaluate the left operand twice —
   * for `(f(), g()) == …`, twice as many effects as the program has.
   *
   * What the refusal falls back *to* moved with §9.1's graduation (#446): the
   * dictionary is ground, so it is Dictionary Sharing §3.4's module-level
   * binding and the selection is read off it. The reduction's own conditions
   * are unchanged — this site declines for exactly the reason it always did.
   */
  test("a body that reads a parameter twice reads the member off the binding", async () => {
    const source = "export let same: Bool = (1, 2) == (1, 2)\n" +
      "export let differ: Bool = (1, 2) == (1, 3)\n";
    const javascript = emitted(source);

    expect(javascript).toContain(
      "const __Eq_Int_Int = ({ equals: (__left, __right) => " +
        "__left[0] === __right[0] && __left[1] === __right[1],",
    );
    expect(javascript).toContain("const same = __Eq_Int_Int.equals([1, 2], [1, 2]);");
    expect(javascript).toContain("const differ = __Eq_Int_Int.equals([1, 2], [1, 3]);");
    // §11 obligation 8's negative half at a declining site: the literal is the
    // binding's initializer and appears nowhere else.
    expect(javascript).not.toContain("}).equals(");

    const module = await runProject([["/main.hex", source]]);
    expect(module["same"]).toBe(true);
    expect(module["differ"]).toBe(false);
  });

  /**
   * The clauses no count can see. `compare` at a `Vector` zips two iterators,
   * and it takes the **right** operand's iterator before it walks the left one
   * — so each parameter occurs exactly once, and yet substituting would
   * evaluate `f() < g()`'s operands right to left, with the iterator call
   * completing between them. Both remaining clauses refuse it independently:
   * the occurrences read backwards (order), and the left one sits behind a
   * completed call (position). Reordering effects the source never wrote is
   * what they are for.
   */
  test("occurrences that read out of parameter order read off the binding", async () => {
    const source = "export let less: Bool = [1, 2] < [1, 3]\n" +
      "export let more: Bool = [1, 3] < [1, 2]\n";
    const javascript = emitted(source);

    expect(javascript).toContain(
      "const __Ord_Vector_Int = ({ compare: (__left, __right) => (() => { " +
        "const __rightStep = __right[Symbol.iterator]();",
    );
    expect(javascript).toContain(
      "const less = __Ord_Vector_Int.compare(__vectorOf([1, 2]), __vectorOf([1, 3])) === \"Less\";",
    );
    expect(javascript).not.toContain("}).compare(");

    const module = await runProject([["/main.hex", source]]);
    expect(module["less"]).toBe(true);
    expect(module["more"]).toBe(false);
  });

  /**
   * And the other end of the same clause: `show` at `Unit` (#159's arity-0
   * tuple) names its operand *nowhere*, so a reduction would drop the
   * argument's evaluation entirely. The refusal stands and the operand is still
   * handed to the member — read, since #446, off the §3.4 binding, which is the
   * exact shape §3.4's last paragraph spells out.
   */
  test("a body that never reads its parameter reads the member off the binding", async () => {
    const source = 'export let text: String = "u = ${()}"\n';
    const javascript = emitted(source);

    expect(javascript).toContain('const __Show_Unit = ({ show: __value => "()" });');
    expect(javascript).toContain('const text = "u = " + __Show_Unit.show(undefined);');
    expect(javascript).not.toContain("}).show(");

    expect((await runProject([["/main.hex", source]]))["text"]).toBe("u = ()");
  });

  /**
   * The dropping clause, behaviourally: a `Unit`-valued operand with an effect
   * in it must still run. This is the assertion the text pin above cannot
   * make — a reduction to the constant `"()"` matches the answer exactly and
   * loses only the probe line.
   */
  test("the refused shape still evaluates its operand", async () => {
    const lines = await written(async () => {
      const module = await runProject([["/main.hex",
        "let mark(label: String): Unit =\n" +
          "    log(label)\n" +
          "    ()\n" +
          'export let text(): String = "u = ${mark("unit-operand")}"\n',
      ]], { transform: distinct("unit-operand") });
      expect((module["text"] as () => string)()).toBe("u = ()");
    });

    expect(lines).toEqual(["unit-operand"]);
  });
});

describe("what the rule does not reach", () => {
  /**
   * A whole record passed as trailing evidence to a polymorphic call is
   * genuinely needed: `Iterable`'s exported `toSeq` takes a dictionary, not a
   * member. Nothing selects a member here, so nothing reduces.
   *
   * §11 obligation 7's amendment (#446) says what it *does* take at a ground
   * shape: the §3.4 binding, by name. The pin is on the call's argument and not
   * merely on the literal's presence — the literal is still in the module, as
   * the binding's initializer, so a `toContain` on it alone can no longer fail.
   */
  test("trailing evidence to a polymorphic call takes the §3.4 binding", async () => {
    const source = "export let length(): Int = Seq.length(toSeq([1, 2, 3]))\n";
    const javascript = emitted(source);

    expect(javascript).toContain(
      "const __Iterable_Vector_Int = ({ toSeq: __seqFromIterable });",
    );
    expect(javascript).toContain(
      "toSeq(__vectorOf([1, 2, 3]), __Iterable_Vector_Int)",
    );
    expect(javascript).not.toContain("toSeq(__vectorOf([1, 2, 3]), ({");

    const module = await runProject([["/main.hex", source]]);
    expect((module["length"] as () => number)()).toBe(3);
  });

  /**
   * §9.1's bare-function-reference clause: a member that is not an arrow takes
   * the **selection** alone. `Concat<Vector(a)>`'s slot is the trie operation
   * itself (Operators §7), so `++` at a `Vector` emits the runtime call it
   * always meant, with no record between.
   */
  test("a bare-reference member takes the selection alone", async () => {
    const source =
      "export let joined: Vector(Int) = [1, 2] ++ [3]\n" +
      "export let size: Int = Vector.length(joined)\n";
    const javascript = emitted(source);

    expect(javascript).toContain(
      "const joined = __trieConcat(__vectorOf([1, 2]), __vectorOf([3]));",
    );
    expect(javascript).not.toContain("({ concat:");

    const module = await runProject([["/main.hex", source]]);
    expect(module["size"]).toBe(3);
  });
});

/**
 * The property the guard exists for, measured rather than reasoned about: in
 * the unreduced shape the arguments are evaluated once each, left to right,
 * before the body runs, and the reduction must not change that.
 */
describe("a reduced site evaluates its arguments exactly once, in order", () => {
  test("one argument, one effect", async () => {
    const lines = await written(async () => {
      const module = await runProject([["/main.hex",
        "let audit(label: String): Bool =\n" +
          "    log(label)\n" +
          "    True\n" +
          'export let line(): String = "answer: ${audit("once")}"\n',
      ]], { transform: distinct("argument-once") });
      expect((module["line"] as () => string)()).toBe("answer: True");
    });

    expect(lines).toEqual(["once"]);
  });

  test("two arguments, in the order the source wrote them", async () => {
    const lines = await written(async () => {
      const module = await runProject([["/main.hex",
        "let stamp(label: String): Int =\n" +
          "    log(label)\n" +
          "    1\n" +
          "export let same(): Bool =\n" +
          '    {n = stamp("left")} == {n = stamp("right")}\n',
      ]], { transform: distinct("argument-order") });
      expect((module["same"] as () => boolean)()).toBe(true);
    });

    expect(lines).toEqual(["left", "right"]);
  });
});
