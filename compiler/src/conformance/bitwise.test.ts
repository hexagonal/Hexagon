/**
 * `spec/bitwise.md` §11's acceptance evidence: the six `Bitwise` members at
 * both instances against `BigInt` as the oracle, the 32-bit conversions, every
 * spelling and its emitted JavaScript, the tower's operand treatment, the
 * refusals and their riders, and the non-decimal literals.
 */

import fc from "fast-check";
import { beforeAll, describe, expect, test } from "vitest";

import { compileMain, projectDiagnostics, runMain, runProject } from "../support/test-project.js";

const MAX_SAFE = 2 ** 53 - 1;

function verdict(source: string): readonly string[] {
  return projectDiagnostics("module Main\n\n" + source);
}

function mainJavaScript(source: string): string {
  const project = compileMain("module Main\n\n" + source);
  expect(project.diagnostics.map(({ message }) => message)).toEqual([]);
  return project.modules.find(({ source }) => source.path === "/main.hex")!.javascript.text;
}

// The six members at both instances, as exported functions the oracle drives.
const OPERATIONS =
  "export let andI(a: Int, b: Int): Int = a band b\n" +
  "export let orI(a: Int, b: Int): Int = a bor b\n" +
  "export let xorI(a: Int, b: Int): Int = a bxor b\n" +
  "export let notI(a: Int): Int = bnot a\n" +
  "export let shlI(a: Int, n: Int): Int = a.shiftLeft(n)\n" +
  "export let shrI(a: Int, n: Int): Int = a.shiftRight(n)\n" +
  "export let andB(a: BigInt, b: BigInt): BigInt = a band b\n" +
  "export let orB(a: BigInt, b: BigInt): BigInt = a bor b\n" +
  "export let xorB(a: BigInt, b: BigInt): BigInt = a bxor b\n" +
  "export let notB(a: BigInt): BigInt = bnot a\n" +
  "export let shlB(a: BigInt, n: Int): BigInt = a.shiftLeft(n)\n" +
  "export let shrB(a: BigInt, n: Int): BigInt = a.shiftRight(n)\n" +
  "export let int32(a: Int): Int = a.toInt32()\n" +
  "export let uint32(a: Int): Int = a.toUint32()\n";

type Binary<T> = (a: T, b: T) => T;
type Unary<T> = (a: T) => T;
type Shift<T> = (a: T, n: number) => T;

