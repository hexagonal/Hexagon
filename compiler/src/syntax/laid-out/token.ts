/**
 * Laid-out syntax is the parser's token stream. Physical tokens retain their
 * lexical payloads, while virtual tokens make indentation-delimited blocks
 * explicit and remove any need for the parser to inspect source columns.
 */

import type * as Diagnostics from "../../support/diagnostics.js";
import type * as Source from "../../support/source.js";
import type * as Lexed from "../lexed/index.js";

export type VirtualKind = "VOpen" | "VSep" | "VClose";

export interface VirtualToken {
  readonly kind: VirtualKind;
  readonly span: Source.Span;
}

export type Token = Lexed.Token | VirtualToken;

export interface File {
  readonly fileId: Source.FileId;
  readonly tokens: readonly Token[];
  readonly comments: readonly Source.Comment[];
  readonly diagnostics: readonly Diagnostics.Diagnostic[];
}
