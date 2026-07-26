import { describe, expect, test } from "vitest";

import { compileProject, Source } from "../index";

/**
 * Behavioural conformance for the `Seq(a)` core (Loops §6, spec/notes/seq-core-representation.md).
 *
 * The first test in this file is a *poison test*: it feeds the harness a module
 * that cannot compile and asserts the harness says so. Before #78 `compileProject`
 * reported success for a project whose non-entry modules were broken, so a
 * conformance run over `stdlib/Seq.hex` could pass while `Seq.hex` never compiled
 * at all. The poison test is the standing proof that this channel is honest; if it
 * ever goes green-by-passing, every other assertion below is worthless.
 */

/** Minimal ESM linker: rewrite compiler-owned relative imports to data-URL modules. */
function resolveModulePath(importer: string, specifier: string): string | undefined {
  if (!specifier.startsWith("./") && !specifier.startsWith("../")) return undefined;
  const directory = importer.slice(0, Math.max(0, importer.lastIndexOf("/")));
  const parts: string[] = [];
  for (const part of `${directory}/${specifier}`.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  const path = `/${parts.join("/")}`;
  return path.endsWith(".js") ? `${path.slice(0, -3)}.hex` : path;
}

function link(
  javascript: string,
  importerPath: string,
  moduleUrls: ReadonlyMap<string, string>,
): string {
  return javascript.replace(
    /^(\s*import(?:[^;\n]*?\sfrom)?\s+)(["'])([^"']+)\2;/gmu,
    (statement, prefix: string, _quote: string, specifier: string) => {
      const target = resolveModulePath(importerPath, specifier);
      const url = target === undefined ? undefined : moduleUrls.get(target);
      return url === undefined ? statement : `${prefix}${JSON.stringify(url)};`;
    },
  );
}

/** Compiles entry `/main.hex` plus extras, and returns every diagnostic the project reports. */
function diagnose(
  source: string,
  extras: readonly (readonly [string, string])[] = [],
): readonly { readonly message: string }[] {
  const files = [
    ...extras.map(([path, text], index) => new Source.File(Source.fileId(index + 1), path, text)),
    new Source.File(Source.fileId(0), "/main.hex", source),
  ];
  return compileProject(files).diagnostics;
}

/** Compiles a program (entry `/main.hex` plus extras) and returns the entry's exports. */
async function run(
  source: string,
  extras: readonly (readonly [string, string])[] = [],
): Promise<Record<string, unknown>> {
  const files = [
    ...extras.map(([path, text], index) => new Source.File(Source.fileId(index + 1), path, text)),
    new Source.File(Source.fileId(0), "/main.hex", source),
  ];
  const project = compileProject(files);
  // The project-wide bag, not just the entry's: a broken *extra* must fail here.
  expect(project.diagnostics).toEqual([]);
  const moduleUrls = new Map<string, string>();
  for (const module of project.modules) {
    const linked = link(module.javascript.text, module.source.path, moduleUrls);
    moduleUrls.set(
      module.source.path,
      `data:text/javascript;charset=utf-8,${encodeURIComponent(linked)}`,
    );
  }
  return (await import(/* @vite-ignore */ moduleUrls.get("/main.hex")!)) as Record<string, unknown>;
}

describe("harness honesty (poison test)", () => {
  test("a broken non-entry module is reported by the project channel", () => {
    // `/Poison.hex` is deliberately ill-typed: `plus` claims `Int` and returns a
    // `String`. The entry is well-formed and never touches the bad binding, so a
    // harness that only inspected `/main.hex` would call this project clean.
    const poison =
      "export let plus(left: Int, right: Int): Int = \"not an Int\"\n";
    const entry =
      'import * as Poison from "./Poison"\n' +
      "export let ok: Int = 1\n";
    const diagnostics = diagnose(entry, [["/Poison.hex", poison]]);
    expect(diagnostics).not.toEqual([]);
  });

  test("`run` refuses a project whose non-entry module is broken", async () => {
    const poison =
      "export let plus(left: Int, right: Int): Int = \"not an Int\"\n";
    const entry =
      'import * as Poison from "./Poison"\n' +
      "export let ok: Int = 1\n";
    await expect(run(entry, [["/Poison.hex", poison]])).rejects.toThrow();
  });

  test("the same harness passes a project whose non-entry module is sound", async () => {
    const sound = "export let plus(left: Int, right: Int): Int = left + right\n";
    const entry =
      'import * as Sound from "./Sound"\n' +
      "export let three: Int = Sound.plus(1, 2)\n";
    const m = await run(entry, [["/Sound.hex", sound]]);
    expect(m.three).toBe(3);
  });
});

