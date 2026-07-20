/**
 * The first resolver assigns stable identities to local bindings and replaces
 * textual references with those identities. It deliberately covers only the
 * binding forms admitted by the current parser: sequential lets and vars,
 * directly recursive functions, patterns, lambda parameters, and owner-relative
 * implied type names.
 */

import * as Diagnostics from "../../support/diagnostics.js";
import type * as Source from "../../support/source.js";
import type * as Parsed from "../../syntax/parsed/index.js";
import * as Resolved from "../../syntax/resolved/index.js";

export interface ModuleInterface {
  readonly module: Resolved.Module;
  readonly terms: ReadonlyMap<string, Resolved.Symbol>;
  readonly unions: ReadonlyMap<string, Resolved.Union>;
  readonly records: ReadonlyMap<string, Resolved.RecordDeclaration>;
  readonly aliases: ReadonlyMap<string, Resolved.TypeAliasItem>;
}

export interface ResolveOptions {
  readonly imports?: ReadonlyMap<string, ModuleInterface>;
  readonly symbolBase?: number;
  readonly unionBase?: number;
  readonly recordBase?: number;
}

export function resolve(
  module: Parsed.Module,
  options: ResolveOptions = {},
): Resolved.Module {
  const diagnostics = new Diagnostics.Bag();
  for (const diagnostic of module.diagnostics) diagnostics.add(diagnostic);

  return new Resolver(diagnostics, options).resolve(module);
}

