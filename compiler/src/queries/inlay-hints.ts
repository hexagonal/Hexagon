/**
 * Compiler-owned source query: inlay hints. The types inference gave the
 * places a dev could have written one, and a function's colour in words where
 * no place can hold it (LANGUAGE-SERVER-D3.md, ruled (a); Effects §10).
 *
 * **Every hint is a piece of a face.** A header has a place for every part of a
 * function's face but one: the binder list goes after the name (Functions
 * §4.2), or on the head of the `fun` block it is a member of (§7.3), each
 * parameter's type after the parameter, the result after the parameter list.
 * The outer arrow has none, because a definition's colour is inferred and never
 * written (Functions §4.1, #355), so it is shown in the words hover reads it in
 * (§10's gloss), at the end of the header's line, and only where it is not
 * `->`: silence is the strong claim (§1). A binding's type has a place for its
 * arrows, so a function value bound by `let` shows its colour in its type and
 * takes no words. Each hint's tooltip is the whole face it is a piece of.
 *
 * **One declaration, one set of letters** (`Typed.Letters`). A type variable
 * written anywhere in one declaration is one variable (Functions §4.1), so two
 * hints of one declaration that show one letter claim one type. Each hint is
 * therefore lettered from the declaration's whole display, the dev's own
 * spellings first, from every annotation position, never on its own: shown alone, `second` in
 * `pairUp(first, second) = (first, second)` would read `a`, beside a `first`
 * that also reads `a`.
 *
 * **Shown, never written.** A hint carries no edit (plan point 3): a written
 * type binds, so writing one is "Write down the inferred type"
 * (`queries/written-types.ts`), which compiles the edit, and which reads the
 * places from here (`typePieces`). A type with an error in it is not shown, nor
 * a colour in error; the report is the information. A `let` pattern's variable
 * is shown though no type can be written there (Pattern Matching §2.4).
 *
 * Not hinted in v1: a lambda's result (rust-analyzer's default too), a
 * pattern's bindings outside a `let`, a lambda's pattern parameters, a record
 * field's pun, and a lambda that is a binding's whole value, whose binding's
 * type already shows its parameters.
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
   * `type`: a piece of a face, at a place one could be written. `colour`: a
   * function's colour in words, at the end of its header's line. `regexGroup`:
   * a capturing group's number, at its `(` in a literal handed to
   * `Regex.compile` (`queries/regex-groups.ts`).
   */
  readonly kind: "type" | "colour" | "regexGroup";
  /**
   * The whole face of the declaration the hint is a piece of, as hover's first
   * line writes it (`name: face`), lettered as the hints are: one line for each
   * face, so a `fun` block's head shows each member's. A lambda has no name, so
   * its face is its type alone. A group's number has the group's hover, already
   * Markdown. Worded for a host by `inlayHintTooltipMarkdown`.
   */
  readonly tooltip: string;
}

export interface InlayHintInput {
  readonly parsed: Parsed.Module;
  readonly typed: Typed.Module;
  /** This module's file, lexed: where a header's `)` and `=` stand, and its text. */
  readonly lexed: Lexed.File;
  /**
   * The offsets the host shows, ends included: only the hints there are
   * answered. A declaration that reaches none of them is not read; one that
   * does is read whole, since its hints are lettered together.
   */
  readonly range?: { readonly start: number; readonly end: number };
}

/**
 * What a place a type could be written is: a parameter, a `let` or `var`, a
 * `let` pattern's variable, a header's result, or a binder list.
 */
export type PieceRole = "parameter" | "binding" | "pattern" | "result" | "binder";

/** What a place's pieces have in common, written or not. */
interface Place {
  readonly role: PieceRole;
  /**
   * What the place is named by: the parameter, binding or variable; the
   * header or binding, for a result or binder list. A `fun` block's head has
   * none.
   */
  readonly name?: string;
  /** The names whose own types it is a piece of: its own, or its header's or binding's, or each member's of a block. */
  readonly places: readonly Source.Span[];
  /** The name of the header whose face it is a piece of, where it is one. */
  readonly header?: Source.Span;
  /** Whether that header or binding, or a member of that block, is exported. */
  readonly exported: boolean;
}

