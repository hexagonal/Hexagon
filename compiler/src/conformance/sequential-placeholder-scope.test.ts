import { describe, expect, test } from "vitest";

import { compileProject, Source } from "../index";

/**
 * Conformance for the reach of a shared module-level binding
 * (`spec/notes/compiler-conformance-defects.md`, 2026-07-26 defect 7).
 *
 * A module-level `let`/`var` whose type item 7 declines stands for *one* binding
 * holding *one* value of *one* type. It must therefore never be quantified into
 * some sibling's scheme: if it is, each consumer instantiates a fresh copy and a
 * single runtime value is handed out at two different types — and, at constrained
 * types, with two different evidence dictionaries.
 *
 * `shared` below is a function *call* whose result type is a bare `a -> a`, so
 * item 7's clause (b) declines it: the variable occurs in argument position, and
 * the binding holds one function of one type. Reading it through an intermediary
 * must not launder that away, whichever keyword declares the intermediary.
 *
 * The specimen is chosen to be one item 7 declines for a reason the ruling still
 * gives: `let shared = makeEmpty()` is the ruling's headline *acceptance* (closure
 * doc §4.4: unconstrained, covariant-only, level-admitted), so a file built on it
 * would pass while asserting a rule the corpus has dropped.
 */

function diagnostics(source: string): readonly string[] {
  const project = compileProject([new Source.File(Source.fileId(0), "/main.hex", source)]);
  return project.diagnostics.map((diagnostic) => diagnostic.message);
}

const PRELUDE =
  "fun makeIdentity<a>(): (a) -> a = value => value\n" +
  "let shared = makeIdentity()\n";

const CONSUMERS =
  "export fun useInt(n: Int): Int = reuse()(n)\n" +
  "export fun useText(s: String): String = reuse()(s)\n";

describe("a declined module binding is never quantified by a sibling", () => {
  test("through a captured `let` intermediary", () => {
    expect(diagnostics(PRELUDE + "let reuse = () => shared\n" + CONSUMERS)).not.toEqual([]);
  });

  test("through an annotated `fun` intermediary", () => {
    expect(diagnostics(PRELUDE + "fun reuse(): (a) -> a = shared\n" + CONSUMERS)).not.toEqual([]);
  });

  test("through an unannotated `fun` intermediary", () => {
    expect(diagnostics(PRELUDE + "fun reuse() = shared\n" + CONSUMERS)).not.toEqual([]);
  });

  test("direct consumption is rejected too (the unlaundered baseline)", () => {
    expect(diagnostics(
      PRELUDE +
      "export fun useInt(n: Int): Int = shared(n)\n" +
      "export fun useText(s: String): String = shared(s)\n",
    )).not.toEqual([]);
  });

  test("being read by a function does not change the answer, in either direction", () => {
    // Item 7 asks its clauses per variable and gets one answer; whether some
    // function happens to mention the binding is not an input to it. Both halves
    // matter: the declined one must not be laundered *into* generalization, and
    // the granted one must not be laundered out of it.
    const declined = "fun makeIdentity<a>(): (a) -> a = value => value\n" +
      "let shared = makeIdentity()\n" +
      "export let n: Int = shared(1)\n" +
      'export let s: String = shared("x")\n';
    expect(diagnostics(declined)).not.toEqual([]);
    expect(diagnostics(declined + "fun capture(): Int = shared(0)\n")).not.toEqual([]);

    const granted = "fun makeEmpty<a>(): Vector(a) = []\n" +
      "let shared = makeEmpty()\n" +
      "export let n: Vector(Int) = shared\n" +
      "export let s: Vector(String) = shared\n";
    expect(diagnostics(granted)).toEqual([]);
    expect(diagnostics(granted + "fun capture(): Int = Vector.length(shared)\n")).toEqual([]);
  });
});

describe("legitimate generalization is untouched", () => {
  test("a genuinely generic captured helper still serves two types", () => {
    expect(diagnostics(
      "let ident(value: a): a = value\n" +
      "export fun asInt(value: Int): Int = ident(value)\n" +
      "export fun asText(value: String): String = ident(value)\n",
    )).toEqual([]);
  });

  test("a generic `fun` helper still serves two types", () => {
    expect(diagnostics(
      "fun ident(value: a): a = value\n" +
      "export fun asInt(value: Int): Int = ident(value)\n" +
      "export fun asText(value: String): String = ident(value)\n",
    )).toEqual([]);
  });

  test("a monomorphic captured binding is still usable at its one type", () => {
    expect(diagnostics(
      "let base = Vector.length([1, 2])\n" +
      "export fun bump(): Int = base + 1\n" +
      "export fun twice(): Int = base + base\n",
    )).toEqual([]);
  });
});
