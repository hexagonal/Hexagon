import { describe, expect, test } from "vitest";

import { compileProject, Source } from "../index";

/**
 * Conformance for tuple patterns beneath constructor patterns (Pattern Matching;
 * `spec/notes/compiler-conformance-defects.md`, 2026-07-26 defect 2).
 *
 * `Some((value, rest))` is the canonical way to consume the Loops §6.2 sequence
 * protocol, whose payload is `Option((a, Seq(a)))`. Exhaustiveness used to refuse
 * to count such an arm as covering its constructor -- reporting
 * "match is missing cases: `Some`" on a match that plainly handles `Some` --
 * because the constructor slot's declared type is the union's own parameter
 * (`Some(value: a)`), and a tuple pattern was only accepted as irrefutable when
 * the expected type was already known to be a tuple.
 *
 * The arity diagnostic is a different, correct check and is pinned here too:
 * `Some(value, rest)` really is a two-argument pattern against a one-slot
 * constructor, and must keep failing.
 */

function diagnostics(source: string): readonly string[] {
  const project = compileProject([new Source.File(Source.fileId(0), "/main.hex", source)]);
  return project.diagnostics.map((diagnostic) => diagnostic.message);
}

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

/**
 * Compiles and returns `/main.hex`'s exports. The entry is selected by path, never
 * by position: once a program touches a prelude nominal, prelude modules are
 * emitted too and `modules[0]` is one of them, not the entry.
 */
async function run(source: string): Promise<Record<string, unknown>> {
  const project = compileProject([new Source.File(Source.fileId(0), "/main.hex", source)]);
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

describe("a tuple pattern beneath a constructor covers its case", () => {
  test("Option carrying a tuple — the sequence-protocol shape", () => {
    expect(diagnostics(
      "let pair: Option((Int, Int)) = Some((1, 2))\n" +
      "export let total: Int = match pair\n" +
      "    None => 0\n" +
      "    Some((left, right)) => left + right\n",
    )).toEqual([]);
  });

  test("not Option-specific: Result carrying a tuple", () => {
    expect(diagnostics(
      "let outcome: Result((Int, Int), String) = Ok((1, 2))\n" +
      "export let total: Int = match outcome\n" +
      "    Err(reason) => 0\n" +
      "    Ok((left, right)) => left + right\n",
    )).toEqual([]);
  });

  test("a user union carrying a tuple", () => {
    expect(diagnostics(
      "union Holder(a) =\n" +
      "    | Empty\n" +
      "    | Held(item: a)\n" +
      "let held: Holder((Int, Int)) = Held((1, 2))\n" +
      "export let total: Int = match held\n" +
      "    Empty => 0\n" +
      "    Held((left, right)) => left + right\n",
    )).toEqual([]);
  });

  test("nested one level deeper", () => {
    expect(diagnostics(
      "let nested: Option(((Int, Int), Int)) = Some(((1, 2), 3))\n" +
      "export let total: Int = match nested\n" +
      "    None => 0\n" +
      "    Some(((a, b), c)) => a + b + c\n",
    )).toEqual([]);
  });

  test("a record pattern beneath a constructor covers too", () => {
    // Structural record payload: the nominal spelling (`Some(Point({ x, y }))`)
    // is not writable at all yet -- that is issue #83, independent of this defect.
    expect(diagnostics(
      "union Holder =\n" +
      "    | Nothing\n" +
      "    | Held(point: { x: Int, y: Int })\n" +
      "let held: Holder = Held({ x = 1, y = 2 })\n" +
      "export let total: Int = match held\n" +
      "    Nothing => 0\n" +
      "    Held({ x, y }) => x + y\n",
    )).toEqual([]);
  });

  test("the covering arm actually runs and binds both components", async () => {
    const m = await run(
      "let pair: Option((Int, String)) = Some((7, \"seven\"))\n" +
      "export let n: Int = match pair\n" +
      "    None => 0\n" +
      "    Some((count, _)) => count\n" +
      "export let s: String = match pair\n" +
      "    None => \"\"\n" +
      "    Some((_, label)) => label\n",
    );
    expect(m.n).toBe(7);
    expect(m.s).toBe("seven");
  });
});

describe("exhaustiveness still rejects what it should", () => {
  test("a genuinely missing constructor is still reported", () => {
    const messages = diagnostics(
      "let pair: Option((Int, Int)) = Some((1, 2))\n" +
      "export let total: Int = match pair\n" +
      "    Some((left, right)) => left + right\n",
    );
    expect(messages.some((message) => message.includes("missing cases: `None`"))).toBe(true);
  });

  test("a refutable tuple element does not make the arm covering", () => {
    // `Some((1, rest))` matches only when the first component is 1, so `Some`
    // remains uncovered.
    const messages = diagnostics(
      "let pair: Option((Int, Int)) = Some((1, 2))\n" +
      "export let total: Int = match pair\n" +
      "    None => 0\n" +
      "    Some((1, right)) => right\n",
    );
    expect(messages.some((message) => message.includes("missing cases: `Some`"))).toBe(true);
  });

  test("the arity check is untouched", () => {
    const messages = diagnostics(
      "let pair: Option((Int, Int)) = Some((1, 2))\n" +
      "export let total: Int = match pair\n" +
      "    None => 0\n" +
      "    Some(left, right) => left + right\n",
    );
    expect(messages.some((message) =>
      message.includes("expects 1 arguments, got 2")
    )).toBe(true);
  });
});
