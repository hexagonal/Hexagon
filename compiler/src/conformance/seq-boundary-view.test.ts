import { describe, expect, test } from "vitest";

import { compileProject, Source } from "../index";

/**
 * A real collection, for FFI Part 3 §9.4 property 7.
 *
 * The suite does not run under `--expose-gc` and this is the only test that
 * wants it, so the flag is turned on in-process and off again rather than
 * imposed on every worker: `runInNewContext` captures `gc` while it is exposed,
 * and the captured binding keeps working after the flag is withdrawn.
 *
 * The specifiers are indirected through variables on purpose. This package
 * carries no `@types/node` and `lib` is `ES2024` alone — the compiler itself is
 * platform-neutral and should stay that way — so a literal `import "node:v8"`
 * would not typecheck. A non-literal specifier is not resolved by TypeScript,
 * which is exactly the escape hatch wanted for one test.
 */
/**
 * One macrotask. Reached off `globalThis` for the same reason as the specifiers
 * below: `lib` is `ES2024`, which declares no timers.
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

/**
 * Conformance for the **memoized boundary view** — FFI Part 3 §9.4, the
 * defect-12 ruling (2026-07-28).
 *
 * §9.4 makes the JavaScript iterable protocol part of a `Seq`'s representation
 * and states seven normative properties of what that method delivers. The
 * ruling is explicit that the composed R1 pair is a *representative*
 * implementation and the seven properties are the contract, so this file tests
 * the properties and never the composition. One describe block per property,
 * numbered as §9.4 numbers them.
 *
 * **Every test of the seven properties executes the emitted JavaScript.** The
 * defect being closed here was a clean compile whose exported value did not
 * satisfy its own `.d.ts`, so a test that only read emitted text would prove
 * nothing about it.
 *
 * Four tests here do read emitted text, and none of them stands alone as the
 * only evidence for what it claims. Two pin things with no runtime observable
 * at all — a record shape that must not appear outside the helper block (a
 * source-level invariant) and a wrapper that must not be re-allocated (ESM
 * gives no way to see how many times a binding was constructed). One pins a
 * normative *sentence* about the lowering, next to a runtime test of the same
 * property, so that a reader changing that line meets it. One checks the export
 * shape of constrained specializations, and executes one of them as well.
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
 * byte-identical share one instantiated module — and therefore one copy of the
 * foreign side's mutable counters. Nearly every test here counts derivation
 * steps in a foreign module, and several deliberately use the same probe, so
 * without a per-run tag one test would observe another's tally. Stamped into
 * the URL rather than the source so the compiled program is unaffected.
 */
let runTag = 0;

