/**
 * The first checker implements the Hindley–Milner core needed by the current
 * expression grammar. Mutable union-find variables are private to inference;
 * the returned Typed tree contains only immutable types and schemes.
 */

import * as Diagnostics from "../../support/diagnostics.js";
import type * as Source from "../../support/source.js";
import type * as Resolved from "../../syntax/resolved/index.js";
import * as Typed from "../../syntax/typed/index.js";

export function check(module: Resolved.Module): Typed.Module {
  const diagnostics = new Diagnostics.Bag();
  for (const diagnostic of module.diagnostics) diagnostics.add(diagnostic);
  return new Checker(diagnostics).check(module);
}

type Mono = Variable | Constructor | FunctionMono | ErrorMono;

interface Variable {
  readonly kind: "Variable";
  readonly id: number;
  level: number;
  instance?: Mono;
  literalOnly: boolean;
  readonly requirements: Requirement[];
}

interface Constructor {
  readonly kind: "Constructor";
  readonly name: Typed.PrimitiveName;
}

interface FunctionMono {
  readonly kind: "Function";
  readonly parameters: readonly Mono[];
  readonly result: Mono;
}

interface ErrorMono {
  readonly kind: "Error";
}

interface Requirement {
  readonly name: Typed.ConstraintName;
  readonly type: Mono;
  readonly span: Source.Span;
  readonly origin: "literal" | "operation" | "interpolation";
  reported: boolean;
}

interface Scheme {
  readonly variables: readonly Variable[];
  readonly type: Mono;
}

const ERROR: ErrorMono = { kind: "Error" };

function primitive(name: Typed.PrimitiveName): Constructor {
  return { kind: "Constructor", name };
}

class Checker {
  readonly #expressionTypes = new WeakMap<Resolved.Expr, Mono>();
  readonly #requirements = new WeakMap<object, readonly Requirement[]>();
  readonly #pipeCalls = new WeakMap<Resolved.BinaryExpr, Resolved.CallExpr>();
  readonly #schemes = new Map<Resolved.SymbolId, Scheme>();
  readonly #variables: Variable[] = [];
  readonly #quantified = new Set<number>();
  readonly #diagnostics: Diagnostics.Bag;
  #nextVariable = 0;

  constructor(diagnostics: Diagnostics.Bag) {
    this.#diagnostics = diagnostics;
  }

  check(module: Resolved.Module): Typed.Module {
    this.#inferItems(module.items, 0, true);
    this.#defaultRemainingVariables();

    const symbols = module.symbols.map((symbol) => ({
      ...symbol,
      scheme: this.#publicScheme(this.#scheme(symbol.id)),
    }));

    return {
      kind: "Module",
      fileId: module.fileId,
      items: module.items.map((item) => this.#materializeItem(item)),
      symbols,
      span: module.span,
      diagnostics: this.#diagnostics.toArray(),
    };
  }

  #inferItems(
    items: readonly Resolved.Item[],
    level: number,
    moduleItems: boolean,
  ): Mono {
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      if (item === undefined) continue;

      if (item.kind === "Let") {
        const valueType = this.#inferExpr(item.value, level + 1);
        const scheme = this.#generalize(
          valueType,
          level,
          this.#isValue(item.value),
        );
        this.#schemes.set(item.binding.symbol, scheme);
        continue;
      }

