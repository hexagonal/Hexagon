import { describe, expect, test } from "vitest";

import { AnalysisSession } from "../analysis/session.js";
import { projectDiagnostics, runMain } from "../support/test-project.js";

/**
 * Conformance for **`Debug.todo` and `TodoFault`** (#1493; the stdlib roadmap's
 * `Debug` row, Exceptions §8.5).
 *
 * `todo` stands in for code not written yet, at any type, and throws
 * `TodoFault(what)` where it is reached. The fault is what keeps a stand-in
 * honest about colour: no colour tracks a fault (Exceptions §1), so a function
 * whose arm is a `todo` has the face it will have once the arm is written, and
 * its callers' marks do not change when it is.
 */

function main(...lines: readonly string[]): string {
  return "module Main\n\n" + lines.join("\n") + "\n";
}

function thrownBy(call: () => unknown): unknown {
  try {
    call();
  } catch (error) {
    return error;
  }
  throw new Error("expected a throw");
}

const SHAPE = "export union Shape = Circle(radius: Float) | Square(side: Float)";

const AREA = [
  "export let area(s: Shape): Float =",
  "    match s",
  "        Circle(r) => r * r",
];

describe("`Debug.todo` keeps the face the finished code will have", () => {
  test("an arm's todo leaves the function's colour alone, so its caller needs no mark", () => {
    expect(projectDiagnostics(main(SHAPE, ...AREA,
      "        Square(_) => Debug.todo(\"Square(_)\")",
      "export let total(s: Shape): Float = area(s) + 1.0",
    ))).toEqual([]);
    // The control: a tracked exception in the same seat does change the face.
    expect(projectDiagnostics(main(SHAPE, "exception Unwritten", ...AREA,
      "        Square(_) => throw^(Unwritten)",
      "export let total(s: Shape): Float = area(s) + 1.0",
    ))).toEqual(["this call may fail, so `area` wants `^`, not no mark"]);
  });

  test("it stands in at any type: a member's body, and a function", () => {
    expect(projectDiagnostics(main(
      "export record Box = {n: Int}",
      "honor Show<Box> =",
      "    show(value) = Debug.todo(\"show\")",
      "export let pick(n: Int): Int -> Int = Debug.todo(\"pick\")",
    ))).toEqual([]);
  });

  test("its documentation reaches the editor, for both declarations", () => {
    const text = main("export let later(): Int = Debug.todo(\"later\")",
      "export let caught(): Int =",
      "    try",
      "        later()",
      "    catch",
      "        TodoFault(_) => 0");
    const session = new AnalysisSession();
    session.setFile("/main.hex", text);
    expect(session.hover("/main.hex", text.indexOf("todo("))?.documentation)
      .toMatch(/^Stands in for code not written yet, at any type/);
    expect(session.hover("/main.hex", text.indexOf("TodoFault"))?.documentation)
      .toMatch(/^Thrown by `todo` when the code it stands in for is reached/);
  });

  test("it is reached qualified, as every prelude function is (Modules §5.5)", () => {
    expect(projectDiagnostics(main("export let x(): Int = todo(\"x\")")))
      .toEqual(["no bare `todo`; write `Debug.todo(\"x\")`"]);
  });
});

describe("a reached todo throws `TodoFault`, naming what is missing", () => {
  const program = main(SHAPE, ...AREA,
    "        Square(_) => Debug.todo(\"Square(_)\")",
    "export let ofCircle(r: Float): Float = area(Circle(r))",
    "export let ofSquare(side: Float): Float = area(Square(side))",
    "export let caught(side: Float): String =",
    "    try",
    "        area(Square(side)).show()",
    "    catch",
    "        TodoFault(what) => \"not yet: ${what}\"",
    "export let qualified(side: Float): String =",
    "    try",
    "        area(Square(side)).show()",
    "    catch",
    "        Debug.TodoFault(what) => what",
  );

  test("the arms that are written run; the todo throws where it is reached", async () => {
    const exports = await runMain(program);
    expect((exports["ofCircle"] as (r: number) => number)(3)).toBe(9);
    const fault = thrownBy(() => (exports["ofSquare"] as (side: number) => number)(2));
    expect(fault).toBeInstanceOf(Error);
    expect(fault).toMatchObject({ name: "TodoFault", $hex: "Hex.Debug", message: "Square(_)" });
    // Uncaught, it reads the way a `message` slot reads (Exceptions §2).
    expect(String(fault)).toBe("TodoFault: Square(_)");
  });

  test("`TodoFault` is a prelude fault, bare by category and qualified through `Debug`", async () => {
    const exports = await runMain(program);
    expect((exports["caught"] as (side: number) => string)(2)).toBe("not yet: Square(_)");
    expect((exports["qualified"] as (side: number) => string)(2)).toBe("Square(_)");
  });
});
