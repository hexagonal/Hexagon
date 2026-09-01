import { beforeAll, describe, expect, test } from "vitest";

import { compileFiles, projectDiagnostics, runMain } from "../support/test-project.js";

/**
 * Conformance for **`JsValue.kind` and the strict scalar decoders** — FFI
 * Part 11 §3, §4.1, §5.1 and §11's checklist rows (issue #511).
 *
 * Almost everything here is a **runtime** observation, and deliberately so.
 * §3's two hard promises — property-free and total — are properties of the
 * emitted JavaScript and of nothing else: a classification that reads one
 * property still typechecks, and a probe that throws on a revoked proxy still
 * typechecks. Only executing the emitted module against a hostile value tells
 * the two apart, so the harness links the compiler's own output through a
 * `data:` URL and hands it real proxies.
 *
 * The decoders are §1's doctrine in five instances: **a decoder succeeds if and
 * only if the value already is the target representation.** Nothing is parsed,
 * truncated, rounded, `String()`-ed or `Number()`-ed. The table below is
 * §4.1's, row for row, including the corner it exists for: `toInt` splits
 * `Shape` from `Range`, because "not a number at all" and "a number `Int`
 * cannot hold" are different mistakes with different repairs.
 *
 * `JsValue` itself, the nullish collapse and `from`'s erasure are
 * `js-value-boundary.test.ts`'s; `JsKind`'s qualified-only constructors are
 * `js-kind-qualification.test.ts`'s.
 */

/**
 * The one compiled program every runtime test below drives.
 *
 * Its surface is deliberately thin: the classification, the five decoders, and
 * two projections of a failure — the reason's tag and the path's length —
 * because a `JsConversionError`'s representation is not this file's subject and
 * a test that walked it would pin one.
 */
const PROGRAM = "export let kindOf(v: JsValue): JsKind = JsValue.kind(v)\n" +
  "export let asInt(v: JsValue): Result(Int, JsConversionError) = JsValue.toInt(v)\n" +
  "export let asFloat(v: JsValue): Result(Float, JsConversionError) = JsValue.toFloat(v)\n" +
  "export let asBigInt(v: JsValue): Result(BigInt, JsConversionError) = JsValue.toBigInt(v)\n" +
  "export let asBool(v: JsValue): Result(Bool, JsConversionError) = JsValue.toBool(v)\n" +
  "export let asString(v: JsValue): Result(String, JsConversionError) = JsValue.toString(v)\n" +
  "\n" +
  "// The two projections of a failure a caller can make without naming a\n" +
  "// representation: which reason, and how long the path is.\n" +
  "// The reasons are matched qualified because `spec/ffi.md` §12's extension\n" +
  "// (#511) makes them qualified-only; the arms are the same arms.\n" +
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

type Decoder = "asInt" | "asFloat" | "asBigInt" | "asBool" | "asString";

let exports_: Record<string, unknown>;

/** `JsValue.kind(value)`, as the `JsKind` name-string it is (Unions §6.2). */
function kindOf(value: unknown): string {
  return (exports_["kindOf"] as (v: unknown) => string)(value);
}

/** `"Ok"`, or the failing reason's name. */
function outcome(decoder: Decoder, value: unknown): string {
  const decoded = (exports_[decoder] as (v: unknown) => unknown)(value);
  return (exports_["failure"] as (r: unknown) => string)(decoded);
}

/** The decoded value on success; throws if the decoder failed. */
function decoded(decoder: Decoder, value: unknown): unknown {
  const result = (exports_[decoder] as (v: unknown) => { tag: string; value?: unknown })(value);
  if (result.tag !== "Ok") throw new Error(`${decoder} refused the value`);
  return result.value;
}

/** The failure path's length; `-1` when the decoder succeeded. */
function pathLength(decoder: Decoder, value: unknown): number {
  const result = (exports_[decoder] as (v: unknown) => unknown)(value);
  return (exports_["pathLength"] as (r: unknown) => number)(result);
}

beforeAll(async () => {
  exports_ = await runMain(PROGRAM);
});

