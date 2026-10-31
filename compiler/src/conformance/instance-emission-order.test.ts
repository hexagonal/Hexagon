import { describe, expect, test } from "vitest";

import { compileFiles, projectDiagnostics, runProject } from "../support/test-project.js";

const above = (instance: string) =>
  `\`${instance}\` is used here, and its honor is declared below it; ` +
  "declarations are read top-down — move the honor above this use";

/**
 * Conformance for Constraints §6.3's emission obligation, the second leg of
 * Functions §7.2's temporal-dead-zone guarantee.
 *
 * An instance is read top-down (Constraints §4.8, #1227): a use stands below
 * its honor or inside its knot, so a term binding above an honor that uses it
 * is refused, and the pins below write each use where the law puts it. The
 * evidence block is still emitted ahead of every term binding, and inside an
 * honor group — whose items may use each other in either order — in its
 * dependency order. Both artifacts move: a bare dictionary and the factory a
 * parameterized instance emits.
 */

function emitted(files: readonly (readonly [string, string])[], path: string): string {
  const project = compileFiles(files);
  // An ordering pin reads `indexOf`, which answers -1 for a binding that was
  // never emitted — so a rejected source would satisfy every `toBeLessThan`
  // below. The compile has to be clean before its text means anything.
  expect(project.diagnostics).toEqual([]);
  const module = project.modules.find(({ source }) => source.path === path);
  if (module === undefined) throw new Error(`${path} was not emitted`);
  return module.javascript.text;
}

/** The offset of `needle` in `javascript`, asserted present so -1 cannot pass an ordering pin. */
function offsetOf(javascript: string, needle: string): number {
  const offset = javascript.indexOf(needle);
  expect(offset, `${needle} was not emitted`).toBeGreaterThanOrEqual(0);
  return offset;
}

describe("evidence is emitted before the module's term bindings", () => {
  test("a use above the `honor` is refused; below it, it runs", async () => {
    const head = "module Main\n\n" + "export constraint Render<a> =\n" +
      "    render(value: a) -> Int\n" +
      "export record Box = {v: Int}\n";
    const use = "export let label: Int = render(Box({v = 1}))\n";
    const honor = "honor Render<Box> =\n" +
      "    render(value) = value.v\n";
    expect(projectDiagnostics(head + use + honor)).toEqual([above("Render<Box>")]);
    const main = await runProject([["/main.hex", head + honor + use]]);

    expect(main["label"]).toBe(1);
  });

  test("a factory demanded above its `honor` is refused; below it, it runs", async () => {
    const head = "module Main\n\n" + "export constraint Render<a> =\n" +
      "    render(value: a) -> Int\n" +
      "export record Box(a) = {v: a}\n" +
      "honor Render<Int> =\n" +
      "    render(value) = value\n" +
      "export let boxed: Box(Int) = Box({v = 1})\n";
    const use = "export let label: Int = render(boxed)\n";
    const honor = "honor<a: Render> Render<Box(a)> =\n" +
      // A member cannot call its own name (Constraints §4.6); `box.v: a`
      // dispatches through the instance's binder evidence.
      "    render(box) = box.v.render()\n";
    expect(projectDiagnostics(head + use + honor)).toEqual([above("Render<Box(Int)>")]);
    const main = await runProject([["/main.hex", head + honor + use]]);

    expect(main["label"]).toBe(1);
  });

  test("one instance reading another's evidence runs: below it, or grouped with it", async () => {
    const head = "module Main\n\n" + "export constraint Small<a> =\n" +
      "    size(value: a) -> Int\n" +
      "export constraint Big<a: Small> =\n" +
      "    total(value: a) -> Int\n" +
      "export record Box = {v: Int}\n";
    // The base obligation and the call in `total` both use `Small<Box>`
    // above its honor: refused, at the head and at the call.
    expect(projectDiagnostics(head +
      "honor Big<Box> =\n" +
      "    total(b) = size(b) * 10\n" +
      "export let middle: Int = total(Box({v = 4}))\n" +
      "honor Small<Box> =\n" +
      "    size(b) = b.v\n")).toEqual([above("Small<Box>"), above("Small<Box>")]);
    const main = await runProject([["/main.hex", head +
      "honor Small<Box> =\n" +
      "    size(b) = b.v\n" +
      "export let early: Int = size(Box({v = 2}))\n" +
      "honor Big<Box> =\n" +
      "    total(b) = size(b) * 10\n" +
      "export let middle: Int = total(Box({v = 4}))\n",
    ]]);

    expect(main["early"]).toBe(2);
    expect(main["middle"]).toBe(40);
    const grouped = await runProject([["/main.hex", head +
      "honor\n" +
      "    Big<Box> =\n" +
      "        total(b) = size(b) * 10\n" +
      "    Small<Box> =\n" +
      "        size(b) = b.v\n" +
      "export let middle: Int = total(Box({v = 4}))\n",
    ]]);

    expect(grouped["middle"]).toBe(40);
  });

  test("a dictionary read while another initializes is emitted first", () => {
    // The base-constraint slot is the one part of a dictionary read during its
    // own initialization, so it is the one edge that orders the block. Inside
    // an honor group the items may stand in either order (Constraints §4.8).
    const javascript = emitted([["/main.hex",
      "module Main\n\n" + "export constraint Small<a> =\n" +
      "    size(value: a) -> Int\n" +
      "export constraint Big<a: Small> =\n" +
      "    total(value: a) -> Int\n" +
      "export record Box = {v: Int}\n" +
      "honor\n" +
      "    Big<Box> =\n" +
      "        total(b) = size(b) * 10\n" +
      "    Small<Box> =\n" +
      "        size(b) = b.v\n",
    ]], "/main.hex");

    expect(offsetOf(javascript, "const __Small_Box"))
      .toBeLessThan(offsetOf(javascript, "const __Big_Box"));
  });

  test("a derived instance rides the same channel", () => {
    // A `derives` instance can never sit below its own use — the value-position
    // constructor reference would already be a declared-later error — so what is
    // pinned here is channel membership: it precedes *every* term binding, the
    // record's own constructor included.
    const javascript = emitted([["/main.hex",
      "module Main\n\n" + "export record Box derives Eq = {v: Int}\n" +
      "export let same: Bool = Box({v = 1}) == Box({v = 1})\n",
    ]], "/main.hex");

    expect(offsetOf(javascript, "const __Eq_Box"))
      .toBeLessThan(offsetOf(javascript, "const Box ="));
  });

  test("a derived factory rides it too", () => {
    const javascript = emitted([["/main.hex",
      "module Main\n\n" + "export record Box(a) derives Eq = {v: a}\n" +
      "export let boxed: Box(Int) = Box({v = 1})\n",
    ]], "/main.hex");

    expect(javascript).toMatch(/const __Eq_Box = \S+ => \{/u);
    expect(offsetOf(javascript, "const __Eq_Box"))
      .toBeLessThan(offsetOf(javascript, "const Box ="));
  });
});
