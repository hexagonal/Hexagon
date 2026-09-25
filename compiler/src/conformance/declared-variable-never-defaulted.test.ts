import { describe, expect, test } from "vitest";

import { projectDiagnostics } from "../support/test-project.js";

// #704 (James, 2026-09-25, following GHC): a declared type variable is never
// proposed `Int` by defaulting, anywhere. A knot's survivor is left alone, and
// the knot's own refusal is the only report. The bindings with no evidence seat
// keep defaulting's refusal, which their own binding delivers.

function verdict(source: string): readonly string[] {
  return projectDiagnostics("module Main\n\n" + source);
}

const REFUSED_B =
  "`b` is a declared type variable, but the body requires `String`; change the " +
  "annotation to `String`, or remove it to let the type be inferred";

describe("a knot's survivor gets no report of its own", () => {
  test("head-declared: `c` is never blamed for an `Int` no body demanded", () => {
    expect(verdict(
      "fun<b: Show, c: Show>\n" +
      "    p2(x: b, n: Int): String = if n <= 0 then show(x) else p3(x, n - 1)\n" +
      "    p3(x: c, n: Int): String = if n <= 0 then show(x) else p2(\"s\", n - 1)\n",
    )).toEqual([REFUSED_B]);
  });

  test("member-declared: the knot refuses as a whole", () => {
    expect(verdict(
      "fun\n" +
      "    p2(x: b, n: Int): String = if n <= 0 then show(x) else p3(x, n - 1)\n" +
      "    p3(x: c, n: Int): String = if n <= 0 then show(x) else p2(\"s\", n - 1)\n",
    )).toEqual([REFUSED_B]);
  });

  test("a knot that refused nothing still reports a sibling's reach, at the member", () => {
    // `c`'s own `u` is reached from `a` through the shared type; without the
    // default, #1048's evidence check is what speaks, naming `a`, not its local.
    expect(verdict(
      "fun\n" +
      "    c(go: Bool): u = if go then 0 else if a(False) == 0 then c(True) else 0\n" +
      "    a(flag: Bool): Int =\n" +
      "        let z = c(True) + c(False)\n" +
      "        if flag then 1 else 0\n" +
      "export let r: Int = a(True)\n",
    )).toEqual([
      "`u` is declared on `c`, and this in `a` needs its `Num` evidence, but `a`'s type " +
        "does not mention it, and a knot member cannot name a sibling's variable; declare " +
        "it on the block's head, `fun<u: Num>`, and write `u` in `a`'s signature too",
    ]);
  });

  test("a refusal in one knot of a block hides nothing in another knot of it", () => {
    // `p2` is its own knot, `p4` another: the knot is the SCC, never the whole
    // block (§10), so `p4`'s unrouted demand is still reported.
    expect(verdict(
      "fun<b: Show, c: Show>\n" +
      "    p2(x: b, n: Int): String = if n <= 0 then show(x) else p2(\"s\", n - 1)\n" +
      "    p3(x: c, n: Int): String = if n <= 0 then show(x) else p3(x, n - 1)\n" +
      "    p4(n: Int): String =\n" +
      "        let f = (y: c) => show(y)\n" +
      "        \"\"\n",
    )).toEqual([
      REFUSED_B,
      "`c` is a declared type variable, and this needs its `Show` evidence, but `p4`'s " +
        "type does not mention `c`, so no call of `p4` can supply it; use `c` in `p4`'s " +
        "parameter or result types",
    ]);
  });

  test("a clash outside the knot is not the knot's refusal, and hides nothing", () => {
    // `h` meets `u` only because it leaked from `c`, which `a`'s reach left
    // unquantified. `h`'s own clash is reported, and so is the knot's cause.
    const messages = verdict(
      "fun\n" +
      "    c(go: Bool): u = if go then 0 else if a(False) == 0 then c(True) else 0\n" +
      "    a(flag: Bool): Int =\n" +
      "        let z = c(True) + c(False)\n" +
      "        if flag then 1 else 0\n" +
      "fun h<q: Num>(x: q): q = c(True)\n",
    );
    expect(messages.some((message) => message.startsWith("`u` is declared on `c`, and this in `a`")))
      .toBe(true);
  });
});

describe("the bindings with no evidence seat keep defaulting's refusal", () => {
  test("an annotated value binding", () => {
    expect(verdict("let x: a = 42\n")).toEqual([
      "`a` is a declared type variable, but the body requires `Int`; change the " +
        "annotation to `Int`, or remove it to let the type be inferred",
    ]);
  });

  test("an ascription at a value binding", () => {
    expect(verdict("let n = (42 : a)\n")).toEqual([
      "`a` is a declared type variable, but `42` can be only a `Num` type; ascribe the " +
        "concrete type you mean — `(42 : Int)` — or remove the ascription to let the " +
        "literal default to `Int`",
    ]);
  });

  test("an ascription its value binding's type does not mention is the unmentioned row", () => {
    expect(verdict("let n = ignore((42 : a))\n")).toEqual([
      "`a` is a declared type variable, but this declaration's type does not mention it, " +
        "so no call can choose it or supply its `Num` evidence; ascribe a concrete type",
    ]);
  });
});
