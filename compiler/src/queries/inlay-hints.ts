/**
 * Compiler-owned source query: inlay hints. The types inference gave the
 * places a dev could have written one, and a function's colour in words where
 * no place can hold it (LANGUAGE-SERVER-D3.md, ruled (a); Effects §10).
 *
 * **Every hint is a piece of a face.** A header has a place for every part of a
 * function's face but one: the binder list goes after the name (Functions
 * §4.2), each parameter's type after the parameter, the result after the
 * parameter list. The outer arrow has none, because a definition's colour is
 * inferred and never written (Functions §4.1, #355), so it is shown in the words
 * hover reads it in (§10's gloss), at the end of the header's line, and only
 * where it is not `->`: silence is the strong claim (§1). A binding's type has
 * a place for its arrows, so a function value bound by `let` shows its colour
 * in its type and takes no words.
 *
 * **One declaration, one set of letters** (`Typed.Letters`). A type variable
 * written anywhere in one declaration is one variable (Functions §4.1), so two
 * hints of one declaration that show one letter claim one type. Each hint is
 * therefore lettered from the declaration's whole display, the dev's own
 * spellings first, never on its own: shown alone, `second` in
 * `pairUp(first, second) = (first, second)` would read `a`, beside a `first`
 * that also reads `a`.
 *
 * **Shown, never written.** A hint carries no edit (plan point 3): a written
 * type binds, so writing one is checked by "add annotation", which compiles the
 * edit. A type with an error in it is not shown; the report is the information.
 *
 * Not hinted in v1: a lambda's result (rust-analyzer's default too), a
 * pattern's bindings outside a `let`, a lambda's pattern parameters, and a
 * lambda that is a binding's whole value, whose binding's type already shows
 * its parameters.
 */

import * as Parsed from "../syntax/parsed/index.js";
import * as Typed from "../syntax/typed/index.js";
import type * as Lexed from "../syntax/lexed/index.js";
import type * as Source from "../support/source.js";
import { isSyntheticParameterName } from "../support/synthetic.js";
import { syntaxTree, type SyntaxNode } from "./syntax-nodes.js";
import { forEachTypedExpression, forEachTypedItem } from "./typed-walk.js";

export interface InlayHint {
  /** The offset the hint is drawn at, before the text there. */
  readonly offset: number;
  readonly label: string;
  /**
   * `type`: a type, at a place one could be written. `colour`: a function's
   * colour in words, at the end of its header's line.
   */
  readonly kind: "type" | "colour";
  /**
   * For a colour: the function's face, whose arrow the words read, as hover's
   * first line writes it (`name: face`). Worded for a host by
   * `inlayHintTooltipMarkdown`.
   */
  readonly tooltip?: string;
}

export interface InlayHintInput {
  readonly parsed: Parsed.Module;
  readonly typed: Typed.Module;
  /** This module's file, lexed: where a header's `)` and `=` stand, and its text. */
  readonly lexed: Lexed.File;
}

