/**
 * The experimental first emitter renders conservative, readable ESM from Core.
 * It is platform-neutral: hosts decide paths and perform filesystem writes.
 */

import * as Diagnostics from "../../support/diagnostics.js";
import type * as Source from "../../support/source.js";
import type * as Core from "../../syntax/core/index.js";
import type * as Emitted from "../../emission/index.js";
import type * as Resolved from "../../syntax/resolved/index.js";
import type * as Typed from "../../syntax/typed/index.js";

export function emitJavaScript(module: Core.Module): Emitted.JavaScript {
  return new JavaScriptEmitter(module).emit();
}

export function emitDeclarations(module: Core.Module): Emitted.Declarations {
  return new DeclarationEmitter(module).emit();
}

/** Emits a module-local TypeScript view of top-level bindings for interactive tools. */
export function emitTypeScriptPreview(
  module: Core.Module,
): Emitted.TypeScriptPreview {
  return new TypeScriptPreviewEmitter(module).emit();
}

type EvidenceNames = ReadonlyMap<string, string>;

class JavaScriptEmitter {
  readonly #diagnostics = new Diagnostics.Bag();
  readonly #symbols = new Map<Resolved.SymbolId, Core.Symbol>();
  readonly #constructors = new Map<Resolved.SymbolId, { constructor: Core.Constructor; tagged: boolean }>();
  #nextMatch = 0;
  readonly #helpers = new Set<Helper>();
  readonly #exports: string[] = [];
  readonly #module: Core.Module;

  constructor(module: Core.Module) {
    this.#module = module;
    for (const diagnostic of module.diagnostics) this.#diagnostics.add(diagnostic);
    for (const symbol of module.symbols) this.#symbols.set(symbol.id, symbol);
    for (const union of module.unions) {
      const tagged = union.constructors.some(({ slots }) => (slots?.length ?? 0) > 0);
      for (const constructor of union.constructors) {
        this.#constructors.set(constructor.symbol, { constructor, tagged });
      }
    }
  }

  emit(): Emitted.JavaScript {
    const body: string[] = [];
    const trailing = trailingComments(this.#module.items, this.#module.comments);
    const entries = sourceEntries(
      this.#module.items,
      this.#module.comments,
      trailing,
    );
    let previousSpan: Source.Span | undefined;
    for (const entry of entries) {
      if (previousSpan !== undefined) {
        body.push(...Array(blankLinesBetween(previousSpan, entry.span)).fill(""));
      }
      if (entry.kind === "Comment") {
        body.push(...commentLines(entry.comment));
      } else {
        const lines = this.#emitItem(entry.item, 0, new Map(), false);
        const comments = trailing.get(entry.item) ?? [];
        if (comments.length > 0 && lines.length > 0) {
          const last = lines.length - 1;
          lines[last] = `${lines[last]} ${comments.map(({ text }) => text).join(" ")}`;
        }
        body.push(...lines);
      }
      previousSpan = entry.span;
    }
    body.push(...this.#exports);

    const helpers = [...this.#helpers]
      .sort()
      .flatMap((helper) => renderHelper(helper));
    const lines = helpers.length === 0 ? body : [...helpers, "", ...body];

    return {
      kind: "JavaScript",
      fileId: this.#module.fileId,
      text: lines.length === 0 ? "" : `${lines.join("\n")}\n`,
      diagnostics: this.#diagnostics.toArray(),
    };
  }

  #emitItem(
    item: Core.Item,
    depth: number,
    evidenceNames: EvidenceNames,
    returnFinal: boolean,
  ): string[] {
    const prefix = indent(depth);
    if (item.kind === "ErrorItem") return [`${prefix}undefined;`];
    if (item.kind === "ExprItem") {
      if (returnFinal) {
        return this.#emitReturn(item.expression, depth, evidenceNames);
      }
      const expression = this.#emitExpr(item.expression, depth, evidenceNames);
      return [`${prefix}${expression};`];
    }

    if (item.kind === "LetPattern") {
      const value = this.#emitExpr(item.value, depth, evidenceNames);
      const alternatives = expandOrPatterns(item.pattern);
      if (alternatives.length > 1) {
        const bindings = patternBindings(item.pattern);
        if (bindings.length === 0) return [`${prefix}${value};`];
        const matchName = `__match${this.#nextMatch++}`;
        const names = bindings.map((binding) =>
          this.#identifier(binding.symbol, binding.name)
        );
        const lines = [
          `${prefix}const ${matchName} = ${value};`,
          `${prefix}let ${names.join(", ")};`,
        ];
        alternatives.forEach((alternative, index) => {
          const plan = this.#emitPatternPlan(alternative, matchName);
          const condition = plan.tests.length === 0
            ? "true"
            : plan.tests.join(" && ");
          lines.push(`${prefix}${index === 0 ? "if" : "else if"} (${condition}) {`);
          for (const binding of plan.bindings) {
            lines.push(`${indent(depth + 1)}${binding.replace(/^const /, "")}`);
          }
          lines.push(`${prefix}}`);
        });
        lines.push(
          `${prefix}else { throw new RangeError("Unexpected irrefutable pattern."); }`,
        );
        return lines;
      }
      if (item.pattern.kind === "Unit") return [`${prefix}${value};`];
      if (item.pattern.kind === "As") {
        const name = this.#identifier(
          item.pattern.binding.symbol,
          item.pattern.binding.name,
        );
        const nested = this.#emitPattern(item.pattern.pattern);
        return [
          `${prefix}const ${name} = ${value};`,
          ...(nested === "" ? [] : [`${prefix}const ${nested} = ${name};`]),
        ];
      }
      const pattern = this.#emitPattern(item.pattern);
      return pattern === ""
        ? [`${prefix}${value};`]
        : [`${prefix}const ${pattern} = ${value};`];
    }
    if (item.kind === "Union") {
      const tagged = item.constructors.some(({ slots }) => (slots?.length ?? 0) > 0);
      const lines = item.constructors.map((constructor) => {
        const name = this.#identifier(constructor.symbol, constructor.name);
        if (item.exported && depth === 0) {
          this.#exports.push(
            name === constructor.name
              ? `export { ${name} };`
              : `export { ${name} as ${constructor.name} };`,
          );
        }
        const slots = constructor.slots ?? [];
        if (slots.length > 0) {
          const parameters = slots.map(({ field }) => field);
          const fields = slots.map(({ field }) => `${field}: ${field}`);
          return `${prefix}const ${name} = (${parameters.join(", ")}) => ({ tag: ${JSON.stringify(constructor.name)}, ${fields.join(", ")} });`;
        }
        return tagged
          ? `${prefix}const ${name} = { tag: ${JSON.stringify(constructor.name)} };`
          : `${prefix}const ${name} = ${JSON.stringify(constructor.name)};`;
      });
      return lines;
    }

    if (item.kind === "Fun") {
      const name = this.#identifier(item.binding.symbol, item.binding.name);
      this.#recordExport(item, name, depth);
      return this.#emitFunctionDeclaration(item, name, depth, evidenceNames);
    }

    const name = this.#identifier(item.binding.symbol, item.binding.name);
    const value = this.#emitBindingValue(item, depth, evidenceNames);
    this.#recordExport(item, name, depth);
    return [`${prefix}const ${name} = ${value};`];
  }

