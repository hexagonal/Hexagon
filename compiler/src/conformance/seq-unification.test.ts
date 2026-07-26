import { describe, expect, test } from "vitest";

import { compileProject, Source } from "../index";

/**
 * Conformance for the `Seq` unification (plan Phase 4 steps 8–9): the prelude
 * `Seq.hex` record is the *only* `Seq(a)` there is, and every compiler-side
 * producer and consumer speaks its representation through the FFI Part 3 pair
 * (ruling R1).
 *
 * These are **runtime round-trips on purpose.** The defect log's recurring shape
 * — entries 8 and 10, PR #88's F1 — is a clean compile whose emitted JavaScript
 * is unloadable, so a test that only reads diagnostics proves nothing about the
 * coupling it claims to pin. Every assertion below executes the emitted module.
 *
 * R5: the inbound adapter builds `Option` values and `Seq` records as literal
 * emitted shapes, because it is the one place the compiler is allowed to know
 * them. The round-trips here are what makes a change to either shape break
 * loudly instead of silently producing a `Seq` no `.hex` code can destructure.
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
 * Compiles a project and executes it, returning `/main.hex`'s exports.
 *
 * `foreign` supplies genuine JavaScript modules by specifier, so an `extern`
 * boundary can actually be crossed at runtime rather than only typechecked.
 */
