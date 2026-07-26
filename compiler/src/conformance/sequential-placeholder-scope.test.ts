import { describe, expect, test } from "vitest";

import { compileProject, Source } from "../index";

/**
 * Conformance for the scope of sequential placeholders
 * (`spec/notes/compiler-conformance-defects.md`, 2026-07-26 defect 7).
 *
 * A module-level `let`/`var` captured by a function is installed as a monomorphic
 * placeholder so bodies can refer to it before it is checked. That placeholder
 * stands for *one* binding holding *one* value of *one* type. It must therefore
 * never be quantified into some sibling's scheme: if it is, each consumer
 * instantiates a fresh copy and a single runtime value is handed out at two
 * different types — and, at constrained types, with two different evidence
 * dictionaries.
 *
 * `shared` below is a function *call*, so the value restriction denies it
 * generalization (Functions §8). Reading it through an intermediary must not
 * launder that away, whichever keyword declares the intermediary.
 */

function diagnostics(source: string): readonly string[] {
  const project = compileProject([new Source.File(Source.fileId(0), "/main.hex", source)]);
  return project.diagnostics.map((diagnostic) => diagnostic.message);
}

const PRELUDE =
  "let makeEmpty() = []\n" +
  "let shared = makeEmpty()\n";

const CONSUMERS =
  "export fun useInt(values: Vector(Int)): Bool = reuse() == values\n" +
  "export fun useText(values: Vector(String)): Bool = reuse() == values\n";

describe("a sequential placeholder is never quantified by a sibling", () => {
  test("through a captured `let` intermediary", () => {
    expect(diagnostics(PRELUDE + "let reuse = () => shared\n" + CONSUMERS)).not.toEqual([]);
  });

  test("through an annotated `fun` intermediary", () => {
    expect(diagnostics(PRELUDE + "fun reuse(): Vector(a) = shared\n" + CONSUMERS)).not.toEqual([]);
  });

  test("through an unannotated `fun` intermediary", () => {
    expect(diagnostics(PRELUDE + "fun reuse() = shared\n" + CONSUMERS)).not.toEqual([]);
  });

  test("direct consumption is rejected too (the unlaundered baseline)", () => {
    expect(diagnostics(
      PRELUDE +
      "export fun useInt(values: Vector(Int)): Bool = shared == values\n" +
      "export fun useText(values: Vector(String)): Bool = shared == values\n",
    )).not.toEqual([]);
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
      "let base = Vector.size([1, 2])\n" +
      "export fun bump(): Int = base + 1\n" +
      "export fun twice(): Int = base + base\n",
    )).toEqual([]);
  });
});
