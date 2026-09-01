/**
 * Conformance for the inbound `Stream(a)` crossing — FFI Part 3 §14.1, the raw
 * shim, landed with #364's un-flagging milestone.
 *
 * **The defect this closes.** Before the shim, an extern declared
 * `Stream(Int)` compiled clean and handed the foreign iterator straight to
 * `stdlib/Stream.hex`, which read `Option`-shaped answers off it and died on
 * the first pull with the emitter's match-miss `RangeError("Unexpected
 * pattern.")` — a lying face with no diagnostic anywhere. So every test here
 * **executes** the emitted program: a boundary that only reads right is exactly
 * what was already wrong.
 *
 * **What the shim is, stated as the tests check it.** Position declares intent
 * (§14): the same foreign object at a `Seq(a)` position takes §2's launder and
 * becomes replayable pure data, and here it crosses raw. So the interesting
 * assertions are all *absences* — no memoization, no failure memo, no latch on
 * exhaustion, no `return()`, no identity cache — and each is written as an
 * observation a JavaScript consumer of the same source would make. §2.1's
 * posture verbatim: the boundary preserves the foreign source's behavior rather
 * than strengthening it.
 *
 * The outbound face (§14.2) is deliberately absent and tracked as #384; nothing
 * here exercises a `Stream` leaving Hexagon.
 */

import { describe, expect, test } from "vitest";

import { compileProject, Source } from "../index";

/** Minimal ESM linker: compiler-owned relative imports become data-URL modules. */
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
 * byte-identical would share one instantiated module — and therefore one copy
 * of the foreign side's cursor. Every test here counts foreign steps, so each
 * run is stamped.
 */
let runTag = 0;

/** Compiles a project with foreign modules and executes it, returning `/main.hex`'s exports. */
async function run(
  source: string,
  foreign: Readonly<Record<string, string>>,
): Promise<Record<string, unknown>> {
  const project = compileProject([new Source.File(Source.fileId(0), "/main.hex", source)]);
  expect(project.diagnostics.map(({ message }) => message)).toEqual([]);
  runTag += 1;
  const url = (text: string): string =>
    `data:text/javascript;charset=utf-8,${encodeURIComponent(text)}#run${runTag}`;
  const moduleUrls = new Map<string, string>();
  for (const [specifier, text] of Object.entries(foreign)) moduleUrls.set(specifier, url(text));
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
  return (await import(/* @vite-ignore */ moduleUrls.get("/main.hex")!)) as Record<
    string,
    unknown
  >;
}

