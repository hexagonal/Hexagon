/** Messages exchanged with the compiler worker.
 *
 * The browser UI and compiler deliberately communicate through serializable
 * values. This keeps worker ownership clear and prevents editor objects from
 * leaking into the platform-neutral compiler API.
 */

export interface CompileRequest {
  readonly kind: "compile";
  readonly version: number;
  readonly source: string;
}

export interface PlaygroundDiagnostic {
  readonly severity: "error" | "warning" | "information";
  readonly message: string;
  readonly startOffset: number;
  readonly endOffset: number;
}

export interface TypeOccurrence {
  readonly name: string;
  readonly displayedType: string;
  readonly startOffset: number;
  readonly endOffset: number;
}

export interface GeneratedJavaScriptSection {
  readonly kind: "FundamentalSpecialization";
  readonly sourceName: string;
  readonly generatedName: string;
  readonly typeArguments: readonly string[];
  readonly startOffset: number;
  readonly endOffset: number;
  readonly bytes: number;
}

export interface ExecutableModule {
  readonly path: string;
  readonly javascript: string;
}

export interface CompileSuccess {
  readonly kind: "compile-success";
  readonly version: number;
  readonly javascript: string;
  readonly executionModules: readonly ExecutableModule[];
  readonly entryPath: string;
  readonly generatedJavaScript: readonly GeneratedJavaScriptSection[];
  readonly typeScriptPreview: string;
  readonly types: readonly TypeOccurrence[];
  readonly diagnostics: readonly PlaygroundDiagnostic[];
}

export interface CompileFailure {
  readonly kind: "compile-failure";
  readonly version: number;
  readonly diagnostics: readonly PlaygroundDiagnostic[];
}

/**
 * A region of the editor buffer. Every coordinate crossing this boundary is a
 * buffer offset: the virtual files the compiler sees are the worker's business
 * and the UI has no way to name one.
 */
export interface BufferRange {
  readonly startOffset: number;
  readonly endOffset: number;
}

/** Markdown, already rendered — the same sentence the language server sends. */
export interface PlaygroundHover {
  readonly markdown: string;
  readonly range: BufferRange;
}

export interface PlaygroundTextEdit extends BufferRange {
  readonly replacement: string;
}

/**
 * A repair the session offers.
 *
 * `disabled` carries the reason a repair must not be made, and an action that
 * has one has no edits. It is sent because it is the session's answer and this
 * is the shape that answer has; see `registerLanguageProviders` in `monaco.ts`
 * for how much of it a user currently sees, which is less than it should be.
 */
export interface PlaygroundCodeAction {
  readonly title: string;
  readonly kind: "quickfix" | "refactor";
  readonly edits: readonly PlaygroundTextEdit[];
  readonly disabled?: string;
}

export interface PlaygroundRenameSubject {
  readonly name: string;
  readonly range: BufferRange;
}

export interface PlaygroundRenameRefusal {
  readonly refused: string;
}

export interface PlaygroundRenamePlan {
  readonly newName: string;
  readonly edits: readonly PlaygroundTextEdit[];
}

/**
 * Every request that asks the session about one position or region.
 *
 * The source travels with the request rather than being accumulated from edits,
 * so an answer is always computed against text the caller named exactly. The
 * `version` is what the caller does with it afterwards: a reply about text the
 * user has since changed is dropped rather than applied.
 */
interface ServiceRequest {
  readonly id: number;
  readonly version: number;
  readonly source: string;
}

export interface HoverRequest extends ServiceRequest {
  readonly kind: "hover";
  readonly offset: number;
}

/**
 * Where a hover would answer, for the whole document at once.
 *
 * The only request here that names no position: it is asked by the host that has
 * to open the hover itself, which needs the answer before there is a position to
 * ask about. See `PlaygroundAnalysis.hoverSpans`.
 */
export interface HoverSpansRequest extends ServiceRequest {
  readonly kind: "hover-spans";
}

export interface CodeActionsRequest extends ServiceRequest, BufferRange {
  readonly kind: "code-actions";
}

export interface DefinitionRequest extends ServiceRequest {
  readonly kind: "definition";
  readonly offset: number;
}

export interface ReferencesRequest extends ServiceRequest {
  readonly kind: "references";
  readonly offset: number;
}

export interface PrepareRenameRequest extends ServiceRequest {
  readonly kind: "prepare-rename";
  readonly offset: number;
}

export interface RenameRequest extends ServiceRequest {
  readonly kind: "rename";
  readonly offset: number;
  readonly newName: string;
}

interface ServiceReply {
  readonly id: number;
  readonly version: number;
}

export interface HoverReply extends ServiceReply {
  readonly kind: "hover";
  readonly hover: PlaygroundHover | undefined;
}

export interface HoverSpansReply extends ServiceReply {
  readonly kind: "hover-spans";
  readonly ranges: readonly BufferRange[];
}

export interface CodeActionsReply extends ServiceReply {
  readonly kind: "code-actions";
  readonly actions: readonly PlaygroundCodeAction[];
}

export interface DefinitionReply extends ServiceReply {
  readonly kind: "definition";
  readonly ranges: readonly BufferRange[];
}

export interface ReferencesReply extends ServiceReply {
  readonly kind: "references";
  readonly ranges: readonly BufferRange[];
}

export interface PrepareRenameReply extends ServiceReply {
  readonly kind: "prepare-rename";
  readonly subject: PlaygroundRenameSubject | PlaygroundRenameRefusal | undefined;
}

export interface RenameReply extends ServiceReply {
  readonly kind: "rename";
  readonly result: PlaygroundRenamePlan | PlaygroundRenameRefusal | undefined;
}

/**
 * A request the worker could not answer at all, as opposed to one it answered
 * with nothing.
 *
 * The user sees the same thing either way — the editor draws nothing — and that
 * is not the point of keeping them apart. The point is the console: a service
 * that has started throwing is otherwise indistinguishable from a service with
 * nothing to say, and the difference only becomes visible if something says so.
 */
export interface ServiceFailure extends ServiceReply {
  readonly kind: "service-failure";
  readonly message: string;
}

export type CompilerRequest =
  | CompileRequest
  | HoverRequest
  | HoverSpansRequest
  | CodeActionsRequest
  | DefinitionRequest
  | ReferencesRequest
  | PrepareRenameRequest
  | RenameRequest;

export type ServiceReplyMessage =
  | HoverReply
  | HoverSpansReply
  | CodeActionsReply
  | DefinitionReply
  | ReferencesReply
  | PrepareRenameReply
  | RenameReply
  | ServiceFailure;

export type CompilerResponse = CompileSuccess | CompileFailure;
export type CompilerMessage = CompilerResponse | ServiceReplyMessage;

export interface ExecuteRequest {
  readonly kind: "execute";
  readonly version: number;
  readonly modules: readonly ExecutableModule[];
  readonly entryPath: string;
}

export interface ExecuteSuccess {
  readonly kind: "execute-success";
  readonly version: number;
}

export interface ExecuteOutput {
  readonly kind: "execute-output";
  readonly version: number;
  readonly line: string;
}

export interface ExecuteFailure {
  readonly kind: "execute-failure";
  readonly version: number;
  readonly message: string;
}

export type ExecutionRequest = ExecuteRequest;
export type ExecutionResponse = ExecuteSuccess | ExecuteFailure;
export type ExecutionEvent = ExecuteOutput | ExecutionResponse;
