/**
 * Conformance for `stdlib/Debug.hex` — the probe `spec/effects.md` §6.2 admits
 * as **species (a)**, an unobservable world-write, declared through the
 * intrinsic door (`spec/intrinsics.md` §3.2).
 *
 * The interesting content is all runtime. A pure face over a console write is
 * only honest if the write really is unreadable from Hexagon, and §6.2 makes
 * that conditional on one property of the emitted code: the sink is captured
 * when the module initializes, never dereferenced per call. `console.log` is a
 * replaceable global, so a per-call lowering would let a program swap the sink,
 * call the probe, and read its own probe back — precisely the observation the
 * pure face denies. That property has no expression in the type system and no
 * trace in the diagnostics, so it is asserted here by replacing the global
 * after the graph has loaded and watching where the message goes.
 *
 * **Every module of every graph below is made byte-distinct per test**, through
 * the `distinct` transform. Emitted modules are mounted as `data:` URLs and the
 * module registry caches those by their full text, so two tests compiling the
 * same program would share one instance of `Debug.js` — and therefore one
 * captured sink, taken during whichever test ran first. Every assertion after
 * it would then be reading another test's capture.
 */

import { describe, expect, test } from "vitest";

import { compileMain, projectDiagnostics, runProject } from "../support/test-project.js";

/** Makes a graph's modules byte-distinct, so the test gets its own instances. */
function distinct(label: string): (path: string, javascript: string) => string {
  return (_path, javascript) => `// ${label}\n${javascript}`;
}

/**
 * The sink itself, reached off `globalThis` because `lib` is `ES2024` and
 * declares no console. Every test below swaps this property, which is the
 * point: it is the same global the emitted module captures.
 */
const host = globalThis as unknown as {
  console: { log: (...values: unknown[]) => void };
};

/**
 * What the sink receives while `body` runs, with the global restored after. The
 * collector is handed to `body` as well, so a test that wants to read or clear
 * it partway through can.
 */
async function written(body: (lines: unknown[][]) => Promise<void>): Promise<unknown[][]> {
  const lines: unknown[][] = [];
  const original = host.console.log;
  host.console.log = (...values: unknown[]) => {
    lines.push(values);
  };
  try {
    await body(lines);
  } finally {
    host.console.log = original;
  }
  return lines;
}

