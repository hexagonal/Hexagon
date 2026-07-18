/**
 * The physical lexer turns one Source.File into a Lexed.File. It recognizes the
 * complete closed token inventory, records physical newlines for layout, and
 * recovers from malformed source without inventing successful public tokens.
 * String interpolation recursively uses this scanner but stays inside one outer
 * string token, so the later layout pass cannot observe indentation in a hole.
 *
 * See spec/lexer.md and spec/comments.md.
 */

import * as Diagnostics from "../../support/diagnostics.js";
import * as Source from "../../support/source.js";
import type * as Lexed from "../../syntax/lexed/index.js";
import {
  idContinue,
  idStart,
  titlecase,
  uppercase,
} from "./unicode-17.js";

const MAX_SAFE_INTEGER_DECIMAL = 9_007_199_254_740_991n;

const keywords: Readonly<Record<string, Lexed.KeywordKind>> = {
  and: "And",
  catch: "Catch",
  constraint: "Constraint",
  derive: "Derive",
  else: "Else",
  exception: "Exception",
  export: "Export",
  extern: "Extern",
  false: "False",
  finally: "Finally",
  for: "For",
  fun: "Fun",
  honor: "Honor",
  iff: "Iff",
  if: "If",
  implies: "Implies",
  import: "Import",
  in: "In",
  let: "Let",
  match: "Match",
  not: "Not",
  or: "Or",
  record: "Record",
  then: "Then",
  true: "True",
  try: "Try",
  type: "Type",
  union: "Union",
  var: "Var",
  while: "While",
};

const punctuation: readonly (readonly [string, Lexed.PunctuationKind])[] = [
  ["...", "Spread"],
  ["**", "Power"],
  ["++", "Concat"],
  ["==", "EqualEqual"],
  ["!=", "NotEqual"],
  ["<=", "LessEqual"],
  [">=", "GreaterEqual"],
  ["..", "Range"],
  ["|>", "Pipe"],
  [":=", "Assign"],
  ["=>", "FatArrow"],
  ["(", "LeftParen"],
  [")", "RightParen"],
  ["[", "LeftBracket"],
  ["]", "RightBracket"],
  ["{", "LeftBrace"],
  ["}", "RightBrace"],
  [",", "Comma"],
  [":", "Colon"],
  [";", "Semicolon"],
  [".", "Dot"],
  ["=", "Equal"],
  ["+", "Plus"],
  ["-", "Minus"],
  ["*", "Star"],
  ["/", "Slash"],
  ["<", "Less"],
  [">", "Greater"],
  ["|", "Bar"],
  ["_", "Wildcard"],
];

export function lex(source: Source.File): Lexed.File {
  const diagnostics = new Diagnostics.Bag();
  validateSourceCharacters(source, diagnostics);
  const scanner = new Scanner(source, diagnostics);
  const { tokens } = scanner.scanSequence(false);

  return {
    fileId: source.id,
    tokens,
    newlines: scanner.newlines,
    comments: scanner.comments,
    diagnostics: diagnostics.toArray(),
  };
}

interface ScannedSequence {
  readonly tokens: readonly Lexed.Token[];
  readonly closedInterpolation: boolean;
}

class Scanner {
  readonly newlines: Lexed.Newline[] = [];
  readonly comments: Source.Comment[] = [];

  readonly #source: Source.File;
  readonly #diagnostics: Diagnostics.Bag;

  #offset = 0;
  #atLineStart = true;
  #suppressNewlines = 0;

  constructor(source: Source.File, diagnostics: Diagnostics.Bag) {
    this.#source = source;
    this.#diagnostics = diagnostics;
  }

