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
import { idContinue, idStart } from "../lexer/unicode-17.js";
import {
  planFundamentalSpecializations,
  specializeItem,
  type FundamentalSpecialization,
  type SpecializationCollision,
  type SpecializableItem,
} from "./specializations.js";

export interface JavaScriptEmissionOptions {
  /** Includes private editions for inspection tools; ordinary builds omit them. */
  readonly previewPrivateSpecializations?: boolean;
}

export function emitJavaScript(
  module: Core.Module,
  options: JavaScriptEmissionOptions = {},
): Emitted.JavaScript {
  return new JavaScriptEmitter(module, options).emit();
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
  readonly #recordConstructors = new Set<Resolved.SymbolId>();
  readonly #constrainedImports = new Map<Resolved.SymbolId, string>();
  readonly #exceptions = new Map<Resolved.SymbolId, Core.ExceptionItem>();
  readonly #constraints = new Map<string, Core.ConstraintItem>();
  readonly #nullaryExceptions = new Set<Resolved.SymbolId>();
  readonly #generatedNames: GeneratedNames;
  readonly #helpers = new Set<Helper>();
  readonly #helperNames = new Map<Helper, string>();
  readonly #exports: string[] = [];
  readonly #module: Core.Module;
  readonly #specializations: readonly FundamentalSpecialization[];
  readonly #generatedBodies: {
    readonly specialization: FundamentalSpecialization;
    readonly text: string;
  }[] = [];

  constructor(module: Core.Module, options: JavaScriptEmissionOptions) {
    this.#module = module;
    this.#generatedNames = new GeneratedNames(module.symbols.map(({ name }) => name));
    for (const diagnostic of module.diagnostics) this.#diagnostics.add(diagnostic);
    for (const symbol of module.symbols) this.#symbols.set(symbol.id, symbol);
    for (const union of module.unions) {
      const tagged = union.constructors.some(({ slots }) => (slots?.length ?? 0) > 0);
      for (const constructor of union.constructors) {
        this.#constructors.set(constructor.symbol, { constructor, tagged });
      }
    }
    for (const record of module.records) {
      this.#recordConstructors.add(record.constructor.symbol);
    }
    for (const item of module.items) {
      if (item.kind === "ConstraintDeclaration") this.#constraints.set(item.name, item);
      if (item.kind !== "Exception") continue;
      this.#exceptions.set(item.binding.symbol, item);
      if (item.slots.length === 0) this.#nullaryExceptions.add(item.binding.symbol);
    }
    for (const item of module.items) {
      if (item.kind !== "Import" || item.form.kind === "Effect") continue;
      for (const name of item.form.names) {
        if (name.symbol === undefined) continue;
        const symbol = this.#symbols.get(name.symbol);
        if ((symbol?.scheme.constraints.length ?? 0) > 0) {
          this.#constrainedImports.set(
            name.symbol,
            item.form.kind === "Namespace"
              ? internalConstrainedExportName(name.symbol)
              : name.local,
          );
        }
      }
    }
    const plan = planFundamentalSpecializations(
      module,
      options.previewPrivateSpecializations ?? false,
    );
    this.#specializations = plan.specializations;
    addSpecializationCollisionDiagnostics(this.#diagnostics, module, plan.collisions);
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
      .flatMap((helper) =>
        renderHelper(helper, this.#helperName(helper), (dependency) =>
          this.#helperName(dependency)
        )
      );
    const lines = helpers.length === 0 ? body : [...helpers, "", ...body];

    const text = lines.length === 0 ? "" : `${lines.join("\n")}\n`;
    return {
      kind: "JavaScript",
      fileId: this.#module.fileId,
      text,
      generatedSections: this.#generatedSections(text),
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
    if (item.kind === "TypeAlias") return [];
    if (item.kind === "Import") {
      const specifier = JSON.stringify(emittedModuleSpecifier(item.specifier));
      if (item.form.kind === "Effect") return [`${prefix}import ${specifier};`];
      if (item.form.kind === "Namespace") {
        const constrained = item.form.names.flatMap(({ symbol }) => {
          if (symbol === undefined || !this.#constrainedImports.has(symbol)) return [];
          const name = internalConstrainedExportName(symbol);
          return [name];
        });
        return [
          `${prefix}import * as ${item.form.alias} from ${specifier};`,
          ...(constrained.length === 0
            ? []
            : [`${prefix}import { ${constrained.join(", ")} } from ${specifier};`]),
        ];
      }
      const names = item.form.names.filter(({ typeOnly }) => typeOnly !== true).map(({ imported, local, symbol }) => {
        const source = symbol !== undefined && this.#constrainedImports.has(symbol)
          ? internalConstrainedExportName(symbol)
          : imported;
        return source === local ? source : `${source} as ${local}`;
      });
      return names.length === 0
        ? [`${prefix}import ${specifier};`]
        : [`${prefix}import { ${names.join(", ")} } from ${specifier};`];
    }
    if (item.kind === "ConstraintDeclaration") {
      return item.members.map((member) => {
        const name = this.#identifier(member.binding.symbol, member.binding.name);
        const sourceParameters = member.parameters.map((parameter) =>
          this.#identifier(parameter.symbol, parameter.name)
        );
        const dictionaries = dictionaryEntries(member.binding.scheme).map(
          ({ constraint, variable }) => dictionaryParameterName(constraint, variable),
        );
        const dictionary = dictionaries[0] ?? "undefined";
        return `${prefix}const ${name} = (${[...sourceParameters, ...dictionaries].join(", ")}) => ${dictionary}.${member.binding.name}(${sourceParameters.join(", ")});`;
      });
    }
    if (item.kind === "Honor") {
      const localEvidence = new Map(evidenceNames);
      const parameters = item.typeParameters.flatMap((parameter) =>
        parameter.constraints.map((constraint) => {
          const name = dictionaryParameterName(constraint, parameter.variable);
          localEvidence.set(evidenceKey(parameter.variable, constraint), name);
          return name;
        })
      );
      const localDictionary = parameters.length === 0
        ? item.dictionary
        : this.#generatedNames.fresh("instance");
      const declaration = this.#constraints.get(item.constraint);
      if (declaration !== undefined) {
        localEvidence.set(
          evidenceKey(declaration.subject, item.constraint),
          localDictionary,
        );
      }
      const superconstraints = item.superconstraints.map(({ name, evidence }) => {
        const slot = (name[0]?.toLowerCase() ?? "") + name.slice(1);
        return `${slot}: ${this.#emitEvidence(evidence, name, item.span, localEvidence)}`;
      });
      const members = item.derived
        ? this.#derivedMembers(item, localEvidence)
        : item.members.map((member) =>
            `${member.name}: ${this.#emitExpr(member.value, depth, localEvidence)}`
          );
      const completedMembers =
        !item.derived && item.constraint === "Eq" &&
          !item.members.some(({ name }) => name === "notEquals")
          ? [
              ...members,
              `notEquals: (__hex_left, __hex_right) => !${localDictionary}.equals(__hex_left, __hex_right)`,
            ]
          : members;
      const value = `{ ${[...superconstraints, ...completedMembers].join(", ")} }`;
      if (parameters.length === 0) {
        return [`${prefix}const ${item.dictionary} = ${value};`];
      }
      return [
        `${prefix}const ${item.dictionary} = (${parameters.join(", ")}) => {`,
        `${indent(depth + 1)}const ${localDictionary} = ${value};`,
        `${indent(depth + 1)}return ${localDictionary};`,
        `${prefix}};`,
      ];
    }
    if (item.kind === "ExprItem") {
      if (item.expression.kind === "While") {
        return this.#emitWhile(item.expression, depth, evidenceNames);
      }
      if (item.expression.kind === "For") {
        return this.#emitFor(item.expression, depth, evidenceNames);
      }
      if (item.expression.kind === "Assignment") {
        const target = this.#identifier(
          item.expression.target.symbol,
          item.expression.target.text,
        );
        const value = this.#emitExpr(item.expression.value, depth, evidenceNames);
        return [`${prefix}${target} = ${value};`];
      }
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
        const matchName = this.#generatedNames.fresh("match");
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
        if (item.exported && !item.opaque && depth === 0) {
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
    if (item.kind === "RecordDeclaration") {
      const name = this.#identifier(item.constructor.symbol, item.constructor.name);
      if (item.exported && !item.opaque && depth === 0) {
        this.#exports.push(
          name === item.name ? `export { ${name} };` : `export { ${name} as ${item.name} };`,
        );
      }
      return [`${prefix}const ${name} = __hex_record => __hex_record;`];
    }
    if (item.kind === "Exception") {
      const exceptionHelper = this.#useHelper("exception");
      const name = this.#identifier(item.binding.symbol, item.binding.name);
      const parameters = item.slots.map(({ field }) => field);
      const message = item.slots.some(({ field }) => field === "message")
        ? "message"
        : '""';
      const fields = `{ ${item.slots.map(({ field }) => `${field}: ${field}`).join(", ")} }`;
      const value = item.slots.length === 0
        ? `() => ${exceptionHelper}(${JSON.stringify(item.binding.name)}, "", {})`
        : `(${parameters.join(", ")}) => ${exceptionHelper}(${JSON.stringify(item.binding.name)}, ${message}, ${fields})`;
      if (item.exported && depth === 0) {
        this.#exports.push(
          name === item.binding.name
            ? `export { ${name} };`
            : `export { ${name} as ${item.binding.name} };`,
        );
      }
      return [`${prefix}const ${name} = ${value};`];
    }

    if (item.kind === "Fun") {
      const name = this.#identifier(item.binding.symbol, item.binding.name);
      this.#recordExport(item, name, depth);
      return [
        ...this.#emitFunctionDeclaration(item, name, depth, evidenceNames),
        ...this.#emitSpecializations(item, depth),
      ];
    }

    if (item.kind === "Var") {
      const name = this.#identifier(item.binding.symbol, item.binding.name);
      const value = this.#emitExpr(item.value, depth, evidenceNames);
      return [`${prefix}let ${name} = ${value};`];
    }

    const name = this.#identifier(item.binding.symbol, item.binding.name);
    const value = this.#emitBindingValue(item, depth, evidenceNames);
    this.#recordExport(item, name, depth);
    return [
      `${prefix}const ${name} = ${value};`,
      ...this.#emitSpecializations(item, depth),
    ];
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
      case "Vector":
        return "";
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
      this.#exports.push(
        `export { ${name} as ${internalConstrainedExportName(item.binding.symbol)} };`,
      );
      for (const specialization of this.#specializationsFor(item.binding.symbol)) {
        this.#exports.push(`export { ${specialization.name} };`);
      }
      return;
    }
    this.#exports.push(
      name === item.binding.name
        ? `export { ${name} };`
        : `export { ${name} as ${item.binding.name} };`,
    );
  }

  #emitFunctionDeclaration(
    item: Core.FunItem | Core.LetItem,
    name: string,
    depth: number,
    evidenceNames: EvidenceNames,
  ): string[] {
    if (item.value.kind !== "Lambda") return [];
    const localEvidence = new Map(evidenceNames);
    const dictionaryParameters = dictionaryEntries(item.binding.scheme).map(
      ({ constraint, variable }) => {
        const dictionary = dictionaryParameterName(constraint, variable);
        localEvidence.set(evidenceKey(variable, constraint), dictionary);
        return dictionary;
      },
    );
    const parameters = [
      ...item.value.parameters.map((parameter) =>
        this.#identifier(parameter.symbol, parameter.name),
      ),
      ...dictionaryParameters,
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

  #emitSpecializations(item: Core.Item, depth: number): string[] {
    if (depth !== 0 || (item.kind !== "Let" && item.kind !== "Fun")) return [];
    const lines: string[] = [];
    for (const specialization of this.#specializationsFor(item.binding.symbol)) {
      const specialized = specializeItem(item as SpecializableItem, specialization);
      const emitted = this.#emitFunctionDeclaration(
        specialized,
        specialization.name,
        depth,
        new Map(),
      );
      if (emitted.length === 0) continue;
      this.#generatedBodies.push({ specialization, text: emitted.join("\n") });
      lines.push(...emitted);
    }
    return lines;
  }

  #specializationsFor(
    symbol: Resolved.SymbolId,
  ): readonly FundamentalSpecialization[] {
    return this.#specializations.filter(({ sourceSymbol }) => sourceSymbol === symbol);
  }

  #generatedSections(text: string): readonly Emitted.GeneratedSection[] {
    let cursor = 0;
    return this.#generatedBodies.flatMap(({ specialization, text: body }) => {
      const startOffset = text.indexOf(body, cursor);
      if (startOffset < 0) return [];
      const endOffset = startOffset + body.length;
      cursor = endOffset;
      return [{
        kind: "FundamentalSpecialization" as const,
        sourceName: specialization.sourceName,
        generatedName: specialization.name,
        typeArguments: specialization.assignment.map(({ type }) => type),
        startOffset,
        endOffset,
        bytes: utf8ByteLength(body),
      }];
    });
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
        if (this.#constrainedImports.has(expression.symbol)) {
          return this.#constrainedImports.get(expression.symbol)!;
        }
        if (expression.text.includes(".")) return expression.text;
        const name = this.#identifier(expression.symbol, expression.text);
        return this.#nullaryExceptions.has(expression.symbol) ? `${name}()` : name;
      case "SeqOperation":
        this.#useHelper("seq");
        return this.#useHelper(
          expression.operation === "iterate"
            ? "seqIterate"
            : expression.operation === "map"
            ? "seqMap"
            : expression.operation === "filter"
            ? "seqFilter"
            : "seqTake",
        );
      case "CollectionOperation":
        return collectionOperation(
          expression.collection,
          expression.operation,
          this.#useHelper("persistentCollections"),
          expression.hashEvidence === undefined
            ? undefined
            : this.#emitEvidence(expression.hashEvidence, "Hash", expression.span, evidenceNames),
          this.#useHelper("seq"),
        );
      case "Unit":
      case "ErrorExpr":
        return "undefined";
      case "Boolean":
        return String(expression.value);
      case "Number": {
        const literal = cleanNumber(expression.decimal);
        return expression.representation === "Float" ? `${literal}.0` : literal;
      }
      case "BigInt":
        return `${cleanNumber(expression.decimal)}n`;
      case "Float":
        return cleanNumber(expression.spelling);
      case "ConvertInt":
        return this.#emitConvertInt(expression, evidenceNames);
      case "WidenInt":
        return this.#emitWidenInt(expression, depth, evidenceNames);
      case "String":
        return this.#emitString(expression, depth, evidenceNames);
      case "Tuple":
      case "Vector":
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
      case "Index": {
        const receiver = this.#emitExpr(expression.receiver, depth, evidenceNames);
        const index = this.#emitExpr(expression.index, depth, evidenceNames);
        if (expression.operation === "MapElement") {
          const hash = this.#emitEvidence(
            expression.hashEvidence ?? { kind: "Error" },
            "Hash",
            expression.span,
            evidenceNames,
          );
          return `${this.#useHelper("persistentCollections")}.mapGet(${hash})(${receiver}, ${index})`;
        }
        const helper = expression.operation === "VectorElement"
          ? "vectorIndex"
          : expression.operation === "VectorSlice"
          ? "vectorSlice"
          : expression.operation === "StringElement"
          ? "stringIndex"
          : "stringSlice";
        return `${this.#useHelper(helper)}(${receiver}, ${index})`;
      }
      case "Hash": {
        const dictionary = this.#emitEvidence(expression.evidence, "Hash", expression.span, evidenceNames);
        return `${dictionary}.hash(${this.#emitExpr(expression.value, depth, evidenceNames)})`;
      }
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
      case "While": {
        const lines = this.#emitWhile(expression, depth + 1, evidenceNames);
        return `(() => {\n${lines.join("\n")}\n${indent(depth)}})()`;
      }
      case "For": {
        const lines = this.#emitFor(expression, depth + 1, evidenceNames);
        return `(() => {\n${lines.join("\n")}\n${indent(depth)}})()`;
      }
      case "Match":
        return this.#emitMatch(expression, depth, evidenceNames);
      case "Throw":
        return `(() => { throw ${this.#emitExpr(expression.exception, depth, evidenceNames)}; })()`;
      case "Try":
        return this.#emitTry(expression, depth, evidenceNames);
      case "Call":
        if (
          expression.callee.kind === "Name" &&
          this.#recordConstructors.has(expression.callee.symbol) &&
          expression.arguments.length === 1
        ) {
          return this.#emitExpr(expression.arguments[0]!, depth, evidenceNames);
        }
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
      case "Range": {
        const helper = this.#useHelper("range");
        return `${helper}(${this.#emitExpr(expression.start, depth, evidenceNames)}, ${this.#emitExpr(expression.end, depth, evidenceNames)})`;
      }
      case "Assignment": {
        const target = this.#identifier(expression.target.symbol, expression.target.text);
        return `void (${target} = ${this.#emitExpr(expression.value, depth, evidenceNames)})`;
      }
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
      ...expression.parameters.map((parameter) =>
        this.#identifier(parameter.symbol, parameter.name),
      ),
      ...dictionaryParameters,
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
    if (expression.kind === "While") {
      return this.#emitWhile(expression, depth, evidenceNames);
    }
    if (expression.kind === "For") {
      return this.#emitFor(expression, depth, evidenceNames);
    }
    if (expression.kind === "Assignment") {
      const target = this.#identifier(expression.target.symbol, expression.target.text);
      return [`${indent(depth)}${target} = ${this.#emitExpr(expression.value, depth, evidenceNames)};`];
    }
    return [
      `${indent(depth)}return ${this.#emitExpr(expression, depth, evidenceNames)};`,
    ];
  }

  #emitWhile(
    expression: Core.WhileExpr,
    depth: number,
    evidenceNames: EvidenceNames,
  ): string[] {
    const prefix = indent(depth);
    const condition = this.#emitExpr(expression.condition, depth, evidenceNames);
    const body = expression.body.items.flatMap((item) =>
      this.#emitItem(item, depth + 1, evidenceNames, false)
    );
    return [
      `${prefix}while (${condition}) {`,
      ...body,
      `${prefix}}`,
    ];
  }

  #emitFor(
    expression: Core.ForExpr,
    depth: number,
    evidenceNames: EvidenceNames,
  ): string[] {
    const prefix = indent(depth);
    const source = this.#emitExpr(expression.iterable, depth, evidenceNames);
    const iterable = expression.iteration === undefined
      ? source
      : `${this.#emitEvidence(expression.iteration, "Iterable", expression.span, evidenceNames)}.iterate(${source})`;
    if (expression.pattern.kind === "Binding") {
      const name = this.#identifier(
        expression.pattern.binding.symbol,
        expression.pattern.binding.name,
      );
      const body = expression.body.items.flatMap((item) =>
        this.#emitItem(item, depth + 1, evidenceNames, false)
      );
      return [
        `${prefix}for (const ${name} of ${iterable}) {`,
        ...body,
        `${prefix}}`,
      ];
    }

    const itemName = this.#generatedNames.fresh("item");
    const plan = this.#emitPatternPlan(expression.pattern, itemName);
    const bindings = plan.bindings.map((binding) =>
      `${indent(depth + 1)}${binding}`
    );
    const body = expression.body.items.flatMap((item) =>
      this.#emitItem(item, depth + 1, evidenceNames, false)
    );
    return [
      `${prefix}for (const ${itemName} of ${iterable}) {`,
      ...bindings,
      ...body,
      `${prefix}}`,
    ];
  }

  #emitCall(
    expression: Core.CallExpr,
    depth: number,
    evidenceNames: EvidenceNames,
  ): string {
    const specialization = this.#callSpecialization(expression);
    const emittedCallee = specialization?.name ??
      this.#emitExpr(expression.callee, depth, evidenceNames);
    const callee =
      expression.callee.kind === "Name" ||
        expression.callee.kind === "SeqOperation" ||
        expression.callee.kind === "Call"
        ? emittedCallee
        : `(${emittedCallee})`;
    const arguments_ = expression.arguments.map((argument) =>
      this.#emitExpr(argument, depth, evidenceNames),
    );
    if (specialization === undefined) {
      arguments_.push(...expression.evidence.map(({ constraint, value }) => {
        if (value.kind === "Dictionary") {
          return this.#dictionary(
            value.variable,
            value.constraint ?? constraint,
            expression.span,
            evidenceNames,
            value.path,
          );
        }
        return this.#emitEvidence(value, constraint, expression.span, evidenceNames);
      }));
    }
    return `${callee}(${arguments_.join(", ")})`;
  }

  #callSpecialization(
    expression: Core.CallExpr,
  ): FundamentalSpecialization | undefined {
    if (expression.callee.kind !== "Name") return undefined;
    const candidates = this.#specializationsFor(expression.callee.symbol);
    if (candidates.length === 0) return undefined;

    const symbol = this.#symbols.get(expression.callee.symbol);
    if (symbol === undefined) return undefined;
    const entries = dictionaryEntries(symbol.scheme);
    if (entries.length !== expression.evidence.length) return undefined;

    const assignments = new Map<Typed.TypeVariableId, Typed.PrimitiveName>();
    for (const [index, entry] of entries.entries()) {
      const evidence = expression.evidence[index]?.value;
      if (evidence?.kind !== "Primitive") return undefined;
      const previous = assignments.get(entry.variable);
      if (previous !== undefined && previous !== evidence.instance) return undefined;
      assignments.set(entry.variable, evidence.instance);
    }

    return candidates.find((candidate) =>
      candidate.assignment.every(({ variable, type }) =>
        assignments.get(variable) === type
      )
    );
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

  #emitTry(
    expression: Core.TryExpr,
    depth: number,
    evidenceNames: EvidenceNames,
  ): string {
    const error = this.#generatedNames.fresh("error");
    const prefix = indent(depth);
    const inner = indent(depth + 1);
    const armIndent = indent(depth + 2);
    const lines = [
      "(() => {",
      `${inner}try {`,
      `${armIndent}return ${this.#emitExpr(expression.body, depth + 2, evidenceNames)};`,
      `${inner}} catch (${error}) {`,
    ];
    for (const arm of expression.arms) {
      for (const alternative of expandOrPatterns(arm.pattern)) {
        const plan = this.#emitPatternPlan(alternative, error, true);
        const condition = plan.tests.length === 0
          ? "true"
          : plan.tests.join(" && ");
        lines.push(`${armIndent}if (${condition}) {`);
        const bodyDepth = depth + 3;
        const bodyIndent = indent(bodyDepth);
        for (const binding of plan.bindings) {
          lines.push(`${bodyIndent}${binding}`);
        }
        if (arm.guard === undefined) {
          lines.push(
            `${bodyIndent}return ${this.#emitExpr(arm.body, bodyDepth, evidenceNames)};`,
          );
        } else {
          const guard = this.#emitExpr(arm.guard, bodyDepth, evidenceNames);
          lines.push(`${bodyIndent}if (${guard}) {`);
          lines.push(
            `${indent(bodyDepth + 1)}return ${this.#emitExpr(arm.body, bodyDepth + 1, evidenceNames)};`,
            `${bodyIndent}}`,
          );
        }
        lines.push(`${armIndent}}`);
      }
    }
    lines.push(
      `${armIndent}throw ${error};`,
      `${inner}}`,
      `${prefix}})()`,
    );
    return lines.join("\n");
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
      ? this.#generatedNames.fresh("match")
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
    const matchName = this.#generatedNames.fresh("match");
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

  #emitPatternPlan(
    pattern: Core.Pattern,
    value: string,
    exceptionPatterns = false,
  ): PatternPlan {
    switch (pattern.kind) {
      case "Wildcard":
        return { tests: [], bindings: [] };
      case "Unit":
        return { tests: [`${value} === undefined`], bindings: [] };
      case "As": {
        const nested = this.#emitPatternPlan(
          pattern.pattern,
          value,
          exceptionPatterns,
        );
        const name = this.#identifier(pattern.binding.symbol, pattern.binding.name);
        return {
          tests: nested.tests,
          bindings: [...nested.bindings, `const ${name} = ${value};`],
        };
      }
      case "Or": {
        const alternatives = pattern.alternatives.map((alternative) =>
          this.#emitPatternPlan(alternative, value, exceptionPatterns)
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
            this.#emitPatternPlan(
              element,
              `${value}[${index}]`,
              exceptionPatterns,
            )
          ),
        );
      case "Vector": {
        const fixed = pattern.elements.length;
        const plans = pattern.elements.map((element, index) => {
          const position = pattern.rest === undefined || index < pattern.rest.index
            ? String(index)
            : `${value}.length - ${fixed - index}`;
          return this.#emitPatternPlan(
            element,
            `${value}[${position}]`,
            exceptionPatterns,
          );
        });
        const combined = combinePatternPlans(plans);
        const restEnd = pattern.rest === undefined || pattern.rest.index === fixed
          ? ""
          : `, ${value}.length - ${fixed - pattern.rest.index}`;
        const restPlan = pattern.rest?.pattern === undefined
          ? { tests: [], bindings: [] }
          : this.#emitPatternPlan(
              pattern.rest.pattern,
              `${value}.slice(${pattern.rest.index}${restEnd})`,
              exceptionPatterns,
            );
        return {
          tests: [
            pattern.rest === undefined
              ? `${value}.length === ${fixed}`
              : `${value}.length >= ${fixed}`,
            ...combined.tests,
            ...restPlan.tests,
          ],
          bindings: [...combined.bindings, ...restPlan.bindings],
        };
      }
      case "Record":
        return combinePatternPlans(
          pattern.fields.map((field) =>
            this.#emitPatternPlan(
              field.pattern,
              `${value}.${field.name}`,
              exceptionPatterns,
            )
          ),
        );
      case "Constructor": {
        const exception = exceptionPatterns
          ? this.#exceptions.get(pattern.symbol)
          : undefined;
        const metadata = this.#constructors.get(pattern.symbol);
        const test = exception !== undefined
          ? `${value} != null && ${value}.$hex === true && ${value}.name === ${JSON.stringify(pattern.text)}`
          : metadata?.tagged
          ? `${value}.tag === ${JSON.stringify(pattern.text)}`
          : `${value} === ${JSON.stringify(pattern.text)}`;
        const payloads = pattern.arguments.map((argument, index) => {
          const field = exception?.slots[index]?.field ??
            metadata?.constructor.slots[index]?.field ??
            `item${index + 1}`;
          return this.#emitPatternPlan(
            argument,
            `${value}.${field}`,
            exceptionPatterns,
          );
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
    if (expression.evidence.kind === "Primitive") {
      const literal = cleanNumber(expression.decimal);
      if (expression.evidence.instance === "BigInt") return `${literal}n`;
      if (expression.evidence.instance === "Float") return `${literal}.0`;
      return literal;
    }
    if (expression.evidence.kind === "Instance" || expression.evidence.kind === "Structural") {
      const dictionary = this.#emitEvidence(
        expression.evidence,
        "Num",
        expression.span,
        evidenceNames,
      );
      return `${dictionary}.fromInt(${cleanNumber(expression.decimal)})`;
    }
    if (expression.evidence.kind !== "Dictionary") return "undefined";
    const dictionary = this.#dictionary(
      expression.evidence.variable,
      expression.evidence.constraint ?? "Num",
      expression.span,
      evidenceNames,
      expression.evidence.path,
    );
    return `${dictionary}.fromInt(${cleanNumber(expression.decimal)})`;
  }

  #emitWidenInt(
    expression: Core.WidenIntExpr,
    depth: number,
    evidenceNames: EvidenceNames,
  ): string {
    const value = this.#emitExpr(expression.value, depth, evidenceNames);
    if (expression.evidence.kind === "Primitive") {
      return expression.evidence.instance === "BigInt"
        ? `BigInt(${value})`
        : value;
    }
    if (expression.evidence.kind === "Dictionary") {
      const dictionary = this.#dictionary(
        expression.evidence.variable,
        expression.evidence.constraint ?? "Num",
        expression.span,
        evidenceNames,
        expression.evidence.path,
      );
      return `${dictionary}.fromInt(${value})`;
    }
    if (expression.evidence.kind === "Instance" || expression.evidence.kind === "Structural") {
      const dictionary = this.#emitEvidence(
        expression.evidence,
        "Num",
        expression.span,
        evidenceNames,
      );
      return `${dictionary}.fromInt(${value})`;
    }
    return "undefined";
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
          part.evidence.constraint ?? "Show",
          part.span,
          evidenceNames,
          part.evidence.path,
        );
        return `${dictionary}.show(${value})`;
      }
      if (part.evidence.kind === "Instance" || part.evidence.kind === "Structural") {
        const dictionary = this.#emitEvidence(
          part.evidence,
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
        expression.evidence.constraint ?? expression.constraint,
        expression.span,
        evidenceNames,
        expression.evidence.path,
      );
      return `${dictionary}.${expression.member}(${arguments_.join(", ")})`;
    }
    if (expression.evidence.kind === "Error") return "undefined";
    if (expression.evidence.kind === "Instance" || expression.evidence.kind === "Structural") {
      const dictionary = this.#emitEvidence(
        expression.evidence,
        expression.constraint,
        expression.span,
        evidenceNames,
      );
      return `${dictionary}.${expression.member}(${arguments_.join(", ")})`;
    }

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
        return `${this.#useHelper("checkedPower")}(${arguments_[0] ?? "undefined"}, ${arguments_[1] ?? "undefined"})`;
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
    const operandNames = expression.operands.map(() =>
      this.#generatedNames.fresh("compare")
    );
    const lines = [
      `${prefix}const ${operandNames[0]} = ${this.#emitExpr(expression.operands[0]!, depth + 1, evidenceNames)};`,
    ];
    for (let index = 0; index < expression.steps.length; index += 1) {
      const operandName = operandNames[index + 1]!;
      lines.push(
        `${prefix}const ${operandName} = ${this.#emitExpr(expression.operands[index + 1]!, depth + 1, evidenceNames)};`,
      );
      const test = this.#emitComparisonStep(
        expression.steps[index]!,
        operandNames[index]!,
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
    const constraint =
      step.test === "Equal" || step.test === "NotEqual" ? "Eq" : "Ord";
    if (step.evidence.kind === "Dictionary") {
      const dictionary = this.#dictionary(
        step.evidence.variable,
        step.evidence.constraint ?? constraint,
        step.span,
        evidenceNames,
        step.evidence.path,
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
    if (step.evidence.kind === "Instance" || step.evidence.kind === "Structural") {
      const dictionary = this.#emitEvidence(
        step.evidence,
        constraint,
        step.span,
        evidenceNames,
      );
      if (step.test === "Equal") return `${dictionary}.equals(${left}, ${right})`;
      if (step.test === "NotEqual") return `${dictionary}.notEquals(${left}, ${right})`;
      return comparisonFromOrder(step.test, `${dictionary}.compare(${left}, ${right})`);
    }

    const instance = step.evidence.instance;
    if (step.test === "Equal" || step.test === "NotEqual") {
      let equality: string;
      if (instance === "Float") {
        equality = `${this.#useHelper("floatEquals")}(${left}, ${right})`;
      } else {
        equality = `${left} === ${right}`;
      }
      return step.test === "Equal" ? equality : `!(${equality})`;
    }

    if (instance === "Float") {
      return comparisonFromOrder(
        step.test,
        `${this.#useHelper("compareFloat")}(${left}, ${right})`,
      );
    }
    if (instance === "String") {
      return comparisonFromOrder(
        step.test,
        `${this.#useHelper("compareString")}(${left}, ${right})`,
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
    path: readonly string[] = [],
  ): string {
    const name = evidenceNames.get(evidenceKey(variable, constraint));
    if (name !== undefined) {
      return path.reduce((dictionary, slot) => `${dictionary}.${slot}`, name);
    }
    this.#diagnostics.add({
      severity: "error",
      message: `missing \`${constraint}\` evidence during JavaScript emission`,
      primary: span,
    });
    return "undefined";
  }

  /** Selects direct Eq evidence or the nested Eq superconstraint of Hash. */
  #equalityDictionary(
    variable: Typed.TypeVariableId,
    evidenceNames: EvidenceNames,
  ): string {
    if (evidenceNames.has(evidenceKey(variable, "Eq"))) {
      return this.#dictionary(variable, "Eq", this.#module.span, evidenceNames);
    }
    return `${this.#dictionary(variable, "Hash", this.#module.span, evidenceNames)}.eq`;
  }

  #derivedMembers(item: Core.HonorItem, evidenceNames: EvidenceNames): readonly string[] {
    const subject = item.subject;
    const equals = (left: string, right: string): string =>
      this.#derivedEquals(subject, left, right, evidenceNames);
    if (item.constraint === "Eq") {
      return [
        `equals: (__hex_left, __hex_right) => ${equals("__hex_left", "__hex_right")}`,
        `notEquals: (__hex_left, __hex_right) => !(${equals("__hex_left", "__hex_right")})`,
      ];
    }
    if (item.constraint === "Show") {
      return [`show: __hex_value => ${this.#derivedShow(subject, "__hex_value", evidenceNames)}`];
    }
    if (item.constraint === "Ord") {
      return [
        `compare: (__hex_left, __hex_right) => ${this.#derivedCompare(
          subject,
          "__hex_left",
          "__hex_right",
          evidenceNames,
        )}`,
      ];
    }
    return [
      `hash: __hex_value => ${this.#derivedHash(subject, "__hex_value", evidenceNames)}`,
    ];
  }

  /** Builds law-preserving hashes from the same structural components as derived Eq. */
  #derivedHash(type: Typed.Type, value: string, evidenceNames: EvidenceNames): string {
    if (type.kind === "Primitive") return `${this.#useHelper("stableHash")}(${value})`;
    if (type.kind === "Variable") {
      return `${this.#dictionary(type.id, "Hash", this.#module.span, evidenceNames)}.hash(${value})`;
    }
    const combine = (parts: readonly string[]): string =>
      parts.reduce(
        (seed, part) => `${this.#useHelper("mixHash")}(${seed}, ${part})`,
        "0",
      );
    if (type.kind === "Tuple") {
      return combine(type.elements.map((element, index) =>
        this.#derivedHash(element, `${value}[${index}]`, evidenceNames)
      ));
    }
    if (type.kind === "Vector") {
      const elementHash = this.#derivedHash(type.element, "__hex_element", evidenceNames);
      return `(() => { let __hex_hash = 0; for (const __hex_element of ${value}) __hex_hash = ${this.#useHelper("mixHash")}(__hex_hash, ${elementHash}); return __hex_hash; })()`;
    }
    if (type.kind === "Set") {
      const dictionary = type.element.kind === "Variable"
        ? this.#dictionary(type.element.id, "Hash", this.#module.span, evidenceNames)
        : this.#emitEvidence({ kind: "Structural", type: type.element }, "Hash", this.#module.span, evidenceNames);
      return `${this.#useHelper("persistentCollections")}.setHash(${dictionary}, ${this.#useHelper("mixHash")})(${value})`;
    }
    if (type.kind === "Map") {
      const key = type.key.kind === "Variable"
        ? this.#dictionary(type.key.id, "Hash", this.#module.span, evidenceNames)
        : this.#emitEvidence({ kind: "Structural", type: type.key }, "Hash", this.#module.span, evidenceNames);
      const item = type.value.kind === "Variable"
        ? this.#dictionary(type.value.id, "Hash", this.#module.span, evidenceNames)
        : this.#emitEvidence({ kind: "Structural", type: type.value }, "Hash", this.#module.span, evidenceNames);
      return `${this.#useHelper("persistentCollections")}.mapHash(${key}, ${item}, ${this.#useHelper("mixHash")})(${value})`;
    }
    if (type.kind === "Record") {
      return combine([...type.fields].sort((a, b) => a.name.localeCompare(b.name)).map((field) =>
        this.#derivedHash(field.type, `${value}.${field.name}`, evidenceNames)
      ));
    }
    if (type.kind === "NominalRecord") {
      const record = this.#module.records.find(({ id }) => id === type.record);
      if (record === undefined) return "0";
      const replacements = new Map(record.parameters.map((parameter, index) => [
        parameter,
        type.arguments[index] ?? { kind: "Error" as const },
      ]));
      return combine([...record.fields].sort((a, b) => a.name.localeCompare(b.name)).map((field) =>
        this.#derivedHash(substituteType(field.type, replacements), `${value}.${field.name}`, evidenceNames)
      ));
    }
    if (type.kind === "Union") {
      const union = this.#module.unions.find(({ id }) => id === type.union);
      if (union === undefined) return "0";
      const tagged = union.constructors.some(({ slots }) => slots.length > 0);
      if (!tagged) return `${this.#useHelper("stableHash")}(${value})`;
      const replacements = new Map(union.parameters.map((parameter, index) => [
        parameter,
        type.arguments[index] ?? { kind: "Error" as const },
      ]));
      const cases = union.constructors.map((constructor) => {
        const parts = [
          `${this.#useHelper("stableHash")}(${JSON.stringify(constructor.name)})`,
          ...constructor.slots.map((slot) => this.#derivedHash(
            substituteType(slot.type, replacements),
            `${value}.${slot.field}`,
            evidenceNames,
          )),
        ];
        return `case ${JSON.stringify(constructor.name)}: return ${combine(parts)};`;
      }).join(" ");
      return `(() => { switch (${value}.tag) { ${cases} default: return 0; } })()`;
    }
    return "0";
  }

  #derivedCompare(
    type: Typed.Type,
    left: string,
    right: string,
    evidenceNames: EvidenceNames,
  ): string {
    if (type.kind === "Primitive") {
      if (type.name === "Float") return `${this.#useHelper("compareFloat")}(${left}, ${right})`;
      if (type.name === "String") return `${this.#useHelper("compareString")}(${left}, ${right})`;
      if (type.name === "Unit") return "0";
      return `${left} < ${right} ? -1 : ${left} > ${right} ? 1 : 0`;
    }
    if (type.kind === "Variable") {
      return `${this.#dictionary(type.id, "Ord", this.#module.span, evidenceNames)}.compare(${left}, ${right})`;
    }
    if (type.kind === "Tuple") {
      return lexicographicComparison(type.elements.map((element, index) =>
        this.#derivedCompare(element, `${left}[${index}]`, `${right}[${index}]`, evidenceNames)
      ));
    }
    if (type.kind === "Vector") {
      const elementOrder = this.#derivedCompare(type.element, `${left}[__hex_index]`, `${right}[__hex_index]`, evidenceNames);
      return `(() => { const __hex_length = Math.min(${left}.length, ${right}.length); for (let __hex_index = 0; __hex_index < __hex_length; __hex_index += 1) { const __hex_order = ${elementOrder}; if (__hex_order !== 0) return __hex_order; } return ${left}.length - ${right}.length; })()`;
    }
    if (type.kind === "Record") {
      return lexicographicComparison(
        [...type.fields].sort((a, b) => a.name.localeCompare(b.name)).map((field) =>
          this.#derivedCompare(field.type, `${left}.${field.name}`, `${right}.${field.name}`, evidenceNames)
        ),
      );
    }
    if (type.kind === "NominalRecord") {
      const record = this.#module.records.find(({ id }) => id === type.record);
      if (record === undefined) return "0";
      const replacements = new Map(record.parameters.map((parameter, index) => [
        parameter,
        type.arguments[index] ?? { kind: "Error" as const },
      ]));
      return lexicographicComparison(
        [...record.fields].sort((a, b) => a.name.localeCompare(b.name)).map((field) =>
          this.#derivedCompare(
            substituteType(field.type, replacements),
            `${left}.${field.name}`,
            `${right}.${field.name}`,
            evidenceNames,
          )
        ),
      );
    }
    if (type.kind === "Union") {
      const union = this.#module.unions.find(({ id }) => id === type.union);
      if (union === undefined) return "0";
      const tag = (value: string) => union.constructors
        .map((constructor, index) => `${value} === ${JSON.stringify(constructor.name)} ? ${index} : `)
        .join("") + "-1";
      const tagged = union.constructors.some(({ slots }) => slots.length > 0);
      if (!tagged) return `(${tag(left)}) - (${tag(right)})`;
      const replacements = new Map(union.parameters.map((parameter, index) => [
        parameter,
        type.arguments[index] ?? { kind: "Error" as const },
      ]));
      const cases = union.constructors.map((constructor) => {
        const comparison = lexicographicComparison(constructor.slots.map((slot) =>
          this.#derivedCompare(
            substituteType(slot.type, replacements),
            `${left}.${slot.field}`,
            `${right}.${slot.field}`,
            evidenceNames,
          )
        ));
        return `case ${JSON.stringify(constructor.name)}: return ${comparison};`;
      }).join(" ");
      return `(() => { const __hex_tagOrder = (${tag(`${left}.tag`)}) - (${tag(`${right}.tag`)}); if (__hex_tagOrder !== 0) return __hex_tagOrder; switch (${left}.tag) { ${cases} default: return 0; } })()`;
    }
    return "0";
  }

  #derivedEquals(
    type: Typed.Type,
    left: string,
    right: string,
    evidenceNames: EvidenceNames,
    hashBacked = false,
  ): string {
    if (type.kind === "Primitive") {
      return type.name === "Float"
        ? `${this.#useHelper("floatEquals")}(${left}, ${right})`
        : `${left} === ${right}`;
    }
    if (type.kind === "Variable") {
      const dictionary = hashBacked
        ? `${this.#dictionary(type.id, "Hash", this.#module.span, evidenceNames)}.eq`
        : this.#equalityDictionary(type.id, evidenceNames);
      return `${dictionary}.equals(${left}, ${right})`;
    }
    if (type.kind === "Tuple") {
      return type.elements.map((element, index) =>
        this.#derivedEquals(element, `${left}[${index}]`, `${right}[${index}]`, evidenceNames, hashBacked)
      ).join(" && ") || "true";
    }
    if (type.kind === "Vector") {
      const elementEquals = this.#derivedEquals(type.element, `${left}[__hex_index]`, `${right}[__hex_index]`, evidenceNames, hashBacked);
      return `${left}.length === ${right}.length && (() => { for (let __hex_index = 0; __hex_index < ${left}.length; __hex_index += 1) if (!(${elementEquals})) return false; return true; })()`;
    }
    if (type.kind === "Set") {
      const hash = type.element.kind === "Variable"
        ? this.#dictionary(type.element.id, "Hash", this.#module.span, evidenceNames)
        : this.#emitEvidence({ kind: "Structural", type: type.element }, "Hash", this.#module.span, evidenceNames);
      return `${this.#useHelper("persistentCollections")}.setEquals(${hash})(${left}, ${right})`;
    }
    if (type.kind === "Map") {
      const hash = type.key.kind === "Variable"
        ? this.#dictionary(type.key.id, "Hash", this.#module.span, evidenceNames)
        : this.#emitEvidence({ kind: "Structural", type: type.key }, "Hash", this.#module.span, evidenceNames);
      const equals = type.value.kind === "Variable"
        ? hashBacked
          ? `${this.#dictionary(type.value.id, "Hash", this.#module.span, evidenceNames)}.eq`
          : this.#equalityDictionary(type.value.id, evidenceNames)
        : this.#emitEvidence({ kind: "Structural", type: type.value }, "Eq", this.#module.span, evidenceNames);
      return `${this.#useHelper("persistentCollections")}.mapEquals(${hash}, ${equals})(${left}, ${right})`;
    }
    if (type.kind === "Record") {
      return type.fields.map((field) =>
        this.#derivedEquals(field.type, `${left}.${field.name}`, `${right}.${field.name}`, evidenceNames, hashBacked)
      ).join(" && ") || "true";
    }
    if (type.kind === "NominalRecord") {
      const record = this.#module.records.find(({ id }) => id === type.record);
      if (record === undefined) return `${left} === ${right}`;
      const replacements = new Map(record.parameters.map((parameter, index) => [
        parameter,
        type.arguments[index] ?? { kind: "Error" as const },
      ]));
      return record.fields.map((field) =>
        this.#derivedEquals(
          substituteType(field.type, replacements),
          `${left}.${field.name}`,
          `${right}.${field.name}`,
          evidenceNames,
          hashBacked,
        )
      ).join(" && ") || "true";
    }
    if (type.kind === "Union") {
      const union = this.#module.unions.find(({ id }) => id === type.union);
      if (union === undefined) return `${left} === ${right}`;
      const tagged = union.constructors.some(({ slots }) => slots.length > 0);
      if (!tagged) return `${left} === ${right}`;
      const replacements = new Map(union.parameters.map((parameter, index) => [
        parameter,
        type.arguments[index] ?? { kind: "Error" as const },
      ]));
      const cases = union.constructors.map((constructor) => {
        const fields = constructor.slots.map((slot) =>
          this.#derivedEquals(
            substituteType(slot.type, replacements),
            `${left}.${slot.field}`,
            `${right}.${slot.field}`,
            evidenceNames,
            hashBacked,
          )
        ).join(" && ") || "true";
        return `case ${JSON.stringify(constructor.name)}: return ${fields};`;
      }).join(" ");
      return `${left}.tag === ${right}.tag && (() => { switch (${left}.tag) { ${cases} default: return false; } })()`;
    }
    return `${left} === ${right}`;
  }

  #derivedShow(
    type: Typed.Type,
    value: string,
    evidenceNames: EvidenceNames,
  ): string {
    if (type.kind === "Primitive") {
      if (type.name === "String") return value;
      if (type.name === "Unit") return '"()"';
      return `String(${value})`;
    }
    if (type.kind === "Variable") {
      return `${this.#dictionary(type.id, "Show", this.#module.span, evidenceNames)}.show(${value})`;
    }
    if (type.kind === "Tuple") {
      const elements = type.elements.map((element, index) =>
        this.#derivedShow(element, `${value}[${index}]`, evidenceNames)
      );
      return elements.length === 0
        ? '"()"'
        : `"(" + ${elements.join(' + ", " + ')} + ")"`;
    }
    if (type.kind === "Vector") {
      const shown = this.#derivedShow(type.element, "__hex_element", evidenceNames);
      return `"[" + ${value}.map(__hex_element => ${shown}).join(", ") + "]"`;
    }
    if (type.kind === "Set") {
      const shown = this.#derivedShow(type.element, "__hex_element", evidenceNames);
      return `${value}.size === 0 ? "Set.empty" : "Set.fromVector([" + [...${value}].map(__hex_element => ${shown}).join(", ") + "])"`;
    }
    if (type.kind === "Map") {
      const key = this.#derivedShow(type.key, "__hex_entry[0]", evidenceNames);
      const item = this.#derivedShow(type.value, "__hex_entry[1]", evidenceNames);
      return `${value}.size === 0 ? "Map.empty" : "Map.fromVector([" + [...${value}].map(__hex_entry => "(" + ${key} + ", " + ${item} + ")").join(", ") + "])"`;
    }
    if (type.kind === "Record") {
      const fields = [...type.fields].sort((a, b) => a.name.localeCompare(b.name)).map((field) =>
        `${JSON.stringify(`${field.name}: `)} + ${this.#derivedShow(
          field.type,
          `${value}.${field.name}`,
          evidenceNames,
        )}`
      );
      return fields.length === 0 ? '"{}"' : `"{" + ${fields.join(' + ", " + ')} + "}"`;
    }
    if (type.kind === "NominalRecord") {
      const record = this.#module.records.find(({ id }) => id === type.record);
      if (record !== undefined) {
        const replacements = new Map(record.parameters.map((parameter, index) => [
          parameter,
          type.arguments[index] ?? { kind: "Error" as const },
        ]));
        const fields = [...record.fields].sort((a, b) => a.name.localeCompare(b.name)).map((field) =>
          `${JSON.stringify(`${field.name}: `)} + ${this.#derivedShow(
            substituteType(field.type, replacements),
            `${value}.${field.name}`,
            evidenceNames,
          )}`
        );
        return fields.length === 0
          ? '"{}"'
          : `"{" + ${fields.join(` + ", " + `)} + "}"`;
      }
    }
    if (type.kind === "Union") {
      const union = this.#module.unions.find(({ id }) => id === type.union);
      if (union !== undefined) {
        const tagged = union.constructors.some(({ slots }) => slots.length > 0);
        if (!tagged) return value;
        const replacements = new Map(union.parameters.map((parameter, index) => [
          parameter,
          type.arguments[index] ?? { kind: "Error" as const },
        ]));
        const cases = union.constructors.map((constructor) => {
          const payload = constructor.slots.map((slot) =>
            this.#derivedShow(
              substituteType(slot.type, replacements),
              `${value}.${slot.field}`,
              evidenceNames,
            )
          );
          const shown = payload.length === 0
            ? JSON.stringify(constructor.name)
            : `${JSON.stringify(`${constructor.name}(`)} + ${payload.join(' + ", " + ')} + ")"`;
          return `case ${JSON.stringify(constructor.name)}: return ${shown};`;
        }).join(" ");
        return `(() => { switch (${value}.tag) { ${cases} default: return "<unknown>"; } })()`;
      }
    }
    return `JSON.stringify(${value})`;
  }

  #emitEvidence(
    evidence: Core.Evidence,
    constraint: Typed.ConstraintName,
    span: Core.Expr["span"],
    evidenceNames: EvidenceNames,
  ): string {
    if (evidence.kind === "Dictionary") {
      return this.#dictionary(
        evidence.variable,
        evidence.constraint ?? constraint,
        span,
        evidenceNames,
        evidence.path,
      );
    }
    if (evidence.kind === "Primitive") {
      return primitiveDictionary(
        constraint,
        evidence.instance,
        (helper) => this.#useHelper(helper),
      );
    }
    if (evidence.kind === "Structural") {
      if (constraint === "Hash") {
        const equals = this.#derivedEquals(evidence.type, "__hex_left", "__hex_right", evidenceNames, true);
        return `({ eq: { equals: (__hex_left, __hex_right) => ${equals}, notEquals: (__hex_left, __hex_right) => !(${equals}) }, hash: __hex_value => ${this.#derivedHash(evidence.type, "__hex_value", evidenceNames)} })`;
      }
      if (constraint === "Eq") {
        const equals = this.#derivedEquals(evidence.type, "__hex_left", "__hex_right", evidenceNames);
        return `({ equals: (__hex_left, __hex_right) => ${equals}, notEquals: (__hex_left, __hex_right) => !(${equals}) })`;
      }
      if (constraint === "Ord") {
        return `({ compare: (__hex_left, __hex_right) => ${this.#derivedCompare(evidence.type, "__hex_left", "__hex_right", evidenceNames)} })`;
      }
      if (constraint === "Show") {
        return `({ show: __hex_value => ${this.#derivedShow(evidence.type, "__hex_value", evidenceNames)} })`;
      }
      return "({})";
    }
    if (evidence.kind === "Instance") {
      const arguments_ = evidence.arguments.map((argument) =>
        this.#emitEvidence(
          argument.evidence,
          argument.constraint,
          span,
          evidenceNames,
        )
      );
      return arguments_.length === 0
        ? evidence.dictionary
        : `${evidence.dictionary}(${arguments_.join(", ")})`;
    }
    return "undefined";
  }

  #identifier(symbol: Resolved.SymbolId, sourceName: string): string {
    return isSafeIdentifier(sourceName) ? sourceName : `__hex_binding${Number(symbol)}`;
  }

  #useHelper(helper: Helper): string {
    this.#helpers.add(helper);
    if (helper === "stringIndex") this.#helpers.add("vectorIndex");
    if (helper === "stringSlice") this.#helpers.add("vectorSlice");
    return this.#helperName(helper);
  }

  #helperName(helper: Helper): string {
    const existing = this.#helperNames.get(helper);
    if (existing !== undefined) return existing;
    const name = this.#generatedNames.fixed(helper);
    this.#helperNames.set(helper, name);
    return name;
  }
}