/** Compiles a project and executes it, returning `/main.hex`'s exports. */
async function run(
  files: readonly (readonly [string, string])[],
  foreign: Readonly<Record<string, string>> = {},
): Promise<Record<string, unknown>> {
  const project = compileProject(
    files.map(([path, text], index) => new Source.File(Source.fileId(index), path, text)),
  );
  expect(project.diagnostics).toEqual([]);
  runTag += 1;
  const url = (source: string): string =>
    `data:text/javascript;charset=utf-8,${encodeURIComponent(source)}#run${runTag}`;
  const moduleUrls = new Map<string, string>();
  for (const [specifier, source] of Object.entries(foreign)) {
    moduleUrls.set(specifier, url(source));
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
  return (await import(/* @vite-ignore */ moduleUrls.get("/main.hex")!)) as Record<string, unknown>;
}

function main(source: string): Promise<Record<string, unknown>> {
  return run([["/main.hex", source]]);
}

describe("the face is representation, at every construction site (§9.4)", () => {
  /**
   * "The method is representation from birth, at every construction site
   * (`Seq.hex`'s combinators and the §2 adapter alike), so it is present at
   * every position without boundary plumbing."
   *
   * Both construction sites are checked, because they are separate code paths:
   * the record-constructor lowering and the inbound adapter's node factory.
   */
  test("a combinator-built Seq is iterable", async () => {
    const exports = await main(
      "export let built: Seq(Int) = Seq.map(Seq.take(Seq.successors(1, x => x + 1), 3), x => x * 2)\n",
    );
    expect([...exports["built"] as Iterable<number>]).toEqual([2, 4, 6]);
  });

  test("an adapter-built Seq is iterable", async () => {
    const exports = await run(
      [["/main.hex",
        "extern from \"numbers\"\n" +
        "    fun counter(): Seq(Int)\n" +
        "\n" +
        "export let adapted: Seq(Int) = counter!()\n"]],
      { numbers: "export function counter() { return [7, 8, 9]; }" },
    );
    expect([...exports["adapted"] as Iterable<number>]).toEqual([7, 8, 9]);
  });

  test("the empty Seq is iterable", async () => {
    // `Seq.empty` is a module-level constant, not a call — its record literal is
    // built once at module initialization, so it exercises a distinct path.
    const exports = await main("export let nothing: Seq(Int) = Seq.empty\n");
    expect([...exports["nothing"] as Iterable<number>]).toEqual([]);
  });

  test("a Seq nested in an exported aggregate is iterable too", async () => {
    // §9.3's note: the representation rule incidentally makes outbound nested
    // `Seq` values honest. Part 1 §5.3's *inbound* rejection is unaffected and
    // is not what this observes.
    const exports = await main(
      "export let pair: (Seq(Int), Int) = (Seq.singleton(4), 9)\n",
    );
    const [sequence, count] = exports["pair"] as [Iterable<number>, number];
    expect([...sequence]).toEqual([4]);
    expect(count).toBe(9);
  });
});

describe("§9.4 property 1: each call opens an independent cursor", () => {
  test("two cursors advance separately over one value", async () => {
    const exports = await main(
      "export let counted: Seq(Int) = Seq.take(Seq.successors(1, x => x + 1), 4)\n",
    );
    const counted = exports["counted"] as Iterable<number>;
    const first = counted[Symbol.iterator]();
    const second = counted[Symbol.iterator]();
    expect(first.next().value).toBe(1);
    expect(first.next().value).toBe(2);
    // The second cursor starts at the position, not at the first's frontier.
    expect(second.next().value).toBe(1);
    expect(first.next().value).toBe(3);
    expect(second.next().value).toBe(2);
  });

  test("a full traversal can be repeated", async () => {
    const exports = await main(
      "export let counted: Seq(Int) = Seq.take(Seq.successors(1, x => x + 1), 3)\n",
    );
    const counted = exports["counted"] as Iterable<number>;
    expect([...counted]).toEqual([1, 2, 3]);
    expect([...counted]).toEqual([1, 2, 3]);
    expect([...counted]).toEqual([1, 2, 3]);
  });
});

describe("§9.4 property 2: all cursors share one memoized view", () => {
  /**
   * "Across all foreign traversals of that value, each position's derivation
   * runs **at most once** — the first cursor to reach a position forces it;
   * every later observation replays the memoized outcome."
   *
   * The observable is a **side effect count**. Re-derivation is the internal
   * default (Loops §6.4), so a `map` whose transform is counted would run twice
   * on a second internal traversal; through the boundary view it must not.
   */
  async function traversals(): Promise<{
    steps: () => number;
    counted: Iterable<number>;
  }> {
    const exports = await run(
      [["/main.hex",
        "extern from \"probe\"\n" +
        "    pure fun note(value: Int): Int\n" +
        "    fun steps(): Int\n" +
        "\n" +
        "export let counted: Seq(Int) =\n" +
        "    Seq.map(Seq.take(Seq.successors(1, x => x + 1), 3), note)\n" +
        "export let observed(ignored: Int): Int = steps!()\n"]],
      {
        probe: [
          "let count = 0;",
          "export function note(value) { count += 1; return value; }",
          "export function steps() { return count; }",
        ].join("\n"),
      },
    );
    return {
      steps: () => (exports["observed"] as (ignored: number) => number)(0),
      counted: exports["counted"] as Iterable<number>,
    };
  }

  test("a second foreign traversal re-runs nothing", async () => {
    const { steps, counted } = await traversals();
    expect(steps()).toBe(0);
    expect([...counted]).toEqual([1, 2, 3]);
    expect(steps()).toBe(3);
    expect([...counted]).toEqual([1, 2, 3]);
    expect(steps()).toBe(3);
  });

  test("interleaved cursors force each position once between them", async () => {
    const { steps, counted } = await traversals();
    const first = counted[Symbol.iterator]();
    const second = counted[Symbol.iterator]();
    expect(first.next().value).toBe(1);
    expect(steps()).toBe(1);
    // The second cursor reaches an already-forced position: no new derivation.
    expect(second.next().value).toBe(1);
    expect(steps()).toBe(1);
    // Whichever cursor reaches the shared frontier advances it.
    expect(second.next().value).toBe(2);
    expect(steps()).toBe(2);
    expect(first.next().value).toBe(2);
    expect(steps()).toBe(2);
  });
});

describe("§9.4 property 3: the view is created lazily", () => {
  /**
   * "A `Seq` JavaScript never traverses carries no view, no buffer, and no cost
   * beyond the shared method itself."
   *
   * Stated honestly about what these two tests reach: the view is held in a
   * `WeakMap` inside the shared method's closure, so it is **unobservable from
   * JavaScript by construction** — there is no assertion that can distinguish
   * "no view" from "an empty view created eagerly". What they do pin is the
   * consequence the property exists for, and the only one a program can feel:
   * nothing is derived and no foreign effect runs. The stronger half is
   * structural and is checked by reading the helper, not by executing it.
   */
  test("a Seq JavaScript never traverses forces nothing", async () => {
    const exports = await run(
      [["/main.hex",
        "extern from \"probe\"\n" +
        "    pure fun note(value: Int): Int\n" +
        "    fun steps(): Int\n" +
        "\n" +
        "export let counted: Seq(Int) =\n" +
        "    Seq.map(Seq.take(Seq.successors(1, x => x + 1), 3), note)\n" +
        "export let observed(ignored: Int): Int = steps!()\n"]],
      {
        probe: [
          "let count = 0;",
          "export function note(value) { count += 1; return value; }",
          "export function steps() { return count; }",
        ].join("\n"),
      },
    );
    // Exported, reachable, never iterated.
    expect(exports["counted"]).toBeDefined();
    expect((exports["observed"] as (ignored: number) => number)(0)).toBe(0);
  });

  test("opening a cursor without advancing it forces nothing", async () => {
    const exports = await run(
      [["/main.hex",
        "extern from \"probe\"\n" +
        "    pure fun note(value: Int): Int\n" +
        "    fun steps(): Int\n" +
        "\n" +
        "export let counted: Seq(Int) =\n" +
        "    Seq.map(Seq.take(Seq.successors(1, x => x + 1), 3), note)\n" +
        "export let observed(ignored: Int): Int = steps!()\n"]],
      {
        probe: [
          "let count = 0;",
          "export function note(value) { count += 1; return value; }",
          "export function steps() { return count; }",
        ].join("\n"),
      },
    );
    (exports["counted"] as Iterable<number>)[Symbol.iterator]();
    expect((exports["observed"] as (ignored: number) => number)(0)).toBe(0);
  });
});

describe("§9.4 property 4: failure is memoized per position", () => {
  /**
   * "If forcing a position throws, every later foreign observation of that
   * position replays the same thrown value and the underlying computation is
   * not re-run" — uniformly with §7.1, which the inbound spine already
   * delivers for the internal channel (defect 15).
   */
  test("a throwing position replays the same value and is not re-run", async () => {
    const exports = await run(
      [["/main.hex",
        "extern from \"probe\"\n" +
        "    pure fun risky(value: Int): Int\n" +
        "    fun attempts(): Int\n" +
        "\n" +
        "export let counted: Seq(Int) =\n" +
        "    Seq.map(Seq.take(Seq.successors(1, x => x + 1), 3), risky)\n" +
        "export let tried(ignored: Int): Int = attempts!()\n"]],
      {
        probe: [
          "let calls = 0;",
          "export function attempts() { return calls; }",
          "export function risky(value) {",
          "  calls += 1;",
          "  if (value === 2) throw new Error('boom ' + calls);",
          "  return value;",
          "}",
        ].join("\n"),
      },
    );
    const counted = exports["counted"] as Iterable<number>;
    const thrown: unknown[] = [];
    for (const _attempt of [0, 1]) {
      try {
        [...counted];
      } catch (error) {
        thrown.push(error);
      }
    }
    expect(thrown).toHaveLength(2);
    // Identity, not equality: a re-run that happened to throw a look-alike
    // would pass an equality check and must not pass this one.
    expect(thrown[0]).toBe(thrown[1]);
    // Two successful calls plus the one that threw, and nothing re-run.
    expect((exports["tried"] as (ignored: number) => number)(0)).toBe(2);
  });
});

describe("§9.4 property 5: laziness survives the view", () => {
  test("an infinite Seq forces only what a cursor reaches", async () => {
    const exports = await main(
      "export let naturals: Seq(Int) = Seq.successors(1, x => x + 1)\n",
    );
    const naturals = exports["naturals"] as Iterable<number>;
    const taken: number[] = [];
    for (const value of naturals) {
      taken.push(value);
      if (taken.length === 4) break;
    }
    expect(taken).toEqual([1, 2, 3, 4]);
  });
});

describe("§9.4 property 6: an early return() ends that cursor only", () => {
  test("the value and the view stay valid after one cursor is abandoned", async () => {
    const exports = await main(
      "export let counted: Seq(Int) = Seq.take(Seq.successors(1, x => x + 1), 5)\n",
    );
    const counted = exports["counted"] as Iterable<number>;
    const abandoned = counted[Symbol.iterator]();
    expect(abandoned.next().value).toBe(1);
    expect(abandoned.next().value).toBe(2);
    abandoned.return?.(undefined);
    expect(abandoned.next().done).toBe(true);
    // A `break` out of a `for...of` is the same thing, spelt as JS writes it.
    for (const value of counted) {
      expect(value).toBe(1);
      break;
    }
    // Both other traversals see the whole sequence, from the head.
    expect([...counted]).toEqual([1, 2, 3, 4, 5]);
    expect([...counted]).toEqual([1, 2, 3, 4, 5]);
  });

  test("abandoning a cursor over a foreign source does not close it", async () => {
    // §8: early loop exit must not call the shared `return()`. The source stays
    // usable for every other cursor over the same value.
    const exports = await run(
      [["/main.hex",
        "extern from \"numbers\"\n" +
        "    fun counter(): Seq(Int)\n" +
        "    fun closes(): Int\n" +
        "\n" +
        "export let adapted: Seq(Int) = counter!()\n" +
        "export let closed(ignored: Int): Int = closes!()\n"]],
      {
        numbers: [
          "let closures = 0;",
          "export function closes() { return closures; }",
          "export function counter() {",
          "  let index = 0;",
          "  return { [Symbol.iterator]() {",
          "    return {",
          "      next() { index += 1; return index > 3 ? { done: true } : { done: false, value: index }; },",
          "      return() { closures += 1; return { done: true }; },",
          "    };",
          "  } };",
          "}",
        ].join("\n"),
      },
    );
    const adapted = exports["adapted"] as Iterable<number>;
    for (const _value of adapted) break;
    expect((exports["closed"] as (ignored: number) => number)(0)).toBe(0);
    expect([...adapted]).toEqual([1, 2, 3]);
  });
});

describe("§9.4 property 7: the view lives and dies with the value", () => {
  /**
   * "Retention follows §5's addendum: the view lives and dies with the value."
   *
   * The mechanism is a `WeakMap` in the shared method's closure, keyed by the
   * `Seq`. Weak *keys* are not the whole story: the entry's **value** — the
   * view, whose spine drives the key — strongly references the key, which is
   * the textbook ephemeron cycle. If the engine (or a future change to where
   * the view is stored) held that entry strongly, every `Seq` JavaScript ever
   * traversed would be immortal, and §5's "no cache limit may evict reachable
   * history" would have quietly become "nothing is ever reclaimed".
   *
   * `collectGarbage` above exposes and withdraws `--expose-gc` in-process, so
   * this runs on every ordinary `vitest run` — deliberately not skipped behind
   * a flag check, because a property pinned only sometimes is not pinned.
   */
  test("the traversed value is collected once the program drops it", async () => {
    const exports = await main(
      "export let countedTo(limit: Int): Seq(Int) =\n" +
      "    Seq.take(Seq.successors(1, x => x + 1), limit)\n",
    );
    const countedTo = exports["countedTo"] as (limit: number) => Iterable<number>;
    // Built by a call, not exported as a value: a module-level export is
    // retained by its own namespace object forever, so it could never be
    // collected and the test could never fail.
    //
    // Traversed inside a nested scope, and never named in this one, so no local
    // — and no spread temporary — is still holding it when the collection runs.
    const reference = ((): WeakRef<object> => {
      const sequence = countedTo(50);
      expect([...sequence]).toHaveLength(50);
      return new WeakRef(sequence as object);
    })();
    expect(reference.deref()).toBeDefined();
    // A turn of the event loop before collecting: the traversal's frames have to
    // be gone, not merely unreachable from source.
    await yieldToEventLoop();
    await collectGarbage();
    await collectGarbage();
    expect(reference.deref()).toBeUndefined();
  });

  test("traversal attaches nothing to the value", async () => {
    // The deterministic half, and the reason the collection above is possible:
    // the view is never a slot on the record, so a traversed `Seq` is the same
    // shape as an untraversed one — nothing on the value can outlive it.
    const exports = await main(
      "export let counted: Seq(Int) = Seq.take(Seq.successors(1, x => x + 1), 3)\n",
    );
    const counted = exports["counted"] as Iterable<number> & object;
    const before = [
      ...Object.getOwnPropertyNames(counted),
      ...Object.getOwnPropertySymbols(counted).map(String),
    ].sort();
    expect([...counted]).toEqual([1, 2, 3]);
    expect([...counted]).toEqual([1, 2, 3]);
    const after = [
      ...Object.getOwnPropertyNames(counted),
      ...Object.getOwnPropertySymbols(counted).map(String),
    ].sort();
    expect(after).toEqual(before);
    // And what it carries is exactly the representation: the protocol and the
    // face, nothing else.
    expect(before).toEqual(["Symbol(Symbol.iterator)", "pull"]);
  });
});

describe("§9.4 channel separation: internal traversal never uses the face", () => {
  /**
   * "Hexagon-internal traversal drives the §6.2 protocol (`pull`) and **never**
   * the boundary traversal method; it neither creates nor consults the boundary
   * view. The internal persistence default (re-derivation) is therefore
   * untouched by this ruling."
   *
   * The sharp form: the *same value* must re-derive when Hexagon re-traverses
   * it and replay memoized outcomes when JavaScript re-traverses it.
   */
  test("two internal traversals re-derive; two foreign traversals do not", async () => {
    const exports = await run(
      [["/main.hex",
        "extern from \"probe\"\n" +
        "    pure fun note(value: Int): Int\n" +
        "    fun steps(): Int\n" +
        "\n" +
        "let shared: Seq(Int) = Seq.map(Seq.take(Seq.successors(1, x => x + 1), 3), note)\n" +
        "\n" +
        "export let internally(ignored: Int): Int = Seq.length(shared)\n" +
        "export let observed(ignored: Int): Int = steps!()\n" +
        "export let exported: Seq(Int) = shared\n"]],
      {
        probe: [
          "let count = 0;",
          "export function note(value) { count += 1; return value; }",
          "export function steps() { return count; }",
        ].join("\n"),
      },
    );
    const internally = exports["internally"] as (ignored: number) => number;
    const observed = exports["observed"] as (ignored: number) => number;
    // Internal: re-derivation, the Loops §6.4 default. Three steps each time.
    expect(internally(0)).toBe(3);
    expect(observed(0)).toBe(3);
    expect(internally(0)).toBe(3);
    expect(observed(0)).toBe(6);
    // Foreign traversals of the same value memoize — and, being a separate
    // channel, they start their own view rather than inheriting either count.
    const exported = exports["exported"] as Iterable<number>;
    expect([...exported]).toEqual([1, 2, 3]);
    expect(observed(0)).toBe(9);
    expect([...exported]).toEqual([1, 2, 3]);
    expect(observed(0)).toBe(9);
    // And an internal traversal afterwards still re-derives: it never consults
    // the view the foreign traversals built.
    expect(internally(0)).toBe(3);
    expect(observed(0)).toBe(12);
  });

  test("two `for x in` traversals of one Seq re-derive", async () => {
    // The claim in its runtime form, and the sharper of the two: if `for x in`
    // were lowered to native `for...of` over the record, the loop would drive
    // the boundary view and a second traversal would replay memoized elements
    // instead of re-deriving — 3 derivations across both loops rather than 6.
    // The emitted-text test below pins the same thing at the lowering; this
    // pins what a program would actually observe.
    const exports = await run(
      [["/main.hex",
        "extern from \"probe\"\n" +
        "    pure fun note(value: Int): Int\n" +
        "    fun steps(): Int\n" +
        "\n" +
        "let counted: Seq(Int) = Seq.map(Seq.take(Seq.successors(1, x => x + 1), 3), note)\n" +
        "\n" +
        "export let sumTwice(ignored: Int): Int =\n" +
        "    var sum = 0\n" +
        "    for value in counted\n" +
        "        sum := sum + value\n" +
        "    for value in counted\n" +
        "        sum := sum + value\n" +
        "    sum\n" +
        "\n" +
        "export let observed(ignored: Int): Int = steps!()\n"]],
      {
        probe: [
          "let count = 0;",
          "export function note(value) { count += 1; return value; }",
          "export function steps() { return count; }",
        ].join("\n"),
      },
    );
    expect((exports["sumTwice"] as (ignored: number) => number)(0)).toBe(12);
    expect((exports["observed"] as (ignored: number) => number)(0)).toBe(6);
  });

  test("`for x in` is not lowered to native for...of over the record", () => {
    // Lowering the loop to `for (const x of sequence)` would silently import
    // boundary memoization, and its retention, into internal semantics. Pinned
    // at the lowering as well as at runtime (above), because this is the exact
    // sentence §9.4 makes normative — "an emitter must not lower `for x in` to
    // native `for...of` over the record" — and a reader changing that line
    // should meet it here.
    const project = compileProject([
      new Source.File(
        Source.fileId(0),
        "/main.hex",
        "export let total(source: Seq(Int)): Int =\n" +
        "    var sum = 0\n" +
        "    for value in source\n" +
        "        sum := sum + value\n" +
        "    sum\n",
      ),
    ]);
    expect(project.diagnostics).toEqual([]);
    const javascript = project.modules
      .find((module) => module.source.path === "/main.hex")!
      .javascript.text;
    expect(javascript).toContain("__hex_seqToIterable(source)");
  });
});

describe("occasion 1's wrapper is transparent to Hexagon importers (§9.4)", () => {
  /**
   * "Hexagon importers reach the export through the same ESM binding and
   * therefore the same wrapper; the identity pass-through makes it semantically
   * transparent to them, at the price of one recognition check per `Seq`-typed
   * argument per cross-module call."
   *
   * This is the load-bearing claim of the parameter position, and the one that
   * sank the rejected dual-binding alternative (§9.6 item 1). It is checked
   * across a real module boundary, not within one, because same-module calls
   * bind the internal function and never touch the wrapper.
   */
  test("a Hexagon importer's call through the wrapper still works", async () => {
    // Deliberately only a smoke test, and named as one. Both assertions below
    // hold under re-adaptation too — `seqFromIterable` of a genuine `Seq`
    // yields a working sequence with the same elements — so this cannot
    // distinguish identity from adaptation, and the test that can is the next
    // one. What it does pin is that inserting the wrapper into every
    // cross-module call did not break the call.
    const exports = await run([
      ["/lib.hex",
        "export let firstOf(source: Seq(Int)): Option(Int) =\n" +
        "    match Seq.next(source)\n" +
        "        None => None\n" +
        "        Some((value, _)) => Some(value)\n" +
        "\n" +
        "export let identical(left: Seq(Int), right: Seq(Int)): Bool =\n" +
        "    Seq.length(left) == Seq.length(right)\n"],
      ["/main.hex",
        "import { firstOf, identical } from \"./lib.hex\"\n" +
        "\n" +
        "let shared: Seq(Int) = Seq.take(Seq.successors(1, x => x + 1), 3)\n" +
        "\n" +
        "export let head: Option(Int) = firstOf(shared)\n" +
        "export let same: Bool = identical(shared, shared)\n"],
    ]);
    expect(exports["head"]).toEqual({ tag: "Some", value: 1 });
    expect(exports["same"]).toBe(true);
  });

  test("a Seq crossing a Hexagon module boundary is not re-adapted", async () => {
    // The identity claim, in the only form that can fail. If the door re-adapted
    // a genuine `Seq` instead of passing it by identity, a round trip through an
    // importing module would silently swap the value's persistence regime from
    // re-derivation to memoization — §2.2's stated reason for choosing identity —
    // and the derivation count below would read 3 rather than 6.
    const exports = await run(
      [
        ["/lib.hex",
          "export let twice(source: Seq(Int)): Int = Seq.length(source) + Seq.length(source)\n"],
        ["/main.hex",
          "import { twice } from \"./lib.hex\"\n" +
          "extern from \"probe\"\n" +
          "    pure fun note(value: Int): Int\n" +
          "    fun steps(): Int\n" +
          "\n" +
          "let counted: Seq(Int) = Seq.map(Seq.take(Seq.successors(1, x => x + 1), 3), note)\n" +
          "\n" +
          "export let total: Int = twice(counted)\n" +
          "export let observed(ignored: Int): Int = steps!()\n"],
      ],
      {
        probe: [
          "let count = 0;",
          "export function note(value) { count += 1; return value; }",
          "export function steps() { return count; }",
        ].join("\n"),
      },
    );
    expect(exports["total"]).toBe(6);
    // Two internal traversals of the same value, each deriving all three.
    expect((exports["observed"] as (ignored: number) => number)(0)).toBe(6);
  });

  test("a constrained export's specializations take the wrapper; the internal edition does not", async () => {
    // Part 7 §7's edit note: occasion 1 follows the *published face*. A
    // constrained export's face is its fundamental specializations; the
    // trailing-evidence generic edition ships under an internal name that
    // appears in no `.d.ts`, so a door there would tax every cross-module
    // Hexagon constrained call to serve a caller the face says does not exist.
    const source =
      "export let total<a: Num>(source: Seq(a), start: a): a =\n" +
      "    Seq.fold(source, start, (x, y) => x + y)\n";
    const project = compileProject([
      new Source.File(Source.fileId(0), "/main.hex", source),
    ]);
    expect(project.diagnostics).toEqual([]);
    const compiled = project.modules.find((module) => module.source.path === "/main.hex")!;
    const javascript = compiled.javascript.text;
    // Every specialization the face publishes is wrapped, and named as itself.
    for (const instance of ["totalNat", "totalInt", "totalFloat", "totalBigInt"]) {
      expect(compiled.declarations.text).toContain(`export declare function ${instance}(`);
      expect(javascript).toMatch(
        new RegExp(
          `const (\\w+) = \\(__hex_argument0, __hex_argument1\\) => ` +
            `${instance}\\(__hex_seqInbound\\(__hex_argument0\\), __hex_argument1\\);\\n` +
            `export \\{ \\1 as ${instance} \\};`,
          "u",
        ),
      );
    }
    // The internal edition is exported raw, and is absent from the face.
    expect(javascript).toMatch(/^export \{ total as __hex_export\d+ \};$/mu);
    expect(compiled.declarations.text).not.toContain("__hex_export");
    // And a specialization really accepts what its face invites.
    const exports = await main(source);
    const totalInt = exports["totalInt"] as (source: Iterable<number>, start: number) => number;
    expect(totalInt([1, 2, 3], 10)).toBe(16);
    expect(totalInt(new Set([4, 5]), 0)).toBe(9);
  });

  test("the wrapper is allocated once with the binding, not per reference", async () => {
    // §7: "allocated once with the ESM binding, not per reference or call, so
    // its JS identity is stable". Reading the export twice off the module
    // namespace cannot observe this — that comparison holds for *any* emission,
    // so it would be a test that cannot fail. What can fail is the shape: one
    // module-level `const`, bound once, exported by name. A per-reference or
    // per-call wrapper would emit the arrow at each use site instead.
    const source =
      "export let total(values: Seq(Int)): Int = Seq.fold(values, 0, (a, b) => a + b)\n" +
      "export let alsoTotal(values: Seq(Int)): Int = total(values)\n";
    const project = compileProject([
      new Source.File(Source.fileId(0), "/main.hex", source),
    ]);
    expect(project.diagnostics).toEqual([]);
    const javascript = project.modules
      .find((module) => module.source.path === "/main.hex")!
      .javascript.text;
    const declarations = [...javascript.matchAll(/^const (\w+Boundary\d+) = /gmu)];
    // Two exported functions with a `Seq` parameter, and `alsoTotal`'s call to
    // `total` binds the internal name — so exactly two wrappers, not three.
    expect(declarations).toHaveLength(2);
    expect(new Set(declarations.map(([, name]) => name)).size).toBe(2);
    // And each is named exactly once more, by its export statement.
    for (const [, name] of declarations) {
      expect(javascript.split(name!).length - 1).toBe(2);
    }
    const exports = await main(source);
    expect((exports["total"] as (values: Iterable<number>) => number)([1, 2, 3])).toBe(6);
  });
});

describe("§9.4 R1: the representation family is four, and nothing else knows", () => {
  test("a user module names the record's shape nowhere outside the helpers", () => {
    // The family is `seqFromIterable`, `seqToIterable`, `seqIterate`, and
    // `seqInbound`, all in one runtime-helper home. `pull` may appear in
    // `Seq.hex`'s own emitted body — that is `.hex` source, which owns the
    // record — but nowhere in a user module outside the helper block.
    const project = compileProject([
      new Source.File(
        Source.fileId(0),
        "/main.hex",
        "export let counted: Seq(Int) = Seq.take(Seq.successors(1, x => x + 1), 3)\n" +
        "export let total(source: Seq(Int)): Int = Seq.fold(source, 0, (a, b) => a + b)\n",
      ),
    ]);
    expect(project.diagnostics).toEqual([]);
    const javascript = project.modules
      .find((module) => module.source.path === "/main.hex")!
      .javascript.text;
    // The helper block ends where the module's own imports begin. Asserted, not
    // assumed: a missing marker would make `slice` take the last character and
    // the two checks below would pass on anything.
    const bodyStart = javascript.indexOf("\nimport ");
    expect(bodyStart).toBeGreaterThan(0);
    const body = javascript.slice(bodyStart);
    expect(body).not.toContain("pull");
    expect(body).not.toContain("Symbol.iterator");
  });
});
