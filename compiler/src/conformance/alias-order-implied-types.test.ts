/**
 * An alias's body names what it names where the alias is written, the
 * module's types (Declarations Preamble §4), and module-level declarations
 * read the same in any arrangement (§7.2). So an alias used in a constraint's
 * or an honor's member signature means the same above the constraint or below
 * it: never the implied types of the place it is used (#1505).
 */

import { describe, expect, test } from "vitest";

import { projectDiagnostics } from "../support/test-project.js";

const ORDERS = [["above", true], ["below", false]] as const;

/** `Thing`, an alias of the module's record `Item`, used where the constraint's implied `Item` stands. */
function program(above: boolean, member: string, ...aliases: readonly string[]): string {
  const declared = aliases.length === 0 ? ["type Thing = Item"] : aliases;
  return [
    "module Main",
    "",
    "record Item = {x: Int}",
    ...(above ? declared : []),
    "constraint Source<a> =",
    "    type Item",
    "    get(value: a, t: Thing) -> Int",
    "record Box = {value: Int}",
    "honor Source<Box> =",
    "    type Item = String",
    `    ${member}`,
    ...(above ? [] : declared),
    "",
  ].join("\n");
}

describe("#1505 an alias in a member signature means the module's types, above or below", () => {
  test.each(ORDERS)("the record, with the alias %s the constraint", (_, above) => {
    expect(projectDiagnostics(program(above, "get(box, t) = t.x"))).toEqual([]);
  });

  test.each(ORDERS)("not the implied type, with the alias %s the constraint", (_, above) => {
    expect(projectDiagnostics(program(above, "get(box, t) = String.length(t)"))).toEqual([
      "type mismatch: expected String, found Item",
    ]);
  });

  test.each(ORDERS)("in the parameters an honor's member writes, with the alias %s", (_, above) => {
    expect(projectDiagnostics(program(above, "get(box: Box, t: Thing) = t.x"))).toEqual([]);
  });

  test.each(ORDERS)("through an alias of an alias, both %s", (_, above) => {
    expect(projectDiagnostics(program(above, "get(box, t) = t.x", "type Thing = Inner", "type Inner = Item"))).toEqual([]);
  });

  test.each(ORDERS)("applied, with the alias %s", (_, above) => {
    const applied = program(above, "get(box, t) = t.x", "type Thing = Pick(Item)", "type Pick(x) = x");
    expect(projectDiagnostics(applied)).toEqual([]);
  });
});
