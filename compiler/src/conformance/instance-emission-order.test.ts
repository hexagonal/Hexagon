import { describe, expect, test } from "vitest";

import { compileFiles, runProject } from "../support/test-project.js";

/**
 * Conformance for Constraints §6.3's emission obligation, the second leg of
 * Functions §7.2's temporal-dead-zone guarantee.
 *
 * An `honor` carries no source-ordering law — instances are order-independent
 * within a module, because building one evaluates nothing — yet it emits a
 * term-level `const`. A term binding above it may demand its evidence, so the
 * evidence block is emitted ahead of every term binding. Both artifacts move: a
 * bare dictionary and the factory a parameterized instance emits.
 */

function emitted(files: readonly (readonly [string, string])[], path: string): string {
  const module = compileFiles(files).modules.find(({ source }) => source.path === path);
  if (module === undefined) throw new Error(`${path} was not emitted`);
  return module.javascript.text;
}

describe("evidence is emitted before the module's term bindings", () => {
  test("a use above the `honor` runs", async () => {
    const main = await runProject([["/main.hex",
      "export constraint Render<a> =\n" +
      "    render(value: a): Int\n" +
      "export record Box = {v: Int}\n" +
      "export let label: Int = render(Box({v = 1}))\n" +
      "honor Render<Box> =\n" +
      "    render(value) = value.v\n",
    ]]);

    expect(main["label"]).toBe(1);
  });

  test("a factory demanded above its `honor` runs", async () => {
    const main = await runProject([["/main.hex",
      "export constraint Render<a> =\n" +
      "    render(value: a): Int\n" +
      "export record Box(a) = {v: a}\n" +
      "honor Render<Int> =\n" +
      "    render(value) = value\n" +
      "export let boxed: Box(Int) = Box({v = 1})\n" +
      "export let label: Int = render(boxed)\n" +
      "honor<a: Render> Render<Box(a)> =\n" +
      "    render(box) = render(box.v)\n",
    ]]);

    expect(main["label"]).toBe(1);
  });

  test("one instance reading another's evidence runs, with a term use between", async () => {
    const main = await runProject([["/main.hex",
      "export constraint Small<a> =\n" +
      "    size(value: a): Int\n" +
      "export constraint Big<a: Small> =\n" +
      "    total(value: a): Int\n" +
      "export record Box = {v: Int}\n" +
      "honor Big<Box> =\n" +
      "    total(b) = size(b) * 10\n" +
      "export let middle: Int = total(Box({v = 4}))\n" +
      "honor Small<Box> =\n" +
      "    size(b) = b.v\n",
    ]]);

    expect(main["middle"]).toBe(40);
  });

  test("a dictionary read while another initializes is emitted first", () => {
    // The base-constraint slot is the one part of a dictionary read during its
    // own initialization, so it is the one edge that orders the block.
    const javascript = emitted([["/main.hex",
      "export constraint Small<a> =\n" +
      "    size(value: a): Int\n" +
      "export constraint Big<a: Small> =\n" +
      "    total(value: a): Int\n" +
      "export record Box = {v: Int}\n" +
      "honor Big<Box> =\n" +
      "    total(b) = size(b) * 10\n" +
      "honor Small<Box> =\n" +
      "    size(b) = b.v\n",
    ]], "/main.hex");

    expect(javascript.indexOf("const __hex_instance_Small_Box"))
      .toBeLessThan(javascript.indexOf("const __hex_instance_Big_Box"));
  });

  test("a derived instance rides the same channel", () => {
    // A `derives` instance can never sit below its own use — the value-position
    // constructor reference would already be a declared-later error — so what is
    // pinned here is channel membership: it precedes *every* term binding, the
    // record's own constructor included.
    const javascript = emitted([["/main.hex",
      "export record Box = {v: Int} derives Eq\n" +
      "export let same: Bool = equals(Box({v = 1}), Box({v = 1}))\n",
    ]], "/main.hex");

    expect(javascript.indexOf("const __hex_instance_Eq_Box"))
      .toBeLessThan(javascript.indexOf("const Box ="));
  });

  test("a derived factory rides it too", () => {
    const javascript = emitted([["/main.hex",
      "export record Box(a) derives Eq = {v: a}\n" +
      "export let boxed: Box(Int) = Box({v = 1})\n",
    ]], "/main.hex");

    expect(javascript).toMatch(/const __hex_instance_Eq_Box = \S+ => \{/u);
    expect(javascript.indexOf("const __hex_instance_Eq_Box"))
      .toBeLessThan(javascript.indexOf("const Box ="));
  });
});
