/**
 * Compiler-owned source query: every place a name *denotes* something, paired
 * with the identity it denotes.
 *
 * This is the index behind go-to-definition and find-references. It lets an
 * editor answer "what is the name under the cursor, and where else is it?"
 * without re-deriving Hexagon's scoping rules, which is the boundary
 * `language-server/README.md` draws. It is deliberately identity-only: hover
 * types come from `collectTypeOccurrences`, which keys off the same spans.
 *
 * Three inputs contribute, each because it is the only one that still knows its
 * part of the answer:
 *
 * - `resolved` owns value identity (`SymbolId`) and type identity (`UnionId`,
 *   `RecordId`, `ExternTypeId`). Its type annotations keep both the identity and
 *   the source span, so a type *reference* needs nothing else.
 * - `parsed` owns constraint occurrences. A constraint has no id — a constraint
 *   *is* its name — and the resolver flattens every constraint `Name` to a bare
 *   string, discarding the span. `parsed` is where those spans survive.
 * - `source` locates the head name inside a span that covers more than the name:
 *   annotation spans include arguments (`Box(Int)`) and qualifiers (`M.Box`).
 *   Reading the text to find a name the tree already told us is there is not a
 *   textual guess about meaning; the meaning arrived with the identity.
 */

import type * as Source from "../support/source.js";
import type * as Parsed from "../syntax/parsed/index.js";
import type * as Resolved from "../syntax/resolved/index.js";

/** What an occurrence denotes. Constraints key by name because they have no id. */
export type Target =
  | { readonly kind: "value"; readonly symbol: Resolved.SymbolId }
  | { readonly kind: "union"; readonly union: Resolved.UnionId }
  | { readonly kind: "record"; readonly record: Resolved.RecordId }
  | { readonly kind: "extern-type"; readonly externType: Resolved.ExternTypeId }
  | { readonly kind: "constraint"; readonly name: string };

/**
 * Whether this occurrence is the site that introduces the identity or a use of
 * it. Go-to-definition looks for `definition`; find-references reports both, as
 * LSP clients expect the declaration among the results.
 */
export type Role = "definition" | "reference";

export interface Occurrence {
  readonly target: Target;
  readonly role: Role;
  /** The identifier as written, for display and for tie-breaking at a position. */
  readonly name: string;
  /** Covers the identifier alone, never its arguments or qualifier. */
  readonly span: Source.Span;
}

/** The three views of one module this query needs; a subset of `CompiledModule`. */
export interface ModuleInput {
  readonly source: Source.File;
  readonly parsed: Parsed.Module;
  readonly resolved: Resolved.Module;
}

/**
 * A comparable identity for a target. Two occurrences belong to the same thing
 * exactly when their keys match, which is what lets find-references group across
 * modules without holding the declarations themselves.
 */
export function targetKey(target: Target): string {
  switch (target.kind) {
    case "value":
      return `value:${Number(target.symbol)}`;
    case "union":
      return `union:${Number(target.union)}`;
    case "record":
      return `record:${Number(target.record)}`;
    case "extern-type":
      return `extern-type:${Number(target.externType)}`;
    case "constraint":
      return `constraint:${target.name}`;
  }
}

/**
 * Every occurrence in one module, ordered by position.
 *
 * A single position can carry more than one occurrence, and that is meaningful
 * rather than a defect: a record name is simultaneously a type and the value
 * symbol of its constructor, so `Box` denotes both. Callers that want every
 * reference to `Box` want the union of both target's references.
 */
export function collectOccurrences(module: ModuleInput): readonly Occurrence[] {
  return new Collector(module).run();
}

class Collector {
  readonly #source: Source.File;
  readonly #parsed: Parsed.Module;
  readonly #resolved: Resolved.Module;
  readonly #fileId: Source.FileId;
  readonly #occurrences: Occurrence[] = [];
  /** Guards against a span being published twice for the same target. */
  readonly #seen = new Set<string>();
  /** Spans of the imports the source actually contains — see `#visitItem`. */
  readonly #writtenImports: ReadonlySet<string>;