export function moduleInterface(module: Resolved.Module): ModuleInterface {
  const symbols = new Map(module.symbols.map((symbol) => [symbol.id, symbol]));
  const terms = new Map<string, Resolved.Symbol>();
  const unions = new Map<string, Resolved.Union>();
  const records = new Map<string, Resolved.RecordDeclaration>();
  const aliases = new Map<string, Resolved.TypeAliasItem>();
  for (const item of module.items) {
    if (!('exported' in item) || item.exported !== true) continue;
    if (item.kind === "Let" || item.kind === "Fun") {
      const symbol = symbols.get(item.binding.symbol);
      if (symbol !== undefined) terms.set(item.binding.name, symbol);
    } else if (item.kind === "TypeAlias") {
      aliases.set(item.name, item);
    } else if (item.kind === "Union") {
      const union = module.unions.find(({ id }) => id === item.union);
      if (union !== undefined) unions.set(item.name, union);
      for (const constructor of item.opaque ? [] : item.constructors) {
        const symbol = symbols.get(constructor.binding.symbol);
        if (symbol !== undefined) terms.set(constructor.binding.name, symbol);
      }
    } else if (item.kind === "RecordDeclaration") {
      const record = module.records.find(({ id }) => id === item.record);
      const symbol = symbols.get(item.constructor.symbol);
      if (record !== undefined) records.set(item.name, record);
      if (!item.opaque && symbol !== undefined) terms.set(item.name, symbol);
    } else if (item.kind === "Exception") {
      const symbol = symbols.get(item.binding.symbol);
      if (symbol !== undefined) terms.set(item.binding.name, symbol);
    }
  }
  return { module, terms, unions, records, aliases };
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
  readonly #symbols = new Map<Resolved.SymbolId, Resolved.Symbol>();
  readonly #importedSymbols = new Map<Resolved.SymbolId, Resolved.Symbol>();
  readonly #unions: Resolved.Union[] = [];
  readonly #records: Resolved.RecordDeclaration[] = [];
  readonly #unionNames = new Map<string, Resolved.UnionId>();
  readonly #unionArities = new Map<string, number>();
  readonly #recordNames = new Map<string, Resolved.RecordId>();
  readonly #recordArities = new Map<string, number>();
  readonly #typeAliases = new Map<string, Parsed.TypeAliasItem | Resolved.TypeAliasItem>();
  readonly #unionDeclarations = new WeakMap<Parsed.UnionItem, Resolved.UnionId>();
  readonly #recordDeclarations = new WeakMap<Parsed.RecordItem, Resolved.RecordId>();
  readonly #resolvingAliases: string[] = [];
  readonly #imports: ReadonlyMap<string, ModuleInterface>;
  readonly #moduleAliases = new Map<string, ModuleInterface>();
  readonly #constraintNames = new Set<string>([
    "Num", "Frac", "Pow", "Concat", "Eq", "Ord", "Show",
  ]);
  readonly #impliedTypeOwners = new Map<string, Set<string>>();
  readonly #pending: { readonly name: Parsed.Name; readonly kind: "let" | "var" }[] = [];
  readonly #predeclaredBindings = new WeakMap<Parsed.LetItem | Parsed.VarItem | Parsed.FunItem, Resolved.Binding>();
  readonly #futureSequential: Map<string, Resolved.Binding>[] = [];
  readonly #currentFunctions: Resolved.SymbolId[] = [];
  readonly #funCaptures = new Map<Resolved.SymbolId, Set<Resolved.SymbolId>>();
  readonly #funDependencies = new Map<Resolved.SymbolId, Set<Resolved.SymbolId>>();
  readonly #varOwners = new Map<Resolved.SymbolId, number>();
  readonly #diagnostics: Diagnostics.Bag;
  #lambdaDepth = 0;
  #nextSymbol: number;
  #nextUnion: number;
  #nextRecord: number;

  constructor(diagnostics: Diagnostics.Bag, options: ResolveOptions) {
    this.#diagnostics = diagnostics;
    this.#imports = options.imports ?? new Map();
    this.#nextSymbol = options.symbolBase ?? 0;
    this.#nextUnion = options.unionBase ?? 0;
    this.#nextRecord = options.recordBase ?? 0;
  }

  resolve(module: Parsed.Module): Resolved.Module {
    this.#predeclareTypes(module.items);
    // Implied type names have owner-relative identity, but failed uses outside
    // an owner still receive the knowing v1 diagnostic even before declaration.
    // See Collections Part 2 §6–§7.3.
    for (const item of module.items) {
      if (item.kind !== "ConstraintDeclaration") continue;
      for (const impliedType of item.impliedTypes) {
        const owners = this.#impliedTypeOwners.get(impliedType.name.text) ?? new Set();
        owners.add(item.name.text);
        this.#impliedTypeOwners.set(impliedType.name.text, owners);
      }
    }
    const scope = new Scope();
    const items = this.#resolveItems(module.items, scope);

    return {
      kind: "Module",
      fileId: module.fileId,
      items,
      symbols: [...this.#importedSymbols.values(), ...this.#symbols.values()],
      unions: this.#unions,
      records: this.#records,
      comments: module.comments,
      span: module.span,
      diagnostics: this.#diagnostics.toArray(),
    };
  }

  /** Registers module type identities before resolving any declaration body. */
  #predeclareTypes(items: readonly Parsed.Item[]): void {
    const claimed = new Map<string, Source.Span>();
    for (const item of items) {
      if (item.kind !== "TypeAlias" && item.kind !== "Union" && item.kind !== "RecordDeclaration") continue;
      const previous = claimed.get(item.name.text);
      if (previous !== undefined) {
        this.#diagnostics.add({
          severity: "error",
          message: `type \`${item.name.text}\` is already declared`,
          primary: item.name.span,
          labels: [{ span: previous, message: "first declaration is here" }],
        });
        continue;
      }
      claimed.set(item.name.text, item.name.span);
      if (item.kind === "TypeAlias") {
        this.#typeAliases.set(item.name.text, item);
      } else if (item.kind === "Union") {
        const id = Resolved.unionId(this.#nextUnion++);
        this.#unionDeclarations.set(item, id);
        this.#unionNames.set(item.name.text, id);
        this.#unionArities.set(item.name.text, item.parameters.length);
      } else {
        const id = Resolved.recordId(this.#nextRecord++);
        this.#recordDeclarations.set(item, id);
        this.#recordNames.set(item.name.text, id);
        this.#recordArities.set(item.name.text, item.parameters.length);
      }
    }
  }

  #resolveItems(
    items: readonly Parsed.Item[],
    scope: Scope,
  ): readonly Resolved.Item[] {
    const future = new Map<string, Resolved.Binding>();
    for (const item of items) {
      if (item.kind === "Fun") {
        const existing = scope.lookupLocal(item.name.text);
        if (existing !== undefined) this.#reportRebinding(item.name, existing);
        const binding = this.#declare(item.name, "fun");
        this.#predeclaredBindings.set(item, binding);
        if (existing === undefined) scope.define(item.name.text, binding.symbol);
      } else if (item.kind === "Let" || item.kind === "Var") {
        const binding = this.#declare(item.name, item.kind === "Let" ? "let" : "var");
        this.#predeclaredBindings.set(item, binding);
        if (!future.has(item.name.text)) future.set(item.name.text, binding);
      }
    }
    this.#futureSequential.push(future);
    const resolved: Resolved.Item[] = [];
    for (const item of items) {
      const resolvedItem = this.#resolveItem(item, scope);
      resolved.push(resolvedItem, ...this.#derivedHonors(resolvedItem));
      if (item.kind === "Let" || item.kind === "Var") future.delete(item.name.text);
    }
    this.#futureSequential.pop();
    this.#checkFunctionAvailability(resolved);
    return resolved;
  }

  /** Expands declaration-header derivation sugar into ordinary instance items. */
  #derivedHonors(item: Resolved.Item): readonly Resolved.HonorItem[] {
    if (item.kind !== "Union" && item.kind !== "RecordDeclaration") return [];
    const requiredParameters = new Set(
      (item.kind === "Union"
        ? item.constructors.flatMap((constructor) => constructor.slots)
        : item.fields
      ).flatMap(({ annotation }) => annotationTypeVariables(annotation)),
    );
    const subject: Resolved.TypeAnnotation = item.kind === "Union"
      ? {
          kind: "Union",
          union: item.union,
          name: item.name,
          arguments: item.parameters.map((name) => ({
            kind: "TypeVariable",
            name,
            span: item.span,
          })),
          span: item.span,
        }
      : {
          kind: "RecordDeclaration",
          record: item.record,
          name: item.name,
          arguments: item.parameters.map((name) => ({
            kind: "TypeVariable",
            name,
            span: item.span,
          })),
          span: item.span,
        };
    return item.derives.map((constraint) => ({
      kind: "Honor",
      constraint,
      typeParameters: item.parameters.map((name) => ({
        name,
        constraints: requiredParameters.has(name) ? [constraint] : [],
        span: item.span,
      })),
      subject,
      derived: true,
      dictionary: `__hex_instance_${constraint}_${item.name}`,
      impliedTypes: [],
      members: [],
      span: item.span,
    }));
  }

  #resolveItem(item: Parsed.Item, scope: Scope): Resolved.Item {
    switch (item.kind) {
      case "Import": {
        if (!item.specifier.startsWith("./") && !item.specifier.startsWith("../")) {
          this.#diagnostics.add({
            severity: "error",
            message: "package imports are not yet supported; use a relative module path",
            primary: item.span,
          });
        }
        const importedModule = this.#imports.get(item.specifier);
        if (importedModule === undefined) {
          this.#diagnostics.add({
            severity: "error",
            message: `cannot resolve module \`${item.specifier}\``,
            primary: item.span,
          });
        }
        if (item.form.kind === "Namespace" && importedModule !== undefined) {
          if (this.#moduleAliases.has(item.form.alias.text)) {
            this.#diagnostics.add({
              severity: "error",
              message: `module alias \`${item.form.alias.text}\` is already bound`,
              primary: item.form.alias.span,
            });
          } else {
            this.#moduleAliases.set(item.form.alias.text, importedModule);
            this.#includeNominals(importedModule);
            for (const symbol of importedModule.terms.values()) {
              this.#importedSymbols.set(symbol.id, symbol);
            }
          }
        }
        const names = item.form.kind === "Named"
          ? item.form.names.map((name) => {
              const term = importedModule?.terms.get(name.imported.text);
              const union = importedModule?.unions.get(name.imported.text);
              const record = importedModule?.records.get(name.imported.text);
              const alias = importedModule?.aliases.get(name.imported.text);
              if (term === undefined && union === undefined && record === undefined && alias === undefined) {
                this.#diagnostics.add({
                  severity: "error",
                  message: `module \`${item.specifier}\` does not export \`${name.imported.text}\``,
                  primary: name.span,
                });
              }
              if (term !== undefined) {
                const existing = scope.lookup(name.local.text);
                if (existing !== undefined) this.#reportRebinding(name.local, existing);
                else scope.define(name.local.text, term.id);
                this.#importedSymbols.set(term.id, term);
              }
              if (union !== undefined) {
                if (this.#unionNames.has(name.local.text) || this.#recordNames.has(name.local.text)) {
                  this.#diagnostics.add({
                    severity: "error",
                    message: `type \`${name.local.text}\` is already declared or imported`,
                    primary: name.span,
                  });
                }
                this.#unionNames.set(name.local.text, union.id);
                this.#unionArities.set(name.local.text, union.parameters.length);
                if (!this.#unions.some(({ id }) => id === union.id)) this.#unions.push({ ...union, representationVisible: false });
              }
              if (record !== undefined) {
                if (this.#unionNames.has(name.local.text) || this.#recordNames.has(name.local.text)) {
                  this.#diagnostics.add({
                    severity: "error",
                    message: `type \`${name.local.text}\` is already declared or imported`,
                    primary: name.span,
                  });
                }
                this.#recordNames.set(name.local.text, record.id);
                this.#recordArities.set(name.local.text, record.parameters.length);
                const importedRecord = { ...record, representationVisible: false };
                if (!this.#records.some(({ id }) => id === record.id)) this.#records.push(importedRecord);
              }
              if (alias !== undefined) {
                if (this.#typeAliases.has(name.local.text) || this.#unionNames.has(name.local.text) || this.#recordNames.has(name.local.text)) {
                  this.#diagnostics.add({
                    severity: "error",
                    message: `type \`${name.local.text}\` is already declared or imported`,
                    primary: name.span,
                  });
                } else {
                  this.#typeAliases.set(name.local.text, { ...alias, name: name.local.text });
                }
              }
              return {
                imported: name.imported.text,
                local: name.local.text,
                ...(term === undefined ? {} : { symbol: term.id }),
                ...(term === undefined && (union !== undefined || record !== undefined || alias !== undefined)
                  ? { typeOnly: true }
                  : {}),
                span: name.span,
              };
            })
          : undefined;
        const namespaceAlias = item.form.kind === "Namespace"
          ? item.form.alias.text
          : undefined;
        return {
          kind: "Import",
          specifier: item.specifier,
          form: item.form.kind === "Effect"
            ? item.form
            : item.form.kind === "Namespace"
              ? {
                  kind: "Namespace",
                  alias: namespaceAlias!,
                  names: [...(importedModule?.terms.entries() ?? [])].map(
                    ([name, symbol]) => ({
                      imported: name,
                      local: `${namespaceAlias}.${name}`,
                      symbol: symbol.id,
                      span: item.span,
                    }),
                  ),
                }
              : {
                  kind: "Named",
                  names: names ?? [],
                },
          span: item.span,
        };
      }
      case "ConstraintDeclaration": {
        if (this.#constraintNames.has(item.name.text)) {
          this.#diagnostics.add({
            severity: "error",
            message: `constraint \`${item.name.text}\` is already declared`,
            primary: item.name.span,
          });
        }
        this.#constraintNames.add(item.name.text);
        const typeParameters = new Set([item.subject.text]);
        const impliedTypes = new Set(item.impliedTypes.map(({ name }) => name.text));
        const impliedContext = { owner: item.name.text, names: impliedTypes };
        const memberBindings = item.members.map((member) => {
          const existing = scope.lookup(member.name.text);
          if (existing !== undefined) this.#reportRebinding(member.name, existing);
          const binding = this.#declare(member.name, "constraint-member");
          if (existing === undefined) scope.define(member.name.text, binding.symbol);
          return binding;
        });
        const members = item.members.map((member, index) => {
          const binding = memberBindings[index]!;
          const parameters = member.parameters.map((parameter) => ({
            ...this.#declare(parameter.name, "parameter"),
            ...(parameter.annotation === undefined
              ? {}
              : { annotation: this.#resolveTypeAnnotation(parameter.annotation, typeParameters, impliedContext) }),
          }));
          return {
            binding,
            parameters,
            returnAnnotation: this.#resolveTypeAnnotation(member.returnAnnotation, typeParameters, impliedContext),
            ...(member.defaultValue === undefined
              ? {}
              : { defaultValue: this.#resolveLambda(member.defaultValue, scope, impliedContext) }),
            span: member.span,
          };
        });
        return {
          kind: "ConstraintDeclaration",
          name: item.name.text,
          subject: item.subject.text,
          superconstraints: item.superconstraints.map(({ text }) => text),
          impliedTypes: item.impliedTypes.map(({ name, span }) => ({
            name: name.text,
            span,
          })),
          members,
          span: item.span,
        };
      }
      case "Honor": {
        const typeParameterNames = new Set(item.typeParameters.map(({ name }) => name.text));
        const subject = this.#resolveTypeAnnotation(item.subject, typeParameterNames);
        const declaration = this.#impliedTypeOwners;
        const names = new Set(
          [...declaration.entries()]
            .filter(([, owners]) => owners.has(item.constraint.text))
            .map(([name]) => name),
        );
        const impliedContext = { owner: item.constraint.text, names };
        return {
          kind: "Honor",
          constraint: item.constraint.text,
          typeParameters: item.typeParameters.map((parameter) => ({
            name: parameter.name.text,
            constraints: parameter.constraints.map(({ text }) => text),
            span: parameter.span,
          })),
          subject,
          derived: item.derived,
          dictionary: `__hex_instance_${item.constraint.text}_${annotationHeadName(subject)}`,
          impliedTypes: item.impliedTypes.map((impliedType) => ({
            name: impliedType.name.text,
            annotation: this.#resolveTypeAnnotation(
              impliedType.annotation,
              typeParameterNames,
            ),
            span: impliedType.span,
          })),
          members: item.members.map((member) => ({
            name: member.name.text,
            value: this.#resolveLambda(member.value, scope, impliedContext),
            span: member.span,
          })),
          span: item.span,
        };
      }
      case "Let": {
        const existing = scope.lookup(item.name.text);
        if (existing !== undefined) this.#reportRebinding(item.name, existing);

        const binding = this.#predeclaredBindings.get(item) ?? this.#declare(item.name, "let");
        this.#pending.push({ name: item.name, kind: "let" });
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
      case "TypeAlias": {
        const parameters = new Set(item.parameters.map(({ text }) => text));
        const used = parsedAnnotationTypeVariables(item.annotation);
        for (const parameter of item.parameters) {
          if (!used.has(parameter.text)) {
            this.#diagnostics.add({
              severity: "error",
              message: `type parameter \`${parameter.text}\` is not used by alias \`${item.name.text}\``,
              primary: parameter.span,
            });
          }
        }
        this.#resolvingAliases.push(item.name.text);
        const annotation = this.#resolveTypeAnnotation(item.annotation, parameters);
        this.#resolvingAliases.pop();
        const resolvedAlias: Resolved.TypeAliasItem = {
          kind: "TypeAlias",
          exported: item.exported,
          name: item.name.text,
          parameters: item.parameters.map(({ text }) => text),
          annotation,
          span: item.span,
        };
        this.#typeAliases.set(item.name.text, resolvedAlias);
        return resolvedAlias;
      }
      case "Var": {
        const existing = scope.lookup(item.name.text);
        if (existing !== undefined) this.#reportRebinding(item.name, existing);
        if (this.#lambdaDepth === 0) {
          this.#diagnostics.add({
            severity: "error",
            message: "`var` is only allowed inside a function",
            primary: item.name.span,
          });
        }
        const binding = this.#predeclaredBindings.get(item) ?? this.#declare(item.name, "var");
        this.#varOwners.set(binding.symbol, this.#lambdaDepth);
        this.#pending.push({ name: item.name, kind: "var" });
        const value = this.#resolveExpr(item.value, scope);
        this.#pending.pop();
        if (existing === undefined) scope.define(item.name.text, binding.symbol);
        return {
          kind: "Var",
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
        this.#pending.push(
          ...names.map((name) => ({ name, kind: "let" as const })),
        );
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
        const union = this.#unionDeclarations.get(item) ?? Resolved.unionId(this.#nextUnion++);
        const typeParameters = new Set(item.parameters.map(({ text }) => text));
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
              annotation: this.#resolveTypeAnnotation(slot.annotation, typeParameters),
              span: slot.span,
            })),
            span: constructor.span,
          };
        });
        const declaration: Resolved.Union = {
          id: union,
          name: item.name.text,
          parameters: item.parameters.map(({ text }) => text),
          derives: item.derives.map(({ text }) => text),
          opaque: item.opaque,
          representationVisible: true,
          span: item.name.span,
          constructors,
        };
        this.#unions.push(declaration);
        return {
          kind: "Union",
          exported: item.exported,
          opaque: item.opaque,
          union,
          name: item.name.text,
          parameters: item.parameters.map(({ text }) => text),
          derives: item.derives.map(({ text }) => text),
          constructors,
          span: item.span,
        };
      }
      case "RecordDeclaration": {
        const record = this.#recordDeclarations.get(item) ?? Resolved.recordId(this.#nextRecord++);
        const existing = scope.lookup(item.name.text);
        if (existing !== undefined) this.#reportRebinding(item.name, existing);
        const constructor = this.#declare(item.name, "record-constructor");
        if (existing === undefined) scope.define(item.name.text, constructor.symbol);
        const typeParameters = new Set(item.parameters.map(({ text }) => text));
        const fields = item.fields.map((field) => ({
          name: field.name.text,
          annotation: this.#resolveTypeAnnotation(field.annotation, typeParameters),
          span: field.span,
        }));
        const declaration: Resolved.RecordDeclaration = {
          id: record,
          name: item.name.text,
          parameters: item.parameters.map(({ text }) => text),
          derives: item.derives.map(({ text }) => text),
          opaque: item.opaque,
          representationVisible: true,
          constructor,
          fields,
          span: item.span,
        };
        this.#records.push(declaration);
        return {
          kind: "RecordDeclaration",
          exported: item.exported,
          opaque: item.opaque,
          record,
          name: item.name.text,
          parameters: declaration.parameters,
          derives: declaration.derives,
          constructor,
          fields,
          span: item.span,
        };
      }
      case "Exception": {
        const existing = scope.lookup(item.name.text);
        if (existing !== undefined) this.#reportRebinding(item.name, existing);
        const binding = this.#declare(item.name, "constructor");
        if (existing === undefined) scope.define(item.name.text, binding.symbol);
        return {
          kind: "Exception",
          exported: item.exported,
          binding,
          slots: item.slots.map((slot, index) => ({
            field: slot.name?.text ?? `item${index + 1}`,
            annotation: this.#resolveTypeAnnotation(slot.annotation),
            span: slot.span,
          })),
          span: item.span,
        };
      }
      case "Fun": {
        const binding = this.#predeclaredBindings.get(item) ?? this.#declare(item.name, "fun");
        this.#currentFunctions.push(binding.symbol);
        const value = this.#resolveLambda(item.value, scope);
        this.#currentFunctions.pop();

        return {
          kind: "Fun",
          exported: item.exported,
          binding,
          value,
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
      case "Vector":
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
            name: { text: field.name.text, startClass: field.name.startClass, span: field.name.span },
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
      case "While":
        return {
          kind: "While",
          condition: this.#resolveExpr(expression.condition, scope),
          body: this.#resolveExpr(expression.body, scope) as Resolved.BlockExpr,
          span: expression.span,
        };
      case "For": {
        const loopScope = new Scope(scope);
        const pattern = this.#resolvePattern(
          expression.pattern,
          loopScope,
          new Map(),
          true,
        );
        return {
          kind: "For",
          pattern,
          iterable: this.#resolveExpr(expression.iterable, scope),
          body: this.#resolveExpr(expression.body, loopScope) as Resolved.BlockExpr,
          span: expression.span,
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
      case "Try":
        return {
          kind: "Try",
          body: this.#resolveExpr(expression.body, scope),
          arms: expression.arms.map((arm) => {
            const armScope = new Scope(scope);
            return {
              pattern: this.#resolvePattern(arm.pattern, armScope, new Map(), true),
              body: this.#resolveExpr(arm.body, armScope),
              span: arm.span,
            };
          }),
          span: expression.span,
        };
      case "Call":
        if (
          expression.callee.kind === "Name" &&
          expression.callee.name.text === "hash" &&
          scope.lookup("hash") === undefined
        ) {
          if (expression.arguments.length !== 1) {
            this.#diagnostics.add({
              severity: "error",
              message: `\`hash\` expects exactly one value, got ${expression.arguments.length}`,
              primary: expression.span,
            });
          }
          return {
            kind: "Hash",
            value: expression.arguments[0] === undefined
              ? { kind: "ErrorExpr", span: expression.span }
              : this.#resolveExpr(expression.arguments[0], scope),
            span: expression.span,
          };
        }
        if (
          expression.callee.kind === "Name" &&
          expression.callee.name.text === "throw" &&
          scope.lookup("throw") === undefined
        ) {
          if (expression.arguments.length !== 1) {
            this.#diagnostics.add({
              severity: "error",
              message: `\`throw\` expects exactly one exception, got ${expression.arguments.length}`,
              primary: expression.span,
            });
          }
          const argument = expression.arguments[0];
          return {
            kind: "Throw",
            exception: argument === undefined
              ? { kind: "ErrorExpr", span: expression.span }
              : this.#resolveExpr(argument, scope),
            span: expression.span,
          };
        }
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
        if (expression.receiver.kind === "Name") {
          if (
            expression.receiver.name.text === "Seq" &&
            scope.lookup("Seq") === undefined &&
            ["iterate", "map", "filter", "take"].includes(expression.field.text)
          ) {
            return {
              kind: "SeqOperation",
              operation: expression.field.text as "iterate" | "map" | "filter" | "take",
              span: expression.span,
            };
          }
          if (
            ["Map", "Set", "Vector"].includes(expression.receiver.name.text) &&
            scope.lookup(expression.receiver.name.text) === undefined
          ) {
            return {
              kind: "CollectionOperation",
              collection: expression.receiver.name.text as "Map" | "Set" | "Vector",
              operation: expression.field.text,
              span: expression.span,
            };
          }
          const importedModule = this.#moduleAliases.get(expression.receiver.name.text);
          if (importedModule !== undefined) {
            const symbol = importedModule.terms.get(expression.field.text);
            if (symbol === undefined) {
              this.#diagnostics.add({
                severity: "error",
                message: `module \`${expression.receiver.name.text}\` does not export \`${expression.field.text}\``,
                primary: expression.field.span,
              });
              return { kind: "ErrorExpr", span: expression.span };
            }
            this.#importedSymbols.set(symbol.id, symbol);
            return {
              kind: "Name",
              symbol: symbol.id,
              text: `${expression.receiver.name.text}.${expression.field.text}`,
              span: expression.span,
            };
          }
        }
        return {
          ...expression,
          receiver: this.#resolveExpr(expression.receiver, scope),
          field: {
            text: expression.field.text,
            startClass: expression.field.startClass,
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
        if (expression.target.kind !== "Name") {
          this.#diagnostics.add({
            severity: "error",
            message: "assignment targets a bare name; records and tuples are immutable",
            primary: expression.target.span,
          });
        }
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
        nameSpan: pattern.name.span,
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
    if (pattern.kind === "Vector") {
      const resolvedRest = pattern.rest === undefined
        ? undefined
        : {
            index: pattern.rest.index,
            span: pattern.rest.span,
            ...(pattern.rest.pattern === undefined
              ? {}
              : { pattern: this.#resolvePattern(pattern.rest.pattern, scope, seen, head, sharedBindings) }),
          };
      return {
        kind: "Vector",
        elements: pattern.elements.map((element) =>
          this.#resolvePattern(element, scope, seen, head, sharedBindings)
        ),
        ...(resolvedRest === undefined ? {} : { rest: resolvedRest }),
        span: pattern.span,
      };
    }
    if (pattern.kind === "Record") {
      return {
        kind: "Record",
        fields: pattern.fields.map((field) => ({
          name: field.name.text,
          nameSpan: field.name.span,
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
    let symbol = scope.lookup(expression.name.text);
    const currentFunction = this.#currentFunctions.at(-1);
    if (symbol === undefined && currentFunction !== undefined) {
      for (let index = this.#futureSequential.length - 1; index >= 0; index -= 1) {
        const future = this.#futureSequential[index]?.get(expression.name.text);
        if (future === undefined) continue;
        symbol = future.symbol;
        const captures = this.#funCaptures.get(currentFunction) ?? new Set();
        captures.add(symbol);
        this.#funCaptures.set(currentFunction, captures);
        break;
      }
    }
    if (symbol !== undefined) {
      if (currentFunction !== undefined && this.#symbol(symbol).kind === "fun" && symbol !== currentFunction) {
        const dependencies = this.#funDependencies.get(currentFunction) ?? new Set();
        dependencies.add(symbol);
        this.#funDependencies.set(currentFunction, dependencies);
      }
      const owner = this.#varOwners.get(symbol);
      if (owner !== undefined && owner < this.#lambdaDepth) {
        this.#diagnostics.add({
          severity: "error",
          message: `\`${expression.name.text}\` is a \`var\` and cannot be used inside a lambda; copy it to a \`let\` first`,
          primary: expression.span,
          labels: [{ span: this.#symbol(symbol).bindingSpan, message: "mutable binding declared here" }],
        });
      }
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
        message: pending.kind === "let"
          ? `\`${expression.name.text}\` is not in scope in its own \`let\` definition; \`let\` is non-recursive — use \`fun\`.`
          : `\`${expression.name.text}\` is not in scope in its own \`var\` definition; initialize it from an earlier binding`,
        primary: expression.span,
        labels: [{ span: pending.name.span, message: "binding declared here" }],
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

  #resolveLambda(
    expression: Parsed.LambdaExpr,
    scope: Scope,
    impliedContext?: { readonly owner: string; readonly names: ReadonlySet<string> },
  ): Resolved.LambdaExpr {
    this.#lambdaDepth += 1;
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
        : this.#resolveTypeAnnotation(parameter.annotation, new Set(), impliedContext);
      return {
        ...binding,
        ...(annotation === undefined ? {} : { annotation }),
      };
    });

    const resolved: Resolved.LambdaExpr = {
      kind: "Lambda",
      parameters,
      ...(expression.typeParameters === undefined
        ? {}
        : {
            typeParameters: expression.typeParameters.map((parameter) => ({
              name: parameter.name.text,
              constraints: parameter.constraints.map(({ text }) => text),
              span: parameter.span,
            })),
          }),
      ...(expression.returnAnnotation === undefined
        ? {}
        : { returnAnnotation: this.#resolveTypeAnnotation(expression.returnAnnotation, new Set(), impliedContext) }),
      body: this.#resolveExpr(expression.body, lambdaScope),
      span: expression.span,
    };
    this.#lambdaDepth -= 1;
    return resolved;
  }

  #resolveTypeAnnotation(
    annotation: Parsed.TypeAnnotation,
    typeParameters = new Set<string>(),
    impliedContext?: { readonly owner: string; readonly names: ReadonlySet<string> },
    substitutions: ReadonlyMap<string, Resolved.TypeAnnotation> = new Map(),
  ): Resolved.TypeAnnotation {
    if (annotation.kind === "Tuple") {
      return {
        kind: "Tuple",
        elements: annotation.elements.map((element) =>
          this.#resolveTypeAnnotation(element, typeParameters, impliedContext, substitutions),
        ),
        span: annotation.span,
      };
    }
    if (annotation.kind === "Record") {
      return {
        kind: "Record",
        fields: annotation.fields.map((field) => ({
          name: field.name.text,
          annotation: this.#resolveTypeAnnotation(field.annotation, typeParameters, impliedContext, substitutions),
          span: field.span,
        })),
        open: annotation.open,
        ...(annotation.tail === undefined ? {} : { tail: annotation.tail.text }),
        span: annotation.span,
      };
    }
    if (annotation.kind === "TypeVariable") {
      const replacement = substitutions.get(annotation.name.text);
      if (replacement !== undefined) return withTypeSpan(replacement, annotation.span);
      return {
        kind: "TypeVariable",
        name: annotation.name.text,
        span: annotation.span,
      };
    }
    const name = annotation.kind === "AppliedType"
      ? annotation.constructor.text
      : annotation.name.text;
    if (annotation.qualifier !== undefined) {
      const imported = this.#moduleAliases.get(annotation.qualifier.text);
      if (imported === undefined) {
        this.#diagnostics.add({
          severity: "error",
          message: `unknown module alias \`${annotation.qualifier.text}\``,
          primary: annotation.qualifier.span,
        });
        return { kind: "ErrorType", span: annotation.span };
      }
      const arguments_ = annotation.kind === "AppliedType"
        ? annotation.arguments.map((argument) => this.#resolveTypeAnnotation(argument, typeParameters, impliedContext, substitutions))
        : [];
      const union = imported.unions.get(name);
      if (union !== undefined) return this.#resolvedNominalType("union", union, name, arguments_, annotation.span);
      const record = imported.records.get(name);
      if (record !== undefined) return this.#resolvedNominalType("record", record, name, arguments_, annotation.span);
      const alias = imported.aliases.get(name);
      if (alias !== undefined) return this.#instantiateResolvedAlias(alias, arguments_, annotation.span);
      this.#diagnostics.add({
        severity: "error",
        message: `module \`${annotation.qualifier.text}\` does not export type \`${name}\``,
        primary: annotation.span,
      });
      return { kind: "ErrorType", span: annotation.span };
    }
    if (impliedContext?.names.has(name)) {
      if (annotation.kind === "AppliedType") {
        this.#diagnostics.add({
          severity: "error",
          message: `\`${name}\` is an implied type of \`${impliedContext.owner}\` and cannot be applied in v1`,
          primary: annotation.span,
        });
        return { kind: "ErrorType", span: annotation.span };
      }
      return {
        kind: "ImpliedType",
        constraint: impliedContext.owner,
        name,
        span: annotation.span,
      };
    }
    const alias = this.#typeAliases.get(name);
    if (alias !== undefined) {
      const arguments_ = annotation.kind === "AppliedType"
        ? annotation.arguments.map((argument) => this.#resolveTypeAnnotation(argument, typeParameters, impliedContext, substitutions))
        : [];
      return isResolvedTypeAlias(alias)
        ? this.#instantiateResolvedAlias(alias, arguments_, annotation.span)
        : this.#resolveAlias(name, arguments_, annotation.span, typeParameters, impliedContext, substitutions);
    }
    const union = this.#unionNames.get(name);
    if (union !== undefined) {
      const arguments_ = annotation.kind === "AppliedType"
        ? annotation.arguments.map((argument) =>
          this.#resolveTypeAnnotation(argument, typeParameters, impliedContext, substitutions)
        )
        : [];
      const expected = this.#unionArities.get(name) ?? 0;
      if (arguments_.length !== expected) {
        this.#diagnostics.add({
          severity: "error",
          message: `type \`${name}\` expects ${expected} argument${expected === 1 ? "" : "s"}, but ${arguments_.length} were provided`,
          primary: annotation.span,
        });
      }
      return {
        kind: "Union",
        union,
        name,
        arguments: arguments_,
        span: annotation.span,
      };
    }
    if (annotation.kind === "AppliedType") {
      if (name === "Seq" || name === "Vector" || name === "Set" || name === "Array" || name === "Nullable") {
        if (annotation.arguments.length !== 1) {
          this.#diagnostics.add({
            severity: "error",
            message: `type \`${name}\` expects 1 argument, but ${annotation.arguments.length} were provided`,
            primary: annotation.span,
          });
        }
        const argument = annotation.arguments[0] === undefined
          ? { kind: "ErrorType" as const, span: annotation.span }
          : this.#resolveTypeAnnotation(annotation.arguments[0], typeParameters, impliedContext, substitutions);
        if (name === "Nullable") return { kind: "Nullable", value: argument, span: annotation.span };
        if (name === "Seq") return { kind: "Seq", element: argument, span: annotation.span };
        if (name === "Vector") return { kind: "Vector", element: argument, span: annotation.span };
        if (name === "Set") return { kind: "Set", element: argument, span: annotation.span };
        return { kind: "Array", element: argument, span: annotation.span };
      }
      if (name === "Map") {
        if (annotation.arguments.length !== 2) {
          this.#diagnostics.add({
            severity: "error",
            message: `type \`Map\` expects 2 arguments, but ${annotation.arguments.length} were provided`,
            primary: annotation.span,
          });
        }
        return {
          kind: "Map",
          key: annotation.arguments[0] === undefined
            ? { kind: "ErrorType", span: annotation.span }
            : this.#resolveTypeAnnotation(annotation.arguments[0], typeParameters, impliedContext, substitutions),
          value: annotation.arguments[1] === undefined
            ? { kind: "ErrorType", span: annotation.span }
            : this.#resolveTypeAnnotation(annotation.arguments[1], typeParameters, impliedContext, substitutions),
          span: annotation.span,
        };
      }
      const record = this.#recordNames.get(name);
      if (record !== undefined) {
        const arguments_ = annotation.arguments.map((argument) =>
          this.#resolveTypeAnnotation(argument, typeParameters, impliedContext, substitutions)
        );
        const expected = this.#recordArities.get(name) ?? 0;
        if (arguments_.length !== expected) {
          this.#diagnostics.add({
            severity: "error",
            message: `type \`${name}\` expects ${expected} argument${expected === 1 ? "" : "s"}, but ${arguments_.length} were provided`,
            primary: annotation.span,
          });
        }
        return { kind: "RecordDeclaration", record, name, arguments: arguments_, span: annotation.span };
      }
      this.#diagnostics.add({
        severity: "error",
        message: `unknown generic type \`${name}\``,
        primary: annotation.span,
      });
      return { kind: "ErrorType", span: annotation.span };
    }
    const record = this.#recordNames.get(name);
    if (record !== undefined) {
      const expected = this.#recordArities.get(name) ?? 0;
      if (expected !== 0) {
        this.#diagnostics.add({
          severity: "error",
          message: `type \`${name}\` expects ${expected} argument${expected === 1 ? "" : "s"}, but 0 were provided`,
          primary: annotation.span,
        });
      }
      return { kind: "RecordDeclaration", record, name, arguments: [], span: annotation.span };
    }
    if (isPrimitiveName(annotation.name.text)) {
      return {
        kind: "Primitive",
        name: annotation.name.text,
        span: annotation.span,
      };
    }
    if (annotation.name.text === "Range") {
      return { kind: "Range", span: annotation.span };
    }

    const owners = this.#impliedTypeOwners.get(name);
    if (owners !== undefined) {
      const ownerNames = [...owners].sort();
      const ownership = ownerNames.length === 1
        ? `of \`${ownerNames[0]}\``
        : `declared by ${ownerNames.map((owner) => `\`${owner}\``).join(" and ")}`;
      this.#diagnostics.add({
        severity: "error",
        message: `\`${name}\` is an implied type ${ownership} and cannot appear in type expressions`,
        primary: annotation.span,
      });
      return { kind: "ErrorType", span: annotation.span };
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
    const symbol = Resolved.symbolId(this.#nextSymbol++);
    this.#symbols.set(symbol, {
      id: symbol,
      name: name.text,
      kind,
      bindingSpan: name.span,
    });
    return { symbol, name: name.text, span: name.span };
  }

  #resolveAlias(
    name: string,
    arguments_: readonly Resolved.TypeAnnotation[],
    span: Source.Span,
    outerParameters = new Set<string>(),
    impliedContext?: { readonly owner: string; readonly names: ReadonlySet<string> },
    outerSubstitutions: ReadonlyMap<string, Resolved.TypeAnnotation> = new Map(),
  ): Resolved.TypeAnnotation {
    const alias = this.#typeAliases.get(name);
    if (alias === undefined || isResolvedTypeAlias(alias)) return { kind: "ErrorType", span };
    if (this.#resolvingAliases.includes(name)) {
      const cycle = [...this.#resolvingAliases.slice(this.#resolvingAliases.indexOf(name)), name];
      this.#diagnostics.add({
        severity: "error",
        message: `recursive type alias cycle: ${cycle.map((part) => `\`${part}\``).join(" -> ")}`,
        primary: span,
      });
      return { kind: "ErrorType", span };
    }
    if (arguments_.length !== alias.parameters.length) {
      this.#diagnostics.add({
        severity: "error",
        message: `type alias \`${name}\` expects ${alias.parameters.length} argument${alias.parameters.length === 1 ? "" : "s"}, but ${arguments_.length} were provided`,
        primary: span,
      });
    }
    const replacements = new Map(outerSubstitutions);
    alias.parameters.forEach((parameter, index) => {
      replacements.set(parameter.text, arguments_[index] ?? { kind: "ErrorType", span });
    });
    this.#resolvingAliases.push(name);
    const result = this.#resolveTypeAnnotation(
      alias.annotation,
      new Set([...outerParameters, ...alias.parameters.map(({ text }) => text)]),
      impliedContext,
      replacements,
    );
    this.#resolvingAliases.pop();
    return withTypeSpan(result, span);
  }

  #instantiateResolvedAlias(
    alias: Resolved.TypeAliasItem,
    arguments_: readonly Resolved.TypeAnnotation[],
    span: Source.Span,
  ): Resolved.TypeAnnotation {
    if (arguments_.length !== alias.parameters.length) {
      this.#diagnostics.add({
        severity: "error",
        message: `type alias \`${alias.name}\` expects ${alias.parameters.length} argument${alias.parameters.length === 1 ? "" : "s"}, but ${arguments_.length} were provided`,
        primary: span,
      });
    }
    const replacements = new Map(alias.parameters.map((parameter, index) => [
      parameter,
      arguments_[index] ?? { kind: "ErrorType" as const, span },
    ]));
    return substituteResolvedType(alias.annotation, replacements, span);
  }

  #resolvedNominalType(
    kind: "union" | "record",
    declaration: Resolved.Union | Resolved.RecordDeclaration,
    name: string,
    arguments_: readonly Resolved.TypeAnnotation[],
    span: Source.Span,
  ): Resolved.TypeAnnotation {
    const expected = declaration.parameters.length;
    if (arguments_.length !== expected) {
      this.#diagnostics.add({
        severity: "error",
        message: `type \`${name}\` expects ${expected} argument${expected === 1 ? "" : "s"}, but ${arguments_.length} were provided`,
        primary: span,
      });
    }
    return kind === "union"
      ? { kind: "Union", union: (declaration as Resolved.Union).id, name, arguments: arguments_, span }
      : { kind: "RecordDeclaration", record: (declaration as Resolved.RecordDeclaration).id, name, arguments: arguments_, span };
  }

  #includeNominals(imported: ModuleInterface): void {
    for (const union of imported.unions.values()) {
      if (!this.#unions.some(({ id }) => id === union.id)) this.#unions.push({ ...union, representationVisible: false });
    }
    for (const record of imported.records.values()) {
      if (!this.#records.some(({ id }) => id === record.id)) this.#records.push({ ...record, representationVisible: false });
    }
  }

  #findPending(
    name: string,
  ): { readonly name: Parsed.Name; readonly kind: "let" | "var" } | undefined {
    for (let index = this.#pending.length - 1; index >= 0; index -= 1) {
      const pending = this.#pending[index];
      if (pending?.name.text === name) return pending;
    }
    return undefined;
  }

  #checkFunctionAvailability(items: readonly Resolved.Item[]): void {
    const required = (symbol: Resolved.SymbolId, visiting = new Set<Resolved.SymbolId>()): Set<Resolved.SymbolId> => {
      if (visiting.has(symbol)) return new Set();
      const next = new Set(visiting);
      next.add(symbol);
      const captures = new Set(this.#funCaptures.get(symbol) ?? []);
      for (const dependency of this.#funDependencies.get(symbol) ?? []) {
        for (const capture of required(dependency, next)) captures.add(capture);
      }
      return captures;
    };
    const available = new Set<Resolved.SymbolId>();
    for (const item of items) if (item.kind === "Fun") available.add(item.binding.symbol);
    for (const item of items) {
      if (item.kind !== "Fun") {
        for (const reference of itemNameReferences(item)) {
          if (this.#symbol(reference.symbol).kind !== "fun") continue;
          const missing = [...required(reference.symbol)].find((capture) => !available.has(capture));
          if (missing === undefined) continue;
          const captured = this.#symbol(missing);
          this.#diagnostics.add({
            severity: "error",
            message: `\`${reference.text}\` cannot be used before captured value \`${captured.name}\` is bound`,
            primary: reference.span,
            labels: [{ span: captured.bindingSpan, message: "captured value is bound here" }],
          });
        }
      }
      if (item.kind === "Let" || item.kind === "Var") available.add(item.binding.symbol);
      if (item.kind === "LetPattern") for (const binding of resolvedPatternBindings(item.pattern)) available.add(binding.symbol);
    }
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
    const symbol = this.#symbols.get(id) ?? this.#importedSymbols.get(id);
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
  return ["Int", "Float", "Bool", "String", "BigInt", "Exn", "Unit"].includes(name);
}

