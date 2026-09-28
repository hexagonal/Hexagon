/**
 * Conformance for **a body held until its dot-call goals settle** (#378).
 *
 * A dot call whose receiver is still an unsolved variable is a goal (Method
 * Syntax §3): it resolves when the receiver's head arrives — later in its owner
 * region, or at the region's deadline — and only then is its call, and the
 * colour that call carries, registered into the body it was written in. A body
 * that closes with such a goal pending cannot decide its colour at its close,
 * the moment Effects §3.4 decides a lambda's: the call it has not yet absorbed
 * may be the one that makes it a source. Deciding it anyway lost the effect —
 * the lambda read pure, its callers were told to drop the `!`, and a `->`
 * demand accepted it.
 *
 * So such a body is **held**, as a knot holds a lambda whose calls reach a
 * sibling (§3.4's knot bullet): its colour and its calls' are decided at the
 * goals' deadline, right after they settle, and a demand its colour meets in
 * the meantime is recorded and compared then, never choosing it. A body that
 * calls a held one is held with it. Every specimen below lost its effect before
 * the hold.
 */

import { describe, expect, test } from "vitest";
import { compileFiles } from "../support/test-project.js";
import * as Typed from "../syntax/typed/index.js";

const world = "extern from \"./world.js\"\n" +
  "    export fun save(document: String) ->! Unit\n\n";

function compile(body: string) {
  return compileFiles([["/main.hex", "module Main\n\n" + world + body]]);
}

function refusals(body: string): readonly string[] {
  return compile(body).diagnostics.map(({ message }) => message);
}

/** The scheme a top-level binding was given, as the checker renders it. */
function typeOf(body: string, name: string): string {
  const compiled = compile(body);
  expect(compiled.diagnostics.map(({ message }) => message)).toEqual([]);
  const typed = compiled.modules.find(({ source }) => source.path === "/main.hex")!.typed;
  const symbol = typed.symbols.find(
    (candidate) => candidate.name === name && candidate.bindingSpan.fileId === typed.fileId,
  );
  if (symbol === undefined) throw new Error(`no symbol \`${name}\``);
  return Typed.displayScheme(symbol.scheme);
}

/** A lambda whose one dot call settles only when a later line fixes `source`. */
const heldLambda = (use: string): string =>
  "let run(source) =\n" +
  "    let act = () => source.forEach!((value) => save!(value))\n" +
  "    let pinned: Seq(String) = source\n" +
  `    ${use}\n`;

/** A `Store` whose `Int` instance saves, reached through a receiver only defaulting settles. */
const store = "constraint Store<s> =\n" +
  "    put(x: s) ->! Unit\n\n" +
  "honor Store<Int> =\n" +
  "    put(x) = save!(\"x\")\n\n" +
  "let f(n) =\n" +
  "    let k = n + 1\n" +
  "    n.put!()\n";

describe("a goal that settles after its body closes keeps its colour", () => {
  test("the control: a goal settling inside its own open body", () => {
    expect(typeOf(
      "let run(source): Seq(String) =\n" +
        "    source.forEach!((value) => save!(value))\n" +
        "    let pinned: Seq(String) = source\n" +
        "    pinned\n",
      "run",
    )).toBe("Seq(String) ->! Seq(String)");
  });

  test("a lambda closed before its receiver was known is impure", () => {
    expect(typeOf(heldLambda("act"), "run")).toBe("Seq(String) -> () ->! Unit");
  });

  test("calling it takes `!`, and its caller is a source", () => {
    expect(typeOf(heldLambda("act!()"), "run")).toBe("Seq(String) ->! Unit");
    expect(refusals(heldLambda("act()"))).toEqual([
      "this call runs effects, so `act` wants `!`, not no mark",
    ]);
  });

  test("an inner function is held the same way", () => {
    const inner = (use: string): string =>
      "let run(source) =\n" +
      "    let inner() = source.forEach!((value) => save!(value))\n" +
      "    let pinned: Seq(String) = source\n" +
      `    ${use}\n`;
    expect(typeOf(inner("inner"), "run")).toBe("Seq(String) -> () ->! Unit");
    expect(refusals(inner("inner()"))).toEqual([
      "this call runs effects, so `inner` wants `!`, not no mark",
    ]);
  });

  test("a `fun` member's goals settle before its knot decides it", () => {
    expect(typeOf(
      "fun go(v) =\n" +
        "    let act = () => v.forEach!((value) => save!(value))\n" +
        "    let pinned: Seq(String) = v\n" +
        "    act\n",
      "go",
    )).toBe("Seq(String) -> () ->! Unit");
  });

  test("a goal settled by defaulting at its owner's deadline", () => {
    expect(typeOf(store, "f")).toBe("Int ->! Unit");
    expect(refusals(store + "\nlet g() = f(1)\n")).toEqual([
      "this call runs effects, so `f` wants `!`, not no mark",
    ]);
  });
});

describe("what a held colour meets before it settles is compared after", () => {
  test("a `->` demand is refused at the demand", () => {
    expect(refusals(heldLambda("let quiet: () -> Unit = act\n    quiet"))).toEqual([
      "a `->` arrow promises purity, and this function performs effects — the demand is " +
        "written `->`, the function's face `->?` or `->!`",
    ]);
  });

  test("a held body whose goal is pure stays pure", () => {
    expect(refusals(
      "let run(source) =\n" +
        "    let act = () => source.length()\n" +
        "    let pinned: Seq(String) = source\n" +
        "    act!()\n",
    )).toEqual(["this call is pure, so `act` wants no mark, not `!`"]);
  });
});