  /** Scans either a complete file or one interpolation's balanced token stream. */
  scanSequence(stopAtInterpolationEnd: boolean): ScannedSequence {
    const tokens: Lexed.Token[] = [];
    let braceDepth = 0;

    while (this.#offset < this.#source.text.length) {
      this.#scanTrivia();

      if (this.#offset >= this.#source.text.length) {
        break;
      }

      if (
        stopAtInterpolationEnd &&
        braceDepth === 0 &&
        this.#source.text[this.#offset] === "}"
      ) {
        tokens.push(this.#eof());
        return { tokens, closedInterpolation: true };
      }

      const token = this.#scanToken();
      if (token === undefined) {
        continue;
      }

      if (stopAtInterpolationEnd) {
        if (token.kind === "LeftBrace") {
          braceDepth += 1;
        } else if (token.kind === "RightBrace") {
          braceDepth -= 1;
        }
      }

      tokens.push(token);
    }

    tokens.push(this.#eof());
    return { tokens, closedInterpolation: false };
  }

  #scanTrivia(): void {
    while (this.#offset < this.#source.text.length) {
      const start = this.#offset;
      const codeUnit = this.#source.text.charCodeAt(this.#offset);

      if (codeUnit === 0xfeff) {
        this.#offset += 1;
      } else if (codeUnit === 0x20) {
        this.#offset += 1;
      } else if (codeUnit === 0x09) {
        this.#scanTab();
      } else if (isNewlineStart(codeUnit)) {
        this.#scanNewline();
      } else if (this.#startsWith("//")) {
        const commentStart = this.#offset;
        this.#atLineStart = false;
        this.#offset += 2;
        while (
          this.#offset < this.#source.text.length &&
          !isNewlineStart(this.#source.text.charCodeAt(this.#offset))
        ) {
          this.#offset += scalarWidth(this.#source.text, this.#offset);
        }
        this.#recordComment("Line", commentStart);
      } else if (this.#startsWith("/*")) {
        this.#atLineStart = false;
        this.#scanBlockComment();
      } else {
        return;
      }

      if (this.#offset <= start) {
        throw new Error("internal error: trivia scanning did not advance");
      }
    }
  }

  #scanTab(): void {
    const start = this.#offset;
    while (this.#source.text.charCodeAt(this.#offset) === 0x09) {
      this.#offset += 1;
    }

    if (this.#atLineStart) {
      this.#error(
        start,
        this.#offset,
        "indentation uses spaces; tabs are not allowed here",
        {
          message: "replace tabs with spaces",
          replacement: "  ".repeat(this.#offset - start),
        },
      );
    }
  }

  #scanNewline(): void {
    const start = this.#offset;
    if (this.#startsWith("\r\n")) {
      this.#offset += 2;
    } else {
      this.#offset += 1;
    }

    if (this.#suppressNewlines === 0) {
      this.newlines.push({ span: this.#source.span(start, this.#offset) });
    }
    this.#atLineStart = true;
  }

  #scanBlockComment(): void {
    const commentStart = this.#offset;
    const openers: number[] = [this.#offset];
    this.#offset += 2;

    while (this.#offset < this.#source.text.length) {
      if (this.#startsWith("/*")) {
        openers.push(this.#offset);
        this.#offset += 2;
      } else if (this.#startsWith("*/")) {
        openers.pop();
        this.#offset += 2;
        if (openers.length === 0) {
          this.#atLineStart = false;
          this.#recordComment("Block", commentStart);
          return;
        }
      } else if (isNewlineStart(this.#source.text.charCodeAt(this.#offset))) {
        this.#scanNewline();
        // A comment is already content on this physical line. Tabs within it are
        // comment text, even before the closing delimiter.
        this.#atLineStart = false;
      } else {
        this.#offset += scalarWidth(this.#source.text, this.#offset);
      }
    }

    const innermost = openers.at(-1);
    if (innermost === undefined) {
      throw new Error("internal error: unterminated comment lost its opener");
    }

    const depth = openers.length;
    const nested =
      depth > 1
        ? ` (nested ${depth} levels deep; each \`/*\` needs its own \`*/\`)`
        : "";
    this.#recordComment("Block", commentStart);
    this.#error(
      innermost,
      Math.min(innermost + 2, this.#source.text.length),
      `unterminated block comment; opened at line ${
        this.#source.positionAt(innermost).line + 1
      }, column ${this.#source.positionAt(innermost).column + 1}${nested}`,
    );
  }

  #recordComment(kind: Source.Comment["kind"], start: number): void {
    this.comments.push({
      kind,
      text: this.#source.text.slice(start, this.#offset),
      span: this.#source.span(start, this.#offset),
    });
  }

  #scanToken(): Lexed.Token | undefined {
    const start = this.#offset;
    const codeUnit = this.#source.text.charCodeAt(start);

    this.#atLineStart = false;

    if (isBidiControl(codeUnit)) {
      // validateSourceCharacters owns the one diagnostic, including when the
      // literal control occurs inside a comment or string.
      this.#offset += 1;
      return undefined;
    }

    if (this.#startsWith("*/")) {
      this.#offset += 2;
      this.#error(start, this.#offset, "unmatched `*/` — no open block comment");
      return undefined;
    }

    if (this.#startsWith("&&") || this.#startsWith("||")) {
      const spelling = this.#source.text.slice(start, start + 2);
      this.#offset += 2;
      this.#error(
        start,
        this.#offset,
        `Hexagon spells logical ${spelling === "&&" ? "conjunction `and`" : "disjunction `or`"}`,
      );
      return undefined;
    }

    if (codeUnit === 0x21 && !this.#startsWith("!=")) {
      this.#offset += 1;
      this.#error(start, this.#offset, "Hexagon spells logical negation `not`");
      return undefined;
    }

    if (codeUnit === 0x22) {
      return this.#scanString();
    }

    if (isAsciiDigit(codeUnit)) {
      return this.#scanNumber();
    }

    if (codeUnit === 0x2e && isAsciiDigit(this.#peekCodeUnit(1))) {
      this.#offset += 1;
      this.#consumeDigitsAndUnderscores();
      this.#consumeNumericTail();
      this.#error(start, this.#offset, "a Float literal needs a digit before `.`", {
        message: "add a leading zero",
        replacement: `0${this.#source.text.slice(start, this.#offset)}`,
      });
      return undefined;
    }

    if (codeUnit === 0x5f && !this.#continuesIdentifierAt(this.#offset + 1)) {
      this.#offset += 1;
      return { kind: "Wildcard", span: this.#source.span(start, this.#offset) };
    }

    const scalar = this.#scalarAt(this.#offset);
    if (scalar === undefined) {
      this.#offset += 1;
      return undefined;
    }

    if (isIdentifierStart(scalar)) {
      return this.#scanName();
    }

    if (isIdentifierContinue(scalar)) {
      this.#consumeIdentifierRun();
      this.#error(
        start,
        this.#offset,
        "identifier continuation character cannot begin a Hexagon name",
      );
      return undefined;
    }

    for (const [spelling, kind] of punctuation) {
      if (this.#startsWith(spelling)) {
        this.#offset += spelling.length;
        return { kind, span: this.#source.span(start, this.#offset) };
      }
    }

    if (isUnsupportedWhitespace(codeUnit)) {
      this.#offset += scalar.length;
      this.#error(
        start,
        this.#offset,
        `unsupported whitespace U+${codePointLabel(scalar.codePointAt(0) ?? codeUnit)}`,
        { message: "replace with an ordinary space", replacement: " " },
      );
      return undefined;
    }

    this.#offset += scalar.length;
    this.#error(
      start,
      this.#offset,
      `invalid character ${JSON.stringify(scalar)} (U+${codePointLabel(
        scalar.codePointAt(0) ?? codeUnit,
      )})`,
    );
    return undefined;
  }

  #scanName(): Lexed.Token | undefined {
    const start = this.#offset;
    const first = this.#scalarAt(this.#offset);
    if (first === undefined) {
      throw new Error("internal error: name scanning requires a Unicode scalar");
    }

    this.#offset += first.length;
    this.#consumeIdentifierRun();
    const text = this.#source.text.slice(start, this.#offset);

    if (text.startsWith("__hex_")) {
      this.#error(start, this.#offset, "`__hex_` is reserved for compiler-generated names", {
        message: "rename this identifier",
        replacement: `_hex_${text.slice("__hex_".length)}`,
      });
      return undefined;
    }

    if (!matches(uppercase, first) && !matches(titlecase, first)) {
      const keyword = keywords[text];
      return keyword === undefined
        ? { kind: "NonUpperName", text, span: this.#source.span(start, this.#offset) }
        : { kind: keyword, span: this.#source.span(start, this.#offset) };
    }

    if (matches(uppercase, first) || matches(titlecase, first)) {
      return {
        kind: "UpperName",
        text,
        span: this.#source.span(start, this.#offset),
      };
    }

    throw new Error("internal error: identifier start was not classified");
  }

  #scanNumber(): Lexed.Token | undefined {
    const start = this.#offset;
    const integerDigits = this.#consumeDigitsAndUnderscores();

    if (!validDigitSeparators(integerDigits)) {
      this.#consumeNumericTail();
      this.#error(
        start,
        this.#offset,
        "`_` in a number must have a digit on both sides",
      );
      return undefined;
    }

    if (
      integerDigits === "0" &&
      ["x", "X", "o", "O", "b", "B"].includes(
        this.#source.text[this.#offset] ?? "",
      )
    ) {
      this.#consumeNumericTail();
      this.#error(start, this.#offset, "Hexagon v1 has decimal literals only");
      return undefined;
    }

    if (this.#source.text[this.#offset] === "n") {
      this.#offset += 1;
      if (this.#continuesIdentifierAt(this.#offset)) {
        this.#consumeNumericTail();
        if (this.#source.text.slice(start, this.#offset).includes("_")) {
          this.#error(
            start,
            this.#offset,
            "`_` in a number must have a digit on both sides",
          );
        } else {
          this.#invalidNumericSuffix(start);
        }
        return undefined;
      }

      return {
        kind: "BigInt",
        decimal: integerDigits.replaceAll("_", ""),
        span: this.#source.span(start, this.#offset),
      };
    }

    let isFloat = false;
    if (this.#source.text[this.#offset] === ".") {
      if (this.#source.text[this.#offset + 1] === ".") {
        return this.#finishInteger(start, integerDigits);
      }

      if (isAsciiDigit(this.#peekCodeUnit(1))) {
        isFloat = true;
        this.#offset += 1;
        const fraction = this.#consumeDigitsAndUnderscores();
        if (!validDigitSeparators(fraction)) {
          this.#consumeNumericTail();
          this.#error(
            start,
            this.#offset,
            "`_` in a number must have a digit on both sides",
          );
          return undefined;
        }
      } else if (this.#source.text[this.#offset + 1] === "_") {
        this.#offset += 1;
        this.#consumeNumericTail();
        this.#error(
          start,
          this.#offset,
          "`_` in a number must have a digit on both sides",
        );
        return undefined;
      } else if (!this.#continuesIdentifierAt(this.#offset + 1)) {
        this.#offset += 1;
        this.#error(start, this.#offset, "a Float literal needs a digit after `.`", {
          message: "add a trailing zero",
          replacement: `${this.#source.text.slice(start, this.#offset)}0`,
        });
        return undefined;
      }
    }

    if (["e", "E"].includes(this.#source.text[this.#offset] ?? "")) {
      isFloat = true;
      this.#offset += 1;
      if (["+", "-"].includes(this.#source.text[this.#offset] ?? "")) {
        this.#offset += 1;
      }

      if (!isAsciiDigit(this.#source.text.charCodeAt(this.#offset))) {
        this.#consumeNumericTail();
        if (this.#source.text.slice(start, this.#offset).includes("_")) {
          this.#error(
            start,
            this.#offset,
            "`_` in a number must have a digit on both sides",
          );
        } else {
          this.#invalidNumericSuffix(start);
        }
        return undefined;
      }

      const exponent = this.#consumeDigitsAndUnderscores();
      if (!validDigitSeparators(exponent)) {
        this.#consumeNumericTail();
        this.#error(
          start,
          this.#offset,
          "`_` in a number must have a digit on both sides",
        );
        return undefined;
      }
    }

    if (this.#continuesIdentifierAt(this.#offset)) {
      this.#consumeNumericTail();
      this.#invalidNumericSuffix(start);
      return undefined;
    }

    if (!isFloat) {
      return this.#finishInteger(start, integerDigits);
    }

    const spelling = this.#source.text.slice(start, this.#offset);
    const value = Number(spelling.replaceAll("_", ""));
    if (!Number.isFinite(value)) {
      this.#error(
        start,
        this.#offset,
        "Float literal is too large; use `Float.infinity`",
      );
      return undefined;
    }

    return {
      kind: "Float",
      spelling,
      value,
      span: this.#source.span(start, this.#offset),
    };
  }

  #finishInteger(start: number, digits: string): Lexed.Token | undefined {
    const decimal = digits.replaceAll("_", "");
    if (BigInt(decimal) > MAX_SAFE_INTEGER_DECIMAL) {
      this.#error(
        start,
        this.#offset,
        "integer literal exceeds Int range; add `n` for a BigInt, or use an explicit conversion",
        {
          message: "make this a BigInt literal",
          replacement: `${this.#source.text.slice(start, this.#offset)}n`,
        },
      );
      return undefined;
    }

    return {
      kind: "Integer",
      decimal,
      span: this.#source.span(start, this.#offset),
    };
  }

  #invalidNumericSuffix(start: number): void {
    this.#error(
      start,
      this.#offset,
      `invalid numeric literal suffix in \`${this.#source.text.slice(
        start,
        this.#offset,
      )}\``,
    );
  }

  #scanString(): Lexed.Token {
    const start = this.#offset;
    this.#offset += 1;
    let textStart = this.#offset;
    let decoded = "";
    const parts: Lexed.StringPart[] = [];

    const flushText = (): void => {
      if (textStart < this.#offset || decoded.length > 0) {
        parts.push({
          kind: "Text",
          value: decoded,
          span: this.#source.span(textStart, this.#offset),
        });
      }
      decoded = "";
      textStart = this.#offset;
    };

    while (this.#offset < this.#source.text.length) {
      const current = this.#source.text.charCodeAt(this.#offset);

      if (current === 0x22) {
        flushText();
        this.#offset += 1;
        this.#atLineStart = false;
        return {
          kind: "String",
          parts,
          span: this.#source.span(start, this.#offset),
        };
      }

      if (this.#startsWith("${")) {
        flushText();
        const interpolationStart = this.#offset;
        this.#offset += 2;
        this.#suppressNewlines += 1;
        const nested = this.scanSequence(true);
        this.#suppressNewlines -= 1;

        if (!nested.closedInterpolation) {
          this.#error(
            interpolationStart,
            Math.min(interpolationStart + 2, this.#source.text.length),
            "unterminated string interpolation",
          );
          parts.push({
            kind: "Interpolation",
            tokens: nested.tokens,
            span: this.#source.span(interpolationStart, this.#offset),
          });
          return {
            kind: "String",
            parts,
            span: this.#source.span(start, this.#offset),
          };
        }

        this.#offset += 1;
        this.#atLineStart = false;
        parts.push({
          kind: "Interpolation",
          tokens: nested.tokens,
          span: this.#source.span(interpolationStart, this.#offset),
        });
        textStart = this.#offset;
        continue;
      }

      if (this.#startsWith("#{")) {
        this.#error(
          this.#offset,
          this.#offset + 2,
          "`#{` is reserved for future use; write `\\#{` for a literal `#{`",
          { message: "escape the hash", replacement: "\\#{" },
        );
        decoded += "#{";
        this.#offset += 2;
        continue;
      }

      if (current === 0x5c) {
        decoded += this.#scanEscape();
        continue;
      }

      if (isNewlineStart(current)) {
        if (this.#startsWith("\r\n")) {
          this.#offset += 2;
        } else {
          this.#offset += 1;
        }
        decoded += "\n";
        continue;
      }

      const scalar = this.#scalarAt(this.#offset);
      if (scalar === undefined) {
        this.#offset += 1;
        decoded += "�";
      } else {
        decoded += scalar;
        this.#offset += scalar.length;
      }
    }

    flushText();
    this.#error(start, Math.min(start + 1, this.#source.text.length), "unterminated string literal");
    return {
      kind: "String",
      parts,
      span: this.#source.span(start, this.#offset),
    };
  }

  #scanEscape(): string {
    const start = this.#offset;
    this.#offset += 1;
    const escape = this.#source.text[this.#offset];

    const simple: Readonly<Record<string, string>> = {
      n: "\n",
      t: "\t",
      r: "\r",
      "\\": "\\",
      '"': '"',
      $: "$",
      "#": "#",
    };
    if (escape !== undefined && simple[escape] !== undefined) {
      this.#offset += 1;
      return simple[escape];
    }

    if (escape === "u" && this.#source.text[this.#offset + 1] === "{") {
      this.#offset += 2;
      const digitsStart = this.#offset;
      while (isAsciiHex(this.#source.text.charCodeAt(this.#offset))) {
        this.#offset += 1;
      }
      const digits = this.#source.text.slice(digitsStart, this.#offset);

      if (this.#source.text[this.#offset] === "}") {
        this.#offset += 1;
      }

      const value = digits.length > 0 ? Number.parseInt(digits, 16) : -1;
      if (
        digits.length >= 1 &&
        digits.length <= 6 &&
        this.#source.text[this.#offset - 1] === "}" &&
        value <= 0x10ffff &&
        !(value >= 0xd800 && value <= 0xdfff)
      ) {
        return String.fromCodePoint(value);
      }

      this.#error(
        start,
        this.#offset,
        "a Unicode escape needs 1–6 hex digits naming a Unicode scalar value",
      );
      return "�";
    }

    if (escape !== undefined && !isNewlineStart(escape.charCodeAt(0))) {
      this.#offset += scalarWidth(this.#source.text, this.#offset);
    }
    this.#error(start, this.#offset, "unknown string escape");
    return "�";
  }

  #consumeDigitsAndUnderscores(): string {
    const start = this.#offset;
    while (true) {
      const codeUnit = this.#source.text.charCodeAt(this.#offset);
      if (!isAsciiDigit(codeUnit) && codeUnit !== 0x5f) {
        break;
      }
      this.#offset += 1;
    }
    return this.#source.text.slice(start, this.#offset);
  }

  #consumeIdentifierRun(): void {
    while (this.#continuesIdentifierAt(this.#offset)) {
      this.#offset += scalarWidth(this.#source.text, this.#offset);
    }
  }

  #consumeNumericTail(): void {
    while (this.#offset < this.#source.text.length) {
      const codeUnit = this.#source.text.charCodeAt(this.#offset);
      if (
        isAsciiDigit(codeUnit) ||
        codeUnit === 0x5f ||
        this.#continuesIdentifierAt(this.#offset)
      ) {
        this.#offset += scalarWidth(this.#source.text, this.#offset);
      } else {
        break;
      }
    }
  }

  #continuesIdentifierAt(offset: number): boolean {
    const scalar = this.#scalarAt(offset);
    return scalar !== undefined && isIdentifierContinue(scalar);
  }

  #scalarAt(offset: number): string | undefined {
    if (offset < 0 || offset >= this.#source.text.length) {
      return undefined;
    }

    const first = this.#source.text.charCodeAt(offset);
    if (first >= 0xd800 && first <= 0xdbff) {
      const second = this.#source.text.charCodeAt(offset + 1);
      return second >= 0xdc00 && second <= 0xdfff
        ? this.#source.text.slice(offset, offset + 2)
        : undefined;
    }
    if (first >= 0xdc00 && first <= 0xdfff) {
      return undefined;
    }
    return this.#source.text[offset];
  }

  #peekCodeUnit(relativeOffset: number): number {
    return this.#source.text.charCodeAt(this.#offset + relativeOffset);
  }

  #startsWith(spelling: string): boolean {
    return this.#source.text.startsWith(spelling, this.#offset);
  }

  #eof(): Lexed.Token {
    return {
      kind: "Eof",
      span: this.#source.span(this.#offset, this.#offset),
    };
  }

  #error(
    start: number,
    end: number,
    message: string,
    fix?: { readonly message: string; readonly replacement: string },
  ): void {
    const primary = this.#source.span(start, end);
    const diagnostic: Diagnostics.Diagnostic =
      fix === undefined
        ? { severity: "error", message, primary }
        : {
            severity: "error",
            message,
            primary,
            fixes: [
              {
                message: fix.message,
                edits: [{ span: primary, replacement: fix.replacement }],
              },
            ],
          };
    this.#diagnostics.add(diagnostic);
  }
}

