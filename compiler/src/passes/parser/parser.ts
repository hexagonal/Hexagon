/**
 * The parser turns LaidOut.File into Parsed.Module. It owns block items and the
 * core expression grammar, including precedence and recovery at layout
 * separators. Tuple patterns, nullary unions and matches, annotations, tuple
 * values, and directly recursive `fun` bindings are present; the remaining
 * declarations, patterns, and richer type syntax remain future work.
 */

import * as Diagnostics from "../../support/diagnostics.js";
import type * as Source from "../../support/source.js";
import type * as LaidOut from "../../syntax/laid-out/index.js";
import type * as Lexed from "../../syntax/lexed/index.js";
import type * as Parsed from "../../syntax/parsed/index.js";

type TokenKind = LaidOut.Token["kind"];

interface Infix {
  readonly operator?: Parsed.BinaryOperator;
  readonly comparison?: Parsed.ComparisonOperator;
  readonly leftBindingPower: number;
  readonly rightBindingPower: number;
  readonly assignment?: true;
}

const infix = new Map<TokenKind, Infix>([
  ["Assign", { leftBindingPower: 0, rightBindingPower: 1, assignment: true }],
  ["Pipe", { operator: "Pipe", leftBindingPower: 1, rightBindingPower: 2 }],
  ["Iff", { operator: "Iff", leftBindingPower: 2, rightBindingPower: 3 }],
  ["Implies", { operator: "Implies", leftBindingPower: 3, rightBindingPower: 3 }],
  ["Or", { operator: "Or", leftBindingPower: 4, rightBindingPower: 5 }],
  ["And", { operator: "And", leftBindingPower: 5, rightBindingPower: 6 }],
  ["EqualEqual", { comparison: "Equal", leftBindingPower: 6, rightBindingPower: 7 }],
  ["NotEqual", { comparison: "NotEqual", leftBindingPower: 6, rightBindingPower: 7 }],
  ["Less", { comparison: "Less", leftBindingPower: 6, rightBindingPower: 7 }],
  ["Greater", { comparison: "Greater", leftBindingPower: 6, rightBindingPower: 7 }],
  ["LessEqual", { comparison: "LessEqual", leftBindingPower: 6, rightBindingPower: 7 }],
  ["GreaterEqual", { comparison: "GreaterEqual", leftBindingPower: 6, rightBindingPower: 7 }],
  ["Range", { operator: "Range", leftBindingPower: 7, rightBindingPower: 8 }],
  ["Plus", { operator: "Add", leftBindingPower: 8, rightBindingPower: 9 }],
  ["Minus", { operator: "Subtract", leftBindingPower: 8, rightBindingPower: 9 }],
  ["Concat", { operator: "Concat", leftBindingPower: 8, rightBindingPower: 9 }],
  ["Star", { operator: "Multiply", leftBindingPower: 9, rightBindingPower: 10 }],
  ["Slash", { operator: "Divide", leftBindingPower: 9, rightBindingPower: 10 }],
  ["Power", { operator: "Power", leftBindingPower: 11, rightBindingPower: 11 }],
]);

const itemEnds = new Set<TokenKind>(["VSep", "Semicolon", "VClose", "Eof"]);
const structuralEnds: readonly TokenKind[] = ["VSep", "Semicolon", "VClose", "Eof"];
const unsupportedItemStarts = new Set<TokenKind>([
  "Constraint",
  "Exception",
  "Extern",
  "Honor",
  "Import",
  "Record",
  "Type",
  "Var",
]);

/** Parses one layout-aware file and retains diagnostics from earlier passes. */
export function parse(file: LaidOut.File): Parsed.Module {
  const diagnostics = new Diagnostics.Bag();
  for (const diagnostic of file.diagnostics) {
    diagnostics.add(diagnostic);
  }

  return new Parser(file.tokens, diagnostics).parseModule(
    file.fileId,
    file.comments,
  );
}

class Parser {
  readonly #tokens: readonly LaidOut.Token[];
  readonly #diagnostics: Diagnostics.Bag;
  #index = 0;

  constructor(tokens: readonly LaidOut.Token[], diagnostics: Diagnostics.Bag) {
    this.#tokens = tokens;
    this.#diagnostics = diagnostics;
  }

  /** Consumes the module's implicit layout block and requires a final Eof. */
  parseModule(
    fileId: Source.FileId,
    comments: readonly Source.Comment[],
  ): Parsed.Module {
    const opening = this.#expect("VOpen", "expected the module layout block");
    const items = this.#parseItems(true);
    const closing = this.#expect("VClose", "expected the module layout block to close");
    const eof = this.#expect("Eof", "expected end of file");
    const first = opening ?? items[0] ?? closing ?? eof ?? this.#current();
    const last = eof ?? closing ?? items.at(-1) ?? first;

    return {
      kind: "Module",
      fileId,
      items,
      comments,
      span: spanFrom(first.span, last.span),
      diagnostics: this.#diagnostics.toArray(),
    };
  }

  /** Parses one interpolation's expression-only token stream. */
  parseStandaloneExpression(): Parsed.Expr {
    const expression = this.#parseExpression();
    if (!this.#at("Eof")) {
      this.#error("expected one expression inside string interpolation");
      this.#synchronize(new Set(["Eof"]));
    }
    this.#expect("Eof", "expected the end of string interpolation");
    return expression;
  }

  #parseItems(moduleItems = false): readonly Parsed.Item[] {
    const items: Parsed.Item[] = [];
    this.#skipSeparators();

