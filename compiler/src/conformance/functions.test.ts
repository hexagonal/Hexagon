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
      ["/main.hex", "module Main\n\nimport Lib\nexport let f<a: Eq>(x: Lib.Box(a)): String = x.describeIt()\n"],
    ]);
    const mainId = (project: typeof importedInstance) =>
      project.modules.find(({ source }) => source.path === "/main.hex")!.source.id;
    expect(importedInstance.diagnostics.map(({ message, primary }) => [message, primary.fileId])).toEqual([
      [
        "`a` is declared to honor `Eq`, but the body requires `Describe`; write `<a: (Lib.Describe, Eq)>`, or remove the constraint annotation to let it be inferred",
        mainId(importedInstance),
      ],
    ]);
    // A missing instance for a copied demand carets the call too, not the
    // callee's binder in its own module.
    const missing = compileFiles([
      ["/lib.hex", "module Lib\n\n" + describe],
      ["/main.hex", "module Main\n\nimport Lib\nexport let s: String = Lib.describe((x: Int) => x)\n"],
    ]);
    expect(missing.diagnostics.map(({ message, primary }) => [message, primary.fileId])).toEqual([
      ["functions have no `Show` instance", mainId(missing)],
    ]);
  });

  test("§10 a report carets the use and says only what is true there (#1063)", () => {
    // Where a report stands: a demand copied at a call reports at the call,
    // and wording about the seat that made it — the literal, the operator's
    // riders — stays with the requirement at that seat, where its advice
    // compiles. At the call it would describe code the caret is not on.
    const reports = (text: string) =>
      checkSource(text).diagnostics.map(({ message, primary }) => [message, caret(text, primary)]);
    const n = "let n: Nat = 3\n";
    const signedFace = "; a written `Int` face runs the operation and admits the result (`let difference: Int = …`)";
    const signed = "type `Nat` has no `Signed` instance; its only legal homes are the module declaring `Signed` and `Nat`'s prelude companion module, both outside project source, so this pair's honored set is closed — change the type, or go through the operations those homes export";

    // At the seat — an operator, and a constraint member's own call — the
    // rider stands: the face goes on the binding that runs the operation.
    expect(reports(n + "let x = n - n")).toEqual([[signed + signedFace, "n - n"]]);
    expect(reports(n + "let x = n.subtract(n)")).toEqual([[signed + signedFace, "subtract"]]);
    expect(reports(n + "let x = Signed.subtract(n, n)")).toEqual([[signed + signedFace, "Signed.subtract"]]);
    expect(reports(n + "let x = n |> Signed.negate").map(([message, at]) => [message!.includes("face"), at]))
      .toEqual([[true, "Signed.negate"]]);
    // A grouped callee joins no tree, so a written face would not lift it:
    // `let x: Int = (Signed.negate)(n)` is refused too, and no face is offered.
    expect(reports(n + "let x = (Signed.negate)(n)").map(([message, at]) => [message!.includes("face"), at]))
      .toEqual([[false, "Signed.negate"]]);
    expect(reports(n + "let x: Int = (Signed.negate)(n)").map(([message, at]) => [message!.includes("face"), at]))
      .toEqual([[false, "Signed.negate"]]);
    // A called member outside any arithmetic tree is its operation too.
    expect(reports("let x: Nat = Signed.fromInt(3)").map(([message, at]) => [message!.includes("face"), at]))
      .toEqual([[true, "Signed.fromInt"]]);
    // A member passed as a value is no operation: `let x: Int = f(n, n)` would
    // not compile, so no face is offered — the reference itself is typed.
    expect(reports(n + "let f = Signed.subtract\nlet x = f(n, n)")).toEqual([[signed, "Signed.subtract"]]);
    expect(reports(n + "let apply(g, a, b) = g(a, b)\nlet x = apply(Signed.subtract, n, n)"))
      .toEqual([[signed, "Signed.subtract"]]);
    expect(reports(n + "let f: (Int, Int) -> Int = Signed.subtract\nlet x = f(n, n)")).toEqual([]);
    // Through a function, the call is not the operation: no rider.
    expect(reports(n + "let d(a, b) = a - b\nlet x = d(n, n)")).toEqual([[signed, "d"]]);
    // Two demands copied at one call that fail alike are one report there.
    expect(reports(n + "let d2(a, b) = (a - a, b - b)\nlet x = d2(n, n)")).toEqual([[signed, "d2"]]);
    expect(
      reports(
        "let both<a: Show, b: Show>(x: a, y: b): String = show(x) ++ show(y)\n" +
          "let r = both((v: Int) => v, (v: Int) => v)",
      ),
    ).toEqual([["functions have no `Show` instance", "both"]]);
    // Two declared variables that share a name are two binders to repair.
    const shadowed = reports(
      "let both<a: Show, b: Show>(x: a, y: b): String = show(x) ++ show(y)\n" +
        "export let f<a: Eq>(x: a): String =\n" +
        "    let g<a: Eq>(y: a): String = both(x, y)\n" +
        "    g(x)",
    );
    expect(shadowed.map(([, at]) => at)).toEqual(["both", "both"]);
    // A blocked-defaulting report names the use as written, even where the
    // resolver keeps only the member (`Frac.divide`).
    expect(reports("let y = Frac.divide(Num.fromNat(1), Num.fromNat(2))").map(([message]) =>
      message!.slice(0, message!.indexOf(" gives"))
    )).toContain("the type this use of `Frac.divide`");
    const bandCall = reports(n + "let h(a, b) = a band b\nlet x = h(n, n)");
    expect(bandCall.map(([, at]) => at)).toEqual(["h"]);
    expect(bandCall[0]![0]).not.toContain("face");
    const divCall = reports("let i: Int = 3\nlet q(a, b) = a / b\nlet x = q(i, i)");
    expect(divCall.map(([, at]) => at)).toEqual(["q"]);
    expect(divCall[0]![0]).not.toContain("face");

    // A literal in the callee is not at the call: the report is the
    // instance's, and names no literal the caller did not write.
    expect(reports("let g(x) = x + 1\nlet y = g(True)")).toEqual([
      [
        "type `Bool` has no `Num` instance; its only legal homes are the module declaring `Num` and the prelude module declaring `Bool`, both outside project source, so this pair's honored set is closed — change the type, or go through the operations those homes export",
        "g",
      ],
    ]);
    expect(reports("let y: Bool = 1")).toEqual([["integer literal cannot have type `Bool`", "1"]]);
    // Numeric Literals §6's blocked defaulting names a literal only where one
    // is written; otherwise, at a use, it names the binding used — the caret
    // is on `k`, whose own type is a function, not the type that is blocked.
    expect(reports("let k(u: Unit) = 1 / 2\nlet y = k(())")).toEqual([
      [
        "the type this use of `k` gives cannot default to `Int`: `Frac` is not a defaultable constraint; add a type annotation to pin it",
        "k",
      ],
    ]);
    expect(reports("let y = 1 / 2").map(([, at]) => at)).toEqual(["2"]);
    // Where the call's result does not carry the stuck type, an annotation on
    // it pins nothing: the report stands at the first value supplied that
    // carries it — an argument, or a dot call's argument — where one does.
    const tag = "constraint Tag<a> =\n    tag(x: a) -> String\nhonor Tag<String> =\n    tag(x) = x\n";
    const blocked = "this expression's type cannot default to `Int`: `Tag` is not a defaultable constraint; add a type annotation to pin the type";
    expect(reports(tag + "let label<a: Tag>(x: Option(a)): String = \"s\"\nlet v = label(None)"))
      .toEqual([[blocked, "None"]]);
    expect(reports(tag + "let t<a: Tag>(x: a): String = \"s\"\nlet v = t(Num.fromNat(1))"))
      .toEqual([[blocked, "Num.fromNat(1)"]]);
    expect(reports(
      tag + "export record R = { n: Int }\nexport let pack<b: Tag>(x: R, y: Option(b)): Int = 1\n" +
        "let v = R({n = 1}).pack(None)",
    )).toEqual([[blocked, "None"]]);
    // A constraint member called by the dot, its receiver's element open
    // through an instance's argument: `tag` gives a `String`.
    expect(reports(tag + "honor<a: Tag> Tag<Option(a)> =\n    tag(x) = \"o\"\nlet v = None.tag()"))
      .toEqual([[blocked, "None"]]);
    // Past the first level of an instance's arguments too: `Tag<Option(a)>`
    // asks `a` for `Tag`, and the use's call still decides where it stands.
    const optionTag = "honor<a: Tag> Tag<Option(a)> =\n    tag(x) = \"o\"\n";
    expect(reports(tag + optionTag + "let v = tag(Some(None))")).toEqual([[blocked, "Some(None)"]]);
    expect(reports(tag + optionTag + "let idt<a: Tag>(x: a): a = x\nlet v = idt(Some(None))")
      .map(([message, at]) => [message!.slice(0, message!.indexOf(" gives")), at]))
      .toEqual([["the type this use of `idt`", "idt"]]);
    // A grouped callee is still a call: its values are supplied as any call's.
    expect(reports(tag + "let label<a: Tag>(x: Option(a)): String = \"s\"\nlet v = (label)(None)"))
      .toEqual([[blocked, "None"]]);
    // The first value supplied that carries it, in source order.
    const twoSource = tag + "let two<a: Tag>(x: Option(a), y: Option(a)): String = \"s\"\nlet v = two(None, None)";
    expect(checkSource(twoSource).diagnostics.map(({ primary }) => primary.start.offset))
      .toEqual([("module Main\n\n" + twoSource).lastIndexOf("two(None") + "two(".length]);
    // Two stuck types at one use, alike: one report.
    expect(reports("let k2(u: Unit) = (1 / 2, 3 / 4)\nlet y = k2(())").map(([, at]) => at)).toEqual(["k2"]);
    // The use is named as written, its layout dropped.
    expect(reports("let y = Frac.\n    divide(Num.fromNat(1), Num.fromNat(2))").map(([message]) =>
      message!.slice(0, message!.indexOf(" gives"))
    )).toContain("the type this use of `Frac.divide`");
    // The repair it names compiles.
    expect(reports(tag + "let label<a: Tag>(x: Option(a)): String = \"s\"\nlet v = label((None : Option(String)))"))
      .toEqual([]);
    // Where the result carries it, the use keeps the report.
    expect(reports(tag + "let pair<a: Tag>(x: Option(a)): (Option(a), Int) = (x, 1)\nlet v = pair(None)")
      .map(([message, at]) => [message!.slice(0, message!.indexOf(" gives")), at]))
      .toEqual([["the type this use of `pair`", "pair"]]);

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
