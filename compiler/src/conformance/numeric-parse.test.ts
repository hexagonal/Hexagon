import { describe, expect, test } from "vitest";

import { AnalysisSession } from "../analysis/session.js";
import { compileMain, projectDiagnostics, runMain } from "../support/test-project.js";

/**
 * Conformance for **numeric text parsing** (`spec/numeric-parsing.md`, #1049,
 * #1253 step 9c): one tracked `parse` per numeric type, `NumberFormatError`,
 * and a reading's `Option` widening as `Some(…)` would (Effects §3.1).
 *
 * - **The grammar** is Lexer §5's literal for the type, without the `n`/`d`
 *   suffix, after an optional `+` or `-` (`Nat` takes none), plus `NaN`,
 *   `Infinity` and `-Infinity` for `Float` and `top/bottom` for `Rat`.
 * - **The failure** is the exception `NumberFormatError(message)`, for text
 *   that is not a number of the type and for one outside its range; the
 *   message quotes the text, cut short.
 * - **The round trip:** `T.parse(show(x))` gives back `x`.
 */

type Read<a> = { tag: "Some"; value: a } | { tag: "None" };

/** Every parser read with `?`, callable from JavaScript with any text. */
async function readers(): Promise<Record<string, (text: string) => Read<unknown>>> {
  const main = await runMain("module Main\n\nimport Rat\n\n" +
    "export let int(text: String): Option(Int) = Int.parse?(text)\n" +
    "export let nat(text: String): Option(Nat) = Nat.parse?(text)\n" +
    "export let big(text: String): Option(BigInt) = BigInt.parse?(text)\n" +
    "export let float(text: String): Option(Float) = Float.parse?(text)\n" +
    "export let dec(text: String): Option(String) = Option.map(Dec.parse?(text), (d) => \"${d}@${d.places()}\")\n" +
    "export let rat(text: String): Option(String) = Option.map(Rat.parse?(text), (r) => show(r))\n");
  return main as Record<string, (text: string) => Read<unknown>>;
}

/** The message each parser's failure carries, or the value's `show`. */
async function messages(): Promise<Record<string, (text: string) => string>> {
  const catching = (name: string, type: string): string =>
    `export let ${name}(text: String): String =\n` +
    "    try\n" +
    `        show(${type}.parse^(text))\n` +
    "    catch\n" +
    "        NumberFormatError(message) => message\n";
  const main = await runMain("module Main\n\nimport Rat\n\n" +
    catching("int", "Int") + catching("nat", "Nat") + catching("big", "BigInt") +
    catching("float", "Float") + catching("dec", "Dec") + catching("rat", "Rat"));
  return main as Record<string, (text: string) => string>;
}

const some = (value: unknown): Read<unknown> => ({ tag: "Some", value });
const none: Read<unknown> = { tag: "None" };

function hoveredType(source: string, needle: string): string | undefined {
  const session = new AnalysisSession();
  session.setFile("/main.hex", source);
  return session.hover("/main.hex", source.indexOf(needle))?.displayedType;
}