describe("`kind` classifies ten ways (§3)", () => {
  /**
   * §3's inventory, run: `undefined` and `null` by direct comparison, six by
   * `typeof`, arrays by `Array.isArray`, everything else `Object`. The two
   * nullish forms are *distinguished* — that is the whole reason `JsValue`
   * absorbs nullishness rather than wrapping it (§8), since `kind` is what the
   * three-way split is spelled with.
   */
  test.each([
    ["undefined", undefined, "Undefined"],
    ["null", null, "Null"],
    ["a boolean", true, "Bool"],
    ["a number", 1.5, "Number"],
    ["a bigint", 10n, "BigInt"],
    ["a string", "text", "String"],
    ["a symbol", Symbol("s"), "Symbol"],
    ["a function", () => 1, "Function"],
    ["an array", [1, 2], "Array"],
    ["a plain object", { a: 1 }, "Object"],
    ["a Date", new Date(0), "Object"],
    ["a Map", new Map(), "Object"],
    ["a class instance", new (class {})(), "Object"],
    ["a boxed Number object", new Number(1), "Object"],
  ])("%s classifies as its kind", (_label, value, expected) => {
    expect(kindOf(value)).toBe(expected);
  });

  /**
   * §3: "there is no `Int` kind — the `Int`/`Float` distinction is a Hexagon
   * refinement invisible to `typeof`". Both of these are `Number`, and telling
   * them apart is `toInt`'s range check, not `kind`'s job.
   */
  test("a whole number and a fraction are both `Number` — there is no `Int` kind", () => {
    expect(kindOf(3)).toBe("Number");
    expect(kindOf(3.5)).toBe("Number");
    expect(kindOf(Number.NaN)).toBe("Number");
    expect(kindOf(Number.POSITIVE_INFINITY)).toBe("Number");
    expect(projectDiagnostics("export let k: JsKind = JsKind.Int\n"))
      .toEqual(["module `JsKind` does not export `Int`"]);
  });

  /**
   * §3's totality clause, and the one input that makes it a real promise:
   * `Array.isArray` on a **revoked proxy** throws a `TypeError`. `kind` guards
   * that one probe and answers `Object`. Contrast `toArray` (§4.2), which does
   * not guard — that asymmetry is §1's doctrine applied honestly, and `toArray`
   * is a later slice.
   */
  test("a revoked proxy classifies `Object` instead of throwing", () => {
    const object = Proxy.revocable({}, {});
    object.revoke();
    // The premise, asserted so the test cannot pass vacuously if a future
    // JavaScript stops throwing here.
    expect(() => Array.isArray(object.proxy)).toThrow(TypeError);
    expect(kindOf(object.proxy)).toBe("Object");

    // A revoked proxy over an *array* target is the same answer: the probe is
    // what throws, and the target is unreachable through it.
    const array = Proxy.revocable([] as unknown[], {});
    array.revoke();
    expect(kindOf(array.proxy)).toBe("Object");

    // A revoked proxy over a *function* never reaches the probe at all —
    // `typeof` answers first, and `typeof` does not throw.
    const callable = Proxy.revocable(() => 1, {});
    callable.revoke();
    expect(kindOf(callable.proxy)).toBe("Function");
  });

  /**
   * §3: "**property-free means property-free**: the implementation never reads
   * a property, never invokes a getter, never triggers a proxy `get`/`has`
   * trap." A proxy whose traps throw is the only way to *prove* that, and it is
   * the reason this test executes rather than reads the emitted text.
   */
  test("a proxy with throwing traps is classified without being touched", () => {
    const touched: string[] = [];
    const hostile = new Proxy({}, {
      get(_target, property) {
        touched.push(String(property));
        throw new Error("get trap");
      },
      has(_target, property) {
        touched.push(`has:${String(property)}`);
        throw new Error("has trap");
      },
      getOwnPropertyDescriptor(_target, property) {
        touched.push(`descriptor:${String(property)}`);
        throw new Error("descriptor trap");
      },
      ownKeys() {
        touched.push("ownKeys");
        throw new Error("ownKeys trap");
      },
    });
    expect(kindOf(hostile)).toBe("Object");
    expect(touched).toEqual([]);
  });

  /** A poisoned getter on an ordinary object is the same promise, one rung down. */
  test("a throwing getter is never invoked", () => {
    let reads = 0;
    const poisoned = {
      get boom(): never {
        reads += 1;
        throw new Error("getter");
      },
    };
    expect(kindOf(poisoned)).toBe("Object");
    expect(reads).toBe(0);
  });

  /** The classification is reachable both ways: qualified, and as a dot call. */
  test("`JsValue.kind(v)` and `v.kind()` are the same operation", async () => {
    const main = await runMain(
      "export let qualified(v: JsValue): JsKind = JsValue.kind(v)\n" +
        "export let dotted(v: JsValue): JsKind = v.kind()\n",
    );
    const qualified = main["qualified"] as (v: unknown) => string;
    const dotted = main["dotted"] as (v: unknown) => string;
    for (const value of [undefined, null, 1, "s", [1]]) {
      expect(dotted(value)).toBe(qualified(value));
    }
  });
});