/**
 * A type hint's piece of a face, with what writing it down needs
 * (`queries/written-types.ts`): a hint is shown, never written, and "Write down
 * the inferred type" is how it is written (plan point 3).
 */
export interface TypePiece extends Place {
  /** Its text where it goes: one insert, or a bare parameter's `(` and `: type)`. */
  readonly inserts: readonly { readonly offset: number; readonly label: string }[];
  readonly tooltip: string;
  /**
   * Where it is asked for: a parameter's, a binding's or a pattern variable's
   * name; for a result, from the `)` it goes after to the `=` it goes
   * before; for a binder list, the name or `fun` keyword it goes after.
   */
  readonly anchor: Source.Span;
  /**
   * The type it shows, the face's scheme it is read from, and what stands
   * around its text in the last insert's label. A binder list has none.
   */
  readonly shown?: {
    readonly type: Typed.Type;
    readonly scheme: Typed.Scheme;
    readonly text: string;
    readonly before: string;
    readonly after: string;
  };
  /** The declaration's letters, every variable it shows lettered. */
  readonly letters: Typed.Letters;
  /** Whether what it shows holds an error, in which case it is never drawn. */
  readonly error: boolean;
}

/**
 * A type written where a hint would otherwise stand, with what removing it
 * needs (`queries/written-types.ts`): the reverse of a `TypePiece`.
 */
export interface WrittenPiece extends Place {
  /**
   * Where it is asked for: the `: type` and the name it follows; for a result,
   * from the `)` to the `=`; for a binder list, the list and the name or
   * keyword it follows.
   */
  readonly anchors: readonly Source.Span[];
  /** What removing it takes out: the `: type` and the space before it, or the binder list. */
  readonly removed: Source.Span;
}

/** Every hint in one module, or in its range, in the order of the text. */
export function inlayHints(input: InlayHintInput): readonly InlayHint[] {
  const hints: InlayHint[] = [];
  // In the order they were found, which orders two at one offset.
  for (const found of collect(input)) {
    if ("removed" in found) continue;
    if (!("inserts" in found)) hints.push(found);
    else if (!found.error) {
      for (const { offset, label } of found.inserts) hints.push({ offset, label, kind: "type", tooltip: found.tooltip });
    }
  }
  const { range } = input;
  return hints
    .filter(({ offset }) => range === undefined || (offset >= range.start && offset <= range.end))
    .sort((left, right) => left.offset - right.offset);
}

/**
 * Every place in the declarations a range reaches, or in the whole module, a
 * type could have been written: those where none was, with the inferred type
 * for it, the inlay hints' type pieces, those whose type holds an error
 * included; and those where one was.
 */
export function typePieces(input: InlayHintInput): {
  readonly unwritten: readonly TypePiece[];
  readonly written: readonly WrittenPiece[];
} {
  const found = collect(input);
  return {
    unwritten: found.filter((each): each is TypePiece => "inserts" in each),
    written: found.filter((each): each is WrittenPiece => "removed" in each),
  };
}