function matches(regex: RegExp, value: string): boolean {
  return regex.test(value);
}

function validateSourceCharacters(
  source: Source.File,
  diagnostics: Diagnostics.Bag,
): void {
  for (let offset = 0; offset < source.text.length; offset += 1) {
    const codeUnit = source.text.charCodeAt(offset);

    if (isBidiControl(codeUnit)) {
      diagnostics.add({
        severity: "error",
        message: "literal bidirectional controls are not allowed in Hexagon source; use a Unicode escape inside a string",
        primary: source.span(offset, offset + 1),
      });
      continue;
    }

    if (codeUnit === 0xfeff && offset !== 0) {
      diagnostics.add({
        severity: "error",
        message: "a byte-order mark is only allowed at the start of a file",
        primary: source.span(offset, offset + 1),
      });
      continue;
    }

    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = source.text.charCodeAt(offset + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        offset += 1;
        continue;
      }
      diagnostics.add({
        severity: "error",
        message: "Hexagon source must be valid Unicode",
        primary: source.span(offset, offset + 1),
      });
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      diagnostics.add({
        severity: "error",
        message: "Hexagon source must be valid Unicode",
        primary: source.span(offset, offset + 1),
      });
    }
  }
}

function validDigitSeparators(value: string): boolean {
  return !value.startsWith("_") && !value.endsWith("_") && !value.includes("__");
}

