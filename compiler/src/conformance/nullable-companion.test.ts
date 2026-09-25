import { describe, expect, test } from "vitest";

import { compileFiles, projectDiagnostics, runMain } from "../support/test-project.js";
import { typeScriptErrors } from "../support/typescript-check.js";

/**
 * Executable conformance for the `Nullable` companion (FFI Part 2 §§2–4), its
 * designated absorption rules (Part 2 §2.1; Part 11 §8), and the relaxed-value-
 * restriction claim that permits its two polymorphic values.
 */

function compiled(source: string) {
  const project = compileFiles([["/main.hex", "module Main\n\n" + source]]);
  expect(project.diagnostics).toEqual([]);
  return project.modules.find(({ source: file }) => file.path === "/main.hex")!;
}

describe("values, predicates, and exact classification (FFI Part 2 §§2–3)", () => {
  test("the two values and every predicate preserve JavaScript nullishness", async () => {
    const main = await runMain(
      "module Main\n\n" +
        "export let missing(): Nullable(String) = Nullable.undefined\n" +
        "export let empty(): Nullable(String) = Nullable.null\n" +
        "export let inspectString(value: Nullable(String)): (Bool, Bool, Bool) =\n" +
        "    (Nullable.isNullish(value), Nullable.isNull(value), Nullable.isUndefined(value))\n" +
        "export let inspectInt(value: Nullable(Int)): (Bool, Bool, Bool) =\n" +
        "    (Nullable.isNullish(value), Nullable.isNull(value), Nullable.isUndefined(value))\n" +
        "export let inspectBool(value: Nullable(Bool)): (Bool, Bool, Bool) =\n" +
        "    (Nullable.isNullish(value), Nullable.isNull(value), Nullable.isUndefined(value))\n",
    );
    expect((main["missing"] as () => unknown)()).toBeUndefined();
    expect((main["empty"] as () => unknown)()).toBeNull();
    const strings = main["inspectString"] as (value: unknown) => boolean[];
    const ints = main["inspectInt"] as (value: unknown) => boolean[];
    const bools = main["inspectBool"] as (value: unknown) => boolean[];
    expect(strings(null)).toEqual([true, true, false]);
    expect(strings(undefined)).toEqual([true, false, true]);
    expect(strings("value")).toEqual([false, false, false]);
    expect(strings("")).toEqual([false, false, false]);
    expect(ints(0)).toEqual([false, false, false]);
    expect(bools(false)).toEqual([false, false, false]);
  });

  test("toCase preserves three ways and extracts a present value", async () => {
    const main = await runMain(
      "module Main\n\n" +
        "export let classify(value: Nullable(String)): String =\n" +
        "    match Nullable.toCase(value)\n" +
        "        NullableCase.Undefined => \"undefined\"\n" +
        "        NullableCase.Null => \"null\"\n" +
        "        NullableCase.Value(text) => text\n",
    );
    const classify = main["classify"] as (value: unknown) => string;
    expect(classify(undefined)).toBe("undefined");
    expect(classify(null)).toBe("null");
    expect(classify("present")).toBe("present");
  });
});

