import { describe, expect, test } from "vitest";

import { compileProject, Source } from "../index";

/**
 * Behavioural conformance for `Seq.memoize` (Loops §6.4), the explicit opt-in
 * out of the re-derivation default, and for the intrinsic door it is declared
 * through (`spec/intrinsics.md` §3.2).
 *
 * **Every assertion below executes the emitted module.** The recurring shape in
 * the defect log is a clean compile whose JavaScript is wrong or unloadable, and
 * `memoize`'s entire content is a *runtime* property — what re-driving a value
 * does to the effects underneath it. A diagnostics-only test would prove nothing
 * it claims.
 *
 * The observable used throughout is a foreign counter behind `Seq.map`: the base
 * sequence crosses the FFI Part 3 boundary and is therefore already memoized,
 * but the mapping over it re-derives on every traversal, so the counter reads
 * exactly how many times the derivation ran. That is the quantity §6.4 is about.
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

/**
 * A foreign module exposing a counted identity `tick` and the count. Mapping
 * `tick` over a sequence makes each derivation of an element observable.
 *
 * `label` is not decoration. Foreign modules are mounted as `data:` URLs, and the
 * JavaScript module registry caches those by their full text — so two tests
 * sharing a ticker would share one `count`, and every assertion after the first
 * would read a total from the whole file rather than from its own test. The
 * label makes each test's module a distinct URL, and therefore a fresh counter.
 */
function ticker(label: string): string {
  return `// ${label}\n` +
    "let count = 0;\n" +
    "export function tick(value) { count += 1; return value; }\n" +
    "export function ticks() { return count; }\n";
}

const TICKER_HEADER =
  'extern from "ticker"\n' +
  "    fun tick(value: Int): Int\n" +
  "    fun ticks(): Int\n" +
  "\n";

