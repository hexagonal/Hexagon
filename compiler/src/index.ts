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
export { lex } from "./passes/lexer/lexer.js";
export { applyLayout } from "./passes/layout/layout.js";
