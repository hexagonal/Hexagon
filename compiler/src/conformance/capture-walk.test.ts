import { describe, expect, test } from "vitest";

import { compileProject, Source } from "../index";
import { compileFiles, projectDiagnostics } from "../support/test-project.js";

/**
 * Conformance for **FFI Part 1 §5.4's capture walk at the crossings PR 2 of the
 * capture arc owns** (#945): an extern `fun`'s parameters and result, an
 * `extern let`'s value, `JsValue.toArray`, and `JsValue.from` — the release
 * seat. The checker's refusals are `capture-refusals.test.ts`'s and are not
 * restated; what is pinned here is the copy itself.
 *
 * **Everything below executes.** The claims are about what a foreign object
 * observes and about what a Hexagon value denotes afterwards, and neither is
 * legible in emitted text: a copy that reads the source twice typechecks
 * exactly as well as one that reads it once, and an array that is still the
 * foreign one compiles exactly as well as a snapshot. So each fixture is a real
 * foreign module — a `data:` URL the linker below wires in — and several of
 * them are `Proxy` objects that record what was touched.
 *
 * The four positions this file does **not** reach are later PRs of the same
 * arc, and their absence here is deliberate rather than an omission: an
 * exported Hexagon function's stable export wrapper (Part 7 §7 occasion 4), a
 * callback's conversion wrapper (Part 6 §5.5), Part 5's receiver members, and a
 * public dictionary handle's members (Part 9 §3.4). A value crossing *out*
 * through an export is therefore still Hexagon's own object here, which is what
 * lets several pins below read a captured value directly from JavaScript.
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
    /^(\s*(?:import|export)(?:[^;\n]*?\sfrom)?\s+)(["'])([^"']+)\2;/gmu,
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

interface Run {
  /** `/main.hex`'s exports. */
  readonly main: Record<string, unknown>;
  /**
   * One foreign module's own exports, by the specifier the program named it by.
   *
   * The same module instance the Hexagon program is linked against, because a
   * `data:` URL is a module identity: a fixture that records what it was handed
   * can therefore be interrogated directly, which is what the identity and
   * access-pattern pins need and what no export of `/main.hex` could supply
   * without itself crossing the boundary under test.
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
    `data:text/javascript;charset=utf-8,${encodeURIComponent(text)}#capture${runTag}`;
  const moduleUrls = new Map<string, string>();
  for (const [specifier, text] of Object.entries(foreign)) {
    moduleUrls.set(specifier, url(text));
  }
  for (const data of project.dataUnits) {
    const linked = link(data.javascript.text, data.path, moduleUrls);
    moduleUrls.set(data.path, url(linked));
  }
  for (const module of project.modules) {
    const linked = link(module.javascript.text, module.source.path, moduleUrls)
      .replace(
        /^(\s*(?:import|export)(?:[^;\n]*?\sfrom)?\s+)(["'])([^"']+)\2;/gmu,
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

describe("an extern `fun`'s result is captured on the way in (Part 4 §4)", () => {
  /**
   * §2.2's governing guarantee, executed: "foreign mutation cannot change a
   * collection value Hexagon retains". The foreign module hands out one array
   * and mutates it afterwards; every observation Part 2 §6.5 names — the
   * bracket, `Array.length`, a `for` traversal — sees the snapshot.
   */
  test("a foreign mutation after the call is invisible to the value", async () => {
    const { main } = await run(
      'extern from "shared"\n' +
        "    fun rows() ->! Array(Int)\n" +
        "    fun grow() ->! Unit\n" +
        "    fun poke() ->! Unit\n" +
        "\n" +
        "export fun probe(): (Int, Int, Int) =\n" +
        "    let xs = rows!()\n" +
        "    poke!()\n" +
        "    grow!()\n" +
        "    var total = 0\n" +
        "    for n in Array.toVector(xs)\n" +
        "        total := total + n\n" +
        "    (xs[1], Array.length(xs), total)\n",
      {
        shared: "const shared = [10, 20];\n" +
          "export function rows() { return shared; }\n" +
          "export function grow() { shared.push(30); }\n" +
          "export function poke() { shared[0] = 999; }\n",
      },
    );
    expect((main["probe"] as () => [number, number, number])()).toEqual([10, 2, 30]);
  });

  /**
   * §5.4's identity clause: "two acquisitions of one foreign collection are two
   * values … no cache of any kind ties them together". The two arrays leave
   * through an export, which PR 2 does not wrap, so what JavaScript compares is
   * the two values Hexagon holds.
   */
  test("two calls on one foreign array are two values", async () => {
    const { main, foreign } = await run(
      'extern from "shared"\n' +
        "    fun rows() ->! Array(Int)\n" +
        "\n" +
        "export fun twice(): (Array(Int), Array(Int)) = (rows!(), rows!())\n",
      {
        shared: "export const source = [1, 2];\n" +
          "export function rows() { return source; }\n",
      },
    );
    const [first, second] = (main["twice"] as () => [number[], number[]])();
    const { source } = await foreign("shared") as { source: number[] };
    expect(first).not.toBe(second);
    expect(first).not.toBe(source);
    expect(first).toEqual([1, 2]);
    expect(second).toEqual([1, 2]);
  });
});

describe("an extern `fun`'s parameters are captured on the way out (Part 4 §4.3)", () => {
  /**
   * The copy runs in **both directions** (Part 2 §6.2): "an `Array` handed *to*
   * foreign code is a fresh array too, so the value Hexagon retains cannot be
   * reached by the code that received it". The array enters through an export —
   * unwrapped in PR 2 — so the object the test holds *is* the one Hexagon
   * forwards, and what the fixture received is measurably not it.
   */
  test("what JavaScript receives is not the array Hexagon holds", async () => {
    const { main, foreign } = await run(
      'extern from "sink"\n' +
        "    fun send(xs: Array(Int)) ->! Unit\n" +
        "\n" +
        "export fun forward(xs: Array(Int)): Int =\n" +
        "    send!(xs)\n" +
        "    xs[1]\n",
      {
        sink: "export const seen = [];\n" +
          "export function send(xs) { seen.push(xs); }\n",
      },
    );
    const held = [1, 2, 3];
    expect((main["forward"] as (xs: readonly number[]) => number)(held)).toBe(1);
    const { seen } = await foreign("sink") as { seen: number[][] };
    expect(seen).toHaveLength(1);
    expect(seen[0]).not.toBe(held);
    expect(seen[0]).toEqual([1, 2, 3]);
    // And the copy is the protection, not a coincidence of ordering: mutating
    // what JavaScript received leaves the value Hexagon forwarded untouched.
    seen[0]![0] = 999;
    expect(held).toEqual([1, 2, 3]);
  });

  /** Two crossings of one value are two copies (§5.4), out as well as in. */
  test("two calls hand out two arrays, with the elements by identity", async () => {
    const { main, foreign } = await run(
      "extern from \"sink\"\n" +
        "    fun keep(xs: Array(Vector(Int))) ->! Unit\n" +
        "\n" +
        "export fun twice(): Unit =\n" +
        "    let rows = Vector.toArray([[1], [2]])\n" +
        "    keep!(rows)\n" +
        "    keep!(rows)\n",
      {
        sink: "export const seen = [];\n" +
          "export function keep(xs) { seen.push(xs); }\n",
      },
    );
    (main["twice"] as () => void)();
    const { seen } = await foreign("sink") as { seen: unknown[][] };
    expect(seen).toHaveLength(2);
    // Two arrays…
    expect(seen[0]).not.toBe(seen[1]);
    // …whose elements are the very `Vector` values, by identity: §5.4's
    // "elements keep their identities except where the walk names them captured
    // in turn", and a `Vector` is never one.
    expect(seen[0]![0]).toBe(seen[1]![0]);
    expect(seen[0]![1]).toBe(seen[1]![1]);
  });
});

