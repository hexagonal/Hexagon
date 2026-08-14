/**
 * Conformance for the **imported** half of FFI Part 8 §8.2's optimizer freedom
 * (§15 row 18, #440): a call whose callee is an exported constrained
 * declaration in another module, and whose constrained variables all
 * instantiate at fundamental types, emits the Algorithm N edition by name
 * rather than the generic edition with trailing evidence.
 *
 * The same-module half predates this and is pinned in `emitter.test.ts`. What
 * is new here is everything the module boundary adds: the plan is recomputed
 * from the scheme the interface carries rather than read off local items, the
 * edition's name has to be *imported*, and the module it comes from has to be
 * emitted. That last one is defect 8's shape and is the reason several tests
 * here run the graph instead of reading it — a program can import `logString`
 * from a `Debug.js` that was never written, compile clean, and fail only at
 * load.
 *
 * **Every executed graph is made byte-distinct**, through the `distinct`
 * transform `debug-log.test.ts` introduced: emitted modules mount as `data:`
 * URLs and the registry caches those by text, so two tests compiling the same
 * program would share one `Debug.js` — and one captured sink.
 */

import { describe, expect, test } from "vitest";

import { compileFiles, runProject } from "../support/test-project.js";

/** Makes a graph's modules byte-distinct, so the test gets its own instances. */
function distinct(label: string): (path: string, javascript: string) => string {
  return (_path, javascript) => `// ${label}\n${javascript}`;
}

function emitted(
  files: readonly (readonly [string, string])[],
  path = "/main.hex",
): string {
  const project = compileFiles(files);
  expect(project.diagnostics.map(({ message }) => message)).toEqual([]);
  const module = project.modules.find(({ source }) => source.path === path);
  if (module === undefined) {
    throw new Error(
      `no emitted module at ${path}; emitted: ${
        project.modules.map(({ source }) => source.path).join(", ")
      }`,
    );
  }
  return module.javascript.text;
}

/**
 * Relative imports in the emitted JavaScript naming a module the project did not
 * emit — defect 8's general form. Empty is the only acceptable value.
 */
function danglingImports(
  files: readonly (readonly [string, string])[],
): readonly string[] {
  const project = compileFiles(files);
  const paths = new Set(project.modules.map(({ source }) => source.path));
  return project.modules.flatMap((module) =>
    [...module.javascript.text.matchAll(/from\s+"(\.[^"]+)"/gu)].flatMap((match) => {
      const specifier = match[1];
      if (specifier === undefined) return [];
      const target = `${specifier.replace(/\.js$/u, "")}.hex`.replace(/^\.\//u, "/");
      return paths.has(target) ? [] : [`${module.source.path} -> ${specifier}`];
    })
  );
}

const SHOW_PAIR =
  "export let pair<a: Show, b: Show>(x: a, y: b): String = show(x) ++ show(y)\n";

