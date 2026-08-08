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
export { compileProject, isInjectedModule } from "./project.js";
export type { CompiledModule, CompiledProject } from "./project.js";
export type { RuntimeLocation, RuntimeLocations } from "./passes/emitter/emitter.js";
export {
  collectTypeOccurrences,
  type TypeOccurrence,
} from "./queries/type-occurrences.js";
export {
  AnalysisSession,
  refused,
  type ActionEdit,
  type CodeAction,
  type Definition,
  type Hover,
  type Location,
  type OffsetRange,
  type Reference,
  type RenameEdit,
  type RenamePlan,
  type RenameRefusal,
  type RenameResult,
  type RenameSubject,
  type SessionOptions,
} from "./analysis/session.js";
export { hoverMarkdown } from "./analysis/hover-text.js";
export {
  collectOccurrences,
  targetKey,
  type ModuleInput,
  type Occurrence,
  type Role,
  type Target,
} from "./queries/occurrences.js";
export {
  collectSemanticTokens,
  type SemanticToken,
  type SemanticTokenModifier,
  type SemanticTokenType,
} from "./queries/semantic-tokens.js";
export { collectSymbolFacts, type SymbolFacts } from "./queries/symbol-facts.js";
export {
  DocumentationIndex,
  type DocumentedModule,
  type DocumentedName,
} from "./queries/documentation.js";
export {
  collectCompletions,
  qualifierAt,
  type Completion,
  type CompletionInput,
  type CompletionKind,
} from "./queries/completions.js";
export {
  emitJavaScript,
  emitDeclarations,
  emitTypeScriptPreview,
} from "./passes/emitter/emitter.js";