describe("Loops §6.4: re-derivation is the default, `memoize` the opt-in", () => {
  /**
   * The contrast the whole feature exists for, asserted in one program so the
   * two halves cannot drift apart. `derived` and `memoized` are the same
   * pipeline; only the opt-in differs.
   */
  test("an un-memoized Seq replays its effects; a memoized one replays cached elements", async () => {
    const exports = await run(
      [["/main.hex",
        TICKER_HEADER +
        "let base: Seq(Int) = Vector.toSeq([1, 2, 3])\n" +
        "let derived: Seq(Int) = Seq.map(base, tick)\n" +
        "let memoized: Seq(Int) = Seq.memoize(Seq.map(base, tick))\n" +
        "\n" +
        "export let driveDerived(ignored: Int): Int =\n" +
        "    Seq.fold(derived, 0, (total, value) => total + value)\n" +
        "\n" +
        "export let driveMemoized(ignored: Int): Int =\n" +
        "    Seq.fold(memoized, 0, (total, value) => total + value)\n" +
        "\n" +
        "export let ticked(ignored: Int): Int = ticks()\n"]],
      { ticker: ticker("default-vs-optin") },
    );
    const driveDerived = exports["driveDerived"] as (ignored: number) => number;
    const driveMemoized = exports["driveMemoized"] as (ignored: number) => number;
    const ticked = exports["ticked"] as (ignored: number) => number;

    // Nothing is forced until something drives it: `memoize` is lazy like every
    // other combinator, so building it over `base` ran no step at all.
    expect(ticked(0)).toBe(0);

    // Re-derivation: the same three elements are recomputed on every traversal,
    // and the effects underneath them are replayed. This is §6.4's default and
    // the reason the opt-in exists.
    expect(driveDerived(0)).toBe(6);
    expect(ticked(0)).toBe(3);
    expect(driveDerived(0)).toBe(6);
    expect(ticked(0)).toBe(6);

    // The opt-in: the first traversal forces each position once, and every later
    // traversal replays the memoized elements without re-running the derivation.
    const before = ticked(0);
    expect(driveMemoized(0)).toBe(6);
    expect(ticked(0)).toBe(before + 3);
    expect(driveMemoized(0)).toBe(6);
    expect(driveMemoized(0)).toBe(6);
    expect(ticked(0)).toBe(before + 3);
  });

  test("memoize preserves laziness: an infinite Seq stays a finite value", async () => {
    const exports = await run(
      [["/main.hex",
        TICKER_HEADER +
        // Infinite, so this terminates only if `memoize` forces nothing eagerly
        // and forces exactly what the consumer demands.
        "let naturals: Seq(Int) = Seq.iterate(1, x => x + 1)\n" +
        "let memoized: Seq(Int) = Seq.memoize(Seq.map(naturals, tick))\n" +
        "\n" +
        "export let firstThree(ignored: Int): Int =\n" +
        "    Seq.fold(Seq.take(memoized, 3), 0, (total, value) => total + value)\n" +
        "\n" +
        "export let ticked(ignored: Int): Int = ticks()\n"]],
      { ticker: ticker("laziness") },
    );
    const firstThree = exports["firstThree"] as (ignored: number) => number;
    const ticked = exports["ticked"] as (ignored: number) => number;

    expect(ticked(0)).toBe(0);
    expect(firstThree(0)).toBe(6);
    // Exactly the demanded prefix — no speculative lookahead past the frontier.
    expect(ticked(0)).toBe(3);
    expect(firstThree(0)).toBe(6);
    expect(ticked(0)).toBe(3);
  });

  /**
   * §4's retention rule read from the argument's side: `memoize` returns a new
   * value and leaves the one it was handed exactly as it was. A `Seq` is a value,
   * and memoizing one no more consumes it than driving one does (§6.5).
   */
  test("the memoized value is new; the source keeps re-deriving", async () => {
    const exports = await run(
      [["/main.hex",
        TICKER_HEADER +
        "let source: Seq(Int) = Seq.map(Vector.toSeq([1, 2, 3]), tick)\n" +
        "let memoized: Seq(Int) = Seq.memoize(source)\n" +
        "\n" +
        "export let driveSource(ignored: Int): Int = Seq.length(source)\n" +
        "export let driveMemoized(ignored: Int): Int = Seq.length(memoized)\n" +
        "export let ticked(ignored: Int): Int = ticks()\n"]],
      { ticker: ticker("source-unconsumed") },
    );
    const driveSource = exports["driveSource"] as (ignored: number) => number;
    const driveMemoized = exports["driveMemoized"] as (ignored: number) => number;
    const ticked = exports["ticked"] as (ignored: number) => number;

    expect(driveMemoized(0)).toBe(3);
    expect(driveMemoized(0)).toBe(3);
    expect(ticked(0)).toBe(3);
    // The source is untouched by what was done to the value derived from it.
    expect(driveSource(0)).toBe(3);
    expect(ticked(0)).toBe(6);
    expect(driveSource(0)).toBe(3);
    expect(ticked(0)).toBe(9);
    // And the memoized value is still memoized after all of that.
    expect(driveMemoized(0)).toBe(3);
    expect(ticked(0)).toBe(9);
  });

  /**
   * Independent traversals share one spine, so a position forced by either is
   * forced for both. This is the property that distinguishes memoization from a
   * per-traversal cache, and it holds for interleaved cursors, not just
   * sequential ones.
   */
  test("independent traversals of one memoized value share the forced prefix", async () => {
    const exports = await run(
      [["/main.hex",
        TICKER_HEADER +
        "let memoized: Seq(Int) = Seq.memoize(Seq.map(Vector.toSeq([1, 2, 3, 4]), tick))\n" +
        "\n" +
        // Opens a cursor and forces one position, returning the rest as a value
        // the caller can hold — two of these interleave over one spine.
        "export let headThenLength(ignored: Int): Int =\n" +
        "    match Seq.next(memoized)\n" +
        "        None => 0\n" +
        "        Some((value, rest)) => value + Seq.length(rest)\n" +
        "\n" +
        "export let ticked(ignored: Int): Int = ticks()\n"]],
      { ticker: ticker("shared-prefix") },
    );
    const headThenLength = exports["headThenLength"] as (ignored: number) => number;
    const ticked = exports["ticked"] as (ignored: number) => number;

    expect(headThenLength(0)).toBe(1 + 3);
    expect(ticked(0)).toBe(4);
    // A second, independent traversal from the head forces nothing new.
    expect(headThenLength(0)).toBe(1 + 3);
    expect(ticked(0)).toBe(4);
  });

  /**
   * Loops §6.5 promises no tail-call elimination, so a long memoized run must be
   * driven iteratively at every layer — the spine, the outbound driver, and the
   * fold. 50k is well past any engine's recursion budget.
   */
  test("a long memoized run drives in constant stack", async () => {
    const exports = await run(
      [["/main.hex",
        "let memoized: Seq(Int) = Seq.memoize(Seq.take(Seq.iterate(1, x => x + 1), 50000))\n" +
        "export let total: Int = Seq.fold(memoized, 0, (running, value) => running + value)\n" +
        "export let again: Int = Seq.fold(memoized, 0, (running, value) => running + value)\n"]],
    );
    expect(exports["total"]).toBe(1250025000);
    expect(exports["again"]).toBe(1250025000);
  });
});

