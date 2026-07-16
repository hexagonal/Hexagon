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
  readonly #unions: Resolved.Union[] = [];
  readonly #unionNames = new Map<string, Resolved.UnionId>();
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
      unions: this.#unions,
      comments: module.comments,
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
          ...(item.annotation === undefined
            ? {}
            : { annotation: this.#resolveTypeAnnotation(item.annotation) }),
          value,
          span: item.span,
        };
      }
      case "LetPattern": {
        const names = parsedPatternNames(item.pattern);
        this.#pending.push(...names);
        const value = this.#resolveExpr(item.value, scope);
        this.#pending.splice(this.#pending.length - names.length, names.length);
        const seen = new Map<string, Resolved.Binding>();
        const pattern = this.#resolvePattern(item.pattern, scope, seen, false);
        return {
          kind: "LetPattern",
          exported: false,
          pattern,
          value,
          span: item.span,
        };
      }
      case "Union": {
        const existingUnion = this.#unionNames.get(item.name.text);
        if (existingUnion !== undefined) {
          this.#diagnostics.add({
            severity: "error",
            message: `type \`${item.name.text}\` is already declared`,
            primary: item.name.span,
          });
        }
        const union = Resolved.unionId(this.#unions.length);
        if (existingUnion === undefined) {
          this.#unionNames.set(item.name.text, union);
        }
        const seenConstructors = new Set<string>();
        const constructors = item.constructors.map((constructor) => {
          const existing = scope.lookup(constructor.name.text);
          if (seenConstructors.has(constructor.name.text)) {
            this.#diagnostics.add({
              severity: "error",
              message: `duplicate constructor \`${constructor.name.text}\``,
              primary: constructor.span,
            });
          } else if (existing !== undefined) {
            this.#reportRebinding(constructor.name, existing);
          }
          seenConstructors.add(constructor.name.text);
          const binding = this.#declare(constructor.name, "constructor");
          if (existing === undefined) {
            scope.define(constructor.name.text, binding.symbol);
          }
          return {
            binding,
            slots: constructor.slots.map((slot, index) => ({
              field: slot.name?.text ?? `item${index + 1}`,
              annotation: this.#resolveTypeAnnotation(slot.annotation),
              span: slot.span,
            })),
            span: constructor.span,
          };
        });
        const declaration: Resolved.Union = {
          id: union,
          name: item.name.text,
          span: item.name.span,
          constructors,
        };
        this.#unions.push(declaration);
        return {
          kind: "Union",
          exported: item.exported,
          union,
          name: item.name.text,
          constructors,
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
      case "Tuple":
        return {
          ...expression,
          elements: expression.elements.map((element) =>
            this.#resolveExpr(element, scope),
          ),
        };
      case "Record":
        return {
          kind: "Record",
          ...(expression.spread === undefined
            ? {}
            : { spread: this.#resolveExpr(expression.spread, scope) }),
          fields: expression.fields.map((field) => ({
            name: { text: field.name.text, case: field.name.case, span: field.name.span },
            punned: field.punned,
            value: this.#resolveExpr(field.value, scope),
            span: field.span,
          })),
          span: expression.span,
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
      case "Match":
        return {
          ...expression,
          scrutinee: this.#resolveExpr(expression.scrutinee, scope),
          arms: expression.arms.map((arm) => {
            const armScope = new Scope(scope);
            const pattern = this.#resolvePattern(
              arm.pattern,
              armScope,
              new Map(),
              true,
            );
            return {
              pattern,
              ...(arm.guard === undefined
                ? {}
                : { guard: this.#resolveExpr(arm.guard, armScope) }),
              body: this.#resolveExpr(arm.body, armScope),
              span: arm.span,
            };
          }),
        };
      case "Call":
        if (isUnshadowedConsoleLog(expression, scope)) {
          return {
            kind: "ConsoleLog",
            arguments: expression.arguments.map((argument) =>
              this.#resolveExpr(argument, scope),
            ),
            span: expression.span,
          };
        }
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

  #resolvePattern(
    pattern: Parsed.Pattern,
    scope: Scope,
    seen: Map<string, Resolved.Binding>,
    head: boolean,
    sharedBindings?: ReadonlyMap<string, Resolved.Binding>,
  ): Resolved.Pattern {
    if (
      pattern.kind === "Wildcard" ||
      pattern.kind === "Unit" ||
      pattern.kind === "Boolean" ||
      pattern.kind === "Integer" ||
      pattern.kind === "String"
    ) return pattern;
    if (pattern.kind === "Or") {
      const namesByAlternative = pattern.alternatives.map((alternative) =>
        parsedPatternNames(alternative)
      );
      const expected = new Set(namesByAlternative[0]?.map(({ text }) => text));
      for (const names of namesByAlternative.slice(1)) {
        const actual = new Set(names.map(({ text }) => text));
        for (const name of new Set([...expected, ...actual])) {
          if (expected.has(name) !== actual.has(name)) {
            this.#diagnostics.add({
              severity: "error",
              message: `\`${name}\` must be bound in every alternative of an or-pattern`,
              primary: pattern.span,
            });
          }
        }
      }

      const sourceNames = new Map<string, Parsed.Name>();
      for (const name of namesByAlternative.flat()) {
        if (!sourceNames.has(name.text)) sourceNames.set(name.text, name);
      }
      const shared = new Map(sharedBindings);
      for (const [text, name] of sourceNames) {
        if (shared.has(text)) continue;
        const existing = scope.lookup(text);
        if (!head && existing !== undefined) this.#reportRebinding(name, existing);
        const binding = this.#declare(name, head ? "pattern" : "let");
        shared.set(text, binding);
        if (head || existing === undefined) scope.define(text, binding.symbol);
      }
      return {
        kind: "Or",
        alternatives: pattern.alternatives.map((alternative) =>
          this.#resolvePattern(alternative, scope, new Map(), head, shared)
        ),
        span: pattern.span,
      };
    }
    if (pattern.kind === "As") {
      const nested = this.#resolvePattern(
        pattern.pattern,
        scope,
        seen,
        head,
        sharedBindings,
      );
      const binder = this.#resolvePattern(
        { kind: "Binding", name: pattern.name, span: pattern.name.span },
        scope,
        seen,
        head,
        sharedBindings,
      );
      return {
        kind: "As",
        pattern: nested,
        binding: (binder as Resolved.BindingPattern).binding,
        span: pattern.span,
      };
    }
    if (pattern.kind === "Constructor") {
      const symbol = scope.lookup(pattern.name.text);
      if (symbol === undefined || this.#symbol(symbol).kind !== "constructor") {
        this.#diagnostics.add({
          severity: "error",
          message: `unknown constructor \`${pattern.name.text}\``,
          primary: pattern.name.span,
        });
        return { kind: "Wildcard", span: pattern.span };
      }
      return {
        kind: "Constructor",
        symbol,
        text: pattern.name.text,
        arguments: pattern.arguments.map((argument) =>
          this.#resolvePattern(argument, scope, seen, head, sharedBindings),
        ),
        span: pattern.span,
      };
    }
    if (pattern.kind === "Tuple") {
      return {
        ...pattern,
        elements: pattern.elements.map((element) =>
          this.#resolvePattern(element, scope, seen, head, sharedBindings),
        ),
      };
    }
    if (pattern.kind === "Record") {
      return {
        kind: "Record",
        fields: pattern.fields.map((field) => ({
          name: field.name.text,
          pattern: this.#resolvePattern(
            field.pattern,
            scope,
            seen,
            head,
            sharedBindings,
          ),
          span: field.span,
        })),
        span: pattern.span,
      };
    }

    const existing = scope.lookup(pattern.name.text);
    const duplicate = seen.get(pattern.name.text);
    if (duplicate !== undefined) {
      this.#diagnostics.add({
        severity: "error",
        message: `\`${pattern.name.text}\` is bound twice in this pattern`,
        primary: pattern.name.span,
        labels: [{ span: duplicate.span, message: "first binding is here" }],
      });
    } else if (sharedBindings === undefined && !head && existing !== undefined) {
      this.#reportRebinding(pattern.name, existing);
    }

    const binding = sharedBindings?.get(pattern.name.text) ??
      this.#declare(pattern.name, head ? "pattern" : "let");
    seen.set(pattern.name.text, binding);
    if (
      sharedBindings === undefined &&
      duplicate === undefined &&
      (head || existing === undefined)
    ) {
      scope.define(pattern.name.text, binding.symbol);
    }
    return { kind: "Binding", binding, span: pattern.span };
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
    if (annotation.kind === "Tuple") {
      return {
        kind: "Tuple",
        elements: annotation.elements.map((element) =>
          this.#resolveTypeAnnotation(element),
        ),
        span: annotation.span,
      };
    }
    if (annotation.kind === "Record") {
      return {
        kind: "Record",
        fields: annotation.fields.map((field) => ({
          name: field.name.text,
          annotation: this.#resolveTypeAnnotation(field.annotation),
          span: field.span,
        })),
        open: annotation.open,
        ...(annotation.tail === undefined ? {} : { tail: annotation.tail.text }),
        span: annotation.span,
      };
    }
    const union = this.#unionNames.get(annotation.name.text);
    if (union !== undefined) {
      return {
        kind: "Union",
        union,
        name: annotation.name.text,
        span: annotation.span,
      };
    }
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
        `unknown type \`${annotation.name.text}\`; this slice supports primitive, ` +
        "tuple, and declared union types",
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