      if (item.kind === "Fun") {
        // Recursive uses see this one provisional monotype. Generalization is
        // delayed until the body closes the knot, ruling out polymorphic
        // recursion without a separate special case.
        const recursiveType = this.#fresh(level + 1, false);
        this.#schemes.set(item.binding.symbol, {
          variables: [],
          type: recursiveType,
        });
        const valueType = this.#inferExpr(item.value, level + 1);
        this.#unify(recursiveType, valueType, item.span);
        this.#schemes.set(
          item.binding.symbol,
          this.#generalize(recursiveType, level, true),
        );
        continue;
      }

      if (item.kind === "ExprItem") {
        const expressionType = this.#inferExpr(item.expression, level);
        if (!moduleItems && index < items.length - 1) {
          this.#defaultDiscardedLiteral(expressionType, item.expression.span);
          this.#unify(
            expressionType,
            primitive("Unit"),
            item.expression.span,
            () =>
              `this expression's value is discarded — its type is ` +
              `${this.#display(expressionType)}; wrap it in \`ignore(...)\` if ` +
              "discarding is intentional",
          );
        }
      }
    }

    if (moduleItems) return primitive("Unit");
    const finalItem = items.at(-1);
    if (finalItem === undefined || finalItem.kind === "ErrorItem") return ERROR;
    if (finalItem.kind === "Let" || finalItem.kind === "Fun") {
      const keyword = finalItem.kind === "Let" ? "let" : "fun";
      this.#diagnostics.add({
        severity: "error",
        message:
          `a block cannot end with a \`${keyword}\`; did you mean to return ` +
          `\`${finalItem.binding.name}\`?`,
        primary: finalItem.span,
      });
      return ERROR;
    }
    return this.#typeOf(finalItem.expression);
  }

  #inferExpr(expression: Resolved.Expr, level: number): Mono {
    let type: Mono;
    switch (expression.kind) {
      case "Name":
        type = this.#instantiate(this.#scheme(expression.symbol), level);
        break;
      case "Unit":
        type = primitive("Unit");
        break;
      case "Boolean":
        type = primitive("Bool");
        break;
      case "Integer": {
        type = this.#fresh(level, true);
        const requirement = this.#require("Num", type, expression.span, "literal");
        this.#requirements.set(expression, [requirement]);
        break;
      }
      case "BigInt":
        type = primitive("BigInt");
        break;
      case "Float":
        type = primitive("Float");
        break;
      case "String":
        for (const part of expression.parts) {
          if (part.kind === "Interpolation") {
            const partType = this.#inferExpr(part.expression, level);
            const requirement = this.#require(
              "Show",
              partType,
              part.span,
              "interpolation",
            );
            this.#requirements.set(part, [requirement]);
          }
        }
        type = primitive("String");
        break;
      case "Group":
        type = this.#inferExpr(expression.expression, level);
        break;
      case "Block":
        type = this.#inferItems(expression.items, level, false);
        break;
      case "Lambda": {
        const parameters = expression.parameters.map((parameter) => {
          const parameterType = parameter.annotation === undefined
            ? this.#fresh(level + 1, false)
            : this.#annotationType(parameter.annotation);
          this.#schemes.set(parameter.symbol, {
            variables: [],
            type: parameterType,
          });
          return parameterType;
        });
        const result = this.#inferExpr(expression.body, level + 1);
        if (expression.returnAnnotation !== undefined) {
          this.#unify(
            this.#annotationType(expression.returnAnnotation),
            result,
            expression.returnAnnotation.span,
          );
        }
        type = { kind: "Function", parameters, result };
        break;
      }
      case "If": {
        const condition = this.#inferExpr(expression.condition, level);
        this.#unify(condition, primitive("Bool"), expression.condition.span);
        const consequence = this.#inferExpr(expression.consequence, level);
        if (expression.alternative === undefined) {
          this.#unify(consequence, primitive("Unit"), expression.consequence.span);
          type = primitive("Unit");
        } else {
          const alternative = this.#inferExpr(expression.alternative, level);
          this.#unify(consequence, alternative, expression.span);
          type = consequence;
        }
        break;
      }
      case "Call": {
        const callee = this.#inferExpr(expression.callee, level);
        const arguments_ = expression.arguments.map((argument) =>
          this.#inferExpr(argument, level),
        );
        const result = this.#fresh(level, false);
        const knownCallee = this.#prune(callee);
        if (
          knownCallee.kind === "Function" &&
          knownCallee.parameters.length !== arguments_.length
        ) {
          this.#diagnostics.add({
            severity: "error",
            message:
              `function expects ${knownCallee.parameters.length} arguments, got ` +
              `${arguments_.length}`,
            primary: expression.span,
          });
          type = ERROR;
        } else {
          this.#unify(
            callee,
            { kind: "Function", parameters: arguments_, result },
            expression.span,
          );
          type = result;
        }
        break;
      }
      case "Unary": {
        const operand = this.#inferExpr(expression.operand, level);
        if (expression.operator === "Not") {
          this.#unify(operand, primitive("Bool"), expression.span);
          type = primitive("Bool");
          this.#requirements.set(expression, []);
        } else {
          const requirement = this.#require("Num", operand, expression.span);
          this.#requirements.set(expression, [requirement]);
          type = operand;
        }
        break;
      }
      case "Binary":
        type = this.#inferBinary(expression, level);
        break;
      case "Comparison": {
        const operands = expression.operands.map((operand) =>
          this.#inferExpr(operand, level),
        );
        const common = operands[0] ?? ERROR;
        for (const operand of operands.slice(1)) {
          this.#unify(common, operand, expression.span);
        }
        const requirements = expression.operators.map((operator) =>
          this.#require(
            operator === "Equal" || operator === "NotEqual" ? "Eq" : "Ord",
            common,
            expression.span,
          ),
        );
        this.#requirements.set(expression, requirements);
        type = primitive("Bool");
        break;
      }
      case "Assignment": {
        const target = this.#inferExpr(expression.target, level);
        const value = this.#inferExpr(expression.value, level);
        this.#unify(target, value, expression.span);
        this.#diagnostics.add({
          severity: "error",
          message: "assignment requires a `var` binding",
          primary: expression.target.span,
        });
        type = primitive("Unit");
        break;
      }
      case "Access":
        this.#inferExpr(expression.receiver, level);
        type = this.#unsupported(expression.span, "field access requires row typing");
        break;
      case "Index":
        this.#inferExpr(expression.receiver, level);
        this.#inferExpr(expression.index, level);
        type = this.#unsupported(expression.span, "indexing is not in the first checker slice");
        break;
      case "ErrorExpr":
        type = ERROR;
        break;
    }

    this.#expressionTypes.set(expression, type);
    return type;
  }

  #inferBinary(expression: Resolved.BinaryExpr, level: number): Mono {
    if (expression.operator === "Pipe") {
      const call = rewritePipe(expression);
      this.#pipeCalls.set(expression, call);
      return this.#inferExpr(call, level);
    }

    const left = this.#inferExpr(expression.left, level);
    const right = this.#inferExpr(expression.right, level);

    if (["And", "Or", "Implies", "Iff"].includes(expression.operator)) {
      this.#unify(left, primitive("Bool"), expression.left.span);
      this.#unify(right, primitive("Bool"), expression.right.span);
      this.#requirements.set(expression, []);
      return primitive("Bool");
    }

    if (expression.operator === "Range") {
      this.#unify(left, primitive("Int"), expression.left.span);
      this.#unify(right, primitive("Int"), expression.right.span);
      return this.#unsupported(expression.span, "range types are not in the first checker slice");
    }
    this.#unify(left, right, expression.span);
    const constraint: Typed.ConstraintName =
      expression.operator === "Divide"
        ? "Frac"
        : expression.operator === "Power"
          ? "Pow"
          : expression.operator === "Concat"
            ? "Concat"
            : "Num";
    const requirement = this.#require(constraint, left, expression.span);
    this.#requirements.set(expression, [requirement]);
    return left;
  }

  #fresh(level: number, literalOnly: boolean): Variable {
    const variable: Variable = {
      kind: "Variable",
      id: this.#nextVariable++,
      level,
      literalOnly,
      requirements: [],
    };
    this.#variables.push(variable);
    return variable;
  }

  #prune(type: Mono): Mono {
    if (type.kind !== "Variable" || type.instance === undefined) return type;
    type.instance = this.#prune(type.instance);
    return type.instance;
  }

  #unify(
    left: Mono,
    right: Mono,
    span: Source.Span,
    message?: () => string,
  ): void {
    const actualLeft = this.#prune(left);
    const actualRight = this.#prune(right);
    if (actualLeft === actualRight || actualLeft.kind === "Error" || actualRight.kind === "Error") return;

    if (actualLeft.kind === "Variable") {
      this.#bind(actualLeft, actualRight, span);
      return;
    }
    if (actualRight.kind === "Variable") {
      this.#bind(actualRight, actualLeft, span);
      return;
    }
    if (actualLeft.kind === "Constructor" && actualRight.kind === "Constructor") {
      if (actualLeft.name === actualRight.name) return;
    } else if (actualLeft.kind === "Function" && actualRight.kind === "Function") {
      if (actualLeft.parameters.length !== actualRight.parameters.length) {
        this.#diagnostics.add({
          severity: "error",
          message:
            `function arity mismatch: ${actualLeft.parameters.length} and ` +
            `${actualRight.parameters.length}`,
          primary: span,
        });
        return;
      }
      actualLeft.parameters.forEach((parameter, index) => {
        const other = actualRight.parameters[index];
        if (other !== undefined) this.#unify(parameter, other, span);
      });
      this.#unify(actualLeft.result, actualRight.result, span);
      return;
    }

    this.#diagnostics.add({
      severity: "error",
      message:
        message?.() ??
        `type mismatch: expected ${this.#display(actualLeft)}, found ` +
          this.#display(actualRight),
      primary: span,
    });
  }

  #bind(variable: Variable, type: Mono, span: Source.Span): void {
    if (type.kind === "Variable") {
      type.level = Math.min(type.level, variable.level);
      type.literalOnly &&= variable.literalOnly;
      type.requirements.push(...variable.requirements);
      variable.instance = type;
      return;
    }
    if (this.#occurs(variable, type)) {
      this.#diagnostics.add({
        severity: "error",
        message: "infinite type: a type variable occurs inside itself",
        primary: span,
      });
      variable.instance = ERROR;
      return;
    }
    variable.instance = type;
    for (const requirement of variable.requirements) this.#validate(requirement);
  }

  #occurs(variable: Variable, type: Mono): boolean {
    const actual = this.#prune(type);
    if (actual === variable) return true;
    if (actual.kind !== "Function") return false;
    return (
      actual.parameters.some((parameter) => this.#occurs(variable, parameter)) ||
      this.#occurs(variable, actual.result)
    );
  }

  #require(
    name: Typed.ConstraintName,
    type: Mono,
    span: Source.Span,
    origin: Requirement["origin"] = "operation",
  ): Requirement {
    const requirement: Requirement = {
      name,
      type,
      span,
      origin,
      reported: false,
    };
    const actual = this.#prune(type);
    if (actual.kind === "Variable") actual.requirements.push(requirement);
    else this.#validate(requirement);
    return requirement;
  }

  #validate(requirement: Requirement): void {
    if (requirement.reported) return;
    const type = this.#prune(requirement.type);
    if (type.kind === "Variable" || type.kind === "Error") return;
    if (type.kind === "Constructor" && supports(type.name, requirement.name)) return;

    requirement.reported = true;
    this.#diagnostics.add({
      severity: "error",
      message:
        requirement.origin === "literal" && type.kind === "Constructor"
          ? `integer literal cannot have type \`${type.name}\``
          : type.kind === "Function"
          ? `functions have no \`${requirement.name}\` instance`
          : `type \`${this.#display(type)}\` has no \`${requirement.name}\` instance`,
      primary: requirement.span,
    });
  }

  #generalize(type: Mono, level: number, allow: boolean): Scheme {
    let variables = this.#collectVariables(type).filter(
      (variable) => variable.level > level,
    );
    const inputVariables = this.#inputVariables(type);
    for (const variable of variables) {
      if (
        !inputVariables.has(variable.id) &&
        variable.requirements.length > 0 &&
        variable.requirements.every(({ name }) =>
          ["Num", "Eq", "Ord", "Show"].includes(name),
        )
      ) {
        this.#bind(variable, primitive("Int"), variable.requirements[0]!.span);
      }
    }
    variables = this.#collectVariables(type).filter(
      (variable) => variable.level > level,
    );
    if (!allow) {
      for (const variable of variables) variable.level = level;
      variables = [];
    }
    for (const variable of variables) this.#quantified.add(variable.id);
    return { variables, type };
  }

  #defaultRemainingVariables(): void {
    const seen = new Set<number>();
    for (const variable of this.#variables) {
      const actual = this.#prune(variable);
      if (
        actual.kind !== "Variable" ||
        seen.has(actual.id) ||
        this.#quantified.has(actual.id)
      ) {
        continue;
      }
      seen.add(actual.id);
      if (
        actual.requirements.length > 0 &&
        actual.requirements.every(({ name }) =>
          ["Num", "Eq", "Ord", "Show"].includes(name),
        )
      ) {
        this.#bind(actual, primitive("Int"), actual.requirements[0]!.span);
      }
    }
  }

  #inputVariables(type: Mono, found = new Set<number>()): Set<number> {
    const actual = this.#prune(type);
    if (actual.kind !== "Function") return found;
    for (const parameter of actual.parameters) {
      for (const variable of this.#collectVariables(parameter)) {
        found.add(variable.id);
      }
    }
    this.#inputVariables(actual.result, found);
    return found;
  }

  #defaultDiscardedLiteral(type: Mono, span: Source.Span): void {
    const actual = this.#prune(type);
    if (
      actual.kind === "Variable" &&
      actual.requirements.length > 0 &&
      actual.requirements.every(({ name }) =>
        ["Num", "Eq", "Ord", "Show"].includes(name),
      ) &&
      actual.requirements.some(({ name }) => !supports("Unit", name))
    ) {
      this.#bind(actual, primitive("Int"), span);
    }
  }

  #collectVariables(type: Mono, found = new Map<number, Variable>()): Variable[] {
    const actual = this.#prune(type);
    if (actual.kind === "Variable") found.set(actual.id, actual);
    if (actual.kind === "Function") {
      for (const parameter of actual.parameters) this.#collectVariables(parameter, found);
      this.#collectVariables(actual.result, found);
    }
    return [...found.values()];
  }

  #instantiate(scheme: Scheme, level: number): Mono {
    const replacements = new Map<number, Variable>();
    for (const variable of scheme.variables) {
      replacements.set(variable.id, this.#fresh(level, variable.literalOnly));
    }
    const copy = (type: Mono): Mono => {
      const actual = this.#prune(type);
      if (actual.kind === "Variable") {
        const replacement = replacements.get(actual.id);
        if (replacement === undefined) return actual;
        for (const requirement of actual.requirements) {
          this.#require(
            requirement.name,
            replacement,
            requirement.span,
            requirement.origin,
          );
        }
        return replacement;
      }
      if (actual.kind === "Function") {
        return {
          kind: "Function",
          parameters: actual.parameters.map(copy),
          result: copy(actual.result),
        };
      }
      return actual;
    };
    return copy(scheme.type);
  }

  #unsupported(span: Source.Span, message: string): ErrorMono {
    this.#diagnostics.add({ severity: "error", message, primary: span });
    return ERROR;
  }

  #annotationType(annotation: Resolved.TypeAnnotation): Mono {
    return annotation.kind === "Primitive"
      ? primitive(annotation.name)
      : ERROR;
  }

  #scheme(symbol: Resolved.SymbolId): Scheme {
    return this.#schemes.get(symbol) ?? { variables: [], type: ERROR };
  }

  #typeOf(expression: Resolved.Expr): Mono {
    return this.#expressionTypes.get(expression) ?? ERROR;
  }

  #isValue(expression: Resolved.Expr): boolean {
    switch (expression.kind) {
      case "Unit":
      case "Boolean":
      case "Integer":
      case "BigInt":
      case "Float":
      case "Lambda":
        return true;
      case "String":
        return expression.parts.every(({ kind }) => kind === "Text");
      case "Group":
        return this.#isValue(expression.expression);
      default:
        return false;
    }
  }

  #publicType(type: Mono, seen = new Map<number, Typed.VariableType>()): Typed.Type {
    const actual = this.#prune(type);
    if (actual.kind === "Error") return { kind: "Error" };
    if (actual.kind === "Constructor") return { kind: "Primitive", name: actual.name };
    if (actual.kind === "Function") {
      return {
        kind: "Function",
        parameters: actual.parameters.map((parameter) => this.#publicType(parameter, seen)),
        result: this.#publicType(actual.result, seen),
      };
    }
    const existing = seen.get(actual.id);
    if (existing !== undefined) return existing;
    const variable: Typed.VariableType = {
      kind: "Variable",
      id: Typed.typeVariableId(actual.id),
    };
    seen.set(actual.id, variable);
    return variable;
  }

  #publicRequirement(requirement: Requirement): Typed.Constraint {
    return {
      name: requirement.name,
      type: this.#publicType(requirement.type),
      span: requirement.span,
    };
  }

  #publicScheme(scheme: Scheme): Typed.Scheme {
    const variables = scheme.variables
      .map((variable) => this.#prune(variable))
      .filter((type): type is Variable => type.kind === "Variable");
    const constraints = new Map<string, Typed.Constraint>();
    for (const variable of variables) {
      for (const requirement of variable.requirements) {
        const constraint = this.#publicRequirement(requirement);
        constraints.set(`${constraint.name}:${variable.id}`, constraint);
      }
    }
    return {
      variables: variables.map(({ id }) => Typed.typeVariableId(id)),
      constraints: [...constraints.values()],
      type: this.#publicType(scheme.type),
    };
  }

  #materializeItem(item: Resolved.Item): Typed.Item {
    if (item.kind === "ErrorItem") return item;
    if (item.kind === "ExprItem") {
      return { ...item, expression: this.#materializeExpr(item.expression) };
    }
    const scheme = this.#publicScheme(this.#scheme(item.binding.symbol));
    return item.kind === "Fun"
      ? {
          kind: "Fun",
          exported: item.exported,
          binding: { ...item.binding, scheme },
          value: this.#materializeLambda(item.value),
          span: item.span,
        }
      : {
          kind: "Let",
          exported: item.exported,
          binding: { ...item.binding, scheme },
          value: this.#materializeExpr(item.value),
          span: item.span,
        };
  }

  #materializeExpr(expression: Resolved.Expr): Typed.Expr {
    const type = this.#publicType(this.#typeOf(expression));
    switch (expression.kind) {
      case "Name":
      case "Unit":
      case "Boolean":
      case "BigInt":
      case "Float":
      case "ErrorExpr":
        return { ...expression, type };
      case "Integer":
        return {
          kind: "FromInt",
          decimal: expression.decimal,
          requirement: this.#publicRequirement(this.#requirements.get(expression)![0]!),
          type,
          span: expression.span,
        };
      case "String":
        return {
          ...expression,
          type,
          parts: expression.parts.map((part) =>
            part.kind === "Text"
              ? part
              : {
                  ...part,
                  expression: this.#materializeExpr(part.expression),
                  requirement: this.#publicRequirement(this.#requirements.get(part)![0]!),
                },
          ),
        };
      case "Group":
        return { ...expression, type, expression: this.#materializeExpr(expression.expression) };
      case "Block":
        return { ...expression, type, items: expression.items.map((item) => this.#materializeItem(item)) };
      case "Lambda":
        return this.#materializeLambda(expression);
      case "If": {
        const common = {
          kind: "If" as const,
          condition: this.#materializeExpr(expression.condition),
          consequence: this.#materializeExpr(expression.consequence),
          type,
          span: expression.span,
        };
        return expression.alternative === undefined
          ? common
          : { ...common, alternative: this.#materializeExpr(expression.alternative) };
      }
      case "Call":
        return {
          ...expression,
          type,
          callee: this.#materializeExpr(expression.callee),
          arguments: expression.arguments.map((argument) => this.#materializeExpr(argument)),
        };
      case "Access":
        return { ...expression, type, receiver: this.#materializeExpr(expression.receiver) };
      case "Index":
        return {
          ...expression,
          type,
          receiver: this.#materializeExpr(expression.receiver),
          index: this.#materializeExpr(expression.index),
        };
      case "Unary":
        if (expression.operator === "Not") {
          return {
            kind: "LogicalNot",
            operand: this.#materializeExpr(expression.operand),
            type,
            span: expression.span,
          };
        }
        return this.#materializeConstraintCall(
          expression,
          "Num",
          "negate",
          [expression.operand],
        );
      case "Binary":
        return this.#materializeBinary(expression, type);
      case "Comparison":
        return {
          kind: "ComparisonChain",
          type,
          operands: expression.operands.map((operand) => this.#materializeExpr(operand)),
          steps: expression.operators.map((test, index) => ({
            test,
            requirement: this.#publicRequirement(
              this.#requirements.get(expression)?.[index]!,
            ),
            span: expression.span,
          })),
          span: expression.span,
        };
      case "Assignment":
        return {
          ...expression,
          type,
          target: this.#materializeExpr(expression.target),
          value: this.#materializeExpr(expression.value),
        };
    }
  }

  #materializeLambda(expression: Resolved.LambdaExpr): Typed.LambdaExpr {
    return {
      kind: "Lambda",
      type: this.#publicType(this.#typeOf(expression)),
      parameters: expression.parameters.map((parameter) => ({
        symbol: parameter.symbol,
        name: parameter.name,
        span: parameter.span,
        scheme: this.#publicScheme(this.#scheme(parameter.symbol)),
      })),
      body: this.#materializeExpr(expression.body),
      span: expression.span,
    };
  }

  #materializeBinary(
    expression: Resolved.BinaryExpr,
    type: Typed.Type,
  ): Typed.Expr {
    if (expression.operator === "Pipe") {
      const call = this.#pipeCalls.get(expression);
      return call === undefined
        ? { kind: "ErrorExpr", type, span: expression.span }
        : this.#materializeExpr(call);
    }

    const left = this.#materializeExpr(expression.left);
    const right = this.#materializeExpr(expression.right);
    if (expression.operator === "And" || expression.operator === "Or") {
      return {
        kind: "Logical",
        operation: expression.operator,
        left,
        right,
        type,
        span: expression.span,
      };
    }
    if (expression.operator === "Implies") {
      return {
        kind: "Logical",
        operation: "Or",
        left: {
          kind: "LogicalNot",
          operand: left,
          type: this.#publicType(this.#typeOf(expression.left)),
          span: expression.left.span,
        },
        right,
        type,
        span: expression.span,
      };
    }
    if (expression.operator === "Iff") {
      const bool: Typed.PrimitiveType = { kind: "Primitive", name: "Bool" };
      return {
        kind: "ComparisonChain",
        operands: [left, right],
        steps: [
          {
            test: "Equal",
            requirement: { name: "Eq", type: bool, span: expression.span },
            span: expression.span,
          },
        ],
        type,
        span: expression.span,
      };
    }

    const details: Partial<
      Record<
        Resolved.BinaryOperator,
        readonly [Typed.ConstraintName, Typed.ConstraintMember]
      >
    > = {
      Power: ["Pow", "pow"],
      Multiply: ["Num", "multiply"],
      Divide: ["Frac", "divide"],
      Add: ["Num", "add"],
      Subtract: ["Num", "subtract"],
      Concat: ["Concat", "concat"],
    };
    const detail = details[expression.operator];
    return detail === undefined
      ? { kind: "ErrorExpr", type, span: expression.span }
      : this.#materializeConstraintCall(
          expression,
          detail[0],
          detail[1],
          [expression.left, expression.right],
        );
  }

  #materializeConstraintCall(
    expression: Resolved.Expr,
    constraint: Typed.ConstraintName,
    member: Typed.ConstraintMember,
    arguments_: readonly Resolved.Expr[],
  ): Typed.ConstraintCallExpr {
    const requirement = this.#requirements.get(expression)?.[0];
    return {
      kind: "ConstraintCall",
      constraint,
      member,
      requirement:
        requirement === undefined
          ? { name: constraint, type: { kind: "Error" }, span: expression.span }
          : this.#publicRequirement(requirement),
      arguments: arguments_.map((argument) => this.#materializeExpr(argument)),
      type: this.#publicType(this.#typeOf(expression)),
      span: expression.span,
    };
  }

  #display(type: Mono): string {
    const actual = this.#prune(type);
    if (actual.kind === "Error") return "<error>";
    if (actual.kind === "Constructor") return actual.name;
    if (actual.kind === "Variable") return `?${actual.id}`;
    return (
      `(${actual.parameters.map((parameter) => this.#display(parameter)).join(", ")})` +
      ` -> ${this.#display(actual.result)}`
    );
  }
}

/** Rewrites first-argument pipe insertion before either side is inferred. */
function rewritePipe(expression: Resolved.BinaryExpr): Resolved.CallExpr {
  return expression.right.kind === "Call"
    ? {
        kind: "Call",
        callee: expression.right.callee,
        arguments: [expression.left, ...expression.right.arguments],
        span: expression.span,
      }
    : {
        kind: "Call",
        callee: expression.right,
        arguments: [expression.left],
        span: expression.span,
      };
}

function supports(
  type: Typed.PrimitiveName,
  constraint: Typed.ConstraintName,
): boolean {
  const instances: Record<Typed.PrimitiveName, readonly Typed.ConstraintName[]> = {
    Int: ["Num", "Eq", "Ord", "Show", "Pow"],
    Float: ["Num", "Frac", "Eq", "Ord", "Show", "Pow"],
    Bool: ["Eq", "Ord", "Show"],
    String: ["Eq", "Ord", "Show", "Concat"],
    BigInt: ["Num", "Eq", "Ord", "Show", "Pow"],
    Unit: ["Eq", "Ord", "Show"],
  };
  return instances[type].includes(constraint);
}
