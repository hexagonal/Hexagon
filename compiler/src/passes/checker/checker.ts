/**
 * The checker implements the Hindley–Milner core needed by the current vertical
 * slices. Mutable union-find variables are private to inference;
 * the returned Typed tree contains only immutable types and schemes.
 */

import * as Diagnostics from "../../support/diagnostics.js";
import type * as Source from "../../support/source.js";
import * as Resolved from "../../syntax/resolved/index.js";
import * as Typed from "../../syntax/typed/index.js";

export function check(module: Resolved.Module): Typed.Module {
  const diagnostics = new Diagnostics.Bag();
  for (const diagnostic of module.diagnostics) diagnostics.add(diagnostic);
  return new Checker(diagnostics).check(module);
}

type Mono =
  | Variable
  | Constructor
  | TupleMono
  | RecordMono
  | UnionMono
  | FunctionMono
  | ErrorMono;

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

interface TupleMono {
  readonly kind: "Tuple";
  readonly elements: readonly Mono[];
}

interface RecordMono {
  readonly kind: "Record";
  readonly fields: ReadonlyMap<string, Mono>;
  readonly tail?: Variable;
}

interface UnionMono {
  readonly kind: "Union";
  readonly union: Resolved.UnionId;
  readonly name: string;
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
  readonly #tupleAccesses = new WeakMap<Resolved.AccessExpr, number>();
  readonly #recordAccesses = new WeakMap<Resolved.AccessExpr, string>();
  readonly #matchUnions = new WeakMap<Resolved.MatchExpr, Resolved.UnionId>();
  readonly #schemes = new Map<Resolved.SymbolId, Scheme>();
  readonly #unions = new Map<Resolved.UnionId, Resolved.Union>();
  readonly #constructorUnions = new Map<Resolved.SymbolId, Resolved.UnionId>();
  readonly #variables: Variable[] = [];
  readonly #quantified = new Set<number>();
  readonly #diagnostics: Diagnostics.Bag;
  #nextVariable = 0;

  constructor(diagnostics: Diagnostics.Bag) {
    this.#diagnostics = diagnostics;
  }

