/**
 * The parsed tree as one shape of node: what each piece of the text is, where
 * it stands, and what it holds.
 *
 * Read by the editor services that ask what a position or a selection is part
 * of: the type of an expression (`expression-types.ts`) and "Expand Selection".
 * The parsed tree is the one that keeps every piece the source wrote, in the
 * source's own nesting: an operator is still its `Binary`, a pattern and a type
 * annotation are still themselves. The checked tree has folded some of that
 * away and has no annotations at all, so it answers what a piece *is* only by
 * span, and only for expressions.
 *
 * Each node has a role, and the roles are what a reader of the text would call
 * the piece:
 *
 * - `expression`: a parsed `Expr`.
 * - `name`: an identifier, wherever it stands.
 * - `part`: a piece of an expression's own syntax that is not an expression: a
 *   string's text and its `${…}`, a record literal's field, a `match` arm.
 *   What a part's punctuation belongs to is the expression around it.
 * - `other`: everything else: a declaration (an item, a parameter, a type
 *   parameter, a constructor, a member), a pattern, a type, the module.
 *
 * Every child lies inside its parent and has width: a piece the parser minted
 * where nothing was written (an `if`'s missing `else`) is left out by that rule
 * rather than by name. Children are in the order the text has them, and no two
 * share text: where the parser keeps one piece twice (a pun, a member's name
 * and the lambda built over it), it is a node once.
 */

import * as Source from "../support/source.js";
import { isSyntheticParameterName } from "../support/synthetic.js";
import type * as Parsed from "../syntax/parsed/index.js";

export type SyntaxRole = "expression" | "name" | "part" | "other";

export interface SyntaxNode {
  readonly role: SyntaxRole;
  readonly span: Source.Span;
  /** The parsed expression, for a node whose role is `expression`. */
  readonly expression?: Parsed.Expr;
  readonly children: readonly SyntaxNode[];
}

const trees = new WeakMap<Parsed.Module, SyntaxNode>();

/** The module as a tree of nodes. Built once per parsed module. */
export function syntaxTree(module: Parsed.Module): SyntaxNode {
  const known = trees.get(module);
  if (known !== undefined) return known;
  const built = node("other", module.span, [
    ...(module.name.declared ? [moduleName(module.name)] : []),
    ...module.items.map(item),
  ]);
  trees.set(module, built);
  return built;
}

/**
 * The nodes that hold `[start, end)`, outermost first, ending at the innermost.
 * An empty range is held by a node it lies inside or at either edge of, and
 * where it is at the edge two siblings share, by the first: the one it is just
 * after.
 */
export function enclosingNodes(root: SyntaxNode, start: number, end: number): readonly SyntaxNode[] {
  const chain: SyntaxNode[] = [];
  let at: SyntaxNode | undefined = holds(root, start, end) ? root : undefined;
  while (at !== undefined) {
    chain.push(at);
    at = at.children.find((child) => holds(child, start, end));
  }
  return chain;
}

/**
 * What "Expand Selection" grows through from an offset: the nodes around it,
 * innermost first, each wider than the one before. The offset stands for the
 * character there, or, where that is a space, a line break or a comment, the
 * one before it (a caret just after a word); a comment the offset is in comes
 * first, and then what holds the comment.
 */
export function selectionRangesAt(file: Source.File, module: Parsed.Module, offset: number): readonly Source.Span[] {
  const solid = solidText(file, module);
  const inComment = (at: number): Source.Comment | undefined =>
    module.comments.find(({ span }) => span.start.offset <= at && at < span.end.offset);
  const comment = inComment(offset) ?? (solid(offset) ? undefined : inComment(offset - 1));
  // Off every character, the empty range at the offset is held by what it is
  // just after (`enclosingNodes`), which is the character before.
  const [start, end] = comment !== undefined
    ? [comment.span.start.offset, comment.span.end.offset]
    : solid(offset)
    ? [offset, offset + 1]
    : [offset, offset];
  const spans: Source.Span[] = comment === undefined ? [] : [comment.span];
  for (const node of [...enclosingNodes(syntaxTree(module), start, end)].reverse()) {
    const last = spans.at(-1);
    if (last?.start.offset === node.span.start.offset && last.end.offset === node.span.end.offset) continue;
    spans.push(node.span);
  }
  return spans;
}

