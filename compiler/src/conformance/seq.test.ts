import { describe, expect, test } from "vitest";

import { compileProject, Source } from "../index";
import seqCoreSource from "../../../runtime/SeqCore.hex?raw";

/**
 * Behavioural conformance for the `Seq(a)` core (Loops §6, spec/notes/seq-core-representation.md).
 *
 * The first test in this file is a *poison test*: it feeds the harness a module
 * that cannot compile and asserts the harness says so. Before #78 `compileProject`
 * reported success for a project whose non-entry modules were broken, so a
 * conformance run over `stdlib/Seq.hex` could pass while `Seq.hex` never compiled
 * at all. The poison test is the standing proof that this channel is honest; if it
 * ever goes green-by-passing, every other assertion below is worthless.
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

/** Compiles entry `/main.hex` plus extras, and returns every diagnostic the project reports. */
function diagnose(
  source: string,
  extras: readonly (readonly [string, string])[] = [],
): readonly { readonly message: string }[] {
  const files = [
    ...extras.map(([path, text], index) => new Source.File(Source.fileId(index + 1), path, text)),
    new Source.File(Source.fileId(0), "/main.hex", source),
  ];
  return compileProject(files).diagnostics;
}

/** Compiles a program (entry `/main.hex` plus extras) and returns the entry's exports. */
async function run(
  source: string,
  extras: readonly (readonly [string, string])[] = [],
): Promise<Record<string, unknown>> {
  const files = [
    ...extras.map(([path, text], index) => new Source.File(Source.fileId(index + 1), path, text)),
    new Source.File(Source.fileId(0), "/main.hex", source),
  ];
  const project = compileProject(files);
  // The project-wide bag, not just the entry's: a broken *extra* must fail here.
  expect(project.diagnostics).toEqual([]);
  const moduleUrls = new Map<string, string>();
  for (const module of project.modules) {
    const linked = link(module.javascript.text, module.source.path, moduleUrls);
    moduleUrls.set(
      module.source.path,
      `data:text/javascript;charset=utf-8,${encodeURIComponent(linked)}`,
    );
  }
  return (await import(/* @vite-ignore */ moduleUrls.get("/main.hex")!)) as Record<string, unknown>;
}

describe("harness honesty (poison test)", () => {
  test("a broken non-entry module is reported by the project channel", () => {
    // `/Poison.hex` is deliberately ill-typed: `plus` claims `Int` and returns a
    // `String`. The entry is well-formed and never touches the bad binding, so a
    // harness that only inspected `/main.hex` would call this project clean.
    const poison =
      "export let plus(left: Int, right: Int): Int = \"not an Int\"\n";
    const entry =
      'import * as Poison from "./Poison"\n' +
      "export let ok: Int = 1\n";
    const diagnostics = diagnose(entry, [["/Poison.hex", poison]]);
    expect(diagnostics).not.toEqual([]);
  });

  test("`run` refuses a project whose non-entry module is broken", async () => {
    const poison =
      "export let plus(left: Int, right: Int): Int = \"not an Int\"\n";
    const entry =
      'import * as Poison from "./Poison"\n' +
      "export let ok: Int = 1\n";
    await expect(run(entry, [["/Poison.hex", poison]])).rejects.toThrow();
  });

  test("the same harness passes a project whose non-entry module is sound", async () => {
    const sound = "export let plus(left: Int, right: Int): Int = left + right\n";
    const entry =
      'import * as Sound from "./Sound"\n' +
      "export let three: Int = Sound.plus(1, 2)\n";
    const m = await run(entry, [["/Sound.hex", sound]]);
    expect(m.three).toBe(3);
  });
});

// The core module itself (runtime/SeqCore.hex, loaded via ?raw), mounted at
// /SeqCore.hex and driven from an entry module. Assertions are on *results*, never
// on the representation, so they survive the emitter rewiring `Seq(a)` onto this
// core at milestone 3.
const CORE: readonly (readonly [string, string])[] = [["/SeqCore.hex", seqCoreSource]];
const IMPORT = 'import * as Seq from "./SeqCore"\n';

/** `1, 2, 3, ...` — infinite, so any test using it also proves laziness. */
const NATURALS = "let naturals = Seq.iterate(1, x => x + 1)\n";