async function run(
  files: readonly (readonly [string, string])[],
  foreign: Readonly<Record<string, string>> = {},
): Promise<Record<string, unknown>> {
  const project = compileProject(
    files.map(([path, text], index) => new Source.File(Source.fileId(index), path, text)),
  );
  expect(project.diagnostics).toEqual([]);
  const moduleUrls = new Map<string, string>();
  for (const [specifier, source] of Object.entries(foreign)) {
    moduleUrls.set(specifier, `data:text/javascript;charset=utf-8,${encodeURIComponent(source)}`);
  }
  for (const module of project.modules) {
    const linked = link(module.javascript.text, module.source.path, moduleUrls)
      .replace(
        /^(\s*import(?:[^;\n]*?\sfrom)?\s+)(["'])([^"']+)\2;/gmu,
        (statement, prefix: string, _quote: string, specifier: string) => {
          const url = moduleUrls.get(specifier);
          return url === undefined ? statement : `${prefix}${JSON.stringify(url)};`;
        },
      );
    moduleUrls.set(
      module.source.path,
      `data:text/javascript;charset=utf-8,${encodeURIComponent(linked)}`,
    );
  }
  // By path, never `modules[0]`: the prelude members share the project.
  return (await import(/* @vite-ignore */ moduleUrls.get("/main.hex")!)) as Record<string, unknown>;
}

function main(source: string): Promise<Record<string, unknown>> {
  return run([["/main.hex", source]]);
}

function diagnostics(source: string): readonly string[] {
  return compileProject([new Source.File(Source.fileId(0), "/main.hex", source)])
    .diagnostics.map((diagnostic) => diagnostic.message);
}

describe("Seq is one type", () => {
  /**
   * The single fact the whole arc turns on. A `Seq` built by the prelude's own
   * combinators and a `Seq` yielded by a compiler-known producer must be the
   * same type, so either can be handed to either side.
   */
  test("a prelude-built Seq and a compiler-produced Seq unify", () => {
    expect(diagnostics(
      "export let joined: Seq(Int) = Seq.concat(Seq.take(Seq.iterate(1, x => x + 1), 2), Vector.toSeq([7, 8]))\n",
    )).toEqual([]);
  });

  test("a compiler-produced Seq destructures through the §6.2 protocol", async () => {
    const exports = await main(
      "export let head: Option(Int) =\n" +
      "    match Seq.next(Vector.toSeq([4, 5, 6]))\n" +
      "        None => None\n" +
      "        Some((value, _)) => Some(value)\n",
    );
    expect(exports["head"]).toEqual({ tag: "Some", value: 4 });
  });

  test("a prelude-built Seq is accepted where a compiler-known consumer wants one", async () => {
    const exports = await main(
      "export let rebuilt: Vector(Int) = Vector.fromSeq(Seq.take(Seq.iterate(1, x => x * 2), 4))\n",
    );
    expect(exports["rebuilt"]).toEqual([1, 2, 4, 8]);
  });
});

describe("the bare compiler-known rows (R4)", () => {
  /**
   * The blind spot that 473 compiler tests missed and the shipped `vectors`
   * playground example caught: no test mixed a bare `Vector.fromSeq` with a
   * `Seq.iterate`. Both spellings survive this arc retyped and re-emitted
   * through the R1 pair; they die in `Vector`'s own arc.
   */
  test("Vector.toSeq / Vector.fromSeq round-trip", async () => {
    const exports = await main(
      "export let replayed: Vector(Int) = Vector.fromSeq(Vector.toSeq([1, 2, 3]))\n",
    );
    expect(exports["replayed"]).toEqual([1, 2, 3]);
  });

  test("Vector.fromSeq consumes a lazily built infinite Seq", async () => {
    const exports = await main(
      "export let firstFive: Vector(Int) = Vector.fromSeq(Seq.take(Seq.iterate(0, x => x + 3), 5))\n",
    );
    expect(exports["firstFive"]).toEqual([0, 3, 6, 9, 12]);
  });

  test("Set and Map producers yield the same Seq", async () => {
    const exports = await main(
      "let numbers: Set(Int) = Set.fromVector([3, 1, 2])\n" +
      "export let sorted: Vector(Int) = Vector.fromSeq(Set.toSeq(numbers))\n" +
      "let table: Map(String, Int) = Map.fromVector([(\"a\", 1), (\"b\", 2)])\n" +
      "export let keyCount: Int = Seq.length(Map.keys(table))\n" +
      "export let valueTotal: Int = Seq.fold(Map.values(table), 0, (total, value) => total + value)\n",
    );
    expect((exports["sorted"] as number[]).slice().sort()).toEqual([1, 2, 3]);
    expect(exports["keyCount"]).toBe(2);
    expect(exports["valueTotal"]).toBe(3);
  });

  test("Map.fromSeq and Set.fromSeq consume a prelude-built Seq", async () => {
    const exports = await main(
      "let pairs: Seq((String, Int)) = Vector.toSeq([(\"a\", 1), (\"b\", 2)])\n" +
      "export let table: Map(String, Int) = Map.fromSeq(pairs)\n" +
      "export let names: Set(String) = Set.fromSeq(Map.keys(table))\n" +
      "export let size: Int = Map.size(table)\n" +
      "export let count: Int = Set.size(names)\n",
    );
    expect(exports["size"]).toBe(2);
    expect(exports["count"]).toBe(2);
  });
});

describe("`for x in` over a Seq (R3)", () => {
  /** Compiler-owned, per R1/R3: it lowers through the outbound driver. */
  test("iterates a compiler-produced Seq", async () => {
    const exports = await main(
      "let sumOf(values: Seq(Int)): Int =\n" +
      "    var sum = 0\n" +
      "    for value in values\n" +
      "        sum := sum + value\n" +
      "    sum\n" +
      "\n" +
      "export let total: Int = sumOf(Vector.toSeq([1, 2, 3, 4]))\n",
    );
    expect(exports["total"]).toBe(10);
  });

  test("iterates a prelude-built Seq, and stops on a bounded prefix of an infinite one", async () => {
    const exports = await main(
      "let sumOf(values: Seq(Int)): Int =\n" +
      "    var sum = 0\n" +
      "    for value in values\n" +
      "        sum := sum + value\n" +
      "    sum\n" +
      "\n" +
      "export let total: Int = sumOf(Seq.take(Seq.iterate(1, x => x + 1), 5))\n",
    );
    expect(exports["total"]).toBe(15);
  });

  test("drives a long Seq in constant stack", async () => {
    const exports = await main(
      "let sumOf(values: Seq(Int)): Int =\n" +
      "    var sum = 0\n" +
      "    for value in values\n" +
      "        sum := sum + value\n" +
      "    sum\n" +
      "\n" +
      "export let total: Int = sumOf(Seq.take(Seq.iterate(1, x => x + 1), 50000))\n",
    );
    expect(exports["total"]).toBe(1_250_025_000);
  });
});

describe("compiler-known operation spellings keep working (step 8 item 1)", () => {
  /**
   * The `SeqOperation` special case is deleted, not repointed. These four
   * spellings must keep compiling with identical types through ordinary
   * qualified reference against prelude `Seq.hex`.
   */
  test("Seq.iterate / map / filter / take", async () => {
    const exports = await main(
      "export let values: Vector(Int) =\n" +
      "    Vector.fromSeq(Seq.take(Seq.filter(Seq.map(Seq.iterate(1, x => x + 1), x => x * 3), x => x > 4), 3))\n",
    );
    expect(exports["values"]).toEqual([6, 9, 12]);
  });

  test("subject-first dot calls dispatch to the prelude companion", async () => {
    const exports = await main(
      "let source: Seq(Int) = Seq.iterate(1, x => x + 1)\n" +
      "export let values: Vector(Int) = Vector.fromSeq(source.map(x => x * 2).filter(x => x > 4).take(3))\n",
    );
    expect(exports["values"]).toEqual([6, 8, 10]);
  });

  test("a module-level binding occludes the companion of the same name", async () => {
    // Companion dispatch resolves by *name* over everything visible, and a
    // module's own declarations come last, so a local `map` wins over the
    // prelude's. That is the pre-existing rule for every nominal receiver, not
    // something `Seq` introduces; it is pinned here because `Seq.hex` is the
    // first prelude module whose operations can collide with ordinary names.
    // The prelude's version stays reachable qualified (Modules §5.4/§6.4).
    const exports = await main(
      "let map(value: Int): Int = value + 100\n" +
      "export let shadowed: Int = map(1)\n" +
      "export let qualified: Vector(Int) =\n" +
      "    Vector.fromSeq(Seq.map(Vector.toSeq([1, 2]), x => x * 2))\n",
    );
    expect(exports["shadowed"]).toBe(101);
    expect(exports["qualified"]).toEqual([2, 4]);
  });
});

describe("laziness survives the unification", () => {
  test("a compiler-produced Seq is not driven past what is demanded", async () => {
    const exports = await main(
      "export let firstTwo: Vector(Int) =\n" +
      "    Vector.fromSeq(Seq.take(Seq.map(Seq.iterate(1, x => x + 1), x => x * 10), 2))\n",
    );
    // An infinite source: reaching this value at all proves `take` bounded the
    // drive rather than the producer running to exhaustion.
    expect(exports["firstTwo"]).toEqual([10, 20]);
  });

  test("a Seq is persistent — driving it twice does not consume it", async () => {
    const exports = await main(
      "let shared: Seq(Int) = Seq.take(Seq.iterate(1, x => x + 1), 3)\n" +
      "export let first: Vector(Int) = Vector.fromSeq(shared)\n" +
      "export let second: Vector(Int) = Vector.fromSeq(shared)\n",
    );
    expect(exports["first"]).toEqual([1, 2, 3]);
    expect(exports["second"]).toEqual([1, 2, 3]);
  });

  test("a compiler-produced Seq is replayable across independent traversals", async () => {
    const exports = await main(
      "let keys: Seq(Int) = Vector.toSeq([1, 2, 3])\n" +
      "export let a: Int = Seq.fold(keys, 0, (total, value) => total + value)\n" +
      "export let b: Int = Seq.length(keys)\n",
    );
    expect(exports["a"]).toBe(6);
    expect(exports["b"]).toBe(3);
  });
});

describe("the boundary face (FFI Part 3)", () => {
  test("a Seq crosses out to JavaScript as an Iterable", async () => {
    const project = compileProject([
      new Source.File(
        Source.fileId(0),
        "/main.hex",
        "export let counted: Seq(Int) = Seq.take(Seq.iterate(1, x => x + 1), 3)\n",
      ),
    ]);
    expect(project.diagnostics).toEqual([]);
    const declarations = project.modules
      .find((module) => module.source.path === "/main.hex")!
      .declarations.text;
    expect(declarations).toContain("export declare const counted: Iterable<number>;");
  });

  /**
   * **Known gap, pinned deliberately — defect 11.** FFI Part 3 §9.1 says an
   * exported Hexagon `Seq` is a *replayable JavaScript iterable*: each
   * `[Symbol.iterator]()` opens an independent cursor over the same memoized
   * sequence. Under the intrinsic that held for free, because a `Seq` *was* a
   * JS iterable. It is a record now, and this arc does not restore the property.
   *
   * It is not an oversight and not a one-line fix. An emitted ESM binding is
   * simultaneously the Hexagon interface and the JavaScript interface, so an
   * export-site wrapper (Part 7 §7's mechanism) would hand Hexagon importers the
   * wrapped value and break them. The three candidate answers — a per-value
   * `[Symbol.iterator]` on the record, a dual-binding export protocol, or
   * changing the face to Part 7 §6's opaque brand — trade FFI Part 3 §9.1, Part
   * 7 §6, ruling R1's "sole compiler-side constructor", and per-step allocation
   * cost against each other. That is a ruling, and `Seq` is the pilot every
   * other collection inherits, so guessing here would bake the guess into
   * `Vector`, `Set`, and `Map`.
   *
   * Pinned as behaviour rather than left absent, so the ruling lands against a
   * test that already fails loudly when it changes.
   */
  test("an exported function's Seq positions face JavaScript as the record too", async () => {
    // The half defect 12's first statement omitted (PR #91 finding F2, Fable).
    // FFI Part 7 §7 **occasion 1** — a stable wrapper adapting an incoming
    // `Iterable(a)` parameter declared `Seq(a)` — is decided spec, unimplemented
    // here: a JS caller following the published face passes an array and the
    // body drives `.pull` on it. Result positions have the mirror problem.
    // Pinned so the ruling lands against the whole statement, not half of it.
    const project = compileProject([
      new Source.File(
        Source.fileId(0),
        "/main.hex",
        "export let total(values: Seq(Int)): Int = Seq.fold(values, 0, (a, b) => a + b)\n" +
        "export let upTo(count: Int): Seq(Int) = Seq.take(Seq.iterate(1, x => x + 1), count)\n",
      ),
    ]);
    expect(project.diagnostics).toEqual([]);
    const compiled = project.modules.find((module) => module.source.path === "/main.hex")!;
    // The published face, in both positions.
    expect(compiled.declarations.text).toContain(
      "export declare const total: (values: Iterable<number>) => number;",
    );
    expect(compiled.declarations.text).toContain(
      "export declare const upTo: (count: number) => Iterable<number>;",
    );
    // And no boundary wrapper stands behind either one.
    expect(compiled.javascript.text).toContain("const total = values => fold(values, 0,");
    expect(compiled.javascript.text).not.toContain("__hex_seqFromIterable");
  });

  test("an exported Seq faces JavaScript as the record, not yet as an Iterable", async () => {
    const exports = await main(
      "export let counted: Seq(Int) = Seq.take(Seq.iterate(1, x => x + 1), 3)\n",
    );
    const counted = exports["counted"] as { pull: unknown };
    expect(typeof counted.pull).toBe("function");
    expect(counted[Symbol.iterator as unknown as keyof typeof counted]).toBeUndefined();
    // The face the `.d.ts` promises, which the value does not yet satisfy.
    const project = compileProject([
      new Source.File(
        Source.fileId(0),
        "/main.hex",
        "export let counted: Seq(Int) = Seq.take(Seq.iterate(1, x => x + 1), 3)\n",
      ),
    ]);
    expect(
      project.modules.find((module) => module.source.path === "/main.hex")!.declarations.text,
    ).toContain("export declare const counted: Iterable<number>;");
  });

  test("a foreign `Seq` result enters through the inbound adapter, not raw", () => {
    const project = compileProject([
      new Source.File(
        Source.fileId(0),
        "/main.hex",
        "extern from \"./numbers.js\"\n" +
        "    export fun counter(): Seq(Int)\n" +
        "\n" +
        "export let first: Option(Int) =\n" +
        "    match Seq.next(counter())\n" +
        "        None => None\n" +
        "        Some((value, _)) => Some(value)\n",
      ),
    ]);
    expect(project.diagnostics).toEqual([]);
    const javascript = project.modules
      .find((module) => module.source.path === "/main.hex")!
      .javascript.text;
    // The declared result is a `Seq`, so the raw foreign iterable is adapted
    // rather than handed to `.hex` code that would try to read `pull` off it.
    expect(javascript).toMatch(/__hex_seqFromIterable\(__hex_counterForeign\d*\(\)\)/u);
  });
});

describe("the inbound adapter's protocol access order (FFI Part 3 §7.2)", () => {
  /**
   * §7.2 fixes the order exactly, because `done` and `value` may be effectful
   * getters: call `next()` once, require an object, read `done` once and
   * **boolean-coerce** it, read `value` once and only when not done.
   *
   * The coercion is the part that is easy to get wrong. `done === true` is not
   * boolean coercion, and a foreign iterator yielding `{ done: 1 }` terminates
   * under native `for...of` while looping forever under a strict-equality check
   * (PR #91 finding F3, Fable).
   */

  test("a truthy non-boolean `done` terminates, as native iteration does", async () => {
    const exports = await run(
      [["/main.hex",
        "extern from \"numbers\"\n" +
        "    fun counter(): Seq(Int)\n" +
        "\n" +
        "export let collected: Vector(Int) = Vector.fromSeq(counter())\n"]],
      {
        numbers: [
          "export function counter() {",
          "  let index = 0;",
          "  return { [Symbol.iterator]() {",
          "    return { next() {",
          "      index += 1;",
          "      return index <= 2 ? { done: 0, value: index } : { done: 1 };",
          "    } };",
          "  } };",
          "}",
        ].join("\n"),
      },
    );
    expect(exports["collected"]).toEqual([1, 2]);
  });

  test("`value` is not read when the step is done", async () => {
    const exports = await run(
      [["/main.hex",
        "extern from \"numbers\"\n" +
        "    fun counter(): Seq(Int)\n" +
        "    fun valueReads(): Int\n" +
        "\n" +
        "export let collected: Vector(Int) = Vector.fromSeq(counter())\n" +
        "export let reads: Int = valueReads()\n"]],
      {
        numbers: [
          "let reads = 0;",
          "export function valueReads() { return reads; }",
          "export function counter() {",
          "  let index = 0;",
          "  return { [Symbol.iterator]() {",
          "    return { next() {",
          "      index += 1;",
          "      const done = index > 2;",
          "      return { done, get value() { reads += 1; return index; } };",
          "    } };",
          "  } };",
          "}",
        ].join("\n"),
      },
    );
    expect(exports["collected"]).toEqual([1, 2]);
    // Two reads, not three: the terminating step must not touch `value`.
    expect(exports["reads"]).toBe(2);
  });

  test("a malformed iterator result is a TypeError, as native iteration gives", async () => {
    await expect(run(
      [["/main.hex",
        "extern from \"numbers\"\n" +
        "    fun counter(): Seq(Int)\n" +
        "\n" +
        "export let collected: Vector(Int) = Vector.fromSeq(counter())\n"]],
      {
        numbers: [
          "export function counter() {",
          "  return { [Symbol.iterator]() { return { next() { return 5; } }; } };",
          "}",
        ].join("\n"),
      },
    )).rejects.toThrow(TypeError);
  });

  test("the source is not acquired before the first pull (§3)", async () => {
    // §3 forbids speculative `[Symbol.iterator]()` and forbids restarting
    // foreign computation to discover what kind of iterable is held.
    const exports = await run(
      [["/main.hex",
        "extern from \"numbers\"\n" +
        "    fun counter(): Seq(Int)\n" +
        "    fun acquisitions(): Int\n" +
        "\n" +
        "let unused: Seq(Int) = counter()\n" +
        "export let before: Int = acquisitions()\n"]],
      {
        numbers: [
          "let acquired = 0;",
          "export function acquisitions() { return acquired; }",
          "export function counter() {",
          "  return { [Symbol.iterator]() { acquired += 1; return { next: () => ({ done: true }) }; } };",
          "}",
        ].join("\n"),
      },
    );
    expect(exports["before"]).toBe(0);
  });
});
