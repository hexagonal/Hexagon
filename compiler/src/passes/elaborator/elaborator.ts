/**
 * Elaboration removes surface-only expression forms and makes every remaining
 * constraint dispatch explicit. It does not format JavaScript or choose names
 * for emitted helpers; those decisions belong to emission.
 */

import * as Diagnostics from "../../support/diagnostics.js";
import type * as Source from "../../support/source.js";
import type * as Core from "../../syntax/core/index.js";
import type * as Typed from "../../syntax/typed/index.js";

/**
 * Every match catch clause elaborated in the module being processed, in source
 * order (Exceptions §5.4, #500).
 *
 * The cannot-throw judgment's subject is *the elaborated scrutinee*, so its
 * input is collected as elaboration produces it rather than re-walked from the
 * finished tree: a second traversal would be a second reading of the same rule,
 * free to drift from the first. Elaboration is synchronous and one module at a
 * time, and `elaborate` clears this before it starts.
 */
let elaboratedCatchClauses: Core.MatchExpr[] = [];

export function elaborate(module: Typed.Module, source?: Source.File): Core.Module {
  elaboratedCatchClauses = [];
  const items = module.items.map(elaborateItem);
  const clauses = elaboratedCatchClauses;
  elaboratedCatchClauses = [];
  const diagnostics = new Diagnostics.Bag();
  for (const diagnostic of module.diagnostics) diagnostics.add(diagnostic);
  for (const clause of clauses) reportUnreachableCatchClause(clause, diagnostics, source);
  return {
    kind: "Module",
    fileId: module.fileId,
    items,
    symbols: module.symbols,
    unions: module.unions,
    records: module.records,
    preludeRecords: module.preludeRecords,
    preludeUnions: module.preludeUnions,
    preludeInstances: module.preludeInstances,
    preludeTypeImports: module.preludeTypeImports,
    visibleExceptions: module.visibleExceptions,
    externTypes: module.externTypes,
    comments: module.comments,
    docs: module.docs,
    companionImports: module.companionImports,
    span: module.span,
    diagnostics: diagnostics.toArray(),
  };
}

function elaborateItem(item: Typed.Item): Core.Item {
  switch (item.kind) {
    case "Import":
    case "ExternBlock":
    case "ExternImport":
      return item;
    case "ConstraintDeclaration":
      // Default bodies are elaborated here, because for an **exported**
      // constraint this declaration is where the body is emitted — hoisted once
      // as a helper (Constraints §6.5) rather than copied into each honoring
      // dictionary. Before §6.5 the only elaborated copy was the one the checker
      // materialized into each `Honor`, and this one was dead.
      return {
        ...item,
        members: item.members.map((member): Core.ConstraintMemberDeclaration => {
          const { defaultValue, ...rest } = member;
          if (defaultValue === undefined) return rest;
          return {
            ...rest,
            defaultValue: { ...defaultValue, body: elaborateExpr(defaultValue.body) },
          };
        }),
      };
    case "Honor":
      return {
        ...item,
        baseConstraints: item.baseConstraints.map((constraint) => ({
          name: constraint.name,
          evidence: evidence(constraint),
        })),
        components: evidenceComponents(item.components),
        members: item.members.map((member) => ({
          ...member,
          value: {
            ...member.value,
            body: elaborateExpr(member.value.body),
          },
        })),
      };
    case "Let":
      return { ...item, value: elaborateExpr(item.value) };
    case "Var":
      return { ...item, value: elaborateExpr(item.value) };
    case "LetPattern":
      return { ...item, pattern: elaboratePattern(item.pattern), value: elaborateExpr(item.value) };
    case "Union":
    case "TypeAlias":
    case "RecordDeclaration":
    case "Exception":
      return item;
    case "Fun":
      return {
        ...item,
        value: {
          ...item.value,
          body: elaborateExpr(item.value.body),
        },
      };
    case "ExprItem":
      return { ...item, expression: elaborateExpr(item.expression) };
    case "ErrorItem":
      return item;
  }
}

/**
 * Exceptions §5.4's cannot-throw judgment: a scrutinee whose evaluation provably
 * cannot throw makes the whole catch clause unreachable — a hard error, the same
 * doctrine as every dead arm.
 *
 * The class is exact and deliberately minimal, and it is read off the
 * *elaborated* scrutinee because that is where the guarantee lives:
 *
 * - a **bare variable read** — a plain `Name` with no evidence hanging off it.
 *   An evidence application is excluded on purpose: a generalized literal
 *   binding's use re-runs its `Num` elaboration, which may be user code.
 * - a **literal whose elaboration erases to a primitive construction** — the
 *   Numeric Literals §5 codegen guarantee. `Number`, `BigInt`, and `Float`
 *   nodes are exactly the erased ones; a `ConvertNat` is the *unerased* case
 *   and declines, which is how the judgment avoids leaning on `Num`'s unchecked
 *   totality law. A `String` qualifies only with no interpolation holes, since
 *   a hole runs a `Show` call; a vector, tuple, or record literal never does.
 *
 * Nothing wider is available: throwing is not an effect (§1), so no colour
 * analysis can prove throw-freedom through a call, and purity would not prove it
 * either — a `->` function may throw.
 */
