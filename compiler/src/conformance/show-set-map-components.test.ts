/**
 * A `Set` or a `Map` shown as a component of a tuple, a record, a constructor
 * payload or a map entry keeps its own text (#1273). Its show is a
 * conditional, and a composite show joins its components with `+`; these
 * compile clean either way, so each row asserts the running answer.
 */

import { describe, expect, test } from "vitest";

import { runMain } from "../support/test-project.js";

const run = (body: string): Promise<Record<string, unknown>> => runMain("module Main\n\n" + body);

describe("#1273 a Set or Map shown as a component", () => {
  test.each([
    ["a tuple's first component, interpolated", 'export let out: String = "${(Set.empty, 1)}"\n', "(Set.empty, 1)"],
    ["a tuple's first component, a Map", "export let out: String = show((Map.empty, 1))\n", "(Map.empty, 1)"],
    [
      "a tuple's last component",
      "export let out: String = show((1, Set.fromVector([2])))\n",
      "(1, Set.fromVector([2]))",
    ],
    [
      "a structural record's field",
      "export let out: String = show({s = Set.fromVector([1]), n = 1})\n",
      "{n = 1, s = Set.fromVector([1])}",
    ],
    [
      "a union payload",
      "union U derives (Show) = U(Set(Int), Int)\nexport let out: String = show(U(Set.empty, 1))\n",
      "U(Set.empty, 1)",
    ],
    [
      "a nominal record's field",
      "record R derives (Show) = {s: Set(Int), n: Int}\nexport let out: String = show(R({s = Set.empty, n = 1}))\n",
      "{n = 1, s = Set.empty}",
    ],
    [
      "a Map entry's value",
      "export let out: String = show(Map.fromVector([(1, Set.fromVector([2]))]))\n",
      "Map.fromVector([(1, Set.fromVector([2]))])",
    ],
    ["a tuple inside a vector", "export let out: String = show([(Set.empty, 1)])\n", "[(Set.empty, 1)]"],
  ])("%s", async (_seat, body, out) => {
    expect(await run(body)).toMatchObject({ out });
  });
});

describe("#1273 controls: seats that never joined with `+`", () => {
  test.each([
    ["a vector element", "export let out: String = show([Set.empty])\n", "[Set.empty]"],
    ["an Option payload", "export let out: String = show(Some(Set.empty))\n", "Some(Set.empty)"],
    ["an interpolation with text after", 'export let out: String = "${Set.fromVector([1])}!"\n', "Set.fromVector([1])!"],
  ])("%s", async (_seat, body, out) => {
    expect(await run(body)).toMatchObject({ out });
  });
});
