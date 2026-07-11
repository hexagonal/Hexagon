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

export interface InferredBinding {
  readonly name: string;
  readonly displayedType: string;
}

export interface CompileSuccess {
  readonly kind: "compile-success";
  readonly version: number;
  readonly javascript: string;
  readonly declarations: string;
  readonly types: readonly InferredBinding[];
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
  readonly javascript: string;
}

export interface ExecuteSuccess {
  readonly kind: "execute-success";
  readonly version: number;
  readonly output: readonly string[];
}

export interface ExecuteFailure {
  readonly kind: "execute-failure";
  readonly version: number;
  readonly message: string;
  readonly output: readonly string[];
}

export type ExecutionRequest = ExecuteRequest;
export type ExecutionResponse = ExecuteSuccess | ExecuteFailure;
