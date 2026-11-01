/**
 * A constraint's default body is checked once in the constraint's generic
 * context (Constraints §2), where an implied type is as rigid as the subject
 * (#1123). The body's own demands of the constraint on the subject have the
 * declaration's implied types, by Collections Part 2 §5.4's functional
 * dependency; and an implied type declares nothing, so the body may demand
 * nothing of it.
 */

import { describe, expect, test } from "vitest";

import { projectDiagnostics, runMain } from "../support/test-project.js";

const COLL = "constraint Coll2<c> =\n" +
  "    type Elem\n" +
  "    head(xs: c) -> Elem\n";

describe("#1123 a default body leaves its implied types the declaration's", () => {
  test("the unsound program: a default naming `Elem` no longer makes it one global type", () => {
    const messages = projectDiagnostics(
      "module Main\n\n" +
      "record Bag = {x: Int}\n" + COLL +
      "    again(xs: c) -> Elem = head(xs)\n" +
      "honor Coll2<Bag> =\n" +
      "    type Elem = Int\n" +
      "    head(b) = b.x\n" +
      "export let r: String = head(Bag({x = 1}))\n",
    );
    expect(messages).toEqual(["type mismatch: expected String, found Int"]);
  });

  test("two honors with different implied types each keep their own, through the default", async () => {
    expect(await runMain(
      "module Main\n\n" +
      "record Bag = {x: Int}\n" + COLL +
      "    again(xs: c) -> Elem = head(xs)\n" +
      "honor Coll2<Bag> =\n" +
      "    type Elem = Int\n" +
      "    head(b) = b.x\n" +
      "union S = S\n" +
      "honor Coll2<S> =\n" +
      "    type Elem = String\n" +
      "    head(s) = \"s\"\n" +
      "export let r: Int = again(Bag({x = 1}))\n" +
      "export let q: String = again(S)\n",
    )).toMatchObject({ r: 1, q: "s" });
  });

  test("a default may use its siblings' implied types freely", () => {
    expect(projectDiagnostics(
      "module Main\n\n" + COLL +
      "    pair(xs: c) -> (Elem, Elem) = (head(xs), head(xs))\n" +
      "    first(xs: c) -> Elem =\n" +
      "        let y = head(xs)\n" +
      "        y\n",
    )).toEqual([]);
  });

  test.each([
    ["describe(xs: c) -> String = show(head(xs))", "`Show`"],
    ["same(xs: c) -> Bool = head(xs) == head(xs)", "`Eq`"],
    ["bad(xs: c) -> Elem = 1", "`Num`"],
  ])("a default may demand nothing of an implied type: %s", (member, demand) => {
    expect(projectDiagnostics("module Main\n\n" + COLL + "    " + member + "\n")).toEqual([
      `\`Elem\` is \`Coll2\`'s implied type, so a default body knows nothing of it but its name, ` +
        `and this one requires ${demand}; write this member's body in each \`honor\` instead`,
    ]);
  });
});
