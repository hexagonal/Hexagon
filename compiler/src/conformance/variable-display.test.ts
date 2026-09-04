import { describe, expect, test } from "vitest";

import { compileFiles } from "../support/test-project.js";

/**
 * Conformance for Constraints §8's **displayed-type law** (#649): no diagnostic
 * displays a numbered inference variable.
 *
 * Numeric Literals §6 already required survivors to be "named rather than
 * numbered", but only at its own fixit, which it reached by settling first and
 * naming what was left. #649 generalises the naming half — and only that half —
 * to `#display`, the one entry point every report reads a type through, so
 * `Box(?442)` is unwritable and the head reads `type `Box(a)` has no `Hash`
 * instance`.
 *
 * The two halves stay apart on purpose. Naming is a label: it binds nothing, so
 * a display run mid-inference cannot change what the program means. Settling
 * binds, so it stays where a seat can do it honestly and deliberately — §6's
 * own settle-then-name sequence, whose pins live in `checker.test.ts`.
 *
 * The neighbouring files own the reports themselves; this one owns the spelling
 * they all share, and the naming rule underneath it.
 */

const messagesOf = (files: readonly (readonly [string, string])[]): readonly string[] =>
  compileFiles(files).diagnostics.map(({ message }) => message);

const main = (source: string): readonly string[] => messagesOf([["/main.hex", "module Main\n\n" + source]]);

describe("the law: a survivor reaching a report is named", () => {
  test("the head case — a parameterized nominal with an unsolved argument", () => {
    // #649's own example. The literal's variable is still unsolved when the
    // `Hash` requirement fails, and the head is where the reader meets it, with
    // #644's derivation fixit riding on the same sentence: the fixit names
    // `Box`, and the head must name `Box`'s argument in a spelling that belongs
    // beside it (§5.4's general-head convention), not `Box(?442)`.
    expect(main(
      "export record Box(a) = {value: a}\n" +
        "\n" +
        "export fun go(): Int = Hash.hash(Box({value = 1}))\n",
    )).toEqual([
      "type `Box(a)` has no `Hash` instance; `Hash` instances must be derived, " +
      "so the only repair is `derives (Eq, Hash)` on the declaration of `Box` " +
      "in `./main.hex`",
    ]);
  });

  test("a survivor under a structural head is named too", () => {
    expect(main("export let n: {a: Int} = []\n")).toEqual([
      "type mismatch: expected {a: Int}, found Vector(a)",
    ]);
  });

  test("an effect colour is not spent a letter — it prints as a colour", () => {
    // `#display` skips effect-slot variables when it names: an unsolved colour
    // reaches the reader through the arrow (`->?`), never as a name, so naming
    // it would only push the type's own survivor off `a` for nothing.
    expect(main(
      "export fun go(f: (b) ->? b): Int =\n" +
        "    let n: String = (f, [])\n" +
        "    1\n",
    )).toEqual([
      "type mismatch: expected String, found ((b) ->? b, Vector(a))",
    ]);
  });

  test("no report in this file's shapes reaches the reader with a `?N`", () => {
    // The law is a statement about *every* report, so it is pinned once as
    // itself: across a spread of shapes that leave a variable unsolved, no
    // message spells an allocation counter. A numbered arrow is not a false
    // positive waiting to happen — Effects §10 renders its ordinal in
    // superscript digits (`arrows.ts`), which `\d` does not match.
    const shapes = [
      "export let n: Int = ((y) => y)\n",
      "export let n: {a: Int} = []\n",
      "export let v: Vector(Int) = [].nope(3)\n",
      "export record Box(a) = {value: a}\n\nexport fun go(): Int = Hash.hash(Box({value = 1}))\n",
      "export fun f(o: Option(a)): Int = 1\n\nexport fun go(): Int = f([])\n",
      "export fun go(f: (b) ->? b): Int =\n    let n: String = (f, [])\n    1\n",
    ];
    const reported = shapes.flatMap((source) => main(source));
    expect(reported.length).toBeGreaterThan(shapes.length - 1);
    expect(reported.filter((message) => /\?\d/u.test(message))).toEqual([]);
  });
});

describe("fresh names dedupe against every name already visible", () => {
  test("a declared variable holds its letter; the survivor takes the next", () => {
    // `a` is the writer's, so the survivor beside it cannot be `a` — the same
    // sentence in §6 that excepts declared variables is what says so.
    expect(main(
      "export record Pair(a, b) = {left: a, right: b}\n" +
        "\n" +
        "export fun go(x: a): Int = Hash.hash(Pair({left = x, right = 1}))\n",
    )).toEqual([
      "type `Pair(a, b)` has no `Hash` instance; `Hash` instances must be " +
      "derived, so the only repair is `derives (Eq, Hash)` on the declaration " +
      "of `Pair` in `./main.hex`",
    ]);
  });

  test("a name an earlier report minted is as visible as a declared one", () => {
    // The sticky-name path, and the reason the dedupe reads display names and
    // not just declared ones. The fixture is a `var` because a `var` *never*
    // generalises — Statements §6.1 says so outright, so the pin rests on a
    // stated rule rather than on an outcome. (The same program with `let`
    // reports identically today; both reports concern one variable either way.)
    // Both reports are therefore about the *same* variable: the first names the
    // vector's element `a` and the name stays with it, and the second displays
    // it beside a variable no report has seen — which must not be `a` too.
    // Seeded from
    // declared names alone, the second message would read `(Vector(a), a)`, one
    // variable named by history and one fresh, with nothing to tell them apart.
    expect(main(
      "export fun go(): Int =\n" +
        "    var v = []\n" +
        "    let n: Int = v\n" +
        "    let m: Int = (v, 1)\n" +
        "    1\n",
    )).toEqual([
      "type mismatch: expected Int, found Vector(a)",
      "type mismatch: expected Int, found (Vector(a), b)",
    ]);

    // The other half of stickiness, which is why the dedupe is over *names*
    // and not occurrences: one variable is one name, however many times the
    // displayed type reaches it.
    expect(main(
      "export fun go(): Int =\n" +
        "    var v = []\n" +
        "    let n: Int = v\n" +
        "    let m: Int = (v, v)\n" +
        "    1\n",
    )).toEqual([
      "type mismatch: expected Int, found Vector(a)",
      "type mismatch: expected Int, found (Vector(a), Vector(a))",
    ]);
  });

  test("two types in one message name independently", () => {
    // One `#display` call is one displayed type expression (the doc comment at
    // the seat), so each side of a mismatch starts its own alphabet — the unit
    // Effects §10's arrow numbering already uses. Coordinating the two would be
    // a different rule, and #649 ruled against inventing it.
    expect(main(
      "export fun f(o: Option(a)): Int = 1\n" +
        "\n" +
        "export fun go(): Int = f([])\n",
    )).toEqual([
      "type mismatch: expected Option(a), found Vector(a)",
    ]);
  });
});
