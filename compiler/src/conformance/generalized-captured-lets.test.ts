import { describe, expect, test } from "vitest";

import { compileProject, Source } from "../index";

/**
 * Conformance for the value restriction across the capture boundary (Functions §8;
 * `spec/notes/compiler-conformance-defects.md`, 2026-07-26 defect 1).
 *
 * A module-level `let` whose value is a syntactic value generalizes. Being
 * *captured by a function* must not cost it that generalization. The checker used
 * to install every captured `let` as a monomorphic placeholder before checking any
 * function body, which fused all of that binding's uses into a single type — so a
 * generic helper called from two functions, or from one function under a declared
 * type variable, collapsed.
 *
 * The defect was first found as "recursive functions cannot call `Seq.next`", and
 * was originally logged that way. Both halves of that description were wrong, and
 * the tests below pin the corrected characterisation: neither recursion nor
 * annotations are required — only that the callee is a captured `let` and the
 * caller is a `fun`. `var`s and non-value `let`s stay monomorphic, which is
 * correct and is pinned too.
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

describe("a captured `let` keeps its generalization", () => {
  test("the reproduction: a `fun` calling a generic annotated `let`", () => {
    // The minimal case from the defect log. `ident` and `repeat` each declare their
    // own `a`; pinning `ident` monomorphic forced the two to unify, reported as
    // "`a` and `a` are distinct declared type variables".
    expect(diagnostics(
      "let ident(value: a): a = value\n" +
      "export fun repeat(value: a, n: Int): a =\n" +
      "    if n <= 0 then\n" +
      "        value\n" +
      "    else\n" +
      "        repeat(ident(value), n - 1)\n",
    )).toEqual([]);
  });

  test("recursion is not required — a non-recursive `fun` caller is the same case", () => {
    expect(diagnostics(
      "let ident(value: a): a = value\n" +
      "export fun once(value: a): a = ident(value)\n",
    )).toEqual([]);
  });

  test("annotations are not required — an unannotated helper serves two types", () => {
    expect(diagnostics(
      "let ident(value) = value\n" +
      "export fun useBoth(): Int =\n" +
      "    let text: String = ident(\"x\")\n" +
      "    ident(1)\n",
    )).toEqual([]);
  });

  test("two functions may use one captured helper at different types", () => {
    expect(diagnostics(
      "let ident(value: a): a = value\n" +
      "export fun asInt(value: Int): Int = ident(value)\n" +
      "export fun asText(value: String): String = ident(value)\n",
    )).toEqual([]);
  });

  test("a `fun` callee was always fine — the `let`/`fun` asymmetry is gone", () => {
    expect(diagnostics(
      "fun ident(value: a): a = value\n" +
      "export fun once(value: a): a = ident(value)\n",
    )).toEqual([]);
  });

  test("a promoted helper may itself depend on another promoted helper", () => {
    // Dependency order across the promoted set, not just fun-to-let.
    expect(diagnostics(
      "let ident(value: a): a = value\n" +
      "let twice(value: a): a = ident(ident(value))\n" +
      "export fun asInt(value: Int): Int = twice(value)\n" +
      "export fun asText(value: String): String = twice(value)\n",
    )).toEqual([]);
  });

  test("a promoted helper may depend on a `fun`", () => {
    // The reverse edge: `let` -> `fun` must still order correctly.
    expect(diagnostics(
      "fun wrap(value: a): Option(a) = Some(value)\n" +
      "let wrapTwice(value: a): Option(Option(a)) = wrap(wrap(value))\n" +
      "export fun useInt(value: Int): Option(Option(Int)) = wrapTwice(value)\n" +
      "export fun useText(value: String): Option(Option(String)) = wrapTwice(value)\n",
    )).toEqual([]);
  });
});

describe("what must stay monomorphic still does", () => {
  test("a captured non-value `let` still does NOT generalize", () => {
    // `makeEmpty()` is a function *call*, so the value restriction denies
    // generalization (Functions §8). `shared` must therefore pin to one element
    // type, and the second use must fail. This is the guard that the promotion
    // above did not quietly generalize everything.
    const messages = diagnostics(
      "let makeEmpty() = []\n" +
      "let shared = makeEmpty()\n" +
      "export fun useInt(values: Vector(Int)): Bool = shared == values\n" +
      "export fun useText(values: Vector(String)): Bool = shared == values\n",
    );
    expect(messages).not.toEqual([]);
  });

  test("promotion applies inside a function body too, not just at module level", () => {
    // `#inferItems` runs for block items as well; a local helper captured by a
    // local `fun` takes the same path.
    expect(diagnostics(
      "export fun outer(): Int =\n" +
      "    let ident(value: a): a = value\n" +
      "    fun useInt(n: Int): Int = ident(n)\n" +
      "    useInt(ident(1))\n",
    )).toEqual([]);
  });

  test("a genuinely over-general annotation is still rejected", () => {
    // The 2026-07-24 rigid-type-variable rule is untouched: a declared `a` that
    // the body forces to `Int` remains an error.
    const messages = diagnostics("export fun bad(value: a): a = value + 1\n");
    expect(messages).not.toEqual([]);
  });
});

describe("the generalized helper actually runs", () => {
  test("one captured helper drives two element types at runtime", async () => {
    const m = await run(
      "let ident(value: a): a = value\n" +
      "export fun asInt(value: Int): Int = ident(value)\n" +
      "export fun asText(value: String): String = ident(value)\n" +
      "export let n: Int = asInt(7)\n" +
      "export let s: String = asText(\"seven\")\n",
    );
    expect(m.n).toBe(7);
    expect(m.s).toBe("seven");
  });
});