  #emitPattern(pattern: Core.Pattern): string {
    switch (pattern.kind) {
      case "Binding":
        return this.#identifier(
          pattern.binding.symbol,
          pattern.binding.name,
        );
      case "Wildcard":
        return "";
      case "Unit":
        return "";
      case "As":
        return this.#emitPattern(pattern.pattern);
      case "Or":
        return this.#emitPattern(pattern.alternatives[0] ?? {
          kind: "Wildcard",
          span: pattern.span,
        });
      case "Boolean":
        return String(pattern.value);
      case "Integer":
        return cleanNumber(pattern.decimal);
      case "String":
        return JSON.stringify(pattern.value);
      case "Tuple":
        return `[${pattern.elements.map((element) =>
          this.#emitPattern(element)
        ).join(", ")}]`;
      case "Record": {
        const fields = pattern.fields.flatMap((field) => {
          const emitted = this.#emitPattern(field.pattern);
          if (emitted === "") return [];
          return [field.pattern.kind === "Binding" &&
              emitted === field.name
            ? field.name
            : `${field.name}: ${emitted}`];
        });
        return fields.length === 0 ? "" : `{ ${fields.join(", ")} }`;
      }
      case "Constructor": {
        const fields = pattern.arguments.flatMap((argument, index) => {
          const field = this.#constructors.get(pattern.symbol)?.constructor
            .slots[index]?.field ?? `item${index + 1}`;
          const emitted = this.#emitPattern(argument);
          if (emitted === "") return [];
          return [argument.kind === "Binding" && emitted === field
            ? field
            : `${field}: ${emitted}`];
        });
        return fields.length === 0 ? "" : `{ ${fields.join(", ")} }`;
      }
    }
  }

  #recordExport(
    item: Core.LetItem | Core.FunItem,
    name: string,
    depth: number,
  ): void {
    if (!item.exported || depth !== 0) return;
    if (item.binding.scheme.constraints.length > 0) {
      this.#diagnostics.add({
        severity: "error",
        message:
          `cannot emit constrained export \`${item.binding.name}\` until ` +
          "the public dictionary ABI is implemented",
        primary: item.binding.span,
      });
      return;
    }
    this.#exports.push(
      name === item.binding.name
        ? `export { ${name} };`
        : `export { ${name} as ${item.binding.name} };`,
    );
  }

  #emitFunctionDeclaration(
    item: Core.FunItem,
    name: string,
    depth: number,
    evidenceNames: EvidenceNames,
  ): string[] {
    const localEvidence = new Map(evidenceNames);
    const dictionaryParameters = dictionaryEntries(item.binding.scheme).map(
      ({ constraint, variable }) => {
        const dictionary = dictionaryParameterName(constraint, variable);
        localEvidence.set(evidenceKey(variable, constraint), dictionary);
        return dictionary;
      },
    );
    const parameters = [
      ...dictionaryParameters,
      ...item.value.parameters.map((parameter) =>
        this.#identifier(parameter.symbol, parameter.name),
      ),
    ];
    const prefix = indent(depth);
    const head = `${prefix}function ${name}(${parameters.join(", ")}) {`;
    const body = item.value.body.kind === "Block"
      ? this.#emitBlockItems(
          item.value.body.items,
          depth + 1,
          localEvidence,
        )
      : this.#emitReturn(item.value.body, depth + 1, localEvidence);
    return [head, ...body, `${prefix}}`];
  }

  #emitBindingValue(
    item: Core.LetItem,
    depth: number,
    evidenceNames: EvidenceNames,
  ): string {
    if (item.value.kind !== "Lambda") {
      return this.#emitExpr(item.value, depth, evidenceNames);
    }

    const localEvidence = new Map(evidenceNames);
    const dictionaryParameters = dictionaryEntries(item.binding.scheme).map(
      ({ constraint, variable }) => {
        const name = dictionaryParameterName(constraint, variable);
        localEvidence.set(evidenceKey(variable, constraint), name);
        return name;
      },
    );
    return this.#emitLambda(
      item.value,
      depth,
      localEvidence,
      dictionaryParameters,
    );
  }

  #emitExpr(
    expression: Core.Expr,
    depth: number,
    evidenceNames: EvidenceNames,
  ): string {
    switch (expression.kind) {
      case "Name":
        return this.#identifier(expression.symbol, expression.text);
      case "Unit":
      case "ErrorExpr":
        return "undefined";
      case "Boolean":
        return String(expression.value);
      case "Number":
        return cleanNumber(expression.decimal);
      case "BigInt":
        return `${cleanNumber(expression.decimal)}n`;
      case "Float":
        return cleanNumber(expression.spelling);
      case "ConvertInt":
        return this.#emitConvertInt(expression, evidenceNames);
      case "String":
        return this.#emitString(expression, depth, evidenceNames);
      case "Tuple":
        return `[${expression.elements.map((element) =>
          this.#emitExpr(element, depth, evidenceNames)
        ).join(", ")}]`;
      case "Record":
        return `{ ${[
          ...(expression.spread === undefined
            ? []
            : [`...${this.#emitExpr(expression.spread, depth, evidenceNames)}`]),
          ...expression.fields.map((field) =>
            field.punned && field.value.kind === "Name" &&
                this.#identifier(field.value.symbol, field.value.text) === field.name
              ? field.name
              : `${field.name}: ${this.#emitExpr(field.value, depth, evidenceNames)}`
          ),
        ].join(", ")} }`;
      case "TupleAccess":
        return (
          `${this.#emitOperand(expression.receiver, Precedence.Call, depth, evidenceNames)}` +
          `[${expression.index}]`
        );
      case "FieldAccess":
        return expression.receiver.kind === "Record"
          ? `(${this.#emitExpr(expression.receiver, depth, evidenceNames)}).${expression.field}`
          : `${this.#emitOperand(expression.receiver, Precedence.Call, depth, evidenceNames)}.${expression.field}`;
      case "Block":
        return this.#emitBlockExpression(expression, depth, evidenceNames);
      case "Lambda":
        return this.#emitLambda(expression, depth, evidenceNames, []);
      case "If": {
        const condition = this.#emitOperand(
          expression.condition,
          Precedence.Conditional,
          depth,
          evidenceNames,
          true,
        );
        const consequence = this.#emitExpr(
          expression.consequence,
          depth,
          evidenceNames,
        );
        const alternative =
          expression.alternative === undefined
            ? "undefined"
            : this.#emitExpr(expression.alternative, depth, evidenceNames);
        return `${condition} ? ${consequence} : ${alternative}`;
      }
      case "Match":
        return this.#emitMatch(expression, depth, evidenceNames);
      case "Call":
        return this.#emitCall(expression, depth, evidenceNames);
      case "ConsoleLog":
        return `console.log(${expression.arguments.map((argument) =>
          this.#emitExpr(argument, depth, evidenceNames)
        ).join(", ")})`;
      case "LogicalNot":
        return `!${this.#emitOperand(expression.operand, Precedence.Unary, depth, evidenceNames)}`;
      case "Logical": {
        const operation = expression.operation === "And" ? "&&" : "||";
        const precedence = expression.operation === "And"
          ? Precedence.LogicalAnd
          : Precedence.LogicalOr;
        const left = this.#emitOperand(
          expression.left,
          precedence,
          depth,
          evidenceNames,
        );
        const right = this.#emitOperand(
          expression.right,
          precedence,
          depth,
          evidenceNames,
          true,
        );
        return `${left} ${operation} ${right}`;
      }
      case "ConstraintCall":
        return this.#emitConstraintCall(expression, depth, evidenceNames);
      case "ComparisonChain":
        return this.#emitComparison(expression, depth, evidenceNames);
    }
  }

  #emitOperand(
    expression: Core.Expr,
    parentPrecedence: Precedence,
    depth: number,
    evidenceNames: EvidenceNames,
    parenthesizeEqual = false,
  ): string {
    const emitted = this.#emitExpr(expression, depth, evidenceNames);
    const precedence = expressionPrecedence(expression);
    return precedence < parentPrecedence ||
      (parenthesizeEqual && precedence === parentPrecedence)
      ? `(${emitted})`
      : emitted;
  }

  #emitLambda(
    expression: Core.LambdaExpr,
    depth: number,
    evidenceNames: EvidenceNames,
    dictionaryParameters: readonly string[],
  ): string {
    const parameters = [
      ...dictionaryParameters,
      ...expression.parameters.map((parameter) =>
        this.#identifier(parameter.symbol, parameter.name),
      ),
    ];
    const head =
      parameters.length === 1
        ? `${parameters[0]} =>`
        : `(${parameters.join(", ")}) =>`;

    if (expression.body.kind !== "Block") {
      if (expression.body.kind === "Match") {
        const lines = this.#emitReturn(
          expression.body,
          depth + 1,
          evidenceNames,
        );
        return `${head} {\n${lines.join("\n")}\n${indent(depth)}}`;
      }
      return `${head} ${this.#emitExpr(expression.body, depth, evidenceNames)}`;
    }

    const lines = this.#emitBlockItems(
      expression.body.items,
      depth + 1,
      evidenceNames,
    );
    return `${head} {\n${lines.join("\n")}\n${indent(depth)}}`;
  }

  #emitBlockExpression(
    expression: Core.BlockExpr,
    depth: number,
    evidenceNames: EvidenceNames,
  ): string {
    const lines = this.#emitBlockItems(
      expression.items,
      depth + 1,
      evidenceNames,
    );
    return `(() => {\n${lines.join("\n")}\n${indent(depth)}})()`;
  }

  #emitBlockItems(
    items: readonly Core.Item[],
    depth: number,
    evidenceNames: EvidenceNames,
  ): string[] {
    if (items.length === 0) return [`${indent(depth)}return undefined;`];

    return items.flatMap((item, index) =>
      this.#emitItem(item, depth, evidenceNames, index === items.length - 1),
    );
  }

  #emitReturn(
    expression: Core.Expr,
    depth: number,
    evidenceNames: EvidenceNames,
  ): string[] {
    if (expression.kind === "Match") {
      return this.#emitReturningMatch(expression, depth, evidenceNames);
    }
    return [
      `${indent(depth)}return ${this.#emitExpr(expression, depth, evidenceNames)};`,
    ];
  }

  #emitCall(
    expression: Core.CallExpr,
    depth: number,
    evidenceNames: EvidenceNames,
  ): string {
    if (expression.callee.kind === "Name") {
      const symbol = this.#symbols.get(expression.callee.symbol);
      if (symbol !== undefined && symbol.scheme.constraints.length > 0) {
        this.#diagnostics.add({
          severity: "error",
          message:
            `cannot emit constrained call to \`${symbol.name}\` in the ` +
            "first JavaScript slice",
          primary: expression.span,
        });
        return "undefined";
      }
    }

    const emittedCallee = this.#emitExpr(expression.callee, depth, evidenceNames);
    const callee =
      expression.callee.kind === "Name" || expression.callee.kind === "Call"
        ? emittedCallee
        : `(${emittedCallee})`;
    const arguments_ = expression.arguments.map((argument) =>
      this.#emitExpr(argument, depth, evidenceNames),
    );
    return `${callee}(${arguments_.join(", ")})`;
  }

  #emitMatch(
    expression: Core.MatchExpr,
    depth: number,
    evidenceNames: EvidenceNames,
  ): string {
    const lines = this.#emitReturningMatch(
      expression,
      depth + 1,
      evidenceNames,
    );
    return `(() => {\n${lines.join("\n")}\n${indent(depth)}})()`;
  }

  #emitReturningMatch(
    expression: Core.MatchExpr,
    depth: number,
    evidenceNames: EvidenceNames,
  ): string[] {
    if (
      expression.union === undefined ||
      expression.arms.some((arm) =>
        arm.guard !== undefined || !isSimpleSwitchPattern(arm.pattern)
      )
    ) {
      return this.#emitConditionalMatch(expression, depth, evidenceNames);
    }
    const prefix = indent(depth);
    const armIndent = indent(depth + 1);
    const bodyDepth = depth + 2;
    const bodyIndent = indent(bodyDepth);
    const union = this.#module.unions.find(({ id }) => id === expression.union);
    const tagged = union?.constructors.some(({ slots }) => (slots?.length ?? 0) > 0) ?? false;
    const needsMatchName = tagged || expression.arms.some(
      (arm) => arm.pattern.kind === "Binding",
    );
    const matchName = needsMatchName
      ? `__match${this.#nextMatch++}`
      : undefined;
    const scrutinee = this.#emitExpr(
      expression.scrutinee,
      depth,
      evidenceNames,
    );
    const lines = matchName === undefined
      ? [`${prefix}switch (${scrutinee}) {`]
      : [
          `${prefix}const ${matchName} = ${scrutinee};`,
          `${prefix}switch (${matchName}${tagged ? ".tag" : ""}) {`,
        ];
    for (const arm of expression.arms) {
      const pattern = arm.pattern;
      if (pattern.kind === "Constructor") {
        lines.push(`${armIndent}case ${JSON.stringify(pattern.text)}:`);
        const metadata = this.#constructors.get(pattern.symbol)?.constructor;
        pattern.arguments.forEach((argument, index) => {
          if (matchName === undefined) return;
          const field = metadata?.slots[index]?.field ?? `item${index + 1}`;
          const destructuring = this.#emitPattern(argument);
          if (destructuring !== "") {
            lines.push(`${bodyIndent}const ${destructuring} = ${matchName}.${field};`);
          }
        });
        lines.push(...this.#emitReturn(arm.body, bodyDepth, evidenceNames));
      } else {
        lines.push(`${armIndent}default:`);
        if (pattern.kind === "Binding") {
          const name = this.#identifier(
            pattern.binding.symbol,
            pattern.binding.name,
          );
          lines.push(`${bodyIndent}const ${name} = ${matchName};`);
        }
        lines.push(...this.#emitReturn(arm.body, bodyDepth, evidenceNames));
      }
    }
    if (expression.arms.every((arm) => arm.pattern.kind === "Constructor")) {
      lines.push(
        `${armIndent}default:`,
        `${bodyIndent}throw new RangeError("Unexpected pattern.");`,
      );
    }
    lines.push(`${prefix}}`);
    return lines;
  }

  #emitConditionalMatch(
    expression: Core.MatchExpr,
    depth: number,
    evidenceNames: EvidenceNames,
  ): string[] {
    const prefix = indent(depth);
    const matchName = `__match${this.#nextMatch++}`;
    const scrutinee = this.#emitExpr(expression.scrutinee, depth, evidenceNames);
    const lines = [`${prefix}const ${matchName} = ${scrutinee};`];

    for (const arm of expression.arms) {
      const alternatives = expandOrPatterns(arm.pattern);
      for (const [index, alternative] of alternatives.entries()) {
        const plan = this.#emitPatternPlan(alternative, matchName);
        const condition = plan.tests.length === 0
          ? "true"
          : plan.tests.join(" && ");
        const keyword = index === 0 ? "if" : "else if";
        lines.push(`${prefix}${keyword} (${condition}) {`);
        const armDepth = depth + 1;
        const armPrefix = indent(armDepth);
        for (const binding of plan.bindings) {
          lines.push(`${armPrefix}${binding}`);
        }
        if (arm.guard === undefined) {
          lines.push(...this.#emitReturn(arm.body, armDepth, evidenceNames));
        } else {
          const guard = this.#emitExpr(arm.guard, armDepth, evidenceNames);
          lines.push(`${armPrefix}if (${guard}) {`);
          lines.push(...this.#emitReturn(arm.body, armDepth + 1, evidenceNames));
          lines.push(`${armPrefix}}`);
        }
        lines.push(`${prefix}}`);
      }
    }
    lines.push(`${prefix}throw new RangeError("Unexpected pattern.");`);
    return lines;
  }

  #emitPatternPlan(pattern: Core.Pattern, value: string): PatternPlan {
    switch (pattern.kind) {
      case "Wildcard":
        return { tests: [], bindings: [] };
      case "Unit":
        return { tests: [`${value} === undefined`], bindings: [] };
      case "As": {
        const nested = this.#emitPatternPlan(pattern.pattern, value);
        const name = this.#identifier(pattern.binding.symbol, pattern.binding.name);
        return {
          tests: nested.tests,
          bindings: [...nested.bindings, `const ${name} = ${value};`],
        };
      }
      case "Or": {
        const alternatives = pattern.alternatives.map((alternative) =>
          this.#emitPatternPlan(alternative, value)
        );
        if (alternatives.some(({ bindings }) => bindings.length > 0)) {
          return { tests: ["false"], bindings: [] };
        }
        return {
          tests: [alternatives.map(({ tests }) =>
            tests.length === 0 ? "true" : `(${tests.join(" && ")})`
          ).join(" || ")],
          bindings: [],
        };
      }
      case "Binding": {
        const name = this.#identifier(pattern.binding.symbol, pattern.binding.name);
        return { tests: [], bindings: [`const ${name} = ${value};`] };
      }
      case "Boolean":
        return { tests: [`${value} === ${pattern.value}`], bindings: [] };
      case "Integer":
        return { tests: [`${value} === ${cleanNumber(pattern.decimal)}`], bindings: [] };
      case "String":
        return { tests: [`${value} === ${JSON.stringify(pattern.value)}`], bindings: [] };
      case "Tuple":
        return combinePatternPlans(
          pattern.elements.map((element, index) =>
            this.#emitPatternPlan(element, `${value}[${index}]`)
          ),
        );
      case "Record":
        return combinePatternPlans(
          pattern.fields.map((field) =>
            this.#emitPatternPlan(field.pattern, `${value}.${field.name}`)
          ),
        );
      case "Constructor": {
        const metadata = this.#constructors.get(pattern.symbol);
        const test = metadata?.tagged
          ? `${value}.tag === ${JSON.stringify(pattern.text)}`
          : `${value} === ${JSON.stringify(pattern.text)}`;
        const payloads = pattern.arguments.map((argument, index) => {
          const field = metadata?.constructor.slots[index]?.field ?? `item${index + 1}`;
          return this.#emitPatternPlan(argument, `${value}.${field}`);
        });
        const combined = combinePatternPlans(payloads);
        return { tests: [test, ...combined.tests], bindings: combined.bindings };
      }
    }
  }

  #emitConvertInt(
    expression: Core.ConvertIntExpr,
    evidenceNames: EvidenceNames,
  ): string {
    if (expression.evidence.kind !== "Dictionary") return "undefined";
    const dictionary = this.#dictionary(
      expression.evidence.variable,
      "Num",
      expression.span,
      evidenceNames,
    );
    return `${dictionary}.fromInt(${cleanNumber(expression.decimal)})`;
  }

  #emitString(
    expression: Core.StringExpr,
    depth: number,
    evidenceNames: EvidenceNames,
  ): string {
    const parts = expression.parts.map((part) => {
      if (part.kind === "Text") return JSON.stringify(part.value);
      const value = this.#emitExpr(part.expression, depth, evidenceNames);
      if (part.evidence.kind === "Dictionary") {
        const dictionary = this.#dictionary(
          part.evidence.variable,
          "Show",
          part.span,
          evidenceNames,
        );
        return `${dictionary}.show(${value})`;
      }
      if (part.evidence.kind === "Primitive") {
        if (part.evidence.instance === "String") {
          return this.#emitOperand(
            part.expression,
            Precedence.Additive,
            depth,
            evidenceNames,
          );
        }
        if (part.evidence.instance === "Unit") return `(${value}, "()")`;
        return `String(${value})`;
      }
      return `(${value}, undefined)`;
    });
    return parts.length === 0 ? '""' : parts.join(" + ");
  }

  #emitConstraintCall(
    expression: Core.ConstraintCallExpr,
    depth: number,
    evidenceNames: EvidenceNames,
  ): string {
    const arguments_ = expression.arguments.map((argument) =>
      this.#emitExpr(argument, depth, evidenceNames),
    );
    if (expression.evidence.kind === "Dictionary") {
      const dictionary = this.#dictionary(
        expression.evidence.variable,
        expression.constraint,
        expression.span,
        evidenceNames,
      );
      return `${dictionary}.${expression.member}(${arguments_.join(", ")})`;
    }
    if (expression.evidence.kind === "Error") return "undefined";

    const instance = expression.evidence.instance;
    const [leftExpression, rightExpression] = expression.arguments;
    const operand = (
      argument: Core.Expr | undefined,
      precedence: Precedence,
      parenthesizeEqual = false,
    ): string =>
      argument === undefined
        ? "undefined"
        : this.#emitOperand(
            argument,
            precedence,
            depth,
            evidenceNames,
            parenthesizeEqual,
          );
    switch (expression.member) {
      case "negate":
        return `-${operand(leftExpression, Precedence.Unary, true)}`;
      case "add":
        return (
          `${operand(leftExpression, Precedence.Additive)} + ` +
          operand(rightExpression, Precedence.Additive, true)
        );
      case "subtract":
        return (
          `${operand(leftExpression, Precedence.Additive)} - ` +
          operand(rightExpression, Precedence.Additive, true)
        );
      case "multiply":
        return (
          `${operand(leftExpression, Precedence.Multiplicative)} * ` +
          operand(rightExpression, Precedence.Multiplicative, true)
        );
      case "divide":
        return (
          `${operand(leftExpression, Precedence.Multiplicative)} / ` +
          operand(rightExpression, Precedence.Multiplicative, true)
        );
      case "concat":
        // Both operands are String, so flattening a nested concat preserves
        // JavaScript evaluation order and cannot trigger numeric addition.
        return (
          `${operand(leftExpression, Precedence.Additive)} + ` +
          operand(rightExpression, Precedence.Additive)
        );
      case "pow":
        if (instance === "Float") {
          const left = leftExpression === undefined
            ? "undefined"
            : expressionPrecedence(leftExpression) === Precedence.Unary
              ? `(${this.#emitExpr(leftExpression, depth, evidenceNames)})`
              : operand(leftExpression, Precedence.Exponentiation, true);
          return (
            `${left} ** ` +
            operand(rightExpression, Precedence.Exponentiation)
          );
        }
        this.#helpers.add("checkedPower");
        return `$hexCheckedPower(${arguments_[0] ?? "undefined"}, ${arguments_[1] ?? "undefined"})`;
    }
  }

  #emitComparison(
    expression: Core.ComparisonChainExpr,
    depth: number,
    evidenceNames: EvidenceNames,
  ): string {
    if (expression.steps.length === 0) return "true";
    if (expression.steps.length === 1) {
      const step = expression.steps[0]!;
      const precedence = comparisonPrecedence(step);
      return this.#emitComparisonStep(
        step,
        this.#emitOperand(
          expression.operands[0]!,
          precedence,
          depth,
          evidenceNames,
        ),
        this.#emitOperand(
          expression.operands[1]!,
          precedence,
          depth,
          evidenceNames,
          true,
        ),
        evidenceNames,
      );
    }

    const prefix = indent(depth + 1);
    const lines = [
      `${prefix}const __compare0 = ${this.#emitExpr(expression.operands[0]!, depth + 1, evidenceNames)};`,
    ];
    for (let index = 0; index < expression.steps.length; index += 1) {
      const operandName = `__compare${index + 1}`;
      lines.push(
        `${prefix}const ${operandName} = ${this.#emitExpr(expression.operands[index + 1]!, depth + 1, evidenceNames)};`,
      );
      const test = this.#emitComparisonStep(
        expression.steps[index]!,
        `__compare${index}`,
        operandName,
        evidenceNames,
      );
      lines.push(
        index === expression.steps.length - 1
          ? `${prefix}return ${test};`
          : `${prefix}if (!(${test})) return false;`,
      );
    }
    return `(() => {\n${lines.join("\n")}\n${indent(depth)}})()`;
  }

  #emitComparisonStep(
    step: Core.ComparisonStep,
    left: string,
    right: string,
    evidenceNames: EvidenceNames,
  ): string {
    if (step.evidence.kind === "Dictionary") {
      const constraint =
        step.test === "Equal" || step.test === "NotEqual" ? "Eq" : "Ord";
      const dictionary = this.#dictionary(
        step.evidence.variable,
        constraint,
        step.span,
        evidenceNames,
      );
      if (step.test === "Equal") return `${dictionary}.equals(${left}, ${right})`;
      if (step.test === "NotEqual") {
        return `${dictionary}.notEquals(${left}, ${right})`;
      }
      return comparisonFromOrder(
        step.test,
        `${dictionary}.compare(${left}, ${right})`,
      );
    }
    if (step.evidence.kind === "Error") return "false";

    const instance = step.evidence.instance;
    if (step.test === "Equal" || step.test === "NotEqual") {
      let equality: string;
      if (instance === "Float") {
        this.#helpers.add("floatEquals");
        equality = `$hexFloatEquals(${left}, ${right})`;
      } else {
        equality = `${left} === ${right}`;
      }
      return step.test === "Equal" ? equality : `!(${equality})`;
    }

    if (instance === "Float") {
      this.#helpers.add("compareFloat");
      return comparisonFromOrder(
        step.test,
        `$hexCompareFloat(${left}, ${right})`,
      );
    }
    if (instance === "String") {
      this.#helpers.add("compareString");
      return comparisonFromOrder(
        step.test,
        `$hexCompareString(${left}, ${right})`,
      );
    }
    if (instance === "Unit") return comparisonFromOrder(step.test, "0");
    return `${left} ${comparisonOperator(step.test)} ${right}`;
  }

  #dictionary(
    variable: Typed.TypeVariableId,
    constraint: Typed.ConstraintName,
    span: Core.Expr["span"],
    evidenceNames: EvidenceNames,
  ): string {
    const name = evidenceNames.get(evidenceKey(variable, constraint));
    if (name !== undefined) return name;
    this.#diagnostics.add({
      severity: "error",
      message: `missing \`${constraint}\` evidence during JavaScript emission`,
      primary: span,
    });
    return "undefined";
  }

  #identifier(symbol: Resolved.SymbolId, sourceName: string): string {
    return isSafeIdentifier(sourceName) ? sourceName : `$hex${Number(symbol)}`;
  }
}

