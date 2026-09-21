import { describe, expect, test } from "vitest";

import { compileProject, Source } from "../index";
import { compileFiles } from "../support/test-project.js";

/**
 * Conformance for **FFI Part 6 §5.5's per-crossing conversion wrapper** — what
 * a callback value becomes when its signature names a captured foreign
 * collection (`Array`, `JsMap`, `JsSet`), in both directions of function
 * crossing (#876, #945, PR 4 of the capture arc).
 *
 * The position is Part 1 §5.4's table row "a callback's parameters / result, at
 * each invocation", reached through that section's function clause: "τ is a
 * function type that names a captured collection anywhere in its signature →
 * the value becomes a per-crossing conversion wrapper … which walks each
 * captured argument and result at each invocation". §5.5 says what the wrapper
 * owes — the declared arity (§2), `Unit` discarding (§3.2), throws unchanged
 * (§4), no `this` (§6) — and, loudest, what it does **not** owe: "created per
 * crossing and … never cached", the one recorded departure from §5.1's identity
 * guarantee.
 *
 * **Both halves are pinned, and the second is the larger one.** A signature
 * naming no captured collection keeps §5.1's guarantee exactly — the same
 * JavaScript function object in both directions, `addListener`/`removeListener`
 * matching by identity — and that is asserted here as text *and* as `===`,
 * because it is the property the wrapper's existence could quietly cost.
 *
 * **Almost everything executes.** What a wrapper is for is a property of a
 * running program: a callback handed the foreign array itself compiles exactly
 * as well as one handed a snapshot. So the fixtures are real foreign modules
 * mounted as `data:` URLs, one of them a `Proxy` that records what the
 * invocation touched.
 *
 * Not here, and deliberately: the checker's refusals (`capture-refusals.test.ts`
 * — this PR adds none and changes none), the extern and release-seat crossings
 * of PR 2 (`capture-walk.test.ts`), the export wrapper of PR 3
 * (`capture-export-wrappers.test.ts`, which owns everything about occasion 4
 * but the callback slots restated below), Part 5's receiver members, and a
 * public dictionary handle's members (Part 9 §3.4).
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
 * side's recorded values with it. Every fixture below is textually distinct
 * anyway; the tag makes that a convenience rather than a load-bearing accident.
 */
let runTag = 0;

interface Run {
  /** `/main.hex`'s exports. */
  readonly main: Record<string, unknown>;
  /**
   * One foreign module's own exports, by the specifier the program named it by
   * — the same instance the Hexagon program is linked against, so a fixture
   * that recorded what it was handed can be interrogated directly.
   */
  readonly foreign: (specifier: string) => Promise<Record<string, unknown>>;
}

/** Compiles a project with foreign modules and executes it. */
async function run(
  source: string,
  foreign: Readonly<Record<string, string>>,
): Promise<Run> {
  const project = compileProject([
    new Source.File(Source.fileId(0), "/main.hex", "module Main\n\n" + source),
  ]);
  expect(project.diagnostics.map(({ message }) => message)).toEqual([]);
  runTag += 1;
  const url = (text: string): string =>
    `data:text/javascript;charset=utf-8,${encodeURIComponent(text)}#callback${runTag}`;
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
  const main = (await import(/* @vite-ignore */ moduleUrls.get("/main.hex")!)) as Record<
    string,
    unknown
  >;
  return {
    main,
    foreign: async (specifier) =>
      (await import(/* @vite-ignore */ moduleUrls.get(specifier)!)) as Record<string, unknown>,
  };
}

/** The emitted JavaScript of a one-module program that must compile clean. */
function javascript(source: string): string {
  const project = compileFiles([["/main.hex", "module Main\n\n" + source]]);
  expect(project.diagnostics.map(({ message }) => message)).toEqual([]);
  return project.modules.find(({ source: file }) => file.path === "/main.hex")!
    .javascript.text;
}

/** The rendered capture-plan table of a one-module program, as emitted rows. */
function plans(source: string): readonly string[] {
  const table = /const __capturePlans = \[\n([\s\S]*?)\n\];/u.exec(javascript(source));
  return table === null ? [] : table[1]!.split("\n").map((row) => row.trim());
}

