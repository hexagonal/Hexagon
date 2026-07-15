/**
 * The first resolver assigns stable identities to local bindings and replaces
 * textual references with those identities. It deliberately covers only the
 * binding forms admitted by the current parser: sequential lets, directly
 * recursive functions, and lambda parameters.
 */

import * as Diagnostics from "../../support/diagnostics.js";
import type * as Source from "../../support/source.js";
import type * as Parsed from "../../syntax/parsed/index.js";
import * as Resolved from "../../syntax/resolved/index.js";

export function resolve(module: Parsed.Module): Resolved.Module {
  const diagnostics = new Diagnostics.Bag();
  for (const diagnostic of module.diagnostics) diagnostics.add(diagnostic);

  return new Resolver(diagnostics).resolve(module);
}

class Scope {
  readonly #bindings = new Map<string, Resolved.SymbolId>();

  constructor(readonly parent?: Scope) {}

  define(name: string, symbol: Resolved.SymbolId): void {
    this.#bindings.set(name, symbol);
  }

  lookupLocal(name: string): Resolved.SymbolId | undefined {
    return this.#bindings.get(name);
  }

  lookup(name: string): Resolved.SymbolId | undefined {
    return this.#bindings.get(name) ?? this.parent?.lookup(name);
  }
}

class Resolver {
  readonly #symbols: Resolved.Symbol[] = [];
  readonly #pending: Parsed.Name[] = [];
  readonly #laterFunNames: Parsed.Name[][] = [];
  readonly #diagnostics: Diagnostics.Bag;

  constructor(diagnostics: Diagnostics.Bag) {
    this.#diagnostics = diagnostics;
  }

  resolve(module: Parsed.Module): Resolved.Module {
    const scope = new Scope();
    const items = this.#resolveItems(module.items, scope);

    return {
      kind: "Module",
      fileId: module.fileId,
      items,
      symbols: this.#symbols,
      span: module.span,
      diagnostics: this.#diagnostics.toArray(),
    };
  }

