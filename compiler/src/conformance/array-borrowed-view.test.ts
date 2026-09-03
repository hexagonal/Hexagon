import { beforeAll, describe, expect, test } from "vitest";

import { compileMain, projectDiagnostics, runMain } from "../support/test-project.js";

/**
 * Conformance for the **borrowed `Array(a)`'s minimal decode loop** — FFI Part 2
 * §6.3's `Array.length`, the 1-based asserting read `xs[i]`, and `Array.get`,
 * plus §6.3/§13.1's specialized bare-`.length` diagnostic and §10's checklist
 * row for it (issue #511).
 *
 * Everything the door promises is a property of the *emitted* code or of the
 * *running* one, so almost every assertion here is one or the other. A bounds
 * check that typechecks is not a bounds check; a `length` that scans typechecks
 * exactly as well as one that reads `.length`; and the only way to know that
 * `xs[1]` is the JavaScript element `0` is to hand the compiled program a real
 * array and look.
 *
 * What is deliberately **not** here, because it is not shipped: `Array.at`, the
 * slice `xs[lo..hi]`, and `Array.toSeq`/`fromSeq`. Their absence is pinned below
 * as absence — §9.1's doctrine that an unshipped operation is missing rather
 * than stubbed — and nothing here should be read as deciding when they arrive.
 * Two of §9's four conversions *have* shipped — `Vector.toArray` (#238) and
 * `Array.toVector` — so the rows that once pinned their absence pin their
 * arrival instead; each operation's own contract is its own file's,
 * `vector-to-array.test.ts` and `array-to-vector.test.ts`.
 *
 * The `.d.ts` face (`ReadonlyArray<a>`) is `array-readonly-face.test.ts`'s and
 * is not restated; the one composition this slice adds — `Array(JsValue)` —
 * is pinned in `js-value-to-array.test.ts` beside the operation that produces
 * it.
 */

/**
 * The one compiled program the runtime tests drive.
 *
 * Every borrowed array arrives as a *parameter*, which is the honest shape: a
 * `Array(a)` has no Hexagon literal and never will — foreign code owns the
 * array, and §6.2's stability contract begins where it crosses.
 */
const PROGRAM = "export let size(xs: Array(Int)): Int = Array.length(xs)\n" +
  "export let sizeDot(xs: Array(Int)): Int = xs.length()\n" +
  "export let read(xs: Array(Int), index: Int): Int = xs[index]\n" +
  "export let peek(xs: Array(Int), index: Int): Option(Int) = Array.get(xs, index)\n" +
  "\n" +
  "// The `Option` projection, so a test can read `get`'s answer without naming\n" +
  "// `Option`'s representation.\n" +
  "export let peeked(xs: Array(Int), index: Int): Int = match Array.get(xs, index)\n" +
  "    None => -1\n" +
  "    Some(value) => value\n" +
  "\n" +
  "// The throw, caught by the *bare* spelling of Collections Part 3's one\n" +
  "// declaration — which is the whole claim: the array bracket raises `Vector`'s\n" +
  "// `IndexError`, not one of its own.\n" +
  "export fun guarded(xs: Array(Int), index: Int): Int =\n" +
  "    try\n" +
  "        xs[index]\n" +
  "    catch\n" +
  "        IndexError(at, size) => at * 1000 + size\n";

let exports_: Record<string, unknown>;

function size(xs: readonly number[]): number {
  return (exports_["size"] as (xs: readonly number[]) => number)(xs);
}

function read(xs: readonly number[], index: number): number {
  return (exports_["read"] as (xs: readonly number[], i: number) => number)(xs, index);
}

function peeked(xs: readonly number[], index: number): number {
  return (exports_["peeked"] as (xs: readonly number[], i: number) => number)(xs, index);
}

/** `/main.hex`'s emitted JavaScript, for the emission-shape assertions. */
function mainJavaScript(source: string): string {
  const compiled = compileMain(source);
  expect(compiled.diagnostics).toEqual([]);
  const main = compiled.modules.find(({ source: file }) => file.path === "/main.hex");
  if (main === undefined) throw new Error("no /main.hex in the compiled project");
  return main.javascript.text;
}

/** The emitted JavaScript of the injected `stdlib/Array.hex`. */
function companionJavaScript(): string {
  const compiled = compileMain("export let size(xs: Array(Int)): Int = Array.length(xs)\n");
  expect(compiled.diagnostics).toEqual([]);
  const companion = compiled.modules.find(({ source }) => source.path.endsWith("/Array.hex"));
  if (companion === undefined) throw new Error("no Array.hex in the compiled project");
  return companion.javascript.text;
}