/** Every piece, written or not, and colour in the declarations the range reaches, in the order found. */
function collect(input: InlayHintInput): readonly (TypePiece | WrittenPiece | InlayHint)[] {
  const { parsed, typed, lexed, range } = input;
  const { text, tokens } = lexed;
  // The file is part of the key: a module's symbols include members it reached
  // in other files, whose offsets mean nothing here.
  const key = (span: Source.Span): string => `${span.fileId}:${span.start.offset}:${span.end.offset}`;

  const symbols = new Map<string, Typed.Symbol>();
  for (const symbol of typed.symbols) symbols.set(key(symbol.bindingSpan), symbol);
  const lambdas = new Map<string, Typed.LambdaExpr>();
  const ascriptions = new Map<string, Typed.Type>();
  forEachTypedExpression(typed, (expression) => {
    if (expression.kind === "Lambda") lambdas.set(key(expression.span), expression);
    if (expression.kind === "Ascription") ascriptions.set(key(expression.span), expression.type);
  });
  const honors = new Map<string, Typed.HonorItem>();
  forEachTypedItem(typed, (item) => {
    if (item.kind === "Honor") honors.set(key(item.span), item);
  });
  const context = Typed.colourContextAt(typed);
  // In the order of the text, so the expressions inside one item are one run of them.
  const expressions = expressionsOf(syntaxTree(parsed));

  // Which lambdas are a header's, and which a binding's whole value, by the
  // items that hold them anywhere in the module.
  const headers = new Map<Parsed.LambdaExpr, Header>();
  const bound = new Set<Parsed.LambdaExpr>();
  const classify = (item: Parsed.Item): void => {
    if (item.kind === "Fun") {
      headers.set(item.value, {
        name: item.name,
        lambda: item.value,
        binder: item.block === undefined ? "name" : "head",
        end: item.span.end.offset,
        exported: item.exported,
        ...(item.block === undefined ? {} : { block: item.block }),
      });
    } else if (item.kind === "Let" && item.value.kind === "Lambda" && isHeader(item.name, item.value)) {
      headers.set(item.value, { name: item.name, lambda: item.value, binder: "name", end: item.span.end.offset, exported: item.exported });
    } else if (item.kind === "Let" || item.kind === "Var") {
      const value = Parsed.unwrapBindingValue(item.value);
      if (value.kind === "Lambda") bound.add(value);
    } else if (item.kind === "Honor") {
      for (const member of item.members) {
        if (member.value === undefined) continue;
        headers.set(member.value, { name: member.name, lambda: member.value, binder: "instance", end: member.span.end.offset, exported: false });
      }
    }
  };
  for (const item of parsed.items) classify(item);
  for (const expression of expressions) {
    if (expression.kind === "Block") for (const item of expression.items) classify(item);
  }

  const found: (TypePiece | WrittenPiece | InlayHint)[] = [];
  /**
   * One piece of a face: its inserts stand or fall together, all of them
   * drawn, or none where the type they show holds an error.
   */
  const pushTypes = (piece: Omit<TypePiece, "error">): void => {
    found.push({ ...piece, error: piece.shown !== undefined && holdsError(piece.shown.type) });
  };
  /**
   * A written type's `: type`, and what removing it takes out: from the end of
   * the token before its `:`, so the space before goes with it. A written type
   * always follows its `:`.
   */
  const colonOf = (written: Source.Span): { readonly colon: Source.Span; readonly removed: Source.Span } | undefined => {
    const at = firstStartingAt(tokens, written.start.offset);
    const colon = tokens[at - 1];
    const before = tokens[at - 2];
    if (colon === undefined || before === undefined) return undefined;
    return { colon: { ...written, start: colon.span.start }, removed: { ...written, start: before.span.end } };
  };
  /** A type written at a parameter or binding: asked for on its name or its `: type`. */
  const pushWritten = (piece: Omit<WrittenPiece, "removed" | "anchors">, name: Source.Span, written: Source.Span): void => {
    const typed = colonOf(written);
    if (typed !== undefined) found.push({ ...piece, anchors: [name, typed.colon], removed: typed.removed });
  };
  /** Where a piece belongs: what names it, the names whose types it is part of, its header, and whether it is exported. */
  type Owner = Omit<Place, "role">;

  for (const group of declarations(parsed.items)) {
    const head = group[0]!.kind === "Fun" ? group[0]!.block : undefined;
    const first = Math.min(head?.span.start.offset ?? Infinity, ...group.map(({ span }) => span.start.offset));
    const last = lineEnd(Math.max(...group.map(({ span }) => span.end.offset)));
    if (range !== undefined && (last < range.start || first > range.end)) continue;

    const letters = new Typed.Letters();
    const insides = group.map(({ span }) => inside(span));
    group.forEach((item, at) => learnItem(item, insides[at]!, letters));

    // Each item itself first, so its face is lettered before anything in its
    // body mints a letter; then what its body declares, in the order written.
    // Each `fun` block met, the module's or one in a body, keeps its own
    // members for its own head.
    const blocks: Blocks = new Map();
    group.forEach((item, at) => {
      const sites: { readonly start: number; readonly visit: () => void }[] = [];
      const addItem = (each: Parsed.Item): void => {
        sites.push({ start: each.span.start.offset, visit: () => itemHints(each, letters, blocks) });
        if (each.kind !== "Honor") return;
        for (const member of each.members) {
          const header = member.value === undefined ? undefined : headers.get(member.value);
          if (header !== undefined) sites.push({ start: member.span.start.offset, visit: () => headerHints(header, letters, blocks) });
        }
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
    for (const { head, members } of blocks.values()) headHints(head, members, letters);
  }
  return found;

  /**
   * The expressions inside a module item's span: those that start in it, since
   * module items do not overlap and an item's expressions are all its own.
   */
  function inside(span: Source.Span): readonly Parsed.Expr[] {
    const found: Parsed.Expr[] = [];
    for (let at = firstStartingAt(expressions, span.start.offset); at < expressions.length; at += 1) {
      const expression = expressions[at]!;
      if (expression.span.start.offset >= span.end.offset) break;
      found.push(expression);
    }
    return found;
  }

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
      if (expression.kind === "Ascription") {
        const type = ascriptions.get(key(expression.span));
        if (type !== undefined) learn(expression.annotation, type, letters);
      }
      if (expression.kind !== "Lambda") continue;
      for (const parameter of expression.parameters) {
        if (parameter.annotation === undefined) continue;
        const symbol = symbols.get(key(parameter.name.span));
        if (symbol !== undefined) learn(parameter.annotation, symbol.scheme.type, letters);
      }
      if (expression.returnAnnotation === undefined) continue;
      // A header's result is its face's; any other lambda's is its own type's.
      // (An instance's member writes none: the parser takes none there, #1484.)
      const header = headers.get(expression);
      const face = header === undefined
        ? lambdas.get(key(expression.span))?.type
        : symbols.get(key(header.name.span))?.scheme.type;
      if (face?.kind === "Function") learn(expression.returnAnnotation, face.result, letters);
    }
  }

  function itemHints(item: Parsed.Item, letters: Typed.Letters, blocks: Blocks): void {
    switch (item.kind) {
      case "Fun":
        headerHints(headers.get(item.value)!, letters, blocks);
        return;
      case "Let":
      case "Var": {
        const header = item.value.kind === "Lambda" ? headers.get(item.value) : undefined;
        if (header !== undefined) headerHints(header, letters, blocks);
        else bindingHints(item, letters);
        return;
      }
      case "LetPattern":
        forEachBinder(item.pattern, (name) => {
          const symbol = symbols.get(key(name.span));
          if (symbol === undefined) return;
          const shown = Typed.displayCallFace(symbol.scheme, context, letters);
          pushTypes({
            inserts: [{ offset: name.span.end.offset, label: `: ${shown.type}` }],
            tooltip: `${name.text}: ${shown.type}`,
            role: "pattern",
            anchor: name.span,
            name: name.text,
            places: [name.span],
            exported: item.exported,
            letters,
            shown: { type: symbol.scheme.type, scheme: symbol.scheme, text: shown.type, before: ": ", after: "" },
          });
        });
        return;
      default:
        return;
    }
  }

  /**
   * A header-form function: its binder list, parameters, result and colour. A
   * `fun` block's member gives its binder list to the block's head, which
   * `headHints` draws once every member is lettered.
   */
  function headerHints(header: Header, letters: Typed.Letters, blocks: Blocks): void {
    const { name, lambda } = header;
    // An instance member's face is its lambda's type at the instance, whose
    // callbacks' colours are its own, as a header's are.
    const scheme = header.binder === "instance"
      ? instanceScheme(lambdas.get(key(lambda.span))?.type)
      : symbols.get(key(name.span))?.scheme;
    if (scheme === undefined) return;
    const face = Typed.displayCallFace(scheme, context, letters);
    const tooltip = `${name.text}: ${face.type}`;
    const owner: Owner = { name: name.text, places: [name.span], header: name.span, exported: header.exported };
    if (header.binder === "name") entryHints(face.binderEntries, lambda.typeParameters, name.span, tooltip, owner, letters);
    if (header.block !== undefined) {
      const block = blocks.get(header.block.id) ?? { head: header.block, members: [] };
      block.members.push({ face, tooltip, writes: spellingsIn(lambda), exported: header.exported, name: name.span });
      blocks.set(header.block.id, block);
    }
    parameterHints(lambda, face, scheme, false, tooltip, owner, letters);
    // A header always ends at its `=`; nothing is drawn for one that somehow does not.
    const end = headerEnd(lambda);
    if (end === undefined || scheme.type.kind !== "Function") return;
    // Its place: from the `)` it is written after to the `=` it is written before.
    const place = { fileId: name.span.fileId, start: end.before.span.end, end: end.equal.span.end };
    if (lambda.returnAnnotation !== undefined) {
      // Asked for from the `)` to the `=`, as an unwritten one is.
      const written = colonOf(lambda.returnAnnotation.span);
      if (written !== undefined) {
        found.push({ role: "result", ...owner, anchors: [{ ...place, start: written.removed.start }], removed: written.removed });
      }
    } else if (face.result !== undefined && header.binder !== "instance") {
      const text = face.type.slice(face.result[0], face.result[1]);
      pushTypes({
        inserts: [{ offset: end.before.span.end.offset, label: `: ${text}` }],
        tooltip,
        role: "result",
        anchor: place,
        ...owner,
        letters,
        shown: { type: scheme.type.result, scheme, text, before: ": ", after: "" },
      });
    }
    // The words read the face's arrow, so a face that holds an error, its
    // arrow's own colours included, shows none.
    const colour = face.owners[0];
    if (colour !== undefined && !holdsError(scheme.type)) {
      found.push({ offset: colourOffset(end.before, header.end), label: colour, kind: "colour", tooltip });
    }
  }

  /**
   * A `fun` block's binder list, on its head, where §4.2 writes it (Functions
   * §7.3): the members' lists as one, since their letters are one set. A
   * variable the head declares is every member's that writes its spelling, so
   * an entry whose spelling another member of the block writes for its own
   * would tie the two there: it has no place, and is left out.
   */
  function headHints(head: Parsed.FunBlockHead, members: readonly Member[], letters: Typed.Letters): void {
    const entries = new Map<string, Typed.BinderEntry>();
    members.forEach(({ face }, at) => {
      for (const entry of face.binderEntries) {
        if (members.some(({ writes }, other) => other !== at && writes.has(entry.subject))) continue;
        entries.set(entry.subject, entry);
      }
    });
    const tooltip = members.map(({ tooltip }) => tooltip).join("\n");
    const keyword = tokens[firstStartingAt(tokens, head.span.start.offset)];
    if (keyword === undefined) return;
    entryHints([...entries.values()], head.typeParameters, keyword.span, tooltip, {
      places: members.map(({ name }) => name),
      exported: members.some(({ exported }) => exported),
    }, letters);
  }

  /**
   * Binder entries at their place: a whole list at `place` where none is
   * written, and where one is, the entries it does not write before its `>`,
   * since a declaration takes one list (Functions §4.2). An entry's subject is
   * one of its face's variables, so it holds no error of its own. `after` is
   * the name or keyword the list goes after, which is where it is asked for.
   */
  function entryHints(
    entries: readonly Typed.BinderEntry[],
    written: readonly Parsed.TypeParameter[] | undefined,
    after: Source.Span,
    tooltip: string,
    owner: Owner,
    letters: Typed.Letters,
  ): void {
    if (written === undefined) {
      if (entries.length === 0) return;
      pushTypes({
        inserts: [{ offset: after.end.offset, label: `<${entries.map(({ text }) => text).join(", ")}>` }],
        tooltip,
        role: "binder",
        anchor: after,
        ...owner,
        letters,
      });
      return;
    }
    const missing = entries.filter(({ subject }) => !written.some(({ name }) => name.text === subject));
    const closing = closingOf(written);
    const opening = openingOf(written);
    if (closing !== undefined && opening !== undefined) {
      const list = { fileId: after.fileId, start: opening.span.start, end: closing.span.end };
      found.push({ role: "binder", ...owner, anchors: [after, list], removed: { ...list, start: after.end } });
    }
    if (missing.length > 0 && closing !== undefined) {
      pushTypes({
        inserts: [{ offset: closing.span.start.offset, label: `, ${missing.map(({ text }) => text).join(", ")}` }],
        tooltip,
        role: "binder",
        anchor: after,
        ...owner,
        letters,
      });
    }
  }

  /**
   * A `let` or `var` with no written type: its type after its name, its binder
   * list before it where it has one.
   */
  function bindingHints(item: Parsed.LetItem | Parsed.VarItem, letters: Typed.Letters): void {
    const owner: Owner = { name: item.name.text, places: [item.name.span], exported: item.kind === "Let" && item.exported };
    if (item.annotation !== undefined) {
      pushWritten({ role: "binding", ...owner }, item.name.span, item.annotation.span);
      // Its binder list, written: there is nothing to show, but it can be removed.
      if (item.kind === "Let" && item.typeParameters !== undefined) entryHints([], item.typeParameters, item.name.span, "", owner, letters);
      return;
    }
    const symbol = symbols.get(key(item.name.span));
    if (symbol === undefined) return;
    const face = Typed.displayCallFace(symbol.scheme, context, letters);
    const type = face.binder === "" ? face.type : face.type.slice(face.binder.length + 1);
    const tooltip = `${item.name.text}: ${face.type}`;
    const typed = (offset: number, before: string): void => {
      pushTypes({
        inserts: [{ offset, label: `${before}${type}` }],
        tooltip,
        role: "binding",
        anchor: item.name.span,
        ...owner,
        letters,
        shown: { type: symbol.scheme.type, scheme: symbol.scheme, text: type, before, after: "" },
      });
    };
    // A binding takes one binder list (Functions §4.2). Where it writes one on
    // its name, the type goes after it, where `: type` would be written (#1047).
    const written = item.kind === "Let" ? item.typeParameters : undefined;
    const closing = written === undefined ? undefined : closingOf(written);
    if (written !== undefined) {
      entryHints(face.binderEntries, written, item.name.span, tooltip, owner, letters);
      if (closing !== undefined) typed(closing.span.end.offset, ": ");
      return;
    }
    // Where its lambda writes one, that is the list, and the name takes none.
    const value = Parsed.unwrapBindingValue(item.value);
    if (value.kind === "Lambda" && value.typeParameters !== undefined) {
      entryHints(face.binderEntries, value.typeParameters, item.name.span, tooltip, owner, letters);
      typed(item.name.span.end.offset, ": ");
      return;
    }
    typed(item.name.span.end.offset, `${face.binder}: `);
  }

  /** A lambda written as a value: its parameters, read from its own type. */
  function lambdaHints(lambda: Parsed.LambdaExpr, letters: Typed.Letters): void {
    const scheme = schemeOf(lambdas.get(key(lambda.span))?.type);
    if (scheme === undefined) return;
    const face = Typed.displayCallFace(scheme, context, letters);
    parameterHints(lambda, face, scheme, isBare(lambda), face.type, { places: [], exported: false }, letters);
  }

  /** Whether a lambda's one parameter is written bare, `x => …`: the `=>` follows it straight away. */
  function isBare(lambda: Parsed.LambdaExpr): boolean {
    // With two or more, a `,` follows the first.
    const first = lambda.parameters[0];
    if (first === undefined) return false;
    return tokens[firstStartingAt(tokens, first.span.end.offset)]?.kind === "FatArrow";
  }

  /**
   * Each parameter with no written type, its piece of the face after it. A
   * bare parameter, `x => …`, is shown in the parentheses a written type needs.
   */
  function parameterHints(
    lambda: Parsed.LambdaExpr,
    face: Face,
    scheme: Typed.Scheme,
    bare: boolean,
    tooltip: string,
    owner: Owner,
    letters: Typed.Letters,
  ): void {
    const { type } = scheme;
    if (type.kind !== "Function") return;
    lambda.parameters.forEach((parameter, index) => {
      const range = face.parameters[index];
      const shown = type.parameters[index];
      if (isSyntheticParameterName(parameter.name.text)) return;
      // Its own name, and its header's, whose face it is a piece of.
      const own = { ...owner, name: parameter.name.text, places: [parameter.name.span, ...owner.places] };
      if (parameter.annotation !== undefined) {
        pushWritten({ role: "parameter", ...own }, parameter.name.span, parameter.annotation.span);
        return;
      }
      if (range === undefined || shown === undefined) return;
      const text = face.type.slice(range[0], range[1]);
      const end = { offset: parameter.name.span.end.offset, label: `: ${text}${bare ? ")" : ""}` };
      pushTypes({
        inserts: bare ? [{ offset: parameter.span.start.offset, label: "(" }, end] : [end],
        tooltip,
        role: "parameter",
        anchor: parameter.name.span,
        ...own,
        letters,
        shown: { type: shown, scheme, text, before: ": ", after: bare ? ")" : "" },
      });
    });
  }

  /**
   * Whether a `let`'s lambda is its header, written straight after the name,
   * rather than a value after `=`: no `=` stands between the two.
   */
  function isHeader(name: Parsed.Name, lambda: Parsed.LambdaExpr): boolean {
    for (let at = firstStartingAt(tokens, name.span.end.offset); at < tokens.length; at += 1) {
      const token = tokens[at]!;
      if (token.span.start.offset >= lambda.span.start.offset) return true;
      if (token.kind === "Equal") return false;
    }
    return true;
  }

  /**
   * A header's `=`, and the token before it: the `)` a result type is written
   * after where none is. A header writes one `=`, between its parameters and
   * its body; one the parser recovered without its `=` has none, and the next
   * `=` belongs to something else.
   */
  function headerEnd(lambda: Parsed.LambdaExpr): { readonly equal: Lexed.Token; readonly before: Lexed.Token } | undefined {
    const from = firstStartingAt(tokens, lambda.span.start.offset);
    for (let at = from; at < tokens.length; at += 1) {
      const token = tokens[at]!;
      if (token.span.end.offset > lambda.body.span.start.offset) return undefined;
      // Never the first: a header's lambda starts at its `(` or `<`.
      if (token.kind === "Equal") return { equal: token, before: tokens[at - 1]! };
    }
    return undefined;
  }

  /**
   * A written binder list's closing `>`: the first after its last entry, since
   * a constraint list holds none (`<a: (Num, Show)>`).
   */
  function closingOf(written: readonly Parsed.TypeParameter[]): Lexed.Token | undefined {
    const last = written.at(-1);
    if (last === undefined) return undefined;
    for (let at = firstStartingAt(tokens, last.span.end.offset); at < tokens.length; at += 1) {
      if (tokens[at]!.kind === "Greater") return tokens[at];
    }
    return undefined;
  }

  /** A written binder list's opening `<`: the token before its first entry. */
  function openingOf(written: readonly Parsed.TypeParameter[]): Lexed.Token | undefined {
    const first = written[0];
    return first === undefined ? undefined : tokens[firstStartingAt(tokens, first.span.start.offset) - 1];
  }

  /**
   * Where a colour's words go: the end of the line its header ends on. On a
   * one-line function that more code follows on its line, that would set the
   * words after the next one, so they go at its own end instead.
   */
  function colourOffset(before: Lexed.Token, end: number): number {
    const stop = lineEnd(before.span.end.offset);
    const next = tokens[firstStartingAt(tokens, end)];
    return next !== undefined && next.span.start.offset < stop ? end : stop;
  }

  function lineEnd(offset: number): number {
    const newline = text.indexOf("\n", offset);
    const end = newline === -1 ? text.length : newline;
    return text[end - 1] === "\r" ? end - 1 : end;
  }
}

type Face = ReturnType<typeof Typed.displayCallFace>;

/** A `fun` block member, as its head's binder list needs it: its face, and the spellings it writes. */
interface Member {
  readonly face: Face;
  readonly tooltip: string;
  readonly writes: ReadonlySet<string>;
  readonly exported: boolean;
  readonly name: Source.Span;
}

/** The `fun` blocks met in one declaration, by id: each one's head and members. */
type Blocks = Map<number, { readonly head: Parsed.FunBlockHead; readonly members: Member[] }>;

/** A type as a scheme of its own: its variables are the enclosing declaration's. */
function schemeOf(type: Typed.Type | undefined): Typed.Scheme | undefined {
  return type === undefined ? undefined : { variables: [], constraints: [], type };
}

/**
 * An instance member's type as its scheme: its type variables are the honor
 * head's, but its callbacks' colours are its own, so the gloss names them by
 * the member's parameters rather than as an enclosing function's.
 */
function instanceScheme(type: Typed.Type | undefined): Typed.Scheme | undefined {
  if (type === undefined) return undefined;
  const colours = new Set<Typed.TypeVariableId>();
  // Each callback's colour stands alone on its parameter's arrow; a join is
  // made of those.
  walkData(type, (node) => {
    if (node.kind !== "Function") return;
    for (const colour of [(node as Typed.FunctionType).effect, (node as Typed.FunctionType).fail]) {
      if (typeof colour === "object" && "variable" in colour) colours.add(colour.variable);
    }
  });
  return { variables: [...colours], constraints: [], type };
}

/**
 * Whether a type holds an error: the error type, shown `?`, or an arrow whose
 * colour is in error (Effects §3.5), which shows as the impure constant and so
 * would claim one.
 */
function holdsError(type: Typed.Type): boolean {
  let found = false;
  walkData(type, (node) => {
    if (node.kind === "Error") found = true;
    if (node.kind === "Function") {
      const arrow = node as Typed.FunctionType;
      if (arrow.effect === "error" || arrow.fail === "error") found = true;
    }
  });
  return found;
}

/** The first of `spanned`, sorted by where each starts, that starts at or after `offset`. */
function firstStartingAt(spanned: readonly { readonly span: Source.Span }[], offset: number): number {
  let low = 0;
  let high = spanned.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (spanned[middle]!.span.start.offset < offset) low = middle + 1;
    else high = middle;
  }
  return low;
}

