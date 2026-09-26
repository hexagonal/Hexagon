import { beforeAll, describe, expect, test } from "vitest";

import { type CompiledProject } from "../project.js";
import { compileMain } from "../support/test-project.js";

/**
 * A long arithmetic chain compiles in time linear in its length (#1072).
 *
 * Each level of a left-nested chain once materialized its operands twice in the
 * checker and emitted them twice in the emitter, so every term doubled the
 * work: 22 terms took seconds and 100 never finished. A compile is synchronous,
 * so no test timeout can interrupt one; the guard is a chain long enough that
 * either doubling takes seconds, against a bound a hundred times what the
 * linear walk needs once the standard library is built. A refused tree's
 * values are gathered in one array rather than copied at every level; that
 * takes its path from cubic to quadratic, which no chain this short can show,
 * so it has no guard here.
 */

const HEADER = "module Main\n\nlet n: Int = 3\nlet f: Float = 1.5\nlet price: Dec = 2.50d\n";
const TERMS = 24;
const BOUND_MS = 2_000;
const chain = (operator = " + "): string => Array.from({ length: TERMS }, () => "n").join(operator);

/** The compiled project, and how long its compile took. */
function timed(source: string): { readonly project: CompiledProject; readonly ms: number } {
  const started = Date.now();
  const project = compileMain(HEADER + source);
  return { project, ms: Date.now() - started };
}

const messages = (project: CompiledProject): readonly string[] =>
  project.diagnostics.map(({ message }) => message);

const mainText = (project: CompiledProject): string =>
  project.modules.find(({ name }) => name === "Main")!.javascript.text;

// The standard library is built once per worker; timed compiles measure the chain.
beforeAll(() => {
  compileMain(HEADER);
});

describe("a long arithmetic chain compiles in linear time", () => {
  test("at a primitive, where the emitter inlines the operator", () => {
    const { project, ms } = timed(`let x = ${chain()}\n`);
    expect(messages(project)).toEqual([]);
    expect(ms).toBeLessThan(BOUND_MS);
    const line = mainText(project).split("\n").find((text) => text.includes("const x ="))!;
    expect(line.match(/n \+ /gu)).toHaveLength(TERMS - 1);
  });

  test("under a written face, and through a member's dictionary", () => {
    for (const source of [`let x: Float = ${chain()}\n`, `let x = price * ${chain(" * ")}\n`]) {
      const { project, ms } = timed(source);
      expect(messages(project), source).toEqual([]);
      expect(ms, source).toBeLessThan(BOUND_MS);
    }
  });

  test("refused once where its face declines", () => {
    const { project, ms } = timed(`let x: Dec = f + ${chain()}\n`);
    expect(messages(project)).toEqual([
      "`f` is a `Float` and cannot enter `Dec`, so the addition could not run at `Dec`",
    ]);
    expect(ms).toBeLessThan(BOUND_MS);
  });
});

describe("an operator's operands are emitted once", () => {
  test("so an operand's fresh names are not spent twice", () => {
    const { project } = timed(
      "let x =\n    (try n\n    catch\n        _ => n) + (try 0\n    catch\n        _ => 0)\n",
    );
    expect(messages(project)).toEqual([]);
    const text = mainText(project);
    expect(text).toContain("catch (__error)");
    expect(text).toContain("catch (__error_1)");
    expect(text).not.toContain("__error_2");
  });

  test("so a refused program imports nothing for an operation it never emits", () => {
    const { project } = timed(
      "fun\n" +
        "    b(x: u, go: Bool): Int =\n" +
        "        let y = FromBigInt.fromBigInt(5n) + x\n" +
        "        if go then a(3n, False) else 1\n" +
        "    a(n: BigInt, flag: Bool): Int = if flag then b(n, False) else 0\n" +
        "export let r: Int = a(3n, True)\n",
    );
    expect(messages(project)).toHaveLength(1);
    expect(mainText(project)).not.toContain("FromBigInt");
  });

  test("left operand first, at a shift as at every operator", () => {
    // Emission order is the order hoisted evidence is interned in.
    const { project } = timed(
      "constraint Size<a> =\n    size(value: a) -> Int\n" +
        "honor Size<Int> =\n    size(value) = value\n" +
        "constraint Big<a> =\n    big(value: a) -> BigInt\n" +
        "honor Big<Int> =\n    big(value) = 1n\n" +
        "record Box(a) = {value: a}\n" +
        "honor<a: Size> Size<Box(a)> =\n    size(box) = box.value.size() + 1\n" +
        "honor<a: Big> Big<Box(a)> =\n    big(box) = box.value.big() + 1n\n" +
        "export let g(a: Bool, k: Int): BigInt =\n" +
        "    big(Box({value = k})).shiftLeft(size(Box({value = Box({value = k})})))\n",
    );
    expect(messages(project)).toEqual([]);
    const text = mainText(project);
    const big = text.indexOf("__Big_Box_Int");
    expect(big).toBeGreaterThan(-1);
    expect(big).toBeLessThan(text.indexOf("__Size_Box_Int"));
  });
});