function isResolvedTypeAlias(
  alias: Parsed.TypeAliasItem | Resolved.TypeAliasItem,
): alias is Resolved.TypeAliasItem {
  return typeof alias.name === "string";
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
    case "Vector":
      return [
        ...pattern.elements.flatMap(parsedPatternNames),
        ...(pattern.kind === "Vector" && pattern.rest?.pattern !== undefined
          ? parsedPatternNames(pattern.rest.pattern)
          : []),
      ];
    case "Record":
      return pattern.fields.flatMap((field) => parsedPatternNames(field.pattern));
    case "Constructor":
      return pattern.arguments.flatMap(parsedPatternNames);
  }
}

function annotationHeadName(annotation: Resolved.TypeAnnotation): string {
  switch (annotation.kind) {
    case "Primitive": return annotation.name;
    case "Range": return "Range";
    case "Seq": return "Seq";
    case "Vector": return "Vector";
    case "Map": return "Map";
    case "Set": return "Set";
    case "Array": return "Array";
    case "Nullable": return "Nullable";
    case "Union": return annotation.name;
    case "RecordDeclaration": return annotation.name;
    case "Tuple": return "Tuple";
    case "Record": return "Record";
    case "TypeVariable": return annotation.name;
    case "ImpliedType": return annotation.name;
    case "ErrorType": return "Error";
  }
}

