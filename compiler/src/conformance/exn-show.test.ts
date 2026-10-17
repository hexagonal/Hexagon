import { describe, expect, test } from "vitest";

import { AnalysisSession } from "../analysis/session.js";
import { compileMain, projectDiagnostics, runMain } from "../support/test-project.js";

/**
 * Conformance for **describing a caught `Exn`** (Exceptions §8.6, #1159):
 * `honor Show<Exn>` and `Exn.stack`, in `stdlib/Exn.hex`, `Exn`'s companion.
 *
 * - **One line.** `show` gives JavaScript's own first line, `Name: message`,
 *   or whichever half is not empty. An exception's `message` slot fills it.
 * - **Pure.** A foreign throw is read with `JsError`'s kept reads (FFI Part 11
 *   §7), so every property of one value is read once, whichever of `show`,
 *   `Exn.stack`, `JsError.message` and `JsError.stack` asks first.
 * - **The companion.** `e.show()`, `show(e)` and interpolation reach the
 *   instance; `e.stack()` is `Exn.stack(e)`; a field read is still refused, and
 *   `Exn` still has no `Eq`.
 *
 * A foreign `Exn` is any JavaScript value at run time, so the hostile inputs are
 * handed to exported functions from this side, as `js-error-door.test.ts` does
 * for `JsValue`.
 */

/** `show` and `Exn.stack` over an `Exn`, callable with any JavaScript value. */
async function describers(): Promise<{
  show: (error: unknown) => string;
  stack: (error: unknown) => { tag: string; value?: string };
  message: (error: unknown) => string;
}> {
  const main = await runMain("module Main\n\n" +
    "export let describe(error: Exn): String = show(error)\n" +
    "export let trace(error: Exn): Option(String) = error.stack()\n" +
    "export let foreignMessage(value: JsValue): String = JsError.message(value)\n");
  return {
    show: main["describe"] as (error: unknown) => string,
    stack: main["trace"] as (error: unknown) => { tag: string; value?: string },
    message: main["foreignMessage"] as (error: unknown) => string,
  };
}

function hoveredType(source: string, needle: string): string | undefined {
  const session = new AnalysisSession();
  session.setFile("/main.hex", source);
  return session.hover("/main.hex", source.indexOf(needle))?.displayedType;
}

describe("Show<Exn>: JavaScript's one line", () => {
  test("an exception shows its name, and its message where it has one", async () => {
    const main = await runMain(`module Main

exception ParseError(line: Int, message: String)
exception TimeoutError(millis: Int)
exception NotFoundError

export let parse: String = show(ParseError(3, "unexpected token"))
export let timeout: String = show(TimeoutError(5000))
export let missing: String = show(NotFoundError)
export let interpolated: String = "failed: \${ParseError(1, "bad")}"
export let dotted: String = NotFoundError.show()
export let qualified: String = Show.show(TimeoutError(1))
`);
    expect(main).toMatchObject({
      parse: "ParseError: unexpected token",
      timeout: "TimeoutError",
      missing: "NotFoundError",
      interpolated: "failed: ParseError: bad",
      dotted: "NotFoundError",
      qualified: "TimeoutError",
    });
  });

  /** Faults are `Exn`s too, and `AssumptionFault` shows its cause's message. */
  test("a fault shows the same way, and `assume` keeps the cause's message", async () => {
    const main = await runMain(`module Main

exception ParseError(line: Int, message: String)
let parse(text: String): Int = if text == "" then throw^(ParseError(1, "empty input")) else 1

let caught(thunk: () ->! Int): String =
    try
        Int.show(thunk!())
    catch
        fault f => show(f)
        e => show(e)

export let key: String = caught(() => Map.get(Map.empty, "k") |> Option.defaultValue(throw(KeyFault)))
export let assumed: String = caught(() => assume parse^(""))
export let caughtException: String = caught(() => parse^(""))
`);
    expect(main).toMatchObject({
      key: "KeyFault",
      assumed: "AssumptionFault: empty input",
      caughtException: "ParseError: empty input",
    });
  });

  test("a foreign throw shows its own name and message, guarded", async () => {
    const { show } = await describers();
    expect(show(new TypeError("x is not a function"))).toBe("TypeError: x is not a function");
    expect(show(new Error(""))).toBe("Error");
    expect(show({ message: "only a message" })).toBe("only a message");
    expect(show({ name: "OnlyAName" })).toBe("OnlyAName");
    expect(show({})).toBe("");
    expect(show({ get name(): string { throw new Error("hostile"); }, message: "kept" })).toBe("kept");
    expect(show("oops")).toBe("oops");
    expect(show(null)).toBe("null");
    expect(show(42)).toBe("42");
    expect(show([1, 2])).toBe("");
  });

  /**
   * Each property is read once per value, whoever asks: `show` keeps `.name`
   * here and asks `JsError`'s kept `.message`, so a later `JsError.message`
   * of the same value reads nothing again.
   */
  test("every property of a foreign throw is read once, whoever asks first", async () => {
    const { show, message } = await describers();
    let names = 0;
    let messages = 0;
    const value = {
      get name(): string {
        names += 1;
        return `Name${names}`;
      },
      get message(): string {
        messages += 1;
        return `message ${messages}`;
      },
    };
    expect(show(value)).toBe("Name1: message 1");
    expect(show(value)).toBe("Name1: message 1");
    expect(message(value)).toBe("message 1");
    expect([names, messages]).toEqual([1, 1]);

    const askedFirst = {
      get message(): string {
        messages += 1;
        return `first ${messages}`;
      },
    };
    expect(message(askedFirst)).toBe("first 2");
    expect(show(askedFirst)).toBe("first 2");
    expect(messages).toBe(2);
  });

  /** The wrapping is virtual (Exceptions §6.2): `JsError(v)` shows as `v`. */
  test("a `JsError(v)` built by hand shows as `v` does", async () => {
    const main = await runMain(`module Main

export let wrapped(value: JsValue): String = show(JsError(value))
export let traced(value: JsValue): Option(String) = Exn.stack(JsError(value))
`);
    const wrapped = main["wrapped"] as (value: unknown) => string;
    const traced = main["traced"] as (value: unknown) => { tag: string; value?: string };
    expect(wrapped(new RangeError("out of range"))).toBe("RangeError: out of range");
    expect(wrapped("plain")).toBe("plain");
    const original = new Error("with a trace");
    expect(traced(original).value).toBe(original.stack);
  });

  /** A record holding an `Exn` derives `Show` now, and an `Option` shows. */
  test("a type holding an `Exn` can derive `Show`", async () => {
    const main = await runMain(`module Main

exception Boom(message: String)
record Failure derives (Show) = {step: Int, error: Exn}

export let failure: String = show(Failure({step = 2, error = Boom("bang")}))
export let optional: String = show(Some(Boom("bang")))
`);
    expect(main["failure"]).toContain("Boom: bang");
    expect(main["optional"]).toBe("Some(Boom: bang)");
  });
});

