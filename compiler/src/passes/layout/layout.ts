/**
 * Layout turns physical line structure into explicit virtual block tokens.
 * Deeper indentation is a continuation by default; it opens a block only
 * when the preceding logical item has a syntactic block head.
 */

import * as Diagnostics from "../../support/diagnostics.js";
import type * as Source from "../../support/source.js";
import type * as LaidOut from "../../syntax/laid-out/index.js";
import type * as Lexed from "../../syntax/lexed/index.js";

interface Block {
  readonly indentation: number;
  readonly delimiterDepth: number;
  readonly item: Lexed.Token[];
  hasContent: boolean;
}

type DelimiterKind = "LeftParen" | "LeftBracket" | "LeftBrace";

const openingDelimiters = new Set<Lexed.Token["kind"]>([
  "LeftParen",
  "LeftBracket",
  "LeftBrace",
]);

const closingDelimiter = new Map<Lexed.Token["kind"], DelimiterKind>([
  ["RightParen", "LeftParen"],
  ["RightBracket", "LeftBracket"],
  ["RightBrace", "LeftBrace"],
]);

const clauseContinuations = new Set<Lexed.Token["kind"]>([
  "Then",
  "Else",
  "Catch",
  "Finally",
]);

/**
 * Tokens that can only *continue* an expression, never begin a new item. A line
 * at an open block's own indentation that starts with one of these continues the
 * preceding item instead of receiving a VSEP, so an aligned multiline chain
 * (`numbers` / `.filter(...)` / `.take(5)`) stays one expression while an
 * ordinary item on the next line still starts a new one.
 *
 * The set is closed against the current expression grammar: a token belongs only
 * while it cannot begin an expression. `Minus` is absent because it is also
 * unary negation, and `Less` is absent for the same reason since the type-parameter
 * lambda form (`<a: Ord>(x) => ...`, Functions §4.2) made `<` expression-initial.
 */
const expressionContinuations = new Set<Lexed.Token["kind"]>([
  "Dot",
  "Pipe",
  "Plus",
  "Star",
  "Slash",
  "EqualEqual",
  "NotEqual",
  "LessEqual",
  "GreaterEqual",
  "Greater",
  "Range",
  "Arrow",
  "Comma",
  "And",
  "Or",
  "RightParen",
  "RightBracket",
  "RightBrace",
]);

/** Makes the module block and every nested offside block explicit. */
export function applyLayout(file: Lexed.File): LaidOut.File {
  const diagnostics = new Diagnostics.Bag();
  for (const diagnostic of file.diagnostics) {
    diagnostics.add(diagnostic);
  }

  const physical = file.tokens.filter(
    (token): token is Exclude<Lexed.Token, Lexed.EofToken> => token.kind !== "Eof",
  );
  const eof = file.tokens.at(-1);
  if (eof?.kind !== "Eof") {
    throw new Error("internal error: a lexed file must end with Eof");
  }

  const tokens: LaidOut.Token[] = [];
  const firstSpan = physical[0]?.span ?? eof.span;
  const blocks: Block[] = [
    {
      indentation: physical[0]?.span.start.column ?? 0,
      delimiterDepth: 0,
      item: [],
      hasContent: false,
    },
  ];
  const delimiters: DelimiterKind[] = [];
  tokens.push(virtual("VOpen", firstSpan));

  let previous: Lexed.Token | undefined;
  for (let index = 0; index < physical.length; index += 1) {
    const token = physical[index];
    if (token === undefined) {
      continue;
    }

    const beginsPhysicalLine =
      previous !== undefined && token.span.start.line > previous.span.end.line;
    if (beginsPhysicalLine) {
      beginLine(token, blocks, delimiters.length, tokens, diagnostics);
    }

    closeBlocksEndedByDelimiter(token, blocks, delimiters, tokens);

    validateSemicolon(
      token,
      physical[index - 1],
      physical[index + 1],
      delimiters.length,
      currentBlock(blocks).delimiterDepth,
      diagnostics,
    );
    tokens.push(token);

    const block = currentBlock(blocks);
    block.item.push(token);
    block.hasContent = true;

    updateDelimiters(token, delimiters);
    if (
      token.kind === "Semicolon" &&
      delimiters.length === block.delimiterDepth
    ) {
      block.item.length = 0;
      block.hasContent = false;
    }

    previous = token;
  }

  const finalBlock = currentBlock(blocks);
  if (expectsBlock(finalBlock.item)) {
    diagnostics.add({
      severity: "error",
      message: "expected an indented block",
      primary: eof.span,
    });
  }

  while (blocks.length > 1) {
    blocks.pop();
    tokens.push(virtual("VClose", eof.span));
  }
  tokens.push(virtual("VClose", eof.span), eof);

  return {
    fileId: file.fileId,
    tokens,
    comments: file.comments,
    diagnostics: diagnostics.toArray(),
  };
}