describe("the plan a callback signature compiles to (§5.4's function clause)", () => {
  /**
   * The node and nothing beside it: one `function` row naming its declared
   * slots, and the `array` row one of them points at. `p`'s length is the
   * declared arity (Part 6 §2) whether or not a slot is walked, and `r: null`
   * is the `Unit` result crossing by identity.
   */
  test("a callback parameter compiles to a `function` node over its slots", () => {
    expect(plans('extern from "f"\n    fun on(cb: Array(Int) -> Unit) ->! Unit\n'))
      .toEqual([
        '{ k: "function", p: [1], r: null },',
        '{ k: "array", e: null },',
      ]);
  });

  /**
   * The extern seat picks the node up with no seat-specific code: this is the
   * *same* `#captured` door Part 4 §4.3's parameters already went through, and
   * the only thing that changed is that the walk now answers at a function
   * type.
   */
  test("the extern binding's wrapper walks the callback at its parameter", () => {
    const text = javascript(
      'extern from "f"\n    fun on(cb: Array(Int) -> Unit) ->! Unit\n',
    );
    expect(text).toContain('import { on as __onForeign } from "f";');
    expect(text).toContain(
      "const on = cb => { __onForeign(__capture(__capturePlans, 0, cb)); };",
    );
  });

  /** A function-typed *result* is the same node, walked on the way in (§5.3). */
  test("a function-typed result is walked on the way in", () => {
    const text = javascript(
      'extern from "f"\n    fun handler() ->! (Array(Int) -> Unit)\n',
    );
    expect(text).toContain("const handler = () => __capture(__capturePlans, 0, __handlerForeign());");
  });

  /**
   * The absence, which is §5.1's whole subset: a callback signature naming no
   * captured collection is "the same JavaScript function object in both
   * directions — no wrapper, no copy, no identity translation", so there is no
   * plan, no helper, and the raw import stands.
   */
  test("a signature naming none compiles to no plan at all", () => {
    const text = javascript(
      'extern from "events"\n' +
        "    type Event\n" +
        "    fun addListener(cb: Event -> Unit) ->! Unit\n" +
        "    fun removeListener(cb: Event -> Unit) ->! Unit\n",
    );
    expect(text).toContain("const addListener = cb => { __addListenerForeign(cb); };");
    expect(text).toContain("const removeListener = cb => { __removeListenerForeign(cb); };");
    expect(text).not.toContain("__capture");
    expect(text).not.toContain("__capturePlans");
  });

  /**
   * A **nested** callback is a recursive occurrence like any other, so it is a
   * second `function` node rather than a second mechanism — and the plan table
   * is finite because a node is addressed by index (`capture.ts`'s header).
   */
  test("a callback returning a callback is two `function` nodes", () => {
    expect(
      plans(
        'extern from "n"\n' +
          "    fun outer(cb: Array(Int) -> (Int -> Array(Int))) ->! Bool\n",
      ),
    ).toEqual([
      '{ k: "function", p: [1], r: 2 },',
      '{ k: "array", e: null },',
      '{ k: "function", p: [null], r: 1 },',
    ]);
  });

  /**
   * A parameter at a **type variable** is `null` — §5.4's "τ is a type
   * variable: identity, and sound by parametricity" — and the `Array(a)` around
   * it is still copied. An extern cannot be generic (Part 4), so the position
   * that shows this is an exported Hexagon function's, whose callback parameter
   * the export wrapper of PR 3 walks.
   */
  test("a type variable inside a callback signature is identity", () => {
    expect(plans("export fun apply(xs: Array(a), f: Array(a) -> a): a = f(xs)\n"))
      .toEqual([
        '{ k: "array", e: null },',
        '{ k: "function", p: [0], r: null },',
      ]);
  });
});