  constructor(module: ModuleInput) {
    this.#source = module.source;
    this.#parsed = module.parsed;
    this.#resolved = module.resolved;
    this.#fileId = module.resolved.fileId;
    this.#writtenImports = new Set(
      module.parsed.items
        .filter((item) => item.kind === "Import")
        .map((item) => spanKey(item.span)),
    );
  }

  run(): readonly Occurrence[] {
    this.#collectValueDefinitions();
    this.#collectTypeDefinitions();
    for (const item of this.#resolved.items) {
      if (this.#isDerivedHonor(item)) continue;
      this.#visitItem(item);
    }
    for (const item of this.#parsed.items) this.#visitParsedItem(item);
    return this.#occurrences.sort((left, right) =>
      left.span.start.offset - right.span.start.offset ||
      left.span.end.offset - right.span.end.offset ||
      targetKey(left.target).localeCompare(targetKey(right.target))
    );
  }

  // ---------------------------------------------------------------- publishing

  #publish(target: Target, role: Role, name: string, span: Source.Span): void {
    // A module's tree reaches spans in the files it imports from — an imported
    // symbol carries its own declaring file's `bindingSpan`. Only this file's
    // occurrences belong to this module's index; the declaring module publishes
    // the rest, so nothing is lost and nothing is duplicated.
    if (span.fileId !== this.#fileId) return;
    const key = `${targetKey(target)}@${span.start.offset}:${span.end.offset}`;
    if (this.#seen.has(key)) return;
    this.#seen.add(key);
    this.#occurrences.push({ target, role, name, span });
  }

  /**
   * Narrows a span to the identifier it starts with, skipping any module
   * qualifier. `Box(Int)` and `M.Box(Int)` both yield the span of `Box`.
   * A span that does not begin with an identifier is published unchanged rather
   * than dropped, so a malformed tree loses precision instead of coverage.
   */
  #headNameSpan(span: Source.Span): Source.Span {
    const text = this.#source.text.slice(span.start.offset, span.end.offset);
    const match = /^\s*(?:[A-Za-z_$][\w$]*\s*\.\s*)*([A-Za-z_$][\w$]*)/u.exec(text);
    const name = match?.[1];
    if (match === null || name === undefined) return span;
    const start = span.start.offset + match[0].length - name.length;
    return this.#source.span(start, start + name.length);
  }

  /** The same, for a span that *ends* with the identifier — `type Widget`. */
  #trailingNameSpan(span: Source.Span, name: string): Source.Span {
    const text = this.#source.text.slice(span.start.offset, span.end.offset);
    if (!text.endsWith(name)) return span;
    return this.#source.span(span.end.offset - name.length, span.end.offset);
  }

  // -------------------------------------------------------------- definitions

  #collectValueDefinitions(): void {
    // `symbols` carries every symbol the module can see, imported ones included;
    // `#publish` keeps only those bound in this file. Taking definitions from
    // this one list rather than from the traversal is what makes parameters and
    // pattern binders definitions without a special case at every binding site.
    for (const symbol of this.#resolved.symbols) {
      this.#publish(
        { kind: "value", symbol: symbol.id },
        "definition",
        symbol.name,
        symbol.bindingSpan,
      );
    }
  }

  #collectTypeDefinitions(): void {
    // A union's `span` is already its name; a record's is the whole declaration,
    // and only its constructor binding carries the name span.
    for (const union of this.#resolved.unions) {
      this.#publish({ kind: "union", union: union.id }, "definition", union.name, union.span);
    }
    for (const record of this.#resolved.records) {
      this.#publish(
        { kind: "record", record: record.id },
        "definition",
        record.name,
        record.constructor.span,
      );
    }
    for (const declaration of this.#resolved.externTypes) {
      this.#publish(
        { kind: "extern-type", externType: declaration.externType },
        "definition",
        declaration.localName,
        this.#trailingNameSpan(declaration.span, declaration.localName),
      );
    }
  }

  /**
   * `derives (Eq)` becomes a synthesized `Honor` item whose every span is the
   * declaration it came from, so traversing it would publish the union's own
   * name as a reference to itself. A synthesized honor is exactly one that
   * shares a span with a type declaration; the source form `honor C<T> = derive`
   * also sets `derived`, so that flag cannot be the test. The `derives` list's
   * real constraint references are recovered from `parsed`, where they are
   * separate names with their own spans.
   */
  #isDerivedHonor(item: Resolved.Item): boolean {
    if (item.kind !== "Honor") return false;
    return this.#resolved.items.some(
      (other) =>
        (other.kind === "Union" || other.kind === "RecordDeclaration") &&
        other.span.start.offset === item.span.start.offset &&
        other.span.end.offset === item.span.end.offset,
    );
  }

  // ------------------------------------------------------- resolved traversal

  #visitItem(item: Resolved.Item): void {
    switch (item.kind) {
      case "Import":
        // Every module also carries the prelude's imports, which the resolver
        // injects rather than reads (Modules §5.5). They are real bindings but
        // not source text: their spans are the whole module, so publishing them
        // would put `Some`, `None`, `True` and `False` on top of the entire
        // file. A written import is exactly one the parser also saw.
        if (item.form.kind !== "Effect" && this.#writtenImports.has(spanKey(item.span))) {
          for (const name of item.form.names) this.#visitImportName(name);
        }
        return;
      case "ExternBlock":
        for (const declaration of item.declarations) {
          if (declaration.kind === "ExternType") continue;
          if (declaration.kind === "ExternLet") {
            this.#visitAnnotation(declaration.annotation);
            continue;
          }
          for (const parameter of declaration.parameters) {
            if (parameter.annotation !== undefined) this.#visitAnnotation(parameter.annotation);
          }
          this.#visitAnnotation(declaration.returnAnnotation);
        }
        return;
      case "Let":
      case "Var":
        if (item.annotation !== undefined) this.#visitAnnotation(item.annotation);
        this.#visitExpr(item.value);
        return;
      case "LetPattern":
        this.#visitPattern(item.pattern);
        this.#visitExpr(item.value);
        return;
      case "Fun":
        this.#visitExpr(item.value);
        return;
      case "TypeAlias":
        this.#visitAnnotation(item.annotation);
        return;
      case "RecordDeclaration":
        for (const field of item.fields) this.#visitAnnotation(field.annotation);
        return;
      case "Union":
        for (const constructor of item.constructors) {
          for (const slot of constructor.slots) this.#visitAnnotation(slot.annotation);
        }
        return;
      case "Exception":
        for (const slot of item.slots) this.#visitAnnotation(slot.annotation);
        return;
      case "ConstraintDeclaration":
        for (const member of item.members) {
          for (const parameter of member.parameters) {
            if (parameter.annotation !== undefined) this.#visitAnnotation(parameter.annotation);
          }
          this.#visitAnnotation(member.returnAnnotation);
          if (member.defaultValue !== undefined) this.#visitExpr(member.defaultValue);
        }
        return;
      case "Honor":
        this.#visitAnnotation(item.subject);
        for (const implied of item.impliedTypes) this.#visitAnnotation(implied.annotation);
        for (const member of item.members) this.#visitExpr(member.value);
        return;
      case "ExprItem":
        this.#visitExpr(item.expression);
        return;
      default:
        return;
    }
  }

  /**
   * A name in an import list. Value names arrive already resolved; a type name
   * does not, because `ImportName` has no room for a type identity — so it is
   * recovered from the module's own type tables, which carry the *imported*
   * declarations alongside the local ones.
   *
   * The lookup deliberately ignores anything declared in this file. A module may
   * occlude an imported type name (Modules §5.4), and in that case both entries
   * share a spelling; the one an import list names is by construction the one
   * declared elsewhere.
   */
  #visitImportName(name: Resolved.ImportName): void {
    if (name.symbol !== undefined) {
      this.#publish({ kind: "value", symbol: name.symbol }, "reference", name.local, name.span);
      return;
    }
    const foreign = <T extends { readonly span: Source.Span }>(candidates: readonly T[]) =>
      candidates.find((candidate) => candidate.span.fileId !== this.#fileId);
    const union = foreign(this.#resolved.unions.filter(({ name: it }) => it === name.imported));
    if (union !== undefined) {
      this.#publish({ kind: "union", union: union.id }, "reference", name.local, name.span);
      return;
    }
    const record = foreign(this.#resolved.records.filter(({ name: it }) => it === name.imported));
    if (record !== undefined) {
      this.#publish({ kind: "record", record: record.id }, "reference", name.local, name.span);
      return;
    }
    const externType = foreign(
      this.#resolved.externTypes.filter(({ localName }) => localName === name.imported),
    );
    if (externType !== undefined) {
      this.#publish(
        { kind: "extern-type", externType: externType.externType },
        "reference",
        name.local,
        name.span,
      );
    }
  }

  #visitAnnotation(annotation: Resolved.TypeAnnotation): void {
    switch (annotation.kind) {
      case "Union":
        this.#publish(
          { kind: "union", union: annotation.union },
          "reference",
          annotation.name,
          this.#headNameSpan(annotation.span),
        );
        for (const argument of annotation.arguments) this.#visitAnnotation(argument);
        return;
      case "RecordDeclaration":
        this.#publish(
          { kind: "record", record: annotation.record },
          "reference",
          annotation.name,
          this.#headNameSpan(annotation.span),
        );
        for (const argument of annotation.arguments) this.#visitAnnotation(argument);
        return;
      case "ExternType":
        this.#publish(
          { kind: "extern-type", externType: annotation.externType },
          "reference",
          annotation.name,
          this.#headNameSpan(annotation.span),
        );
        return;
      case "Tuple":
        for (const element of annotation.elements) this.#visitAnnotation(element);
        return;
      case "Record":
        for (const field of annotation.fields) this.#visitAnnotation(field.annotation);
        return;
      case "Vector":
      case "Set":
      case "Array":
      case "Node":
        this.#visitAnnotation(annotation.element);
        return;
      case "Map":
        this.#visitAnnotation(annotation.key);
        this.#visitAnnotation(annotation.value);
        return;
      case "Nullable":
        this.#visitAnnotation(annotation.value);
        return;
      case "Function":
        for (const parameter of annotation.parameters) this.#visitAnnotation(parameter);
        this.#visitAnnotation(annotation.result);
        return;
      default:
        return;
    }
  }

  #visitPattern(pattern: Resolved.Pattern): void {
    switch (pattern.kind) {
      case "Constructor":
        this.#publish(
          { kind: "value", symbol: pattern.symbol },
          "reference",
          pattern.text,
          this.#headNameSpan(pattern.nameSpan),
        );
        for (const argument of pattern.arguments) this.#visitPattern(argument);
        return;
      case "As":
        this.#visitPattern(pattern.pattern);
        return;
      case "Or":
        for (const alternative of pattern.alternatives) this.#visitPattern(alternative);
        return;
      case "Tuple":
      case "Vector":
        for (const element of pattern.elements) this.#visitPattern(element);
        if (pattern.kind === "Vector" && pattern.rest?.pattern !== undefined) {
          this.#visitPattern(pattern.rest.pattern);
        }
        return;
      case "Record":
        for (const field of pattern.fields) this.#visitPattern(field.pattern);
        return;
      default:
        return;
    }
  }

  #visitExpr(expression: Resolved.Expr): void {
    switch (expression.kind) {
      case "Name":
        this.#publish(
          { kind: "value", symbol: expression.symbol },
          "reference",
          expression.text,
          this.#trailingNameSpan(expression.span, trailingIdentifier(expression.text)),
        );
        return;
      case "String":
        for (const part of expression.parts) {
          if (part.kind === "Interpolation") this.#visitExpr(part.expression);
        }
        return;
      case "Vector":
      case "Tuple":
        for (const element of expression.elements) this.#visitExpr(element);
        return;
      case "Record":
        if (expression.spread !== undefined) this.#visitExpr(expression.spread);
        for (const field of expression.fields) this.#visitExpr(field.value);
        return;
      case "Group":
        this.#visitExpr(expression.expression);
        return;
      case "Block":
        for (const item of expression.items) this.#visitItem(item);
        return;
      case "Lambda":
        for (const parameter of expression.parameters) {
          if (parameter.annotation !== undefined) this.#visitAnnotation(parameter.annotation);
        }
        if (expression.returnAnnotation !== undefined) {
          this.#visitAnnotation(expression.returnAnnotation);
        }
        this.#visitExpr(expression.body);
        return;
      case "If":
        this.#visitExpr(expression.condition);
        this.#visitExpr(expression.consequence);
        this.#visitExpr(expression.alternative);
        return;
      case "While":
        this.#visitExpr(expression.condition);
        this.#visitExpr(expression.body);
        return;
      case "For":
        this.#visitPattern(expression.pattern);
        this.#visitExpr(expression.iterable);
        this.#visitExpr(expression.body);
        return;
      case "Match":
      case "Try":
        this.#visitExpr(expression.kind === "Match" ? expression.scrutinee : expression.body);
        for (const arm of expression.arms) {
          this.#visitPattern(arm.pattern);
          if (arm.guard !== undefined) this.#visitExpr(arm.guard);
          this.#visitExpr(arm.body);
        }
        return;
      case "Throw":
        this.#visitExpr(expression.exception);
        return;
      case "Call":
        this.#visitExpr(expression.callee);
        for (const argument of expression.arguments) this.#visitExpr(argument);
        return;
      case "ConsoleLog":
        for (const argument of expression.arguments) this.#visitExpr(argument);
        return;
      case "Access":
        this.#visitExpr(expression.receiver);
        return;
      case "Index":
        this.#visitExpr(expression.receiver);
        this.#visitExpr(expression.index);
        return;
      case "Hash":
        this.#visitExpr(expression.value);
        return;
      case "Unary":
        this.#visitExpr(expression.operand);
        return;
      case "Binary":
        this.#visitExpr(expression.left);
        this.#visitExpr(expression.right);
        return;
      case "Comparison":
        for (const operand of expression.operands) this.#visitExpr(operand);
        return;
      case "Assignment":
        this.#visitExpr(expression.target);
        this.#visitExpr(expression.value);
        return;
      default:
        return;
    }
  }

  // --------------------------------------------------------- parsed traversal

  /**
   * Constraint occurrences only. Everything else in `parsed` is covered by the
   * resolved traversal with identity attached, so this walk stays narrow: it
   * visits the item forms that can mention a constraint, plus the expressions
   * that can nest a type parameter list.
   */
  #visitParsedItem(item: Parsed.Item): void {
    switch (item.kind) {
      case "ConstraintDeclaration":
        this.#publishConstraint(item.name, "definition");
        for (const base of item.baseConstraints) this.#publishConstraint(base, "reference");
        for (const member of item.members) {
          if (member.defaultValue !== undefined) this.#visitParsedExpr(member.defaultValue);
        }
        return;
      case "Honor":
        this.#publishConstraint(item.constraint, "reference");
        for (const parameter of item.typeParameters) this.#parsedTypeParameter(parameter);
        for (const member of item.members) this.#visitParsedExpr(member.value);
        return;
      case "Union":
      case "RecordDeclaration":
        for (const derive of item.derives) this.#publishConstraint(derive, "reference");
        return;
      case "Let":
      case "Var":
      case "Fun":
        this.#visitParsedExpr(item.value);
        return;
      case "LetPattern":
        this.#visitParsedExpr(item.value);
        return;
      case "ExprItem":
        this.#visitParsedExpr(item.expression);
        return;
      default:
        return;
    }
  }

  #parsedTypeParameter(parameter: Parsed.TypeParameter): void {
    for (const constraint of parameter.constraints) {
      this.#publishConstraint(constraint, "reference");
    }
  }

  /**
   * Only the expression forms that can carry a type parameter list or nest one.
   * A constraint can appear on any `let`/`fun` binding, and those become lambdas
   * with `typeParameters`, so the walk has to reach into every body.
   */
  #visitParsedExpr(expression: Parsed.Expr): void {
    switch (expression.kind) {
      case "Lambda":
        for (const parameter of expression.typeParameters ?? []) {
          this.#parsedTypeParameter(parameter);
        }
        this.#visitParsedExpr(expression.body);
        return;
      case "Block":
        for (const item of expression.items) this.#visitParsedItem(item);
        return;
      case "Group":
        this.#visitParsedExpr(expression.expression);
        return;
      case "If":
        this.#visitParsedExpr(expression.condition);
        this.#visitParsedExpr(expression.consequence);
        this.#visitParsedExpr(expression.alternative);
        return;
      case "While":
        this.#visitParsedExpr(expression.condition);
        this.#visitParsedExpr(expression.body);
        return;
      case "For":
        this.#visitParsedExpr(expression.iterable);
        this.#visitParsedExpr(expression.body);
        return;
      case "Match":
      case "Try":
        this.#visitParsedExpr(expression.kind === "Match" ? expression.scrutinee : expression.body);
        for (const arm of expression.arms) {
          if (arm.guard !== undefined) this.#visitParsedExpr(arm.guard);
          this.#visitParsedExpr(arm.body);
        }
        return;
      case "Call":
        this.#visitParsedExpr(expression.callee);
        for (const argument of expression.arguments) this.#visitParsedExpr(argument);
        return;
      case "Vector":
      case "Tuple":
        for (const element of expression.elements) this.#visitParsedExpr(element);
        return;
      case "Record":
        if (expression.spread !== undefined) this.#visitParsedExpr(expression.spread);
        for (const field of expression.fields) this.#visitParsedExpr(field.value);
        return;
      case "Binary":
        this.#visitParsedExpr(expression.left);
        this.#visitParsedExpr(expression.right);
        return;
      case "Unary":
        this.#visitParsedExpr(expression.operand);
        return;
      case "Assignment":
        this.#visitParsedExpr(expression.target);
        this.#visitParsedExpr(expression.value);
        return;
      default:
        return;
    }
  }

  #publishConstraint(name: Parsed.Name, role: Role): void {
    this.#publish({ kind: "constraint", name: name.text }, role, name.text, name.span);
  }
}

function spanKey(span: Source.Span): string {
  return `${Number(span.fileId)}:${span.start.offset}:${span.end.offset}`;
}

/** `Vector.map` hovers and jumps as `map`; the qualifier is not the reference. */
function trailingIdentifier(text: string): string {
  return text.includes(".") ? text.slice(text.lastIndexOf(".") + 1) : text;
}
