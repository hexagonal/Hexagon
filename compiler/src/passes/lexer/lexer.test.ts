import fc from "fast-check";
import { describe, expect, test } from "vitest";

import * as Source from "../../support/source.js";
import type * as Lexed from "../../syntax/lexed/index.js";
import { lex } from "./lexer.js";

describe("lex", () => {
  test("distinguishes hard keywords, contextual words, and cased names", () => {
    const result = lexSource(
      // `true` stays lowercase here on purpose: this is the lexer, where #147
      // kept `true`/`false` as hard keywords. Rejecting them is the parser's job.
      "let when = true\nrecord Résultat(a) derives Eq = {value: a}",
    );

    expect(kinds(result.tokens)).toEqual([
      "Let",
      "NonUpperName",
      "Equal",
      "True",
      "Record",
      "UpperName",
      "LeftParen",
      "NonUpperName",
      "RightParen",
      "NonUpperName",
      "UpperName",
      "Equal",
      "LeftBrace",
      "NonUpperName",
      "Colon",
      "NonUpperName",
      "RightBrace",
      "Eof",
    ]);
    expect(result.diagnostics).toEqual([]);
    expect(result.newlines).toHaveLength(1);
  });

  /**
   * §4.1's hard-keyword table lost `union` at the Set step (#373). The lexer is
   * where that is decided and where it is smallest to check: the word arrives
   * as an ordinary `NonUpperName` in *every* position, declaration head
   * included, and which of them opens a declaration is the parser's business
   * (Products §3.3's division, the same one `with` and `when` follow).
   */
  test("`union` is contextual, so the lexer never gives it a keyword kind", () => {
    const declaration = lexSource("union Colour = Red | Green");
    expect(kinds(declaration.tokens)).toEqual([
      "NonUpperName",
      "UpperName",
      "Equal",
      "UpperName",
      "Bar",
      "UpperName",
      "Eof",
    ]);
    expect(declaration.diagnostics).toEqual([]);

    // A binder and a member reference, which a hard keyword made unspellable.
    const term = lexSource("let union = Set.union");
    expect(kinds(term.tokens)).toEqual([
      "Let",
      "NonUpperName",
      "Equal",
      "UpperName",
      "Dot",
      "NonUpperName",
      "Eof",
    ]);
    expect(term.diagnostics).toEqual([]);

    // The control: the words beside it in the table are untouched.
    expect(kinds(lexSource("record type").tokens)).toEqual(["Record", "Type", "Eof"]);
  });

  test("uses JavaScript-compatible Unicode identifiers and classifies only uppercase starts specially", () => {
    const result = lexSource(
      "let 用户 = 1\nlet $税率 = 2\nlet _折扣 = 3\nrecord T用户 = {名字: String}\nlet é = 4",
    );

    expect(result.diagnostics).toEqual([]);
    expect(nameTexts(result.tokens)).toEqual([
      "用户", "$税率", "_折扣", "T用户", "名字", "String", "é",
    ]);
    expect(result.tokens.filter(({ kind }) => kind === "UpperName")).toHaveLength(2);
  });

  test("reserves bare wildcard and compiler names, and rejects emoji and literal bidi controls", () => {
    const result = lexSource("_ __hex_temp 😀 x\u202Ey");

    expect(result.tokens[0]?.kind).toBe("Wildcard");
    expect(result.diagnostics.map(({ message }) => message)).toEqual([
      "`__hex_` is reserved for compiler-generated names",
      'invalid character "😀" (U+1F600)',
      "literal bidirectional controls are not allowed in Hexagon source; use a Unicode escape inside a string",
    ]);
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
      "NonUpperName",
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
      "( ) [ ] { } , : ; ... . => -> = ** * ++ + != == <= < >= > .. |> := | _ - /",
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
      "Arrow",
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
      "(* outer\n (* inner *) still outer *) let x = 1 // note\n\tlet y = 2",
    );

    expect(kinds(result.tokens)).toEqual([
      "Let",
      "NonUpperName",
      "Equal",
      "Integer",
      "Let",
      "NonUpperName",
      "Equal",
      "Integer",
      "Eof",
    ]);
    expect(result.newlines).toHaveLength(2);
    expect(result.comments.map(({ kind, text }) => [kind, text])).toEqual([
      ["Block", "(* outer\n (* inner *) still outer *)"],
      ["Line", "// note"],
    ]);
    expect(result.diagnostics.map(({ message }) => message)).toEqual([
      "indentation uses spaces; tabs are not allowed here",
    ]);
    expect(result.diagnostics[0]?.fixes?.[0]?.edits[0]?.replacement).toBe("    ");
  });

  test("lexes the block-comment acceptance tests of spec/comments.md §8", () => {
    const empty = lexSource("(**)");
    expect(empty.comments.map(({ text }) => text)).toEqual(["(**)"]);
    expect(empty.diagnostics).toEqual([]);

    const inline = lexSource("let y = (* inline *) 2");
    expect(kinds(inline.tokens)).toEqual(["Let", "NonUpperName", "Equal", "Integer", "Eof"]);
    expect(inline.diagnostics).toEqual([]);

    // `(*` opens and the `)` is comment text, so the file ends inside the comment.
    expect(lexSource("(*)").diagnostics.map(({ message }) => message)).toEqual([
      "unterminated block comment; opened at line 1, column 1",
    ]);

    expect(lexSource("(* a (* b").diagnostics.map(({ message }) => message)).toEqual([
      "unterminated block comment; opened at line 1, column 6 (nested 2 levels deep; each `(*` needs its own `*)`)",
    ]);

    // Strings are not lexed inside comments: the comment ends at the `*)` in the quotes.
    const quoted = lexSource('(* "unclosed string with *) let z = 1');
    expect(kinds(quoted.tokens)).toEqual(["Let", "NonUpperName", "Equal", "Integer", "Eof"]);
    expect(quoted.diagnostics).toEqual([]);

    // ...and comments are not lexed inside strings.
    const string = lexSource('let s = "not a // comment, not a (* one"');
    expect(string.comments).toEqual([]);
    expect(string.diagnostics).toEqual([]);

    // `**` munches positionally, so `**)` never reaches the comment machinery.
    const power = lexSource("let b = a **) 2");
    expect(kinds(power.tokens)).toEqual([
      "Let",
      "NonUpperName",
      "Equal",
      "NonUpperName",
      "Power",
      "RightParen",
      "Integer",
      "Eof",
    ]);
    expect(power.diagnostics).toEqual([]);

    // An interpolation hole is expression territory, so a comment there is trivia.
    const hole = lexSource('"${ (* why *) x }"');
    expect(hole.comments.map(({ text }) => text)).toEqual(["(* why *)"]);
    expect(hole.diagnostics).toEqual([]);

    // `--` is not a comment spelling: `x --1` is `x - (-1)`.
    expect(kinds(lexSource("x --1").tokens)).toEqual([
      "NonUpperName",
      "Minus",
      "Minus",
      "Integer",
      "Eof",
    ]);
  });

  test("redirects the JavaScript block-comment spellings", () => {
    const opener = lexSource("/* JS habit */\nlet x = 1");
    expect(opener.diagnostics.map(({ message }) => message)).toEqual([
      "JavaScript block comment syntax — Hexagon block comments are `(* ... *)`",
    ]);
    // Recovery resumes after JavaScript's own closer, so the pasted comment costs
    // one diagnostic and the code after it still lexes.
    expect(kinds(opener.tokens)).toEqual(["Let", "NonUpperName", "Equal", "Integer", "Eof"]);
    expect(opener.comments).toEqual([]);
    expect(opener.diagnostics[0]?.fixes?.[0]?.edits.map(({ replacement }) => replacement)).toEqual([
      "(*",
      "*)",
    ]);

    const documentation = lexSource("/** doc */");
    expect(documentation.diagnostics.map(({ message }) => message)).toEqual([
      "JavaScript block comment syntax — Hexagon block comments are `(* ... *)` (documentation form: `(** ... *)`)",
    ]);
    expect(
      documentation.diagnostics[0]?.fixes?.[0]?.edits.map(({ replacement }) => replacement),
    ).toEqual(["(**", "*)"]);

    // `/**/` is JavaScript's empty comment, not its documentation opener.
    expect(lexSource("/**/").diagnostics.map(({ message }) => message)).toEqual([
      "JavaScript block comment syntax — Hexagon block comments are `(* ... *)`",
    ]);

    // With no closer to pair with, the single error at the opener stands on its
    // message: rewriting the opener alone would only trade this error for an
    // unterminated Hexagon comment.
    for (const source of ["/* never closed", "/** doc, never closed"]) {
      const unclosed = lexSource(source);
      expect(unclosed.diagnostics, source).toHaveLength(1);
      expect(unclosed.diagnostics[0]?.fixes, source).toBeUndefined();
    }

    // The recovery crosses lines, and what it crosses stays trivia: the newlines are
    // recorded for layout and the tab below is comment text, not indentation.
    const spanning = lexSource("/* one\n\ttwo */\n\tlet y = 2");
    expect(spanning.diagnostics.map(({ message }) => message)).toEqual([
      "JavaScript block comment syntax — Hexagon block comments are `(* ... *)`",
      "indentation uses spaces; tabs are not allowed here",
    ]);
    expect(spanning.newlines).toHaveLength(2);

    const closer = lexSource("*/");
    expect(closer.diagnostics.map(({ message }) => message)).toEqual([
      "`*/` is JavaScript's block comment closer — Hexagon spells it `*)`; no block comment is open here",
    ]);
    expect(closer.diagnostics[0]?.fixes).toBeUndefined();
  });

  test("keeps interpolations nested inside one string token", () => {
    const result = lexSource('"a\r\n${\n  user.name} b \\u{1F600}"');
    const string = result.tokens[0] as Lexed.StringToken;

    expect(string.kind).toBe("String");
    expect(string.parts).toHaveLength(3);
    expect(string.parts[0]).toMatchObject({ kind: "Text", value: "a\n" });
    expect(string.parts[1]).toMatchObject({ kind: "Interpolation" });
    if (string.parts[1]?.kind !== "Interpolation") {
      throw new Error("expected interpolation");
    }
    expect(kinds(string.parts[1].tokens)).toEqual([
      "NonUpperName",
      "Dot",
      "NonUpperName",
      "Eof",
    ]);
    expect(string.parts[2]).toMatchObject({ kind: "Text", value: " b 😀" });
    expect(result.newlines).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  test("diagnoses reserved string text, unknown escapes, and comment boundaries", () => {
    const result = lexSource('"#{x} \\q" *) (* unclosed');

    expect(result.diagnostics.map(({ message }) => message)).toEqual([
      "`#{` is reserved for future use; write `\\#{` for a literal `#{`",
      "unknown string escape",
      "unmatched `*)` — no open block comment",
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

/**
 * Documentation trivia (`spec/doc-comments.md` §2). The lexer's whole share of
 * the feature is the classification at the opener; everything downstream of it
 * reads `documentation`, so what these pin is the predicate — and, just as
 * hard, that `///` acquires nothing.
 */
describe("documentation trivia", () => {
  test("recognizes `(**` followed by a character that is neither `)` nor `*`", () => {
    const result = lexSource(
      "(** doc *)\n(**x*)\n(**\n  newline first\n*)\n(** *bold* *)\n",
    );

    expect(result.diagnostics).toEqual([]);
    expect(result.comments.map(({ documentation }) => documentation)).toEqual([
      true,
      true,
      true,
      true,
    ]);
  });

  test("`(**)`, `(***`, and plain `(*` stay ordinary comments (§2.2)", () => {
    const result = lexSource(
      "(**)\n(***)\n(**********)\n(*** doc? *)\n(* plain *)\n(*! not special *)\n",
    );

    expect(result.diagnostics).toEqual([]);
    expect(result.comments.map(({ documentation }) => documentation)).toEqual([
      false,
      false,
      false,
      false,
      false,
      false,
    ]);
  });

  test("`///` is nothing: the lexer does not count slashes (§2.3)", () => {
    // The revocation, pinned. `///` is a `//` line comment whose text begins
    // with `/`, and so is `////`; no line documentation form exists or is
    // reserved, so this must survive every future edit to trivia scanning.
    const result = lexSource("/// doc?\n//// more?\n// plain\nlet a = 1\n");

    expect(result.diagnostics).toEqual([]);
    expect(result.comments.map(({ kind, documentation, text }) => ({
      kind,
      documentation,
      text,
    }))).toEqual([
      { kind: "Line", documentation: false, text: "/// doc?" },
      { kind: "Line", documentation: false, text: "//// more?" },
      { kind: "Line", documentation: false, text: "// plain" },
    ]);
  });

  test("an unterminated doc comment keeps its classification and its own error", () => {
    const result = lexSource("(** never closed\n");

    expect(result.diagnostics.map(({ message }) => message)).toEqual([
      "unterminated block comment; opened at line 1, column 1",
    ]);
    expect(result.comments.map(({ documentation }) => documentation)).toEqual([true]);
  });

  test("`(**` at end of file has no character after the opener, so it is ordinary", () => {
    const result = lexSource("(**");

    expect(result.comments.map(({ documentation }) => documentation)).toEqual([false]);
  });

  test("nesting is the ordinary block rule; an inner `(**` is not its own comment", () => {
    const result = lexSource("(** outer (** inner *) still outer *)\n");

    expect(result.diagnostics).toEqual([]);
    expect(result.comments).toHaveLength(1);
    expect(result.comments[0]!.documentation).toBe(true);
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
    token.kind === "NonUpperName" || token.kind === "UpperName" ? [token.text] : [],
  );
}