function isAsciiDigit(codeUnit: number): boolean {
  return codeUnit >= 0x30 && codeUnit <= 0x39;
}

function isAsciiHex(codeUnit: number): boolean {
  return (
    isAsciiDigit(codeUnit) ||
    (codeUnit >= 0x41 && codeUnit <= 0x46) ||
    (codeUnit >= 0x61 && codeUnit <= 0x66)
  );
}

function isIdentifierStart(scalar: string): boolean {
  return scalar === "$" || scalar === "_" || matches(idStart, scalar);
}

function isIdentifierContinue(scalar: string): boolean {
  return scalar === "$" || scalar === "_" || scalar === "\u200C" ||
    scalar === "\u200D" || matches(idContinue, scalar);
}

function isBidiControl(codeUnit: number): boolean {
  return codeUnit === 0x061c || codeUnit === 0x200e || codeUnit === 0x200f ||
    (codeUnit >= 0x202a && codeUnit <= 0x202e) ||
    (codeUnit >= 0x2066 && codeUnit <= 0x2069);
}

function isNewlineStart(codeUnit: number): boolean {
  return codeUnit === 0x0a || codeUnit === 0x0d;
}

function isUnsupportedWhitespace(codeUnit: number): boolean {
  return (
    codeUnit === 0x0b ||
    codeUnit === 0x0c ||
    codeUnit === 0x85 ||
    codeUnit === 0xa0 ||
    codeUnit === 0x1680 ||
    (codeUnit >= 0x2000 && codeUnit <= 0x200a) ||
    codeUnit === 0x2028 ||
    codeUnit === 0x2029 ||
    codeUnit === 0x202f ||
    codeUnit === 0x205f ||
    codeUnit === 0x3000
  );
}

function scalarWidth(text: string, offset: number): number {
  const codeUnit = text.charCodeAt(offset);
  if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
    const next = text.charCodeAt(offset + 1);
    if (next >= 0xdc00 && next <= 0xdfff) {
      return 2;
    }
  }
  return 1;
}

function codePointLabel(codePoint: number): string {
  return codePoint.toString(16).toUpperCase().padStart(4, "0");
}
