import { beforeAll, describe, expect, test } from "vitest";

import { compileMain, projectDiagnostics, runMain } from "../support/test-project.js";
import { typeScriptErrors } from "../support/typescript-check.js";

/**
 * Conformance for **`JsValue.toArray`** — FFI Part 11 §4.2, the core's one
 * structural decoder (issue #511).
 *
 * Three claims carry the section, and each is only observable by running the
 * emitted code:
 *
 * 1. **Success is a zero-copy borrowed view over the same array.** Not a copy
 *    that happens to be equal — the same object, so a foreign mutation is
 *    visible through the borrow and §6.2's stability contract has something to
 *    be about. An implementation that copied would pass every equality test and
 *    fail the identity ones here.
 * 2. **The elements stay honestly uncertain.** Each is a `JsValue` and is
 *    decoded individually, by the same strict decoders as anything else. There
 *    is no element scan and no element check — a mixed array succeeds.
 * 3. **The probe is unguarded, and that asymmetry is the point.** `kind` (§3)
 *    guards its `Array.isArray` so the classification is total; `toArray` does
 *    not, because it promises a verdict about the *data* and a throwing probe is
 *    foreign control flow. A revoked proxy is the one input that tells them
 *    apart, and both are asked of it side by side below.
 *
 * Claim 3's throw travels the `JsError` door (Exceptions §6), which exists now
 * (#509), so the pin is written at both ends: the value that leaves is still the
 * raw foreign one — the door wraps nothing, and never changed which values
 * arrive here — and a `JsError(e)` arm is where it arrives.
 *
 * The scalar decoders, `kind`'s inventory and the failure shape are
 * `js-value-decoding.test.ts`'s and are not restated.
 */

const PROGRAM = "export let asArray(v: JsValue): Result(Array(JsValue), JsConversionError) =\n" +
  "    JsValue.toArray(v)\n" +
  "\n" +
  "export let kindOf(v: JsValue): JsKind = JsValue.kind(v)\n" +
  "\n" +
  "// The door the unguarded probe's throw travels (Exceptions section 6.2):\n" +
  "// the arm binds the raw foreign value, so what comes back to a test *is*\n" +
  "// what was thrown.\n" +
  "export let arrayOrThrown(v: JsValue): JsValue =\n" +
  "    try\n" +
  "        match JsValue.toArray(v)\n" +
  "            Ok(_) => JsValue.from(\"decoded\")\n" +
  "            Err(_) => JsValue.from(\"refused\")\n" +
  "    catch\n" +
  "        JsError(e) => e\n" +
  "\n" +
  "// The borrow, held as a value: these take the view itself, so a test can\n" +
  "// keep one across a foreign mutation and ask it again.\n" +
  "export let borrowedLength(xs: Array(JsValue)): Int = Array.length(xs)\n" +
  "\n" +
  "export let elementAsInt(xs: Array(JsValue), index: Int): Result(Int, JsConversionError) =\n" +
  "    JsValue.toInt(xs[index])\n" +
  "\n" +
  "// The two projections of a failure that name no representation, as in\n" +
  "// `js-value-decoding.test.ts`: which reason, and how long the path is.\n" +
  "let reasonOf(reason: JsConversionReason): String = match reason\n" +
  "    JsConversionReason.Shape => \"Shape\"\n" +
  "    JsConversionReason.Range => \"Range\"\n" +
  "    JsConversionReason.Cycle(_) => \"Cycle\"\n" +
  "\n" +
  "export let failure(result: Result(a, JsConversionError)): String = match result\n" +
  "    Ok(_) => \"Ok\"\n" +
  "    Err(e) => reasonOf(e.reason)\n" +
  "\n" +
  "export let pathLength(result: Result(a, JsConversionError)): Int = match result\n" +
  "    Ok(_) => -1\n" +
  "    Err(e) => Vector.length(e.path)\n";

let exports_: Record<string, unknown>;

/** `"Ok"`, or the failing reason's name. */
function outcome(value: unknown): string {
  const decoded = (exports_["asArray"] as (v: unknown) => unknown)(value);
  return (exports_["failure"] as (r: unknown) => string)(decoded);
}

/** The failure path's length; `-1` on success. */
function pathLength(value: unknown): number {
  const decoded = (exports_["asArray"] as (v: unknown) => unknown)(value);
  return (exports_["pathLength"] as (r: unknown) => number)(decoded);
}

