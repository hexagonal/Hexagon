/**
 * Platform-neutral public surface of the Hexagon compiler core.
 *
 * Host adapters import this module; compiler passes must not gain implicit
 * access to Node or browser globals through it.
 */

export * as Diagnostics from "./support/diagnostics.js";
export * as Source from "./support/source.js";
export * as Lexed from "./syntax/lexed/index.js";
export * as LaidOut from "./syntax/laid-out/index.js";
export * as Parsed from "./syntax/parsed/index.js";
export * as Resolved from "./syntax/resolved/index.js";
export * as Typed from "./syntax/typed/index.js";
export * as Core from "./syntax/core/index.js";
export * as Emitted from "./emission/index.js";
export { lex } from "./passes/lexer/lexer.js";
export { applyLayout } from "./passes/layout/layout.js";
export { parse } from "./passes/parser/parser.js";
export { resolve } from "./passes/resolver/resolver.js";
export { check } from "./passes/checker/checker.js";
export { elaborate } from "./passes/elaborator/elaborator.js";
export {
  emitJavaScript,
  emitDeclarations,
  emitTypeScriptPreview,
} from "./passes/emitter/emitter.js";