describe("the scalar decoders are strict and non-coercing (§4.1)", () => {
  /**
   * §4.1's `toFloat` row: succeeds iff `kind` is `Number`, and **any** number
   * qualifies. `NaN`, both infinities and `-0` are `Float` values, so refusing
   * them would be a domain claim the type does not make.
   */
  test.each([
    ["zero", 0],
    ["a fraction", 1.5],
    ["a negative", -2.25],
    ["negative zero", -0],
    ["NaN", Number.NaN],
    ["positive infinity", Number.POSITIVE_INFINITY],
    ["negative infinity", Number.NEGATIVE_INFINITY],
    ["2^53", 2 ** 53],
  ])("`toFloat` accepts %s", (_label, value) => {
    expect(outcome("asFloat", value)).toBe("Ok");
    expect(Object.is(decoded("asFloat", value), value)).toBe(true);
  });

  test.each([
    ["a string", "1.5"],
    ["a numeric string", "42"],
    ["a bigint", 1n],
    ["a boolean", true],
    ["null", null],
    ["undefined", undefined],
    ["an array", [1]],
    ["an object", { valueOf: () => 1 }],
  ])("`toFloat` refuses %s with `Shape`", (_label, value) => {
    expect(outcome("asFloat", value)).toBe("Shape");
  });

  /**
   * §4.1's `toInt` row, and the reason the reason classes exist. A number
   * outside the safe-integer domain is a **`Range`** failure — it is the right
   * *kind* of thing — while anything that is not a number at all is `Shape`.
   * The boundary cases are named in the spec itself: `1.5`, `2^53` and `NaN`
   * are all `Range`.
   */
  test.each([
    ["zero", 0],
    ["negative zero", -0],
    ["a positive whole number", 42],
    ["a negative whole number", -42],
    ["2^53 - 1, the largest safe integer", 2 ** 53 - 1],
    ["-(2^53 - 1)", -(2 ** 53 - 1)],
  ])("`toInt` accepts %s", (_label, value) => {
    expect(outcome("asInt", value)).toBe("Ok");
    expect(Object.is(decoded("asInt", value), value)).toBe(true);
  });

  test.each([
    ["a fraction", 1.5],
    ["2^53", 2 ** 53],
    ["-(2^53)", -(2 ** 53)],
    ["NaN", Number.NaN],
    ["positive infinity", Number.POSITIVE_INFINITY],
    ["negative infinity", Number.NEGATIVE_INFINITY],
  ])("`toInt` refuses %s with `Range` — it is a number `Int` cannot hold", (_label, value) => {
    expect(outcome("asInt", value)).toBe("Range");
  });

  test.each([
    ["a numeric string", "42"],
    ["a bigint that would fit", 42n],
    ["a boolean", true],
    ["null", null],
    ["undefined", undefined],
    ["an array of one number", [42]],
  ])("`toInt` refuses %s with `Shape` — it is not a number at all", (_label, value) => {
    expect(outcome("asInt", value)).toBe("Shape");
  });

  /** §4.1: `toBigInt` needs the exact `typeof`. A whole `number` is not a bigint. */
  test("`toBigInt` accepts a bigint and refuses everything else", () => {
    expect(outcome("asBigInt", 42n)).toBe("Ok");
    expect(decoded("asBigInt", 42n)).toBe(42n);
    expect(outcome("asBigInt", -1n)).toBe("Ok");
    for (const value of [42, "42", true, null, undefined, [42n]]) {
      expect(outcome("asBigInt", value)).toBe("Shape");
    }
  });

  /**
   * §1's own example: **`JsValue.toBool` on `1` fails.** Truthiness is a
   * foreign-side decision made in foreign code, never a Hexagon default, so
   * neither `1` nor `0` nor `""` is a `Bool` here.
   */
  test("`toBool` accepts a boolean and refuses `1`", () => {
    expect(outcome("asBool", true)).toBe("Ok");
    expect(decoded("asBool", true)).toBe(true);
    expect(outcome("asBool", false)).toBe("Ok");
    expect(decoded("asBool", false)).toBe(false);
    for (const value of [1, 0, "", "true", null, undefined, {}]) {
      expect(outcome("asBool", value)).toBe("Shape");
    }
  });

  /**
   * §1's other example: **`JsValue.toString` on `42` fails.** Nothing calls
   * `String()`, and no `toString` of the value's is invoked — the second half
   * matters, because a hostile object's `toString` is exactly the foreign code
   * §1 refuses to run.
   */
  test("`toString` accepts a string and refuses `42`", () => {
    expect(outcome("asString", "text")).toBe("Ok");
    expect(decoded("asString", "text")).toBe("text");
    expect(outcome("asString", "")).toBe("Ok");
    for (const value of [42, true, null, undefined, ["x"]]) {
      expect(outcome("asString", value)).toBe("Shape");
    }
    let calls = 0;
    const stringly = {
      toString(): string {
        calls += 1;
        return "converted";
      },
    };
    expect(outcome("asString", stringly)).toBe("Shape");
    expect(calls).toBe(0);
  });

  /**
   * §5.1: "empty vector = the decoded value itself (**every** §4.1–4.2 failure
   * has an empty path)". A scalar decoder inspects the value it was given and
   * descends into nothing, so there is no segment to name.
   */
  test.each([
    ["asInt", "a non-number", "x"],
    ["asInt", "an unsafe integer", 2 ** 53],
    ["asFloat", "a string", "1"],
    ["asBigInt", "a number", 1],
    ["asBool", "a number", 1],
    ["asString", "a number", 42],
  ] as const)("%s's failure on %s carries the empty path", (decoder, _label, value) => {
    expect(pathLength(decoder, value)).toBe(0);
  });

  /**
   * The decoders are property-free for the same reason `kind` is: they inspect
   * through `kind` and never touch the value. A hostile proxy is refused rather
   * than interrogated, and its traps never fire.
   */
  test("a hostile proxy is refused by every decoder without being touched", () => {
    const touched: string[] = [];
    const hostile = new Proxy({}, {
      get(_target, property) {
        touched.push(String(property));
        throw new Error("get trap");
      },
    });
    for (const decoder of ["asInt", "asFloat", "asBigInt", "asBool", "asString"] as const) {
      expect(outcome(decoder, hostile)).toBe("Shape");
    }
    expect(touched).toEqual([]);
  });

  /** The decoders reach through the dot as well, at the same companion. */
  test("`v.toInt()` is `JsValue.toInt(v)`", async () => {
    const main = await runMain(
      "export let dotted(v: JsValue): Result(Int, JsConversionError) = v.toInt()\n" +
        "export let ok(r: Result(Int, JsConversionError)): Bool = match r\n" +
        "    Ok(_) => True\n" +
        "    Err(_) => False\n",
    );
    const dotted = main["dotted"] as (v: unknown) => unknown;
    const ok = main["ok"] as (r: unknown) => boolean;
    expect(ok(dotted(3))).toBe(true);
    expect(ok(dotted(3.5))).toBe(false);
  });
});