/** Every hint in one module, in the order of the text. */
export function inlayHints(input: InlayHintInput): readonly InlayHint[] {
  const { parsed, typed, lexed } = input;
  const text = lexed.text;
  // The file is part of the key: a module's symbols include members it reached
  // in other files, whose offsets mean nothing here.
  const key = (span: Source.Span): string => `${span.fileId}:${span.start.offset}:${span.end.offset}`;

  const symbols = new Map<string, Typed.Symbol>();
  for (const symbol of typed.symbols) symbols.set(key(symbol.bindingSpan), symbol);
  const lambdas = new Map<string, Typed.LambdaExpr>();
  forEachTypedExpression(typed, (expression) => {
    if (expression.kind === "Lambda") lambdas.set(key(expression.span), expression);
  });
  const honors = new Map<string, Typed.HonorItem>();
  forEachTypedItem(typed, (item) => {
    if (item.kind === "Honor") honors.set(key(item.span), item);
  });
  const context = Typed.colourContextAt(typed);
  const expressions = expressionsOf(syntaxTree(parsed));

  // Which lambdas are a header's, and which a binding's whole value, by the
  // items that hold them anywhere in the module.
  const headers = new Map<Parsed.LambdaExpr, Header>();
  const bound = new Set<Parsed.LambdaExpr>();
  const classify = (item: Parsed.Item): void => {
    if (item.kind === "Fun") {
      headers.set(item.value, { name: item.name, lambda: item.value, binderPlace: item.block === undefined });
    } else if (item.kind === "Let" && item.value.kind === "Lambda" && isHeader(text, item.name, item.value)) {
      headers.set(item.value, { name: item.name, lambda: item.value, binderPlace: true });
    } else if (item.kind === "Let" || item.kind === "Var") {
      const value = Parsed.unwrapBindingValue(item.value);
      if (value.kind === "Lambda") bound.add(value);
    }
  };
  for (const item of parsed.items) classify(item);
  for (const expression of expressions) {
    if (expression.kind === "Block") for (const item of expression.items) classify(item);
  }

  const hints: InlayHint[] = [];
  /** An error displays as `?`: a type that holds one is not shown, since the report is the information. */
  const shows = (piece: string): boolean => !piece.includes("?");
  /** Type hints that stand or fall together: all of them, or none where one holds an error. */
  const pushTypes = (...pieces: readonly { readonly offset: number; readonly label: string }[]): void => {
    if (pieces.every(({ label }) => shows(label))) {
      for (const { offset, label } of pieces) hints.push({ offset, label, kind: "type" });
    }
  };

  for (const group of declarations(parsed.items)) {
    const letters = new Typed.Letters();
    const insides = group.map((item) =>
      expressions.filter(({ span }) =>
        span.start.offset >= item.span.start.offset && span.end.offset <= item.span.end.offset
      )
    );
    group.forEach((item, at) => learnItem(item, insides[at]!, letters));

    // Each item itself first, so its face is lettered before anything in its
    // body mints a letter; then what its body declares, in the order written.
    group.forEach((item, at) => {
      const sites: { readonly start: number; readonly visit: () => void }[] = [];
      const addItem = (each: Parsed.Item): void => {
        sites.push({ start: each.span.start.offset, visit: () => itemHints(each, letters) });
      };
      addItem(item);
      for (const expression of insides[at]!) {
        if (expression.kind === "Block") for (const local of expression.items) addItem(local);
        if (expression.kind === "Lambda" && !headers.has(expression) && !bound.has(expression)) {
          sites.push({ start: expression.span.start.offset, visit: () => lambdaHints(expression, letters) });
        }
      }
      sites.sort((left, right) => left.start - right.start);
      for (const site of sites) site.visit();
    });
  }
  return hints.sort((left, right) => left.offset - right.offset);

  /** Records the spellings an item writes, and which variable each names where that can be told. */
  function learnItem(item: Parsed.Item, inside: readonly Parsed.Expr[], letters: Typed.Letters): void {
    reserveWritten(item, letters);
    const learnBinding = (each: Parsed.Item): void => {
      if ((each.kind === "Let" || each.kind === "Var") && each.annotation !== undefined) {
        const symbol = symbols.get(key(each.name.span));
        if (symbol !== undefined) learn(each.annotation, symbol.scheme.type, letters);
      }
    };
    learnBinding(item);
    if (item.kind === "Honor") {
      const honor = honors.get(key(item.span));
      if (honor !== undefined) learn(item.subject, honor.subject, letters);
    }
    for (const expression of inside) {
      if (expression.kind === "Block") for (const local of expression.items) learnBinding(local);
      if (expression.kind !== "Lambda") continue;
      for (const parameter of expression.parameters) {
        if (parameter.annotation === undefined) continue;
        const symbol = symbols.get(key(parameter.name.span));
        if (symbol !== undefined) learn(parameter.annotation, symbol.scheme.type, letters);
      }
      const header = headers.get(expression);
      if (header !== undefined && expression.returnAnnotation !== undefined) {
        const face = symbols.get(key(header.name.span))?.scheme.type;
        if (face?.kind === "Function") learn(expression.returnAnnotation, face.result, letters);
      }
    }
  }

  function itemHints(item: Parsed.Item, letters: Typed.Letters): void {
    switch (item.kind) {
      case "Fun":
        headerHints(headers.get(item.value)!, letters);
        return;
      case "Let":
      case "Var": {
        const header = item.value.kind === "Lambda" ? headers.get(item.value) : undefined;
        if (header !== undefined) headerHints(header, letters);
        else bindingHints(item, letters);
        return;
      }
      case "LetPattern":
        forEachBinder(item.pattern, (name) => {
          const symbol = symbols.get(key(name.span));
          if (symbol === undefined) return;
          const shown = Typed.displayCallFace(symbol.scheme, context, letters);
          pushTypes({ offset: name.span.end.offset, label: `: ${shown.type}` });
        });
        return;
      default:
        return;
    }
  }

  /** A header-form function: its binder list, parameters, result and colour. */
  function headerHints(header: Header, letters: Typed.Letters): void {
    const { name, lambda } = header;
    const symbol = symbols.get(key(name.span));
    if (symbol === undefined) return;
    const face = Typed.displayCallFace(symbol.scheme, context, letters);
    if (header.binderPlace && lambda.typeParameters === undefined && face.binder !== "") {
      pushTypes({ offset: name.span.end.offset, label: face.binder });
    }
    parameterHints(lambda, face, false);
    // A header always ends at its `=`; nothing is drawn for one that somehow does not.
    const end = headerEnd(lambda);
    if (end === undefined) return;
    if (lambda.returnAnnotation === undefined && face.result !== undefined) {
      pushTypes({ offset: end.before.span.end.offset, label: `: ${face.type.slice(face.result[0], face.result[1])}` });
    }
    // The words read the face's arrow, so a face that holds an error shows none.
    const colour = face.owners[0];
    if (colour !== undefined && shows(face.type)) {
      hints.push({
        offset: lineEnd(end.equal.span.end.offset),
        label: colour,
        kind: "colour",
        tooltip: `${name.text}: ${face.type}`,
      });
    }
  }

  /**
   * A `let` or `var` with no written type: its type after its name, its binder
   * list before it where it has one.
   */
  function bindingHints(item: Parsed.LetItem | Parsed.VarItem, letters: Typed.Letters): void {
    if (item.annotation !== undefined) return;
    const symbol = symbols.get(key(item.name.span));
    if (symbol === undefined) return;
    const face = Typed.displayCallFace(symbol.scheme, context, letters);
    const type = face.binder === "" ? face.type : face.type.slice(face.binder.length + 1);
    // A binding takes one binder list (Functions §4.2). Where it writes one on
    // its name, the type goes after it, where `: type` would be written (#1047).
    const written = item.kind === "Let" ? item.typeParameters?.at(-1) : undefined;
    if (written !== undefined) {
      const closing = lexed.tokens.find(({ kind, span }) => kind === "Greater" && span.start.offset >= written.span.end.offset);
      if (closing !== undefined) pushTypes({ offset: closing.span.end.offset, label: `: ${type}` });
      return;
    }
    // Where its lambda writes one, that is the list, and the name takes none.
    const value = Parsed.unwrapBindingValue(item.value);
    const binder = value.kind === "Lambda" && value.typeParameters !== undefined ? "" : face.binder;
    pushTypes({ offset: item.name.span.end.offset, label: `${binder}: ${type}` });
  }

  /** A lambda written as a value: its parameters, read from its own type. */
  function lambdaHints(lambda: Parsed.LambdaExpr, letters: Typed.Letters): void {
    const checked = lambdas.get(key(lambda.span));
    if (checked === undefined) return;
    const face = Typed.displayCallFace({ variables: [], constraints: [], type: checked.type }, context, letters);
    parameterHints(lambda, face, isBare(lambda));
  }

  /** Whether a lambda's one parameter is written bare, `x => …`: the `=>` follows it straight away. */
  function isBare(lambda: Parsed.LambdaExpr): boolean {
    // With two or more, a `,` follows the first.
    const first = lambda.parameters[0];
    if (first === undefined) return false;
    const next = lexed.tokens.find(({ span }) => span.start.offset >= first.span.end.offset);
    return next?.kind === "FatArrow";
  }

  /**
   * Each parameter with no written type, its piece of the face after it. A
   * bare parameter, `x => …`, is shown in the parentheses a written type needs.
   */
  function parameterHints(
    lambda: Parsed.LambdaExpr,
    face: ReturnType<typeof Typed.displayCallFace>,
    bare: boolean,
  ): void {
    lambda.parameters.forEach((parameter, index) => {
      const range = face.parameters[index];
      if (parameter.annotation !== undefined || range === undefined) return;
      if (isSyntheticParameterName(parameter.name.text)) return;
      const piece = face.type.slice(range[0], range[1]);
      if (bare) {
        pushTypes(
          { offset: parameter.span.start.offset, label: "(" },
          { offset: parameter.name.span.end.offset, label: `: ${piece})` },
        );
      } else {
        pushTypes({ offset: parameter.name.span.end.offset, label: `: ${piece}` });
      }
    });
  }

  /**
   * A header's `=`, and the token before it: the `)` a result type is written
   * after where none is. A header writes one `=`, between its parameters and
   * its body, and the `(` comes before it.
   */
  function headerEnd(lambda: Parsed.LambdaExpr): { readonly equal: Lexed.Token; readonly before: Lexed.Token } | undefined {
    const from = lambda.span.start.offset;
    const to = lambda.body.span.start.offset;
    const window = lexed.tokens.filter(({ span }) => span.start.offset >= from && span.end.offset <= to);
    const at = window.findIndex(({ kind }) => kind === "Equal");
    return at < 1 ? undefined : { equal: window[at]!, before: window[at - 1]! };
  }

  function lineEnd(offset: number): number {
    const newline = text.indexOf("\n", offset);
    const end = newline === -1 ? text.length : newline;
    return text[end - 1] === "\r" ? end - 1 : end;
  }
}

