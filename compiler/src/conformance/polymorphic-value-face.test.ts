import { describe, expect, test } from "vitest";

import { compileProject, Source } from "../index";
import { typeScriptErrors } from "../support/typescript-check.js";

/**
 * Conformance for FFI Part 7 §14.1: a declaration whose type is **not** a
 * function type has nowhere to put a quantifier, so a polymorphic one faces as
 * its `never` instantiation — quantified type variables at `never`, a
 * quantified row tail at the empty row.
 *
 * The defect this pins (#132) was not a naming blemish. Naming the source
 * binder produced `export declare const empty: Iterable<a>;`, and `a` is bound
 * by nothing: the *whole* declaration file stopped being TypeScript on account
 * of one row, and `stdlib/Seq.hex`'s `empty` shipped that way.
 *
 * So the assertions below do not stop at comparing strings. `describe("tsc
 * accepts …")` runs the real TypeScript compiler over the emitted text, which
 * is the property the issue is actually about, and carries a negative control
 * that feeds it the pre-fix spelling — a check that cannot fail proves nothing.
 */

/** Compiles one module and returns its generated `.d.ts` text. */
function declarations(source: string): string {
  const project = compileProject([
    new Source.File(Source.fileId(0), "/main.hex", "module Main\n\n" + source),
  ]);
  expect(project.diagnostics).toEqual([]);
  const main = project.modules.find(({ source: file }) => file.path === "/main.hex");
  if (main === undefined) throw new Error("no /main.hex in the compiled project");
  return main.declarations.text;
}

/**
 * Compiles one module and returns *every* emitted module's `.d.ts`, keyed for
 * `typeScriptErrors`.
 *
 * A face naming another module's type is only TypeScript together with the
 * siblings it imports from. Until #227 it was not: §14.1 could compile only what
 * stood alone, and the faces that named `Option` were text comparisons. §14.2
 * discharged that (Part 7 §2.4), and the set below is what discharges it here.
 */