describe("the failure type is ordinary data (§5.1)", () => {
  /**
   * §5.1: "**It is ordinary data** — a record over unions, carried in `Err`
   * like any other value. The checked-failure path allocates no `Error`,
   * captures no stack, and carries no brand." So it is *not* throwable, which is
   * the observable half of the rule: a caller who wants to abort matches and
   * throws an exception of its own choosing, at its own site.
   */
  test("a `JsConversionError` is not an exception and cannot be thrown", () => {
    expect(projectDiagnostics(
      "export let abort(v: JsValue): Int = match JsValue.toInt(v)\n" +
        "    Ok(n) => n\n" +
        "    Err(e) => throw(e)\n",
    )[0]).toContain("Exn");
  });

  /** And the value itself carries no `Error` machinery at run time. */
  test("the failure value has no stack, no name, and no brand", async () => {
    const main = await runMain(
      "export let fail(v: JsValue): Result(Int, JsConversionError) = JsValue.toInt(v)\n",
    );
    const failure = (main["fail"] as (v: unknown) => { tag: string; error: unknown })("x");
    expect(failure.tag).toBe("Err");
    expect(failure.error).not.toBeInstanceOf(Error);
    const error = failure.error as Record<string, unknown>;
    expect(error["stack"]).toBeUndefined();
    expect(error["name"]).toBeUndefined();
    expect(error["$hex"]).toBeUndefined();
    expect(Object.keys(error).sort()).toEqual(["path", "reason"]);
  });

  /**
   * §5.1's path vocabulary is fixed at five segments and the reason classes at
   * three, so a program can name each of them today even though nothing in this
   * slice originates a non-empty path (§6.3: `Field` and `Index` originate from
   * conversions that traverse, and there are none in the v1 core surface).
   *
   * Each is named **qualified**, which since §12's extension (#511) is the only
   * way any of the eight can be named at all; the bare refusals are
   * `js-kind-qualification.test.ts`'s.
   */
  test("the whole path vocabulary and every reason class is nameable", () => {
    expect(projectDiagnostics(
      "export let segments: Vector(JsPathSegment) = [\n" +
        "    JsPathSegment.Field(\"name\"),\n" +
        "    JsPathSegment.Index(3),\n" +
        "    JsPathSegment.MapKey(2),\n" +
        "    JsPathSegment.MapValue(2),\n" +
        "    JsPathSegment.SetElement(1),\n" +
        "]\n" +
        "export let reasons: Vector(JsConversionReason) = [\n" +
        "    JsConversionReason.Shape,\n" +
        "    JsConversionReason.Range,\n" +
        "    JsConversionReason.Cycle([JsPathSegment.Index(1)]),\n" +
        "]\n" +
        "export let error: JsConversionError =\n" +
        "    JsConversionError({ reason = JsConversionReason.Shape, path = [] })\n",
    )).toEqual([]);
  });
});