describe("§14.1 the crossing accepts what a single-pass source is", () => {
  /**
   * The cold reviewer's own program, and the exact shape that used to crash.
   *
   * A **bare iterator** — no `[Symbol.iterator]` anywhere on it. `Seq`'s
   * iterable-only rule (§9.2) is grounded in replay obligations a `Stream` does
   * not have, so §14.1 admits the cursor as the shape it already is.
   */
  test("a bare foreign iterator crosses, and pulls through `next!`", async () => {
    const exports = await run(
      'extern from "source"\n' +
      "    fun readings(): Stream(Int)\n" +
      "\n" +
      "export let drained(ignored: Int): Vector(Int) =\n" +
      "    let stream: Stream(Int) = readings!()\n" +
      "    var seen = Vector.empty\n" +
      "    var pulling = True\n" +
      "    while pulling\n" +
      "        match Stream.next!(stream)\n" +
      "            None => pulling := False\n" +
      "            Some(value) => seen := Vector.append(seen, value)\n" +
      "    seen\n",
      {
        source: [
          "export function readings() {",
          "  let index = 0;",
          "  return { next: () => index < 3 ? { value: ++index, done: false } : { done: true } };",
          "}",
        ].join("\n"),
      },
    );
    expect([...(exports["drained"] as (i: number) => readonly number[])(0)]).toEqual([1, 2, 3]);
  });

  test("the same source reaches `collect!`, the consumer the chapter leads with", async () => {
    const exports = await run(
      'extern from "source"\n' +
      "    fun readings(): Stream(Int)\n" +
      "\n" +
      "export let sample(ignored: Int): Vector(Int) = Stream.collect!(readings!(), 2)\n",
      {
        source: [
          "export function readings() {",
          "  let index = 0;",
          "  return { next: () => ({ value: ++index, done: false }) };",
          "}",
        ].join("\n"),
      },
    );
    // An endless bare iterator, bounded by `collect` — which is what §4.4 of
    // `stream.md` says bounded consumption is for, now reachable from a real
    // foreign source.
    expect([...(exports["sample"] as (i: number) => readonly number[])(0)]).toEqual([1, 2]);
  });

  test("an iterable crosses too, and its iterator is requested once, at the crossing", async () => {
    const exports = await run(
      'extern from "source"\n' +
      "    fun readings(): Stream(Int)\n" +
      "    fun acquisitions(): Int\n" +
      "\n" +
      "export let probe(ignored: Int): (Int, Vector(Int), Int) =\n" +
      "    let stream: Stream(Int) = readings!()\n" +
      "    let atCrossing: Int = acquisitions!()\n" +
      "    let drawn: Vector(Int) = Stream.collect!(stream, 3)\n" +
      "    (atCrossing, drawn, acquisitions!())\n",
      {
        source: [
          "let acquired = 0;",
          "export function acquisitions() { return acquired; }",
          "export function readings() {",
          "  return { [Symbol.iterator]() { acquired += 1; let i = 0;",
          "    return { next: () => i < 3 ? { value: ++i, done: false } : { done: true } };",
          "  } };",
          "}",
        ].join("\n"),
      },
    );
    const [atCrossing, drawn, afterPulls] =
      (exports["probe"] as (i: number) => readonly [number, readonly number[], number])(0);
    // Once, at the crossing — not deferred to the first pull the way §3 defers
    // the adapter's acquisition. A per-crossing shim has a crossing to do it at.
    expect(atCrossing).toBe(1);
    expect([...drawn]).toEqual([1, 2, 3]);
    // And not again: three pulls acquired nothing further.
    expect(afterPulls).toBe(1);
  });

  test("an extern `let` value takes the same door as a result", async () => {
    const exports = await run(
      'extern from "source"\n' +
      "    let readings: Stream(Int)\n" +
      "\n" +
      "export let sample(ignored: Int): Vector(Int) = Stream.collect!(readings, 2)\n",
      {
        source: [
          "let index = 0;",
          "export const readings = { next: () => ({ value: ++index, done: false }) };",
        ].join("\n"),
      },
    );
    expect([...(exports["sample"] as (i: number) => readonly number[])(0)]).toEqual([1, 2]);
  });

  test("repeated crossings of one iterator share its cursor, as two foreign consumers would", async () => {
    const exports = await run(
      'extern from "source"\n' +
      "    fun readings(): Stream(Int)\n" +
      "\n" +
      "export let twice(ignored: Int): (Vector(Int), Vector(Int)) =\n" +
      "    let earlier: Vector(Int) = Stream.collect!(readings!(), 2)\n" +
      "    let later: Vector(Int) = Stream.collect!(readings!(), 2)\n" +
      "    (earlier, later)\n",
      {
        source: [
          "let index = 0;",
          "const cursor = { next: () => ({ value: ++index, done: false }) };",
          "export function readings() { return cursor; }",
        ].join("\n"),
      },
    );
    const [earlier, later] =
      (exports["twice"] as (i: number) => readonly [readonly number[], readonly number[]])(0);
    // There is no identity cache and nothing is rewound: the second crossing
    // continues where the first stopped (§14.1's third bullet).
    expect([...earlier]).toEqual([1, 2]);
    expect([...later]).toEqual([3, 4]);
  });
});