class DeclarationEmitter {
  readonly #diagnostics = new Diagnostics.Bag();
  readonly #module: Core.Module;
  readonly #specializations: readonly FundamentalSpecialization[];
  readonly #opaqueBrands: ReadonlyMap<string, string>;

  constructor(module: Core.Module) {
    this.#module = module;
    this.#opaqueBrands = opaqueBrandNames(module);
    for (const diagnostic of module.diagnostics) this.#diagnostics.add(diagnostic);
    const plan = planFundamentalSpecializations(module);
    this.#specializations = plan.specializations;
    addSpecializationCollisionDiagnostics(this.#diagnostics, module, plan.collisions);
  }

  emit(): Emitted.Declarations {
    const declarations: string[] = [];
    let isExternalModule = false;
    for (const item of this.#module.items) {
      if (item.kind === "TypeAlias") {
        if (!item.exported) continue;
        const variables = typeVariableNames(item.parameters);
        const names = item.parameters.map((parameter) => variables.get(parameter)!);
        const generics = names.length === 0 ? "" : `<${names.join(", ")}>`;
        declarations.push(`export type ${item.name}${generics} = ${renderType(item.type, variables, false)};`);
        isExternalModule = true;
        continue;
      }
      if (item.kind === "Union") {
        if (item.opaque && item.exported) {
          const brand = this.#opaqueBrands.get(item.name)!;
          const variables = typeVariableNames(item.parameters);
          const names = item.parameters.map((parameter) => variables.get(parameter)!);
          const generics = names.length === 0 ? "" : `<${names.join(", ")}>`;
          declarations.push(`declare const ${brand}: unique symbol;`);
          declarations.push(`export type ${item.name}${generics} = { readonly [${brand}]: ${names.length === 0 ? "never" : names.join(" | ")} };`);
          isExternalModule = true;
          continue;
        }
        declarations.push(renderUnionDeclaration(item, item.exported));
        if (item.exported) {
          isExternalModule = true;
          const variables = typeVariableNames(item.parameters);
          const genericNames = item.parameters.map((parameter) => variables.get(parameter)!);
          const generics = genericNames.length === 0
            ? ""
            : `<${genericNames.join(", ")}>`;
          const result = item.parameters.length === 0
            ? item.name
            : `${item.name}<${genericNames.join(", ")}>`;
          for (const constructor of item.constructors) {
            const type = constructor.slots.length === 0
              ? item.parameters.length === 0
                ? item.name
                : `${item.name}<${item.parameters.map(() => "never").join(", ")}>`
              : `${generics}(${constructor.slots.map((slot, index) => `${slot.field || `arg${index}`}: ${renderType(slot.type, variables, false)}`).join(", ")}) => ${result}`;
            declarations.push(
              `export declare const ${constructor.name}: ${type};`,
            );
          }
        }
        continue;
      }
      if (item.kind === "RecordDeclaration") {
        if (!item.exported) continue;
        const variables = typeVariableNames(item.parameters);
        const names = item.parameters.map((parameter) => variables.get(parameter)!);
        const generics = names.length === 0 ? "" : `<${names.join(", ")}>`;
        if (item.opaque) {
          const brand = this.#opaqueBrands.get(item.name)!;
          declarations.push(`declare const ${brand}: unique symbol;`);
          declarations.push(`export type ${item.name}${generics} = { readonly [${brand}]: ${names.length === 0 ? "never" : names.join(" | ")} };`);
          isExternalModule = true;
          continue;
        }
        const recordType = `{ ${item.fields.map((field) =>
          `${field.name}: ${renderType(field.type, variables, false)}`
        ).join("; ")} }`;
        const result = names.length === 0 ? item.name : `${item.name}<${names.join(", ")}>`;
        declarations.push(`export type ${item.name}${generics} = ${recordType};`);
        declarations.push(`export declare const ${item.name}: ${generics}(${item.fields.length === 0 ? "record: {}" : `record: ${recordType}`}) => ${result};`);
        isExternalModule = true;
        continue;
      }
      if (item.kind === "Exception") {
        if (!item.exported) continue;
        const face = `Error & { readonly $hex: true; readonly name: ${JSON.stringify(item.binding.name)}${item.slots.map((slot) => `; readonly ${slot.field}: ${renderType(slot.type, new Map(), false)}`).join("")} }`;
        declarations.push(`export type ${item.binding.name} = ${face};`);
        const constructor = item.slots.length === 0
          ? `() => ${item.binding.name}`
          : `(${item.slots.map((slot) => `${slot.field}: ${renderType(slot.type, new Map(), false)}`).join(", ")}) => ${item.binding.name}`;
        declarations.push(`export declare const ${item.binding.name}: ${constructor};`);
        isExternalModule = true;
        continue;
      }
      if ((item.kind !== "Let" && item.kind !== "Fun") || !item.exported) {
        continue;
      }
      if (item.binding.scheme.constraints.length > 0) {
        const specializations = this.#specializations.filter(
          ({ sourceSymbol }) => sourceSymbol === item.binding.symbol,
        );
        for (const specialization of specializations) {
          if (item.value.kind !== "Lambda") continue;
          const specialized = specializeItem(item as SpecializableItem, specialization);
          declarations.push(
            renderFunctionDeclaration(
              specialization.name,
              specialized.binding.scheme,
              specialized.value as Core.LambdaExpr,
              true,
            ),
          );
        }
        isExternalModule ||= specializations.length > 0;
        continue;
      }
      isExternalModule = true;

      const safeName = isSafeIdentifier(item.binding.name);
      const local = safeName
        ? item.binding.name
        : `__hex_binding${Number(item.binding.symbol)}`;
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
  readonly #specializations: readonly FundamentalSpecialization[];
  readonly #opaqueBrands: ReadonlyMap<string, string>;

  constructor(module: Core.Module) {
    this.#module = module;
    this.#opaqueBrands = opaqueBrandNames(module);
    for (const diagnostic of module.diagnostics) this.#diagnostics.add(diagnostic);
    const plan = planFundamentalSpecializations(module, true);
    this.#specializations = plan.specializations;
    addSpecializationCollisionDiagnostics(this.#diagnostics, module, plan.collisions);
  }

  emit(): Emitted.TypeScriptPreview {
    const declarations: string[] = [];
    let isExternalModule = false;

    for (const item of this.#module.items) {
      if (item.kind === "TypeAlias") {
        const prefix = item.exported ? "export " : "";
        const variables = typeVariableNames(item.parameters);
        const names = item.parameters.map((parameter) => variables.get(parameter)!);
        const generics = names.length === 0 ? "" : `<${names.join(", ")}>`;
        declarations.push(`${prefix}type ${item.name}${generics} = ${renderType(item.type, variables, false)};`);
        isExternalModule ||= item.exported;
        continue;
      }
      if (item.kind === "Union") {
        if (item.opaque) {
          const prefix = item.exported ? "export " : "";
          const brand = this.#opaqueBrands.get(item.name)!;
          const variables = typeVariableNames(item.parameters);
          const names = item.parameters.map((parameter) => variables.get(parameter)!);
          const generics = names.length === 0 ? "" : `<${names.join(", ")}>`;
          declarations.push(`declare const ${brand}: unique symbol;`);
          declarations.push(`${prefix}type ${item.name}${generics} = { readonly [${brand}]: ${names.length === 0 ? "never" : names.join(" | ")} };`);
          isExternalModule ||= item.exported;
          continue;
        }
        declarations.push(renderUnionDeclaration(item, item.exported));
        const variables = typeVariableNames(item.parameters);
        const genericNames = item.parameters.map((parameter) => variables.get(parameter)!);
        const generics = genericNames.length === 0 ? "" : `<${genericNames.join(", ")}>`;
        const result = item.parameters.length === 0
          ? item.name
          : `${item.name}<${genericNames.join(", ")}>`;
        for (const constructor of item.constructors) {
          const prefix = item.exported ? "export " : "";
          const type = constructor.slots.length === 0
            ? item.parameters.length === 0
              ? item.name
              : `${item.name}<${item.parameters.map(() => "never").join(", ")}>`
            : `${generics}(${constructor.slots.map((slot, index) => `${slot.field || `arg${index}`}: ${renderType(slot.type, variables, false)}`).join(", ")}) => ${result}`;
          declarations.push(
            `${prefix}declare const ${constructor.name}: ${type};`,
          );
        }
        isExternalModule ||= item.exported;
        continue;
      }
      if (item.kind === "RecordDeclaration") {
        const prefix = item.exported ? "export " : "";
        const variables = typeVariableNames(item.parameters);
        const names = item.parameters.map((parameter) => variables.get(parameter)!);
        const generics = names.length === 0 ? "" : `<${names.join(", ")}>`;
        if (item.opaque) {
          const brand = this.#opaqueBrands.get(item.name)!;
          declarations.push(`declare const ${brand}: unique symbol;`);
          declarations.push(`${prefix}type ${item.name}${generics} = { readonly [${brand}]: ${names.length === 0 ? "never" : names.join(" | ")} };`);
          isExternalModule ||= item.exported;
          continue;
        }
        const recordType = `{ ${item.fields.map((field) =>
          `${field.name}: ${renderType(field.type, variables, false)}`
        ).join("; ")} }`;
        const result = names.length === 0 ? item.name : `${item.name}<${names.join(", ")}>`;
        declarations.push(`${prefix}type ${item.name}${generics} = ${recordType};`);
        declarations.push(`${prefix}declare const ${item.name}: ${generics}(record: ${recordType}) => ${result};`);
        isExternalModule ||= item.exported;
        continue;
      }
      if (item.kind === "Exception") {
        const prefix = item.exported ? "export " : "";
        const face = `Error & { readonly $hex: true; readonly name: ${JSON.stringify(item.binding.name)}${item.slots.map((slot) => `; readonly ${slot.field}: ${renderType(slot.type, new Map(), false)}`).join("")} }`;
        declarations.push(`${prefix}type ${item.binding.name} = ${face};`);
        const constructor = item.slots.length === 0
          ? `() => ${item.binding.name}`
          : `(${item.slots.map((slot) => `${slot.field}: ${renderType(slot.type, new Map(), false)}`).join(", ")}) => ${item.binding.name}`;
        declarations.push(`${prefix}declare const ${item.binding.name}: ${constructor};`);
        isExternalModule ||= item.exported;
        continue;
      }
      if (item.kind === "LetPattern") {
        for (const binding of patternBindings(item.pattern)) {
          const name = isSafeIdentifier(binding.name)
            ? binding.name
            : `__hex_binding${Number(binding.symbol)}`;
          declarations.push(
            `declare const ${name}: ${renderScheme(binding.scheme)};`,
          );
        }
        continue;
      }
      if (item.kind !== "Let" && item.kind !== "Fun") continue;
      if (item.binding.scheme.constraints.length > 0) {
        const specializations = this.#specializations.filter(
          ({ sourceSymbol }) => sourceSymbol === item.binding.symbol,
        );
        for (const specialization of specializations) {
          if (item.value.kind !== "Lambda") continue;
          const specialized = specializeItem(item as SpecializableItem, specialization);
          declarations.push(
            renderFunctionDeclaration(
              specialization.name,
              specialized.binding.scheme,
              specialized.value as Core.LambdaExpr,
              item.exported,
            ),
          );
        }
        isExternalModule ||= item.exported && specializations.length > 0;
        continue;
      }

      const name = isSafeIdentifier(item.binding.name)
        ? item.binding.name
        : `__hex_binding${Number(item.binding.symbol)}`;
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

function opaqueBrandNames(module: Core.Module): ReadonlyMap<string, string> {
  const typeNames = module.items.flatMap((item) =>
    item.kind === "TypeAlias" || item.kind === "Union" || item.kind === "RecordDeclaration"
      ? [item.name]
      : []
  );
  const names = new GeneratedNames([
    ...module.symbols.map(({ name }) => name),
    ...typeNames,
  ]);
  return new Map(module.items.flatMap((item) =>
    (item.kind === "Union" || item.kind === "RecordDeclaration") && item.opaque
      ? [[item.name, names.fixed(`opaque_${item.name}`)] as const]
      : []
  ));
}

interface PatternPlan {
  readonly tests: readonly string[];
  readonly bindings: readonly string[];
}

function addSpecializationCollisionDiagnostics(
  diagnostics: Diagnostics.Bag,
  module: Core.Module,
  collisions: readonly SpecializationCollision[],
): void {
  for (const collision of collisions) {
    diagnostics.add({
      severity: collision.specialization.sourceExported ? "error" : "warning",
      message: collision.kind === "explicit"
        ? collision.otherExported
          ? `generated specialization \`${collision.specialization.name}\` conflicts with exported \`${collision.otherSourceName}\`; rename one of the exports`
          : `generated specialization \`${collision.specialization.name}\` conflicts with binding \`${collision.otherSourceName}\`; rename one of the declarations`
        : `generated specialization \`${collision.specialization.name}\` from \`${collision.specialization.sourceName}\` conflicts with the edition generated by \`${collision.otherSourceName}\`; rename one of the exports`,
      primary: module.items.find((item) =>
        (item.kind === "Let" || item.kind === "Fun") &&
        item.binding.symbol === collision.specialization.sourceSymbol
      )?.span ?? module.span,
    });
  }
}

function utf8ByteLength(text: string): number {
  let bytes = 0;
  for (const character of text) {
    const codePoint = character.codePointAt(0)!;
    bytes += codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;
  }
  return bytes;
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
    case "Vector":
      return false;
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

type Helper =
  | "checkedPower"
  | "compareFloat"
  | "compareString"
  | "exception"
  | "floatEquals"
  | "range"
  | "seq"
  | "seqFilter"
  | "seqIterate"
  | "seqMap"
  | "seqTake"
  | "vectorIndex"
  | "vectorSlice"
  | "stringIndex"
  | "stringSlice"
  | "stableHash"
  | "mixHash"
  | "persistentCollections";

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
    case "Index":
    case "Hash":
    case "Call":
    case "ConsoleLog":
    case "While":
    case "For":
    case "Throw":
    case "Try":
    case "Range":
      return Precedence.Call;
    case "Assignment":
      return Precedence.Unary;
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
    case "WidenInt":
      return expression.evidence.kind === "Primitive" &&
          expression.evidence.instance !== "BigInt"
        ? expressionPrecedence(expression.value)
        : Precedence.Call;
    case "Name":
    case "SeqOperation":
    case "CollectionOperation":
    case "Unit":
    case "Boolean":
    case "Number":
    case "BigInt":
    case "Float":
    case "Tuple":
    case "Vector":
    case "ErrorExpr":
      return Precedence.Primary;
  }
}

function comparisonPrecedence(step: Core.ComparisonStep): Precedence {
  return step.test === "Equal" || step.test === "NotEqual"
    ? Precedence.Equality
    : Precedence.Relational;
}

function renderHelper(
  helper: Helper,
  name: string,
  dependencyName: (helper: Helper) => string,
): string[] {
  switch (helper) {
    case "persistentCollections":
      return [
        `const ${name} = (() => {`,
        "  const entries = function* (__hex_node) {",
        "    if (__hex_node === null) return;",
        "    if (__hex_node.kind === 0) { yield* __hex_node.entries; return; }",
        "    for (const __hex_child of __hex_node.children) if (__hex_child !== undefined) yield* entries(__hex_child);",
        "  };",
        "  const find = (__hex_node, __hex_hash, __hex_key, __hex_equals, __hex_shift = 0) => {",
        "    if (__hex_node === null) return undefined;",
        "    if (__hex_node.kind === 0) return __hex_node.hash === __hex_hash ? __hex_node.entries.find(__hex_entry => __hex_equals(__hex_entry[0], __hex_key)) : undefined;",
        "    return find(__hex_node.children[(__hex_hash >>> __hex_shift) & 31] ?? null, __hex_hash, __hex_key, __hex_equals, __hex_shift + 5);",
        "  };",
        "  const join = (__hex_left, __hex_right, __hex_shift) => {",
        "    const __hex_leftIndex = (__hex_left.hash >>> __hex_shift) & 31, __hex_rightIndex = (__hex_right.hash >>> __hex_shift) & 31;",
        "    const __hex_children = [];",
        "    if (__hex_leftIndex === __hex_rightIndex) __hex_children[__hex_leftIndex] = join(__hex_left, __hex_right, __hex_shift + 5);",
        "    else { __hex_children[__hex_leftIndex] = __hex_left; __hex_children[__hex_rightIndex] = __hex_right; }",
        "    return { kind: 1, children: __hex_children };",
        "  };",
        "  const insert = (__hex_node, __hex_hash, __hex_key, __hex_value, __hex_equals, __hex_shift = 0) => {",
        "    const __hex_leaf = { kind: 0, hash: __hex_hash, entries: [[__hex_key, __hex_value]] };",
        "    if (__hex_node === null) return [__hex_leaf, true];",
        "    if (__hex_node.kind === 0) {",
        "      if (__hex_node.hash !== __hex_hash) return [join(__hex_node, __hex_leaf, __hex_shift), true];",
        "      const __hex_index = __hex_node.entries.findIndex(__hex_entry => __hex_equals(__hex_entry[0], __hex_key));",
        "      if (__hex_index < 0) return [{ ...__hex_node, entries: [...__hex_node.entries, [__hex_key, __hex_value]] }, true];",
        "      if (__hex_node.entries[__hex_index][1] === __hex_value) return [__hex_node, false];",
        "      const __hex_updated = __hex_node.entries.slice(); __hex_updated[__hex_index] = [__hex_node.entries[__hex_index][0], __hex_value];",
        "      return [{ ...__hex_node, entries: __hex_updated }, false];",
        "    }",
        "    const __hex_slot = (__hex_hash >>> __hex_shift) & 31, __hex_child = __hex_node.children[__hex_slot] ?? null;",
        "    const [__hex_updated, __hex_added] = insert(__hex_child, __hex_hash, __hex_key, __hex_value, __hex_equals, __hex_shift + 5);",
        "    if (__hex_updated === __hex_child) return [__hex_node, __hex_added];",
        "    const __hex_children = __hex_node.children.slice(); __hex_children[__hex_slot] = __hex_updated;",
        "    return [{ kind: 1, children: __hex_children }, __hex_added];",
        "  };",
        "  const discard = (__hex_node, __hex_hash, __hex_key, __hex_equals, __hex_shift = 0) => {",
        "    if (__hex_node === null) return [null, false];",
        "    if (__hex_node.kind === 0) {",
        "      if (__hex_node.hash !== __hex_hash) return [__hex_node, false];",
        "      const __hex_index = __hex_node.entries.findIndex(__hex_entry => __hex_equals(__hex_entry[0], __hex_key));",
        "      if (__hex_index < 0) return [__hex_node, false];",
        "      const __hex_remaining = __hex_node.entries.filter((_, __hex_entryIndex) => __hex_entryIndex !== __hex_index);",
        "      return [__hex_remaining.length === 0 ? null : { ...__hex_node, entries: __hex_remaining }, true];",
        "    }",
        "    const __hex_slot = (__hex_hash >>> __hex_shift) & 31, __hex_child = __hex_node.children[__hex_slot] ?? null;",
        "    const [__hex_updated, __hex_removed] = discard(__hex_child, __hex_hash, __hex_key, __hex_equals, __hex_shift + 5);",
        "    if (!__hex_removed) return [__hex_node, false];",
        "    const __hex_children = __hex_node.children.slice(); __hex_children[__hex_slot] = __hex_updated ?? undefined;",
        "    return [{ kind: 1, children: __hex_children }, true];",
        "  };",
        "  const mapValue = (__hex_root, __hex_size) => ({ root: __hex_root, size: __hex_size, [Symbol.iterator]: function () { return entries(__hex_root); } });",
        "  const setValue = (__hex_root, __hex_size) => ({ root: __hex_root, size: __hex_size, [Symbol.iterator]: function* () { for (const [__hex_key] of entries(__hex_root)) yield __hex_key; } });",
        "  const hashed = (__hex_dictionary, __hex_value) => __hex_dictionary.hash(__hex_value) | 0;",
        "  const emptyMap = () => mapValue(null, 0), emptySet = () => setValue(null, 0);",
        "  const mapSet = __hex_hash => (__hex_map, __hex_key, __hex_value) => { const [__hex_root, __hex_added] = insert(__hex_map.root, hashed(__hex_hash, __hex_key), __hex_key, __hex_value, __hex_hash.eq.equals); return __hex_root === __hex_map.root ? __hex_map : mapValue(__hex_root, __hex_map.size + Number(__hex_added)); };",
        "  const mapRemove = __hex_hash => (__hex_map, __hex_key) => { const [__hex_root, __hex_removed] = discard(__hex_map.root, hashed(__hex_hash, __hex_key), __hex_key, __hex_hash.eq.equals); return __hex_removed ? mapValue(__hex_root, __hex_map.size - 1) : __hex_map; };",
        "  const mapEntry = (__hex_hash, __hex_map, __hex_key) => find(__hex_map.root, hashed(__hex_hash, __hex_key), __hex_key, __hex_hash.eq.equals);",
        "  const mapContainsKey = __hex_hash => (__hex_map, __hex_key) => mapEntry(__hex_hash, __hex_map, __hex_key) !== undefined;",
        "  const mapGet = __hex_hash => (__hex_map, __hex_key) => { const __hex_entry = mapEntry(__hex_hash, __hex_map, __hex_key); if (__hex_entry !== undefined) return __hex_entry[1]; const __hex_error = new Error(\"key is absent\"); __hex_error.name = \"KeyError\"; throw __hex_error; };",
        "  const setAdd = __hex_hash => (__hex_set, __hex_value) => { const [__hex_root, __hex_added] = insert(__hex_set.root, hashed(__hex_hash, __hex_value), __hex_value, undefined, __hex_hash.eq.equals); return __hex_added ? setValue(__hex_root, __hex_set.size + 1) : __hex_set; };",
        "  const setRemove = __hex_hash => (__hex_set, __hex_value) => { const [__hex_root, __hex_removed] = discard(__hex_set.root, hashed(__hex_hash, __hex_value), __hex_value, __hex_hash.eq.equals); return __hex_removed ? setValue(__hex_root, __hex_set.size - 1) : __hex_set; };",
        "  const setContains = __hex_hash => (__hex_set, __hex_value) => find(__hex_set.root, hashed(__hex_hash, __hex_value), __hex_value, __hex_hash.eq.equals) !== undefined;",
        "  const setUnion = __hex_hash => (__hex_left, __hex_right) => { let __hex_result = __hex_left; for (const __hex_value of __hex_right) __hex_result = setAdd(__hex_hash)(__hex_result, __hex_value); return __hex_result; };",
        "  const setIntersect = __hex_hash => (__hex_left, __hex_right) => { let __hex_result = emptySet(); const __hex_has = setContains(__hex_hash); for (const __hex_value of __hex_left) if (__hex_has(__hex_right, __hex_value)) __hex_result = setAdd(__hex_hash)(__hex_result, __hex_value); return __hex_result; };",
        "  const setDifference = __hex_hash => (__hex_left, __hex_right) => { let __hex_result = __hex_left; const __hex_remove = setRemove(__hex_hash); for (const __hex_value of __hex_right) __hex_result = __hex_remove(__hex_result, __hex_value); return __hex_result; };",
        "  const setIsSubsetOf = __hex_hash => (__hex_left, __hex_right) => { const __hex_has = setContains(__hex_hash); for (const __hex_value of __hex_left) if (!__hex_has(__hex_right, __hex_value)) return false; return true; };",
        "  const mapFrom = __hex_hash => __hex_source => { let __hex_result = emptyMap(); const __hex_set = mapSet(__hex_hash); for (const [__hex_key, __hex_value] of __hex_source) __hex_result = __hex_set(__hex_result, __hex_key, __hex_value); return __hex_result; };",
        "  const setFrom = __hex_hash => __hex_source => { let __hex_result = emptySet(); const __hex_add = setAdd(__hex_hash); for (const __hex_value of __hex_source) __hex_result = __hex_add(__hex_result, __hex_value); return __hex_result; };",
        "  const setEquals = __hex_hash => (__hex_left, __hex_right) => __hex_left.size === __hex_right.size && (() => { const __hex_has = setContains(__hex_hash); for (const __hex_value of __hex_left) if (!__hex_has(__hex_right, __hex_value)) return false; return true; })();",
        "  const mapEquals = (__hex_hash, __hex_valueEq) => (__hex_left, __hex_right) => __hex_left.size === __hex_right.size && (() => { for (const [__hex_key, __hex_value] of __hex_left) { const __hex_entry = mapEntry(__hex_hash, __hex_right, __hex_key); if (__hex_entry === undefined || !__hex_valueEq.equals(__hex_value, __hex_entry[1])) return false; } return true; })();",
        "  const setHash = (__hex_hash, __hex_mix) => __hex_set => { let __hex_result = __hex_set.size | 0; for (const __hex_value of __hex_set) __hex_result = (__hex_result + __hex_mix(0x51ed270b, __hex_hash.hash(__hex_value))) | 0; return __hex_result; };",
        "  const mapHash = (__hex_keyHash, __hex_valueHash, __hex_mix) => __hex_map => { let __hex_result = __hex_map.size | 0; for (const [__hex_key, __hex_value] of __hex_map) __hex_result = (__hex_result + __hex_mix(__hex_keyHash.hash(__hex_key), __hex_valueHash.hash(__hex_value))) | 0; return __hex_result; };",
        "  return { emptyMap, emptySet, mapSet, mapRemove, mapContainsKey, mapGet, mapFrom, setAdd, setRemove, setContains, setUnion, setIntersect, setDifference, setIsSubsetOf, setFrom, setEquals, mapEquals, setHash, mapHash, size: __hex_collection => __hex_collection.size, isEmpty: __hex_collection => __hex_collection.size === 0, mapKeys: __hex_map => [...__hex_map].map(__hex_entry => __hex_entry[0]), mapValues: __hex_map => [...__hex_map].map(__hex_entry => __hex_entry[1]), mapEntries: __hex_map => [...__hex_map] };",
        "})();",
      ];
    case "mixHash":
      return [
        `function ${name}(__hex_seed, __hex_value) {`,
        "  return Math.imul(__hex_seed ^ __hex_value, 0x9e3779b1) | 0;",
        "}",
      ];
    case "stableHash":
      return [
        `function ${name}(__hex_value) {`,
        "  if (__hex_value === undefined) return 0;",
        "  if (typeof __hex_value === \"boolean\") return __hex_value ? 1 : 2;",
        "  if (typeof __hex_value === \"number\") { if (Number.isNaN(__hex_value)) return 0x7fc00000; if (Object.is(__hex_value, -0)) return 0; const __hex_text = String(__hex_value); let __hex_hash = 0; for (let __hex_index = 0; __hex_index < __hex_text.length; __hex_index += 1) __hex_hash = Math.imul(__hex_hash, 31) + __hex_text.charCodeAt(__hex_index) | 0; return __hex_hash; }",
        "  const __hex_text = String(__hex_value); let __hex_hash = 0; for (let __hex_index = 0; __hex_index < __hex_text.length; __hex_index += 1) __hex_hash = Math.imul(__hex_hash, 31) + __hex_text.charCodeAt(__hex_index) | 0; return __hex_hash;",
        "}",
      ];
    case "exception":
      return [
        `function ${name}(__hex_name, __hex_message, __hex_fields) {`,
        "  return Object.assign(new Error(__hex_message), { $hex: true, name: __hex_name }, __hex_fields);",
        "}",
      ];
    case "floatEquals":
      return [
        `function ${name}(__hex_left, __hex_right) {`,
        "  return __hex_left === __hex_right || (Number.isNaN(__hex_left) && Number.isNaN(__hex_right));",
        "}",
      ];
    case "compareFloat":
      return [
        `function ${name}(__hex_left, __hex_right) {`,
        "  if (Number.isNaN(__hex_left)) return Number.isNaN(__hex_right) ? 0 : 1;",
        "  if (Number.isNaN(__hex_right)) return -1;",
        "  return __hex_left < __hex_right ? -1 : __hex_left > __hex_right ? 1 : 0;",
        "}",
      ];
    case "compareString":
      return [
        `function ${name}(__hex_left, __hex_right) {`,
        "  const __hex_leftPoints = Array.from(__hex_left);",
        "  const __hex_rightPoints = Array.from(__hex_right);",
        "  const __hex_length = Math.min(__hex_leftPoints.length, __hex_rightPoints.length);",
        "  for (let __hex_index = 0; __hex_index < __hex_length; __hex_index += 1) {",
        "    const __hex_leftPoint = __hex_leftPoints[__hex_index].codePointAt(0);",
        "    const __hex_rightPoint = __hex_rightPoints[__hex_index].codePointAt(0);",
        "    if (__hex_leftPoint < __hex_rightPoint) return -1;",
        "    if (__hex_leftPoint > __hex_rightPoint) return 1;",
        "  }",
        "  return __hex_leftPoints.length < __hex_rightPoints.length ? -1 : __hex_leftPoints.length > __hex_rightPoints.length ? 1 : 0;",
        "}",
      ];
    case "checkedPower":
      return [
        `function ${name}(__hex_base, __hex_exponent) {`,
        "  if (__hex_exponent < 0) {",
        '    const __hex_error = new Error("an integer exponent cannot be negative");',
        '    __hex_error.name = "NegativeExponentError";',
        "    throw __hex_error;",
        "  }",
        "  return __hex_base ** __hex_exponent;",
        "}",
      ];
    case "range":
      return [
        `function ${name}(__hex_start, __hex_end) {`,
        "  return { start: __hex_start, end: __hex_end, descending: false,",
        "    *[Symbol.iterator]() {",
        "      for (let __hex_value = __hex_start; __hex_value <= __hex_end; __hex_value += 1) yield __hex_value;",
        "    },",
        "  };",
        "}",
      ];
    case "vectorIndex":
      return [
        `function ${name}(__hex_values, __hex_index) {`,
        "  if (__hex_index < 1 || __hex_index > __hex_values.length) { const __hex_error = new RangeError(`index ${__hex_index} out of bounds for size ${__hex_values.length}`); __hex_error.name = \"IndexError\"; __hex_error.index = __hex_index; __hex_error.size = __hex_values.length; throw __hex_error; }",
        "  return __hex_values[__hex_index - 1];",
        "}",
      ];
    case "vectorSlice":
      return [
        `function ${name}(__hex_values, __hex_range) {`,
        "  if (__hex_range.descending) { const __hex_error = new RangeError(\"a slice window cannot descend\"); __hex_error.name = \"SliceError\"; __hex_error.start = __hex_range.start; __hex_error.end = __hex_range.end; throw __hex_error; }",
        "  return __hex_values.slice(Math.max(0, __hex_range.start - 1), Math.max(0, __hex_range.end));",
        "}",
      ];
    case "stringIndex":
      return [
        `function ${name}(__hex_text, __hex_index) {`,
        "  const __hex_points = Array.from(__hex_text);",
        `  return ${dependencyName("vectorIndex")}(__hex_points, __hex_index);`,
        "}",
      ];
    case "stringSlice":
      return [
        `function ${name}(__hex_text, __hex_range) {`,
        `  return ${dependencyName("vectorSlice")}(Array.from(__hex_text), __hex_range).join("");`,
        "}",
      ];
    case "seq":
      // Every traversal replays the same memoized spine. The source generator
      // advances only when a traversal reaches the current frontier.
      return [
        `function ${name}(__hex_source) {`,
        "  const __hex_values = [];",
        "  const __hex_iterator = __hex_source[Symbol.iterator]();",
        "  let __hex_done = false;",
        "  return {",
        "    *[Symbol.iterator]() {",
        "      for (let __hex_index = 0; ; __hex_index += 1) {",
        "        if (__hex_index === __hex_values.length && !__hex_done) {",
        "          const __hex_next = __hex_iterator.next();",
        "          __hex_done = __hex_next.done;",
        "          if (!__hex_done) __hex_values.push(__hex_next.value);",
        "        }",
        "        if (__hex_index >= __hex_values.length) return;",
        "        yield __hex_values[__hex_index];",
        "      }",
        "    },",
        "  };",
        "}",
      ];
    case "seqIterate":
      return [
        `function ${name}(__hex_seed, __hex_next) {`,
        `  return ${dependencyName("seq")}((function* () {`,
        "    let __hex_value = __hex_seed;",
        "    while (true) { yield __hex_value; __hex_value = __hex_next(__hex_value); }",
        "  })());",
        "}",
      ];
    case "seqMap":
      return [
        `function ${name}(__hex_values, __hex_transform) {`,
        `  return ${dependencyName("seq")}((function* () {`,
        "    for (const __hex_value of __hex_values) yield __hex_transform(__hex_value);",
        "  })());",
        "}",
      ];
    case "seqFilter":
      return [
        `function ${name}(__hex_values, __hex_keep) {`,
        `  return ${dependencyName("seq")}((function* () {`,
        "    for (const __hex_value of __hex_values) if (__hex_keep(__hex_value)) yield __hex_value;",
        "  })());",
        "}",
      ];
    case "seqTake":
      return [
        `function ${name}(__hex_values, __hex_count) {`,
        `  return ${dependencyName("seq")}((function* () {`,
        "    if (__hex_count <= 0) return;",
        "    let __hex_seen = 0;",
        "    for (const __hex_value of __hex_values) {",
        "      yield __hex_value;",
        "      __hex_seen += 1;",
        "      if (__hex_seen >= __hex_count) return;",
        "    }",
        "  })());",
        "}",
      ];
  }
}

/** Selects compiler-owned operations over persistent hash-array-mapped tries. */
function collectionOperation(
  collection: Core.CollectionOperationExpr["collection"],
  operation: string,
  runtime: string,
  hash?: string,
  seq?: string,
): string {
  const dictionaries = `${hash}`;
  if (collection === "Map") {
    if (operation === "empty") return `${runtime}.emptyMap`;
    if (["set", "remove", "containsKey", "get"].includes(operation)) {
      return `${runtime}.map${operation[0]!.toUpperCase()}${operation.slice(1)}(${dictionaries})`;
    }
    if (operation === "size") return `${runtime}.size`;
    if (operation === "isEmpty") return `${runtime}.isEmpty`;
    if (["keys", "values", "entries"].includes(operation)) return `__hex_map => ${seq}(${runtime}.map${operation[0]!.toUpperCase()}${operation.slice(1)}(__hex_map))`;
    if (operation === "toSeq") return `__hex_map => ${seq}(${runtime}.mapEntries(__hex_map))`;
    if (["fromVector", "fromSeq", "fromEntries"].includes(operation)) return `${runtime}.mapFrom(${dictionaries})`;
  }
  if (collection === "Set") {
    if (operation === "empty") return `${runtime}.emptySet`;
    if (["add", "remove", "contains", "union", "intersect", "difference", "isSubsetOf"].includes(operation)) {
      return `${runtime}.set${operation[0]!.toUpperCase()}${operation.slice(1)}(${dictionaries})`;
    }
    if (operation === "size") return `${runtime}.size`;
    if (operation === "isEmpty") return `${runtime}.isEmpty`;
    if (operation === "toSeq") return `__hex_set => ${seq}(__hex_set)`;
    if (operation === "fromVector" || operation === "fromSeq") return `${runtime}.setFrom(${dictionaries})`;
  }
  if (operation === "empty") return "() => []";
  if (operation === "size") return "__hex_vector => __hex_vector.length";
  if (operation === "isEmpty") return "__hex_vector => __hex_vector.length === 0";
  if (operation === "append") return "(__hex_vector, __hex_value) => [...__hex_vector, __hex_value]";
  if (operation === "prepend") return "(__hex_vector, __hex_value) => [__hex_value, ...__hex_vector]";
  return "() => undefined";
}

class GeneratedNames {
  readonly #used: Set<string>;
  readonly #next = new Map<string, number>();

  constructor(existing: Iterable<string>) {
    this.#used = new Set(existing);
  }

  fixed(stem: string): string {
    return this.#claim(stem);
  }

  fresh(stem: string): string {
    let index = this.#next.get(stem) ?? 0;
    while (true) {
      const name = this.#claim(`${stem}${index}`);
      this.#next.set(stem, index + 1);
      return name;
    }
  }

  #claim(stem: string): string {
    const base = `__hex_${stem}`;
    let name = base;
    let suffix = 1;
    while (this.#used.has(name)) name = `${base}${suffix++}`;
    this.#used.add(name);
    return name;
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

function substituteType(
  type: Typed.Type,
  replacements: ReadonlyMap<Typed.TypeVariableId, Typed.Type>,
): Typed.Type {
  if (type.kind === "Variable") return replacements.get(type.id) ?? type;
  if (type.kind === "Function") {
    return {
      kind: "Function",
      parameters: type.parameters.map((parameter) => substituteType(parameter, replacements)),
      result: substituteType(type.result, replacements),
    };
  }
  if (type.kind === "Tuple") {
    return { kind: "Tuple", elements: type.elements.map((element) =>
      substituteType(element, replacements)
    ) };
  }
  if (type.kind === "Vector") {
    return { kind: "Vector", element: substituteType(type.element, replacements) };
  }
  if (type.kind === "Record") {
    return {
      ...type,
      fields: type.fields.map((field) => ({
        ...field,
        type: substituteType(field.type, replacements),
      })),
    };
  }
  if (type.kind === "Union" || type.kind === "NominalRecord") {
    return {
      ...type,
      arguments: type.arguments.map((argument) => substituteType(argument, replacements)),
    };
  }
  return type;
}

function lexicographicComparison(comparisons: readonly string[]): string {
  if (comparisons.length === 0) return "0";
  const statements = comparisons.map((comparison, index) =>
    `const __hex_order${index} = ${comparison}; if (__hex_order${index} !== 0) return __hex_order${index};`
  );
  return `(() => { ${statements.join(" ")} return 0; })()`;
}

function dictionaryParameterName(
  constraint: Typed.ConstraintName,
  variable: Typed.TypeVariableId,
): string {
  return `__hex_dict${constraint}_${Number(variable)}`;
}

function primitiveDictionary(
  constraint: Typed.ConstraintName,
  instance: Typed.PrimitiveName,
  helperName: (helper: Helper) => string,
): string {
  switch (constraint) {
    case "Num": {
      const fromInt = instance === "BigInt"
        ? "BigInt(__hex_a)"
        : "__hex_a";
      return `({ add: (__hex_a, __hex_b) => __hex_a + __hex_b, subtract: (__hex_a, __hex_b) => __hex_a - __hex_b, multiply: (__hex_a, __hex_b) => __hex_a * __hex_b, negate: __hex_a => -__hex_a, fromInt: __hex_a => ${fromInt} })`;
    }
    case "Frac":
      return "({ divide: (__hex_a, __hex_b) => __hex_a / __hex_b })";
    case "Concat":
      return "({ concat: (__hex_a, __hex_b) => __hex_a + __hex_b })";
    case "Pow":
      return instance === "Float"
        ? "({ pow: (__hex_a, __hex_b) => __hex_a ** __hex_b })"
        : `({ pow: (__hex_a, __hex_b) => ${helperName("checkedPower")}(__hex_a, __hex_b) })`;
    case "Eq":
      return instance === "Float"
        ? "({ equals: (__hex_a, __hex_b) => __hex_a === __hex_b || (__hex_a !== __hex_a && __hex_b !== __hex_b), notEquals: (__hex_a, __hex_b) => !(__hex_a === __hex_b || (__hex_a !== __hex_a && __hex_b !== __hex_b)) })"
        : "({ equals: (__hex_a, __hex_b) => __hex_a === __hex_b, notEquals: (__hex_a, __hex_b) => __hex_a !== __hex_b })";
    case "Ord":
      if (instance === "Float") {
        return `({ compare: (__hex_a, __hex_b) => ${helperName("compareFloat")}(__hex_a, __hex_b) })`;
      }
      if (instance === "String") {
        return `({ compare: (__hex_a, __hex_b) => ${helperName("compareString")}(__hex_a, __hex_b) })`;
      }
      return "({ compare: (__hex_a, __hex_b) => __hex_a < __hex_b ? -1 : __hex_a > __hex_b ? 1 : 0 })";
    case "Show":
      if (instance === "String") return "({ show: __hex_a => __hex_a })";
      if (instance === "Unit") return "({ show: () => \"()\" })";
      return "({ show: __hex_a => String(__hex_a) })";
    case "Hash":
      return instance === "Float"
        ? `({ eq: { equals: (__hex_a, __hex_b) => __hex_a === __hex_b || (__hex_a !== __hex_a && __hex_b !== __hex_b), notEquals: (__hex_a, __hex_b) => !(__hex_a === __hex_b || (__hex_a !== __hex_a && __hex_b !== __hex_b)) }, hash: __hex_a => ${helperName("stableHash")}(__hex_a) })`
        : `({ eq: { equals: (__hex_a, __hex_b) => __hex_a === __hex_b, notEquals: (__hex_a, __hex_b) => __hex_a !== __hex_b }, hash: __hex_a => ${helperName("stableHash")}(__hex_a) })`;
    default:
      return "({})";
  }
}

function evidenceKey(
  variable: Typed.TypeVariableId,
  constraint: Typed.ConstraintName,
): string {
  return `${Number(variable)}:${constraint}`;
}

function internalConstrainedExportName(symbol: Resolved.SymbolId): string {
  return `__hex_export${Number(symbol)}`;
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
        case "Exn":
          return "Error & { readonly $hex: true; readonly name: string }";
        case "Unit":
          return returnPosition ? "void" : "undefined";
      }
    case "Variable":
      return variables.get(type.id) ?? "unknown";
    case "Range":
      return "Iterable<number>";
    case "Seq":
      return `Iterable<${renderType(type.element, variables, false)}>`;
    case "Vector":
      return `ReadonlyArray<${renderType(type.element, variables, false)}>`;
    case "Set":
      return `ReadonlySet<${renderType(type.element, variables, false)}>`;
    case "Map":
      return `ReadonlyMap<${renderType(type.key, variables, false)}, ${renderType(type.value, variables, false)}>`;
    case "Array":
      return `Array<${renderType(type.element, variables, false)}>`;
    case "Nullable":
      return `${renderType(type.value, variables, false)} | null | undefined`;
    case "Union":
      return type.arguments.length === 0
        ? type.name
        : `${type.name}<${type.arguments.map((argument) =>
          renderType(argument, variables, false)
        ).join(", ")}>`;
    case "NominalRecord":
      return type.arguments.length === 0
        ? type.name
        : `${type.name}<${type.arguments.map((argument) =>
          renderType(argument, variables, false)
        ).join(", ")}>`;
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
    : `__hex_binding${Number(binding.symbol)}`;
}

function renderUnionDeclaration(
  item: Core.UnionItem,
  exported: boolean,
): string {
  const prefix = exported ? "export " : "";
  const variables = typeVariableNames(item.parameters);
  const genericNames = item.parameters.map((parameter) => variables.get(parameter)!);
  const generics = genericNames.length === 0 ? "" : `<${genericNames.join(", ")}>`;
  const tagged = item.constructors.some(({ slots }) => slots.length > 0);
  const alternatives = item.constructors
    .map(({ name, slots }) => tagged
      ? `{ tag: ${JSON.stringify(name)}${slots.map(({ field, type }) => `; ${field}: ${renderType(type, variables, false)}`).join("")} }`
      : JSON.stringify(name))
    .join(" | ");
  return `${prefix}type ${item.name}${generics} = ${alternatives};`;
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
    case "Vector":
      return [
        ...pattern.elements.flatMap(patternBindings),
        ...(pattern.rest?.pattern === undefined ? [] : patternBindings(pattern.rest.pattern)),
      ];
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

function emittedModuleSpecifier(specifier: string): string {
  return specifier.endsWith(".hex")
    ? `${specifier.slice(0, -4)}.js`
    : `${specifier}.js`;
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
  if (reservedWords.has(name)) return false;
  const scalars = [...name];
  const first = scalars.shift();
  if (first === undefined || !isJavaScriptIdentifierStart(first)) return false;
  return scalars.every(isJavaScriptIdentifierContinue);
}

function isJavaScriptIdentifierStart(scalar: string): boolean {
  return scalar === "$" || scalar === "_" || idStart.test(scalar);
}

function isJavaScriptIdentifierContinue(scalar: string): boolean {
  return scalar === "$" || scalar === "_" || scalar === "\u200C" ||
    scalar === "\u200D" || idContinue.test(scalar);
}
