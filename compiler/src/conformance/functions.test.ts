import { describe, expect, test } from "vitest";

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
      "export let fingerprint<a: Eq>(thing: a): Int = hash(thing)",
    );
    expect(rejected.diagnostics.map(({ message }) => message)).toEqual([
      "`a` is declared to honor `Eq`, but the body requires `Hash`; write `<a: Hash>`, or remove the constraint annotation to let it be inferred",
    ]);

    const accepted = checkSource(
      "export let fingerprint<a: Hash>(thing: a): Int = hash(thing)\n" +
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

  test("Modules §4.1.1 requires complete exported signatures with maximal constraints", () => {
    const module = checkSource(
      "export let answer = 42\n" +
        "export let same(value: a): Bool = value == value\n" +
        "export let hashed<a: (Eq, Hash)>(value: a): Int = hash(value)\n" +
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

function checkSource(text: string): Typed.Module {
  const source = new Source.File(Source.fileId(0), "functions-conformance.hex", text);
  return check(resolve(parse(applyLayout(lex(source)))));
}

async function run(text: string): Promise<Record<string, unknown>> {
  const source = new Source.File(Source.fileId(0), "functions-conformance.hex", text);
  const typed = check(resolve(parse(applyLayout(lex(source)))));
  expect(typed.diagnostics).toEqual([]);
  const javascript = emitJavaScript(elaborate(typed));
  expect(javascript.diagnostics).toEqual([]);
  const url = `data:text/javascript;charset=utf-8,${encodeURIComponent(javascript.text)}`;
  return (await import(/* @vite-ignore */ url)) as Record<string, unknown>;
}

function symbol(module: Typed.Module, name: string): Typed.Symbol {
  const found = module.symbols.find((candidate) => candidate.name === name);
  if (found === undefined) throw new Error(`expected symbol ${name}`);
  return found;
}