describe("§14.1 the absences: nothing is manufactured, memoized, or strengthened", () => {
  /**
   * The sharpest of them, and the one most likely to be "fixed" by a later
   * reader who thinks it is a bug. §14.1 says a source that misbehaves after
   * exhaustion is Part 1 §3.1 territory *exactly as it would be to a JavaScript
   * consumer* — so the shim must NOT latch `None`.
   *
   * `stdlib/Stream.hex`'s own `fromSeq` cursor does keep answering `None`, and
   * that is not a latch either: it is the pure `Seq` position re-deriving the
   * same answer. Here the foreign cursor decides, and it is allowed to change
   * its mind.
   */
  test("an exhausted source is not latched — the next pull is whatever the cursor does", async () => {
    const exports = await run(
      'extern from "source"\n' +
      "    fun readings(): Stream(Int)\n" +
      "\n" +
      "let stream: Stream(Int) = readings!()\n" +
      "\n" +
      "export let pull(ignored: Int): Int =\n" +
      "    match Stream.next!(stream)\n" +
      "        None => 0\n" +
      "        Some(value) => value\n",
      {
        source: [
          "let step = 0;",
          "const answers = [",
          "  { value: 1, done: false },",
          "  { done: true },",
          "  { value: 9, done: false },",
          "];",
          "const cursor = { next: () => answers[step++] };",
          "export function readings() { return cursor; }",
        ].join("\n"),
      },
    );
    const pull = exports["pull"] as (i: number) => number;
    expect(pull(0)).toBe(1);
    // Exhausted...
    expect(pull(0)).toBe(0);
    // ...and then not, because that is what this cursor does. A latch would
    // have answered 0 here and hidden the source's behaviour.
    expect(pull(0)).toBe(9);
  });

  /**
   * The throw leaves the pull as the foreign value it was, and the `JsError`
   * **door** (Exceptions §6, #509) is what carries it: §6.2's wrapping is
   * virtual, so a `JsError(e)` arm binds that value rather than a wrapper over
   * it — pinned in the test below this one. What §14.1 owns, and what is checked
   * here, is the other half: the shim remembers nothing.
   */
  test("a foreign throw propagates out of the pull, and is not memoized", async () => {
    const exports = await run(
      'extern from "source"\n' +
      "    fun readings(): Stream(Int)\n" +
      "\n" +
      "let stream: Stream(Int) = readings!()\n" +
      "\n" +
      "export let pull(ignored: Int): Int =\n" +
      "    match Stream.next!(stream)\n" +
      "        None => 0\n" +
      "        Some(value) => value\n",
      {
        source: [
          "let step = 0;",
          "const cursor = { next: () => {",
          "  step += 1;",
          "  if (step === 2) throw new Error('sensor fault');",
          "  return { value: step, done: false };",
          "} };",
          "export function readings() { return cursor; }",
        ].join("\n"),
      },
    );
    const pull = exports["pull"] as (i: number) => number;
    expect(pull(0)).toBe(1);
    // Out through the pull, unchanged and unclassified.
    expect(() => pull(0)).toThrow("sensor fault");
    // And nothing remembered it: §7.1's failure memo is a property of the
    // adapter's spine, and the shim has no position to hang one on, so the
    // source is simply asked again.
    expect(pull(0)).toBe(3);
  });

  /**
   * The same fault, named at the door (#509). §14.1 says the shim manufactures
   * nothing, and this is the strongest form of that claim: the value a
   * `JsError(e)` arm binds is the source's own `Error`, message and all — no
   * `$hex`, no payload slot, nothing the shim put there.
   */
  test("that throw arrives at a `JsError(e)` arm as the source's own value", async () => {
    const exports = await run(
      'extern from "source"\n' +
      "    fun readings(): Stream(Int)\n" +
      "\n" +
      "let stream: Stream(Int) = readings!()\n" +
      "\n" +
      "export let pull(ignored: Int): String =\n" +
      "    try\n" +
      "        match Stream.next!(stream)\n" +
      "            None => \"none\"\n" +
      "            Some(value) => Int.show(value)\n" +
      "    catch\n" +
      "        JsError(e) => JsError.message(e)\n",
      {
        source: [
          "let step = 0;",
          "const cursor = { next: () => {",
          "  step += 1;",
          "  if (step === 2) throw new Error('sensor fault');",
          "  return { value: step, done: false };",
          "} };",
          "export function readings() { return cursor; }",
        ].join("\n"),
      },
    );
    const pull = exports["pull"] as (i: number) => string;
    expect(pull(0)).toBe("1");
    expect(pull(0)).toBe("sensor fault");
    // Unmemoized here too: the arm caught the fault, and the next pull asks the
    // source again rather than replaying it.
    expect(pull(0)).toBe("3");
  });

  test("a malformed iterator result is the §7.2 TypeError, and nothing more", async () => {
    const exports = await run(
      'extern from "source"\n' +
      "    fun readings(): Stream(Int)\n" +
      "\n" +
      "export let pull(ignored: Int): Int =\n" +
      "    match Stream.next!(readings!())\n" +
      "        None => 0\n" +
      "        Some(value) => value\n",
      {
        source: "export function readings() { return { next: () => 5 }; }",
      },
    );
    // The minimum protocol check native iteration performs, and no other
    // validation (§7.2, shared verbatim with the adapter): a `TypeError` naming
    // the offending result, never a Hexagon error of its own — there is no
    // `InvalidIteratorError` and this section invents none.
    expect(() => (exports["pull"] as (i: number) => number)(0))
      .toThrow("Iterator result 5 is not an object");
  });

  test("`done` is read before `value`, and `value` is not read at all when done", async () => {
    const exports = await run(
      'extern from "source"\n' +
      "    fun readings(): Stream(Int)\n" +
      "    fun reads(): String\n" +
      "\n" +
      "let stream: Stream(Int) = readings!()\n" +
      "\n" +
      "export let drain(ignored: Int): String =\n" +
      "    Stream.forEach!(stream, value => ())\n" +
      "    reads!()\n",
      {
        source: [
          "const order = [];",
          "export function reads() { return order.join(','); }",
          "let step = 0;",
          "const result = (done, value) => ({",
          "  get done() { order.push('done'); return done; },",
          "  get value() { order.push('value'); return value; },",
          "});",
          "const cursor = { next: () => { step += 1; return result(step > 1, step); } };",
          "export function readings() { return cursor; }",
        ].join("\n"),
      },
    );
    // §7.2's access order: one element read whole, then a terminating step
    // whose `value` getter is never touched.
    expect((exports["drain"] as (i: number) => string)(0)).toBe("done,value,done");
  });

  test("the shim never calls `return()`, even when a consumer stops early", async () => {
    const exports = await run(
      'extern from "source"\n' +
      "    fun readings(): Stream(Int)\n" +
      "    fun closes(): Int\n" +
      "\n" +
      "let stream: Stream(Int) = readings!()\n" +
      "\n" +
      "export let probe(ignored: Int): (Option(Int), Int) =\n" +
      "    let found: Option(Int) = Stream.find!(stream, value => value > 1)\n" +
      "    (found, closes!())\n",
      {
        source: [
          "let closed = 0;",
          "export function closes() { return closed; }",
          "let index = 0;",
          "const cursor = {",
          "  next: () => ({ value: ++index, done: false }),",
          "  return: () => { closed += 1; return { done: true }; },",
          "};",
          "export function readings() { return cursor; }",
        ].join("\n"),
      },
    );
    const [found, closed] =
      (exports["probe"] as (i: number) => readonly [{ value: number }, number])(0);
    expect(found.value).toBe(2);
    // §8's no-deterministic-disposal posture, inherited (§14.1's last line).
    // The resource-aware home is deferral 4 and is still open.
    expect(closed).toBe(0);
  });
});

