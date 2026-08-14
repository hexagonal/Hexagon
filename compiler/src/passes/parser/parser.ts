/**
 * The parser turns LaidOut.File into Parsed.Module. It owns block items and the
 * core expression grammar, including precedence and recovery at layout
 * separators. Tuple patterns, nullary unions and matches, annotations, tuple
 * values, local mutation, inclusive ranges, `while`, `for..in`, and directly recursive
 * `fun` bindings are present; the remaining
 * declarations, patterns, and richer type syntax remain future work. Constraint
 * bodies include the owner-scoped implied type forms from Collections Part 2 §5.
 */

import * as Diagnostics from "../../support/diagnostics.js";
import { isIntrinsicScheme } from "../../intrinsics.js";
import type * as Source from "../../support/source.js";
import { syntheticParameterName } from "../../support/synthetic.js";
import type * as LaidOut from "../../syntax/laid-out/index.js";
import type * as Lexed from "../../syntax/lexed/index.js";
import * as Parsed from "../../syntax/parsed/index.js";
import { DocBlocks } from "./doc-blocks.js";

type TokenKind = LaidOut.Token["kind"];

interface Infix {
  readonly operator?: Parsed.BinaryOperator;
  readonly comparison?: Parsed.ComparisonOperator;
  readonly leftBindingPower: number;
  readonly rightBindingPower: number;
  readonly assignment?: true;
}

const infix = new Map<TokenKind, Infix>([
  ["Assign", { leftBindingPower: 0, rightBindingPower: 1, assignment: true }],
  ["Pipe", { operator: "Pipe", leftBindingPower: 1, rightBindingPower: 2 }],
  ["Iff", { operator: "Iff", leftBindingPower: 2, rightBindingPower: 3 }],
  ["Implies", { operator: "Implies", leftBindingPower: 3, rightBindingPower: 3 }],
  ["Or", { operator: "Or", leftBindingPower: 4, rightBindingPower: 5 }],
  ["And", { operator: "And", leftBindingPower: 5, rightBindingPower: 6 }],
  ["EqualEqual", { comparison: "Equal", leftBindingPower: 6, rightBindingPower: 7 }],
  ["NotEqual", { comparison: "NotEqual", leftBindingPower: 6, rightBindingPower: 7 }],
  ["Less", { comparison: "Less", leftBindingPower: 6, rightBindingPower: 7 }],
  ["Greater", { comparison: "Greater", leftBindingPower: 6, rightBindingPower: 7 }],
  ["LessEqual", { comparison: "LessEqual", leftBindingPower: 6, rightBindingPower: 7 }],
  ["GreaterEqual", { comparison: "GreaterEqual", leftBindingPower: 6, rightBindingPower: 7 }],
  ["Range", { operator: "Range", leftBindingPower: 7, rightBindingPower: 8 }],
  ["Plus", { operator: "Add", leftBindingPower: 8, rightBindingPower: 9 }],
  ["Minus", { operator: "Subtract", leftBindingPower: 8, rightBindingPower: 9 }],
  ["Concat", { operator: "Concat", leftBindingPower: 8, rightBindingPower: 9 }],
  ["Star", { operator: "Multiply", leftBindingPower: 9, rightBindingPower: 10 }],
  ["Slash", { operator: "Divide", leftBindingPower: 9, rightBindingPower: 10 }],
  ["Power", { operator: "Power", leftBindingPower: 11, rightBindingPower: 11 }],
]);

const itemEnds = new Set<TokenKind>(["VSep", "Semicolon", "VClose", "Eof"]);

/** A pattern parameter's binder, paired with the pattern it destructures. */
type Destructuring = Parsed.ParameterDestructuring;

interface ParsedParameters {
  readonly parameters: readonly Parsed.Parameter[];
  readonly destructurings: readonly Destructuring[];
}
const structuralEnds: readonly TokenKind[] = ["VSep", "Semicolon", "VClose", "Eof"];

/** Everything a `<...>` type-parameter list may contain, for the lambda-form lookahead. */
const typeParameterListKinds = new Set<TokenKind>([
  "NonUpperName",
  "UpperName",
  "Colon",
  "Comma",
  "LeftParen",
  "RightParen",
]);

/**
 * Tokens that can begin a type operand (`#parseTypeOperand`'s own arms). Read by
 * the parenthesized element rule, which needs to know whether a term stands
 * where the ascribed type must (Products §2.2's named-tuple hint) before the
 * type parser reports a less specific failure — and by the lambda lookahead's
 * type skipper.
 */
const typeOperandStarts = new Set<TokenKind>([
  "LeftBrace",
  "LeftParen",
  "Wildcard",
  "NonUpperName",
  "UpperName",
]);

/** Nesting bracketry, so the record-update scan reads only its own brace's depth. */
const opensNesting = new Set<TokenKind>(["LeftParen", "LeftBracket", "LeftBrace", "VOpen"]);
const closesNesting = new Set<TokenKind>(["RightParen", "RightBracket", "RightBrace", "VClose"]);

/**
 * Tokens that can begin a paren-free pattern parameter (Pattern Matching §6.5). Literal
 * patterns are deliberately absent: as a sole parameter they are refutable without
 * exception, so reading one as a lambda head could only trade one error for another,
 * and the tokens that begin them overwhelmingly begin ordinary expressions.
 */
const parenFreePatternStarts = new Set<TokenKind>([
  "NonUpperName",
  "Wildcard",
  "UpperName",
  "LeftBrace",
  "LeftBracket",
]);

/**
 * Token kinds that can end an expression. A contextual `with` opens a record update only
 * when one of these precedes it; otherwise `with` is the field name or the value it looks
 * like (Products §3.3).
 */
const endsExpression = new Set<TokenKind>([
  "NonUpperName",
  "UpperName",
  "RightParen",
  "RightBracket",
  "RightBrace",
  "Integer",
  "BigInt",
  "Float",
  "String",
  "True",
  "False",
]);

/**
 * Effects §9's mark-position row: the one report every mark outside its two
 * grammatical seats takes. A mark before a `(` it is not glued to is in this
 * family too — Lexer §8.1 spells the seat "glued immediately before `(`", so a
 * spaced mark is a mark with no argument list it belongs to.
 */
const markSeatError =
  "a call mark governs an argument list; write it immediately before `(`, " +
  "or (in a `|>` stage) at the end of the stage — a reference carries no colour";

/** Parses one layout-aware file and retains diagnostics from earlier passes. */
export function parse(file: LaidOut.File): Parsed.Module {
  const diagnostics = new Diagnostics.Bag();
  for (const diagnostic of file.diagnostics) {
    diagnostics.add(diagnostic);
  }

  return new Parser(
    file.tokens,
    diagnostics,
    new DocBlocks(file.tokens, file.comments, diagnostics),
  ).parseModule(file.fileId, file.comments);
}

class Parser {
  readonly #tokens: readonly LaidOut.Token[];
  readonly #diagnostics: Diagnostics.Bag;
  /**
   * Doc-comment bookkeeping (spec/doc-comments.md §4). Declaration parsers claim
   * the block sitting before their first token; the blocks nobody claims are
   * §5's hard errors, reported when the module closes.
   */
  readonly #docs: DocBlocks;
  #index = 0;
  /**
   * Type-parameter lambdas awaiting their position check (Functions §4.2). The grammar
   * parses `<a: Ord>(x: a) => …` wherever an expression may start, because a leading `<`
   * has no other reading; the *restriction* to `let`/`fun` right-hand sides is enforced by
   * `#parseBinding` discharging its own value here, and whatever is left over at the end of
   * the module was written somewhere the restriction forbids.
   */
  readonly #pendingTypeParameterLambdas = new Map<Parsed.Expr, Source.Span>();

  /**
   * The mark a pipe stage wore with no argument list of its own — `x |> save!`
   * (Effects §3.2). The postfix loop parks it here and the `|>` arm collects
   * it one step later, because the mark is consumed while the stage's own
   * expression is still being parsed. Cleared on collection; a mark that
   * reaches any other position is a parse error raised where it was found.
   */
  #stageMark: { readonly mark: Parsed.CallMark; readonly span: Source.Span } | undefined;

  /**
   * Token positions the reserved-`__` sweep must leave alone (Lexer §3.2, #425).
   *
   * The reservation governs *Hexagon's own name seats*, and only a parser knows
   * which seats those are — so the lexer emits the token and this records the
   * exceptions as they are parsed: the foreign side of an FFI `as` alias, which
   * is outside the seats entirely (FFI Part 4 §3.2), and an unaliased extern
   * name seat, which gets that part's alias rewrite instead of a rename and so
   * has already been reported by the time the sweep runs.
   */
  readonly #reservedNameExemptions = new Set<number>();

  constructor(
    tokens: readonly LaidOut.Token[],
    diagnostics: Diagnostics.Bag,
    docs: DocBlocks,
  ) {
    this.#tokens = tokens;
    this.#diagnostics = diagnostics;
    this.#docs = docs;
  }

  /** Consumes the module's implicit layout block and requires a final Eof. */
  parseModule(
    fileId: Source.FileId,
    comments: readonly Source.Comment[],
  ): Parsed.Module {
    const opening = this.#expect("VOpen", "expected the module layout block");
    const items = this.#parseItems(true);
    const closing = this.#expect("VClose", "expected the module layout block to close");
    const eof = this.#expect("Eof", "expected end of file");
    this.#reportMisplacedTypeParameterLambdas();
    this.#reportReservedNames();
    const first = opening ?? items[0] ?? closing ?? eof ?? this.#current();
    const last = eof ?? closing ?? items.at(-1) ?? first;

    // After the items: `finish` reports every block nobody claimed (§5), and
    // those diagnostics have to be in the bag before it is drained.
    const docs = this.#docs.finish();

    return {
      kind: "Module",
      fileId,
      items,
      comments,
      docs,
      span: spanFrom(first.span, last.span),
      diagnostics: this.#diagnostics.toArray(),
    };
  }

  /** Parses one interpolation's expression-only token stream. */
  parseStandaloneExpression(): Parsed.Expr {
    const expression = this.#parseExpression();
    if (!this.#at("Eof")) {
      this.#error("expected one expression inside string interpolation");
      this.#synchronize(new Set(["Eof"]));
    }
    this.#expect("Eof", "expected the end of string interpolation");
    // An interpolation has its own token stream, so it needs its own sweep: the
    // module-level one never sees these tokens. Every seat inside one is an
    // ordinary Hexagon seat — no extern declaration can appear here — so there
    // is nothing to exempt.
    this.#reportReservedNames();
    return expression;
  }

  #parseItems(moduleItems = false): readonly Parsed.Item[] {
    const items: Parsed.Item[] = [];
    this.#skipSeparators();

    while (!this.#at("VClose") && !this.#at("Eof")) {
      // The item's first physical token, captured before it is consumed: a doc
      // block claims its declaration by the token the declaration begins with
      // (§4.1), and virtual tokens are invisible to that (§4).
      const start = this.#current().span.start.offset;
      const item = this.#parseItem(moduleItems);
      this.#documentItem(start, item);
      items.push(item);

      if (this.#at("VSep") || this.#at("Semicolon")) {
        this.#skipSeparators();
      } else if (!this.#at("VClose") && !this.#at("Eof")) {
        this.#error("expected a newline or `;` between block items");
        this.#synchronize(itemEnds);
        this.#skipSeparators();
      }
    }

