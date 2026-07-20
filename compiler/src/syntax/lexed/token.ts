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
  "Union",
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
  readonly tokens: readonly Token[];
  readonly newlines: readonly Newline[];
  readonly comments: readonly Source.Comment[];
  readonly diagnostics: readonly Diagnostics.Diagnostic[];
}