describe("the integer grammar: Lexer §5's literal after an optional sign", () => {
  test("Int.parse reads decimal and the three prefixed bases, with `_` and a sign", async () => {
    const { int } = await readers();
    const accepted: [string, number][] = [
      ["42", 42], ["-5", -5], ["+5", 5], ["007", 7], ["-0", 0], ["1_000", 1000],
      ["0xFF", 255], ["0xff", 255], ["0o777", 511], ["0b1010", 10], ["-0x10", -16], ["+0b1", 1],
      ["9007199254740991", 9007199254740991], ["-9007199254740991", -9007199254740991],
    ];
    for (const [text, value] of accepted) expect(int!(text), text).toEqual(some(value));
    const refused = [
      "", " 5", "5 ", "12x", "1__0", "_1", "1_", "0x", "0X10", "0O7", "0B1", "5n", "1.5", "1e3",
      "+-5", "--5", "++5", "٣", "0x_FF", "0b102", "0o8", "0xFF_", "\t5", "5\n",
    ];
    for (const text of refused) expect(int!(text), JSON.stringify(text)).toEqual(none);
    expect(int!("9007199254740992")).toEqual(none);
    expect(int!("-9007199254740992")).toEqual(none);
  });

  test("Nat.parse takes no sign, and BigInt.parse has no range", async () => {
    const { nat, big } = await readers();
    expect(nat!("5")).toEqual(some(5));
    expect(nat!("0x10")).toEqual(some(16));
    expect(nat!("0")).toEqual(some(0));
    for (const text of ["+5", "-0", "-5", "9007199254740992"]) expect(nat!(text), text).toEqual(none);
    expect(big!("123456789012345678901234567890")).toEqual(some(123456789012345678901234567890n));
    expect(big!("-0x1F")).toEqual(some(-31n));
    expect(big!("+1_0")).toEqual(some(10n));
    expect(big!("5n")).toEqual(none);
  });
});

describe("the Float, Dec and Rat grammars", () => {
  test("Float.parse reads digits, a fraction, an exponent, and show's three words", async () => {
    const { float } = await readers();
    const accepted: [string, number][] = [
      ["1.5", 1.5], ["-0.25", -0.25], ["1e+21", 1e21], ["1.5e-7", 1.5e-7], ["1E3", 1000],
      ["+2.5", 2.5], ["4", 4], ["007.5", 7.5], ["1_000.000_5", 1000.0005],
      ["1e400", Number.POSITIVE_INFINITY], ["Infinity", Number.POSITIVE_INFINITY],
      ["-Infinity", Number.NEGATIVE_INFINITY], ["0.1", 0.1],
    ];
    for (const [text, value] of accepted) expect(float!(text), text).toEqual(some(value));
    const nan = float!("NaN");
    expect(nan.tag).toBe("Some");
    expect(Number.isNaN((nan as { value: number }).value)).toBe(true);
    expect(float!("1e-400")).toEqual(some(0));
    const refused = [
      ".5", "5.", "1e", "1e+", "Inf", "nan", "infinity", "+NaN", "-NaN", "+Infinity", " 1", "1_.5",
      "0x10", "1.5f", "", "1.5.5", "1._5",
    ];
    for (const text of refused) expect(float!(text), JSON.stringify(text)).toEqual(none);
  });

  test("Dec.parse keeps the places as written, and takes no exponent", async () => {
    const { dec } = await readers();
    expect(dec!("1.50")).toEqual(some("1.50@2"));
    expect(dec!("-0.05")).toEqual(some("-0.05@2"));
    expect(dec!("12")).toEqual(some("12@0"));
    expect(dec!("+1.5")).toEqual(some("1.5@1"));
    expect(dec!("1_000.000_1")).toEqual(some("1000.0001@4"));
    expect(dec!("-0.00")).toEqual(some("0.00@2"));
    for (const text of ["1e2", ".5", "5.", "1.5d", "", "0x10", "1.5e0", " 1.5"]) {
      expect(dec!(text), JSON.stringify(text)).toEqual(none);
    }
  });

  test("Rat.parse reads top/bottom and a bare integer, reduced, the sign on top", async () => {
    const { rat } = await readers();
    expect(rat!("1/3")).toEqual(some("1/3"));
    expect(rat!("-1/3")).toEqual(some("-1/3"));
    expect(rat!("6/4")).toEqual(some("3/2"));
    expect(rat!("5")).toEqual(some("5/1"));
    expect(rat!("0x10/2")).toEqual(some("8/1"));
    expect(rat!("+2/4")).toEqual(some("1/2"));
    for (const text of ["1/0", "1/-3", "1/+3", "1/2/3", "1 / 2", "/2", "1/", "0.5", "", "a/b"]) {
      expect(rat!(text), JSON.stringify(text)).toEqual(none);
    }
  });
});

