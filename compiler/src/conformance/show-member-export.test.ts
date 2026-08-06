import { describe, expect, test } from "vitest";

import { compileMain, projectDiagnostics, runMain, runProject } from "../support/test-project.js";

/**
 * Conformance for the #335 pilot: **a constraint member is an export of its
 * declaring module**, piloted on `Show` (`spec/notes/constraint-members-are-values.md`
 * §6 step 2). `stdlib/Show.hex` declares the constraint, joins the prelude
 * first, and its member `show` reaches every module's bare scope through the
 * ordinary prelude-export machinery — one polymorphic value, instantiated per
 * use, evidence-dispatched at the use's type.
 */

describe("the control: diagnostics are project-level, so prove the probe can fail", () => {
  test("an unknown name is still refused", () => {
    expect(projectDiagnostics("export let r: String = shew(42)\n"))
      .toEqual(["unknown name `shew`"]);
  });
});

describe("bare `show` is in scope everywhere (the book's rule becomes the language's)", () => {
  test("the book's `display` compiles and runs", async () => {
    const exports = await runMain([
      "export let display<a: Show>(value: a): String = show(value)",
      "",
      "export let shown: String = display(42)",
      "",
    ].join("\n"));

    expect(exports.shown).toBe("42");
  });

  test("`show(42)` defaults the literal to Int (Numeric Literals §4)", async () => {
    const exports = await runMain("export let r: String = show(42)\n");

    expect(exports.r).toBe("42");
  });

  test("pipe position: `42 |> show`", async () => {
    const exports = await runMain("export let r: String = 42 |> show\n");

    expect(exports.r).toBe("42");
  });

  test("higher-order position: mapping `show` over a Vector's elements", async () => {
    const exports = await runMain([
      "let values: Vector(Int) = [1, 2, 3]",
      "",
      "export let joined: String =",
      "    values.toSeq().map(show).fold(\"\", (line, shown) => line ++ shown ++ \";\")",
      "",
    ].join("\n"));

    expect(exports.joined).toBe("1;2;3;");
  });

  test("non-numeric instances are unchanged: String and Bool", async () => {
    const exports = await runMain([
      "export let text: String = show(\"abc\")",
      "export let truth: String = show(True)",
      "",
    ].join("\n"));

    expect(exports.text).toBe("abc");
    expect(exports.truth).toBe("True");
  });
});

describe("qualified access: `Show.show` is ordinary module-qualified access to an export", () => {
  test("`Show.show(42)` compiles and runs", async () => {
    const exports = await runMain("export let r: String = Show.show(42)\n");

    expect(exports.r).toBe("42");
  });
});