describe("Option conversions (FFI Part 2 §4)", () => {
  test("toOption collapses absence and fromOption chooses the documented form", async () => {
    const main = await runMain(
      "module Main\n\n" +
        "export let read(value: Nullable(String)): String =\n" +
        "    match Nullable.toOption(value)\n" +
        "        None => \"none\"\n" +
        "        Some(text) => text\n" +
        "export let missing(): Nullable(String) = Nullable.fromOption(None)\n" +
        "export let empty(): Nullable(String) = Nullable.fromOptionOrNull(None)\n" +
        "export let present(text: String): Nullable(String) = Nullable.fromOption(Some(text))\n" +
        "export let presentOrNull(text: String): Nullable(String) = Nullable.fromOptionOrNull(Some(text))\n",
    );
    const read = main["read"] as (value: unknown) => string;
    expect(read(null)).toBe("none");
    expect(read(undefined)).toBe("none");
    expect(read("value")).toBe("value");
    expect((main["missing"] as () => unknown)()).toBeUndefined();
    expect((main["empty"] as () => unknown)()).toBeNull();
    expect((main["present"] as (value: string) => unknown)("x")).toBe("x");
    expect((main["presentOrNull"] as (value: string) => unknown)("y")).toBe("y");
  });

  test("absorbing and already-nullish element types classify by runtime value", async () => {
    const main = await runMain(
      "module Main\n\n" +
        "export extern enum Tri = true as Yes | null as Unknown | undefined as Missing\n" +
        "export let js(value: JsValue): Bool =\n" +
        "    match Nullable.toOption(value)\n" +
        "        None => False\n" +
        "        Some(_) => True\n" +
        "export let tri(value: Tri): Bool =\n" +
        "    match Nullable.toOption(value)\n" +
        "        None => False\n" +
        "        Some(_) => True\n" +
        "export let triNone(): Tri = Nullable.fromOption(None)\n" +
        "export let nested(): Nullable(String) = Nullable.fromOption(Some(Nullable.null))\n" +
        "export let unit(): Bool =\n" +
        "    match Nullable.toOption(Nullable.fromOption(Some(())))\n" +
        "        None => True\n" +
        "        Some(_) => False\n",
    );
    const js = main["js"] as (value: unknown) => boolean;
    const tri = main["tri"] as (value: unknown) => boolean;
    expect(js(null)).toBe(false);
    expect(js(undefined)).toBe(false);
    expect(js({})).toBe(true);
    expect(tri(null)).toBe(false);
    expect(tri(undefined)).toBe(false);
    expect(tri(true)).toBe(true);
    expect((main["triNone"] as () => unknown)()).toBeUndefined();
    expect((main["nested"] as () => unknown)()).toBeNull();
    expect((main["unit"] as () => boolean)()).toBe(true);
  });

  test("one-nullish enums remain wrapped while conversions intentionally lose provenance", async () => {
    const main = await runMain(
      "module Main\n\n" +
        "export extern enum NullSlot = true as Yes | null as Unknown\n" +
        "export extern enum UndefinedSlot = \"ready\" as Ready | undefined as Missing\n" +
        "export let nullSlot(value: Nullable(NullSlot)): String =\n" +
        "    match Nullable.toCase(value)\n" +
        "        NullableCase.Null => \"null\"\n" +
        "        NullableCase.Undefined => \"undefined\"\n" +
        "        NullableCase.Value(_) => \"value\"\n" +
        "export let undefinedSlot(value: Nullable(UndefinedSlot)): String =\n" +
        "    match Nullable.toCase(value)\n" +
        "        NullableCase.Null => \"null\"\n" +
        "        NullableCase.Undefined => \"undefined\"\n" +
        "        NullableCase.Value(_) => \"value\"\n" +
        "export let nullMemberLost(): Bool =\n" +
        "    match Nullable.toOption(Nullable.fromOption(Some(Unknown)))\n" +
        "        None => True\n" +
        "        Some(_) => False\n" +
        "export let undefinedMemberLost(): Bool =\n" +
        "    match Nullable.toOption(Nullable.fromOption(Some(Missing)))\n" +
        "        None => True\n" +
        "        Some(_) => False\n" +
        "export let nullSlotNone(): Nullable(NullSlot) = Nullable.fromOption(None)\n" +
        "export let undefinedSlotNull(): Nullable(UndefinedSlot) = Nullable.fromOptionOrNull(None)\n",
    );
    const nullSlot = main["nullSlot"] as (value: unknown) => string;
    const undefinedSlot = main["undefinedSlot"] as (value: unknown) => string;
    expect(nullSlot(null)).toBe("null");
    expect(nullSlot(undefined)).toBe("undefined");
    expect(nullSlot(true)).toBe("value");
    expect(undefinedSlot(null)).toBe("null");
    expect(undefinedSlot(undefined)).toBe("undefined");
    expect(undefinedSlot("ready")).toBe("value");
    expect((main["nullMemberLost"] as () => boolean)()).toBe(true);
    expect((main["undefinedMemberLost"] as () => boolean)()).toBe(true);
    expect((main["nullSlotNone"] as () => unknown)()).toBeUndefined();
    expect((main["undefinedSlotNull"] as () => unknown)()).toBeNull();
  });
});

