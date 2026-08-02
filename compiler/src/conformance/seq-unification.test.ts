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
   * **Defect 12, closed** (FFI Part 3 §9.4, ruled 2026-07-28). Three tests here
   * held the divergence as pinned behaviour while it awaited a ruling; they now
   * hold the ruling's three positions. §9.4's seven normative properties of the
   * memoized boundary view get their own describe block below.
   *
   * The face is **representation**, not plumbing: every `Seq` value carries the
   * boundary traversal method from construction, which is what lets a value
   * export be direct (a wrapper there would hand Hexagon importers a non-`Seq`)
   * and what makes Part 7 §6's identity crossing true rather than traded away.
   */
  test("an exported function's Seq parameter goes through occasion 1's wrapper", async () => {
    // Part 7 §7 occasion 1, specified by §9.4: the parameter position is the one
    // that needs a wrapper, because what arrives may be any iterable. The result
    // position needs none — it is honest by representation.
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
    // The `Seq` parameter is routed through the door; the `Seq` result is not
    // wrapped at all, because the value already carries its face.
    expect(compiled.javascript.text).toMatch(
      /const (\w+) = __hex_argument0 => total\(__hex_seqInbound\(__hex_argument0\)\);\nexport \{ \1 as total \};/u,
    );
    expect(compiled.javascript.text).toContain("export { upTo };");
  });

  test("a JavaScript caller may pass any iterable to an exported Seq parameter", async () => {
    // What the wrapper is *for*: the published face says `Iterable<number>`, so
    // an array must work, and so must a single-shot generator.
    const exports = await main(
      "export let total(values: Seq(Int)): Int = Seq.fold(values, 0, (a, b) => a + b)\n",
    );
    const total = exports["total"] as (values: Iterable<number>) => number;
    expect(total([1, 2, 3])).toBe(6);
    expect(total(new Set([4, 5]))).toBe(9);
    expect(total((function* () {
      yield 10;
      yield 20;
    })())).toBe(30);
  });

  test("an exported Seq faces JavaScript as an Iterable, by representation", async () => {
    const exports = await main(
      "export let counted: Seq(Int) = Seq.take(Seq.iterate(1, x => x + 1), 3)\n",
    );
    const counted = exports["counted"] as Iterable<number> & { pull: unknown };
    // The record is unchanged — `pull` is still the §6.2 protocol — and the
    // JavaScript face rides the same value rather than a wrapper around it.
    expect(typeof counted.pull).toBe("function");
    expect(typeof counted[Symbol.iterator]).toBe("function");
    expect([...counted]).toEqual([1, 2, 3]);
    // And the value export is the raw ESM binding: no indirection to unwrap.
    const project = compileProject([
      new Source.File(
        Source.fileId(0),
        "/main.hex",
        "export let counted: Seq(Int) = Seq.take(Seq.iterate(1, x => x + 1), 3)\n",
      ),
    ]);
    const compiled = project.modules.find((module) => module.source.path === "/main.hex")!;
    expect(compiled.declarations.text).toContain(
      "export declare const counted: Iterable<number>;",
    );
    expect(compiled.javascript.text).toContain("export { counted };");
  });

  test("the shared method is one function, not a closure per value", async () => {
    // §9.4: "one shared method for all `Seq` values, never a per-value closure".
    // Directly observable, so observed rather than read off the emitted text.
    const exports = await run(
      [["/main.hex",
        "extern from \"numbers\"\n" +
        "    fun counter(): Seq(Int)\n" +
        "    fun other(): Seq(Int)\n" +
        "\n" +
        "export let one: Seq(Int) = Seq.singleton(1)\n" +
        "export let many: Seq(Int) = Seq.take(Seq.iterate(1, x => x + 1), 3)\n" +
        "export let none: Seq(Int) = Seq.empty\n" +
        "export let adapted: Seq(Int) = counter()\n" +
        "export let alsoAdapted: Seq(Int) = other()\n"]],
      {
        numbers: "export function counter() { return [1, 2, 3]; }\n" +
          "export function other() { return [4, 5]; }",
      },
    );
    const face = (name: string) =>
      (exports[name] as Iterable<number>)[Symbol.iterator];
    expect(typeof face("one")).toBe("function");
    // Three different combinators in `Seq.hex`, one method.
    expect(face("one")).toBe(face("many"));
    expect(face("one")).toBe(face("none"));
    // The inbound adapter is the *other* construction site the ruling names,
    // and it lives in this module's helper block rather than `Seq.hex`'s — so
    // its nodes share a method with each other, and, per §9.4's scope edit
    // note, deliberately **not** with `Seq.hex`'s values. That asymmetry is why
    // the door's mark cannot be this method's identity (§2.2).
    expect(face("adapted")).toBe(face("alsoAdapted"));
    expect(face("adapted")).not.toBe(face("one"));
    // And a tail pulled out of an adapter node carries it too — the node
    // factory builds every successor, not just the head.
    const [, tail] = (exports["adapted"] as unknown as {
      pull: () => { value: [number, Iterable<number>] };
    }).pull().value;
    expect(tail[Symbol.iterator]).toBe(face("adapted"));
  });

  test("a foreign `Seq` result enters through the inbound door, not raw", () => {
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
    // rather than handed to `.hex` code that would try to read `pull` off it —
    // through §2.2's door, which is what makes a round-tripped `Seq` come home
    // by identity instead of acquiring a second spine (Part 4 §4.3).
    expect(javascript).toMatch(/__hex_seqInbound\(__hex_counterForeign\d*\(\)\)/u);
  });

  test("a Seq argument to a foreign function crosses as itself, unwrapped", () => {
    // §9.4's outbound extern direction: the value carries its `Iterable<a>` face
    // by representation, so there is nothing to drive it through. The extern
    // needs no wrapper at all and the ESM import binds directly.
    const project = compileProject([
      new Source.File(
        Source.fileId(0),
        "/main.hex",
        "extern from \"./numbers.js\"\n" +
        "    fun consume(values: Seq(Int)): Int\n" +
        "\n" +
        "export let out: Int = consume(Seq.singleton(1))\n",
      ),
    ]);
    expect(project.diagnostics).toEqual([]);
    const javascript = project.modules
      .find((module) => module.source.path === "/main.hex")!
      .javascript.text;
    expect(javascript).toContain('import { consume } from "./numbers.js";');
    expect(javascript).not.toContain("__hex_seqToIterable(values)");
  });

  test("a foreign function receives a Hexagon Seq as a working iterable", async () => {
    const exports = await run(
      [["/main.hex",
        "extern from \"numbers\"\n" +
        "    fun consume(values: Seq(Int)): Int\n" +
        "\n" +
        "export let out: Int = consume(Seq.take(Seq.iterate(1, x => x + 1), 4))\n"]],
      {
        numbers: [
          "export function consume(values) {",
          "  let total = 0;",
          "  for (const value of values) total += value;",
          "  return total;",
          "}",
        ].join("\n"),
      },
    );
    expect(exports["out"]).toBe(10);
  });

  test("a Seq round-tripped through JavaScript comes home by identity", async () => {
    // §2.2's door, and the reason it exists: re-adapting would wrap a possibly
    // re-deriving spine in a memoizing one, observably changing the value's
    // persistence regime on a trip that changed nothing.
    const exports = await run(
      [["/main.hex",
        "extern from \"numbers\"\n" +
        "    fun echo(values: Seq(Int)): Seq(Int)\n" +
        "\n" +
        "let sent: Seq(Int) = Seq.singleton(1)\n" +
        "export let same(ignored: Int): Bool = Seq.length(echo(sent)) == Seq.length(sent)\n" +
        "export let sentOut: Seq(Int) = sent\n" +
        "export let returned: Seq(Int) = echo(sent)\n"]],
      { numbers: "export function echo(values) { return values; }" },
    );
    expect(exports["returned"]).toBe(exports["sentOut"]);
    expect((exports["same"] as (ignored: number) => boolean)(0)).toBe(true);
  });

  test("a foreign iterable at a Seq position is still adapted freshly", async () => {
    // The door's other case, which is §2.1 unchanged: anything that is not a
    // genuine `Seq` gets its own adapter and its own spine.
    const exports = await run(
      [["/main.hex",
        "extern from \"numbers\"\n" +
        "    fun counter(): Seq(Int)\n" +
        "\n" +
        "export let firstPass: Vector(Int) = Vector.fromSeq(counter())\n" +
        "export let secondPass: Vector(Int) = Vector.fromSeq(counter())\n"]],
      {
        numbers: "export function counter() { return [1, 2, 3]; }",
      },
    );
    expect(exports["firstPass"]).toEqual([1, 2, 3]);
    expect(exports["secondPass"]).toEqual([1, 2, 3]);
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

/**
 * One macrotask, and a real collection — the machinery `seq-boundary-view`'s
 * §9.4 property 7 test introduced, for the sibling retention clause here. Both
 * reach off `globalThis` / non-literal specifiers for the same reason given
 * there: this package carries no `@types/node` and `lib` is `ES2024` alone.
 */
function yieldToEventLoop(): Promise<void> {
  const { setTimeout: schedule } = globalThis as unknown as {
    setTimeout: (callback: () => void, milliseconds: number) => unknown;
  };
  return new Promise((resolve) => {
    schedule(() => resolve(), 0);
  });
}

async function collectGarbage(): Promise<void> {
  const v8 = "node:v8";
  const vm = "node:vm";
  const { setFlagsFromString } = await import(/* @vite-ignore */ v8) as {
    setFlagsFromString: (flags: string) => void;
  };
  const { runInNewContext } = await import(/* @vite-ignore */ vm) as {
    runInNewContext: (code: string) => unknown;
  };
  setFlagsFromString("--expose-gc");
  let collect: () => void;
  try {
    collect = runInNewContext("gc") as () => void;
  } finally {
    setFlagsFromString("--no-expose-gc");
  }
  collect();
}

describe("the memoizing spine reclaims an unreachable prefix (FFI Part 3 §5)", () => {
  /**
   * §5: "Memoization is represented by **persistent lazy nodes, not a permanent
   * central history array**", and the two clauses it spends that on — "once an
   * older position is unreachable, ordinary garbage collection may reclaim its
   * cached prefix", and the user-facing rule that "advancing while retaining
   * only the current cursor permits unreachable prefixes to be collected".
   *
   * Issue #131. The spine memoized into one array closed over by every node, so
   * the *newest* cursor pinned the entire forced prefix and neither clause held.
   * Nothing observed reclamation, which is why it survived: the conformance
   * suites pin what a `Seq` *yields*, and a central array yields exactly what
   * persistent nodes yield.
   *
   * So these two tests observe collection directly, the same way §9.4 property 7
   * does — `collectGarbage` exposes and withdraws `--expose-gc` in-process, so
   * they run on every ordinary `vitest run` rather than behind a flag check.
   *
   * The elements are **tuples**, because a `WeakRef` needs an object: an `Int`
   * element would be a JavaScript number, and a spine that retained every one of
   * them forever would be unobservable here.
   *
   * **The claim these pin is narrower than "prefixes are collected", and the
   * narrowing is deliberate.** Both sources below *re-derive* — a combinator
   * chain, and a foreign generator — so the memo is the only thing that could be
   * holding an early element, which is what makes the observation attributable
   * to the memo's representation. A source that *stores* (a `Seq.memoize` over
   * an inbound-adapted `Seq`, say) still has its prefix pinned, through a second
   * channel in the driver rather than in the memo: #230, out of #131's scope and
   * unfixed. Deleting the qualifier from these tests' subject would make them
   * assert something false.
   */

  /**
   * Cursor walking, in Hexagon rather than in the test: §5's subject is a
   * program that holds *only* the advanced position, and a JavaScript driver
   * would hold the head as well (`seqToIterable`'s generator closes over it, and
   * so would the local). `advance` returns the cursor and lets its own frame die.
   */
  const cursorHelpers =
    "export let advance(source: Seq((Int, Int)), count: Int): Seq((Int, Int)) =\n" +
    "    var current = source\n" +
    "    var remaining = count\n" +
    "    var running = True\n" +
    "    while running\n" +
    "        if remaining <= 0 then\n" +
    "            running := False\n" +
    "        else\n" +
    "            match Seq.next(current)\n" +
    "                None => running := False\n" +
    "                Some((_, rest)) =>\n" +
    "                    current := rest\n" +
    "                    remaining := remaining - 1\n" +
    "    current\n" +
    "\n" +
    "export let elementAt(source: Seq((Int, Int)), index: Int): (Int, Int) =\n" +
    "    match Seq.next(advance(source, index))\n" +
    "        None => (0, 0)\n" +
    "        Some((value, _)) => value\n" +
    "\n" +
    "export let headTag(source: Seq((Int, Int))): Int =\n" +
    "    match Seq.next(source)\n" +
    "        None => 0\n" +
    "        Some((value, _)) =>\n" +
    "            let (tag, _) = value\n" +
    "            tag\n";

  /**
   * The prefix positions sampled, as zero-based indices — the very head, its
   * successor, and two further in — so that what the tests pin is a *prefix*
   * being reclaimed and not one lucky position. All four are behind the cursor
   * `walk` stops at.
   */
  const sampled = [0, 1, 40, 100] as const;

  interface Walked {
    /** The `sampled` positions' elements, held only weakly. */
    readonly elements: readonly WeakRef<object>[];
    /** The advanced cursor, the one position the test still holds. */
    readonly cursor: unknown;
  }

  /**
   * Forces `steps` positions of `build(200)` and keeps the cursor, dropping
   * every other reference inside a frame that then dies.
   */
  function walk(exports: Record<string, unknown>, steps: number): Walked {
    const build = exports["build"] as (count: number) => unknown;
    const advance = exports["advance"] as (source: unknown, count: number) => unknown;
    const elementAt = exports["elementAt"] as (source: unknown, index: number) => object;
    let cursor: unknown;
    // The head, and every element handed back by `elementAt`, are named only
    // inside this arrow — so once it returns, no local and no temporary of the
    // enclosing scope is still holding any of them.
    const elements = ((): readonly WeakRef<object>[] => {
      const head = build(200);
      const weak = sampled.map((index) => new WeakRef(elementAt(head, index)));
      cursor = advance(head, steps);
      return weak;
    })();
    return { elements, cursor };
  }

  /** Every sampled position, by index, whose element is still reachable. */
  function alive(elements: readonly WeakRef<object>[]): readonly number[] {
    return sampled.filter((_index, at) => elements[at]!.deref() !== undefined);
  }

  async function collectTwice(): Promise<void> {
    // A turn of the event loop first: the frames above have to be gone, not
    // merely unreachable from source.
    await yieldToEventLoop();
    await collectGarbage();
    await collectGarbage();
  }

  test("an inbound adapter's prefix is collected once the cursor has passed it", async () => {
    const exports = await run(
      [["/main.hex",
        "extern from \"boxes\"\n" +
        "    fun boxes(count: Int): Seq((Int, Int))\n" +
        "\n" +
        "export let build(count: Int): Seq((Int, Int)) = boxes(count)\n" +
        "\n" + cursorHelpers]],
      {
        boxes: [
          "export function boxes(count) {",
          "  return { *[Symbol.iterator]() {",
          "    for (let i = 1; i <= count; i += 1) yield [i, i];",
          "  } };",
          "}",
        ].join("\n"),
      },
    );
    const { elements, cursor } = walk(exports, 150);
    expect(alive(elements)).toEqual([...sampled]);
    await collectTwice();
    expect(alive(elements)).toEqual([]);
    // And the cursor is unharmed by the collection — §5 reclaims the prefix, not
    // the suffix reachable from the position still held.
    expect((exports["headTag"] as (source: unknown) => number)(cursor)).toBe(151);
  });

  test("a `Seq.memoize` prefix is collected too", async () => {
    // #131's reason for urgency: `Seq.memoize` (Loops §6.4) lowers to this same
    // spine, so a pure Hexagon program that never touches the FFI inherits
    // whatever §5's representation costs. The source re-derives rather than
    // stores, so the memo is the only thing that could hold the sampled
    // elements — see the block comment on why that qualifier is here.
    const exports = await main(
      "export let build(count: Int): Seq((Int, Int)) =\n" +
      "    Seq.memoize(Seq.map(Seq.take(Seq.iterate(1, i => i + 1), count), i => (i, i)))\n" +
      "\n" + cursorHelpers,
    );
    const { elements, cursor } = walk(exports, 150);
    expect(alive(elements)).toEqual([...sampled]);
    await collectTwice();
    expect(alive(elements)).toEqual([]);
    expect((exports["headTag"] as (source: unknown) => number)(cursor)).toBe(151);
  });
});

describe("forcing is not reentrant (FFI Part 3 §7.3)", () => {
  /**
   * The #123 ruling, 2026-08-02. A forcing that asks the same spine for the
   * position it is computing is asking for the value it is in the middle of
   * producing; §7.3 makes that a `TypeError`, observed in Hexagon through
   * `JsError`, and leaves everything else about the traversal alone.
   *
   * **The shape is an ordinary program, not a contrived one**, which is what
   * the issue got wrong when it recorded this as unreachable from the harness
   * ("its data-URL modules cannot be circular"). No circular import is needed:
   * a third module — here, the test — hands the `Seq` to the foreign module
   * that the sequence's own derivation calls. `main.hex` never names the value
   * inside its own definition, so `let`'s non-recursiveness is not in the way.
   *
   * What that program did before the ruling is the reason for it: the reentrant
   * traversal and the enclosing one each advanced the source for the same
   * position, and one element vanished with no error anywhere — a `Vector`
   * silently one short. Both traversals then agreed on the wrong answer, which
   * is why no existing test could see it.
   *
   * The uniformity claim is checked, not asserted (last test): a `seqToIterable`
   * generator already made JavaScript refuse the reentrant advance, so the spec
   * is conforming one case to the platform rather than inventing a failure mode.
   */

  /**
   * A sequence whose source can call back into the program that holds it.
   *
   * `armIt` is how the foreign module gets the `Seq` — the caller supplies it,
   * so there is no self-reference and no import cycle. `drained` forces the
   * whole sequence through the internal channel, which is what a Hexagon
   * program does with it.
   */
  const selfObserving =
    "extern from \"probe\"\n" +
    "    fun source(): Seq(Int)\n" +
    "    fun setSeq(held: Seq(Int)): Unit\n" +
    "    fun outcome(): String\n" +
    "\n" +
    "let shared: Seq(Int) = source()\n" +
    "\n" +
    "export let armIt(ignored: Int): Unit = setSeq(shared)\n" +
    "export let drained(ignored: Int): Vector(Int) = Vector.fromSeq(shared)\n" +
    "export let handOut(ignored: Int): Seq(Int) = shared\n" +
    "export let reentry(ignored: Int): String = outcome()\n";

  /**
   * The foreign side. `reenter` is spliced in per test: it runs inside `next()`
   * for the nominated call, and records what it observed.
   */
  function probeModule(sourceBody: string, reenterBody: string): string {
    return [
      "let held; let outcome = 'not reached'; let calls = 0;",
      "export function setSeq(value) { held = value; return undefined; }",
      "export function outcome_() { return outcome; }",
      "export { outcome_ as outcome };",
      "function record(fn) {",
      "  try { outcome = 'OK:' + JSON.stringify(fn()); }",
      "  catch (error) { outcome = 'ERR:' + error.constructor.name + ':' + error.message; }",
      "}",
      reenterBody,
      sourceBody,
    ].join("\n");
  }

  /** A plain-object iterator: `next()` is an ordinary function, not a generator. */
  const plainSource = [
    "export function source() {",
    "  return { [Symbol.iterator]() { return { next() {",
    "    calls += 1;",
    "    const mine = calls;",
    "    reenter(mine);",
    "    return mine <= 4 ? { done: false, value: mine * 10 } : { done: true };",
    "  } }; } };",
    "}",
  ].join("\n");

  /** The same source as a generator, for the uniformity check. */
  const generatorSource = [
    "export function source() {",
    "  return { *[Symbol.iterator]() {",
    "    for (let index = 1; index <= 4; index += 1) { calls += 1; reenter(calls); yield index * 10; }",
    "  } };",
    "}",
  ].join("\n");

  async function armed(
    sourceBody: string,
    reenterBody: string,
  ): Promise<{
    drained: () => number[];
    reentry: () => string;
    handOut: () => Iterable<number>;
  }> {
    const exports = await run(
      [["/main.hex", selfObserving]],
      { probe: probeModule(sourceBody, reenterBody) },
    );
    (exports["armIt"] as (ignored: number) => void)(0);
    return {
      drained: () => (exports["drained"] as (ignored: number) => number[])(0),
      reentry: () => (exports["reentry"] as (ignored: number) => string)(0),
      handOut: () => (exports["handOut"] as (ignored: number) => Iterable<number>)(0),
    };
  }

  /** Re-traverse the whole sequence from within `next()` for call `at`. */
  function retraverseAt(at: number, swallow = true): string {
    const body = "record(() => Array.from(held));";
    return [
      "function reenter(call) {",
      `  if (call !== ${at}) return;`,
      swallow ? `  ${body}` : "  Array.from(held);",
      "}",
    ].join("\n");
  }

  test("re-forcing the position being forced fails, and costs the traversal nothing", async () => {
    const { drained, reentry } = await armed(plainSource, retraverseAt(1));
    // The headline. Before the ruling this was `[20, 30, 40]` — the reentrant
    // traversal had consumed the element the enclosing forcing was fetching, and
    // both traversals returned the short answer with no error raised anywhere.
    expect(drained()).toEqual([10, 20, 30, 40]);
    expect(reentry()).toBe(
      "ERR:TypeError:Seq position is already being forced: " +
      "a sequence position cannot depend on its own value",
    );
    // Replay agrees with the first traversal, so nothing was patched over.
    expect(drained()).toEqual([10, 20, 30, 40]);
  });

  test("reading an already-forced position from inside a forcing replays it", async () => {
    // §7.3's carve-out, and the reason the flag guards the forcing step rather
    // than `pull`: a foreign source that looks back at elements it has already
    // produced is doing nothing cyclic, and must keep working.
    const { drained, reentry } = await armed(plainSource, [
      "function reenter(call) {",
      "  if (call !== 3) return;",
      "  record(() => held[Symbol.iterator]().next().value);",
      "}",
    ].join("\n"));
    expect(drained()).toEqual([10, 20, 30, 40]);
    expect(reentry()).toBe("OK:10");
  });

  test("a reentrant throw the source does not catch is that position's failure", async () => {
    // §7.1 applies to it like any other throw out of `next()` — the enclosing
    // forcing did not survive its own source, so the position failed. The point
    // of the test is *which* position: the throw must not have been memoized by
    // the reentrant pull, or the failure would sit on the node before this one.
    const { drained, reentry } = await armed(plainSource, retraverseAt(1, false));
    for (const _attempt of [0, 1]) {
      expect(drained).toThrowError(/already being forced/u);
    }
    expect(reentry()).toBe("not reached");
  });

  test("a swallowed refusal still ends the value's JavaScript face, and says so", async () => {
    // §7.3's memoization clause, and the finding that made it explicit.
    // JavaScript's only route back into a `Seq` is the §9.4 face, so the
    // reentrant traversal runs through a *second* spine — the boundary view —
    // and the refusal reaches it as a throw out of its own source, which §7.1
    // memoizes there. The Hexagon side is untouched; the value's foreign face
    // is finished, and every later traversal says why rather than going quiet.
    const { drained, handOut } = await armed(plainSource, retraverseAt(1));
    expect(drained()).toEqual([10, 20, 30, 40]);
    const face = handOut();
    for (const _attempt of [0, 1]) {
      // The assertion that matters is not that it throws but that it never
      // *silently* answers: declining to memoize the refusal here — the obvious
      // repair — leaves the view's generator completed, so the next forcing
      // reads `done` off a dead generator and the value becomes an empty
      // sequence to JavaScript. That was measured; this pins the alternative.
      expect(() => [...face]).toThrowError(/already being forced/u);
    }
  });

  test("reentry from `[Symbol.iterator]()` is refused too", async () => {
    // §7.3 names acquisition among the reentry sites, because §3 defers it to
    // the first pull — so it runs inside a forcing like anything else. The
    // check precedes acquisition for that reason.
    const { drained, reentry } = await armed([
      "export function source() {",
      "  return { [Symbol.iterator]() {",
      "    reenter(1);",
      "    return { next() {",
      "      calls += 1;",
      "      const mine = calls;",
      "      return mine <= 3 ? { done: false, value: mine * 10 } : { done: true };",
      "    } };",
      "  } };",
      "}",
    ].join("\n"), [
      "function reenter(call) {",
      "  if (call !== 1) return;",
      "  record(() => Array.from(held));",
      "}",
    ].join("\n"));
    expect(drained()).toEqual([10, 20, 30]);
    expect(reentry()).toBe(
      "ERR:TypeError:Seq position is already being forced: " +
      "a sequence position cannot depend on its own value",
    );
  });

  test("a generator source behaves identically, which is the point", async () => {
    // JavaScript already refuses this for a generator — `TypeError: Generator is
    // already running` — and every internal spine (`Seq.memoize`, the §9.4
    // boundary view) is driven by one. The ruling conforms the remaining case,
    // so the two now fail the same way and with the same message.
    const { drained, reentry } = await armed(generatorSource, retraverseAt(1));
    expect(drained()).toEqual([10, 20, 30, 40]);
    expect(reentry()).toBe(
      "ERR:TypeError:Seq position is already being forced: " +
      "a sequence position cannot depend on its own value",
    );
  });
});
