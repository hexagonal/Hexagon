import { describe, expect, test } from "vitest";

import { compileProject, Source } from "../index";

/**
 * Conformance for the wrappers around a binding's right-hand side (issue #98).
 *
 * Lexer & Layout §2.1 gives every term binding a block, and says a single
 * wrapped expression "is simply the one-item case, so the ordinary multi-line
 * RHS is unaffected". The compiler did not read it that way: the block reached
 * every rule that inspects a right-hand side, so writing the same expression on
 * the next line changed what the binding meant — it stopped generalizing
 * (Functions §8.2), it stopped being an exported *function* for the signature
 * diagnostic, and a constrained one lost its evidence.
 *
 * The peel is one step in the resolver, so these tests are written as the
 * question a reader asks: does the program mean the same thing written three
 * ways? Constrained cases **execute**, because a generalized constrained
 * binding that never gets its dictionary compiles clean and dies at emission or
 * at runtime — the whole existing suite passed while that was broken.
 *
 * A multi-item block is deliberately *not* peeled; Functions §8.2 rules that it
 * is not a value, and the last describe block pins that and the other things
 * the peel must not license.
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

function compile(source: string) {
  return compileProject([new Source.File(Source.fileId(0), "/main.hex", source)]);
}

function diagnostics(source: string): readonly string[] {
  return compile(source).diagnostics.map((diagnostic) => diagnostic.message);
}

function javascript(source: string): string {
  const project = compile(source);
  expect(project.diagnostics).toEqual([]);
  return project.modules.find((module) => module.source.path === "/main.hex")!.javascript.text;
}

/** Compiles a single module and runs it, returning its exports. */
async function run(source: string): Promise<Record<string, unknown>> {
  const project = compile(source);
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

describe("a right-hand side means the same wherever it sits on the page", () => {
  test("an indented lambda generalizes, and is used at two types", async () => {
    const exports = await run(
      "let identity =\n" +
      "    (x) => x\n" +
      "export let whole: Int = identity(1)\n" +
      "export let text: String = identity(\"s\")\n",
    );
    expect(exports["whole"]).toBe(1);
    expect(exports["text"]).toBe("s");
  });

  test("every spelling of one binding agrees", async () => {
    const uses =
      "export let whole: Int = identity(1)\n" +
      "export let text: String = identity(\"s\")\n";
    for (
      const spelling of [
        "let identity = (x) => x\n",
        "let identity = ((x) => x)\n",
        "let identity =\n    (x) => x\n",
        "let identity =\n    ((x) => x)\n",
        "let identity = (\n    (x) => x\n    )\n",
      ]
    ) {
      const exports = await run(spelling + uses);
      expect(exports["whole"]).toBe(1);
      expect(exports["text"]).toBe("s");
    }
  });

  test("a declared type variable survives the indented spelling", async () => {
    // The worst tier: with `a` declared, the un-generalized variable was
    // defaulted, and *every* concrete call failed — a single monomorphic one
    // included — reporting `Int`, a type nobody wrote.
    const exports = await run(
      "let pick =\n" +
      "    <a>(left: a, right: a): a => left\n" +
      "export let whole: Int = pick(1, 2)\n",
    );
    expect(exports["whole"]).toBe(1);
  });

  test("an indented constrained binding carries its evidence and runs", async () => {
    // Generalizing without threading the dictionary is the silent half of this
    // defect: it compiled and then died at emission. Two element types, so one
    // shared dictionary would be wrong.
    const exports = await run(
      "let plus =\n" +
      "    (x, y) => x + y\n" +
      "export let whole: Int = plus(1, 2)\n" +
      "export let fractional: Float = plus(1.5, 2.25)\n",
    );
    expect(exports["whole"]).toBe(3);
    expect(exports["fractional"]).toBe(3.75);
  });

  test("declared type parameters and a constraint, indented, run too", async () => {
    const exports = await run(
      "let plus =\n" +
      "    <a: Num>(x: a, y: a): a => x + y\n" +
      "export let whole: Int = plus(1, 2)\n" +
      "export let fractional: Float = plus(1.5, 2.25)\n",
    );
    expect(exports["whole"]).toBe(3);
    expect(exports["fractional"]).toBe(3.75);
  });

  test("a parenthesized right-hand side written across lines still works", async () => {
    // The control, and it passes on `main`: newlines inside `(` are
    // continuation whitespace (Lexer & Layout §2.2), so no block ever opens
    // here — this is the parenthesized spelling, merely spread out, and the
    // peel must leave it exactly as capable as it was.
    const exports = await run(
      "let plus = (\n" +
      "    (x, y) => x + y\n" +
      "    )\n" +
      "export let whole: Int = plus(1, 2)\n" +
      "export let fractional: Float = plus(1.5, 2.25)\n",
    );
    expect(exports["whole"]).toBe(3);
    expect(exports["fractional"]).toBe(3.75);
  });

  test("a pattern binding is peeled too, and its binders generalize", async () => {
    // `LetPattern` is the third peeled position. One binder used at two types
    // is what discriminates: on `main` the indented spelling monomorphizes the
    // whole tuple, while the inline one is clean.
    const exports = await run(
      "let (identity, second) =\n" +
      "    ((x) => x, (y) => y)\n" +
      "export let whole: Int = identity(1)\n" +
      "export let text: String = identity(\"s\")\n" +
      "export let other: Int = second(2)\n",
    );
    expect(exports["whole"]).toBe(1);
    expect(exports["text"]).toBe("s");
    expect(exports["other"]).toBe(2);
  });

  test("an exported binding gets the same signature diagnostic every way", () => {
    // The parenthesized spelling belongs here as much as the indented one: only
    // `#isValue` had a `Group` case, so this check saw a non-lambda through
    // parentheses too and asked for the wrong thing.
    const message =
      "exported function `identity` requires a complete signature; " +
      "add type for parameter `x` and a return type";
    expect(diagnostics("export let identity = (x) => x\n")).toEqual([message]);
    expect(diagnostics("export let identity =\n    (x) => x\n")).toEqual([message]);
    expect(diagnostics("export let identity = ((x) => x)\n")).toEqual([message]);
  });

  test("a parenthesized exported constrained binding compiles and specializes", () => {
    // Rejected outright on `main` — ``exported value `plus` requires a type
    // annotation`` — for a binding whose signature is complete and written
    // right there. The parenthesis half of the peel is load-bearing.
    const project = compile("export let plus = (<a: Num>(x: a, y: a): a => x + y)\n");
    expect(project.diagnostics).toEqual([]);
    const module = project.modules.find(({ source }) => source.path === "/main.hex")!;
    expect(module.declarations.text).toContain("export declare function plusInt(");
  });

  test("a captured `let` is still promoted, so two callers get two types", async () => {
    // The promotion path in `#inferItems` reads the same value test: a `let`
    // captured by a `fun` is generalized ahead of the bodies rather than
    // placeheld monomorphically, and being written on the next line must not
    // cost it that either.
    const exports = await run(
      "let identity =\n" +
      "    (x) => x\n" +
      "fun whole(): Int = identity(1)\n" +
      "fun text(): String = identity(\"s\")\n" +
      "export let one: Int = whole()\n" +
      "export let other: String = text()\n",
    );
    expect(exports["one"]).toBe(1);
    expect(exports["other"]).toBe("s");
  });

  test("an exported constrained binding emits the same JS and `.d.ts` either way", () => {
    // Everything downstream reads the peeled right-hand side, so the two
    // spellings are the same program: the same trailing-evidence function, the
    // same zero-cost fundamental specializations (FFI Part 8), the same face.
    const signature = "<a: Num>(x: a, y: a): a => x + y\n";
    const [inline, indented] = [
      compile(`export let plus = ${signature}`),
      compile(`export let plus =\n    ${signature}`),
    ];
    expect(inline.diagnostics).toEqual([]);
    expect(indented.diagnostics).toEqual([]);
    const emitted = (project: ReturnType<typeof compile>) => {
      const module = project.modules.find(({ source }) => source.path === "/main.hex")!;
      return [module.javascript.text, module.declarations.text];
    };
    expect(emitted(indented)).toEqual(emitted(inline));
    expect(emitted(inline)[1]).toContain("export declare function plusInt(");
  });

  test("the emitted binding is the lambda, with its dictionary parameter", () => {
    // Not an immediately-invoked block, and not a bare `(x, y) => x + y` that
    // has silently monomorphized to `Int`.
    const emitted = javascript(
      "let plus =\n" +
      "    (x, y) => x + y\n" +
      "export let whole: Int = plus(1, 2)\n",
    );
    expect(emitted).toMatch(/^const plus = \(x, y, __hex_dict\w+\) =>/mu);
  });
});

describe("what the peel must not license", () => {
  test("a multi-item block is not a value, so it does not generalize", () => {
    // Functions §8.2: its earlier items are evaluated when the binding is, and
    // evaluation is what the value restriction is about. The first use fixes
    // the type, so the second is a mismatch.
    const messages = diagnostics(
      "let identity =\n" +
      "    let unused = 1\n" +
      "    (x) => x\n" +
      "export let whole: Int = identity(1)\n" +
      "export let text: String = identity(\"s\")\n",
    );
    expect(messages.length).toBeGreaterThan(0);
    expect(messages.some((message) => message.includes("expected Int, found String"))).toBe(true);
  });

  test("a multi-item block still binds and runs at one type", async () => {
    const exports = await run(
      "let identity =\n" +
      "    let unused = 1\n" +
      "    (x) => x\n" +
      "export let whole: Int = identity(1)\n",
    );
    expect(exports["whole"]).toBe(1);
  });

  test("a call is not a value in either spelling", () => {
    // The peel removes a wrapper; it must not make the wrapped expression a
    // value it was not. `make()` is a call on both lines and is a value on
    // neither, so `full` generalization is withheld in both spellings.
    //
    // The observable changed with #205 and the test moved with it. It used to
    // be a `Vector(a)` producer, whose variable item 7 now generalizes —
    // `Vector(+a)` is a compiler-side claim and the variable is unconstrained,
    // so Functions §8.2's own former counterexample compiles (closure doc
    // §4.4). What still separates a value from a computation is the *rest* of
    // item 7's remainder: `a -> a` puts the variable on both sides of an arrow,
    // so it is invariant, declined, and pinned by its first use.
    const uses =
      "export let whole: Int = xs(1)\n" +
      'export let text: String = strings("s")\n';
    const producer = "let make<a>(): (a -> a) = (x) => x\n";
    for (
      const spelling of [
        "let xs = make()\nlet strings = xs\n",
        "let xs =\n    make()\nlet strings = xs\n",
      ]
    ) {
      const messages = diagnostics(producer + spelling + uses);
      expect(messages.some((message) => message.includes("String"))).toBe(true);
    }
  });

  test("item 7 generalizes what the peel still refuses to call a value", () => {
    // The other side of the same coin, pinned so the pair reads together: the
    // value test says no, and the binding is polymorphic anyway — per variable,
    // and only because `Vector` carries a covariant claim (closure doc §4.4).
    for (
      const spelling of [
        "let xs = empty()\nlet strings = xs\n",
        "let xs =\n    empty()\nlet strings = xs\n",
      ]
    ) {
      expect(
        diagnostics(
          "let empty<a>(): Vector(a) = []\n" +
            spelling +
            "export let whole: Int = Vector.at(xs, 1)\n" +
            "export let text: String = Vector.at(strings, 1)\n",
        ),
      ).toEqual([]);
    }
  });

  test("`fun` still requires a lambda literal, wrappers included", () => {
    // Functions §7.1 is a check on the written right-hand side, and hoisting
    // rests on it; the peel happens after the parser and must leave it alone.
    const message = "`fun` requires a function header or lambda literal on its right-hand side";
    expect(diagnostics("fun identity = ((x) => x)\n")).toContain(message);
    expect(diagnostics("fun identity =\n    (x) => x\n")).toContain(message);
  });

  test("a block whose one item is a binding is still rejected", () => {
    // Only an *expression* item is peeled: a lone `let` leaves the block with
    // no value, which Statements §3.1 rejects.
    const messages = diagnostics(
      "let x =\n" +
      "    let y = 40\n" +
      "export let out: Int = x\n",
    );
    expect(messages.length).toBeGreaterThan(0);
  });
});