describe("outbound: a Hexagon callback handed to JavaScript (§5.5)", () => {
  /**
   * §5.4's access-pattern contract, observed at a *callback invocation* rather
   * than at an extern call: "reads each index exactly once in index order
   * through native array access". A raw crossing would leave the `Proxy` in the
   * callback's hands and record only the one `length` the body reads.
   */
  test("a `Proxy` argument is read once per index, at the invocation", async () => {
    const { main, foreign } = await run(
      'extern from "watched"\n' +
        "    fun each(cb: Array(Int) -> Int) ->! Int\n" +
        "\n" +
        "export fun probe(): Int = each!(xs => Array.length(xs))\n",
      {
        watched: "export const reads = [];\n" +
          "const inner = [1, 2, 3];\n" +
          "const watched = new Proxy(inner, {\n" +
          "  get(target, property) {\n" +
          "    reads.push(String(property));\n" +
          "    return Reflect.get(target, property, target);\n" +
          "  },\n" +
          "});\n" +
          "export function each(cb) { return cb(watched); }\n",
      },
    );
    expect((main["probe"] as () => number)()).toBe(3);
    const { reads } = await foreign("watched") as { reads: string[] };
    expect(reads).toEqual(["length", "0", "1", "2"]);
  });

  /**
   * §5.5's sentence in one round trip: "the arrays JavaScript passes in become
   * Hexagon's own copies and the arrays Hexagon returns leave as copies". The
   * callback is the identity, so what comes back is the argument after two
   * walks — a different object from the one JavaScript supplied, and one whose
   * mutation reaches nothing.
   */
  test("the argument arrives copied and the result leaves copied", async () => {
    const { main, foreign } = await run(
      'extern from "round"\n' +
        "    fun round(cb: Array(Int) -> Array(Int)) ->! Unit\n" +
        "\n" +
        "export fun probe(): Unit = round!(xs => xs)\n",
      {
        round: "export const seen = {};\n" +
          "export function round(cb) {\n" +
          "  const xs = [1, 2];\n" +
          "  const back = cb(xs);\n" +
          "  seen.same = back === xs;\n" +
          "  back.push(3);\n" +
          "  seen.source = [...xs];\n" +
          "  seen.back = [...back];\n" +
          "}\n",
      },
    );
    (main["probe"] as () => void)();
    const { seen } = await foreign("round") as {
      seen: { same: boolean; source: number[]; back: number[] };
    };
    expect(seen.same).toBe(false);
    expect(seen.source).toEqual([1, 2]);
    expect(seen.back).toEqual([1, 2, 3]);
  });

  /**
   * The result leg **on its own**, which the round trip above cannot isolate:
   * there the argument and the result are one value, so one walk would satisfy
   * both readings. Here the callback returns an array Hexagon *holds* and never
   * received at this crossing, so two invocations must hand JavaScript two
   * objects — "the arrays Hexagon returns leave as copies", at each invocation
   * — and what JavaScript then does to one of them reaches neither the other
   * nor Hexagon's own value.
   */
  test("a retained array leaves as a fresh copy at every invocation", async () => {
    const { main, foreign } = await run(
      'extern from "give"\n' +
        "    fun give(cb: Int -> Array(Int)) ->! Int\n" +
        "\n" +
        "export fun probe(xs: Array(Int)): (Int, Int) =\n" +
        "    let answer = give!(n => xs)\n" +
        "    (answer, Array.length(xs))\n",
      {
        give: "export const seen = {};\n" +
          "export function give(cb) {\n" +
          "  const first = cb(0);\n" +
          "  const second = cb(0);\n" +
          "  seen.twoCallsAgree = first === second;\n" +
          "  first.push(99);\n" +
          "  seen.firstLength = first.length;\n" +
          "  seen.secondLength = second.length;\n" +
          "  return second.length;\n" +
          "}\n",
      },
    );
    expect((main["probe"] as (xs: readonly number[]) => [number, number])([1, 2]))
      .toEqual([2, 2]);
    const { seen } = await foreign("give") as { seen: Record<string, unknown> };
    expect(seen).toEqual({ twoCallsAgree: false, firstLength: 3, secondLength: 2 });
  });

  /**
   * The keyed shapes on the same mechanism (Part 1 §2.2, Part 10 §2): "a fresh
   * native `Map`/`Set` built from the source's entries". A callback slot is a
   * crossing like any other, so both directions of both shapes copy.
   */
  test("`JsMap` and `JsSet` arguments and results are fresh natives", async () => {
    const { main, foreign } = await run(
      'extern from "keyed"\n' +
        "    fun withMap(cb: JsMap(String, Int) -> JsMap(String, Int)) ->! Bool\n" +
        "    fun withSet(cb: JsSet(Int) -> JsSet(Int)) ->! Bool\n" +
        "\n" +
        "export fun probe(): Bool = withMap!(m => m) and withSet!(s => s)\n",
      {
        keyed: "export const seen = {};\n" +
          "export function withMap(cb) {\n" +
          '  const m = new Map([["a", 1]]);\n' +
          "  const back = cb(m);\n" +
          "  seen.mapSame = back === m;\n" +
          '  seen.mapValue = back.get("a");\n' +
          "  return back instanceof Map;\n" +
          "}\n" +
          "export function withSet(cb) {\n" +
          "  const s = new Set([7]);\n" +
          "  const back = cb(s);\n" +
          "  seen.setSame = back === s;\n" +
          "  seen.setHas = back.has(7);\n" +
          "  return back instanceof Set;\n" +
          "}\n",
      },
    );
    expect((main["probe"] as () => boolean)()).toBe(true);
    const { seen } = await foreign("keyed") as {
      seen: { mapSame: boolean; mapValue: number; setSame: boolean; setHas: boolean };
    };
    expect(seen).toEqual({ mapSame: false, mapValue: 1, setSame: false, setHas: true });
  });

  /**
   * §5.4's aggregate clause reached through a callback slot: "a fresh aggregate
   * of the same representation … with each component the walk at its declared
   * type". The record is rebuilt because its field type names one, and the
   * field is a fresh array in turn.
   */
  test("a record argument with an `Array` field is rebuilt field-wise", async () => {
    const { main, foreign } = await run(
      'extern from "sheet"\n' +
        "    fun round(cb: {rows: Array(Int), name: String} -> {rows: Array(Int), name: String})" +
        " ->! Unit\n" +
        "\n" +
        "export fun probe(): Unit = round!(s => s)\n",
      {
        sheet: "export const seen = {};\n" +
          "export function round(cb) {\n" +
          '  const sheet = { rows: [1, 2], name: "q1" };\n' +
          "  const back = cb(sheet);\n" +
          "  seen.sameRecord = back === sheet;\n" +
          "  seen.sameRows = back.rows === sheet.rows;\n" +
          "  seen.rows = [...back.rows];\n" +
          "  seen.name = back.name;\n" +
          "}\n",
      },
    );
    (main["probe"] as () => void)();
    const { seen } = await foreign("sheet") as {
      seen: { sameRecord: boolean; sameRows: boolean; rows: number[]; name: string };
    };
    expect(seen).toEqual({
      sameRecord: false,
      sameRows: false,
      rows: [1, 2],
      name: "q1",
    });
  });

  /**
   * §5.4's type-variable clause at a callback slot: the `Array(a)` is copied
   * and the element at `a` keeps its identity, "an element it could not have
   * looked inside". The position is an exported Hexagon function's, because
   * Part 4 has no generic extern.
   */
  test("the array is copied and the element at a type variable is the source's", async () => {
    const { main } = await run(
      "export fun apply(xs: Array(a), f: Array(a) -> Array(a)): Array(a) = f(xs)\n",
      {},
    );
    const one = { id: 1 };
    const supplied = [one];
    let seenInside: readonly unknown[] | undefined;
    const back = (main["apply"] as (
      xs: readonly unknown[],
      f: (xs: readonly unknown[]) => readonly unknown[],
    ) => readonly unknown[])(supplied, (inside) => {
      seenInside = inside;
      return inside;
    });
    expect(seenInside).not.toBe(supplied);
    expect(back).not.toBe(supplied);
    expect(seenInside![0]).toBe(one);
    expect(back[0]).toBe(one);
  });

  /**
   * "Nothing else about the callback changes: arity is the declared arity
   * (§2)". Two facts, and both are the arity: the wrapper's own `length` is the
   * declared count, because a Hexagon function *is* an n-ary JS function (§1);
   * and extra arguments a JS caller supplies reach no slot — §2.3's
   * `forEach`-style `(value, index, array)`, "harmless against a Hexagon
   * callback declared with fewer parameters".
   */
  test("the wrapper has the declared arity and drops a caller's extras", async () => {
    const { main, foreign } = await run(
      'extern from "arity"\n' +
        "    fun call3(cb: Array(Int) -> Int) ->! Int\n" +
        "    fun call0(cb: () -> Array(Int)) ->! Int\n" +
        "\n" +
        "export fun probe(): (Int, Int) =\n" +
        "    (call3!(xs => Array.length(xs)), call0!(() => Vector.toArray(Vector.empty)))\n",
      {
        arity: "export const seen = {};\n" +
          "export function call3(cb) {\n" +
          "  seen.oneLength = cb.length;\n" +
          '  return cb([1, 2], 99, "extra");\n' +
          "}\n" +
          "export function call0(cb) {\n" +
          "  seen.zeroLength = cb.length;\n" +
          "  return cb(1, 2).length;\n" +
          "}\n",
      },
    );
    expect((main["probe"] as () => [number, number])()).toEqual([2, 0]);
    const { seen } = await foreign("arity") as { seen: Record<string, number> };
    expect(seen).toEqual({ oneLength: 1, zeroLength: 0 });
  });

  /**
   * Both properties are pinned as **descriptors**, against an ordinary
   * function's, not merely as values: the wrapper stands where an n-ary
   * JavaScript function stood (§1), so "both properties carry the descriptors
   * an ordinary function's carry" — a `configurable: false` slipping in would
   * leave foreign code holding something it cannot re-describe where the
   * original could.
   *
   * **The wrapper is anonymous**, which is what an arrow in argument position
   * is: it contributes no spelling of its own — in particular not the helper's
   * own `__copy`, a reserved `__` local Lexer §3.2 keeps off the published
   * surface — and it does not take the original's, because reading one is a
   * foreign property read §5.4's walk may not perform and a Hexagon original
   * may itself carry a reserved spelling. The export wrapper's `name` is a
   * different question with a different answer, and is
   * `capture-export-wrappers.test.ts`'s.
   */
  test("the wrapper is anonymous and its `length` is an ordinary one", async () => {
    const { main, foreign } = await run(
      'extern from "faces"\n' +
        "    fun inspect(cb: Array(Int) -> Int) ->! Int\n" +
        "\n" +
        "let onRows(xs: Array(Int)): Int = Array.length(xs)\n" +
        "\n" +
        "export fun probe(): Int = inspect!(onRows)\n",
      {
        faces: "export const seen = {};\n" +
          "export function inspect(cb) {\n" +
          "  seen.name = cb.name;\n" +
          '  seen.lengthDescriptor = Object.getOwnPropertyDescriptor(cb, "length");\n' +
          '  seen.nameDescriptor = Object.getOwnPropertyDescriptor(cb, "name");\n' +
          // The two references the descriptors must match: an ordinary
          // one-parameter function's `length`, and an anonymous arrow's `name`
          // — the arrow is passed through a call so that nothing names it.
          '  seen.nativeLength = Object.getOwnPropertyDescriptor(function (a) {}, "length");\n' +
          "  const anonymous = ((f) => f)((a) => a);\n" +
          '  seen.nativeName = Object.getOwnPropertyDescriptor(anonymous, "name");\n' +
          "  return cb([1, 2]);\n" +
          "}\n",
      },
    );
    expect((main["probe"] as () => number)()).toBe(2);
    const { seen } = await foreign("faces") as {
      seen: {
        name: string;
        lengthDescriptor: PropertyDescriptor;
        nameDescriptor: PropertyDescriptor;
        nativeLength: PropertyDescriptor;
        nativeName: PropertyDescriptor;
      };
    };
    expect(seen.name).toBe("");
    expect(seen.lengthDescriptor).toEqual(seen.nativeLength);
    expect(seen.lengthDescriptor.value).toBe(1);
    expect(seen.nameDescriptor).toEqual(seen.nativeName);
    expect(seen.nameDescriptor.configurable).toBe(true);
  });

  /**
   * The same in the **other direction**, which is where the wrapper's own
   * spelling would otherwise be most visible: a JavaScript caller's named
   * function becomes Hexagon's wrapper on entry (§5.3) and a second wrapper on
   * the way back out, and neither carries the caller's name nor the helper's
   * local. The name it does *not* have is worth naming: `__copy`.
   */
  test("neither direction's wrapper carries a name", async () => {
    const { main } = await run(
      "export fun echo(f: Array(Int) -> Int): Array(Int) -> Int = f\n",
      {},
    );
    const echo = main["echo"] as (
      f: (xs: readonly number[]) => number,
    ) => (xs: readonly number[]) => number;
    const back = echo(function counted(xs) {
      return xs.length;
    });
    expect(back.name).toBe("");
    expect(back.name).not.toBe("__copy");
    expect(back([1, 2, 3])).toBe(3);
  });

  /**
   * §3.1/§3.2: `Unit`'s representation is `undefined` and "a `Unit`-returning
   * Hexagon function or callback returns JavaScript `undefined` naturally;
   * nothing is manufactured at the boundary". The wrapper passes that through
   * rather than manufacturing anything of its own.
   */
  test("a `Unit` result reaches JavaScript as `undefined`", async () => {
    const { main, foreign } = await run(
      'extern from "fire"\n' +
        "    fun fire(cb: Array(Int) -> Unit) ->! Unit\n" +
        "\n" +
        "export fun probe(): Unit = fire!(xs => ())\n",
      {
        fire: "export const seen = {};\n" +
          "export function fire(cb) {\n" +
          "  const answer = cb([1, 2]);\n" +
          "  seen.undefinedResult = answer === undefined;\n" +
          '  seen.kind = typeof answer;\n' +
          "}\n",
      },
    );
    (main["probe"] as () => void)();
    const { seen } = await foreign("fire") as { seen: Record<string, unknown> };
    expect(seen).toEqual({ undefinedResult: true, kind: "undefined" });
  });

  /**
   * §5.5's nested case, and the sentence that makes it one: the wrapper "walks
   * … the result at their declared types **at each invocation**". The inner
   * function is walked out of the outer wrapper once, and *its* result is
   * walked on every call — so two calls on one inner function are two arrays.
   */
  test("a returned callback wraps again and copies at each invocation", async () => {
    const { main, foreign } = await run(
      'extern from "nested"\n' +
        "    fun outer(cb: Array(Int) -> (Int -> Array(Int))) ->! Bool\n" +
        "\n" +
        "export fun probe(): Bool = outer!(xs => n => xs)\n",
      {
        nested: "export const seen = {};\n" +
          "export function outer(cb) {\n" +
          "  const xs = [1, 2];\n" +
          "  const inner = cb(xs);\n" +
          "  const first = inner(0);\n" +
          "  const second = inner(0);\n" +
          "  seen.firstIsSource = first === xs;\n" +
          "  seen.twoCallsAgree = first === second;\n" +
          "  seen.contents = [...second];\n" +
          "  return true;\n" +
          "}\n",
      },
    );
    expect((main["probe"] as () => boolean)()).toBe(true);
    const { seen } = await foreign("nested") as { seen: Record<string, unknown> };
    expect(seen).toEqual({
      firstIsSource: false,
      twoCallsAgree: false,
      contents: [1, 2],
    });
  });
});