function annotationTypeVariables(annotation: Resolved.TypeAnnotation): readonly string[] {
  switch (annotation.kind) {
    case "TypeVariable": return [annotation.name];
    case "Seq": return annotationTypeVariables(annotation.element);
    case "Vector": return annotationTypeVariables(annotation.element);
    case "Set": return annotationTypeVariables(annotation.element);
    case "Array": return annotationTypeVariables(annotation.element);
    case "Nullable": return annotationTypeVariables(annotation.value);
    case "Map": return [
      ...annotationTypeVariables(annotation.key),
      ...annotationTypeVariables(annotation.value),
    ];
    case "Tuple": return annotation.elements.flatMap(annotationTypeVariables);
    case "Record": return annotation.fields.flatMap((field) =>
      annotationTypeVariables(field.annotation)
    );
    case "Union":
    case "RecordDeclaration":
      return annotation.arguments.flatMap(annotationTypeVariables);
    case "Primitive":
    case "Range":
    case "ImpliedType":
    case "ErrorType":
      return [];
  }
}

function parsedAnnotationTypeVariables(annotation: Parsed.TypeAnnotation): ReadonlySet<string> {
  const names = new Set<string>();
  const visit = (type: Parsed.TypeAnnotation): void => {
    if (type.kind === "TypeVariable") names.add(type.name.text);
    else if (type.kind === "Tuple") type.elements.forEach(visit);
    else if (type.kind === "Record") type.fields.forEach((field) => visit(field.annotation));
    else if (type.kind === "AppliedType") type.arguments.forEach(visit);
  };
  visit(annotation);
  return names;
}