const solids = new WeakMap<Parsed.Module, (offset: number) => boolean>();

/**
 * Whether the character at an offset is part of a token: inside the text, and
 * not a space, a tab, a line break, or a comment.
 */
export function solidText(file: Source.File, module: Parsed.Module): (offset: number) => boolean {
  const known = solids.get(module);
  if (known !== undefined) return known;
  const { text } = file;
  const comment = new Uint8Array(text.length);
  for (const { span } of module.comments) comment.fill(1, span.start.offset, span.end.offset);
  const solid = (offset: number): boolean =>
    offset >= 0 && offset < text.length && comment[offset] === 0 && !" \t\r\n".includes(text[offset]!);
  solids.set(module, solid);
  return solid;
}

/** A type's text from its module qualifier, which the parser keeps outside the type's span. */
function qualified(span: Source.Span, qualifier: Parsed.Name | undefined): Source.Span {
  return qualifier === undefined || qualifier.span.start.offset >= span.start.offset
    ? span
    : { ...span, start: qualifier.span.start };
}

function sameText(left: Source.Span, right: Source.Span): boolean {
  return left.start.offset === right.start.offset && left.end.offset === right.end.offset;
}

function holds(node: SyntaxNode, start: number, end: number): boolean {
  return node.span.start.offset <= start && end <= node.span.end.offset;
}

function node(
  role: SyntaxRole,
  span: Source.Span,
  children: readonly (SyntaxNode | undefined)[],
  expression?: Parsed.Expr,
): SyntaxNode {
  const inside = children
    .filter((child): child is SyntaxNode =>
      child !== undefined &&
      child.span.start.offset < child.span.end.offset &&
      span.start.offset <= child.span.start.offset &&
      child.span.end.offset <= span.end.offset
    )
    .sort((left, right) => left.span.start.offset - right.span.start.offset);
  return { role, span, ...(expression === undefined ? {} : { expression }), children: inside };
}

function name(written: Parsed.Name): SyntaxNode {
  return node("name", written.span, []);
}

function names(written: readonly Parsed.Name[] | undefined): readonly SyntaxNode[] {
  return (written ?? []).map(name);
}

function moduleName(written: Parsed.ModuleName): SyntaxNode {
  return node("other", written.span, names(written.segments));
}