describe("inbound: a foreign function value entering Hexagon (§5.3)", () => {
  /**
   * §5.3: "a foreign function value entering Hexagon is wrapped the other way
   * round" — the captured *result* is copied on the way in, so what Hexagon
   * holds is its own and the foreign side's later mutation does not reach it.
   */
  test("an inbound function's result is Hexagon's own snapshot", async () => {
    const { main } = await run(
      'extern from "source"\n' +
        "    fun handler() ->! (Int ->! Array(Int))\n" +
        "\n" +
        "export fun probe(): (Int, Int) =\n" +
        "    let h = handler!()\n" +
        "    let first = h!(0)\n" +
        "    let second = h!(1)\n" +
        "    (Array.length(first), Array.length(second))\n",
      {
        source: "const shared = [1, 2];\n" +
          "export function handler() {\n" +
          "  return (grow) => { if (grow === 1) shared.push(3); return shared; };\n" +
          "}\n",
      },
    );
    // `first` was captured before the push; it is two long afterwards, which is
    // §2.2's guarantee applied at an invocation rather than at an extern call.
    expect((main["probe"] as () => [number, number])()).toEqual([2, 3]);
  });

  /**
   * The mirror leg: an `Array` Hexagon hands *to* an inbound function value
   * leaves as the foreign side's own copy, so foreign code that retains and
   * mutates it cannot reach Hexagon's value.
   */
  test("an array Hexagon passes out is the foreign side's own copy", async () => {
    const { main, foreign } = await run(
      'extern from "sink"\n' +
        "    fun sink() ->! (Array(Int) ->! Int)\n" +
        "    fun rows() ->! Array(Int)\n" +
        "\n" +
        "export fun probe(): (Int, Int) =\n" +
        "    let send = sink!()\n" +
        "    let xs = rows!()\n" +
        "    let before = send!(xs)\n" +
        "    (before, Array.length(xs))\n",
      {
        sink: "export const kept = [];\n" +
          "export function rows() { return [1, 2]; }\n" +
          "export function sink() {\n" +
          "  return (xs) => { kept.push(xs); xs.push(99); return xs.length; };\n" +
          "}\n",
      },
    );
    // The foreign side saw three after its own push; Hexagon's array is still
    // the two it captured.
    expect((main["probe"] as () => [number, number])()).toEqual([3, 2]);
    const { kept } = await foreign("sink") as { kept: number[][] };
    expect(kept[0]).toEqual([1, 2, 99]);
  });
});

