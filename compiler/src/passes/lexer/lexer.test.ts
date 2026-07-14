import fc from "fast-check";
import { describe, expect, test } from "vitest";

import * as Source from "../../support/source.js";
import type * as Lexed from "../../syntax/lexed/index.js";
import { lex } from "./lexer.js";

describe("lex", () => {
  test("distinguishes hard keywords, contextual words, and cased names", () => {
    const result = lexSource(
      "let when = true\nrecord Résultat(a) derives Eq = {value: a}",
    );

    expect(kinds(result.tokens)).toEqual([
      "Let",
      "LowerName",
      "Equal",
      "True",
      "Record",
      "UpperName",
      "LeftParen",
      "LowerName",
      "RightParen",
      "LowerName",
      "UpperName",
      "Equal",
      "LeftBrace",
      "LowerName",
      "Colon",
      "LowerName",
      "RightBrace",
      "Eof",
    ]);
    expect(result.diagnostics).toEqual([]);
    expect(result.newlines).toHaveLength(1);
  });

  test("accepts Unicode continuations but requires a cased NFC initial", () => {
    const result = lexSource("let user東京 = 1\nlet 東京 = 2\nlet é = 3");

    expect(result.diagnostics.map(({ message }) => message)).toEqual([
      "Hexagon names must begin with a lowercase or uppercase cased letter",
      "identifier is not in Unicode NFC",
    ]);
    expect(nameTexts(result.tokens)).toContain("user東京");
  });

  test("classifies every numeric form and keeps dot calls separate", () => {
    const result = lexSource("0 1_000 42n 1.5 1e9 1..10 3.show");

    expect(kinds(result.tokens)).toEqual([
      "Integer",
      "Integer",
      "BigInt",
      "Float",
      "Float",
      "Integer",
      "Range",
      "Integer",
      "Integer",
      "Dot",
      "LowerName",
      "Eof",
    ]);
    expect(result.tokens[1]).toMatchObject({ decimal: "1000" });
    expect(result.tokens[2]).toMatchObject({ decimal: "42" });
    expect(result.tokens[3]).toMatchObject({ spelling: "1.5", value: 1.5 });
    expect(result.diagnostics).toEqual([]);
  });

  test("reports malformed and overflowing numeric literals as whole constructs", () => {
    const result = lexSource(
      ".5 1. 0xFF 1__0 12cats 9007199254740992 1e999",
    );

    expect(result.diagnostics.map(({ message }) => message)).toEqual([
      "a Float literal needs a digit before `.`",
      "a Float literal needs a digit after `.`",
      "Hexagon v1 has decimal literals only",
      "`_` in a number must have a digit on both sides",
      "invalid numeric literal suffix in `12cats`",
      "integer literal exceeds Int range; add `n` for a BigInt, or use an explicit conversion",
      "Float literal is too large; use `Float.infinity`",
    ]);
    expect(kinds(result.tokens)).toEqual(["Eof"]);
  });

  test("uses maximal munch over the complete punctuation inventory", () => {
    const result = lexSource(
      "( ) [ ] { } , : ; ... . => = ** * ++ + != == <= < >= > .. |> := | _ - /",
    );

    expect(kinds(result.tokens)).toEqual([
      "LeftParen",
      "RightParen",
      "LeftBracket",
      "RightBracket",
      "LeftBrace",
      "RightBrace",
      "Comma",
      "Colon",
      "Semicolon",
      "Spread",
      "Dot",
      "FatArrow",
      "Equal",
      "Power",
      "Star",
      "Concat",
      "Plus",
      "NotEqual",
      "EqualEqual",
      "LessEqual",
      "Less",
      "GreaterEqual",
      "Greater",
      "Range",
      "Pipe",
      "Assign",
      "Bar",
      "Wildcard",
      "Minus",
      "Slash",
      "Eof",
    ]);
    expect(result.diagnostics).toEqual([]);
  });

  test("treats nested comments as trivia and records physical newlines", () => {
    const result = lexSource(
      "/* outer\n /* inner */ still outer */ let x = 1 // note\n\tlet y = 2",
    );

    expect(kinds(result.tokens)).toEqual([
      "Let",
      "LowerName",
      "Equal",
      "Integer",
      "Let",
      "LowerName",
      "Equal",
      "Integer",
      "Eof",
    ]);
    expect(result.newlines).toHaveLength(2);
    expect(result.diagnostics.map(({ message }) => message)).toEqual([
      "indentation uses spaces; tabs are not allowed here",
    ]);
  });

  test("keeps interpolations nested inside one string token", () => {
    const result = lexSource('"a\r\n${\n user.name} b \\u{1F600}"');
    const string = result.tokens[0] as Lexed.StringToken;

    expect(string.kind).toBe("String");
    expect(string.parts).toHaveLength(3);
    expect(string.parts[0]).toMatchObject({ kind: "Text", value: "a\n" });
    expect(string.parts[1]).toMatchObject({ kind: "Interpolation" });
    if (string.parts[1]?.kind !== "Interpolation") {
      throw new Error("expected interpolation");
    }
    expect(kinds(string.parts[1].tokens)).toEqual([
      "LowerName",
      "Dot",
      "LowerName",
      "Eof",
    ]);
    expect(string.parts[2]).toMatchObject({ kind: "Text", value: " b 😀" });
    expect(result.newlines).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  test("diagnoses reserved string text, unknown escapes, and comment boundaries", () => {
    const result = lexSource('"#{x} \\q" */ /* unclosed');

    expect(result.diagnostics.map(({ message }) => message)).toEqual([
      "`#{` is reserved for future use; write `\\#{` for a literal `#{`",
      "unknown string escape",
      "unmatched `*/` — no open block comment",
      "unterminated block comment; opened at line 1, column 14",
    ]);
  });

  test("recovers from arbitrary UTF-16 input and keeps public spans in bounds", () => {
    fc.assert(
      fc.property(fc.string(), (text) => {
        const result = lexSource(text);
        expect(result.tokens.at(-1)?.kind).toBe("Eof");

        let previousEnd = 0;
        for (const token of result.tokens) {
          expect(token.span.start.offset).toBeGreaterThanOrEqual(previousEnd);
          expect(token.span.end.offset).toBeGreaterThanOrEqual(token.span.start.offset);
          expect(token.span.end.offset).toBeLessThanOrEqual(text.length);
          previousEnd = token.span.end.offset;
        }
        for (const diagnostic of result.diagnostics) {
          expect(diagnostic.primary.start.offset).toBeGreaterThanOrEqual(0);
          expect(diagnostic.primary.end.offset).toBeLessThanOrEqual(text.length);
        }
      }),
      { numRuns: 250 },
    );
  });
});

function lexSource(text: string) {
  return lex(new Source.File(Source.fileId(0), "test.hex", text));
}

function kinds(tokens: readonly Lexed.Token[]): readonly Lexed.Token["kind"][] {
  return tokens.map(({ kind }) => kind);
}

function nameTexts(tokens: readonly Lexed.Token[]): readonly string[] {
  return tokens.flatMap((token) =>
    token.kind === "LowerName" || token.kind === "UpperName" ? [token.text] : [],
  );
}
