/**
 * The checker implements the Hindley–Milner core needed by the current vertical
 * slices. Mutable union-find variables are private to inference;
 * the returned Typed tree contains only immutable types and schemes. Implied
 * type choices substitute into ground instances and erase before emission; v1
 * rejects projection-bearing constraints on type-variable binders.
 */

import * as Diagnostics from "../../support/diagnostics.js";
import type * as Source from "../../support/source.js";
import * as Resolved from "../../syntax/resolved/index.js";
import * as Typed from "../../syntax/typed/index.js";

export interface CheckOptions {
  readonly importedSchemes?: ReadonlyMap<Resolved.SymbolId, Typed.Scheme>;
}

export function check(
  module: Resolved.Module,
  options: CheckOptions = {},
): Typed.Module {
  const diagnostics = new Diagnostics.Bag();
  for (const diagnostic of module.diagnostics) diagnostics.add(diagnostic);
  return new Checker(diagnostics, options).check(module);
}

type Mono =
  | Variable
  | Constructor
  | TupleMono
  | RecordMono
  | RangeMono
  | SeqMono
  | VectorMono
  | MapMono
  | SetMono
  | ArrayMono
  | NullableMono
  | UnionMono
  | NominalRecordMono
  | ExternMono
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

interface RangeMono {
  readonly kind: "Range";
}

interface SeqMono {
  readonly kind: "Seq";
  readonly element: Mono;
}

interface VectorMono {
  readonly kind: "Vector";
  readonly element: Mono;
}

interface MapMono {
  readonly kind: "Map";
  readonly key: Mono;
  readonly value: Mono;
}

interface SetMono {
  readonly kind: "Set";
  readonly element: Mono;
}

interface ArrayMono {
  readonly kind: "Array";
  readonly element: Mono;
}

interface NullableMono {
  readonly kind: "Nullable";
  readonly value: Mono;
}

interface UnionMono {
  readonly kind: "Union";
  readonly union: Resolved.UnionId;
  readonly name: string;
  readonly arguments: readonly Mono[];
}

interface NominalRecordMono {
  readonly kind: "NominalRecord";
  readonly record: Resolved.RecordId;
  readonly name: string;
  readonly arguments: readonly Mono[];
}

interface ExternMono {
  readonly kind: "ExternType";
  readonly externType: Resolved.ExternTypeId;
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
  readonly impliedTypes?: ReadonlyMap<string, Mono>;
  evidenceConstraint?: Typed.ConstraintName;
  evidencePath?: readonly string[];
  reported: boolean;
  dictionary?: string;
  structural?: boolean;
  dictionaryArguments?: readonly Requirement[];
}

interface Scheme {
  readonly variables: readonly Variable[];
  readonly type: Mono;
  readonly constraint?: string;
  readonly impliedTypes?: ReadonlyMap<string, Variable>;
}

const ERROR: ErrorMono = { kind: "Error" };

function primitive(name: Typed.PrimitiveName): Constructor {
  return { kind: "Constructor", name };
}