/**
 * The module's declarations, each the items that letter as one: an item on its
 * own, or a `fun` block's members together. A block's members are checked as
 * one knot at shared types (Functions §7.4), so one variable can stand in two
 * members' faces, and it must read as one letter in both.
 */
function declarations(items: readonly Parsed.Item[]): readonly (readonly Parsed.Item[])[] {
  const groups: Parsed.Item[][] = [];
  const blocks = new Map<number, Parsed.Item[]>();
  for (const item of items) {
    if (item.kind === "Fun" && item.block !== undefined) {
      const known = blocks.get(item.block.id);
      if (known !== undefined) {
        known.push(item);
        continue;
      }
      const group = [item];
      blocks.set(item.block.id, group);
      groups.push(group);
      continue;
    }
    groups.push([item]);
  }
  return groups;
}

/** A header-form function: `let f(x) = …`, `fun f(x) = …`, or the same with a binder list after the name. */
interface Header {
  readonly name: Parsed.Name;
  readonly lambda: Parsed.LambdaExpr;
  /** Whether a binder list may stand after the name: not on a `fun` block's member (Functions §7.3). */
  readonly binderPlace: boolean;
}

/** Whether a `let`'s lambda is its header, written straight after the name, rather than a value after `=`. */
function isHeader(text: string, name: Parsed.Name, lambda: Parsed.LambdaExpr): boolean {
  return /^\s*(<[^=]*>)?\s*$/.test(text.slice(name.span.end.offset, lambda.span.start.offset));
}