class DeclarationEmitter {
  readonly #diagnostics = new Diagnostics.Bag();
  readonly #module: Core.Module;

  constructor(module: Core.Module) {
    this.#module = module;
    for (const diagnostic of module.diagnostics) this.#diagnostics.add(diagnostic);
  }

  emit(): Emitted.Declarations {
    const declarations: string[] = [];
    let isExternalModule = false;
    for (const item of this.#module.items) {
      if (item.kind === "Union") {
        declarations.push(renderUnionDeclaration(item, item.exported));
        if (item.exported) {
          isExternalModule = true;
          for (const constructor of item.constructors) {
            const type = constructor.slots.length === 0
              ? item.name
              : `(${constructor.slots.map((slot, index) => `${slot.field || `arg${index}`}: ${renderType(slot.type, new Map(), false)}`).join(", ")}) => ${item.name}`;
            declarations.push(
              `export declare const ${constructor.name}: ${type};`,
            );
          }
        }
        continue;
      }
      if ((item.kind !== "Let" && item.kind !== "Fun") || !item.exported) {
        continue;
      }
      if (item.binding.scheme.constraints.length > 0) {
        this.#diagnostics.add({
          severity: "error",
          message:
            `cannot emit constrained export \`${item.binding.name}\` until ` +
            "the public dictionary ABI is implemented",
          primary: item.binding.span,
        });
        continue;
      }
      isExternalModule = true;

