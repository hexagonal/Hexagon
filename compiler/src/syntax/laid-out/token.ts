/**
 * Laid-out syntax is the parser's token stream. Physical tokens retain their
 * lexical payloads, while virtual tokens make indentation-delimited blocks
 * explicit and remove any need for the parser to inspect source columns.
 */

import type * as Diagnostics from "../../support/diagnostics.js";
import type * as Source from "../../support/source.js";
import type * as Lexed from "../lexed/index.js";

export type VirtualKind = "VOpen" | "VSep" | "VClose";

/**
 * Layout's report of a block a line requires and does not open (Lexer &
 * Layout §2.1's rows). An empty honor's is its one report, which the parser
 * reads the rest of the file past (`Parsed.Module.readAsWritten`).
 */
export const MISSING_BLOCK = "expected an indented block";

export interface VirtualToken {
  readonly kind: VirtualKind;
  readonly span: Source.Span;
}

export type Token = Lexed.Token | VirtualToken;

export interface File {
  readonly fileId: Source.FileId;
  /** The source this file was scanned from; see `Lexed.File.text`. */
  readonly text: string;
  readonly tokens: readonly Token[];
  readonly comments: readonly Source.Comment[];
  readonly diagnostics: readonly Diagnostics.Diagnostic[];
}
