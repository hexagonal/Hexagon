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

  test("a written type that failed to resolve takes its own report alone", () => {
    // Wherever the declaration wrote it: a parameter, nested in a parameter's
    // function type, the return annotation, or a block head's member.
    for (const source of [
      "fun f<a: Num>(x: Nope(a)): Int = 1\n",
      "fun f<a: Num>(g: (Nope(a)) -> Int): Int = 1\n",
      "fun f<a: Num>(x: Int): Nope(a) = x\n",
      "fun<u: Num>\n    b(x: Int): Int = x\n    a(x: Nope(u)): Int = 1\n",
    ]) {
      expect(verdict(source)).toEqual(["unknown generic type `Nope`"]);
    }
  });

  test("an ascription's variable at a value binding takes the same row and wording", () => {
    // No function records it; the end-of-module sweep's ascription arm speaks,
    // in the one wording every spelling shares.
    expect(verdict(
      TAG + "fun anything(): b = anything()\n" +
      "let v: String = tag((anything() : a))\n",
    )).toEqual([
      // Only the concrete type: a constrained variable has no seat here.
      "`a` is a declared type variable, but this declaration's type does not mention it, " +
        "so no call can choose it or supply its `Tag` evidence; ascribe a concrete type",
    ]);
  });

  test("an ascription's report stands at the ascribed variable, not the value", () => {
    const source = "module Main\n\nfun ignore(value: t): Unit = ()\nlet f() = ignore((42 : a))\n";
    const [diagnostic] = compileMain(source).diagnostics;
    expect(diagnostic?.message).toContain("this declaration's type does not mention it");
    expect(source.slice(diagnostic!.primary.start.offset, diagnostic!.primary.end.offset))
      .toBe("a");
  });

  test("another orphan's refusal, or an error elsewhere, excuses nothing", () => {
    // `b`'s own type mentions the refused `a`; that settling is not an
    // unresolved written type of `b`'s.
    expect(verdict(
      "fun f<a: Num>(x: Int): Int =\n" +
      "    let g = <b: Num>(y: a): Int => 1\n" +
      "    x\n",
    )).toEqual([unmentioned("a", "Num", true), unmentioned("b", "Num")]);
    // An error in an inferred result is not a written type.
    const messages = verdict("fun f<a: Num>(x: Int) = undefinedName\n");
    expect(messages).toContain(unmentioned("a", "Num"));
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

describe("the row absorbs §4.2's refusal of an unmentioned variable (#1053)", () => {
  // A variable no call can choose can never be handed evidence, so §4.2's
  // advice to widen its list repairs nothing on its own. This row, at the
  // declaration, is the whole report; its first rewrite writes the whole list,
  // since using the variable alone would draw §4.2's refusal next.
  function absorbed(evidence: string, widen: string, use = "a parameter or result type"): string {
    return "`a` is a declared type variable, but this declaration's type does not mention it, " +
      `so no call can choose it or supply its ${evidence} evidence; use \`a\` in ${use} and ${widen}, ` +
      "or remove `a` from the binder list and write a concrete type where the body names `a`";
  }

  test("one report, at the binder, naming the whole list", () => {
    const body = "(x: Int): Int =\n    let g = (y: a) => y + y\n    x\n";
    expect(verdict(`fun f<a: Eq>${body}`))
      .toEqual([absorbed("`Eq`, `Num`", "write `<a: (Eq, Num)>`")]);
    expect(carets(`fun f<a: Eq>${body}`)).toEqual(["a: Eq"]);
    // Both rewrites, applied as written.
    expect(verdict("fun f<a: (Eq, Num)>(x: a): Int =\n    let g = (y: a) => y + y\n    0\n")).toEqual([]);
    expect(verdict("fun f(x: Int): Int =\n    let g = (y: Int) => y + y\n    x\n")).toEqual([]);
  });

  test("the list is maximal: a written constraint a demand entails is dropped", () => {
    expect(verdict(
      "fun f<a: Eq>(x: Int): Int =\n" +
      '    let g = (y: a) => if y < y then show(y) else ""\n' +
      "    x\n",
    )).toEqual([absorbed("`Ord`, `Show`", "write `<a: (Ord, Show)>`")]);
    expect(verdict(
      "fun f<a: (Ord, Show)>(x: a): Int =\n" +
      '    let g = (y: a) => if y < y then show(y) else ""\n' +
      "    0\n",
    )).toEqual([]);
  });

  test("an unconstrained binder the body demands of carries the demand", () => {
    // It used to take §4.2's refusal alone, whose `write <a: Num>` led straight
    // into this row.
    const source = "fun f<a>(x: Int): Int =\n    let g = (y: a) => y + y\n    x\n";
    expect(verdict(source)).toEqual([absorbed("`Num`", "write `<a: Num>`")]);
    expect(carets(source)).toEqual(["a"]);
    expect(verdict("fun f<a: Num>(x: a): Int =\n    let g = (y: a) => y + y\n    0\n")).toEqual([]);
  });

  test("a block head is widened, in the head's own words", () => {
    const members = (head: string, parameter: string) =>
      `fun<${head}>\n` +
      `    p(x: ${parameter}): Int =\n` +
      "        let g = (y: a) => y + y\n" +
      "        0\n" +
      "    q(x: Int): Int = x\n";
    expect(verdict(members("a: Eq", "Int")))
      .toEqual([absorbed("`Eq`, `Num`", "widen the head to `fun<a: (Eq, Num)>`")]);
    expect(verdict(members("a: (Eq, Num)", "a"))).toEqual([]);
  });

  test("a list on a binding's name points at the binding's type", () => {
    expect(verdict("let v<a: Eq>: (Int) -> Int = (x) =>\n    let g = (y: a) => y + y\n    x\n"))
      .toEqual([absorbed("`Eq`, `Num`", "write `<a: (Eq, Num)>`", "the binding's type")]);
    expect(verdict("let v<a: (Eq, Num)>: (a) -> Int = (x) =>\n    let g = (y: a) => y + y\n    0\n"))
      .toEqual([]);
  });

  test("a list the declaration already covers keeps the row's own wording", () => {
    expect(verdict("fun f<a: (Eq, Num)>(x: Int): Int =\n    let g = (y: a) => y + y\n    x\n"))
      .toEqual([unmentioned("a", "Eq`, `Num", true)]);
  });
});

/** The carets, in report order, as the source text each one covers. */
function carets(source: string): readonly string[] {
  const text = "module Main\n\n" + source;
  return compileMain(text).diagnostics.map(({ primary }) =>
    text.slice(primary.start.offset, primary.end.offset)
  );
}

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