      const safeName = isSafeIdentifier(item.binding.name);
      const local = safeName
        ? item.binding.name
        : `$hex${Number(item.binding.symbol)}`;
      if (item.kind === "Fun") {
        declarations.push(
          renderFunctionDeclaration(local, item.binding.scheme, item.value, safeName),
        );
        if (!safeName) {
          declarations.push(`export { ${local} as ${item.binding.name} };`);
        }
      } else if (safeName) {
        const type = renderScheme(item.binding.scheme, item.value);
        declarations.push(`export declare const ${item.binding.name}: ${type};`);
      } else {
        const type = renderScheme(item.binding.scheme, item.value);
        declarations.push(`declare const ${local}: ${type};`);
        declarations.push(`export { ${local} as ${item.binding.name} };`);
      }
    }
    if (!isExternalModule) declarations.push("export {};");

    return {
      kind: "Declarations",
      fileId: this.#module.fileId,
      text: `${declarations.join("\n")}\n`,
      diagnostics: this.#diagnostics.toArray(),
    };
  }
}

class TypeScriptPreviewEmitter {
  readonly #diagnostics = new Diagnostics.Bag();
  readonly #module: Core.Module;

  constructor(module: Core.Module) {
    this.#module = module;
    for (const diagnostic of module.diagnostics) this.#diagnostics.add(diagnostic);
  }