function scrutineeCannotThrow(scrutinee: Core.Expr): boolean {
  switch (scrutinee.kind) {
    case "Name":
      return scrutinee.evidence === undefined || scrutinee.evidence.length === 0;
    case "Number":
    case "BigInt":
    case "Float":
    case "Unit":
      return true;
    case "String":
      return scrutinee.parts.every((part) => part.kind === "Text");
    default:
      return false;
  }
}

/** The scrutinee as written, for the message; reconstructed if no source came along. */
function scrutineeText(scrutinee: Core.Expr, source: Source.File | undefined): string {
  if (source !== undefined && source.id === scrutinee.span.fileId) {
    return source.text.slice(scrutinee.span.start.offset, scrutinee.span.end.offset);
  }
  switch (scrutinee.kind) {
    case "Name":
      return scrutinee.text;
    case "Number":
    case "BigInt":
      return scrutinee.decimal;
    case "Float":
      return scrutinee.spelling;
    case "Unit":
      return "()";
    default:
      return "the scrutinee";
  }
}

function reportUnreachableCatchClause(
  expression: Core.MatchExpr,
  diagnostics: Diagnostics.Bag,
  source: Source.File | undefined,
): void {
  if (!scrutineeCannotThrow(expression.scrutinee)) return;
  diagnostics.add({
    severity: "error",
    message: "this `catch` can never run: evaluating " +
      `${scrutineeText(expression.scrutinee, source)} cannot throw`,
    primary: expression.catchArms?.[0]?.span ?? expression.span,
  });
}

function elaborateArms(arms: readonly Typed.MatchArm[]): readonly Core.MatchArm[] {
  return arms.map((arm) => ({
    pattern: elaboratePattern(arm.pattern),
    ...(arm.guard === undefined ? {} : { guard: elaborateExpr(arm.guard) }),
    body: elaborateExpr(arm.body),
    span: arm.span,
  }));
}

