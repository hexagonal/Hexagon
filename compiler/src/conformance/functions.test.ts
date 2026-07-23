import { describe, expect, test } from "vitest";

import {
  applyLayout,
  check,
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
});

function checkSource(text: string): Typed.Module {
  const source = new Source.File(Source.fileId(0), "functions-conformance.hex", text);
  return check(resolve(parse(applyLayout(lex(source)))));
}

function symbol(module: Typed.Module, name: string): Typed.Symbol {
  const found = module.symbols.find((candidate) => candidate.name === name);
  if (found === undefined) throw new Error(`expected symbol ${name}`);
  return found;
}