describe("the companion is `stdlib/JsValue.hex` (Method Syntax §4.1)", () => {
  /**
   * The companion is the module addressable under the type's name, so the whole
   * §4.1 surface is reachable qualified — and *only* that module's exports are,
   * which is what makes the dot call type-directed rather than lexical.
   */
  test("the qualified surface is the section's, and nothing else", () => {
    expect(projectDiagnostics(
      "export let a(v: JsValue): JsKind = JsValue.kind(v)\n" +
        "export let b(v: JsValue): Result(Int, JsConversionError) = JsValue.toInt(v)\n" +
        "export let c(v: JsValue): Result(Float, JsConversionError) = JsValue.toFloat(v)\n" +
        "export let d(v: JsValue): Result(BigInt, JsConversionError) = JsValue.toBigInt(v)\n" +
        "export let e(v: JsValue): Result(Bool, JsConversionError) = JsValue.toBool(v)\n" +
        "export let f(v: JsValue): Result(String, JsConversionError) = JsValue.toString(v)\n",
    )).toEqual([]);
  });

  /**
   * `toArray` (§4.2) is the next slice's, not this one's — recorded here so the
   * boundary of what shipped is a test rather than a memory.
   */
  test("`toArray` is not part of this surface yet", () => {
    expect(projectDiagnostics("export let a(v: JsValue): Int = JsValue.toArray(v)\n"))
      .toContain("module `JsValue` does not export `toArray`");
  });

  /**
   * The unchecked crossings behind the decoders are **unexported** rows of the
   * intrinsic block (`spec/intrinsics.md` §3.2): the guard above each one is
   * the surface, and there is no way to spell the crossing without it. This is
   * §1's "no unsafe casts in v1" holding at the one place it could have leaked.
   */
  test("the unchecked crossings beneath the decoders are unreachable", () => {
    for (const name of [
      "asIntUnchecked",
      "asFloatUnchecked",
      "asBigIntUnchecked",
      "asBoolUnchecked",
      "asStringUnchecked",
      "isSafeInteger",
    ]) {
      expect(projectDiagnostics(`export let x(v: JsValue): Int = JsValue.${name}(v)\n`))
        .toContain(`module \`JsValue\` does not export \`${name}\``);
    }
  });

  /** The emitted classification is one helper, shared, and reached by import. */
  test("the companion's `kind` lowers to the guarded classification helper", () => {
    const compiled = compileFiles([["/main.hex",
      "export let k(v: JsValue): JsKind = JsValue.kind(v)\n"]]);
    expect(compiled.diagnostics).toEqual([]);
    const companion = compiled.modules.find(({ source }) => source.path === "/JsValue.hex")!;
    const text = companion.javascript.text;
    expect(text).toContain('if (__value === undefined) return "Undefined";');
    expect(text).toContain('if (__value === null) return "Null";');
    expect(text).toContain('if (__type === "function") return "Function";');
    // The guard is the totality promise, and it is one `try` around one probe.
    expect(text).toContain("  try {");
    expect(text).toContain('.isArray(__value) ? "Array" : "Object";');
    expect(text).toContain("  } catch {");
    // The five crossings are the identity, and the predicate is the host's.
    expect(text).toContain("__a => __a");
    expect(text).toContain(".isSafeInteger(__a)");
  });
});

