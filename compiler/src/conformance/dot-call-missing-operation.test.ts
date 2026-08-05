import { describe, expect, test } from "vitest";

import { compileFiles, projectDiagnostics } from "../support/test-project.js";

/**
 * Conformance for the dot call whose companion has no such operation (#212).
 *
 * A dot call on a nominal receiver looks the field up in the checker's by-name
 * operation table; when nothing answers, the call is abandoned and the companion
 * diagnostic is reported. The defect was that abandoning it skipped the
 * *arguments*, and an integer literal only records its `Num`/`FromNat`
 * requirement when it is inferred. Materialization walks the whole resolved tree
 * regardless of who abandoned what, so a bare `1` in such a call took down the
 * entire compile with `Cannot read properties of undefined (reading '0')` — the
 * diagnostic never reached the user, and neither did any other module's.
 *
 * Every route below reaches that one bail. They are pinned together because the
 * crash was invisible in most of them: only the shape of the *argument* decided
 * whether the compiler reported or threw, so a control with a `Float` or a named
 * binding argument passed throughout.
 *
 * Whether dot call should someday reach the compiler-core inventory (§4) or how
 * a module-level binding comes to shadow an operation (§5) are separate
 * questions — #217/#267. What is pinned here is only: a diagnostic, never a
 * throw.
 */

/** Every diagnostic message a multi-module project produced, in order. */
function diagnostics(files: readonly (readonly [string, string])[]): readonly string[] {
  return compileFiles(files).diagnostics.map(({ message }) => message);
}

describe("a missing companion operation reports rather than crashing (#212)", () => {
  test("the filed reproduction: a `Seq` receiver with a bare integer argument", () => {
    expect(
      projectDiagnostics("export fun go(s: Seq(Int)): Seq(Int) = s.bogus(1)\n"),
    ).toEqual([
      "the companion of `Seq(Int)` has no operation `bogus`; call an available subject-first function explicitly",
    ]);
  });

  test("a `Vector` receiver, reached through an annotation", () => {
    expect(
      projectDiagnostics(
        "export let blank: Vector(Int) = []\n" +
          "export let counts: Vector(Int) = blank.nope(1)\n",
      ),
    ).toEqual([
      "the companion of `Vector(Int)` has no operation `nope`; call an available subject-first function explicitly",
    ]);
  });

  test("a record receiver whose representation is visible", () => {
    expect(
      projectDiagnostics(
        "record P = {x: Int}\n" +
          "let p = P({x = 1})\n" +
          "export let q = p.nope(1)\n",
      ),
    ).toContain(
      "the companion of `P` has no operation `nope`; call an available subject-first function explicitly",
    );
  });
});

describe("correctly-spelled core operations are out of dot call's reach", () => {
  // `append` and `at` exist — they are compiler-core `Vector` operations — but
  // they are not module-level functions, so the by-name table has no row for
  // them and the dot call takes the same bail. The pin is that this is a
  // diagnostic; that dot call cannot reach the core inventory is #217/#267.
  //
  // The receiver is a literal, so its element type is still an unsolved variable
  // when the message is rendered (`Vector(?n)`). The variable's number is an
  // allocation counter, not behaviour, so it is matched rather than spelled.
  test("`append` on a vector literal reports", () => {
    const messages = projectDiagnostics("export let v: Vector(Int) = [1, 2].append(3)\n");

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatch(
      /^the companion of `Vector\(\?\d+\)` has no operation `append`; call an available subject-first function explicitly$/u,
    );
  });

  test("`at` on a vector literal reports", () => {
    const messages = projectDiagnostics("export let n: Int = [1, 2].at(1)\n");

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatch(
      /^the companion of `Vector\(\?\d+\)` has no operation `at`; call an available subject-first function explicitly$/u,
    );
  });
});

describe("a module-level binding that shadows a real operation", () => {
  // `take` is a genuine `Seq` operation, occluded here by a module-level `let`
  // of the same name — and the occluding binding is not itself an operation, so
  // the by-name table answers with nothing and the call reaches the same bail as
  // an outright misspelling. Why a module-level binding gets to occlude a
  // companion operation at all is #267; what is pinned here is only that the
  // argument is still inferred, so this reports instead of throwing.
  test("`s.take(1)` under `let take: Int` reports rather than crashing", () => {
    expect(
      projectDiagnostics(
        "export let take: Int = 5\n" +
          "export fun go(s: Seq(Int)): Seq(Int) = s.take(1)\n",
      ),
    ).toEqual([
      "the companion of `Seq(Int)` has no operation `take`; call an available subject-first function explicitly",
    ]);
  });
});

describe("a constraint member is not a companion operation", () => {
  // The receiver is opaque, so the field is not a record field; `show` *is* a
  // real name in the prelude, but as a constraint member rather than a
  // module-level `fun`/`let` it has no row in the by-name operation table. So
  // this reaches the same bail as an outright misspelling — it does not route
  // to `Show.show`.
  test("an imported opaque record's `show` reports rather than crashing", () => {
    expect(
      diagnostics([
        [
          "/vault.hex",
          "export opaque record Token = {show: (Int) -> Int}\n" +
            "export fun issue(f: (Int) -> Int): Token = Token({show = f})\n",
        ],
        [
          "/main.hex",
          'import { Token } from "./vault"\n' +
            "export fun probe(t: Token): Int = t.show(1)\n",
        ],
      ]),
    ).toContain(
      "the companion of `Token` has no operation `show`; call an available subject-first function explicitly",
    );
  });
});

describe("the controls that already reported before the fix", () => {
  // These decided the diagnosis: a `Float` literal is a primitive and records no
  // requirement, and a named binding was inferred at its declaration, so neither
  // argument had anything for materialization to miss. They must keep reporting.
  test("a float argument", () => {
    expect(
      projectDiagnostics("export fun go(s: Seq(Int)): Seq(Int) = s.bogus(1.5)\n"),
    ).toEqual([
      "the companion of `Seq(Int)` has no operation `bogus`; call an available subject-first function explicitly",
    ]);
  });

  test("a named `Int` binding as the argument", () => {
    expect(
      projectDiagnostics(
        "export let blank: Vector(Int) = []\n" +
          "let one: Int = 1\n" +
          "export let counts: Vector(Int) = blank.nope(one)\n",
      ),
    ).toContain(
      "the companion of `Vector(Int)` has no operation `nope`; call an available subject-first function explicitly",
    );
  });

  test("no arguments at all", () => {
    expect(
      projectDiagnostics(
        "let xs: Vector(Int) = [1, 2]\n" +
          "export let empty = xs.isEmpty()\n",
      ),
    ).toContain(
      "the companion of `Vector(Int)` has no operation `isEmpty`; call an available subject-first function explicitly",
    );
  });
});