class Checker {
  readonly #expressionTypes = new WeakMap<Resolved.Expr, Mono>();
  readonly #requirements = new WeakMap<object, readonly Requirement[]>();
  /** Exact Nat expressions that checking injects into an independently known Num target. */
  readonly #natWidenings = new WeakMap<Resolved.Expr, Requirement>();
  /** Exact Int expressions that checking injects into an independently known Signed target. */
  readonly #intWidenings = new WeakMap<Resolved.Expr, Requirement>();
  readonly #nameRequirements = new WeakMap<Resolved.NameExpr, readonly Requirement[]>();
  readonly #callRequirements = new WeakMap<Resolved.CallExpr, readonly Requirement[]>();
  readonly #pipeCalls = new WeakMap<Resolved.BinaryExpr, Resolved.CallExpr>();
  readonly #dotCalls = new WeakMap<Resolved.CallExpr, {
    readonly symbol: Resolved.Symbol;
    readonly callee: Mono;
    readonly receiver: Resolved.Expr;
  }>();
  readonly #seqDotCalls = new WeakMap<Resolved.CallExpr, {
    readonly operation: "map" | "filter" | "take";
    readonly callee: Mono;
    readonly receiver: Resolved.Expr;
  }>();
  readonly #tupleAccesses = new WeakMap<Resolved.AccessExpr, number>();
  readonly #recordAccesses = new WeakMap<Resolved.AccessExpr, string>();
  readonly #indexOperations = new WeakMap<Resolved.IndexExpr, NonNullable<Typed.IndexExpr["operation"]>>();
  readonly #matchUnions = new WeakMap<Resolved.MatchExpr, Resolved.UnionId>();
  readonly #iterations = new WeakMap<Resolved.ForExpr, Requirement>();
  readonly #schemes = new Map<Resolved.SymbolId, Scheme>();
  readonly #unions = new Map<Resolved.UnionId, Resolved.Union>();
  readonly #constructorUnions = new Map<Resolved.SymbolId, Resolved.UnionId>();
  readonly #unionParameters = new Map<Resolved.UnionId, ReadonlyMap<string, Variable>>();
  readonly #records = new Map<Resolved.RecordId, Resolved.RecordDeclaration>();
  readonly #externTypes = new Map<Resolved.ExternTypeId, Resolved.ExternTypeDeclaration>();
  readonly #recordParameters = new Map<Resolved.RecordId, ReadonlyMap<string, Variable>>();
  readonly #recordFields = new Map<Resolved.RecordId, ReadonlyMap<string, Mono>>();
  readonly #recordConstructors = new Set<Resolved.SymbolId>();
  readonly #aliasParameters = new WeakMap<Resolved.TypeAliasItem, ReadonlyMap<string, Variable>>();
  readonly #exceptions = new Map<Resolved.SymbolId, Resolved.ExceptionItem>();
  readonly #operationsByName = new Map<string, Resolved.Symbol>();
  readonly #operationSpellings = new Map<Resolved.SymbolId, string>();
  readonly #constraintNames = new Set<string>([
    "Num", "Signed", "Frac", "Pow", "Concat", "Eq", "Ord", "Show", "Hash", "Iterable", "Integral",
  ]);
  readonly #constraintSubjects = new WeakMap<Resolved.ConstraintItem, Variable>();
  readonly #constraintImpliedTypes = new WeakMap<
    Resolved.ConstraintItem,
    ReadonlyMap<string, Variable>
  >();
  readonly #instances = new Map<string, Resolved.HonorItem>();
  readonly #instanceIdentities = new Map<string, string>();
  readonly #constraintDeclarations = new Map<string, Resolved.ConstraintItem>();
  readonly #projectionBearingConstraints = new Set<string>();
  readonly #instanceTypeParameters = new WeakMap<
    Resolved.HonorItem,
    ReadonlyMap<string, Variable>
  >();
  readonly #instanceSubjects = new WeakMap<Resolved.HonorItem, Mono>();
  readonly #instanceSuperconstraints = new WeakMap<Resolved.HonorItem, readonly Requirement[]>();
  readonly #mutableSymbols = new Set<Resolved.SymbolId>();
  readonly #variables: Variable[] = [];
  readonly #quantified = new Set<number>();
  readonly #diagnostics: Diagnostics.Bag;
  readonly #importedSchemes: ReadonlyMap<Resolved.SymbolId, Typed.Scheme>;
  #nextVariable = 0;

  constructor(diagnostics: Diagnostics.Bag, options: CheckOptions) {
    this.#diagnostics = diagnostics;
    this.#importedSchemes = options.importedSchemes ?? new Map();
  }

  check(module: Resolved.Module): Typed.Module {
    for (const externType of module.externTypes) {
      this.#externTypes.set(externType.externType, externType);
    }
    for (const item of module.items) {
      if (item.kind !== "Import" || item.form.kind !== "Namespace") continue;
      for (const name of item.form.names) {
        if (name.symbol !== undefined) this.#operationSpellings.set(name.symbol, name.local);
      }
    }
    for (const [symbol, scheme] of this.#importedSchemes) {
      this.#schemes.set(symbol, this.#importScheme(scheme));
    }
    for (const item of module.items) {
      if (item.kind !== "TypeAlias") continue;
      this.#aliasParameters.set(item, new Map(
        item.parameters.map((name) => [name, this.#fresh(0, false)] as const),
      ));
    }
    for (const item of module.items) {
      if (item.kind === "ConstraintDeclaration") {
        this.#constraintNames.add(item.name);
        this.#constraintDeclarations.set(item.name, item);
        if (item.impliedTypes.length > 0) {
          this.#projectionBearingConstraints.add(item.name);
        }
      }
    }
    for (const item of module.items) {
      if (item.kind !== "Import") continue;
      for (const imported of item.instances) {
        const instance: Resolved.HonorItem = {
          kind: "Honor",
          constraint: imported.constraint,
          typeParameters: imported.typeParameters,
          subject: imported.subject,
          derived: false,
          dictionary: imported.localDictionary,
          impliedTypes: imported.impliedTypes,
          members: [],
          span: imported.span,
        };
        const typeParameters = new Map(
          instance.typeParameters.map(({ name }) => [
            name,
            this.#fresh(0, false),
          ] as const),
        );
        this.#instanceTypeParameters.set(instance, typeParameters);
        const subject = this.#annotationType(
          instance.subject,
          0,
          new Map(),
          typeParameters,
        );
        this.#instanceSubjects.set(instance, subject);
        const key = this.#instanceKey(instance.constraint, subject);
        const existingIdentity = this.#instanceIdentities.get(key);
        if (existingIdentity === imported.identity) continue;
        if (existingIdentity !== undefined || this.#instances.has(key)) {
          this.#diagnostics.add({
            severity: "error",
            message: `duplicate instance of \`${instance.constraint}<${this.#display(subject)}>\``,
            primary: imported.span,
          });
        } else {
          this.#instances.set(key, instance);
          this.#instanceIdentities.set(key, imported.identity);
        }
      }
    }
    for (const item of module.items) {
      if (item.kind === "Honor") {
        this.#checkInstanceHead(item, module.items);
        const typeParameters = new Map(
          item.typeParameters.map(({ name }) => [name, this.#fresh(0, false)] as const),
        );
        this.#instanceTypeParameters.set(item, typeParameters);
        for (const parameter of item.typeParameters) {
          const variable = typeParameters.get(parameter.name)!;
          for (const constraint of parameter.constraints) {
            if (!this.#constraintNames.has(constraint)) {
              this.#diagnostics.add({
                severity: "error",
                message: `unknown constraint \`${constraint}\``,
                primary: parameter.span,
              });
              continue;
            }
            if (this.#projectionBearingConstraints.has(constraint)) {
              this.#diagnostics.add({
                severity: "error",
                message: impliedTypeBinderMessage(constraint),
                primary: parameter.span,
              });
              continue;
            }
            this.#require(constraint, variable, parameter.span);
          }
        }
        const subject = this.#annotationType(
          item.subject,
          0,
          new Map(),
          typeParameters,
        );
        this.#instanceSubjects.set(item, subject);
        const key = this.#instanceKey(item.constraint, subject);
        if (this.#instances.has(key)) {
          this.#diagnostics.add({
            severity: "error",
            message: `duplicate instance of \`${item.constraint}<${this.#display(subject)}>\``,
            primary: item.span,
          });
        } else {
          this.#instances.set(key, item);
          this.#instanceIdentities.set(
            key,
            `${Number(module.fileId)}:${item.dictionary}`,
          );
        }
      }
    }
    for (const item of module.items) {
      if (item.kind !== "ConstraintDeclaration") continue;
      const subject = this.#fresh(0, false);
      // A constraint's subject is universally quantified by the declaration.
      // It must never participate in ordinary unresolved-variable defaulting,
      // even when the constraint happens to have an Int instance.
      this.#quantified.add(subject.id);
      this.#constraintSubjects.set(item, subject);
      const typeParameters = new Map<string, Mono>([[item.subject, subject]]);
      const impliedTypes = new Map(
        item.impliedTypes.map(({ name }) => [name, this.#fresh(0, false)] as const),
      );
      const seenImpliedTypes = new Set<string>();
      for (const impliedType of item.impliedTypes) {
        if (seenImpliedTypes.has(impliedType.name)) {
          this.#diagnostics.add({
            severity: "error",
            message: `implied type \`${impliedType.name}\` is declared more than once in \`${item.name}\``,
            primary: impliedType.span,
          });
        }
        seenImpliedTypes.add(impliedType.name);
      }
      this.#constraintImpliedTypes.set(item, impliedTypes);
      for (const member of item.members) {
        const parameters = member.parameters.map((parameter) => {
          const type = parameter.annotation === undefined
            ? ERROR
            : this.#annotationType(
                parameter.annotation,
                0,
                new Map(),
                typeParameters,
                impliedTypes,
              );
          this.#schemes.set(parameter.symbol, { variables: [], type });
          return type;
        });
        const result = this.#annotationType(
          member.returnAnnotation,
          0,
          new Map(),
          typeParameters,
          impliedTypes,
        );
        this.#require(item.name, subject, member.span);
        this.#schemes.set(member.binding.symbol, {
          variables: [subject, ...impliedTypes.values()],
          type: { kind: "Function", parameters, result },
          constraint: item.name,
          impliedTypes,
        });
      }
    }
    this.#checkSuperconstraintGraph();
    for (const item of module.items) {
      if (item.kind !== "ConstraintDeclaration") continue;
      for (const member of item.members) {
        if (member.defaultValue === undefined) continue;
        const expected = this.#prune(this.#scheme(member.binding.symbol).type);
        if (expected.kind !== "Function") continue;
        member.defaultValue.parameters.forEach((parameter, index) => {
          this.#schemes.set(parameter.symbol, {
            variables: [],
            type: expected.parameters[index] ?? ERROR,
          });
        });
        const body = this.#inferExpr(member.defaultValue.body, 1);
        this.#unify(expected.result, body, member.defaultValue.span);
        this.#expressionTypes.set(member.defaultValue, expected);
      }
    }
    for (const symbol of module.symbols) {
      if (symbol.kind === "fun" || symbol.kind === "let") {
        this.#operationsByName.set(symbol.name, symbol);
      }
    }
    for (const item of module.items) {
      if (item.kind !== "Exception") continue;
      this.#exceptions.set(item.binding.symbol, item);
      for (const slot of item.slots) {
        if (annotationHasTypeVariable(slot.annotation)) {
          this.#diagnostics.add({
            severity: "error",
            message: "exception payloads must have concrete types",
            primary: slot.span,
          });
        }
        if (
          slot.field === "message" &&
          !(slot.annotation.kind === "Primitive" && slot.annotation.name === "String")
        ) {
          this.#diagnostics.add({
            severity: "error",
            message: "exception field `message` must have type `String`",
            primary: slot.span,
          });
        }
      }
      const parameters = item.slots.map((slot) => this.#annotationType(slot.annotation));
      const result = primitive("Exn");
      this.#schemes.set(item.binding.symbol, {
        variables: [],
        type: parameters.length === 0
          ? result
          : { kind: "Function", parameters, result },
      });
    }
    for (const item of module.items) {
      if (item.kind !== "ExternBlock") continue;
      for (const declaration of item.declarations) {
        if (declaration.kind === "ExternType") continue;
        const annotations = declaration.kind === "ExternFun"
          ? [
              ...declaration.parameters.flatMap((parameter) =>
                parameter.annotation === undefined ? [] : [parameter.annotation]
              ),
              declaration.returnAnnotation,
            ]
          : [declaration.annotation];
        if (annotations.some(annotationHasTypeVariable)) {
          this.#diagnostics.add({
            severity: "error",
            message: "generic extern declarations are not part of Hexagon v1",
            primary: declaration.span,
          });
        }
        for (const annotation of annotations) {
          const nested = nestedAdapterType(annotation);
          if (nested !== undefined) {
            this.#diagnostics.add({
              severity: "error",
              message: `extern type \`${nested}\` requires adaptation inside a direct value; use an explicit eager conversion at the boundary or a foreign shim`,
              primary: annotation.span,
            });
          }
        }
        if (declaration.kind === "ExternLet") {
          this.#schemes.set(declaration.binding.symbol, {
            variables: [],
            type: this.#annotationType(declaration.annotation),
          });
          continue;
        }
        const parameters = declaration.parameters.map((parameter) => {
          const type = parameter.annotation === undefined
            ? ERROR
            : this.#annotationType(parameter.annotation);
          this.#schemes.set(parameter.symbol, { variables: [], type });
          return type;
        });
        this.#schemes.set(declaration.binding.symbol, {
          variables: [],
          type: {
            kind: "Function",
            parameters,
            result: this.#annotationType(declaration.returnAnnotation),
          },
        });
      }
    }
    for (const record of module.records) {
      this.#records.set(record.id, record);
      this.#recordConstructors.add(record.constructor.symbol);
      const typeParameters = new Map(
        record.parameters.map((name) => [name, this.#fresh(0, false)] as const),
      );
      this.#recordParameters.set(record.id, typeParameters);
      const fields = new Map(record.fields.map((field) => [
        field.name,
        this.#annotationType(field.annotation, 0, new Map(), typeParameters),
      ]));
      this.#recordFields.set(record.id, fields);
      const result: NominalRecordMono = {
        kind: "NominalRecord",
        record: record.id,
        name: record.name,
        arguments: [...typeParameters.values()],
      };
      this.#schemes.set(record.constructor.symbol, {
        variables: [...typeParameters.values()],
        type: {
          kind: "Function",
          parameters: [{ kind: "Record", fields }],
          result,
        },
      });
    }
    for (const union of module.unions) {
      this.#unions.set(union.id, union);
      const typeParameters = new Map(
        union.parameters.map((name) => [name, this.#fresh(0, false)] as const),
      );
      this.#unionParameters.set(union.id, typeParameters);
      const type: UnionMono = {
        kind: "Union",
        union: union.id,
        name: union.name,
        arguments: [...typeParameters.values()],
      };
      for (const constructor of union.constructors) {
        this.#constructorUnions.set(constructor.binding.symbol, union.id);
        const slotParameters = constructor.slots.map((slot) =>
          this.#annotationType(slot.annotation, 0, new Map(), typeParameters)
        );
        this.#schemes.set(constructor.binding.symbol, {
          variables: [...typeParameters.values()],
          type: slotParameters.length === 0
            ? type
            : { kind: "Function", parameters: slotParameters, result: type },
        });
      }
    }
    this.#inferItems(module.items, 0, true);
    this.#defaultRemainingVariables();
    this.#checkPublicSignatures(module.items);

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
      records: module.records.map((record) => this.#materializeRecord(record)),
      externTypes: module.externTypes,
      comments: module.comments,
      span: module.span,
      diagnostics: this.#diagnostics.toArray(),
    };
  }

  #checkInstanceHead(
    item: Resolved.HonorItem,
    moduleItems: readonly Resolved.Item[],
  ): void {
    const subject = item.subject;
    const nominal = subject.kind === "Union" || subject.kind === "RecordDeclaration";
    if (item.typeParameters.length > 0) {
      const arguments_ = nominal ? subject.arguments : [];
      const names = arguments_.flatMap((argument) =>
        argument.kind === "TypeVariable" ? [argument.name] : []
      );
      const declared = item.typeParameters.map(({ name }) => name);
      const lawful = nominal && names.length === arguments_.length &&
        new Set(names).size === names.length &&
        names.length === declared.length &&
        declared.every((name) => names.includes(name));
      if (!lawful) {
        this.#diagnostics.add({
          severity: "error",
          message: "a parameterized instance head must be a nominal constructor applied once to each distinct instance parameter",
          primary: item.subject.span,
        });
      }
    } else if (
      subject.kind !== "Primitive" &&
      subject.kind !== "Union" &&
      subject.kind !== "RecordDeclaration"
    ) {
      this.#diagnostics.add({
        severity: "error",
        message: "an instance head must name a primitive or nominal type constructor",
        primary: item.subject.span,
      });
    }

    const ownsConstraint = this.#constraintDeclarations.has(item.constraint);
    const ownsSubject = moduleItems.some((candidate) =>
      (subject.kind === "Union" && candidate.kind === "Union" && candidate.union === subject.union) ||
      (subject.kind === "RecordDeclaration" &&
        candidate.kind === "RecordDeclaration" &&
        candidate.record === subject.record)
    );
    if (!ownsConstraint && !ownsSubject) {
      this.#diagnostics.add({
        severity: "error",
        message: `orphan instance: this module declares neither \`${item.constraint}\` nor the instance subject`,
        primary: item.span,
      });
    }
  }

  #inferItems(
    items: readonly Resolved.Item[],
    level: number,
    moduleItems: boolean,
  ): Mono {
    const sequentialPlaceholders = new Map<Resolved.SymbolId, Variable>();
    const recursiveTypes = new Map<Resolved.SymbolId, Variable>();
    const capturedSequential = new Set(
      items.flatMap((item) => item.kind === "Fun" ? [...referencedSymbols(item.value)] : []),
    );
    for (const item of items) {
      if ((item.kind === "Let" || item.kind === "Var") && capturedSequential.has(item.binding.symbol)) {
        const placeholder = this.#fresh(level + 1, false);
        sequentialPlaceholders.set(item.binding.symbol, placeholder);
        this.#schemes.set(item.binding.symbol, { variables: [], type: placeholder });
      } else if (item.kind === "Fun") {
        const recursiveType = this.#fresh(level + 1, false);
        recursiveTypes.set(item.binding.symbol, recursiveType);
        this.#schemes.set(item.binding.symbol, { variables: [], type: recursiveType });
      }
    }
    // All functions in one lexical block form a recursive group. Their
    // provisional monotypes are installed together before any body is checked.
    for (const item of items) {
      if (item.kind !== "Fun") continue;
      const recursiveType = recursiveTypes.get(item.binding.symbol)!;
      const valueType = this.#inferExpr(item.value, level + 1);
      this.#unify(recursiveType, valueType, item.span);
    }
    for (const item of items) {
      if (item.kind !== "Fun") continue;
      this.#schemes.set(
        item.binding.symbol,
        this.#generalize(recursiveTypes.get(item.binding.symbol)!, level, true),
      );
    }

    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      if (item === undefined) continue;

      if (item.kind === "Let") {
        const inferredValueType = this.#inferExpr(item.value, level + 1);
        let valueType = inferredValueType;
        if (item.annotation !== undefined) {
          const annotationType = this.#annotationType(item.annotation, level + 1);
          this.#unifyExpected(
            annotationType,
            inferredValueType,
            item.value,
            item.annotation.span,
            true,
          );
          if (this.#hasNumericWidening(item.value)) valueType = annotationType;
        }
        const placeholder = sequentialPlaceholders.get(item.binding.symbol);
        if (placeholder !== undefined) this.#unify(placeholder, valueType, item.span);
        const scheme = this.#generalize(
          valueType,
          level,
          this.#isValue(item.value),
        );
        this.#schemes.set(item.binding.symbol, scheme);
        continue;
      }
      if (item.kind === "Import" || item.kind === "ExternBlock" || item.kind === "ExternImport") continue;
      if (item.kind === "ConstraintDeclaration") continue;
      if (item.kind === "Honor") {
        const declaration = this.#constraintDeclarations.get(item.constraint);
        if (item.derived && !["Eq", "Ord", "Show", "Hash"].includes(item.constraint)) {
          this.#diagnostics.add({
            severity: "error",
            message: `\`${item.constraint}\` cannot be derived; only \`Eq\`, \`Ord\`, \`Show\`, and \`Hash\` have derivable forms`,
            primary: item.span,
          });
          continue;
        }
        if (!item.derived && item.constraint === "Hash") {
          this.#diagnostics.add({
            severity: "error",
            message: "`Hash` instances cannot be hand-written; use `derives Hash` on the declaration of the subject type",
            primary: item.span,
          });
          continue;
        }
        if (declaration === undefined && !item.derived) {
          if (this.#checkPreludeHonor(item, level)) continue;
          this.#diagnostics.add({
            severity: "error",
            message: `unknown constraint \`${item.constraint}\``,
            primary: item.span,
          });
          continue;
        }
        if (item.derived) {
          const instanceSubject = this.#instanceSubjects.get(item) ?? ERROR;
          const actual = this.#prune(instanceSubject);
          if (actual.kind !== "Union" && actual.kind !== "NominalRecord") {
            this.#diagnostics.add({
              severity: "error",
              message: `cannot derive \`${item.constraint}<${this.#display(actual)}>\`; derivation requires a nominal record or union`,
              primary: item.span,
            });
          } else {
            for (const component of this.#derivationComponents(actual, item.span)) {
              this.#require(item.constraint, component.type, component.span);
            }
          }
          this.#instanceSuperconstraints.set(
            item,
            this.#superconstraints(item.constraint).map((superconstraint) =>
              this.#require(superconstraint, instanceSubject, item.span)
            ),
          );
          if (item.constraint === "Hash") {
            const equality = this.#instances.get(this.#instanceKey("Eq", instanceSubject));
            if (equality !== undefined && !equality.derived) {
              this.#diagnostics.add({
                severity: "error",
                message: `cannot derive \`Hash<${this.#display(actual)}>\`: the subject has a hand-written \`Eq\` instance; a derived hash requires derived equality`,
                primary: item.span,
              });
            }
          }
          continue;
        }
        if (declaration === undefined) continue;
        const supplied = new Set(item.members.map(({ name }) => name));
        const instanceSubject = this.#instanceSubjects.get(item) ?? ERROR;
        this.#instanceSuperconstraints.set(
          item,
          this.#superconstraints(item.constraint).map((superconstraint) =>
            this.#require(superconstraint, instanceSubject, item.span)
          ),
        );
        const impliedTypes = new Map<string, Mono>();
        for (const required of declaration.impliedTypes) {
          const bindings = item.impliedTypes.filter(({ name }) => name === required.name);
          if (bindings.length === 0) {
            this.#diagnostics.add({
              severity: "error",
              message: `instance is missing implied type \`${required.name}\``,
              primary: item.span,
            });
            impliedTypes.set(required.name, ERROR);
          } else {
            impliedTypes.set(
              required.name,
              this.#annotationType(bindings[0]!.annotation, level + 1),
            );
            if (bindings.length > 1) {
              this.#diagnostics.add({
                severity: "error",
                message: `implied type \`${required.name}\` is bound more than once in this instance`,
                primary: bindings[1]!.span,
              });
            }
          }
        }
        for (const binding of item.impliedTypes) {
          if (!declaration.impliedTypes.some(({ name }) => name === binding.name)) {
            this.#diagnostics.add({
              severity: "error",
              message: `\`${binding.name}\` is not an implied type of \`${item.constraint}\``,
              primary: binding.span,
            });
          }
        }
        for (const required of declaration.members) {
          if (required.defaultValue === undefined && !supplied.has(required.binding.name)) {
            this.#diagnostics.add({
              severity: "error",
              message: `instance is missing required member \`${required.binding.name}\``,
              primary: item.span,
            });
          }
        }
        for (const member of item.members) {
          const firstDefinition = item.members.findIndex(
            ({ name }) => name === member.name,
          );
          if (firstDefinition !== item.members.indexOf(member)) {
            this.#diagnostics.add({
              severity: "error",
              message: `instance member \`${member.name}\` is defined more than once`,
              primary: member.span,
            });
            this.#inferExpr(member.value, level + 1);
            continue;
          }
          const required = declaration.members.find(
            ({ binding }) => binding.name === member.name,
          );
          if (required === undefined) {
            this.#diagnostics.add({
              severity: "error",
              message: `\`${member.name}\` is not a member of \`${item.constraint}\``,
              primary: member.span,
            });
            this.#inferExpr(member.value, level + 1);
            continue;
          }
          const subjectTypes = new Map([[declaration.subject, instanceSubject]]);
          const expectedFunction: FunctionMono = {
            kind: "Function",
            parameters: required.parameters.map((parameter) =>
              parameter.annotation === undefined
                ? ERROR
                : this.#annotationType(
                    parameter.annotation,
                    level + 1,
                    new Map(),
                    subjectTypes,
                    impliedTypes,
                  )
            ),
            result: this.#annotationType(
              required.returnAnnotation,
              level + 1,
              new Map(),
              subjectTypes,
              impliedTypes,
            ),
          };
          if (expectedFunction.parameters.length !== member.value.parameters.length) {
            this.#diagnostics.add({
              severity: "error",
              message: `instance member \`${member.name}\` expects ${expectedFunction.parameters.length} parameters, got ${member.value.parameters.length}`,
              primary: member.span,
            });
          }
          member.value.parameters.forEach((parameter, index) => {
            const expectedParameter = expectedFunction.parameters[index] ?? ERROR;
            this.#schemes.set(parameter.symbol, {
              variables: [],
              type: expectedParameter,
            });
            if (parameter.annotation !== undefined) {
              this.#unify(
                this.#annotationType(
                  parameter.annotation,
                  level + 1,
                  new Map(),
                  new Map(),
                  impliedTypes,
                ),
                expectedParameter,
                parameter.annotation.span,
              );
            }
          });
          const body = this.#inferExpr(member.value.body, level + 1);
          this.#unify(expectedFunction.result, body, member.span);
          this.#expressionTypes.set(member.value, expectedFunction);
        }
        continue;
      }

      if (item.kind === "Var") {
        const inferredValueType = this.#inferExpr(item.value, level + 1);
        let valueType = inferredValueType;
        if (item.annotation !== undefined) {
          const annotationType = this.#annotationType(item.annotation, level + 1);
          this.#unifyExpected(
            annotationType,
            inferredValueType,
            item.value,
            item.annotation.span,
            true,
          );
          if (this.#hasNumericWidening(item.value)) valueType = annotationType;
        }
        const placeholder = sequentialPlaceholders.get(item.binding.symbol);
        if (placeholder !== undefined) this.#unify(placeholder, valueType, item.span);
        this.#schemes.set(item.binding.symbol, { variables: [], type: placeholder ?? valueType });
        this.#mutableSymbols.add(item.binding.symbol);
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
      if (item.kind === "RecordDeclaration") continue;
      if (item.kind === "TypeAlias") continue;
      if (item.kind === "Exception") continue;
    }

    if (moduleItems) return primitive("Unit");
    const finalItem = items.at(-1);
    if (finalItem === undefined || finalItem.kind === "ErrorItem") return ERROR;
    if (
      finalItem.kind === "Let" ||
      finalItem.kind === "Import" ||
      finalItem.kind === "ExternBlock" ||
      finalItem.kind === "ExternImport" ||
      finalItem.kind === "Var" ||
      finalItem.kind === "LetPattern" ||
      finalItem.kind === "Fun" ||
      finalItem.kind === "TypeAlias" ||
      finalItem.kind === "Union"
      || finalItem.kind === "RecordDeclaration"
      || finalItem.kind === "Exception"
      || finalItem.kind === "ConstraintDeclaration"
      || finalItem.kind === "Honor"
    ) {
      if (finalItem.kind === "LetPattern") {
        this.#diagnostics.add({
          severity: "error",
          message: "a block cannot end with a `let` pattern; add a final expression",
          primary: finalItem.span,
        });
        return ERROR;
      }
      if (
        finalItem.kind === "Union" ||
        finalItem.kind === "TypeAlias" ||
        finalItem.kind === "RecordDeclaration" ||
        finalItem.kind === "Exception" ||
        finalItem.kind === "ConstraintDeclaration" ||
        finalItem.kind === "Honor" ||
        finalItem.kind === "Import"
        || finalItem.kind === "ExternBlock"
        || finalItem.kind === "ExternImport"
      ) {
        this.#diagnostics.add({
          severity: "error",
          message: "declarations are only allowed at module level",
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

  #derivationComponents(
    subject: UnionMono | NominalRecordMono,
    fallbackSpan: Source.Span,
  ): readonly { readonly type: Mono; readonly span: Source.Span }[] {
    if (subject.kind === "NominalRecord") {
      const fields = this.#nominalRecordFields(subject);
      const declaration = this.#records.get(subject.record);
      return [...fields].map(([name, type]) => ({
        type,
        span: declaration?.fields.find((field) => field.name === name)?.span ??
          declaration?.span ?? fallbackSpan,
      }));
    }
    const parameters = [...(this.#unionParameters.get(subject.union)?.values() ?? [])];
    const replacements = new Map(
      parameters.map((parameter, index) => [parameter.id, subject.arguments[index] ?? ERROR]),
    );
    const union = this.#unions.get(subject.union);
    return union?.constructors.flatMap((constructor) =>
      constructor.slots.map((slot) => ({
        type: this.#replaceVariables(
          this.#annotationType(
            slot.annotation,
            0,
            new Map(),
            this.#unionParameters.get(subject.union),
          ),
          replacements,
        ),
        span: slot.span,
      }))
    ) ?? [];
  }


  /** Checks compiler-known prelude constraint members before a source prelude exists. */
  #checkPreludeHonor(item: Resolved.HonorItem, level: number): boolean {
    const subject = this.#instanceSubjects.get(item) ?? ERROR;
    const members = new Map<string, { parameters: readonly Mono[]; result: Mono; optional?: boolean }>();
    const binary = { parameters: [subject, subject], result: subject };
    if (item.constraint === "Eq") {
      members.set("equals", { parameters: [subject, subject], result: primitive("Bool") });
      members.set("notEquals", {
        parameters: [subject, subject],
        result: primitive("Bool"),
        optional: true,
      });
    } else if (item.constraint === "Ord") {
      members.set("compare", { parameters: [subject, subject], result: primitive("Int") });
    } else if (item.constraint === "Show") {
      members.set("show", { parameters: [subject], result: primitive("String") });
    } else if (item.constraint === "Num") {
      for (const name of ["add", "multiply"] as const) members.set(name, binary);
      members.set("fromNat", { parameters: [primitive("Nat")], result: subject });
    } else if (item.constraint === "Signed") {
      members.set("subtract", binary);
      members.set("negate", { parameters: [subject], result: subject });
      members.set("fromInt", { parameters: [primitive("Int")], result: subject });
    } else if (item.constraint === "Frac") {
      members.set("divide", binary);
    } else if (item.constraint === "Concat") {
      members.set("concat", binary);
    } else if (item.constraint === "Pow") {
      members.set("pow", binary);
    } else if (item.constraint === "Integral") {
      for (const name of ["div", "mod", "quot", "rem", "gcd"] as const) {
        members.set(name, binary);
      }
    } else {
      return false;
    }

    this.#instanceSuperconstraints.set(
      item,
      this.#superconstraints(item.constraint).map((superconstraint) =>
        this.#require(superconstraint, subject, item.span)
      ),
    );
    const supplied = new Set(item.members.map(({ name }) => name));
    for (const [name, signature] of members) {
      if (!signature.optional && !supplied.has(name)) {
        this.#diagnostics.add({
          severity: "error",
          message: `instance is missing required member \`${name}\``,
          primary: item.span,
        });
      }
    }
    for (const member of item.members) {
      const signature = members.get(member.name);
      if (signature === undefined) {
        this.#diagnostics.add({
          severity: "error",
          message: `\`${member.name}\` is not a member of \`${item.constraint}\``,
          primary: member.span,
        });
        this.#inferExpr(member.value, level + 1);
        continue;
      }
      member.value.parameters.forEach((parameter, index) => {
        this.#schemes.set(parameter.symbol, {
          variables: [],
          type: signature.parameters[index] ?? ERROR,
        });
      });
      if (member.value.parameters.length !== signature.parameters.length) {
        this.#diagnostics.add({
          severity: "error",
          message: `instance member \`${member.name}\` expects ${signature.parameters.length} parameters, got ${member.value.parameters.length}`,
          primary: member.span,
        });
      }
      const body = this.#inferExpr(member.value.body, level + 1);
      this.#unify(signature.result, body, member.span);
      this.#expressionTypes.set(member.value, {
        kind: "Function",
        parameters: signature.parameters,
        result: signature.result,
      });
    }
    return true;
  }

  /** Validates the implication DAG before evidence selection begins. */
  #checkSuperconstraintGraph(): void {
    for (const declaration of this.#constraintDeclarations.values()) {
      for (const superconstraint of declaration.superconstraints) {
        if (!this.#constraintNames.has(superconstraint)) {
          this.#diagnostics.add({
            severity: "error",
            message: `unknown superconstraint \`${superconstraint}\``,
            primary: declaration.span,
          });
        }
        if (this.#projectionBearingConstraints.has(superconstraint)) {
          this.#diagnostics.add({
            severity: "error",
            message: impliedTypeBinderMessage(superconstraint),
            primary: declaration.span,
          });
        }
        const reservedMember =
          (superconstraint[0]?.toLowerCase() ?? "") + superconstraint.slice(1);
        if (declaration.members.some(({ binding }) => binding.name === reservedMember)) {
          this.#diagnostics.add({
            severity: "error",
            message: `member \`${reservedMember}\` conflicts with the \`${superconstraint}\` dictionary slot; rename the member`,
            primary: declaration.span,
          });
        }
      }
    }

    const state = new Map<string, "visiting" | "visited">();
    const visit = (name: string, path: readonly string[]): void => {
      const current = state.get(name);
      if (current === "visited") return;
      if (current === "visiting") {
        const cycle = [...path.slice(path.indexOf(name)), name];
        this.#diagnostics.add({
          severity: "error",
          message: `superconstraint cycle: ${cycle.join(" requires ")}`,
          primary: this.#constraintDeclarations.get(name)!.span,
        });
        return;
      }
      state.set(name, "visiting");
      const declaration = this.#constraintDeclarations.get(name);
      for (const superconstraint of declaration?.superconstraints ?? []) {
        if (this.#constraintDeclarations.has(superconstraint)) {
          visit(superconstraint, [...path, name]);
        }
      }
      state.set(name, "visited");
    };
    for (const name of this.#constraintDeclarations.keys()) visit(name, []);
  }

  /** Gives qualified and dot-call Seq operations one shared polymorphic shape. */
  #seqOperationType(
    operation: Resolved.SeqOperationExpr["operation"],
    level: number,
  ): FunctionMono {
    const element = this.#fresh(level, false);
    const result = this.#fresh(level, false);
    const sequence: SeqMono = { kind: "Seq", element };
    if (operation === "iterate") {
      return {
        kind: "Function",
        parameters: [element, { kind: "Function", parameters: [element], result: element }],
        result: sequence,
      };
    }
    if (operation === "map") {
      return {
        kind: "Function",
        parameters: [sequence, { kind: "Function", parameters: [element], result }],
        result: { kind: "Seq", element: result },
      };
    }
    if (operation === "filter") {
      return {
        kind: "Function",
        parameters: [
          sequence,
          { kind: "Function", parameters: [element], result: primitive("Bool") },
        ],
        result: sequence,
      };
    }
    return {
      kind: "Function",
      parameters: [sequence, primitive("Int")],
      result: sequence,
    };
  }

  /** Gives compiler-known persistent collection operations their ordinary function types. */
  #collectionOperationType(
    collection: Resolved.CollectionOperationExpr["collection"],
    operation: string,
    level: number,
    span: Source.Span,
    requirements: Requirement[],
  ): Mono {
    const requireKey = (subject: Mono): void => {
      requirements.push(this.#require("Hash", subject, span));
    };
    if (collection === "Map") {
      const key = this.#fresh(level, false);
      const value = this.#fresh(level, false);
      const map: MapMono = { kind: "Map", key, value };
      if (["set", "remove", "containsKey", "fromVector", "fromSeq", "fromEntries"].includes(operation)) {
        requireKey(key);
      }
      if (operation === "empty") return { kind: "Function", parameters: [], result: map };
      if (operation === "set") return { kind: "Function", parameters: [map, key, value], result: map };
      if (operation === "remove") return { kind: "Function", parameters: [map, key], result: map };
      if (operation === "containsKey") return { kind: "Function", parameters: [map, key], result: primitive("Bool") };
      if (operation === "size") return { kind: "Function", parameters: [map], result: primitive("Int") };
      if (operation === "isEmpty") return { kind: "Function", parameters: [map], result: primitive("Bool") };
      if (operation === "keys") return { kind: "Function", parameters: [map], result: { kind: "Seq", element: key } };
      if (operation === "values") return { kind: "Function", parameters: [map], result: { kind: "Seq", element: value } };
      if (operation === "entries" || operation === "toSeq") return { kind: "Function", parameters: [map], result: { kind: "Seq", element: { kind: "Tuple", elements: [key, value] } } };
      if (operation === "fromVector") return { kind: "Function", parameters: [{ kind: "Vector", element: { kind: "Tuple", elements: [key, value] } }], result: map };
      if (operation === "fromSeq" || operation === "fromEntries") return { kind: "Function", parameters: [{ kind: "Seq", element: { kind: "Tuple", elements: [key, value] } }], result: map };
    } else if (collection === "Set") {
      const element = this.#fresh(level, false);
      const set: SetMono = { kind: "Set", element };
      if (["add", "remove", "contains", "union", "intersect", "difference", "isSubsetOf", "fromVector", "fromSeq"].includes(operation)) {
        requireKey(element);
      }
      if (operation === "empty") return { kind: "Function", parameters: [], result: set };
      if (operation === "add" || operation === "remove") return { kind: "Function", parameters: [set, element], result: set };
      if (operation === "contains") return { kind: "Function", parameters: [set, element], result: primitive("Bool") };
      if (["union", "intersect", "difference"].includes(operation)) return { kind: "Function", parameters: [set, set], result: set };
      if (operation === "isSubsetOf") return { kind: "Function", parameters: [set, set], result: primitive("Bool") };
      if (operation === "size") return { kind: "Function", parameters: [set], result: primitive("Int") };
      if (operation === "isEmpty") return { kind: "Function", parameters: [set], result: primitive("Bool") };
      if (operation === "toSeq") return { kind: "Function", parameters: [set], result: { kind: "Seq", element } };
      if (operation === "fromVector") return { kind: "Function", parameters: [{ kind: "Vector", element }], result: set };
      if (operation === "fromSeq") return { kind: "Function", parameters: [{ kind: "Seq", element }], result: set };
    } else {
      const element = this.#fresh(level, false);
      const vector: VectorMono = { kind: "Vector", element };
      if (operation === "empty") return { kind: "Function", parameters: [], result: vector };
      if (operation === "size") return { kind: "Function", parameters: [vector], result: primitive("Int") };
      if (operation === "isEmpty") return { kind: "Function", parameters: [vector], result: primitive("Bool") };
      if (operation === "append") return { kind: "Function", parameters: [vector, element], result: vector };
      if (operation === "prepend") return { kind: "Function", parameters: [vector, element], result: vector };
    }
    return this.#unsupported(span, `the companion of \`${collection}\` has no core operation \`${operation}\``);
  }

  #inferExpr(expression: Resolved.Expr, level: number): Mono {
    let type: Mono;
    switch (expression.kind) {
      case "SeqOperation": {
        type = this.#seqOperationType(expression.operation, level);
        break;
      }
      case "CollectionOperation":
        const collectionRequirements: Requirement[] = [];
        type = this.#collectionOperationType(
          expression.collection,
          expression.operation,
          level,
          expression.span,
          collectionRequirements,
        );
        this.#requirements.set(expression, collectionRequirements);
        break;
      case "PrimitiveOperation": {
        const subject = primitive(expression.primitive);
        const permitted = expression.primitive === "Float"
          ? ["mod", "rem"]
          : expression.primitive === "Int"
          ? ["div", "mod", "quot", "rem", "gcd"]
          : ["div", "mod", "quot", "rem", "gcd", "lcm"];
        type = permitted.includes(expression.operation)
          ? { kind: "Function", parameters: [subject, subject], result: subject }
          : this.#unsupported(
              expression.span,
              `the companion of \`${expression.primitive}\` has no operation \`${expression.operation}\``,
            );
        break;
      }
      case "Name":
        const requirements: Requirement[] = [];
        type = this.#instantiate(this.#scheme(expression.symbol), level, requirements);
        this.#nameRequirements.set(expression, requirements);
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
      case "Hash": {
        const value = this.#inferExpr(expression.value, level);
        const requirement = this.#require("Hash", value, expression.span);
        this.#requirements.set(expression, [requirement]);
        type = primitive("Int");
        break;
      }
      case "Tuple":
        type = {
          kind: "Tuple",
          elements: expression.elements.map((element) =>
            this.#inferExpr(element, level),
          ),
        };
        break;
      case "Vector": {
        const element = this.#fresh(level, false);
        for (const value of expression.elements) {
          this.#unifyExpected(element, this.#inferExpr(value, level), value, value.span, true);
        }
        type = { kind: "Vector", element };
        break;
      }
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
          if (actual.kind === "NominalRecord") {
            if (!this.#recordRepresentationVisible(actual.record)) {
              type = this.#unsupported(
                expression.span,
                `cannot update opaque record \`${actual.name}\`; use an operation exported by its home module`,
              );
              break;
            }
            const fields = this.#nominalRecordFields(actual);
            for (const [name, override] of overrides) {
              const existing = fields.get(name);
              if (existing === undefined) {
                this.#diagnostics.add({
                  severity: "error",
                  message: `record update cannot add fields; \`${actual.name}\` has no field \`${name}\``,
                  primary: expression.span,
                });
              } else {
                this.#unify(existing, override, expression.span);
              }
            }
            type = overrides.size === 0
              ? { kind: "Record", fields }
              : receiver;
            break;
          } else if (actual.kind === "Record") {
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
        const annotationVariables = new Map<string, Variable>();
        for (const parameter of expression.typeParameters ?? []) {
          const variable = this.#fresh(level + 1, false);
          annotationVariables.set(parameter.name, variable);
          for (const constraint of parameter.constraints) {
            if (!this.#constraintNames.has(constraint)) {
              this.#diagnostics.add({
                severity: "error",
                message: `unknown constraint \`${constraint}\``,
                primary: parameter.span,
              });
              continue;
            }
            if (this.#projectionBearingConstraints.has(constraint)) {
              this.#diagnostics.add({
                severity: "error",
                message: impliedTypeBinderMessage(constraint),
                primary: parameter.span,
              });
              continue;
            }
            this.#require(constraint, variable, parameter.span);
          }
        }
        const parameters = expression.parameters.map((parameter) => {
          const parameterType = parameter.annotation === undefined
            ? this.#fresh(level + 1, false)
            : this.#annotationType(
                parameter.annotation,
                level + 1,
                annotationTails,
                annotationVariables,
              );
          this.#schemes.set(parameter.symbol, {
            variables: [],
            type: parameterType,
          });
          return parameterType;
        });
        const inferredResult = this.#inferExpr(expression.body, level + 1);
        let result = inferredResult;
        if (expression.returnAnnotation !== undefined) {
          const annotationType = this.#annotationType(
            expression.returnAnnotation,
            level + 1,
            annotationTails,
            annotationVariables,
          );
          this.#unifyExpected(
            annotationType,
            inferredResult,
            expression.body,
            expression.returnAnnotation.span,
            true,
          );
          if (this.#hasNumericWidening(expression.body)) result = annotationType;
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
          if (
            this.#tryWidenNumeric(
              expression.consequence,
              consequence,
              alternative,
              expression.span,
              true,
            )
          ) {
            type = alternative;
          } else if (
            this.#tryWidenNumeric(
              expression.alternative,
              alternative,
              consequence,
              expression.span,
              true,
            )
          ) {
            type = consequence;
          } else {
            this.#unify(consequence, alternative, expression.span);
            type = consequence;
          }
        }
        break;
      }
      case "While": {
        const condition = this.#inferExpr(expression.condition, level);
        this.#unify(condition, primitive("Bool"), expression.condition.span);
        const body = this.#inferExpr(expression.body, level);
        this.#defaultDiscardedLiteral(body, expression.body.span);
        this.#unify(body, primitive("Unit"), expression.body.span, () =>
          "the final expression of a loop body produces a value that is discarded on every iteration; use `ignore(...)` if intended"
        );
        type = primitive("Unit");
        break;
      }
      case "For": {
        const iterable = this.#inferExpr(expression.iterable, level);
        let actual = this.#prune(iterable);
        if (actual.kind === "Variable" && actual.literalOnly) {
          this.#bind(actual, primitive("Int"), expression.iterable.span);
          actual = this.#prune(iterable);
        }
        let element: Mono = ERROR;
        if (actual.kind === "Range") {
          element = primitive("Int");
        } else if (actual.kind === "Seq") {
          element = actual.element;
        } else if (actual.kind === "Vector" || actual.kind === "Set" || actual.kind === "Array") {
          element = actual.element;
        } else if (actual.kind === "Map") {
          element = { kind: "Tuple", elements: [actual.key, actual.value] };
        } else if (
          actual.kind === "Constructor" && actual.name === "String"
        ) {
          element = primitive("String");
        } else if (actual.kind === "Variable") {
          this.#diagnostics.add({
            severity: "error",
            message: "cannot determine how to iterate this value; add a `Range`, `String`, or `Seq(a)` type annotation",
            primary: expression.iterable.span,
          });
        } else if (actual.kind !== "Error") {
          element = this.#fresh(level, false);
          const requirement = this.#require(
            "Iterable",
            actual,
            expression.iterable.span,
            "operation",
            new Map([["Item", element]]),
          );
          if (!requirement.reported) this.#iterations.set(expression, requirement);
        }
        this.#inferMatchPattern(expression.pattern, element, level);
        if (!this.#isIrrefutablePattern(expression.pattern, element)) {
          this.#diagnostics.add({
            severity: "error",
            message: "this loop pattern can fail; bind an irrefutable pattern and use `match` inside the loop",
            primary: expression.pattern.span,
          });
        }
        const body = this.#inferExpr(expression.body, level);
        this.#defaultDiscardedLiteral(body, expression.body.span);
        this.#unify(body, primitive("Unit"), expression.body.span, () =>
          "the final expression of a loop body produces a value that is discarded on every iteration; use `ignore(...)` if intended"
        );
        type = primitive("Unit");
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
        } else if (
          actual.kind === "Constructor" &&
          actual.name === "Exn"
        ) {
          this.#diagnostics.add({
            severity: "error",
            message: "match requires a closed type; exceptions are inspected with `try`/`catch`",
            primary: expression.scrutinee.span,
          });
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
        } else if (actual.kind === "Vector") {
          const patterns = expression.arms.flatMap((arm) =>
            arm.guard === undefined
              ? coverageAlternatives(arm.pattern).filter(
                  (pattern): pattern is Resolved.VectorPattern => pattern.kind === "Vector",
                )
              : []
          );
          const restMinimum = Math.min(
            ...patterns.filter(({ rest }) => rest !== undefined).map(({ elements }) => elements.length),
          );
          const fixedLengths = new Set(
            patterns.filter(({ rest }) => rest === undefined).map(({ elements }) => elements.length),
          );
          const exhaustive = Number.isFinite(restMinimum) &&
            Array.from({ length: restMinimum }, (_, length) => length).every((length) =>
              fixedLengths.has(length)
            );
          if (!catchAll && !exhaustive) {
            this.#diagnostics.add({
              severity: "error",
              message: "match is missing a vector length case",
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
      case "Throw": {
        const exception = this.#inferExpr(expression.exception, level);
        this.#unify(exception, primitive("Exn"), expression.exception.span);
        type = this.#fresh(level, false);
        break;
      }
      case "Try": {
        const result = this.#inferExpr(expression.body, level);
        let catchesAll = false;
        const coveredConstructors = new Set<Resolved.SymbolId>();
        const constructorPatterns = new Map<
          Resolved.SymbolId,
          Resolved.ConstructorPattern[]
        >();
        for (const arm of expression.arms) {
          if (catchesAll) {
            this.#diagnostics.add({
              severity: "error",
              message: "this catch arm is unreachable because an earlier arm catches everything",
              primary: arm.span,
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
                  message: `exception \`${coveragePattern.text}\` is already caught above`,
                  primary: coveragePattern.span,
                });
              }
              if (!guarded && this.#exceptions.has(coveragePattern.symbol)) {
                armConstructors.push(coveragePattern);
              }
            } else if (
              coveragePattern.kind === "Binding" ||
              coveragePattern.kind === "Wildcard"
            ) {
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
          if (!guarded && armCatchesAll) catchesAll = true;
          this.#inferExceptionPattern(arm.pattern, level);
          if (arm.guard !== undefined) {
            const guard = this.#inferExpr(arm.guard, level);
            this.#unify(guard, primitive("Bool"), arm.guard.span);
          }
          this.#unify(result, this.#inferExpr(arm.body, level), arm.body.span);
        }
        type = result;
        break;
      }
      case "Call": {
        if (expression.callee.kind === "Access") {
          const receiver = this.#inferExpr(expression.callee.receiver, level);
          const actual = this.#prune(receiver);
          if (actual.kind === "Seq") {
            const field = expression.callee.field.text;
            if (field !== "map" && field !== "filter" && field !== "take") {
              type = this.#unsupported(
                expression.callee.field.span,
                `the companion of \`Seq\` has no subject-first operation \`${field}\``,
              );
              break;
            }
            const callee = this.#seqOperationType(field, level);
            const arguments_ = [
              receiver,
              ...expression.arguments.map((argument) => this.#inferExpr(argument, level)),
            ];
            const callExpressions = [
              expression.callee.receiver,
              ...expression.arguments,
            ];
            const knownOperation = this.#prune(callee);
            const result = knownOperation.kind === "Function"
              ? knownOperation.result
              : this.#fresh(level, false);
            if (knownOperation.kind === "Function") {
              this.#checkCallArguments(
                knownOperation.parameters,
                arguments_,
                callExpressions,
                expression.span,
              );
            } else {
              this.#unify(
                callee,
                { kind: "Function", parameters: arguments_, result },
                expression.span,
              );
            }
            this.#seqDotCalls.set(expression, {
              operation: field,
              callee,
              receiver: expression.callee.receiver,
            });
            type = result;
            break;
          }
          const nominal = actual.kind === "NominalRecord" || actual.kind === "Union";
          const recordHasField = actual.kind === "NominalRecord" &&
            this.#recordRepresentationVisible(actual.record) &&
            this.#nominalRecordFields(actual).has(expression.callee.field.text);
          if (nominal && !recordHasField) {
            const operation = this.#operationsByName.get(expression.callee.field.text);
            const scheme = operation === undefined ? undefined : this.#schemes.get(operation.id);
            if (operation === undefined || scheme === undefined) {
              type = this.#unsupported(
                expression.callee.field.span,
                `the companion of \`${actual.name}\` has no operation \`${expression.callee.field.text}\`; call an available subject-first function explicitly`,
              );
              break;
            }
            const callee = this.#instantiate(scheme, level);
            const arguments_ = [
              receiver,
              ...expression.arguments.map((argument) => this.#inferExpr(argument, level)),
            ];
            const result = this.#fresh(level, false);
            this.#unify(
              callee,
              { kind: "Function", parameters: arguments_, result },
              expression.span,
            );
            this.#dotCalls.set(expression, {
              symbol: operation,
              callee,
              receiver: expression.callee.receiver,
            });
            type = result;
            break;
          }
        }
        if (expression.callee.kind === "Name") {
          const exception = this.#exceptions.get(expression.callee.symbol);
          if (exception?.slots.length === 0) {
            for (const argument of expression.arguments) {
              this.#inferExpr(argument, level);
            }
            this.#diagnostics.add({
              severity: "error",
              message: `\`${expression.callee.text}\` is a value; write it without \`()\``,
              primary: expression.span,
            });
            type = ERROR;
            break;
          }
        }
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
        } else if (knownCallee.kind === "Function") {
          this.#checkCallArguments(
            knownCallee.parameters,
            arguments_,
            expression.arguments,
            expression.span,
          );
          type = knownCallee.result;
        } else {
          this.#unify(
            callee,
            { kind: "Function", parameters: arguments_, result },
            expression.span,
          );
          type = result;
        }
        if (expression.callee.kind === "Name") {
          this.#callRequirements.set(
            expression,
            this.#nameRequirements.get(expression.callee) ?? [],
          );
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
          const requirement = this.#require("Signed", operand, expression.span);
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
        let targetIndex = operands.findIndex((operand) => {
          const actual = this.#prune(operand);
          return !(actual.kind === "Constructor" && ["Nat", "Int"].includes(actual.name)) &&
            this.#supportsNumericTarget(actual, true);
        });
        if (targetIndex < 0) {
          targetIndex = operands.findIndex((operand) => {
            const actual = this.#prune(operand);
            return actual.kind === "Constructor" && actual.name === "Int";
          });
        }
        const common = targetIndex < 0 ? operands[0] ?? ERROR : operands[targetIndex]!;
        for (const [index, operand] of operands.entries()) {
          if (index === targetIndex || (targetIndex < 0 && index === 0)) continue;
          const sourceExpression = expression.operands[index];
          if (sourceExpression === undefined) continue;
          this.#unifyExpected(
            common,
            operand,
            sourceExpression,
            expression.span,
            true,
          );
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
        this.#unifyExpected(target, value, expression.value, expression.span, true);
        if (
          expression.target.kind !== "Name" ||
          !this.#mutableSymbols.has(expression.target.symbol)
        ) {
          this.#diagnostics.add({
            severity: "error",
            message: expression.target.kind === "Name"
              ? `\`${expression.target.text}\` is not mutable; declare it with \`var\` if you need to update it`
              : "assignment requires a `var` binding",
            primary: expression.target.span,
          });
        }
        type = primitive("Unit");
        break;
      }
      case "Access": {
        const inferredReceiver = this.#prune(this.#inferExpr(expression.receiver, level));
        const receiver = inferredReceiver.kind === "Record"
          ? this.#normalizeRecord(inferredReceiver)
          : inferredReceiver;
        if (receiver.kind === "Constructor" && receiver.name === "Exn") {
          type = this.#unsupported(
            expression.span,
            "exceptions are inspected with `try`/`catch`",
          );
          break;
        }
        if (receiver.kind === "NominalRecord") {
          if (!this.#recordRepresentationVisible(receiver.record)) {
            type = this.#unsupported(
              expression.field.span,
              `cannot access field \`${expression.field.text}\` of opaque record \`${receiver.name}\`; use an operation exported by its home module`,
            );
            break;
          }
          const fields = this.#nominalRecordFields(receiver);
          const field = fields.get(expression.field.text);
          type = field === undefined
            ? this.#unsupported(
                expression.field.span,
                `\`${receiver.name}\` has fields ${[...fields.keys()].map((name) => `\`${name}\``).join(", ")}, not \`${expression.field.text}\``,
              )
            : field;
          if (field !== undefined) this.#recordAccesses.set(expression, expression.field.text);
          break;
        }
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
      case "Index": {
        const receiver = this.#prune(this.#inferExpr(expression.receiver, level));
        const index = this.#prune(this.#inferExpr(expression.index, level));
        if (receiver.kind === "Vector") {
          if (index.kind === "Range") {
            type = receiver;
            this.#indexOperations.set(expression, "VectorSlice");
          } else {
            this.#unify(index, primitive("Int"), expression.index.span);
            type = receiver.element;
            this.#indexOperations.set(expression, "VectorElement");
          }
        } else if (receiver.kind === "Constructor" && receiver.name === "String") {
          if (index.kind === "Range") {
            type = primitive("String");
            this.#indexOperations.set(expression, "StringSlice");
          } else {
            this.#unify(index, primitive("Int"), expression.index.span);
            type = primitive("String");
            this.#indexOperations.set(expression, "StringElement");
          }
        } else if (receiver.kind === "Map") {
          this.#unify(index, receiver.key, expression.index.span);
          const requirements = [
            this.#require("Hash", receiver.key, expression.span),
          ];
          this.#requirements.set(expression, requirements);
          type = receiver.value;
          this.#indexOperations.set(expression, "MapElement");
        } else {
          type = this.#unsupported(expression.receiver.span, "indexing requires a Vector, String, or Map value");
        }
        break;
      }
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
      const shape = this.#constructorShape(constructor.binding.symbol, level);
      const parameters = shape.parameters;
      this.#unify(
        expected,
        shape.result,
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

    if (pattern.kind === "Vector") {
      const element = this.#fresh(level + 1, false);
      const vector: VectorMono = { kind: "Vector", element };
      this.#unify(expected, vector, pattern.span);
      for (const nested of pattern.elements) {
        this.#inferPattern(nested, element, level, generalizable);
      }
      if (pattern.rest?.pattern !== undefined) {
        this.#inferPattern(pattern.rest.pattern, vector, level, generalizable);
      }
      if (pattern.rest === undefined || pattern.elements.length > 0) {
        this.#diagnostics.add({
          severity: "error",
          message: "this vector pattern can fail because of its length and cannot be used in `let`; use `match`",
          primary: pattern.span,
        });
      }
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
    if (pattern.kind === "Vector") {
      const element = this.#fresh(level, false);
      const vector: VectorMono = { kind: "Vector", element };
      this.#unify(expected, vector, pattern.span);
      for (const nested of pattern.elements) this.#inferMatchPattern(nested, element, level);
      if (pattern.rest?.pattern !== undefined) {
        this.#inferMatchPattern(pattern.rest.pattern, vector, level);
      }
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
    const shape = this.#constructorShape(constructor.binding.symbol, level);
    const parameters = shape.parameters;
    this.#unify(expected, shape.result, pattern.span);
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

  #inferExceptionPattern(pattern: Resolved.Pattern, level: number): void {
    if (pattern.kind === "Binding" || pattern.kind === "Wildcard") {
      this.#inferMatchPattern(pattern, primitive("Exn"), level);
      return;
    }
    if (pattern.kind === "As") {
      this.#inferExceptionPattern(pattern.pattern, level);
      this.#schemes.set(pattern.binding.symbol, {
        variables: [],
        type: primitive("Exn"),
      });
      return;
    }
    if (pattern.kind === "Or") {
      const common = new Map<Resolved.SymbolId, Mono>();
      for (const alternative of pattern.alternatives) {
        this.#inferExceptionPattern(alternative, level);
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
    if (pattern.kind !== "Constructor") {
      this.#inferMatchPattern(pattern, primitive("Exn"), level);
      return;
    }
    if (!this.#exceptions.has(pattern.symbol)) {
      this.#diagnostics.add({
        severity: "error",
        message: `\`${pattern.text}\` is not an exception constructor`,
        primary: pattern.span,
      });
      return;
    }
    const shape = this.#constructorShape(pattern.symbol, level);
    this.#unify(shape.result, primitive("Exn"), pattern.span);
    if (shape.parameters.length !== pattern.arguments.length) {
      this.#diagnostics.add({
        severity: "error",
        message: `exception pattern \`${pattern.text}\` expects ${shape.parameters.length} arguments, got ${pattern.arguments.length}`,
        primary: pattern.span,
      });
    }
    pattern.arguments.forEach((argument, index) =>
      this.#inferMatchPattern(argument, shape.parameters[index] ?? ERROR, level)
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
    const slots = constructor?.slots ?? this.#exceptions.get(first.symbol)?.slots;
    if (slots === undefined) return false;
    if (patterns.some((pattern) =>
      pattern.arguments.length === slots.length &&
      pattern.arguments.every((argument, index) =>
        this.#isIrrefutablePattern(
          argument,
          this.#annotationType(slots[index]!.annotation),
        )
      )
    )) return true;
    if (slots.length !== 1) return false;
    const arguments_ = patterns.flatMap((pattern) => pattern.arguments.slice(0, 1));
    if (arguments_.length !== patterns.length) return false;
    return this.#isIrrefutablePattern(
      { kind: "Or", alternatives: arguments_, span: first.span },
      this.#annotationType(slots[0]!.annotation),
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
      return { kind: "Range" };
    }
    const constraint: Typed.ConstraintName =
      expression.operator === "Divide"
        ? "Frac"
        : expression.operator === "Power"
          ? "Pow"
        : expression.operator === "Concat"
          ? "Concat"
          : expression.operator === "Subtract"
            ? "Signed"
            : "Num";
    let common = left;
    if (this.#tryWidenNumeric(expression.left, left, right, expression.span, true)) {
      common = right;
    } else if (
      this.#tryWidenNumeric(expression.right, right, left, expression.span, true)
    ) {
      common = left;
    } else {
      this.#unify(left, right, expression.span);
    }
    const requirement = this.#require(constraint, common, expression.span);
    this.#requirements.set(expression, [requirement]);
    return common;
  }

  #checkCallArguments(
    parameters: readonly Mono[],
    arguments_: readonly Mono[],
    expressions: readonly Resolved.Expr[],
    span: Source.Span,
  ): void {
    // A later argument may establish the shared type of an earlier Nat/Int argument
    // (`plus(count, 1.5)`). Bare literals and fresh variables establish nothing,
    // so defer both classes until concrete/already-constrained arguments settle.
    const deferredNumericArguments: number[] = [];
    const deferredLiteralArguments: number[] = [];
    const establishedVariables = new Set<number>();

    for (const [index, actual] of arguments_.entries()) {
      const expected = parameters[index] ?? ERROR;
      const expression = expressions[index];
      if (expression === undefined) continue;
      const source = this.#prune(actual);
      const destination = this.#prune(expected);
      if (
        source.kind === "Variable" && source.literalOnly &&
        destination.kind === "Variable"
      ) {
        deferredLiteralArguments.push(index);
        continue;
      }
      if (
        source.kind === "Constructor" && ["Nat", "Int"].includes(source.name) &&
        destination.kind === "Variable"
      ) {
        deferredNumericArguments.push(index);
        continue;
      }
      const independentlyEstablished = source.kind !== "Variable" ||
        this.#supportsNumericTarget(source, true);
      this.#unifyExpected(expected, actual, expression, span, true);
      const established = this.#prune(expected);
      if (independentlyEstablished && established.kind === "Variable") {
        establishedVariables.add(established.id);
      }
    }

    for (const index of deferredNumericArguments) {
      const expected = parameters[index] ?? ERROR;
      const actual = arguments_[index] ?? ERROR;
      const expression = expressions[index];
      if (expression === undefined) continue;
      const destination = this.#prune(expected);
      const allowVariableTarget = destination.kind === "Variable" &&
        establishedVariables.has(destination.id);
      this.#unifyExpected(
        expected,
        actual,
        expression,
        span,
        allowVariableTarget,
      );
    }

    for (const index of deferredLiteralArguments) {
      const expected = parameters[index] ?? ERROR;
      const actual = arguments_[index] ?? ERROR;
      const expression = expressions[index];
      if (expression === undefined) continue;
      this.#unifyExpected(expected, actual, expression, span, true);
    }
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
      if (actualLeft.union === actualRight.union) {
        actualLeft.arguments.forEach((argument, index) => {
          const other = actualRight.arguments[index];
          if (other !== undefined) this.#unify(argument, other, span);
        });
        return;
      }
    } else if (
      actualLeft.kind === "NominalRecord" &&
      actualRight.kind === "NominalRecord"
    ) {
      if (actualLeft.record === actualRight.record) {
        actualLeft.arguments.forEach((argument, index) => {
          const other = actualRight.arguments[index];
          if (other !== undefined) this.#unify(argument, other, span);
        });
        return;
      }
    } else if (
      actualLeft.kind === "ExternType" &&
      actualRight.kind === "ExternType"
    ) {
      if (actualLeft.externType === actualRight.externType) return;
    } else if (actualLeft.kind === "Range" && actualRight.kind === "Range") {
      return;
    } else if (actualLeft.kind === "Seq" && actualRight.kind === "Seq") {
      this.#unify(actualLeft.element, actualRight.element, span);
      return;
    } else if (actualLeft.kind === "Vector" && actualRight.kind === "Vector") {
      this.#unify(actualLeft.element, actualRight.element, span);
      return;
    } else if (actualLeft.kind === "Set" && actualRight.kind === "Set") {
      this.#unify(actualLeft.element, actualRight.element, span);
      return;
    } else if (actualLeft.kind === "Array" && actualRight.kind === "Array") {
      this.#unify(actualLeft.element, actualRight.element, span);
      return;
    } else if (actualLeft.kind === "Nullable" && actualRight.kind === "Nullable") {
      this.#unify(actualLeft.value, actualRight.value, span);
      return;
    } else if (actualLeft.kind === "Map" && actualRight.kind === "Map") {
      this.#unify(actualLeft.key, actualRight.key, span);
      this.#unify(actualLeft.value, actualRight.value, span);
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
      for (const requirement of variable.requirements) {
        this.#attachRequirement(type, requirement);
      }
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
    if (actual.kind === "Union") {
      return actual.arguments.some((argument) => this.#occurs(variable, argument));
    }
    if (actual.kind === "NominalRecord") {
      return actual.arguments.some((argument) => this.#occurs(variable, argument));
    }
    if (actual.kind === "Seq") return this.#occurs(variable, actual.element);
    if (actual.kind === "Vector") return this.#occurs(variable, actual.element);
    if (actual.kind === "Set") return this.#occurs(variable, actual.element);
    if (actual.kind === "Array") return this.#occurs(variable, actual.element);
    if (actual.kind === "Nullable") return this.#occurs(variable, actual.value);
    if (actual.kind === "Map") return this.#occurs(variable, actual.key) || this.#occurs(variable, actual.value);
    return false;
  }

  #require(
    name: Typed.ConstraintName,
    type: Mono,
    span: Source.Span,
    origin: Requirement["origin"] = "operation",
    impliedTypes?: ReadonlyMap<string, Mono>,
  ): Requirement {
    const requirement: Requirement = {
      name,
      type,
      span,
      origin,
      ...(impliedTypes === undefined ? {} : { impliedTypes }),
      reported: false,
    };
    const actual = this.#prune(type);
    if (actual.kind === "Variable") this.#attachRequirement(actual, requirement);
    else this.#validate(requirement);
    return requirement;
  }

  #tryWidenInt(
    expression: Resolved.Expr,
    actual: Mono,
    target: Mono,
    span: Source.Span,
    allowVariableTarget = false,
  ): boolean {
    // This is contextual evidence insertion, not subtyping: the target must already
    // support the matching numeric tier, and literal-only variables cannot bootstrap their own target.
    const source = this.#prune(actual);
    const destination = this.#prune(target);
    if (source.kind !== "Constructor" || source.name !== "Int") return false;
    if (destination.kind === "Constructor" && destination.name === "Int") return false;

    if (!this.#supportsSignedTarget(destination, allowVariableTarget)) return false;

    const requirement = this.#require("Signed", destination, span);
    this.#intWidenings.set(expression, requirement);
    return true;
  }

  #tryWidenNat(
    expression: Resolved.Expr,
    actual: Mono,
    target: Mono,
    span: Source.Span,
    allowVariableTarget = false,
  ): boolean {
    const source = this.#prune(actual);
    const destination = this.#prune(target);
    if (source.kind !== "Constructor" || source.name !== "Nat") return false;
    if (destination.kind === "Constructor" && destination.name === "Nat") return false;
    if (!this.#supportsTarget(destination, "Num", allowVariableTarget)) return false;

    const requirement = this.#require("Num", destination, span);
    this.#natWidenings.set(expression, requirement);
    return true;
  }

  #tryWidenNumeric(
    expression: Resolved.Expr,
    actual: Mono,
    target: Mono,
    span: Source.Span,
    allowVariableTarget = false,
  ): boolean {
    return this.#tryWidenInt(expression, actual, target, span, allowVariableTarget) ||
      this.#tryWidenNat(expression, actual, target, span, allowVariableTarget);
  }

  #hasNumericWidening(expression: Resolved.Expr): boolean {
    return this.#natWidenings.has(expression) || this.#intWidenings.has(expression);
  }

  #supportsTarget(
    target: Mono,
    constraint: Typed.ConstraintName,
    allowVariableTarget = false,
  ): boolean {
    const destination = this.#prune(target);
    return destination.kind === "Variable"
      ? allowVariableTarget && !destination.literalOnly &&
        destination.requirements.some(({ name }) =>
          this.#superconstraintPath(name, constraint) !== undefined
        )
      : destination.kind === "Constructor"
        ? supports(destination.name, constraint)
        : this.#instances.has(this.#instanceKey(constraint, destination));
  }

  #supportsSignedTarget(target: Mono, allowVariableTarget = false): boolean {
    return this.#supportsTarget(target, "Signed", allowVariableTarget);
  }

  #supportsNumericTarget(target: Mono, allowVariableTarget = false): boolean {
    return this.#supportsTarget(target, "Num", allowVariableTarget);
  }

  #unifyExpected(
    expected: Mono,
    actual: Mono,
    expression: Resolved.Expr,
    span: Source.Span,
    allowVariableTarget = false,
  ): void {
    if (
      !this.#tryWidenNumeric(
        expression,
        actual,
        expected,
        span,
        allowVariableTarget,
      )
    ) {
      this.#unify(expected, actual, span);
    }
  }

  #attachRequirement(variable: Variable, requirement: Requirement): void {
    const provider = variable.requirements.find(
      (candidate) =>
        this.#superconstraintPath(candidate.name, requirement.name) !== undefined,
    );
    if (provider !== undefined) {
      if (provider.name === requirement.name) return;
      const path = this.#superconstraintPath(provider.name, requirement.name);
      requirement.evidenceConstraint = provider.name;
      if (path !== undefined) requirement.evidencePath = path;
      return;
    }
    for (const existing of variable.requirements) {
      const path = this.#superconstraintPath(requirement.name, existing.name);
      if (path !== undefined) {
        existing.evidenceConstraint = requirement.name;
        existing.evidencePath = path;
      }
    }
    variable.requirements.push(requirement);
  }

  #superconstraintPath(
    constraint: string,
    target: string,
    seen = new Set<string>(),
  ): readonly string[] | undefined {
    if (constraint === target) return [];
    if (seen.has(constraint)) return undefined;
    seen.add(constraint);
    for (const superconstraint of this.#superconstraints(constraint)) {
      const suffix = this.#superconstraintPath(superconstraint, target, seen);
      if (suffix !== undefined) {
        const slot =
          (superconstraint[0]?.toLowerCase() ?? "") + superconstraint.slice(1);
        return [slot, ...suffix];
      }
    }
    return undefined;
  }

  #superconstraints(constraint: string): readonly string[] {
    const declared = this.#constraintDeclarations.get(constraint);
    if (declared !== undefined) return declared.superconstraints;
    if (constraint === "Ord") return ["Eq"];
    if (constraint === "Signed") return ["Num"];
    if (constraint === "Frac") return ["Signed"];
    if (constraint === "Pow") return ["Num"];
    if (constraint === "Hash") return ["Eq"];
    if (constraint === "Integral") return ["Num", "Ord"];
    return [];
  }

  #validate(requirement: Requirement): void {
    if (requirement.reported) return;
    const type = this.#prune(requirement.type);
    if (type.kind === "Variable" || type.kind === "Error") return;
    if (type.kind === "Constructor" && supports(type.name, requirement.name)) return;
    if (
      ["Eq", "Ord", "Show", "Hash"].includes(requirement.name) &&
      (type.kind === "Tuple" || type.kind === "Record" || type.kind === "Vector")
    ) {
      const components = type.kind === "Tuple"
        ? type.elements
        : type.kind === "Record"
        ? [...type.fields.values()]
        : [type.element];
      for (const component of components) {
        this.#require(requirement.name, component, requirement.span);
      }
      requirement.structural = true;
      return;
    }
    if (["Eq", "Show", "Hash"].includes(requirement.name) && type.kind === "Set") {
      this.#require(requirement.name === "Show" ? "Show" : "Hash", type.element, requirement.span);
      requirement.structural = true;
      return;
    }
    if (["Eq", "Show", "Hash"].includes(requirement.name) && type.kind === "Map") {
      if (requirement.name === "Show") {
        this.#require("Show", type.key, requirement.span);
        this.#require("Show", type.value, requirement.span);
      } else {
        this.#require("Hash", type.key, requirement.span);
        this.#require(requirement.name === "Hash" ? "Hash" : "Eq", type.value, requirement.span);
      }
      requirement.structural = true;
      return;
    }
    const instance = this.#instances.get(this.#instanceKey(requirement.name, type));
    if (instance !== undefined) {
      requirement.dictionary = instance.dictionary;
      requirement.dictionaryArguments = this.#instanceArguments(instance, type);
      if (requirement.impliedTypes !== undefined) {
        const parameters = this.#instanceTypeParameters.get(instance) ?? new Map();
        const replacements = this.#matchInstanceSubject(instance, type);
        for (const [name, projection] of requirement.impliedTypes) {
          const binding = instance.impliedTypes.find(
            (impliedType) => impliedType.name === name,
          );
          if (binding !== undefined) {
            this.#unify(
              projection,
              this.#replaceVariables(
                this.#annotationType(binding.annotation, 0, new Map(), parameters),
                replacements,
              ),
              requirement.span,
            );
          }
        }
      }
      return;
    }

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

  /** Instantiates the context on a parameterized instance at a concrete use. */
  #instanceArguments(
    instance: Resolved.HonorItem,
    subject: Mono,
  ): readonly Requirement[] {
    const replacements = this.#matchInstanceSubject(instance, subject);
    return instance.typeParameters.flatMap((parameter) => {
      const formal = this.#instanceTypeParameters.get(instance)?.get(parameter.name);
      const actual = formal === undefined ? undefined : replacements.get(formal.id);
      if (actual === undefined) return [];
      return parameter.constraints.map((constraint) =>
        this.#require(constraint, actual, parameter.span)
      );
    });
  }

  #matchInstanceSubject(
    instance: Resolved.HonorItem,
    subject: Mono,
  ): ReadonlyMap<number, Mono> {
    const parameters = new Set(
      [...(this.#instanceTypeParameters.get(instance)?.values() ?? [])].map(({ id }) => id),
    );
    const replacements = new Map<number, Mono>();
    const match = (formalType: Mono, actualType: Mono): void => {
      const formal = this.#prune(formalType);
      const actual = this.#prune(actualType);
      if (formal.kind === "Variable" && parameters.has(formal.id)) {
        replacements.set(formal.id, actual);
        return;
      }
      if (formal.kind === "Union" && actual.kind === "Union") {
        formal.arguments.forEach((argument, index) =>
          match(argument, actual.arguments[index] ?? ERROR)
        );
      }
      if (formal.kind === "NominalRecord" && actual.kind === "NominalRecord") {
        formal.arguments.forEach((argument, index) =>
          match(argument, actual.arguments[index] ?? ERROR)
        );
      }
    };
    match(this.#instanceSubjects.get(instance) ?? ERROR, subject);
    return replacements;
  }

  #replaceVariables(type: Mono, replacements: ReadonlyMap<number, Mono>): Mono {
    const actual = this.#prune(type);
    if (actual.kind === "Variable") return replacements.get(actual.id) ?? actual;
    if (actual.kind === "Tuple") {
      return { kind: "Tuple", elements: actual.elements.map((element) =>
        this.#replaceVariables(element, replacements)
      ) };
    }
    if (actual.kind === "Record") {
      return {
        kind: "Record",
        fields: new Map([...actual.fields].map(([name, field]) => [
          name,
          this.#replaceVariables(field, replacements),
        ])),
        ...(actual.tail === undefined ? {} : { tail: actual.tail }),
      };
    }
    if (actual.kind === "Union" || actual.kind === "NominalRecord") {
      return {
        ...actual,
        arguments: actual.arguments.map((argument) =>
          this.#replaceVariables(argument, replacements)
        ),
      };
    }
    if (actual.kind === "Seq") {
      return { kind: "Seq", element: this.#replaceVariables(actual.element, replacements) };
    }
    if (actual.kind === "Vector") {
      return { kind: "Vector", element: this.#replaceVariables(actual.element, replacements) };
    }
    if (actual.kind === "Set") {
      return { kind: "Set", element: this.#replaceVariables(actual.element, replacements) };
    }
    if (actual.kind === "Array") return { kind: "Array", element: this.#replaceVariables(actual.element, replacements) };
    if (actual.kind === "Nullable") return { kind: "Nullable", value: this.#replaceVariables(actual.value, replacements) };
    if (actual.kind === "Map") {
      return {
        kind: "Map",
        key: this.#replaceVariables(actual.key, replacements),
        value: this.#replaceVariables(actual.value, replacements),
      };
    }
    if (actual.kind === "Function") {
      return {
        kind: "Function",
        parameters: actual.parameters.map((parameter) =>
          this.#replaceVariables(parameter, replacements)
        ),
        result: this.#replaceVariables(actual.result, replacements),
      };
    }
    return actual;
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
        this.#canDefaultToInt(variable)
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
        this.#canDefaultToInt(actual)
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
      this.#canDefaultToInt(actual) &&
      actual.requirements.some(({ name }) => !supports("Unit", name))
    ) {
      this.#bind(actual, primitive("Int"), span);
    }
  }

  #canDefaultToInt(variable: Variable): boolean {
    return variable.requirements.length > 0 &&
      variable.requirements.every(({ name }) =>
        supports("Int", name) ||
        this.#instances.has(this.#instanceKey(name, primitive("Int")))
      );
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
    if (actual.kind === "Union") {
      for (const argument of actual.arguments) this.#collectVariables(argument, found);
    }
    if (actual.kind === "NominalRecord") {
      for (const argument of actual.arguments) this.#collectVariables(argument, found);
    }
    if (actual.kind === "Seq") this.#collectVariables(actual.element, found);
    if (actual.kind === "Vector") this.#collectVariables(actual.element, found);
    if (actual.kind === "Set") this.#collectVariables(actual.element, found);
    if (actual.kind === "Array") this.#collectVariables(actual.element, found);
    if (actual.kind === "Nullable") this.#collectVariables(actual.value, found);
    if (actual.kind === "Map") {
      this.#collectVariables(actual.key, found);
      this.#collectVariables(actual.value, found);
    }
    return [...found.values()];
  }

  #instantiate(
    scheme: Scheme,
    level: number,
    collected?: Requirement[],
  ): Mono {
    const replacements = new Map<number, Variable>();
    const copiedRequirements = new Set<number>();
    for (const variable of scheme.variables) {
      replacements.set(variable.id, this.#fresh(level, variable.literalOnly));
    }
    const impliedTypes = scheme.impliedTypes === undefined
      ? undefined
      : new Map(
          [...scheme.impliedTypes].map(([name, variable]) => [
            name,
            replacements.get(variable.id) ?? variable,
          ]),
        );
    const copy = (type: Mono): Mono => {
      const actual = this.#prune(type);
      if (actual.kind === "Variable") {
        const replacement = replacements.get(actual.id);
        if (replacement === undefined) return actual;
        if (copiedRequirements.has(actual.id)) return replacement;
        copiedRequirements.add(actual.id);
        for (const requirement of actual.requirements) {
          const copied = this.#require(
            requirement.name,
            replacement,
            requirement.span,
            requirement.origin,
            requirement.name === scheme.constraint ? impliedTypes : undefined,
          );
          collected?.push(copied);
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
      if (actual.kind === "Union") {
        return { ...actual, arguments: actual.arguments.map(copy) };
      }
      if (actual.kind === "NominalRecord") {
        return { ...actual, arguments: actual.arguments.map(copy) };
      }
      if (actual.kind === "Seq") return { kind: "Seq", element: copy(actual.element) };
      if (actual.kind === "Vector") return { kind: "Vector", element: copy(actual.element) };
      if (actual.kind === "Set") return { kind: "Set", element: copy(actual.element) };
      if (actual.kind === "Array") return { kind: "Array", element: copy(actual.element) };
      if (actual.kind === "Nullable") return { kind: "Nullable", value: copy(actual.value) };
      if (actual.kind === "Map") return { kind: "Map", key: copy(actual.key), value: copy(actual.value) };
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
    typeParameters: ReadonlyMap<string, Mono> = new Map(),
    impliedTypes: ReadonlyMap<string, Mono> = new Map(),
  ): Mono {
    if (annotation.kind === "Primitive") return primitive(annotation.name);
    if (annotation.kind === "Range") return { kind: "Range" };
    if (annotation.kind === "Seq") {
      return {
        kind: "Seq",
        element: this.#annotationType(
          annotation.element,
          level,
          namedTails,
          typeParameters,
          impliedTypes,
        ),
      };
    }
    if (annotation.kind === "Vector") {
      return {
        kind: "Vector",
        element: this.#annotationType(annotation.element, level, namedTails, typeParameters, impliedTypes),
      };
    }
    if (annotation.kind === "Set") {
      return { kind: "Set", element: this.#annotationType(annotation.element, level, namedTails, typeParameters, impliedTypes) };
    }
    if (annotation.kind === "Array") return { kind: "Array", element: this.#annotationType(annotation.element, level, namedTails, typeParameters, impliedTypes) };
    if (annotation.kind === "Nullable") return { kind: "Nullable", value: this.#annotationType(annotation.value, level, namedTails, typeParameters, impliedTypes) };
    if (annotation.kind === "Map") {
      return {
        kind: "Map",
        key: this.#annotationType(annotation.key, level, namedTails, typeParameters, impliedTypes),
        value: this.#annotationType(annotation.value, level, namedTails, typeParameters, impliedTypes),
      };
    }
    if (annotation.kind === "Function") {
      return {
        kind: "Function",
        parameters: annotation.parameters.map((parameter) =>
          this.#annotationType(parameter, level, namedTails, typeParameters, impliedTypes)
        ),
        result: this.#annotationType(
          annotation.result,
          level,
          namedTails,
          typeParameters,
          impliedTypes,
        ),
      };
    }
    if (annotation.kind === "Union") {
      return {
        kind: "Union",
        union: annotation.union,
        name: annotation.name,
        arguments: annotation.arguments.map((argument) =>
          this.#annotationType(argument, level, namedTails, typeParameters, impliedTypes)
        ),
      };
    }
    if (annotation.kind === "RecordDeclaration") {
      return {
        kind: "NominalRecord",
        record: annotation.record,
        name: annotation.name,
        arguments: annotation.arguments.map((argument) =>
          this.#annotationType(argument, level, namedTails, typeParameters, impliedTypes)
        ),
      };
    }
    if (annotation.kind === "ExternType") {
      return {
        kind: "ExternType",
        externType: annotation.externType,
        name: annotation.name,
      };
    }
    if (annotation.kind === "TypeVariable") {
      const existing = typeParameters.get(annotation.name);
      if (existing !== undefined) return existing;
      if (typeParameters instanceof Map) {
        const variable = this.#fresh(level, false);
        typeParameters.set(annotation.name, variable);
        return variable;
      }
      return ERROR;
    }
    if (annotation.kind === "ImpliedType") {
      return impliedTypes.get(annotation.name) ?? ERROR;
    }
    if (annotation.kind === "Tuple") {
      return {
        kind: "Tuple",
        elements: annotation.elements.map((element) =>
          this.#annotationType(element, level, namedTails, typeParameters, impliedTypes)
        ),
      };
    }
    if (annotation.kind === "Record") {
      return {
        kind: "Record",
        fields: new Map(annotation.fields.map((field) => [
          field.name,
          this.#annotationType(field.annotation, level, namedTails, typeParameters, impliedTypes),
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

  #constructorShape(
    symbol: Resolved.SymbolId,
    level: number,
  ): { readonly parameters: readonly Mono[]; readonly result: Mono } {
    const type = this.#instantiate(this.#scheme(symbol), level);
    return type.kind === "Function"
      ? { parameters: type.parameters, result: type.result }
      : { parameters: [], result: type };
  }

  #instanceKey(constraint: string, subject: Mono): string {
    const type = this.#prune(subject);
    if (type.kind === "Constructor") return `${constraint}:primitive:${type.name}`;
    if (type.kind === "NominalRecord") return `${constraint}:record:${Number(type.record)}`;
    if (type.kind === "Union") return `${constraint}:union:${Number(type.union)}`;
    if (type.kind === "Range") return `${constraint}:range`;
    return `${constraint}:${this.#display(type)}`;
  }

  #importScheme(scheme: Typed.Scheme): Scheme {
    const variables = new Map<Typed.TypeVariableId, Variable>();
    for (const id of scheme.variables) {
      const variable = this.#fresh(0, false);
      variables.set(id, variable);
      // Imported binders are already generalized by their defining module;
      // they must never be defaulted as unresolved locals in this module.
      this.#quantified.add(variable.id);
    }
    const copy = (type: Typed.Type): Mono => {
      switch (type.kind) {
        case "Primitive": return primitive(type.name);
        case "Range": return { kind: "Range" };
        case "Seq": return { kind: "Seq", element: copy(type.element) };
        case "Vector": return { kind: "Vector", element: copy(type.element) };
        case "Set": return { kind: "Set", element: copy(type.element) };
        case "Array": return { kind: "Array", element: copy(type.element) };
        case "Nullable": return { kind: "Nullable", value: copy(type.value) };
        case "Map": return { kind: "Map", key: copy(type.key), value: copy(type.value) };
        case "Variable": {
          const existing = variables.get(type.id);
          if (existing !== undefined) return existing;
          const variable = this.#fresh(0, false);
          variables.set(type.id, variable);
          return variable;
        }
        case "Tuple": return { kind: "Tuple", elements: type.elements.map(copy) };
        case "Record": return {
          kind: "Record",
          fields: new Map(type.fields.map((field) => [field.name, copy(field.type)])),
          ...(type.tail === undefined ? {} : { tail: copy({ kind: "Variable", id: type.tail }) as Variable }),
        };
        case "Union": return { ...type, arguments: type.arguments.map(copy) };
        case "NominalRecord": return { ...type, arguments: type.arguments.map(copy) };
        case "ExternType": return {
          ...type,
          name: this.#externTypes.get(type.externType)?.localName ?? type.name,
        };
        case "Function": return {
          kind: "Function",
          parameters: type.parameters.map(copy),
          result: copy(type.result),
        };
        case "Error": return ERROR;
      }
    };
    for (const constraint of scheme.constraints) {
      this.#require(constraint.name, copy(constraint.type), constraint.span);
    }
    return { variables: [...variables.values()], type: copy(scheme.type) };
  }

  #nominalRecordFields(record: NominalRecordMono): ReadonlyMap<string, Mono> {
    const parameters = [...(this.#recordParameters.get(record.record)?.values() ?? [])];
    const replacements = new Map(
      parameters.map((parameter, index) => [parameter.id, record.arguments[index] ?? ERROR]),
    );
    const copy = (type: Mono): Mono => {
      const actual = this.#prune(type);
      if (actual.kind === "Variable") return replacements.get(actual.id) ?? actual;
      if (actual.kind === "Tuple") return { kind: "Tuple", elements: actual.elements.map(copy) };
      if (actual.kind === "Record") {
        return {
          kind: "Record",
          fields: new Map([...actual.fields].map(([name, field]) => [name, copy(field)])),
          ...(actual.tail === undefined ? {} : { tail: copy(actual.tail) as Variable }),
        };
      }
      if (actual.kind === "Union") return { ...actual, arguments: actual.arguments.map(copy) };
      if (actual.kind === "NominalRecord") return { ...actual, arguments: actual.arguments.map(copy) };
      if (actual.kind === "Seq") return { kind: "Seq", element: copy(actual.element) };
      if (actual.kind === "Vector") return { kind: "Vector", element: copy(actual.element) };
      if (actual.kind === "Set") return { kind: "Set", element: copy(actual.element) };
      if (actual.kind === "Array") return { kind: "Array", element: copy(actual.element) };
      if (actual.kind === "Nullable") return { kind: "Nullable", value: copy(actual.value) };
      if (actual.kind === "Map") return { kind: "Map", key: copy(actual.key), value: copy(actual.value) };
      if (actual.kind === "Function") {
        return {
          kind: "Function",
          parameters: actual.parameters.map(copy),
          result: copy(actual.result),
        };
      }
      return actual;
    };
    return new Map(
      [...(this.#recordFields.get(record.record) ?? [])].map(([name, field]) => [name, copy(field)]),
    );
  }

  #recordRepresentationVisible(record: Resolved.RecordId): boolean {
    return this.#records.get(record)?.representationVisible ?? true;
  }

  #checkPublicSignatures(items: readonly Resolved.Item[]): void {
    const publicUnions = new Set(items.flatMap((item) => item.kind === "Union" && item.exported ? [item.union] : []));
    const publicRecords = new Set(items.flatMap((item) => item.kind === "RecordDeclaration" && item.exported ? [item.record] : []));
    const publicExternTypes = new Set(
      [...this.#externTypes.values()].flatMap((declaration) =>
        declaration.exported ? [declaration.externType] : []
      ),
    );
    const visit = (type: Mono, found = new Set<string>()): ReadonlySet<string> => {
      const actual = this.#prune(type);
      if (actual.kind === "Union") {
        if (!publicUnions.has(actual.union) && this.#unions.get(actual.union)?.representationVisible) found.add(actual.name);
        actual.arguments.forEach((argument) => visit(argument, found));
      } else if (actual.kind === "NominalRecord") {
        if (!publicRecords.has(actual.record) && this.#records.get(actual.record)?.representationVisible) found.add(actual.name);
        actual.arguments.forEach((argument) => visit(argument, found));
      } else if (actual.kind === "ExternType") {
        if (!publicExternTypes.has(actual.externType)) found.add(actual.name);
      } else if (actual.kind === "Function") {
        actual.parameters.forEach((parameter) => visit(parameter, found));
        visit(actual.result, found);
      } else if (actual.kind === "Tuple") actual.elements.forEach((element) => visit(element, found));
      else if (actual.kind === "Record") actual.fields.forEach((field) => visit(field, found));
      else if (actual.kind === "Seq" || actual.kind === "Vector" || actual.kind === "Set" || actual.kind === "Array") visit(actual.element, found);
      else if (actual.kind === "Nullable") visit(actual.value, found);
      else if (actual.kind === "Map") { visit(actual.key, found); visit(actual.value, found); }
      return found;
    };
    for (const item of items) {
      const bindings = item.kind === "ExternBlock"
        ? item.declarations.flatMap((declaration) =>
            declaration.kind !== "ExternType" && declaration.exported
              ? [declaration.binding]
              : []
          )
        : (item.kind === "Let" || item.kind === "Fun") && item.exported
          ? [item.binding]
          : [];
      for (const binding of bindings) {
        for (const name of visit(this.#scheme(binding.symbol).type)) {
        this.#diagnostics.add({
          severity: "error",
          message: `exported binding \`${binding.name}\` exposes private type \`${name}\`; export the type, perhaps opaquely, or keep the binding private`,
          primary: binding.span,
        });
        }
      }
    }
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
          (this.#constructorUnions.has(expression.callee.symbol) ||
            this.#recordConstructors.has(expression.callee.symbol)) &&
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
      return {
        kind: "Union",
        union: actual.union,
        name: actual.name,
        arguments: actual.arguments.map((argument) => this.#publicType(argument, seen)),
      };
    }
    if (actual.kind === "NominalRecord") {
      return {
        kind: "NominalRecord",
        record: actual.record,
        name: actual.name,
        arguments: actual.arguments.map((argument) => this.#publicType(argument, seen)),
      };
    }
    if (actual.kind === "ExternType") {
      return {
        kind: "ExternType",
        externType: actual.externType,
        name: actual.name,
      };
    }
    if (actual.kind === "Range") return { kind: "Range" };
    if (actual.kind === "Seq") {
      return { kind: "Seq", element: this.#publicType(actual.element, seen) };
    }
    if (actual.kind === "Vector") {
      return { kind: "Vector", element: this.#publicType(actual.element, seen) };
    }
    if (actual.kind === "Set") return { kind: "Set", element: this.#publicType(actual.element, seen) };
    if (actual.kind === "Array") return { kind: "Array", element: this.#publicType(actual.element, seen) };
    if (actual.kind === "Nullable") return { kind: "Nullable", value: this.#publicType(actual.value, seen) };
    if (actual.kind === "Map") {
      return { kind: "Map", key: this.#publicType(actual.key, seen), value: this.#publicType(actual.value, seen) };
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
      ...(requirement.dictionary === undefined
        ? {}
        : { dictionary: requirement.dictionary }),
      ...(requirement.evidenceConstraint === undefined
        ? {}
        : { evidenceConstraint: requirement.evidenceConstraint }),
      ...(requirement.evidencePath === undefined
        ? {}
        : { evidencePath: requirement.evidencePath }),
      ...(requirement.dictionaryArguments === undefined
        ? {}
        : { dictionaryArguments: requirement.dictionaryArguments.map((argument) =>
            this.#publicRequirement(argument)
          ) }),
      ...(requirement.structural === true ? { structural: true } : {}),
    };
  }

  #publicRequirements(requirements: readonly Requirement[]): readonly Typed.Constraint[] {
    const unique = new Map<string, Typed.Constraint>();
    for (const requirement of requirements) {
      const constraint = this.#publicRequirement(requirement);
      const type = this.#prune(requirement.type);
      const identity = type.kind === "Variable"
        ? `v${type.id}`
        : this.#display(type);
      unique.set(`${constraint.name}:${identity}`, constraint);
    }
    return [...unique.values()];
  }

  #publicScheme(scheme: Scheme): Typed.Scheme {
    const variables = scheme.variables
      .map((variable) => this.#prune(variable))
      .filter((type): type is Variable => type.kind === "Variable");
    const constraints = new Map<string, Typed.Constraint>();
    for (const variable of variables) {
      for (const requirement of variable.requirements) {
        if (
          requirement.evidenceConstraint !== undefined &&
          requirement.evidenceConstraint !== requirement.name
        ) continue;
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
    if (item.kind === "Import") return item;
    if (item.kind === "ExternImport") return item;
    if (item.kind === "ExternBlock") {
      return {
        ...item,
        declarations: item.declarations.map((declaration): Typed.ExternDeclaration => {
          if (declaration.kind === "ExternType") return declaration;
          const binding = {
            ...declaration.binding,
            scheme: this.#publicScheme(this.#scheme(declaration.binding.symbol)),
          };
          if (declaration.kind === "ExternLet") {
            return {
              kind: "ExternLet",
              exported: declaration.exported,
              default: declaration.default,
              ...(declaration.foreignName === undefined ? {} : { foreignName: declaration.foreignName }),
              localName: declaration.localName,
              binding,
              type: this.#publicType(this.#annotationType(declaration.annotation)),
              span: declaration.span,
            };
          }
          return {
            kind: "ExternFun",
            exported: declaration.exported,
            default: declaration.default,
            ...(declaration.foreignName === undefined ? {} : { foreignName: declaration.foreignName }),
            localName: declaration.localName,
            binding,
            parameters: declaration.parameters.map((parameter) => ({
              ...parameter,
              scheme: this.#publicScheme(this.#scheme(parameter.symbol)),
            })),
            result: this.#publicType(this.#annotationType(declaration.returnAnnotation)),
            span: declaration.span,
          };
        }),
      };
    }
    if (item.kind === "ConstraintDeclaration") {
      const subject = this.#constraintSubjects.get(item) ?? this.#fresh(0, false);
      return {
        kind: "ConstraintDeclaration",
        name: item.name,
        subject: Typed.typeVariableId(subject.id),
        superconstraints: item.superconstraints,
        impliedTypes: item.impliedTypes.map((impliedType) => ({
          name: impliedType.name,
          type: this.#publicType(
            this.#constraintImpliedTypes.get(item)?.get(impliedType.name) ?? ERROR,
          ),
          span: impliedType.span,
        })),
        members: item.members.map((member) => ({
          binding: {
            ...member.binding,
            scheme: this.#publicScheme(this.#scheme(member.binding.symbol)),
          },
          parameters: member.parameters.map((parameter) => ({
            ...parameter,
            scheme: this.#publicScheme(this.#scheme(parameter.symbol)),
          })),
          result: this.#publicType(this.#annotationType(
            member.returnAnnotation,
            0,
            new Map(),
            new Map([[item.subject, subject]]),
            this.#constraintImpliedTypes.get(item),
          )),
          ...(member.defaultValue === undefined
            ? {}
            : { defaultValue: this.#materializeLambda(member.defaultValue) }),
          span: member.span,
        })),
        span: item.span,
      };
    }
    if (item.kind === "Honor") {
      const typeParameters = this.#instanceTypeParameters.get(item) ?? new Map();
      const declaration = this.#constraintDeclarations.get(item.constraint);
      const supplied = new Set(item.members.map(({ name }) => name));
      const inherited = declaration?.members.flatMap((member) =>
        member.defaultValue !== undefined && !supplied.has(member.binding.name)
          ? [{
              name: member.binding.name,
              value: this.#materializeLambda(member.defaultValue),
              span: member.span,
            }]
          : []
      ) ?? [];
      return {
        kind: "Honor",
        constraint: item.constraint,
        typeParameters: item.typeParameters.map((parameter) => ({
          name: parameter.name,
          variable: Typed.typeVariableId(typeParameters.get(parameter.name)?.id ?? -1),
          constraints: parameter.constraints,
          span: parameter.span,
        })),
        subject: this.#publicType(this.#instanceSubjects.get(item) ?? ERROR),
        derived: item.derived,
        dictionary: item.dictionary,
        superconstraints: this.#publicRequirements(
          this.#instanceSuperconstraints.get(item) ?? [],
        ),
        impliedTypes: item.impliedTypes.map((impliedType) => ({
          name: impliedType.name,
          type: this.#publicType(this.#annotationType(impliedType.annotation)),
          span: impliedType.span,
        })),
        members: [
          ...item.members.map((member) => ({
            name: member.name,
            value: this.#materializeLambda(member.value),
            span: member.span,
          })),
          ...inherited,
        ],
        span: item.span,
      };
    }
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
        opaque: item.opaque,
        union: item.union,
        name: item.name,
        parameters: [...(this.#unionParameters.get(item.union)?.values() ?? [])]
          .map(({ id }) => Typed.typeVariableId(id)),
        derives: item.derives,
        constructors: item.constructors.map(({ binding, slots }) => ({
          ...binding,
          scheme: this.#publicScheme(this.#scheme(binding.symbol)),
          slots: slots.map((slot) => ({
            field: slot.field,
            type: this.#publicType(this.#annotationType(
              slot.annotation,
              0,
              new Map(),
              this.#unionParameters.get(item.union),
            )),
            span: slot.span,
          })),
        })),
        span: item.span,
      };
    }
    if (item.kind === "RecordDeclaration") {
      const record = this.#materializeRecord(this.#records.get(item.record)!);
      return {
        kind: "RecordDeclaration",
        exported: item.exported,
        record: item.record,
        ...record,
      };
    }
    if (item.kind === "TypeAlias") {
      const parameters = this.#aliasParameters.get(item) ?? new Map();
      return {
        kind: "TypeAlias",
        exported: item.exported,
        name: item.name,
        parameters: [...parameters.values()].map(({ id }) => Typed.typeVariableId(id)),
        type: this.#publicType(this.#annotationType(item.annotation, 0, new Map(), parameters)),
        span: item.span,
      };
    }
    if (item.kind === "Exception") {
      return {
        kind: "Exception",
        exported: item.exported,
        binding: {
          ...item.binding,
          scheme: this.#publicScheme(this.#scheme(item.binding.symbol)),
        },
        slots: item.slots.map((slot) => ({
          field: slot.field,
          type: this.#publicType(this.#annotationType(slot.annotation)),
          span: slot.span,
        })),
        span: item.span,
      };
    }
    const scheme = this.#publicScheme(this.#scheme(item.binding.symbol));
    if (item.kind === "Var") {
      return {
        kind: "Var",
        binding: { ...item.binding, scheme },
        value: this.#materializeExpr(item.value),
        span: item.span,
      };
    }
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
    if (pattern.kind === "Vector") {
      return {
        kind: "Vector",
        elements: pattern.elements.map((element) => this.#materializePattern(element)),
        ...(pattern.rest === undefined
          ? {}
          : {
              rest: {
                index: pattern.rest.index,
                span: pattern.rest.span,
                ...(pattern.rest.pattern === undefined
                  ? {}
                  : { pattern: this.#materializePattern(pattern.rest.pattern) }),
              },
            }),
        span: pattern.span,
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
      parameters: [...(this.#unionParameters.get(union.id)?.values() ?? [])]
        .map(({ id }) => Typed.typeVariableId(id)),
      derives: union.derives,
      opaque: union.opaque,
      representationVisible: union.representationVisible,
      span: union.span,
      constructors: union.constructors.map(({ binding, slots }) => ({
        ...binding,
        scheme: this.#publicScheme(this.#scheme(binding.symbol)),
        slots: slots.map((slot) => ({
          field: slot.field,
          type: this.#publicType(this.#annotationType(
            slot.annotation,
            0,
            new Map(),
            this.#unionParameters.get(union.id),
          )),
          span: slot.span,
        })),
      })),
    };
  }

  #materializeRecord(record: Resolved.RecordDeclaration): Typed.RecordDeclaration {
    const parameters = this.#recordParameters.get(record.id);
    return {
      id: record.id,
      name: record.name,
      parameters: [...(parameters?.values() ?? [])].map(({ id }) => Typed.typeVariableId(id)),
      derives: record.derives,
      opaque: record.opaque,
      representationVisible: record.representationVisible,
      constructor: {
        ...record.constructor,
        scheme: this.#publicScheme(this.#scheme(record.constructor.symbol)),
      },
      fields: record.fields.map((field) => ({
        name: field.name,
        type: this.#publicType(this.#annotationType(
          field.annotation,
          0,
          new Map(),
          parameters,
        )),
        span: field.span,
      })),
      span: record.span,
    };
  }

  #materializeExpr(expression: Resolved.Expr): Typed.Expr {
    const value = this.#materializeUnwidenedExpr(expression);
    const natWidening = this.#natWidenings.get(expression);
    if (natWidening !== undefined) {
      const requirement = this.#publicRequirement(natWidening);
      return {
        kind: "WidenNat",
        value,
        requirement,
        type: requirement.type,
        span: expression.span,
      };
    }
    const widening = this.#intWidenings.get(expression);
    if (widening === undefined) return value;
    const requirement = this.#publicRequirement(widening);
    return {
      kind: "WidenInt",
      value,
      requirement,
      type: requirement.type,
      span: expression.span,
    };
  }

  #materializeUnwidenedExpr(expression: Resolved.Expr): Typed.Expr {
    const type = this.#publicType(this.#typeOf(expression));
    switch (expression.kind) {
      case "Name":
      case "SeqOperation":
      case "CollectionOperation":
      case "PrimitiveOperation":
      case "Unit":
      case "Boolean":
      case "BigInt":
      case "Float":
      case "ErrorExpr":
        return expression.kind === "CollectionOperation"
          ? {
              ...expression,
              type,
              requirements: this.#publicRequirements(this.#requirements.get(expression) ?? []),
            }
          : { ...expression, type };
      case "Integer":
        return {
          kind: "FromNat",
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
      case "Hash":
        return {
          kind: "Hash",
          value: this.#materializeExpr(expression.value),
          requirement: this.#publicRequirement(this.#requirements.get(expression)![0]!),
          type,
          span: expression.span,
        };
      case "Tuple":
      case "Vector":
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
      case "While":
        return {
          kind: "While",
          condition: this.#materializeExpr(expression.condition),
          body: this.#materializeExpr(expression.body) as Typed.BlockExpr,
          type,
          span: expression.span,
        };
      case "For":
        return {
          kind: "For",
          pattern: this.#materializePattern(expression.pattern),
          iterable: this.#materializeExpr(expression.iterable),
          body: this.#materializeExpr(expression.body) as Typed.BlockExpr,
          ...(this.#iterations.get(expression) === undefined
            ? {}
            : { iteration: this.#publicRequirement(this.#iterations.get(expression)!) }),
          type,
          span: expression.span,
        };
      case "Throw":
        return {
          kind: "Throw",
          exception: this.#materializeExpr(expression.exception),
          type,
          span: expression.span,
        };
      case "Try":
        return {
          kind: "Try",
          body: this.#materializeExpr(expression.body),
          arms: expression.arms.map((arm) => ({
            pattern: this.#materializePattern(arm.pattern),
            ...(arm.guard === undefined
              ? {}
              : { guard: this.#materializeExpr(arm.guard) }),
            body: this.#materializeExpr(arm.body),
            span: arm.span,
          })),
          type,
          span: expression.span,
        };
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
        const seqDotCall = this.#seqDotCalls.get(expression);
        if (seqDotCall !== undefined) {
          return {
            kind: "Call",
            callee: {
              kind: "SeqOperation",
              operation: seqDotCall.operation,
              type: this.#publicType(seqDotCall.callee),
              receiverBound: true,
              span: expression.callee.kind === "Access"
                ? expression.callee.field.span
                : expression.callee.span,
            },
            arguments: [
              this.#materializeExpr(seqDotCall.receiver),
              ...expression.arguments.map((argument) => this.#materializeExpr(argument)),
            ],
            requirements: [],
            type,
            span: expression.span,
          };
        }
        const dotCall = this.#dotCalls.get(expression);
        if (dotCall !== undefined) {
          return {
            kind: "Call",
            callee: {
              kind: "Name",
              symbol: dotCall.symbol.id,
              text: this.#operationSpellings.get(dotCall.symbol.id) ?? dotCall.symbol.name,
              type: this.#publicType(dotCall.callee),
              receiverBound: true,
              span: expression.callee.kind === "Access"
                ? expression.callee.field.span
                : expression.callee.span,
            },
            arguments: [
              this.#materializeExpr(dotCall.receiver),
              ...expression.arguments.map((argument) => this.#materializeExpr(argument)),
            ],
            requirements: [],
            type,
            span: expression.span,
          };
        }
        return {
          ...expression,
          type,
          callee: this.#materializeExpr(expression.callee),
          arguments: expression.arguments.map((argument) => this.#materializeExpr(argument)),
          requirements: this.#publicRequirements(
            this.#callRequirements.get(expression) ?? [],
          ),
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
          ...(this.#indexOperations.get(expression) === undefined
            ? {}
            : { operation: this.#indexOperations.get(expression)! }),
          ...(this.#requirements.get(expression) === undefined
            ? {}
            : { requirements: this.#publicRequirements(this.#requirements.get(expression)!) }),
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
          "Signed",
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
    if (expression.operator === "Range") {
      return {
        kind: "Range",
        start: left,
        end: right,
        type,
        span: expression.span,
      };
    }
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
      Subtract: ["Signed", "subtract"],
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
    if (actual.kind === "Union") {
      return actual.arguments.length === 0
        ? actual.name
        : `${actual.name}(${actual.arguments.map((argument) => this.#display(argument)).join(", ")})`;
    }
    if (actual.kind === "NominalRecord") {
      return actual.arguments.length === 0
        ? actual.name
        : `${actual.name}(${actual.arguments.map((argument) => this.#display(argument)).join(", ")})`;
    }
    if (actual.kind === "ExternType") return actual.name;
    if (actual.kind === "Range") return "Range";
    if (actual.kind === "Seq") return `Seq(${this.#display(actual.element)})`;
    if (actual.kind === "Vector") return `Vector(${this.#display(actual.element)})`;
    if (actual.kind === "Set") return `Set(${this.#display(actual.element)})`;
    if (actual.kind === "Array") return `Array(${this.#display(actual.element)})`;
    if (actual.kind === "Nullable") return `Nullable(${this.#display(actual.value)})`;
    if (actual.kind === "Map") return `Map(${this.#display(actual.key)}, ${this.#display(actual.value)})`;
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

function referencedSymbols(root: object): ReadonlySet<Resolved.SymbolId> {
  const symbols = new Set<Resolved.SymbolId>();
  const seen = new WeakSet<object>();
  const visit = (value: unknown): void => {
    if (value === null || typeof value !== "object") return;
    if (seen.has(value)) return;
    seen.add(value);
    if ("kind" in value && value.kind === "Name" && "symbol" in value && typeof value.symbol === "number") {
      symbols.add(value.symbol as Resolved.SymbolId);
      return;
    }
    for (const [key, child] of Object.entries(value)) {
      if (key !== "span") visit(child);
    }
  };
  visit(root);
  return symbols;
}

function coverageAlternatives(
  pattern: Resolved.Pattern,
): readonly Resolved.Pattern[] {
  const unwrapped = unwrapAsPattern(pattern);
  return unwrapped.kind === "Or"
    ? unwrapped.alternatives.flatMap(coverageAlternatives)
    : [unwrapped];
}

function annotationHasTypeVariable(
  annotation: Resolved.TypeAnnotation,
): boolean {
  switch (annotation.kind) {
    case "TypeVariable":
      return true;
    case "Function":
      return annotation.parameters.some(annotationHasTypeVariable) ||
        annotationHasTypeVariable(annotation.result);
    case "Seq":
    case "Vector":
    case "Set":
    case "Array":
      return annotationHasTypeVariable(annotation.element);
    case "Nullable":
      return annotationHasTypeVariable(annotation.value);
    case "Map":
      return annotationHasTypeVariable(annotation.key) ||
        annotationHasTypeVariable(annotation.value);
    case "Tuple":
      return annotation.elements.some(annotationHasTypeVariable);
    case "Record":
      return annotation.fields.some((field) =>
        annotationHasTypeVariable(field.annotation)
      );
    case "Union":
    case "RecordDeclaration":
      return annotation.arguments.some(annotationHasTypeVariable);
    case "ExternType":
    case "Primitive":
    case "Range":
    case "ImpliedType":
    case "ErrorType":
      return false;
  }
}

function nestedAdapterType(
  annotation: Resolved.TypeAnnotation,
  nested = false,
): string | undefined {
  if (annotation.kind === "Seq") {
    if (nested) return "Seq";
    return nestedAdapterType(annotation.element, true);
  }
  if (annotation.kind === "Function") {
    for (const parameter of annotation.parameters) {
      const found = nestedAdapterType(parameter, true);
      if (found !== undefined) return found;
    }
    return nestedAdapterType(annotation.result, true);
  }
  if (annotation.kind === "Tuple") {
    for (const element of annotation.elements) {
      const found = nestedAdapterType(element, true);
      if (found !== undefined) return found;
    }
  } else if (annotation.kind === "Record") {
    for (const field of annotation.fields) {
      const found = nestedAdapterType(field.annotation, true);
      if (found !== undefined) return found;
    }
  } else if (
    annotation.kind === "Vector" ||
    annotation.kind === "Set" ||
    annotation.kind === "Array"
  ) {
    return nestedAdapterType(annotation.element, true);
  } else if (annotation.kind === "Nullable") {
    return nestedAdapterType(annotation.value, true);
  } else if (annotation.kind === "Map") {
    return nestedAdapterType(annotation.key, true) ??
      nestedAdapterType(annotation.value, true);
  } else if (annotation.kind === "Union" || annotation.kind === "RecordDeclaration") {
    for (const argument of annotation.arguments) {
      const found = nestedAdapterType(argument, true);
      if (found !== undefined) return found;
    }
  }
  return undefined;
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
    case "Vector":
      return [
        ...pattern.elements.flatMap(resolvedPatternBindings),
        ...(pattern.rest?.pattern === undefined
          ? []
          : resolvedPatternBindings(pattern.rest.pattern)),
      ];
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
    case "Vector":
      return pattern.rest !== undefined && pattern.elements.length === 0;
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
    Nat: ["Num", "Eq", "Ord", "Show", "Pow", "Hash", "Integral"],
    Int: ["Num", "Signed", "Eq", "Ord", "Show", "Pow", "Hash", "Integral"],
    Float: ["Num", "Signed", "Frac", "Eq", "Ord", "Show", "Pow", "Hash"],
    Bool: ["Eq", "Ord", "Show", "Hash"],
    String: ["Eq", "Ord", "Show", "Concat", "Hash"],
    BigInt: ["Num", "Signed", "Eq", "Ord", "Show", "Pow", "Hash", "Integral"],
    Exn: [],
    Unit: ["Eq", "Ord", "Show", "Hash"],
  };
  return instances[type].includes(constraint);
}

function isConstraintName(name: string): name is Typed.ConstraintName {
  return ["Num", "Signed", "Frac", "Pow", "Concat", "Eq", "Ord", "Show", "Hash", "Iterable", "Integral"].includes(name);
}

/** Keeps the technical projection vocabulary out of source-facing diagnostics. */
function impliedTypeBinderMessage(constraint: string): string {
  const reason = `\`${constraint}\` declares an implied type and cannot constrain a type variable in v1`;
  return constraint === "Iterable"
    ? `${reason}; take a \`Seq(a)\` parameter instead`
    : reason;
}
