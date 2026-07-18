/**
 * The parser turns LaidOut.File into Parsed.Module. It owns block items and the
 * core expression grammar, including precedence and recovery at layout
 * separators. Tuple patterns, nullary unions and matches, annotations, tuple
 * values, local mutation, inclusive ranges, `while`, `for..in`, and directly recursive
 * `fun` bindings are present; the remaining
 * declarations, patterns, and richer type syntax remain future work. Constraint
 * bodies include the owner-scoped associated type forms from Collections Part 2 §5.
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
  "Extern",
  "Type",
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
    if (this.#at("Import")) {
      if (!moduleItems) {
        const start = this.#advance();
        this.#errorAt(start.span, "imports are declared at module level");
        this.#synchronize(itemEnds);
        return { kind: "ErrorItem", span: spanFrom(start.span, this.#previous().span) };
      }
      return this.#parseImport();
    }
    if (this.#at("Constraint")) {
      if (!moduleItems) {
        const start = this.#advance();
        this.#errorAt(start.span, "constraints are declared at module level");
        this.#synchronize(itemEnds);
        return { kind: "ErrorItem", span: spanFrom(start.span, this.#previous().span) };
      }
      return this.#parseConstraint();
    }
    if (this.#at("Honor")) {
      if (!moduleItems) {
        const start = this.#advance();
        this.#errorAt(start.span, "instances are declared at module level");
        this.#synchronize(itemEnds);
        return { kind: "ErrorItem", span: spanFrom(start.span, this.#previous().span) };
      }
      return this.#parseHonor();
    }
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
      if (!this.#at("Let") && !this.#at("Fun") && !this.#at("Union") && !this.#at("Record") && !this.#at("Exception")) {
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
      if (this.#at("Record")) return this.#parseRecordDeclaration(true, exportToken.span);
      if (this.#at("Exception")) return this.#parseException(true, exportToken.span);
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
    if (this.#at("Var")) {
      return this.#parseVar();
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
    if (this.#at("Record")) {
      if (!moduleItems) {
        const start = this.#advance();
        this.#errorAt(start.span, "`record` is only allowed at module top level");
        this.#synchronize(itemEnds);
        return { kind: "ErrorItem", span: spanFrom(start.span, this.#previous().span) };
      }
      return this.#parseRecordDeclaration(false);
    }
    if (this.#at("Exception")) {
      if (!moduleItems) {
        const start = this.#advance();
        this.#errorAt(start.span, "exceptions are declared at module level");
        this.#synchronize(itemEnds);
        return { kind: "ErrorItem", span: spanFrom(start.span, this.#previous().span) };
      }
      return this.#parseException(false);
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

  #parseImport(): Parsed.ImportItem {
    const start = this.#advance();
    let form: Parsed.ImportForm;
    if (this.#at("String")) {
      const specifier = this.#parseImportSpecifier();
      return {
        kind: "Import",
        specifier: specifier.value,
        form: { kind: "Effect" },
        span: spanFrom(start.span, specifier.span),
      };
    }
    if (this.#at("Star")) {
      this.#advance();
      this.#expectContextual("as", "expected `as` after `import *`");
      const aliasToken = this.#takeName("UpperName", "module aliases must be uppercase-start names");
      const alias = aliasToken === undefined
        ? { text: "Invalid", startClass: "upper" as const, span: this.#current().span }
        : parsedName(aliasToken);
      form = { kind: "Namespace", alias };
    } else {
      this.#expect("LeftBrace", "expected `{`, `*`, or a module string after `import`");
      const names: Parsed.ImportName[] = [];
      while (!this.#at("RightBrace") && !this.#at("Eof")) {
        const token = this.#current();
        if (token.kind !== "NonUpperName" && token.kind !== "UpperName") {
          this.#error("expected an imported name");
          break;
        }
        this.#advance();
        const imported = parsedName(token);
        let local = imported;
        if (this.#atContextual("as")) {
          this.#advance();
          const expected = imported.startClass === "non-upper" ? "NonUpperName" : "UpperName";
          const alias = this.#takeName(expected, "import alias start class must match what it names");
          if (alias !== undefined) local = parsedName(alias);
        }
        names.push({ imported, local, span: spanFrom(imported.span, local.span) });
        if (!this.#at("Comma")) break;
        this.#advance();
      }
      this.#expect("RightBrace", "expected `}` after imported names");
      form = { kind: "Named", names };
    }
    this.#expectContextual("from", "expected `from` before the module path");
    const specifier = this.#parseImportSpecifier();
    return {
      kind: "Import",
      specifier: specifier.value,
      form,
      span: spanFrom(start.span, specifier.span),
    };
  }

  #parseConstraint(): Parsed.ConstraintItem {
    const start = this.#advance();
    const nameToken = this.#takeName("UpperName", "`constraint` requires an uppercase-start name");
    const fallbackName: Parsed.Name = {
      text: "Invalid",
      startClass: "upper",
      span: nameToken?.span ?? start.span,
    };
    const head = this.#at("Less") ? this.#parseTypeParameters() : [];
    if (head.length !== 1) {
      this.#errorAt(start.span, "a constraint head introduces exactly one type variable");
    }
    const subject = head[0]?.name ?? {
      text: "a",
      startClass: "non-upper" as const,
      span: this.#current().span,
    };
    const superconstraints = head[0]?.constraints ?? [];
    this.#expect("Equal", "expected `=` after constraint head");
    this.#expect("VOpen", "expected an indented constraint body");
    const associatedTypes: Parsed.ConstraintAssociatedType[] = [];
    const members: Parsed.ConstraintMember[] = [];
    this.#skipSeparators();
    while (!this.#at("VClose") && !this.#at("Eof")) {
      if (this.#at("Type")) {
        const type = this.#advance();
        const typeName = this.#takeName("UpperName", "associated types require an uppercase-start name");
        if (typeName !== undefined) {
          associatedTypes.push({
            name: parsedName(typeName),
            span: spanFrom(type.span, typeName.span),
          });
        }
        this.#skipSeparators();
        continue;
      }
      const memberToken = this.#takeName("NonUpperName", "constraint members are non-uppercase-start names");
      if (memberToken === undefined) {
        this.#synchronize(new Set(["VSep", "VClose", "Eof"]));
        this.#skipSeparators();
        continue;
      }
      const parameters = this.#parseParameters();
      for (const parameter of parameters) {
        if (parameter.annotation === undefined) {
          this.#errorAt(parameter.span, "constraint member parameters require type annotations");
        }
      }
      this.#expect("Colon", "constraint members require a result type");
      const result = this.#parseTypeAnnotation() ?? {
        kind: "NamedType" as const,
        name: fallbackName,
        span: fallbackName.span,
      };
      let defaultValue: Parsed.LambdaExpr | undefined;
      if (this.#at("Equal")) {
        this.#advance();
        const body = this.#parseBodyExpression(new Set(["VSep", "VClose", "Eof"]));
        defaultValue = {
          kind: "Lambda",
          parameters,
          body,
          span: spanFrom(memberToken.span, body.span),
        };
      }
      members.push({
        name: parsedName(memberToken),
        parameters,
        returnAnnotation: result,
        ...(defaultValue === undefined ? {} : { defaultValue }),
        span: spanFrom(memberToken.span, result.span),
      });
      this.#skipSeparators();
    }
    const closing = this.#expect("VClose", "expected the constraint body to close");
    if (members.length === 0) this.#errorAt(start.span, "a constraint needs at least one required member");
    return {
      kind: "ConstraintDeclaration",
      name: nameToken === undefined ? fallbackName : parsedName(nameToken),
      subject,
      superconstraints,
      associatedTypes,
      members,
      span: spanFrom(start.span, closing?.span ?? members.at(-1)?.span ?? start.span),
    };
  }

  #parseHonor(): Parsed.HonorItem {
    const start = this.#advance();
    const typeParameters = this.#at("Less") ? this.#parseTypeParameters() : [];
    const constraintToken = this.#takeName("UpperName", "`honor` requires a constraint name");
    const fallback: Parsed.Name = {
      text: "Invalid",
      startClass: "upper",
      span: constraintToken?.span ?? start.span,
    };
    this.#expect("Less", "instance heads use `<Type>`");
    const subject = this.#parseTypeAnnotation() ?? {
      kind: "NamedType" as const,
      name: fallback,
      span: fallback.span,
    };
    this.#expect("Greater", "expected `>` after instance head");
    this.#expect("Equal", "expected `=` after instance head");
    if (this.#at("Derive")) {
      this.#advance();
      return {
        kind: "Honor",
        constraint: constraintToken === undefined ? fallback : parsedName(constraintToken),
        typeParameters,
        subject,
        derived: true,
        associatedTypes: [],
        members: [],
        span: spanFrom(start.span, this.#previous().span),
      };
    }
    this.#expect("VOpen", "expected an indented instance body");
    const associatedTypes: Parsed.HonorAssociatedType[] = [];
    const members: Parsed.HonorMember[] = [];
    this.#skipSeparators();
    while (!this.#at("VClose") && !this.#at("Eof")) {
      if (this.#at("Type")) {
        const type = this.#advance();
        const typeName = this.#takeName("UpperName", "associated type bindings require an uppercase-start name");
        this.#expect("Equal", "expected `=` in associated type binding");
        const annotation = this.#parseTypeAnnotation();
        if (typeName !== undefined && annotation !== undefined) {
          associatedTypes.push({
            name: parsedName(typeName),
            annotation,
            span: spanFrom(type.span, annotation.span),
          });
        }
        this.#skipSeparators();
        continue;
      }
      const memberToken = this.#takeName("NonUpperName", "instance members are non-uppercase-start names");
      if (memberToken === undefined) {
        this.#synchronize(new Set(["VSep", "VClose", "Eof"]));
        this.#skipSeparators();
        continue;
      }
      const parameters = this.#parseParameters();
      this.#expect("Equal", "expected `=` in instance member");
      const body = this.#parseBodyExpression(new Set(["VSep", "VClose", "Eof"]));
      const name = parsedName(memberToken);
      members.push({
        name,
        value: {
          kind: "Lambda",
          parameters,
          body,
          span: spanFrom(name.span, body.span),
        },
        span: spanFrom(name.span, body.span),
      });
      this.#skipSeparators();
    }
    const closing = this.#expect("VClose", "expected the instance body to close");
    return {
      kind: "Honor",
      constraint: constraintToken === undefined ? fallback : parsedName(constraintToken),
      typeParameters,
      subject,
      derived: false,
      associatedTypes,
      members,
      span: spanFrom(start.span, closing?.span ?? members.at(-1)?.span ?? subject.span),
    };
  }

  #parseImportSpecifier(): { readonly value: string; readonly span: Source.Span } {
    const token = this.#current();
    if (token.kind !== "String") {
      this.#error("module paths are string literals");
      return { value: "", span: token.span };
    }
    this.#advance();
    if (token.parts.some((part) => part.kind !== "Text")) {
      this.#errorAt(token.span, "module paths cannot contain interpolation");
    }
    return {
      value: token.parts.flatMap((part) => part.kind === "Text" ? [part.value] : []).join(""),
      span: token.span,
    };
  }

  #atContextual(text: string): boolean {
    const token = this.#current();
    return token.kind === "NonUpperName" && token.text === text;
  }

  #expectContextual(text: string, message: string): void {
    if (this.#atContextual(text)) this.#advance();
    else this.#error(message);
  }

  #parseVar(): Parsed.Item {
    const start = this.#advance();
    if (["LeftParen", "LeftBrace"].includes(this.#current().kind)) {
      this.#error("`var` binds a single name; destructure with `let` and copy");
      this.#synchronize(itemEnds);
      return { kind: "ErrorItem", span: spanFrom(start.span, this.#previous().span) };
    }
    const token = this.#takeName("NonUpperName", "`var` requires a non-uppercase-start name");
    if (token === undefined) {
      this.#synchronize(itemEnds);
      return { kind: "ErrorItem", span: spanFrom(start.span, this.#previous().span) };
    }
    let annotation: Parsed.TypeAnnotation | undefined;
    if (this.#at("Colon")) {
      this.#advance();
      annotation = this.#parseTypeAnnotation();
    }
    if (this.#expect("Equal", "expected `=` in `var` binding") === undefined) {
      this.#synchronize(itemEnds);
      return { kind: "ErrorItem", span: spanFrom(start.span, this.#previous().span) };
    }
    const value = this.#parseBodyExpression();
    return {
      kind: "Var",
      name: parsedName(token),
      ...(annotation === undefined ? {} : { annotation }),
      value,
      span: spanFrom(start.span, value.span),
    };
  }

  #parseBinding(
    bindingKind: "Let" | "Fun",
    exported: boolean,
    itemStart?: Source.Span,
  ): Parsed.Item {
    const start = this.#advance();
    const keyword = bindingKind === "Let" ? "let" : "fun";
    const nameToken = this.#takeName(
      "NonUpperName",
      `\`${keyword}\` requires a non-uppercase-start name`,
    );
    if (nameToken === undefined) {
      this.#synchronize(itemEnds);
      return { kind: "ErrorItem", span: spanFrom(start.span, this.#previous().span) };
    }

    let parameters: readonly Parsed.Parameter[] | undefined;
    let typeParameters: readonly Parsed.TypeParameter[] | undefined;
    let returnAnnotation: Parsed.TypeAnnotation | undefined;
    let bindingAnnotation: Parsed.TypeAnnotation | undefined;
    let parameterStartSpan: Source.Span | undefined;
    if (this.#at("Less")) {
      typeParameters = this.#parseTypeParameters();
    }
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
          ...(typeParameters === undefined ? {} : { typeParameters }),
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

  #parseTypeParameters(): readonly Parsed.TypeParameter[] {
    this.#advance();
    const parameters: Parsed.TypeParameter[] = [];
    const seen = new Set<string>();
    while (!this.#at("Greater") && !this.#at("Eof")) {
      const token = this.#takeName("NonUpperName", "type parameters must be non-uppercase-start names");
      if (token === undefined) break;
      const name = parsedName(token);
      if (seen.has(name.text)) this.#errorAt(name.span, `duplicate type parameter \`${name.text}\``);
      seen.add(name.text);
      const constraints: Parsed.Name[] = [];
      if (this.#at("Colon")) {
        this.#advance();
      } else {
        parameters.push({ name, constraints, span: name.span });
        if (!this.#at("Comma")) break;
        this.#advance();
        continue;
      }
      if (this.#at("LeftParen")) {
        this.#advance();
        while (!this.#at("RightParen") && !this.#at("Eof")) {
          const constraint = this.#takeName("UpperName", "constraint names are uppercase");
          if (constraint !== undefined) constraints.push(parsedName(constraint));
          if (!this.#at("Comma")) break;
          this.#advance();
        }
        this.#expect("RightParen", "expected `)` after constraints");
      } else {
        const constraint = this.#takeName("UpperName", "expected a constraint name");
        if (constraint !== undefined) constraints.push(parsedName(constraint));
      }
      parameters.push({
        name,
        constraints,
        span: spanFrom(name.span, constraints.at(-1)?.span ?? name.span),
      });
      if (!this.#at("Comma")) break;
      this.#advance();
    }
    this.#expect("Greater", "expected `>` after type parameters");
    return parameters;
  }

  #parseDerives(): readonly Parsed.Name[] {
    if (!this.#atContextual("derives")) return [];
    this.#advance();
    const derives: Parsed.Name[] = [];
    const parenthesized = this.#at("LeftParen");
    if (parenthesized) this.#advance();
    while (!this.#at("Eof")) {
      const token = this.#takeName("UpperName", "`derives` requires a constraint name");
      if (token === undefined) break;
      const name = parsedName(token);
      if (derives.some(({ text }) => text === name.text)) {
        this.#errorAt(name.span, `\`${name.text}\` appears more than once in \`derives\``);
      }
      derives.push(name);
      if (!parenthesized || !this.#at("Comma")) break;
      this.#advance();
    }
    if (parenthesized) this.#expect("RightParen", "expected `)` after `derives` constraints");
    return derives;
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
    const parameters: Parsed.Name[] = [];
    if (this.#at("LeftParen")) {
      this.#advance();
      const seen = new Set<string>();
      while (!this.#at("RightParen") && !this.#at("Eof")) {
        const parameter = this.#takeName(
          "NonUpperName",
          "union type parameters must be non-uppercase-start names",
        );
        if (parameter === undefined) break;
        const name = parsedName(parameter);
        if (seen.has(name.text)) {
          this.#errorAt(name.span, `duplicate type parameter \`${name.text}\``);
        }
        seen.add(name.text);
        parameters.push(name);
        if (!this.#at("Comma")) break;
        this.#advance();
      }
      this.#expect("RightParen", "expected `)` after union type parameters");
      if (parameters.length === 0) {
        this.#errorAt(nameToken.span, "generic union parameter list cannot be empty");
      }
    }
    const derives = this.#parseDerives();
    if (this.#expect("Equal", "expected `=` after union name") === undefined) {
      this.#synchronize(itemEnds);
      return { kind: "ErrorItem", span: spanFrom(start.span, this.#previous().span) };
    }
    if (this.#at("Bar")) this.#advance();

    const constructors: Parsed.Constructor[] = [];
    while (!itemEnds.has(this.#current().kind)) {
      const constructor = this.#takeName(
        "UpperName",
        "union constructors must be uppercase-start names",
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
          if (slotStart.kind === "NonUpperName" && this.#peek(1).kind === "Colon") {
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
      parameters,
      derives,
      constructors,
      span: spanFrom(
        itemStart ?? start.span,
        constructors.at(-1)?.span ?? nameToken.span,
      ),
    };
  }

  #parseRecordDeclaration(exported: boolean, itemStart?: Source.Span): Parsed.Item {
    const start = this.#advance();
    const nameToken = this.#takeName("UpperName", "`record` requires an uppercase type name");
    if (nameToken === undefined) {
      this.#synchronize(itemEnds);
      return { kind: "ErrorItem", span: spanFrom(start.span, this.#previous().span) };
    }
    const parameters: Parsed.Name[] = [];
    if (this.#at("LeftParen")) {
      this.#advance();
      const seen = new Set<string>();
      while (!this.#at("RightParen") && !this.#at("Eof")) {
        const parameter = this.#takeName("NonUpperName", "record type parameters must be non-uppercase-start names");
        if (parameter === undefined) break;
        const name = parsedName(parameter);
        if (seen.has(name.text)) this.#errorAt(name.span, `duplicate type parameter \`${name.text}\``);
        seen.add(name.text);
        parameters.push(name);
        if (!this.#at("Comma")) break;
        this.#advance();
      }
      this.#expect("RightParen", "expected `)` after record type parameters");
      if (parameters.length === 0) this.#errorAt(nameToken.span, "generic record parameter list cannot be empty");
    }
    const derives = this.#parseDerives();
    if (this.#expect("Equal", "expected `=` after record name") === undefined ||
        this.#expect("LeftBrace", "expected `{` after record `=`") === undefined) {
      this.#synchronize(itemEnds);
      return { kind: "ErrorItem", span: spanFrom(start.span, this.#previous().span) };
    }
    const fields: Parsed.RecordTypeField[] = [];
    const seen = new Set<string>();
    while (!this.#at("RightBrace") && !this.#at("Eof")) {
      const fieldToken = this.#takeName("NonUpperName", "record fields must be non-uppercase-start names");
      if (fieldToken === undefined) break;
      this.#expect("Colon", "expected `:` after record field name");
      const annotation = this.#parseTypeAnnotation();
      if (annotation === undefined) break;
      const name = parsedName(fieldToken);
      if (seen.has(name.text)) this.#errorAt(name.span, `duplicate record field \`${name.text}\``);
      seen.add(name.text);
      fields.push({ name, annotation, span: spanFrom(name.span, annotation.span) });
      if (!this.#at("Comma")) break;
      this.#advance();
    }
    const closing = this.#expect("RightBrace", "expected `}` after record fields");
    return {
      kind: "RecordDeclaration",
      exported,
      name: parsedName(nameToken),
      parameters,
      derives,
      fields,
      span: spanFrom(
        itemStart ?? start.span,
        closing?.span ?? fields.at(-1)?.span ?? nameToken.span,
      ),
    };
  }

  #parseException(exported: boolean, itemStart?: Source.Span): Parsed.Item {
    const start = this.#advance();
    const nameToken = this.#takeName("UpperName", "`exception` requires an uppercase-start name");
    if (nameToken === undefined) {
      this.#synchronize(itemEnds);
      return { kind: "ErrorItem", span: spanFrom(start.span, this.#previous().span) };
    }
    const slots: Parsed.ConstructorSlot[] = [];
    let end = nameToken.span;
    if (this.#at("LeftParen")) {
      const opening = this.#advance();
      while (!this.#at("RightParen") && !this.#at("Eof")) {
        const slotStart = this.#current();
        let slotName: Parsed.Name | undefined;
        if (slotStart.kind === "NonUpperName" && this.#peek(1).kind === "Colon") {
          this.#advance();
          this.#advance();
          slotName = parsedName(slotStart);
        }
        const annotation = this.#parseTypeAnnotation();
        if (annotation === undefined) break;
        slots.push({
          ...(slotName === undefined ? {} : { name: slotName }),
          annotation,
          span: spanFrom(slotStart.span, annotation.span),
        });
        if (!this.#at("Comma")) break;
        this.#advance();
      }
      const closing = this.#expect("RightParen", "expected `)` after exception payload");
      end = closing?.span ?? slots.at(-1)?.span ?? opening.span;
      if (slots.length === 0) this.#errorAt(opening.span, "a nullary exception is written without `()`");
      const named = slots.filter((slot) => slot.name !== undefined);
      if (named.length !== 0 && named.length !== slots.length) {
        this.#errorAt(opening.span, "exception payload slots must be all named or all unnamed");
      }
      const names = new Set<string>();
      for (const slot of named) {
        const name = slot.name!;
        if (["name", "stack"].includes(name.text) || name.text.startsWith("$")) {
          this.#errorAt(name.span, `\`${name.text}\` is reserved by the exception representation; rename this field`);
        }
        if (names.has(name.text)) this.#errorAt(name.span, `duplicate payload slot \`${name.text}\``);
        names.add(name.text);
      }
    }
    return {
      kind: "Exception",
      exported,
      name: parsedName(nameToken),
      slots,
      span: spanFrom(itemStart ?? start.span, end),
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
    if (operator.kind !== "NonUpperName" || operator.text !== "as") return pattern;
    this.#advance();
    const binder = this.#takeName(
      "NonUpperName",
      "`as` in a pattern requires a non-uppercase-start binding name",
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
    if (token.kind === "NonUpperName") {
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
        const field = this.#takeName("NonUpperName", "record patterns contain non-uppercase-start field names");
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
    if (this.#at("NonUpperName") && this.#peek(1).kind === "FatArrow") {
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
    if (this.#at("While")) {
      return this.#parseWhile(stops);
    }
    if (this.#at("For")) {
      return this.#parseFor(stops);
    }
    if (this.#at("Match")) {
      return this.#parseMatch(stops);
    }
    if (this.#at("Try")) {
      return this.#parseTry(stops);
    }

    return this.#parsePrimary(stops);
  }

  #parsePrimary(stops: ReadonlySet<TokenKind>): Parsed.Expr {
    const token = this.#current();
    switch (token.kind) {
      case "NonUpperName":
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
      const token = this.#takeName("NonUpperName", "record fields must be non-uppercase-start names");
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

  #parseWhile(outerStops: ReadonlySet<TokenKind>): Parsed.Expr {
    const start = this.#advance();
    const condition = this.#parseExpression(0, withStops(outerStops, "VOpen"));
    if (!this.#at("VOpen")) {
      this.#error("expected an indented block after `while` condition");
      return {
        kind: "While",
        condition,
        body: { kind: "Block", items: [], span: condition.span },
        span: spanFrom(start.span, condition.span),
      };
    }
    const body = this.#parseBlock();
    return {
      kind: "While",
      condition,
      body,
      span: spanFrom(start.span, body.span),
    };
  }

  #parseFor(outerStops: ReadonlySet<TokenKind>): Parsed.Expr {
    const start = this.#advance();
    const pattern = this.#parsePattern() ?? {
      kind: "Wildcard" as const,
      span: this.#current().span,
    };
    this.#expect("In", "expected `in` after `for` pattern");
    const iterable = this.#parseExpression(0, withStops(outerStops, "VOpen"));
    if (!this.#at("VOpen")) {
      this.#error("expected an indented block after `for` iterable");
      return {
        kind: "For",
        pattern,
        iterable,
        body: { kind: "Block", items: [], span: iterable.span },
        span: spanFrom(start.span, iterable.span),
      };
    }
    const body = this.#parseBlock();
    return {
      kind: "For",
      pattern,
      iterable,
      body,
      span: spanFrom(start.span, body.span),
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
        guardStart.kind === "NonUpperName" &&
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

  #parseTry(outerStops: ReadonlySet<TokenKind>): Parsed.TryExpr {
    const start = this.#advance();
    const body = this.#parseBodyExpression(withStops(outerStops, "Catch"));
    this.#expect("Catch", "`try` requires a `catch`");
    this.#expect("VOpen", "expected an indented block of catch arms");
    const arms: Parsed.MatchArm[] = [];
    this.#skipSeparators();
    while (!this.#at("VClose") && !this.#at("Eof")) {
      const pattern = this.#parsePattern();
      if (pattern === undefined) {
        this.#synchronize(new Set(["VSep", "VClose", "Eof"]));
        this.#skipSeparators();
        continue;
      }
      this.#expect("FatArrow", "expected `=>` after catch pattern");
      const armBody = this.#parseBodyExpression(new Set(["VSep", "VClose", "Eof"]));
      arms.push({ pattern, body: armBody, span: spanFrom(pattern.span, armBody.span) });
      this.#skipSeparators();
    }
    const closing = this.#expect("VClose", "expected the catch arms to close");
    return {
      kind: "Try",
      body,
      arms,
      span: spanFrom(start.span, closing?.span ?? arms.at(-1)?.span ?? body.span),
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
        "NonUpperName",
        "function parameters must be non-uppercase-start names",
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
          if (this.#at("NonUpperName")) {
            tail = parsedName(this.#advance() as Lexed.NameToken);
          }
          if (this.#at("Comma")) this.#error("`...` must be the final entry in a record type");
          break;
        }
        const fieldToken = this.#takeName("NonUpperName", "record type fields must be non-uppercase-start names");
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
    if (token.kind === "NonUpperName") {
      this.#advance();
      const name = parsedName(token);
      return { kind: "TypeVariable", name, span: name.span };
    }
    if (token.kind !== "UpperName") {
      this.#error(
        "expected a type annotation",
      );
      return undefined;
    }
    this.#advance();
    const name = parsedName(token);
    if (this.#at("LeftParen")) {
      this.#advance();
      const arguments_: Parsed.TypeAnnotation[] = [];
      while (!this.#at("RightParen") && !this.#at("Eof")) {
        const argument = this.#parseTypeAnnotation();
        if (argument === undefined) return undefined;
        arguments_.push(argument);
        if (!this.#at("Comma")) break;
        this.#advance();
      }
      const closing = this.#expect("RightParen", "expected `)` after type arguments");
      if (arguments_.length === 0) {
        this.#errorAt(name.span, "a type application needs at least one argument");
      }
      return {
        kind: "AppliedType",
        constructor: name,
        arguments: arguments_,
        span: spanFrom(name.span, closing?.span ?? arguments_.at(-1)?.span ?? name.span),
      };
    }
    return { kind: "NamedType", name, span: name.span };
  }

  #takeName(
    kind: "NonUpperName" | "UpperName",
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
    if (token.kind !== "NonUpperName" && token.kind !== "UpperName") {
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
    startClass: token.kind === "NonUpperName" ? "non-upper" : "upper",
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
    case "NonUpperName": return "a non-uppercase-start name";
    case "UpperName": return "an uppercase-start name";
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