describe("SeqCore construction and the §6.2 protocol", () => {
  test("empty pulls None; singleton and cons pull one element then empty", async () => {
    const m = await run(
      IMPORT +
        "export let emptyIsNone: Bool = match Seq.next(Seq.empty)\n    None => true\n    Some(_) => false\n" +
        "export let singleHead: Int = match Seq.next(Seq.singleton(7))\n" +
        "    None => 0 - 1\n" +
        "    Some(pulled) =>\n        let (value, _) = pulled\n        value\n" +
        "export let singleTailEmpty: Bool = match Seq.next(Seq.singleton(7))\n" +
        "    None => false\n" +
        "    Some(pulled) =>\n        let (_, rest) = pulled\n" +
        "        match Seq.next(rest)\n            None => true\n            Some(_) => false\n" +
        "export let consHead: Int = match Seq.next(Seq.cons(1, Seq.singleton(2)))\n" +
        "    None => 0 - 1\n" +
        "    Some(pulled) =>\n        let (value, _) = pulled\n        value\n" +
        "export let consLength: Int = Seq.length(Seq.cons(1, Seq.singleton(2)))\n",
      CORE,
    );
    expect(m.emptyIsNone).toBe(true);
    expect(m.singleHead).toBe(7);
    expect(m.singleTailEmpty).toBe(true);
    expect(m.consHead).toBe(1);
    expect(m.consLength).toBe(2);
  });

  test("an infinite Seq is a finite value: constructing runs nothing", async () => {
    // If `iterate`/`map`/`filter` were eager, merely naming these would not
    // terminate. Nothing is driven until `take` + `length` ask for elements.
    const m = await run(
      IMPORT +
        NATURALS +
        "let doubled = Seq.map(naturals, x => x * 2)\n" +
        "let evens = Seq.filter(naturals, x => Int.mod(x, 2) == 0)\n" +
        "export let built: Bool = true\n" +
        "export let firstDoubled: Int = Seq.length(Seq.take(doubled, 3))\n" +
        "export let firstEvens: Int = Seq.length(Seq.take(evens, 3))\n",
      CORE,
    );
    expect(m.built).toBe(true);
    expect(m.firstDoubled).toBe(3);
    expect(m.firstEvens).toBe(3);
  });
});

describe("SeqCore one-step combinators", () => {
  test("map, take, takeWhile, and unfold", async () => {
    const m = await run(
      IMPORT +
        NATURALS +
        "let sum(source) = Seq.fold(source, 0, (total, value) => total + value)\n" +
        "export let mapped: Int = sum(Seq.take(Seq.map(naturals, x => x * 10), 3))\n" +
        "export let taken: Int = Seq.length(Seq.take(naturals, 5))\n" +
        "export let takeZero: Int = Seq.length(Seq.take(naturals, 0))\n" +
        "export let takeNegative: Int = Seq.length(Seq.take(naturals, 0 - 3))\n" +
        "export let takeOverrun: Int = Seq.length(Seq.take(Seq.singleton(1), 99))\n" +
        "export let whileSmall: Int = sum(Seq.takeWhile(naturals, x => x < 5))\n" +
        "export let whileNoneMatch: Int = Seq.length(Seq.takeWhile(naturals, x => x > 100))\n" +
        "let countdown = Seq.unfold(3, n => if n <= 0 then None else Some((n, n - 1)))\n" +
        "export let unfolded: Int = sum(countdown)\n" +
        "export let unfoldedLength: Int = Seq.length(countdown)\n",
      CORE,
    );
    expect(m.mapped).toBe(60); // 10 + 20 + 30
    expect(m.taken).toBe(5);
    expect(m.takeZero).toBe(0);
    expect(m.takeNegative).toBe(0);
    expect(m.takeOverrun).toBe(1);
    expect(m.whileSmall).toBe(10); // 1 + 2 + 3 + 4
    expect(m.whileNoneMatch).toBe(0);
    expect(m.unfolded).toBe(6); // 3 + 2 + 1
    expect(m.unfoldedLength).toBe(3);
  });

  test("zipWith and zip stop at the shorter side; concat joins in order", async () => {
    const m = await run(
      IMPORT +
        NATURALS +
        "let sum(source) = Seq.fold(source, 0, (total, value) => total + value)\n" +
        // zipping an infinite Seq against a finite one must terminate
        "export let zipped: Int = sum(Seq.zipWith(naturals, Seq.take(naturals, 3), (l, r) => l * r))\n" +
        "export let zippedLength: Int = Seq.length(Seq.zipWith(Seq.take(naturals, 2), naturals, (l, r) => l))\n" +
        "export let zipEmptyLeft: Int = Seq.length(Seq.zipWith(Seq.empty, naturals, (l, r) => l))\n" +
        // hoisted: a multi-line lambda cannot be written as a call argument
        "let addPair(pair: (Int, Int)): Int =\n    let (left, right) = pair\n    left + right\n" +
        "export let zipPairs: Int = sum(Seq.map(Seq.zip(Seq.take(naturals, 3), Seq.take(naturals, 3)), addPair))\n" +
        "export let joined: Int = Seq.length(Seq.concat(Seq.take(naturals, 2), Seq.take(naturals, 3)))\n" +
        "export let joinedOrder: Int = sum(Seq.take(Seq.concat(Seq.singleton(100), naturals), 3))\n" +
        "export let joinEmptyFirst: Int = Seq.length(Seq.concat(Seq.empty, Seq.take(naturals, 4)))\n" +
        "export let joinEmptyBoth: Int = Seq.length(Seq.concat(Seq.empty, Seq.empty))\n",
      CORE,
    );
    expect(m.zipped).toBe(14); // 1*1 + 2*2 + 3*3
    expect(m.zippedLength).toBe(2);
    expect(m.zipEmptyLeft).toBe(0);
    expect(m.zipPairs).toBe(12); // (1+1) + (2+2) + (3+3)
    expect(m.joined).toBe(5);
    expect(m.joinedOrder).toBe(103); // 100 + 1 + 2
    expect(m.joinEmptyFirst).toBe(4);
    expect(m.joinEmptyBoth).toBe(0);
  });
});