describe("an `extern let` is captured once, at initialization (Part 4 §4.4)", () => {
  /**
   * §4.4's capture is a module-level event: "the binding is Hexagon's snapshot
   * from then on". Growth of the foreign original afterwards is invisible
   * however many times the binding is read.
   */
  test("later foreign growth is not visible through the binding", async () => {
    const { main } = await run(
      'extern from "registry"\n' +
        "    let table: JsMap(String, Int)\n" +
        "    fun grow() ->! Unit\n" +
        "\n" +
        "export fun probe(): (Int, Int) =\n" +
        "    let before = JsMap.size(table)\n" +
        "    grow!()\n" +
        "    (before, JsMap.size(table))\n",
      {
        registry: 'export const table = new Map([["a", 1]]);\n' +
          'export function grow() { table.set("b", 2); }\n',
      },
    );
    expect((main["probe"] as () => [number, number])()).toEqual([1, 1]);
  });

  /**
   * **Once** is the word §4.4 uses, and a logging `Proxy` is how it is
   * measured: over the whole lifetime of the module, each index of the source
   * is read exactly once, however often the binding is read afterwards.
   */
  test("a logging source is read exactly once over the module's lifetime", async () => {
    const { main, foreign } = await run(
      'extern from "watched"\n' +
        "    let xs: Array(Int)\n" +
        "\n" +
        "export fun probe(): Int =\n" +
        "    xs[1] + xs[2] + Array.length(xs)\n",
      {
        watched: "export const reads = [];\n" +
          "const inner = [7, 8];\n" +
          "export const xs = new Proxy(inner, {\n" +
          "  get(target, property) {\n" +
          "    reads.push(String(property));\n" +
          "    return Reflect.get(target, property, target);\n" +
          "  },\n" +
          "});\n",
      },
    );
    const probe = main["probe"] as () => number;
    expect(probe()).toBe(17);
    expect(probe()).toBe(17);
    expect(probe()).toBe(17);
    const { reads } = await foreign("watched") as { reads: string[] };
    expect(reads).toEqual(["length", "0", "1"]);
  });
});

describe("`JsMap` and `JsSet` are captured on the same mechanism (Part 10 §2)", () => {
  /**
   * The inverse of the fresh-read pin this file's predecessor carried: two
   * `size` reads of one captured map, with a foreign mutation between them,
   * answer `(1, 1)`. Before #875 they answered `(1, 2)`, which was the borrow
   * contract; Part 10 §2 retired it, and §4.4 says the captured collection's
   * `has`/`get`/`size` are "the platform's own".
   */
  test("two `size` reads around a foreign mutation answer the same", async () => {
    const { main } = await run(
      'extern from "live"\n' +
        "    fun table() ->! JsMap(String, Int)\n" +
        "    fun members() ->! JsSet(Int)\n" +
        "    fun growTable() ->! Unit\n" +
        "    fun growMembers() ->! Unit\n" +
        "\n" +
        "export fun counted(): (Int, Int) =\n" +
        "    let m = table!()\n" +
        "    let before = JsMap.size(m)\n" +
        "    growTable!()\n" +
        "    (before, JsMap.size(m))\n" +
        "export fun membership(): (Bool, Bool) =\n" +
        "    let s = members!()\n" +
        "    let before = JsSet.contains(s, 9)\n" +
        "    growMembers!()\n" +
        "    (before, JsSet.contains(s, 9))\n",
      {
        live: 'const table_ = new Map([["a", 1]]);\n' +
          "const members_ = new Set([1]);\n" +
          "export function table() { return table_; }\n" +
          "export function members() { return members_; }\n" +
          'export function growTable() { table_.set("b", 2); }\n' +
          "export function growMembers() { members_.add(9); }\n",
      },
    );
    expect((main["counted"] as () => [number, number])()).toEqual([1, 1]);
    expect((main["membership"] as () => [boolean, boolean])()).toEqual([false, false]);
  });

  /**
   * §2's "no collapse or reordering arises in the copy", and §6.2's order
   * contract over it: the captured collection's own insertion order is exactly
   * the order the source's iteration protocol yielded.
   */
  test("the source's iteration order is the captured collection's", async () => {
    const { main } = await run(
      'extern from "ordered"\n' +
        "    fun table() ->! JsMap(String, Int)\n" +
        "    fun flags() ->! JsSet(Int)\n" +
        "\n" +
        "let render(pair: (String, Int)): String =\n" +
        "    let (key, value) = pair\n" +
        "    key ++ Int.show(value)\n" +
        "\n" +
        "export fun probe(): (String, Int, Int) =\n" +
        '    (Seq.fold(JsMap.toSeq(table!()), "", (acc, pair) => acc ++ render(pair)),\n' +
        "     Seq.fold(JsSet.toSeq(flags!()), 0, (acc, n) => acc * 10 + n),\n" +
        "     JsMap.size(table!()))\n",
      {
        ordered: 'export function table() { return new Map([["c", 1], ["a", 2], ["b", 3]]); }\n' +
          "export function flags() { return new Set([4, 1, 9]); }\n",
      },
    );
    expect((main["probe"] as () => [string, number, number])())
      .toEqual(["c1a2b3", 419, 3]);
  });

  /**
   * §2's nested clause: `JsMap(String, Array(Int))` "copies the outer map and
   * every array value", while a key carried by identity "is exactly as distinct
   * under SameValueZero as it was in the source".
   */
  test("values that name a captured collection are fresh; keys are identical", async () => {
    const { main, foreign } = await run(
      'extern from "nested"\n' +
        "    fun table() ->! JsMap(JsValue, Array(Int))\n" +
        "    fun key() ->! JsValue\n" +
        "\n" +
        "export fun probe(): (Bool, Option(Array(Int))) =\n" +
        "    let m = table!()\n" +
        "    (JsMap.containsKey(m, key!()), JsMap.get(m, key!()))\n",
      {
        nested: "export const key_ = { id: 1 };\n" +
          "export const values = [1, 2];\n" +
          "export function table() { return new Map([[key_, values]]); }\n" +
          "export function key() { return key_; }\n",
      },
    );
    const [found, got] = (main["probe"] as () => [boolean, { tag: string; value: number[] }])();
    const { values } = await foreign("nested") as { values: number[] };
    // The key is the very object, so the lookup finds it…
    expect(found).toBe(true);
    // …and the value is a fresh array holding the same numbers.
    expect(got.tag).toBe("Some");
    expect(got.value).toEqual([1, 2]);
    expect(got.value).not.toBe(values);
  });
});

describe("the array copy is dense and reads each index once (§5.4, Part 2 §6.4)", () => {
  /**
   * §5.4: "the copy is dense in both directions: a source hole becomes a stored
   * `undefined`" — "pinned, because the outbound copy is what JavaScript
   * receives and `in`, `forEach`, and `Object.keys` all tell a hole from a
   * stored `undefined`". The value leaves through an unwrapped export, so what
   * is inspected is the captured array itself.
   */
  test("a hole in the source becomes a stored `undefined`", async () => {
    const { main } = await run(
      'extern from "sparse"\n' +
        "    fun rows() ->! Array(Nullable(Int))\n" +
        "\n" +
        "export fun probe(): Array(Nullable(Int)) = rows!()\n",
      {
        sparse: "const sparse = [];\n" +
          "sparse[0] = 1;\n" +
          "sparse[2] = 3;\n" +
          "export function rows() { return sparse; }\n",
      },
    );
    const captured = (main["probe"] as () => unknown[])();
    expect(captured).toHaveLength(3);
    expect(1 in captured).toBe(true);
    expect(captured[1]).toBeUndefined();
    expect(Object.keys(captured)).toEqual(["0", "1", "2"]);
  });

  /**
   * §5.4's access-pattern contract: the copy "reads each index exactly once in
   * index order through native array access — an exotic array object observes
   * exactly that access pattern and nothing else". This is what rules out
   * `slice` (which preserves holes) and `Array.from`/spread (which drive the
   * iterator protocol), and only a `Proxy` can tell the difference.
   */
  test("a `Proxy` source sees `length` once, then each index in order", async () => {
    const { main, foreign } = await run(
      'extern from "watched"\n' +
        "    fun rows() ->! Array(Int)\n" +
        "\n" +
        "export fun probe(): Int = Array.length(rows!())\n",
      {
        watched: "export const reads = [];\n" +
          "const inner = [1, 2, 3];\n" +
          "const watched = new Proxy(inner, {\n" +
          "  get(target, property) {\n" +
          "    reads.push(String(property));\n" +
          "    return Reflect.get(target, property, target);\n" +
          "  },\n" +
          "});\n" +
          "export function rows() { return watched; }\n",
      },
    );
    expect((main["probe"] as () => number)()).toBe(3);
    const { reads } = await foreign("watched") as { reads: string[] };
    expect(reads).toEqual(["length", "0", "1", "2"]);
  });

  /**
   * The keyed shapes' half of the same contract (Part 10 §2): entries are read
   * "exactly once through the source's iteration protocol", and nothing else on
   * the source is touched — in particular not `size`, which a copy that
   * preallocated would read.
   */
  test("a `Proxy` map is read only through its iteration protocol", async () => {
    const { main, foreign } = await run(
      'extern from "watched"\n' +
        "    fun table() ->! JsMap(String, Int)\n" +
        "\n" +
        "export fun probe(): Int = JsMap.size(table!())\n",
      {
        watched: "export const reads = [];\n" +
          'const inner = new Map([["a", 1], ["b", 2]]);\n' +
          "const watched = new Proxy(inner, {\n" +
          "  get(target, property) {\n" +
          "    reads.push(typeof property === \"symbol\" ? \"@@iterator\" : String(property));\n" +
          "    const value = Reflect.get(target, property, target);\n" +
          '    return typeof value === "function" ? value.bind(target) : value;\n' +
          "  },\n" +
          "});\n" +
          "export function table() { return watched; }\n",
      },
    );
    expect((main["probe"] as () => number)()).toBe(2);
    const { reads } = await foreign("watched") as { reads: string[] };
    expect(reads).toEqual(["@@iterator"]);
  });
});