/**
 * What seating `JsValue.hex` in the prelude costs the **bare** namespace, which
 * is the one thing this slice takes away rather than adds.
 *
 * `toInt` and `toFloat` were `BigInt.hex`'s alone, so bare `toInt(b)` at a
 * `BigInt` resolved and compiled. `JsValue.hex` exports both spellings for its
 * own type, and Modules §5.5 refuses a bare prelude name two members export
 * rather than picking one — so that call is now the ambiguity error, naming
 * both homes and both rewrites. This is the shape #373 already pinned for
 * `empty` across four homes; the difference is that this one is a **change**,
 * and the pin exists so it cannot happen again unnoticed.
 *
 * It pins current behaviour, not a settled design: whether a prelude module may
 * be qualified-only for functions, the way `spec/ffi.md` §12 made `JsKind`'s
 * constructors, is an open question filed separately. Nothing here anticipates
 * an answer.
 */
describe("the bare namespace this slice narrows (Modules §5.5)", () => {
  test("bare `toInt` and `toFloat` are refused, naming both homes", () => {
    expect(projectDiagnostics("export let n(b: BigInt): Int = toInt(b)\n")).toEqual([
      "the prelude name `toInt` is ambiguous: exported by `BigInt` and `JsValue`; " +
      "write `BigInt.toInt` or `JsValue.toInt`",
    ]);
    expect(projectDiagnostics("export let f(b: BigInt): Float = toFloat(b)\n")).toEqual([
      "the prelude name `toFloat` is ambiguous: exported by `BigInt` and `JsValue`; " +
      "write `BigInt.toFloat` or `JsValue.toFloat`",
    ]);
  });

  /**
   * The refusal is about the *name*, not about the argument — §5.5 is a scoping
   * rule and resolution has no type to consult. So a `JsValue` argument draws
   * the same message, and the repair the message offers is the whole of what a
   * reader has to do.
   */
  test("the argument's type does not change the refusal", () => {
    expect(projectDiagnostics("export let n(v: JsValue): Int = toInt(v)\n")).toEqual([
      "the prelude name `toInt` is ambiguous: exported by `BigInt` and `JsValue`; " +
      "write `BigInt.toInt` or `JsValue.toInt`",
    ]);
  });

  /** And both offered repairs answer, alongside the dot call §5.5 leaves alone. */
  test("the qualified spelling and the dot call both compile", () => {
    expect(projectDiagnostics(
      "export let a(b: BigInt): Option(Int) = BigInt.toInt(b)\n" +
        "export let b_(b: BigInt): Option(Int) = b.toInt()\n" +
        "export let c(b: BigInt): Float = BigInt.toFloat(b)\n" +
        "export let d(b: BigInt): Float = b.toFloat()\n" +
        "export let e(v: JsValue): Result(Int, JsConversionError) = JsValue.toInt(v)\n" +
        "export let f(v: JsValue): Result(Float, JsConversionError) = v.toFloat()\n",
    )).toEqual([]);
  });

  /** Run, because "compiles" is not the claim — the two homes stay two answers. */
  test("the two homes answer their own way at run time", async () => {
    const main = await runMain(
      "export let qualified: Option(Int) = BigInt.toInt(5n)\n" +
        "export let dotted: Option(Int) = 5n.toInt()\n" +
        "export let widened: Float = BigInt.toFloat(5n)\n" +
        "export let dottedFloat: Float = 5n.toFloat()\n" +
        "export let foreign(v: JsValue): Result(Int, JsConversionError) = JsValue.toInt(v)\n",
    );
    expect(main["qualified"]).toEqual({ tag: "Some", value: 5 });
    expect(main["dotted"]).toEqual({ tag: "Some", value: 5 });
    expect(main["widened"]).toBe(5);
    expect(main["dottedFloat"]).toBe(5);
    const foreign = main["foreign"] as (v: unknown) => { tag: string; value?: unknown };
    expect(foreign(7)).toEqual({ tag: "Ok", value: 7 });
    expect(foreign(7.5).tag).toBe("Err");
  });
});