describe("semantics: the true integer answer at both instances (§4)", () => {
  let ops: Record<string, unknown>;
  beforeAll(async () => {
    ops = await runMain("module Main\n\n" + OPERATIONS);
  });
  const binary = (name: string) => ops[name] as Binary<number>;
  const binaryB = (name: string) => ops[name] as Binary<bigint>;

  // The edges §11 names: the 32-bit boundaries, bit 31, 2³², and the safe range.
  const edges = [
    0, 1, -1, 2, -2, 2 ** 31 - 1, 2 ** 31, -(2 ** 31), -(2 ** 31) - 1, 2 ** 32 - 1,
    2 ** 32, 2 ** 32 + 1, -(2 ** 32), 0x1_0000_0003, 2 ** 52, -(2 ** 52), MAX_SAFE, -MAX_SAFE,
  ];
  const safeInt = fc.oneof(
    fc.integer({ min: -(2 ** 31), max: 2 ** 31 - 1 }),
    fc.integer({ min: -MAX_SAFE, max: MAX_SAFE }),
    fc.constantFrom(...edges),
  );
  const oracle: Record<string, (a: bigint, b: bigint) => bigint> = {
    andI: (a, b) => a & b,
    orI: (a, b) => a | b,
    xorI: (a, b) => a ^ b,
  };

  test.each(["andI", "orI", "xorI"])("%s agrees with BigInt over the safe range", (name) => {
    fc.assert(
      fc.property(safeInt, safeInt, (a, b) => {
        expect(binary(name)(a, b)).toBe(Number(oracle[name]!(BigInt(a), BigInt(b))));
      }),
      { numRuns: 2000 },
    );
    for (const a of edges) {
      for (const b of edges) {
        expect(binary(name)(a, b)).toBe(Number(oracle[name]!(BigInt(a), BigInt(b))));
      }
    }
  });

  test("bnot is -x - 1, and lands exactly on -2⁵³ at the top of the range", () => {
    const not = ops["notI"] as Unary<number>;
    fc.assert(fc.property(safeInt, (a) => {
      expect(not(a)).toBe(-a - 1);
    }));
    expect(not(MAX_SAFE)).toBe(-(2 ** 53));
    expect(not(not(MAX_SAFE))).toBe(MAX_SAFE);
  });

  test("the BigInt instance is BigInt's native semantics", () => {
    fc.assert(fc.property(fc.bigInt(), fc.bigInt(), (a, b) => {
      expect(binaryB("andB")(a, b)).toBe(a & b);
      expect(binaryB("orB")(a, b)).toBe(a | b);
      expect(binaryB("xorB")(a, b)).toBe(a ^ b);
      expect((ops["notB"] as Unary<bigint>)(a)).toBe(~a);
    }));
  });

  test("Int and BigInt give one answer for one value (§4.1)", () => {
    fc.assert(fc.property(safeInt, safeInt, (a, b) => {
      expect(BigInt(binary("andI")(a, b))).toBe(binaryB("andB")(BigInt(a), BigInt(b)));
      expect(BigInt(binary("xorI")(a, b))).toBe(binaryB("xorB")(BigInt(a), BigInt(b)));
    }));
  });

  test("shifts are ⌊x · 2ⁿ⌋, total, a negative count reversing, never -0", () => {
    const shl = ops["shlI"] as Shift<number>;
    const shr = ops["shrI"] as Shift<number>;
    const shlB = ops["shlB"] as Shift<bigint>;
    const shrB = ops["shrB"] as Shift<bigint>;
    // §4.2's reference, stated directly: multiplication by, or floored division
    // by, a power of two, with the ends answered rather than computed.
    const referenceLeft = (value: number, count: number): number =>
      count < 0 ? referenceRight(value, -count) : value === 0 ? 0 : value * 2 ** count;
    const referenceRight = (value: number, count: number): number =>
      count < 0
        ? referenceLeft(value, -count)
        : value === 0
        ? 0
        : count > 1023
        ? (value < 0 ? -1 : 0)
        : Math.floor(value / 2 ** count);
    const counts = [0, 1, 31, 32, 53, 1023, 1024, 5000, 2 ** 40, -1, -31, -32, -53, -1024, -5000];
    const values = [0, 1, -1, 5, -5, 2 ** 31, -(2 ** 31), 2 ** 52, -MAX_SAFE, MAX_SAFE];
    for (const value of values) {
      for (const count of counts) {
        expect(Object.is(shl(value, count), referenceLeft(value, count))).toBe(true);
        expect(Object.is(shr(value, count), referenceRight(value, count))).toBe(true);
        expect(Object.is(shr(value, count), -0)).toBe(false);
      }
    }
    expect(shl(1, 31)).toBe(2147483648);
    expect(shr(-5, 1)).toBe(-3);
    expect(shl(5, -1)).toBe(2);
    expect(shr(-1, 100)).toBe(-1);
    expect(shr(-1, 5000)).toBe(-1);
    expect(shl(0, 5000)).toBe(0);
    // Exact within the safe range: BigInt agrees.
    fc.assert(fc.property(
      fc.integer({ min: -(2 ** 20), max: 2 ** 20 }),
      fc.integer({ min: -60, max: 30 }),
      (value, count) => {
        const expected = count >= 0
          ? BigInt(value) << BigInt(count)
          : BigInt(value) >> BigInt(-count);
        expect(BigInt(shl(value, count))).toBe(expected);
        expect(BigInt(shr(value, -count))).toBe(expected);
      },
    ));
    for (const count of [0, 31, 32, 53, 200, -1, -64]) {
      expect(shlB(-5n, count)).toBe(count >= 0 ? -5n << BigInt(count) : -5n >> BigInt(-count));
      expect(shrB(-5n, count)).toBe(count >= 0 ? -5n >> BigInt(count) : -5n << BigInt(-count));
    }
    expect(shrB(-1n, 5000)).toBe(-1n);
  });

  test("toInt32 and toUint32 are JavaScript's | 0 and >>> 0 (§4.3)", () => {
    const int32 = ops["int32"] as Unary<number>;
    const uint32 = ops["uint32"] as Unary<number>;
    for (const value of [...edges, 4294967295, 2 ** 31 + 5]) {
      expect(int32(value)).toBe(value | 0);
      expect(uint32(value)).toBe(value >>> 0);
    }
    expect(int32(4294967295)).toBe(-1);
    expect(uint32(-1)).toBe(4294967295);
  });

  test("past the overflow contract: a finite operand rounds, an infinite one throws at band", () => {
    expect(binary("orI")(2 ** 60, 1)).toBe(2 ** 60);
    expect(() => binary("andI")(Infinity, 1)).toThrow(RangeError);
    expect((ops["notI"] as Unary<number>)(Infinity)).toBe(-Infinity);
  });
});

