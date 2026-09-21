import { describe, expect, test } from "vitest";

import { compileProject, Source } from "../index";
import { compileFiles } from "../support/test-project.js";

/**
 * Conformance for **FFI Part 7 §7 occasion 4** — the stable export wrapper an
 * exported Hexagon function or constructor takes when its signature names a
 * captured foreign collection (`Array`, `JsMap`, `JsSet`), and the internal
 * edition Hexagon importers bind instead (#876, #945, PR 3 of the capture arc).
 *
 * The position is Part 1 §5.4's table row "an exported Hexagon function's
 * parameters / result": in on entry, out on exit. What the wrapper buys is
 * §2.2's guarantee at the one boundary a Hexagon program publishes — "a
 * JavaScript caller's array becomes Hexagon's copy and Hexagon's array leaves
 * as a copy" — and the internal edition is what keeps a *Hexagon* importer off
 * it, because a cross-module Hexagon call is not a crossing.
 *
 * **Two kinds of pin, and both are needed.** The linkage is a property of the
 * emitted text — which name binds the wrapper, which name an importer reaches —
 * and is asserted as text. Everything the wrapper is *for* is a property of a
 * running program: an array that is still the caller's compiles exactly as well
 * as a snapshot, and a copy that reads an index twice typechecks exactly as
 * well as one that reads it once. Those pins execute, against real foreign
 * modules mounted as `data:` URLs, several of them getter-laden or `Proxy`
 * objects that record what was touched.
 *
 * Not here, and deliberately: the checker's refusals (`capture-refusals.test.ts`),
 * the extern and release-seat crossings PR 2 owns (`capture-walk.test.ts`), a
 * callback's per-crossing conversion wrapper (Part 6 §5.5) and Part 5's receiver
 * members, and a public dictionary handle's members (Part 9 §3.4). The one
 * extern fact this file does restate is the *interaction* §7 assigns here: an
 * extern binding re-exported or taken first-class is already the copying
 * wrapper of Part 4 §4.3, and occasion 4 adds nothing to it.
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
 * byte-identical share one instantiated module. Every fixture below is textually
 * distinct anyway; the tag makes that a convenience rather than a load-bearing
 * accident.
 */
let runTag = 0;

interface Run {
  /** `/main.hex`'s exports. */
  readonly main: Record<string, unknown>;
  /** One foreign module's own exports, by the specifier the program named it by. */
  readonly foreign: (specifier: string) => Promise<Record<string, unknown>>;
}

