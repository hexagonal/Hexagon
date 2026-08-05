/** Compiler-owned source query for value-level identifier hover information. */

import type * as Source from "../support/source.js";
import * as Typed from "../syntax/typed/index.js";

export interface TypeOccurrence {
  readonly name: string;
  readonly displayedType: string;
  readonly span: Source.Span;
  /** The value this names, when it names one. Absent for a record field. */
  readonly symbol?: Typed.Symbol["id"];
  /**
   * Whether this is a dot-call's operation name — `source.map(f)`.
   *
   * Such a name exists only in the typed tree. The checker resolves companion
   * dispatch against the *receiver's* companion (Method Syntax §4.2) and
   * materializes the result as an ordinary `Name` at the field's span, so the
   * resolved tree has only an `Access` whose field nothing has yet decided the
   * meaning of. Any
   * query that wants to know what `map` denotes there has to read it from here.
   */
  readonly receiverBound?: boolean;
}

/** Returns every typed value identifier declaration and use in one module. */
export function collectTypeOccurrences(module: Typed.Module): readonly TypeOccurrence[] {
  const symbols = new Map(module.symbols.map((symbol) => [symbol.id, symbol]));
  const occurrences = new Map<string, TypeOccurrence>();
  const publish = (
    name: string,
    scheme: Typed.Scheme,
    span: Source.Span,
    denoted?: { readonly symbol: Typed.Symbol["id"]; readonly receiverBound: boolean },
  ): void => {
    if (span.fileId !== module.fileId) return;
    const key = `${Number(span.fileId)}:${span.start.offset}:${span.end.offset}`;
    if (occurrences.has(key)) return;
    occurrences.set(key, {
      name,
      displayedType: Typed.displayScheme(scheme),
      span,
      ...(denoted === undefined
        ? {}
        : { symbol: denoted.symbol, receiverBound: denoted.receiverBound }),
    });
  };
  const publishSymbol = (
    symbolId: Typed.Symbol["id"],
    fallbackName: string,
    span: Source.Span,
    receiverBound = false,
  ): void => {
    const symbol = symbols.get(symbolId);
    if (symbol === undefined) return;
    const scheme = symbol.scheme;
    publish(
      fallbackName,
      receiverBound ? receiverBoundScheme(scheme) : scheme,
      // A dot call's span is already exactly the operation name — the checker
      // takes it from the field — and its *name* is the local import spelling,
      // which need not be what the source wrote there. Narrowing by that name
      // would keep the last few characters of the field instead: `brighten`
      // imported as `b` and called as `Pale.brighten()` would publish over the
      // single character `n`.
      receiverBound ? span : spanForIdentifier(span, fallbackName),
      { symbol: symbol.id, receiverBound },
    );
  };

  for (const symbol of module.symbols) {
    publish(symbol.name, symbol.scheme, symbol.bindingSpan);
  }

  const visitPattern = (pattern: Typed.Pattern): void => {
    switch (pattern.kind) {
      case "As":
        visitPattern(pattern.pattern);
        return;
      case "Or":
        for (const alternative of pattern.alternatives) visitPattern(alternative);
        return;
      case "Tuple":
        for (const element of pattern.elements) visitPattern(element);
        return;
      case "Record":
        for (const field of pattern.fields) {
          const type = typeOfPattern(field.pattern);
          if (type !== undefined) publish(field.name, schemeForType(type), field.nameSpan);
          visitPattern(field.pattern);
        }
        return;
      case "Constructor":
        publishSymbol(pattern.symbol, pattern.text, pattern.nameSpan);
        for (const argument of pattern.arguments) visitPattern(argument);
        return;
      default:
        return;
    }
  };

  const visitItem = (item: Typed.Item): void => {
    switch (item.kind) {
      case "Let":
      case "Var":
      case "LetPattern":
        visitExpr(item.value);
        if (item.kind === "LetPattern") visitPattern(item.pattern);
        return;
      case "Fun":
        visitExpr(item.value);
        return;
      case "ConstraintDeclaration":
        for (const member of item.members) {
          if (member.defaultValue !== undefined) visitExpr(member.defaultValue);
        }
        return;
      case "Honor":
        for (const member of item.members) {
          publish(
            member.name,
            schemeForType(member.value.type),
            spanForLeadingIdentifier(member.span, member.name),
          );
          visitExpr(member.value);
        }
        return;
      case "RecordDeclaration":
        for (const field of item.fields) {
          publish(
            field.name,
            schemeForType(field.type),
            spanForLeadingIdentifier(field.span, field.name),
          );
        }
        return;
      case "ExprItem":
        visitExpr(item.expression);
        return;
      default:
        return;
    }
  };

  const visitExpr = (expression: Typed.Expr): void => {
    switch (expression.kind) {
      case "Name":
        publishSymbol(
          expression.symbol,
          expression.text,
          expression.span,
          expression.receiverBound,
        );
        return;
      case "String":
        for (const part of expression.parts) {
          if (part.kind === "Interpolation") visitExpr(part.expression);
        }
        return;
      case "Tuple":
        for (const element of expression.elements) visitExpr(element);
        return;
      case "Record":
        if (expression.spread !== undefined) visitExpr(expression.spread);
        for (const field of expression.fields) {
          publish(field.name.text, schemeForType(field.value.type), field.name.span);
          visitExpr(field.value);
        }
        return;
      case "Group":
        visitExpr(expression.expression);
        return;
      case "Block":
        for (const item of expression.items) visitItem(item);
        return;
      case "Lambda":
        visitExpr(expression.body);
        return;
      case "If":
        visitExpr(expression.condition);
        visitExpr(expression.consequence);
        visitExpr(expression.alternative);
        return;
      case "While":
        visitExpr(expression.condition);
        visitExpr(expression.body);
        return;
      case "For":
        visitPattern(expression.pattern);
        visitExpr(expression.iterable);
        visitExpr(expression.body);
        return;
      case "Match":
        visitExpr(expression.scrutinee);
        for (const arm of expression.arms) {
          visitPattern(arm.pattern);
          if (arm.guard !== undefined) visitExpr(arm.guard);
          visitExpr(arm.body);
        }
        return;
      case "Try":
        visitExpr(expression.body);
        for (const arm of expression.arms) {
          visitPattern(arm.pattern);
          visitExpr(arm.body);
        }
        return;
      case "Throw":
        visitExpr(expression.exception);
        return;
      case "Call":
        visitExpr(expression.callee);
        for (const argument of expression.arguments) visitExpr(argument);
        return;
      case "ConsoleLog":
        for (const argument of expression.arguments) visitExpr(argument);
        return;
      case "Access":
        visitExpr(expression.receiver);
        publish(expression.field.text, schemeForType(expression.type), expression.field.span);
        return;
      case "Index":
        visitExpr(expression.receiver);
        visitExpr(expression.index);
        return;
      case "LogicalNot":
        visitExpr(expression.operand);
        return;
      case "Logical":
        visitExpr(expression.left);
        visitExpr(expression.right);
        return;
      case "ConstraintCall":
        for (const argument of expression.arguments) visitExpr(argument);
        return;
      case "ComparisonChain":
        for (const operand of expression.operands) visitExpr(operand);
        return;
      case "Range":
        visitExpr(expression.start);
        visitExpr(expression.end);
        return;
      case "WidenNat":
      case "WidenInt":
        visitExpr(expression.value);
        return;
      case "Assignment":
        visitExpr(expression.target);
        visitExpr(expression.value);
        return;
      default:
        return;
    }
  };

  for (const item of module.items) visitItem(item);
  return [...occurrences.values()].sort((left, right) =>
    left.span.start.offset - right.span.start.offset ||
    left.span.end.offset - right.span.end.offset
  );
}