describe("Exn.stack, and the companion", () => {
  test("a stack where there is one, and `None` where there is none", async () => {
    const { stack } = await describers();
    const error = new Error("traced");
    expect(stack(error)).toEqual({ tag: "Some", value: error.stack });
    expect(stack("oops").tag).toBe("None");
    expect(stack(null).tag).toBe("None");
    expect(stack({ stack: 42 }).tag).toBe("None");

    const main = await runMain(`module Main

exception Boom
export let hexagon: Bool = match Exn.stack(Boom)
    Some(_) => True
    None => False
`);
    expect(main["hexagon"]).toBe(true);
  });

  test("both are pure, and each spelling reaches them", () => {
    const source = "module Main\n\n" +
      "let shown(e: Exn) = e.show()\n" +
      "let traced(e: Exn) = e.stack()\n" +
      "let qualified(e: Exn) = Exn.stack(e)\n" +
      "let pure: (Exn) -> String = (e) => \"${e}\"\n";
    expect(projectDiagnostics(source)).toEqual([]);
    expect(hoveredType(source, "shown")).toBe("Exn -> String");
    expect(hoveredType(source, "traced")).toBe("Exn -> Option(String)");
    expect(hoveredType(source, "qualified")).toBe("Exn -> Option(String)");
  });

  /** The companion opens dot calls to its exports and `Show`'s member, nothing else. */
  test("a field read, another dot call, and `Eq` are still refused", () => {
    expect(projectDiagnostics("module Main\n\n" +
      "let a(e: Exn) = e.name\n" +
      "let b(e: Exn) = e.message()\n" +
      "let c(e: Exn): Bool = e == e\n",
    )).toEqual([
      "exceptions are inspected with `try`/`catch`",
      "`Exn` has no field `message`, its companion exports no operation `message`, and no constraint honored at `Exn` has a subject-first member `message`; call an available subject-first function explicitly",
      "type `Exn` has no `Eq` instance; its only legal homes are the module declaring `Eq` and `Exn`'s prelude companion module, both outside project source, so this pair's honored set is closed — change the type, or go through the operations those homes export",
    ]);
  });

  test("a project cannot honor `Show<Exn>` itself", () => {
    expect(projectDiagnostics("module Main\n\n" +
      "honor Show<Exn> =\n" +
      "    show(e) = \"mine\"\n",
    )).toEqual([
      "orphan instance: this module declares neither `Show` nor the instance subject; " +
        "`Show<Exn>` is already declared in module `Exn`",
    ]);
  });

  test("the `.d.ts` face of `Exn.stack`", () => {
    const project = compileMain("module Main\n\nexport let traced(e: Exn): Option(String) = e.stack()\n");
    expect(project.diagnostics).toEqual([]);
    const exn = project.modules.find(({ source }) => source.path.endsWith("/Exn.hex"))!;
    expect(exn.declarations.text).toContain("export declare const stack: (error: Error) => Option<string>;");
  });
});