test("a ported 32-bit hash matches its JavaScript original (FNV-1a, shift-add form)", async () => {
  const exports = await runMain(
    "module Main\n\n" +
      "export let fnv(codes: Vector(Int)): Int =\n" +
      "    var h = 0x811c9dc5\n" +
      "    for c in codes\n" +
      "        h := (h bxor c).toInt32()\n" +
      "        h := h + h.shiftLeft(1).toInt32() + h.shiftLeft(4).toInt32() +\n" +
      "            h.shiftLeft(7).toInt32() + h.shiftLeft(8).toInt32() +\n" +
      "            h.shiftLeft(24).toInt32()\n" +
      "    h.toUint32()\n",
  );
  const fnv = exports["fnv"] as (codes: Iterable<number>) => number;
  const reference = (text: string): number => {
    let h = 0x811c9dc5;
    for (const character of text) {
      h ^= character.codePointAt(0)!;
      h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24);
    }
    return h >>> 0;
  };
  for (const text of ["a", "hello", "The quick brown fox", "ÿ".repeat(50)]) {
    const codes = [...text].map((character) => character.codePointAt(0)!);
    expect(fnv(codes)).toBe(reference(text));
  }
  expect(fnv([97])).toBe(0xe40c292c);
});

describe("spellings and emission (§3, §6)", () => {
  test("every spelling at Int emits the member seat's direct call", () => {
    const text = mainJavaScript(
      "let x: Int = 6\nlet y: Int = 3\n" +
        "let a = x band y\nlet b = Bitwise.bitAnd(x, y)\nlet c = x.bitAnd(y)\nlet d = Int.bitAnd(x, y)\n",
    );
    const calls = text.match(/^const [abcd] = (.*);$/gmu)!.map((line) => line.slice(10));
    expect(new Set(calls).size).toBe(1);
    expect(calls[0]).toMatch(/^[\w$]+\(x, y\);$/u);
    expect(text).not.toContain("x & y");
    expect(text).not.toContain(".bitAnd(");
  });

  test("every spelling at BigInt emits JavaScript's operator", () => {
    const text = mainJavaScript(
      "let x: BigInt = 6n\nlet y: BigInt = 3n\nlet n: Int = 2\n" +
        "let a = x band y\nlet b = Bitwise.bitAnd(x, y)\nlet c = x.bitAnd(y)\n" +
        "let d = x bor y bxor x band y\nlet e = bnot x\nlet f = x.shiftLeft(n)\n" +
        "let g = x.shiftRight(3)\nlet h = (x bor y) band x\n",
    );
    expect(text).toContain("const a = x & y;");
    expect(text).toContain("const b = x & y;");
    expect(text).toContain("const c = x & y;");
    expect(text).toContain("const d = x | y ^ x & y;");
    expect(text).toContain("const e = ~x;");
    expect(text).toContain("const f = x << BigInt(n);");
    expect(text).toContain("const g = x >> BigInt(3);");
    expect(text).toContain("const h = (x | y) & x;");
  });

  test("BigInt's shifts and complement keep their grouping against JavaScript's precedences", async () => {
    const source =
      "let x: BigInt = 12n\nlet y: BigInt = 5n\n" +
      "export let a: BigInt = x.shiftLeft(1) + y\nexport let b: BigInt = y + x.shiftRight(1)\n" +
      "export let c: BigInt = bnot (x band y)\nexport let d: BigInt = bnot x band y\n" +
      "export let e: BigInt = -x band y\nexport let f: BigInt = (x + y).shiftLeft(2)\n";
    const text = mainJavaScript(source);
    expect(text).toContain("const a = (x << BigInt(1)) + y;");
    expect(text).toContain("const b = y + (x >> BigInt(1));");
    expect(text).toContain("const c = ~(x & y);");
    expect(text).toContain("const d = ~x & y;");
    // JavaScript's `+` binds tighter than `<<`, so no parentheses are owed.
    expect(text).toContain("const f = x + y << BigInt(2);");
    const exports = await runMain("module Main\n\n" + source);
    expect(exports).toMatchObject({
      a: 29n, b: 11n, c: ~(12n & 5n), d: ~12n & 5n, e: -12n & 5n, f: 68n,
    });
  });

  test("toInt32 and toUint32 emit JavaScript's | 0 and >>> 0 in every spelling (§4.3, §6)", async () => {
    const source =
      "let h: Int = 4294967295\n" +
      "export let a: Int = h.toInt32()\nexport let b: Int = Int.toUint32(-1)\n" +
      "export let c: Int = h.toInt32() + 1\nexport let d: Int = (h + 1).toInt32()\n" +
      "export let e: Int = h |> Int.toInt32\nexport let f: Bool = (h band 3).toUint32() == 3\n" +
      "let g = Int.toInt32\nexport let viaValue: Int = g(h)\n";
    const text = mainJavaScript(source);
    expect(text).toContain("const a = h | 0;");
    expect(text).toContain("const b = -1 >>> 0;");
    expect(text).toContain("const c = (h | 0) + 1;");
    expect(text).toContain("const d = h + 1 | 0;");
    expect(text).toContain("const e = h | 0;");
    expect(text).toMatch(/const g = \w*toInt32;/u);
    const exports = await runMain("module Main\n\n" + source);
    expect(exports).toMatchObject({ a: -1, b: 4294967295, c: 0, d: 0, e: -1, f: true, viaValue: -1 });
    // Silently widened to `Float`, the inlined operator keeps its parentheses.
    const widened = await runMain("module Main\n\nlet h: Int = 4294967295\n" +
      "export let w: Float = 1.5 * h.toInt32()\nexport let v: Float = h.toUint32() + 0.5\n" +
      "export let u: Float = h.toInt32() * 1.5\n");
    expect(widened).toMatchObject({ w: -1.5, v: 4294967295.5, u: -1.5 });
  });

  test("a bitwise result compared keeps its grouping in JavaScript", async () => {
    const exports = await runMain(
      "module Main\n\nlet x: BigInt = 6n\nexport let zero: Bool = x band 1n == 0n\n",
    );
    expect(exports["zero"]).toBe(true);
  });

  test("generic bodies take ordinary evidence", async () => {
    const exports = await runMain(
      "module Main\n\n" +
        "let mask<a: Bitwise>(value: a, bits: a): a = value band bnot bits\n" +
        "export let i: Int = mask(0xFF, 0x0F)\n" +
        "export let b: BigInt = mask(0xFFn, 0x0Fn)\n",
    );
    expect(exports).toMatchObject({ i: 0xF0, b: 0xF0n });
  });

  test("a literal operand defaults to Int (Numeric Literals §4)", async () => {
    const exports = await runMain("module Main\n\nexport let x: Int = 12 band 10\nlet y = 12 bor 3\nexport let z: Int = y\n");
    expect(exports).toMatchObject({ x: 8, z: 15 });
  });

  test("operands are evaluated once each, left to right, with no short circuit", async () => {
    const exports = await runProject([[
      "/main.hex",
      "module Main\n\nlet source(label: String, value: Int): Int = value\n" +
        "export let result: Int = source(\"L\", 0) band source(\"R\", 5)\n",
    ]], {
      transform: (path, javascript) => path !== "/main.hex" ? javascript :
        ("const __seen = [];\n" + javascript).replace(
          "const source = (label, value) => value;",
          "const source = (label, value) => { __seen.push(label); return value; };",
        ) + "\nexport { __seen };\n",
    });
    expect(exports["result"]).toBe(0);
    expect(exports["__seen"]).toEqual(["L", "R"]);
  });
});

