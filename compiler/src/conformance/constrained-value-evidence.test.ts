import { describe, expect, test } from "vitest";

import { compileProject, Source } from "../index";

/**
 * A crossed `Vector(a)` as a plain array.
 *
 * Readouts that land in a `Vector` go through this since the trie wiring: a
 * `Vector(a)` is a `TrieVector` record, not a JavaScript array. The subject of
 * these tests is unchanged; spreading is what the `Hex.Vector<a> extends
 * Iterable<a>` face promises a consumer can do, so the readout is now also a
 * live check of that contract.
 */
function elements(value: unknown): unknown[] {
  return [...(value as Iterable<unknown>)];
}

/**
 * Conformance for evidence on a constrained generic function used as a **value**
 * (`spec/notes/compiler-conformance-defects.md` defect 4).
 *
 * A function generic over a constraint compiles to one that takes a trailing
 * evidence dictionary (Constraints §6.1; FFI Part 9 fixes the ABI). Call sites
 * at a known type supply it. A *value* reference had nowhere to put it, so the
 * dictionary parameter stayed `undefined` and the first operation through it
 * crashed — after a clean compile:
 *
 * ```
 * let plus(a, b) = a + b
 * let apply(f: (Int, Int) -> Int): Int = f(1, 2)
 * export let out: Int = apply(plus)     // TypeError: reading 'add' of undefined
 * ```
 *
 * Every test here **executes** the emitted module. The defect's whole character
 * is that the diagnostic channel says nothing, so a test that only reads
 * diagnostics would pass against the broken compiler.
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

/** Compiles a project and executes it, returning `/main.hex`'s exports. */
async function run(
  files: readonly (readonly [string, string])[],
): Promise<Record<string, unknown>> {
  const project = compileProject(
    files.map(([path, text], index) => new Source.File(Source.fileId(index), path, text)),
  );
  expect(project.diagnostics).toEqual([]);
  const moduleUrls = new Map<string, string>();
  for (const module of project.modules) {
    const linked = link(module.javascript.text, module.source.path, moduleUrls);
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

describe("a constrained function carries its evidence into value position", () => {
  test("passed as an argument", async () => {
    const exports = await main(
      "let plus(a, b) = a + b\n" +
      "let apply(f: (Int, Int) -> Int): Int = f(1, 2)\n" +
      "export let out: Int = apply(plus)\n",
    );
    expect(exports["out"]).toBe(3);
  });

  test("bound to an annotated `let`", async () => {
    const exports = await main(
      "let plus(a, b) = a + b\n" +
      "let chosen: (Int, Int) -> Int = plus\n" +
      "export let out: Int = chosen(1, 2)\n",
    );
    expect(exports["out"]).toBe(3);
  });

  test("returned from a function", async () => {
    const exports = await main(
      "let plus(a, b) = a + b\n" +
      "let pick(): (Int, Int) -> Int = plus\n" +
      "export let out: Int = pick()(1, 2)\n",
    );
    expect(exports["out"]).toBe(3);
  });

  test("stored in a collection", async () => {
    const exports = await main(
      "let plus(a, b) = a + b\n" +
      "let operations: Vector((Int, Int) -> Int) = [plus]\n" +
      "export let out: Int = Vector.at(operations, 1)(4, 5)\n",
    );
    expect(exports["out"]).toBe(9);
  });

  test("with one parameter, and a constraint reached through a superconstraint", async () => {
    // `negate` needs `Signed`, whose evidence carries `Num` beneath it — the
    // nested-dictionary path, not just a flat primitive instance.
    const exports = await main(
      "let negate(a) = 0 - a\n" +
      "let apply(f: Int -> Int): Int = f(5)\n" +
      "export let out: Int = apply(negate)\n",
    );
    expect(exports["out"]).toBe(-5);
  });

  test("through a Seq pipeline", async () => {
    // Ordinary user code only since `Seq.map` stopped being a compiler
    // intrinsic: before the unification this shape could not be written.
    const exports = await main(
      "let double(x) = x + x\n" +
      "export let out: Vector(Int) = Vector.fromSeq(Seq.map(Vector.toSeq([1, 2, 3]), double))\n",
    );
    expect(elements(exports["out"])).toEqual([2, 4, 6]);
  });

  test("at two different types from two value positions", async () => {
    // Each reference instantiates the scheme separately, so each must capture
    // *its own* evidence — one shared wrapper would be wrong.
    const exports = await main(
      "let plus(a, b) = a + b\n" +
      "let applyInt(f: (Int, Int) -> Int): Int = f(1, 2)\n" +
      "let applyFloat(f: (Float, Float) -> Float): Float = f(1.5, 2.25)\n" +
      "export let whole: Int = applyInt(plus)\n" +
      "export let fractional: Float = applyFloat(plus)\n",
    );
    expect(exports["whole"]).toBe(3);
    expect(exports["fractional"]).toBe(3.75);
  });

  test("imported from another module", async () => {
    const exports = await run([
      ["/lib.hex", "export let plus<a: Num>(left: a, right: a): a = left + right\n"],
      ["/main.hex",
        "import { plus } from \"./lib\"\n" +
        "let apply(f: (Int, Int) -> Int): Int = f(1, 2)\n" +
        "export let out: Int = apply(plus)\n"],
    ]);
    expect(exports["out"]).toBe(3);
  });
});

describe("one argument per scheme constraint (defect 16)", () => {
  /**
   * Found while fixing defect 4 and independent of it — this shape is a plain
   * *call*, no value position anywhere. Instantiating a scheme yields every
   * requirement the body accumulated, `Num` included when the body also needed
   * `Signed`; the definition declares a parameter only for the maximal ones, so
   * the extra dictionary shifted into the wrong slot and crashed. FFI Part 9 §13:
   * maximal constraints per variable, the same rule internally and publicly.
   */

  test("a direct call supplies only the maximal constraint", async () => {
    const exports = await main(
      "let negate(a) = 0 - a\n" +
      "export let out: Int = negate(5)\n",
    );
    expect(exports["out"]).toBe(-5);
  });

  test("the annotated equivalent behaves identically", async () => {
    // Its scheme names `Signed` outright, so it never had the extra requirement.
    // Pinned as the control: the two spellings must agree.
    const exports = await main(
      "let negate<a: Signed>(x: a): a = 0 - x\n" +
      "export let out: Int = negate(5)\n",
    );
    expect(exports["out"]).toBe(-5);
  });

  test("a projection from an enclosing dictionary is still passed", async () => {
    // The case the first attempt at this filter broke. `Same` is reached as a
    // *slot* of the enclosing `Labeled` dictionary — it carries another
    // constraint's name, like a redundant sibling does, but it is the callee's
    // one real argument. Elimination is decided among siblings, not per
    // requirement.
    const exports = await main(
      "constraint Same<a> =\n" +
      "    same(left: a, right: a): Bool\n" +
      "constraint Labeled<a: Same> =\n" +
      "    label(value: a): String\n" +
      "record Token = {value: Int}\n" +
      "honor Same<Token> =\n" +
      "    same(left, right) = left.value == right.value\n" +
      "honor Labeled<Token> =\n" +
      "    label(value) = \"token\"\n" +
      "fun agrees<a: Labeled>(left: a, right: a): Bool = same(left, right)\n" +
      "export let yes: Bool = agrees(Token({value = 1}), Token({value = 1}))\n" +
      "export let no: Bool = agrees(Token({value = 1}), Token({value = 2}))\n",
    );
    expect(exports["yes"]).toBe(true);
    expect(exports["no"]).toBe(false);
  });
});

describe("what must not change", () => {
  test("a direct call still passes evidence at the call site, not through a wrapper", async () => {
    const exports = await main(
      "let plus(a, b) = a + b\n" +
      "export let whole: Int = plus(1, 2)\n" +
      "export let fractional: Float = plus(1.5, 2.5)\n",
    );
    expect(exports["whole"]).toBe(3);
    expect(exports["fractional"]).toBe(4);
  });

  test("an unconstrained function in value position is passed by identity", () => {
    // The wrapper must be reserved for references that actually carry evidence:
    // wrapping every value reference would break function identity and cost an
    // allocation per mention.
    const project = compileProject([
      new Source.File(Source.fileId(0), "/main.hex",
        "let identity(value: Int): Int = value\n" +
        "let apply(f: Int -> Int): Int = f(1)\n" +
        "export let out: Int = apply(identity)\n"),
    ]);
    expect(project.diagnostics).toEqual([]);
    const javascript = project.modules
      .find((module) => module.source.path === "/main.hex")!.javascript.text;
    expect(javascript).toContain("const out = apply(identity);");
  });

  test("an annotated monomorphic function needs no evidence at all", async () => {
    const exports = await main(
      "let plus(a: Int, b: Int): Int = a + b\n" +
      "let apply(f: (Int, Int) -> Int): Int = f(1, 2)\n" +
      "export let out: Int = apply(plus)\n",
    );
    expect(exports["out"]).toBe(3);
  });
});