describe("failure is memoized per position (FFI Part 3 §7.1, inherited)", () => {
  /**
   * §4.2 makes the lowering answerable for "every Loops §6.4 property,
   * inheriting FFI Part 3 §7.1 failure memoization". Composition cannot weaken
   * that — the spine memoizing failures is the same spine — but the inheritance
   * is a claim about *this* operation, so it is pinned here rather than left to
   * the inbound adapter's own suite (#124).
   *
   * The assertions are the two the old spine got wrong: the second force throws
   * the *same* value by identity, and the failing derivation ran exactly once.
   */
  test("forcing a failed position again replays the throw without re-running it", async () => {
    const exports = await run(
      [["/main.hex",
        'extern from "boom"\n' +
        "    fun explode(value: Int): Int\n" +
        "    fun attempts(): Int\n" +
        "\n" +
        "let memoized: Seq(Int) = Seq.memoize(Seq.map(Vector.toSeq([1, 2, 3]), explode))\n" +
        "\n" +
        "export let force(ignored: Int): Int =\n" +
        "    match Seq.next(memoized)\n" +
        "        None => 0\n" +
        "        Some((value, _)) => value\n" +
        "\n" +
        "export let attempted(ignored: Int): Int = attempts()\n"]],
      {
        boom:
          "let calls = 0;\n" +
          // Throws on the first call and succeeds afterwards, so a re-run is
          // visible as a *success* where §7.1 demands a replayed failure.
          "export function explode(value) {\n" +
          "  calls += 1;\n" +
          "  if (calls === 1) throw new Error('boom');\n" +
          "  return value;\n" +
          "}\n" +
          "export function attempts() { return calls; }\n",
      },
    );
    const force = exports["force"] as (ignored: number) => number;
    const attempted = exports["attempted"] as (ignored: number) => number;

    const thrown: unknown[] = [];
    for (const _attempt of [0, 1]) {
      try {
        force(0);
      } catch (error) {
        thrown.push(error);
      }
    }
    expect(thrown).toHaveLength(2);
    // Identity, not equality: a re-run that happened to throw a look-alike must
    // not pass this.
    expect(thrown[0]).toBe(thrown[1]);
    expect(attempted(0)).toBe(1);
  });
});

describe("the door's emission (spec/intrinsics.md §8)", () => {
  function seqModule(): { javascript: string; declarations: string } {
    const project = compileProject([
      new Source.File(Source.fileId(0), "/main.hex", "export let ok: Int = Seq.length(Seq.empty)\n"),
    ]);
    expect(project.diagnostics).toEqual([]);
    const module = project.modules.find(({ source }) => source.path.endsWith("Seq.hex"))!;
    return { javascript: module.javascript.text, declarations: module.declarations.text };
  }

  /**
   * §8.3: "A `"hex:intrinsic"` block emits **no import** — there is no foreign
   * module." An emitted `import "hex:intrinsic"` would be a specifier no loader
   * can resolve, so this is load-bearing, not cosmetic.
   */
  test("the block emits no import", () => {
    expect(seqModule().javascript).not.toContain("hex:intrinsic");
  });

  /**
   * §8.3: an ordinary binding of the declaring module's output, an ESM named
   * export when exported — so cross-module linkage is ordinary ESM, exactly like
   * every other prelude function.
   */
  test("the binding and its export are ordinary", () => {
    const { javascript } = seqModule();
    expect(javascript).toContain("const memoize = __hex_seqMemoize;");
    expect(javascript).toContain("export { memoize };");
  });

  /** §4.1: keys mirror the runtime helper family, and the lowering is that helper. */
  test("the lowering is the composed R1 pair, not a second spine", () => {
    const { javascript } = seqModule();
    expect(javascript).toContain(
      "function __hex_seqMemoize(__hex_source) {\n" +
      "  return __hex_seqFromIterable(__hex_seqToIterable(__hex_source));\n" +
      "}",
    );
  });

  /**
   * §8.2: consumers see nothing new. The declaration is an exported function of
   * its module, so it reaches consumers qualified, and §8.1's `CompanionOf` is
   * unperturbed — `Seq.hex` is `Seq`'s home module, so dot-call dispatches here
   * exactly as it does to `map`.
   */
  test("consumers reach it qualified and by dot-call", async () => {
    const exports = await run(
      [["/main.hex",
        "let base: Seq(Int) = Seq.take(Seq.iterate(1, x => x + 1), 3)\n" +
        "export let qualified: Int = Seq.length(Seq.memoize(base))\n" +
        "export let dotCalled: Int = Seq.length(base.memoize())\n"]],
    );
    expect(exports["qualified"]).toBe(3);
    expect(exports["dotCalled"]).toBe(3);
  });

  /** §3.4's genericity, visible where it has to be: the published face. */
  test("the emitted face quantifies the declaration's variable", () => {
    expect(seqModule().declarations).toContain(
      "export declare function memoize<a>(source: Seq<a>): Seq<a>;",
    );
  });
});