function declarationSet(source: string): Record<string, string> {
  const project = compileProject([
    new Source.File(Source.fileId(0), "/main.hex", "module Main\n\n" + source),
  ]);
  expect(project.diagnostics).toEqual([]);
  const files: Record<string, string> = {};
  for (const module of project.modules) {
    files[module.source.path.replace(/^\//u, "").replace(/\.hex$/u, ".d.ts")] =
      module.declarations.text;
  }
  return files;
}

describe("a polymorphic non-function export faces as its `never` instantiation", () => {
  test("the quantified variable is instantiated, not named", () => {
    expect(declarations("export let empty: Seq(a) = Seq.empty\n")).toBe(
      "export declare const empty: Iterable<never>;\n",
    );
  });

  test("`stdlib/Seq.hex`'s `empty` — the live instance (#132)", () => {
    const project = compileProject([
      new Source.File(Source.fileId(0), "/main.hex", "module Main\n\n" + "export let e: Seq(Int) = Seq.empty\n"),
    ]);
    expect(project.diagnostics).toEqual([]);
    const seq = project.modules.find(({ source }) => source.path.endsWith("Seq.hex"));
    if (seq === undefined) throw new Error("the prelude `Seq` module was not emitted");

    expect(seq.declarations.text).toContain("export declare const empty: Iterable<never>;");
    // The other polymorphic exports of the same module are function-typed and
    // keep §2.2's binders. Both rows in one assertion: the rule is about the
    // *shape of the declaration*, not about the module.
    expect(seq.declarations.text).toContain(
      "export declare const singleton: <a>(value: a) => Iterable<a>;",
    );
  });

  // `Seq` and `Option`, deliberately: this test is about the `never`
  // instantiation, not about which face the outer type wears, and a specimen
  // that also pinned a face would fail whenever that face was re-decided. It
  // very nearly did: the comment here used to say a `Vector(Option(a))`
  // specimen would pin `ReadonlyArray`, "which #128 is filed to change". #128
  // has since landed — such a specimen now reads `Hex.Vector<Option<never>>`
  // — and the reason for choosing `Seq`/`Option` is what survives it.
  test("an occurrence nested inside another face is instantiated too", () => {
    expect(declarations("export let table: Seq(Option(a)) = Seq.empty\n")).toContain(
      "export declare const table: Iterable<Option<never>>;",
    );
  });

  test("several quantified variables all instantiate", () => {
    expect(declarations("export let both: (Option(a), Option(b)) = (None, None)\n")).toContain(
      "export declare const both: [Option<never>, Option<never>];",
    );
  });

  test("a monomorphic value is untouched", () => {
    expect(declarations("export let version: String = \"1.0\"\n")).toBe(
      "export declare const version: string;\n",
    );
  });
});

describe("what the rule does not reach", () => {
  test("a function-typed polymorphic export still binds its quantifier (§2.2)", () => {
    expect(declarations("export let identity(x: a): a = x\n")).toBe(
      "export declare const identity: <a>(x: a) => a;\n",
    );
  });

  test("a generic nullary constructor keeps §12.1's face, which this generalizes", () => {
    expect(declarations("export union Box(a) = Full(value: a) | Empty\n")).toContain(
      "export declare const Empty: Box<never>;",
    );
  });
});

/** An exported function whose annotation spells an open row. */
const ROW_TAIL_FIELD = "export let field(r: {x: a, ...b}): a = r.x\n";

/** The same function inside an exported non-function value. */
const ROW_TAIL_PAIR = ROW_TAIL_FIELD +
  "export let pair: (({x: a, ...b}) -> a, Int) = (field, 1)\n";

describe("a quantified row tail stands at the empty row, not `& never`", () => {
  // A shipped file meets this: an exported annotation can spell an open row
  // (`{x: a, ...b}`), at a function type, which binds its tail, and inside a
  // non-function value, which instantiates it.
  test("the tail contributes no fields rather than collapsing the record", () => {
    const text = declarations(ROW_TAIL_PAIR);

    expect(text).toContain("export declare const pair: [(arg0: { x: never }) => never, number];");
    expect(text).not.toContain("& never");
  });

  test("a named tail in a function-typed scheme is still bound and intersected", () => {
    expect(declarations(ROW_TAIL_FIELD)).toBe(
      "export declare const field: <a, b>(r: ({ x: a } & b)) => a;\n",
    );
  });
});

describe("tsc accepts the emitted declarations", () => {
  test("the face compiles, and a consumer uses it at a concrete instantiation", async () => {
    const emitted = declarations("export let empty: Seq(a) = Seq.empty\n");
    expect(emitted).toContain("Iterable<never>");

    expect(
      await typeScriptErrors({
        "empty.d.ts": emitted,
        "consumer.ts":
          'import { empty } from "./empty.js";\n' +
          "export const numbers: Iterable<number> = empty;\n" +
          "export const texts: Iterable<string> = empty;\n",
      }),
    ).toEqual([]);
  });

  test("a face naming another module's type compiles with its siblings (§14.2)", async () => {
    const files = declarationSet("export let table: Seq(Option(a)) = Seq.empty\n");
    expect(files["main.d.ts"]).toContain("export declare const table: Iterable<Option<never>>;");

    expect(await typeScriptErrors(files)).toEqual([]);
  });

  test("the pre-fix spelling is rejected — TS2304, the control that makes the check real", async () => {
    const errors = await typeScriptErrors({
      "empty.d.ts": "export declare const empty: Iterable<a>;\n",
    });

    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("error TS2304");
    expect(errors[0]).toContain("Cannot find name 'a'");
  });

  // The row-tail forms ship, so the shipped file has to survive the same
  // compiler. Note what this does *not* buy: `({ x: never } & never)` is valid
  // TypeScript too, so the empty-row half of the rule is pinned by the text
  // assertion above and by the mutation that produces it — never by `tsc`.
  test("the row-tail forms compile too, generic and instantiated alike", async () => {
    const files = declarationSet(ROW_TAIL_PAIR);
    expect(files["main.d.ts"]).toContain("{ x: never }");
    expect(files["main.d.ts"]).toContain("<a, b>");

    expect(await typeScriptErrors(files)).toEqual([]);
  });

  test("`unknown` would not serve the consumer — why §14.1 instantiates at `never`", async () => {
    const errors = await typeScriptErrors({
      "unknown.ts":
        "export declare const empty: Iterable<unknown>;\n" +
        "export const numbers: Iterable<number> = empty;\n",
    });

    expect(errors[0]).toContain("error TS2322");
  });
});
