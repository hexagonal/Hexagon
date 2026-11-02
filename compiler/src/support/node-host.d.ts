// The few Node host functions `test-project.ts` uses to write an emitted
// program to disk and run it. The compiler itself names no host module, so the
// project carries no Node type definitions; these are typed here, for the test
// harness alone.

declare module "node:fs" {
  export function mkdtempSync(prefix: string): string;
  export function mkdirSync(path: string, options?: { readonly recursive?: boolean }): string | undefined;
  export function writeFileSync(path: string, data: string): void;
}

declare module "node:os" {
  export function tmpdir(): string;
}

declare module "node:path" {
  export function dirname(path: string): string;
  export function join(...parts: readonly string[]): string;
}

declare module "node:url" {
  export function pathToFileURL(path: string): { readonly href: string };
}