describe("the tower's operand treatment (§5.1)", () => {
  test("Nat, Int, and BigInt meet at the wider home in either order", async () => {
    const exports = await runMain(
      "module Main\n\n" +
        "let n: Nat = 12\nlet i: Int = 10\nlet b: BigInt = 6n\n" +
        "export let ni: Int = n band i\nexport let in_: Int = i band n\n" +
        "export let ib: BigInt = i bor b\nexport let bi: BigInt = b bor i\n" +
        "export let member: Int = Bitwise.bitAnd(n, i)\nexport let dot: Int = n.bitAnd(i)\n" +
        "export let face: Int = n bxor n\nexport let wide: BigInt = i.shiftLeft(60)\n" +
        "export let count: Int = i.shiftLeft(n)\n",
    );
    expect(exports).toMatchObject({
      ni: 8, in_: 8, ib: 14n, bi: 14n, member: 8, dot: 8, face: 0,
      wide: 10n << 60n, count: 10 * 2 ** 12,
    });
  });

  test("Nat alone, with no face, takes subtraction's route", () => {
    for (const body of ["n band m", "n.bitAnd(m)", "bnot n", "n.shiftLeft(1)"]) {
      const messages = verdict("let n: Nat = 5\nlet m: Nat = 3\nlet x = " + body + "\n");
      expect(messages).toHaveLength(1);
      expect(messages[0]).toContain("type `Nat` has no `Bitwise` instance");
      expect(messages[0]).toContain(
        "a written `Int` face runs the operation and admits the result (`let bits: Int = …`)",
      );
    }
  });
});