describe("throws pass through untouched, in both directions (§4)", () => {
  /**
   * §4.3: a Hexagon callback's throw "propagates a JS throw through the foreign
   * caller; if that throw travels through foreign frames and returns into a
   * Hexagon `try`, it is **still branded**". The wrapper is one of those frames
   * and catches nothing.
   */
  test("a Hexagon callback's throw reaches the Hexagon `catch` still domestic", async () => {
    const { main, foreign } = await run(
      "exception Boom(code: Int)\n" +
        "\n" +
        'extern from "relay"\n' +
        "    fun run(cb: Array(Int) -> Int) ->! Int\n" +
        "\n" +
        "export fun probe(): Int =\n" +
        "    try\n" +
        "        run!(xs => throw(Boom(Array.length(xs))))\n" +
        "    catch\n" +
        "        Boom(code) => code\n" +
        "        JsError(_) => -1\n",
      {
        relay: "export const seen = {};\n" +
          "export function run(cb) {\n" +
          "  try {\n" +
          "    return cb([1, 2, 3]);\n" +
          "  } catch (error) {\n" +
          "    seen.name = error.name;\n" +
          "    seen.code = error.code;\n" +
          "    seen.isError = error instanceof Error;\n" +
          "    throw error;\n" +
          "  }\n" +
          "}\n",
      },
    );
    // The `Boom` arm, not the `JsError` one — and the code is the length of the
    // copy the wrapper made, so the throw left from inside the walked frame.
    expect((main["probe"] as () => number)()).toBe(3);
    // §4.2 on the way out: an ordinary branded `Error`, which foreign code
    // catches as one.
    const { seen } = await foreign("relay") as { seen: Record<string, unknown> };
    expect(seen).toEqual({ name: "Boom", code: 3, isError: true });
  });

  /**
   * §4.1 inbound: "an inbound function value's invocation … every other thrown
   * value takes the `JsError` foreign branch". A wrapper around it changes
   * nothing — including for JavaScript's degenerate throws, which are unbranded
   * and therefore foreign.
   */
  test("an inbound function value's throw is a `JsError`", async () => {
    const { main } = await run(
      'extern from "bad"\n' +
        "    fun handler() ->! (Array(Int) ->! Int)\n" +
        "    fun rows() ->! Array(Int)\n" +
        "\n" +
        "export fun probe(): Int =\n" +
        "    let h = handler!()\n" +
        "    try\n" +
        "        h!(rows!())\n" +
        "    catch\n" +
        "        JsError(_) => -2\n",
      {
        bad: "export function rows() { return [1, 2]; }\n" +
          'export function handler() { return () => { throw "oops"; }; }\n',
      },
    );
    expect((main["probe"] as () => number)()).toBe(-2);
  });
});