  check(module: Resolved.Module): Typed.Module {
    for (const union of module.unions) {
      this.#unions.set(union.id, union);
      const type: UnionMono = {
        kind: "Union",
        union: union.id,
        name: union.name,
      };
      for (const constructor of union.constructors) {
        this.#constructorUnions.set(constructor.binding.symbol, union.id);
        const parameters = constructor.slots.map((slot) =>
          this.#annotationType(slot.annotation)
        );
        this.#schemes.set(constructor.binding.symbol, {
          variables: [],
          type: parameters.length === 0
            ? type
            : { kind: "Function", parameters, result: type },
        });
      }
    }
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
      unions: module.unions.map((union) => this.#materializeUnion(union)),
      comments: module.comments,
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
        if (item.annotation !== undefined) {
          this.#unify(
            this.#annotationType(item.annotation, level + 1),
            valueType,
            item.annotation.span,
          );
        }
        const scheme = this.#generalize(
          valueType,
          level,
          this.#isValue(item.value),
        );
        this.#schemes.set(item.binding.symbol, scheme);
        continue;
      }

      if (item.kind === "LetPattern") {
        const valueType = this.#inferExpr(item.value, level + 1);
        this.#inferPattern(
          item.pattern,
          valueType,
          level,
          this.#isValue(item.value),
        );
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
    if (
      finalItem.kind === "Let" ||
      finalItem.kind === "LetPattern" ||
      finalItem.kind === "Fun" ||
      finalItem.kind === "Union"
    ) {
      if (finalItem.kind === "LetPattern") {
        this.#diagnostics.add({
          severity: "error",
          message: "a block cannot end with a `let` pattern; add a final expression",
          primary: finalItem.span,
        });
        return ERROR;
      }
      if (finalItem.kind === "Union") {
        this.#diagnostics.add({
          severity: "error",
          message: "a union declaration is only allowed at module level",
          primary: finalItem.span,
        });
        return ERROR;
      }
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
      case "Tuple":
        type = {
          kind: "Tuple",
          elements: expression.elements.map((element) =>
            this.#inferExpr(element, level),
          ),
        };
        break;
      case "Record":
        if (expression.spread === undefined) {
          type = {
            kind: "Record",
            fields: new Map(expression.fields.map((field) => [
              field.name.text,
              this.#inferExpr(field.value, level),
            ])),
          };
        } else {
          const receiver = this.#inferExpr(expression.spread, level);
          const overrides = new Map(expression.fields.map((field) => [
            field.name.text,
            this.#inferExpr(field.value, level),
          ]));
          const actual = this.#prune(receiver);
          if (actual.kind === "Record") {
            for (const [name, override] of overrides) {
              const existing = actual.fields.get(name);
              if (existing === undefined) {
                this.#diagnostics.add({
                  severity: "error",
                  message: `record update cannot add fields; the input has no field \`${name}\``,
                  primary: expression.span,
                });
              } else {
                this.#unify(existing, override, expression.span);
              }
            }
          } else {
            this.#unify(receiver, {
              kind: "Record",
              fields: overrides,
              tail: this.#fresh(level, false),
            }, expression.span);
          }
          type = receiver;
        }
        break;
      case "Group":
        type = this.#inferExpr(expression.expression, level);
        break;
      case "Block":
        type = this.#inferItems(expression.items, level, false);
        break;
      case "Lambda": {
        const annotationTails = new Map<string, Variable>();
        const parameters = expression.parameters.map((parameter) => {
          const parameterType = parameter.annotation === undefined
            ? this.#fresh(level + 1, false)
            : this.#annotationType(parameter.annotation, level + 1, annotationTails);
          this.#schemes.set(parameter.symbol, {
            variables: [],
            type: parameterType,
          });
          return parameterType;
        });
        const result = this.#inferExpr(expression.body, level + 1);
        if (expression.returnAnnotation !== undefined) {
          this.#unify(
            this.#annotationType(expression.returnAnnotation, level + 1, annotationTails),
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
      case "Match": {
        const scrutinee = this.#inferExpr(expression.scrutinee, level);
        const result = this.#fresh(level, false);
        let catchAll = false;
        const coveredConstructors = new Set<Resolved.SymbolId>();
        const constructorPatterns = new Map<
          Resolved.SymbolId,
          Resolved.ConstructorPattern[]
        >();
        const coveredLiterals = new Set<string>();
        const coveredBooleans = new Set<boolean>();
        for (const arm of expression.arms) {
          if (catchAll) {
            this.#diagnostics.add({
              severity: "error",
              message: "this match arm is unreachable; an earlier pattern matches everything",
              primary: arm.pattern.span,
            });
          }
          const guarded = arm.guard !== undefined;
          let armCatchesAll = false;
          const armConstructors: Resolved.ConstructorPattern[] = [];
          for (const coveragePattern of coverageAlternatives(arm.pattern)) {
            if (coveragePattern.kind === "Constructor") {
              if (coveredConstructors.has(coveragePattern.symbol)) {
                this.#diagnostics.add({
                  severity: "error",
                  message: `this case is unreachable; \`${coveragePattern.text}\` is already handled above`,
                  primary: coveragePattern.span,
                });
              }
              if (!guarded) armConstructors.push(coveragePattern);
            } else if (
              coveragePattern.kind === "Boolean" ||
              coveragePattern.kind === "Integer" ||
              coveragePattern.kind === "String"
            ) {
              const key = renderLiteralPatternKey(coveragePattern);
              if (coveredLiterals.has(key)) {
                this.#diagnostics.add({
                  severity: "error",
                  message: "this literal case is unreachable; it is already handled above",
                  primary: coveragePattern.span,
                });
              }
              if (!guarded) {
                coveredLiterals.add(key);
                if (coveragePattern.kind === "Boolean") {
                  coveredBooleans.add(coveragePattern.value);
                }
              }
            } else if (isStructurallyIrrefutablePattern(coveragePattern)) {
              armCatchesAll = true;
            }
          }
          for (const pattern of armConstructors) {
            const patterns = constructorPatterns.get(pattern.symbol) ?? [];
            patterns.push(pattern);
            constructorPatterns.set(pattern.symbol, patterns);
            if (this.#constructorPatternsAreExhaustive(patterns)) {
              coveredConstructors.add(pattern.symbol);
            }
          }
          if (!guarded && armCatchesAll) catchAll = true;
          this.#inferMatchPattern(arm.pattern, scrutinee, level);
          if (arm.guard !== undefined) {
            const guard = this.#inferExpr(arm.guard, level);
            this.#unify(guard, primitive("Bool"), arm.guard.span);
          }
          this.#unify(result, this.#inferExpr(arm.body, level), arm.body.span);
        }
        const actual = this.#prune(scrutinee);
        if (actual.kind === "Union") {
          this.#matchUnions.set(expression, actual.union);
          if (!catchAll) {
            const union = this.#unions.get(actual.union);
            const missing = union?.constructors.filter(
              ({ binding }) => !coveredConstructors.has(binding.symbol),
            ) ?? [];
            if (missing.length > 0) {
              this.#diagnostics.add({
                severity: "error",
                message:
                  "match is missing cases: " +
                  missing.map(({ binding }) => `\`${binding.name}\``).join(", "),
                primary: expression.span,
              });
            }
          }
        } else if (actual.kind === "Constructor" && actual.name === "Bool") {
          if (!catchAll && coveredBooleans.size < 2) {
            const missing = coveredBooleans.has(true) ? "false" : "true";
            this.#diagnostics.add({
              severity: "error",
              message: `match is missing case \`${missing}\``,
              primary: expression.span,
            });
          }
        } else if (
          actual.kind === "Constructor" &&
          (actual.name === "Int" || actual.name === "String")
        ) {
          if (!catchAll) {
            this.#diagnostics.add({
              severity: "error",
              message: `a match on \`${actual.name}\` needs a catch-all pattern`,
              primary: expression.span,
            });
          }
        } else if (
          (actual.kind === "Constructor" && actual.name === "Unit") ||
          actual.kind === "Tuple" ||
          actual.kind === "Record"
        ) {
          if (!catchAll) {
            this.#diagnostics.add({
              severity: "error",
              message: `match on \`${this.#display(actual)}\` needs a catch-all structural pattern`,
              primary: expression.span,
            });
          }
        } else {
          type = this.#unsupported(
            expression.scrutinee.span,
            actual.kind === "Variable"
              ? "cannot match on a value of abstract type; use the operations its constraints provide"
              : `cannot match on \`${this.#display(actual)}\` yet`,
          );
          break;
        }
        type = result;
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
      case "ConsoleLog":
        for (const argument of expression.arguments) {
          this.#inferExpr(argument, level);
        }
        type = primitive("Unit");
        break;
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
      case "Access": {
        const inferredReceiver = this.#prune(this.#inferExpr(expression.receiver, level));
        const receiver = inferredReceiver.kind === "Record"
          ? this.#normalizeRecord(inferredReceiver)
          : inferredReceiver;
        if (receiver.kind === "Record") {
          const field = receiver.fields.get(expression.field.text);
          if (field !== undefined) {
            type = field;
            this.#recordAccesses.set(expression, expression.field.text);
            break;
          }
          if (receiver.tail === undefined) {
            const known = [...receiver.fields.keys()];
            type = this.#unsupported(
              expression.field.span,
              known.length === 0
                ? `the empty record has no field \`${expression.field.text}\``
                : `record has fields ${known.map((name) => `\`${name}\``).join(", ")}, not \`${expression.field.text}\``,
            );
            break;
          }
          type = this.#fresh(level, false);
          this.#unify(receiver, {
            kind: "Record",
            fields: new Map([[expression.field.text, type]]),
            tail: this.#fresh(level, false),
          }, expression.span);
          this.#recordAccesses.set(expression, expression.field.text);
          break;
        }
        const item = /^item(\d+)$/.exec(expression.field.text);
        if (item === null) {
          type = this.#fresh(level, false);
          const tail = this.#fresh(level, false);
          this.#unify(receiver, {
            kind: "Record",
            fields: new Map([[expression.field.text, type]]),
            tail,
          }, expression.span);
          this.#recordAccesses.set(expression, expression.field.text);
          break;
        }
        const position = Number(item[1]);
        if (!Number.isSafeInteger(position) || position < 1) {
          type = this.#unsupported(
            expression.field.span,
            "tuple components are numbered from 1",
          );
          break;
        }
        if (receiver.kind === "Variable") {
          type = this.#unsupported(
            expression.receiver.span,
            "tuple access needs a known tuple type; add a tuple annotation",
          );
          break;
        }
        if (receiver.kind !== "Tuple") {
          type = receiver.kind === "Error"
            ? ERROR
            : this.#unsupported(
                expression.receiver.span,
                `\`${this.#display(receiver)}\` is not a tuple`,
              );
          break;
        }
        if (position > receiver.elements.length) {
          type = this.#unsupported(
            expression.field.span,
            `this tuple has ${receiver.elements.length} components; there is no ` +
              `item${position}`,
          );
          break;
        }
        const index = position - 1;
        this.#tupleAccesses.set(expression, index);
        type = receiver.elements[index]!;
        break;
      }
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

  #inferPattern(
    pattern: Resolved.Pattern,
    expected: Mono,
    level: number,
    generalizable: boolean,
  ): void {
    if (pattern.kind === "Wildcard") return;
    if (pattern.kind === "Unit") {
      this.#unify(expected, primitive("Unit"), pattern.span);
      return;
    }
    if (pattern.kind === "Binding") {
      this.#schemes.set(
        pattern.binding.symbol,
        this.#generalize(expected, level, generalizable),
      );
      return;
    }
    if (pattern.kind === "As") {
      this.#inferPattern(pattern.pattern, expected, level, generalizable);
      this.#schemes.set(
        pattern.binding.symbol,
        this.#generalize(expected, level, generalizable),
      );
      return;
    }
    if (pattern.kind === "Or") {
      this.#inferMatchPattern(pattern, expected, level);
      for (const binding of resolvedPatternBindings(pattern)) {
        this.#schemes.set(
          binding.symbol,
          this.#generalize(
            this.#scheme(binding.symbol).type,
            level,
            generalizable,
          ),
        );
      }
      if (!this.#isIrrefutablePattern(pattern, expected)) {
        this.#diagnostics.add({
          severity: "error",
          message: "this or-pattern does not cover every possible value and cannot be used in `let`; use `match`",
          primary: pattern.span,
        });
      }
      return;
    }
    if (pattern.kind === "Constructor") {
      const unionId = this.#constructorUnions.get(pattern.symbol);
      const union = unionId === undefined ? undefined : this.#unions.get(unionId);
      if (union === undefined || union.constructors.length !== 1) {
        this.#diagnostics.add({
          severity: "error",
          message: "a constructor pattern is refutable and cannot be used in `let`",
          primary: pattern.span,
        });
        return;
      }
      const constructor = union.constructors[0]!;
      const parameters = constructor.slots.map((slot) =>
        this.#annotationType(slot.annotation)
      );
      this.#unify(
        expected,
        { kind: "Union", union: union.id, name: union.name },
        pattern.span,
      );
      if (pattern.arguments.length !== parameters.length) {
        this.#diagnostics.add({
          severity: "error",
          message: `constructor pattern \`${pattern.text}\` expects ${parameters.length} arguments, got ${pattern.arguments.length}`,
          primary: pattern.span,
        });
      }
      pattern.arguments.forEach((argument, index) =>
        this.#inferPattern(
          argument,
          parameters[index] ?? ERROR,
          level,
          generalizable,
        )
      );
      return;
    }
    if (
      pattern.kind === "Boolean" ||
      pattern.kind === "Integer" ||
      pattern.kind === "String"
    ) {
      this.#diagnostics.add({
        severity: "error",
        message: "a literal pattern is refutable and cannot be used in `let`",
        primary: pattern.span,
      });
      return;
    }

    if (pattern.kind === "Record") {
      const fields = new Map<string, Mono>();
      for (const fieldPattern of pattern.fields) {
        const field = this.#fresh(level + 1, false);
        fields.set(fieldPattern.name, field);
      }
      this.#unify(expected, {
        kind: "Record",
        fields,
        tail: this.#fresh(level + 1, false),
      }, pattern.span);
      for (const fieldPattern of pattern.fields) {
        this.#inferPattern(
          fieldPattern.pattern,
          fields.get(fieldPattern.name) ?? ERROR,
          level,
          generalizable,
        );
      }
      return;
    }

    const elements = pattern.elements.map(() => this.#fresh(level + 1, false));
    this.#unify(
      expected,
      { kind: "Tuple", elements },
      pattern.span,
    );
    pattern.elements.forEach((element, index) => {
      this.#inferPattern(element, elements[index]!, level, generalizable);
    });
  }

  #inferMatchPattern(
    pattern: Resolved.Pattern,
    expected: Mono,
    level: number,
  ): void {
    if (pattern.kind === "Wildcard") return;
    if (pattern.kind === "Unit") {
      this.#unify(expected, primitive("Unit"), pattern.span);
      return;
    }
    if (pattern.kind === "Binding") {
      this.#schemes.set(pattern.binding.symbol, { variables: [], type: expected });
      return;
    }
    if (pattern.kind === "As") {
      this.#inferMatchPattern(pattern.pattern, expected, level);
      this.#schemes.set(pattern.binding.symbol, { variables: [], type: expected });
      return;
    }
    if (pattern.kind === "Or") {
      const common = new Map<Resolved.SymbolId, Mono>();
      for (const alternative of pattern.alternatives) {
        this.#inferMatchPattern(alternative, expected, level);
        for (const binding of resolvedPatternBindings(alternative)) {
          const current = this.#scheme(binding.symbol).type;
          const previous = common.get(binding.symbol);
          if (previous === undefined) common.set(binding.symbol, current);
          else this.#unify(previous, current, binding.span);
        }
      }
      for (const [symbol, type] of common) {
        this.#schemes.set(symbol, { variables: [], type });
      }
      return;
    }
    if (pattern.kind === "Boolean") {
      this.#unify(expected, primitive("Bool"), pattern.span);
      return;
    }
    if (pattern.kind === "Integer") {
      this.#unify(expected, primitive("Int"), pattern.span);
      return;
    }
    if (pattern.kind === "String") {
      this.#unify(expected, primitive("String"), pattern.span);
      return;
    }
    if (pattern.kind === "Tuple") {
      const elements = pattern.elements.map(() => this.#fresh(level, false));
      this.#unify(expected, { kind: "Tuple", elements }, pattern.span);
      pattern.elements.forEach((element, index) =>
        this.#inferMatchPattern(element, elements[index] ?? ERROR, level)
      );
      return;
    }
    if (pattern.kind === "Record") {
      const fields = new Map(
        pattern.fields.map((field) => [field.name, this.#fresh(level, false)]),
      );
      this.#unify(expected, {
        kind: "Record",
        fields,
        tail: this.#fresh(level, false),
      }, pattern.span);
      for (const field of pattern.fields) {
        this.#inferMatchPattern(
          field.pattern,
          fields.get(field.name) ?? ERROR,
          level,
        );
      }
      return;
    }

    const unionId = this.#constructorUnions.get(pattern.symbol);
    const union = unionId === undefined ? undefined : this.#unions.get(unionId);
    if (union === undefined) return;
    const constructor = union.constructors.find(
      ({ binding }) => binding.symbol === pattern.symbol,
    );
    if (constructor === undefined) return;
    const parameters = constructor.slots.map((slot) =>
      this.#annotationType(slot.annotation)
    );
    this.#unify(expected, { kind: "Union", union: union.id, name: union.name }, pattern.span);
    if (pattern.arguments.length !== parameters.length) {
      this.#diagnostics.add({
        severity: "error",
        message: `constructor pattern \`${pattern.text}\` expects ${parameters.length} arguments, got ${pattern.arguments.length}`,
        primary: pattern.span,
      });
    }
    pattern.arguments.forEach((argument, index) =>
      this.#inferMatchPattern(argument, parameters[index] ?? ERROR, level)
    );
  }

  #isIrrefutablePattern(pattern: Resolved.Pattern, expected: Mono): boolean {
    if (pattern.kind === "Wildcard" || pattern.kind === "Binding") return true;
    if (pattern.kind === "As") {
      return this.#isIrrefutablePattern(pattern.pattern, expected);
    }
    const actual = this.#prune(expected);
    if (pattern.kind === "Or") {
      if (pattern.alternatives.some((alternative) =>
        this.#isIrrefutablePattern(alternative, actual)
      )) return true;
      if (actual.kind === "Constructor" && actual.name === "Bool") {
        const values = new Set<boolean>();
        for (const alternative of pattern.alternatives) {
          const unwrapped = unwrapAsPattern(alternative);
          if (unwrapped.kind === "Boolean") values.add(unwrapped.value);
        }
        return values.size === 2;
      }
      if (actual.kind === "Union") {
        const union = this.#unions.get(actual.union);
        return union?.constructors.every((constructor) =>
          pattern.alternatives.some((alternative) => {
            const unwrapped = unwrapAsPattern(alternative);
            if (
              unwrapped.kind !== "Constructor" ||
              unwrapped.symbol !== constructor.binding.symbol
            ) return false;
            return unwrapped.arguments.every((argument, index) => {
              const slot = constructor.slots[index];
              return slot !== undefined && this.#isIrrefutablePattern(
                argument,
                this.#annotationType(slot.annotation),
              );
            });
          })
        ) ?? false;
      }
      return false;
    }
    if (pattern.kind === "Unit") {
      return actual.kind === "Constructor" && actual.name === "Unit";
    }
    if (pattern.kind === "Tuple") {
      return actual.kind === "Tuple" &&
        pattern.elements.length === actual.elements.length &&
        pattern.elements.every((element, index) =>
          this.#isIrrefutablePattern(element, actual.elements[index] ?? ERROR)
        );
    }
    if (pattern.kind === "Record") {
      if (actual.kind !== "Record") return false;
      const fields = this.#normalizeRecord(actual).fields;
      return pattern.fields.every((field) =>
        this.#isIrrefutablePattern(
          field.pattern,
          fields.get(field.name) ?? ERROR,
        )
      );
    }
    if (pattern.kind === "Constructor" && actual.kind === "Union") {
      const union = this.#unions.get(actual.union);
      if (union?.constructors.length !== 1) return false;
      const constructor = union.constructors[0]!;
      return constructor.binding.symbol === pattern.symbol &&
        pattern.arguments.every((argument, index) => {
          const slot = constructor.slots[index];
          return slot !== undefined && this.#isIrrefutablePattern(
            argument,
            this.#annotationType(slot.annotation),
          );
        });
    }
    return false;
  }

  #constructorPatternsAreExhaustive(
    patterns: readonly Resolved.ConstructorPattern[],
  ): boolean {
    const first = patterns[0];
    if (first === undefined) return false;
    const unionId = this.#constructorUnions.get(first.symbol);
    const union = unionId === undefined ? undefined : this.#unions.get(unionId);
    const constructor = union?.constructors.find(
      ({ binding }) => binding.symbol === first.symbol,
    );
    if (constructor === undefined) return false;
    if (patterns.some((pattern) =>
      pattern.arguments.length === constructor.slots.length &&
      pattern.arguments.every((argument, index) =>
        this.#isIrrefutablePattern(
          argument,
          this.#annotationType(constructor.slots[index]!.annotation),
        )
      )
    )) return true;
    if (constructor.slots.length !== 1) return false;
    const arguments_ = patterns.flatMap((pattern) => pattern.arguments.slice(0, 1));
    if (arguments_.length !== patterns.length) return false;
    return this.#isIrrefutablePattern(
      { kind: "Or", alternatives: arguments_, span: first.span },
      this.#annotationType(constructor.slots[0]!.annotation),
    );
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
    if (
      actualLeft === actualRight ||
      actualLeft.kind === "Error" ||
      actualRight.kind === "Error"
    ) {
      return;
    }

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
    } else if (actualLeft.kind === "Tuple" && actualRight.kind === "Tuple") {
      if (actualLeft.elements.length !== actualRight.elements.length) {
        this.#diagnostics.add({
          severity: "error",
          message:
            `tuple arity mismatch: ${actualLeft.elements.length} and ` +
            `${actualRight.elements.length}`,
          primary: span,
        });
        return;
      }
      actualLeft.elements.forEach((element, index) => {
        this.#unify(element, actualRight.elements[index]!, span);
      });
      return;
    } else if (actualLeft.kind === "Record" && actualRight.kind === "Record") {
      this.#unifyRecords(actualLeft, actualRight, span);
      return;
    } else if (actualLeft.kind === "Union" && actualRight.kind === "Union") {
      if (actualLeft.union === actualRight.union) return;
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

  #unifyRecords(left: RecordMono, right: RecordMono, span: Source.Span): void {
    left = this.#normalizeRecord(left);
    right = this.#normalizeRecord(right);
    for (const [name, type] of left.fields) {
      const other = right.fields.get(name);
      if (other !== undefined) this.#unify(type, other, span);
    }
    const leftOnly = new Map([...left.fields].filter(([name]) => !right.fields.has(name)));
    const rightOnly = new Map([...right.fields].filter(([name]) => !left.fields.has(name)));

    if (left.tail === undefined && rightOnly.size > 0) {
      this.#recordMismatch([...rightOnly.keys()], span);
      return;
    }
    if (right.tail === undefined && leftOnly.size > 0) {
      this.#recordMismatch([...leftOnly.keys()], span);
      return;
    }
    if (left.tail !== undefined && right.tail !== undefined) {
      const actualLeftTail = this.#prune(left.tail);
      const actualRightTail = this.#prune(right.tail);
      if (actualLeftTail === actualRightTail) {
        if (leftOnly.size > 0 || rightOnly.size > 0) {
          this.#recordMismatch([...leftOnly.keys(), ...rightOnly.keys()], span);
        }
        return;
      }
      const shared = this.#fresh(Math.min(left.tail.level, right.tail.level), false);
      this.#bind(left.tail, { kind: "Record", fields: rightOnly, tail: shared }, span);
      this.#bind(right.tail, { kind: "Record", fields: leftOnly, tail: shared }, span);
      return;
    }
    if (left.tail !== undefined) {
      this.#bind(left.tail, { kind: "Record", fields: rightOnly }, span);
      return;
    }
    if (right.tail !== undefined) {
      this.#bind(right.tail, { kind: "Record", fields: leftOnly }, span);
    }
  }

  #normalizeRecord(record: RecordMono): RecordMono {
    const fields = new Map(record.fields);
    let tail = record.tail;
    while (tail !== undefined) {
      const actual = this.#prune(tail);
      if (actual.kind === "Variable") {
        return { kind: "Record", fields, tail: actual };
      }
      if (actual.kind !== "Record") return { kind: "Record", fields };
      for (const [name, field] of actual.fields) {
        if (!fields.has(name)) fields.set(name, field);
      }
      tail = actual.tail;
    }
    return { kind: "Record", fields };
  }

  #recordMismatch(fields: readonly string[], span: Source.Span): void {
    this.#diagnostics.add({
      severity: "error",
      message: `record fields do not match; unexpected ${fields.map((field) => `\`${field}\``).join(", ")}`,
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
    if (actual.kind === "Tuple") {
      return actual.elements.some((element) => this.#occurs(variable, element));
    }
    if (actual.kind === "Record") {
      return [...actual.fields.values()].some((field) => this.#occurs(variable, field)) ||
        (actual.tail !== undefined && this.#occurs(variable, actual.tail));
    }
    if (actual.kind === "Function") {
      return (
        actual.parameters.some((parameter) => this.#occurs(variable, parameter)) ||
        this.#occurs(variable, actual.result)
      );
    }
    return false;
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
    if (actual.kind === "Tuple") {
      for (const element of actual.elements) this.#collectVariables(element, found);
    }
    if (actual.kind === "Record") {
      for (const field of actual.fields.values()) this.#collectVariables(field, found);
      if (actual.tail !== undefined) this.#collectVariables(actual.tail, found);
    }
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
      if (actual.kind === "Tuple") {
        return { kind: "Tuple", elements: actual.elements.map(copy) };
      }
      if (actual.kind === "Record") {
        const record = this.#normalizeRecord(actual);
        return {
          kind: "Record",
          fields: new Map([...record.fields].map(([name, field]) => [name, copy(field)])),
          ...(record.tail === undefined ? {} : { tail: copy(record.tail) as Variable }),
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

  #annotationType(
    annotation: Resolved.TypeAnnotation,
    level = 0,
    namedTails = new Map<string, Variable>(),
  ): Mono {
    if (annotation.kind === "Primitive") return primitive(annotation.name);
    if (annotation.kind === "Union") {
      return {
        kind: "Union",
        union: annotation.union,
        name: annotation.name,
      };
    }
    if (annotation.kind === "Tuple") {
      return {
        kind: "Tuple",
        elements: annotation.elements.map((element) =>
          this.#annotationType(element, level, namedTails)
        ),
      };
    }
    if (annotation.kind === "Record") {
      return {
        kind: "Record",
        fields: new Map(annotation.fields.map((field) => [
          field.name,
          this.#annotationType(field.annotation, level, namedTails),
        ])),
        ...(annotation.open
          ? { tail: this.#annotationTail(annotation.tail, level, namedTails) }
          : {}),
      };
    }
    return ERROR;
  }

  #annotationTail(
    name: string | undefined,
    level: number,
    namedTails: Map<string, Variable>,
  ): Variable {
    if (name === undefined) return this.#fresh(level, false);
    const existing = namedTails.get(name);
    if (existing !== undefined) return existing;
    const tail = this.#fresh(level, false);
    namedTails.set(name, tail);
    return tail;
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
      case "Name":
        return this.#constructorUnions.has(expression.symbol);
      case "String":
        return expression.parts.every(({ kind }) => kind === "Text");
      case "Tuple":
        return expression.elements.every((element) => this.#isValue(element));
      case "Record":
        return expression.spread === undefined &&
          expression.fields.every((field) => this.#isValue(field.value));
      case "Call":
        return expression.callee.kind === "Name" &&
          this.#constructorUnions.has(expression.callee.symbol) &&
          expression.arguments.every((argument) => this.#isValue(argument));
      case "Group":
        return this.#isValue(expression.expression);
      default:
        return false;
    }
  }

  #publicType(
    type: Mono,
    seen = new Map<number, Typed.VariableType>(),
  ): Typed.Type {
    const actual = this.#prune(type);
    if (actual.kind === "Error") return { kind: "Error" };
    if (actual.kind === "Constructor") {
      return { kind: "Primitive", name: actual.name };
    }
    if (actual.kind === "Function") {
      return {
        kind: "Function",
        parameters: actual.parameters.map((parameter) =>
          this.#publicType(parameter, seen),
        ),
        result: this.#publicType(actual.result, seen),
      };
    }
    if (actual.kind === "Tuple") {
      return {
        kind: "Tuple",
        elements: actual.elements.map((element) => this.#publicType(element, seen)),
      };
    }
    if (actual.kind === "Record") {
      const tail = actual.tail === undefined ? undefined : this.#prune(actual.tail);
      return {
        kind: "Record",
        fields: [...actual.fields].map(([name, field]) => ({
          name,
          type: this.#publicType(field, seen),
        })),
        ...(tail?.kind === "Variable" ? { tail: Typed.typeVariableId(tail.id) } : {}),
      };
    }
    if (actual.kind === "Union") {
      return { kind: "Union", union: actual.union, name: actual.name };
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
    if (item.kind === "LetPattern") {
      return {
        ...item,
        pattern: this.#materializePattern(item.pattern),
        value: this.#materializeExpr(item.value),
      };
    }
    if (item.kind === "Union") {
      return {
        kind: "Union",
        exported: item.exported,
        union: item.union,
        name: item.name,
        constructors: item.constructors.map(({ binding, slots }) => ({
          ...binding,
          scheme: this.#publicScheme(this.#scheme(binding.symbol)),
          slots: slots.map((slot) => ({
            field: slot.field,
            type: this.#publicType(this.#annotationType(slot.annotation)),
            span: slot.span,
          })),
        })),
        span: item.span,
      };
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

  #materializePattern(pattern: Resolved.Pattern): Typed.Pattern {
    if (
      pattern.kind === "Wildcard" ||
      pattern.kind === "Unit" ||
      pattern.kind === "Boolean" ||
      pattern.kind === "Integer" ||
      pattern.kind === "String"
    ) return pattern;
    if (pattern.kind === "Or") {
      return {
        ...pattern,
        alternatives: pattern.alternatives.map((alternative) =>
          this.#materializePattern(alternative)
        ),
      };
    }
    if (pattern.kind === "As") {
      return {
        ...pattern,
        pattern: this.#materializePattern(pattern.pattern),
        binding: {
          ...pattern.binding,
          scheme: this.#publicScheme(this.#scheme(pattern.binding.symbol)),
        },
      };
    }
    if (pattern.kind === "Constructor") {
      return {
        ...pattern,
        arguments: pattern.arguments.map((argument) =>
          this.#materializePattern(argument),
        ),
      };
    }
    if (pattern.kind === "Tuple") {
      return {
        ...pattern,
        elements: pattern.elements.map((element) =>
          this.#materializePattern(element),
        ),
      };
    }
    if (pattern.kind === "Record") {
      return {
        ...pattern,
        fields: pattern.fields.map((field) => ({
          ...field,
          pattern: this.#materializePattern(field.pattern),
        })),
      };
    }
    return {
      kind: "Binding",
      binding: {
        ...pattern.binding,
        scheme: this.#publicScheme(this.#scheme(pattern.binding.symbol)),
      },
      span: pattern.span,
    };
  }

  #materializeUnion(union: Resolved.Union): Typed.Union {
    return {
      id: union.id,
      name: union.name,
      span: union.span,
      constructors: union.constructors.map(({ binding, slots }) => ({
        ...binding,
        scheme: this.#publicScheme(this.#scheme(binding.symbol)),
        slots: slots.map((slot) => ({
          field: slot.field,
          type: this.#publicType(this.#annotationType(slot.annotation)),
          span: slot.span,
        })),
      })),
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
      case "Tuple":
        return {
          ...expression,
          type,
          elements: expression.elements.map((element) =>
            this.#materializeExpr(element),
          ),
        };
      case "Record":
        return {
          kind: "Record",
          type,
          ...(expression.spread === undefined
            ? {}
            : { spread: this.#materializeExpr(expression.spread) }),
          fields: expression.fields.map((field) => ({
            ...field,
            value: this.#materializeExpr(field.value),
          })),
          span: expression.span,
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
      case "Match":
        const union = this.#matchUnions.get(expression);
        return {
          kind: "Match",
          scrutinee: this.#materializeExpr(expression.scrutinee),
          arms: expression.arms.map((arm) => ({
            pattern: this.#materializePattern(arm.pattern),
            ...(arm.guard === undefined
              ? {}
              : { guard: this.#materializeExpr(arm.guard) }),
            body: this.#materializeExpr(arm.body),
            span: arm.span,
          })),
          ...(union === undefined ? {} : { union }),
          type,
          span: expression.span,
        };
      case "Call":
        return {
          ...expression,
          type,
          callee: this.#materializeExpr(expression.callee),
          arguments: expression.arguments.map((argument) => this.#materializeExpr(argument)),
        };
      case "ConsoleLog":
        return {
          ...expression,
          type,
          arguments: expression.arguments.map((argument) =>
            this.#materializeExpr(argument)
          ),
        };
      case "Access": {
        const tupleIndex = this.#tupleAccesses.get(expression);
        const recordField = this.#recordAccesses.get(expression);
        return {
          ...expression,
          type,
          receiver: this.#materializeExpr(expression.receiver),
          ...(tupleIndex === undefined ? {} : { tupleIndex }),
          ...(recordField === undefined ? {} : { recordField }),
        };
      }
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
    if (actual.kind === "Tuple") {
      return `(${actual.elements.map((element) => this.#display(element)).join(", ")})`;
    }
    if (actual.kind === "Union") return actual.name;
    if (actual.kind === "Record") {
      const fields = [...actual.fields].map(([name, field]) => `${name}: ${this.#display(field)}`);
      if (actual.tail !== undefined) fields.push("...");
      return `{${fields.join(", ")}}`;
    }
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

function renderLiteralPatternKey(
  pattern: Resolved.BooleanPattern | Resolved.IntegerPattern | Resolved.StringPattern,
): string {
  switch (pattern.kind) {
    case "Boolean":
      return `Bool:${pattern.value}`;
    case "Integer":
      return `Int:${pattern.decimal}`;
    case "String":
      return `String:${pattern.value}`;
  }
}

function unwrapAsPattern(pattern: Resolved.Pattern): Resolved.Pattern {
  return pattern.kind === "As" ? unwrapAsPattern(pattern.pattern) : pattern;
}

function coverageAlternatives(
  pattern: Resolved.Pattern,
): readonly Resolved.Pattern[] {
  const unwrapped = unwrapAsPattern(pattern);
  return unwrapped.kind === "Or"
    ? unwrapped.alternatives.flatMap(coverageAlternatives)
    : [unwrapped];
}

function resolvedPatternBindings(
  pattern: Resolved.Pattern,
): readonly Resolved.Binding[] {
  switch (pattern.kind) {
    case "Binding":
      return [pattern.binding];
    case "Wildcard":
    case "Unit":
    case "Boolean":
    case "Integer":
    case "String":
      return [];
    case "As":
      return [...resolvedPatternBindings(pattern.pattern), pattern.binding];
    case "Or":
      return pattern.alternatives[0] === undefined
        ? []
        : resolvedPatternBindings(pattern.alternatives[0]);
    case "Tuple":
      return pattern.elements.flatMap(resolvedPatternBindings);
    case "Record":
      return pattern.fields.flatMap((field) =>
        resolvedPatternBindings(field.pattern)
      );
    case "Constructor":
      return pattern.arguments.flatMap(resolvedPatternBindings);
  }
}

function isStructurallyIrrefutablePattern(pattern: Resolved.Pattern): boolean {
  switch (pattern.kind) {
    case "Wildcard":
    case "Binding":
    case "Unit":
      return true;
    case "As":
      return isStructurallyIrrefutablePattern(pattern.pattern);
    case "Or":
      return pattern.alternatives.some(isStructurallyIrrefutablePattern);
    case "Tuple":
      return pattern.elements.every(isStructurallyIrrefutablePattern);
    case "Record":
      return pattern.fields.every((field) =>
        isStructurallyIrrefutablePattern(field.pattern)
      );
    case "Boolean":
    case "Integer":
    case "String":
    case "Constructor":
      return false;
  }
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
