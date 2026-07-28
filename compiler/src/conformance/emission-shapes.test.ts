/**
 * Conformance for emitted-JavaScript shapes that typecheck cleanly but can be
 * mis-parsed or mis-executed by JavaScript itself. Each case executes the
 * emitted module, so a wrong shape shows up as a wrong value rather than as a
 * text mismatch.
 */
import { describe, expect, test } from "vitest";

import * as Source from "../support/source.js";
import { lex } from "../passes/lexer/lexer.js";
import { applyLayout } from "../passes/layout/layout.js";
import { parse } from "../passes/parser/parser.js";
import { resolve } from "../passes/resolver/resolver.js";
import { check } from "../passes/checker/checker.js";
import { elaborate } from "../passes/elaborator/elaborator.js";
import { emitJavaScript } from "../passes/emitter/emitter.js";

async function run(source: string): Promise<Record<string, unknown>> {
  const file = new Source.File(Source.fileId(0), "/probe.hex", source);
  const resolved = resolve(parse(applyLayout(lex(file))), {});
  expect(resolved.diagnostics).toEqual([]);
  const typed = check(resolved);
  expect(typed.diagnostics).toEqual([]);
  const javascript = emitJavaScript(elaborate(typed));
  expect(javascript.diagnostics).toEqual([]);
  const url = `data:text/javascript;charset=utf-8,${encodeURIComponent(javascript.text)}`;
  return (await import(/* @vite-ignore */ url)) as Record<string, unknown>;
}

// Proves this file's harness can observe a failure: a harness that silently
// swallowed diagnostics would report every case below as green regardless of
// what the compiler did.
test("the harness reports a broken module rather than passing it", async () => {
  await expect(run("export let broken: Int = missing(1)\n")).rejects.toThrow();
});

describe("concise arrow bodies", () => {
  test("a lambda returning a record returns the record, not undefined", async () => {
    // A record construction inlines to its literal (the constructor is the
    // identity), so a concise arrow body would begin with `{` and be read as a
    // block.
    const m = await run(
      "record Box = { value: Int }\n" +
        "let wrapper: Int -> Box = value => Box({ value = value })\n" +
        "export let out: Int = (wrapper(7)).value\n",
    );
    expect(m.out).toBe(7);
  });

  test("a record-returning lambda passed as an argument behaves the same", async () => {
    const m = await run(
      "record Box = { value: Int }\n" +
        "let apply(transform: Int -> Box, value: Int): Box = transform(value)\n" +
        "export let out: Int = (apply(value => Box({ value = value }), 9)).value\n",
    );
    expect(m.out).toBe(9);
  });
});

describe("statement-position match", () => {
  const MAYBE = "union Maybe =\n    | Nothing\n    | Just(value: Int)\n";

  test("a matched arm does not fall through into the next arm", async () => {
    // Unit-valued arms emit statements rather than a `return`, so the switch
    // needs a `break` to stop control reaching the next arm's destructuring.
    const m = await run(
      MAYBE +
        "let pick(source: Maybe): Int =\n" +
        "    var result = 0\n" +
        "    match source\n" +
        "        Nothing => result := 1\n" +
        "        Just(value) => result := value\n" +
        "    result\n" +
        "export let nothingCase: Int = pick(Nothing)\n" +
        "export let justCase: Int = pick(Just(9))\n",
    );
    expect(m.nothingCase).toBe(1);
    expect(m.justCase).toBe(9);
  });

  test("a loop-valued arm does not fall through either", async () => {
    const m = await run(
      MAYBE +
        "let count(source: Maybe): Int =\n" +
        "    var total = 0\n" +
        "    match source\n" +
        "        Just(limit) =>\n" +
        "            for step in 1..limit\n" +
        "                total := total + step\n" +
        "        Nothing => total := 0 - 1\n" +
        "    total\n" +
        "export let summed: Int = count(Just(4))\n" +
        "export let missing: Int = count(Nothing)\n",
    );
    expect(m.summed).toBe(10);
    expect(m.missing).toBe(-1);
  });

  // A `match` that cannot lower to a `switch` — a tuple pattern here — becomes
  // an `if`-chain closed by an unreachable-pattern `throw`. A `Unit`-valued arm
  // emits statements, so without a `return` control runs on through every later
  // arm and into that `throw`.
  test("an if-chain arm does not fall through into the later arms", async () => {
    const m = await run(
      "let pick(pair: (Int, Int)): Int =\n" +
        "    var result = 0\n" +
        "    match pair\n" +
        "        (0, second) => result := second\n" +
        "        (first, _) => result := first\n" +
        "    result\n" +
        "export let firstArm: Int = pick((0, 7))\n" +
        "export let secondArm: Int = pick((5, 7))\n",
    );
    expect(m.firstArm).toBe(7);
    expect(m.secondArm).toBe(5);
  });

  test("a conditional-valued if-chain arm does not fall through either", async () => {
    const m = await run(
      "let pick(pair: (Int, Int)): Int =\n" +
        "    var result = 0\n" +
        "    match pair\n" +
        "        (0, second) => if second > 0 then result := second\n" +
        "        (first, _) => result := first\n" +
        "    result\n" +
        "export let branchTaken: Int = pick((0, 7))\n" +
        "export let branchSkipped: Int = pick((0, 0 - 7))\n" +
        "export let secondArm: Int = pick((5, 7))\n",
    );
    expect(m.branchTaken).toBe(7);
    expect(m.branchSkipped).toBe(0);
    expect(m.secondArm).toBe(5);
  });
});