describe("SeqCore while-pull combinators", () => {
  test("filter, drop, dropWhile, and flatMap", async () => {
    const m = await run(
      IMPORT +
        NATURALS +
        "let sum(source) = Seq.fold(source, 0, (total, value) => total + value)\n" +
        "export let evens: Int = sum(Seq.take(Seq.filter(naturals, x => Int.mod(x, 2) == 0), 3))\n" +
        "export let filterNone: Int = Seq.length(Seq.filter(Seq.take(naturals, 10), x => x > 99))\n" +
        "export let filterAll: Int = Seq.length(Seq.filter(Seq.take(naturals, 10), x => true))\n" +
        "export let dropped: Int = sum(Seq.take(Seq.drop(naturals, 3), 2))\n" +
        "export let dropPastEnd: Int = Seq.length(Seq.drop(Seq.take(naturals, 3), 99))\n" +
        "export let dropZero: Int = Seq.length(Seq.drop(Seq.take(naturals, 3), 0))\n" +
        "export let dropWhileSmall: Int = sum(Seq.take(Seq.dropWhile(naturals, x => x < 5), 2))\n" +
        "export let dropWhileAll: Int = Seq.length(Seq.dropWhile(Seq.take(naturals, 5), x => true))\n" +
        // each element expands to that many copies of itself: 1, 2, 2, 3, 3, 3
        "export let flat: Int = sum(Seq.flatMap(Seq.take(naturals, 3), x => Seq.take(Seq.iterate(x, y => y), x)))\n" +
        "export let flatLength: Int = Seq.length(Seq.flatMap(Seq.take(naturals, 3), x => Seq.take(Seq.iterate(x, y => y), x)))\n" +
        // every inner sequence empty: flatMap must drain them all and report empty
        "export let flatAllEmpty: Int = Seq.length(Seq.flatMap(Seq.take(naturals, 20), x => Seq.empty))\n" +
        // leading empties must be skipped to reach a later non-empty inner
        "let lateOnly(x: Int) = if x < 6 then Seq.empty else Seq.singleton(42)\n" +
        "export let flatLeadingEmpties: Int = sum(Seq.flatMap(Seq.take(naturals, 6), lateOnly))\n",
      CORE,
    );
    expect(m.evens).toBe(12); // 2 + 4 + 6
    expect(m.filterNone).toBe(0);
    expect(m.filterAll).toBe(10);
    expect(m.dropped).toBe(9); // 4 + 5
    expect(m.dropPastEnd).toBe(0);
    expect(m.dropZero).toBe(3);
    expect(m.dropWhileSmall).toBe(11); // 5 + 6
    expect(m.dropWhileAll).toBe(0);
    expect(m.flat).toBe(14); // 1 + 2+2 + 3+3+3
    expect(m.flatLength).toBe(6);
    expect(m.flatAllEmpty).toBe(0);
    expect(m.flatLeadingEmpties).toBe(42);
  });

  test("§6.5 a long skip run is constant-stack, not recursion", async () => {
    // One `pull` of this filter must skip 49_999 elements before yielding. Self
    // recursion would overflow (Loops §6.5 promises no TCO); the `while` cursor
    // must not. The same for a flatMap draining 50_000 empty inner sequences.
    const m = await run(
      IMPORT +
        NATURALS +
        "export let deepFilter: Int = match Seq.next(Seq.filter(naturals, x => x >= 50000))\n" +
        "    None => 0 - 1\n" +
        "    Some(pulled) =>\n        let (value, _) = pulled\n        value\n" +
        "export let deepDropWhile: Int = match Seq.next(Seq.dropWhile(naturals, x => x < 50000))\n" +
        "    None => 0 - 1\n" +
        "    Some(pulled) =>\n        let (value, _) = pulled\n        value\n" +
        "export let deepDrop: Int = match Seq.next(Seq.drop(naturals, 50000))\n" +
        "    None => 0 - 1\n" +
        "    Some(pulled) =>\n        let (value, _) = pulled\n        value\n" +
        "export let deepFlatMap: Int = Seq.length(Seq.flatMap(Seq.take(naturals, 50000), x => Seq.empty))\n",
      CORE,
    );
    expect(m.deepFilter).toBe(50000);
    expect(m.deepDropWhile).toBe(50000);
    expect(m.deepDrop).toBe(50001);
    expect(m.deepFlatMap).toBe(0);
  });
});