describe("variance, faces, and emission", () => {
  test("the reserved `null` export keeps one stable JavaScript and TypeScript linkage", async () => {
    const project = compileFiles([["/main.hex", "module Main\n\n" +
      "export let absent: Nullable(Int) = Nullable.null\n"]]);
    expect(project.diagnostics).toEqual([]);
    const nullable = project.modules.find(({ source }) => source.path.endsWith("Nullable.hex"));
    if (nullable === undefined) throw new Error("the stdlib `Nullable` module was not emitted");

    expect(nullable.javascript.text).toContain("const __null = nullValue();");
    expect(nullable.javascript.text).toContain("export { __null as null };");
    expect(nullable.javascript.text).not.toMatch(/__null_\d+/u);
    expect(nullable.declarations.text).toContain("declare const __null:");
    expect(nullable.declarations.text).toContain("export { __null as null };");
    expect(nullable.declarations.text).not.toMatch(/__null_\d+/u);

    const nullableSpecifier = `.${nullable.path.replace(/\.hex$/u, ".js")}`;
    const files: Record<string, string> = {
      "consumer.ts":
        `import { null as nullableNull } from ${JSON.stringify(nullableSpecifier)};\n` +
        "export const absent: null | undefined = nullableNull;\n",
    };
    for (const module of project.modules) {
      files[module.path.replace(/^\//u, "").replace(/\.hex$/u, ".d.ts")] =
        module.declarations.text;
    }
    expect(await typeScriptErrors(files)).toEqual([]);
  });

  test("Nullable values generalize on the same control as an expansive empty Seq", () => {
    expect(projectDiagnostics(
      "module Main\n\n" +
        "let getEmpty() = Seq.empty\n" +
        "let e = getEmpty()\n" +
        "let xs = e.prepend(42)\n" +
        "let ys = e.prepend(42n)\n" +
        "let getNull() = Nullable.null\n" +
        "let getUndefined() = Nullable.undefined\n" +
        "let n = getNull()\n" +
        "let u = getUndefined()\n" +
        "let ni: Nullable(Int) = n\n" +
        "let ns: Nullable(String) = n\n" +
        "let ui: Nullable(Int) = u\n" +
        "let us: Nullable(String) = u\n",
    )).toEqual([]);
  });

  test("a nullable containing a present value cannot be reused at an incompatible type", () => {
    expect(projectDiagnostics(
      "module Main\n\n" +
        "let present = Nullable.fromOption(Some(1))\n" +
        "let wrong: Nullable(String) = present\n",
    )).toEqual(["type mismatch: expected String, found Int"]);
  });

  test("covariance under a function parameter does not generalize", () => {
    expect(projectDiagnostics(
      "module Main\n\n" +
        "let make(): Nullable(a) -> Unit = (_) => ()\n" +
        "let consume: Nullable(a) -> Unit = make()\n",
    )[0]).toContain(
      "`a` is a declared type variable, but this right-hand side is a computation " +
        "that cannot be generalized in `a` (`a` occurs in argument position)",
    );
  });

  test("operations work qualified, as dot calls, and as higher-order values", async () => {
    const main = await runMain(
      "module Main\n\n" +
        "let predicate: Nullable(String) -> Bool = Nullable.isNullish\n" +
        "let conversion: Nullable(String) -> Option(String) = Nullable.toOption\n" +
        "export let dot(value: Nullable(String)): Bool = value.isNullish()\n" +
        "export let higher(value: Nullable(String)): Bool = predicate(value)\n" +
        "export let converted(value: Nullable(String)): Bool =\n" +
        "    match conversion(value)\n" +
        "        None => False\n" +
        "        Some(_) => True\n",
    );
    const dot = main["dot"] as (value: unknown) => boolean;
    const higher = main["higher"] as (value: unknown) => boolean;
    const converted = main["converted"] as (value: unknown) => boolean;
    expect(dot(null)).toBe(true);
    expect(dot("x")).toBe(false);
    expect(higher(undefined)).toBe(true);
    expect(converted("x")).toBe(true);
    expect(converted(null)).toBe(false);
  });

  test("NullableCase constructors are not added to bare expression scope", () => {
    expect(projectDiagnostics(
      "module Main\n\n" + "export let c: NullableCase(Int) = Undefined\n",
    )).toEqual([
      "no bare `Undefined`; write `NullableCase.Undefined` or `JsKind.Undefined`",
    ]);
    expect(projectDiagnostics(
      "module Main\n\n" + "export let c: NullableCase(Int) = Value(1)\n",
    )).toEqual(["no bare `Value`; write `NullableCase.Value(1)`"]);
  });

  test("the TypeScript face stays a raw nullish union", () => {
    expect(compiled("export let echo(value: Nullable(Int)): Nullable(Int) = value\n").declarations.text)
      .toContain("(value: number | null | undefined) => number | null | undefined");
  });

  test("the two narrow predicates emit direct comparisons", () => {
    // A call is inlined (Intrinsics §8.3); a value reference keeps the
    // companion emitted, so its own bindings can be read too.
    const project = compileFiles([["/main.hex", "module Main\n\n" +
      "export let nullOnly(value: Nullable(Int)): Bool = Nullable.isNull(value)\n" +
        "export let undefinedOnly(value: Nullable(Int)): Bool = Nullable.isUndefined(value)\n" +
        "export let test: (Nullable(Int)) -> Bool = Nullable.isNull\n"]]);
    expect(project.diagnostics).toEqual([]);
    const main = project.modules.find(({ source }) => source.path === "/main.hex")!.javascript.text;
    expect(main).toContain("const nullOnly = value => value === null;");
    expect(main).toContain("const undefinedOnly = value => value === undefined;");
    const source = project.modules.find(({ source }) => source.path.endsWith("Nullable.hex"))!
      .javascript.text;
    expect(source).toContain("const isNull = __a => __a === null;");
    expect(source).toContain("const isUndefined = __a => __a === void 0;");
    expect(source).not.toContain("nullableIsNull");
    expect(source).not.toContain("nullableIsUndefined");
  });
});