describe("refusals (§2.1, §9)", () => {
  test("Bool, Float, and a user honor of a prelude type are refused", () => {
    expect(verdict("let f: Float = 1.5\nlet x = f band f\n")[0])
      .toContain("type `Float` has no `Bitwise` instance");
    for (const type of ["Bool", "Float", "Nat"]) {
      expect(verdict(`honor Bitwise<${type}> =\n` +
        "    bitAnd(l, r) = l\n    bitOr(l, r) = l\n    bitXor(l, r) = l\n" +
        "    bitNot(v) = v\n    shiftLeft(v, c) = v\n    shiftRight(v, c) = v\n"))
        .toContain("orphan instance: this module declares neither `Bitwise` nor the instance subject");
    }
  });

  test("a program's own type may honor Bitwise, and the operators reach it", async () => {
    const exports = await runMain(
      "module Main\n\n" +
        "record Flags = {bits: Int}\n" +
        "honor Bitwise<Flags> =\n" +
        "    bitAnd(l, r) = Flags({bits = l.bits band r.bits})\n" +
        "    bitOr(l, r) = Flags({bits = l.bits bor r.bits})\n" +
        "    bitXor(l, r) = Flags({bits = l.bits bxor r.bits})\n" +
        "    bitNot(v) = Flags({bits = bnot v.bits})\n" +
        "    shiftLeft(v, c) = Flags({bits = v.bits.shiftLeft(c)})\n" +
        "    shiftRight(v, c) = Flags({bits = v.bits.shiftRight(c)})\n" +
        "let read = Flags({bits = 1})\nlet write = Flags({bits = 2})\n" +
        "export let both: Int = (read bor write).bits\n",
    );
    expect(exports["both"]).toBe(3);
  });

  test("each family refuses the other's spelling and names it", () => {
    const logic = "let p: Bool = True\nlet q: Bool = False\n";
    expect(verdict(logic + "let x = p band q\n")[0]).toContain("logic on `Bool` is spelled `and`");
    expect(verdict(logic + "let x = p bor q\n")[0]).toContain("logic on `Bool` is spelled `or`");
    expect(verdict(logic + "let x = p bxor q\n")[0]).toContain("logic on `Bool` is spelled `!=`");
    expect(verdict(logic + "let x = bnot p\n")[0]).toContain("logic on `Bool` is spelled `not`");
    // The logic word is the operator's own seat's: a `Bool` reached as an
    // instance's argument is no `band` written on `Bool`, and `and` would not
    // compile on the boxes (#1063's review).
    const boxed = verdict(
      "record Box(a) = { item: a }\n" +
        "honor<a: Bitwise> Bitwise<Box(a)> =\n" +
        "    bitAnd(l, r) = Box({item = l.item band r.item})\n" +
        "    bitOr(l, r) = Box({item = l.item bor r.item})\n" +
        "    bitXor(l, r) = Box({item = l.item bxor r.item})\n" +
        "    bitNot(v) = Box({item = bnot v.item})\n" +
        "    shiftLeft(v, c) = Box({item = v.item.shiftLeft(c)})\n" +
        "    shiftRight(v, c) = Box({item = v.item.shiftRight(c)})\n" +
        "let x = Box({item = True}) band Box({item = False})\n",
    );
    expect(boxed).toHaveLength(1);
    expect(boxed[0]).not.toContain("logic on `Bool`");
    const bits = "let i: Int = 6\nlet j: Int = 3\n";
    expect(verdict(bits + "let x = i and j\n")[0]).toContain("the bitwise operation is spelled `band`");
    expect(verdict(bits + "let x = i or j\n")[0]).toContain("the bitwise operation is spelled `bor`");
    expect(verdict(bits + "let x = not i\n")[0]).toContain("the bitwise operation is spelled `bnot`");
  });

  test("JavaScript's symbols are redirected to the words and the named shifts", () => {
    const bits = "let i: Int = 6\nlet j: Int = 3\n";
    expect(verdict(bits + "let x = i & j\n")).toContain("Hexagon spells bitwise and `band`");
    expect(verdict(bits + "let x = i ^ j\n")).toContain(
      "Hexagon spells bitwise exclusive or `bxor`; a power is `**`",
    );
    expect(verdict(bits + "let x = ~i\n")).toContain("Hexagon spells bitwise complement `bnot`");
    expect(verdict(bits + "let x = i | j\n")).toContain("Hexagon spells bitwise or `bor`");
    expect(verdict(bits + "let x = i << 2\n"))
      .toContain("Hexagon has no shift operators; write `x.shiftLeft(n)`");
    expect(verdict(bits + "let x = i >> 2\n"))
      .toContain("Hexagon has no shift operators; write `x.shiftRight(n)`");
    expect(verdict(bits + "let x = i >>> 2\n"))
      .toContain("Hexagon has no shift operators; write `x.toUint32().shiftRight(n)`");
  });

  test("a bitwise word glued to `)` is told to take a space", () => {
    const bits = "let i: Int = 6\nlet j: Int = 3\n";
    expect(verdict(bits + "let x = (i bor j)band j\n")[0]).toContain("write a space: `) band`");
    expect(verdict(bits + "let x = (i bor j)band\n")[0]).toContain("write a space: `) band`");
  });

  test("a shift count is the member's Int parameter", () => {
    expect(verdict("let i: Int = 6\nlet x = i.shiftLeft(1.5)\n")).toEqual([
      "type mismatch: expected Int, found Float",
    ]);
  });
});

