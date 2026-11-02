import { describe, expect, test } from "vitest";

import { describeFailure, formatConsoleArguments } from "./execution";

describe("execution output", () => {
  test("formats primitive and generated tuple values", () => {
    expect(formatConsoleArguments(["answer", 42, true, 7n, ["Hearts", 10]])).toBe(
      "answer 42 true 7n [Hearts, 10]",
    );
  });

  test("bounds recursive host values", () => {
    const value: { self?: unknown } = {};
    value.self = value;

    expect(formatConsoleArguments([value])).toBe("{self: [Circular]}");
  });
});

/**
 * The cases a playground program cannot throw, or not easily: these pin the
 * guarded reads themselves. The parity with `Show<Exn>` for throws a program
 * can make is pinned through the worker, in `execution-worker.test.ts`.
 */
describe("describing an uncaught failure", () => {
  test("joins the name and the message, or gives whichever is not empty", () => {
    expect(describeFailure(new TypeError("x is not a function"))).toBe("TypeError: x is not a function");
    expect(describeFailure(Object.assign(new Error(""), { name: "Oops" }))).toBe("Oops");
    expect(describeFailure(Object.assign(new Error("only the message"), { name: "" }))).toBe("only the message");
    expect(describeFailure({ name: "X", message: "y" })).toBe("X: y");
  });

  test("counts only a string, read without coercion", () => {
    expect(describeFailure(Object.assign(new Error("msg"), { name: 42 }))).toBe("msg");
    expect(describeFailure(Object.assign(new Error("msg"), { name: Symbol("s") }))).toBe("msg");
    expect(describeFailure({ name: "X", message: { toString: () => "coerced" } })).toBe("X");
  });

  test("never reaches the value's own toString", () => {
    const shadowed = Object.assign(new Error("slot shadows"), { name: "Weird", toString: "not a function" });
    expect(describeFailure(shadowed)).toBe("Weird: slot shadows");
    expect(describeFailure({ toString: "x", message: "no primitive" })).toBe("no primitive");
  });

  test("swallows a read that throws", () => {
    const trap = new Proxy({}, { get() { throw new Error("trap"); } });
    expect(describeFailure(trap)).toBe("");
    const getter = Object.defineProperty(new Error("kept"), "name", { get() { throw new Error("getter"); } });
    expect(describeFailure(getter)).toBe("kept");
  });

  test("renders a value without properties as itself", () => {
    expect(describeFailure("oops")).toBe("oops");
    expect(describeFailure(null)).toBe("null");
    expect(describeFailure(undefined)).toBe("undefined");
    expect(describeFailure(Symbol("s"))).toBe("Symbol(s)");
    expect(describeFailure(7n)).toBe("7");
  });

  test("describes the value inside a JsError built in Hexagon", () => {
    expect(describeFailure({ $hex: "Hex.JsError", name: "JsError", error: "oops" })).toBe("oops");
    expect(describeFailure({ $hex: "Hex.JsError", name: "JsError", error: new RangeError("r") })).toBe("RangeError: r");
  });
});