/** Compiles a multi-module project with foreign modules and executes it. */
async function runFiles(
  files: readonly (readonly [string, string])[],
  foreign: Readonly<Record<string, string>> = {},
): Promise<Run> {
  const project = compileProject(
    files.map(([path, text], index) => new Source.File(Source.fileId(index), path, text)),
  );
  expect(project.diagnostics.map(({ message }) => message)).toEqual([]);
  runTag += 1;
  const url = (text: string): string =>
    `data:text/javascript;charset=utf-8,${encodeURIComponent(text)}#exportwrapper${runTag}`;
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

/** Compiles and executes a one-module program, with optional foreign modules. */
async function run(
  source: string,
  foreign: Readonly<Record<string, string>> = {},
): Promise<Run> {
  return runFiles([["/main.hex", "module Main\n\n" + source]], foreign);
}

/** The emitted JavaScript of a one-module program that must compile clean. */
function javascript(source: string): string {
  return moduleOf([["/main.hex", "module Main\n\n" + source]], "/main.hex").javascript.text;
}

/** The generated `.d.ts` of a one-module program that must compile clean. */
function declarations(source: string): string {
  return moduleOf([["/main.hex", "module Main\n\n" + source]], "/main.hex").declarations.text;
}

function moduleOf(
  files: readonly (readonly [string, string])[],
  path: string,
): ReturnType<typeof compileFiles>["modules"][number] {
  const project = compileFiles(files.map(([file, text]) => [file, text] as [string, string]));
  expect(project.diagnostics.map(({ message }) => message)).toEqual([]);
  const found = project.modules.find(({ source }) => source.path === path);
  if (found === undefined) throw new Error(`no ${path} in the compiled project`);
  return found;
}

/** The rendered capture-plan table of a one-module program, as emitted rows. */
function plans(source: string): readonly string[] {
  const table = /const __capturePlans = \[\n([\s\S]*?)\n\];/u.exec(javascript(source));
  return table === null ? [] : table[1]!.split("\n").map((row) => row.trim());
}

/** How many `__capture` calls the emitted program performs. */
function copies(text: string): number {
  return text.match(/__capture\(__capturePlans/gu)?.length ?? 0;
}

describe("the public name binds the wrapper and the internal edition rides beside it", () => {
  /**
   * §7 occasion 4's own sentence, as emitted text: "the public name binds the
   * wrapper; the internal edition … is exported under that internal name".
   */
  test("a captured parameter is walked on entry", () => {
    const text = javascript("export fun hold(xs: Array(Int)): Int = xs[1]\n");
    expect(text).toContain(
      "const __holdBoundary = __argument0 => hold(__capture(__capturePlans, 0, __argument0));",
    );
    expect(text).toContain("export { __holdBoundary as hold };");
    expect(text).toContain("export { hold as __hold };");
  });

  /** And on exit, at the result: "Hexagon's array leaves as a copy". */
  test("a captured result is walked on exit", () => {
    const text = javascript("export fun make(v: Vector(Int)): Array(Int) = Vector.toArray(v)\n");
    expect(text).toContain(
      "const __makeBoundary = __argument0 => __capture(__capturePlans, 0, make(__argument0));",
    );
    expect(text).toContain("export { __makeBoundary as make };");
    expect(text).toContain("export { make as __make };");
  });

  /**
   * The absence, which is the larger half of the rule: "an aggregate whose
   * declared type names no captured collection is not walked at all" (§5.4), so
   * an ordinary export is the emitted function, raw identity, no indirection
   * (§1) and no second edition to bind.
   */
  test("a signature naming none is untouched", () => {
    const text = javascript(
      "export fun plain(n: Int): Int = n\n" +
        "export fun vectors(v: Vector(Int)): Vector(Int) = v\n",
    );
    expect(text).toContain("export { plain };");
    expect(text).toContain("export { vectors };");
    expect(text).not.toContain("Boundary");
    expect(text).not.toContain("__plain");
    expect(text).not.toContain("__vectors");
    expect(copies(text)).toBe(0);
  });

  /**
   * §7's identity clause: "the wrapper is allocated once with the ESM binding,
   * not per reference or call, so its JS identity is stable — a JS consumer
   * storing, comparing, or deregistering the export observes one function
   * forever".
   */
  test("the wrapper is one function forever", async () => {
    const { main } = await run("export fun held(xs: Array(Int)): Int = xs[1]\n");
    expect(main["held"]).toBe(main["held"]);
    expect(typeof main["held"]).toBe("function");
  });

  /**
   * A same-module call binds the local function, never the export. There is no
   * crossing between two Hexagon frames of one module, so the caller pays
   * nothing — the module's only `__capture` is the wrapper's own.
   */
  test("a same-module call pays nothing", () => {
    const text = javascript(
      "export fun hold(xs: Array(Int)): Int = xs[1]\n" +
        "export fun twice(v: Vector(Int)): Int = hold(Vector.toArray(v)) + hold(Vector.toArray(v))\n",
    );
    expect(text).toContain("return hold(toArray(v)) + hold(toArray(v));");
    expect(copies(text)).toBe(1);
  });
});

describe("occasion 1 and occasion 4 are one wrapper, with two linkages", () => {
  /**
   * §7: where the two meet on one signature — `f(xs: Seq(Int), ys: Array(Int))`
   * — one wrapper carries the door on the `Seq` parameter and the walk on the
   * captured one, and "occasion 4 governs the linkage: Hexagon importers bind
   * the internal edition".
   */
  test("a `Seq` door and a capture walk compose in one wrapper", () => {
    const text = javascript("export fun both(s: Seq(Int), xs: Array(Int)): Int = xs[1]\n");
    expect(text).toContain(
      "const __bothBoundary = (__argument0, __argument1) => " +
        "both(__seqInbound(__argument0), __capture(__capturePlans, 0, __argument1));",
    );
    expect(text).toContain("export { __bothBoundary as both };");
    expect(text).toContain("export { both as __both };");
  });

  /**
   * A **pure occasion 1** export is unchanged, which is the other half of the
   * ruling: the door's identity pass-through makes the published wrapper
   * semantically invisible to a Hexagon importer (§7 occasion 1), so there is
   * no second edition and importers keep binding the public name.
   */
  test("a `Seq` parameter alone publishes no internal edition", () => {
    const text = javascript("export fun take(s: Seq(Int)): Int = 1\n");
    expect(text).toContain("const __takeBoundary = __argument0 => take(__seqInbound(__argument0));");
    expect(text).toContain("export { __takeBoundary as take };");
    expect(text).not.toContain("export { take as __take };");
  });
});

describe("a constrained export wraps its published face and not its plumbing", () => {
  /**
   * §7: "each fundamental specialization with a captured position takes the
   * wrapper … and the internal trailing-evidence edition, which Hexagon
   * importers bind, takes none" — a door there would tax every cross-module
   * Hexagon constrained call to serve a caller the published face says does not
   * exist.
   */
  test("the specializations take it, the trailing-evidence edition does not", () => {
    const text = javascript("export let total<a: Num>(xs: Array(a), z: a): a = z\n");
    expect(text).toContain("export { total as __total };");
    expect(text).not.toContain("__totalBoundary");
    for (const fundamental of ["Nat", "Int", "Float", "BigInt"]) {
      expect(text).toContain(
        `const __total${fundamental}Boundary = (__argument0, __argument1) => ` +
          `total${fundamental}(__capture(__capturePlans, `,
      );
      expect(text).toContain(`export { __total${fundamental}Boundary as total${fundamental} };`);
    }
  });
});

describe("exported constructors are functions for this occasion (§5.4 item 4)", () => {
  const BOX = "export union Box =\n" +
    "    | Wrap(xs: Array(Int))\n" +
    "    | Plain(n: Int)\n" +
    "    | Empty\n";

  /**
   * §5.4 item 4: "a union or record constructor whose payload names a captured
   * collection walks it on entry". On entry and nowhere else — the tagged object
   * the constructor then builds out of already-walked components is not a second
   * position, so the wrapper has no outbound walk.
   */
  test("a payload constructor walks its payload on entry only", () => {
    const text = javascript(BOX);
    expect(text).toContain(
      "const __WrapBoundary = __argument0 => Wrap(__capture(__capturePlans, 0, __argument0));",
    );
    expect(text).toContain("export { __WrapBoundary as Wrap };");
    expect(text).toContain("export { Wrap as __Wrap };");
  });

  /**
   * The sibling arms, which the same declaration reaches and the walk does not.
   * `Plain`'s *result* type names a captured collection through `Wrap`, and it
   * still takes no wrapper: entry is the only position, and its payload is an
   * `Int`. A nullary constructor "has nothing to walk" and is the shared
   * constant it always was (Unions §6.1).
   */
  test("a sibling arm with no captured payload takes neither wrapper nor edition", () => {
    const text = javascript(BOX);
    expect(text).toContain("export { Plain };");
    expect(text).toContain("export { Empty };");
    expect(text).not.toContain("__PlainBoundary");
    expect(text).not.toContain("export { Plain as __Plain };");
    expect(text).not.toContain("export { Empty as __Empty };");
  });

  /** Products §5.4's record constructor takes the same treatment. */
  test("a record constructor walks its field row on entry", () => {
    const text = javascript("export record Pair = { xs: Array(Int), n: Int }\n");
    expect(text).toContain(
      "const __PairBoundary = __argument0 => Pair(__capture(__capturePlans, 0, __argument0));",
    );
    expect(text).toContain("export { __PairBoundary as Pair };");
    expect(text).toContain("export { Pair as __Pair };");
  });

  /**
   * Executed, because the claim is about what a JavaScript caller can still
   * reach: the array inside the value it gets back is not the array it passed.
   */
  test("a JS caller's array does not survive into the constructed value", async () => {
    const { main } = await run(
      "export union Held =\n" +
        "    | Keep(xs: Array(Int))\n" +
        "\n" +
        "export fun sizeOf(h: Held): Int =\n" +
        "    match h\n" +
        "        Keep(xs) => Array.length(xs)\n",
    );
    const given = [1, 2, 3];
    const value = (main["Keep"] as (xs: readonly number[]) => { xs: number[] })(given);
    expect(value.xs).not.toBe(given);
    expect(value.xs).toEqual([1, 2, 3]);
    given[0] = 999;
    expect(value.xs).toEqual([1, 2, 3]);
  });
});

describe("a Hexagon importer binds the internal edition and never copies", () => {
  const LIB = [
    "/Lib.hex",
    "module Lib\n\n" +
      "export fun hold(xs: Array(Int)): Int = xs[1]\n" +
      "export fun plain(n: Int): Int = n\n",
  ] as const;

  /**
   * Part 1 §5.4: "a cross-module Hexagon import is an ordinary
   * Hexagon-to-Hexagon call, which Part 7 §7 occasion 4 keeps copy-free by
   * binding the internal edition". The call site names `__hold` and the module
   * emits no `__capture` of its own.
   */
  test("a cross-module call reaches the unwalked function", () => {
    const text = moduleOf([
      LIB,
      [
        "/main.hex",
        "module Main\n\nimport Lib\n\n" +
          "export fun go(v: Vector(Int)): Int = Lib.hold(Vector.toArray(v)) + Lib.plain(2)\n",
      ],
    ], "/main.hex").javascript.text;
    expect(text).toContain('import { __hold } from "./Lib.js";');
    expect(text).toContain("return __hold(toArray(v)) + Lib.plain(2);");
    expect(copies(text)).toBe(0);
  });

  /**
   * And the value the callee sees is the *same array*, which is the whole point
   * of the internal edition: identity across a Hexagon-to-Hexagon call, no copy
   * to pay for.
   */
  test("the array crosses the module boundary by identity", async () => {
    const { main } = await runFiles([
      [
        "/Lib.hex",
        "module Lib\n\nexport fun echo(xs: Array(Int)): Array(Int) = xs\n",
      ],
      [
        "/main.hex",
        "module Main\n\nimport Lib\n\n" +
          "export fun width(xs: Array(Int)): Int = Array.length(Lib.echo(xs))\n",
      ],
    ]);
    expect((main["width"] as (xs: readonly number[]) => number)([1, 2, 3])).toBe(3);
  });

  /**
   * A namespace alias can no more reach `Lib.__hold` than it can reach a
   * fundamental edition — the internal editions are not on the exporter's
   * Hexagon interface — so a first-class reference takes the second, named
   * import line the namespace form already opens for them.
   */
  test("a first-class reference binds the edition, not the namespace member", () => {
    const text = moduleOf([
      LIB,
      [
        "/main.hex",
        "module Main\n\nimport Lib\n\nexport fun ref(): (Array(Int)) -> Int = Lib.hold\n",
      ],
    ], "/main.hex").javascript.text;
    expect(text).toContain('import { __hold } from "./Lib.js";');
    expect(text).toContain("return __hold;");
  });

  /** A constructor's edition rides the same route. */
  test("an imported constructor reference binds the edition", () => {
    const text = moduleOf([
      ["/Lib.hex", "module Lib\n\nexport union Box =\n    | Wrap(xs: Array(Int))\n    | Plain(n: Int)\n"],
      [
        "/main.hex",
        "module Main\n\nimport Lib\n\n" +
          "export fun wrapper(): (Array(Int)) -> Lib.Box = Lib.Wrap\n" +
          "export fun plainer(): (Int) -> Lib.Box = Lib.Plain\n",
      ],
    ], "/main.hex").javascript.text;
    expect(text).toContain('import { __Wrap } from "./Lib.js";');
    expect(text).toContain("return __Wrap;");
    // The sibling has no edition to bind, so it stays the namespace member.
    expect(text).toContain("return Lib.Plain;");
  });

  /**
   * Executed end to end: two Hexagon modules, and the array the importer made
   * is the array the exporter's body reads. A copy anywhere on this path would
   * make the two lengths agree and the identity disagree, so the fixture asks
   * the exporter to answer whether what it received is what it was handed.
   */
  test("no copy is performed anywhere on a Hexagon-to-Hexagon path", async () => {
    const { main } = await runFiles([
      [
        "/Lib.hex",
        "module Lib\n\nexport fun echo(xs: Array(Int)): Array(Int) = xs\n",
      ],
      [
        "/main.hex",
        "module Main\n\nimport Lib\n\n" +
          "export fun roundTrip(xs: Array(Int)): Int = Array.length(Lib.echo(xs))\n",
      ],
    ]);
    // The watched array is read exactly once per index — by `roundTrip`'s own
    // entry walk, and by nothing on the cross-module leg.
    const touched: number[] = [];
    const watched: number[] = [];
    for (const index of [0, 1, 2]) {
      Object.defineProperty(watched, index, {
        enumerable: true,
        get: () => {
          touched.push(index);
          return index;
        },
      });
    }
    expect((main["roundTrip"] as (xs: readonly number[]) => number)(watched)).toBe(3);
    expect(touched).toEqual([0, 1, 2]);
  });
});

describe("what the wrapper buys, executed", () => {
  /**
   * §2.2's governing guarantee at the export boundary: "foreign mutation cannot
   * change a collection value Hexagon retains". Before this PR the exported
   * function held the caller's own array and read `999`.
   */
  test("a JS caller's later mutation is invisible to the value", async () => {
    const { main } = await run(
      "export fun hold(xs: Array(Int)): () -> Int = () => xs[1]\n",
    );
    const given = [1, 2];
    const thunk = (main["hold"] as (xs: readonly number[]) => () => number)(given);
    given[0] = 999;
    expect(thunk()).toBe(1);
  });

  /**
   * The mirror image on the way out: what JavaScript receives is not the array
   * Hexagon retains, so mutating it changes nothing Hexagon can see.
   */
  test("what JavaScript receives is not the array Hexagon retains", async () => {
    const { main } = await run(
      "let held: Array(Int) = Vector.toArray([1, 2, 3])\n" +
        "\n" +
        "export fun leak(): Array(Int) = held\n" +
        "export fun peek(index: Int): Int = held[index]\n",
    );
    const first = (main["leak"] as () => number[])();
    const second = (main["leak"] as () => number[])();
    expect(first).not.toBe(second);
    expect(first).toEqual([1, 2, 3]);
    first[0] = 999;
    expect((main["peek"] as (index: number) => number)(1)).toBe(1);
  });

  /**
   * §5.4's access pattern, at this position: "the copy has the source's
   * `length`, reads each index exactly once in index order through native array
   * access — an exotic array object observes exactly that access pattern and
   * nothing else".
   */
  test("the entry walk reads each index exactly once, in order", async () => {
    const { main } = await run("export fun total(xs: Array(Int)): Int = Array.length(xs)\n");
    const touched: number[] = [];
    const watched: number[] = [];
    for (const index of [0, 1, 2, 3]) {
      Object.defineProperty(watched, index, {
        enumerable: true,
        get: () => {
          touched.push(index);
          return index * 10;
        },
      });
    }
    expect((main["total"] as (xs: readonly number[]) => number)(watched)).toBe(4);
    expect(touched).toEqual([0, 1, 2, 3]);
  });

  /**
   * §5.4's type-variable clause: "identity, and sound by parametricity … a
   * `first(xs: Array(a)): a` returns to JavaScript an element it could not have
   * looked inside". The array is copied; the element is not.
   */
  test("a type variable carries its value by identity through a copied array", async () => {
    const { main } = await run("export fun first(xs: Array(a)): a = xs[1]\n");
    const element = { tag: "opaque" };
    const given = [element];
    const answer = (main["first"] as (xs: readonly unknown[]) => unknown)(given);
    expect(answer).toBe(element);
  });

  /**
   * §5.4: "a hole reads as `undefined` … and **the copy is dense in both
   * directions**: a source hole becomes a stored `undefined` — pinned, because
   * the outbound copy is what JavaScript receives and `in`, `forEach`, and
   * `Object.keys` all tell a hole from a stored `undefined`".
   */
  test("a hole crossing in becomes a stored `undefined` crossing out", async () => {
    const { main } = await run("export fun through(xs: Array(a)): Array(a) = xs\n");
    const sparse: unknown[] = [];
    sparse[2] = "end";
    expect(0 in sparse).toBe(false);
    const answer = (main["through"] as (xs: readonly unknown[]) => unknown[])(sparse);
    expect(answer).toHaveLength(3);
    expect(0 in answer).toBe(true);
    expect(Object.keys(answer)).toEqual(["0", "1", "2"]);
    expect(answer[2]).toBe("end");
  });

  /**
   * §5.4's stability clause: "the walk reads through the native protocol inside
   * the frame that performs the crossing … so a hostile getter, proxy trap, or
   * accessor that throws follows the ordinary `JsError` path". The walk runs
   * before any Hexagon code in this call, so what the JavaScript caller sees is
   * the getter's own error, thrown out of the wrapper frame.
   */
  test("a throwing getter surfaces to the JS caller from the wrapper frame", async () => {
    const { main } = await run("export fun size(xs: Array(Int)): Int = Array.length(xs)\n");
    const reached: string[] = [];
    const hostile: number[] = [];
    Object.defineProperty(hostile, 0, {
      enumerable: true,
      get: () => {
        reached.push("getter");
        throw new TypeError("no");
      },
    });
    expect(() => (main["size"] as (xs: readonly number[]) => number)(hostile))
      .toThrow(/no/u);
    expect(reached).toEqual(["getter"]);
  });
});

describe("every captured head and every aggregate that leads to one", () => {
  /** Part 10 §2: a `JsMap`/`JsSet` position is a fresh native `Map`/`Set`. */
  test("`JsMap` and `JsSet` cross as fresh native collections in both directions", async () => {
    const { main } = await run(
      "export fun echoMap(m: JsMap(String, Int)): JsMap(String, Int) = m\n" +
        "export fun echoSet(s: JsSet(Int)): JsSet(Int) = s\n",
    );
    const map = new Map([["a", 1]]);
    const back = (main["echoMap"] as (m: ReadonlyMap<string, number>) => Map<string, number>)(map);
    expect(back).not.toBe(map);
    expect([...back]).toEqual([["a", 1]]);
    map.set("b", 2);
    expect(back.has("b")).toBe(false);

    const set = new Set([1, 2]);
    const backSet = (main["echoSet"] as (s: ReadonlySet<number>) => Set<number>)(set);
    expect(backSet).not.toBe(set);
    expect([...backSet]).toEqual([1, 2]);
  });

  /**
   * §5.4's aggregate clause: "a fresh aggregate of the same representation is
   * built … with each component the walk at its declared type; a component
   * whose type names no captured collection is carried by identity".
   */
  test("a record parameter with an `Array` field is rebuilt around it", async () => {
    const { main } = await run(
      "export record Row = { xs: Array(Int), tag: String }\n" +
        "\n" +
        "export fun widthOf(r: Row): Int = Array.length(r.xs)\n" +
        "export fun echo(r: Row): Row = r\n",
    );
    const row = { xs: [1, 2], tag: "t" };
    const back = (main["echo"] as (r: unknown) => { xs: number[]; tag: string })(row);
    expect(back).not.toBe(row);
    expect(back.xs).not.toBe(row.xs);
    expect(back.tag).toBe("t");
    expect((main["widthOf"] as (r: unknown) => number)(row)).toBe(2);
  });

  /**
   * `Option`, which is a union, and `Nullable`, which has no cell — "for
   * `Nullable`, which has no cell, the walk at `a` itself … a nullish
   * `Nullable` is itself".
   */
  test("`Option` and `Nullable` carry the walk through to the collection", async () => {
    const { main } = await run(
      "export fun sizeOf(o: Option(Array(Int))): Int =\n" +
        "    match o\n" +
        "        None => -1\n" +
        "        Some(xs) => Array.length(xs)\n" +
        "\n" +
        "export fun maybe(present: Bool): Nullable(Array(Int)) =\n" +
        "    Nullable.fromOption(if present then Some(Vector.toArray([1, 2])) else None)\n",
    );
    const sizeOf = main["sizeOf"] as (o: unknown) => number;
    expect(sizeOf({ tag: "Some", value: [1, 2, 3] })).toBe(3);
    expect(sizeOf({ tag: "None" })).toBe(-1);

    const maybe = main["maybe"] as (present: boolean) => readonly number[] | null;
    expect(maybe(true)).toEqual([1, 2]);
    expect(maybe(true)).not.toBe(maybe(true));
    // `fromOption(None)` is the `undefined` edition of a nullish `Nullable`,
    // and "a nullish `Nullable` is itself" — the walk does not enter it.
    expect(maybe(false) == null).toBe(true);
  });
});

describe("an exported Hexagon function keeps its open rows (§5.4 item 7)", () => {
  /**
   * The exemption item 7 grants exactly here, and nowhere else at a boundary:
   * "**An exported Hexagon function's parameters and result keep their open
   * rows** … its face is the **solved** row — the row after the body is
   * checked, never the annotation as written".
   *
   * Since #962 refused `...` in every nominal declaration, this is the only
   * producer of an open plan node left in the compiler, which is why the pin
   * #964 removed with the last of them belongs here.
   */
  const OPEN = "export fun widthOf(r: {xs: Array(a), ...}): Int = Array.length(r.xs)\n";

  test("the plan node is open", () => {
    expect(plans(OPEN)).toContain('{ k: "record", fields: [["xs", 1]], open: true },');
  });

  /**
   * And what `open` means at runtime: "the copy therefore starts from a spread
   * of the source, which carries them, and overwrites only the fields the
   * declaration named" — so a field the declaration never named "crosses by
   * identity and stays unnameable".
   *
   * The spread is what the pin reads. It touches every own enumerable property
   * of the source, the undeclared ones included, so an accessor on one runs
   * exactly once during the copy; a closed row rebuilt from its declared fields
   * alone never looks. That difference is visible from JavaScript, and the copy
   * itself is not — Hexagon cannot name the field, so nothing can hand it back.
   */
  test("an open row's copy spreads the source, carrying what was never declared", async () => {
    const { main } = await run(OPEN);
    const reads: string[] = [];
    const given: Record<string, unknown> = { xs: [1, 2] };
    Object.defineProperty(given, "extra", {
      enumerable: true,
      get: () => {
        reads.push("extra");
        return { untouched: true };
      },
    });
    expect((main["widthOf"] as (r: unknown) => number)(given)).toBe(2);
    expect(reads).toEqual(["extra"]);
  });

  /**
   * The contrast, and the reason `open` is a plan field rather than a default:
   * a **closed** row "is rebuilt from its fields alone, which reads each of
   * them exactly once", and §5.4's closing note says what that means for the
   * rest — "the copy carries the declared fields and drops the rest".
   */
  test("a closed row's copy never looks at a field the declaration did not name", async () => {
    const { main } = await run(
      "export record Row = { xs: Array(Int) }\n" +
        "\n" +
        "export fun sizeOf(r: Row): Int = Array.length(r.xs)\n",
    );
    const reads: string[] = [];
    const given: Record<string, unknown> = { xs: [1, 2] };
    Object.defineProperty(given, "extra", {
      enumerable: true,
      get: () => {
        reads.push("extra");
        return 0;
      },
    });
    expect((main["sizeOf"] as (r: unknown) => number)(given)).toBe(2);
    expect(reads).toEqual([]);
  });

  /**
   * The other half of item 7's argument: "every field any Hexagon expression
   * named is on the face and a JavaScript caller supplies it". A body that
   * reads `r.m` puts `m` on the face, whatever the annotation wrote.
   */
  test("the face lists every field the body named", () => {
    expect(
      declarations("export fun peek(r: {n: Int, ...}): Int = r.n + r.m\n"),
    ).toContain("r: { n: number; m: number }");
  });
});

describe("the declaration face is untouched (§7, Part 1 §4.1)", () => {
  const FACES = "export fun hold(xs: Array(Int)): Int = xs[1]\n" +
    "export fun make(v: Vector(Int)): Array(Int) = Vector.toArray(v)\n" +
    "export record Pair = { xs: Array(Int), n: Int }\n";

  /**
   * §5.4's closing sentence: the walk is "not a change to any face: `Array(a)`
   * still faces as `ReadonlyArray<a>`, which is now simply true in both
   * directions". The wrapper is an emission fact and the `.d.ts` does not know
   * about it.
   */
  test("`ReadonlyArray` faces both directions and no wrapper is named", () => {
    const text = declarations(FACES);
    expect(text).toContain("export declare function hold(xs: ReadonlyArray<number>): number;");
    expect(text).toContain(
      "export declare function make(v: Hex.Vector<number>): ReadonlyArray<number>;",
    );
    expect(text).not.toContain("Boundary");
  });

  /**
   * §7: the internal edition appears "in no `.d.ts`". It is compiler linkage
   * outside the published foreign contract (Part 1 §5.4), and a JavaScript
   * module that imports it by that spelling is in §3.1's territory — the
   * omission is not the protection, but it is the face's part of it.
   */
  test("no internal edition reaches the face", () => {
    expect(declarations(FACES)).not.toMatch(/\b__\w/u);
  });
});

describe("an extern binding's copying wrapper is already one object (Part 4 §4.3, §7)", () => {
  /**
   * The interaction §7 sends here: "exported extern bindings re-export per Part
   * 4 §7". The local extern binding *is* the stable module-level copying
   * wrapper, so re-exporting it and taking it first-class both reach that one
   * wrapper — occasion 4 adds nothing, and this pin is what says so.
   */
  test("the re-export and a first-class reference are the same function", async () => {
    const { main } = await run(
      'extern from "rows"\n' +
        "    export fun rows() ->! Array(Int)\n" +
        "\n" +
        "export fun viaRef(): () ->! Array(Int) = rows\n",
      {
        rows: "export const source = [1, 2];\nexport function rows() { return source; }\n",
      },
    );
    expect(main["rows"]).toBe((main["viaRef"] as () => unknown)());
  });

  /** And two acquisitions are two values, with the foreign source unreachable. */
  test("two acquisitions are two values and neither is the foreign array", async () => {
    const { main, foreign } = await run(
      'extern from "store"\n' +
        "    export fun cells() ->! Array(Int)\n",
      {
        store: "export const source = [7, 8];\nexport function cells() { return source; }\n",
      },
    );
    const take = main["cells"] as () => number[];
    const first = take();
    const second = take();
    const { source } = await foreign("store") as { source: number[] };
    expect(first).not.toBe(second);
    expect(first).not.toBe(source);
    expect(first).toEqual([7, 8]);
    first[0] = 999;
    expect(source).toEqual([7, 8]);
  });
});
