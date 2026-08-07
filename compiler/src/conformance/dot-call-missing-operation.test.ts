import { describe, expect, test } from "vitest";

import { compileFiles, projectDiagnostics } from "../support/test-project.js";

/**
 * Conformance for the dot call whose companion has no such operation (#212).
 *
 * A dot call on a nominal receiver looks the field up in the receiver's own
 * companion (Method Syntax §4.2); when nothing answers, the call is abandoned
 * and the companion diagnostic is reported. The defect was that abandoning it
 * skipped the *arguments*, and an integer literal only records its `Num`/`FromNat`
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
 * How a module-level binding came to shadow an operation was #267, since fixed:
 * dispatch is resolved from the receiver's companion, not from the names in
 * scope, and the `take` case below now binds `Seq.take`. #217's residue — that a
 * correctly-spelled `Vector` operation was out of dot call's reach — closed with
 * the intrinsic-door milestone, which put `stdlib/Vector.hex` in the prelude and
 * so gave the built-in head a companion (`companion-dispatch.test.ts`). What is
 * pinned here is only: a diagnostic, never a throw.
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
      "`Seq(Int)` has no field `bogus`, its companion exports no operation `bogus`, and no constraint honored at `Seq(Int)` has a subject-first member `bogus`; call an available subject-first function explicitly",
    ]);
  });

  test("a `Vector` receiver, reached through an annotation", () => {
    expect(
      projectDiagnostics(
        "export let blank: Vector(Int) = []\n" +
          "export let counts: Vector(Int) = blank.nope(1)\n",
      ),
    ).toEqual([
      "`Vector(Int)` has no field `nope`, its companion exports no operation `nope`, and no constraint honored at `Vector(Int)` has a subject-first member `nope`; call an available subject-first function explicitly",
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
      "`P` has no field `nope`, its companion exports no operation `nope`, and no constraint honored at `P` has a subject-first member `nope`; call an available subject-first function explicitly",
    );
  });
});

describe("a misspelling beside a correctly-spelled operation", () => {
  // The two spellings must part company: `append` and `at` are `Vector`
  // operations and now dispatch (their semantics are pinned in
  // `companion-dispatch.test.ts`), while a name the companion does not export
  // still takes the diagnostic — with a bare integer argument, the shape that
  // used to crash the compile.
  test("a correctly-spelled core operation reports nothing", () => {
    expect(projectDiagnostics(
      "export let v: Vector(Int) = [1, 2].append(3)\n" +
        "export let n: Int = [1, 2].at(1)\n",
    )).toEqual([]);
  });

  // The receiver is a literal, so its element type is still an unsolved variable
  // when the message is rendered (`Vector(?n)`). The variable's number is an
  // allocation counter, not behaviour, so it is matched rather than spelled.
  test("a misspelled one on the same receiver still reports", () => {
    const messages = projectDiagnostics("export let v: Vector(Int) = [1, 2].appendd(3)\n");

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatch(
      /^`Vector\(\?\d+\)` has no field `appendd`, its companion exports no operation `appendd`, and no constraint honored at `Vector\(\?\d+\)` has a subject-first member `appendd`; call an available subject-first function explicitly$/u,
    );
  });
});

describe("a module-level binding that shadows a real operation", () => {
  // `take` is a genuine `Seq` operation, and a module-level `let take: Int` used
  // to knock it out: the by-name table answered with the `let`, whose scheme is
  // not a function, so the call reached the same bail as an outright misspelling
  // and the compiler said something false about the companion. #267 replaced the
  // table with the receiver's own companion, so the `let` is not a candidate for
  // anything and `Seq.take` answers. What this route contributed to #212 — that
  // a bare `1` in an *abandoned* dot call is still inferred — is covered by every
  // other case here; this one no longer abandons.
  test("`s.take(1)` under `let take: Int` reaches `Seq.take`", () => {
    expect(
      projectDiagnostics(
        "export let take: Int = 5\n" +
          "export fun go(s: Seq(Int)): Seq(Int) = s.take(1)\n",
      ),
    ).toEqual([]);
  });
});

describe("a member name with no instance behind it is still a misspelling", () => {
  // Dot syntax reaches constraint members since #304/#335 — but through the
  // instances the receiver's type honors, never through the name (Method Syntax
  // §7: "the dot never *discovers* a member"). `Token` honors nothing, its
  // companion `/vault.hex` exports no `show`, and its one field is invisible
  // outside the home module, so all three candidate sources are empty and the
  // call reaches the same bail as an outright misspelling. That the prelude has
  // a `show` changes nothing: the member is `Show`'s, and `Token` has no `Show`.
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
      "`Token` has no field `show`, its companion exports no operation `show`, and no constraint honored at `Token` has a subject-first member `show`; call an available subject-first function explicitly",
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
      "`Seq(Int)` has no field `bogus`, its companion exports no operation `bogus`, and no constraint honored at `Seq(Int)` has a subject-first member `bogus`; call an available subject-first function explicitly",
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
      "`Vector(Int)` has no field `nope`, its companion exports no operation `nope`, and no constraint honored at `Vector(Int)` has a subject-first member `nope`; call an available subject-first function explicitly",
    );
  });

  test("no arguments at all", () => {
    expect(
      projectDiagnostics(
        "let xs: Vector(Int) = [1, 2]\n" +
          "export let blank = xs.vacant()\n",
      ),
    ).toContain(
      "`Vector(Int)` has no field `vacant`, its companion exports no operation `vacant`, and no constraint honored at `Vector(Int)` has a subject-first member `vacant`; call an available subject-first function explicitly",
    );
  });
});