function beginLine(
  token: Lexed.Token,
  blocks: Block[],
  delimiterDepth: number,
  output: LaidOut.Token[],
  diagnostics: Diagnostics.Bag,
): void {
  let block = currentBlock(blocks);
  const indentation = token.span.start.column;
  const continuesClause = clauseContinuations.has(token.kind);

  if (indentation > block.indentation && expectsBlock(block.item)) {
    output.push(virtual("VOpen", token.span));
    block.item.length = 0;
    blocks.push({ indentation, delimiterDepth, item: [], hasContent: false });
    return;
  }

  if (delimiterDepth > block.delimiterDepth) {
    return;
  }

  if (indentation < block.indentation) {
    while (blocks.length > 1 && indentation < currentBlock(blocks).indentation) {
      blocks.pop();
      output.push(virtual("VClose", token.span));
    }
    block = currentBlock(blocks);

    if (delimiterDepth > block.delimiterDepth) {
      return;
    }

    if (indentation !== block.indentation) {
      const candidates = blocks.map(({ indentation: column }) => column).join(", ");
      diagnostics.add({
        severity: "error",
        message: `inconsistent dedent; expected one of columns ${candidates}`,
        primary: token.span,
      });
    }
  }

  block = currentBlock(blocks);
  if (continuesClause) {
    block.item.length = 0;
    return;
  }

  if (indentation <= block.indentation) {
    if (expectsBlock(block.item)) {
      diagnostics.add({
        severity: "error",
        message: "expected an indented block",
        primary: token.span,
      });
    }
    if (block.hasContent && !expressionContinuations.has(token.kind)) {
      output.push(virtual("VSep", token.span));
      block.item.length = 0;
      block.hasContent = false;
    }
  }
}

function expectsBlock(item: readonly Lexed.Token[]): boolean {
  if (item.length === 0) {
    return false;
  }

  const last = item.at(-1);
  if (
    last?.kind === "FatArrow" ||
    last?.kind === "Then" ||
    last?.kind === "Else" ||
    last?.kind === "Catch" ||
    last?.kind === "Finally"
  ) {
    return true;
  }

  const activeControl = lastControlHead(item);
  if (activeControl !== undefined) {
    if (activeControl.kind === "Try") {
      return activeControl.index === item.length - 1;
    }
    if (activeControl.kind === "If") {
      // A bare `if` remains a recovery head so the parser can diagnose the
      // formerly valid layout spelling at the right boundary. Valid multiline
      // conditionals open their true-branch block after mandatory `then`.
      const hasThen = item
        .slice(activeControl.index + 1)
        .some(({ kind }) => kind === "Then");
      return !hasThen;
    }
    return true;
  }

  const first = item[item[0]?.kind === "Export" ? 1 : 0];
  if (
    first?.kind === "Extern" &&
    item.some((token) => token.kind === "NonUpperName" && token.text === "from") &&
    last?.kind === "String"
  ) {
    return true;
  }

  if (last?.kind !== "Equal") {
    return false;
  }

  if (first?.kind === "Constraint" || first?.kind === "Honor") {
    return true;
  }
  // A union declaration head is recognized contextually here for the same
  // reason the parser recognizes it contextually (#373): `union` is an ordinary
  // `NonUpperName` since the Set step, and the test is the token after it. A
  // *name* follows only in a declaration; a member binding spelled `union(l, r)`
  // has a `LeftParen` there and must keep opening its block like any other.
  const unionHead = first?.kind === "NonUpperName" && first.text === "union" &&
    ["UpperName", "NonUpperName"].includes(item[item[0]?.kind === "Export" ? 2 : 1]?.kind ?? "");
  if (first?.kind === "Record" || unionHead || first?.kind === "Type") {
    return false;
  }
  // Every term binding opens a block: `let x =`, `var x =`, and `fun f(...) =`
  // alike are followed by a block whose value is its final expression. (A single
  // wrapped expression is the one-item case.) Type declarations above keep their
  // continuation treatment — indented union alternatives receive no VOPEN.
  if (first?.kind === "Let" || first?.kind === "Fun" || first?.kind === "Var") {
    return true;
  }
  // A `widens` declaration is a term binding too (Constraints §4.7, #546), and
  // its head is recognized contextually here for `union`'s reason and by
  // `union`'s test: the word is an ordinary `NonUpperName`, and only a
  // declaration puts an *uppercase* module alias after it. A member binding
  // spelled `widens(l, r)` has a `LeftParen` there and keeps opening its block
  // through the parameter-list rule below.
  if (
    first?.kind === "NonUpperName" && first.text === "widens" &&
    item[item[0]?.kind === "Export" ? 2 : 1]?.kind === "UpperName"
  ) {
    return true;
  }

  return hasBindingParameterList(item);
}