describe("NumberFormatError and its message", () => {
  test("each type says what the text is not, and Int and Nat say when it is out of range", async () => {
    const m = await messages();
    expect(m.int!("12x")).toBe("\"12x\" is not an Int");
    expect(m.int!("9007199254740992")).toBe("\"9007199254740992\" is out of range for Int");
    expect(m.nat!("-5")).toBe("\"-5\" is not a Nat");
    expect(m.nat!("9007199254740992")).toBe("\"9007199254740992\" is out of range for Nat");
    expect(m.big!("5n")).toBe("\"5n\" is not a BigInt");
    expect(m.float!(".5")).toBe("\".5\" is not a Float");
    expect(m.dec!("1e2")).toBe("\"1e2\" is not a Dec");
    expect(m.rat!("1/0")).toBe("\"1/0\" is not a Rat");
    expect(m.int!("42")).toBe("42");
  });

  /** Untrusted text cannot make a message as long as itself, or an ambiguous one. */
  test("the quoted text is cut short past 40 code points, and escaped", async () => {
    const m = await messages();
    const long = "x".repeat(41);
    expect(m.int!(long)).toBe(`"${"x".repeat(37)}…" is not an Int`);
    const forty = "y".repeat(40);
    expect(m.int!(forty)).toBe(`"${forty}" is not an Int`);
    expect(m.int!("a\"b\\c")).toBe("\"a\\\"b\\\\c\" is not an Int");
    expect(m.int!("1\n2\t")).toBe("\"1\\u000a2\\u0009\" is not an Int");
    const emoji = "\u{1F600}".repeat(41);
    expect(m.int!(emoji)).toBe(`"${"\u{1F600}".repeat(37)}…" is not an Int`);
  });

  /**
   * `Rat.hex` is ordinary source, so it writes the formatter's rule in Hexagon
   * rather than keying it. The two must quote every text the same way.
   */
  test("Rat's message quotes, cuts and escapes exactly as the prelude parsers' do", async () => {
    const m = await messages();
    const texts = ["x".repeat(41), "y".repeat(40), "a\"b\\c", "1\n2\t\u007f", "\u{1F600}".repeat(41), "1/0"];
    for (const text of texts) {
      expect(m.rat!(text), JSON.stringify(text)).toBe(m.big!(text).replace(/ is not a BigInt$/u, " is not a Rat"));
    }
  });

  test("it is bare, an exception, caught by name, and shown by Show<Exn>", async () => {
    const main = await runMain(`module Main

export let shown: String =
    match attempt Int.parse^("12x")
        Err(e) => show(e)
        Ok(_) => "parsed"
export let qualified: String =
    try
        Int.show(Int.parse^("bad"))
    catch
        Int.NumberFormatError(message) => message
export let assumed: Int = assume Int.parse^("8080")
`);
    expect(main).toMatchObject({
      shown: "NumberFormatError: \"12x\" is not an Int",
      qualified: "\"bad\" is not an Int",
      assumed: 8080,
    });
  });

  test("parse may fail, so a call wears `^`, and `?` reads it", () => {
    const source = "module Main\n\n" +
      "let a(s: String) = Int.parse^(s)\n" +
      "let b(s: String) = Float.parse?(s)\n";
    expect(projectDiagnostics(source)).toEqual([]);
    expect(hoveredType(source, "a(s")).toBe("String ->^ Int");
    expect(hoveredType(source, "b(s")).toBe("String -> Option(Float)");
    expect(projectDiagnostics("module Main\n\nlet c(s: String) = Int.parse(s)\n"))
      .toEqual(["this call may fail, so `parse` wants `^`, not no mark"]);
  });
});