  emit(): Emitted.TypeScriptPreview {
    const declarations: string[] = [];
    let isExternalModule = false;

    for (const item of this.#module.items) {
      if (item.kind === "Union") {
        declarations.push(renderUnionDeclaration(item, item.exported));
        for (const constructor of item.constructors) {
          const prefix = item.exported ? "export " : "";
          const type = constructor.slots.length === 0
            ? item.name
            : `(${constructor.slots.map((slot, index) => `${slot.field || `arg${index}`}: ${renderType(slot.type, new Map(), false)}`).join(", ")}) => ${item.name}`;
          declarations.push(
            `${prefix}declare const ${constructor.name}: ${type};`,
          );
        }
        isExternalModule ||= item.exported;
        continue;
      }
      if (item.kind === "LetPattern") {
        for (const binding of patternBindings(item.pattern)) {
          const name = isSafeIdentifier(binding.name)
            ? binding.name
            : `$hex${Number(binding.symbol)}`;
          declarations.push(
            `declare const ${name}: ${renderScheme(binding.scheme)};`,
          );
        }
        continue;
      }
      if (item.kind !== "Let" && item.kind !== "Fun") continue;
      if (item.binding.scheme.constraints.length > 0) {
        this.#diagnostics.add({
          severity: item.exported ? "error" : "warning",
          message: item.exported
            ? `cannot emit constrained export \`${item.binding.name}\` until ` +
              "the public dictionary ABI is implemented"
            : `cannot preview constrained binding \`${item.binding.name}\` in ` +
              "TypeScript until its dictionary representation is implemented",
          primary: item.binding.span,
        });
        continue;
      }