/**
 * The borrowed view on success; throws if `toArray` refused.
 *
 * Unwrapping in JavaScript is `js-value-decoding.test.ts`'s own `decoded`
 * shape, and it is what an identity assertion needs: the whole question is
 * whether the object inside the `Ok` *is* the array that went in.
 */
function borrowed(value: unknown): unknown {
  const result = (exports_["asArray"] as (v: unknown) => { tag: string; value?: unknown })(value);
  if (result.tag !== "Ok") throw new Error("toArray refused the value");
  return result.value;
}

function kindOf(value: unknown): string {
  return (exports_["kindOf"] as (v: unknown) => string)(value);
}

beforeAll(async () => {
  exports_ = await runMain(PROGRAM);
});

describe("success is the same array, borrowed (§4.2)", () => {
  test("a real array succeeds", () => {
    expect(outcome([])).toBe("Ok");
    expect(outcome([1, 2, 3])).toBe("Ok");
    expect(outcome(["mixed", 1, null, { a: 1 }])).toBe("Ok");
  });

  /**
   * **Zero-copy, asserted as identity.** `===` against the array that was
   * handed in is the only assertion that separates a borrow from a copy, and
   * §4.2's "the same array" is exactly this.
   */
  test("the success value is the very array that went in", () => {
    const source = [1, 2, 3];
    expect(borrowed(source)).toBe(source);
    const nested = [[1], [2]];
    expect(borrowed(nested)).toBe(nested);
  });

  /**
   * The same fact from the Hexagon side, which is where it matters: a view held
   * across a foreign mutation reports the *new* length. A copy would have kept
   * reporting the old one — and this is precisely why §6.2 puts a stability
   * obligation on foreign code rather than on the compiler.
   */
  test("a foreign mutation is visible through the held borrow", () => {
    const length = exports_["borrowedLength"] as (xs: unknown) => number;
    const source = [1, 2, 3];
    const view = borrowed(source);
    expect(length(view)).toBe(3);
    source.push(4);
    expect(length(view)).toBe(4);
    source.length = 1;
    expect(length(view)).toBe(1);
  });

  /**
   * §4.2: the elements "remain uncertain, and each is decoded individually by
   * the caller". So a heterogeneous array succeeds whole, and the per-element
   * verdicts are the ordinary scalar decoders' — including their failures.
   */
  test("elements are `JsValue`, decoded one at a time", () => {
    const asInt = exports_["elementAsInt"] as (
      xs: unknown,
      i: number,
    ) => { tag: string; value?: unknown };
    const view = borrowed([7, "not a number", 1.5]);
    expect(asInt(view, 1)).toMatchObject({ tag: "Ok", value: 7 });
    // Not a number at all: `Shape`. A number `Int` cannot hold: `Range`. The
    // split is `toInt`'s, and `toArray` did nothing to either element.
    expect(asInt(view, 2).tag).toBe("Err");
    expect(asInt(view, 3).tag).toBe("Err");
  });

  /**
   * The zero-scan rule survives the crossing: `toArray` inspects the *value*,
   * never its contents. An array of poisoned getters decodes without a single
   * one firing.
   */
  test("no element is read on the way through", () => {
    let reads = 0;
    const poisoned: unknown[] = [];
    for (const index of [0, 1, 2]) {
      Object.defineProperty(poisoned, index, {
        enumerable: true,
        get: () => {
          reads += 1;
          throw new Error("element getter");
        },
      });
    }
    expect(outcome(poisoned)).toBe("Ok");
    expect(reads).toBe(0);
  });
});

describe("failure is `Shape` with an empty path (§4.2, §5.1)", () => {
  test.each([
    ["a number", 42],
    ["a float", 1.5],
    ["a string", "[1,2,3]"],
    ["null", null],
    ["undefined", undefined],
    ["a plain object", { 0: 1, length: 1 }],
    ["a boolean", true],
    ["a bigint", 10n],
    ["a function", () => 1],
    ["a Set", new Set([1, 2])],
    ["a Date", new Date(0)],
  ])("%s fails with `Shape`", (_label, value) => {
    expect(outcome(value)).toBe("Shape");
  });

  /**
   * The path is empty because the decoder inspected the value itself and
   * descended into nothing — §5.1's rule, and the same empty path every scalar
   * decoder's failure carries.
   */
  test("the failure path is empty", () => {
    expect(pathLength(42)).toBe(0);
    expect(pathLength({ length: 0 })).toBe(0);
    expect(pathLength(null)).toBe(0);
  });

  /**
   * An **array-like is not an array**, and that is the whole content of "iff
   * `Array.isArray`". `arguments` is the case a JavaScript author is most
   * likely to meet, and it is the case a length-and-index duck test would have
   * wrongly accepted.
   */
  test("array-likes are refused, not coerced", () => {
    const argumentsObject = (function (
      this: unknown,
      ..._values: readonly number[]
    ): IArguments {
      return arguments;
    })(1, 2, 3);
    expect(outcome(argumentsObject)).toBe("Shape");
    expect(outcome({ length: 2, 0: "a", 1: "b" })).toBe("Shape");
    expect(outcome(new Int32Array([1, 2]))).toBe("Shape");
  });
});

