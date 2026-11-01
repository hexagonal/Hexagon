import { describe, expect, test } from "vitest";

import { compileFiles, runProject } from "../support/test-project.js";

/**
 * Conformance for **the local a synthesized prelude import binds under** —
 * #816; Method Syntax §8.1, Dictionary Sharing §5 and §8, Lexer §3.2.
 *
 * The resolver writes a prelude term's import before type checking, so a dot
 * call registers *every* prelude function of its name as a candidate, and each
 * candidate claims a spelling in prelude order: `b.pow(e)` at `BigInt` reaches
 * `BigInt.pow` behind `Pow.pow` and `Float.pow`. The emitter drops the
 * candidates the checker did not choose, so they hold nothing in the emitted
 * file, and the one that survives binds under its own name unless something
 * really there holds it: a binding of the module's, anywhere in the file; an
 * explicit import; an honored member; a routed seat; or a second referenced
 * import of the same spelling.
 *
 * Each claim is pinned twice — on the emitted text, which is the doctrine's
 * whole content (what a person would have written), and on the run, which is
 * what says an alias that *was* kept still reaches the right function.
 */

type Files = readonly (readonly [string, string])[];

function mainFile(body: string): readonly [string, string] {
  return ["/main.hex", "module Main\n\n" + body];
}

/** `/main.hex`'s emitted JavaScript, with the project asserted clean. */
function emitted(files: Files): string {
  const project = compileFiles(files);
  expect(project.diagnostics.map(({ message }) => message)).toEqual([]);
  return project.modules.find(({ source }) => source.path === "/main.hex")!.javascript.text;
}

function emittedMain(body: string): string {
  return emitted([mainFile(body)]);
}

/** The `import` lines of an emitted module, in order. */
function importLines(javascript: string): readonly string[] {
  return javascript.split("\n").filter((line) => line.startsWith("import "));
}

describe("a dot call binds its import under the function's own name (§8.1)", () => {
  const bigints = "let b: BigInt = 2n\nlet e: BigInt = 10n\n";

  test("a lone `b.pow(e)` emits exactly what `BigInt.pow(b, e)` emits", async () => {
    // `Pow.pow` and `Float.pow` were candidates for the dot and were dropped;
    // they contest nothing, so the door is `pow`, not `__prelude_pow_1`.
    const dot = emittedMain(bigints + "export let x: BigInt = b.pow(e)\n");
    const qualified = emittedMain(bigints + "export let x: BigInt = BigInt.pow(b, e)\n");

    expect(importLines(dot)).toEqual(['import { pow } from "./Hex/BigInt.js";']);
    expect(dot).toContain("const x = pow(b, e);");
    expect(dot).not.toContain("__prelude_");
    expect(dot).toBe(qualified);
    const exports = await runProject([mainFile(bigints + "export let x: BigInt = b.pow(e)\n")]);
    expect(exports["x"]).toBe(1024n);
  });

  test("both spellings in one module share the plain name", async () => {
    const source = bigints +
      "export let x: BigInt = b.pow(e)\nexport let y: BigInt = BigInt.pow(b, e)\n";
    const javascript = emittedMain(source);

    expect(importLines(javascript)).toEqual(['import { pow } from "./Hex/BigInt.js";']);
    expect(javascript).toContain("const x = pow(b, e);");
    expect(javascript).toContain("const y = pow(b, e);");
    const exports = await runProject([mainFile(source)]);
    expect([exports["x"], exports["y"]]).toEqual([1024n, 1024n]);
  });

  test("`v.length()` on a `Vector` binds `length`", async () => {
    const source = "let v: Vector(Int) = [1, 2, 3]\nexport let n: Int = v.length()\n";
    const javascript = emittedMain(source);

    expect(javascript).toContain('import { length } from "./Hex/Vector.js";');
    expect(javascript).toContain("const n = length(v);");
    expect(javascript).not.toContain("__prelude_");
    expect((await runProject([mainFile(source)]))["n"]).toBe(3);
  });

  test("`t.length()` on a `String` binds `length`", async () => {
    const source = "let t: String = \"abcd\"\nexport let n: Int = t.length()\n";
    const javascript = emittedMain(source);

    expect(importLines(javascript)).toEqual(['import { length } from "./Hex/String.js";']);
    expect(javascript).toContain("const n = length(t);");
    expect((await runProject([mainFile(source)]))["n"]).toBe(4);
  });

  test("`o.map(f)` on an `Option` binds `map`", async () => {
    const source = "let o: Option(Int) = Some(1)\n" +
      "export let p: Int = Option.defaultValue(o.map((x: Int) => x + 1), 0)\n";
    const javascript = emittedMain(source);

    expect(javascript).toMatch(/^import \{ defaultValue, map \} from "\.\/Hex\/Option\.js";$/mu);
    expect(javascript).toContain("defaultValue(map(o, x => x + 1), 0)");
    expect(javascript).not.toContain("__prelude_");
    expect((await runProject([mainFile(source)]))["p"]).toBe(2);
  });
});