      const name = isSafeIdentifier(item.binding.name)
        ? item.binding.name
        : `$hex${Number(item.binding.symbol)}`;
      if (item.exported) {
        if (item.kind === "Fun") {
          declarations.push(
            renderFunctionDeclaration(
              name,
              item.binding.scheme,
              item.value,
              isSafeIdentifier(item.binding.name),
            ),
          );
          if (!isSafeIdentifier(item.binding.name)) {
            declarations.push(`export { ${name} as ${item.binding.name} };`);
          }
        } else if (isSafeIdentifier(item.binding.name)) {
          declarations.push(
            `export declare const ${name}: ${renderScheme(
              item.binding.scheme,
              item.value,
            )};`,
          );
        } else {
          declarations.push(
            `declare const ${name}: ${renderScheme(
              item.binding.scheme,
              item.value,
            )};`,
          );
          declarations.push(`export { ${name} as ${item.binding.name} };`);
        }
        isExternalModule = true;
      } else if (item.kind === "Fun") {
        declarations.push(
          renderFunctionDeclaration(name, item.binding.scheme, item.value, false),
        );
      } else {
        declarations.push(
          `declare const ${name}: ${renderScheme(
            item.binding.scheme,
            item.value,
          )};`,
        );
      }
    }

    if (!isExternalModule) declarations.push("export {};");

    return {
      kind: "TypeScriptPreview",
      fileId: this.#module.fileId,
      text: `${declarations.join("\n")}\n`,
      diagnostics: this.#diagnostics.toArray(),
    };
  }
}

type SourceEntry = ItemEntry | CommentEntry;

interface PatternPlan {
  readonly tests: readonly string[];
  readonly bindings: readonly string[];
}

function expandOrPatterns(pattern: Core.Pattern): readonly Core.Pattern[] {
  switch (pattern.kind) {
    case "Or":
      return pattern.alternatives.flatMap(expandOrPatterns);
    case "As":
      return expandOrPatterns(pattern.pattern).map((nested) => ({
        ...pattern,
        pattern: nested,
      }));
    case "Tuple":
      return combinations(pattern.elements.map(expandOrPatterns)).map(
        (elements) => ({ ...pattern, elements }),
      );
    case "Record":
      return combinations(pattern.fields.map((field) =>
        expandOrPatterns(field.pattern).map((nested) => ({
          ...field,
          pattern: nested,
        }))
      )).map((fields) => ({ ...pattern, fields }));
    case "Constructor":
      return combinations(pattern.arguments.map(expandOrPatterns)).map(
        (arguments_) => ({ ...pattern, arguments: arguments_ }),
      );
    default:
      return [pattern];
  }
}

function combinations<T>(groups: readonly (readonly T[])[]): readonly T[][] {
  return groups.reduce<readonly T[][]>(
    (results, group) => results.flatMap((result) =>
      group.map((value) => [...result, value])
    ),
    [[]],
  );
}

function combinePatternPlans(plans: readonly PatternPlan[]): PatternPlan {
  return {
    tests: plans.flatMap(({ tests }) => tests),
    bindings: plans.flatMap(({ bindings }) => bindings),
  };
}

function isSimpleSwitchPattern(pattern: Core.Pattern): boolean {
  return pattern.kind === "Constructor"
    ? pattern.arguments.every(isSimplePayloadBindingPattern)
    : pattern.kind === "Binding" || pattern.kind === "Wildcard";
}

