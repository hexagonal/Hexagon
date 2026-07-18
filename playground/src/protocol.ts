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
  readonly typeOccurrences: readonly TypeOccurrence[];
  readonly diagnostics: readonly PlaygroundDiagnostic[];
}

export interface CompileFailure {
  readonly kind: "compile-failure";
  readonly version: number;
  readonly diagnostics: readonly PlaygroundDiagnostic[];
}

export type CompilerRequest = CompileRequest;
export type CompilerResponse = CompileSuccess | CompileFailure;

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