describe("the round trip: T.parse(show(x)) gives back x", () => {
  test("for Int, Nat, BigInt, Float, Dec and Rat", async () => {
    const main = await runMain(`module Main

import Rat

let ints: Vector(Int) = [0, 1, -1, 42, -9007199254740991, 9007199254740991]
let nats: Vector(Nat) = [0, 5, 9007199254740991]
let bigs: Vector(BigInt) = [0n, -1n, 123456789012345678901234567890n]
let floats: Vector(Float) = [0.0, -0.0, 1.5, -2.25, 0.1, 1e21, 1.5e-7, 5e-324, 1.7976931348623157e308, Float.infinity, -Float.infinity]
let decs: Vector(Dec) = [Dec.create(150n, 2), Dec.create(-5n, 2), Dec.create(12n, 0), Dec.create(0n, 3)]
let rats: Vector(Rat) = [Rat.create(1n, 3), Rat.create(-6n, 4), Rat.create(5n, 1)]

export let intsBack: Bool = Seq.all(ints.toSeq(), (n) => Int.parse?(show(n)) == Some(n))
export let natsBack: Bool = Seq.all(nats.toSeq(), (n) => Nat.parse?(show(n)) == Some(n))
export let bigsBack: Bool = Seq.all(bigs.toSeq(), (n) => BigInt.parse?(show(n)) == Some(n))
export let floatsBack: Bool = Seq.all(floats.toSeq(), (x) => Float.parse?(show(x)) == Some(x))
export let nanBack: Bool = match Float.parse?(show(Float.nan))
    Some(x) => x.isNan()
    None => False
export let decsBack: Bool = Seq.all(decs.toSeq(), (d) => match Dec.parse?(show(d))
    Some(back) => Dec.same(back, d)
    None => False)
export let ratsBack: Bool = Seq.all(rats.toSeq(), (r) => Rat.parse?(show(r)) == Some(r))
`);
    expect(main).toMatchObject({
      intsBack: true, natsBack: true, bigsBack: true, floatsBack: true, nanBack: true,
      decsBack: true, ratsBack: true,
    });
  });
});

describe("a reading's Option widens as Some(…) would (Effects §3.1, n5)", () => {
  test("at a written Option of a wider type, in every seat", async () => {
    const source = "module Main\n\n" +
      "export let direct(s: String): Option(BigInt) = Int.parse?(s)\n" +
      "export let bound: Option(Float) = Int.parse?(\"3\")\n" +
      "export let grouped(s: String): Option(BigInt) = (Int.parse?(s))\n" +
      "export let branched(s: String): Option(BigInt) = if s == \"\" then None else Int.parse?(s)\n" +
      "export let fromNat(s: String): Option(Int) = Nat.parse?(s)\n";
    expect(projectDiagnostics(source)).toEqual([]);
    expect(hoveredType(source, "direct")).toBe("String -> Option(BigInt)");
    const main = await runMain(source);
    const direct = main["direct"] as (text: string) => Read<unknown>;
    expect(direct("12")).toEqual(some(12n));
    expect(direct("x")).toEqual(none);
    expect(main["bound"]).toEqual(some(3));
    expect((main["grouped"] as (text: string) => Read<unknown>)("7")).toEqual(some(7n));
    expect((main["branched"] as (text: string) => Read<unknown>)("8")).toEqual(some(8n));
    expect((main["fromNat"] as (text: string) => Read<unknown>)("9")).toEqual(some(9));
  });

  /** The widening is the call's result's, inside `Some`, never the `Option`'s. */
  test("the widening sits inside Some, and nothing but a numeric widening applies", () => {
    const project = compileMain("module Main\n\nexport let direct(s: String): Option(BigInt) = Int.parse?(s)\n");
    expect(project.diagnostics).toEqual([]);
    const main = project.modules.find(({ source }) => source.path === "/main.hex")!.javascript.text;
    expect(main).toContain('return { tag: "Some", value: BigInt(parse(s)) };');
    expect(projectDiagnostics("module Main\n\nlet wrong(s: String): Option(String) = Int.parse?(s)\n"))
      .toEqual(["type mismatch: expected String, found Int"]);
    expect(projectDiagnostics("module Main\n\nlet narrow(s: String): Option(Int) = BigInt.parse?(s)\n"))
      .toEqual(["type mismatch: expected Int, found BigInt"]);
  });
});
