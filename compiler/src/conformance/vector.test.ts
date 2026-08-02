import { describe, expect, test } from "vitest";

import { compileProject, Source } from "../index";
import vectorSource from "../../../stdlib/Vector.hex?raw";

/**
 * Behavioural conformance for `Vector(a)` (Collections Part 3). Assertions are on
 * the *results* of operations — never the internal representation — so they hold
 * for any spec-following implementation: today's plain-array backing and the
 * persistent 32-way trie deque it must become (§4). Cross-construction `==`
 * (§8) is the representation-leak detector: a value built by prepends must equal
 * the same value built by appends, and a round-trip must equal its origin — full
 * element-by-element scans, not spot checks. Boundary sizes straddle the 32-branch
 * factor (and its square) so a real trie's level transitions are exercised.
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

/** Compiles a program (entry `/main.hex` plus any extra modules) and returns the entry's exports. */
async function run(
  source: string,
  extras: readonly (readonly [string, string])[] = [],
): Promise<Record<string, unknown>> {
  const files = [
    ...extras.map(([path, text], index) => new Source.File(Source.fileId(index + 1), path, text)),
    new Source.File(Source.fileId(0), "/main.hex", source),
  ];
  const project = compileProject(files);
  expect(project.diagnostics).toEqual([]);
  const main = project.modules.find(({ source: file }) => file.path === "/main.hex")!;
  expect(main.typed.diagnostics).toEqual([]);
  expect(main.javascript.diagnostics).toEqual([]);
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

// Fixture builders. `appendBuild`/`prependBuild` both produce [1, 2, ..., n], via the
// tail path and the origin path respectively — so `prependBuild(n) == appendBuild(n)`
// checks both ends agree element-for-element. `weaveBuild` interleaves both ends.
// `var`+`for` is the spec-blessed accumulate-in-a-loop idiom (Loops §6.3): there is no
// fold in v1 and recursion is avoided (stack). The counting loop `for i in 1..n` is
// constant-stack (Loops §8), so these are safe at 32K.
const BUILDERS =
  "fun appendBuild(n: Int): Vector(Int) = Vector.fromSeq(Seq.iterate(1, x => x + 1).take(n))\n" +
  "fun prependBuild(n: Int): Vector(Int) =\n" +
  "    var acc: Vector(Int) = []\n" +
  "    for i in 1..n\n" +
  "        acc := Vector.prepend(acc, n - i + 1)\n" +
  "    acc\n" +
  "fun weaveBuild(n: Int): Vector(Int) =\n" +
  "    var acc: Vector(Int) = []\n" +
  "    for i in 1..n\n" +
  "        acc := if Int.mod(i, 2) == 0 then Vector.append(acc, i) else Vector.prepend(acc, i)\n" +
  "    acc\n";

describe("Vector specification conformance", () => {
  test("§7 size and emptiness across the 32-branch boundaries", async () => {
    const m = await run(
      BUILDERS +
        [0, 1, 31, 32, 33, 63, 64, 65, 1024, 1025, 1056].map((n) =>
          `export let s${n}: Int = Vector.length(appendBuild(${n}))\n`
        ).join("") +
        "export let empty0: Bool = Vector.isEmpty(appendBuild(0))\n" +
        "export let empty1: Bool = Vector.isEmpty(appendBuild(1))\n",
    );
    for (const n of [0, 1, 31, 32, 33, 63, 64, 65, 1024, 1025, 1056]) {
      expect(m[`s${n}`]).toBe(n);
    }
    expect(m.empty0).toBe(true);
    expect(m.empty1).toBe(false);
  });

  test("§8 cross-construction equality is the representation-leak detector", async () => {
    const m = await run(
      BUILDERS +
        "export let literal: Bool = appendBuild(3) == [1, 2, 3]\n" +
        "export let ends65: Bool = prependBuild(65) == appendBuild(65)\n" +
        // 1056 > 32² forces a 3-level trie; a 32³ full-scan is re-addable once the
        // trie makes prepend O(log n) (on the plain array it is O(n²) and slow).
        "export let ends1056: Bool = prependBuild(1056) == appendBuild(1056)\n" +
        // TODO(trie): re-add a 32³ (=32768) full-scan once prepend is O(log n);
        // on the plain array prependBuild is O(n²) and too slow for the suite.
        "export let weave5: Bool = weaveBuild(5) == [5, 3, 1, 2, 4]\n" +
        // Independent reconstruction of the interleave (fromSeq + concat, no weave
        // loop) so a deterministically-wrong interleave can't pass by self-consistency:
        // weave prepends odds (=> descending front) then appends evens.
        "export let weaveIndep: Bool = weaveBuild(200) == " +
        "(Vector.fromSeq(Seq.iterate(199, x => x - 2).take(100)) ++ " +
        "Vector.fromSeq(Seq.iterate(2, x => x + 2).take(100)))\n" +
        "export let diffFirst: Bool = [1, 2, 3] != [9, 2, 3]\n" +
        "export let diffMid: Bool = [1, 2, 3] != [1, 9, 3]\n" +
        "export let diffLast: Bool = [1, 2, 3] != [1, 2, 9]\n" +
        "export let diffLen: Bool = [1, 2, 3] != [1, 2]\n" +
        // Deep inequality: guards a trie `Eq` whose structural-sharing fast path
        // wrongly reports equality when a single deep element differs.
        "export let deepDiff: Bool = appendBuild(1056) != Vector.set(appendBuild(1056), 517, 0)\n",
    );
    expect(m.literal).toBe(true);
    expect(m.ends65).toBe(true);
    expect(m.ends1056).toBe(true); // full 3-level scan, both build paths agree
    expect(m.weave5).toBe(true);
    expect(m.weaveIndep).toBe(true);
    expect(m.diffFirst).toBe(true);
    expect(m.diffMid).toBe(true);
    expect(m.diffLast).toBe(true);
    expect(m.diffLen).toBe(true);
    expect(m.deepDiff).toBe(true);
  });

  test("§4 Seq round-trip equals its origin (full scan)", async () => {
    const m = await run(
      BUILDERS +
        "export let round1056: Bool = Vector.fromSeq(Vector.toSeq(appendBuild(1056))) == appendBuild(1056)\n" +
        "export let roundWeave: Bool = Vector.fromSeq(Vector.toSeq(weaveBuild(200))) == weaveBuild(200)\n",
    );
    expect(m.round1056).toBe(true);
    expect(m.roundWeave).toBe(true);
  });

  test("§5 bracket and signed `at`, deep into the trie", async () => {
    const m = await run(
      BUILDERS +
        "export let brFirst: Int = appendBuild(33)[1]\n" +
        "export let brLast: Int = appendBuild(33)[33]\n" +
        "export let brDeep: Int = appendBuild(1056)[1000]\n" +
        "export let atNegLast: Int = Vector.at(appendBuild(1025), -1)\n" +
        "export let atNegFirst: Int = Vector.at(appendBuild(1025), -1025)\n" +
        "export let atPosLast: Int = Vector.at(appendBuild(1025), 1025)\n",
    );
    expect(m.brFirst).toBe(1);
    expect(m.brLast).toBe(33);
    expect(m.brDeep).toBe(1000);
    expect(m.atNegLast).toBe(1025);
    expect(m.atNegFirst).toBe(1);
    expect(m.atPosLast).toBe(1025);
  });

  test("§4 set is persistent: the original is never mutated", async () => {
    const m = await run(
      BUILDERS +
        "let big = appendBuild(1056)\n" +
        "let updated = Vector.set(big, 1000, 9999)\n" +
        "export let origAt: Int = Vector.at(big, 1000)\n" +
        "export let updAt: Int = Vector.at(updated, 1000)\n" +
        "export let origUnchanged: Bool = big == appendBuild(1056)\n" +
        "export let neighboursIntact: Bool = Vector.at(updated, 999) == 999 and Vector.at(updated, 1001) == 1001\n" +
        "export let setFirst: Int = Vector.at(Vector.set(big, 1, 7), 1)\n" +
        "export let setLast: Int = Vector.at(Vector.set(big, 1056, 7), 1056)\n",
    );
    expect(m.origAt).toBe(1000);
    expect(m.updAt).toBe(9999);
    expect(m.origUnchanged).toBe(true);
    expect(m.neighboursIntact).toBe(true);
    expect(m.setFirst).toBe(7);
    expect(m.setLast).toBe(7);
  });

  test("§2 append and prepend grow at both ends", async () => {
    const m = await run(
      BUILDERS +
        "export let appEnd: Int = Vector.at(Vector.append(appendBuild(32), 99), 33)\n" +
        "export let appSize: Int = Vector.length(Vector.append(appendBuild(1024), 99))\n" +
        "export let preStart: Int = Vector.at(Vector.prepend(appendBuild(32), 99), 1)\n" +
        "export let preShift: Int = Vector.at(Vector.prepend(appendBuild(1024), 99), 2)\n" +
        "export let preSize: Int = Vector.length(Vector.prepend(appendBuild(1024), 99))\n",
    );
    expect(m.appEnd).toBe(99);
    expect(m.appSize).toBe(1025);
    expect(m.preStart).toBe(99);
    expect(m.preShift).toBe(1);
    expect(m.preSize).toBe(1025);
  });

  test("§7 concat, rest pattern, and Show do not leak representation", async () => {
    const m = await run(
      BUILDERS +
        "export let cat: Bool = ([1, 2] ++ [3, 4]) == [1, 2, 3, 4]\n" +
        "export let catBig: Bool = (appendBuild(1000) ++ appendBuild(56)) == (appendBuild(1000) ++ appendBuild(56))\n" +
        "export let restHead: Int = match appendBuild(33)\n    [x, ...rest] => x\n    [] => 0\n" +
        "export let restRestSize: Int = match appendBuild(33)\n    [x, ...rest] => Vector.length(rest)\n    [] => 0\n" +
        "export let shown: String = \"${[1, 2, 3]}\"\n",
    );
    expect(m.cat).toBe(true);
    expect(m.catBig).toBe(true);
    expect(m.restHead).toBe(1);
    expect(m.restRestSize).toBe(32);
    expect(m.shown).toBe("[1, 2, 3]");
  });

  test("§6 slicing clamps windows and never reverses", async () => {
    const m = await run(
      BUILDERS +
        "export let window: Bool = [10, 20, 30][2..3] == [20, 30]\n" +
        "export let clamp: Bool = [10, 20, 30][2..99] == [20, 30]\n" +
        "export let outOfWindow: Bool = [10, 20, 30][5..9] == []\n" +
        "export let emptyAscending: Bool = [10, 20, 30][3..1] == []\n",
    );
    expect(m.window).toBe(true);
    expect(m.clamp).toBe(true);
    expect(m.outOfWindow).toBe(true);
    expect(m.emptyAscending).toBe(true);
  });

  test("§5 out-of-range access throws IndexError with the index as passed", async () => {
    await expect(
      run(BUILDERS + "export let bad: Int = Vector.at(appendBuild(3), 99)\n"),
    ).rejects.toMatchObject({ name: "IndexError", index: 99, size: 3 });
    await expect(
      run(BUILDERS + "export let bad: Int = Vector.at(appendBuild(3), -9)\n"),
    ).rejects.toMatchObject({ name: "IndexError", index: -9, size: 3 });
    await expect( // §5.3 dead zone: index 0 is never an address
      run(BUILDERS + "export let bad: Int = Vector.at(appendBuild(3), 0)\n"),
    ).rejects.toMatchObject({ name: "IndexError", index: 0, size: 3 });
    await expect( // §5.1 brackets reject negatives (signed access is `at`-only)
      run(BUILDERS + "export let bad: Int = appendBuild(3)[-1]\n"),
    ).rejects.toMatchObject({ name: "IndexError", index: -1, size: 3 });
    await expect( // §5.4 set asserts the slot exists
      run(BUILDERS + "export let bad: Vector(Int) = Vector.set(appendBuild(3), 99, 0)\n"),
    ).rejects.toMatchObject({ name: "IndexError", index: 99, size: 3 });
  });
});

// Companion surface from stdlib/Vector.hex (the real module, loaded via ?raw), not the
// core intrinsics. Thin wrappers, but pinned so the trie rewrite can't break them.
const COMPANION_MAIN =
  'import * as Vector from "./Vector"\n' +
  "let three: Vector(Int) = [1, 2, 3]\n" +
  "let none: Vector(Int) = []\n" +
  "export let firstFull: Int = match Vector.first(three)\n    Some(v) => v\n    None => 0 - 1\n" +
  "export let firstEmpty: Int = match Vector.first(none)\n    Some(v) => v\n    None => 0 - 1\n" +
  "export let lastFull: Int = match Vector.last(three)\n    Some(v) => v\n    None => 0 - 1\n" +
  "export let getIn: Int = match Vector.get(three, 2)\n    Some(v) => v\n    None => 0 - 1\n" +
  "export let getOut: Int = match Vector.get(three, 9)\n    Some(v) => v\n    None => 0 - 1\n" +
  "export let dropF: Bool = Vector.dropFirst(three) == [2, 3]\n" +
  "export let dropL: Bool = Vector.dropLast(three) == [1, 2]\n" +
  "export let single: Bool = Vector.singleton(7) == [7]\n";

describe("Vector companion conformance (stdlib/Vector.hex)", () => {
  test("§7 Option-returning and end-dropping companions", async () => {
    const m = await run(COMPANION_MAIN, [["/Vector.hex", vectorSource]]);
    expect(m.firstFull).toBe(1);
    expect(m.firstEmpty).toBe(-1);
    expect(m.lastFull).toBe(3);
    expect(m.getIn).toBe(2);
    expect(m.getOut).toBe(-1);
    expect(m.dropF).toBe(true);
    expect(m.dropL).toBe(true);
    expect(m.single).toBe(true);
  });
});
