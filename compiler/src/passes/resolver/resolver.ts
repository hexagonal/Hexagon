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
  readonly externTypes: ReadonlyMap<string, Resolved.ExternTypeDeclaration>;
  readonly instances: readonly InstanceInterface[];
}

export interface InstanceInterface {
  readonly identity: string;
  readonly constraint: string;
  readonly typeParameters: readonly Resolved.TypeParameter[];
  readonly subject: Resolved.TypeAnnotation;
  readonly impliedTypes: readonly Resolved.HonorImpliedType[];
  readonly dictionary: string;
  readonly span: Source.Span;
}

/**
 * Which of Statements §5's two binder classes a pattern's binders take. The
 * class comes from the binder's *position*, never from the pattern's grammar:
 * the same `{name}` is sequential on a `let` LHS and a head binder in a lambda
 * head or a match arm.
 *
 * - `"sequential"` — a `let` pattern. Scopes over the open-ended rest of its
 *   block, so it may not reuse any name in scope (§5.1 rule 1).
 * - `"head"` — a match arm, a catch arm, or a `for..in` binder. Governs a region
 *   the construct delimits and owns a scope of its own, so it may shadow
 *   anything (rule 2) with nothing to collide against.
 * - `"parameter"` — a pattern parameter. A head binder as well, but one that
 *   shares the lambda's scope with the parameters beside it, so the one name it
 *   may not take is a sibling parameter's (rule 3).
 */
type BinderClass = "sequential" | "head" | "parameter";

/** Sequential binders are `let`s; both head classes are pattern binders. */
function declaredKind(binderClass: BinderClass): Resolved.SymbolKind {
  return binderClass === "sequential" ? "let" : "pattern";
}

/** Two spans in the order a reader meets them, so a diagnostic can point in source order. */
function orderedBySource(a: Source.Span, b: Source.Span): readonly [Source.Span, Source.Span] {
  return a.start.offset <= b.start.offset ? [a, b] : [b, a];
}

/**
 * Opens a lambda body with the bindings its pattern parameters destructure
 * through, so everything downstream sees the shape a hand-written destructuring
 * `let` would have produced — the binders having already been classified in the
 * head, where they belong.
 */
function openedWith(
  bindings: readonly Resolved.LetPatternItem[],
  body: Resolved.Expr,
): Resolved.Expr {
  if (bindings.length === 0) return body;
  const items: readonly Resolved.Item[] = body.kind === "Block"
    ? [...bindings, ...body.items]
    : [...bindings, { kind: "ExprItem", expression: body, span: body.span }];
  return { kind: "Block", items, span: body.span };
}

/** One prelude module made implicitly available, with the specifier this module imports it by. */
export interface PreludeImport {
  readonly interface: ModuleInterface;
  readonly specifier: string;
}