beforeAll(async () => {
  exports_ = await runMain(PROGRAM);
});

describe("`xs[i]` is 1-based, asserting, and native underneath (§6.3)", () => {
  /**
   * The offset, run rather than read. Element 1 is the JavaScript index 0, and
   * the last element is at `length`, not at `length - 1` — Collections Part 3's
   * indexing doctrine, unchanged by the array being foreign.
   */
  test("element 1 is the JavaScript element 0", () => {
    expect(read([10, 20, 30], 1)).toBe(10);
    expect(read([10, 20, 30], 2)).toBe(20);
    expect(read([10, 20, 30], 3)).toBe(30);
  });

  /**
   * §6.3's exact emission shape: the bounds check `i < 1 || i > xs.length`, the
   * 1-to-0 offset, and then the native read. The whole helper is pinned as text
   * because every clause of it is load-bearing — the check is what makes the
   * read an assertion, and the offset is what makes it 1-based.
   */
  test("the emitted read is a bounds check, an offset, and a native index", () => {
    const javascript = mainJavaScript(
      "export let read(xs: Array(Int), index: Int): Int = xs[index]\n",
    );
    expect(javascript).toContain("const __size = __values.length;");
    expect(javascript).toContain("if (__index < 1 || __index > __size) {");
    expect(javascript).toContain("return __values[__index - 1];");
    // And the call site reaches it, rather than inlining a bare native read
    // that would answer `undefined` out of bounds.
    expect(javascript).toContain("const read = (xs, index) => __arrayIndex(xs, index);");
  });

  /**
   * Both ends of the window, and the one that a JavaScript habit gets wrong:
   * `0` addresses no element in Hexagon, and `length + 1` addresses none in any
   * language. A bare `xs[i - 1]` would have answered `undefined` at `0` — §6.3's
   * stated reason the check is not optional.
   */
  test("`0` and `length + 1` both throw", () => {
    expect(() => read([10, 20, 30], 0)).toThrow();
    expect(() => read([10, 20, 30], 4)).toThrow();
    expect(() => read([], 1)).toThrow();
    expect(() => read([10, 20, 30], -1)).toThrow();
  });

  /**
   * The thrown value is **the** `IndexError` — `stdlib/Vector.hex`'s one
   * declaration (Collections Part 3's), branded to the module that declares it
   * rather than to the one the read was written in. The payload slots are
   * `index` as passed and `size` at the fault.
   */
  test("the throw carries `IndexError`'s identity and payload", async () => {
    await expect(async () => read([10, 20, 30], 99)).rejects
      .toMatchObject({ name: "IndexError", $hex: "Vector", index: 99, size: 3 });
    await expect(async () => read([10, 20, 30], 0)).rejects
      .toMatchObject({ name: "IndexError", $hex: "Vector", index: 0, size: 3 });
  });

  /**
   * And the identity is not merely on the object: a Hexagon `catch` arm written
   * `IndexError(index, size)` catches it and binds both slots. That is what
   * "the exact identity" is *for*, and reading the fields off the raw throw
   * above would not have proved it.
   */
  test("an `IndexError(index, size)` arm catches it and binds both slots", () => {
    const guarded = exports_["guarded"] as (xs: readonly number[], i: number) => number;
    expect(guarded([10, 20, 30], 9)).toBe(9 * 1000 + 3);
    expect(guarded([10, 20, 30], 0)).toBe(0 * 1000 + 3);
    // In bounds, the arm never runs.
    expect(guarded([10, 20, 30], 2)).toBe(20);
  });

  /**
   * §6.4's zero-scan rule at the bracket: reading one element touches that
   * element and nothing else. A getter on every *other* index proves it, and
   * proves it in the only way that can — by executing.
   */
  test("reading one element touches no other element", () => {
    const touched: number[] = [];
    const watched: number[] = [];
    for (const index of [0, 1, 2]) {
      Object.defineProperty(watched, index, {
        enumerable: true,
        get: () => {
          touched.push(index);
          return (index + 1) * 10;
        },
      });
    }
    expect(read(watched, 2)).toBe(20);
    expect(touched).toEqual([1]);
  });
});