    return items;
  }

  /**
   * Hands the doc block before an item to that item, when the item is one of
   * §4.2's documentable declarations. The forms that are not — `import`,
   * `extern import`, the `extern from` header, a module-level effect statement
   * — leave the block unclaimed on purpose: §5 owns the message each of them
   * gets, and `DocBlocks` chooses it from the code token, not from here.
   *
   * An `ErrorItem` claims and drops its block instead. The declaration it would
   * have documented failed to parse; one syntax error is the whole story.
   *
   * The names each form introduces go with the block, for the editor services
   * that look documentation up by one. A destructuring `let` introduces all of
   * its binders; an `honor` block introduces none, and hands over the
   * constraint in its head — the only name it writes, and the one a reader
   * points at to ask what the instance is for.
   */
  #documentItem(start: number, item: Parsed.Item): void {
    switch (item.kind) {
      case "Let":
      case "Var":
      case "Fun":
      case "TypeAlias":
      case "RecordDeclaration":
      case "Exception":
      case "ConstraintDeclaration":
      case "Union":
        this.#docs.attach(start, item.span, [item.name.span]);
        return;
      case "LetPattern":
        this.#docs.attach(
          start,
          item.span,
          Parsed.patternNames(item.pattern).map(({ span }) => span),
        );
        return;
      case "Honor":
        this.#docs.attach(start, item.span, [item.constraint.span]);
        return;
      case "ErrorItem":
        this.#docs.discard(start);
        return;
      default:
        return;
    }
  }

  #parseItem(moduleItems: boolean): Parsed.Item {
    if (this.#at("Extern")) {
      if (!moduleItems) {
        const start = this.#advance();
        this.#errorAt(start.span, "foreign declarations are made at module level");
        this.#synchronize(itemEnds);
        return { kind: "ErrorItem", span: spanFrom(start.span, this.#previous().span) };
      }
      return this.#parseExtern();
    }
    if (this.#at("Import")) {
      if (!moduleItems) {
        const start = this.#advance();
        this.#errorAt(start.span, "imports are declared at module level");
        this.#synchronize(itemEnds);
        return { kind: "ErrorItem", span: spanFrom(start.span, this.#previous().span) };
      }
      return this.#parseImport();
    }
    if (this.#at("Constraint")) {
      if (!moduleItems) {
        const start = this.#advance();
        this.#errorAt(start.span, "constraints are declared at module level");
        this.#synchronize(itemEnds);
        return { kind: "ErrorItem", span: spanFrom(start.span, this.#previous().span) };
      }
      return this.#parseConstraint();
    }
    if (this.#at("Honor")) {
      if (!moduleItems) {
        const start = this.#advance();
        this.#errorAt(start.span, "instances are declared at module level");
        this.#synchronize(itemEnds);
        return { kind: "ErrorItem", span: spanFrom(start.span, this.#previous().span) };
      }
      return this.#parseHonor();
    }
    if (this.#at("Export")) {
      const exportToken = this.#advance();
      if (!moduleItems) {
        this.#errorAt(exportToken.span, "`export` is only allowed at module top level");
        this.#synchronize(itemEnds);
        return {
          kind: "ErrorItem",
          span: spanFrom(exportToken.span, this.#previous().span),
        };
      }
      const opaque = this.#atContextual("opaque");
      if (opaque) this.#advance();
      // `honor` is admitted here only to be refused with Modules §4.1's own
      // wording. Left out of the list, it would fall to the generic "must be
      // followed by a declaration" — which is false, and unhelpful precisely
      // where the author believed instances were an export surface.
      if (this.#at("Honor")) {
        this.#errorAt(
          exportToken.span,
          "instances are always visible; `export` does not apply",
        );
        this.#synchronize(itemEnds);
        return {
          kind: "ErrorItem",
          span: spanFrom(exportToken.span, this.#previous().span),
        };
      }
      if (!this.#at("Let") && !this.#at("Fun") && !this.#at("Type") && !this.#atUnionHead() && !this.#at("Record") && !this.#at("Exception") && !this.#at("Constraint")) {
        this.#errorAt(
          exportToken.span,
          "`export` must be followed by a declaration",
        );
        this.#synchronize(itemEnds);
        return {
          kind: "ErrorItem",
          span: spanFrom(exportToken.span, this.#previous().span),
        };
      }
      if (opaque && !this.#atUnionHead() && !this.#at("Record")) {
        this.#errorAt(exportToken.span, "`opaque` applies to `record` and `union` declarations");
      }
      if (this.#at("Constraint")) return this.#parseConstraint(true, exportToken.span);
      if (this.#at("Type")) return this.#parseTypeAlias(true, exportToken.span);
      if (this.#atUnionHead()) return this.#parseUnion(true, exportToken.span, opaque);
      if (this.#at("Record")) return this.#parseRecordDeclaration(true, exportToken.span, opaque);
      if (this.#at("Exception")) return this.#parseException(true, exportToken.span);
      return this.#at("Let")
        ? this.#parseBinding("Let", true, exportToken.span)
        : this.#parseBinding("Fun", true, exportToken.span);
    }
    if (this.#at("Type")) {
      if (!moduleItems) {
        const start = this.#advance();
        this.#errorAt(start.span, "type aliases are declared at module level");
        this.#synchronize(itemEnds);
        return { kind: "ErrorItem", span: spanFrom(start.span, this.#previous().span) };
      }
      return this.#parseTypeAlias(false);
    }
    if (this.#at("Let")) {
      if (
        // No `True`/`False` here (#147): those token kinds are the *lowercase*
        // reserved words, which used to open a literal pattern and no longer
        // open anything. Routing them to the pattern binding would answer
        // `let true = 1` with the value-position redirect ("write `True`"),
        // which is wrong advice in a binder — `let True = ...` is a refutable
        // constructor pattern and errors again. Falling through to the ordinary
        // binding path gets the plain reserved-name message the spec requires
        // (Lexer §10). The constructors themselves are `UpperName`s, already
        // listed.
        ["LeftParen", "LeftBrace", "UpperName", "Wildcard"]
          .includes(this.#peek(1).kind)
      ) {
        return this.#parsePatternBinding();
      }
      return this.#parseBinding("Let", false);
    }
    if (this.#at("Fun")) {
      return this.#parseBinding("Fun", false);
    }
    if (this.#at("Var")) {
      return this.#parseVar();
    }
    if (this.#atUnionHead()) {
      if (!moduleItems) {
        const start = this.#advance();
        this.#errorAt(start.span, "`union` is only allowed at module top level");
        this.#synchronize(itemEnds);
        return { kind: "ErrorItem", span: spanFrom(start.span, this.#previous().span) };
      }
      return this.#parseUnion(false, undefined, false);
    }
    if (this.#at("Record")) {
      if (!moduleItems) {
        const start = this.#advance();
        this.#errorAt(start.span, "`record` is only allowed at module top level");
        this.#synchronize(itemEnds);
        return { kind: "ErrorItem", span: spanFrom(start.span, this.#previous().span) };
      }
      return this.#parseRecordDeclaration(false, undefined, false);
    }
    if (this.#at("Exception")) {
      if (!moduleItems) {
        const start = this.#advance();
        this.#errorAt(start.span, "exceptions are declared at module level");
        this.#synchronize(itemEnds);
        return { kind: "ErrorItem", span: spanFrom(start.span, this.#previous().span) };
      }
      return this.#parseException(false);
    }
    const expression = this.#parseExpression();
    return { kind: "ExprItem", expression, span: expression.span };
  }

  #parseImport(): Parsed.ImportItem {
    const start = this.#advance();
    let form: Parsed.ImportForm;
    if (this.#at("String")) {
      const specifier = this.#parseImportSpecifier();
      return {
        kind: "Import",
        specifier: specifier.value,
        form: { kind: "Effect" },
        span: spanFrom(start.span, specifier.span),
      };
    }
    if (this.#at("Star")) {
      this.#advance();
      this.#expectContextual("as", "expected `as` after `import *`");
      const aliasToken = this.#takeName("UpperName", "module aliases must be uppercase-start names");
      const alias = aliasToken === undefined
        ? { text: "Invalid", startClass: "upper" as const, span: this.#current().span }
        : parsedName(aliasToken);
      form = { kind: "Namespace", alias };
    } else {
      this.#expect("LeftBrace", "expected `{`, `*`, or a module string after `import`");
      const names: Parsed.ImportName[] = [];
      while (!this.#at("RightBrace") && !this.#at("Eof")) {
        const token = this.#current();
        if (token.kind !== "NonUpperName" && token.kind !== "UpperName") {
          this.#error("expected an imported name");
          break;
        }
        this.#advance();
        const imported = parsedName(token);
        let local = imported;
        if (this.#atContextual("as")) {
          this.#advance();
          const expected = imported.startClass === "non-upper" ? "NonUpperName" : "UpperName";
          const alias = this.#takeName(expected, "import alias start class must match what it names");
          if (alias !== undefined) local = parsedName(alias);
        }
        names.push({ imported, local, span: spanFrom(imported.span, local.span) });
        if (!this.#at("Comma")) break;
        this.#advance();
      }
      this.#expect("RightBrace", "expected `}` after imported names");
      form = { kind: "Named", names };
    }
    this.#expectContextual("from", "expected `from` before the module path");
    const specifier = this.#parseImportSpecifier();
    return {
      kind: "Import",
      specifier: specifier.value,
      form,
      span: spanFrom(start.span, specifier.span),
    };
  }

  #parseExtern(): Parsed.ExternBlockItem | Parsed.ExternImportItem | Parsed.ErrorItem {
    const start = this.#advance();
    if (this.#at("Import")) {
      this.#advance();
      const specifier = this.#parseImportSpecifier();
      return {
        kind: "ExternImport",
        specifier: specifier.value,
        span: spanFrom(start.span, specifier.span),
      };
    }
    if (!this.#atContextual("from")) {
      this.#error("expected `from` or `import` after `extern`");
      this.#synchronize(itemEnds);
      return { kind: "ErrorItem", span: spanFrom(start.span, this.#previous().span) };
    }
    this.#advance();
    const specifier = this.#parseImportSpecifier();
    // The intrinsic door reuses this grammar wholesale except for the deltas
    // `spec/intrinsics.md` §3.3–§3.4 state, which are keyed off the specifier
    // alone. Whether the module may *use* the door is the resolver's question
    // (§5.2's privilege gate); the shape of what it wrote is this pass's.
    const intrinsic = isIntrinsicScheme(specifier.value);
    this.#expect("VOpen", "expected an indented extern block");
    const declarations: Parsed.ExternDeclaration[] = [];
    this.#skipSeparators();
    while (!this.#at("VClose") && !this.#at("Eof")) {
      const declarationStart = this.#current().span.start.offset;
      const declaration = this.#parseExternDeclaration(intrinsic);
      // Every item form the block admits introduces a name, so every one is
      // documentable (§4.2). A form that failed to parse claims and drops its
      // block, like an `ErrorItem` does.
      if (declaration === undefined) this.#docs.discard(declarationStart);
      else {
        declarations.push(declaration);
        this.#docs.attach(declarationStart, declaration.span, [declaration.localName.span]);
      }
      if (this.#at("VSep") || this.#at("Semicolon")) this.#skipSeparators();
      else if (!this.#at("VClose") && !this.#at("Eof")) {
        this.#error("expected a newline or `;` between extern declarations");
        this.#synchronize(new Set(["VSep", "VClose", "Eof"]));
        this.#skipSeparators();
      }
    }
    const closing = this.#expect("VClose", "expected the extern block to close");
    return {
      kind: "ExternBlock",
      specifier: specifier.value,
      declarations,
      span: spanFrom(start.span, closing?.span ?? declarations.at(-1)?.span ?? specifier.span),
    };
  }

  #parseExternDeclaration(intrinsic: boolean): Parsed.ExternDeclaration | undefined {
    const start = this.#current();
    const exported = this.#at("Export");
    if (exported) this.#advance();
    const defaultBinding = this.#atContextual("default");
    if (defaultBinding) {
      // `default` names a foreign module's default export. There is no foreign
      // module behind the intrinsic door (§8.3 emits no import), so the modifier
      // has nothing to name — it falls under §3.3's `fun`-only admission.
      if (intrinsic) this.#errorAt(this.#current().span, intrinsicFormError("default"));
      this.#advance();
    }
    // Effects §6.1's opt-out, in the shape `default` already established: a
    // contextual modifier on one extern declaration. A user-written extern is
    // effectful by default (trust territory); `pure` is the trusted purity
    // claim, and `conduit` (#409) is its sibling in the same slot — the claim
    // that the row is exactly as effectful as the callbacks it is handed.
    // Compiler-owned intrinsic rows take their purity from intrinsics §4.2's
    // verification instead, so both modifiers are redundant there.
    //
    // Either order is scanned so `conduit pure` reaches the one-claim report
    // below rather than a parse failure; a *repeated* word is not consumed
    // twice, and falls to the declaration-keyword check as it always did.
    const claims: { readonly text: "pure" | "conduit"; readonly span: Source.Span }[] = [];
    for (;;) {
      const text = this.#atContextual("pure")
        ? "pure" as const
        : this.#atContextual("conduit")
        ? "conduit" as const
        : undefined;
      if (
        text === undefined || claims.length === 2 ||
        claims.some((claim) => claim.text === text)
      ) break;
      const { span } = this.#advance();
      claims.push({ text, span });
      if (intrinsic) {
        this.#errorAt(
          span,
          `intrinsic rows are verified rather than trusted; \`${text}\` is for user-written externs`,
        );
      }
    }
    // FFI Part 4 §4.5: one row, one claim. The two say incompatible things
    // about the same arrow, so neither is believed — the row falls back to the
    // impure default, which is the honest reading of a row that claimed nothing.
    const conflicting = claims.length === 2;
    if (conflicting) {
      this.#errorAt(
        claims[1]!.span,
        "one row, one claim: `pure` says this function never observably invokes " +
          "what it is handed, and `conduit` says it is exactly as effectful as " +
          "what it is handed — write one",
      );
    }
    const pureClaim = !conflicting && claims[0]?.text === "pure";
    const conduitClaim = conflicting ? undefined : claims.find((claim) => claim.text === "conduit");
    const kind = this.#current().kind;
    if (intrinsic && kind !== "Fun") {
      const label = this.#current();
      this.#errorAt(label.span, intrinsicFormError(externDeclarationKeyword(label)));
      this.#synchronize(new Set(["VSep", "VClose", "Eof"]));
      return undefined;
    }
    if (kind !== "Fun" && kind !== "Let" && kind !== "Type") {
      const label = this.#current();
      const text = label.kind === "NonUpperName" || label.kind === "UpperName"
        ? `extern \`${label.text}\` declarations belong to a later FFI slice`
        : "extern blocks contain `fun`, `let`, or `type` declarations";
      this.#errorAt(label.span, text);
      this.#synchronize(new Set(["VSep", "VClose", "Eof"]));
      return undefined;
    }
    // FFI Part 4 §4.5: the claim is a claim about a *face*, and only a callable
    // has one. Refused here rather than believed and dropped, so the row does
    // not read as carrying a purity the checker never asked about. `conduit`
    // stands on the same sentence: it colours an outer arrow the non-callable
    // forms do not have.
    const pureOnFun = pureClaim && kind === "Fun";
    const conduitOnFun = kind === "Fun" ? conduitClaim : undefined;
    if (kind !== "Fun") {
      for (const claim of claims) {
        if (conflicting && claim !== claims[0]) continue;
        this.#errorAt(
          start.span,
          kind === "Type"
            ? `\`${claim.text}\` claims a function's face, and a type has none — the claim ` +
              "belongs on an extern `fun`"
            : `\`${claim.text}\` claims a function's face, and a value reference carries no ` +
              "colour — the claim belongs on an extern `fun`",
        );
      }
    }
    this.#advance();
    if (kind === "Type" && defaultBinding) {
      this.#errorAt(start.span, "`default` applies to foreign functions and values, not types");
    }
    const expected = kind === "Type" || !defaultBinding ? undefined : "NonUpperName";
    const nameIndex = this.#index;
    const nameToken = expected === undefined
      ? this.#takeAnyName("extern declarations require a name")
      : this.#takeName(expected, "default extern bindings require a non-uppercase-start local name");
    if (nameToken === undefined) {
      this.#synchronize(new Set(["VSep", "VClose", "Eof"]));
      return undefined;
    }
    const firstName = parsedName(nameToken);
    let foreignName: Parsed.Name | undefined = defaultBinding ? undefined : firstName;
    let localName = firstName;
    let aliased = false;
    if (this.#atContextual("as")) {
      const asToken = this.#advance();
      const aliasToken = this.#takeAnyName("expected a local name after `as`");
      if (defaultBinding) {
        this.#errorAt(
          asToken.span,
          "`as` aliases a foreign export name; a `default` binding has none — name the binding directly",
        );
      } else if (aliasToken !== undefined) {
        localName = parsedName(aliasToken);
        aliased = true;
      }
    }
    // FFI Part 4 §3.2, the reservation half. The foreign side of `as` is not a
    // Hexagon name seat, so a foreign export named `__foo` — a common JavaScript
    // internals convention — stays bindable and is exempted from the sweep. An
    // *unaliased* seat is both sides at once, and the repair is the one that
    // part names for every other illegal foreign spelling: an alias, never a
    // rename of the foreign name, which would bind a different export. (The
    // local side of `as` is an ordinary seat and takes the sweep's rename.)
    let reservedForeignSeat = false;
    if (!defaultBinding && firstName.text.startsWith("__")) {
      this.#reservedNameExemptions.add(nameIndex);
      if (!aliased) {
        reservedForeignSeat = true;
        const keyword = kind === "Type" ? "type" : kind === "Fun" ? "fun" : "let";
        const alias = firstName.text.replace(/^_+/, "");
        this.#errorAt(
          firstName.span,
          `foreign ${kind === "Type" ? "type" : "term"} \`${firstName.text}\` uses the reserved \`__\` ` +
            `prefix; bind it with an alias: \`${keyword} ${firstName.text} as ` +
            `${kind === "Type" ? upperInitial(alias) : lowerInitial(alias)}\``,
        );
      }
    }
    if (kind === "Type") {
      // One rewrite per seat: the reservation message above already names the
      // alias this would ask for a second time, with the same repair.
      if (localName.startClass !== "upper" && !reservedForeignSeat) {
        this.#errorAt(
          localName.span,
          `foreign type \`${foreignName?.text ?? localName.text}\` needs an uppercase-start local alias; write \`type ${foreignName?.text ?? localName.text} as T${localName.text}\``,
        );
      }
      if (this.#at("LeftParen") || this.#at("Less")) {
        this.#errorAt(this.#current().span, "generic extern declarations are not part of Hexagon v1");
        this.#synchronize(new Set(["VSep", "VClose", "Eof"]));
      }
      return {
        kind: "ExternType",
        exported,
        default: false,
        ...(foreignName === undefined ? {} : { foreignName }),
        localName,
        span: spanFrom(start.span, this.#previous().span),
      };
    }
    if (localName.startClass !== "non-upper") {
      const declaration = kind === "Fun" ? "fun" : "let";
      this.#errorAt(
        localName.span,
        `foreign term \`${foreignName?.text ?? localName.text}\` is not a legal Hexagon term name; bind it with an alias: \`${declaration} ${foreignName?.text ?? localName.text} as ${lowerInitial(localName.text)}\``,
      );
    }
    let typeParameters: readonly Parsed.TypeParameter[] | undefined;
    if (this.#at("Less")) {
      // Genericity is granted inside the reserved boundary only (§3.4): the
      // implementer here is the compiler, which owns the representation of every
      // instantiation, so Part 4 §12.4's representation question does not arise.
      //
      // The list used to be parsed for its scoping shape alone — the annotations
      // carry the variables, so an unbounded binder records nothing the checker
      // needs. #370 widened §3.4 to *constraint* brackets, and a bound is not
      // recoverable from an annotation, so the list is now recorded. Foreign
      // externs stay monomorphic and unconstrained: the refusal below is the one
      // that has always fired, and dropping the list on that path keeps a refused
      // declaration from carrying a bound into the scheme behind the diagnostic.
      if (!intrinsic) {
        this.#errorAt(this.#current().span, "generic extern declarations are not part of Hexagon v1");
        this.#parseTypeParameters();
      } else {
        typeParameters = this.#parseTypeParameters();
      }
    }
    if (kind === "Fun") {
      if (!this.#at("LeftParen")) {
        this.#errorAt(
          localName.span,
          `extern \`fun\` declares a callable and requires a parameter list; for a foreign value, write \`let ${localName.text}: Type\``,
        );
      }
      const parsedParameters = this.#at("LeftParen")
        ? this.#parseParameters()
        : { parameters: [], destructurings: [] };
      const parameters = parsedParameters.parameters;
      this.#rejectDestructurings(parsedParameters.destructurings, "extern functions");
      for (const parameter of parameters) {
        if (parameter.annotation === undefined) {
          this.#errorAt(parameter.span, "extern function parameters require type annotations");
        }
      }
      this.#expect("Colon", "extern functions require a result type");
      const returnAnnotation = this.#parseTypeAnnotation() ?? invalidType(localName);
      this.#rejectExternBody();
      return {
        kind: "ExternFun",
        exported,
        default: defaultBinding,
        ...(pureOnFun ? { pure: true as const } : {}),
        ...(conduitOnFun === undefined ? {} : { conduit: conduitOnFun.span }),
        ...(foreignName === undefined ? {} : { foreignName }),
        localName,
        ...(typeParameters === undefined || typeParameters.length === 0
          ? {}
          : { typeParameters }),
        parameters,
        returnAnnotation,
        span: spanFrom(start.span, returnAnnotation.span),
      };
    }
    if (this.#at("LeftParen")) {
      this.#errorAt(
        localName.span,
        `extern callable declarations use \`fun\`; write \`fun ${localName.text}(...)\` with explicit parameters`,
      );
      this.#parseParameters();
    }
    this.#expect("Colon", "extern values require a type annotation");
    const annotation = this.#parseTypeAnnotation() ?? invalidType(localName);
    if (annotation.kind === "Function") {
      this.#errorAt(
        annotation.span,
        `extern callable declarations use \`fun\`; write \`fun ${localName.text}(...)\` with explicit parameters`,
      );
    }
    this.#rejectExternBody();
    return {
      kind: "ExternLet",
      exported,
      default: defaultBinding,
      ...(foreignName === undefined ? {} : { foreignName }),
      localName,
      annotation,
      span: spanFrom(start.span, annotation.span),
    };
  }

  #rejectExternBody(): void {
    if (!this.#at("Equal")) return;
    const equal = this.#advance();
    this.#errorAt(equal.span, "extern declarations have no bodies");
    this.#parseExpression();
  }

  #parseConstraint(
    exported = false,
    itemStart?: Source.Span,
  ): Parsed.ConstraintItem {
    const start = this.#advance();
    const nameToken = this.#takeName("UpperName", "`constraint` requires an uppercase-start name");
    const fallbackName: Parsed.Name = {
      text: "Invalid",
      startClass: "upper",
      span: nameToken?.span ?? start.span,
    };
    const head = this.#at("Less") ? this.#parseTypeParameters() : [];
    if (head.length !== 1) {
      this.#errorAt(start.span, "a constraint head introduces exactly one type variable");
    }
    const subject = head[0]?.name ?? {
      text: "a",
      startClass: "non-upper" as const,
      span: this.#current().span,
    };
    const baseConstraints = head[0]?.constraints ?? [];
    this.#expect("Equal", "expected `=` after constraint head");
    this.#expect("VOpen", "expected an indented constraint body");
    const impliedTypes: Parsed.ConstraintImpliedType[] = [];
    const members: Parsed.ConstraintMember[] = [];
    this.#skipSeparators();
    while (!this.#at("VClose") && !this.#at("Eof")) {
      if (this.#at("Type")) {
        const memberStart = this.#current().span.start.offset;
        const type = this.#advance();
        const typeName = this.#takeName("UpperName", "implied types require an uppercase-start name");
        if (typeName === undefined) {
          // The member this block would document failed to parse (§5's error
          // would be a second complaint about one typo).
          this.#docs.discard(memberStart);
          this.#skipSeparators();
          continue;
        }
        const impliedType = {
          name: parsedName(typeName),
          span: spanFrom(type.span, typeName.span),
        };
        impliedTypes.push(impliedType);
        // §4.2: a `type` member is a constraint member and documentable like
        // any other. Its seat is nowhere — an instance's choice is a type, and
        // types are gone before the boundary (§7.1) — so the attachment is for
        // tooling (§8), and for the §5 error not to fire.
        this.#docs.attach(memberStart, impliedType.span, [impliedType.name.span]);
        this.#skipSeparators();
        continue;
      }
      const memberStart = this.#current().span.start.offset;
      const memberToken = this.#takeName("NonUpperName", "constraint members are non-uppercase-start names");
      if (memberToken === undefined) {
        this.#synchronize(new Set(["VSep", "VClose", "Eof"]));
        this.#skipSeparators();
        continue;
      }
      const memberParameters = this.#parseParameters();
      const parameters = memberParameters.parameters;
      this.#rejectDestructurings(memberParameters.destructurings, "constraint members");
      for (const parameter of parameters) {
        if (parameter.annotation === undefined) {
          this.#errorAt(parameter.span, "constraint member parameters require type annotations");
        }
      }
      this.#expect("Colon", "constraint members require a result type");
      const result = this.#parseTypeAnnotation() ?? {
        kind: "NamedType" as const,
        name: fallbackName,
        span: fallbackName.span,
      };
      let defaultValue: Parsed.LambdaExpr | undefined;
      if (this.#at("Equal")) {
        this.#advance();
        const body = this.#parseBodyExpression(new Set(["VSep", "VClose", "Eof"]));
        defaultValue = {
          kind: "Lambda",
          parameters,
          body,
          span: spanFrom(memberToken.span, body.span),
        };
      }
      const member = {
        name: parsedName(memberToken),
        parameters,
        returnAnnotation: result,
        ...(defaultValue === undefined ? {} : { defaultValue }),
        span: spanFrom(memberToken.span, result.span),
      };
      members.push(member);
      this.#docs.attach(memberStart, member.span, [member.name.span]);
      this.#skipSeparators();
    }
    const closing = this.#expect("VClose", "expected the constraint body to close");
    if (members.length === 0) this.#errorAt(start.span, "a constraint needs at least one required member");
    return {
      kind: "ConstraintDeclaration",
      exported,
      name: nameToken === undefined ? fallbackName : parsedName(nameToken),
      subject,
      baseConstraints,
      impliedTypes,
      members,
      span: spanFrom(
        itemStart ?? start.span,
        closing?.span ?? members.at(-1)?.span ?? start.span,
      ),
    };
  }

  #parseHonor(): Parsed.HonorItem {
    const start = this.#advance();
    const typeParameters = this.#at("Less") ? this.#parseTypeParameters() : [];
    // Qualified by a module alias where the constraint was namespace-imported
    // (Modules §3.3): `honor Geo.Area<Tile>` is the only spelling available to a
    // module that reached the constraint that way, and its own type is a lawful
    // home for the instance (Constraints §5.3).
    const constraintName = this.#parseConstraintReference(
      "`honor` requires a constraint name",
    );
    const fallback: Parsed.Name = {
      text: "Invalid",
      startClass: "upper",
      span: constraintName?.span ?? start.span,
    };
    this.#expect("Less", "instance heads use `<Type>`");
    const subject = this.#parseTypeAnnotation() ?? {
      kind: "NamedType" as const,
      name: fallback,
      span: fallback.span,
    };
    this.#expect("Greater", "expected `>` after instance head");
    this.#expect("Equal", "expected `=` after instance head");
    if (this.#at("Derive")) {
      this.#advance();
      return {
        kind: "Honor",
        constraint: constraintName ?? fallback,
        typeParameters,
        subject,
        derived: true,
        impliedTypes: [],
        members: [],
        span: spanFrom(start.span, this.#previous().span),
      };
    }
    this.#expect("VOpen", "expected an indented instance body");
    const impliedTypes: Parsed.HonorImpliedType[] = [];
    const members: Parsed.HonorMember[] = [];
    this.#skipSeparators();
    while (!this.#at("VClose") && !this.#at("Eof")) {
      if (this.#at("Type")) {
        const memberStart = this.#current().span.start.offset;
        const type = this.#advance();
        const typeName = this.#takeName("UpperName", "implied type bindings require an uppercase-start name");
        this.#expect("Equal", "expected `=` in implied type binding");
        const annotation = this.#parseTypeAnnotation();
        if (typeName === undefined || annotation === undefined) {
          this.#docs.discard(memberStart);
          this.#skipSeparators();
          continue;
        }
        const binding = {
          name: parsedName(typeName),
          annotation,
          span: spanFrom(type.span, annotation.span),
        };
        impliedTypes.push(binding);
        // §7.1: like every other `honor` member, an implied-type binding has no
        // seat in either emitted artifact. The attachment is for tooling (§8),
        // and for the §5 error not to fire.
        this.#docs.attach(memberStart, binding.span, [binding.name.span]);
        this.#skipSeparators();
        continue;
      }
      const memberStart = this.#current().span.start.offset;
      const memberToken = this.#takeName("NonUpperName", "instance members are non-uppercase-start names");
      if (memberToken === undefined) {
        this.#synchronize(new Set(["VSep", "VClose", "Eof"]));
        this.#skipSeparators();
        continue;
      }
      const { parameters, destructurings } = this.#parseParameters();
      this.#expect("Equal", "expected `=` in instance member");
      const body = this.#parseBodyExpression(new Set(["VSep", "VClose", "Eof"]));
      const name = parsedName(memberToken);
      const member = {
        name,
        value: {
          kind: "Lambda" as const,
          parameters,
          ...this.#lambdaDestructurings(destructurings),
          body,
          span: spanFrom(name.span, body.span),
        },
        span: spanFrom(name.span, body.span),
      };
      members.push(member);
      // §7.1: an `honor` member has no seat in either emitted artifact. The
      // attachment is for tooling (§8), and for the §5 error not to fire.
      this.#docs.attach(memberStart, member.span, [name.span]);
      this.#skipSeparators();
    }
    const closing = this.#expect("VClose", "expected the instance body to close");
    return {
      kind: "Honor",
      constraint: constraintName ?? fallback,
      typeParameters,
      subject,
      derived: false,
      impliedTypes,
      members,
      span: spanFrom(start.span, closing?.span ?? members.at(-1)?.span ?? subject.span),
    };
  }

  #parseImportSpecifier(): { readonly value: string; readonly span: Source.Span } {
    const token = this.#current();
    if (token.kind !== "String") {
      this.#error("module paths are string literals");
      return { value: "", span: token.span };
    }
    this.#advance();
    if (token.parts.some((part) => part.kind !== "Text")) {
      this.#errorAt(token.span, "module paths cannot contain interpolation");
    }
    return {
      value: token.parts.flatMap((part) => part.kind === "Text" ? [part.value] : []).join(""),
      span: token.span,
    };
  }

  #atContextual(text: string): boolean {
    const token = this.#current();
    return token.kind === "NonUpperName" && token.text === text;
  }

  /**
   * Whether a union **declaration** starts here — the `union` contextual
   * keyword (#373), recognized by Products §3.3's mechanism.
   *
   * `union` was a hard keyword until the Set step needed `Set.union` and could
   * not have it: Collections Part 4 §6.2 mandates that name, and a reserved word
   * is unspellable in every binder position. The `with` precedent settled the
   * shape — a contextual word costs one predicate and forecloses nothing — and
   * `when` and `opaque` are the same mechanism.
   *
   * **One token of lookahead is the whole test, and it is exact.** A declaration
   * head is always `union` followed by the type's *name*; nothing else in the
   * grammar puts a name immediately after a bare `union`, because Hexagon has no
   * juxtaposition — an application is `union(a, b)`, whose next token is
   * `LeftParen`, and a reference is `union` followed by an operator, a newline,
   * or nothing. So a name here means a declaration and anything else means a
   * term, at module level and inside a block alike.
   *
   * A *non-uppercase* name counts, and deliberately: `union foo = A | B` is a
   * declaration with the wrong name, and admitting it here is what keeps
   * `#parseUnion`'s "requires an uppercase type name" pointed at the real fault
   * instead of letting the line fall out of the item grammar entirely.
   */
  #atUnionHead(): boolean {
    if (!this.#atContextual("union")) return false;
    const next = this.#peek(1).kind;
    return next === "UpperName" || next === "NonUpperName";
  }

  #expectContextual(text: string, message: string): void {
    if (this.#atContextual(text)) this.#advance();
    else this.#error(message);
  }

  #parseVar(): Parsed.Item {
    const start = this.#advance();
    if (["LeftParen", "LeftBrace"].includes(this.#current().kind)) {
      this.#error("`var` binds a single name; destructure with `let` and copy");
      this.#synchronize(itemEnds);
      return { kind: "ErrorItem", span: spanFrom(start.span, this.#previous().span) };
    }
    const token = this.#takeName("NonUpperName", "`var` requires a non-uppercase-start name");
    if (token === undefined) {
      this.#synchronize(itemEnds);
      return { kind: "ErrorItem", span: spanFrom(start.span, this.#previous().span) };
    }
    let annotation: Parsed.TypeAnnotation | undefined;
    if (this.#at("Colon")) {
      this.#advance();
      annotation = this.#parseTypeAnnotation();
    }
    if (this.#expect("Equal", "expected `=` in `var` binding") === undefined) {
      this.#synchronize(itemEnds);
      return { kind: "ErrorItem", span: spanFrom(start.span, this.#previous().span) };
    }
    const value = this.#parseBodyExpression();
    return {
      kind: "Var",
      name: parsedName(token),
      ...(annotation === undefined ? {} : { annotation }),
      value,
      span: spanFrom(start.span, value.span),
    };
  }

  #parseBinding(
    bindingKind: "Let" | "Fun",
    exported: boolean,
    itemStart?: Source.Span,
  ): Parsed.Item {
    const start = this.#advance();
    const keyword = bindingKind === "Let" ? "let" : "fun";
    const nameToken = this.#takeName(
      "NonUpperName",
      `\`${keyword}\` requires a non-uppercase-start name`,
    );
    if (nameToken === undefined) {
      this.#synchronize(itemEnds);
      return { kind: "ErrorItem", span: spanFrom(start.span, this.#previous().span) };
    }

    let parameters: readonly Parsed.Parameter[] | undefined;
    let typeParameters: readonly Parsed.TypeParameter[] | undefined;
    let returnAnnotation: Parsed.TypeAnnotation | undefined;
    let bindingAnnotation: Parsed.TypeAnnotation | undefined;
    let parameterStartSpan: Source.Span | undefined;
    if (this.#at("Less")) {
      typeParameters = this.#parseTypeParameters();
    }
    let destructurings: readonly Destructuring[] = [];
    if (this.#at("LeftParen")) {
      parameterStartSpan = this.#current().span;
      ({ parameters, destructurings } = this.#parseParameters());
      if (this.#at("Colon")) {
        this.#advance();
        returnAnnotation = this.#parseTypeAnnotation();
      }
    } else if (bindingKind === "Let" && this.#at("Colon")) {
      this.#advance();
      bindingAnnotation = this.#parseTypeAnnotation();
    }

    if (
      this.#expect("Equal", `expected \`=\` in \`${keyword}\` binding`) ===
      undefined
    ) {
      this.#synchronize(itemEnds);
      return { kind: "ErrorItem", span: spanFrom(start.span, this.#previous().span) };
    }

    const body: Parsed.Expr = this.#parseBodyExpression();
    // This is the one position Functions §4.2 permits `<...>` on a lambda, so a lambda
    // arriving here has its restriction satisfied. A header form (`parameters` present)
    // has its own binders already and never reaches the pending set.
    if (parameters === undefined) this.#dischargeTypeParameterLambda(body);
    const value: Parsed.Expr = parameters === undefined
      ? body
      : {
          kind: "Lambda",
          parameters,
          ...(typeParameters === undefined ? {} : { typeParameters }),
          ...(returnAnnotation === undefined ? {} : { returnAnnotation }),
          ...this.#lambdaDestructurings(destructurings),
          body,
          span: spanFrom(parameterStartSpan ?? nameToken.span, body.span),
        };

    const common = {
      exported,
      name: parsedName(nameToken),
      span: spanFrom(itemStart ?? start.span, value.span),
    };
    if (bindingKind === "Let") {
      return {
        kind: "Let",
        ...common,
        ...(bindingAnnotation === undefined
          ? {}
          : { annotation: bindingAnnotation }),
        value,
      };
    }
    if (value.kind === "Lambda") return { kind: "Fun", ...common, value };

    this.#errorAt(
      value.span,
      "`fun` requires a function header or lambda literal on its right-hand side",
    );
    return {
      kind: "ErrorItem",
      span: spanFrom(itemStart ?? start.span, value.span),
    };
  }

  #parseTypeParameters(): readonly Parsed.TypeParameter[] {
    this.#advance();
    const parameters: Parsed.TypeParameter[] = [];
    const seen = new Set<string>();
    while (!this.#at("Greater") && !this.#at("Eof")) {
      const token = this.#takeName("NonUpperName", "type parameters must be non-uppercase-start names");
      if (token === undefined) break;
      const name = parsedName(token);
      if (seen.has(name.text)) this.#errorAt(name.span, `duplicate type parameter \`${name.text}\``);
      seen.add(name.text);
      if (!this.#at("Colon")) {
        parameters.push({ name, constraints: [], span: name.span });
        if (!this.#at("Comma")) break;
        this.#advance();
        continue;
      }
      this.#advance();
      const constraints = this.#parseConstraintList();
      parameters.push({
        name,
        constraints,
        span: spanFrom(name.span, constraints.at(-1)?.span ?? name.span),
      });
      if (!this.#at("Comma")) break;
      this.#advance();
    }
    this.#expect("Greater", "expected `>` after type parameters");
    return parameters;
  }

  #parseDerives(): readonly Parsed.Name[] {
    if (!this.#atContextual("derives")) return [];
    this.#advance();
    const derives: Parsed.Name[] = [];
    const parenthesized = this.#at("LeftParen");
    if (parenthesized) this.#advance();
    while (!this.#at("Eof")) {
      const token = this.#takeName("UpperName", "`derives` requires a constraint name");
      if (token === undefined) break;
      const name = parsedName(token);
      if (derives.some(({ text }) => text === name.text)) {
        this.#errorAt(name.span, `\`${name.text}\` appears more than once in \`derives\``);
      }
      derives.push(name);
      if (!parenthesized || !this.#at("Comma")) break;
      this.#advance();
    }
    if (parenthesized) this.#expect("RightParen", "expected `)` after `derives` constraints");
    return derives;
  }

  /**
   * A variance sigil at a type-parameter position (Declarations Preamble §2.1).
   * `+a` and `-a` are legal only on a parameterized `export opaque` record or
   * union: what crosses an opaque boundary must be declared, and there is
   * nothing to declare where the definition is public (closure doc §6.1, §9.6).
   *
   * The sigil is consumed either way, so the parameter after it still parses and
   * the author gets one report rather than a cascade.
   *
   * That covers a sigil, and only a sigil. `Box(++a)` is not a doubled one —
   * `++` is the concatenation operator's own token (Lexer §3) — so it never
   * reaches here and recovers as any other token that cannot start a parameter
   * would, with the parameter list's ordinary messages. There is no doubled
   * sigil in the grammar to report better.
   *
   * The gate is `opaque`, not `exported && opaque`, and the two coincide: bare
   * `opaque` is not a form — the keyword only ever follows `export` — so every
   * caller that can pass `true` here has already seen `export opaque`.
   */
  #takeVarianceSigil(
    opaque: boolean,
  ): { readonly claim: "co" | "contra"; readonly span: Source.Span } | undefined {
    if (!this.#at("Plus") && !this.#at("Minus")) return undefined;
    const claim = this.#at("Plus") ? "co" : "contra";
    const token = this.#advance();
    if (opaque) return { claim, span: token.span };
    // Declarations Preamble §2.1's normative text, verbatim. A second exit —
    // "or declare this type `export opaque`" — reads helpful and is not: it
    // invites an author to change what a type *is* to satisfy a sigil they had
    // no reason to write, and the Preamble already named the rewrite.
    this.#errorAt(
      token.span,
      `variance is inferred for transparent types; remove the \`${claim === "co" ? "+" : "-"}\``,
    );
    return undefined;
  }

  /**
   * A sigil written at a *use* site. Variance is a property of the constructor,
   * fixed once at its declaration; it is not part of any type expression, so
   * there is no "dropping" a sigil at an annotation — no annotation ever carries
   * one (closure doc §5.4).
   *
   * Called from one place: a constructor's argument list. That is the only
   * position where a sigil is close enough to legal to be worth a bespoke
   * message — elsewhere (`+` before a bare type name, say) `+` is an operator
   * token and the ordinary expected-a-type diagnostic already fires.
   *
   * The message names one rewrite and shows no corrected spelling. It used to
   * append ``write `Box(Int)` ``, built from the token after the sigil, which is
   * the whole argument list only at arity 1: `Pair(+Int, String)` was told to
   * write `Pair(Int)`, and three of the four shapes the 2026-08-01 cold review
   * tried produced a fresh error when applied. Declarations Preamble §2.1 struck
   * the clause (closure doc §13.5) rather than have the parser re-print an
   * argument list it holds only as kind-tagged tokens: with the caret on the
   * sigil, "remove the `+`" is already an exact single-token edit, correct at
   * every arity and nesting depth.
   */
  #rejectVarianceSigilAtUse(): void {
    if (!this.#at("Plus") && !this.#at("Minus")) return;
    const sigil = this.#at("Plus") ? "+" : "-";
    // Declarations Preamble §2.1's diagnostics row, verbatim.
    this.#errorAt(
      this.#advance().span,
      `remove the \`${sigil}\` — variance is declared on the type's declaration, ` +
        "never written at a use site",
    );
  }

  /**
   * The same, where no declaration form admits a sigil at all (`type`). One
   * message for all three forms, as Declarations Preamble §2.1 writes it: an
   * alias is transparent by definition, so the reason is the reason given.
   */
  #rejectVarianceSigil(): void {
    if (!this.#at("Plus") && !this.#at("Minus")) return;
    const sigil = this.#at("Plus") ? "+" : "-";
    this.#errorAt(
      this.#advance().span,
      `variance is inferred for transparent types; remove the \`${sigil}\``,
    );
  }

  #parseTypeAlias(exported: boolean, itemStart?: Source.Span): Parsed.Item {
    const start = this.#advance();
    const nameToken = this.#takeName("UpperName", "`type` requires an uppercase type name");
    if (nameToken === undefined) {
      this.#synchronize(itemEnds);
      return { kind: "ErrorItem", span: spanFrom(start.span, this.#previous().span) };
    }
    const parameters: Parsed.Name[] = [];
    if (this.#at("LeftParen")) {
      this.#advance();
      const seen = new Set<string>();
      while (!this.#at("RightParen") && !this.#at("Eof")) {
        this.#rejectVarianceSigil();
        const token = this.#takeName("NonUpperName", "alias parameters must be non-uppercase-start names");
        if (token === undefined) break;
        const parameter = parsedName(token);
        if (seen.has(parameter.text)) this.#errorAt(parameter.span, `duplicate type parameter \`${parameter.text}\``);
        seen.add(parameter.text);
        parameters.push(parameter);
        if (!this.#at("Comma")) break;
        this.#advance();
      }
      this.#expect("RightParen", "expected `)` after alias parameters");
      if (parameters.length === 0) this.#errorAt(nameToken.span, "generic alias parameter list cannot be empty");
    }
    this.#expect("Equal", "expected `=` after type alias name");
    const annotation = this.#parseTypeAnnotation();
    if (annotation === undefined) {
      this.#synchronize(itemEnds);
      return { kind: "ErrorItem", span: spanFrom(itemStart ?? start.span, this.#previous().span) };
    }
    return {
      kind: "TypeAlias",
      exported,
      name: parsedName(nameToken),
      parameters,
      annotation,
      span: spanFrom(itemStart ?? start.span, annotation.span),
    };
  }

  #parseUnion(exported: boolean, itemStart?: Source.Span, opaque = false): Parsed.Item {
    const start = this.#advance();
    const nameToken = this.#takeName(
      "UpperName",
      "`union` requires an uppercase type name",
    );
    if (nameToken === undefined) {
      this.#synchronize(itemEnds);
      return { kind: "ErrorItem", span: spanFrom(start.span, this.#previous().span) };
    }
    const parameters: Parsed.Name[] = [];
    const declaredParameters: Parsed.DeclaredTypeParameter[] = [];
    if (this.#at("LeftParen")) {
      this.#advance();
      const seen = new Set<string>();
      while (!this.#at("RightParen") && !this.#at("Eof")) {
        const sigil = this.#takeVarianceSigil(opaque);
        const parameter = this.#takeName(
          "NonUpperName",
          "union type parameters must be non-uppercase-start names",
        );
        if (parameter === undefined) break;
        const name = parsedName(parameter);
        if (seen.has(name.text)) {
          this.#errorAt(name.span, `duplicate type parameter \`${name.text}\``);
        }
        seen.add(name.text);
        parameters.push(name);
        declaredParameters.push({
          name: name.text,
          ...(sigil === undefined ? {} : { claim: sigil.claim }),
          span: sigil === undefined ? name.span : spanFrom(sigil.span, name.span),
        });
        if (!this.#at("Comma")) break;
        this.#advance();
      }
      this.#expect("RightParen", "expected `)` after union type parameters");
      if (parameters.length === 0) {
        this.#errorAt(nameToken.span, "generic union parameter list cannot be empty");
      }
    }
    const derives = this.#parseDerives();
    if (this.#expect("Equal", "expected `=` after union name") === undefined) {
      this.#synchronize(itemEnds);
      return { kind: "ErrorItem", span: spanFrom(start.span, this.#previous().span) };
    }
    // An alternative begins at its leading `|`, or at the constructor name
    // where no `|` precedes (§4.2) — so the offset a doc block would match is
    // captured before either is consumed.
    let alternative = this.#current().span.start.offset;
    if (this.#at("Bar")) this.#advance();

    const constructors: Parsed.Constructor[] = [];
    while (!itemEnds.has(this.#current().kind)) {
      const constructor = this.#takeName(
        "UpperName",
        "union constructors must be uppercase-start names",
      );
      if (constructor === undefined) {
        this.#synchronize(itemEnds);
        return { kind: "ErrorItem", span: spanFrom(start.span, this.#previous().span) };
      }
      const name = parsedName(constructor);
      const slots: Parsed.ConstructorSlot[] = [];
      let end = name.span;
      if (this.#at("LeftParen")) {
        const opening = this.#advance();
        while (!this.#at("RightParen") && !this.#at("Eof")) {
          const slotStart = this.#current();
          let slotName: Parsed.Name | undefined;
          if (slotStart.kind === "NonUpperName" && this.#peek(1).kind === "Colon") {
            this.#advance();
            this.#advance();
            slotName = parsedName(slotStart);
          }
          const annotation = this.#parseTypeAnnotation();
          if (annotation === undefined) {
            this.#synchronize(new Set(["Comma", "RightParen", ...structuralEnds]));
            break;
          }
          slots.push({
            ...(slotName === undefined ? {} : { name: slotName }),
            annotation,
            span: spanFrom(slotStart.span, annotation.span),
          });
          if (!this.#at("Comma")) break;
          this.#advance();
        }
        const closing = this.#expect("RightParen", "expected `)` after constructor payload");
        end = closing?.span ?? slots.at(-1)?.span ?? opening.span;
        if (slots.length === 0) this.#errorAt(opening.span, "constructor payload cannot be empty");
        const named = slots.filter((slot) => slot.name !== undefined);
        if (named.length !== 0 && named.length !== slots.length) {
          this.#errorAt(opening.span, "constructor payload slots must be all named or all unnamed");
        }
        const names = new Set<string>();
        for (const slot of named) {
          const text = slot.name!.text;
          if (text === "tag") this.#errorAt(slot.name!.span, "`tag` is reserved for union discrimination");
          if (names.has(text)) this.#errorAt(slot.name!.span, `duplicate payload slot \`${text}\``);
          names.add(text);
        }
      }
      constructors.push({ name, slots, span: spanFrom(name.span, end) });
      // Constructor documentation rides the constructor, whose identity
      // downstream is its declared name (§7.1: it emits on the materialized
      // constructor, not on the union type's arm).
      this.#docs.attach(alternative, name.span, [name.span]);
      if (!this.#at("Bar")) break;
      alternative = this.#current().span.start.offset;
      this.#advance();
    }
    if (constructors.length === 0) {
      this.#errorAt(nameToken.span, "a union needs at least one constructor");
    }
    return {
      kind: "Union",
      exported,
      opaque,
      name: parsedName(nameToken),
      parameters,
      declaredParameters,
      derives,
      constructors,
      span: spanFrom(
        itemStart ?? start.span,
        constructors.at(-1)?.span ?? nameToken.span,
      ),
    };
  }

  #parseRecordDeclaration(exported: boolean, itemStart?: Source.Span, opaque = false): Parsed.Item {
    const start = this.#advance();
    const nameToken = this.#takeName("UpperName", "`record` requires an uppercase type name");
    if (nameToken === undefined) {
      this.#synchronize(itemEnds);
      return { kind: "ErrorItem", span: spanFrom(start.span, this.#previous().span) };
    }
    const parameters: Parsed.Name[] = [];
    const declaredParameters: Parsed.DeclaredTypeParameter[] = [];
    if (this.#at("LeftParen")) {
      this.#advance();
      const seen = new Set<string>();
      while (!this.#at("RightParen") && !this.#at("Eof")) {
        const sigil = this.#takeVarianceSigil(opaque);
        const parameter = this.#takeName("NonUpperName", "record type parameters must be non-uppercase-start names");
        if (parameter === undefined) break;
        const name = parsedName(parameter);
        if (seen.has(name.text)) this.#errorAt(name.span, `duplicate type parameter \`${name.text}\``);
        seen.add(name.text);
        parameters.push(name);
        declaredParameters.push({
          name: name.text,
          ...(sigil === undefined ? {} : { claim: sigil.claim }),
          span: sigil === undefined ? name.span : spanFrom(sigil.span, name.span),
        });
        if (!this.#at("Comma")) break;
        this.#advance();
      }
      this.#expect("RightParen", "expected `)` after record type parameters");
      if (parameters.length === 0) this.#errorAt(nameToken.span, "generic record parameter list cannot be empty");
    }
    const derives = this.#parseDerives();
    if (this.#expect("Equal", "expected `=` after record name") === undefined ||
        this.#expect("LeftBrace", "expected `{` after record `=`") === undefined) {
      this.#synchronize(itemEnds);
      return { kind: "ErrorItem", span: spanFrom(start.span, this.#previous().span) };
    }
    const fields: Parsed.RecordTypeField[] = [];
    const seen = new Set<string>();
    while (!this.#at("RightBrace") && !this.#at("Eof")) {
      const fieldStart = this.#current().span.start.offset;
      const fieldToken = this.#takeName("NonUpperName", "record fields must be non-uppercase-start names");
      if (fieldToken === undefined) break;
      this.#expect("Colon", "expected `:` after record field name");
      const annotation = this.#parseTypeAnnotation();
      if (annotation === undefined) break;
      const name = parsedName(fieldToken);
      if (seen.has(name.text)) this.#errorAt(name.span, `duplicate record field \`${name.text}\``);
      seen.add(name.text);
      const field = { name, annotation, span: spanFrom(name.span, annotation.span) };
      fields.push(field);
      this.#docs.attach(fieldStart, field.span, [name.span]);
      if (!this.#at("Comma")) break;
      this.#advance();
    }
    const closing = this.#expect("RightBrace", "expected `}` after record fields");
    return {
      kind: "RecordDeclaration",
      exported,
      opaque,
      name: parsedName(nameToken),
      parameters,
      declaredParameters,
      derives,
      fields,
      span: spanFrom(
        itemStart ?? start.span,
        closing?.span ?? fields.at(-1)?.span ?? nameToken.span,
      ),
    };
  }

  #parseException(exported: boolean, itemStart?: Source.Span): Parsed.Item {
    const start = this.#advance();
    const nameToken = this.#takeName("UpperName", "`exception` requires an uppercase-start name");
    if (nameToken === undefined) {
      this.#synchronize(itemEnds);
      return { kind: "ErrorItem", span: spanFrom(start.span, this.#previous().span) };
    }
    const slots: Parsed.ConstructorSlot[] = [];
    let end = nameToken.span;
    if (this.#at("LeftParen")) {
      const opening = this.#advance();
      while (!this.#at("RightParen") && !this.#at("Eof")) {
        const slotStart = this.#current();
        let slotName: Parsed.Name | undefined;
        if (slotStart.kind === "NonUpperName" && this.#peek(1).kind === "Colon") {
          this.#advance();
          this.#advance();
          slotName = parsedName(slotStart);
        }
        const annotation = this.#parseTypeAnnotation();
        if (annotation === undefined) break;
        slots.push({
          ...(slotName === undefined ? {} : { name: slotName }),
          annotation,
          span: spanFrom(slotStart.span, annotation.span),
        });
        if (!this.#at("Comma")) break;
        this.#advance();
      }
      const closing = this.#expect("RightParen", "expected `)` after exception payload");
      end = closing?.span ?? slots.at(-1)?.span ?? opening.span;
      if (slots.length === 0) this.#errorAt(opening.span, "a nullary exception is written without `()`");
      const named = slots.filter((slot) => slot.name !== undefined);
      if (named.length !== 0 && named.length !== slots.length) {
        this.#errorAt(opening.span, "exception payload slots must be all named or all unnamed");
      }
      const names = new Set<string>();
      for (const slot of named) {
        const name = slot.name!;
        if (name.text === "name") {
          this.#errorAt(
            name.span,
            "`name` is reserved as the exception's discriminant field; rename this field",
          );
        } else if (name.text === "stack") {
          this.#errorAt(
            name.span,
            "`stack` is reserved for the exception's stack trace; rename this field",
          );
        }
        if (names.has(name.text)) this.#errorAt(name.span, `duplicate payload slot \`${name.text}\``);
        names.add(name.text);
      }
    }
    return {
      kind: "Exception",
      exported,
      name: parsedName(nameToken),
      slots,
      span: spanFrom(itemStart ?? start.span, end),
    };
  }

  #parsePatternBinding(): Parsed.Item {
    const start = this.#advance();
    const pattern = this.#parsePattern();
    if (pattern === undefined) {
      this.#synchronize(itemEnds);
      return { kind: "ErrorItem", span: spanFrom(start.span, this.#previous().span) };
    }
    if (this.#expect("Equal", "expected `=` after `let` pattern") === undefined) {
      this.#synchronize(itemEnds);
      return { kind: "ErrorItem", span: spanFrom(start.span, this.#previous().span) };
    }
    const value = this.#parseBodyExpression();
    return {
      kind: "LetPattern",
      exported: false,
      pattern,
      value,
      span: spanFrom(start.span, value.span),
    };
  }

  #parsePattern(): Parsed.Pattern | undefined {
    const first = this.#parseAtomicPattern();
    if (first === undefined) return undefined;
    const alternatives: Parsed.Pattern[] = [first];
    while (this.#at("Bar")) {
      this.#advance();
      const alternative = this.#parseAtomicPattern();
      if (alternative === undefined) return undefined;
      alternatives.push(alternative);
    }
    const pattern: Parsed.Pattern = alternatives.length === 1
      ? first
      : {
          kind: "Or",
          alternatives,
          span: spanFrom(first.span, alternatives.at(-1)!.span),
        };
    const operator = this.#current();
    if (operator.kind !== "NonUpperName" || operator.text !== "as") return pattern;
    this.#advance();
    const binder = this.#takeName(
      "NonUpperName",
      "`as` in a pattern requires a non-uppercase-start binding name",
    );
    if (binder === undefined) return undefined;
    const name = parsedName(binder);
    return {
      kind: "As",
      pattern,
      name,
      span: spanFrom(pattern.span, name.span),
    };
  }

  #parseAtomicPattern(): Parsed.Pattern | undefined {
    const token = this.#current();
    if (token.kind === "NonUpperName") {
      this.#advance();
      const name = parsedName(token);
      return { kind: "Binding", name, span: name.span };
    }
    if (token.kind === "Wildcard") {
      this.#advance();
      return { kind: "Wildcard", span: token.span };
    }
    if (token.kind === "True" || token.kind === "False") {
      // #147: the constructor patterns are `True`/`False`; these spellings are
      // reserved and carry the same one-token fixit they do in value position.
      this.#advance();
      this.#redirectBooleanWord(token, token.kind === "True" ? "true" : "false");
      return { kind: "Wildcard", span: token.span };
    }
    if (token.kind === "Integer") {
      this.#advance();
      return { kind: "Integer", decimal: token.decimal, span: token.span };
    }
    if (token.kind === "Minus" && this.#peek(1).kind === "Integer") {
      const minus = this.#advance();
      const integer = this.#advance() as Lexed.IntegerToken;
      return {
        kind: "Integer",
        decimal: `-${integer.decimal}`,
        span: spanFrom(minus.span, integer.span),
      };
    }
    if (token.kind === "Float") {
      this.#advance();
      this.#errorAt(
        token.span,
        "Float literals cannot appear in patterns; bind a name and compare it in a guard",
      );
      return undefined;
    }
    if (token.kind === "String") {
      this.#advance();
      if (token.parts.some(({ kind }) => kind === "Interpolation")) {
        this.#errorAt(token.span, "string interpolation cannot appear in a pattern");
      }
      return {
        kind: "String",
        value: token.parts.map((part) => part.kind === "Text" ? part.value : "").join(""),
        span: token.span,
      };
    }
    if (token.kind === "UpperName") {
      this.#advance();
      const name = parsedName(token);
      const args: Parsed.Pattern[] = [];
      let end = token.span;
      if (this.#at("LeftParen")) {
        this.#advance();
        while (!this.#at("RightParen") && !this.#at("Eof")) {
          const argument = this.#parsePattern();
          if (argument === undefined) return undefined;
          args.push(argument);
          if (!this.#at("Comma")) break;
          this.#advance();
        }
        end = this.#expect(
          "RightParen",
          "expected `)` after constructor pattern",
        )?.span ?? end;
      }
      return {
        kind: "Constructor",
        name,
        arguments: args,
        span: spanFrom(token.span, end),
      };
    }
    if (token.kind === "LeftBracket") {
      const opening = this.#advance();
      const elements: Parsed.Pattern[] = [];
      let rest: Parsed.VectorPattern["rest"];
      while (!this.#at("RightBracket") && !this.#at("Eof")) {
        if (this.#at("Spread")) {
          const spread = this.#advance();
          if (rest !== undefined) {
            this.#errorAt(spread.span, "a vector pattern may contain at most one `...`");
          }
          let pattern: Parsed.Pattern | undefined;
          if (!this.#at("Comma") && !this.#at("RightBracket")) {
            pattern = this.#parsePattern();
          }
          rest = {
            ...(pattern === undefined ? {} : { pattern }),
            index: elements.length,
            span: spanFrom(spread.span, pattern?.span ?? spread.span),
          };
        } else {
          elements.push(this.#parsePattern() ?? { kind: "Wildcard", span: this.#current().span });
        }
        if (!this.#at("Comma")) break;
        this.#advance();
      }
      const closing = this.#expect("RightBracket", "expected `]` after vector pattern");
      return {
        kind: "Vector",
        elements,
        ...(rest === undefined ? {} : { rest }),
        span: spanFrom(opening.span, closing?.span ?? rest?.span ?? elements.at(-1)?.span ?? opening.span),
      };
    }
    if (token.kind === "LeftBrace") {
      const opening = this.#advance();
      const fields: Parsed.RecordPatternField[] = [];
      const seen = new Set<string>();
      while (!this.#at("RightBrace") && !this.#at("Eof")) {
        const field = this.#takeName("NonUpperName", "record patterns contain non-uppercase-start field names");
        if (field === undefined) return undefined;
        const name = parsedName(field);
        if (seen.has(name.text)) this.#errorAt(name.span, `duplicate record pattern field \`${name.text}\``);
        seen.add(name.text);
        let pattern: Parsed.Pattern = {
          kind: "Binding",
          name,
          span: name.span,
        };
        if (this.#recordFieldSeparator(name.text, true) !== undefined) {
          const nested = this.#parsePattern();
          if (nested === undefined) return undefined;
          pattern = nested;
        }
        fields.push({
          name,
          pattern,
          span: spanFrom(name.span, pattern.span),
        });
        if (!this.#at("Comma")) break;
        this.#advance();
      }
      const closing = this.#expect("RightBrace", "expected `}` after record pattern");
      return {
        kind: "Record",
        fields,
        span: spanFrom(opening.span, closing?.span ?? fields.at(-1)?.span ?? opening.span),
      };
    }
    if (token.kind !== "LeftParen") {
      this.#error("expected a binding, `_`, constructor, tuple, or record pattern");
      return undefined;
    }

    const opening = this.#advance();
    if (this.#at("RightParen")) {
      const closing = this.#advance();
      return { kind: "Unit", span: spanFrom(opening.span, closing.span) };
    }
    const first = this.#parsePattern();
    if (first === undefined) return undefined;
    if (!this.#at("Comma")) {
      const closing = this.#expect("RightParen", "expected `)` after pattern");
      return { ...first, span: spanFrom(opening.span, closing?.span ?? first.span) };
    }
    const elements: Parsed.Pattern[] = [first];
    while (this.#at("Comma")) {
      const comma = this.#advance();
      if (this.#at("RightParen")) {
        this.#errorAt(comma.span, "a tuple pattern needs a pattern after `,`");
        this.#advance();
        return undefined;
      }
      const element = this.#parsePattern();
      if (element === undefined) return undefined;
      elements.push(element);
    }
    const closing = this.#expect("RightParen", "expected `)` after tuple pattern");
    return {
      kind: "Tuple",
      elements,
      span: spanFrom(opening.span, closing?.span ?? elements.at(-1)!.span),
    };
  }

  #parseExpression(
    minimumBindingPower = 0,
    stops: ReadonlySet<TokenKind> = itemEnds,
    /**
     * Whether a mark may end this expression with no argument list of its own.
     * True for a `|>` stage and nowhere else (#355 ruling 1): the rewrite is
     * what supplies that call's arguments, so the stage is a call-in-waiting.
     */
    stageMarkAllowed = false,
  ): Parsed.Expr {
    const effectiveStops = withStops(stops, ...structuralEnds);
    let left = this.#parsePrefix(effectiveStops);

    while (!effectiveStops.has(this.#current().kind)) {
      if (this.#at("Bang") || this.#at("Question")) {
        const mark = this.#at("Bang") ? "bang" : "question";
        const token = this.#advance();
        // Lexer §8.1: a mark is written *glued* — to the callee it marks, and to
        // the `(` it governs. Whitespace on either side is the same defect the
        // seat rule reports, because a floating mark is exactly a mark with no
        // argument list it visibly belongs to.
        const gluedToCallee = token.span.start.offset === left.span.end.offset;
        if (this.#at("LeftParen")) {
          if (gluedToCallee && this.#current().span.start.offset === token.span.end.offset) {
            left = this.#parseCall(left, mark, token.span);
            continue;
          }
          this.#errorAt(token.span, markSeatError);
          // Parsed as the call it plainly is, so one spacing slip reports once.
          left = this.#parseCall(left, mark, token.span);
          continue;
        }
        if (stageMarkAllowed) {
          if (gluedToCallee) {
            this.#stageMark = { mark, span: token.span };
            break;
          }
          this.#errorAt(token.span, markSeatError);
          this.#stageMark = { mark, span: token.span };
          break;
        }
        this.#errorAt(token.span, markSeatError);
        continue;
      }
      if (minimumBindingPower <= 12) {
        if (this.#at("LeftParen")) {
          left = this.#parseCall(left);
          continue;
        }
        if (this.#at("Dot")) {
          left = this.#parseAccess(left);
          continue;
        }
        if (this.#at("LeftBracket")) {
          left = this.#parseIndex(left);
          continue;
        }
      }

      const operation = infix.get(this.#current().kind);
      if (operation === undefined || operation.leftBindingPower < minimumBindingPower) {
        break;
      }

      const token = this.#advance();
      const pipeStage = operation.operator === "Pipe";
      const right = this.#parseExpression(
        operation.rightBindingPower,
        effectiveStops,
        pipeStage,
      );
      const stageMark = pipeStage ? this.#stageMark : undefined;
      if (pipeStage) this.#stageMark = undefined;
      if (operation.assignment === true) {
        if (left.kind === "Assignment") {
          this.#errorAt(token.span, "`:=` does not chain; assignment produces `Unit`");
        }
        left = {
          kind: "Assignment",
          target: left,
          value: right,
          span: spanFrom(left.span, right.span),
        };
      } else if (operation.comparison !== undefined) {
        left = left.kind === "Comparison"
          ? {
              kind: "Comparison",
              operands: [...left.operands, right],
              operators: [...left.operators, operation.comparison],
              span: spanFrom(left.span, right.span),
            }
          : {
              kind: "Comparison",
              operands: [left, right],
              operators: [operation.comparison],
              span: spanFrom(left.span, right.span),
            };
      } else {
        const operator = requiredOperator(operation, token);
        if (
          operator === "Range" &&
          left.kind === "Binary" &&
          left.operator === "Range"
        ) {
          this.#errorAt(token.span, "`..` does not chain; write separate ranges");
        }
        left = {
          kind: "Binary",
          operator,
          left,
          right,
          ...(stageMark === undefined
            ? {}
            : { mark: stageMark.mark, markSpan: stageMark.span }),
          span: spanFrom(left.span, stageMark?.span ?? right.span),
        };
      }
    }

    return left;
  }

  #parsePrefix(stops: ReadonlySet<TokenKind>): Parsed.Expr {
    // No lambda may start where the next `=>` is already spoken for (§6.5's guard pin,
    // `#arrowIsClaimed`) — it belongs to the arm, and eating it strands the arm.
    if (!this.#arrowIsClaimed(stops)) {
      if (this.#atPatternParameterLambda()) {
        return this.#parsePatternParameterLambda(stops);
      }
      if (this.#atTypeParameterLambda()) {
        const start = this.#current().span;
        const typeParameters = this.#parseTypeParameters();
        const lambda = this.#parseLambda(stops, typeParameters, start);
        this.#pendingTypeParameterLambdas.set(lambda, start);
        return lambda;
      }
      if (this.#isParenthesizedLambda()) {
        return this.#parseLambda(stops);
      }
    }
    if (this.#at("Minus")) {
      const start = this.#advance();
      const operand = this.#parseExpression(10, stops);
      return {
        kind: "Unary",
        operator: "Negate",
        operand,
        span: spanFrom(start.span, operand.span),
      };
    }
    if (this.#at("Not")) {
      const start = this.#advance();
      const operand = this.#parseExpression(6, stops);
      return {
        kind: "Unary",
        operator: "Not",
        operand,
        span: spanFrom(start.span, operand.span),
      };
    }
    if (this.#at("Bang") || this.#at("Question")) {
      // Effects §9's two prefix rows, chosen by which mark it is. A mark governs an
      // argument list and an argument list follows something, so a mark *here*
      // has no call to speak for. A `!` in this seat is the negation the scanner
      // used to redirect before the marks made it a token, and the redirect is
      // the parser's now (Lexer §8.2); a `?` never had that reading and takes
      // the mark-position row.
      const token = this.#advance();
      this.#errorAt(
        token.span,
        token.kind === "Bang" ? "Hexagon spells logical negation `not`" : markSeatError,
      );
      // Recovery keeps the operand: the writer's expression is what follows, and
      // reporting it missing on top of the redirect would say the same mistake
      // twice.
      return this.#parseExpression(6, stops);
    }
    if (this.#at("If")) {
      return this.#parseIf(stops);
    }
    if (this.#at("While")) {
      return this.#parseWhile(stops);
    }
    if (this.#at("For")) {
      return this.#parseFor(stops);
    }
    if (this.#at("Match")) {
      return this.#parseMatch(stops);
    }
    if (this.#at("Try")) {
      return this.#parseTry(stops);
    }

    return this.#parsePrimary(stops);
  }

  #parsePrimary(stops: ReadonlySet<TokenKind>): Parsed.Expr {
    const token = this.#current();
    switch (token.kind) {
      case "NonUpperName":
      case "UpperName":
        this.#advance();
        return { kind: "Name", name: parsedName(token), span: token.span };
      case "True":
      case "False": {
        // #147: not a literal any more — a reserved spelling with a fixit.
        this.#advance();
        this.#redirectBooleanWord(token, token.kind === "True" ? "true" : "false");
        return { kind: "ErrorExpr", span: token.span };
      }
      case "Integer":
        this.#advance();
        return { kind: "Integer", decimal: token.decimal, span: token.span };
      case "BigInt":
        this.#advance();
        return { kind: "BigInt", decimal: token.decimal, span: token.span };
      case "Float":
        this.#advance();
        return {
          kind: "Float",
          spelling: token.spelling,
          value: token.value,
          span: token.span,
        };
      case "String":
        this.#advance();
        return this.#parseString(token);
      case "LeftBracket":
        return this.#parseVector(stops);
      case "LeftParen":
        return this.#parseParenthesized(stops);
      case "LeftBrace":
        return this.#parseRecord(stops);
      default:
        this.#error(`expected an expression, found ${describe(token.kind)}`);
        if (!stops.has(token.kind)) {
          this.#advance();
        }
        return { kind: "ErrorExpr", span: token.span };
    }
  }

  /** Parses eager vector literals; spread is deliberately pattern-only in v1. */
  #parseVector(stops: ReadonlySet<TokenKind>): Parsed.VectorExpr {
    const opening = this.#advance();
    const elements: Parsed.Expr[] = [];
    while (!this.#at("RightBracket") && !this.#at("Eof")) {
      if (this.#at("Spread")) {
        const spread = this.#advance();
        this.#errorAt(
          spread.span,
          "spread is vector-pattern syntax; use a named Vector operation to combine values",
        );
      }
      elements.push(this.#parseExpression(0, insideBrackets(stops, "Comma", "RightBracket")));
      if (!this.#at("Comma")) break;
      this.#advance();
    }
    const closing = this.#expect("RightBracket", "expected `]` after vector elements");
    return {
      kind: "Vector",
      elements,
      span: spanFrom(opening.span, closing?.span ?? elements.at(-1)?.span ?? opening.span),
    };
  }

  /**
   * Term braces hold three forms (Products §3.3/§9): the literal `{x = e}`, the bare copy
   * `{...p}`, and the functional update `{p with x = e}`. Update and copy share one AST
   * node — the head becomes `spread`, which is exactly what both emit — so only the
   * surface grammar distinguishes them. The retired JS idioms (`{...p, x = e}` and
   * `{...a, ...b}`) parse on after their permanent §6 fixit, so one habit yields one error.
   */
  #parseRecord(stops: ReadonlySet<TokenKind>): Parsed.Expr {
    const opening = this.#advance();
    const innerStops = insideBrackets(stops, "Comma", "RightBrace");
    let spread: Parsed.Expr | undefined;
    let update = false;
    let retiredSpread = false;
    const fields: Parsed.RecordField[] = [];
    const names = new Set<string>();
    if (this.#atRecordUpdate()) {
      const head = this.#parseExpression(0, innerStops);
      if (!isDottedPath(head)) {
        this.#errorAt(
          head.span,
          "a record update head must be a name or a dotted path; bind the base first: `let base = f(x)`",
        );
      }
      // The head expression may have stopped short of the `with` the scan found; skipping
      // to it keeps the overrides parsing under the one error already reported.
      while (!this.#atContextual("with") && !this.#at("RightBrace") && !this.#at("Eof")) {
        this.#advance();
      }
      if (this.#atContextual("with")) this.#advance();
      spread = head;
      update = true;
    } else if (this.#at("Spread")) {
      this.#advance();
      spread = this.#parseExpression(0, innerStops);
      if (this.#at("Comma")) this.#advance();
      if (!this.#at("RightBrace") && !this.#at("Eof")) {
        this.#reportRetiredSpread(this.#at("Spread"));
        retiredSpread = true;
        update = true;
      }
    }
    while (!this.#at("RightBrace") && !this.#at("Eof")) {
      if (this.#at("Spread")) {
        // A spread reached from the field loop is the same retired habit; report it once
        // per brace, then consume it so the surrounding fields still parse.
        if (!retiredSpread) {
          this.#reportRetiredSpread(spread !== undefined);
          retiredSpread = true;
        }
        this.#advance();
        this.#parseExpression(0, innerStops);
        if (this.#at("Comma")) this.#advance();
        continue;
      }
      const token = this.#takeName("NonUpperName", "record fields must be non-uppercase-start names");
      if (token === undefined) break;
      const name = parsedName(token);
      const separator = this.#recordFieldSeparator(name.text, false);
      let value: Parsed.Expr;
      if (separator === undefined) {
        value = { kind: "Name", name, span: name.span };
      } else {
        value = this.#parseExpression(0, insideBrackets(stops, "Comma", "RightBrace"));
      }
      const punned = separator === undefined;
      if (names.has(name.text)) this.#errorAt(name.span, `duplicate record field \`${name.text}\``);
      names.add(name.text);
      fields.push({ name, punned, value, span: spanFrom(name.span, value.span) });
      if (!this.#at("Comma")) break;
      this.#advance();
    }
    const closing = this.#expect("RightBrace", "expected `}` after record fields");
    const span = spanFrom(opening.span, closing?.span ?? fields.at(-1)?.span ?? opening.span);
    if (update && fields.length === 0 && !retiredSpread) {
      this.#errorAt(span, "a record update needs at least one override; the no-override copy is `{...p}`");
    }
    return {
      kind: "Record",
      ...(spread === undefined ? {} : { spread }),
      fields,
      span,
    };
  }

  /**
   * The two retired spread idioms (Products §6). Two spreads in one brace is JS's merge;
   * anything else a spread carries is the spread-spelled update. Both are permanent
   * diagnostics — the habits outlive the syntax that once accepted them.
   */
  #reportRetiredSpread(merge: boolean): void {
    this.#error(
      merge
        ? "Hexagon has no record merge; `{...p}` copies, `{p with f = e}` updates"
        : "records update with `with`: `{p with x = 3.0}`; `{...p}` alone is the copy/crossing",
    );
  }

  /**
   * Products §3.3: a term brace is an update when the contextual word `with` stands at the
   * brace's own nesting depth, after a head and before its overrides — the decision is one
   * token past the head path. `with` is contextual, never reserved: it is a *field* when
   * `=`, `,`, or `}` follows (`{with = 3}`, `{with}`), and a *value* when the token before
   * it cannot end an expression (`{x = with}`). A `with` inside a nested literal belongs to
   * that literal, and the scan stops at the first override separator, so a later field's
   * `with` is never mistaken for this brace's.
   */
  #atRecordUpdate(): boolean {
    let depth = 0;
    for (let distance = 0; ; distance += 1) {
      const token = this.#peek(distance);
      if (token.kind === "Eof") return false;
      if (opensNesting.has(token.kind)) depth += 1;
      else if (closesNesting.has(token.kind)) {
        if (depth === 0) return false; // this brace's own `}`
        depth -= 1;
      } else if (depth === 0) {
        if (token.kind === "Comma") return false;
        if (distance > 0 && token.kind === "NonUpperName" && token.text === "with") {
          const before = this.#peek(distance - 1).kind;
          const after = this.#peek(distance + 1).kind;
          if (endsExpression.has(before) && (after === "NonUpperName" || after === "RightBrace")) {
            return true;
          }
        }
      }
    }
  }

  #parseString(token: Lexed.StringToken): Parsed.StringExpr {
    const parts: Parsed.StringPart[] = token.parts.map((part) => {
      if (part.kind === "Text") {
        return { kind: "Text", value: part.value, span: part.span };
      }
      const expression = new Parser(
        part.tokens,
        this.#diagnostics,
        DocBlocks.none(this.#diagnostics),
      ).parseStandaloneExpression();
      return { kind: "Interpolation", expression, span: part.span };
    });
    return { kind: "String", parts, span: token.span };
  }

  /**
   * The parenthesized form: `()`, a group, an ascription, or a tuple
   * (Ascription §2.1, Products §2.1). Every element is `expression (: Type)?`;
   * one *ascribed* element is the ascription expression, and the rest is
   * unchanged — there are no 1-tuples, so `(e)` can only be grouping and
   * `(e: T)` can only be ascription (§2.1's conflict-free argument).
   */
  #parseParenthesized(stops: ReadonlySet<TokenKind>): Parsed.Expr {
    const opening = this.#advance();
    if (this.#at("RightParen")) {
      const closing = this.#advance();
      return { kind: "Unit", span: spanFrom(opening.span, closing.span) };
    }

    const expression = this.#parseElement(stops);
    if (this.#at("Comma")) {
      const elements: Parsed.Expr[] = [expression];
      while (this.#at("Comma")) {
        const comma = this.#advance();
        if (this.#at("RightParen")) {
          this.#errorAt(comma.span, "a tuple needs an expression after `,`");
          const closing = this.#advance();
          return { kind: "ErrorExpr", span: spanFrom(opening.span, closing.span) };
        }
        elements.push(this.#parseElement(stops));
      }
      const closing = this.#expect("RightParen", "expected `)` after tuple elements");
      return {
        kind: "Tuple",
        elements,
        span: spanFrom(opening.span, closing?.span ?? elements.at(-1)!.span),
      };
    }
    const closing = this.#expect("RightParen", "expected `)` after expression");
    if (expression.kind === "Ascription") {
      // The group parentheses *are* the ascription's delimiters (§2.1): wrapping
      // it in a `Group` too would leave two nodes where the source wrote one
      // form, and every read-through would have to know about both.
      return { ...expression, span: spanFrom(opening.span, closing?.span ?? expression.span) };
    }
    return {
      kind: "Group",
      expression,
      span: spanFrom(opening.span, closing?.span ?? expression.span),
    };
  }

  /**
   * One parenthesized element: `expression (: Type)?` (Ascription §2.1).
   *
   * The colon binds loosest within the element (§2.2) — it ends whatever
   * expression form is open, the eats-right forms included — which falls out of
   * parsing the element expression to completion first: `Colon` already halts
   * the expression loop, so the whole element is in hand when the colon is
   * reached.
   */
  #parseElement(stops: ReadonlySet<TokenKind>): Parsed.Expr {
    const expression = this.#parseExpression(
      0,
      insideBrackets(stops, "Comma", "RightParen"),
    );
    if (!this.#at("Colon")) return expression;
    this.#advance();
    if (!this.#startsType()) {
      // Products §2.2: `(x: 1, y: 2)` is the C# named-tuple habit. The element
      // colon is grammar now, so the failure lands one token later — on the term
      // standing where a type must — and the hint is the one that spec has
      // always carried. Reserved for the shape that habit actually produces: a
      // bare lowercase name ascribed to something that cannot be a type.
      const message = expression.kind === "Name" && expression.name.startClass === "non-upper"
        ? "tuples are positional; for named fields use a record: `{x = 1, y = 2}`"
        : "expected a type annotation";
      this.#error(message);
      this.#synchronize(insideBrackets(stops, "Comma", "RightParen", "Eof"));
      return { kind: "ErrorExpr", span: expression.span };
    }
    const annotation = this.#parseTypeAnnotation();
    if (annotation === undefined) {
      this.#synchronize(insideBrackets(stops, "Comma", "RightParen", "Eof"));
      return { kind: "ErrorExpr", span: expression.span };
    }
    return {
      kind: "Ascription",
      expression,
      annotation,
      span: spanFrom(expression.span, annotation.span),
    };
  }

  /** Whether the current token can begin a type (Functions §5's operand set). */
  #startsType(): boolean {
    return typeOperandStarts.has(this.#current().kind);
  }

  #parseCall(
    callee: Parsed.Expr,
    mark?: Parsed.CallMark,
    markSpan: Source.Span = callee.span,
  ): Parsed.Expr {
    this.#advance();
    const args: Parsed.Expr[] = [];
    const stops = new Set<TokenKind>(["Comma", "RightParen", "Eof"]);

    while (!this.#at("RightParen") && !this.#at("Eof")) {
      args.push(this.#parseExpression(0, stops));
      if (!this.#at("Comma")) {
        break;
      }
      this.#advance();
    }

    const closing = this.#expect("RightParen", "expected `)` after arguments");
    return {
      kind: "Call",
      callee,
      arguments: args,
      ...(mark === undefined ? {} : { mark, markSpan }),
      span: spanFrom(callee.span, closing?.span ?? args.at(-1)?.span ?? callee.span),
    };
  }

  #parseAccess(receiver: Parsed.Expr): Parsed.Expr {
    this.#advance();
    // No `union` special case here any more (#373). While `union` was a hard
    // keyword this arm existed so `Vector.union` could at least *parse* as a
    // field — the one position a reserved word was let through. The word is
    // contextual now, so it arrives as an ordinary `NonUpperName` and the
    // general path below takes it, which is why `Set.union(a, b)` needs nothing
    // written for it.
    const field = this.#takeAnyName("expected a field name after `.`");
    if (field === undefined) {
      return { kind: "ErrorExpr", span: receiver.span };
    }
    return {
      kind: "Access",
      receiver,
      field: parsedName(field),
      span: spanFrom(receiver.span, field.span),
    };
  }

  #parseIndex(receiver: Parsed.Expr): Parsed.Expr {
    this.#advance();
    const index = this.#parseExpression(0, new Set(["RightBracket", "Eof"]));
    const closing = this.#expect("RightBracket", "expected `]` after index");
    return {
      kind: "Index",
      receiver,
      index,
      span: spanFrom(receiver.span, closing?.span ?? index.span),
    };
  }

  #parseIf(outerStops: ReadonlySet<TokenKind>): Parsed.Expr {
    const start = this.#advance();
    const condition = this.#parseExpression(
      0,
      withStops(outerStops, "Then", "VOpen"),
    );

    let consequence: Parsed.Expr;
    let alternative: Parsed.Expr;
    // Set when `else` is omitted: the alternative is a synthesized `Unit`
    // (`else ()` sugar, Operators §11.2). The checker forces the `then`
    // branch to `Unit`; the AST always carries both branches.
    let elseless = false;
    if (this.#at("Then")) {
      this.#advance();
      consequence = this.#parseBodyExpression(withStops(outerStops, "Else"));
      if (this.#at("Else")) {
        this.#advance();
        alternative = this.#at("If")
          ? this.#parseIf(outerStops)
          : this.#parseBodyExpression(outerStops);
      } else {
        alternative = { kind: "Unit", span: this.#current().span };
        elseless = true;
      }
    } else if (this.#at("VOpen")) {
      this.#errorAt(
        start.span,
        "`if` requires `then`; write `if condition then` before the indented true branch",
      );
      consequence = this.#parseBlock();
      if (this.#at("Else")) {
        this.#advance();
        alternative = this.#at("If")
          ? this.#parseIf(outerStops)
          : this.#parseBodyExpression(outerStops);
      } else {
        alternative = { kind: "Unit", span: this.#current().span };
        elseless = true;
      }
    } else {
      this.#error("expected `then` after `if` condition");
      consequence = { kind: "ErrorExpr", span: this.#current().span };
      alternative = { kind: "ErrorExpr", span: this.#current().span };
    }

    return {
      kind: "If",
      condition,
      consequence,
      alternative,
      elseless,
      span: spanFrom(start.span, alternative.span),
    };
  }

  #parseWhile(outerStops: ReadonlySet<TokenKind>): Parsed.Expr {
    const start = this.#advance();
    const condition = this.#parseExpression(0, withStops(outerStops, "VOpen"));
    if (!this.#at("VOpen")) {
      this.#error("expected an indented block after `while` condition");
      return {
        kind: "While",
        condition,
        body: { kind: "Block", items: [], span: condition.span },
        span: spanFrom(start.span, condition.span),
      };
    }
    const body = this.#parseBlock();
    return {
      kind: "While",
      condition,
      body,
      span: spanFrom(start.span, body.span),
    };
  }

  #parseFor(outerStops: ReadonlySet<TokenKind>): Parsed.Expr {
    const start = this.#advance();
    const pattern = this.#parsePattern() ?? {
      kind: "Wildcard" as const,
      span: this.#current().span,
    };
    this.#expect("In", "expected `in` after `for` pattern");
    const iterable = this.#parseExpression(0, withStops(outerStops, "VOpen"));
    if (!this.#at("VOpen")) {
      this.#error("expected an indented block after `for` iterable");
      return {
        kind: "For",
        pattern,
        iterable,
        body: { kind: "Block", items: [], span: iterable.span },
        span: spanFrom(start.span, iterable.span),
      };
    }
    const body = this.#parseBlock();
    return {
      kind: "For",
      pattern,
      iterable,
      body,
      span: spanFrom(start.span, body.span),
    };
  }

  #parseMatch(outerStops: ReadonlySet<TokenKind>): Parsed.MatchExpr {
    const start = this.#advance();
    const scrutinee = this.#parseExpression(
      0,
      withStops(outerStops, "VOpen"),
    );
    this.#expect("VOpen", "expected an indented block of match arms");
    const arms: Parsed.MatchArm[] = [];
    this.#skipSeparators();
    while (!this.#at("VClose") && !this.#at("Eof")) {
      const pattern = this.#parsePattern();
      if (pattern === undefined) {
        this.#synchronize(new Set(["VSep", "VClose", "Eof"]));
        this.#skipSeparators();
        continue;
      }
      let guard: Parsed.Expr | undefined;
      const guardStart = this.#current();
      if (
        guardStart.kind === "NonUpperName" &&
        guardStart.text === "when"
      ) {
        this.#advance();
        guard = this.#parseExpression(0, new Set(["FatArrow", "Eof"]));
      }
      this.#expect("FatArrow", "expected `=>` after match pattern or guard");
      const body = this.#parseBodyExpression(
        new Set(["VSep", "VClose", "Eof"]),
      );
      arms.push({
        pattern,
        ...(guard === undefined ? {} : { guard }),
        body,
        span: spanFrom(pattern.span, body.span),
      });
      this.#skipSeparators();
    }
    const closing = this.#expect("VClose", "expected the match arms to close");
    return {
      kind: "Match",
      scrutinee,
      arms,
      span: spanFrom(
        start.span,
        closing?.span ?? arms.at(-1)?.span ?? scrutinee.span,
      ),
    };
  }

  #parseTry(outerStops: ReadonlySet<TokenKind>): Parsed.TryExpr {
    const start = this.#advance();
    const body = this.#parseBodyExpression(withStops(outerStops, "Catch"));
    this.#expect("Catch", "`try` requires a `catch`");
    this.#expect("VOpen", "expected an indented block of catch arms");
    const arms: Parsed.MatchArm[] = [];
    this.#skipSeparators();
    while (!this.#at("VClose") && !this.#at("Eof")) {
      const pattern = this.#parsePattern();
      if (pattern === undefined) {
        this.#synchronize(new Set(["VSep", "VClose", "Eof"]));
        this.#skipSeparators();
        continue;
      }
      let guard: Parsed.Expr | undefined;
      const guardStart = this.#current();
      if (
        guardStart.kind === "NonUpperName" &&
        guardStart.text === "when"
      ) {
        this.#advance();
        guard = this.#parseExpression(0, new Set(["FatArrow", "Eof"]));
      }
      this.#expect("FatArrow", "expected `=>` after catch pattern or guard");
      const armBody = this.#parseBodyExpression(new Set(["VSep", "VClose", "Eof"]));
      arms.push({
        pattern,
        ...(guard === undefined ? {} : { guard }),
        body: armBody,
        span: spanFrom(pattern.span, armBody.span),
      });
      this.#skipSeparators();
    }
    const closing = this.#expect("VClose", "expected the catch arms to close");
    let end = closing?.span ?? arms.at(-1)?.span ?? body.span;
    if (this.#at("Finally")) {
      const finallyToken = this.#advance();
      this.#errorAt(finallyToken.span, "`finally` is not part of Hexagon v1");
      const rejectedBody = this.#parseBodyExpression(outerStops);
      end = rejectedBody.span;
    }
    return {
      kind: "Try",
      body,
      arms,
      span: spanFrom(start.span, end),
    };
  }

  #parseBodyExpression(stops: ReadonlySet<TokenKind> = itemEnds): Parsed.Expr {
    return this.#at("VOpen") ? this.#parseBlock() : this.#parseExpression(0, stops);
  }

  #parseBlock(): Parsed.BlockExpr {
    const opening = this.#advance();
    const items = this.#parseItems();
    const closing = this.#expect("VClose", "expected the indented block to close");
    // Virtual delimiters are anchored to nearby physical tokens. A closing
    // delimiter may therefore sit on the following item; the block's source
    // extent ends at its own final item instead.
    const last = items.at(-1) ?? closing ?? opening;
    return { kind: "Block", items, span: spanFrom(opening.span, last.span) };
  }

  /**
   * A parameter list. Each parameter is a full irrefutable pattern (Functions
   * §3.1, Pattern Matching §6.5): the outer parentheses are the list and
   * top-level commas separate parameters, so anything nested is pattern syntax.
   *
   * A parameter that is a plain name is a parameter directly. Any other pattern
   * binds a fresh parameter and yields a *destructuring* the caller hangs on the
   * lambda head, which the resolver opens the body with — so a pattern parameter
   * inherits the `let` position's checking verbatim, including its
   * irrefutability gate, without inheriting its binder class (Statements §5).
   */
  #parseParameters(): ParsedParameters {
    this.#expect("LeftParen", "expected `(` before parameters");
    const parameters: Parsed.Parameter[] = [];
    const destructurings: Destructuring[] = [];

    while (!this.#at("RightParen") && !this.#at("Eof")) {
      const pattern = this.#parsePattern();
      if (pattern !== undefined) {
        let annotation: Parsed.TypeAnnotation | undefined;
        if (this.#at("Colon")) {
          this.#advance();
          annotation = this.#parseTypeAnnotation();
        }
        const { parameter, destructuring } = this.#parameterFromPattern(
          pattern,
          parameters.length,
          annotation,
        );
        parameters.push(parameter);
        if (destructuring !== undefined) destructurings.push(destructuring);
      }
      if (!this.#at("Comma")) {
        break;
      }
      this.#advance();
    }

    this.#expect("RightParen", "expected `)` after parameters");
    return { parameters, destructurings };
  }

  /** The binder a pattern parameter destructures from; not writable in source. */
  #freshParameterName(span: Source.Span, index: number): Parsed.Name {
    return { text: syntheticParameterName(index), startClass: "non-upper", span };
  }

  /**
   * The destructurings a lambda carries, as a field to spread into it. They stay
   * on the head rather than being prepended to the body here: their binders are
   * head binders (Statements §5), and a body-level `let` is the one shape that
   * cannot say so — the resolver opens the body with the equivalent `let` once
   * it has the lambda's own scope to bind them in.
   */
  #lambdaDestructurings(
    destructurings: readonly Destructuring[],
  ): { readonly destructurings?: readonly Destructuring[] } {
    return destructurings.length === 0 ? {} : { destructurings };
  }

  /** Rejects pattern parameters where no body exists to destructure into. */
  #rejectDestructurings(
    destructurings: readonly Destructuring[],
    what: string,
  ): void {
    for (const { span } of destructurings) {
      this.#errorAt(span, `${what} take plain parameter names, not patterns`);
    }
  }

  /**
   * Pattern Matching §6.5's guard pin: a top-level `=>` after `when` always belongs to the
   * arm, never to a lambda. A `match` or `catch` arm parses its guard with `FatArrow`
   * stopping the expression, and that stop is the claim — where it holds, no lambda may
   * start and swallow the arrow the arm is waiting for. The claim does not cross a bracket
   * (`#insideBrackets`), because a `=>` in there is closed off from the arm by a bracket
   * that must shut first, so guards may still contain lambdas.
   */
  #arrowIsClaimed(stops: ReadonlySet<TokenKind>): boolean {
    return stops.has("FatArrow");
  }

  /**
   * A sole parameter written without the parameter-list parens (Pattern Matching §6.5):
   * a paren-free pattern, then `=>`. The arrow is the entire signal — `=>` never continues
   * an expression, so an arrow standing immediately after a pattern-shaped run of tokens
   * cannot belong to whatever those tokens would otherwise have been. That is what tells a
   * record *pattern* from a record *literal* without inspecting anything between the braces.
   *
   * The lookahead walks the pattern grammar rather than hunting for an arrow, which keeps it
   * both tight and cheap. Tight, because it commits only when the tokens genuinely form a
   * paren-free pattern that the arrow immediately follows. Cheap, because it steps *over*
   * bracket pairs and stops at the pattern's own end: a leading name is settled in one token,
   * so an ordinary expression pays nothing for the possibility of a lambda. Scanning ahead
   * for the arrow instead costs the length of the enclosing expression at every prefix
   * position, which is quadratic on long ones (measured: 60× on a 2000-term sum).
   */
  #atPatternParameterLambda(): boolean {
    if (!parenFreePatternStarts.has(this.#current().kind)) return false;
    let index = this.#skipPattern(this.#index);
    // Or-patterns are paren-free too; refutability, not the grammar, is what rejects them.
    while (index >= 0 && this.#tokens[index]?.kind === "Bar") {
      index = this.#skipPattern(index + 1);
    }
    if (index < 0) return false;
    if (this.#isAsKeyword(index)) {
      index += 1;
      if (this.#tokens[index]?.kind !== "NonUpperName") return false;
      index += 1;
    }
    return this.#tokens[index]?.kind === "FatArrow";
  }

  /** Steps over one paren-free pattern, or returns -1 if these tokens are not one. */
  #skipPattern(index: number): number {
    const kind = this.#tokens[index]?.kind;
    if (kind === "NonUpperName") {
      // A lowercase name binds; it never heads an argument list, and a leading `as` is
      // the operator rather than a pattern of its own.
      return this.#isAsKeyword(index) ? -1 : index + 1;
    }
    if (kind === "Wildcard") return index + 1;
    if (kind === "UpperName") {
      const next = index + 1;
      return this.#tokens[next]?.kind === "LeftParen" ? this.#skipBracketed(next) : next;
    }
    if (kind === "LeftBrace" || kind === "LeftBracket") return this.#skipBracketed(index);
    return -1;
  }

  /** Steps over a balanced bracket pair, or returns -1 if it never closes. */
  #skipBracketed(index: number): number {
    let depth = 0;
    for (let scan = index; scan < this.#tokens.length; scan += 1) {
      const kind = this.#tokens[scan]!.kind;
      if (kind === "Eof") return -1;
      if (opensNesting.has(kind)) depth += 1;
      else if (closesNesting.has(kind)) {
        depth -= 1;
        if (depth === 0) return scan + 1;
        if (depth < 0) return -1;
      }
    }
    return -1;
  }

  #isAsKeyword(index: number): boolean {
    const token = this.#tokens[index];
    return token?.kind === "NonUpperName" && token.text === "as";
  }

  /**
   * The §6.5 paren-free form. One pattern, one parameter — the same parameter the
   * parenthesized spelling would have produced, through the same `#parameterFromPattern`,
   * so `{x} => x` and `({x}) => x` bind identically and the irrefutability gate sees one
   * shape rather than two.
   */
  #parsePatternParameterLambda(stops: ReadonlySet<TokenKind>): Parsed.Expr {
    const start = this.#current().span;
    const pattern = this.#parsePattern();
    if (pattern === undefined) {
      this.#synchronize(withStops(stops, "FatArrow"));
      if (this.#at("FatArrow")) this.#advance();
      const body = this.#parseBodyExpression(stops);
      return { kind: "ErrorExpr", span: spanFrom(start, body.span) };
    }
    const { parameter, destructuring } = this.#parameterFromPattern(pattern, 0);
    this.#expect("FatArrow", "expected `=>` after the lambda parameter");
    const body = this.#parseBodyExpression(stops);
    return {
      kind: "Lambda",
      parameters: [parameter],
      ...this.#lambdaDestructurings(destructuring === undefined ? [] : [destructuring]),
      body,
      span: spanFrom(start, body.span),
    };
  }

  /**
   * One parameter from one pattern. A plain name *is* the parameter; every other pattern
   * becomes a fresh binder plus a destructuring hung on the lambda head, so a pattern
   * parameter binds the same whichever spelling introduced it.
   */
  #parameterFromPattern(
    pattern: Parsed.Pattern,
    index: number,
    annotation?: Parsed.TypeAnnotation,
  ): { parameter: Parsed.Parameter; destructuring?: Destructuring } {
    const span = spanFrom(pattern.span, annotation?.span ?? pattern.span);
    if (pattern.kind === "Binding") {
      return {
        parameter: {
          name: pattern.name,
          ...(annotation === undefined ? {} : { annotation }),
          span,
        },
      };
    }
    const name = this.#freshParameterName(pattern.span, index);
    const parameter: Parsed.Parameter = {
      name,
      ...(annotation === undefined ? {} : { annotation }),
      span,
    };
    // A wildcard binds nothing, so it needs no destructuring at all —
    // the fresh parameter simply goes unused.
    if (pattern.kind === "Wildcard") return { parameter };
    return { parameter, destructuring: { pattern, name, span: pattern.span } };
  }

  /**
   * A parenthesized lambda, optionally carrying the `<...>` binders its caller has already
   * consumed. Functions §4.2 makes the header form `let f<a: Num>(x: a): a = …` and the
   * lambda form `let f = <a: Num>(x: a): a => …` "equivalent, same AST node", so both build
   * their `Lambda` here and the only difference is where the span starts.
   */
  #parseLambda(
    stops: ReadonlySet<TokenKind>,
    typeParameters?: readonly Parsed.TypeParameter[],
    start?: Source.Span,
  ): Parsed.Expr {
    const from = start ?? this.#current().span;
    const { parameters, destructurings } = this.#parseParameters();
    let returnAnnotation: Parsed.TypeAnnotation | undefined;
    if (this.#at("Colon")) {
      this.#advance();
      // No restriction rides this slot since #405: the type arrows are `->`,
      // `->?`, `->!` and the lambda's own arrow is `=>`, so a greedy annotation
      // parse cannot reach the body. `(x): A ->! B => body` and the curried
      // `(x): a => y => x` both parse as written (Effects §2.6).
      returnAnnotation = this.#parseTypeAnnotation();
    }
    this.#expect("FatArrow", "expected `=>` after lambda parameters");
    const body = this.#parseBodyExpression(stops);
    const lambda: Parsed.Expr = {
      kind: "Lambda",
      parameters,
      ...(typeParameters === undefined ? {} : { typeParameters }),
      ...(returnAnnotation === undefined ? {} : { returnAnnotation }),
      ...this.#lambdaDestructurings(destructurings),
      body,
      span: spanFrom(from, body.span),
    };
    return lambda;
  }

  /**
   * `<` opens a type-parameter lambda when a binder list closes on a parameter list.
   * At the start of an expression `<` has no other reading — it is otherwise only an infix
   * comparison — so the scan need not be conservative, but keeping it tight means a
   * malformed binder list still reports as itself rather than as a missing expression.
   */
  #atTypeParameterLambda(): boolean {
    if (!this.#at("Less")) return false;
    for (let distance = 1; ; distance += 1) {
      const kind = this.#peek(distance).kind;
      if (kind === "Greater") return this.#peek(distance + 1).kind === "LeftParen";
      if (!typeParameterListKinds.has(kind)) return false;
    }
  }

  /**
   * Functions §4.2: `<...>` binders are permitted only on a lambda in `let`/`fun` RHS
   * position. The binding discharges its own value — directly, or through the wrappers that
   * are the same right-hand side written differently: parentheses, and the indented block of
   * a right-hand side spread across lines. A block with more than one item is deliberately
   * *not* discharged: there the lambda is the block's result rather than the binding's
   * right-hand side, and what `<a>` would scope over is a question this form should not
   * answer by accident. Functions §8.2 has since ruled the parallel value-restriction
   * question the same way, which is why the walk is now one shared helper.
   */
  #dischargeTypeParameterLambda(value: Parsed.Expr): void {
    // Through the ascription wrapper too: an ascription of a syntactic value is
    // a syntactic value (Ascription §3), so `let f = (<a>(x: a) => x : a -> a)`
    // is the same right-hand side written with its type claimed.
    this.#pendingTypeParameterLambdas.delete(Parsed.unwrapSyntacticValue(value));
  }

  #reportMisplacedTypeParameterLambdas(): void {
    for (const span of this.#pendingTypeParameterLambdas.values()) {
      this.#errorAt(
        span,
        "`<...>` type parameters are permitted only on a lambda bound by `let` or `fun`; " +
          "bind this lambda to a name first",
      );
    }
    this.#pendingTypeParameterLambdas.clear();
  }

  /**
   * A parenthesized lambda head: the arrow after the matching `)`, optionally
   * across a return annotation (Functions §4.1). The doctrine is that the parser
   * decides on what follows the matching `)` and never on a `name :` inside it
   * (Ascription §2.3).
   *
   * The return-annotation arm has to step over *one well-formed type* and then
   * find the arrow immediately. It formerly scanned from the colon to any `=>`
   * before the layout boundary, which was answer-preserving only while every
   * legal inner `(...):` was itself a lambda head's return annotation. Ascription
   * makes non-lambda ones legal, and the loose scan then reads
   * `((a, b): (Int, String)) |> map(x => x)` as a lambda head off an unrelated
   * arrow later in the line (§2.3).
   */
  #isParenthesizedLambda(): boolean {
    if (!this.#at("LeftParen")) {
      return false;
    }

    let index = this.#index;
    let depth = 0;
    do {
      const kind = this.#tokens[index]?.kind;
      if (kind === "LeftParen") depth += 1;
      if (kind === "RightParen") depth -= 1;
      if (kind === "Eof" || kind === "VSep" || kind === undefined) return false;
      index += 1;
    } while (depth > 0);
    // `index` points one token beyond the matching parameter `)`.
    if (this.#tokens[index]?.kind === "Colon") {
      index = this.#skipType(index + 1);
      if (index < 0) return false;
    }
    return this.#tokens[index]?.kind === "FatArrow";
  }

  /**
   * Steps over one well-formed type, or returns -1 if these tokens are not one.
   *
   * A token-level walk of the type grammar, in the shape `#skipPattern` already
   * established: tight, because it commits only on a type the type parser would
   * accept, and cheap, because it steps *over* bracket pairs rather than into
   * them.
   */
  #skipType(index: number): number {
    let scan = this.#skipTypeOperand(index);
    // All three type arrows are walked (#405). None of them can begin a lambda
    // body, so there is no arrow this scan must decline in order to leave the
    // body reachable — the exception the predecessor carried for a bare `=>`
    // went with `=>` leaving the type grammar.
    while (
      scan >= 0 &&
      (this.#tokens[scan]?.kind === "Arrow" ||
        this.#tokens[scan]?.kind === "ArrowQuestion" ||
        this.#tokens[scan]?.kind === "ArrowBang")
    ) {
      scan = this.#skipTypeOperand(scan + 1);
    }
    return scan;
  }

  /** One type operand, constrained-hole suffix included (closure doc §4.4). */
  #skipTypeOperand(index: number): number {
    const kind = this.#tokens[index]?.kind;
    if (kind === "LeftBrace" || kind === "LeftParen") return this.#skipBracketed(index);
    if (kind === "Wildcard") {
      const next = index + 1;
      // The suffix is bounded — one reference, or one balanced list — so
      // consuming it here ends the operand, exactly as the parser does.
      return this.#tokens[next]?.kind === "Colon"
        ? this.#skipConstraintList(next + 1)
        : next;
    }
    if (kind === "NonUpperName") return index + 1;
    if (kind !== "UpperName") return -1;
    let scan = this.#skipQualifiedTypeName(index);
    if (this.#tokens[scan]?.kind === "LeftParen") return this.#skipBracketed(scan);
    return scan;
  }

  #skipConstraintList(index: number): number {
    if (this.#tokens[index]?.kind === "LeftParen") return this.#skipBracketed(index);
    if (this.#tokens[index]?.kind !== "UpperName") return -1;
    return this.#skipQualifiedTypeName(index);
  }

  /** `Box`, or the module-qualified `M.Box` (Modules §3.3). */
  #skipQualifiedTypeName(index: number): number {
    const scan = index + 1;
    return this.#tokens[scan]?.kind === "Dot" && this.#tokens[scan + 1]?.kind === "UpperName"
      ? scan + 2
      : scan;
  }

  /**
   * The arrow kinds that may form a function type here (Effects §2).
   *
   * All three always can, in every type position — there is no slot that
   * withholds one. That is the point of #405's respelling: the type arrows are
   * `->`, `->?`, `->!` and the lambda's arrow is `=>`, so no type arrow can be
   * mistaken for the start of a body and the return-annotation restriction this
   * method used to carry is gone.
   */
  #arrowAt(): Parsed.ArrowEffect | "pure" | undefined {
    if (this.#at("Arrow")) return "pure";
    if (this.#at("ArrowBang")) return "constant";
    if (this.#at("ArrowQuestion")) return "linked";
    return undefined;
  }

  #parseTypeAnnotation(): Parsed.TypeAnnotation | undefined {
    const left = this.#parseTypeOperand();
    if (left === undefined) return undefined;
    const arrow = this.#arrowAt();
    if (arrow !== undefined && arrow !== "pure") {
      const arrowSpan = this.#advance().span;
      const result = this.#parseTypeAnnotation();
      if (result === undefined) return undefined;
      return {
        kind: "Function",
        parameters: left.parameters ?? [left.annotation],
        result,
        effect: arrow,
        arrowSpan,
        span: spanFrom(left.annotation.span, result.span),
      };
    }
    if (!this.#at("Arrow")) {
      if (left.parameters?.length === 0) {
        // The Products §6 redirect (#159): `()` is not a type expression, so a
        // bare `()` in type position names the one legal role it has and the
        // spelling the writer wanted.
        this.#errorAt(
          left.annotation.span,
          "the empty tuple's type is written `Unit`; `()` in type syntax is only " +
            "the zero-parameter domain `() -> T`",
        );
        return undefined;
      }
      return left.annotation;
    }
    this.#advance();
    const result = this.#parseTypeAnnotation();
    if (result === undefined) return undefined;
    return {
      kind: "Function",
      parameters: left.parameters ?? [left.annotation],
      result,
      span: spanFrom(left.annotation.span, result.span),
    };
  }

  /** Retains a direct parenthesized list so `(A, B) -> C` stays n-ary. */
  #parseTypeOperand(): {
    readonly annotation: Parsed.TypeAnnotation;
    readonly parameters?: readonly Parsed.TypeAnnotation[];
  } | undefined {
    const token = this.#current();
    if (token.kind === "LeftBrace") {
      const opening = this.#advance();
      const fields: Parsed.RecordTypeField[] = [];
      const names = new Set<string>();
      let open = false;
      let tail: Parsed.Name | undefined;
      while (!this.#at("RightBrace") && !this.#at("Eof")) {
        if (this.#at("Spread")) {
          this.#advance();
          open = true;
          if (this.#at("NonUpperName")) {
            tail = parsedName(this.#advance() as Lexed.NameToken);
          }
          if (this.#at("Comma")) this.#error("`...` must be the final entry in a record type");
          break;
        }
        const fieldToken = this.#takeName("NonUpperName", "record type fields must be non-uppercase-start names");
        if (fieldToken === undefined) return undefined;
        this.#expect("Colon", "expected `:` after record type field name");
        const annotation = this.#parseTypeAnnotation();
        if (annotation === undefined) return undefined;
        const name = parsedName(fieldToken);
        if (names.has(name.text)) this.#errorAt(name.span, `duplicate record type field \`${name.text}\``);
        names.add(name.text);
        fields.push({ name, annotation, span: spanFrom(name.span, annotation.span) });
        if (!this.#at("Comma")) break;
        this.#advance();
      }
      const closing = this.#expect("RightBrace", "expected `}` after record type");
      return {
        annotation: {
          kind: "Record",
          fields,
          open,
          ...(tail === undefined ? {} : { tail }),
          span: spanFrom(opening.span, closing?.span ?? fields.at(-1)?.span ?? opening.span),
        },
      };
    }
    if (token.kind === "LeftParen") {
      const opening = this.#advance();
      if (this.#at("RightParen")) {
        const closing = this.#advance();
        return {
          annotation: {
            kind: "Tuple",
            elements: [],
            span: spanFrom(opening.span, closing.span),
          },
          parameters: [],
        };
      }
      const first = this.#parseTypeAnnotation();
      if (first === undefined) return undefined;
      if (!this.#at("Comma")) {
        const closing = this.#expect("RightParen", "expected `)` after type");
        return {
          annotation: {
            ...first,
            span: spanFrom(opening.span, closing?.span ?? first.span),
          },
        };
      }
      const elements: Parsed.TypeAnnotation[] = [first];
      while (this.#at("Comma")) {
        const comma = this.#advance();
        if (this.#at("RightParen")) {
          this.#errorAt(comma.span, "a tuple type needs a type after `,`");
          this.#advance();
          return undefined;
        }
        const element = this.#parseTypeAnnotation();
        if (element === undefined) return undefined;
        elements.push(element);
      }
      const closing = this.#expect("RightParen", "expected `)` after tuple type");
      const annotation: Parsed.TupleType = {
        kind: "Tuple",
        elements,
        span: spanFrom(opening.span, closing?.span ?? elements.at(-1)!.span),
      };
      return { annotation, parameters: elements };
    }
    if (token.kind === "Wildcard") {
      this.#advance();
      // A hole is the only operand that admits a constraint suffix (closure doc
      // §4.4). The suffix is bounded — one reference or one balanced
      // parenthesized list — so consuming it here ends the operand: `_ : Num ->
      // a` is `(_ : Num) -> a`, and a tuple's `,` still belongs to the tuple.
      // The span stays the `_`'s: it is what hover points at, and what the
      // fence carets (§7, §5.4).
      if (!this.#at("Colon")) {
        return { annotation: { kind: "Hole", constraints: [], span: token.span } };
      }
      this.#advance();
      return {
        annotation: {
          kind: "Hole",
          constraints: this.#parseConstraintList(),
          span: token.span,
        },
      };
    }
    if (token.kind === "NonUpperName") {
      this.#advance();
      const name = parsedName(token);
      return { annotation: { kind: "TypeVariable", name, span: name.span } };
    }
    if (token.kind !== "UpperName") {
      this.#error(
        "expected a type annotation",
      );
      return undefined;
    }
    this.#advance();
    let qualifier: Parsed.Name | undefined;
    let name = parsedName(token);
    if (this.#at("Dot")) {
      this.#advance();
      const member = this.#takeName("UpperName", "qualified types require an uppercase type name after `.`");
      if (member === undefined) return undefined;
      qualifier = name;
      name = parsedName(member);
    }
    if (this.#at("LeftParen")) {
      this.#advance();
      const arguments_: Parsed.TypeAnnotation[] = [];
      while (!this.#at("RightParen") && !this.#at("Eof")) {
        this.#rejectVarianceSigilAtUse();
        const argument = this.#parseTypeAnnotation();
        if (argument === undefined) return undefined;
        arguments_.push(argument);
        if (!this.#at("Comma")) break;
        this.#advance();
      }
      const closing = this.#expect("RightParen", "expected `)` after type arguments");
      if (arguments_.length === 0) {
        this.#errorAt(name.span, "a type application needs at least one argument");
      }
      return {
        annotation: {
          kind: "AppliedType",
          ...(qualifier === undefined ? {} : { qualifier }),
          constructor: name,
          arguments: arguments_,
          span: spanFrom(name.span, closing?.span ?? arguments_.at(-1)?.span ?? name.span),
        },
      };
    }
    return {
      annotation: {
        kind: "NamedType",
        ...(qualifier === undefined ? {} : { qualifier }),
        name,
        span: qualifier === undefined ? name.span : spanFrom(qualifier.span, name.span),
      },
    };
  }

  #takeName(
    kind: "NonUpperName" | "UpperName",
    message: string,
  ): Lexed.NameToken | undefined {
    const token = this.#current();
    if (token.kind !== kind) {
      const reserved = this.#reservedBooleanWord(token);
      this.#error(
        reserved === undefined
          ? message
          : `\`${reserved}\` is reserved and cannot be used as a name`,
      );
      return undefined;
    }
    this.#advance();
    return token;
  }

  /**
   * A constraint name in a binder, plain or qualified by a module alias:
   * `Ord`, `Geo.Ord` (Modules §3.3).
   *
   * The qualified form carries its dot in the name's `text`, which is what the
   * resolver keys the module-alias lookup on. §5.1 is untouched — the alias is
   * what stands *left* of the dot, and constraints still never take one.
   */
  /**
   * The obligation side of a binder, after its `:`: one constraint reference,
   * or a parenthesized conjunction — `Ord`, `(Num, Ord)` (Functions §4.2).
   *
   * Shared with the constrained hole `_ : C` (closure doc §4.4), which reuses
   * the form wholesale rather than growing a second spelling of it.
   */
  #parseConstraintList(): readonly Parsed.Name[] {
    const constraints: Parsed.Name[] = [];
    if (this.#at("LeftParen")) {
      this.#advance();
      while (!this.#at("RightParen") && !this.#at("Eof")) {
        const constraint = this.#parseConstraintReference("constraint names are uppercase");
        if (constraint !== undefined) constraints.push(constraint);
        if (!this.#at("Comma")) break;
        this.#advance();
      }
      this.#expect("RightParen", "expected `)` after constraints");
      return constraints;
    }
    const constraint = this.#parseConstraintReference("expected a constraint name");
    if (constraint !== undefined) constraints.push(constraint);
    return constraints;
  }

  #parseConstraintReference(message: string): Parsed.Name | undefined {
    const token = this.#takeName("UpperName", message);
    if (token === undefined) return undefined;
    if (!this.#at("Dot") || this.#peek(1).kind !== "UpperName") {
      return parsedName(token);
    }
    this.#advance();
    const qualified = this.#advance();
    return {
      text: `${token.text}.${(qualified as Lexed.NameToken).text}`,
      startClass: "upper",
      span: spanFrom(token.span, qualified.span),
    };
  }

  #takeAnyName(message: string): Lexed.NameToken | undefined {
    const token = this.#current();
    if (token.kind !== "NonUpperName" && token.kind !== "UpperName") {
      const reserved = this.#reservedBooleanWord(token);
      this.#error(
        reserved === undefined
          ? message
          : `\`${reserved}\` is reserved and cannot be used as a name`,
      );
      return undefined;
    }
    this.#advance();
    return token;
  }

  /**
   * Lexer §3.2's reserved prefix, reported once the positions are known.
   *
   * Every name token in the module is a Hexagon name seat unless something
   * parsed it as one of §3.2's exceptions and said so — the sweep is the default
   * and the exemptions are the recorded cases, rather than the other way round,
   * so a seat added later is covered without being remembered. The fix-it is a
   * rename, per the §10 table: the double leading underscore means the compiler
   * wrote the name, so a user's `__foo` becomes `_foo`.
   */
  #reportReservedNames(): void {
    this.#tokens.forEach((token, index) => {
      if (token.kind !== "NonUpperName" && token.kind !== "UpperName") return;
      if (!token.text.startsWith("__")) return;
      if (this.#reservedNameExemptions.has(index)) return;
      this.#diagnostics.add({
        severity: "error",
        message: "names beginning `__` are reserved for compiler-generated code",
        primary: token.span,
        fixes: [{
          message: "rename this identifier",
          edits: [{ span: token.span, replacement: token.text.replace(/^__/, "_") }],
        }],
      });
    });
  }

  #skipSeparators(): void {
    while (this.#at("VSep") || this.#at("Semicolon")) {
      this.#advance();
    }
  }

  #synchronize(stops: ReadonlySet<TokenKind>): void {
    while (!stops.has(this.#current().kind)) {
      this.#advance();
    }
  }

  #expect(kind: TokenKind, message: string): LaidOut.Token | undefined {
    if (!this.#at(kind)) {
      this.#error(message);
      return undefined;
    }
    return this.#advance();
  }

  // Term-position record fields bind with `=`; `:` is the type-position separator
  // (Products §3.1/§8, Pattern Matching §2.4/§16). Consumes the separator token and
  // returns it, or `undefined` when the field is punned. The three near-miss tokens are
  // diagnosed with their permanent fixits (Products §6) and then consumed anyway, so the
  // field's value or sub-pattern still parses and one typo yields one error.
  #recordFieldSeparator(field: string, pattern: boolean): LaidOut.Token | undefined {
    if (this.#at("Equal")) return this.#advance();
    if (this.#at("Colon")) {
      const annotation = pattern && this.#peek(1).kind === "UpperName";
      this.#error(
        `record fields bind with \`=\`: \`{${field} = …}\`; \`:\` gives a field its type in record types` +
          (annotation ? "; if you meant a type, patterns destructure values — annotate outside the pattern" : ""),
      );
      return this.#advance();
    }
    if (this.#at("Assign")) {
      this.#error(`did you mean \`=\`? \`:=\` assigns to a \`var\``);
      return this.#advance();
    }
    if (this.#at("FatArrow")) {
      this.#error(
        `did you mean \`=\`? \`=>\` is the lambda arrow — a lambda-valued field is \`{${field} = arg => …}\``,
      );
      return this.#advance();
    }
    return undefined;
  }

  /**
   * The `true`/`false` redirect (Lexer §4.1, #147). Both spellings stay hard
   * keywords so `let true = ...` is foreclosed forever, but they no longer
   * denote values — `Bool` is the prelude union `False | True`. The lexer emits
   * the token and the reserved-word fact; **selecting the message by position is
   * the parser's job**, which is why this lives here and not there.
   *
   * In value position the Rewrite Rule requires a one-token fixit, because
   * `true` is the JS-trained user's most probable spelling error. In name or
   * binder position there is no fixit to give: "write `True`" would be wrong,
   * since `let True = ...` is a refutable constructor pattern and errors again.
   */
  #reservedBooleanWord(token: LaidOut.Token): "true" | "false" | undefined {
    if (token.kind === "True") return "true";
    if (token.kind === "False") return "false";
    return undefined;
  }

  /** The value-position redirect, with its mandatory fixit. */
  #redirectBooleanWord(token: LaidOut.Token, word: "true" | "false"): void {
    const constructor = word === "true" ? "True" : "False";
    this.#errorAt(
      token.span,
      `\`${word}\` is reserved; Bool's constructors are \`True\` and \`False\` — write \`${constructor}\``,
    );
  }

  #error(message: string): void {
    this.#errorAt(this.#current().span, message);
  }

  #errorAt(span: Source.Span, message: string): void {
    this.#diagnostics.add({ severity: "error", message, primary: span });
  }

  #at(kind: TokenKind): boolean {
    return this.#current().kind === kind;
  }

  #current(): LaidOut.Token {
    return this.#tokens[this.#index] ?? this.#tokens.at(-1) ?? missingEof();
  }

  #peek(distance: number): LaidOut.Token {
    return this.#tokens[this.#index + distance] ?? this.#current();
  }

  #previous(): LaidOut.Token {
    return this.#tokens[Math.max(0, this.#index - 1)] ?? this.#current();
  }

  #advance(): LaidOut.Token {
    const token = this.#current();
    if (token.kind !== "Eof") {
      this.#index += 1;
    }
    return token;
  }
}