describe("the probe is unguarded, and `kind`'s is not (§4.2 against §3)", () => {
  /**
   * The one input that distinguishes the two promises, asked of both, on the
   * same value, in one test — because the claim *is* the contrast, and two
   * tests in two files would not state it.
   *
   * The throw is the foreign `TypeError`, unwrapped and unbranded, leaving the
   * call — which is what the `JsError` door carries, not what it replaces
   * (§6.2's wrapping is virtual).
   */
  test("a revoked proxy throws out of `toArray` and classifies `Object` under `kind`", () => {
    const object = Proxy.revocable({}, {});
    object.revoke();
    // The premise, asserted so the test cannot pass vacuously if a future
    // JavaScript stops throwing here.
    expect(() => Array.isArray(object.proxy)).toThrow(TypeError);

    // Unguarded: the probe's throw is foreign control flow, and it leaves.
    expect(() => outcome(object.proxy)).toThrow(TypeError);
    // Guarded: the classification promises an answer for *any* value.
    expect(kindOf(object.proxy)).toBe("Object");
  });

  /** A revoked proxy over an array target is the same answer both ways. */
  test("the proxy's target does not matter — the probe is what throws", () => {
    const array = Proxy.revocable([1, 2] as unknown[], {});
    array.revoke();
    expect(() => outcome(array.proxy)).toThrow(TypeError);
    expect(kindOf(array.proxy)).toBe("Object");
  });

  /**
   * The observation, stated precisely: the value that leaves is the foreign one.
   * It is not converted into `Err(Shape)`, and it carries none of a Hexagon
   * exception's identity — no `$hex` brand, no Hexagon `name`.
   */
  test("what leaves is the raw foreign value, not an `Err` and not a branded throw", () => {
    const object = Proxy.revocable({}, {});
    object.revoke();
    let thrown: unknown;
    try {
      outcome(object.proxy);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(TypeError);
    expect(thrown).not.toHaveProperty("$hex");
  });

  /**
   * And the door it travels, named (#509). `JsError(e)` binds the very
   * `TypeError` the probe threw — the same object the test above watched leave
   * — which is §6.2's virtual wrapping and §4.3's channel split in one
   * observation: a throw is control, so it comes through `catch`, and it comes
   * through unchanged.
   */
  test("a `JsError(e)` arm catches that probe's throw, unbranded and unwrapped", () => {
    const object = Proxy.revocable({}, {});
    object.revoke();
    const caught = (exports_["arrayOrThrown"] as (v: unknown) => unknown)(object.proxy);
    // The engine's own `TypeError`, not a Hexagon exception carrying it: the
    // wrapping is virtual, so there is no brand and no payload slot to unwrap.
    expect(caught).toBeInstanceOf(TypeError);
    expect(caught).not.toHaveProperty("$hex");
    expect(caught).not.toHaveProperty("error");
    // A value the probe answers about, rather than throwing over, never reaches
    // the arm at all — the guard is the probe's, and only the probe's.
    expect((exports_["arrayOrThrown"] as (v: unknown) => unknown)([1])).toBe("decoded");
    expect((exports_["arrayOrThrown"] as (v: unknown) => unknown)(1)).toBe("refused");
  });

  /**
   * And the asymmetry is in the *emitted code*, which is where it has to be:
   * `kind`'s helper wraps its probe in a `try`, and `toArray`'s row is the bare
   * call. A future lowering that guarded both would pass nothing above but this.
   */
  test("the emitted rows differ: one probe is wrapped, the other is bare", () => {
    const compiled = compileMain(PROGRAM);
    expect(compiled.diagnostics).toEqual([]);
    const companion = compiled.modules.find(({ source }) => source.path.endsWith("/JsValue.hex"));
    expect(companion).toBeDefined();
    const javascript = companion!.javascript.text;
    expect(javascript).toContain("const isArray = __a => Array.isArray(__a);");
    // `kind`'s guard, in the helper the same module reaches.
    expect(javascript).toContain("try {");
  });
});

describe("what the operation spends, and what stays behind the door", () => {
  /**
   * `toArray` joins `stdlib/JsValue.hex`'s exports, so it is a **new bare
   * occupation**: no other prelude member exports the name, and the bare
   * spelling therefore resolves — the same class of spend `toString` is, and it
   * is recorded rather than hidden.
   */
  test("`toArray` is single-homed, so the bare spelling resolves", () => {
    expect(projectDiagnostics(
      "export let a(v: JsValue): Result(Array(JsValue), JsConversionError) = toArray(v)\n",
    )).toEqual([]);
  });

  /**
   * The probe and the crossing beneath it are **unexported** rows of the
   * intrinsic block (`spec/intrinsics.md` §3.2): the verdict above them is the
   * whole surface, and there is no way to spell either one without it. This is
   * §1's "no unsafe casts in v1" holding at the two places this slice could
   * have leaked — an unguarded predicate and an unchecked cast to `Array`.
   */
  test("the probe and the unchecked crossing are unreachable", () => {
    expect(projectDiagnostics("export let a(v: JsValue): Bool = isArray(v)\n"))
      .toEqual(["unknown name `isArray`"]);
    expect(projectDiagnostics("export let a(v: JsValue): Bool = JsValue.isArray(v)\n"))
      .toEqual(["module `JsValue` does not export `isArray`"]);
    expect(projectDiagnostics(
      "export let a(v: JsValue): Array(JsValue) = JsValue.asArrayUnchecked(v)\n",
    )).toEqual(["module `JsValue` does not export `asArrayUnchecked`"]);
  });
});

describe("the boundary face composes (`Array(JsValue)`)", () => {
  /**
   * FFI Part 1 §4.1's two rows, met: `Array(a)` faces `ReadonlyArray<a>` and
   * `JsValue` faces `unknown`, so the result of `toArray` faces
   * `Result<ReadonlyArray<unknown>, JsConversionError>`. Neither row is new; the
   * composition is, and it is the shape every JavaScript consumer of this
   * operation reads.
   */
  test("`Array(JsValue)` is `ReadonlyArray<unknown>` in the `.d.ts`", () => {
    const compiled = compileMain(PROGRAM);
    expect(compiled.diagnostics).toEqual([]);
    const main = compiled.modules.find(({ source }) => source.path === "/main.hex");
    expect(main!.declarations.text).toContain(
      "export declare const asArray: (v: unknown) => " +
        "Result<ReadonlyArray<unknown>, JsConversionError>;",
    );
    expect(main!.declarations.text).toContain(
      "export declare const borrowedLength: (xs: ReadonlyArray<unknown>) => number;",
    );
  });

  /**
   * And `tsc`'s opinion of it, because a pinned spelling inside an invalid file
   * is worth nothing (#132). The consumer reads through the borrow and is
   * refused when it writes — the readonly face doing its job at the one type
   * where the elements are `unknown`.
   */
  test("a TypeScript consumer reads through the face and cannot write to it", async () => {
    const compiled = compileMain(PROGRAM);
    // The whole declaration set, never one file: `main.d.ts` imports its types
    // from the prelude's own declaration files, and checking it alone is what
    // left #227 undetected.
    const files: Record<string, string> = {};
    for (const module of compiled.modules) {
      files[module.source.path.replace(/^\//u, "").replace(/\.hex$/u, ".d.ts")] =
        module.declarations.text;
    }
    if (compiled.runtimeDeclarations !== undefined) {
      files["hex.d.ts"] = compiled.runtimeDeclarations.text;
    }
    const errors = await typeScriptErrors({
      ...files,
      "consumer.ts":
        'import { asArray, borrowedLength } from "./main.js";\n' +
        "const decoded = asArray([1, 2, 3]);\n" +
        'if (decoded.tag === "Ok") {\n' +
        "  const view: ReadonlyArray<unknown> = decoded.value;\n" +
        "  const n: number = borrowedLength(view);\n" +
        "  void n;\n" +
        "  // @ts-expect-error a borrowed array is readonly from TypeScript too\n" +
        "  view[0] = 9;\n" +
        "}\n",
    });
    expect(errors).toEqual([]);
  });
});