function hasBindingParameterList(item: readonly Lexed.Token[]): boolean {
  let index = item[0]?.kind === "Export" ? 1 : 0;
  const first = item[index];
  if (first?.kind === "NonUpperName") {
    return item[index + 1]?.kind === "LeftParen";
  }
  if (first?.kind !== "Let" && first?.kind !== "Fun") return false;

  index += 2; // binding keyword and name
  if (item[index]?.kind === "Less") {
    let depth = 1;
    index += 1;
    while (index < item.length && depth > 0) {
      if (item[index]?.kind === "Less") depth += 1;
      else if (item[index]?.kind === "Greater") depth -= 1;
      index += 1;
    }
  }
  return item[index]?.kind === "LeftParen";
}

function lastControlHead(
  item: readonly Lexed.Token[],
): { readonly kind: Lexed.Token["kind"]; readonly index: number } | undefined {
  const controls = new Set<Lexed.Token["kind"]>(["If", "For", "While", "Match", "Try"]);
  for (let index = item.length - 1; index >= 0; index -= 1) {
    const kind = item[index]?.kind;
    if (kind !== undefined && controls.has(kind)) {
      return { kind, index };
    }
  }
  return undefined;
}

function validateSemicolon(
  token: Lexed.Token,
  previous: Lexed.Token | undefined,
  next: Lexed.Token | undefined,
  delimiterDepth: number,
  blockDelimiterDepth: number,
  diagnostics: Diagnostics.Bag,
): void {
  if (token.kind !== "Semicolon") {
    return;
  }

  if (delimiterDepth > blockDelimiterDepth) {
    diagnostics.add({
      severity: "error",
      message: "did you mean `,`? `;` only separates statements.",
      primary: token.span,
    });
    return;
  }

  const hasLeft =
    previous !== undefined &&
    previous.kind !== "Semicolon" &&
    previous.span.end.line === token.span.start.line;
  const hasRight =
    next !== undefined &&
    next.kind !== "Semicolon" &&
    // A group's closer is not a statement. `f(a; )` ends its block at the `)`
    // exactly as a dedent would, so the `;` is trailing and §5's diagnostic is
    // owed. Only reachable since blocks began closing at delimiters (§2.2) —
    // before that these inputs died in the parser and never got this far.
    !closingDelimiter.has(next.kind) &&
    next.span.start.line === token.span.end.line;

  const touchesSemicolon = previous?.kind === "Semicolon" || next?.kind === "Semicolon";
  if (touchesSemicolon || !hasLeft) {
    diagnostics.add({
      severity: "error",
      message: "`;` must have a statement on both sides.",
      primary: token.span,
    });
  } else if (!hasRight) {
    diagnostics.add({
      severity: "error",
      message: "`;` separates statements; Hexagon lines don't end with one.",
      primary: token.span,
    });
  }
}

/**
 * Closes every layout block opened inside the group a closing delimiter ends
 * (Lexer & Layout §2.2).
 *
 * The offside rule closes blocks on dedented lines, and a group's `)`/`]`/`}`
 * may share a line with the block's last item — `Seq({ pull = () => match x`
 * … `A => y })`. There is no dedent to see, so the block would otherwise still
 * be open when the parser reaches the delimiter, which reads the `}` as the
 * next match arm. Each block records the delimiter depth it was opened at, so
 * the ones this group encloses are those whose recorded depth is at least
 * `delimiters.length` — the closer has not been popped yet, so that count still
 * includes the group being closed, and deeper nesting is a larger number.
 *
 * A closer with no matching opener closes nothing: it is already an error, and
 * unwinding real blocks on it would turn one stray character into a cascade.
 */
function closeBlocksEndedByDelimiter(
  token: Lexed.Token,
  blocks: Block[],
  delimiters: readonly DelimiterKind[],
  output: LaidOut.Token[],
): void {
  const expected = closingDelimiter.get(token.kind);
  if (expected === undefined || delimiters.at(-1) !== expected) {
    return;
  }

  while (
    blocks.length > 1 &&
    currentBlock(blocks).delimiterDepth >= delimiters.length
  ) {
    blocks.pop();
    output.push(virtual("VClose", token.span));
  }
}

function updateDelimiters(token: Lexed.Token, delimiters: DelimiterKind[]): void {
  if (openingDelimiters.has(token.kind)) {
    delimiters.push(token.kind as DelimiterKind);
    return;
  }

  const expected = closingDelimiter.get(token.kind);
  if (expected !== undefined && delimiters.at(-1) === expected) {
    delimiters.pop();
  }
}

function currentBlock(blocks: readonly Block[]): Block {
  const block = blocks.at(-1);
  if (block === undefined) {
    throw new Error("internal error: layout always has a module block");
  }
  return block;
}

function virtual(kind: LaidOut.VirtualKind, anchor: Source.Span): LaidOut.VirtualToken {
  const position = anchor.start;
  return {
    kind,
    span: { fileId: anchor.fileId, start: position, end: position },
  };
}
