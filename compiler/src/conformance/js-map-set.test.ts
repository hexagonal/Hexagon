import { describe, expect, test } from "vitest";

import { compileProject, Source } from "../index";
import { compileFiles, projectDiagnostics } from "../support/test-project.js";
import { typeScriptErrors } from "../support/typescript-check.js";

/**
 * Conformance for FFI Part 10's borrowed foreign views, `JsMap(k, v)` and
 * `JsSet(a)` (#396).
 *
 * The types had no representation in the type system at all until this arc — no
 * `Mono`, no annotation kind — which is why Collections Part 5 §4's nine-row
 * provided-instance table shipped with seven real coherence slots and two
 * absentees. The slots are what this file is mostly about: Part 10 §6.1 binds
 * `Item = (k, v)` and `Item = a`, and §6.2 inherits the native insertion order
 * rather than manufacturing one.
 *
 * **The iteration tests execute against genuine native values**, through a real
 * foreign module. Nothing else would be evidence: the whole claim of §6.3 is
 * that a native `Map`'s entries are *already* representation-correct tuples and
 * a native `Set` yields its elements, so zero adaptation happens anywhere — and
 * a test that read emitted text would be reading the absence of code.
 *
 * The surfaces Part 10 §3–§5 and §7 name — `JsMap.get`, the `jsMap[key]`
 * bracket, `JsSet.contains`, the four conversions — are deliberately **not**
 * here. They are not implemented, and FFI Part 2 §9.1's doctrine is absent
 * until implementable, never a stub.
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

/**
 * A `data:` URL is a module *identity*, so two runs whose emitted text is
 * byte-identical share one instantiated module — and one copy of the foreign
 * side's values with it. Every fixture below is textually distinct anyway, but
 * the tag makes that a convenience rather than a load-bearing accident.
 */
let runTag = 0;

