/**
 * Spacing within a line (Canonical Layout §7): what each gap between two code
 * tokens on one line becomes.
 *
 * The table of §7.1 is read top to bottom, the first row that applies
 * deciding. Most rows ask only what the two tokens are; a few ask what a token
 * *does* — whether a `-` is a sign or a subtraction, whether a `<` opens a
 * binder list or compares — and `roles` answers those from the tokens around
 * it.
 */

import * as Source from "../support/source.js";
import { lex } from "../passes/lexer/lexer.js";
import type * as Lexed from "../syntax/lexed/index.js";

/** What a gap must be: exactly one space or none, or the author's choice. */
export type Rule = "one" | "none" | "kept" | "presence";

export interface Roles {
  /** A prefix sign: unary `-`, variance `+` and `-`, spread `...` (§7.1). */
  readonly prefix: ReadonlySet<number>;
  /** The `<` and `>` of a binder or type-argument list. */
  readonly binderOpen: ReadonlySet<number>;
  readonly binderClose: ReadonlySet<number>;
  /** `band`, `bor` and `bxor` written as operators (Lexer §4.2). */
  readonly bitwiseOperator: ReadonlySet<number>;
}

const operandEnds = new Set<Lexed.Token["kind"]>([
  "NonUpperName",
  "UpperName",
  "Integer",
  "BigInt",
  "Dec",
  "Float",
  "String",
  "RightParen",
  "RightBracket",
  "RightBrace",
  "Wildcard",
  "True",
  "False",
  "Bang",
  "Caret",
  "Tilde",
  "Question",
]);

const keywordKinds = new Set<string>([
  "And", "Assume", "Attempt", "Bnot", "Catch", "Constraint", "Derive", "Else",
  "Exception", "Export", "Extern", "False", "Finally", "For", "Fun", "Honor",
  "Iff", "If", "Implies", "Import", "In", "Let", "Match", "Not", "Or", "Record",
  "Then", "True", "Try", "Type", "Var", "While",
]);

const marks = new Set<string>(["Bang", "Caret", "Tilde", "Question"]);

const alwaysBinary = new Set<string>([
  "Star", "Slash", "Power", "Concat", "EqualEqual", "NotEqual", "LessEqual",
  "GreaterEqual", "And", "Or", "Implies", "Iff",
]);

const spacedOperators = new Set<string>([
  "Equal", "Assign", "FatArrow", "Bar", "Pipe", "Arrow", "ArrowFollows",
  "ArrowFollowsTilde", "ArrowFollowsTildeCaret", "ArrowFollowsCaret",
  "ArrowFollowsCaretTilde", "ArrowBang", "ArrowCaret", "ArrowTilde",
]);

/** The tokens a binder or type-argument list may hold between its `<` and `>`. */
const binderContents = new Set<string>([
  "NonUpperName", "UpperName", "Colon", "Comma", "LeftParen", "RightParen",
  "Less", "Greater", "Dot", "Wildcard", "Plus", "Minus", ...spacedOperators,
]);

const bitwiseWords = new Set(["band", "bor", "bxor"]);

/**
 * Contextual keywords (Lexer §4.2) that can stand before a bracket in their
 * keyword role, as in `derives (Eq, Show)`. Written with a space there they
 * keep it; written against the bracket they are the name they otherwise are.
 */
const contextualWords = new Set([
  "derives", "when", "with", "as", "from", "fault", "union", "pattern", "widens",
  "opaque", "module", "end", "class", "method", "get", "set", "new", "static",
  "default", "enum",
]);

export function isKeyword(token: Lexed.Token): boolean {
  return keywordKinds.has(token.kind);
}

function isName(token: Lexed.Token): boolean {
  return token.kind === "NonUpperName" || token.kind === "UpperName" || token.kind === "Wildcard";
}

/**
 * Reads the roles of §7.1's context-dependent tokens. `beginsItem` holds the
 * tokens that begin an item, before which nothing is an operand.
 */
export function roles(tokens: readonly Lexed.Token[], beginsItem: ReadonlySet<number>): Roles {
  const prefix = new Set<number>();
  const binderOpen = new Set<number>();
  const binderClose = new Set<number>();
  const bitwiseOperator = new Set<number>();

  const followsOperand = (index: number): boolean => {
    if (index === 0 || beginsItem.has(index)) return false;
    const previous = tokens[index - 1]!;
    if (binderClose.has(index - 1)) return false;
    return operandEnds.has(previous.kind);
  };

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    if (token.kind === "Spread") {
      prefix.add(index);
    } else if (token.kind === "Minus" || token.kind === "Plus") {
      if (!followsOperand(index) || bitwiseOperator.has(index - 1)) prefix.add(index);
    } else if (token.kind === "NonUpperName" && bitwiseWords.has(token.text)) {
      const previous = tokens[index - 1];
      const againstParen = previous?.kind === "RightParen" &&
        previous.span.end.offset === token.span.start.offset;
      if (followsOperand(index) && !againstParen) bitwiseOperator.add(index);
    } else if (token.kind === "Less" && !binderOpen.has(index)) {
      const close = binderEnd(tokens, index);
      if (
        close !== undefined && opensBinder(tokens, index, followsOperand(index)) &&
        !(followsOperand(index) && closesAgainstOperand(tokens, close))
      ) {
        markBinder(tokens, index, close, binderOpen, binderClose);
      }
    }
  }
  return { prefix, binderOpen, binderClose, bitwiseOperator };
}