function item(written: Parsed.Item): SyntaxNode {
  switch (written.kind) {
    case "Import":
      // An import without `as` has one name, which the parser keeps as both.
      return node("other", written.span, [
        moduleName(written.module),
        sameText(written.alias.span, written.module.span) ? undefined : name(written.alias),
      ]);
    case "ExternBlock":
      return node("other", written.span, written.declarations.map(externDeclaration));
    case "ExternImport":
    case "ErrorItem":
      return node("other", written.span, []);
    case "Let":
      return node("other", written.span, [
        // A `widens` item's name is derived, over its member path's own text.
        written.widens === undefined ? name(written.name) : undefined,
        ...typeParameters(written.typeParameters),
        ...headerTypeParameters(written.value),
        annotation(written.annotation),
        expression(written.value),
        ...(written.widens ?? []).map((target) => node("other", target.span, [name(target.module), name(target.member)])),
      ]);
    case "Var":
      return node("other", written.span, [
        name(written.name),
        ...headerTypeParameters(written.value),
        annotation(written.annotation),
        expression(written.value),
      ]);
    case "LetPattern":
      return node("other", written.span, [pattern(written.pattern), expression(written.value)]);
    case "Fun":
      return node("other", written.span, [
        name(written.name),
        ...headerTypeParameters(written.value),
        expression(written.value),
      ]);
    case "TypeAlias":
      return node("other", written.span, [name(written.name), ...names(written.parameters), annotation(written.annotation)]);
    case "Union":
      return node("other", written.span, [
        name(written.name),
        ...names(written.parameters),
        ...names(written.derives),
        ...written.constructors.map((constructor) =>
          node("other", constructor.span, [
            name(constructor.name),
            ...constructor.slots.map(slot),
            constructor.foreignName === undefined ? undefined : name(constructor.foreignName),
          ])
        ),
        written.foreign === undefined ? undefined : name(written.foreign.name),
      ]);
    case "RecordDeclaration":
      return node("other", written.span, [
        name(written.name),
        ...names(written.parameters),
        ...names(written.derives),
        ...written.fields.map(typeField),
      ]);
    case "Exception":
      return node("other", written.span, [name(written.name), ...written.slots.map(slot)]);
    case "ConstraintDeclaration":
      return node("other", written.span, [
        name(written.name),
        name(written.subject),
        ...names(written.baseConstraints),
        ...written.impliedTypes.map((implied) => node("other", implied.span, [name(implied.name)])),
        ...written.members.map(constraintMember),
      ]);
    case "Honor":
      return node("other", written.span, [
        name(written.constraint),
        ...typeParameters(written.typeParameters),
        annotation(written.subject),
        ...written.impliedTypes.map((implied) =>
          node("other", implied.span, [name(implied.name), annotation(implied.annotation)])
        ),
        ...written.members.map((member) =>
          member.value === undefined
            ? node("other", member.span, [name(member.name)])
            : memberWithBody(member.span, member.name, [], member.value)
        ),
      ]);
    case "PatternDeclaration":
      return node("other", written.span, [
        name(written.name),
        written.head === undefined ? undefined : node("other", written.head.span, [
          ...typeParameters(written.head.typeParameters),
          ...written.head.components.map((component) =>
            node("other", component.span, [name(component.name), annotation(component.annotation)])
          ),
          annotation(written.head.result),
        ]),
        ...written.members.map((member) =>
          member.value === undefined
            ? node("other", member.span, [
              name(member.name),
              member.delegate === undefined ? undefined : delegate(member.delegate),
            ])
            : memberWithBody(member.span, member.name, [
              member.delegate === undefined ? undefined : delegate(member.delegate),
            ], member.value)
        ),
      ]);
    case "PatternAlias":
      return node("other", written.span, [name(written.name), delegate(written.target)]);
    case "ExprItem":
      // Over its expression's own text.
      return expression(written.expression);
    default: {
      const unreachable: never = written;
      return unreachable;
    }
  }
}

/**
 * A header form's binder list (`let contains<a: Eq>(…) = …`). The parser keeps
 * it on the lambda it builds, whose text starts at the parameter list, so the
 * list stands in the item, ahead of the lambda, where it was written.
 */
function headerTypeParameters(value: Parsed.Expr): readonly SyntaxNode[] {
  if (value.kind !== "Lambda") return [];
  return typeParameters(value.typeParameters).filter((parameter) =>
    parameter.span.end.offset <= value.span.start.offset
  );
}

/**
 * A constraint's member. One with a default is the lambda the parser built for
 * it (`memberWithBody`), and its header's annotation is the member's.
 */
function constraintMember(written: Parsed.ConstraintMember): SyntaxNode {
  if (written.defaultValue === undefined) {
    return node("other", written.span, [
      name(written.name),
      ...written.parameters.map((parameter) => parameterNode(parameter, [])),
      annotation(written.returnAnnotation),
    ]);
  }
  return memberWithBody(written.span, written.name, [annotation(written.returnAnnotation)], written.defaultValue);
}

/**
 * A member with a body (`add(left, right) = …` in an `honor`, a constraint's
 * default). Where the lambda the parser built for it starts at the member's
 * name, the member is that lambda, with the name among its pieces, as a `let`
 * function's value is a lambda from its parameter list; otherwise the member
 * holds its name and the lambda.
 */
function memberWithBody(
  span: Source.Span,
  written: Parsed.Name,
  header: readonly (SyntaxNode | undefined)[],
  lambda: Parsed.LambdaExpr,
): SyntaxNode {
  const named = name(written);
  if (lambda.span.start.offset <= written.span.start.offset) {
    return node("expression", lambda.span, [named, ...lambdaPieces(lambda), ...header], lambda);
  }
  return node("other", span, [named, ...header, expression(lambda)]);
}