    while (!this.#at("VClose") && !this.#at("Eof")) {
      items.push(this.#parseItem(moduleItems));

      if (this.#at("VSep") || this.#at("Semicolon")) {
        this.#skipSeparators();
      } else if (!this.#at("VClose") && !this.#at("Eof")) {
        this.#error("expected a newline or `;` between block items");
        this.#synchronize(itemEnds);
        this.#skipSeparators();
      }
    }

    return items;
  }

  #parseItem(moduleItems: boolean): Parsed.Item {
    if (this.#at("Export")) {
      const exportToken = this.#advance();
      if (!moduleItems) {
        this.#errorAt(exportToken.span, "`export` is only allowed at module top level");
        this.#synchronize(itemEnds);
        return {
          kind: "ErrorItem",
          span: spanFrom(exportToken.span, this.#previous().span),
        };
      }
      if (!this.#at("Let") && !this.#at("Fun") && !this.#at("Union")) {
        this.#errorAt(
          exportToken.span,
          "the current parser supports `export` only on `let`, `fun`, and `union` bindings",
        );
        this.#synchronize(itemEnds);
        return {
          kind: "ErrorItem",
          span: spanFrom(exportToken.span, this.#previous().span),
        };
      }
      if (this.#at("Union")) return this.#parseUnion(true, exportToken.span);
      return this.#at("Let")
        ? this.#parseBinding("Let", true, exportToken.span)
        : this.#parseBinding("Fun", true, exportToken.span);
    }
    if (this.#at("Let")) {
      if (
        ["LeftParen", "LeftBrace", "UpperName", "True", "False", "Wildcard"]
          .includes(this.#peek(1).kind)
      ) {
        return this.#parsePatternBinding();
      }
      return this.#parseBinding("Let", false);
    }
    if (this.#at("Fun")) {
      return this.#parseBinding("Fun", false);
    }
    if (this.#at("Union")) {
      if (!moduleItems) {
        const start = this.#advance();
        this.#errorAt(start.span, "`union` is only allowed at module top level");
        this.#synchronize(itemEnds);
        return { kind: "ErrorItem", span: spanFrom(start.span, this.#previous().span) };
      }
      return this.#parseUnion(false);
    }
    if (unsupportedItemStarts.has(this.#current().kind)) {
      const start = this.#advance();
      this.#errorAt(
        start.span,
        `the first-round parser does not support ${describe(start.kind)} items yet`,
      );
      this.#synchronize(itemEnds);
      const end = this.#previous();
      return { kind: "ErrorItem", span: spanFrom(start.span, end.span) };
    }

    const expression = this.#parseExpression();
    return { kind: "ExprItem", expression, span: expression.span };
  }

  #parseBinding(
    bindingKind: "Let" | "Fun",
    exported: boolean,
    itemStart?: Source.Span,
  ): Parsed.Item {
    const start = this.#advance();
    const keyword = bindingKind === "Let" ? "let" : "fun";
    const nameToken = this.#takeName(
      "LowerName",
      `\`${keyword}\` requires a lowercase name`,
    );
    if (nameToken === undefined) {
      this.#synchronize(itemEnds);
      return { kind: "ErrorItem", span: spanFrom(start.span, this.#previous().span) };
    }

    let parameters: readonly Parsed.Parameter[] | undefined;
    let returnAnnotation: Parsed.TypeAnnotation | undefined;
    let bindingAnnotation: Parsed.TypeAnnotation | undefined;
    let parameterStartSpan: Source.Span | undefined;
    if (this.#at("LeftParen")) {
      parameterStartSpan = this.#current().span;
      parameters = this.#parseParameters();
      if (this.#at("Colon")) {
        this.#advance();
        returnAnnotation = this.#parseTypeAnnotation();
      }
    } else if (bindingKind === "Let" && this.#at("Colon")) {
      this.#advance();
      bindingAnnotation = this.#parseTypeAnnotation();
    }

    if (
      this.#expect("Equal", `expected \`=\` in \`${keyword}\` binding`) ===
      undefined
    ) {
      this.#synchronize(itemEnds);
      return { kind: "ErrorItem", span: spanFrom(start.span, this.#previous().span) };
    }

    const body: Parsed.Expr = this.#parseBodyExpression();
    const value: Parsed.Expr = parameters === undefined
      ? body
      : {
          kind: "Lambda",
          parameters,
          ...(returnAnnotation === undefined ? {} : { returnAnnotation }),
          body,
          span: spanFrom(parameterStartSpan ?? nameToken.span, body.span),
        };

    const common = {
      exported,
      name: parsedName(nameToken),
      span: spanFrom(itemStart ?? start.span, value.span),
    };
    if (bindingKind === "Let") {
      return {
        kind: "Let",
        ...common,
        ...(bindingAnnotation === undefined
          ? {}
          : { annotation: bindingAnnotation }),
        value,
      };
    }
    if (value.kind === "Lambda") return { kind: "Fun", ...common, value };

    this.#errorAt(
      value.span,
      "`fun` requires a function header or lambda literal on its right-hand side",
    );
    return {
      kind: "ErrorItem",
      span: spanFrom(itemStart ?? start.span, value.span),
    };
  }

  #parseUnion(exported: boolean, itemStart?: Source.Span): Parsed.Item {
    const start = this.#advance();
    const nameToken = this.#takeName(
      "UpperName",
      "`union` requires an uppercase type name",
    );
    if (nameToken === undefined) {
      this.#synchronize(itemEnds);
      return { kind: "ErrorItem", span: spanFrom(start.span, this.#previous().span) };
    }
    if (this.#at("LeftParen")) {
      this.#error("generic unions arrive in a later union slice");
      this.#synchronize(itemEnds);
      return { kind: "ErrorItem", span: spanFrom(start.span, this.#previous().span) };
    }
    if (this.#expect("Equal", "expected `=` after union name") === undefined) {
      this.#synchronize(itemEnds);
      return { kind: "ErrorItem", span: spanFrom(start.span, this.#previous().span) };
    }
    if (this.#at("Bar")) this.#advance();

    const constructors: Parsed.Constructor[] = [];
    while (!itemEnds.has(this.#current().kind)) {
      const constructor = this.#takeName(
        "UpperName",
        "union constructors must be uppercase names",
      );
      if (constructor === undefined) {
        this.#synchronize(itemEnds);
        return { kind: "ErrorItem", span: spanFrom(start.span, this.#previous().span) };
      }
      const name = parsedName(constructor);
      const slots: Parsed.ConstructorSlot[] = [];
      let end = name.span;
      if (this.#at("LeftParen")) {
        const opening = this.#advance();
        while (!this.#at("RightParen") && !this.#at("Eof")) {
          const slotStart = this.#current();
          let slotName: Parsed.Name | undefined;
          if (slotStart.kind === "LowerName" && this.#peek(1).kind === "Colon") {
            this.#advance();
            this.#advance();
            slotName = parsedName(slotStart);
          }
          const annotation = this.#parseTypeAnnotation();
          if (annotation === undefined) {
            this.#synchronize(new Set(["Comma", "RightParen", ...structuralEnds]));
            break;
          }
          slots.push({
            ...(slotName === undefined ? {} : { name: slotName }),
            annotation,
            span: spanFrom(slotStart.span, annotation.span),
          });
          if (!this.#at("Comma")) break;
          this.#advance();
        }
        const closing = this.#expect("RightParen", "expected `)` after constructor payload");
        end = closing?.span ?? slots.at(-1)?.span ?? opening.span;
        if (slots.length === 0) this.#errorAt(opening.span, "constructor payload cannot be empty");
        const named = slots.filter((slot) => slot.name !== undefined);
        if (named.length !== 0 && named.length !== slots.length) {
          this.#errorAt(opening.span, "constructor payload slots must be all named or all unnamed");
        }
        const names = new Set<string>();
        for (const slot of named) {
          const text = slot.name!.text;
          if (text === "tag") this.#errorAt(slot.name!.span, "`tag` is reserved for union discrimination");
          if (names.has(text)) this.#errorAt(slot.name!.span, `duplicate payload slot \`${text}\``);
          names.add(text);
        }
      }
      constructors.push({ name, slots, span: spanFrom(name.span, end) });
      if (!this.#at("Bar")) break;
      this.#advance();
    }
    if (constructors.length === 0) {
      this.#errorAt(nameToken.span, "a union needs at least one constructor");
    }
    return {
      kind: "Union",
      exported,
      name: parsedName(nameToken),
      constructors,
      span: spanFrom(
        itemStart ?? start.span,
        constructors.at(-1)?.span ?? nameToken.span,
      ),
    };
  }

  #parsePatternBinding(): Parsed.Item {
    const start = this.#advance();
    const pattern = this.#parsePattern();
    if (pattern === undefined) {
      this.#synchronize(itemEnds);
      return { kind: "ErrorItem", span: spanFrom(start.span, this.#previous().span) };
    }
    if (this.#expect("Equal", "expected `=` after `let` pattern") === undefined) {
      this.#synchronize(itemEnds);
      return { kind: "ErrorItem", span: spanFrom(start.span, this.#previous().span) };
    }
    const value = this.#parseBodyExpression();
    return {
      kind: "LetPattern",
      exported: false,
      pattern,
      value,
      span: spanFrom(start.span, value.span),
    };
  }

  #parsePattern(): Parsed.Pattern | undefined {
    const first = this.#parseAtomicPattern();
    if (first === undefined) return undefined;
    const alternatives: Parsed.Pattern[] = [first];
    while (this.#at("Bar")) {
      this.#advance();
      const alternative = this.#parseAtomicPattern();
      if (alternative === undefined) return undefined;
      alternatives.push(alternative);
    }
    const pattern: Parsed.Pattern = alternatives.length === 1
      ? first
      : {
          kind: "Or",
          alternatives,
          span: spanFrom(first.span, alternatives.at(-1)!.span),
        };
    const operator = this.#current();
    if (operator.kind !== "LowerName" || operator.text !== "as") return pattern;
    this.#advance();
    const binder = this.#takeName(
      "LowerName",
      "`as` in a pattern requires a lowercase binding name",
    );
    if (binder === undefined) return undefined;
    const name = parsedName(binder);
    return {
      kind: "As",
      pattern,
      name,
      span: spanFrom(pattern.span, name.span),
    };
  }

  #parseAtomicPattern(): Parsed.Pattern | undefined {
    const token = this.#current();
    if (token.kind === "LowerName") {
      this.#advance();
      const name = parsedName(token);
      return { kind: "Binding", name, span: name.span };
    }
    if (token.kind === "Wildcard") {
      this.#advance();
      return { kind: "Wildcard", span: token.span };
    }
    if (token.kind === "True" || token.kind === "False") {
      this.#advance();
      return { kind: "Boolean", value: token.kind === "True", span: token.span };
    }
    if (token.kind === "Integer") {
      this.#advance();
      return { kind: "Integer", decimal: token.decimal, span: token.span };
    }
    if (token.kind === "Minus" && this.#peek(1).kind === "Integer") {
      const minus = this.#advance();
      const integer = this.#advance() as Lexed.IntegerToken;
      return {
        kind: "Integer",
        decimal: `-${integer.decimal}`,
        span: spanFrom(minus.span, integer.span),
      };
    }
    if (token.kind === "Float") {
      this.#advance();
      this.#errorAt(
        token.span,
        "Float literals cannot appear in patterns; bind a name and compare it in a guard",
      );
      return undefined;
    }
    if (token.kind === "String") {
      this.#advance();
      if (token.parts.some(({ kind }) => kind === "Interpolation")) {
        this.#errorAt(token.span, "string interpolation cannot appear in a pattern");
      }
      return {
        kind: "String",
        value: token.parts.map((part) => part.kind === "Text" ? part.value : "").join(""),
        span: token.span,
      };
    }
    if (token.kind === "UpperName") {
      this.#advance();
      const name = parsedName(token);
      const args: Parsed.Pattern[] = [];
      let end = token.span;
      if (this.#at("LeftParen")) {
        this.#advance();
        while (!this.#at("RightParen") && !this.#at("Eof")) {
          const argument = this.#parsePattern();
          if (argument === undefined) return undefined;
          args.push(argument);
          if (!this.#at("Comma")) break;
          this.#advance();
        }
        end = this.#expect(
          "RightParen",
          "expected `)` after constructor pattern",
        )?.span ?? end;
      }
      return {
        kind: "Constructor",
        name,
        arguments: args,
        span: spanFrom(token.span, end),
      };
    }
    if (token.kind === "LeftBrace") {
      const opening = this.#advance();
      const fields: Parsed.RecordPatternField[] = [];
      const seen = new Set<string>();
      while (!this.#at("RightBrace") && !this.#at("Eof")) {
        const field = this.#takeName("LowerName", "record patterns contain lowercase field names");
        if (field === undefined) return undefined;
        const name = parsedName(field);
        if (seen.has(name.text)) this.#errorAt(name.span, `duplicate record pattern field \`${name.text}\``);
        seen.add(name.text);
        let pattern: Parsed.Pattern = {
          kind: "Binding",
          name,
          span: name.span,
        };
        if (this.#at("Colon")) {
          this.#advance();
          const nested = this.#parsePattern();
          if (nested === undefined) return undefined;
          pattern = nested;
        }
        fields.push({
          name,
          pattern,
          span: spanFrom(name.span, pattern.span),
        });
        if (!this.#at("Comma")) break;
        this.#advance();
      }
      const closing = this.#expect("RightBrace", "expected `}` after record pattern");
      return {
        kind: "Record",
        fields,
        span: spanFrom(opening.span, closing?.span ?? fields.at(-1)?.span ?? opening.span),
      };
    }
    if (token.kind !== "LeftParen") {
      this.#error("expected a binding, `_`, constructor, tuple, or record pattern");
      return undefined;
    }

    const opening = this.#advance();
    if (this.#at("RightParen")) {
      const closing = this.#advance();
      return { kind: "Unit", span: spanFrom(opening.span, closing.span) };
    }
    const first = this.#parsePattern();
    if (first === undefined) return undefined;
    if (!this.#at("Comma")) {
      const closing = this.#expect("RightParen", "expected `)` after pattern");
      return { ...first, span: spanFrom(opening.span, closing?.span ?? first.span) };
    }
    const elements: Parsed.Pattern[] = [first];
    while (this.#at("Comma")) {
      const comma = this.#advance();
      if (this.#at("RightParen")) {
        this.#errorAt(comma.span, "a tuple pattern needs a pattern after `,`");
        this.#advance();
        return undefined;
      }
      const element = this.#parsePattern();
      if (element === undefined) return undefined;
      elements.push(element);
    }
    const closing = this.#expect("RightParen", "expected `)` after tuple pattern");
    return {
      kind: "Tuple",
      elements,
      span: spanFrom(opening.span, closing?.span ?? elements.at(-1)!.span),
    };
  }

  #parseExpression(
    minimumBindingPower = 0,
    stops: ReadonlySet<TokenKind> = itemEnds,
  ): Parsed.Expr {
    const effectiveStops = withStops(stops, ...structuralEnds);
    let left = this.#parsePrefix(effectiveStops);

    while (!effectiveStops.has(this.#current().kind)) {
      if (minimumBindingPower <= 12) {
        if (this.#at("LeftParen")) {
          left = this.#parseCall(left);
          continue;
        }
        if (this.#at("Dot")) {
          left = this.#parseAccess(left);
          continue;
        }
        if (this.#at("LeftBracket")) {
          left = this.#parseIndex(left);
          continue;
        }
      }

      const operation = infix.get(this.#current().kind);
      if (operation === undefined || operation.leftBindingPower < minimumBindingPower) {
        break;
      }

      const token = this.#advance();
      const right = this.#parseExpression(operation.rightBindingPower, effectiveStops);
      if (operation.assignment === true) {
        if (left.kind === "Assignment") {
          this.#errorAt(token.span, "`:=` does not chain; assignment produces `Unit`");
        }
        left = {
          kind: "Assignment",
          target: left,
          value: right,
          span: spanFrom(left.span, right.span),
        };
      } else if (operation.comparison !== undefined) {
        left = left.kind === "Comparison"
          ? {
              kind: "Comparison",
              operands: [...left.operands, right],
              operators: [...left.operators, operation.comparison],
              span: spanFrom(left.span, right.span),
            }
          : {
              kind: "Comparison",
              operands: [left, right],
              operators: [operation.comparison],
              span: spanFrom(left.span, right.span),
            };
      } else {
        const operator = requiredOperator(operation, token);
        if (
          operator === "Range" &&
          left.kind === "Binary" &&
          left.operator === "Range"
        ) {
          this.#errorAt(token.span, "`..` does not chain; write separate ranges");
        }
        left = {
          kind: "Binary",
          operator,
          left,
          right,
          span: spanFrom(left.span, right.span),
        };
      }
    }

    return left;
  }

  #parsePrefix(stops: ReadonlySet<TokenKind>): Parsed.Expr {
    if (this.#at("LowerName") && this.#peek(1).kind === "FatArrow") {
      const parameter = this.#current() as Lexed.NameToken;
      this.#advance();
      this.#advance();
      const body = this.#parseBodyExpression(stops);
      return {
        kind: "Lambda",
        parameters: [
          { name: parsedName(parameter), span: parameter.span },
        ],
        body,
        span: spanFrom(parameter.span, body.span),
      };
    }
    if (this.#isParenthesizedLambda()) {
      const start = this.#current();
      const parameters = this.#parseParameters();
      let returnAnnotation: Parsed.TypeAnnotation | undefined;
      if (this.#at("Colon")) {
        this.#advance();
        returnAnnotation = this.#parseTypeAnnotation();
      }
      this.#expect("FatArrow", "expected `=>` after lambda parameters");
      const body = this.#parseBodyExpression(stops);
      return {
        kind: "Lambda",
        parameters,
        ...(returnAnnotation === undefined ? {} : { returnAnnotation }),
        body,
        span: spanFrom(start.span, body.span),
      };
    }
    if (this.#at("Minus")) {
      const start = this.#advance();
      const operand = this.#parseExpression(10, stops);
      return {
        kind: "Unary",
        operator: "Negate",
        operand,
        span: spanFrom(start.span, operand.span),
      };
    }
    if (this.#at("Not")) {
      const start = this.#advance();
      const operand = this.#parseExpression(6, stops);
      return {
        kind: "Unary",
        operator: "Not",
        operand,
        span: spanFrom(start.span, operand.span),
      };
    }
    if (this.#at("If")) {
      return this.#parseIf(stops);
    }
    if (this.#at("Match")) {
      return this.#parseMatch(stops);
    }

    return this.#parsePrimary(stops);
  }

  #parsePrimary(stops: ReadonlySet<TokenKind>): Parsed.Expr {
    const token = this.#current();
    switch (token.kind) {
      case "LowerName":
      case "UpperName":
        this.#advance();
        return { kind: "Name", name: parsedName(token), span: token.span };
      case "True":
      case "False":
        this.#advance();
        return { kind: "Boolean", value: token.kind === "True", span: token.span };
      case "Integer":
        this.#advance();
        return { kind: "Integer", decimal: token.decimal, span: token.span };
      case "BigInt":
        this.#advance();
        return { kind: "BigInt", decimal: token.decimal, span: token.span };
      case "Float":
        this.#advance();
        return {
          kind: "Float",
          spelling: token.spelling,
          value: token.value,
          span: token.span,
        };
      case "String":
        this.#advance();
        return this.#parseString(token);
      case "LeftParen":
        return this.#parseParenthesized(stops);
      case "LeftBrace":
        return this.#parseRecord(stops);
      default:
        this.#error(`expected an expression, found ${describe(token.kind)}`);
        if (!stops.has(token.kind)) {
          this.#advance();
        }
        return { kind: "ErrorExpr", span: token.span };
    }
  }

  #parseRecord(stops: ReadonlySet<TokenKind>): Parsed.Expr {
    const opening = this.#advance();
    let spread: Parsed.Expr | undefined;
    const fields: Parsed.RecordField[] = [];
    const names = new Set<string>();
    if (this.#at("Spread")) {
      this.#advance();
      spread = this.#parseExpression(0, withStops(stops, "Comma", "RightBrace"));
      if (this.#at("Comma")) this.#advance();
    }
    while (!this.#at("RightBrace") && !this.#at("Eof")) {
      if (this.#at("Spread")) {
        this.#error("a record update permits exactly one spread, and it must come first");
        this.#advance();
        this.#parseExpression(0, withStops(stops, "Comma", "RightBrace"));
        if (this.#at("Comma")) this.#advance();
        continue;
      }
      const token = this.#takeName("LowerName", "record fields must be lowercase names");
      if (token === undefined) break;
      const name = parsedName(token);
      const punned = !this.#at("Colon");
      let value: Parsed.Expr;
      if (punned) {
        value = { kind: "Name", name, span: name.span };
      } else {
        this.#advance();
        value = this.#parseExpression(0, withStops(stops, "Comma", "RightBrace"));
      }
      if (names.has(name.text)) this.#errorAt(name.span, `duplicate record field \`${name.text}\``);
      names.add(name.text);
      fields.push({ name, punned, value, span: spanFrom(name.span, value.span) });
      if (!this.#at("Comma")) break;
      this.#advance();
    }
    const closing = this.#expect("RightBrace", "expected `}` after record fields");
    return {
      kind: "Record",
      ...(spread === undefined ? {} : { spread }),
      fields,
      span: spanFrom(opening.span, closing?.span ?? fields.at(-1)?.span ?? opening.span),
    };
  }

  #parseString(token: Lexed.StringToken): Parsed.StringExpr {
    const parts: Parsed.StringPart[] = token.parts.map((part) => {
      if (part.kind === "Text") {
        return { kind: "Text", value: part.value, span: part.span };
      }
      const expression = new Parser(part.tokens, this.#diagnostics)
        .parseStandaloneExpression();
      return { kind: "Interpolation", expression, span: part.span };
    });
    return { kind: "String", parts, span: token.span };
  }

  #parseParenthesized(stops: ReadonlySet<TokenKind>): Parsed.Expr {
    const opening = this.#advance();
    if (this.#at("RightParen")) {
      const closing = this.#advance();
      return { kind: "Unit", span: spanFrom(opening.span, closing.span) };
    }

    const expression = this.#parseExpression(
      0,
      withStops(stops, "Comma", "RightParen"),
    );
    if (this.#at("Comma")) {
      const elements: Parsed.Expr[] = [expression];
      while (this.#at("Comma")) {
        const comma = this.#advance();
        if (this.#at("RightParen")) {
          this.#errorAt(comma.span, "a tuple needs an expression after `,`");
          const closing = this.#advance();
          return { kind: "ErrorExpr", span: spanFrom(opening.span, closing.span) };
        }
        elements.push(
          this.#parseExpression(
            0,
            withStops(stops, "Comma", "RightParen"),
          ),
        );
      }
      const closing = this.#expect("RightParen", "expected `)` after tuple elements");
      return {
        kind: "Tuple",
        elements,
        span: spanFrom(opening.span, closing?.span ?? elements.at(-1)!.span),
      };
    }
    const closing = this.#expect("RightParen", "expected `)` after expression");
    return {
      kind: "Group",
      expression,
      span: spanFrom(opening.span, closing?.span ?? expression.span),
    };
  }

  #parseCall(callee: Parsed.Expr): Parsed.Expr {
    this.#advance();
    const args: Parsed.Expr[] = [];
    const stops = new Set<TokenKind>(["Comma", "RightParen", "Eof"]);

    while (!this.#at("RightParen") && !this.#at("Eof")) {
      args.push(this.#parseExpression(0, stops));
      if (!this.#at("Comma")) {
        break;
      }
      this.#advance();
    }

    const closing = this.#expect("RightParen", "expected `)` after arguments");
    return {
      kind: "Call",
      callee,
      arguments: args,
      span: spanFrom(callee.span, closing?.span ?? args.at(-1)?.span ?? callee.span),
    };
  }

  #parseAccess(receiver: Parsed.Expr): Parsed.Expr {
    this.#advance();
    const field = this.#takeAnyName("expected a field name after `.`");
    if (field === undefined) {
      return { kind: "ErrorExpr", span: receiver.span };
    }
    return {
      kind: "Access",
      receiver,
      field: parsedName(field),
      span: spanFrom(receiver.span, field.span),
    };
  }

  #parseIndex(receiver: Parsed.Expr): Parsed.Expr {
    this.#advance();
    const index = this.#parseExpression(0, new Set(["RightBracket", "Eof"]));
    const closing = this.#expect("RightBracket", "expected `]` after index");
    return {
      kind: "Index",
      receiver,
      index,
      span: spanFrom(receiver.span, closing?.span ?? index.span),
    };
  }

  #parseIf(outerStops: ReadonlySet<TokenKind>): Parsed.Expr {
    const start = this.#advance();
    const condition = this.#parseExpression(
      0,
      withStops(outerStops, "Then", "VOpen"),
    );

    let consequence: Parsed.Expr;
    let alternative: Parsed.Expr | undefined;
    if (this.#at("Then")) {
      this.#advance();
      consequence = this.#parseExpression(0, withStops(outerStops, "Else"));
      if (
        this.#expect("Else", "`then`-form `if` requires an `else`") !== undefined
      ) {
        alternative = this.#parseExpression(0, outerStops);
      }
    } else if (this.#at("VOpen")) {
      consequence = this.#parseBlock();
      if (this.#at("Else")) {
        this.#advance();
        alternative = this.#at("If")
          ? this.#parseIf(outerStops)
          : this.#parseBodyExpression(outerStops);
      }
    } else {
      this.#error("expected `then` or an indented block after `if` condition");
      consequence = { kind: "ErrorExpr", span: this.#current().span };
    }

    const end = alternative ?? consequence;
    return {
      kind: "If",
      condition,
      consequence,
      ...(alternative === undefined ? {} : { alternative }),
      span: spanFrom(start.span, end.span),
    };
  }

  #parseMatch(outerStops: ReadonlySet<TokenKind>): Parsed.MatchExpr {
    const start = this.#advance();
    const scrutinee = this.#parseExpression(
      0,
      withStops(outerStops, "VOpen"),
    );
    this.#expect("VOpen", "expected an indented block of match arms");
    const arms: Parsed.MatchArm[] = [];
    this.#skipSeparators();
    while (!this.#at("VClose") && !this.#at("Eof")) {
      const pattern = this.#parsePattern();
      if (pattern === undefined) {
        this.#synchronize(new Set(["VSep", "VClose", "Eof"]));
        this.#skipSeparators();
        continue;
      }
      let guard: Parsed.Expr | undefined;
      const guardStart = this.#current();
      if (
        guardStart.kind === "LowerName" &&
        guardStart.text === "when"
      ) {
        this.#advance();
        guard = this.#parseExpression(0, new Set(["FatArrow", "Eof"]));
      }
      this.#expect("FatArrow", "expected `=>` after match pattern or guard");
      const body = this.#parseBodyExpression(
        new Set(["VSep", "VClose", "Eof"]),
      );
      arms.push({
        pattern,
        ...(guard === undefined ? {} : { guard }),
        body,
        span: spanFrom(pattern.span, body.span),
      });
      this.#skipSeparators();
    }
    const closing = this.#expect("VClose", "expected the match arms to close");
    return {
      kind: "Match",
      scrutinee,
      arms,
      span: spanFrom(
        start.span,
        closing?.span ?? arms.at(-1)?.span ?? scrutinee.span,
      ),
    };
  }

  #parseBodyExpression(stops: ReadonlySet<TokenKind> = itemEnds): Parsed.Expr {
    return this.#at("VOpen") ? this.#parseBlock() : this.#parseExpression(0, stops);
  }

  #parseBlock(): Parsed.BlockExpr {
    const opening = this.#advance();
    const items = this.#parseItems();
    const closing = this.#expect("VClose", "expected the indented block to close");
    // Virtual delimiters are anchored to nearby physical tokens. A closing
    // delimiter may therefore sit on the following item; the block's source
    // extent ends at its own final item instead.
    const last = items.at(-1) ?? closing ?? opening;
    return { kind: "Block", items, span: spanFrom(opening.span, last.span) };
  }

  #parseParameters(): readonly Parsed.Parameter[] {
    this.#expect("LeftParen", "expected `(` before parameters");
    const parameters: Parsed.Parameter[] = [];

    while (!this.#at("RightParen") && !this.#at("Eof")) {
      const name = this.#takeName(
        "LowerName",
        "function parameters must be lowercase names",
      );
      if (name !== undefined) {
        let annotation: Parsed.TypeAnnotation | undefined;
        if (this.#at("Colon")) {
          this.#advance();
          annotation = this.#parseTypeAnnotation();
        }
        parameters.push({
          name: parsedName(name),
          ...(annotation === undefined ? {} : { annotation }),
          span: spanFrom(name.span, annotation?.span ?? name.span),
        });
      }
      if (!this.#at("Comma")) {
        break;
      }
      this.#advance();
    }

    this.#expect("RightParen", "expected `)` after parameters");
    return parameters;
  }

  #isParenthesizedLambda(): boolean {
    if (!this.#at("LeftParen")) {
      return false;
    }

    let index = this.#index;
    let depth = 0;
    do {
      const kind = this.#tokens[index]?.kind;
      if (kind === "LeftParen") depth += 1;
      if (kind === "RightParen") depth -= 1;
      if (kind === "Eof" || kind === "VSep" || kind === undefined) return false;
      index += 1;
    } while (depth > 0);
    // `index` points one token beyond the matching parameter `)`.
    if (this.#tokens[index]?.kind === "Colon") {
      index += 1;
      if (this.#tokens[index]?.kind === "LeftParen") {
        let typeDepth = 0;
        do {
          const kind = this.#tokens[index]?.kind;
          if (kind === "LeftParen") typeDepth += 1;
          if (kind === "RightParen") typeDepth -= 1;
          if (kind === "Eof" || kind === undefined) return false;
          index += 1;
        } while (typeDepth > 0);
      } else if (this.#tokens[index]?.kind === "UpperName") {
        index += 1;
      } else {
        return false;
      }
    }
    return this.#tokens[index]?.kind === "FatArrow";
  }

  #parseTypeAnnotation(): Parsed.TypeAnnotation | undefined {
    const token = this.#current();
    if (token.kind === "LeftBrace") {
      const opening = this.#advance();
      const fields: Parsed.RecordTypeField[] = [];
      const names = new Set<string>();
      let open = false;
      let tail: Parsed.Name | undefined;
      while (!this.#at("RightBrace") && !this.#at("Eof")) {
        if (this.#at("Spread")) {
          this.#advance();
          open = true;
          if (this.#at("LowerName")) {
            tail = parsedName(this.#advance() as Lexed.NameToken);
          }
          if (this.#at("Comma")) this.#error("`...` must be the final entry in a record type");
          break;
        }
        const fieldToken = this.#takeName("LowerName", "record type fields must be lowercase names");
        if (fieldToken === undefined) return undefined;
        this.#expect("Colon", "expected `:` after record type field name");
        const annotation = this.#parseTypeAnnotation();
        if (annotation === undefined) return undefined;
        const name = parsedName(fieldToken);
        if (names.has(name.text)) this.#errorAt(name.span, `duplicate record type field \`${name.text}\``);
        names.add(name.text);
        fields.push({ name, annotation, span: spanFrom(name.span, annotation.span) });
        if (!this.#at("Comma")) break;
        this.#advance();
      }
      const closing = this.#expect("RightBrace", "expected `}` after record type");
      return {
        kind: "Record",
        fields,
        open,
        ...(tail === undefined ? {} : { tail }),
        span: spanFrom(opening.span, closing?.span ?? fields.at(-1)?.span ?? opening.span),
      };
    }
    if (token.kind === "LeftParen") {
      const opening = this.#advance();
      const first = this.#parseTypeAnnotation();
      if (first === undefined) return undefined;
      if (!this.#at("Comma")) {
        const closing = this.#expect("RightParen", "expected `)` after type");
        return { ...first, span: spanFrom(opening.span, closing?.span ?? first.span) };
      }
      const elements: Parsed.TypeAnnotation[] = [first];
      while (this.#at("Comma")) {
        const comma = this.#advance();
        if (this.#at("RightParen")) {
          this.#errorAt(comma.span, "a tuple type needs a type after `,`");
          this.#advance();
          return undefined;
        }
        const element = this.#parseTypeAnnotation();
        if (element === undefined) return undefined;
        elements.push(element);
      }
      const closing = this.#expect("RightParen", "expected `)` after tuple type");
      return {
        kind: "Tuple",
        elements,
        span: spanFrom(opening.span, closing?.span ?? elements.at(-1)!.span),
      };
    }
    if (token.kind !== "UpperName") {
      this.#error(
        "expected a primitive or tuple type annotation",
      );
      if (token.kind === "LowerName") this.#advance();
      return undefined;
    }
    this.#advance();
    const name = parsedName(token);
    return { kind: "NamedType", name, span: name.span };
  }

  #takeName(
    kind: "LowerName" | "UpperName",
    message: string,
  ): Lexed.NameToken | undefined {
    const token = this.#current();
    if (token.kind !== kind) {
      this.#error(message);
      return undefined;
    }
    this.#advance();
    return token;
  }

  #takeAnyName(message: string): Lexed.NameToken | undefined {
    const token = this.#current();
    if (token.kind !== "LowerName" && token.kind !== "UpperName") {
      this.#error(message);
      return undefined;
    }
    this.#advance();
    return token;
  }