/** Compiles a project with foreign modules and executes it, returning `/main.hex`'s exports. */
async function run(
  source: string,
  foreign: Readonly<Record<string, string>>,
): Promise<Record<string, unknown>> {
  const project = compileProject([new Source.File(Source.fileId(0), "/main.hex", source)]);
  expect(project.diagnostics).toEqual([]);
  runTag += 1;
  const url = (text: string): string =>
    `data:text/javascript;charset=utf-8,${encodeURIComponent(text)}#run${runTag}`;
  const moduleUrls = new Map<string, string>();
  for (const [specifier, text] of Object.entries(foreign)) {
    moduleUrls.set(specifier, url(text));
  }
  for (const module of project.modules) {
    const linked = link(module.javascript.text, module.source.path, moduleUrls)
      .replace(
        /^(\s*import(?:[^;\n]*?\sfrom)?\s+)(["'])([^"']+)\2;/gmu,
        (statement, prefix: string, _quote: string, specifier: string) => {
          const target = moduleUrls.get(specifier);
          return target === undefined ? statement : `${prefix}${JSON.stringify(target)};`;
        },
      );
    moduleUrls.set(module.source.path, url(linked));
  }
  return (await import(/* @vite-ignore */ moduleUrls.get("/main.hex")!)) as Record<
    string,
    unknown
  >;
}

/** The generated `.d.ts` text of a one-module program that must compile clean. */
function declarations(source: string): string {
  const project = compileFiles([["/main.hex", source]]);
  expect(project.diagnostics).toEqual([]);
  return project.modules.find(({ source: file }) => file.path === "/main.hex")!
    .declarations.text;
}

/** The emitted JavaScript of a one-module program that must compile clean. */
function javascript(source: string): string {
  const project = compileFiles([["/main.hex", source]]);
  expect(project.diagnostics).toEqual([]);
  return project.modules.find(({ source: file }) => file.path === "/main.hex")!
    .javascript.text;
}

describe("iteration over the real thing (Part 10 §6)", () => {
  /**
   * §6.1's `JsMap` row and §6.3's zero-adaptation claim in one observation. The
   * tuple pattern destructures the native entry directly: JS `Map` iteration
   * yields two-element arrays and a Hexagon tuple *is* a plain JS array, so
   * nothing between the foreign iterator and the pattern converts anything.
   *
   * The keys are accumulated as well as the values, and in a way the order can
   * be read off — §6.2 makes native insertion order the contract, inherited
   * from the foreign object rather than manufactured by the view. A traversal
   * that sorted, reversed, or re-keyed would still sum to 6.
   */
  test("`for (key, value) in` a native Map sees entries in insertion order", async () => {
    const exports = await run(
      'extern from "table"\n' +
        "    fun table(): JsMap(String, Int)\n" +
        "\n" +
        "export fun walk(): (String, Int) =\n" +
        '    var letters = ""\n' +
        "    var total = 0\n" +
        "    for (key, value) in table!()\n" +
        "        letters := letters ++ key\n" +
        "        total := total + value\n" +
        "    (letters, total)\n",
      {
        table: 'export function table() {\n' +
          '  return new Map([["c", 1], ["a", 2], ["b", 3]]);\n' +
          "}\n",
      },
    );
    expect((exports["walk"] as () => [string, number])()).toEqual(["cab", 6]);
  });

  /** §6.1's `JsSet` row: `Item = a`, the element itself and nothing wrapping it. */
  test("`for x in` a native Set sees its elements", async () => {
    const exports = await run(
      'extern from "flags"\n' +
        "    fun flags(): JsSet(Int)\n" +
        "\n" +
        "export fun sum(): Int =\n" +
        "    var running = 0\n" +
        "    for flag in flags!()\n" +
        "        running := running + flag\n" +
        "    running\n",
      { flags: "export function flags() { return new Set([4, 5, 6, 5]); }\n" },
    );
    expect((exports["sum"] as () => number)()).toBe(15);
  });

  /**
   * §6.3: the derived `Seq` obeys full `Seq` persistence — positions are
   * persistent and forcing memoizes — *over a borrowed view*. That is not free:
   * the implementation may hold one native iterator behind a memoizing spine,
   * and a non-memoizing adapter answers `3 + 0` here rather than `3 + 60`,
   * because a `Set`'s iterator is single-shot once acquired.
   *
   * Under a valid borrow (§2) live and snapshot observation coincide, which is
   * what makes the memoizing choice unobservable and therefore lawful.
   */
  test("a `Seq` derived from a borrowed view is re-traversable", async () => {
    const exports = await run(
      'extern from "scores"\n' +
        "    fun scores(): JsSet(Int)\n" +
        "\n" +
        "export fun twice(): Int =\n" +
        "    let sequence = toSeq(scores!())\n" +
        "    Seq.length(sequence) + Seq.fold(sequence, 0, (acc, n) => acc + n)\n",
      { scores: "export function scores() { return new Set([10, 20, 30]); }\n" },
    );
    expect((exports["twice"] as () => number)()).toBe(63);
  });

  /** The same, at `JsMap`, where the items are pairs rather than scalars. */
  test("a `Seq` of a borrowed map's entries replays as pairs", async () => {
    const exports = await run(
      'extern from "prices"\n' +
        "    fun prices(): JsMap(String, Int)\n" +
        "\n" +
        "export fun report(): Int =\n" +
        "    let rows = toSeq(prices!())\n" +
        "    let count = Seq.length(rows)\n" +
        "    count + Seq.fold(rows, 0, (acc, pair) =>\n" +
        "        match pair\n" +
        "            (_, value) => acc + value)\n",
      {
        prices: "export function prices() {\n" +
          '  return new Map([["pen", 7], ["ink", 9]]);\n' +
          "}\n",
      },
    );
    expect((exports["report"] as () => number)()).toBe(18);
  });

  /**
   * §6.4's emission license, read off the text: a loop over a borrowed view is
   * a native `for…of` over the foreign object, with no evidence fetched and no
   * `toSeq` call. This is #353's ruling 2 — the row is the semantics and static
   * dispatch is its *erasure* — reaching the newest two rows unchanged.
   */
  test("a loop over a borrowed view emits native `for…of`, asking for no evidence", () => {
    const text = javascript(
      'extern from "./stock.js"\n' +
        "    fun stock(): JsSet(Int)\n" +
        "\n" +
        "export fun tally(): Int =\n" +
        "    var seen = 0\n" +
        "    for item in stock!()\n" +
        "        seen := seen + item\n" +
        "    seen\n",
    );
    expect(text).toContain("for (const item of stock())");
    expect(text).not.toContain("toSeq");
  });
});

describe("the `.d.ts` faces (Part 10 §1)", () => {
  /**
   * The faces are TypeScript's own readonly interfaces, not `Hex.` types: a
   * `JsMap` *is* the caller's own `Map`, so a brand would be a lie, and the
   * readonly spelling says the only thing the boundary has to say — Hexagon
   * exposes no mutation on a borrowed view (§1).
   */
  const FACES = 'extern from "./stores.js"\n' +
    "    fun store(): JsMap(String, Int)\n" +
    "    fun marks(): JsSet(Float)\n" +
    "\n" +
    "export let table: JsMap(String, Int) = store!()\n" +
    "export let marked: JsSet(Float) = marks!()\n" +
    "export let keep(m: JsMap(String, Int)): JsMap(String, Int) = m\n" +
    "export let hold(s: JsSet(Float)): JsSet(Float) = s\n";

  test("`JsMap(String, Int)` faces as `ReadonlyMap<string, number>`", () => {
    expect(declarations(FACES)).toContain(
      "export declare const table: ReadonlyMap<string, number>;",
    );
  });

  test("`JsSet(Float)` faces as `ReadonlySet<number>`", () => {
    expect(declarations(FACES)).toContain(
      "export declare const marked: ReadonlySet<number>;",
    );
  });

  test("parameter and result positions both take the readonly face", () => {
    const text = declarations(FACES);
    expect(text).toContain(
      "export declare const keep: (m: ReadonlyMap<string, number>) => " +
        "ReadonlyMap<string, number>;",
    );
    expect(text).toContain(
      "export declare const hold: (s: ReadonlySet<number>) => ReadonlySet<number>;",
    );
  });

  test("nesting renders both layers", () => {
    expect(
      declarations(
        'extern from "./grids.js"\n' +
          "    fun grid(): JsMap(String, JsSet(Int))\n" +
          "\n" +
          "export let cells: JsMap(String, JsSet(Int)) = grid!()\n",
      ),
    ).toContain(
      "export declare const cells: ReadonlyMap<string, ReadonlySet<number>>;",
    );
  });

  /**
   * The spelling is the cheap half; what the row is *for* is what `tsc` does
   * with it. Reads and iteration compile, and the four writes Part 10 §1 denies
   * do not — which is the whole content of "borrowed, read-only".
   */
  test("the emitted declarations compile, and the mutators are refused, by `tsc`", async () => {
    const face = declarations(FACES);
    expect(await typeScriptErrors({ "main.d.ts": face })).toEqual([]);

    expect(
      await typeScriptErrors({
        "main.d.ts": face,
        "consumer.ts": 'import { table, marked } from "./main.js";\n' +
          "export const one: number | undefined = table.get(\"a\");\n" +
          "export const known: boolean = table.has(\"a\");\n" +
          "export const size: number = marked.size;\n" +
          "export function total(): number {\n" +
          "  let sum = 0;\n" +
          "  for (const [, value] of table) sum += value;\n" +
          "  for (const mark of marked) sum += mark;\n" +
          "  return sum;\n" +
          "}\n",
      }),
    ).toEqual([]);

    const errors = await typeScriptErrors({
      "main.d.ts": face,
      "consumer.ts": 'import { table, marked } from "./main.js";\n' +
        'table.set("a", 1);\n' +
        'table.delete("a");\n' +
        "marked.add(2);\n" +
        "marked.clear();\n",
    });
    expect(errors).toHaveLength(4);
    for (const error of errors) expect(error).toContain("error TS2339");
  });
});

describe("boundary legality of the parameters (Part 10 §8)", () => {
  /**
   * §8 cites Part 1 §5.3 rather than extending it: an adapter-requiring type is
   * rejected *inside* a borrowed container, exactly as it is inside `Array`.
   * The rule is about where the bridge could be attached — a `Seq` at the top
   * of a declaration is wrapped, and buried in a container there is nothing to
   * wrap — and a borrowed view is a container like any other.
   */
  test("`JsMap(String, Seq(Int))` is the nested-adapter hard error", () => {
    expect(projectDiagnostics(
      'extern from "./feed.js"\n    fun feed(): JsMap(String, Seq(Int))\n',
    )).toContain(
      "extern type `Seq` requires adaptation inside a direct value; use an " +
        "explicit eager conversion at the boundary or a foreign shim",
    );
  });

  test("`JsSet(Seq(Int))` is refused the same way", () => {
    expect(projectDiagnostics(
      'extern from "./bunch.js"\n    fun bunch(): JsSet(Seq(Int))\n',
    )).toContain(
      "extern type `Seq` requires adaptation inside a direct value; use an " +
        "explicit eager conversion at the boundary or a foreign shim",
    );
  });

  /** The key position is walked too, not only the value. */
  test("the key position is checked as well", () => {
    expect(projectDiagnostics(
      'extern from "./index.js"\n    fun keyed(): JsMap(Seq(Int), String)\n',
    )).toContain(
      "extern type `Seq` requires adaptation inside a direct value; use an " +
        "explicit eager conversion at the boundary or a foreign shim",
    );
  });

  /**
   * The other half of §8: representation-direct and borrowed types nest freely,
   * so the restriction is about adaptation and not about nesting.
   */
  test("borrowed and representation-direct types nest freely", () => {
    expect(projectDiagnostics(
      'extern from "./mixed.js"\n' +
        "    fun mixed(): JsMap(String, Array(Int))\n" +
        "    fun sets(): JsSet(Vector(Float))\n",
    )).toEqual([]);
  });
});

describe("arity, and what outranks the intrinsic", () => {
  test("`JsMap` takes two arguments", () => {
    expect(projectDiagnostics(
      'extern from "./one.js"\n    fun one(): JsMap(Int)\n',
    )).toContain("type `JsMap` expects 2 arguments, but 1 were provided");
  });

  test("`JsSet` takes one", () => {
    expect(projectDiagnostics(
      'extern from "./two.js"\n    fun two(): JsSet(Int, Int)\n',
    )).toContain("type `JsSet` expects 1 argument, but 2 were provided");
  });

  /**
   * Modules §5.5, and defect-log entry 6 behind it: the boundary intrinsics are
   * a fallback consulted *after* the declaration tables, so a user record or
   * union of either name is an ordinary nominal type and neither row ever
   * reaches it. Its face is its own name — mutable-looking, and correctly so.
   */
  test("a user `record JsMap(k, v)` occludes the intrinsic and keeps its own face", () => {
    const text = declarations(
      "export record JsMap(k, v) = { key: k, value: v }\n" +
        "export fun pair(key: String, value: Int): JsMap(String, Int) =\n" +
        "    JsMap({ key = key, value = value })\n",
    );
    expect(text).toContain("export type JsMap<a, b> = { key: a; value: b };");
    expect(text).toContain(
      "export declare function pair(key: string, value: number): JsMap<string, number>;",
    );
    expect(text).not.toContain("ReadonlyMap");
  });

  test("a user `union JsSet(a)` occludes the intrinsic too", () => {
    const text = declarations(
      "export union JsSet(a) = Nothing | One(item: a)\n" +
        "export fun wrap(item: Int): JsSet(Int) = One(item)\n",
    );
    expect(text).toContain(
      "export declare function wrap(item: number): JsSet<number>;",
    );
    expect(text).not.toContain("ReadonlySet");
  });

  /**
   * The occlusion is not merely a naming question: a user `JsSet` is *not*
   * iterable, because the provided row is keyed on the intrinsic constructor
   * and the user declaration is a different type entirely.
   */
  test("a user type of the name does not inherit the provided row", () => {
    expect(projectDiagnostics(
      "record JsSet(a) = { only: a }\n" +
        "export fun scan(): Unit =\n" +
        "    for item in JsSet({ only = 1 })\n" +
        "        ()\n",
    ).join("\n")).toContain("is not iterable. Define `honor Iterable<JsSet(a)>`");
  });
});