function isSimplePayloadBindingPattern(pattern: Core.Pattern): boolean {
  switch (pattern.kind) {
    case "Binding":
    case "Wildcard":
    case "Unit":
      return true;
    case "Tuple":
      return pattern.elements.every(isSimplePayloadBindingPattern);
    case "Record":
      return pattern.fields.every((field) =>
        isSimplePayloadBindingPattern(field.pattern)
      );
    case "Boolean":
    case "Integer":
    case "String":
    case "Constructor":
    case "As":
    case "Or":
      return false;
  }
}

interface ItemEntry {
  readonly kind: "Item";
  readonly item: Core.Item;
  readonly span: Source.Span;
}

interface CommentEntry {
  readonly kind: "Comment";
  readonly comment: Source.Comment;
  readonly span: Source.Span;
}

function trailingComments(
  items: readonly Core.Item[],
  comments: readonly Source.Comment[],
): ReadonlyMap<Core.Item, readonly Source.Comment[]> {
  const result = new Map<Core.Item, Source.Comment[]>();
  for (const comment of comments) {
    if (comment.kind !== "Line") continue;
    const item = items.findLast(
      (candidate) =>
        candidate.span.end.line === comment.span.start.line &&
        candidate.span.end.offset <= comment.span.start.offset,
    );
    if (item === undefined) continue;
    const existing = result.get(item) ?? [];
    existing.push(comment);
    result.set(item, existing);
  }
  return result;
}

function sourceEntries(
  items: readonly Core.Item[],
  comments: readonly Source.Comment[],
  trailing: ReadonlyMap<Core.Item, readonly Source.Comment[]>,
): SourceEntry[] {
  const trailingSet = new Set([...trailing.values()].flat());
  return [
    ...items.map((item): ItemEntry => ({ kind: "Item", item, span: item.span })),
    ...comments
      .filter(
        (comment) =>
          comment.span.start.column === 0 && !trailingSet.has(comment),
      )
      .map(
        (comment): CommentEntry => ({
          kind: "Comment",
          comment,
          span: comment.span,
        }),
      ),
  ].sort((left, right) => left.span.start.offset - right.span.start.offset);
}

function commentLines(comment: Source.Comment): string[] {
  return comment.text.split(/\r\n|\r|\n/u);
}

/** Preserves vertical separation where top-level source entries align. */
function blankLinesBetween(previous: Source.Span, next: Source.Span): number {
  return Math.max(0, next.start.line - previous.end.line - 1);
}

type Helper = "checkedPower" | "compareFloat" | "compareString" | "floatEquals";

enum Precedence {
  Arrow = 1,
  Conditional,
  LogicalOr,
  LogicalAnd,
  Equality,
  Relational,
  Additive,
  Multiplicative,
  Exponentiation,
  Unary,
  Call,
  Primary,
}

function expressionPrecedence(expression: Core.Expr): Precedence {
  switch (expression.kind) {
    case "Lambda":
      return Precedence.Arrow;
    case "If":
      return Precedence.Conditional;
    case "Logical":
      return expression.operation === "And"
        ? Precedence.LogicalAnd
        : Precedence.LogicalOr;
    case "LogicalNot":
      return Precedence.Unary;
    case "FieldAccess":
    case "TupleAccess":
    case "Call":
    case "ConsoleLog":
      return Precedence.Call;
    case "Record":
      return Precedence.Primary;
    case "ConstraintCall":
      if (expression.evidence.kind !== "Primitive") return Precedence.Call;
      switch (expression.member) {
        case "add":
        case "subtract":
        case "concat":
          return Precedence.Additive;
        case "multiply":
        case "divide":
          return Precedence.Multiplicative;
        case "pow":
          return expression.evidence.instance === "Float"
            ? Precedence.Exponentiation
            : Precedence.Call;
        case "negate":
          return Precedence.Unary;
      }
    case "ComparisonChain":
      return expression.steps.length === 1
        ? comparisonPrecedence(expression.steps[0]!)
        : Precedence.Call;
    case "String":
      if (expression.parts.length === 1 && expression.parts[0]?.kind === "Text") {
        return Precedence.Primary;
      }
      return expression.parts.length > 1
        ? Precedence.Additive
        : Precedence.Conditional;
    case "Match":
    case "ConvertInt":
    case "Block":
      return Precedence.Call;
    case "Name":
    case "Unit":
    case "Boolean":
    case "Number":
    case "BigInt":
    case "Float":
    case "Tuple":
    case "ErrorExpr":
      return Precedence.Primary;
  }
}

function comparisonPrecedence(step: Core.ComparisonStep): Precedence {
  return step.test === "Equal" || step.test === "NotEqual"
    ? Precedence.Equality
    : Precedence.Relational;
}

function renderHelper(helper: Helper): string[] {
  switch (helper) {
    case "floatEquals":
      return [
        "function $hexFloatEquals(left, right) {",
        "  return left === right || (Number.isNaN(left) && Number.isNaN(right));",
        "}",
      ];
    case "compareFloat":
      return [
        "function $hexCompareFloat(left, right) {",
        "  if (Number.isNaN(left)) return Number.isNaN(right) ? 0 : 1;",
        "  if (Number.isNaN(right)) return -1;",
        "  return left < right ? -1 : left > right ? 1 : 0;",
        "}",
      ];
    case "compareString":
      return [
        "function $hexCompareString(left, right) {",
        "  const leftPoints = Array.from(left);",
        "  const rightPoints = Array.from(right);",
        "  const length = Math.min(leftPoints.length, rightPoints.length);",
        "  for (let index = 0; index < length; index += 1) {",
        "    const leftPoint = leftPoints[index].codePointAt(0);",
        "    const rightPoint = rightPoints[index].codePointAt(0);",
        "    if (leftPoint < rightPoint) return -1;",
        "    if (leftPoint > rightPoint) return 1;",
        "  }",
        "  return leftPoints.length < rightPoints.length ? -1 : leftPoints.length > rightPoints.length ? 1 : 0;",
        "}",
      ];
    case "checkedPower":
      return [
        "function $hexCheckedPower(base, exponent) {",
        "  if (exponent < 0) {",
        '    const error = new Error("an integer exponent cannot be negative");',
        '    error.name = "NegativeExponentError";',
        "    throw error;",
        "  }",
        "  return base ** exponent;",
        "}",
      ];
  }
}

function dictionaryEntries(scheme: Typed.Scheme): readonly {
  readonly constraint: Typed.ConstraintName;
  readonly variable: Typed.TypeVariableId;
}[] {
  return scheme.constraints
    .flatMap((constraint) =>
      constraint.type.kind === "Variable"
        ? [{ constraint: constraint.name, variable: constraint.type.id }]
        : [],
    )
    .sort(
      (left, right) =>
        Number(left.variable) - Number(right.variable) ||
        left.constraint.localeCompare(right.constraint),
    );
}

function dictionaryParameterName(
  constraint: Typed.ConstraintName,
  variable: Typed.TypeVariableId,
): string {
  return `__dict${constraint}_${Number(variable)}`;
}

