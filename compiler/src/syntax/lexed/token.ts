/**
 * Lexed syntax is the physical token stream produced directly from source.
 * It preserves exact source spans and literal payloads but contains no virtual
 * layout delimiters; only the layout pass may create those later-phase tokens.
 *
 * See spec/lexer.md §9.
 */

import type * as Diagnostics from "../../support/diagnostics.js";
import type * as Source from "../../support/source.js";

export const keywordKinds = [
  "And",
  "Catch",
  "Constraint",
  "Derive",
  "Else",
  "Exception",
  "Export",
  "Extern",
  "False",
  "Finally",
  "For",
  "Fun",
  "Honor",
  "Iff",
  "If",
  "Implies",
  "Import",
  "In",
  "Let",
  "Match",
  "Not",
  "Or",
  "Record",
  "Then",
  "True",
  "Try",
  "Type",
  "Var",
  "While",
] as const;

export type KeywordKind = (typeof keywordKinds)[number];

export const punctuationKinds = [
  "LeftParen",
  "RightParen",
  "LeftBracket",
  "RightBracket",
  "LeftBrace",
  "RightBrace",
  "Comma",
  "Colon",
  "Semicolon",
  "Dot",
  "Spread",
  "Equal",
  "FatArrow",
  "Arrow",
  "Plus",
  "Minus",
  "Star",
  "Slash",
  "Power",
  "Concat",
  "EqualEqual",
  "NotEqual",
  "Less",
  "Greater",
  "LessEqual",
  "GreaterEqual",
  "Range",
  "Pipe",
  "Assign",
  "Bar",
  "Wildcard",
  // The effects discipline's tokens (Lexer §8.1; Effects §2.3), lexed
  // unconditionally since #364 removed the flag they shipped behind. A lone `!`
  // is the impure call mark, and the `not` redirect it displaced is the
  // parser's now, position-selected.
  //
  // The marked type arrows are glued single tokens rather than `->` followed by
  // a mark, because the mark trails the arrow it colours exactly as it trails
  // the callee it marks (#405). `!->` and `?->` are not admitted at all: a mark
  // never begins a token. `Arrow` above is the pure member of the same trio.
  "ArrowQuestion",
  "ArrowBang",
  "Bang",
  "Question",
] as const;

export type PunctuationKind = (typeof punctuationKinds)[number];

export interface SimpleToken {
  readonly kind: KeywordKind | PunctuationKind;
  readonly span: Source.Span;
}

export interface NameToken {
  readonly kind: "NonUpperName" | "UpperName";
  readonly text: string;
  readonly span: Source.Span;
}

export interface IntegerToken {
  readonly kind: "Integer";
  readonly decimal: string;
  readonly span: Source.Span;
}

export interface BigIntToken {
  readonly kind: "BigInt";
  readonly decimal: string;
  readonly span: Source.Span;
}

export interface FloatToken {
  readonly kind: "Float";
  readonly spelling: string;
  readonly value: number;
  readonly span: Source.Span;
}

export interface StringText {
  readonly kind: "Text";
  readonly value: string;
  readonly span: Source.Span;
}

export interface StringInterpolation {
  readonly kind: "Interpolation";
  readonly tokens: readonly Token[];
  readonly span: Source.Span;
}

export type StringPart = StringText | StringInterpolation;

export interface StringToken {
  readonly kind: "String";
  readonly parts: readonly StringPart[];
  readonly span: Source.Span;
}

export interface EofToken {
  readonly kind: "Eof";
  readonly span: Source.Span;
}

export type Token =
  | SimpleToken
  | NameToken
  | IntegerToken
  | BigIntToken
  | FloatToken
  | StringToken
  | EofToken;

export interface Newline {
  readonly span: Source.Span;
}

export interface File {
  readonly fileId: Source.FileId;
  /**
   * The source this file was scanned from, carried so a later pass can quote or
   * *rearrange* the program's own text.
   *
   * One thing reads it above the lexer: Modules §2.2's fixit for an item
   * standing above the first header, which moves the header line — an edit that
   * has to reproduce the run of whitespace it lifts, and cannot invent it from
   * tokens and spans. The parser is otherwise text-free and stays so; this is
   * the same narrow door `ResolveOptions.text` opens one pass later, and for
   * the same reason (Modules §7.6: a fixit the reader cannot paste is worse
   * than none).
   */
  readonly text: string;
  readonly tokens: readonly Token[];
  readonly newlines: readonly Newline[];
  readonly comments: readonly Source.Comment[];
  readonly diagnostics: readonly Diagnostics.Diagnostic[];
}
