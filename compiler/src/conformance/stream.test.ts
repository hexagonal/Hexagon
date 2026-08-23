/**
 * Conformance for `stdlib/Stream.hex` — `spec/stream.md`, landed at the
 * un-flagging milestone (#364) because its declaration and surface spell arrows
 * and marks the pre-ruling language could not lex.
 *
 * Two halves, and both are needed. The **semantics** half executes the emitted
 * module: a stream's whole content is that a pull is spent and the cursor
 * advances, which no amount of read text demonstrates. The **effects** half
 * pins the faces and the marks, because `Stream` is the ruling's first real
 * customer — `Stream.fold` is `->!`'s corpus debut (§4.4), and the split
 * between silent wiring and marked consumption (§4) is the module's whole
 * teaching point.
 *
 * The one specimen that cannot be written from outside is a pure lambda at the
 * `next` field: the record is `opaque`, so its constructor is the home
 * module's alone. That test seats a modified `Stream.hex` as the prelude
 * member, on the same footing `effects.test.ts` puts `Seq.hex`'s `fold` on.
 */

import { describe, expect, it } from "vitest";
import streamSource from "../../../stdlib/Stream.hex?raw";
import { AnalysisSession } from "../analysis/session.js";
import { compileFiles, projectDiagnostics, runMain } from "../support/test-project.js";

/** A script `Stream` over the first `count` positive integers. */
const script = (count: number): string =>
  `Stream.fromSeq(Seq.take(Seq.iterate(1, x => x + 1), ${count}))`;

/** What a hover where `needle` is written shows as the type there. */
function hoveredType(source: string, needle: string): string | undefined {
  const session = new AnalysisSession();
  session.setFile("/main.hex", source);
  return session.hover("/main.hex", source.indexOf(needle))?.displayedType;
}

describe("§2 the protocol", () => {
  it("pulls one element at a time, and the pull is spent", async () => {
    const exports = await runMain(
      `let source: Stream(Int) = ${script(3)}\n` +
      "export let pulls(ignored: Int): Vector(Int) =\n" +
      "    var seen = Vector.empty\n" +
      "    var pulling = True\n" +
      "    while pulling\n" +
      "        match Stream.next!(source)\n" +
      "            None => pulling := False\n" +
      "            Some(value) => seen := Vector.append(seen, value)\n" +
      "    seen\n",
    );
    const pulls = exports["pulls"] as (ignored: number) => readonly number[];
    // The first drive sees everything; the second sees nothing, because the
    // stream advanced and there is no tail to go back to.
    expect([...pulls(0)]).toEqual([1, 2, 3]);
    expect([...pulls(0)]).toEqual([]);
  });

  it("keeps answering `None` once exhausted", async () => {
    const exports = await runMain(
      `let source: Stream(Int) = ${script(1)}\n` +
      "export let drained(ignored: Int): Vector(Int) =\n" +
      "    Vector.append(\n" +
      "        Vector.append(Stream.collect!(source, 5), Stream.collect!(source, 5) |> Vector.length),\n" +
      "        Vector.length(Stream.collect!(source, 5)))\n",
    );
    // One element, then two further drains that each end rather than restart
    // or raise — §2's "pulling an exhausted stream yields `None` again".
    expect([...(exports["drained"] as (i: number) => readonly number[])(0)])
      .toEqual([1, 0, 0]);
  });
});

describe("§4.2 derived streams", () => {
  it("maps each element as it is pulled", async () => {
    const exports = await runMain(
      `export let doubled: Vector(Int) = Stream.collect!(Stream.map(${script(4)}, x => x * 2), 4)\n`,
    );
    expect([...exports["doubled"] as readonly number[]]).toEqual([2, 4, 6, 8]);
  });

  it("filters, discarding what `keep` refuses", async () => {
    const exports = await runMain(
      "export let evens: Vector(Int) =\n" +
      `    Stream.collect!(Stream.filter(${script(10)}, x => Integral.rem(x, 2) == 0), 3)\n`,
    );
    expect([...exports["evens"] as readonly number[]]).toEqual([2, 4, 6]);
  });

  it("shares the source's cursor — pulling the derivation advances it", async () => {
    const exports = await runMain(
      `let source: Stream(Int) = ${script(6)}\n` +
      "let doubled: Stream(Int) = Stream.map(source, x => x * 2)\n" +
      "export let interleaved(ignored: Int): (Vector(Int), Vector(Int)) =\n" +
      "    let viaDerived: Vector(Int) = Stream.collect!(doubled, 2)\n" +
      "    let viaSource: Vector(Int) = Stream.collect!(source, 2)\n" +
      "    (viaDerived, viaSource)\n",
    );
    // 1 and 2 leave through the derivation, doubled; 3 and 4 leave through the
    // source itself. There is no independence to promise and none is promised.
    const [viaDerived, viaSource] =
      (exports["interleaved"] as (i: number) => readonly (readonly number[])[])(0);
    expect([...viaDerived!]).toEqual([2, 4]);
    expect([...viaSource!]).toEqual([3, 4]);
  });
});