function opensBinder(tokens: readonly Lexed.Token[], index: number, followsOperand: boolean): boolean {
  const previous = tokens[index - 1];
  if (previous === undefined || !followsOperand) return true;
  // After an operand, `<` opens a list only where it is written against a
  // name: `Show<Ping>`, `contains<a: Eq>`. Spaced, it compares.
  return isName(previous) && previous.span.end.offset === tokens[index]!.span.start.offset;
}

/**
 * Whether a `>` that would close a binder list is written against an operand
 * after it, as the `>` of `c>d` is: a list's `>` is followed by a space, `(`,
 * `=`, or a closer, never directly by a name or a literal.
 */
function closesAgainstOperand(tokens: readonly Lexed.Token[], close: number): boolean {
  const next = tokens[close + 1];
  if (next === undefined || next.span.start.offset !== tokens[close]!.span.end.offset) return false;
  return ["NonUpperName", "UpperName", "Integer", "BigInt", "Dec", "Float", "String", "Wildcard"]
    .includes(next.kind);
}

/** The `>` that closes a binder list opened at `open`, if the tokens allow one. */
function binderEnd(tokens: readonly Lexed.Token[], open: number): number | undefined {
  let depth = 0;
  let brackets = 0;
  for (let index = open; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    if (!binderContents.has(token.kind)) return undefined;
    if (token.kind === "LeftParen") brackets += 1;
    else if (token.kind === "RightParen") {
      if (brackets === 0) return undefined;
      brackets -= 1;
    } else if (token.kind === "Less") depth += 1;
    else if (token.kind === "Greater") {
      depth -= 1;
      if (depth === 0) return brackets === 0 ? index : undefined;
    }
  }
  return undefined;
}

function markBinder(
  tokens: readonly Lexed.Token[],
  open: number,
  close: number,
  binderOpen: Set<number>,
  binderClose: Set<number>,
): void {
  const stack: number[] = [];
  for (let index = open; index <= close; index += 1) {
    const kind = tokens[index]!.kind;
    if (kind === "Less") stack.push(index);
    else if (kind === "Greater") {
      const start = stack.pop();
      if (start !== undefined) {
        binderOpen.add(start);
        binderClose.add(index);
      }
    }
  }
}

function isBinary(tokens: readonly Lexed.Token[], roles: Roles, index: number): boolean {
  const kind = tokens[index]!.kind;
  if (alwaysBinary.has(kind)) return true;
  if (kind === "Plus" || kind === "Minus") return !roles.prefix.has(index);
  if (kind === "Less") return !roles.binderOpen.has(index);
  if (kind === "Greater") return !roles.binderClose.has(index);
  return roles.bitwiseOperator.has(index);
}

/** §7.1 and §7.2's rule for the gap between `tokens[index]` and the next token. */
export function rule(tokens: readonly Lexed.Token[], roles: Roles, index: number, gap: boolean): Rule {
  const left = tokens[index]!;
  const right = tokens[index + 1]!;
  // §7.2: gaps that carry meaning keep whether they are there.
  if (left.kind === "RightParen" && isName(right) && right.kind !== "Wildcard") return "presence";
  if (marks.has(left.kind) || marks.has(right.kind)) return "presence";

  if (isBinary(tokens, roles, index) || isBinary(tokens, roles, index + 1)) return "one";
  if (spacedOperators.has(left.kind) || spacedOperators.has(right.kind)) return "one";
  if (["Range", "Fraction"].includes(left.kind) || ["Range", "Fraction"].includes(right.kind)) {
    return "none";
  }
  if (left.kind === "Dot" || right.kind === "Dot") return "none";
  if (right.kind === "Comma" || right.kind === "Semicolon") return "none";
  if (left.kind === "Comma" || left.kind === "Semicolon") return "one";
  if (right.kind === "Colon") return "none";
  if (left.kind === "Colon") return "one";
  if (left.kind === "LeftBrace") return right.kind === "RightBrace" ? "none" : "one";
  if (right.kind === "RightBrace") return "one";
  if (left.kind === "LeftParen" || left.kind === "LeftBracket" || roles.binderOpen.has(index)) {
    return "none";
  }
  if (right.kind === "RightParen" || right.kind === "RightBracket" || roles.binderClose.has(index + 1)) {
    return "none";
  }
  const opensAfter = right.kind === "LeftParen" || right.kind === "LeftBracket" ||
    roles.binderOpen.has(index + 1);
  if (opensAfter) {
    const contextual = left.kind === "NonUpperName" && contextualWords.has(left.text) && gap;
    if (
      !contextual &&
      (isName(left) || ["RightParen", "RightBracket", "RightBrace"].includes(left.kind) ||
        roles.binderClose.has(index))
    ) {
      return "none";
    }
    if (roles.binderOpen.has(index + 1) && isKeyword(left)) return "none";
  }
  if (roles.prefix.has(index)) return "none";
  if (isKeyword(left) || isKeyword(right)) return "one";
  if ((isName(left) || roles.binderClose.has(index)) && isName(right)) return "one";
  return "kept";
}

/**
 * Whether writing two tokens against each other still reads as those two
 * tokens (§7.2's last paragraph): `- -x` keeps its space, since `--` begins a
 * comment.
 */
export function canJoin(left: string, right: string, kinds: readonly [string, string]): boolean {
  const joined = new Source.File(Source.fileId(0), "join.hex", left + right);
  const lexed = lex(joined);
  if (lexed.comments.length > 0 || lexed.diagnostics.length > 0) return false;
  const tokens = lexed.tokens.filter(({ kind }) => kind !== "Eof");
  return tokens.length === 2 && tokens[0]!.kind === kinds[0] && tokens[1]!.kind === kinds[1];
}