describe("a concrete call to a prelude constrained export", () => {
  test("reaches the `String` edition and asks for no evidence", () => {
    const javascript = emitted([["/main.hex", 'log("hello")\n']]);

    expect(javascript).toContain('import { logString } from "./Debug.js";');
    expect(javascript).toContain('logString("hello");');
    // The two things the edition replaces: the generic edition's aliased import
    // and the dictionary it would have been handed.
    expect(javascript).not.toContain("__log as log");
    expect(javascript).not.toContain("__Show_String");
  });

  test("reaches the `Int` edition, and through a nested call too", () => {
    const javascript = emitted([[
      "/main.hex",
      'log(trace("n", 7))\n',
    ]]);

    expect(javascript).toContain(
      'import { logInt, traceInt } from "./Debug.js";',
    );
    expect(javascript).toContain('logInt(traceInt("n", 7));');
    expect(javascript).not.toContain("__Show_Int");
  });

  /**
   * A constraint **member** is not a declaration Algorithm S enumerates: `show`
   * and `equals` are forwarders emitted from a `constraint` item, and the plan
   * walks `let` and `fun` items only, so no `showFloat` or `equalsString` exists
   * anywhere to call. The issue's specimen names both; the rule as implemented
   * covers `log` and `trace` — declarations — and leaves a member call as it
   * was. Nothing here is a choice this change made, and widening it would be
   * minting editions the export surface does not have.
   */
  test("a constraint member forwarder has no edition, at any type", () => {
    const javascript = emitted([[
      "/main.hex",
      "export let rendered: String = show(42)\n",
    ]]);

    expect(javascript).toContain('import { __show as show } from "./Show.js";');
    expect(javascript).toContain("const rendered = show(42, __Show_Int);");
    expect(javascript).not.toContain("showInt");
  });

  /**
   * The whole reachability claim in one assertion, and the reason the new
   * channel reports its specifiers: routing every call to an edition spends the
   * synthesized prelude import's entire name list, so the term channel reports
   * nothing while the file still imports `logString` from `Debug.js`.
   */
  test("keeps the module it imports the edition from in the emitted graph", () => {
    expect(danglingImports([["/main.hex", 'log("hello")\nlog(1)\n']])).toEqual([]);
  });

  test("runs, and the write reaches the sink", async () => {
    const host = globalThis as unknown as {
      console: { log: (...values: unknown[]) => void };
    };
    const lines: unknown[][] = [];
    const original = host.console.log;
    host.console.log = (...values: unknown[]) => {
      lines.push(values);
    };
    try {
      await runProject(
        [["/main.hex", 'log("through the edition")\nexport let ok: Int = 1\n']],
        { transform: distinct("specialized call sites: prelude edition") },
      );
    } finally {
      host.console.log = original;
    }

    expect(lines).toEqual([["through the edition"]]);
  });
});

describe("a concrete call across a source-written import", () => {
  test("reaches the edition while the source's own import line stays", () => {
    const javascript = emitted([
      ["/math.hex", "export let plus<a: Num>(x: a, y: a): a = x + y\n"],
      [
        "/main.hex",
        'import { plus } from "./math"\nexport let answer: Int = plus(20, 22)\n',
      ],
    ]);

    // Emitted because the source asked for it, not because the body reaches it.
    expect(javascript).toContain('import { __plus as plus } from "./math.js";');
    expect(javascript).toContain('import { plusInt } from "./math.js";');
    expect(javascript).toContain("const answer = plusInt(20, 22);");
    expect(javascript).not.toContain("__Num_Int");
  });

  test("names each variable's assignment in declaration order", () => {
    const javascript = emitted([
      ["/pair.hex", SHOW_PAIR],
      [
        "/main.hex",
        'import { pair } from "./pair"\n' +
          'export let answer: String = pair(1, "x")\n',
      ],
    ]);

    expect(javascript).toContain('import { pairIntString } from "./pair.js";');
    expect(javascript).toContain('const answer = pairIntString(1, "x");');
  });

  test("computes what the generic edition would have", async () => {
    const exports = await runProject(
      [
        ["/pair.hex", SHOW_PAIR],
        [
          "/main.hex",
          'import { pair } from "./pair"\n' +
            'export let answer: String = pair(1, "x")\n',
        ],
      ],
      { transform: distinct("specialized call sites: cartesian edition") },
    );

    expect(exports["answer"]).toBe("1x");
  });
});