function withTypeSpan(type: Resolved.TypeAnnotation, span: Source.Span): Resolved.TypeAnnotation {
  return { ...type, span };
}

function substituteResolvedType(
  type: Resolved.TypeAnnotation,
  replacements: ReadonlyMap<string, Resolved.TypeAnnotation>,
  span = type.span,
): Resolved.TypeAnnotation {
  if (type.kind === "TypeVariable") return withTypeSpan(replacements.get(type.name) ?? type, span);
  if (type.kind === "Tuple") return { ...type, elements: type.elements.map((element) => substituteResolvedType(element, replacements)), span };
  if (type.kind === "Record") return {
    ...type,
    fields: type.fields.map((field) => ({ ...field, annotation: substituteResolvedType(field.annotation, replacements) })),
    span,
  };
  if (type.kind === "Seq" || type.kind === "Vector" || type.kind === "Set" || type.kind === "Array") {
    return { ...type, element: substituteResolvedType(type.element, replacements), span };
  }
  if (type.kind === "Nullable") return { ...type, value: substituteResolvedType(type.value, replacements), span };
  if (type.kind === "Map") return {
    ...type,
    key: substituteResolvedType(type.key, replacements),
    value: substituteResolvedType(type.value, replacements),
    span,
  };
  if (type.kind === "Union" || type.kind === "RecordDeclaration") {
    return { ...type, arguments: type.arguments.map((argument) => substituteResolvedType(argument, replacements)), span };
  }
  return { ...type, span };
}