describe("no identity promise, and §5.1's promise where it still stands", () => {
  /**
   * §5.5's recorded departure: "passing the same Hexagon function to a foreign
   * API twice produces two wrapper objects, and a foreign API that registers
   * and deregisters callbacks *by identity* … will not match them". Pinned
   * because it is the visible cost of the copy, and because Part 6 §8 item 2
   * defers the cache that would remove it — a later change that started caching
   * would have to come here and say so.
   */
  test("two crossings of one Hexagon function are two wrappers", async () => {
    const { main, foreign } = await run(
      'extern from "registry"\n' +
        "    fun add(cb: Array(Int) -> Unit) ->! Unit\n" +
        "\n" +
        "let onRows(xs: Array(Int)): Unit = ()\n" +
        "\n" +
        "export fun probe(): Unit =\n" +
        "    add!(onRows)\n" +
        "    add!(onRows)\n",
      {
        registry: "export const registered = [];\n" +
          "export function add(cb) { registered.push(cb); }\n",
      },
    );
    (main["probe"] as () => void)();
    const { registered } = await foreign("registry") as { registered: unknown[] };
    expect(registered).toHaveLength(2);
    expect(registered[0]).not.toBe(registered[1]);
  });

  /**
   * §5.1, unchanged and executed: a representation-direct callback crosses as
   * "the same JavaScript function object in both directions", so
   * `addListener`/`removeListener` match and "the listener actually
   * deregisters". This is the guarantee §5.5's wrapper is confined away from,
   * and the confinement is what this pin measures.
   */
  test("a callback naming no captured collection keeps its identity", async () => {
    const { main, foreign } = await run(
      'extern from "events"\n' +
        "    type Event\n" +
        "    fun addListener(cb: Event -> Unit) ->! Unit\n" +
        "    fun removeListener(cb: Event -> Unit) ->! Unit\n" +
        "\n" +
        "let onEvent(e: Event): Unit = ()\n" +
        "\n" +
        "export fun probe(): Unit =\n" +
        "    addListener!(onEvent)\n" +
        "    addListener!(onEvent)\n" +
        "    removeListener!(onEvent)\n",
      {
        events: "export const seen = {};\n" +
          "const listeners = new Set();\n" +
          "export function addListener(cb) {\n" +
          "  listeners.add(cb);\n" +
          "  seen.size = listeners.size;\n" +
          "}\n" +
          "export function removeListener(cb) {\n" +
          "  seen.removed = listeners.delete(cb);\n" +
          "  seen.left = listeners.size;\n" +
          "}\n",
      },
    );
    (main["probe"] as () => void)();
    const { seen } = await foreign("events") as { seen: Record<string, unknown> };
    // One object, added twice into a `Set` and deregistered by identity.
    expect(seen).toEqual({ size: 1, removed: true, left: 0 });
  });
});