  #skipSeparators(): void {
    while (this.#at("VSep") || this.#at("Semicolon")) {
      this.#advance();
    }
  }

  #synchronize(stops: ReadonlySet<TokenKind>): void {
    while (!stops.has(this.#current().kind)) {
      this.#advance();
    }
  }

  #expect(kind: TokenKind, message: string): LaidOut.Token | undefined {
    if (!this.#at(kind)) {
      this.#error(message);
      return undefined;
    }
    return this.#advance();
  }

  #error(message: string): void {
    this.#errorAt(this.#current().span, message);
  }

  #errorAt(span: Source.Span, message: string): void {
    this.#diagnostics.add({ severity: "error", message, primary: span });
  }

  #at(kind: TokenKind): boolean {
    return this.#current().kind === kind;
  }

  #current(): LaidOut.Token {
    return this.#tokens[this.#index] ?? this.#tokens.at(-1) ?? missingEof();
  }

  #peek(distance: number): LaidOut.Token {
    return this.#tokens[this.#index + distance] ?? this.#current();
  }

  #previous(): LaidOut.Token {
    return this.#tokens[Math.max(0, this.#index - 1)] ?? this.#current();
  }

  #advance(): LaidOut.Token {
    const token = this.#current();
    if (token.kind !== "Eof") {
      this.#index += 1;
    }
    return token;
  }
}