/**
 * Closure doc `decisions-ml-dialect-generalization-2026-08.md` §7 and §11.1
 * (viii): the intrinsic parametricity obligation, for the one entry the v1
 * inventory holds.
 *
 * `intrinsics.md` §4.2's commitment is that a generic intrinsic "may move,
 * store, and return values at its type parameters; it must never fabricate
 * them, coerce them, or inspect them by type." That obligation is the entire
 * warrant for `Seq(+a)` being semantically true of `memoize` — a stateful,
 * generic, covariant-result intrinsic is the sharpest case there is, and Step
 * 2's soundness leans on it directly (Functions §8.7's third leg).
 *
 * The closure doc declined to *assert* that the lowering satisfies it, routing
 * the question here instead. These tests are that route. The observable is
 * **object identity**: elements are nominal records, which emit as JavaScript
 * objects, so an element the spine fabricated or copied is one `===` cannot
 * confuse with the element that went in.
 */
describe("§7: `memoize` moves values, and does nothing else to them", () => {
  test("every element out of the memoized spine is the element that went in", async () => {
    const exports = await run(
      [["/main.hex",
        "export record Cell = {tag: Int}\n" +
        "export let one: Cell = Cell({tag = 1})\n" +
        "export let two: Cell = Cell({tag = 2})\n" +
        "export let three: Cell = Cell({tag = 3})\n" +
        "let source: Seq(Cell) = Seq.cons(one, Seq.cons(two, Seq.cons(three, Seq.empty)))\n" +
        "let memoized: Seq(Cell) = Seq.memoize(source)\n" +
        "export let first: Vector(Cell) = Vector.fromSeq(memoized)\n" +
        "export let second: Vector(Cell) = Vector.fromSeq(memoized)\n"]],
    );
    const originals = [exports["one"], exports["two"], exports["three"]];
    const first = exports["first"] as readonly unknown[];
    const second = exports["second"] as readonly unknown[];
    // Nothing fabricated: the counts match, so no element appeared from nowhere
    // and none was dropped.
    expect(first.length).toBe(3);
    expect(second.length).toBe(3);
    // Nothing copied or coerced: identity, not equality. A spine that rebuilt
    // its elements — or that reached inside one — would pass a structural
    // comparison and fail here.
    for (const [index, original] of originals.entries()) {
      expect(first[index]).toBe(original);
      expect(second[index]).toBe(original);
    }
  });

  test("the second traversal replays the same objects, not equal ones", async () => {
    // The memoizing spine is the only thing between the two traversals, so this
    // is the assertion that its *store* holds pulled values rather than
    // reconstructions of them.
    const exports = await run(
      [["/main.hex",
        "export record Cell = {tag: Int}\n" +
        "let source: Seq(Cell) = Seq.cons(Cell({tag = 1}), Seq.cons(Cell({tag = 2}), Seq.empty))\n" +
        "let memoized: Seq(Cell) = Seq.memoize(source)\n" +
        "export let first: Vector(Cell) = Vector.fromSeq(memoized)\n" +
        "export let second: Vector(Cell) = Vector.fromSeq(memoized)\n"]],
    );
    const first = exports["first"] as readonly unknown[];
    const second = exports["second"] as readonly unknown[];
    expect(first.length).toBe(2);
    expect(second.length).toBe(2);
    expect(second[0]).toBe(first[0]);
    expect(second[1]).toBe(first[1]);
  });

  test("nothing is inspected by type: a function element survives unchanged", async () => {
    // The element type here is one an intrinsic could not meaningfully examine
    // even if it tried, and the spine must be as indifferent to it as to a
    // record. Applying the elements afterwards is what proves they arrived
    // whole rather than as something that merely printed the same.
    const exports = await run(
      [["/main.hex",
        "let source: Seq(Int -> Int) = Seq.cons(x => x + 1, Seq.cons(x => x * 2, Seq.empty))\n" +
        "let memoized: Seq(Int -> Int) = Seq.memoize(source)\n" +
        "let applied: Seq(Int) = Seq.map(memoized, f => f(10))\n" +
        "export let results: Vector(Int) = Vector.fromSeq(applied)\n"]],
    );
    expect(exports["results"]).toEqual([11, 20]);
  });
});