describe("SeqCore consumers", () => {
  test("fold, length, find, any, and all", async () => {
    const m = await run(
      IMPORT +
        NATURALS +
        "let five = Seq.take(naturals, 5)\n" +
        "export let summed: Int = Seq.fold(five, 0, (total, value) => total + value)\n" +
        "export let foldOrder: Int = Seq.fold(Seq.take(naturals, 3), 0, (total, value) => total * 10 + value)\n" +
        "export let foldEmpty: Int = Seq.fold(Seq.empty, 99, (total, value) => total + value)\n" +
        "export let counted: Int = Seq.length(five)\n" +
        "export let countedEmpty: Int = Seq.length(Seq.empty)\n" +
        "export let found: Int = match Seq.find(naturals, x => x > 3)\n    None => 0 - 1\n    Some(value) => value\n" +
        "export let findMisses: Bool = match Seq.find(five, x => x > 99)\n    None => true\n    Some(_) => false\n" +
        "export let anyTrue: Bool = Seq.any(five, x => x == 3)\n" +
        "export let anyFalse: Bool = Seq.any(five, x => x == 99)\n" +
        "export let allTrue: Bool = Seq.all(five, x => x < 99)\n" +
        "export let allFalse: Bool = Seq.all(five, x => x < 3)\n" +
        "export let allEmpty: Bool = Seq.all(Seq.empty, x => false)\n" +
        "export let anyEmpty: Bool = Seq.any(Seq.empty, x => true)\n",
      CORE,
    );
    expect(m.summed).toBe(15);
    expect(m.foldOrder).toBe(123); // left fold, in order
    expect(m.foldEmpty).toBe(99);
    expect(m.counted).toBe(5);
    expect(m.countedEmpty).toBe(0);
    expect(m.found).toBe(4);
    expect(m.findMisses).toBe(true);
    expect(m.anyTrue).toBe(true);
    expect(m.anyFalse).toBe(false);
    expect(m.allTrue).toBe(true);
    expect(m.allFalse).toBe(false);
    expect(m.allEmpty).toBe(true); // vacuously
    expect(m.anyEmpty).toBe(false);
  });

  test("`find` and `any` short-circuit on an infinite Seq", async () => {
    // These terminate only because the consumers stop at the first match.
    const m = await run(
      IMPORT +
        NATURALS +
        "export let foundEarly: Int = match Seq.find(naturals, x => x == 7)\n" +
        "    None => 0 - 1\n    Some(value) => value\n" +
        "export let anyEarly: Bool = Seq.any(naturals, x => x == 7)\n" +
        "export let allStopsEarly: Bool = Seq.all(naturals, x => x < 7)\n",
      CORE,
    );
    expect(m.foundEarly).toBe(7);
    expect(m.anyEarly).toBe(true);
    expect(m.allStopsEarly).toBe(false);
  });
});

describe("SeqCore persistence", () => {
  test("§6.5 driving a Seq never consumes it: re-driving replays from the start", async () => {
    // Re-derivation, not memoization. Whichever policy is chosen, the *observable*
    // contract is the same: a `Seq` is a value, and driving it leaves it intact.
    const m = await run(
      IMPORT +
        NATURALS +
        "let five = Seq.take(naturals, 5)\n" +
        "let firstPass = Seq.length(five)\n" +
        "export let secondPass: Int = Seq.length(five)\n" +
        "export let bothAgree: Bool = firstPass == Seq.length(five)\n" +
        // a pipeline with a skip layer must also replay identically
        "let odds = Seq.filter(Seq.take(naturals, 20), x => Int.mod(x, 2) == 1)\n" +
        "let firstSum = Seq.fold(odds, 0, (total, value) => total + value)\n" +
        "export let replaySum: Bool = firstSum == Seq.fold(odds, 0, (total, value) => total + value)\n" +
        // a tail taken from a partial drive is independent of the parent
        "export let tailIndependent: Bool = match Seq.next(five)\n" +
        "    None => false\n" +
        "    Some(pulled) =>\n        let (_, rest) = pulled\n" +
        "        Seq.length(rest) == 4 and Seq.length(five) == 5\n",
      CORE,
    );
    expect(m.secondPass).toBe(5);
    expect(m.bothAgree).toBe(true);
    expect(m.replaySum).toBe(true);
    expect(m.tailIndependent).toBe(true);
  });
});