export interface ResolveOptions {
  readonly imports?: ReadonlyMap<string, ModuleInterface>;
  readonly symbolBase?: number;
  readonly unionBase?: number;
  readonly recordBase?: number;
  readonly externTypeBase?: number;
  /**
   * The prelude modules, implicitly in scope in every non-prelude module. Their
   * names are seeded into a shadowable fallback scope (local declarations win),
   * and a used-names-only import is synthesized per prelude module that a module
   * references, so emission stays free of unused prelude imports.
   */
  readonly prelude?: readonly PreludeImport[];
  /**
   * Whether this module is a privileged runtime module. Only runtime modules may
   * name the hidden `Node` trie intrinsic (`Node.empty/get/set/copy`); in user
   * code `Node` resolves as an ordinary — and therefore unknown — name, so the
   * intrinsic stays unimportable and invisible. See the persistent-collections
   * design note §5.2.
   */
  readonly runtime?: boolean;
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
  const externTypes = new Map<string, Resolved.ExternTypeDeclaration>();
  const discoveredInstances: InstanceInterface[] = module.items.flatMap((item) => {
    if (item.kind === "Honor") {
      return [{
        identity: `${Number(module.fileId)}:${item.dictionary}`,
        constraint: item.constraint,
        typeParameters: item.typeParameters,
        subject: item.subject,
        impliedTypes: item.impliedTypes,
        dictionary: item.dictionary,
        span: item.span,
      }];
    }
    if (item.kind !== "Import") return [];
    return item.instances.map((instance) => ({
      identity: instance.identity,
      constraint: instance.constraint,
      typeParameters: instance.typeParameters,
      subject: instance.subject,
      impliedTypes: instance.impliedTypes,
      dictionary: instance.localDictionary,
      span: instance.span,
    }));
  });
  const instances = [...new Map(
    discoveredInstances.map((instance) => [instance.identity, instance]),
  ).values()];
  for (const item of module.items) {
    if (item.kind === "ExternBlock") {
      for (const declaration of item.declarations) {
        if (!declaration.exported) continue;
        if (declaration.kind === "ExternType") externTypes.set(declaration.localName, declaration);
        else {
          const symbol = symbols.get(declaration.binding.symbol);
          if (symbol !== undefined) terms.set(declaration.localName, symbol);
        }
      }
      continue;
    }
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
  return { module, terms, unions, records, aliases, externTypes, instances };
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
  readonly #externTypes: Resolved.ExternTypeDeclaration[] = [];
  readonly #unionNames = new Map<string, Resolved.UnionId>();
  readonly #unionArities = new Map<string, number>();
  readonly #recordNames = new Map<string, Resolved.RecordId>();
  /** Record identities the prelude supplies, by name, immune to local occlusion. */
  readonly #preludeRecords = new Map<string, Resolved.RecordId>();
  readonly #recordArities = new Map<string, number>();
  readonly #externTypeNames = new Map<string, Resolved.ExternTypeId>();
  readonly #typeAliases = new Map<string, Parsed.TypeAliasItem | Resolved.TypeAliasItem>();
  readonly #unionDeclarations = new WeakMap<Parsed.UnionItem, Resolved.UnionId>();
  readonly #recordDeclarations = new WeakMap<Parsed.RecordItem, Resolved.RecordId>();
  readonly #externTypeDeclarations = new WeakMap<Parsed.ExternTypeDeclaration, Resolved.ExternTypeId>();
  readonly #resolvingAliases: string[] = [];
  readonly #imports: ReadonlyMap<string, ModuleInterface>;
  readonly #runtime: boolean;
  readonly #preludeScope = new Scope();
  #moduleScope: Scope | undefined;
  readonly #preludeTerms = new Map<Resolved.SymbolId, Resolved.Symbol>();
  readonly #preludeTypeNames = new Set<string>();
  readonly #preludeSpecifierBySymbol = new Map<Resolved.SymbolId, string>();
  readonly #preludeInterfaceBySpecifier = new Map<string, ModuleInterface>();
  readonly #usedPreludeSymbols = new Set<Resolved.SymbolId>();
  readonly #explicitlyImported = new Set<Resolved.SymbolId>();
  readonly #moduleAliases = new Map<string, ModuleInterface>();
  /** Prelude members addressable by name — a fallback layer, so an explicit
   *  `import * as` of the same name is a module-level binding and wins (§5.4). */
  readonly #preludeModuleAliases = new Map<string, ModuleInterface>();
  readonly #constraintNames = new Set<string>([
    "Num", "Signed", "Frac", "Pow", "Concat", "Eq", "Ord", "Show",
  ]);
  readonly #impliedTypeOwners = new Map<string, Set<string>>();
  readonly #pending: { readonly name: Parsed.Name; readonly kind: "let" | "var" }[] = [];
  readonly #predeclaredBindings = new WeakMap<Parsed.LetItem | Parsed.VarItem | Parsed.FunItem | Parsed.ExternFunDeclaration | Parsed.ExternLetDeclaration, Resolved.Binding>();
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
  #nextExternType: number;

  constructor(diagnostics: Diagnostics.Bag, options: ResolveOptions) {
    this.#diagnostics = diagnostics;
    this.#imports = options.imports ?? new Map();
    this.#runtime = options.runtime ?? false;
    this.#nextSymbol = options.symbolBase ?? 0;
    this.#nextUnion = options.unionBase ?? 0;
    this.#nextRecord = options.recordBase ?? 0;
    this.#nextExternType = options.externTypeBase ?? 0;
    for (const preludeImport of options.prelude ?? []) {
      this.#seedPrelude(preludeImport.interface, preludeImport.specifier);
    }
  }

  /**
   * A module addressable by name: an explicit `import * as` alias first, then the
   * prelude layer. Modules §6.4 requires every prelude name to have a qualified
   * home; §5.4 makes an explicit alias a module-level binding, so it wins.
   */
  #namedModule(name: string): ModuleInterface | undefined {
    return this.#moduleAliases.get(name) ?? this.#preludeModuleAliases.get(name);
  }

  /**
   * Makes a prelude term reachable from emitted code, returning the name to
   * spell it by, or `undefined` if the symbol is not a prelude term.
   *
   * A prelude member has no namespace object to dot into — unlike an explicit
   * `import * as`, nothing declares one. So the reference compiles to a plain
   * name backed by the same synthesized used-names-only import the bare spelling
   * uses, and the symbol has to join that set or the emitted module references
   * nothing.
   *
   * The *local* the import binds it under is decided later, in `#preludeImport`,
   * because choosing it here would mean guessing which names the module will go
   * on to bind (PR #91 finding F1). The reference carries the term's own name;
   * emission substitutes the import's local.
   */
  #reachPreludeTerm(symbol: Resolved.SymbolId): string | undefined {
    const term = this.#preludeTerms.get(symbol);
    if (term === undefined) return undefined;
    this.#usedPreludeSymbols.add(symbol);
    return term.name;
  }

  /**
   * Marks a prelude term that *companion dispatch* might reach through this
   * field name. `source.map(f)` names no module, and whether it is a dispatch or
   * a call of a function-valued field depends on the receiver's **type** — which
   * the checker decides, long after the synthesized prelude import is built. So
   * the candidate is registered here, from the one syntactic form dispatch can
   * take. It is conservative in one direction only: at worst a spare named
   * import of a name the prelude really exports, never a missing one.
   *
   * The failure this prevents is the silent kind (defect log entries 8 and 10):
   * the module compiles clean and its emitted JavaScript calls a name it never
   * imported. `Seq.hex` is the first prelude module to export dispatchable
   * lowercase operations, so nothing exercised this before.
   */
  #noteCompanionCandidate(field: string): void {
    const symbol = this.#preludeScope.lookupLocal(field);
    if (symbol !== undefined) this.#reachPreludeTerm(symbol);
  }

  /**
   * Makes one prelude module's nominals implicitly available. Terms go into a
   * fallback scope so a local declaration of the same name shadows the prelude;
   * type identities are registered so annotations resolve and the checker sees
   * them. The specifier is recorded per term so the synthesized import points at
   * the module the name actually came from.
   */
  #seedPrelude(prelude: ModuleInterface, specifier: string): void {
    this.#preludeInterfaceBySpecifier.set(specifier, prelude);
    // Modules §6.4: the occlusion rule's "the prelude version stays reachable
    // qualified" only works if the member can be *named*. Registering it under
    // its own basename gives every prelude name the qualified home §6.4 requires,
    // the same way an explicit `import * as` alias would. An explicit alias of
    // the same name is a module-level binding and wins, per §5.4.
    const moduleName = specifier.slice(specifier.lastIndexOf("/") + 1).replace(/\.js$/u, "");
    if (moduleName !== "") this.#preludeModuleAliases.set(moduleName, prelude);
    for (const [name, symbol] of prelude.terms) {
      this.#preludeScope.define(name, symbol.id);
      this.#preludeTerms.set(symbol.id, symbol);
      this.#preludeSpecifierBySymbol.set(symbol.id, specifier);
      // Registered eagerly so `#symbol` resolves prelude references during body
      // resolution; unused entries never reach emission (the import lists only
      // the terms actually referenced) and are excluded from id-base progression.
      this.#importedSymbols.set(symbol.id, symbol);
    }
    for (const [name, union] of prelude.unions) {
      this.#preludeTypeNames.add(name);
      this.#unionNames.set(name, union.id);
      this.#unionArities.set(name, union.parameters.length);
      if (!this.#unions.some(({ id }) => id === union.id)) {
        this.#unions.push({ ...union, representationVisible: false });
      }
    }
    for (const [name, record] of prelude.records) {
      this.#preludeTypeNames.add(name);
      // Kept separately from `#recordNames`, which a local declaration may
      // occlude (§5.4). The compiler's own producers must reach the *prelude's*
      // `Seq`, not whatever record a module happens to name `Seq`, so they need
      // an identity that occlusion cannot move.
      this.#preludeRecords.set(name, record.id);
      this.#recordNames.set(name, record.id);
      this.#recordArities.set(name, record.parameters.length);
      if (!this.#records.some(({ id }) => id === record.id)) {
        this.#records.push({ ...record, representationVisible: false });
      }
    }
    for (const [name, alias] of prelude.aliases) {
      this.#preludeTypeNames.add(name);
      this.#typeAliases.set(name, { ...alias, name });
    }
    for (const [name, externType] of prelude.externTypes) {
      this.#preludeTypeNames.add(name);
      this.#externTypeNames.set(name, externType.externType);
      if (!this.#externTypes.some(({ externType: id }) => id === externType.externType)) {
        this.#externTypes.push({ ...externType, localName: name });
      }
    }
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
    const scope = new Scope(this.#preludeScope);
    // The one scope whose parent is the prelude layer, and so the only one where
    // Modules §5.4 permits occlusion. Held rather than inferred: "module level"
    // is scope identity, not nesting depth — a block body of a module-level
    // `let` runs at lambda depth 0 but is an inner layer, where the ban is
    // absolute.
    this.#moduleScope = scope;
    this.#predeclareExternTerms(module.items, scope);
    const resolvedItems = this.#resolveItems(module.items, scope);
    // After resolution, never before: the synthesized import's local names have
    // to dodge every name the emitted module binds, and that set is only closed
    // once every declaration has been through `#declare` (PR #91 finding F1).
    const items = [...this.#preludeImport(module.span, resolvedItems), ...resolvedItems];

    return {
      kind: "Module",
      fileId: module.fileId,
      items,
      symbols: [...this.#importedSymbols.values(), ...this.#symbols.values()],
      unions: this.#unions,
      records: this.#records,
      preludeRecords: this.#preludeRecords,
      externTypes: this.#externTypes,
      comments: module.comments,
      span: module.span,
      diagnostics: this.#diagnostics.toArray(),
    };
  }

  /** Registers module type identities before resolving any declaration body. */
  #predeclareTypes(items: readonly Parsed.Item[]): void {
    const claimed = new Map<string, Source.Span>();
    const declarations: (
      | Parsed.TypeAliasItem
      | Parsed.UnionItem
      | Parsed.RecordItem
      | Parsed.ExternTypeDeclaration
    )[] = [];
    for (const item of items) {
      if (item.kind === "TypeAlias" || item.kind === "Union" || item.kind === "RecordDeclaration") {
        declarations.push(item);
      } else if (item.kind === "ExternBlock") {
        declarations.push(...item.declarations.filter(
          (declaration): declaration is Parsed.ExternTypeDeclaration =>
            declaration.kind === "ExternType",
        ));
      }
    }
    for (const item of declarations) {
      const itemName = item.kind === "ExternType" ? item.localName : item.name;
      const previous = claimed.get(itemName.text);
      if (previous !== undefined) {
        this.#diagnostics.add({
          severity: "error",
          message: `type \`${itemName.text}\` is already declared`,
          primary: itemName.span,
          labels: [{ span: previous, message: "first declaration is here" }],
        });
        continue;
      }
      claimed.set(itemName.text, itemName.span);
      if (item.kind === "TypeAlias") {
        this.#typeAliases.set(item.name.text, item);
      } else if (item.kind === "Union") {
        const id = Resolved.unionId(this.#nextUnion++);
        this.#unionDeclarations.set(item, id);
        this.#unionNames.set(item.name.text, id);
        this.#unionArities.set(item.name.text, item.parameters.length);
      } else if (item.kind === "RecordDeclaration") {
        const id = Resolved.recordId(this.#nextRecord++);
        this.#recordDeclarations.set(item, id);
        this.#recordNames.set(item.name.text, id);
        this.#recordArities.set(item.name.text, item.parameters.length);
      } else {
        const id = Resolved.externTypeId(this.#nextExternType++);
        this.#externTypeDeclarations.set(item, id);
        this.#externTypeNames.set(item.localName.text, id);
      }
    }
  }

  #predeclareExternTerms(items: readonly Parsed.Item[], scope: Scope): void {
    for (const item of items) {
      if (item.kind !== "ExternBlock") continue;
      for (const declaration of item.declarations) {
        if (declaration.kind === "ExternType") continue;
        const existing = scope.lookupLocal(declaration.localName.text);
        if (existing !== undefined) this.#reportRebinding(declaration.localName, existing);
        const binding = this.#declare(declaration.localName, "extern");
        this.#predeclaredBindings.set(declaration, binding);
        if (existing === undefined) scope.define(declaration.localName.text, binding.symbol);
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
            this.#includeNominals(importedModule, item.form.alias.text);
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
              const externType = importedModule?.externTypes.get(name.imported.text);
              if (term === undefined && union === undefined && record === undefined && alias === undefined && externType === undefined) {
                this.#diagnostics.add({
                  severity: "error",
                  message: `module \`${item.specifier}\` does not export \`${name.imported.text}\``,
                  primary: name.span,
                });
              }
              if (term !== undefined) {
                const existing = scope.lookup(name.local.text);
                // A prelude name is a shadowable fallback: an explicit import of
                // the same local name overrides it silently (and takes over its
                // emission, so it is excluded from the synthesized prelude import).
                if (existing !== undefined && !this.#preludeTerms.has(existing)) {
                  this.#reportRebinding(name.local, existing);
                } else {
                  scope.define(name.local.text, term.id);
                }
                this.#explicitlyImported.add(term.id);
                this.#importedSymbols.set(term.id, term);
              }
              if (union !== undefined) {
                if ((this.#unionNames.has(name.local.text) || this.#recordNames.has(name.local.text)) && !this.#preludeTypeNames.has(name.local.text)) {
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
                if ((this.#unionNames.has(name.local.text) || this.#recordNames.has(name.local.text)) && !this.#preludeTypeNames.has(name.local.text)) {
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
                if ((this.#typeAliases.has(name.local.text) || this.#unionNames.has(name.local.text) || this.#recordNames.has(name.local.text) || this.#externTypeNames.has(name.local.text)) && !this.#preludeTypeNames.has(name.local.text)) {
                  this.#diagnostics.add({
                    severity: "error",
                    message: `type \`${name.local.text}\` is already declared or imported`,
                    primary: name.span,
                  });
                } else {
                  this.#typeAliases.set(name.local.text, { ...alias, name: name.local.text });
                }
              }
              if (externType !== undefined) {
                if ((this.#typeAliases.has(name.local.text) || this.#unionNames.has(name.local.text) || this.#recordNames.has(name.local.text) || this.#externTypeNames.has(name.local.text)) && !this.#preludeTypeNames.has(name.local.text)) {
                  this.#diagnostics.add({
                    severity: "error",
                    message: `type \`${name.local.text}\` is already declared or imported`,
                    primary: name.span,
                  });
                } else {
                  this.#externTypeNames.set(name.local.text, externType.externType);
                  if (!this.#externTypes.some(({ externType: id }) => id === externType.externType)) {
                    this.#externTypes.push({ ...externType, localName: name.local.text });
                  }
                }
              }
              return {
                imported: name.imported.text,
                local: name.local.text,
                ...(term === undefined ? {} : { symbol: term.id }),
                ...(term === undefined && (union !== undefined || record !== undefined || alias !== undefined || externType !== undefined)
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
          instances: (importedModule?.instances ?? []).map((instance) => ({
            identity: instance.identity,
            constraint: instance.constraint,
            typeParameters: instance.typeParameters,
            subject: instance.subject,
            impliedTypes: instance.impliedTypes,
            importedDictionary: instance.dictionary,
            localDictionary:
              `__hex_imported_${Number(importedModule!.module.fileId)}_${instance.dictionary}`,
            span: item.span,
          })),
          span: item.span,
        };
      }
      case "ExternImport":
        return item;
      case "ExternBlock": {
        const declarations = item.declarations.map((declaration): Resolved.ExternDeclaration => {
          if (declaration.kind === "ExternType") {
            const resolved: Resolved.ExternTypeDeclaration = {
              kind: "ExternType",
              exported: declaration.exported,
              default: false,
              ...(declaration.foreignName === undefined ? {} : { foreignName: declaration.foreignName.text }),
              localName: declaration.localName.text,
              externType: this.#externTypeDeclarations.get(declaration) ?? Resolved.externTypeId(this.#nextExternType++),
              span: declaration.span,
            };
            this.#externTypes.push(resolved);
            return resolved;
          }
          const binding = this.#predeclaredBindings.get(declaration) ?? this.#declare(declaration.localName, "extern");
          const common = {
            exported: declaration.exported,
            default: declaration.default,
            ...(declaration.foreignName === undefined ? {} : { foreignName: declaration.foreignName.text }),
            localName: declaration.localName.text,
            binding,
            span: declaration.span,
          };
          if (declaration.kind === "ExternLet") {
            return {
              kind: "ExternLet",
              ...common,
              annotation: this.#resolveTypeAnnotation(declaration.annotation),
            };
          }
          const parameters = declaration.parameters.map((parameter) => ({
            ...this.#declare(parameter.name, "parameter"),
            ...(parameter.annotation === undefined
              ? {}
              : { annotation: this.#resolveTypeAnnotation(parameter.annotation) }),
          }));
          return {
            kind: "ExternFun",
            ...common,
            parameters,
            returnAnnotation: this.#resolveTypeAnnotation(declaration.returnAnnotation),
          };
        });
        return {
          kind: "ExternBlock",
          specifier: item.specifier,
          declarations,
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
          // A constraint member binds at module level, so §5.4's occlusion rule
          // applies to it exactly as it does to `let` and `fun` (defect 9): it
          // may occlude a prelude name and may not collide with a sibling in its
          // own layer. Same scope-identity test, same reason — a depth test
          // would license shadowing in inner layers (PR #89 finding F1).
          const existing = scope === this.#moduleScope
            ? scope.lookupLocal(member.name.text)
            : scope.lookup(member.name.text);
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
          baseConstraints: item.baseConstraints.map(({ text }) => text),
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
        // Modules §5.4 is layered: a binder in the *module's own scope* may
        // occlude a prelude name (the local one wins unqualified, the prelude's
        // stays reachable qualified), while any binder in an inner layer may
        // occlude nothing — prelude included, and layer-blind. `lookupLocal`
        // stops at this module's layer; `lookup` walks out through the prelude.
        // `fun` already drew this distinction in the predeclare pass; `let` did
        // not, which is why the rule went untested until the prelude first
        // exported a lowercase name.
        //
        // The test is scope *identity*, not nesting depth: the block body of a
        // module-level `let` runs at lambda depth 0 yet is an inner layer, so a
        // depth test would quietly license shadowing there (PR #89 finding F1).
        const existing = scope === this.#moduleScope
          ? scope.lookupLocal(item.name.text)
          : scope.lookup(item.name.text);
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
        const pattern = this.#resolvePattern(item.pattern, scope, seen, "sequential");
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
      case "If":
        return {
          kind: "If" as const,
          condition: this.#resolveExpr(expression.condition, scope),
          consequence: this.#resolveExpr(expression.consequence, scope),
          alternative: this.#resolveExpr(expression.alternative, scope),
          ...(expression.elseless ? { elseless: true } : {}),
          span: expression.span,
        };
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
          "head",
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
              "head",
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
            const pattern = this.#resolvePattern(
              arm.pattern,
              armScope,
              new Map(),
              "head",
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
        if (
          expression.callee.kind === "Access" &&
          !(expression.callee.receiver.kind === "Name" &&
            this.#namedModule(expression.callee.receiver.name.text) !== undefined)
        ) {
          this.#noteCompanionCandidate(expression.callee.field.text);
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
          // Each guard below asks whether a *declaration* claims the qualifier,
          // and a prelude module is one: `#namedModule` covers the explicit
          // `import * as` alias and the implicit prelude home alike (Modules
          // §6.4). Testing `#moduleAliases` alone would let the compiler's own
          // machinery outrank a prelude member, which is exactly the resolution
          // order Modules §5.5 forbids — and it is what kept `Seq.map` bound to
          // the intrinsic family after `Seq.hex` joined the set.
          if (
            ["Map", "Set", "Vector"].includes(expression.receiver.name.text) &&
            scope.lookup(expression.receiver.name.text) === undefined &&
            this.#namedModule(expression.receiver.name.text) === undefined
          ) {
            return {
              kind: "CollectionOperation",
              collection: expression.receiver.name.text as "Map" | "Set" | "Vector",
              operation: expression.field.text,
              span: expression.span,
            };
          }
          if (
            this.#runtime &&
            expression.receiver.name.text === "Node" &&
            ["empty", "get", "set", "copy"].includes(expression.field.text) &&
            scope.lookup("Node") === undefined &&
            this.#namedModule("Node") === undefined
          ) {
            return {
              kind: "CollectionOperation",
              collection: "Node",
              operation: expression.field.text,
              span: expression.span,
            };
          }
          if (
            ["Int", "BigInt", "Float"].includes(expression.receiver.name.text) &&
            scope.lookup(expression.receiver.name.text) === undefined &&
            this.#namedModule(expression.receiver.name.text) === undefined &&
            ["div", "mod", "quot", "rem", "gcd", "lcm"].includes(expression.field.text)
          ) {
            return {
              kind: "PrimitiveOperation",
              primitive: expression.receiver.name.text as "Int" | "BigInt" | "Float",
              operation: expression.field.text as "div" | "mod" | "quot" | "rem" | "gcd" | "lcm",
              span: expression.span,
            };
          }
          const importedModule = this.#namedModule(expression.receiver.name.text);
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
            const preludeLocal = this.#reachPreludeTerm(symbol.id);
            if (preludeLocal !== undefined) {
              return { kind: "Name", symbol: symbol.id, text: preludeLocal, span: expression.span };
            }
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
    binderClass: BinderClass,
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
        const claimed = this.#claimBinder(name, scope, binderClass);
        const binding = this.#declare(name, declaredKind(binderClass));
        shared.set(text, binding);
        if (claimed) scope.define(text, binding.symbol);
      }
      return {
        kind: "Or",
        alternatives: pattern.alternatives.map((alternative) =>
          this.#resolvePattern(alternative, scope, new Map(), binderClass, shared)
        ),
        span: pattern.span,
      };
    }
    if (pattern.kind === "As") {
      const nested = this.#resolvePattern(
        pattern.pattern,
        scope,
        seen,
        binderClass,
        sharedBindings,
      );
      const binder = this.#resolvePattern(
        { kind: "Binding", name: pattern.name, span: pattern.name.span },
        scope,
        seen,
        binderClass,
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
          this.#resolvePattern(argument, scope, seen, binderClass, sharedBindings),
        ),
        span: pattern.span,
      };
    }
    if (pattern.kind === "Tuple") {
      return {
        ...pattern,
        elements: pattern.elements.map((element) =>
          this.#resolvePattern(element, scope, seen, binderClass, sharedBindings),
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
              : { pattern: this.#resolvePattern(pattern.rest.pattern, scope, seen, binderClass, sharedBindings) }),
          };
      return {
        kind: "Vector",
        elements: pattern.elements.map((element) =>
          this.#resolvePattern(element, scope, seen, binderClass, sharedBindings)
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
            binderClass,
            sharedBindings,
          ),
          span: field.span,
        })),
        span: pattern.span,
      };
    }

    // Binding twice within one pattern is simultaneous duplication, not
    // shadowing (§5.1 rule 3): it is an error in every class, and it settles the
    // name before the class ever gets a say. An or-pattern's alternatives share
    // one binding per name (`sharedBindings`), already claimed above.
    const duplicate = seen.get(pattern.name.text);
    if (duplicate !== undefined) {
      this.#diagnostics.add({
        severity: "error",
        message: `\`${pattern.name.text}\` is bound twice in this pattern`,
        primary: pattern.name.span,
        labels: [{ span: duplicate.span, message: "first binding is here" }],
      });
    }
    const claimed = duplicate === undefined && sharedBindings === undefined &&
      this.#claimBinder(pattern.name, scope, binderClass);

    const binding = sharedBindings?.get(pattern.name.text) ??
      this.#declare(pattern.name, declaredKind(binderClass));
    seen.set(pattern.name.text, binding);
    if (claimed) scope.define(pattern.name.text, binding.symbol);
    return { kind: "Binding", binding, span: pattern.span };
  }

  /**
   * Settles one pattern binder against the names already in scope, per its
   * Statements §5 class, and reports the conflict if it has one. Answers whether
   * the binder may go on to own its name in `scope`; a rejected binder leaves the
   * existing meaning in place, so the names after it still resolve to what they
   * did before the error.
   */
  #claimBinder(name: Parsed.Name, scope: Scope, binderClass: BinderClass): boolean {
    // Rule 2: a head binder may shadow anything, and it owns its scope outright.
    if (binderClass === "head") return true;

    // A pattern parameter is a head binder too, but it shares the lambda's scope
    // with the parameters beside it, so a name already bound *there* is a second
    // parameter of that name — duplication (rule 3), not shadowing. Everything
    // further out it may shadow, exactly as a plain parameter does.
    if (binderClass === "parameter") {
      const sibling = scope.lookupLocal(name.text);
      if (sibling === undefined) return true;
      // Order the pair by source position, not by which one resolved second.
      // Every plain parameter binds before any pattern parameter is resolved, so
      // a pattern binder is always the later claimant even when it was written
      // first — reporting in claim order would label the *second* `p` of
      // `f({p}, p)` as the first one. Two plain parameters have never had that
      // problem, and this keeps the whole family reading the same way: the
      // primary marks the repeat, the label marks what it repeats.
      const [first, second] = orderedBySource(this.#symbol(sibling).bindingSpan, name.span);
      this.#diagnostics.add({
        severity: "error",
        message: `duplicate parameter \`${name.text}\``,
        primary: second,
        labels: [{ span: first, message: "first parameter is here" }],
      });
      return false;
    }

    // Rule 1, layered by Modules §5.4: a binder in the module's own scope may
    // occlude a prelude name on the same scope-identity test `let`, `fun`, and
    // constraint members use; in any inner layer the ban is absolute, so the
    // lookup walks all the way out.
    const existing = scope === this.#moduleScope
      ? scope.lookupLocal(name.text)
      : scope.lookup(name.text);
    if (existing === undefined) return true;
    this.#reportRebinding(name, existing);
    return false;
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
      if (this.#preludeTerms.has(symbol)) this.#usedPreludeSymbols.add(symbol);
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

    // A pattern parameter's binders are head binders whichever spelling
    // introduced them (Pattern Matching §6.5), so they bind here — in the
    // lambda's own scope, beside the plain parameters and under the same rules —
    // rather than in the body, where the surrounding `let`'s sequential class
    // would be the only one on offer (Statements §5.2's pre-desugar warning).
    // The equivalent `let` still opens the body, and is checked, typed, and
    // emitted as a written one: only the classification happens up here.
    const destructurings = (expression.destructurings ?? []).map(
      (destructuring): Resolved.LetPatternItem => {
        const value = this.#resolveExpr(
          { kind: "Name", name: destructuring.name, span: destructuring.span },
          lambdaScope,
        );
        return {
          kind: "LetPattern",
          exported: false,
          pattern: this.#resolvePattern(
            destructuring.pattern,
            lambdaScope,
            new Map(),
            "parameter",
          ),
          value,
          span: destructuring.span,
        };
      },
    );

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
      body: openedWith(destructurings, this.#resolveExpr(expression.body, lambdaScope)),
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
    if (annotation.kind === "Function") {
      return {
        kind: "Function",
        parameters: annotation.parameters.map((parameter) =>
          this.#resolveTypeAnnotation(parameter, typeParameters, impliedContext, substitutions)
        ),
        result: this.#resolveTypeAnnotation(
          annotation.result,
          typeParameters,
          impliedContext,
          substitutions,
        ),
        span: annotation.span,
      };
    }
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
      const imported = this.#namedModule(annotation.qualifier.text);
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
      const externType = imported.externTypes.get(name);
      if (externType !== undefined) {
        if (arguments_.length > 0) {
          this.#diagnostics.add({
            severity: "error",
            message: `extern type \`${name}\` is monomorphic and takes no type arguments`,
            primary: annotation.span,
          });
        }
        return {
          kind: "ExternType",
          externType: externType.externType,
          name: `${annotation.qualifier.text}.${name}`,
          span: annotation.span,
        };
      }
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
    const externType = this.#externTypeNames.get(name);
    if (externType !== undefined) {
      if (annotation.kind === "AppliedType") {
        this.#diagnostics.add({
          severity: "error",
          message: `extern type \`${name}\` is monomorphic and takes no type arguments`,
          primary: annotation.span,
        });
      }
      return { kind: "ExternType", externType, name, span: annotation.span };
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
    // Declarations outrank the compiler's own type machinery (Modules §5.5): the
    // record table is consulted here, alongside the alias/extern/union tables
    // above, so the intrinsic branch below is reached only when no declaration
    // claims the name. Records were once tested *after* the intrinsics while
    // unions were tested before them; that asymmetry was the resolution-order
    // defect (defect log entry 6), not a rule.
    const declaredRecord = this.#recordNames.get(name);
    if (declaredRecord !== undefined) {
      const arguments_ = annotation.kind === "AppliedType"
        ? annotation.arguments.map((argument) =>
          this.#resolveTypeAnnotation(argument, typeParameters, impliedContext, substitutions)
        )
        : [];
      const expected = this.#recordArities.get(name) ?? 0;
      if (arguments_.length !== expected) {
        this.#diagnostics.add({
          severity: "error",
          message: `type \`${name}\` expects ${expected} argument${expected === 1 ? "" : "s"}, but ${arguments_.length} were provided`,
          primary: annotation.span,
        });
      }
      return { kind: "RecordDeclaration", record: declaredRecord, name, arguments: arguments_, span: annotation.span };
    }
    if (annotation.kind === "AppliedType") {
      if (this.#runtime && name === "Node") {
        // `Node(a)` is spellable only inside a runtime module; elsewhere it falls
        // through to the unknown-generic-type path, keeping the intrinsic hidden.
        if (annotation.arguments.length !== 1) {
          this.#diagnostics.add({
            severity: "error",
            message: `type \`Node\` expects 1 argument, but ${annotation.arguments.length} were provided`,
            primary: annotation.span,
          });
        }
        const element = annotation.arguments[0] === undefined
          ? { kind: "ErrorType" as const, span: annotation.span }
          : this.#resolveTypeAnnotation(annotation.arguments[0], typeParameters, impliedContext, substitutions);
        return { kind: "Node", element, span: annotation.span };
      }
      // `Seq` is gone from this list: it is a prelude *declaration* now (Loops
      // §6.6), reached through the record table above. The names left are the
      // boundary intrinsics that no `.hex` module declares.
      if (name === "Vector" || name === "Set" || name === "Array" || name === "Nullable") {
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
      this.#diagnostics.add({
        severity: "error",
        message: `unknown generic type \`${name}\``,
        primary: annotation.span,
      });
      return { kind: "ErrorType", span: annotation.span };
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

  #includeNominals(imported: ModuleInterface, qualifier?: string): void {
    for (const union of imported.unions.values()) {
      if (!this.#unions.some(({ id }) => id === union.id)) this.#unions.push({ ...union, representationVisible: false });
    }
    for (const record of imported.records.values()) {
      if (!this.#records.some(({ id }) => id === record.id)) this.#records.push({ ...record, representationVisible: false });
    }
    for (const externType of imported.externTypes.values()) {
      if (!this.#externTypes.some(({ externType: id }) => id === externType.externType)) {
        this.#externTypes.push({
          ...externType,
          localName: qualifier === undefined
            ? externType.localName
            : `${qualifier}.${externType.localName}`,
        });
      }
    }
  }

  /**
   * Synthesized imports for the prelude terms this module actually references —
   * one per prelude module, carrying exactly the used names and no more.
   * Constructors matched in patterns compile to their string tags and need no
   * import, so only value references (tracked in `#resolveName`) contribute here.
   */
  /**
   * Every identifier the emitted module already binds at its top level.
   *
   * Deliberately **not** a list of binder forms. The first version of this dodge
   * enumerated `let`/`fun`/`var` and silently missed named imports, extern
   * declarations, let-patterns, and constraint members — the same mistake as
   * defect 11, where a rule stated over "module-level binders" was fixed at the
   * two forms that happened to be in front of me. Two structural sources close
   * the set instead:
   *
   * 1. **every symbol this module declared.** `#declare` is the single funnel
   *    for all of them, so no binder form — present or future — can escape it.
   *    It is broader than "top level" (parameters and body locals are in there
   *    too), and being broader is the safe direction: a spare distinguished
   *    local costs nothing, a missed one is a `SyntaxError` at load.
   * 2. **every local an import introduces**, which are bindings this module owns
   *    without declaring.
   */
  #emittedTopLevelNames(resolvedItems: readonly Resolved.Item[]): Set<string> {
    const names = new Set<string>();
    for (const symbol of this.#symbols.values()) names.add(symbol.name);
    for (const item of resolvedItems) {
      if (item.kind !== "Import") continue;
      if (item.form.kind === "Namespace") names.add(item.form.alias);
      if (item.form.kind === "Effect") continue;
      for (const name of item.form.names) names.add(name.local);
    }
    return names;
  }

  #preludeImport(
    span: Source.Span,
    resolvedItems: readonly Resolved.Item[],
  ): readonly Resolved.Item[] {
    const taken = this.#emittedTopLevelNames(resolvedItems);
    const namesBySpecifier = new Map<string, Resolved.ImportName[]>();
    for (const symbol of this.#usedPreludeSymbols) {
      // An explicit import of the same name owns its emission; don't import twice.
      if (this.#explicitlyImported.has(symbol)) continue;
      const term = this.#preludeTerms.get(symbol);
      const specifier = this.#preludeSpecifierBySymbol.get(symbol);
      if (term === undefined || specifier === undefined) continue;
      const names = namesBySpecifier.get(specifier) ?? [];
      // Reaching `Result.tally` from a module that itself binds `tally` is
      // exactly what §6.4 exists for, so importing it *as* `tally` would collide
      // with the binding it is there to see past — and a redeclared identifier
      // is a `SyntaxError` at load, after a clean compile.
      let local = term.name;
      for (let attempt = 0; taken.has(local); attempt += 1) {
        local = `__hex_prelude_${term.name}${attempt === 0 ? "" : attempt}`;
      }
      taken.add(local);
      names.push({ imported: term.name, local, symbol, span });
      namesBySpecifier.set(specifier, names);
    }
    return [...namesBySpecifier].map(([specifier, names]) => {
      // Carry the prelude module's coherent instances (e.g. `Eq`/`Show<Option>`)
      // the same way an explicit import would, so `a != None` and `show(x)` resolve.
      const iface = this.#preludeInterfaceBySpecifier.get(specifier);
      const instances = (iface?.instances ?? []).map((instance) => ({
        identity: instance.identity,
        constraint: instance.constraint,
        typeParameters: instance.typeParameters,
        subject: instance.subject,
        impliedTypes: instance.impliedTypes,
        importedDictionary: instance.dictionary,
        localDictionary:
          `__hex_imported_${Number(iface!.module.fileId)}_${instance.dictionary}`,
        span,
      }));
      return {
        kind: "Import" as const,
        specifier,
        form: { kind: "Named" as const, names },
        instances,
        span,
      };
    });
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
  return ["Nat", "Int", "Float", "Bool", "String", "BigInt", "Exn", "Unit"].includes(name);
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
    case "Vector": return "Vector";
    case "Map": return "Map";
    case "Set": return "Set";
    case "Array": return "Array";
    case "Node": return "Node";
    case "Nullable": return "Nullable";
    case "Function": return "Function";
    case "Union": return annotation.name;
    case "RecordDeclaration": return annotation.name;
    case "ExternType": return annotation.name;
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
    case "Vector": return annotationTypeVariables(annotation.element);
    case "Set": return annotationTypeVariables(annotation.element);
    case "Array": return annotationTypeVariables(annotation.element);
    case "Node": return annotationTypeVariables(annotation.element);
    case "Nullable": return annotationTypeVariables(annotation.value);
    case "Map": return [
      ...annotationTypeVariables(annotation.key),
      ...annotationTypeVariables(annotation.value),
    ];
    case "Function": return [
      ...annotation.parameters.flatMap(annotationTypeVariables),
      ...annotationTypeVariables(annotation.result),
    ];
    case "Tuple": return annotation.elements.flatMap(annotationTypeVariables);
    case "Record": return annotation.fields.flatMap((field) =>
      annotationTypeVariables(field.annotation)
    );
    case "Union":
    case "RecordDeclaration":
      return annotation.arguments.flatMap(annotationTypeVariables);
    case "ExternType":
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
    else if (type.kind === "Function") {
      type.parameters.forEach(visit);
      visit(type.result);
    }
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
  if (type.kind === "Vector" || type.kind === "Set" || type.kind === "Array") {
    return { ...type, element: substituteResolvedType(type.element, replacements), span };
  }
  if (type.kind === "Nullable") return { ...type, value: substituteResolvedType(type.value, replacements), span };
  if (type.kind === "Map") return {
    ...type,
    key: substituteResolvedType(type.key, replacements),
    value: substituteResolvedType(type.value, replacements),
    span,
  };
  if (type.kind === "Function") return {
    ...type,
    parameters: type.parameters.map((parameter) =>
      substituteResolvedType(parameter, replacements)
    ),
    result: substituteResolvedType(type.result, replacements),
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
  if (expression.kind === "Unit" || expression.kind === "Boolean" || expression.kind === "Integer" || expression.kind === "BigInt" || expression.kind === "Float" || expression.kind === "ErrorExpr" || expression.kind === "CollectionOperation" || expression.kind === "PrimitiveOperation") return [];
  if (expression.kind === "String") return expression.parts.flatMap((part) => part.kind === "Interpolation" ? expressionNames(part.expression) : []);
  if (expression.kind === "Tuple" || expression.kind === "Vector") return expression.elements.flatMap(expressionNames);
  if (expression.kind === "Record") return [...(expression.spread === undefined ? [] : expressionNames(expression.spread)), ...expression.fields.flatMap((field) => expressionNames(field.value))];
  if (expression.kind === "Group") return expressionNames(expression.expression);
  if (expression.kind === "Block") return expression.items.flatMap(itemNameReferences);
  if (expression.kind === "Lambda") return expressionNames(expression.body);
  if (expression.kind === "If") return [...expressionNames(expression.condition), ...expressionNames(expression.consequence), ...expressionNames(expression.alternative)];
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