function evidenceKey(
  variable: Typed.TypeVariableId,
  constraint: Typed.ConstraintName,
): string {
  return `${Number(variable)}:${constraint}`;
}

function comparisonFromOrder(test: Core.ComparisonTest, order: string): string {
  switch (test) {
    case "Less":
      return `${order} < 0`;
    case "Greater":
      return `${order} > 0`;
    case "LessEqual":
      return `${order} <= 0`;
    case "GreaterEqual":
      return `${order} >= 0`;
    case "Equal":
      return `${order} === 0`;
    case "NotEqual":
      return `${order} !== 0`;
  }
}

function comparisonOperator(
  test: Exclude<Core.ComparisonTest, "Equal" | "NotEqual">,
): string {
  switch (test) {
    case "Less":
      return "<";
    case "Greater":
      return ">";
    case "LessEqual":
      return "<=";
    case "GreaterEqual":
      return ">=";
  }
}

function renderScheme(scheme: Typed.Scheme, value?: Core.Expr): string {
  const variables = typeVariableNames(scheme.variables);
  const type = scheme.type;
  if (type.kind !== "Function") return renderType(type, variables, false);
  const lambda = value?.kind === "Lambda" ? value : undefined;

  const genericNames = scheme.variables.map((variable) => variables.get(variable)!);
  const generics = genericNames.length === 0
    ? ""
    : `<${genericNames.join(", ")}>`;
  const parameters = type.parameters.map(
    (parameter, index) =>
      `${declarationParameterName(lambda?.parameters[index], index)}: ` +
      renderType(parameter, variables, false),
  );
  return (
    `${generics}(${parameters.join(", ")}) => ` +
    renderType(type.result, variables, true, lambda?.body)
  );
}

function renderFunctionDeclaration(
  name: string,
  scheme: Typed.Scheme,
  value: Core.LambdaExpr,
  exported: boolean,
): string {
  if (scheme.type.kind !== "Function") {
    const prefix = exported ? "export " : "";
    return `${prefix}declare const ${name}: ${renderScheme(scheme, value)};`;
  }

  const variables = typeVariableNames(scheme.variables);
  const genericNames = scheme.variables.map((variable) => variables.get(variable)!);
  const generics = genericNames.length === 0
    ? ""
    : `<${genericNames.join(", ")}>`;
  const parameters = scheme.type.parameters.map(
    (parameter, index) =>
      `${declarationParameterName(value.parameters[index], index)}: ` +
      renderType(parameter, variables, false),
  );
  const result = renderType(
    scheme.type.result,
    variables,
    true,
    value.body,
  );
  const prefix = exported ? "export " : "";
  return (
    `${prefix}declare function ${name}${generics}` +
    `(${parameters.join(", ")}): ${result};`
  );
}

function renderType(
  type: Typed.Type,
  variables: ReadonlyMap<Typed.TypeVariableId, string>,
  returnPosition: boolean,
  value?: Core.Expr,
): string {
  switch (type.kind) {
    case "Primitive":
      switch (type.name) {
        case "Int":
        case "Float":
          return "number";
        case "Bool":
          return "boolean";
        case "String":
          return "string";
        case "BigInt":
          return "bigint";
        case "Unit":
          return returnPosition ? "void" : "undefined";
      }
    case "Variable":
      return variables.get(type.id) ?? "unknown";
    case "Union":
      return type.name;
    case "Tuple":
      return (
        `[${type.elements.map((element) =>
          renderType(element, variables, false)
        ).join(", ")}]`
      );
    case "Record":
      const record = `{ ${type.fields.map(({ name, type: field }) =>
        `${name}: ${renderType(field, variables, false)}`
      ).join("; ")} }`;
      return type.tail === undefined
        ? record
        : `(${record} & ${variables.get(type.tail) ?? "object"})`;
    case "Function": {
      const lambda = value?.kind === "Lambda" ? value : undefined;
      const parameters = type.parameters.map(
        (parameter, index) =>
          `${declarationParameterName(lambda?.parameters[index], index)}: ` +
          renderType(parameter, variables, false),
      );
      return (
        `(${parameters.join(", ")}) => ` +
        renderType(type.result, variables, true, lambda?.body)
      );
    }
    case "Error":
      return "unknown";
  }
}

function declarationParameterName(
  binding: Core.Binding | undefined,
  index: number,
): string {
  if (binding === undefined) return `arg${index}`;
  return isSafeIdentifier(binding.name)
    ? binding.name
    : `$hex${Number(binding.symbol)}`;
}

function renderUnionDeclaration(
  item: Core.UnionItem,
  exported: boolean,
): string {
  const prefix = exported ? "export " : "";
  const tagged = item.constructors.some(({ slots }) => slots.length > 0);
  const alternatives = item.constructors
    .map(({ name, slots }) => tagged
      ? `{ tag: ${JSON.stringify(name)}${slots.map(({ field, type }) => `; ${field}: ${renderType(type, new Map(), false)}`).join("")} }`
      : JSON.stringify(name))
    .join(" | ");
  return `${prefix}type ${item.name} = ${alternatives};`;
}

function patternBindings(pattern: Core.Pattern): Core.Binding[] {
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
      return [...patternBindings(pattern.pattern), pattern.binding];
    case "Or":
      return pattern.alternatives[0] === undefined
        ? []
        : patternBindings(pattern.alternatives[0]);
    case "Tuple":
      return pattern.elements.flatMap(patternBindings);
    case "Record":
      return pattern.fields.flatMap((field) => patternBindings(field.pattern));
    case "Constructor":
      return pattern.arguments.flatMap(patternBindings);
  }
}

function typeVariableNames(
  variables: readonly Typed.TypeVariableId[],
): ReadonlyMap<Typed.TypeVariableId, string> {
  return new Map(
    variables.map((variable, index) => [variable, typeVariableName(index)]),
  );
}

function typeVariableName(index: number): string {
  const letter = String.fromCharCode("a".charCodeAt(0) + (index % 26));
  const cycle = Math.floor(index / 26);
  return cycle === 0 ? letter : `${letter}${cycle}`;
}

function cleanNumber(spelling: string): string {
  return spelling.replaceAll("_", "");
}

function indent(depth: number): string {
  return "  ".repeat(depth);
}

const reservedWords = new Set([
  "await",
  "break",
  "case",
  "catch",
  "class",
  "const",
  "continue",
  "debugger",
  "default",
  "delete",
  "do",
  "else",
  "enum",
  "export",
  "extends",
  "false",
  "finally",
  "for",
  "function",
  "if",
  "implements",
  "import",
  "in",
  "instanceof",
  "interface",
  "let",
  "new",
  "null",
  "package",
  "private",
  "protected",
  "public",
  "return",
  "static",
  "super",
  "switch",
  "this",
  "throw",
  "true",
  "try",
  "typeof",
  "var",
  "void",
  "while",
  "with",
  "yield",
]);

function isSafeIdentifier(name: string): boolean {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(name) && !reservedWords.has(name);
}