function itemNameReferences(item: Resolved.Item): readonly Resolved.NameExpr[] {
  if (item.kind === "Let" || item.kind === "Var" || item.kind === "LetPattern") return expressionNames(item.value);
  if (item.kind === "ExprItem") return expressionNames(item.expression);
  if (item.kind === "Honor") return item.members.flatMap((member) => expressionNames(member.value.body));
  return [];
}

function expressionNames(expression: Resolved.Expr): Resolved.NameExpr[] {
  if (expression.kind === "Name") return [expression];
  if (expression.kind === "Unit" || expression.kind === "Boolean" || expression.kind === "Integer" || expression.kind === "BigInt" || expression.kind === "Float" || expression.kind === "ErrorExpr" || expression.kind === "SeqOperation" || expression.kind === "CollectionOperation") return [];
  if (expression.kind === "String") return expression.parts.flatMap((part) => part.kind === "Interpolation" ? expressionNames(part.expression) : []);
  if (expression.kind === "Tuple" || expression.kind === "Vector") return expression.elements.flatMap(expressionNames);
  if (expression.kind === "Record") return [...(expression.spread === undefined ? [] : expressionNames(expression.spread)), ...expression.fields.flatMap((field) => expressionNames(field.value))];
  if (expression.kind === "Group") return expressionNames(expression.expression);
  if (expression.kind === "Block") return expression.items.flatMap(itemNameReferences);
  if (expression.kind === "Lambda") return expressionNames(expression.body);
  if (expression.kind === "If") return [...expressionNames(expression.condition), ...expressionNames(expression.consequence), ...(expression.alternative === undefined ? [] : expressionNames(expression.alternative))];
  if (expression.kind === "While") return [...expressionNames(expression.condition), ...expressionNames(expression.body)];
  if (expression.kind === "For") return [...expressionNames(expression.iterable), ...expressionNames(expression.body)];
  if (expression.kind === "Match") return [
    ...expressionNames(expression.scrutinee),
    ...expression.arms.flatMap((arm) => [...(arm.guard === undefined ? [] : expressionNames(arm.guard)), ...expressionNames(arm.body)]),
  ];
  if (expression.kind === "Try") return [...expressionNames(expression.body), ...expression.arms.flatMap((arm) => expressionNames(arm.body))];
  if (expression.kind === "Throw") return expressionNames(expression.exception);
  if (expression.kind === "Call") return [...expressionNames(expression.callee), ...expression.arguments.flatMap(expressionNames)];
  if (expression.kind === "ConsoleLog") return expression.arguments.flatMap(expressionNames);
  if (expression.kind === "Access") return expressionNames(expression.receiver);
  if (expression.kind === "Hash") return expressionNames(expression.value);
  if (expression.kind === "Index") return [...expressionNames(expression.receiver), ...expressionNames(expression.index)];
  if (expression.kind === "Unary") return expressionNames(expression.operand);
  if (expression.kind === "Binary") return [...expressionNames(expression.left), ...expressionNames(expression.right)];
  if (expression.kind === "Comparison") return expression.operands.flatMap(expressionNames);
  return [...expressionNames(expression.target), ...expressionNames(expression.value)];
}

function resolvedPatternBindings(pattern: Resolved.Pattern): readonly Resolved.Binding[] {
  if (pattern.kind === "Binding") return [pattern.binding];
  if (pattern.kind === "As") return [...resolvedPatternBindings(pattern.pattern), pattern.binding];
  if (pattern.kind === "Or") return pattern.alternatives[0] === undefined ? [] : resolvedPatternBindings(pattern.alternatives[0]);
  if (pattern.kind === "Tuple" || pattern.kind === "Vector") return [
    ...pattern.elements.flatMap(resolvedPatternBindings),
    ...(pattern.kind === "Vector" && pattern.rest?.pattern !== undefined ? resolvedPatternBindings(pattern.rest.pattern) : []),
  ];
  if (pattern.kind === "Record") return pattern.fields.flatMap((field) => resolvedPatternBindings(field.pattern));
  if (pattern.kind === "Constructor") return pattern.arguments.flatMap(resolvedPatternBindings);
  return [];
}