function elaborateExpr(expression: Typed.Expr): Core.Expr {
  switch (expression.kind) {
    case "Name": {
      const { requirements = [], ...name } = expression;
      if (requirements.length === 0) return name;
      return {
        ...name,
        evidence: requirements.map((requirement) => ({
          constraint: requirement.name,
          value: evidence(requirement),
        })),
      };
    }
    case "Unit":
    case "BigInt":
    case "Float":
    case "ErrorExpr":
      return expression;
    // `Node` alone, and unconstrained (#373): the evidence this case used to
    // resolve was the retired companion rows' `Hash`, and nothing replaces it.
    case "CollectionOperation":
      return expression;
    case "FromNat":
      return elaborateInteger(expression);
    case "WidenNat":
      return {
        kind: "WidenNat",
        value: elaborateExpr(expression.value),
        evidence: evidence(expression.requirement),
        type: expression.type,
        span: expression.span,
      };
    case "WidenInt":
      return {
        kind: "WidenInt",
        value: elaborateExpr(expression.value),
        evidence: evidence(expression.requirement),
        type: expression.type,
        span: expression.span,
      };
    case "String":
      return {
        ...expression,
        parts: expression.parts.map((part) =>
          part.kind === "Text"
            ? part
            : {
                kind: "Show" as const,
                expression: elaborateExpr(part.expression),
                evidence: evidence(part.requirement),
                span: part.span,
              },
        ),
      };
    case "Hash":
      return {
        kind: "Hash",
        value: elaborateExpr(expression.value),
        evidence: evidence(expression.requirement),
        type: expression.type,
        span: expression.span,
      };
    case "Tuple":
    case "Vector":
      return {
        ...expression,
        elements: expression.elements.map(elaborateExpr),
      };
    case "Record":
      return {
        kind: "Record",
        type: expression.type,
        ...(expression.spread === undefined
          ? {}
          : { spread: elaborateExpr(expression.spread) }),
        fields: expression.fields.map((field) => ({
          name: field.name.text,
          punned: field.punned,
          value: elaborateExpr(field.value),
          span: field.span,
        })),
        span: expression.span,
      };
    case "Group":
    // Ascription §4: an ascription erases. `(e: T)` emits exactly as `(e)`
    // would — the type only ever acted through unification — so the wrapper
    // stops here and no Core node records that it was written.
    case "Ascription":
      return elaborateExpr(expression.expression);
    case "Block":
      return { ...expression, items: expression.items.map(elaborateItem) };
    case "Lambda":
      return { ...expression, body: elaborateExpr(expression.body) };
    case "If":
      return {
        kind: "If" as const,
        condition: elaborateExpr(expression.condition),
        consequence: elaborateExpr(expression.consequence),
        alternative: elaborateExpr(expression.alternative),
        ...(expression.elseless ? { elseless: true } : {}),
        type: expression.type,
        span: expression.span,
      };
    case "While":
      return {
        ...expression,
        condition: elaborateExpr(expression.condition),
        body: elaborateExpr(expression.body) as Core.BlockExpr,
      };
    case "For":
      return {
        kind: "For",
        pattern: elaboratePattern(expression.pattern),
        iterable: elaborateExpr(expression.iterable),
        body: elaborateExpr(expression.body) as Core.BlockExpr,
        ...(expression.iteration === undefined
          ? {}
          : { iteration: evidence(expression.iteration) }),
        type: expression.type,
        span: expression.span,
      };
    case "Throw":
      return { ...expression, exception: elaborateExpr(expression.exception) };
    case "Try":
      return {
        ...expression,
        body: elaborateExpr(expression.body),
        arms: elaborateArms(expression.arms),
      };
    case "Match": {
      const { catchArms, ...head } = expression;
      const elaborated: Core.MatchExpr = {
        ...head,
        scrutinee: elaborateExpr(expression.scrutinee),
        arms: elaborateArms(expression.arms),
        ...(catchArms === undefined ? {} : { catchArms: elaborateArms(catchArms) }),
      };
      if (elaborated.catchArms !== undefined) elaboratedCatchClauses.push(elaborated);
      return elaborated;
    }
    case "Call":
      return {
        kind: "Call",
        callee: elaborateExpr(expression.callee),
        arguments: expression.arguments.map(elaborateExpr),
        evidence: expression.requirements.map((requirement) => ({
          constraint: requirement.name,
          value: evidence(requirement),
        })),
        type: expression.type,
        span: expression.span,
      };
    case "LogicalNot":
      return { ...expression, operand: elaborateExpr(expression.operand) };
    case "Logical":
      return {
        ...expression,
        left: elaborateExpr(expression.left),
        right: elaborateExpr(expression.right),
      };
    case "ConstraintCall":
      return {
        kind: "ConstraintCall",
        constraint: expression.constraint,
        member: expression.member,
        evidence: evidence(expression.requirement),
        arguments: expression.arguments.map(elaborateExpr),
        type: expression.type,
        span: expression.span,
      };
    case "ComparisonChain":
      return {
        kind: "ComparisonChain",
        operands: expression.operands.map(elaborateExpr),
        steps: expression.steps.map((step) => ({
          test: step.test,
          evidence: evidence(step.requirement),
          span: step.span,
        })),
        type: expression.type,
        span: expression.span,
      };
    case "Range":
      return {
        ...expression,
        start: elaborateExpr(expression.start),
        end: elaborateExpr(expression.end),
      };
    case "Access":
      return expression.tupleIndex !== undefined
        ? {
            kind: "TupleAccess",
            receiver: elaborateExpr(expression.receiver),
            index: expression.tupleIndex,
            type: expression.type,
            span: expression.span,
          }
        : expression.recordField !== undefined
          ? {
              kind: "FieldAccess",
              receiver: elaborateExpr(expression.receiver),
              field: expression.recordField,
              type: expression.type,
              span: expression.span,
            }
          : { kind: "ErrorExpr", type: expression.type, span: expression.span };
    case "Assignment":
      return expression.target.kind === "Name"
        ? {
            kind: "Assignment",
            target: elaborateExpr(expression.target) as Core.NameExpr,
            value: elaborateExpr(expression.value),
            type: expression.type,
            span: expression.span,
          }
        : { kind: "ErrorExpr", type: expression.type, span: expression.span };
    case "Index":
      return expression.operation === undefined
        ? { kind: "ErrorExpr", type: expression.type, span: expression.span }
        : {
            kind: "Index",
            receiver: elaborateExpr(expression.receiver),
            index: elaborateExpr(expression.index),
            operation: expression.operation,
            ...(expression.requirements === undefined
              ? {}
              : {
                  hashEvidence: evidence(
                    expression.requirements.find(({ name }) => name === "Hash"),
                  ),
                }),
            type: expression.type,
            span: expression.span,
          };
  }
}