describe("§14 position declares intent", () => {
  /**
   * The claim the whole section rests on, checked on **one foreign object**
   * crossed at both positions in one program: the `Seq` position laundered it
   * into replayable pure data, and the `Stream` position left it spent.
   */
  test("one source crossed at both positions launders at `Seq` and stays raw at `Stream`", async () => {
    const exports = await run(
      'extern from "source"\n' +
      "    fun asSeq(): Seq(Int)\n" +
      "    fun asStream(): Stream(Int)\n" +
      "\n" +
      "export let sequence(ignored: Int): (Vector(Int), Vector(Int)) =\n" +
      "    let source: Seq(Int) = asSeq!()\n" +
      "    (Vector.fromSeq(source), Vector.fromSeq(source))\n" +
      "\n" +
      "export let stream(ignored: Int): (Vector(Int), Vector(Int)) =\n" +
      "    let source: Stream(Int) = asStream!()\n" +
      "    (Stream.collect!(source, 3), Stream.collect!(source, 3))\n",
      {
        source: [
          "function counter() {",
          "  let index = 0;",
          "  return { [Symbol.iterator]() {",
          "    return { next: () => index < 3 ? { value: ++index, done: false } : { done: true } };",
          "  } };",
          "}",
          "export function asSeq() { return counter(); }",
          "export function asStream() { return counter(); }",
        ].join("\n"),
      },
    );
    const asPairs = (name: string) =>
      (exports[name] as (i: number) => readonly [readonly number[], readonly number[]])(0);
    // The `Seq` position: replayable pure data, traversed twice with the same
    // answer, because §4's spine memoized what the mutable cursor gave once.
    const [firstSeq, secondSeq] = asPairs("sequence");
    expect([...firstSeq]).toEqual([1, 2, 3]);
    expect([...secondSeq]).toEqual([1, 2, 3]);
    // The `Stream` position: a pull is spent, and the second drain finds the
    // source exhausted. Impurity declared rather than laundered.
    const [firstStream, secondStream] = asPairs("stream");
    expect([...firstStream]).toEqual([1, 2, 3]);
    expect([...secondStream]).toEqual([]);
  });
});
