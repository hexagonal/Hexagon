import { describe, expect, test } from "vitest";

import { compileProject, Source } from "../index";
import { PRELUDE_SOURCES } from "../prelude-sources.js";
import { codeOnly } from "../support/free-identifiers.js";
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
 * *(#792.)* Part 10 §3's read-and-construct surfaces landed with
 * `stdlib/JsMap.hex` and `stdlib/JsSet.hex`, and they are the second half of
 * this file. Every pin below executes against genuine native values for the
 * reason the iteration pins do: the claims are about the *foreign* object's
 * equality, its `size`, its constructor and its throws, none of which a reading
 * of emitted text is evidence about. What is still absent is still absent —
 * the `jsMap[key]` bracket (#793), the `jsSet[x]` refusal (#794), and the four
 * conversions (#795, #796) — and FFI Part 2 §9.1's doctrine is absence until
 * implementable, never a stub.
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
        "    let sequence = Iterable.toSeq(scores!())\n" +
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
        "    let rows = Iterable.toSeq(prices!())\n" +
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

describe("`JsMap.get` and the two-step lowering (Part 10 §4.2)", () => {
  /**
   * The whole reason §4.2 asks `has` before `get`, measured: a native `get`
   * alone answers `undefined` for a stored `undefined` and for an absent key
   * alike, and `v` may lawfully be `undefined` — `Unit` is, and so are
   * `Nullable(a)` and the opaque extern types.
   *
   * `JsMap(String, Unit)` is the sharpest case the type system can state: every
   * value in the map *is* `undefined`, so a fused lowering answers `None`
   * everywhere and this test's first row would agree with its second.
   */
  test("a present `undefined` value is `Some`, and only absence is `None`", async () => {
    const exports = await run(
      'extern from "voids"\n' +
        "    fun voids(): JsMap(String, Unit)\n" +
        "\n" +
        "let answer(m: JsMap(String, Unit), key: String): String =\n" +
        "    match JsMap.get(m, key)\n" +
        '        None => "none"\n' +
        '        Some(_) => "some"\n' +
        "\n" +
        "export fun probe(): (String, String) =\n" +
        "    let m = voids!()\n" +
        '    (answer(m, "stored"), answer(m, "missing"))\n',
      {
        voids: "export function voids() {\n" +
          '  return new Map([["stored", undefined]]);\n' +
          "}\n",
      },
    );
    expect((exports["probe"] as () => [string, string])()).toEqual(["some", "none"]);
  });

  /** The same distinction at a `Nullable` value, the other `undefined`-bearing face. */
  test("a stored `Nullable` `undefined` is `Some` too", async () => {
    const exports = await run(
      'extern from "maybes"\n' +
        "    fun maybes(): JsMap(String, Nullable(Int))\n" +
        "\n" +
        "let read(m: JsMap(String, Nullable(Int)), key: String): String =\n" +
        "    match JsMap.get(m, key)\n" +
        '        None => "absent"\n' +
        '        Some(_) => "present"\n' +
        "\n" +
        "export fun probe(): (String, String) =\n" +
        "    let m = maybes!()\n" +
        '    (read(m, "empty"), read(m, "nothing"))\n',
      {
        maybes: "export function maybes() {\n" +
          '  return new Map([["empty", undefined]]);\n' +
          "}\n",
      },
    );
    expect((exports["probe"] as () => [string, string])()).toEqual(["present", "absent"]);
  });

  /** And an ordinary value comes back, so the accessor is not merely a predicate. */
  test("a present ordinary value is handed back inside the `Some`", async () => {
    const exports = await run(
      'extern from "prices"\n' +
        "    fun prices(): JsMap(String, Int)\n" +
        "\n" +
        "let read(m: JsMap(String, Int), key: String): Int =\n" +
        "    match JsMap.get(m, key)\n" +
        "        None => 0\n" +
        "        Some(value) => value\n" +
        "\n" +
        "export fun probe(): (Int, Int) =\n" +
        "    let m = prices!()\n" +
        '    (read(m, "pen"), read(m, "nib"))\n',
      { prices: 'export function prices() { return new Map([["pen", 7]]); }\n' },
    );
    expect((exports["probe"] as () => [number, number])()).toEqual([7, 0]);
  });

  /**
   * §4.2 step 1: the map and key expressions are evaluated **exactly once
   * each**. Here that is true by construction rather than by arrangement — the
   * accessor is ordinary Hexagon over two function parameters, which are values
   * by the time the body runs — and the foreign side counts, so the
   * construction is measured rather than asserted.
   */
  test("the map and the key are each evaluated once", async () => {
    const exports = await run(
      'extern from "counted"\n' +
        "    fun table(): JsMap(String, Int)\n" +
        "    fun key(): String\n" +
        "    fun calls(): Int\n" +
        "\n" +
        "export fun probe(): Int =\n" +
        "    match JsMap.get(table!(), key!())\n" +
        "        None => calls!()\n" +
        "        Some(_) => calls!()\n",
      {
        counted: "let count = 0;\n" +
          'const shared = new Map([["a", 1]]);\n' +
          "export function table() { count += 1; return shared; }\n" +
          'export function key() { count += 1; return "a"; }\n' +
          "export function calls() { return count; }\n",
      },
    );
    expect((exports["probe"] as () => number)()).toBe(2);
  });
});

describe("the fresh `size` read (Part 10 §3, Collections Part 5 §3.1)", () => {
  /**
   * Never cached and never hoisted. Both reads sit in one Hexagon function with
   * a foreign mutation between them, so a compiler treating the pure-faced
   * `size` as a value to compute once would answer `(1, 1)` — which is the
   * defect the discipline exists against, since foreign code owns the
   * collection and the borrow contract permits it to change.
   */
  test("two reads of one borrowed map see a foreign mutation between them", async () => {
    const exports = await run(
      'extern from "growing"\n' +
        "    fun table(): JsMap(String, Int)\n" +
        "    fun grow(): Int\n" +
        "\n" +
        "export fun probe(): (Int, Int) =\n" +
        "    let m = table!()\n" +
        "    let before = JsMap.size(m)\n" +
        "    ignore(grow!())\n" +
        "    let after = JsMap.size(m)\n" +
        "    (before, after)\n",
      {
        growing: 'const shared = new Map([["a", 1]]);\n' +
          "export function table() { return shared; }\n" +
          'export function grow() { shared.set("b", 2); return 0; }\n',
      },
    );
    expect((exports["probe"] as () => [number, number])()).toEqual([1, 2]);
  });

  test("and two reads of one borrowed set do the same", async () => {
    const exports = await run(
      'extern from "flags"\n' +
        "    fun flags(): JsSet(Int)\n" +
        "    fun add(): Int\n" +
        "\n" +
        "export fun probe(): (Int, Int) =\n" +
        "    let s = flags!()\n" +
        "    let before = JsSet.size(s)\n" +
        "    ignore(add!())\n" +
        "    let after = JsSet.size(s)\n" +
        "    (before, after)\n",
      {
        flags: "const shared = new Set([4]);\n" +
          "export function flags() { return shared; }\n" +
          "export function add() { shared.add(5); return 0; }\n",
      },
    );
    expect((exports["probe"] as () => [number, number])()).toEqual([1, 2]);
  });
});

describe("native equality, not structural (Part 10 §4.3)", () => {
  /**
   * SameValueZero, at its two edges. `NaN` finds `NaN` — where JavaScript `===`
   * would not — and `-0` finds `+0`. Both hold on Hexagon's side too (§4.3's
   * first bullet: every primitive's `Eq` *is* SameValueZero on its JS
   * representation), so the row is about the two regimes agreeing, and the
   * values come from the foreign side because Hexagon writes no `NaN` literal.
   */
  test("`NaN` finds `NaN` and `-0` finds `+0` in a borrowed map", async () => {
    const exports = await run(
      'extern from "odd"\n' +
        "    fun table(): JsMap(Float, Int)\n" +
        "    fun nan(): Float\n" +
        "    fun negativeZero(): Float\n" +
        "\n" +
        "export fun probe(): (Bool, Bool, Bool) =\n" +
        "    let m = table!()\n" +
        "    (JsMap.containsKey(m, nan!()),\n" +
        "     JsMap.containsKey(m, negativeZero!()),\n" +
        "     JsMap.containsKey(m, 1.5))\n",
      {
        odd: "export function table() { return new Map([[NaN, 1], [0, 2]]); }\n" +
          "export function nan() { return NaN; }\n" +
          "export function negativeZero() { return -0; }\n",
      },
    );
    expect((exports["probe"] as () => [boolean, boolean, boolean])())
      .toEqual([true, true, false]);
  });

  /** The same at a borrowed set, whose one Boolean read is `contains` (§5). */
  test("`JsSet.contains` finds `NaN` too", async () => {
    const exports = await run(
      'extern from "marks"\n' +
        "    fun marks(): JsSet(Float)\n" +
        "    fun nan(): Float\n" +
        "\n" +
        "export fun probe(): (Bool, Bool) =\n" +
        "    let s = marks!()\n" +
        "    (JsSet.contains(s, nan!()), JsSet.contains(s, 9.0))\n",
      {
        marks: "export function marks() { return new Set([NaN, 1]); }\n" +
          "export function nan() { return NaN; }\n",
      },
    );
    expect((exports["probe"] as () => [boolean, boolean])()).toEqual([true, false]);
  });

  /**
   * §4.3's second bullet, which is the consequential half: a structural key is
   * a **reference-identity** key here. The stored object is found by the very
   * reference that was stored, and an object with the same contents is a
   * different key — legal, occasionally what a binding needs, and nothing like
   * the persistent `Map`'s structural index.
   *
   * No `Hash` is written anywhere in this program, and none could be demanded:
   * `JsValue` honors no `Hash`, so a surface asking for one would not admit
   * this receiver at all.
   */
  test("an object key is found by reference and not by contents", async () => {
    const exports = await run(
      'extern from "objects"\n' +
        "    fun table(): JsMap(JsValue, Int)\n" +
        "    fun stored(): JsValue\n" +
        "    fun twin(): JsValue\n" +
        "\n" +
        "export fun probe(): (Bool, Bool) =\n" +
        "    let m = table!()\n" +
        "    (JsMap.containsKey(m, stored!()), JsMap.containsKey(m, twin!()))\n",
      {
        objects: "const key = { id: 1 };\n" +
          "export function table() { return new Map([[key, 7]]); }\n" +
          "export function stored() { return key; }\n" +
          "export function twin() { return { id: 1 }; }\n",
      },
    );
    expect((exports["probe"] as () => [boolean, boolean])()).toEqual([true, false]);
  });

  /** And the same at a set, where the elements *are* the keys. */
  test("a set element is a reference too", async () => {
    const exports = await run(
      'extern from "objects"\n' +
        "    fun members(): JsSet(JsValue)\n" +
        "    fun stored(): JsValue\n" +
        "    fun twin(): JsValue\n" +
        "\n" +
        "export fun probe(): (Bool, Bool) =\n" +
        "    let s = members!()\n" +
        "    (JsSet.contains(s, stored!()), JsSet.contains(s, twin!()))\n",
      {
        objects: "const element = { id: 1 };\n" +
          "export function members() { return new Set([element]); }\n" +
          "export function stored() { return element; }\n" +
          "export function twin() { return { id: 1 }; }\n",
      },
    );
    expect((exports["probe"] as () => [boolean, boolean])()).toEqual([true, false]);
  });
});

describe("eager construction from a `Seq` (Part 10 §6.5)", () => {
  /**
   * The duplicate rules are the native constructor's, unarranged: a later equal
   * key replaces the value while the map keeps the **position** it already had.
   * Position is not a thing a Hexagon read can ask about, so it is read off the
   * JavaScript side — which is also where `instanceof Map` says the result is
   * the caller's own native collection rather than anything wrapped.
   */
  test("`JsMap.fromSeq` keeps the first position and the last value", async () => {
    const exports = await run(
      "export fun build(): JsMap(String, Int) =\n" +
        '    JsMap.fromSeq(Vector.toSeq([("a", 1), ("b", 2), ("a", 3)]))\n',
      {},
    );
    const built = (exports["build"] as () => Map<string, number>)();
    expect(built instanceof Map).toBe(true);
    expect([...built.entries()]).toEqual([["a", 3], ["b", 2]]);
  });

  /**
   * The other half of §6.5's map rule — the **stored key representative**
   * survives the replacement — which needs object keys to be observable at all,
   * since two equal strings are one string.
   */
  test("the key representative it already stored survives the replacement", async () => {
    const exports = await run(
      'extern from "keys"\n' +
        "    fun first(): JsValue\n" +
        "    fun second(): JsValue\n" +
        "    fun twin(): JsValue\n" +
        "\n" +
        "export fun build(): JsMap(JsValue, Int) =\n" +
        "    JsMap.fromSeq(Vector.toSeq(\n" +
        "        [(first!(), 1), (second!(), 2), (first!(), 3)]))\n" +
        "export fun firstKey(): JsValue = first!()\n",
      {
        keys: 'const a = { tag: "a" }, b = { tag: "b" };\n' +
          "export function first() { return a; }\n" +
          "export function second() { return b; }\n" +
          'export function twin() { return { tag: "a" }; }\n',
      },
    );
    const built = (exports["build"] as () => Map<unknown, number>)();
    const firstKey = (exports["firstKey"] as () => unknown)();
    expect([...built.keys()][0]).toBe(firstKey);
    expect([...built.values()]).toEqual([3, 2]);
  });

  /** `JsSet.fromSeq` retains the first representative and its position. */
  test("`JsSet.fromSeq` keeps the first representative and position", async () => {
    const exports = await run(
      'extern from "keys"\n' +
        "    fun first(): JsValue\n" +
        "    fun second(): JsValue\n" +
        "    fun twin(): JsValue\n" +
        "\n" +
        "export fun build(): JsSet(JsValue) =\n" +
        "    JsSet.fromSeq(Vector.toSeq([first!(), second!(), first!(), twin!()]))\n" +
        "export fun firstElement(): JsValue = first!()\n",
      {
        keys: 'const a = { tag: "a" }, b = { tag: "b" };\n' +
          "export function first() { return a; }\n" +
          "export function second() { return b; }\n" +
          'export function twin() { return { tag: "a" }; }\n',
      },
    );
    const built = (exports["build"] as () => Set<unknown>)();
    const firstElement = (exports["firstElement"] as () => unknown)();
    expect(built instanceof Set).toBe(true);
    // Three, not four: the repeated reference collapsed, and the same-looking
    // twin did not — which is the equality regime showing through construction.
    expect(built.size).toBe(3);
    expect([...built][0]).toBe(firstElement);
  });

  /**
   * §6.5's freshness: **each call creates a new collection**, and no identity
   * cache exists behind either row. Two calls over the same persistent Hexagon
   * `Seq` replay it and produce two distinct native collections with the same
   * entries — precisely what invoking `new Map(iterable)` twice does, and the
   * reason the door row can be the bare constructor.
   */
  test("two calls over one `Seq` build two distinct native collections", async () => {
    const exports = await run(
      'let pairs: Seq((String, Int)) = Vector.toSeq([("a", 1), ("b", 2)])\n' +
        "let numbers: Seq(Int) = Vector.toSeq([1, 2])\n" +
        "export fun mapped(): JsMap(String, Int) = JsMap.fromSeq(pairs)\n" +
        "export fun setted(): JsSet(Int) = JsSet.fromSeq(numbers)\n",
      {},
    );
    const build = exports["mapped"] as () => Map<string, number>;
    const first = build();
    const second = build();
    expect(first).not.toBe(second);
    expect(first instanceof Map).toBe(true);
    expect(second instanceof Map).toBe(true);
    expect([...first.entries()]).toEqual([["a", 1], ["b", 2]]);
    expect([...first.entries()]).toEqual([...second.entries()]);

    const buildSet = exports["setted"] as () => Set<number>;
    const one = buildSet();
    const other = buildSet();
    expect(one).not.toBe(other);
    expect(one instanceof Set).toBe(true);
    expect([...one]).toEqual([1, 2]);
  });

  /**
   * The source is consumed in traversal order, which is what makes a *lazy*
   * source safe to hand over: a generated sequence arrives in the order it
   * yields, and an eager constructor forces exactly what it is given.
   */
  test("a lazy source is traversed in order", async () => {
    const exports = await run(
      "export fun build(): JsMap(Int, Int) =\n" +
        "    JsMap.fromSeq(\n" +
        "        Seq.map(Seq.take(Seq.iterate(1, (n) => n + 1), 3), (n) => (n, n)))\n",
      {},
    );
    const built = (exports["build"] as () => Map<number, number>)();
    expect([...built.entries()]).toEqual([[1, 1], [2, 2], [3, 3]]);
  });
});

describe("the two failure doors (Part 10 §4.4)", () => {
  /**
   * A hostile `has` throws, and the throw is an ordinary foreign throw: it
   * arrives at a `JsError(e)` arm carrying the very error JavaScript threw. It
   * is never turned into `KeyError` — the honest-absence door — and it is never
   * swallowed into `None`, which is the failure a `try` around a total accessor
   * would otherwise invite. The `KeyError` arm sits *above* the `JsError` one,
   * so a synthesized `KeyError` would win and be seen.
   */
  test("a `Proxy` whose `has` throws lands on `JsError`, never `KeyError` or `None`", async () => {
    const exports = await run(
      'extern from "hostile"\n' +
        "    fun hostile(): JsMap(String, Int)\n" +
        "\n" +
        "export fun probe(): String =\n" +
        "    try\n" +
        '        match JsMap.get(hostile!(), "a")\n' +
        '            None => "none"\n' +
        '            Some(_) => "some"\n' +
        "    catch\n" +
        '        KeyError => "KeyError"\n' +
        '        JsError(e) => "JsError: " ++ JsError.message(e)\n',
      {
        hostile: "export function hostile() {\n" +
          '  const inner = new Map([["a", 1]]);\n' +
          "  return new Proxy(inner, {\n" +
          "    get(target, property) {\n" +
          '      if (property === "has") {\n' +
          '        return () => { throw new TypeError("hostile has"); };\n' +
          "      }\n" +
          "      const value = Reflect.get(target, property, target);\n" +
          '      return typeof value === "function" ? value.bind(target) : value;\n' +
          "    },\n" +
          "  });\n" +
          "}\n",
      },
    );
    expect((exports["probe"] as () => string)()).toBe("JsError: hostile has");
  });

  /** The same door for a throwing `size`, and for a borrowed set's `has`. */
  test("a throwing `size` and a throwing set `has` take the same door", async () => {
    const exports = await run(
      'extern from "hostile"\n' +
        "    fun table(): JsMap(String, Int)\n" +
        "    fun members(): JsSet(Int)\n" +
        "\n" +
        "export fun counted(): String =\n" +
        "    try\n" +
        "        Int.show(JsMap.size(table!()))\n" +
        "    catch\n" +
        "        JsError(e) => JsError.message(e)\n" +
        "export fun member(): String =\n" +
        "    try\n" +
        "        Bool.show(JsSet.contains(members!(), 1))\n" +
        "    catch\n" +
        "        JsError(e) => JsError.message(e)\n",
      {
        hostile: "export function table() {\n" +
          "  return new Proxy(new Map(), {\n" +
          "    get(target, property) {\n" +
          '      if (property === "size") throw new TypeError("hostile size");\n' +
          "      const value = Reflect.get(target, property, target);\n" +
          '      return typeof value === "function" ? value.bind(target) : value;\n' +
          "    },\n" +
          "  });\n" +
          "}\n" +
          "export function members() {\n" +
          "  return new Proxy(new Set(), {\n" +
          "    get(target, property) {\n" +
          '      if (property === "has") {\n' +
          '        return () => { throw new TypeError("hostile set has"); };\n' +
          "      }\n" +
          "      const value = Reflect.get(target, property, target);\n" +
          '      return typeof value === "function" ? value.bind(target) : value;\n' +
          "    },\n" +
          "  });\n" +
          "}\n",
      },
    );
    expect((exports["counted"] as () => string)()).toBe("hostile size");
    expect((exports["member"] as () => string)()).toBe("hostile set has");
  });
});

describe("the qualified and dot spellings (Part 10 §3, §6.1)", () => {
  /**
   * `JsMap.toSeq` and `JsSet.toSeq` are the **provided row's member reached
   * qualified** — no export of either companion, and until #792 no spelling at
   * all, because there was no module for the qualifier to name. `JsMap.entries`
   * is that same walk under a second name (§6.3), so the two must agree pair for
   * pair rather than merely in a summary.
   */
  test("`JsMap.toSeq`, `JsMap.entries` and `JsSet.toSeq` all traverse", async () => {
    const exports = await run(
      'extern from "stock"\n' +
        "    fun table(): JsMap(String, Int)\n" +
        "    fun flags(): JsSet(Int)\n" +
        "\n" +
        "let render(pair: (String, Int)): String =\n" +
        "    let (key, value) = pair\n" +
        "    key ++ Int.show(value)\n" +
        "\n" +
        "let joined(rows: Seq((String, Int))): String =\n" +
        '    Seq.fold(rows, "", (acc, pair) => acc ++ render(pair))\n' +
        "\n" +
        "export fun probe(): (String, String, Int) =\n" +
        "    let m = table!()\n" +
        "    (joined(JsMap.toSeq(m)),\n" +
        "     joined(JsMap.entries(m)),\n" +
        "     Seq.fold(JsSet.toSeq(flags!()), 0, (acc, n) => acc + n))\n",
      {
        stock: "export function table() {\n" +
          '  return new Map([["c", 1], ["a", 2]]);\n' +
          "}\n" +
          "export function flags() { return new Set([4, 5]); }\n",
      },
    );
    expect((exports["probe"] as () => [string, string, number])())
      .toEqual(["c1a2", "c1a2", 9]);
  });

  /**
   * Companion dispatch, exactly as `xs.length()` is `Array.length(xs)` (Method
   * Syntax §4.1): `stdlib/JsMap.hex` and `stdlib/JsSet.hex` are the modules
   * addressable under the names, so every operation is reachable by the dot —
   * `toSeq` included, which arrives through the provided row rather than through
   * an export.
   */
  test("`m.size()`, `m.get(k)`, `m.toSeq()` and `s.contains(x)` are dot calls", async () => {
    const exports = await run(
      'extern from "stock"\n' +
        "    fun table(): JsMap(String, Int)\n" +
        "    fun flags(): JsSet(Int)\n" +
        "\n" +
        "export fun probe(): (Int, Int, Int, Bool, Bool) =\n" +
        "    let m = table!()\n" +
        "    let s = flags!()\n" +
        '    let value = match m.get("a")\n' +
        "        None => 0\n" +
        "        Some(found) => found\n" +
        "    (m.size(), s.size(), value + Seq.length(m.toSeq()),\n" +
        '     m.containsKey("c"), s.contains(5))\n',
      {
        stock: "export function table() {\n" +
          '  return new Map([["c", 1], ["a", 2]]);\n' +
          "}\n" +
          "export function flags() { return new Set([4, 5]); }\n",
      },
    );
    expect((exports["probe"] as () => [number, number, number, boolean, boolean])())
      .toEqual([2, 2, 4, true, true]);
  });

  /** `m.entries()` is the dot form of the synonym, and reads the same walk. */
  test("`m.entries()` is a dot call too", async () => {
    const exports = await run(
      'extern from "stock"\n' +
        "    fun table(): JsMap(String, Int)\n" +
        "\n" +
        "export fun probe(): Int =\n" +
        '    Seq.fold(table!().entries(), 0, (acc, pair) =>\n' +
        "        match pair\n" +
        "            (_, value) => acc + value)\n",
      {
        stock: 'export function table() { return new Map([["c", 1], ["a", 2]]); }\n',
      },
    );
    expect((exports["probe"] as () => number)()).toBe(3);
  });
});

describe("the faces and the emitted text the new surfaces produce", () => {
  /**
   * §1's faces are unchanged by this arc, which is the claim worth pinning: the
   * companions add operations, not a representation, so an export that *uses*
   * them still faces as TypeScript's own readonly interfaces and nothing
   * `Hex.`-branded appears.
   */
  test("an export built with `fromSeq` still faces as `ReadonlyMap`/`ReadonlySet`", () => {
    const text = declarations(
      "export fun table(): JsMap(String, Int) =\n" +
        '    JsMap.fromSeq(Vector.toSeq([("a", 1)]))\n' +
        "export fun marks(): JsSet(Int) = JsSet.fromSeq(Vector.toSeq([1]))\n" +
        "export let count(m: JsMap(String, Int)): Int = JsMap.size(m)\n" +
        "export let seen(s: JsSet(Int), n: Int): Bool = JsSet.contains(s, n)\n",
    );
    expect(text).toContain(
      "export declare function table(): ReadonlyMap<string, number>;",
    );
    expect(text).toContain("export declare function marks(): ReadonlySet<number>;");
    expect(text).toContain(
      "export declare const count: (m: ReadonlyMap<string, number>) => number;",
    );
    expect(text).toContain(
      "export declare const seen: (s: ReadonlySet<number>, n: number) => boolean;",
    );
    expect(text).not.toContain("Hex.");
  });

  /**
   * FFI Part 7 §1.2's runtime vocabulary (#666), at the two seats this arc
   * added. `new Map(…)` and `new Set(…)` are written into the *prelude*
   * companions' own emitted modules, and the hazard is real there rather than
   * hypothetical: a project may supply its own copy of either file at the
   * injection path — which is how the standard library is developed — and that
   * copy may bind `Map` or `Set` at module level. A bare `new Map(…)` under such
   * a binding would construct the user's value.
   *
   * Both halves are measured. The supplied copy, contested, steps around the
   * spellings and imports the captures; the shipped copy, uncontested, writes
   * the bare text.
   */
  test("`fromSeq` steps around a contested `Map`/`Set` in a supplied companion", () => {
    const contested = (basename: string): string =>
      `${PRELUDE_SOURCES[basename]!}\nexport union Contested = Map(Int) | Set(Int)\n`;
    // A prelude module is emitted only when something emitted imports it, so
    // `/main.hex` reaches both constructors: without a consumer there would be
    // no text to read, and the assertions below would pass on nothing.
    const project = compileFiles([
      [
        "/main.hex",
        "export fun m(): JsMap(String, Int) =\n" +
          '    JsMap.fromSeq(Vector.toSeq([("a", 1)]))\n' +
          "export fun s(): JsSet(Int) = JsSet.fromSeq(Vector.toSeq([1]))\n",
      ],
      ["/JsMap.hex", contested("JsMap.hex")],
      ["/JsSet.hex", contested("JsSet.hex")],
    ]);
    expect(project.diagnostics.map(({ message }) => message)).toEqual([]);
    const text = (path: string): string =>
      project.modules.find(({ source }) => source.path === path)!.javascript.text;

    expect(text("/JsMap.hex")).toContain("__Map");
    expect(text("/JsMap.hex")).toContain("new __Map(__a)");
    expect(text("/JsMap.hex")).not.toMatch(/new Map\(/u);
    expect(text("/JsSet.hex")).toContain("__Set");
    expect(text("/JsSet.hex")).toContain("new __Set(__a)");
    expect(text("/JsSet.hex")).not.toMatch(/new Set\(/u);
  });

  test("and the uncontested companion writes the bare spelling", () => {
    const project = compileFiles([
      [
        "/main.hex",
        "export fun m(): JsMap(String, Int) =\n" +
          '    JsMap.fromSeq(Vector.toSeq([("a", 1)]))\n' +
          "export fun s(): JsSet(Int) = JsSet.fromSeq(Vector.toSeq([1]))\n",
      ],
      ["/JsMap.hex", PRELUDE_SOURCES["JsMap.hex"]!],
      ["/JsSet.hex", PRELUDE_SOURCES["JsSet.hex"]!],
    ]);
    expect(project.diagnostics.map(({ message }) => message)).toEqual([]);
    const text = (path: string): string =>
      project.modules.find(({ source }) => source.path === path)!.javascript.text;

    expect(text("/JsMap.hex")).toContain("new Map(__a)");
    expect(text("/JsMap.hex")).not.toContain("hex.js");
    expect(text("/JsSet.hex")).toContain("new Set(__a)");
    expect(text("/JsSet.hex")).not.toContain("hex.js");
  });

  /**
   * The reads are the native operations and nothing more — no helper, no
   * evidence parameter, no `Hash` dictionary anywhere in either module. The
   * `get` pair is the one worth reading off the text: two rows, `has` above and
   * `get` beneath, never one `get` with an `undefined` test (§4.2 step 4). And
   * the raw read is *unexported*, so no program can reach the half that cannot
   * tell a stored `undefined` from an absent key.
   */
  test("the door rows lower to the native operations, and `get` is two of them", () => {
    const project = compileFiles([
      [
        "/main.hex",
        "export let count(m: JsMap(String, Int)): Int = JsMap.size(m)\n" +
          "export let read(m: JsMap(String, Int)): Option(Int) =\n" +
          '    JsMap.get(m, "a")\n',
      ],
      ["/JsMap.hex", PRELUDE_SOURCES["JsMap.hex"]!],
    ]);
    expect(project.diagnostics.map(({ message }) => message)).toEqual([]);
    const text = project.modules
      .find(({ source }) => source.path === "/JsMap.hex")!.javascript.text;

    expect(text).toContain("__a => __a.size");
    expect(text).toContain("(__a, __b) => __a.has(__b)");
    expect(text).toContain("(__a, __b) => __a.get(__b)");
    // The verdict, in one line and in the order §4.2 fixes: the membership
    // question, and the raw read only on its `true` branch.
    expect(text).toContain(
      'containsKey(map, key) ? { tag: "Some", value: readUnchecked(map, key) } : None',
    );
    // And no fused shape *in the accessor*: the module's other text says the
    // word — the doc comments explain the hazard, and the `Seq` adapter helper
    // behind `entries` is full of ordinary `undefined` bookkeeping — so the
    // sweep is over `get`'s own emitted binding, where the word appearing at all
    // would be the `undefined` test §4.2 step 4 forbids.
    const body = /^const get = [\s\S]*?^\};$/mu.exec(codeOnly(text))?.[0];
    expect(body).toBeDefined();
    expect(body).toContain("readUnchecked");
    expect(body).not.toContain("undefined");
    // The raw read is beneath `get`, never beside it: no program can reach the
    // half that cannot tell a stored `undefined` from an absent key.
    expect(text).not.toMatch(/export \{[^}]*readUnchecked/u);
  });
});