describe("non-decimal literals (§8)", () => {
  test("values, and emission in the source base", async () => {
    const source =
      "export let hex: Int = 0xFF\nexport let oct: Int = 0o777\nexport let bin: Int = 0b1010\n" +
      "export let grouped: Int = 0xFF_FF\nexport let big: BigInt = 0xFFn\nexport let decimal: Int = 007\n" +
      "export let hexD: Int = 0xFFd\nexport let hexE: Int = 0x1e5\nexport let wide: BigInt = 0xFF\n" +
      "export let float: Float = 0o17\nexport let negative: Int = -0x10\n" +
      "export let unsigned: Int = 0xFFFFFFFF\n";
    const exports = await runMain("module Main\n\n" + source);
    expect(exports).toMatchObject({
      hex: 255, oct: 511, bin: 10, grouped: 65535, big: 255n, decimal: 7,
      hexD: 4093, hexE: 485, wide: 255n, float: 15, negative: -16, unsigned: 4294967295,
    });
    const text = mainJavaScript(source);
    for (const spelling of [
      "= 0xFF;", "= 0o777;", "= 0b1010;", "= 0xFFFF;", "= 0xFFn;", "= 7;", "= 0xFFd;",
      "= 0x1e5;", "= 0o17;", "= -0x10;",
    ]) {
      expect(text).toContain(spelling);
    }
    expect(text).toContain("const wide = 0xFFn;");
  });

  test("literal patterns take every base, and emit in it", async () => {
    const source =
      "let kind(x: Int): String =\n" +
      "    match x\n" +
      "        0xFF => \"all\"\n" +
      "        -0b1 => \"minus one\"\n" +
      "        _ => \"other\"\n" +
      "export let kinds: Vector(String) = [kind(255), kind(-1), kind(3)]\n";
    const exports = await runMain("module Main\n\n" + source);
    expect([...(exports["kinds"] as Iterable<string>)]).toEqual(["all", "minus one", "other"]);
    const text = mainJavaScript(source);
    expect(text).toContain("=== 0xFF");
    expect(text).toContain("=== -0b1");
  });

  test("a literal extern enum member keeps its base in JavaScript and TypeScript (#1038)", () => {
    const project = compileMain(
      "module Main\n\nexport extern enum Mode = 0x1 as Read | 0b10 as Write | -0x4 as Back | -0x0 as Zero\n",
    );
    expect(project.diagnostics).toEqual([]);
    const main = project.modules.find(({ source }) => source.path === "/main.hex")!;
    const text = main.javascript.text;
    for (const line of ["const Read = 0x1;", "const Write = 0b10;", "const Back = -0x4;", "case 0x1:", "case -0x4:"]) {
      expect(text).toContain(line);
    }
    // `-0x0` is `0`, as the value is: JavaScript would read the signed spelling as `-0`.
    expect(text).toContain("const Zero = 0x0;");
    expect(main.declarations?.text).toContain("export type Mode = 0x1 | 0b10 | -0x4 | 0x0;");
  });

  test("a refused literal pattern is quoted, and its guard written, in the source base (#1038)", () => {
    const [message] = projectDiagnostics("module Main\n\nimport Rat\n\n" +
      "export fun f(ratio: Rat.Rat): String =\n" +
      "    match ratio\n" +
      "        0xFF => \"mask\"\n" +
      "        _ => \"other\"\n");
    expect(message).toContain("`0xFF` is not a pattern at `Rat`");
    expect(message).toContain("x when x == 0xFF");
  });

  test("nested guards, duplicate arms, and literal reports quote the source base (#1038)", () => {
    const [nested] = projectDiagnostics("module Main\n\nimport Rat\n\n" +
      "export fun f(p: (Rat.Rat, Int)): String =\n" +
      "    match p\n" +
      "        (0xFF, 0x1) => \"mask\"\n" +
      "        _ => \"other\"\n");
    expect(nested).toContain("(y, 0x1) when y == 0xFF");
    const duplicate = projectDiagnostics("module Main\n\n" +
      "export fun f(p: Option(Int)): String =\n" +
      "    match p\n" +
      "        Some(0xFF) => \"a\"\n" +
      "        Some(0xFF) => \"b\"\n" +
      "        _ => \"c\"\n");
    expect(duplicate.join("\n")).toContain("`Some(0xFF)`");
    expect(verdict("let x = 0xFF / 0x2\n").join("\n")).toContain("the literal `0x2`");
  });

  test("the bare range limit and its n fix-it apply as for decimal literals", () => {
    const project = compileMain("module Main\n\nlet x = 0x20000000000000\n");
    const [diagnostic] = project.diagnostics;
    expect(diagnostic?.message).toContain("integer literal exceeds Int range; add `n`");
    expect(diagnostic?.fixes?.[0]?.edits[0]?.replacement).toBe("0x20000000000000n");
    expect(verdict("let x: BigInt = 0x20000000000000n\n")).toEqual([]);
  });
});
