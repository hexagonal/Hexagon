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

describe("the inbound adapter memoizes a forcing failure (FFI Part 3 §7.1)", () => {
  /**
   * §7.1: "**If forcing a sequence node fails, that node remembers the
   * failure**: forcing the same persistent position again must not advance the
   * iterator and must not repeat the foreign operation." §7.2 step 6 repeats it
   * for every step of the protocol order. Failure is an outcome like any other
   * in the §4 spine — a third memo state beside *unforced* and *forced*.
   *
   * Defect 15. Each test below forces **one persistent position twice** and
   * asserts two things the old spine got wrong: the second force throws the
   * *same* value (identity, so a re-run that happens to throw a look-alike does
   * not pass), and the foreign side was touched exactly once.
   *
   * The failing position is the head, so the failure is what a caller sees
   * first; the foreign sources all yield perfectly good values on the call
   * after the failing one, which is what makes a re-invocation visible as a
   * *success* where §7.1 demands a replayed failure.
   */

  /** `force()` twice over a shared head, plus the foreign side's own call count. */
  async function forcedTwice(foreign: string): Promise<{
    thrown: readonly unknown[];
    touches: number;
  }> {
    const exports = await run(
      [["/main.hex",
        "extern from \"numbers\"\n" +
        "    fun counter(): Seq(Int)\n" +
        "    fun touches(): Int\n" +
        "\n" +
        "let shared: Seq(Int) = counter()\n" +
        "\n" +
        "export let force(ignored: Int): Int =\n" +
        "    match Seq.next(shared)\n" +
        "        None => 0\n" +
        "        Some((value, _)) => value\n" +
        "\n" +
        "export let touched(ignored: Int): Int = touches()\n"]],
      { numbers: foreign },
    );
    const force = exports["force"] as (ignored: number) => number;
    const thrown: unknown[] = [];
    for (const _attempt of [0, 1]) {
      try {
        force(0);
      } catch (error) {
        thrown.push(error);
      }
    }
    return { thrown, touches: (exports["touched"] as (ignored: number) => number)(0) };
  }

  test("a throw from `next()` is replayed, and the iterator does not advance", async () => {
    const { thrown, touches } = await forcedTwice([
      "let calls = 0;",
      "export function touches() { return calls; }",
      "export function counter() {",
      "  return { [Symbol.iterator]() {",
      "    return { next() {",
      "      calls += 1;",
      "      if (calls === 1) throw new Error(\"no first element\");",
      "      return { done: false, value: calls };",
      "    } };",
      "  } };",
      "}",
    ].join("\n"));
    // Two failures, not a failure and then the element the caller skipped past.
    expect(thrown).toHaveLength(2);
    expect(thrown[1]).toBe(thrown[0]);
    expect((thrown[0] as Error).message).toBe("no first element");
    expect(touches).toBe(1);
  });

  test("a throw from `[Symbol.iterator]()` is replayed, and the source is acquired once", async () => {
    // §7.1 names acquisition among the throwing operations. It happens *during*
    // the first force (§3), so it is that node's failure like any other.
    const { thrown, touches } = await forcedTwice([
      "let acquisitions = 0;",
      "export function touches() { return acquisitions; }",
      "export function counter() {",
      "  return { [Symbol.iterator]() {",
      "    acquisitions += 1;",
      "    if (acquisitions === 1) throw new Error(\"no cursor\");",
      "    return { next: () => ({ done: false, value: 7 }) };",
      "  } };",
      "}",
    ].join("\n"));
    expect(thrown).toHaveLength(2);
    expect(thrown[1]).toBe(thrown[0]);
    expect((thrown[0] as Error).message).toBe("no cursor");
    expect(touches).toBe(1);
  });

  test("a throw from a `done` getter is replayed, and the iterator does not advance", async () => {
    // §7.2 step 3's read, and the earlier of the two accessors §7.2 names.
    // Nothing about the node has been decided when this throws — not even
    // whether it ends the sequence — so the memo cell is all there is to record.
    const { thrown, touches } = await forcedTwice([
      "let calls = 0;",
      "export function touches() { return calls; }",
      "export function counter() {",
      "  return { [Symbol.iterator]() {",
      "    return { next() {",
      "      calls += 1;",
      "      if (calls === 1) return { get done() { throw new Error(\"bad done\"); }, value: 1 };",
      "      return { done: false, value: calls };",
      "    } };",
      "  } };",
      "}",
    ].join("\n"));
    expect(thrown).toHaveLength(2);
    expect(thrown[1]).toBe(thrown[0]);
    expect((thrown[0] as Error).message).toBe("bad done");
    expect(touches).toBe(1);
  });

  test("a throw from a `value` getter is replayed, and the iterator does not advance", async () => {
    // §7.2 step 5's read. `done` was already read and coerced when this throws,
    // so the memo cell must record the failure rather than a half-forced node.
    const { thrown, touches } = await forcedTwice([
      "let calls = 0;",
      "export function touches() { return calls; }",
      "export function counter() {",
      "  return { [Symbol.iterator]() {",
      "    return { next() {",
      "      calls += 1;",
      "      if (calls === 1) return { done: false, get value() { throw new Error(\"bad value\"); } };",
      "      return { done: false, value: calls };",
      "    } };",
      "  } };",
      "}",
    ].join("\n"));
    expect(thrown).toHaveLength(2);
    expect(thrown[1]).toBe(thrown[0]);
    expect((thrown[0] as Error).message).toBe("bad value");
    expect(touches).toBe(1);
  });

  test("the malformed-result TypeError is replayed, and the iterator does not advance", async () => {
    // The one check the adapter performs itself (§7.2). Its `TypeError` is
    // raised by the spine, not the foreign side, and is memoized identically —
    // identity here proves the *stored* error is rethrown, not a fresh one.
    const { thrown, touches } = await forcedTwice([
      "let calls = 0;",
      "export function touches() { return calls; }",
      "export function counter() {",
      "  return { [Symbol.iterator]() {",
      "    return { next() {",
      "      calls += 1;",
      "      return calls === 1 ? 5 : { done: false, value: calls };",
      "    } };",
      "  } };",
      "}",
    ].join("\n"));
    expect(thrown).toHaveLength(2);
    expect(thrown[0]).toBeInstanceOf(TypeError);
    expect(thrown[1]).toBe(thrown[0]);
    expect(touches).toBe(1);
  });

  /**
   * The failure is an outcome of **one position**, not of the sequence. A
   * position already forced keeps its value: §4's spine memoizes outcomes
   * per position, and §7.1 speaks of "that node". So the replay check belongs
   * *inside* the frontier guard, and this is the test that says so — the four
   * above all fail at the head, so none of them would notice a check that
   * poisoned every buffered position behind the failed one.
   *
   * It is also the only case here where the failing position is not the head.
   */
  test("a failure does not poison the positions already forced before it", async () => {
    const exports = await run(
      [["/main.hex",
        "extern from \"numbers\"\n" +
        "    fun counter(): Seq(Int)\n" +
        "    fun touches(): Int\n" +
        "\n" +
        "let shared: Seq(Int) = counter()\n" +
        "\n" +
        "let tailOf(source: Seq(Int)): Seq(Int) =\n" +
        "    match Seq.next(source)\n" +
        "        None => source\n" +
        "        Some((_, rest)) => rest\n" +
        "\n" +
        "let second: Seq(Int) = tailOf(shared)\n" +
        "\n" +
        "export let forceSecond(ignored: Int): Int =\n" +
        "    match Seq.next(second)\n" +
        "        None => 0\n" +
        "        Some((value, _)) => value\n" +
        "\n" +
        "export let forceHead(ignored: Int): Int =\n" +
        "    match Seq.next(shared)\n" +
        "        None => 0\n" +
        "        Some((value, _)) => value\n" +
        "\n" +
        "export let touched(ignored: Int): Int = touches()\n"]],
      {
        numbers: [
          "let calls = 0;",
          "export function touches() { return calls; }",
          "export function counter() {",
          "  return { [Symbol.iterator]() {",
          "    return { next() {",
          "      calls += 1;",
          "      if (calls === 2) throw new Error(\"no second element\");",
          "      return { done: false, value: calls * 10 };",
          "    } };",
          "  } };",
          "}",
        ].join("\n"),
      },
    );
    const forceSecond = exports["forceSecond"] as (ignored: number) => number;
    const forceHead = exports["forceHead"] as (ignored: number) => number;
    // Position 1 was forced while `second` was taken, so it is buffered.
    expect(forceHead(0)).toBe(10);
    const thrown: unknown[] = [];
    for (const _attempt of [0, 1]) {
      try {
        forceSecond(0);
      } catch (error) {
        thrown.push(error);
      }
    }
    expect(thrown).toHaveLength(2);
    expect(thrown[1]).toBe(thrown[0]);
    // The head still answers with its value, after the failure and twice over.
    expect(forceHead(0)).toBe(10);
    expect((exports["touched"] as (ignored: number) => number)(0)).toBe(2);
  });
});