describe("`Array.length` is the native read (§6.3)", () => {
  test("it answers the foreign array's length", () => {
    expect(size([])).toBe(0);
    expect(size([1, 2, 3])).toBe(3);
  });

  /**
   * §6.3's emission bullet: "`Array.length(xs)` is `xs.length`". The door row is
   * that read and nothing else — no scan, no loop, no property probe of its own
   * — which is what makes the length of a million-element borrow free.
   */
  test("the companion's row lowers to `.length`", () => {
    expect(companionJavaScript()).toContain("const length = __a => __a.length;");
  });

  /**
   * §6.4: a sparse array's length is JavaScript's, and nothing counts. A hole
   * is not skipped, sought, or otherwise noticed — there is no scan to notice
   * it with.
   */
  test("a sparse array's length is JavaScript's, uncounted", () => {
    const sparse: number[] = [];
    sparse[9] = 1;
    expect(size(sparse)).toBe(10);
  });
});

describe("`Array.get` answers rather than faults (§6.3)", () => {
  test("in bounds is `Some`, out of bounds is `None`", () => {
    expect(peeked([10, 20, 30], 1)).toBe(10);
    expect(peeked([10, 20, 30], 3)).toBe(30);
    // The three ways to be outside, each an answer rather than a throw.
    expect(peeked([10, 20, 30], 0)).toBe(-1);
    expect(peeked([10, 20, 30], 4)).toBe(-1);
    expect(peeked([], 1)).toBe(-1);
  });

  test("the `Option` itself is what a caller matches", () => {
    const peek = exports_["peek"] as (xs: readonly number[], i: number) => { tag: string };
    expect(peek([10], 1).tag).toBe("Some");
    expect(peek([10], 2).tag).toBe("None");
  });
});

describe("the dot form is companion dispatch, and the bare read is not (§13.1)", () => {
  /**
   * Method Syntax §4.1's boundary row, made true in the build: `Array(a)` is an
   * eligible dot-call receiver and `stdlib/Array.hex` is the module addressable
   * under the name, so `xs.length()` **is** `Array.length(xs)` — §13.1's "the
   * call form stopped being an error entirely". It is pinned by emission as
   * well as by acceptance, because "compiles" would not distinguish it from
   * some other operation that happened to fit.
   */
  test("`xs.length()` compiles, and is the same operation as `Array.length(xs)`", () => {
    const javascript = mainJavaScript(
      "export let size(xs: Array(Int)): Int = Array.length(xs)\n" +
        "export let sizeDot(xs: Array(Int)): Int = xs.length()\n",
    );
    expect(javascript).toContain("const size = xs => length(xs);");
    expect(javascript).toContain("const sizeDot = xs => length(xs);");
    expect(size([1, 2])).toBe(2);
    expect((exports_["sizeDot"] as (xs: readonly number[]) => number)([1, 2])).toBe(2);
  });

  /**
   * §6.3's one new hard error (§10's checklist), and §13.1's three requirements
   * on its wording, each asserted separately so a rewrite that drops one fails
   * here rather than passing on a substring.
   */
  test("the bare read `xs.length` is the specialized hard error", () => {
    const messages = projectDiagnostics(
      "export let n(xs: Array(Int)): Int = xs.length\n",
    );
    expect(messages).toEqual([
      "`Array(a)` is a borrowed foreign view, not a record: it has no fields, and " +
      "a property read does not cross the boundary — the companion call is the " +
      "read. Write `Array.length(xs)`, or `xs.length()` for the smallest edit.",
    ]);
  });

  test("the message explains grammar, and never says the name is wrong", () => {
    const [message] = projectDiagnostics(
      "export let n(rows: Array(Int)): Int = rows.length\n",
    );
    // The subject is the absence of a field surface (§13.1 fact 1)...
    expect(message).toContain("not a record");
    expect(message).toContain("no fields");
    // ...and never the vocabulary. Post-rename the word `length` is the right
    // word, and a message implying otherwise would be false.
    expect(message).not.toContain("Array.size");
    expect(message).not.toMatch(/unknown|does not exist|no such|misspell/iu);
  });

  test("both rewrites are named, canonical first (§13.1 fact 2)", () => {
    const [message] = projectDiagnostics(
      "export let n(rows: Array(Int)): Int = rows.length\n",
    );
    // The author's own spelling, so both rewrites are pasteable.
    expect(message).toContain("`Array.length(rows)`");
    expect(message).toContain("`rows.length()`");
    // Canonical first: the qualified form is what everything elaborates to.
    expect(message!.indexOf("`Array.length(rows)`"))
      .toBeLessThan(message!.indexOf("`rows.length()`"));
  });

  /**
   * **A receiver with no name gets no name**, and this is the row that makes
   * that a rule rather than a detail.
   *
   * The rewrite is advice the reader will paste, so a manufactured subject is
   * not merely vague — it is a wrong rewrite that can *compile*. In the program
   * below the faulting receiver is `xss[1]`, an expression with no spelling of
   * its own, while an unrelated `xs: Vector(Int)` is in scope: advising
   * `xs.length()` would hand back a working program that answers a different
   * question, silently. The neutral `…` cannot, because it resolves to nothing
   * and the reader has to edit it — the corpus's existing convention at
   * `#dotCallReachability` and at the `Iterable` binder refusal, for exactly
   * this reason.
   */
  test("a receiver with no name is spelled neutrally, never manufactured", () => {
    const messages = projectDiagnostics(
      "export let n(xs: Vector(Int), xss: Array(Array(Int))): Int = xss[1].length\n",
    );
    expect(messages).toEqual([
      "`Array(a)` is a borrowed foreign view, not a record: it has no fields, and " +
      "a property read does not cross the boundary — the companion call is the " +
      "read. Write `Array.length(…)`, or `….length()` for the smallest edit.",
    ]);
    // The measured failure, asserted directly: no rewrite in this message names
    // the `xs` that happens to be in scope.
    expect(messages[0]).not.toContain("xs");
    // And the premise, so the row cannot pass vacuously: `xs.length()` really
    // would have compiled, against the wrong receiver.
    expect(projectDiagnostics(
      "export let n(xs: Vector(Int), xss: Array(Array(Int))): Int = xs.length()\n",
    )).toEqual([]);
  });

  /**
   * The diagnostic's domain is *exactly* the bare read (§6.3's last sentence).
   * Any other field on an `Array` receiver is the ordinary refusal — this door
   * gets one tuned message, for the one reflex that earns it.
   */
  test("another field name takes the ordinary refusal, not this one", () => {
    const messages = projectDiagnostics(
      "export let n(xs: Array(Int)): Int = xs.count\n",
    );
    expect(messages).not.toEqual([]);
    expect(messages.join("\n")).not.toContain("borrowed foreign view");
  });
});