describe("everything else keeps its trailing evidence", () => {
  test("a variable still in play carries the dictionary", () => {
    const javascript = emitted([
      ["/pair.hex", SHOW_PAIR],
      [
        "/main.hex",
        'import { pair } from "./pair"\n' +
          "export let half<b: Show>(y: b): String = pair(1, y)\n",
      ],
    ]);

    // The dictionary is this module's own parameter, spelled after the binder
    // `half` declares rather than after the one `pair` was written with (#425).
    expect(javascript).toMatch(
      /const half = \(y, (__Show_a)\) => pair\(1, y, __Show_Int, \1\);/u,
    );
  });

  /**
   * The residue the issue records as defensible rather than as a defect: the
   * rule keys on Part 8's fundamental set, and a user type is not in it, so
   * there is no edition to call and the instance the user wrote reaches the
   * call visibly.
   */
  test("a concrete user type has no edition to reach", () => {
    const javascript = emitted([
      [
        "/point.hex",
        "export record Point = {x: Int}\n" +
          "honor Show<Point> =\n" +
          "    show(value) = \"Point\"\n",
      ],
      [
        "/main.hex",
        'import { Point } from "./point"\n' +
          "export let answer: String = show(Point({x = 1}))\n",
      ],
    ]);

    expect(javascript).toContain("__Show_Point");
    expect(javascript).not.toContain("showPoint(");
  });

  /**
   * `Bool` and `Unit` are fundamental by enumeration (#147, #159) and their
   * editions are exported like any other, but a call site cannot be recognized
   * as reaching one: their evidence arrives structural rather than primitive,
   * because neither is a primitive any more. The same-module router has always
   * skipped them for this reason and the imported half matches it exactly —
   * recognizing them is an evidence-representation question, not this rule's.
   */
  test("`Bool` and `Unit` keep evidence, as the same-module router does", () => {
    const javascript = emitted([["/main.hex", "log(True)\nlog(())\n"]]);

    expect(javascript).toContain("__log as log");
    expect(javascript).not.toContain("logBool");
    expect(javascript).not.toContain("logUnit");
  });

  /**
   * The one fact no importer can read off a scheme, and therefore the one
   * carried on the import: `alias` is constrained, exported, and function-typed,
   * yet mints no editions at all, because the exporter's plan reads the *value*
   * and finds no lambda. Predicting from the scheme emits `import { aliasInt }`
   * beside a module that exports nothing of the kind.
   */
  test("an exported constrained alias mints no edition to call", () => {
    const files = [
      [
        "/alias.hex",
        "export let describe<a: Show>(x: a): String = show(x)\n" +
          "export let alias<a: Show>: (a) -> String = describe\n",
      ],
      [
        "/main.hex",
        'import { alias } from "./alias"\nexport let answer: String = alias(4)\n',
      ],
    ] as const;
    const javascript = emitted(files);

    expect(javascript).toContain("__Show_Int");
    expect(javascript).not.toContain("aliasInt");
    expect(danglingImports(files)).toEqual([]);
  });
});

describe("an edition's public name reaching a module that binds it", () => {
  /**
   * An edition's name is a source-level spelling, unlike every other name the
   * emitter mints, so a module is free to have bound it already. The source's
   * binding keeps the public name and the import moves aside — #425's
   * alias-only-on-collision rule, from the other side.
   */
  test("claims a reserved local, leaving the source's binding alone", () => {
    const javascript = emitted([[
      "/main.hex",
      "let logString(x: String): String = x\n" +
        'log("direct")\n' +
        'log(logString("through"))\n',
    ]]);

    expect(javascript).toContain(
      'import { logString as __logString } from "./Debug.js";',
    );
    expect(javascript).toContain("const logString = x => x;");
    expect(javascript).toContain('__logString("direct");');
    expect(javascript).toContain('__logString(logString("through"));');
  });

  test("runs with both names live", async () => {
    const host = globalThis as unknown as {
      console: { log: (...values: unknown[]) => void };
    };
    const lines: unknown[][] = [];
    const original = host.console.log;
    host.console.log = (...values: unknown[]) => {
      lines.push(values);
    };
    try {
      await runProject(
        [[
          "/main.hex",
          "let logString(x: String): String = x\n" +
            'log(logString("shadowed"))\n' +
            "export let ok: Int = 1\n",
        ]],
        { transform: distinct("specialized call sites: shadowed edition") },
      );
    } finally {
      host.console.log = original;
    }

    expect(lines).toEqual([["shadowed"]]);
  });
});
