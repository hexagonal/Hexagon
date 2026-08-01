import { describe, expect, test } from "vitest";

import { projectDiagnostics } from "../support/test-project.js";

/**
 * A selected instance's declared subject is unified with the type it discharges.
 *
 * `#instanceKey` keys on a **head constructor** only, so `honor Sh<Box(Int)>` is
 * the candidate for any `Sh(Box(?))` requirement. Selecting it used to end there:
 * nothing unified `Box(Int)` against `Box(?1)`, so `?1` came away unconstrained
 * and the instance's own argument was never imposed on the subject.
 *
 * Found while implementing #205 and fixed in the same branch, because that is
 * where it became reachable at scale: item 7's clause (a) reads a variable's
 * requirement list to decide whether to generalize, and a variable left with an
 * empty one is exactly what clause (a) is licensed to quantify. The defect is
 * older and independent of #205 — every specimen here also compiles silently
 * before Step 2 exists — which is why it has its own file.
 *
 * Both specimens below were verified against `main`, where each produces no
 * diagnostic at all.
 */

const SH = "export record Box(a) = { value: a }\n" +
  "constraint Sh<a> =\n" +
  "    sh(x: a): String\n" +
  "honor Sh<Box(Int)> =\n" +
  '    sh(x) = "b"\n';

describe("a ground instance head imposes its arguments", () => {
  test("a subject the instance does not cover is rejected", () => {
    // `Sh<Box(Int)>` is the only instance, and `Box(String)` is not it. Before
    // the fix the head matched, the argument was never looked at, and a
    // `String`-typed export was checked against a body the instance had built
    // for `Int`.
    expect(
      projectDiagnostics(SH + 'export let g: String = sh(Box({value = "x"}))\n'),
    ).toEqual(["type mismatch: expected Int, found String"]);
  });

  test("a declared type variable cannot satisfy a ground head", () => {
    // The same selection under a signature. `a` is rigid, the instance requires
    // `Int`, and Functions §4.1's family reports it with its rewrite named.
    expect(
      projectDiagnostics(SH + "export fun f<a>(x: Box(a)): String = sh(x)\n"),
    ).toEqual([
      "`a` is a declared type variable, but the body requires `Int`; " +
        "change the annotation to `Int`, or remove it to let the type be inferred",
    ]);
  });

  test("a parameterized instance still covers every argument", () => {
    // The guard against over-firing: the pin freshens the instance's own type
    // parameters before unifying, so a genuinely generic instance imposes
    // nothing and both element types go through.
    expect(
      projectDiagnostics(
        "export record Box(a) = { value: a }\n" +
          "constraint Sh<a> =\n" +
          "    sh(x: a): String\n" +
          "honor Sh<Box(a)> =\n" +
          '    sh(x) = "b"\n' +
          'export let g: String = sh(Box({value = "x"}))\n' +
          "export let h: String = sh(Box({value = 1}))\n",
      ),
    ).toEqual([]);
  });
});