/** Every parsed expression, in the order of the text. */
function expressionsOf(root: SyntaxNode): readonly Parsed.Expr[] {
  const found: Parsed.Expr[] = [];
  const visit = (node: SyntaxNode): void => {
    if (node.expression !== undefined) found.push(node.expression);
    for (const child of node.children) visit(child);
  };
  visit(root);
  return found;
}

/** Every name a pattern binds. */
function forEachBinder(pattern: Parsed.Pattern, visit: (name: Parsed.Name) => void): void {
  walkData(pattern, (node) => {
    if (node.kind === "Binding") visit((node as unknown as Parsed.BindingPattern).name);
  });
}

/**
 * Reserves every type variable and binder name an item writes, wherever in it:
 * a letter minted for a hint must not be one the dev already gave something
 * else in the same declaration.
 */
function reserveWritten(item: Parsed.Item, letters: Typed.Letters): void {
  walkData(item, (node) => {
    if (node.kind === "TypeVariable") letters.reserve((node as unknown as Parsed.TypeVariable).name.text);
  });
  walkData(item, (node) => {
    const parameters = (node as { typeParameters?: unknown }).typeParameters;
    if (!Array.isArray(parameters)) return;
    for (const parameter of parameters as readonly Parsed.TypeParameter[]) letters.reserve(parameter.name.text);
  });
}

