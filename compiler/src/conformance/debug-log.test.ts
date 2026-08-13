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

import { compileMain, runProject } from "../support/test-project.js";

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
        [["/main.hex", 'log("the probe reached the sink")\nexport let ok: Int = 1\n']],
        { transform: distinct("log sends its message") },
      );
    });
    expect(lines).toEqual([["the probe reached the sink"]]);
  });

  /**
   * The declared face is `(message: String) -> Unit`, and `Unit` is `undefined`
   * (Products §2.6). The sink's own answer is `undefined` too, so this pins the
   * lowering's one parameter rather than the return: a bare alias of the host's
   * variadic `console.log` would forward every argument a JavaScript consumer
   * passed the exported binding, which the face does not promise.
   */
  test("the exported binding takes one argument, not the host's variadic", async () => {
    const lines = await written(async () => {
      const exports = await runProject(
        [["/main.hex", "export let probe(message: String): Unit = log(message)\n"]],
        { transform: distinct("one argument") },
      );
      const probe = exports["probe"] as (...values: unknown[]) => unknown;
      expect(probe("first", "second")).toBeUndefined();
    });
    expect(lines).toEqual([["first"]]);
  });

  /**
   * The emitted declaration (FFI Part 1 §8.3). `Unit` renders `void` in return
   * position (Products §2.6), so the face a JavaScript consumer imports says
   * the probe answers nothing — which is what the sink answers, and what the
   * species is: a call whose only result is off the language's books.
   */
  test("the declaration faces one string in and nothing out", () => {
    const project = compileMain("export let ok(message: String): Unit = log(message)\n");
    const module = project.modules.find(({ source }) => source.path === "/Debug.hex");
    expect(module!.declarations.text).toContain(
      "export declare function log(message: string): void;",
    );
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
        [["/main.hex", "export let probe(message: String): Unit = log(message)\n"]],
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
    const project = compileMain("export let ok(message: String): Unit = log(message)\n");
    const module = project.modules.find(({ source }) => source.path === "/Debug.hex");
    const javascript = module!.javascript.text;
    const code = javascript.split("\n").filter((line) => {
      const trimmed = line.trimStart();
      return !trimmed.startsWith("//") && !trimmed.startsWith("*") && !trimmed.startsWith("/*");
    });
    expect(code.filter((line) => line.includes("console.log"))).toEqual([
      "  const __hex_sink = console.log.bind(console);",
    ]);
    expect(javascript).toContain("return __hex_message => { __hex_sink(__hex_message); };");
    expect(javascript).toContain("const log = __hex_debugLog;");
  });
});

describe("`trace` threads the probe through an expression", () => {
  test("it renders `label: value` and answers the value unchanged", async () => {
    const lines = await written(async () => {
      const exports = await runProject(
        [[
          "/main.hex",
          "export let doubled(value: Int): Int = 2 * trace(\"input\", value)\n",
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
        [["/main.hex", 'export let rows: Vector(Int) = trace("rows", [1, 2, 3])\n']],
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
          'let probed: Seq(Int) = Seq.map(counted, value => trace("step", value))\n' +
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