describe("the callback slots of PR 3's export wrapper (Part 7 §7 occasion 4)", () => {
  /**
   * §5.4's table row read at an export: a JavaScript caller's callback is
   * walked **in** on entry, so what Hexagon holds is a wrapper of its own — and
   * the array Hexagon then hands that wrapper leaves as the caller's own copy,
   * which the caller may mutate without reaching Hexagon's value.
   */
  test("a JS caller's callback is wrapped on entry and receives copies", async () => {
    const { main } = await run(
      "export fun apply(xs: Array(Int), f: Array(Int) -> Unit): Int =\n" +
        "    f(xs)\n" +
        "    Array.length(xs)\n",
      {},
    );
    const supplied = [1, 2];
    let received: number[] | undefined;
    const length = (main["apply"] as (
      xs: readonly number[],
      f: (xs: number[]) => void,
    ) => number)(supplied, (got) => {
      received = got;
      got.push(99);
    });
    // Hexagon's own array is untouched by the caller's push into what it got.
    expect(length).toBe(2);
    expect(received).not.toBe(supplied);
    expect(received).toEqual([1, 2, 99]);
    expect(supplied).toEqual([1, 2]);
  });

  /**
   * The mirror: an exported Hexagon function whose *result* is a callback hands
   * out a conversion wrapper, fresh per call (§5.5), and the wrapper carries
   * the declared arity (§2) and copies the argument it is given.
   */
  test("an exported function returning a callback hands out a fresh wrapper", async () => {
    const { main } = await run(
      "export fun counter(): Array(Int) -> Int = xs => Array.length(xs)\n",
      {},
    );
    const counter = main["counter"] as () => ((xs: readonly number[]) => number);
    const first = counter();
    expect(first).not.toBe(counter());
    expect(first.length).toBe(1);
    expect(first([1, 2, 3])).toBe(3);
  });
});
