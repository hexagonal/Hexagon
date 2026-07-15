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
    if (block.hasContent) {
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
  if (last?.kind === "FatArrow" || last?.kind === "Else" || last?.kind === "Catch") {
    return true;
  }

  const activeControl = lastControlHead(item);
  if (activeControl !== undefined) {
    if (activeControl.kind === "Try") {
      return activeControl.index === item.length - 1;
    }
    return activeControl.kind !== "If" ||
      !item.slice(activeControl.index + 1).some(({ kind }) => kind === "Then");
  }

  if (last?.kind !== "Equal") {
    return false;
  }

  const first = item[item[0]?.kind === "Export" ? 1 : 0];
  if (first?.kind === "Constraint" || first?.kind === "Honor") {
    return true;
  }
  if (first?.kind === "Record" || first?.kind === "Union" || first?.kind === "Type") {
    return false;
  }

  const beginsFunction =
    first?.kind === "LowerName" || first?.kind === "Let" || first?.kind === "Fun";
  return beginsFunction && item.some(({ kind }) => kind === "LeftParen");
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