/** Recognizes the one host-global operation admitted by this thin FFI slice. */
function isUnshadowedConsoleLog(
  expression: Parsed.CallExpr,
  scope: Scope,
): boolean {
  const callee = expression.callee;
  return callee.kind === "Access" &&
    callee.receiver.kind === "Name" &&
    callee.receiver.name.text === "console" &&
    callee.field.text === "log" &&
    scope.lookup("console") === undefined;
}

function isPrimitiveName(name: string): name is Resolved.PrimitiveName {
  return ["Int", "Float", "Bool", "String", "BigInt", "Unit"].includes(name);
}

function parsedPatternNames(pattern: Parsed.Pattern): Parsed.Name[] {
  switch (pattern.kind) {
    case "Binding":
      return [pattern.name];
    case "Wildcard":
    case "Unit":
    case "Boolean":
    case "Integer":
    case "String":
      return [];
    case "As":
      return [...parsedPatternNames(pattern.pattern), pattern.name];
    case "Or":
      return pattern.alternatives[0] === undefined
        ? []
        : parsedPatternNames(pattern.alternatives[0]);
    case "Tuple":
      return pattern.elements.flatMap(parsedPatternNames);
    case "Record":
      return pattern.fields.flatMap((field) => parsedPatternNames(field.pattern));
    case "Constructor":
      return pattern.arguments.flatMap(parsedPatternNames);
  }
}
