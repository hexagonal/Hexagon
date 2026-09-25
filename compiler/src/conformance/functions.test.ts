import { describe, expect, test } from "vitest";

import { compileFiles, compileMain, runMain } from "../support/test-project.js";

import {
  applyLayout,
  check,
  elaborate,
  emitJavaScript,
  lex,
  parse,
  resolve,
  Source,
  type Typed,
} from "../index";

describe("Functions specification conformance", () => {
  test("§4.1 keeps declared type variables rigid while bare parameters infer", () => {
    const rejected = checkSource(
      "let takesInt(value: Int) = value\n" +
        "let describe(thing: a) = takesInt(thing)",
    );
    expect(rejected.diagnostics.map(({ message }) => message)).toEqual([
      "`a` is a declared type variable, but the body requires `Int`; change the annotation to `Int`, or remove it to let the type be inferred",
    ]);

    const accepted = checkSource(
      "let takesInt(value: Int) = value\n" +
        "let inferred(thing) = takesInt(thing)\n" +
        "let numeric(thing: a) = thing + 1",
    );
    expect(symbol(accepted, "inferred").scheme.type).toMatchObject({
      kind: "Function",
      parameters: [{ kind: "Primitive", name: "Int" }],
      result: { kind: "Primitive", name: "Int" },
    });
    expect(symbol(accepted, "numeric").scheme.constraints).toEqual([
      expect.objectContaining({ name: "Num" }),
    ]);
    expect(accepted.diagnostics).toEqual([]);
  });

  test("§4.2 rejects silent constraint strengthening and accepts entailment", () => {
    const rejected = checkSource(
      "export let fingerprint<a: Eq>(thing: a): Int = Hash.hash(thing)",
    );
    expect(rejected.diagnostics.map(({ message }) => message)).toEqual([
      "`a` is declared to honor `Eq`, but the body requires `Hash`; write `<a: Hash>`, or remove the constraint annotation to let it be inferred",
    ]);

    const accepted = checkSource(
      "export let fingerprint<a: Hash>(thing: a): Int = Hash.hash(thing)\n" +
        "export let same<a: Hash>(left: a, right: a): Bool = left == right",
    );
    expect(symbol(accepted, "fingerprint").scheme.constraints).toEqual([
      expect.objectContaining({ name: "Hash" }),
    ]);
    expect(symbol(accepted, "same").scheme.constraints).toEqual([
      expect.objectContaining({ name: "Hash" }),
    ]);
    expect(accepted.diagnostics).toEqual([]);
  });

  test("§4.2 a demand copied from a callee's written binder is checked like any other (#1063)", () => {
    // The callee's list is *its* declaration; at this call it is a demand. The
    // copy used to keep the declaration's standing and land on the caller's
    // rigid variable unchecked, so each of these compiled with `Show`/`Hash`
    // silently added to the caller's published list.
    const describe = "export let describe<a: Show>(x: a): String = show(x)\n";
    const direct = describe + "export let f<a: Eq>(x: a): String = describe(x)";
    const refused = checkSource(direct);
    expect(refused.diagnostics.map(({ message }) => message)).toEqual([
      "`a` is declared to honor `Eq`, but the body requires `Show`; write `<a: (Eq, Show)>`, or remove the constraint annotation to let it be inferred",
    ]);
    // At the call that made the demand — never the callee's own binder, which
    // is the one declaration in the program that is not at fault.
    expect(caret(direct, refused.diagnostics[0]!.primary)).toBe("describe");
    // A callee in another module: the caret stays in the calling file.
    const imported = compileFiles([
      ["/lib.hex", "module Lib\n\n" + describe],
      ["/main.hex", "module Main\n\nimport Lib\nexport let f<a: Eq>(x: a): String = Lib.describe(x)\n"],
    ]);
    expect(imported.diagnostics.map(({ message, primary }) => [message, primary.fileId])).toEqual([
      [
        "`a` is declared to honor `Eq`, but the body requires `Show`; write `<a: (Eq, Show)>`, or remove the constraint annotation to let it be inferred",
        imported.modules.find(({ source }) => source.path === "/main.hex")!.source.id,
      ],
    ]);
    expect(
      checkSource(
        "export let h<a: Hash>(x: a): Int = x.hash()\n" +
          "export let g<a: Eq>(x: a): Int = h(x)",
      ).diagnostics.map(({ message }) => message),
    ).toEqual([
      "`a` is declared to honor `Eq`, but the body requires `Hash`; write `<a: Hash>`, or remove the constraint annotation to let it be inferred",
    ]);
    expect(
      checkSource(
        describe +
          "fun<a: Eq>\n" +
          "    p(x: a, n: Int): String = if n > 0 then q(x, n) else \"\"\n" +
          "    q(x: a, n: Int): String = describe(x)",
      ).diagnostics.map(({ message }) => message),
    ).toEqual([
      "`a` is declared to honor `Eq` on the block head, but `q`'s body requires `Show`; widen the head: `fun<a: (Eq, Show)>`, or remove the head's constraint to let it be inferred",
    ]);

    // Every arm carets the demand's use, and a demand reached through a
    // component or an instance argument belongs to the use that reached it.
    const carets = (text: string) =>
      checkSource(text).diagnostics.map(({ primary }) => caret(text, primary));
    expect(carets(describe + "export let f<a: Eq>(x: a): String = describe((x, 1))")).toEqual([
      "describe",
    ]);
    expect(
      carets("export let h<a: Hash>(x: a): Int = x.hash()\nexport let g<a: Eq>(x: a): Int = h(x)"),
    ).toEqual(["h"]);
    expect(
      carets(
        "constraint Tell<a> =\n    tell(value: a) -> String\n" + describe +
          "record Box(a) = { item: a }\n" +
          "honor<a: Eq> Tell<Box(a)> =\n    tell(value) = describe(value.item)",
      ),
    ).toEqual(["describe"]);
    expect(
      carets(
        describe +
          "fun<a: Eq>\n" +
          "    p(x: a, n: Int): String = if n > 0 then q(x, n) else \"\"\n" +
          "    q(x: a, n: Int): String = describe(x)",
      ),
    ).toEqual(["describe"]);
    expect(
      carets(
        describe +
          "constraint Labelled<a: Eq> =\n" +
          "    label(value: a) -> String\n" +
          "    shown(value: a) -> String = describe(value)",
      ),
    ).toEqual(["describe"]);
    const describeBox = "constraint Describe<a> =\n    describeIt(value: a) -> String\n" +
      "export record Box(a) = { item: a }\n" +
      "honor<a: Describe> Describe<Box(a)> =\n    describeIt(value) = value.item.describeIt()\n";
    expect(
      carets(describeBox + "export let f<a: Eq>(x: Box(a)): String = x.describeIt()"),
    ).toEqual(["describeIt"]);
    const importedInstance = compileFiles([
      ["/lib.hex", "module Lib\n\nexport " + describeBox],
      ["/main.hex", "module Main\n\nimport Lib\nexport let f<a: Eq>(x: Lib.Box(a)): String = Lib.Describe.describeIt(x)\n"],
    ]);
    expect(importedInstance.diagnostics.map(({ primary }) => primary.fileId)).toEqual([
      importedInstance.modules.find(({ source }) => source.path === "/main.hex")!.source.id,
    ]);

    // Entailment still discharges a copied demand: `Hash` provides `Eq`.
    const accepted = checkSource(
      "export let same<a: Eq>(x: a): Bool = x == x\n" +
        "export let hashedSame<a: Hash>(x: a): Bool = same(x)",
    );
    expect(accepted.diagnostics).toEqual([]);
    expect(symbol(accepted, "hashedSame").scheme.constraints).toEqual([
      expect.objectContaining({ name: "Hash" }),
    ]);
  });

  test("Modules §4.1.1 requires complete exported signatures with maximal constraints", () => {
    const module = checkSource(
      "export let answer = 42\n" +
        "export let same(value: a): Bool = value == value\n" +
        "export let hashed<a: (Eq, Hash)>(value: a): Int = Hash.hash(value)\n" +
        "let private(value: a) = value == value",
    );

    expect(module.diagnostics.map(({ message }) => message)).toEqual([
      "exported value `answer` requires a type annotation",
      "exported function `same` must declare every constraint in its signature; write `<a: Eq>`",
      "exported function `hashed` must omit base constraint `Eq` from `a`; `Hash` already provides it",
    ]);
  });
  test("§4.2 a constrained generic composes across functions, instantiating evidence per use", async () => {
    // A generic used from other functions' bodies is generalized first (dependency
    // order, #66), so each call instantiates its own `Num` dictionary. Executed —
    // the emitted evidence plumbing is where a typecheck-only test would miss a
    // regression.
    const m = await run(
      "module Main\n\n" +
      "fun double<a: Num>(x: a): a = x + x\n" +
        "fun useInt(): Int = double(21)\n" +
        "fun useFloat(): Float = double(1.5)\n" +
        "export let asInt: Int = useInt()\n" +
        "export let asFloat: Float = useFloat()\n",
    );
    expect(m.asInt).toBe(42);
    expect(m.asFloat).toBe(3);
  });
});

// Through the whole project, prelude included. Since #147 `Bool` is a prelude
// declaration, so a module assembled by calling the passes directly cannot type
// a condition, a guard, a comparison, or a logic operator.
/** The text a span covers within `checkSource(text)`'s file. */
function caret(text: string, span: { readonly start: { readonly offset: number }; readonly end: { readonly offset: number } }): string {
  return ("module Main\n\n" + text).slice(span.start.offset, span.end.offset);
}

function checkSource(text: string): Typed.Module {
  return compileMain("module Main\n\n" + text).modules.find(({ source }) => source.path === "/main.hex")!.typed;
}

const run = runMain;

// A checked project module also carries prelude symbols. Match the declaration
// owned by this source so a prelude operation with the same name cannot win.
function symbol(module: Typed.Module, name: string): Typed.Symbol {
  const found = module.symbols.find(
    (candidate) =>
      candidate.name === name &&
      candidate.bindingSpan.fileId === module.fileId,
  );
  if (found === undefined) throw new Error(`expected symbol ${name}`);
  return found;
}