/**
 * Pairs a written annotation with the type inferred for it, recording each
 * variable the two agree on. Shapes that do not match are not paired, and
 * neither is a type an alias may stand for: a wrong pairing is worse than a
 * missing one, and every written spelling is reserved anyway.
 */
function learn(annotation: Parsed.TypeAnnotation, type: Typed.Type, letters: Typed.Letters): void {
  switch (annotation.kind) {
    case "TypeVariable":
      if (type.kind === "Variable") letters.bind(type.id, annotation.name.text);
      return;
    case "Tuple":
      if (type.kind === "Tuple") learnEach(annotation.elements, type.elements, letters);
      return;
    case "Function":
      if (type.kind === "Function") {
        learnEach(annotation.parameters, type.parameters, letters);
        learn(annotation.result, type.result, letters);
      }
      return;
    case "Record":
      if (type.kind !== "Record") return;
      for (const field of annotation.fields) {
        const inferred = type.fields.find(({ name }) => name === field.name.text);
        if (inferred !== undefined) learn(field.annotation, inferred.type, letters);
      }
      if (annotation.tail !== undefined && type.tail !== undefined) letters.bind(type.tail, annotation.tail.text);
      return;
    case "AppliedType": {
      // Only the type the constructor names: through an alias, the arguments
      // need not stand in the order written (`type Flip(a, b) = Map(b, a)`).
      const named = argumentsOf(type);
      if (named?.constructor === annotation.constructor.text) learnEach(annotation.arguments, named.arguments, letters);
      return;
    }
    default:
      return;
  }
}

/** Pairs written pieces with inferred ones, in order, where there are as many of each. */
function learnEach(
  written: readonly Parsed.TypeAnnotation[],
  inferred: readonly Typed.Type[],
  letters: Typed.Letters,
): void {
  if (written.length !== inferred.length) return;
  written.forEach((piece, at) => learn(piece, inferred[at]!, letters));
}

/** An applied type's constructor, as a source names it, and its arguments. */
function argumentsOf(type: Typed.Type): { readonly constructor: string; readonly arguments: readonly Typed.Type[] } | undefined {
  switch (type.kind) {
    case "Vector":
    case "Set":
    case "Array":
    case "JsSet":
    case "Node":
      return { constructor: type.kind, arguments: [type.element] };
    case "Map":
    case "JsMap":
      return { constructor: type.kind, arguments: [type.key, type.value] };
    case "Nullable":
      return { constructor: type.kind, arguments: [type.value] };
    case "Union":
    case "NominalRecord":
    case "ExternType":
      return { constructor: type.name, arguments: type.arguments };
    default:
      return undefined;
  }
}

/**
 * Every node with a `kind` in a piece of the parsed tree, for the two questions
 * above that ask about every node of one shape whatever holds it: the spellings
 * an item writes, and the names a pattern binds.
 */
function walkData(value: unknown, visit: (node: { readonly kind: string }) => void, seen = new Set<unknown>()): void {
  if (value === null || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const each of value) walkData(each, visit, seen);
    return;
  }
  const node = value as Record<string, unknown>;
  if (typeof node.kind === "string") visit(node as { readonly kind: string });
  for (const [field, child] of Object.entries(node)) {
    if (field === "span") continue;
    walkData(child, visit, seen);
  }
}