/**
 * What seating `stdlib/Array.hex` in the prelude spends, in bare names.
 *
 * Since #742 the answer is **nothing at all**, for this module and for every
 * other: Modules §5.5 seeds nothing in the term namespace, so a new prelude
 * member takes no bare spelling and a consumer reaches its exports by the dot or
 * qualified. What the two refusals below show is that `Array` joining the homes
 * of two already-shared words only lengthens the list of routes the message
 * names — spelled, per §5.5, with the arguments the program itself wrote.
 */
describe("the vocabulary this module spends (Modules §5.5)", () => {
  test("`length`'s refusal grows by one home when `Array` joins", () => {
    expect(projectDiagnostics("export let n(v: Vector(Int)): Int = length(v)\n"))
      .toEqual([
        "no bare `length`; write `v.length()`, `Seq.length(v)`, `Vector.length(v)`, " +
        "or `Array.length(v)`",
      ]);
  });

  test("`get`'s refusal grows by one home when `Array` joins", () => {
    expect(projectDiagnostics("export let n(v: Vector(Int)): Option(Int) = get(v, 1)\n"))
      .toEqual([
        "no bare `get`; write `v.get(1)`, `Vector.get(v, 1)`, `Map.get(v, 1)`, " +
        "or `Array.get(v, 1)`",
      ]);
  });

  /**
   * `toVector` is the module's third export and joined it with §9's conversion.
   * It is a name no other prelude module exports, so its refusal names one home
   * rather than three — and it is still a refusal, which is §5.5's whole point:
   * being single-homed buys no bare spelling.
   */
  test("`toVector` is single-homed, and still has no bare spelling", () => {
    expect(projectDiagnostics("export let n(xs: Array(Int)): Vector(Int) = toVector(xs)\n"))
      .toEqual(["no bare `toVector`; write `xs.toVector()` or `Array.toVector(xs)`"]);
  });

  /**
   * And nothing else leaves the module. The one door row's key (`arrayLength`)
   * is not a name a program can spell, and there is no fourth export hiding
   * behind the three above — `toVector` is ordinary Hexagon here and has no key
   * of its own to leak.
   */
  test("the module exports exactly `length`, `get` and `toVector`", () => {
    expect(projectDiagnostics("export let n(xs: Array(Int)): Int = Array.length(xs)\n"))
      .toEqual([]);
    expect(projectDiagnostics("export let n(xs: Array(Int)): Option(Int) = Array.get(xs, 1)\n"))
      .toEqual([]);
    expect(projectDiagnostics("export let n(xs: Array(Int)): Vector(Int) = Array.toVector(xs)\n"))
      .toEqual([]);
    expect(projectDiagnostics("export let n(xs: Array(Int)): Int = Array.arrayLength(xs)\n"))
      .toEqual(["module `Array` does not export `arrayLength`"]);
  });
});