describe("§4.3 `fromSeq` — the injection door", () => {
  it("drives a pure sequence one step per pull", async () => {
    const exports = await runMain(
      `export let sample: Vector(Int) = Stream.collect!(${script(3)}, 3)\n`,
    );
    expect([...exports["sample"] as readonly number[]]).toEqual([1, 2, 3]);
  });

  it("stands a script in for an ambient source, which is the teaching point", async () => {
    // A consumer written against `Stream(a)` never learns where its elements
    // came from, so a `Seq` script is a clock in a test.
    const exports = await runMain(
      "export let total(source: Stream(Int)): Int = Stream.fold!(source, 0, (a, b) => a + b)\n" +
      `export let ofScript: Int = total!(${script(4)})\n`,
    );
    expect(exports["ofScript"]).toBe(10);
  });

  it("is a bare call: building the cursor touches nothing", () => {
    // The row's declared face is pure (`spec/intrinsics.md` §4.2 as #355
    // amended it), and the impurity lives in the record field's arrow instead.
    expect(projectDiagnostics(
      `export let source: Stream(Int) = ${script(2)}\n`,
    )).toEqual([]);
  });
});

describe("§4.4 consumers", () => {
  it("collects at most `count`, and fewer when the stream ends first", async () => {
    const exports = await runMain(
      `export let short: Vector(Int) = Stream.collect!(${script(2)}, 5)\n` +
      `export let exact: Vector(Int) = Stream.collect!(${script(5)}, 5)\n`,
    );
    expect([...exports["short"] as readonly number[]]).toEqual([1, 2]);
    expect([...exports["exact"] as readonly number[]]).toEqual([1, 2, 3, 4, 5]);
  });

  it("collects nothing at a `count` of zero or less, on `Seq.take`'s convention", async () => {
    const exports = await runMain(
      `export let none: Vector(Int) = Stream.collect!(${script(3)}, 0)\n` +
      `export let negative: Vector(Int) = Stream.collect!(${script(3)}, -2)\n`,
    );
    expect([...exports["none"] as readonly number[]]).toEqual([]);
    expect([...exports["negative"] as readonly number[]]).toEqual([]);
  });

  it("folds to exhaustion", async () => {
    const exports = await runMain(
      `export let sum: Int = Stream.fold!(${script(4)}, 0, (a, b) => a + b)\n`,
    );
    expect(exports["sum"]).toBe(10);
  });

  it("drives to exhaustion in `forEach`, which is what makes it unsafe on an ambient source", async () => {
    // What `forEach` leaves behind is the observable: a `var` cannot be touched
    // from inside the action (Statements §6.2 — the fence that makes a `->`
    // face a fact), so the count is not reachable from Hexagon at all. What is
    // reachable is the stream afterwards, and it is spent to the last element.
    const exports = await runMain(
      `let source: Stream(Int) = ${script(3)}\n` +
      "export let leftover(ignored: Int): Vector(Int) =\n" +
      "    Stream.forEach!(source, value => ())\n" +
      "    Stream.collect!(source, 5)\n",
    );
    expect([...(exports["leftover"] as (i: number) => readonly number[])(0)]).toEqual([]);
  });

  it("finds the first match and stops there", async () => {
    const exports = await runMain(
      `let source: Stream(Int) = ${script(9)}\n` +
      "export let probe(ignored: Int): Vector(Int) =\n" +
      "    match Stream.find!(source, x => x > 2)\n" +
      "        None => Vector.empty\n" +
      "        Some(found) => Vector.prepend(Stream.collect!(source, 1), found)\n",
    );
    // 3 is the match; the very next pull answers 4, so `find` stopped at the
    // element it returned rather than draining past it.
    expect([...(exports["probe"] as (i: number) => readonly number[])(0)])
      .toEqual([3, 4]);
  });

  it("answers `None` from `find` when the stream ends first", async () => {
    const exports = await runMain(
      `export let missing: Bool = match Stream.find!(${script(3)}, x => x > 99)\n` +
      "    None => True\n" +
      "    Some(_) => False\n",
    );
    expect(exports["missing"]).toBe(true);
  });
});