/** A lambda's own pieces, in the order they are written. */
function lambdaPieces(written: Parsed.LambdaExpr): readonly (SyntaxNode | undefined)[] {
  return [
    ...typeParameters(written.typeParameters),
    ...written.parameters.map((parameter) => parameterNode(parameter, written.destructurings ?? [])),
    annotation(written.returnAnnotation),
    expression(written.body),
  ];
}

function externDeclaration(written: Parsed.ExternDeclaration): SyntaxNode {
  // A row without `as` has one name, which the parser keeps as both.
  const foreign = written.foreignName === undefined || sameText(written.foreignName.span, written.localName.span)
    ? undefined
    : name(written.foreignName);
  switch (written.kind) {
    case "ExternFun":
      // Not its `owner`: that is the type declaration it belongs to, a node of
      // its own elsewhere in the block.
      return node("other", written.span, [
        foreign,
        name(written.localName),
        ...typeParameters(written.typeParameters),
        ...written.parameters.map((parameter) => parameterNode(parameter, [])),
        annotation(written.returnAnnotation),
      ]);
    case "ExternLet":
      return node("other", written.span, [foreign, name(written.localName), annotation(written.annotation)]);
    case "ExternType":
      return node("other", written.span, [
        foreign,
        name(written.localName),
        ...(written.parameters ?? []).map((parameter) => node("name", parameter.span, [])),
      ]);
    default: {
      const unreachable: never = written;
      return unreachable;
    }
  }
}

function delegate(written: Parsed.PatternDelegate): SyntaxNode {
  return node("other", written.span, [
    written.qualifier === undefined ? undefined : name(written.qualifier),
    name(written.name),
  ]);
}

function slot(written: Parsed.ConstructorSlot): SyntaxNode {
  return node("other", written.span, [
    written.name === undefined ? undefined : name(written.name),
    annotation(written.annotation),
  ]);
}

function typeField(written: Parsed.RecordTypeField): SyntaxNode {
  return node("other", written.span, [name(written.name), annotation(written.annotation)]);
}

function typeParameters(written: readonly Parsed.TypeParameter[] | undefined): readonly SyntaxNode[] {
  return (written ?? []).map((parameter) =>
    node("other", parameter.span, [name(parameter.name), ...names(parameter.constraints)])
  );
}

/**
 * A parameter. A pattern parameter's binder is one the compiler minted, over
 * the pattern's own text, so the pattern stands where its name would.
 */
function parameterNode(
  written: Parsed.Parameter,
  destructurings: readonly Parsed.ParameterDestructuring[],
): SyntaxNode {
  const destructured = isSyntheticParameterName(written.name.text)
    ? destructurings.find((destructuring) => destructuring.name.text === written.name.text)
    : undefined;
  return node("other", written.span, [
    destructured === undefined ? name(written.name) : pattern(destructured.pattern),
    annotation(written.annotation),
  ]);
}

function annotation(written: Parsed.TypeAnnotation | undefined): SyntaxNode | undefined {
  if (written === undefined) return undefined;
  switch (written.kind) {
    case "NamedType":
      return node("other", qualified(written.span, written.qualifier), [
        written.qualifier === undefined ? undefined : name(written.qualifier),
        name(written.name),
      ]);
    case "AppliedType":
      return node("other", qualified(written.span, written.qualifier), [
        written.qualifier === undefined ? undefined : name(written.qualifier),
        name(written.constructor),
        ...written.arguments.map(annotation),
      ]);
    case "TypeVariable":
      return node("other", written.span, [name(written.name)]);
    case "Tuple":
      return node("other", written.span, written.elements.map(annotation));
    case "Record":
      return node("other", written.span, [
        ...written.fields.map(typeField),
        written.tail === undefined ? undefined : name(written.tail),
      ]);
    case "Function":
      return node("other", written.span, [...written.parameters.map(annotation), annotation(written.result)]);
    case "Hole":
      return node("other", written.span, names(written.constraints));
    default: {
      const unreachable: never = written;
      return unreachable;
    }
  }
}