/**
 * The rows of §9's quartet that have since shipped, kept here because this is
 * where their absence used to be pinned. #238 landed `Vector.toArray` through
 * the intrinsic door and `Array.toVector` followed as ordinary Hexagon in this
 * module (`stdlib-roadmap.md` §5.1 — a `for` over the borrow is expressible, so
 * it stays in source), so the absences below are two operations, not four. Each
 * operation's own contract is its own file's — `vector-to-array.test.ts` for
 * the outbound crossing (eager, fresh, shallow, total, §6.2-stable) and
 * `array-to-vector.test.ts` for the inbound one (eager, a stable persistent
 * snapshot, shallow, total, §6.4's holes) — and neither is restated here.
 */
describe("two of §9's four conversions have shipped", () => {
  test("`Vector.toArray` compiles, and is no longer one of the absences", () => {
    expect(projectDiagnostics("export let a(v: Vector(Int)): Array(Int) = Vector.toArray(v)\n"))
      .toEqual([]);
  });

  test("`Array.toVector` compiles, and is no longer one of the absences", () => {
    expect(projectDiagnostics("export let a(xs: Array(Int)): Vector(Int) = Array.toVector(xs)\n"))
      .toEqual([]);
  });
});

describe("what this slice does not ship is absent, not stubbed (§9.1)", () => {
  test.each([
    ["at", "export let a(xs: Array(Int)): Int = Array.at(xs, 1)\n"],
    ["toSeq", "export let a(xs: Array(Int)): Seq(Int) = Array.toSeq(xs)\n"],
    ["fromSeq", "export let a(s: Seq(Int)): Array(Int) = Array.fromSeq(s)\n"],
  ])("`Array.%s` is the ordinary unknown-export error", (name, source) => {
    expect(projectDiagnostics(source))
      .toEqual([`module \`Array\` does not export \`${name}\``]);
  });

  /**
   * Slicing is decided surface (§6.3) that has not shipped, and a bracket is an
   * expression form with no export list to be missing from — so it needs a
   * refusal of its own rather than the generic "indexing requires…", which
   * would be false about a receiver that *is* an `Array`.
   */
  test("the slice `xs[lo..hi]` is refused, naming what does read", () => {
    expect(projectDiagnostics("export let a(xs: Array(Int)): Array(Int) = xs[1..2]\n"))
      .toEqual([
        "slicing an `Array` is not available; `Array.get` and `xs[i]` read one element",
      ]);
  });

  /**
   * And it obeys the same naming rule as the `.length` diagnostic, for the same
   * reason: the element read it points at is spelled at the author's receiver,
   * or neutrally where that receiver has no name. Advising `xs[i]` at a
   * nameless receiver would name whatever `xs` is in scope — here a `Vector`,
   * whose bracket compiles.
   */
  test("its element read is spelled at the author's receiver, or not at all", () => {
    expect(projectDiagnostics(
      "export let a(xs: Vector(Int), xss: Array(Array(Int))): Array(Int) = xss[1][1..2]\n",
    )).toEqual([
      "slicing an `Array` is not available; `Array.get` and `…[i]` read one element",
    ]);
  });

  /**
   * No mutation surface exists, on the companion or through the bracket (§6.1,
   * §10's "not a diagnostic — no such operation exists to misuse"). The bracket
   * has no assignment grammar at all, so the refusal is the parser's.
   */
  test("there is no `set`, and no assignment-to-index grammar", () => {
    expect(projectDiagnostics("export let a(xs: Array(Int)): Array(Int) = Array.set(xs, 1, 9)\n"))
      .toEqual(["module `Array` does not export `set`"]);
    expect(projectDiagnostics("export let a(xs: Array(Int)): Unit =\n    xs[1] = 9\n"))
      .not.toEqual([]);
  });
});
