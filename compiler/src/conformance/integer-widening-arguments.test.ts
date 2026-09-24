import { describe, expect, test } from "vitest";

import { compileMain, projectDiagnostics, runProject } from "../support/test-project.js";

const STDLIB = import.meta.glob("../../../stdlib/*.hex", {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>;
const RAT = Object.entries(STDLIB).find(([path]) => path.endsWith("/Rat.hex"))?.[1];
if (RAT === undefined) throw new Error("no stdlib/Rat.hex");

function verdict(source: string): readonly string[] {
  return projectDiagnostics("module Main\n\n" + source);
}

describe("bounded BigInt argument deferral prototype", () => {
  const helpers =
    "let first<a: FromBigInt>(value: a, values: Vector(a)): a = value\n" +
    "let last<a: FromBigInt>(values: Vector(a), value: a): a = value\n";

  test("a structurally seated rigid FromBigInt target establishes both parameter orders", () => {
    const source =
      helpers +
      "let big: BigInt = 3n\n" +
      "fun valueFirst<t: FromBigInt>(values: Vector(t)): String =\n" +
      "    let ignored = first(big, values)\n" +
      "    \"ok\"\n" +
      "fun valueLast<t: FromBigInt>(values: Vector(t)): String =\n" +
      "    let ignored = last(values, big)\n" +
      "    \"ok\"\n";
    const project = compileMain("module Main\n\n" + source);
    expect(project.diagnostics).toEqual([]);
    const main = project.modules.find(({ source }) => source.path === "/main.hex")!;
    expect(main.javascript.text.match(/\.fromBigInt\(big\)/gu)).toHaveLength(2);
  });

  test("identity and a fresh structural sibling remain exact BigInt", () => {
    const project = compileMain("module Main\n\n" +
      "let identity<a: FromBigInt>(value: a): a = value\n" +
      "let exactResult = identity(1n)\n" +
      helpers +
      "let big: BigInt = 3n\n" +
      "fun valueFirst(x) = first(big, [x])\n" +
      "fun valueLast(x) = last([x], big)\n",
    );
    expect(project.diagnostics).toEqual([]);
    const main = project.modules.find(({ source }) => source.path === "/main.hex")!;
    const symbol = (name: string) =>
      main.typed.symbols.find((candidate) => candidate.name === name)?.scheme;
    expect(symbol("exactResult")?.type).toMatchObject({ kind: "Primitive", name: "BigInt" });
    for (const name of ["valueFirst", "valueLast"]) {
      expect(symbol(name)?.constraints).toEqual([]);
      expect(symbol(name)?.type).toMatchObject({
        kind: "Function",
        parameters: [{ kind: "Primitive", name: "BigInt" }],
        result: { kind: "Primitive", name: "BigInt" },
      });
    }
    expect(main.javascript.text).not.toContain("undefined.fromBigInt");
    expect(main.javascript.text).not.toContain("function valueFirst(x, __FromBigInt");
    expect(main.javascript.text).toContain("identity(1n, __FromBigInt_BigInt)");
  });

  test("a directly established rigid destination converts without a sibling", () => {
    const project = compileMain("module Main\n\n" +
      "fun convert<t: FromBigInt>(value: BigInt): t =\n" +
      "    let accept(item: t): t = item\n" +
      "    accept(value)\n");
    expect(project.diagnostics).toEqual([]);
    const main = project.modules.find(({ source }) => source.path === "/main.hex")!;
    expect(main.javascript.text).toMatch(/accept\(__FromBigInt_[a-z]+\.fromBigInt\(value\)\)/u);
  });

  test("structural rigid conversions execute through caller evidence in both orders", async () => {
    const exports = await runProject([
      ["/main.hex", "module Main\n\nimport Rat\n" +
      helpers +
      "let big: BigInt = 3n\n" +
      "fun convertFirst<t: FromBigInt>(values: Vector(t)): t = first(big, values)\n" +
      "fun convertLast<t: FromBigInt>(values: Vector(t)): t = last(values, big)\n" +
      "let values: Vector(Rat.Rat) = [Rat.create(1n, 2n)]\n" +
      "let directFirst = first(big, values)\n" +
      "let directLast = last(values, big)\n" +
      "export let firstValue: BigInt = Rat.top(convertFirst(values))\n" +
      "export let lastValue: BigInt = Rat.top(convertLast(values))\n" +
      "export let directFirstValue: BigInt = Rat.top(directFirst)\n" +
      "export let directLastValue: BigInt = Rat.top(directLast)\n"],
      ["/Rat.hex", RAT],
    ]);
    expect(exports).toMatchObject({
      firstValue: 3n,
      lastValue: 3n,
      directFirstValue: 3n,
      directLastValue: 3n,
    });
  });

  test("closed-record structural seats distinguish rigid, concrete, and fresh targets", async () => {
    const recordHelpers =
      "let recordFirst<a: FromBigInt>(value: a, box: {item: a}): a = value\n" +
      "let recordLast<a: FromBigInt>(box: {item: a}, value: a): a = value\n";
    const compile = compileMain("module Main\n\n" + recordHelpers +
      "let big: BigInt = 3n\n" +
      "fun rigidFirst<t: FromBigInt>(box: {item: t}): String =\n" +
      "    let ignored = recordFirst(big, box)\n" +
      "    \"ok\"\n" +
      "fun rigidLast<t: FromBigInt>(box: {item: t}): String =\n" +
      "    let ignored = recordLast(box, big)\n" +
      "    \"ok\"\n" +
      "fun freshFirst(x) = recordFirst(big, {item = x})\n" +
      "fun freshLast(x) = recordLast({item = x}, big)\n");
    expect(compile.diagnostics).toEqual([]);
    const main = compile.modules.find(({ source }) => source.path === "/main.hex")!;
    expect(main.javascript.text.match(/\.fromBigInt\(big\)/gu)).toHaveLength(2);
    for (const name of ["freshFirst", "freshLast"]) {
      const scheme = main.typed.symbols.find((candidate) => candidate.name === name)?.scheme;
      expect(scheme?.constraints).toEqual([]);
      expect(scheme?.type).toMatchObject({
        kind: "Function",
        parameters: [{ kind: "Primitive", name: "BigInt" }],
        result: { kind: "Primitive", name: "BigInt" },
      });
    }

    const exports = await runProject([
      ["/main.hex", "module Main\n\nimport Rat\n" + recordHelpers +
        "let big: BigInt = 3n\n" +
        "let box: {item: Rat.Rat} = {item = Rat.create(1n, 2n)}\n" +
        "export let firstValue: BigInt = Rat.top(recordFirst(big, box))\n" +
        "export let lastValue: BigInt = Rat.top(recordLast(box, big))\n"],
      ["/Rat.hex", RAT],
    ]);
    expect(exports).toMatchObject({ firstValue: 3n, lastValue: 3n });
  });

  test("open-record explicit fields establish targets without reading row tails", async () => {
    const openHelpers =
      "let openFirst<a: FromBigInt>(value: a, box): a =\n" +
      "    let item: a = box.item\n" +
      "    value\n" +
      "let openLast<a: FromBigInt>(box, value: a): a =\n" +
      "    let item: a = box.item\n" +
      "    value\n";
    const compile = compileMain("module Main\n\n" + openHelpers +
      "let big: BigInt = 3n\n" +
      "fun rigidFirst<t: FromBigInt>(box): String =\n" +
      "    let item: t = box.item\n" +
      "    let ignored = openFirst(big, box)\n" +
      "    \"ok\"\n" +
      "fun rigidLast<t: FromBigInt>(box): String =\n" +
      "    let item: t = box.item\n" +
      "    let ignored = openLast(box, big)\n" +
      "    \"ok\"\n" +
      "fun freshFirst(x) = openFirst(big, {item = x, tag = \"x\"})\n" +
      "fun freshLast(x) = openLast({item = x, tag = \"x\"}, big)\n");
    expect(compile.diagnostics).toEqual([]);
    const main = compile.modules.find(({ source }) => source.path === "/main.hex")!;
    expect(main.javascript.text.match(/\.fromBigInt\(big\)/gu)).toHaveLength(2);
    for (const name of ["freshFirst", "freshLast"]) {
      const scheme = main.typed.symbols.find((candidate) => candidate.name === name)?.scheme;
      expect(scheme?.constraints).toEqual([]);
      expect(scheme?.type).toMatchObject({
        kind: "Function",
        parameters: [{ kind: "Primitive", name: "BigInt" }],
        result: { kind: "Primitive", name: "BigInt" },
      });
    }

    const exports = await runProject([
      ["/main.hex", "module Main\n\nimport Rat\n" + openHelpers +
        "let big: BigInt = 3n\n" +
        "let box = {item = Rat.create(1n, 2n), tag = \"x\"}\n" +
        "export let firstValue: BigInt = Rat.top(openFirst(big, box))\n" +
        "export let lastValue: BigInt = Rat.top(openLast(box, big))\n"],
      ["/Rat.hex", RAT],
    ]);
    expect(exports).toMatchObject({ firstValue: 3n, lastValue: 3n });
  });

  test("fixed integer homes choose BigInt across Nat and Int permutations", async () => {
    const exports = await runProject([["/main.hex", "module Main\n\n" +
      "let combine<a: Num>(left: a, right: a): a = left + right\n" +
      "let natural: Nat = 2\n" +
      "let integer: Int = -2\n" +
      "let big: BigInt = 5n\n" +
      "export let values: Vector(BigInt) = [\n" +
      "    combine(natural, big), combine(big, natural),\n" +
      "    combine(integer, big), combine(big, integer),\n" +
      "    combine(big, big)]\n"]]);
    expect([...(exports["values"] as Iterable<unknown>)]).toEqual([7n, 7n, 3n, 3n, 10n]);
  });

  test("a leading Nat never pins: Nat and Int meet at Int in every spelling and order (#1033)", async () => {
    const calls = [
      "combine(natural, integer)", "combine(integer, natural)",
      "Num.add(natural, integer)", "Num.add(integer, natural)",
      "natural.add(integer)", "integer.add(natural)",
      "Integral.gcd(natural, integer)", "natural.gcd(integer)",
      "mix(natural, integer)", "mix(integer, natural)",
    ];
    const source = "module Main\n\n" +
      "let combine<a: Num>(left: a, right: a): a = left + right\n" +
      "constraint Mix<a> =\n" +
      "    mix(left: a, right: a) -> a\n" +
      "honor Mix<Int> =\n" +
      "    mix(left, right) = left - right\n" +
      "let natural: Nat = 6\n" +
      "let integer: Int = -4\n" +
      calls.map((call, index) => `let v${index} = ${call}\n`).join("") +
      "let ordered = Ord.compare(natural, integer)\n" +
      "let reversed = natural.compare(integer)\n" +
      "export let values: Vector(Int) = [" +
      calls.map((_, index) => `v${index}`).join(", ") + "]\n" +
      "export let orders: Vector(String) = [ordered.show(), reversed.show()]\n";
    const project = compileMain(source);
    expect(project.diagnostics).toEqual([]);
    const main = project.modules.find(({ source }) => source.path === "/main.hex")!;
    for (let index = 0; index < calls.length; index += 1) {
      expect(main.typed.symbols.find(({ name }) => name === `v${index}`)?.scheme.type)
        .toMatchObject({ kind: "Primitive", name: "Int" });
    }
    const exports = await runProject([["/main.hex", source]]);
    expect([...(exports["values"] as Iterable<unknown>)])
      .toEqual([2, 2, 2, 2, 2, 2, 2, 2, 10, -10]);
    expect([...(exports["orders"] as Iterable<unknown>)]).toEqual(["Greater", "Greater"]);
  });

  test("Signed-only targets refuse BigInt in both orders", () => {
    const combine = "let combine<a: Num>(left: a, right: a): a = left + right\n";
    for (const body of ["combine(big, value)", "combine(value, big)"]) {
      const messages = verdict(combine +
        "fun refused<t: Signed>(value: t, big: BigInt): t = " + body + "\n");
      expect(messages).toHaveLength(1);
      expect(messages[0]).toContain("declared type variable");
      expect(messages[0]).toContain("BigInt");
    }
  });

  test("unrelated destination variables never establish one another", async () => {
    const exports = await runProject([
      ["/main.hex", "module Main\n\nimport Rat\n" +
        "let separate<a: FromBigInt, b: FromBigInt>(left: a, right: b): (a, b) =\n" +
        "    (left, right)\n" +
        "let big: BigInt = 3n\n" +
        "let half: Rat.Rat = Rat.create(1n, 2n)\n" +
        "let pair = separate(big, half)\n" +
        "export let left: BigInt = pair.item1\n" +
        "export let right: BigInt = Rat.top(pair.item2)\n"],
      ["/Rat.hex", RAT],
    ]);
    expect(exports).toMatchObject({ left: 3n, right: 1n });
  });

  test("callbacks before and after an exact BigInt source read BigInt", async () => {
    const exports = await runProject([["/main.hex", "module Main\n\n" +
      "let callbackLast<a: FromBigInt>(value: a, cb: (a) -> a): a = cb(value)\n" +
      "let callbackFirst<a: FromBigInt>(cb: (a) -> a, value: a): a = cb(value)\n" +
      "let big: BigInt = 3n\n" +
      "export let last: BigInt = callbackLast(big, x => x + 1n)\n" +
      "export let first: BigInt = callbackFirst(x => x + 2n, big)\n"]]);
    expect(exports).toMatchObject({ last: 4n, first: 5n });
  });

  test("a previously constrained flexible caller variable remains generic", () => {
    const project = compileMain("module Main\n\n" +
      "let establish<a: FromBigInt>(value: a): a = value\n" +
      "let choose<a: FromBigInt>(left: a, right: a): a = left\n" +
      "fun bigFirst(value) =\n" +
      "    let established = establish(value)\n" +
      "    choose(1n, established)\n" +
      "fun bigLast(value) =\n" +
      "    let established = establish(value)\n" +
      "    choose(established, 1n)\n");
    expect(project.diagnostics).toEqual([]);
    const main = project.modules.find(({ source }) => source.path === "/main.hex")!;
    for (const name of ["bigFirst", "bigLast"]) {
      const scheme = main.typed.symbols.find((candidate) => candidate.name === name)?.scheme;
      expect(scheme?.constraints.map(({ name }) => name)).toContain("FromBigInt");
      expect(scheme?.type).toMatchObject({
        kind: "Function",
        parameters: [{ kind: "Variable" }],
        result: { kind: "Variable" },
      });
    }
    expect(main.javascript.text.match(/\.fromBigInt\(1n\)/gu)).toHaveLength(2);
  });

  test("conversion evaluates each source once and preserves runtime argument order", async () => {
    const exports = await runProject([
      ["/main.hex", "module Main\n\nimport Rat\n" +
        "let combine<a: Num>(left: a, right: a): a = left + right\n" +
        "let sourceBig(label: String, value: BigInt): BigInt = value\n" +
        "let sourceRat(label: String, value: Rat.Rat): Rat.Rat = value\n" +
        "let total = combine(sourceBig(\"B\", 3n), sourceRat(\"R\", Rat.create(1n, 2n)))\n" +
        "export let top: BigInt = Rat.top(total)\n"],
      ["/Rat.hex", RAT],
    ], {
      transform: (path, javascript) => path !== "/main.hex" ? javascript :
        ("const __seen = [];\n" + javascript)
          .replace(
            "const sourceBig = (label, value) => value;",
            "const sourceBig = (label, value) => { __seen.push(label); return value; };",
          )
          .replace(
            "const sourceRat = (label, value) => value;",
            "const sourceRat = (label, value) => { __seen.push(label); return value; };",
          ) + "\nexport { __seen };\n",
    });
    expect(exports["top"]).toBe(7n);
    expect(exports["__seen"]).toEqual(["B", "R"]);
  });
});