describe("§4 the faces: wiring is silent, consumption is spelled", () => {
  it("displays `Stream.fold` as the arrow trio's worked example", () => {
    // §4.4's own sentence: a linked callback
    // beside a constant-impure self, in one face.
    expect(hoveredType("export let held: Int = Stream.fold\n", "fold"))
      .toBe("(Stream(a), b, (b, a) ->? b) ->! b");
  });

  it("displays the protocol function as `Stream(a) ->! Option(a)`", () => {
    // §2: the first pull is unconditional, so every call to `next` wears `!`.
    expect(hoveredType("export let held: Int = Stream.next\n", "next"))
      .toBe("Stream(a) ->! Option(a)");
  });

  it("takes a bare `Stream.map` in an ordinary body", () => {
    expect(projectDiagnostics(
      "export let go(source: Stream(Int)): Stream(Int) = Stream.map(source, x => x + 1)\n",
    )).toEqual([]);
  });

  it("conducts the same call inside an inlet-bearing body", () => {
    // Effects §3.3's qualification, restated at `stream.md` §4.2: the enclosing
    // signature offers an inlet, so a call whose colour is still undetermined
    // is a conduit rather than pure-pinned.
    const body = (mark: string): string =>
      "export let wire(source: Stream(Int), step: Int ->? Int): Stream(Int) =\n" +
      `    Stream.map${mark}(source, step)\n`;
    expect(projectDiagnostics(body(""))).toEqual([
      "this call is as effectful as the enclosing instantiation makes it, so " +
      "`map` wants `?`, not no mark",
    ]);
    expect(projectDiagnostics(body("?"))).toEqual([]);
  });

  it("demands `!` at every consumer, and takes nothing else", () => {
    const call = (name: string, mark: string, rest: string, result: string): string =>
      `export let go(source: Stream(Int)): ${result} =\n    ${name}${mark}(source${rest})\n`;
    for (const [name, rest, result] of [
      ["Stream.collect", ", 1", "Vector(Int)"],
      ["Stream.fold", ", 0, (a, b) => a + b", "Int"],
      ["Stream.forEach", ", value => ()", "Unit"],
      ["Stream.find", ", x => x > 0", "Option(Int)"],
      ["Stream.next", "", "Option(Int)"],
    ] as const) {
      const shown = name.slice("Stream.".length);
      expect(projectDiagnostics(call(name, "", rest, result))).toEqual([
        `this call runs effects, so \`${shown}\` wants \`!\`, not no mark`,
      ]);
      expect(projectDiagnostics(call(name, "?", rest, result))).toEqual([
        `this call runs effects, so \`${shown}\` wants \`!\`, not \`?\``,
      ]);
      expect(projectDiagnostics(call(name, "!", rest, result))).toEqual([]);
    }
  });
});

describe("§4.5 what the surface refuses", () => {
  it("gives `for x in stream` the ordinary no-instance failure", () => {
    // `toSeq` is a constraint member and members are pure (Effects §5), so a
    // `Stream` cannot honor `Iterable` — and the refusal is the ordinary one,
    // not a bespoke report.
    expect(projectDiagnostics(
      "export let go(source: Stream(Int)): Unit =\n    for x in source\n        ()\n",
    )).toEqual(["type `Stream(Int)` has no `Iterable` instance"]);
  });

  it("has no `take`, `drop`, `memoize`, `toSeq`, `any`, `all` or `length`", () => {
    for (const absent of ["take", "drop", "memoize", "toSeq", "any", "all", "length"]) {
      expect(projectDiagnostics(
        `export let go(source: Stream(Int)): Int =\n    Stream.${absent}!(source)\n    0\n`,
      )).toContainEqual(expect.stringContaining("Stream"));
    }
  });
});

describe("§2.5 the field's arrow is the impure constant", () => {
  /**
   * A modified `Stream.hex` seated as the prelude member: a project file with a
   * prelude basename wins over the injected copy, which is the only way to
   * reach the opaque record's constructor at all.
   */
  function withStream(mutated: string): readonly string[] {
    return compileFiles([
      ["/Stream.hex", mutated],
      ["/main.hex", "export let x: Int = 1\n"],
    ]).diagnostics.map(({ message }) => message);
  }

  it("refuses a pure lambda at `next` with the reverse-demand sentence", () => {
    // The demand wrote no `->` anywhere, so §4.3's forward report — whose every
    // clause names one — would misdescribe the program. This is the sentence
    // #364 added for exactly this direction.
    const declaration = "export let map(source: Stream(a), transform: a ->? b): Stream(b) =";
    const mutated = streamSource.replace(
      declaration,
      "export let empty: Stream(a) = Stream({ next = () => None })\n\n" + declaration,
    );
    expect(mutated).not.toBe(streamSource);
    expect(withStream(mutated)).toEqual([
      "this position's arrow is the impure constant — its colour is fixed " +
      "where the type is declared, and this function's face is the pure `->`; " +
      "the demand cannot weaken — change the position's declared arrow, or " +
      "supply the effectful function the position promises",
    ]);
  });

  it("compiles the shipped module clean, which is the acceptance test", () => {
    expect(withStream(streamSource)).toEqual([]);
  });
});
