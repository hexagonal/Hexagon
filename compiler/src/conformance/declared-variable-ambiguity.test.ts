import { describe, expect, test } from "vitest";

import { compileMain, projectDiagnostics } from "../support/test-project.js";

// One principle at every declaration site (#712, #1044; GHC's ambiguity check):
// a declared type variable that carries a constraint must occur in the type it
// is declared for, because the type is the only place a call can choose it.

function verdict(source: string): readonly string[] {
  return projectDiagnostics("module Main\n\n" + source);
}

const TAG = "constraint Tag<a> =\n    tag(value: a) -> String\n";

function unmentioned(name: string, evidence: string, named = false): string {
  return `\`${name}\` is a declared type variable, but this declaration's type does not ` +
    `mention it, so no call can choose it or supply its \`${evidence}\` evidence; use ` +
    `\`${name}\` in a parameter or result type, or remove \`${name}\` from the binder list` +
    (named ? ` and write a concrete type where the body names \`${name}\`` : "");
}

describe("a constrained binder its function's type does not mention (#712)", () => {
  test("is refused at the declaration, never through defaulting's `Int`", () => {
    for (const spelling of ["let", "fun"]) {
      expect(verdict(`${spelling} f<a: Num>(x: Int): Int = x\n`))
        .toEqual([unmentioned("a", "Num")]);
    }
    expect(verdict("fun f<a: Num>(x: String): String = x\n"))
      .toEqual([unmentioned("a", "Num")]);
  });

  test("whatever the constraint: a defaultable one and one defaulting never touches alike", () => {
    for (const constraint of ["Show", "Eq", "Hash"]) {
      expect(verdict(`fun f<a: ${constraint}>(x: Int): Int = x\n`))
        .toEqual([unmentioned("a", constraint)]);
    }
    // `Tag` used to compile with the constraint silently dropped, and `f` took
    // no dictionary at all.
    expect(verdict(`${TAG}fun f<a: Tag>(x: Int): Int = x\nexport let r: Int = f(3)\n`))
      .toEqual([unmentioned("a", "Tag")]);
  });

  test("each unmentioned binder is its own report, and a mentioned one none", () => {
    expect(verdict("fun f<a: Num, b: Num>(x: a): a = x\n"))
      .toEqual([unmentioned("b", "Num")]);
  });

  test("a body demand the written list covers is the same refusal, at the binder", () => {
    expect(verdict(
      "fun f<a: Num>(x: Int): Int =\n" +
      "    let twice = (y: a) => y * y\n" +
      "    x\n",
    )).toEqual([unmentioned("a", "Num", true)]);
  });

  test("a block head that no member mentions is the same refusal", () => {
    expect(verdict(
      "fun<u: Num>\n" +
      "    b(x: Int): Int = x\n" +
      "    a(x: Int): Int = b(x)\n",
    )).toEqual([unmentioned("u", "Num")]);
  });

  test("a head one member mentions is not refused for the others", () => {
    expect(verdict(
      "fun<u: Num>\n" +
      "    b(x: u, n: Int): u = if n <= 0 then x else b(x, n - 1)\n" +
      "    a(x: Int): Int = x\n" +
      "export let r: Float = b(1.5, 2)\n",
    )).toEqual([]);
  });

  test("the report stands at the binder", () => {
    const source = "module Main\n\nfun f<b: Show, a: Num>(x: b): b = x\n";
    const [diagnostic] = compileMain(source).diagnostics;
    expect(diagnostic?.message).toBe(unmentioned("a", "Num"));
    expect(source.slice(diagnostic!.primary.start.offset, diagnostic!.primary.end.offset))
      .toBe("a: Num");
  });

  test("where the body names the variable, the binder rewrite gives those names a type too", () => {
    // Removing the binder alone would leave `let y: a = 1` to meet the
    // forced-to-a-concrete-type row, so the advice has to say so (Rewrite Rule).
    expect(verdict("fun f<a: Num>(x: Int): Int =\n    let y: a = 1\n    x\n")).toEqual([
      "`a` is a declared type variable, but this declaration's type does not mention it, " +
        "so no call can choose it or supply its `Num` evidence; use `a` in a parameter or " +
        "result type, or remove `a` from the binder list and write a concrete type where " +
        "the body names `a`",
    ]);
    expect(verdict("fun f(x: Int): Int =\n    let y: Int = 1\n    x\n")).toEqual([]);
  });

  test("a written type that failed to elaborate takes its own report alone", () => {
    expect(verdict("fun f<a: Num>(x: Nope(a)): Int = 1\n"))
      .toEqual(["unknown generic type `Nope`"]);
  });

  test("an ascription's variable at a value binding takes the same row and wording", () => {
    // No function records it; the end-of-module sweep's ascription arm speaks,
    // in the one wording every spelling shares.
    expect(verdict(
      TAG + "fun anything(): b = anything()\n" +
      "let v: String = tag((anything() : a))\n",
    )).toEqual([
      "`a` is a declared type variable, but this declaration's type does not mention it, " +
        "so no call can choose it or supply its `Tag` evidence; ascribe a concrete type, " +
        "or name a type variable the declaration uses",
    ]);
  });

  test("a repeated binder is the parser's error, and the variable it overwrites says nothing", () => {
    expect(verdict("fun f<a: Num, a: Eq>(x: Int): Int = x\n")).toEqual([
      "duplicate type parameter `a`",
      unmentioned("a", "Eq"),
    ]);
  });

  test("a knot's survivor is not unmentioned: its member's signature writes it", () => {
    // `c` is written in `p3`'s signature; the refused knot can leave `p3`'s
    // scheme carrying `b` instead, so the check reads the member's own lambda
    // type. What the survivor does report is #704's, not this rule's.
    const messages = verdict(
      "fun<b: Show, c: Show>\n" +
      "    p2(x: b, n: Int): String = if n <= 0 then show(x) else p3(x, n - 1)\n" +
      "    p3(x: c, n: Int): String = if n <= 0 then show(x) else p2(\"s\", n - 1)\n",
    );
    expect(messages.some((message) => message.includes("does not mention"))).toBe(false);
    expect(messages).toContain(
      "`b` is a declared type variable, but the body requires `String`; change the " +
        "annotation to `String`, or remove it to let the type be inferred",
    );
  });

  test("an unconstrained unused binder stays legal: it needs no evidence", () => {
    const project = compileMain("module Main\n\nfun f<a>(x: Int): Int = x\nexport let r: Int = f(3)\n");
    expect(project.diagnostics).toEqual([]);
  });

  test("a variable in the result only is mentioned, and quantifies (#1042)", () => {
    expect(verdict("fun zero<t: Num>(): t = 0\n")).toEqual([]);
  });
});