function parsedName(token: Lexed.NameToken): Parsed.Name {
  return {
    text: token.text,
    startClass: token.kind === "NonUpperName" ? "non-upper" : "upper",
    span: token.span,
  };
}

/** Products §3.3's v1 update head: a bare name, or a dot-separated path from one. */
function isDottedPath(expression: Parsed.Expr): boolean {
  if (expression.kind === "Name") return true;
  return expression.kind === "Access" && isDottedPath(expression.receiver);
}

function invalidType(name: Parsed.Name): Parsed.NamedType {
  return {
    kind: "NamedType",
    name: { ...name, text: "Invalid", startClass: "upper" },
    span: name.span,
  };
}

/**
 * The spelling to blame in an inadmissible intrinsic declaration (§3.3). A
 * keyword token reports as itself; anything else reports as its text so the
 * message names what the author actually wrote.
 */
function externDeclarationKeyword(token: LaidOut.Token): string {
  if (token.kind === "NonUpperName" || token.kind === "UpperName") return token.text;
  return token.kind.toLocaleLowerCase();
}

/**
 * §11's inadmissible-form diagnostic. The intrinsic boundary provides operations
 * only; compiler-owned *types* in particular do not enter here (§3.3), which is
 * why the rewrite points at an ordinary declaration in the same module rather
 * than at a different extern spelling.
 */