function pattern(written: Parsed.Pattern): SyntaxNode {
  switch (written.kind) {
    case "Binding":
      return node("other", written.span, [name(written.name)]);
    case "Wildcard":
    case "Unit":
    case "Integer":
    case "Dec":
    case "Float":
    case "String":
    case "Error":
      return node("other", written.span, []);
    case "TermSpelling":
      return node("other", written.span, [name(written.qualifier), name(written.name)]);
    case "As":
      return node("other", written.span, [pattern(written.pattern), name(written.name)]);
    case "Declared":
      return node("other", written.span, [...written.components.map(pattern), name(written.name)]);
    case "Or":
      return node("other", written.span, written.alternatives.map(pattern));
    case "Vector":
      return node("other", written.span, [
        ...written.elements.map(pattern),
        written.rest === undefined
          ? undefined
          : node("other", written.rest.span, [
            written.rest.pattern === undefined ? undefined : pattern(written.rest.pattern),
          ]),
      ]);
    case "Tuple":
      return node("other", written.span, written.elements.map(pattern));
    case "Record":
      return node(
        "other",
        written.span,
        // A punned field (`{ x }`) is its binding, written once.
        written.fields.map((field) =>
          sameText(field.name.span, field.pattern.span)
            ? pattern(field.pattern)
            : node("other", field.span, [name(field.name), pattern(field.pattern)])
        ),
      );
    case "Constructor":
      return node("other", written.span, [
        written.qualifier === undefined ? undefined : name(written.qualifier),
        name(written.name),
        ...written.arguments.map(pattern),
      ]);
    default: {
      const unreachable: never = written;
      return unreachable;
    }
  }
}

function arm(written: Parsed.MatchArm): SyntaxNode {
  return node("part", written.span, [
    pattern(written.pattern),
    written.guard === undefined ? undefined : expression(written.guard),
    expression(written.body),
  ]);
}

function expression(written: Parsed.Expr): SyntaxNode {
  const own = (children: readonly (SyntaxNode | undefined)[]): SyntaxNode =>
    node("expression", written.span, children, written);
  switch (written.kind) {
    case "Name":
      return own([name(written.name)]);
    case "Unit":
    case "Integer":
    case "BigInt":
    case "Dec":
    case "Float":
    case "ErrorExpr":
      return own([]);
    case "String":
      return own(
        written.parts.map((part) =>
          part.kind === "Text"
            ? node("part", part.span, [])
            : node("part", part.span, [expression(part.expression)])
        ),
      );
    case "Vector":
    case "Tuple":
      return own(written.elements.map(expression));
    case "Record":
      return own([
        written.spread === undefined ? undefined : expression(written.spread),
        // A punned field (`{ x }`) is its value, written once.
        ...written.fields.map((field) =>
          node("part", field.span, field.punned ? [expression(field.value)] : [name(field.name), expression(field.value)])
        ),
      ]);
    case "Group":
      return own([expression(written.expression)]);
    case "Ascription":
      return own([expression(written.expression), annotation(written.annotation)]);
    case "Block":
      return own(written.items.map(item));
    case "Lambda":
      return own(lambdaPieces(written));
    case "If":
      return own([expression(written.condition), expression(written.consequence), expression(written.alternative)]);
    case "While":
      return own([expression(written.condition), expression(written.body)]);
    case "For":
      return own([pattern(written.pattern), expression(written.iterable), expression(written.body)]);
    case "Match":
      return own([expression(written.scrutinee), ...written.arms.map(arm), ...(written.catchArms ?? []).map(arm)]);
    case "Try":
      return own([expression(written.body), ...written.arms.map(arm)]);
    case "Attempt":
    case "Assume":
      return own([expression(written.body)]);
    case "Call":
      return own([expression(written.callee), ...written.arguments.map(expression)]);
    case "PatternConstruction":
      return own([...written.components.map(expression), name(written.name)]);
    case "Access":
      return own([expression(written.receiver), name(written.field)]);
    case "Index":
      return own([expression(written.receiver), expression(written.index)]);
    case "Unary":
      return own([expression(written.operand)]);
    case "Binary":
      return own([expression(written.left), expression(written.right)]);
    case "Comparison":
      return own(written.operands.map(expression));
    case "Assignment":
      return own([expression(written.target), expression(written.value)]);
    default: {
      const unreachable: never = written;
      return unreachable;
    }
  }
}