describe("a constraint member header mentions the subject (#1044, Constraints §2)", () => {
  function refusal(member: string, constraint: string, subject: string): string {
    return `the member \`${member}\` does not mention \`${constraint}\`'s subject ` +
      `\`${subject}\`, so no call can determine which \`${constraint}\` instance it uses; ` +
      `use \`${subject}\` in its parameters or its result`;
  }

  test("a header without the subject is refused at the member", () => {
    expect(verdict("constraint Tag<a> =\n    size(n: Int) -> Int\n"))
      .toEqual([refusal("size", "Tag", "a")]);
  });

  test("an implied type does not stand in for the subject", () => {
    expect(verdict("constraint Bag<c> =\n    type Item\n    first(item: Item) -> Int\n"))
      .toEqual([refusal("first", "Bag", "c")]);
  });

  test("the subject anywhere in a parameter or the result is a mention", () => {
    expect(verdict(
      "constraint Make<a> =\n" +
      "    make(seed: Nat) -> a\n" +
      "    visit(f: (a) -> Int) -> Int\n" +
      "    many(items: Vector(a)) -> Int\n",
    )).toEqual([]);
  });

  test("only the offending member is refused", () => {
    expect(verdict(
      "constraint Mixed<a> =\n" +
      "    fine(value: a) -> Int\n" +
      "    loose(n: Int) -> Int\n",
    )).toEqual([refusal("loose", "Mixed", "a")]);
  });
});