describe("statement-position conditionals", () => {
  test("an else-less conditional runs its branch and skips it otherwise", async () => {
    const m = await run(
      "let classify(value: Int): Int =\n" +
        "    var result = 0\n" +
        "    if value > 0 then result := 1\n" +
        "    result\n" +
        "export let taken: Int = classify(3)\n" +
        "export let untaken: Int = classify(0 - 3)\n",
    );
    expect(m.taken).toBe(1);
    expect(m.untaken).toBe(0);
  });

  test("an `else if` chain picks exactly one branch", async () => {
    const m = await run(
      "let sign(value: Int): Int =\n" +
        "    var result = 99\n" +
        "    if value < 0 then\n" +
        "        result := 0 - 1\n" +
        "    else if value == 0 then\n" +
        "        result := 0\n" +
        "    else\n" +
        "        result := 1\n" +
        "    result\n" +
        "export let negative: Int = sign(0 - 4)\n" +
        "export let zero: Int = sign(0)\n" +
        "export let positive: Int = sign(4)\n",
    );
    expect(m.negative).toBe(-1);
    expect(m.zero).toBe(0);
    expect(m.positive).toBe(1);
  });

  // A block arm flattens into the braces the `if` already needs, rather than
  // staying an IIFE. Its own bindings must survive the move, and its final
  // item must not emit the `return` the IIFE wanted — that would return from
  // the enclosing function and skip everything after the conditional.
  test("a block arm flattens without returning from the enclosing function", async () => {
    const m = await run(
      "let compute(flag: Bool): Int =\n" +
        "    var result = 0\n" +
        "    if flag then\n" +
        "        let taken = 1\n" +
        "        result := result + taken\n" +
        "        result := result + taken\n" +
        "    else\n" +
        "        let skipped = 10\n" +
        "        result := result + skipped\n" +
        "    result := result + 100\n" +
        "    result\n" +
        "export let branchTaken: Int = compute(true)\n" +
        "export let branchSkipped: Int = compute(false)\n",
    );
    expect(m.branchTaken).toBe(102);
    expect(m.branchSkipped).toBe(110);
  });

  // The conditional is the function's tail: emitting it as a statement leaves
  // the function falling off its end, which must still produce `Unit` — and
  // must still run the branch. A `throw` in the taken branch makes both halves
  // observable from outside the function.
  test("a conditional in tail position runs its branch and still yields Unit", async () => {
    const m = await run(
      "exception Marked\n" +
        "let guard(flag: Bool): Unit =\n" +
        "    if flag then throw(Marked)\n" +
        "let attempt(flag: Bool): Int =\n" +
        "    try\n" +
        "        guard(flag)\n" +
        "        0\n" +
        "    catch\n" +
        "        Marked => 1\n" +
        "export let taken: Int = attempt(true)\n" +
        "export let untaken: Int = attempt(false)\n",
    );
    expect(m.taken).toBe(1);
    expect(m.untaken).toBe(0);
  });

  test("a nested conditional inside a branch keeps both conditions", async () => {
    const m = await run(
      "let both(left: Bool, right: Bool): Int =\n" +
        "    var result = 0\n" +
        "    if left then\n" +
        "        if right then\n" +
        "            result := 2\n" +
        "        result := result + 1\n" +
        "    result\n" +
        "export let neither: Int = both(false, false)\n" +
        "export let outerOnly: Int = both(true, false)\n" +
        "export let inner: Int = both(true, true)\n",
    );
    expect(m.neither).toBe(0);
    expect(m.outerOnly).toBe(1);
    expect(m.inner).toBe(3);
  });

  test("a conditional in a loop body does not escape the loop", async () => {
    const m = await run(
      "let evens(limit: Int): Int =\n" +
        "    var total = 0\n" +
        "    var step = 0\n" +
        "    while step < limit\n" +
        "        step := step + 1\n" +
        "        if Int.mod(step, 2) == 0 then total := total + step\n" +
        "    total\n" +
        "export let summed: Int = evens(6)\n",
    );
    expect(m.summed).toBe(12);
  });

  // Value position is untouched: the ternary still produces a value, including
  // when the value happens to be `Unit`.
  test("a value-position conditional still produces its value", async () => {
    const m = await run(
      "let pick(flag: Bool): Int = if flag then 1 else 2\n" +
        "export let taken: Int = pick(true)\n" +
        "export let untaken: Int = pick(false)\n",
    );
    expect(m.taken).toBe(1);
    expect(m.untaken).toBe(2);
  });
});