describe("failure during the capture takes the `JsError` door (§5.4, Part 10 §4.4)", () => {
  /**
   * §5.4's stability clause: the walk "reads through the native protocol inside
   * the frame that performs the crossing … so a hostile getter, proxy trap, or
   * accessor that throws follows the ordinary `JsError` path". The throw is the
   * foreign one, carrying its own message.
   */
  test("a throwing element getter arrives as `JsError` from the call", async () => {
    const { main } = await run(
      'extern from "hostile"\n' +
        "    fun rows() ->! Array(Int)\n" +
        "\n" +
        "export fun probe(): String =\n" +
        "    try\n" +
        "        Int.show(Array.length(rows!()))\n" +
        "    catch\n" +
        "        JsError(e) => JsError.message!(e)\n",
      {
        hostile: "export function rows() {\n" +
          "  const values = [1, 2];\n" +
          "  Object.defineProperty(values, 1, {\n" +
          "    enumerable: true,\n" +
          '    get() { throw new TypeError("hostile element"); },\n' +
          "  });\n" +
          "  return values;\n" +
          "}\n",
      },
    );
    expect((main["probe"] as () => string)()).toBe("hostile element");
  });

  /**
   * The same door for a keyed source, and this is where Part 10's throwing-`has`
   * and throwing-`size` rows moved to. §4.4 is explicit that on the read
   * surfaces a throw "can happen in exactly one place: during the capture" —
   * once captured, "the value is a genuine native `Map` whose `has`/`get`/`size`
   * are the platform's own and do not throw".
   */
  test("a throwing iteration protocol throws; a hostile `size`/`has` does not", async () => {
    const { main } = await run(
      'extern from "hostile"\n' +
        "    fun unreadable() ->! JsMap(String, Int)\n" +
        "    fun table() ->! JsMap(String, Int)\n" +
        "    fun members() ->! JsSet(Int)\n" +
        "\n" +
        "export fun iterated(): String =\n" +
        "    try\n" +
        "        Int.show(JsMap.size(unreadable!()))\n" +
        "    catch\n" +
        '        JsError(e) => "JsError: " ++ JsError.message!(e)\n' +
        "export fun counted(): String =\n" +
        "    try\n" +
        "        Int.show(JsMap.size(table!()))\n" +
        "    catch\n" +
        "        JsError(e) => JsError.message!(e)\n" +
        "export fun member(): String =\n" +
        "    try\n" +
        "        Bool.show(JsSet.contains(members!(), 1))\n" +
        "    catch\n" +
        "        JsError(e) => JsError.message!(e)\n",
      {
        hostile: "export function unreadable() {\n" +
          "  return new Proxy(new Map(), {\n" +
          "    get(target, property) {\n" +
          "      if (property === Symbol.iterator) {\n" +
          '        return () => { throw new TypeError("hostile entries"); };\n' +
          "      }\n" +
          "      const value = Reflect.get(target, property, target);\n" +
          '      return typeof value === "function" ? value.bind(target) : value;\n' +
          "    },\n" +
          "  });\n" +
          "}\n" +
          "export function table() {\n" +
          '  return new Proxy(new Map([["a", 1]]), {\n' +
          "    get(target, property) {\n" +
          '      if (property === "size") throw new TypeError("hostile size");\n' +
          "      const value = Reflect.get(target, property, target);\n" +
          '      return typeof value === "function" ? value.bind(target) : value;\n' +
          "    },\n" +
          "  });\n" +
          "}\n" +
          "export function members() {\n" +
          "  return new Proxy(new Set([1]), {\n" +
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
    // The capture drives the iteration protocol, so a source that cannot be
    // iterated throws out of the crossing.
    expect((main["iterated"] as () => string)()).toBe("JsError: hostile entries");
    // A source whose only hostility is `size` or `has` captures cleanly, and
    // Hexagon's later reads are the platform's own on a value it owns.
    expect((main["counted"] as () => string)()).toBe("1");
    expect((main["member"] as () => string)()).toBe("True");
  });
});

describe("what the walk carries by identity, and what it rebuilds (§5.4)", () => {
  /**
   * §5.4: "elements keep their identities except where the walk names them
   * captured in turn". A record element is not one; an inner `Array` is.
   */
  test("record elements are the source's; inner arrays are fresh", async () => {
    const { main, foreign } = await run(
      'extern from "nested"\n' +
        "    fun boxes() ->! Array({n: Int})\n" +
        "    fun grid() ->! Array(Array(Int))\n" +
        "\n" +
        "export fun probe(): (Array({n: Int}), Array(Array(Int))) = (boxes!(), grid!())\n",
      {
        nested: "export const box = { n: 1 };\n" +
          "export const row = [1, 2];\n" +
          "export function boxes() { return [box]; }\n" +
          "export function grid() { return [row]; }\n",
      },
    );
    const [boxes, grid] = (main["probe"] as () => [{ n: number }[], number[][]])();
    const { box, row } = await foreign("nested") as { box: { n: number }; row: number[] };
    expect(boxes[0]).toBe(box);
    expect(grid[0]).not.toBe(row);
    expect(grid[0]).toEqual([1, 2]);
  });

  /**
   * §5.4's aggregate clause: "a fresh aggregate of the same representation is
   * built — the POJO, the tuple array, the tagged POJO, the `Some` cell — with
   * each component the walk at its declared type; a component whose type names
   * no captured collection is carried by identity".
   */
  test("a record, a tuple and a union payload are rebuilt component by component", async () => {
    const { main, foreign } = await run(
      "export union Batch = Rows(Array(Int)) | Empty\n" +
        "export record Page = {rows: Array(Int), label: JsValue}\n" +
        "\n" +
        'extern from "aggregates"\n' +
        "    fun sheet() ->! {rows: Array(Int), label: JsValue}\n" +
        "    fun page() ->! Page\n" +
        "    fun pair() ->! (JsValue, Array(Int))\n" +
        "    fun batch() ->! Batch\n" +
        "    fun empty() ->! Batch\n" +
        "\n" +
        "export fun probe(): ({rows: Array(Int), label: JsValue}, Page, (JsValue, Array(Int)), Batch, Batch) =\n" +
        "    (sheet!(), page!(), pair!(), batch!(), empty!())\n",
      {
        aggregates: "export const rows = [1, 2];\n" +
          "export const label = { tag: 1 };\n" +
          "export const sheet_ = { rows, label };\n" +
          "export const pair_ = [label, rows];\n" +
          "export const batch_ = { tag: \"Rows\", item1: rows };\n" +
          "export const empty_ = { tag: \"Empty\" };\n" +
          "export function sheet() { return sheet_; }\n" +
          "export function page() { return sheet_; }\n" +
          "export function pair() { return pair_; }\n" +
          "export function batch() { return batch_; }\n" +
          "export function empty() { return empty_; }\n",
      },
    );
    const [sheet, page, pair, batch, empty] = (main["probe"] as () => [
      { rows: number[]; label: unknown },
      { rows: number[]; label: unknown },
      [unknown, number[]],
      { tag: string; item1?: number[] },
      { tag: string },
    ])();
    const fixtures = await foreign("aggregates") as {
      rows: number[];
      label: unknown;
      sheet_: unknown;
      pair_: unknown;
      batch_: unknown;
      empty_: unknown;
    };
    // The structural record: fresh POJO, fresh `rows`, `label` by identity.
    expect(sheet).not.toBe(fixtures.sheet_);
    expect(sheet.rows).not.toBe(fixtures.rows);
    expect(sheet.rows).toEqual([1, 2]);
    expect(sheet.label).toBe(fixtures.label);
    // The nominal record is the same POJO shape and takes the same walk.
    expect(page).not.toBe(fixtures.sheet_);
    expect(page.rows).not.toBe(fixtures.rows);
    // The tuple is a fresh JS array with the component walk applied per slot.
    expect(pair).not.toBe(fixtures.pair_);
    expect(pair[0]).toBe(fixtures.label);
    expect(pair[1]).not.toBe(fixtures.rows);
    // The union payload is a fresh tagged POJO…
    expect(batch).not.toBe(fixtures.batch_);
    expect(batch.tag).toBe("Rows");
    expect(batch.item1).not.toBe(fixtures.rows);
    expect(batch.item1).toEqual([1, 2]);
    // …and a nullary constructor is the shared constant it always was, not
    // rebuilt: §5.4's "nullary constructors and `None` are the shared constants
    // they always were".
    expect(empty).toBe(fixtures.empty_);
  });

  /**
   * **The open-row plan has no vehicle left, and is deleted rather than
   * faked** (#962). The plan node still carries an `open` flag and the
   * interpreter still spreads on it — a closed row is rebuilt from its fields
   * and an open one from a spread of the source — but after the ruling no
   * position this PR emits at can produce an open row: every extern position
   * refuses one, and so does an exported constraint member and the release
   * seat. The only producer left is an **exported Hexagon function's**
   * parameters and result, whose face is the solved row and whose wrapper is
   * PR 3's (Part 7 §7 occasion 4). PR 3 re-adds this row at that wrapper.
   *
   * What stays is the closed half, which is what every extern position gets
   * now: the fields the declaration named, rebuilt one read each.
   */
  test("a closed row is rebuilt from its fields", () => {
    expect(javascript(
      'extern from "./closed.js"\n' +
        "    fun sheet() ->! {rows: Array(Int), label: String}\n" +
        "\n" +
        "export fun probe(): Int = Array.length(sheet!().rows)\n",
    )).toContain('{ k: "record", fields: [["rows", 1], ["label", null]], open: false }');
  });

  /**
   * `Option` is an ordinary union and takes the union clause; `Nullable` has no
   * cell, so §5.4's rule for it is "the walk at `a` itself on a non-nullish
   * value, and a nullish value is itself".
   */
  test("`Some` is a fresh cell, `None` and a nullish `Nullable` are themselves", async () => {
    const { main, foreign } = await run(
      'extern from "maybe"\n' +
        "    fun some() ->! Option(Array(Int))\n" +
        "    fun none() ->! Option(Array(Int))\n" +
        "    fun present() ->! Nullable(Array(Int))\n" +
        "    fun absent() ->! Nullable(Array(Int))\n" +
        "\n" +
        "export fun probe(): (Option(Array(Int)), Option(Array(Int)), Nullable(Array(Int)), Nullable(Array(Int))) =\n" +
        "    (some!(), none!(), present!(), absent!())\n",
      {
        maybe: "export const rows = [1, 2];\n" +
          'export const some_ = { tag: "Some", value: rows };\n' +
          'export const none_ = { tag: "None" };\n' +
          "export function some() { return some_; }\n" +
          "export function none() { return none_; }\n" +
          "export function present() { return rows; }\n" +
          "export function absent() { return null; }\n",
      },
    );
    const [some, none, present, absent] = (main["probe"] as () => [
      { tag: string; value?: number[] },
      { tag: string },
      number[] | null,
      number[] | null,
    ])();
    const fixtures = await foreign("maybe") as {
      rows: number[];
      some_: unknown;
      none_: unknown;
    };
    expect(some).not.toBe(fixtures.some_);
    expect(some.value).not.toBe(fixtures.rows);
    expect(some.value).toEqual([1, 2]);
    expect(none).toBe(fixtures.none_);
    expect(present).not.toBe(fixtures.rows);
    expect(present).toEqual([1, 2]);
    expect(absent).toBeNull();
  });

  /**
   * §5.4's type-variable clause — "identity, and sound by parametricity" — has
   * **no reachable seat at the positions this PR owns**, and the row says so
   * rather than pretending to measure it. An extern row cannot be generic
   * (Part 4 §12.4 is deferred, and the declaration is refused), and the one
   * seat where Hexagon supplies a value at a variable, the release seat, is
   * item 5's refusal. The clause becomes measurable with PR 3's exported
   * functions, whose `first(xs: Array(a)): a` §5.4 quotes.
   */
  test("a type variable has no reachable position at these crossings yet", () => {
    expect(projectDiagnostics(
      "module Main\n\n" +
        'extern from "./generic.js"\n' +
        "    fun first<a>(xs: Array(a)) ->! a\n",
    )).toContain("generic extern declarations are not part of Hexagon v1");
    expect(projectDiagnostics(
      "module Main\n\n" + "export let wrap(x: a): JsValue = JsValue.from(x)\n",
    )).not.toEqual([]);
  });
});

describe("the walk is iterative, and a recursive type is a finite plan (§5.4)", () => {
  /**
   * §5.4: "the walk over a long acyclic structure is an **iterative** traversal
   * that does not depend on recursion depth". A hundred-thousand-node chain is
   * the measurement, and the row carries its own **negative baseline**: a
   * hand-written recursive copier of the same shape is run first and must
   * overflow, so the pin cannot pass because the chain was too short.
   */
  test("a hundred-thousand-node recursive record copies without overflowing", async () => {
    const depth = 100_000;
    // The baseline. If this does *not* throw, the chain is not long enough to
    // measure anything and the row below would pass vacuously.
    const chain = (): { next: { tag: string; value?: unknown }; xs: number[] } => {
      let node: { next: { tag: string; value?: unknown }; xs: number[] } = {
        next: { tag: "None" },
        xs: [1],
      };
      for (let i = 0; i < depth; i += 1) {
        node = { next: { tag: "Some", value: node }, xs: [1] };
      }
      return node;
    };
    const recursively = (node: unknown): unknown => {
      const held = node as { next: { tag: string; value?: unknown }; xs: number[] };
      return {
        next: held.next.tag === "Some"
          ? { tag: "Some", value: recursively(held.next.value) }
          : held.next,
        xs: [...held.xs],
      };
    };
    expect(() => recursively(chain())).toThrow(RangeError);

    const { main } = await run(
      "export record Chain = {next: Option(Chain), xs: Array(Int)}\n" +
        "\n" +
        'extern from "deep"\n' +
        "    fun build() ->! Chain\n" +
        "\n" +
        "export fun probe(): Chain = build!()\n",
      {
        deep: `const depth = ${depth};\n` +
          "export function build() {\n" +
          '  let node = { next: { tag: "None" }, xs: [1] };\n' +
          "  for (let i = 0; i < depth; i += 1) {\n" +
          '    node = { next: { tag: "Some", value: node }, xs: [1] };\n' +
          "  }\n" +
          "  return node;\n" +
          "}\n",
      },
    );
    const copied = main["probe"] as () => { next: { tag: string; value?: unknown } };
    let walked = 0;
    let node: { next: { tag: string; value?: unknown }; xs?: number[] } = copied();
    while (node.next.tag === "Some") {
      walked += 1;
      node = node.next.value as { next: { tag: string; value?: unknown }; xs?: number[] };
    }
    expect(walked).toBe(depth);
  });
});

describe("`JsValue.toArray` is the acquisition a decoder performs (Part 11 §4.2)", () => {
  /**
   * §4.2 as amended by #876: "the success value is a **captured**
   * `Array(JsValue)` — Hexagon's own copy of the array, made by Part 1 §5.4's
   * walk at `Array(JsValue)`: each index read once in order, each element
   * carried by identity as the uncertain `JsValue` it is … the result is stable
   * from the moment of success, and the foreign array is not looked at again."
   */
  test("the success value is a copy whose elements are the source's", async () => {
    const { main, foreign } = await run(
      'extern from "values"\n' +
        "    fun source() ->! JsValue\n" +
        "    fun poke() ->! Unit\n" +
        "\n" +
        "export fun probe(): (Int, Bool) =\n" +
        "    match JsValue.toArray(source!())\n" +
        "        Err(_) => (0 - 1, False)\n" +
        "        Ok(xs) =>\n" +
        "            poke!()\n" +
        "            (Array.length(xs), True)\n" +
        "export fun elements(): Array(JsValue) =\n" +
        "    match JsValue.toArray(source!())\n" +
        "        Err(_) => Vector.toArray([])\n" +
        "        Ok(xs) => xs\n",
      {
        values: "export const cell = { id: 1 };\n" +
          "export const array = [cell, cell];\n" +
          "export function source() { return array; }\n" +
          "export function poke() { array.push(cell); }\n",
      },
    );
    expect((main["probe"] as () => [number, boolean])()).toEqual([2, true]);
    const elements = (main["elements"] as () => unknown[])();
    const fixtures = await foreign("values") as { cell: unknown; array: unknown[] };
    // A copy, not the foreign array…
    expect(elements).not.toBe(fixtures.array);
    // …whose elements are carried by identity, the `JsValue` clause.
    expect(elements[0]).toBe(fixtures.cell);
  });

  /** The copy is dense here too: a hole decodes as an `undefined` `JsValue`. */
  test("a hole in the source becomes an `undefined` element", async () => {
    const { main } = await run(
      'extern from "values"\n' +
        "    fun source() ->! JsValue\n" +
        "\n" +
        "export fun probe(): Array(JsValue) =\n" +
        "    match JsValue.toArray(source!())\n" +
        "        Err(_) => Vector.toArray([])\n" +
        "        Ok(xs) => xs\n",
      {
        values: "const sparse = [];\n" +
          "sparse[2] = 1;\n" +
          "export function source() { return sparse; }\n",
      },
    );
    const decoded = (main["probe"] as () => unknown[])();
    expect(decoded).toHaveLength(3);
    expect(0 in decoded).toBe(true);
    expect(decoded[0]).toBeUndefined();
  });

  /**
   * §4.2's two failure clauses, which the copy does not blur. A throwing
   * element getter "follows the `JsError` channel like the probe", never `Err`;
   * and the `Array.isArray` probe itself stays **unguarded**, so a non-array is
   * still an honest `Err(Shape)`.
   */
  test("a throwing element throws, and a non-array is still `Err`", async () => {
    const { main } = await run(
      'extern from "values"\n' +
        "    fun hostile() ->! JsValue\n" +
        "    fun scalar() ->! JsValue\n" +
        "\n" +
        "export fun thrown(): String =\n" +
        "    try\n" +
        "        match JsValue.toArray(hostile!())\n" +
        '            Err(_) => "Err"\n' +
        '            Ok(_) => "Ok"\n' +
        "    catch\n" +
        '        JsError(e) => "JsError: " ++ JsError.message!(e)\n' +
        "export fun shaped(): String =\n" +
        "    match JsValue.toArray(scalar!())\n" +
        '        Err(_) => "Err"\n' +
        '        Ok(_) => "Ok"\n',
      {
        values: "export function hostile() {\n" +
          "  const values = [1];\n" +
          "  Object.defineProperty(values, 0, {\n" +
          "    enumerable: true,\n" +
          '    get() { throw new TypeError("hostile element"); },\n' +
          "  });\n" +
          "  return values;\n" +
          "}\n" +
          "export function scalar() { return 7; }\n",
      },
    );
    expect((main["thrown"] as () => string)()).toBe("JsError: hostile element");
    expect((main["shaped"] as () => string)()).toBe("Err");
  });

  /** The probe's own lowering is untouched: `Array.isArray`, bare. */
  test("the `isArray` probe is still the unguarded lowering", () => {
    const project = compileFiles([[
      "/main.hex",
      "module Main\n\nexport fun probe(v: JsValue): Bool =\n" +
        "    match JsValue.toArray(v)\n" +
        "        Err(_) => False\n" +
        "        Ok(_) => True\n",
    ]]);
    expect(project.diagnostics.map(({ message }) => message)).toEqual([]);
    const companion = project.modules.find(({ source }) => source.path.endsWith("/JsValue.hex"));
    expect(companion?.javascript.text).toContain("Array.isArray(__a)");
  });
});

describe("`JsValue.from` is the release seat (Part 11 §2)", () => {
  /**
   * §2 as amended by #876: `from` is "where a Hexagon value **enters the
   * uncertain world**, and Part 1 §5.4's walk runs on its argument at the
   * seat's concrete type … so that the `JsValue` handed onward never aliases
   * storage a Hexagon `Array` value denotes".
   */
  test("an `Array` released into the uncertain world is a copy", async () => {
    const { main, foreign } = await run(
      'extern from "sink"\n' +
        "    fun keep(value: JsValue) ->! Unit\n" +
        "\n" +
        "export fun release(xs: Array(Int)): Unit = keep!(JsValue.from(xs))\n",
      {
        sink: "export const seen = [];\n" +
          "export function keep(value) { seen.push(value); }\n",
      },
    );
    const held = [1, 2];
    (main["release"] as (xs: readonly number[]) => void)(held);
    const { seen } = await foreign("sink") as { seen: number[][] };
    expect(seen[0]).not.toBe(held);
    expect(seen[0]).toEqual([1, 2]);
  });

  /**
   * **Unapplied, the seat is still the seat.** §2 puts the walk "on its
   * argument at the seat's concrete type" and says nothing about the reference
   * being written applied, so `let g: (Array(Int)) -> JsValue = JsValue.from`
   * releases exactly as `JsValue.from(xs)` does. Item 5 is what makes this
   * decidable: an unapplied seat whose argument type is not ground is already
   * refused, so a reference that compiles has a concrete type to walk at.
   *
   * Before the repair the two seats disagreed — the applied one copied and the
   * unapplied one emitted the stdlib row, whose lowering is the identity — so
   * a `JsValue` handed onward aliased the storage a Hexagon `Array` denotes.
   */
  test("an unapplied `JsValue.from` at a captured type copies too", async () => {
    const { main, foreign } = await run(
      'extern from "sink"\n' +
        "    fun keep(value: JsValue) ->! Unit\n" +
        "\n" +
        "let release: (Array(Int)) -> JsValue = JsValue.from\n" +
        "\n" +
        "export fun leak(xs: Array(Int)): Unit = keep!(release(xs))\n",
      {
        sink: "export const seen = [];\n" +
          "export function keep(value) { seen.push(value); }\n",
      },
    );
    const held: (number | undefined)[] = [1, 2, 3];
    delete held[1];
    (main["leak"] as (xs: readonly (number | undefined)[]) => void)(held);
    const { seen } = await foreign("sink") as { seen: (number | undefined)[][] };
    expect(seen[0]).not.toBe(held);
    // And it is the same walk, so the copy is dense: the hole became a stored
    // `undefined` on the way out, which is what JavaScript can tell apart.
    expect(seen[0]).toHaveLength(3);
    expect(1 in seen[0]!).toBe(true);
    expect(seen[0]![1]).toBeUndefined();
  });

  /** The emitted shape of both seats, side by side. */
  test("the unapplied seat is a wrapper; at a type naming none it is the row", () => {
    const emitted = javascript(
      "let release: (Array(Int)) -> JsValue = JsValue.from\n" +
        "let plain: (Int) -> JsValue = JsValue.from\n" +
        "export fun both(xs: Array(Int), n: Int): (JsValue, JsValue) = (release(xs), plain(n))\n",
    );
    expect(emitted).toMatch(
      /const release = (__\w+) => __capture\(__capturePlans, \d+, \1\);/u,
    );
    // The seat that names no captured collection binds the stdlib row itself,
    // exactly as it always did — no wrapper, no plan, and the import that
    // binds it.
    expect(emitted).toContain("const plain = from;");
    expect(emitted).toContain("import { from }");

    // And a module whose *only* reference became a wrapper spells `from`
    // nowhere, so it imports nothing: a wrapper is not a reference to the row.
    const wrapperOnly = javascript(
      "let release: (Array(Int)) -> JsValue = JsValue.from\n" +
        "export fun out(xs: Array(Int)): JsValue = release(xs)\n",
    );
    expect(wrapperOnly).toContain("__capture(");
    expect(wrapperOnly).not.toContain("import { from }");
  });

  /**
   * And the seat is **still erased** where the argument names no captured
   * collection — "the representation-honest identity, erased in emission,
   * exactly as before". Pinned on the emitted text, because an identity helper
   * call would be just as correct and is exactly what §2 forbids.
   */
  test("a type naming none is erased, with no call in the output", () => {
    const emitted = javascript(
      "export record Point = {x: Int, y: Int}\n" +
        "\n" +
        "export fun number(n: Int): JsValue = JsValue.from(n)\n" +
        "export fun text(s: String): JsValue = JsValue.from(s)\n" +
        "export fun point(p: Point): JsValue = JsValue.from(p)\n" +
        "export fun rows(v: Vector(Int)): JsValue = JsValue.from(v)\n",
    );
    expect(emitted).toContain("function number(n) {\n  return n;\n}");
    expect(emitted).toContain("function text(s) {\n  return s;\n}");
    expect(emitted).toContain("function point(p) {\n  return p;\n}");
    expect(emitted).toContain("function rows(v) {\n  return v;\n}");
    // Nothing in the module asked for a plan table or the walk helper.
    expect(emitted).not.toContain("capturePlans");
    expect(emitted).not.toContain("__capture(");
  });
});

describe("a crossing that copies nothing is unchanged (§5.4)", () => {
  /**
   * §5.4: "an aggregate whose declared type names **no** captured collection is
   * not walked at all: it crosses by identity, as §2.1 always had it, and the
   * walk costs nothing where nothing needs copying". The measurement is the
   * emitted text: the raw import, with no wrapper of any kind.
   */
  test("an extern naming none is the raw import, with no wrapper", () => {
    const emitted = javascript(
      'extern from "./plain.js"\n' +
        "    fun twice(n: Int) ->! Int\n" +
        "    let version: String\n" +
        "\n" +
        "export fun probe(): Int = twice!(1)\n",
    );
    expect(emitted).toContain('import { twice } from "./plain.js";');
    expect(emitted).toContain('import { version } from "./plain.js";');
    expect(emitted).not.toContain("twiceForeign");
    expect(emitted).not.toContain("capturePlans");
  });

  /**
   * §5.4's three non-crossings, and the one this file can measure directly: "an
   * `extern from \"hex:intrinsic\"` row names a compiler lowering over Hexagon's
   * own values (Intrinsics §3), so `Array.length(xs)` copies nothing".
   *
   * The claim is about the **call**, and the call is what is measured: the
   * lowering is a native `.length` read and the Hexagon caller reaches it
   * through the companion's internal edition, copying nothing on the way. What
   * the companion also carries since PR 3 is its own *published* face — its
   * exports are exported Hexagon functions over `Array(a)`, so they take FFI
   * Part 7 §7 occasion 4's wrapper like any other, which is a different
   * ruling's business and is `capture-export-wrappers.test.ts`'s.
   */
  test("`hex:intrinsic` rows are not crossings", () => {
    const project = compileFiles([[
      "/main.hex",
      "module Main\n\nexport fun probe(xs: Array(Int), v: Vector(Int)): Int =\n" +
        "    Array.length(xs) + Array.length(Vector.toArray(v))\n",
    ]]);
    expect(project.diagnostics.map(({ message }) => message)).toEqual([]);
    const array = project.modules.find(({ source }) => source.path.endsWith("/Array.hex"));
    expect(array?.javascript.text).toContain("const length = __a => __a.length;");
    const main = project.modules.find(({ source }) => source.path === "/main.hex");
    // The caller binds the internal edition and performs no walk of its own;
    // its only `__capture` is its own export wrapper's entry walk.
    expect(main?.javascript.text).toContain('import { __length as length } from "./Hex/Array.js";');
    expect(main?.javascript.text).toContain("return length(xs) + length(toArray(v));");
    // `Vector`'s own published face carries exactly one walk, and it is not
    // this row's: `toArray`'s result is an `Array(a)` leaving through an
    // export, so occasion 4 copies it on the way out. Nothing in the module
    // copies on the way in, which is what "not a crossing" means here.
    const vector = project.modules.find(({ source }) => source.path.endsWith("/Vector.hex"));
    expect(vector?.javascript.text.match(/__capture\(__capturePlans/gu)).toHaveLength(1);
    expect(vector?.javascript.text).toContain(
      "const __toArrayBoundary = __argument0 => __capture(__capturePlans, 0, toArray(__argument0));",
    );
  });

  /**
   * A Hexagon-to-Hexagon call never copies (§2.2), and the cheapest evidence is
   * that a module full of `Array(Int)` signatures asks for no plan table at all
   * — which it does as long as none of them is *published*. An export is the
   * one seat where a signature over a captured collection meets a foreign
   * caller, and that seat is occasion 4's.
   */
  test("Hexagon-to-Hexagon signatures ask for no plan", () => {
    const emitted = javascript(
      "let pass(xs: Array(Int)): Array(Int) = xs\n" +
        "let probe(xs: Array(Int)): Int = Array.length(pass(xs))\n" +
        "export fun sizes(v: Vector(Int)): Int = probe(Vector.toArray(v))\n",
    );
    expect(emitted).not.toContain("capturePlans");
  });
});

describe("no node leaves the source in its parent's slot (§5.4, Part 10 §2)", () => {
  /**
   * **`Nullable` beneath a keyed shape**, the one nesting order where a
   * deferred walk was observable. A `JsMap`/`JsSet` reads its entries into
   * cells and inserts them from a `fill` task that runs after the walks it
   * pushed; a node that assigned the *source* to its cell and deferred its own
   * copy therefore had the foreign object inserted, and wrote the copy into a
   * cell the collection no longer read. `Nullable` was that node, because §5.4
   * gives it no cell of its own to allocate.
   *
   * Part 10 §2's words are the contract: "a fresh native `Map` … its key
   * carried through Part 1 §5.4's walk at `k` and its value through the walk at
   * `v`", and §2.2's "sharing no storage with the foreign original".
   */
  test("a `Nullable` value under a `JsMap` is copied, not aliased", async () => {
    const { main, foreign } = await run(
      'extern from "maybe"\n' +
        "    fun table() ->! JsMap(String, Nullable(Array(Int)))\n" +
        "\n" +
        "export fun probe(): JsMap(String, Nullable(Array(Int))) = table!()\n",
      {
        maybe: "export const inner = [1, 2];\n" +
          'export const source = new Map([["a", inner], ["b", null]]);\n' +
          "export function table() { return source; }\n",
      },
    );
    const got = (main["probe"] as () => Map<string, number[] | null>)();
    const { inner, source } = await foreign("maybe") as {
      inner: number[];
      source: Map<string, number[] | null>;
    };
    expect(got).not.toBe(source);
    expect(got.get("a")).not.toBe(inner);
    expect(got.get("a")).toEqual([1, 2]);
    // A nullish value under a `Nullable` is itself (§5.4), and the entry is
    // still there.
    expect(got.has("b")).toBe(true);
    expect(got.get("b")).toBeNull();
  });

  /** The same at a `JsSet`, whose cells hold one slot rather than two. */
  test("a `Nullable` element under a `JsSet` is copied, not aliased", async () => {
    const { main, foreign } = await run(
      'extern from "marks"\n' +
        "    fun marks() ->! JsSet(Nullable(Array(Int)))\n" +
        "\n" +
        "export fun probe(): JsSet(Nullable(Array(Int))) = marks!()\n",
      {
        marks: "export const inner = [3, 4];\n" +
          "export const source = new Set([inner, null]);\n" +
          "export function marks() { return source; }\n",
      },
    );
    const got = (main["probe"] as () => Set<number[] | null>)();
    const { inner, source } = await foreign("marks") as {
      inner: number[];
      source: Set<number[] | null>;
    };
    expect(got).not.toBe(source);
    expect(got.has(inner)).toBe(false);
    expect(got.has(null)).toBe(true);
    expect([...got].filter((element) => element !== null)).toEqual([[3, 4]]);
  });

  /**
   * And one layer deeper, which is what makes the repair a rule rather than a
   * patch on two nodes: the walk under the `Nullable` is itself an aggregate,
   * and its shell has to be in the cell before the `fill` task reads it.
   */
  test("a `Nullable` tuple under a `JsMap` is copied, not aliased", async () => {
    const { main, foreign } = await run(
      'extern from "deep"\n' +
        "    fun table() ->! JsMap(String, Nullable((Int, Array(Int))))\n" +
        "\n" +
        "export fun probe(): JsMap(String, Nullable((Int, Array(Int)))) = table!()\n",
      {
        deep: "export const inner = [5];\n" +
          "export const pair = [1, inner];\n" +
          'export const source = new Map([["a", pair]]);\n' +
          "export function table() { return source; }\n",
      },
    );
    const got = (main["probe"] as () => Map<string, [number, number[]]>)();
    const { inner, pair } = await foreign("deep") as { inner: number[]; pair: unknown };
    expect(got.get("a")).not.toBe(pair);
    expect(got.get("a")![1]).not.toBe(inner);
    expect(got.get("a")).toEqual([1, [5]]);
  });
});

describe("an extern declaration writes no open row at all (§5.4 item 7)", () => {
  const refusal = (rendered: string): string =>
    `this record may have more fields (\`${rendered}\`), so it cannot cross the foreign ` +
    "boundary at this position: a field the declaration does not name would cross unseen, " +
    "neither copied nor refused (FFI Part 1 §5.4) — name every field the crossing carries, " +
    "declare `JsValue` where the foreign side genuinely accepts or supplies anything, or " +
    "bind an opaque extern `type`";

  /**
   * **Every position, and no call site decides it** (#962). Item 7 refused an
   * open row only where Hexagon supplied the record while the exemption rested
   * on parametricity — "Hexagon can neither name nor add the fields it did not
   * declare" — and in the declaring module that is false: an extern's tail is
   * an ordinary inference variable there.
   *
   * What survives from #961 is the half about *when* the question is asked.
   * A declaration's tail is one variable shared with every caller, so a
   * Hexagon call site that passes a closed record solves it; the check reads
   * the row as written (`#externDeclaredSignatures`), so the verdict does not
   * depend on whether somebody called the row.
   */
  test("a closing call site does not retract the refusal", () => {
    const declaration = 'extern from "./sink.js"\n' +
      "    fun send(r: {n: Int, ...}) ->! Unit\n";
    expect(projectDiagnostics("module Main\n\n" + declaration))
      .toEqual([refusal("{n: Int, ...}")]);
    expect(projectDiagnostics(
      "module Main\n\n" + declaration +
        "\nexport fun forward(r: {n: Int, v: Array(Int)}): Unit = send!(r)\n",
    )).toEqual([refusal("{n: Int, ...}")]);
  });

  /**
   * The inbound half, which #961 left open and this rider closes: the extern
   * *result* and the `extern let` are refused too, so the residue programs
   * PR #961's body recorded — `get!().cells` returning the live foreign array,
   * and the `Holder3` inbound mirror — no longer compile.
   */
  test("the result and the `extern let` are refused, and the residues are gone", () => {
    expect(projectDiagnostics(
      "module Main\n\n" +
        'extern from "./src.js"\n    fun get() ->! {xs: Array(Int), ...}\n' +
        "\nexport fun cells(): Array(Int) = get!().cells\n",
    )).toEqual([refusal("{xs: Array(Int), ...}")]);

    expect(projectDiagnostics(
      "module Main\n\n" + 'extern from "./src.js"\n    let cfg: {n: Int, ...}\n',
    )).toEqual([refusal("{n: Int, ...}")]);

    // The `Holder3` mirror: the record can no longer be written, so Products
    // §4 speaks first and the extern position speaks beside it.
    expect(projectDiagnostics(
      "module Main\n\n" +
        "export record Holder3 = { r: {n: Int, ...} }\n\n" +
        'extern from "./src.js"\n    fun get() ->! Holder3\n' +
        "\nexport fun take(): Holder3 = get!()\n",
    )).toEqual([
      "a `record` names every field of its values; `r`'s type says the record may have " +
      "more fields — name them, or give the field the type `JsValue`",
      refusal("{n: Int, ...}"),
    ]);
  });

  /**
   * And a **closed** row crosses as it always did, with the plan its fields
   * ask for — so the refusal above is the row's openness and nothing else.
   */
  test("a closed row crosses, and gets its plan", () => {
    const source = 'extern from "./closed.js"\n' +
      "    fun sheet() ->! {rows: Array(Int), label: String}\n" +
      "\nexport fun probe(): Int = Array.length(sheet!().rows)\n";
    expect(projectDiagnostics("module Main\n\n" + source)).toEqual([]);
    expect(javascript(source))
      .toContain('{ k: "record", fields: [["rows", 1], ["label", null]], open: false }');
  });

  /**
   * What `#publicType`'s **field** normalization is for, kept from #961 and
   * still observable: a branch join binds one row's tail to the *other*
   * record, so a raw read publishes each parameter with the fields its own
   * annotation wrote and drops the ones the join brought in. An exported
   * function is the position that still writes open rows, so it is where this
   * is measured.
   */
  test("a join publishes the fields the join brought in", () => {
    const project = compileFiles([["/main.hex",
      "module Main\n\n" +
        "export fun pick(b: Bool, x: {n: Int, ...}, y: {m: Int, ...}): {n: Int, ...} =\n" +
        "    if b then x else y\n",
    ]]);
    expect(project.diagnostics.map(({ message }) => message)).toEqual([]);
    expect(project.modules.find(({ source }) => source.path === "/main.hex")!.declarations.text)
      .toContain(
        "export declare function pick<a>(b: boolean, x: { n: number; m: number }, " +
          "y: { m: number; n: number }): { n: number; m: number };",
      );
  });
});

describe("a nominal declaration writes no open row either (Products §4)", () => {
  const field = (name: string, alias?: string): string =>
    "a `record` names every field of its values; " +
    `\`${name}\`'s type ${alias === undefined ? "says" : `— \`${alias}\` — says`} ` +
    "the record may have more fields — name them, or give the field the type `JsValue`";
  const slot = (alias?: string): string =>
    "a constructor's payload names every field of its values; " +
    `this slot's type ${alias === undefined ? "says" : `— \`${alias}\` — says`} ` +
    "the record may have more fields — name them, or give the slot the type `JsValue`";

  /**
   * Products §4's "Where `...` may be written", which is a **declaration**
   * check and not a boundary one: it fires on a private record no `extern`
   * ever names. Its ground is not item 7's — "a declaration's row is one row
   * for every value of the type, so a construction that widened it would widen
   * every value of the type at once, a foreign one at a boundary included".
   *
   * The reach is the field's own written type tree, at any depth.
   */
  test.each([
    ["the field's own type", "{ r: {n: Int, ...} }", "r"],
    ["a tuple", "{ r: (Int, {n: Int, ...}) }", "r"],
    ["an `Option`", "{ r: Option({n: Int, ...}) }", "r"],
    ["a nested record", "{ r: {m: {n: Int, ...}} }", "r"],
    ["a function type", "{ f: ({n: Int, ...}) -> Int }", "f"],
    ["a named tail", "{ r: {n: Int, ...t} }", "r"],
  ])("a record's open row is refused at the field — %s", (_what, written, name) => {
    expect(projectDiagnostics(`module Main\n\nexport record H = ${written}\n`))
      .toEqual([field(name)]);
  });

  /**
   * Through an alias, applied or not, and however many aliases deep — the
   * alias is expanded and the report names it, because that is the word the
   * reader's edit has to change.
   */
  test.each([
    ["a plain alias", "type Row = {n: Int, ...}\n", "Row", "Row"],
    ["an applied alias", "type Wrap(a) = {n: a, ...}\n", "Wrap(Int)", "Wrap"],
    ["an alias of an alias", "type A = {n: Int, ...}\ntype B = A\n", "B", "B"],
  ])("a record's open row is refused through %s", (_what, preamble, written, alias) => {
    expect(projectDiagnostics(`module Main\n\n${preamble}\nexport record H = { r: ${written} }\n`))
      .toEqual([field("r", alias)]);
  });

  /** A union constructor's payload takes the same rule and its own sentence. */
  test.each([
    ["the slot's own type", "", "{n: Int, ...}", undefined],
    ["a tuple with a named tail", "", "(Int, {n: Int, ...t})", undefined],
    ["an alias", "type Row = {n: Int, ...}\n", "Row", "Row"],
  ])("a payload's open row is refused at the slot — %s", (_what, preamble, written, alias) => {
    expect(projectDiagnostics(
      `module Main\n\n${preamble}\nexport union Box = Held(${written}) | Empty\n`,
    )).toEqual([slot(alias)]);
  });

  const payload = (alias?: string): string =>
    "an exception's payload names every field of its values; " +
    `this slot's type ${alias === undefined ? "says" : `— \`${alias}\` — says`} ` +
    "the record may have more fields — name them, or give the slot the type `JsValue`";

  /**
   * An **`exception`'s payload** is the third declaration (Exceptions §2, on
   * Products §4's ground plus one of its own: an exception crosses wherever a
   * throw travels, so nothing at a crossing could read a widened row). Its own
   * noun, the same walk — the slot's written type at any depth, through any
   * alias, named tails included — and it fires whether the exception is
   * exported or not, because the reason is the declaration's row and not a
   * face.
   */
  test.each([
    ["a named slot", "exception Bad(r: {n: Int, ...})\n", undefined],
    ["an unnamed slot", "exception Bad({n: Int, ...})\n", undefined],
    ["a tuple", "exception Bad(r: (Int, {n: Int, ...}))\n", undefined],
    ["an `Option`", "exception Bad(r: Option({n: Int, ...}))\n", undefined],
    ["a nested record", "exception Bad(r: {m: {n: Int, ...}})\n", undefined],
    ["a function type", "exception Bad(f: ({n: Int, ...}) -> Int)\n", undefined],
    ["a named tail", "exception Bad(r: {n: Int, ...t})\n", undefined],
    ["an exported exception", "export exception Bad(r: {n: Int, ...})\n", undefined],
    ["an alias", "type Row = {n: Int, ...}\n\nexception Bad(r: Row)\n", "Row"],
    ["an applied alias", "type Wrap(a) = {n: a, ...}\n\nexception Bad(r: Wrap(Int))\n", "Wrap"],
    ["an alias of an alias", "type A = {n: Int, ...}\ntype B = A\n\nexception Bad(r: B)\n", "B"],
  ])("an exception's open payload is refused at the slot — %s", (_what, source, alias) => {
    expect(projectDiagnostics(`module Main\n\n${source}export let go(): Int = 1\n`))
      .toEqual([payload(alias)]);
  });

  /** A closed payload is untouched, so the refusal is the row and not the form. */
  test("a closed exception payload is legal", () => {
    expect(projectDiagnostics(
      "module Main\n\nexception Bad(r: {n: Int})\nexport let go(): Int = 1\n",
    )).toEqual([]);
  });

  /**
   * And what stays legal, which is the other half of "Where `...` may be
   * written": the alias itself, a definition Hexagon compiles, and a closed
   * field, which still gets its capture plan.
   */
  test("the alias, an exported function and a closed field are untouched", () => {
    expect(projectDiagnostics(
      "module Main\n\ntype Row = {n: Int, ...}\n\nexport let f(r: Row): Int = r.n\n",
    )).toEqual([]);
    expect(projectDiagnostics(
      "module Main\n\nexport let f(r: {n: Int, ...}): Int = r.n + r.m\n",
    )).toEqual([]);
    expect(projectDiagnostics("module Main\n\nlet getX(r) = r.x\nexport let n(): Int = getX({x = 1})\n"))
      .toEqual([]);

    const closed = "export record Box = {r: {n: Int}, xs: Array(Int)}\n" +
      "\n" +
      'extern from "./sink.js"\n' + "    fun send(b: Box) ->! Unit\n" +
      "\nexport fun p(b: Box): Unit = send!(b)\n";
    expect(projectDiagnostics("module Main\n\n" + closed)).toEqual([]);
    expect(javascript(closed))
      .toContain('{ k: "record", fields: [["r", null], ["xs", 1]], open: false }');
  });

  /**
   * The face an exported function's open row publishes is the **solved** row,
   * which is the whole of why that position keeps its `...`: every field any
   * expression named is on it.
   */
  test("an exported function's open row publishes the fields its body named", () => {
    const project = compileFiles([["/main.hex",
      "module Main\n\nexport let f(r: {n: Int, ...}): Int = r.n + r.m\n",
    ]]);
    expect(project.diagnostics.map(({ message }) => message)).toEqual([]);
    expect(project.modules.find(({ source }) => source.path === "/main.hex")!.declarations.text)
      .toContain("export declare const f: <a>(r: { n: number; m: number }) => number;");
  });
});

describe("the emitter copies at every type the checker accepts (the one trigger)", () => {
  /**
   * The checker owns §5.4's membership function over `Mono`; this pass asks the
   * same question over `Typed.Type` (`capture.ts` states why the two walks are
   * two). They are only sound together, so the shapes at which they could drift
   * are pinned here as a pair: the position **compiles** — the checker found
   * nothing to refuse — and the emitted text **copies** — this pass found
   * something to walk.
   *
   * The list is the one the arc's brief names: a keyed shape whose value is
   * captured, a captured shape under a legal container element, an aggregate
   * under an `Option`, a nominal record reached through a phantom parameter's
   * sibling field, and a union payload.
   */
  test.each([
    ["a keyed shape over arrays", "fun f() ->! JsMap(String, Array(Int))"],
    ["arrays of a runtime container", "fun f() ->! Array(Vector(Int))"],
    ["an option over a tuple", "fun f() ->! Option((Int, Array(Int)))"],
    ["a nullable over a set", "fun f() ->! Nullable(JsSet(Int))"],
    ["a tuple of a keyed shape", "fun f() ->! (Int, JsSet(String))"],
  ])("%s compiles and copies", (_name, row) => {
    const source = 'extern from "./x.js"\n' + `    ${row}\n`;
    expect(projectDiagnostics("module Main\n\n" + source + "\nexport fun probe(): Unit = ignore(f!())\n"))
      .toEqual([]);
    expect(javascript(source + "\nexport fun probe(): Unit = ignore(f!())\n"))
      .toContain("__capture(");
  });

  /**
   * And through a nominal record's field, including one whose declaration has a
   * **phantom** parameter — a parameter that holds nothing, so the walk's
   * verdict comes from the field that does.
   */
  test("a nominal record's fields decide, phantom parameter and all", () => {
    const source = "export record Tagged(a) = {rows: Array(Int), count: Int}\n" +
      "\n" +
      'extern from "./x.js"\n' +
      "    fun f() ->! Tagged(String)\n" +
      "\n" +
      "export fun probe(): Int = Array.length(f!().rows)\n";
    expect(projectDiagnostics("module Main\n\n" + source)).toEqual([]);
    expect(javascript(source)).toContain("__capture(");
  });
});