describe("the probe writes", () => {
  test("`log` sends its message to the sink", async () => {
    const lines = await written(async () => {
      await runProject(
        [["/main.hex", 'Debug.log("the probe reached the sink")\nexport let ok: Int = 1\n']],
        { transform: distinct("log sends its message") },
      );
    });
    expect(lines).toEqual([["the probe reached the sink"]]);
  });

  /**
   * #419 inverted the module's shape: the door row is now unexported under the
   * local name `writeLine`, and `log` is ordinary Hexagon above it. So the row's
   * arity is no longer reachable from the module surface at all — nothing a
   * JavaScript consumer can import *is* the lowering, and the old form of this
   * test (calling the exported `log` with two arguments and watching the second
   * vanish) has no subject left. What survives is the structural half, pinned
   * here, and the lowering's own one-parameter arrow, pinned off the emitted
   * text below.
   *
   * **The entry is `/Debug.hex`, and it has to be** — this reads the module's
   * own export table. `/main.hex` still names `log`, because reachability is
   * what puts `/Debug.hex` in the emitted graph.
   */
  test("the door row is unexported; nothing importable is the lowering", async () => {
    const lines = await written(async () => {
      const debug = await runProject(
        [["/main.hex", "export let probe(message: String): Unit = Debug.log(message)\n"]],
        { entry: "/Debug.hex", transform: distinct("door row unexported") },
      );
      // Neither the row's local name nor a bare `log` alias of it is published.
      expect(debug["writeLine"]).toBeUndefined();
      expect(debug["debugLog"]).toBeUndefined();
      expect(debug["log"]).toBeUndefined();
      // What a JavaScript consumer does get at `String` is Part 8's fundamental
      // specialization, whose body is the wrapper's, not the row's.
      const logString = debug["logString"] as (...values: unknown[]) => unknown;
      expect(logString("first", "second")).toBeUndefined();
    });
    expect(lines).toEqual([["first"]]);
  });

  /**
   * The emitted declaration (FFI Part 1 §8.3). `Unit` renders `void` in return
   * position (Products §2.6), so the face a JavaScript consumer imports says
   * the probe answers nothing — which is what the sink answers, and what the
   * species is: a call whose only result is off the language's books.
   *
   * #419 changed *which* faces those are. A constrained export publishes Part
   * 8's fundamental specialization set rather than one monomorphic function, so
   * `log` reaches the boundary as `logInt`, `logString`, and the rest — named,
   * dictionary-free entry points, exactly as `trace` already did. No bare `log`
   * is declared: the generic edition carries a trailing `Show` dictionary
   * (FFI Part 9, asserted below off the emitted JavaScript) and is exported
   * under its internal name, which the `.d.ts` does not surface.
   */
  test("the declaration faces the fundamental specializations, none generic", () => {
    const project = compileMain("export let ok(message: String): Unit = Debug.log(message)\n");
    const module = project.modules.find(({ source }) => source.path === "/Debug.hex");
    const declarations = module!.declarations.text;
    expect(declarations).toContain("export declare function logString(value: string): void;");
    expect(declarations).toContain("export declare function logInt(value: number): void;");
    expect(declarations).toContain("export declare function logBool(value: boolean): void;");
    expect(declarations).not.toContain("export declare function log(");
  });

  /**
   * The widening's promise at the boundary, read off the two ends the emitted
   * module actually has. The generic edition takes the value and a trailing
   * `Show` dictionary (FFI Part 9 §6) and renders through it; the `String`
   * specialization renders through nothing at all, because `Show<String>` is the
   * identity (Primitive Types §7) — so a `String` operand reaches the door row
   * byte-identically to the pre-#419 direct call, which is what makes the
   * widening a widening rather than a change.
   */
  test("the generic edition carries the evidence suffix; `String` renders through nothing", () => {
    const project = compileMain("export let ok(message: String): Unit = Debug.log(message)\n");
    const module = project.modules.find(({ source }) => source.path === "/Debug.hex");
    const javascript = module!.javascript.text;
    expect(javascript).toMatch(
      /const log = \(value, (__Show_a)\) => \{\n\s+return writeLine\(\1\.show\(value\)\);/,
    );
    expect(javascript).toContain("function logString(value) {\n  return writeLine(value);\n}");
  });
});

describe("§6.2's caveat: the sink is captured at initialization", () => {
  /**
   * The species (a) claim, made executable. A sink replaced *after* the module
   * graph has loaded is not the probe's sink — the probe holds the one that was
   * standing when `Debug.js` was evaluated — so a program cannot install a
   * reader, call the probe, and observe the write it was promised it could not
   * observe.
   */
  test("a sink replaced after initialization never receives the message", async () => {
    const captured: unknown[][] = [];
    const replacement: unknown[][] = [];
    const original = host.console.log;
    host.console.log = (...values: unknown[]) => {
      captured.push(values);
    };
    try {
      const exports = await runProject(
        [["/main.hex", "export let probe(message: String): Unit = Debug.log(message)\n"]],
        { transform: distinct("captured at initialization") },
      );
      host.console.log = (...values: unknown[]) => {
        replacement.push(values);
      };
      (exports["probe"] as (message: string) => void)("written after the swap");
    } finally {
      host.console.log = original;
    }
    expect(replacement).toEqual([]);
    expect(captured).toEqual([["written after the swap"]]);
  });

  /**
   * The same fact read off the text, because the behavioural test above passes
   * for a second reason it should not be relied on for — a lowering that read
   * the global per call would also have missed the replacement if nothing
   * replaced it. Exactly one emitted *statement* names the global, it is the
   * capture, and the call path names what the capture bound.
   */
  test("the emitted module names the global once, at the top level", () => {
    const project = compileMain("export let ok(message: String): Unit = Debug.log(message)\n");
    const module = project.modules.find(({ source }) => source.path === "/Debug.hex");
    const javascript = module!.javascript.text;
    const code = javascript.split("\n").filter((line) => {
      const trimmed = line.trimStart();
      return !trimmed.startsWith("//") && !trimmed.startsWith("*") && !trimmed.startsWith("/*");
    });
    expect(code.filter((line) => line.includes("console.log"))).toEqual([
      "  const __sink = console.log.bind(console);",
    ]);
    expect(javascript).toContain("return __message => { __sink(__message); };");
    // Since #419 the row's local name is `writeLine` and it is unexported; the
    // one-parameter arrow above is the lowering's own arity, which no longer
    // has an exported binding to be read off.
    expect(javascript).toContain("const writeLine = __debugLog;");
  });
});

/**
 * #419. The probe widened from `log(message: String)` to `log<a: Show>(value: a)`
 * — Hexagon's version of `console.log`, not `console.log` precisely. The door row
 * stays monomorphic and went unexported beneath the wrapper, so everything here
 * is about the *surface*: which operands it takes, whose rendering they get, and
 * which it refuses.
 */
describe("#419: the probe takes any showable value", () => {
  test("a non-`String` operand writes that type's rendering", async () => {
    const lines = await written(async () => {
      await runProject(
        [["/main.hex", "Debug.log(5)\nexport let ok: Int = 1\n"]],
        { transform: distinct("widened to Int") },
      );
    });
    expect(lines).toEqual([["5"]]);
  });

  /**
   * The widening's compatibility claim, made executable: `Show<String>` is the
   * identity (Primitive Types §7), so a `String` operand reaches the sink as
   * itself — no quotes, no escaping, byte-identically to what the pre-#419
   * `String`-only face wrote. Every existing call site is therefore untouched.
   */
  test("a `String` operand still writes itself, unquoted", async () => {
    const lines = await written(async () => {
      await runProject(
        [["/main.hex", 'Debug.log("the probe reached the sink")\nexport let ok: Int = 1\n']],
        { transform: distinct("String unchanged") },
      );
    });
    expect(lines).toEqual([["the probe reached the sink"]]);
  });

  /**
   * The rendering is the *instance's*, not a structural walk of the
   * representation. A record whose `Show` deliberately renders nothing like its
   * fields is the specimen that tells the two apart: a representation walk would
   * write `{cents = 250}` and the honored instance writes `$2.50`.
   */
  test("a user type's own `Show` instance is what renders, not its representation", async () => {
    const lines = await written(async () => {
      await runProject(
        [[
          "/main.hex",
          "record Money = {cents: Int}\n" +
            "honor Show<Money> =\n" +
            '    show(value) = "$2.50"\n' +
            "Debug.log(Money({cents = 250}))\n" +
            "export let ok: Int = 1\n",
        ]],
        { transform: distinct("record instance renders") },
      );
    });
    expect(lines).toEqual([["$2.50"]]);
  });

  test("a union's honored `Show` renders through the same path", async () => {
    const lines = await written(async () => {
      await runProject(
        [[
          "/main.hex",
          "union Light = Red | Green\n" +
            "honor Show<Light> =\n" +
            "    show(value) =\n" +
            "        match value\n" +
            '            Red => "stop"\n' +
            '            Green => "go"\n' +
            "Debug.log(Green)\n" +
            "export let ok: Int = 1\n",
        ]],
        { transform: distinct("union instance renders") },
      );
    });
    expect(lines).toEqual([["go"]]);
  });

  /**
   * The refusal, and the point of asserting it: the widening introduced no new
   * diagnostic. A value with no `Show` is turned away by the ordinary
   * missing-instance report — the same words `show` itself produces on the same
   * operand — so `log` is a constrained call like any other and not a probe with
   * a special error of its own. That is the visible difference from
   * `console.log`, which would have printed something.
   */
  test("a value with no `Show` is refused, in the ordinary words", () => {
    const throughLog = projectDiagnostics(
      "let step(n: Int): Int = n + 1\nexport let bad: Unit = Debug.log(step)\n",
    );
    expect(throughLog).toEqual(["functions have no `Show` instance"]);
    // The same operand handed straight to `show`, for the identity claim above.
    const throughShow = projectDiagnostics(
      "let step(n: Int): Int = n + 1\nexport let bad: String = show(step)\n",
    );
    expect(throughShow).toEqual(throughLog);
  });

  /**
   * The widened `log` is an ordinary constrained function, so a caller that is
   * itself constrained threads its own dictionary through rather than resolving
   * anything. Two instantiations of one such caller prove the dictionary is the
   * call site's and not baked into the callee.
   */
  test("a `<a: Show>` caller threads its dictionary through", async () => {
    const lines = await written(async () => {
      const exports = await runProject(
        [[
          "/main.hex",
          "record Money = {cents: Int}\n" +
            "honor Show<Money> =\n" +
            '    show(value) = "$2.50"\n' +
            "let probe<a: Show>(value: a): a =\n" +
            "    Debug.log(value)\n" +
            "    value\n" +
            "export let atInt(n: Int): Int = probe(n)\n" +
            "export let atMoney(n: Int): Int = probe(Money({cents = n})).cents\n",
        ]],
        { transform: distinct("polymorphic pass-through") },
      );
      expect((exports["atInt"] as (n: number) => number)(7)).toBe(7);
      expect((exports["atMoney"] as (n: number) => number)(250)).toBe(250);
    });
    expect(lines).toEqual([["7"], ["$2.50"]]);
  });

  /** The qualified home (`modules.md` §6.4) widened with the bare name. */
  test("`Debug.log` qualified takes the widened operand too", async () => {
    const lines = await written(async () => {
      await runProject(
        [["/main.hex", "Debug.log(5)\nexport let ok: Int = 1\n"]],
        { transform: distinct("qualified widened") },
      );
    });
    expect(lines).toEqual([["5"]]);
  });
});

describe("`trace` threads the probe through an expression", () => {
  test("it renders `label: value` and answers the value unchanged", async () => {
    const lines = await written(async () => {
      const exports = await runProject(
        [[
          "/main.hex",
          "export let doubled(value: Int): Int = 2 * Debug.trace(\"input\", value)\n",
        ]],
        { transform: distinct("trace renders and answers") },
      );
      expect((exports["doubled"] as (value: number) => number)(21)).toBe(42);
    });
    expect(lines).toEqual([["input: 21"]]);
  });

  /**
   * The `Show` bound is what licenses the interpolation, so the rendering is
   * the subject's own `show` and not a host `String(…)`: a `Vector(Int)` reads
   * as Hexagon writes it.
   */
  test("the rendering is the value's `show`", async () => {
    const lines = await written(async () => {
      await runProject(
        [["/main.hex", 'export let rows: Vector(Int) = Debug.trace("rows", [1, 2, 3])\n']],
        { transform: distinct("trace shows") },
      );
    });
    expect(lines).toEqual([["rows: [1, 2, 3]"]]);
  });

  /**
   * What the species forfeits, taught by the standard library's own laziness:
   * a probe under a `Seq` step runs when that step runs. Two traversals of an
   * unmemoized sequence print twice; `memoize` collapses the second traversal
   * to no printing at all. Neither is a defect — the pure face buys the right
   * to be indifferent to both.
   */
  test("multiplicity is the sequence's, not the probe's", async () => {
    const lines = await written(async (collected) => {
      const exports = await runProject(
        [[
          "/main.hex",
          "let counted: Seq(Int) = Seq.take(Seq.iterate(1, value => value + 1), 2)\n" +
          'let probed: Seq(Int) = Seq.map(counted, value => Debug.trace("step", value))\n' +
          "let stored: Seq(Int) = Seq.memoize(probed)\n" +
          "let total(source: Seq(Int)): Int =\n" +
          "    Seq.fold(source, 0, (running, value) => running + value)\n" +
          "export let twice(ignored: Int): Int = total(probed) + total(probed)\n" +
          "export let storedTwice(ignored: Int): Int = total(stored) + total(stored)\n",
        ]],
        { transform: distinct("multiplicity") },
      );
      expect((exports["twice"] as (ignored: number) => number)(0)).toBe(6);
      // Two traversals of an unmemoized sequence derive every element twice.
      expect(collected).toHaveLength(4);
      collected.length = 0;
      expect((exports["storedTwice"] as (ignored: number) => number)(0)).toBe(6);
    });
    expect(lines).toEqual([["step: 1"], ["step: 2"]]);
  });
});