function intrinsicFormError(form: string): string {
  return `the intrinsic boundary provides operations only; declare \`fun\` here, ` +
    `and declare types as ordinary (\`export opaque\`) declarations in this module ` +
    `(\`${form}\` is not admitted)`;
}

function lowerInitial(name: string): string {
  const [first = "value", ...rest] = [...name];
  return `${first.toLocaleLowerCase()}${rest.join("")}`;
}

function upperInitial(name: string): string {
  const [first = "T", ...rest] = [...name];
  return `${first.toLocaleUpperCase()}${rest.join("")}`;
}

function requiredOperator(operation: Infix, token: LaidOut.Token): Parsed.BinaryOperator {
  if (operation.operator === undefined) {
    throw new Error(`internal error: ${token.kind} has no binary operator`);
  }
  return operation.operator;
}

function withStops(
  stops: ReadonlySet<TokenKind>,
  ...additional: readonly TokenKind[]
): ReadonlySet<TokenKind> {
  return new Set([...stops, ...additional]);
}

/**
 * Stops for a bracketed sub-expression. Everything the surrounding expression stops at
 * still applies, except a claimed `=>` (§6.5's guard pin, `#arrowIsClaimed`): the bracket
 * must close before the arm's arrow can arrive, so an arrow written in here is a lambda's
 * and the claim would only stop a lambda that is entirely legal.
 */