function parsedName(token: Lexed.NameToken): Parsed.Name {
  return {
    text: token.text,
    case: token.kind === "LowerName" ? "lower" : "upper",
    span: token.span,
  };
}

function requiredOperator(operation: Infix, token: LaidOut.Token): Parsed.BinaryOperator {
  if (operation.operator === undefined) {
    throw new Error(`internal error: ${token.kind} has no binary operator`);
  }
  return operation.operator;
}

function withStops(
  stops: ReadonlySet<TokenKind>,
  ...additional: readonly TokenKind[]
): ReadonlySet<TokenKind> {
  return new Set([...stops, ...additional]);
}

function spanFrom(first: Source.Span, last: Source.Span): Source.Span {
  return { fileId: first.fileId, start: first.start, end: last.end };
}

function describe(kind: TokenKind): string {
  const punctuation: Partial<Record<TokenKind, string>> = {
    LeftParen: "(",
    RightParen: ")",
    LeftBracket: "[",
    RightBracket: "]",
    LeftBrace: "{",
    RightBrace: "}",
    Comma: ",",
    Colon: ":",
    Semicolon: ";",
    Dot: ".",
    Spread: "...",
    Equal: "=",
    FatArrow: "=>",
    Plus: "+",
    Minus: "-",
    Star: "*",
    Slash: "/",
    Power: "**",
    Concat: "++",
    EqualEqual: "==",
    NotEqual: "!=",
    Less: "<",
    Greater: ">",
    LessEqual: "<=",
    GreaterEqual: ">=",
    Range: "..",
    Pipe: "|>",
    Assign: ":=",
    Bar: "|",
    Wildcard: "_",
  };
  const spelling = punctuation[kind];
  if (spelling !== undefined) {
    return `\`${spelling}\``;
  }
  if (isKeyword(kind)) {
    return `\`${kind.toLowerCase()}\``;
  }
  switch (kind) {
    case "LowerName": return "a lowercase name";
    case "UpperName": return "an uppercase name";
    case "Integer": return "an integer literal";
    case "BigInt": return "a BigInt literal";
    case "Float": return "a Float literal";
    case "String": return "a string literal";
    case "VOpen": return "an indented block";
    case "VSep": return "a newline";
    case "VClose": return "the end of a block";
    case "Eof": return "end of file";
    default: return "that token";
  }
}

function isKeyword(kind: TokenKind): kind is Lexed.KeywordKind {
  return [
    "And", "Catch", "Constraint", "Derive", "Else", "Exception", "Export",
    "Extern", "False", "Finally", "For", "Fun", "Honor", "Iff", "If",
    "Implies", "Import", "In", "Let", "Match", "Not", "Or", "Record",
    "Then", "True", "Try", "Type", "Union", "Var", "While",
  ].includes(kind);
}

function missingEof(): LaidOut.Token {
  throw new Error("internal error: parser requires a non-empty token stream ending in Eof");
}