  #resolveItems(
    items: readonly Parsed.Item[],
    scope: Scope,
  ): readonly Resolved.Item[] {
    const laterFunNames = items.flatMap((item) =>
      item.kind === "Fun" ? [item.name] : [],
    );
    this.#laterFunNames.push(laterFunNames);
    const resolved: Resolved.Item[] = [];
    for (const item of items) {
      if (item.kind === "Fun") laterFunNames.shift();
      resolved.push(this.#resolveItem(item, scope));
    }
    this.#laterFunNames.pop();
    return resolved;
  }

  #resolveItem(item: Parsed.Item, scope: Scope): Resolved.Item {
    switch (item.kind) {
      case "Let": {
        const existing = scope.lookup(item.name.text);
        if (existing !== undefined) this.#reportRebinding(item.name, existing);

        const binding = this.#declare(item.name, "let");
        this.#pending.push(item.name);
        const value = this.#resolveExpr(item.value, scope);
        this.#pending.pop();

        // Preserve the first valid meaning after an error instead of allowing
        // a rejected rebinding to change how subsequent names resolve.
        if (existing === undefined) scope.define(item.name.text, binding.symbol);

        return {
          kind: "Let",
          exported: item.exported,
          binding,
          value,
          span: item.span,
        };
      }
      case "Fun": {
        const existing = scope.lookup(item.name.text);
        if (existing !== undefined) this.#reportRebinding(item.name, existing);

        const binding = this.#declare(item.name, "fun");
        const valueScope = existing === undefined ? scope : new Scope(scope);
        valueScope.define(item.name.text, binding.symbol);
        if (existing === undefined) scope.define(item.name.text, binding.symbol);

        return {
          kind: "Fun",
          exported: item.exported,
          binding,
          value: this.#resolveLambda(item.value, valueScope),
          span: item.span,
        };
      }
      case "ExprItem":
        return {
          kind: "ExprItem",
          expression: this.#resolveExpr(item.expression, scope),
          span: item.span,
        };
      case "ErrorItem":
        return item;
    }
  }

  #resolveExpr(expression: Parsed.Expr, scope: Scope): Resolved.Expr {
    switch (expression.kind) {
      case "Name":
        return this.#resolveName(expression, scope);
      case "Unit":
      case "Boolean":
      case "Integer":
      case "BigInt":
      case "Float":
      case "ErrorExpr":
        return expression;
      case "String":
        return {
          ...expression,
          parts: expression.parts.map((part) =>
            part.kind === "Text"
              ? part
              : {
                  ...part,
                  expression: this.#resolveExpr(part.expression, scope),
                },
          ),
        };
      case "Group":
        return {
          ...expression,
          expression: this.#resolveExpr(expression.expression, scope),
        };
      case "Block": {
        const blockScope = new Scope(scope);
        return {
          ...expression,
          items: this.#resolveItems(expression.items, blockScope),
        };
      }
      case "Lambda":
        return this.#resolveLambda(expression, scope);
      case "If": {
        const common = {
          kind: "If" as const,
          condition: this.#resolveExpr(expression.condition, scope),
          consequence: this.#resolveExpr(expression.consequence, scope),
          span: expression.span,
        };
        return expression.alternative === undefined
          ? common
          : {
              ...common,
              alternative: this.#resolveExpr(expression.alternative, scope),
            };
      }
      case "Call":
        return {
          ...expression,
          callee: this.#resolveExpr(expression.callee, scope),
          arguments: expression.arguments.map((argument) =>
            this.#resolveExpr(argument, scope),
          ),
        };
      case "Access":
        return {
          ...expression,
          receiver: this.#resolveExpr(expression.receiver, scope),
          field: {
            text: expression.field.text,
            case: expression.field.case,
            span: expression.field.span,
          },
        };
      case "Index":
        return {
          ...expression,
          receiver: this.#resolveExpr(expression.receiver, scope),
          index: this.#resolveExpr(expression.index, scope),
        };
      case "Unary":
        return {
          ...expression,
          operand: this.#resolveExpr(expression.operand, scope),
        };
      case "Binary":
        return {
          ...expression,
          left: this.#resolveExpr(expression.left, scope),
          right: this.#resolveExpr(expression.right, scope),
        };
      case "Comparison":
        return {
          ...expression,
          operands: expression.operands.map((operand) =>
            this.#resolveExpr(operand, scope),
          ),
        };
      case "Assignment":
        return {
          ...expression,
          target: this.#resolveExpr(expression.target, scope),
          value: this.#resolveExpr(expression.value, scope),
        };
    }
  }

  #resolveName(expression: Parsed.NameExpr, scope: Scope): Resolved.Expr {
    const symbol = scope.lookup(expression.name.text);
    if (symbol !== undefined) {
      return {
        kind: "Name",
        symbol,
        text: expression.name.text,
        span: expression.span,
      };
    }

    const pending = this.#findPending(expression.name.text);
    if (pending !== undefined) {
      this.#diagnostics.add({
        severity: "error",
        message:
          `\`${expression.name.text}\` is not in scope in its own ` +
          "`let` definition; `let` is non-recursive — use `fun`.",
        primary: expression.span,
        labels: [{ span: pending.span, message: "binding declared here" }],
      });
    } else if (this.#findLaterFun(expression.name.text) !== undefined) {
      this.#diagnostics.add({
        severity: "error",
        message:
          `\`${expression.name.text}\` is declared by a later \`fun\`; forward ` +
          "and mutual `fun` references are not implemented yet",
        primary: expression.span,
      });
    } else {
      this.#diagnostics.add({
        severity: "error",
        message: `unknown name \`${expression.name.text}\``,
        primary: expression.span,
      });
    }

    return { kind: "ErrorExpr", span: expression.span };
  }

  #resolveLambda(expression: Parsed.LambdaExpr, scope: Scope): Resolved.LambdaExpr {
    const lambdaScope = new Scope(scope);
    const parameters = expression.parameters.map((parameter) => {
      const existing = lambdaScope.lookupLocal(parameter.name.text);
      const binding = this.#declare(parameter.name, "parameter");

      if (existing === undefined) {
        lambdaScope.define(parameter.name.text, binding.symbol);
      } else {
        const previous = this.#symbol(existing);
        this.#diagnostics.add({
          severity: "error",
          message: `duplicate parameter \`${parameter.name.text}\``,
          primary: parameter.name.span,
          labels: [
            { span: previous.bindingSpan, message: "first parameter is here" },
          ],
        });
      }

      const annotation = parameter.annotation === undefined
        ? undefined
        : this.#resolveTypeAnnotation(parameter.annotation);
      return {
        ...binding,
        ...(annotation === undefined ? {} : { annotation }),
      };
    });

    return {
      kind: "Lambda",
      parameters,
      ...(expression.returnAnnotation === undefined
        ? {}
        : { returnAnnotation: this.#resolveTypeAnnotation(expression.returnAnnotation) }),
      body: this.#resolveExpr(expression.body, lambdaScope),
      span: expression.span,
    };
  }

  #resolveTypeAnnotation(
    annotation: Parsed.TypeAnnotation,
  ): Resolved.TypeAnnotation {
    if (isPrimitiveName(annotation.name.text)) {
      return {
        kind: "Primitive",
        name: annotation.name.text,
        span: annotation.span,
      };
    }

    this.#diagnostics.add({
      severity: "error",
      message:
        `unknown type \`${annotation.name.text}\`; the second compiler slice ` +
        "supports primitive type annotations only",
      primary: annotation.span,
    });
    return { kind: "ErrorType", span: annotation.span };
  }

  #declare(name: Parsed.Name, kind: Resolved.SymbolKind): Resolved.Binding {
    const symbol = Resolved.symbolId(this.#symbols.length);
    this.#symbols.push({
      id: symbol,
      name: name.text,
      kind,
      bindingSpan: name.span,
    });
    return { symbol, name: name.text, span: name.span };
  }

  #findPending(name: string): Parsed.Name | undefined {
    for (let index = this.#pending.length - 1; index >= 0; index -= 1) {
      const pending = this.#pending[index];
      if (pending?.text === name) return pending;
    }
    return undefined;
  }

  #findLaterFun(name: string): Parsed.Name | undefined {
    for (let index = this.#laterFunNames.length - 1; index >= 0; index -= 1) {
      const found = this.#laterFunNames[index]?.find(
        (candidate) => candidate.text === name,
      );
      if (found !== undefined) return found;
    }
    return undefined;
  }

  #reportRebinding(name: Parsed.Name, existing: Resolved.SymbolId): void {
    const previous = this.#symbol(existing);
    this.#diagnostics.add({
      severity: "error",
      message:
        `\`${name.text}\` is already bound (line ` +
        `${previous.bindingSpan.start.line + 1}); Hexagon does not allow ` +
        "rebinding — choose a different name.",
      primary: name.span,
      labels: [{ span: previous.bindingSpan, message: "previous binding" }],
    });
  }

  #symbol(id: Resolved.SymbolId): Resolved.Symbol {
    const symbol: Resolved.Symbol | undefined = this.#symbols[id];
    if (symbol === undefined) throw new Error(`unknown internal symbol ${id}`);
    return symbol;
  }
}

function isPrimitiveName(name: string): name is Resolved.PrimitiveName {
  return ["Int", "Float", "Bool", "String", "BigInt", "Unit"].includes(name);
}