describe("a real holder of the name keeps the alias", () => {
  test("a module's own `let pow` keeps the door aliased, and both still run", async () => {
    const source = "let pow(a: Int, b: Int): Int = a * b\n" +
      "let base: BigInt = 2n\n" +
      "export let x: BigInt = base.pow(3n)\n" +
      "export let z: Int = pow(2, 5)\n";
    const javascript = emittedMain(source);

    expect(javascript).toMatch(/^import \{ pow as (__prelude_pow\w*) \} from "\.\/Hex\/BigInt\.js";$/mu);
    expect(javascript).toContain("const pow = (a, b) => a * b;");
    expect(javascript).toMatch(/const x = __prelude_pow\w*\(base, 3n\);/u);
    const exports = await runProject([mainFile(source)]);
    expect([exports["x"], exports["z"]]).toEqual([8n, 10]);
  });

  test("a parameter of the name anywhere in the file keeps the alias too", async () => {
    // The safety margin, deliberately: a module-scope `pow` would be shadowed
    // inside `twice`, so the import stays out of its way.
    const source = "export let twice(pow: Int): Int = pow + pow\n" +
      "let base: BigInt = 2n\n" +
      "export let x: BigInt = base.pow(3n)\n";
    const javascript = emittedMain(source);

    expect(javascript).toMatch(/^import \{ pow as __prelude_pow\w* \} from "\.\/Hex\/BigInt\.js";$/mu);
    expect((await runProject([mainFile(source)]))["x"]).toBe(8n);
  });

  test("`Option.map` beside `Result.map` stays split, one plain and one aliased", async () => {
    const source = "let o: Option(Int) = Some(1)\n" +
      "let r: Result(Int, String) = Ok(2)\n" +
      "export let p: Int = Option.defaultValue(Option.map(o, (x: Int) => x + 1), 0)\n" +
      "export let q: Int = Result.defaultValue(Result.map(r, (x: Int) => x * 10), 0)\n";
    const javascript = emittedMain(source);

    expect(javascript).toMatch(/^import \{ defaultValue, map \} from "\.\/Hex\/Option\.js";$/mu);
    expect(javascript).toMatch(
      /^import \{ defaultValue as __prelude_defaultValue, map as __prelude_map \} from "\.\/Hex\/Result\.js";$/mu,
    );
    const exports = await runProject([mainFile(source)]);
    expect([exports["p"], exports["q"]]).toEqual([2, 20]);
  });

  describe("a dot call beside a second prelude function of its name emits its hand-written call", () => {
    // The pairs differ only in spelling one call as a dot; §8.1 makes their
    // emitted modules one text. Each module names `map` or `length` from two
    // prelude modules, so one of each pair is a real contestant and takes the
    // probe — the later one by first use, as the hand-written module has it.
    const options = "let o: Option(Int) = Some(1)\nlet r: Result(Int, String) = Ok(2)\n";
    const lengths = "let v: Vector(Int) = [1, 2]\nlet t: String = \"abc\"\n";
    const pairs: readonly {
      readonly name: string;
      readonly dot: string;
      readonly written: string;
      readonly exports: Readonly<Record<string, unknown>>;
    }[] = [
      {
        name: "`o.map(f)` beside `Result.map(r, g)`",
        dot: options +
          "export let p: Int = Option.defaultValue(o.map((x: Int) => x + 1), 0)\n" +
          "export let q: Int = Result.defaultValue(Result.map(r, (x: Int) => x * 10), 0)\n",
        written: options +
          "export let p: Int = Option.defaultValue(Option.map(o, (x: Int) => x + 1), 0)\n" +
          "export let q: Int = Result.defaultValue(Result.map(r, (x: Int) => x * 10), 0)\n",
        exports: { p: 2, q: 20 },
      },
      {
        name: "`t.length()` beside `Vector.length(v)`",
        dot: lengths + "export let n: Int = Vector.length(v) + t.length()\n",
        written: lengths + "export let n: Int = Vector.length(v) + String.length(t)\n",
        exports: { n: 5 },
      },
      {
        // First use decides, not prelude order: the dot registers `Vector.length`
        // ahead of `String.length`, and neither placing may survive the drop.
        name: "`t.length()` before `Vector.length(v)`",
        dot: lengths + "export let n: Int = t.length() + Vector.length(v)\n",
        written: lengths + "export let n: Int = String.length(t) + Vector.length(v)\n",
        exports: { n: 5 },
      },
      {
        name: "four dot calls, two of each name",
        dot: options + lengths +
          "export let p: Int = Option.defaultValue(o.map((x: Int) => x + 1), 0)\n" +
          "export let q: Int = Result.defaultValue(r.map((x: Int) => x * 10), 0)\n" +
          "export let n: Int = v.length() + t.length()\n",
        written: options + lengths +
          "export let p: Int = Option.defaultValue(Option.map(o, (x: Int) => x + 1), 0)\n" +
          "export let q: Int = Result.defaultValue(Result.map(r, (x: Int) => x * 10), 0)\n" +
          "export let n: Int = Vector.length(v) + String.length(t)\n",
        exports: { p: 2, q: 20, n: 5 },
      },
    ];

    for (const { name, dot, written, exports } of pairs) {
      test(name, async () => {
        expect(emittedMain(dot)).toBe(emittedMain(written));
        const ran = await runProject([mainFile(dot)]);
        for (const [key, value] of Object.entries(exports)) expect(ran[key]).toBe(value);
      });
    }

    test("the first use keeps the name and the second takes the probe", () => {
      const javascript = emittedMain(pairs.find(({ name }) => name.startsWith("four"))!.dot);

      expect(javascript).toMatch(/^import \{ defaultValue, map \} from "\.\/Hex\/Option\.js";$/mu);
      expect(javascript).toMatch(
        /^import \{ defaultValue as __prelude_defaultValue, map as __prelude_map \} from "\.\/Hex\/Result\.js";$/mu,
      );
      expect(javascript).toContain('import { length } from "./Hex/Vector.js";');
      expect(javascript).toContain('import { length as __prelude_length } from "./Hex/String.js";');
      expect(javascript).toContain("const n = length(v) + __prelude_length(t);");
    });
  });

  test("a namespace import of the name keeps the alias", async () => {
    // `import JsError` binds `JsError` at module level; the prelude's exception
    // constructor, reached bare, steps around it.
    const files: Files = [
      ["/jserror.hex", "module JsError\n\nexport fun answer(): Int = 42\n"],
      mainFile(
        "import JsError\n" +
          "export fun f(v: JsValue): Exn = JsError(v)\n" +
          "export let n: Int = JsError.answer()\n",
      ),
    ];
    const javascript = emitted(files);

    expect(javascript).toContain('import * as JsError from "./JsError.js";');
    expect(javascript).toMatch(/^import \{ JsError as __prelude_JsError \} from "\.\/Hex\/JsError\.js";$/mu);
    const exports = await runProject(files);
    expect(exports["n"]).toBe(42);
    expect(typeof exports["f"]).toBe("function");
  });

  test("a pinned `Bool` constructor is a literal and imports nothing", async () => {
    // It is referenced, but #147 emits it as `true`, so it neither earns an
    // import line nor takes a name from a term that does.
    const source = "let t: String = \"ab\"\nexport let yes: Bool = True\nexport let n: Int = t.length()\n";
    const javascript = emittedMain(source);

    expect(importLines(javascript)).toEqual(['import { length } from "./Hex/String.js";']);
    expect(javascript).toContain("const yes = true;");
    const exports = await runProject([mainFile(source)]);
    expect([exports["yes"], exports["n"]]).toEqual([true, 2]);
  });

  test("a runtime-vocabulary name never binds bare", async () => {
    // FFI Part 7 §1.2 rule 1: `Nullable.undefined` is minted aside, whatever
    // else holds the spelling.
    const source = "export let missing(): Nullable(String) = Nullable.undefined\n";
    const javascript = emittedMain(source);

    expect(javascript).not.toMatch(/^import \{[^}]*\bundefined\b(?! as)/mu);
    expect(javascript).toMatch(/^import \{[^}]*\bundefined as __\w+/mu);
    const exports = await runProject([mainFile(source)]);
    expect((exports["missing"] as () => unknown)()).toBe(undefined);
  });

  test("an honored member of the name holds nothing, so the import stays plain", async () => {
    // The member is emitted under its seat's generated name,
    // `__Lengthy_Gauge_length`, and the module binds no `length` of its own,
    // so nothing in the emitted JavaScript collides with the `String` import.
    const files: Files = [
      ["/lengthy.hex", "module Lengthy\n\nexport constraint Lengthy<a> =\n    length(value: a) -> Int\n"],
      mainFile(
        "import Lengthy\n\n" +
          "export record Gauge = {n: Int}\n" +
          "honor Lengthy<Gauge> =\n    length(g) = g.n\n" +
          "let t: String = \"abc\"\n" +
          "export let n: Int = t.length()\n" +
          "export let m: Int = Lengthy.length(Gauge({n = 4}))\n",
      ),
    ];
    const javascript = emitted(files);

    expect(javascript).toContain('import { length } from "./Hex/String.js";');
    expect(javascript).toContain("const n = length(t);");
    expect(javascript).toContain("const m = __Lengthy_Gauge_length({ n: 4 });");
    expect(javascript).not.toMatch(/\b(?:const|let|function) length\b/u);
    const exports = await runProject(files);
    expect([exports["n"], exports["m"]]).toEqual([3, 4]);
  });

  describe("a prelude import of the name contests a routed seat (Dictionary Sharing §8)", () => {
    // The import keeps the name and the seat binds under its generated
    // spelling, whichever way the prelude call is written.
    test("`b.pow(3n)` beside `i.pow(2)`", async () => {
      const source = "let i: Int = 3\nlet b: BigInt = 2n\n" +
        "export let s: Int = i.pow(2)\nexport let x: BigInt = b.pow(3n)\n";
      const javascript = emittedMain(source);

      expect(javascript).toContain('import { pow } from "./Hex/BigInt.js";');
      expect(javascript).toContain('import { __Pow_Int_pow } from "./Hex/Int.js";');
      expect(javascript).toContain("const s = __Pow_Int_pow(i, 2);");
      expect(javascript).toContain("const x = pow(b, 3n);");
      expect(javascript).toBe(emittedMain(
        "let i: Int = 3\nlet b: BigInt = 2n\n" +
          "export let s: Int = i.pow(2)\nexport let x: BigInt = BigInt.pow(b, 3n)\n",
      ));
      const exports = await runProject([mainFile(source)]);
      expect([exports["s"], exports["x"]]).toEqual([9, 8n]);
    });

    test("`BigInt.pow(b, 3n)` beside `i.pow(2)` emits main's text", async () => {
      const source = "let i: Int = 3\nlet b: BigInt = 2n\n" +
        "export let x: BigInt = BigInt.pow(b, 3n)\nexport let s: Int = i.pow(2)\n";
      const javascript = emittedMain(source);

      expect(importLines(javascript)).toEqual([
        'import { pow } from "./Hex/BigInt.js";',
        'import { __Pow_Int_pow } from "./Hex/Int.js";',
      ]);
      expect(javascript).toContain("const x = pow(b, 3n);");
      expect(javascript).toContain("const s = __Pow_Int_pow(i, 2);");
      const exports = await runProject([mainFile(source)]);
      expect([exports["x"], exports["s"]]).toEqual([8n, 9]);
    });

    test("`Float.pow(f, 0.5)` beside `i.pow(2)` emits main's text", async () => {
      const source = "let i: Int = 3\nlet f: Float = 4.0\n" +
        "export let r: Float = Float.pow(f, 0.5)\nexport let s: Int = i.pow(2)\n";
      const javascript = emittedMain(source);

      expect(importLines(javascript)).toEqual([
        'import { pow } from "./Hex/Float.js";',
        'import { __Pow_Int_pow } from "./Hex/Int.js";',
      ]);
      expect(javascript).toContain("const r = pow(f, 0.5);");
      expect(javascript).toContain("const s = __Pow_Int_pow(i, 2);");
      const exports = await runProject([mainFile(source)]);
      expect([exports["r"], exports["s"]]).toEqual([2, 9]);
    });
  });
});