function schemeForType(type: Typed.Type): Typed.Scheme {
  return { variables: [], constraints: [], type };
}

function typeOfPattern(pattern: Typed.Pattern): Typed.Type | undefined {
  switch (pattern.kind) {
    case "Binding":
      return pattern.binding.scheme.type;
    case "As":
      return pattern.binding.scheme.type;
    case "Integer":
      return { kind: "Primitive", name: "Int" };
    case "String":
      return { kind: "Primitive", name: "String" };
    case "Tuple": {
      const elements = pattern.elements.map(typeOfPattern);
      return elements.every((element) => element !== undefined)
        ? { kind: "Tuple", elements }
        : undefined;
    }
    default:
      return undefined;
  }
}

function receiverBoundScheme(scheme: Typed.Scheme): Typed.Scheme {
  if (scheme.type.kind !== "Function" || scheme.type.parameters.length === 0) {
    return scheme;
  }
  return {
    ...scheme,
    type: {
      ...scheme.type,
      parameters: scheme.type.parameters.slice(1),
    },
  };
}

/** Qualified names retain an expression span; hover only the final identifier. */
function spanForIdentifier(span: Source.Span, name: string): Source.Span {
  const identifier = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1) : name;
  if (span.end.offset - span.start.offset <= identifier.length) return span;
  return {
    fileId: span.fileId,
    start: {
      ...span.end,
      offset: span.end.offset - identifier.length,
      column: span.end.column - identifier.length,
    },
    end: span.end,
  };
}

function spanForLeadingIdentifier(span: Source.Span, name: string): Source.Span {
  if (span.end.offset - span.start.offset <= name.length) return span;
  return {
    fileId: span.fileId,
    start: span.start,
    end: {
      ...span.start,
      offset: span.start.offset + name.length,
      column: span.start.column + name.length,
    },
  };
}