/**
 * The module's declarations, each the items that letter as one: an item on its
 * own, or a `fun` block's members together. A block is one declaration whose
 * head's binder list is every member's (Functions §7.3, SML's `fun … and …`),
 * so its members' letters must be one set for that list to be one; and where
 * members do share a variable, through the head or a knot (§7.4), it reads as
 * one letter in each.
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

/**
 * A header-form function: `let f(x) = …`, `fun f(x) = …`, the same with a
 * binder list after the name, or an instance's member.
 */
interface Header {
  readonly name: Parsed.Name;
  readonly lambda: Parsed.LambdaExpr;
  /**
   * Where its binder list goes (Functions §4.2): after its name; on its `fun`
   * block's head, since a block's members take none of their own (§7.3); or
   * nowhere, for an instance's member, whose variables the honor's head binds
   * (Constraints §5.4). An instance's member takes no result hint either: the
   * parser takes no written result there, though Constraints §4.1 allows one
   * (#1484).
   */
  readonly binder: "name" | "head" | "instance";
  /** The `fun` block it is a member of, whose head takes its binder list. */
  readonly block?: Parsed.FunBlockHead;
  /** Where the item ends. */
  readonly end: number;
  /** Whether the module exports it: an instance's member is not exported itself. */
  readonly exported: boolean;
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

/**
 * Every name a pattern binds that a type could follow: not a record field's
 * pun, `{guest}`, which binds the field's own name and is written `{guest =
 * guest}` before it can take a type.
 */
function forEachBinder(pattern: Parsed.Pattern, visit: (name: Parsed.Name) => void): void {
  const puns = new Set<Parsed.Pattern>();
  walkData(pattern, (node) => {
    if (node.kind !== "Record") return;
    for (const field of (node as unknown as Parsed.RecordPattern).fields) {
      if (field.pattern.kind === "Binding" && field.pattern.name.span.start.offset === field.name.span.start.offset) {
        puns.add(field.pattern);
      }
    }
  });
  walkData(pattern, (node) => {
    if (node.kind === "Binding" && !puns.has(node as unknown as Parsed.Pattern)) visit((node as unknown as Parsed.BindingPattern).name);
    if (node.kind === "As") visit((node as unknown as Parsed.AsPattern).name);
  });
}

/**
 * Reserves every type variable and binder name an item writes, wherever in it:
 * a letter minted for a hint must not be one the dev already gave something
 * else in the same declaration.
 */
function reserveWritten(item: Parsed.Item, letters: Typed.Letters): void {
  for (const spelling of spellingsIn(item)) letters.reserve(spelling);
  walkData(item, (node) => {
    const parameters = (node as { typeParameters?: unknown }).typeParameters;
    if (!Array.isArray(parameters)) return;
    for (const parameter of parameters as readonly Parsed.TypeParameter[]) letters.reserve(parameter.name.text);
  });
}

/** The type variable spellings written anywhere in a piece of the parsed tree. */
function spellingsIn(node: unknown): ReadonlySet<string> {
  const spellings = new Set<string>();
  walkData(node, (each) => {
    if (each.kind === "TypeVariable") spellings.add((each as unknown as Parsed.TypeVariable).name.text);
  });
  return spellings;
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
 * Every node with a `kind` in a piece of a tree, parsed or typed, for the
 * questions above that ask about every node of one shape whatever holds it: the
 * spellings written, the names a pattern binds, and the arrows a type holds.
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