function insideBrackets(
  stops: ReadonlySet<TokenKind>,
  ...additional: readonly TokenKind[]
): ReadonlySet<TokenKind> {
  const inner = new Set([...stops, ...additional]);
  inner.delete("FatArrow");
  return inner;
}

function spanFrom(first: Source.Span, last: Source.Span): Source.Span {
  return { fileId: first.fileId, start: first.start, end: last.end };
}

function describe(kind: TokenKind): string {
  const punctuation: Partial<Record<TokenKind, string>> = {
    LeftParen: "(",
    RightParen: ")",
    LeftBracket: "[",
    RightBracket: "]",
    LeftBrace: "{",
    RightBrace: "}",
    Comma: ",",
    Colon: ":",
    Semicolon: ";",
    Dot: ".",
    Spread: "...",
    Equal: "=",
    FatArrow: "=>",
    Arrow: "->",
    ArrowQuestion: "->?",
    ArrowBang: "->!",
    Plus: "+",
    Minus: "-",
    Star: "*",
    Slash: "/",
    Power: "**",
    Concat: "++",
    EqualEqual: "==",
    NotEqual: "!=",
    Less: "<",
    Greater: ">",
    LessEqual: "<=",
    GreaterEqual: ">=",
    Range: "..",
    Pipe: "|>",
    Assign: ":=",
    Bar: "|",
    Wildcard: "_",
  };
  const spelling = punctuation[kind];
  if (spelling !== undefined) {
    return `\`${spelling}\``;
  }
  if (isKeyword(kind)) {
    return `\`${kind.toLowerCase()}\``;
  }
  switch (kind) {
    case "NonUpperName": return "a non-uppercase-start name";
    case "UpperName": return "an uppercase-start name";
    case "Integer": return "an integer literal";
    case "BigInt": return "a BigInt literal";
    case "Float": return "a Float literal";
    case "String": return "a string literal";
    case "VOpen": return "an indented block";
    case "VSep": return "a newline";
    case "VClose": return "the end of a block";
    case "Eof": return "end of file";
    default: return "that token";
  }
}

function isKeyword(kind: TokenKind): kind is Lexed.KeywordKind {
  return [
    "And", "Catch", "Constraint", "Derive", "Else", "Exception", "Export",
    "Extern", "False", "Finally", "For", "Fun", "Honor", "Iff", "If",
    "Implies", "Import", "In", "Let", "Match", "Not", "Or", "Record",
    "Then", "True", "Try", "Type", "Var", "While",
  ].includes(kind);
}

function missingEof(): LaidOut.Token {
  throw new Error("internal error: parser requires a non-empty token stream ending in Eof");
}
