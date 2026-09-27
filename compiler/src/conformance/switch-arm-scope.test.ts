import { describe, expect, test } from "vitest";

import { compileMain, runMain } from "../support/test-project.js";

/**
 * Conformance for **a `switch` arm's scope** (#367, Unions §6.3).
 *
 * Each Hexagon `match` arm's binders belong to that arm alone. JavaScript scopes
 * every `case` clause's declarations to the whole `switch`, so an arm lowered as
 * a bare `case` shares its `const`s with every other arm. Two arms binding one
 * name then fail to load, and an arm shadowing an outer name hides it from the
 * other arms, whose reads of it land in the declaration's dead zone. An arm that
 * declares anything therefore takes a block of its own, as a person writes it;
 * an arm that declares nothing stays bare.
 *
 * Every shape here is executed: the failures this guards are a module that will
 * not load and a path that throws, neither of which the text alone can show.
 */

function javascript(source: string): string {
  const project = compileMain("module Main\n\n" + source);
  expect(project.diagnostics.map(({ message }) => message)).toEqual([]);
  const main = project.modules.find(({ name }) => name === "Main");
  if (main === undefined) throw new Error("Main was not emitted");
  return main.javascript.text;
}

async function run(source: string): Promise<Record<string, unknown>> {
  return runMain("module Main\n\n" + source);
}

const SHAPE = "export union Shape = Circle(size: Int) | Square(size: Int) | Dot\n\n";

type Shape = { readonly tag: string; readonly size?: number };
const circle = (size: number): Shape => ({ tag: "Circle", size });
const square = (size: number): Shape => ({ tag: "Square", size });
const dot: Shape = { tag: "Dot" };

describe("an arm that declares is a block of its own", () => {
  test("two arms binding one name load and run", async () => {
    const source = SHAPE +
      "export let area(s: Shape): Int = match s\n" +
      "    Circle(size) => size * 3\n" +
      "    Square(size) => size * size\n" +
      "    Dot => 0\n";
    const text = javascript(source);

    expect(text).toContain(
      '    case "Circle": {\n      const size = __match.size;\n      return size * 3;\n    }\n',
    );
    expect(text).toContain(
      '    case "Square": {\n      const size = __match.size;\n      return size * size;\n    }\n',
    );
    // Declaring nothing, it stays bare.
    expect(text).toContain('    case "Dot":\n      return 0;\n');

    const module = await run(source);
    const area = module["area"] as (s: Shape) => number;
    expect(area(circle(2))).toBe(6);
    expect(area(square(3))).toBe(9);
    expect(area(dot)).toBe(0);
  });

  test("an arm's binder does not hide an outer name from the other arms", async () => {
    const source = SHAPE +
      "export let pick(size: Int, s: Shape): Int = match s\n" +
      "    Circle(size) => size\n" +
      "    Square(_) => size\n" +
      "    Dot => 0 - size\n" +
      "\n" +
      "export let fallback(other: Int, s: Shape): Int = match s\n" +
      "    Circle(_) => other\n" +
      "    other => 0\n";
    const text = javascript(source);

    expect(text).toContain('    case "Square":\n      return size;\n');
    expect(text).toContain("    default: {\n      const other = __match;\n      return 0;\n    }\n");

    const module = await run(source);
    const pick = module["pick"] as (size: number, s: Shape) => number;
    expect(pick(10, circle(1))).toBe(1);
    expect(pick(10, square(2))).toBe(10);
    expect(pick(10, dot)).toBe(-10);
    const fallback = module["fallback"] as (other: number, s: Shape) => number;
    expect(fallback(7, circle(1))).toBe(7);
    expect(fallback(7, dot)).toBe(0);
  });

  test("an arm whose body declares takes a block too", async () => {
    // The `Dot` arm binds nothing, but the `match` its body lifts into it
    // declares `__match_1`. The inner arms brace on their own terms. The
    // `Square` arm's `let` is inside the arrow its block emits as, so the arm
    // itself declares nothing.
    const source = SHAPE +
      "export let nested(s: Shape, t: Shape): Int = match s\n" +
      "    Circle(a) => a\n" +
      "    Square(_) =>\n" +
      "        let k = 2\n" +
      "        k * 3\n" +
      "    Dot => match t\n" +
      "        Circle(b) => b\n" +
      "        _ => 0 - 1\n";
    const text = javascript(source);

    expect(text).toContain(
      '    case "Dot": {\n      const __match_1 = t;\n      switch (__match_1.tag) {\n' +
        '        case "Circle": {\n          const b = __match_1.size;\n          return b;\n        }\n' +
        "        default:\n          return 0 - 1;\n      }\n",
    );
    expect(text).toContain('    case "Square":\n      return (() => {\n        const k = 2;\n');

    const module = await run(source);
    const nested = module["nested"] as (s: Shape, t: Shape) => number;
    expect(nested(circle(4), dot)).toBe(4);
    expect(nested(dot, circle(5))).toBe(5);
    expect(nested(dot, square(5))).toBe(-1);
    expect(nested(square(1), dot)).toBe(6);
  });

  test("a `Unit` arm keeps its `break` inside its block", async () => {
    // `Dot`'s loop declares its binders a block deeper, inside the loop, so the
    // arm itself declares nothing and stays bare.
    const source = SHAPE +
      "export let tally(s: Shape): Int =\n" +
      "    var n = 0\n" +
      "    match s\n" +
      "        Circle(size) => n := n + size\n" +
      "        Square(size) => n := n - size\n" +
      "        Dot => for (a, b) in [(1, 2), (3, 4)]\n" +
      "            n := n + a * b\n" +
      "    n\n";
    const text = javascript(source);

    expect(text).toContain(
      '      case "Square": {\n        const size = __match.size;\n        n = n - size;\n' +
        "        break;\n      }\n",
    );
    expect(text).toContain('      case "Dot":\n        for (const __item of ');

    const module = await run(source);
    const tally = module["tally"] as (s: Shape) => number;
    expect(tally(circle(5))).toBe(5);
    expect(tally(square(2))).toBe(-2);
    expect(tally(dot)).toBe(14);
  });

  test("a literal-valued switch braces its catch-all binder", async () => {
    const source = "export let flag(b: Bool): Int = match b\n" +
      "    True => 1\n" +
      "    other => 0\n";
    const text = javascript(source);

    expect(text).toContain("    case true:\n      return 1;\n");
    expect(text).toContain("    default: {\n      const other = __match;\n      return 0;\n    }\n");

    const module = await run(source);
    const flag = module["flag"] as (b: boolean) => number;
    expect(flag(true)).toBe(1);
    expect(flag(false)).toBe(0);
  });
});
