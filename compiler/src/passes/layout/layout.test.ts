import fc from "fast-check";
import { describe, expect, test } from "vitest";

import * as Source from "../../support/source.js";
import type * as LaidOut from "../../syntax/laid-out/index.js";
import { lex } from "../lexer/lexer.js";
import { applyLayout } from "./layout.js";

describe("applyLayout", () => {
  test("wraps the module and separates top-level items", () => {
    expect(kinds(layout("let x = 1\nprint(x)").tokens)).toEqual([
      "VOpen", "Let", "LowerName", "Equal", "Integer",
      "VSep", "LowerName", "LeftParen", "LowerName", "RightParen",
      "VClose", "Eof",
    ]);
  });

  test("keeps comment-only lines invisible to the offside rule", () => {
    const result = layout(
      "if ready\n  first()\n// deliberately outdented\n      /* padded */\n  second()",
    );

    expect(virtualKinds(result.tokens)).toEqual([
      "VOpen", "VOpen", "VSep", "VClose", "VClose",
    ]);
    expect(result.diagnostics).toEqual([]);
  });

  test("opens nested blocks and closes repeated dedents", () => {
    const result = layout("fun f(x) =\n  if x\n    print(x)\n  print(0)\nprint(1)");

    expect(virtualKinds(result.tokens)).toEqual([
      "VOpen", "VOpen", "VOpen", "VClose", "VSep", "VClose", "VSep", "VClose",
    ]);
    expect(result.diagnostics).toEqual([]);
  });

  test("treats deeper declaration lines as continuations", () => {
    const result = layout("union Shape\n    derives Eq =\n  | Circle\n  | Point\nlet x = 1");

    expect(virtualKinds(result.tokens)).toEqual(["VOpen", "VSep", "VClose"]);
    expect(result.diagnostics).toEqual([]);
  });

  test("recognizes exported block declarations", () => {
    const result = layout("export constraint Visible<a> =\n  show(x: a): String");

    expect(virtualKinds(result.tokens)).toEqual(["VOpen", "VOpen", "VClose", "VClose"]);
    expect(result.diagnostics).toEqual([]);
  });

  test("attaches else and catch clauses without an intervening separator", () => {
    const result = layout(
      "if ready\n  run()\nelse\n  wait()\ntry\n  risky()\ncatch\n  Failure => recover()",
    );

    expect(virtualKinds(result.tokens)).toEqual([
      "VOpen", "VOpen", "VClose", "VOpen", "VClose", "VSep",
      "VOpen", "VClose", "VOpen", "VClose", "VClose",
    ]);
    expect(result.diagnostics).toEqual([]);
  });

  test("ignores newlines inside physical delimiters", () => {
    const result = layout("let value = call(\n  first,\n  second\n)\nprint(value)");

    expect(virtualKinds(result.tokens)).toEqual(["VOpen", "VSep", "VClose"]);
    expect(result.diagnostics).toEqual([]);
  });

  test("allows a layout lambda body inside a physical delimiter", () => {
    const result = layout("map(values, x =>\n  inspect(x); transform(x)\n)\nprint(\"done\")");

    expect(virtualKinds(result.tokens)).toEqual([
      "VOpen", "VOpen", "VClose", "VSep", "VClose",
    ]);
    expect(result.diagnostics).toEqual([]);
  });

  test("validates semicolons as same-line block separators", () => {
    const result = layout("; let x = 1;; let y = (1; 2)\nlet z = 3;");

    expect(result.diagnostics.map(({ message }) => message)).toEqual([
      "`;` must have a statement on both sides.",
      "`;` must have a statement on both sides.",
      "`;` must have a statement on both sides.",
      "did you mean `,`? `;` only separates statements.",
      "`;` separates statements; Hexagon lines don't end with one.",
    ]);
  });

  test("retains a legal semicolon without adding a virtual separator", () => {
    const result = layout("let f = x => print(x); print(\"done\")");

    expect(virtualKinds(result.tokens)).toEqual(["VOpen", "VClose"]);
    expect(result.tokens.filter(({ kind }) => kind === "Semicolon")).toHaveLength(1);
    expect(result.diagnostics).toEqual([]);
  });

  test("reports inconsistent dedents and recovers at the revealed block", () => {
    const result = layout("if x\n  if y\n    a\n   b\nc");

    expect(result.diagnostics.map(({ message }) => message)).toContain(
      "inconsistent dedent; expected one of columns 0, 2",
    );
    expect(result.tokens.at(-1)?.kind).toBe("Eof");
  });

  test("preserves lexical diagnostics and closes an empty module", () => {
    const empty = layout("");
    expect(kinds(empty.tokens)).toEqual(["VOpen", "VClose", "Eof"]);

    const invalid = layout("@\nlet x = 1");
    expect(invalid.diagnostics.map(({ message }) => message)).toContain(
      'invalid character "@" (U+0040)',
    );
  });

  test("reports a block head left open at end of file", () => {
    const result = layout("if ready");

    expect(result.diagnostics.map(({ message }) => message)).toContain(
      "expected an indented block",
    );
  });

  test("keeps virtual tokens balanced while recovering from arbitrary input", () => {
    fc.assert(
      fc.property(fc.string(), (text) => {
        const result = layout(text);
        let depth = 0;

        for (const token of result.tokens) {
          if (token.kind === "VOpen") depth += 1;
          if (token.kind === "VClose") depth -= 1;
          expect(depth).toBeGreaterThanOrEqual(0);
          expect(token.span.start.offset).toBeGreaterThanOrEqual(0);
          expect(token.span.end.offset).toBeLessThanOrEqual(text.length);
        }

        expect(depth).toBe(0);
        expect(result.tokens.at(-1)?.kind).toBe("Eof");
      }),
      { numRuns: 250 },
    );
  });
});

function layout(text: string): LaidOut.File {
  const source = new Source.File(Source.fileId(0), "test.hex", text);
  return applyLayout(lex(source));
}

function kinds(tokens: readonly LaidOut.Token[]): readonly LaidOut.Token["kind"][] {
  return tokens.map(({ kind }) => kind);
}

function virtualKinds(tokens: readonly LaidOut.Token[]): readonly string[] {
  return tokens.flatMap(({ kind }) =>
    kind === "VOpen" || kind === "VSep" || kind === "VClose" ? [kind] : [],
  );
}