/** Copies a fully checked pattern into Core without retaining a Typed tree node. */
function elaboratePattern(pattern: Typed.Pattern): Core.Pattern {
  switch (pattern.kind) {
    case "Binding":
    case "Wildcard":
    case "Unit":
    case "Integer":
    case "String":
      return { ...pattern };
    case "As":
      return { ...pattern, pattern: elaboratePattern(pattern.pattern) };
    case "Or":
      return { ...pattern, alternatives: pattern.alternatives.map(elaboratePattern) };
    case "Tuple":
      return { ...pattern, elements: pattern.elements.map(elaboratePattern) };
    case "Vector":
      return {
        kind: "Vector",
        elements: pattern.elements.map(elaboratePattern),
        ...(pattern.rest === undefined
          ? {}
          : {
              rest: {
                index: pattern.rest.index,
                span: pattern.rest.span,
                ...(pattern.rest.pattern === undefined
                  ? {}
                  : { pattern: elaboratePattern(pattern.rest.pattern) }),
              },
            }),
        span: pattern.span,
      };
    case "Record":
      return {
        ...pattern,
        fields: pattern.fields.map((field) => ({
          ...field,
          pattern: elaboratePattern(field.pattern),
        })),
      };
    case "Constructor":
      // Built field by field rather than spread: the local spelling and its
      // span are the checker's to show a reader, and a Core node that still
      // carried them would let emission test the spelling an alias wrote
      // (#468) with nothing but a type to say otherwise.
      return {
        kind: "Constructor",
        symbol: pattern.symbol,
        tag: pattern.tag,
        arguments: pattern.arguments.map(elaboratePattern),
        span: pattern.span,
      };
  }
}

function elaborateInteger(expression: Typed.FromNatExpr): Core.Expr {
  if (expression.type.kind === "Primitive") {
    if (
      expression.type.name === "Nat" ||
      expression.type.name === "Int" ||
      expression.type.name === "Float"
    ) {
      return {
        kind: "Number",
        decimal: expression.decimal,
        representation: expression.type.name,
        type: expression.type,
        span: expression.span,
      };
    }
    if (expression.type.name === "BigInt") {
      return {
        kind: "BigInt",
        decimal: expression.decimal,
        type: expression.type,
        span: expression.span,
      };
    }
  }

  return {
    kind: "ConvertNat",
    decimal: expression.decimal,
    evidence: evidence(expression.requirement),
    type: expression.type,
    span: expression.span,
  };
}

/** #278: the checker's per-component selection, carried to emission verbatim. */
function evidenceComponents(
  components: readonly Typed.ConstraintComponent[] | undefined,
): readonly Core.EvidenceComponent[] {
  return (components ?? []).map((component) => ({
    key: component.key,
    evidence: evidence(component.constraint),
  }));
}

function evidence(requirement: Typed.Constraint | undefined): Core.Evidence {
  if (requirement === undefined) return { kind: "Error" };
  // A requirement the checker has already reported gets no evidence at all.
  // The program is erroneous and one diagnostic already says why; inventing a
  // dictionary here would only give emission a second, quieter way to report
  // the same failure — which is what a missing primitive instance did once
  // every primitive's instances became source (#344).
  if (requirement.unsatisfied === true) return { kind: "Error" };
  if (requirement.dictionary !== undefined) {
    return {
      kind: "Instance",
      dictionary: requirement.dictionary,
      arguments: (requirement.dictionaryArguments ?? []).map((argument) => ({
        constraint: argument.name,
        evidence: evidence(argument),
      })),
      // A source instance at a primitive head (#344). The selection is the
      // instance's, and the note travels so emission can still inline the slots
      // the monomorphic tables cover — Constraints §6.1's last sentence.
      ...(requirement.type.kind === "Primitive"
        ? { primitive: requirement.type.name }
        : {}),
    };
  }
  if (requirement.structural === true) {
    return {
      kind: "Structural",
      type: requirement.type,
      components: evidenceComponents(requirement.components),
    };
  }
  switch (requirement.type.kind) {
    case "Primitive":
      return { kind: "Primitive", instance: requirement.type.name };
    case "Variable":
      return {
        kind: "Dictionary",
        variable: requirement.type.id,
        // The *demanded* constraint's identity, not the provider's: this is the
        // constraint the node answers, and the one an edition's substituted
        // parameter has to find an instance of (#679).
        constraintIdentity: requirement.identity,
        ...(requirement.evidenceConstraint === undefined
          ? {}
          : { constraint: requirement.evidenceConstraint }),
        ...(requirement.evidencePath === undefined
          ? {}
          : { path: requirement.evidencePath }),
      };
    case "Function":
    case "Tuple":
    case "Record":
    case "Range":
    case "Vector":
    case "Map":
    case "Set":
    case "Array":
    case "JsMap":
    case "JsSet":
    case "Node":
    case "Nullable":
    case "Union":
    case "NominalRecord":
    case "ExternType":
    case "Error":
      return { kind: "Error" };
  }
}
