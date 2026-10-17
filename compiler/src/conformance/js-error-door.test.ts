import { describe, expect, test } from "vitest";

import { compileProject, Source } from "../index";
import { compileFiles, compileMain, projectDiagnostics } from "../support/test-project.js";

/**
 * Conformance for **the `JsError` door** — Exceptions §6, FFI Part 11 §7,
 * `attempt` (§8.2), and the guard §7.6 withholds (#509).
 *
 * One doctrine sentence is the whole subject: *the entire foreign world enters
 * through exactly one door*. Everything below is that sentence made checkable,
 * in four groups.
 *
 * - **The arm, in both seats.** `JsError(e)` is an ordinary catch pattern to
 *   the parser and the checker, and in emission it *is* §7.4's foreign branch:
 *   it allocates nothing, binds the thrown value itself, and an unmatched
 *   foreign error is rethrown as the original object. Checked by identity
 *   (`toBe`) rather than by shape, because "the same object" is the claim.
 * - **The wrapping is virtual, and syntactic.** `throw(JsError(e))` emits
 *   `throw e;`, so the rethrow-after-inspection idiom keeps the original
 *   error's identity and its stack. The exotic path — construct now, throw
 *   later — is *not* recognized and materialises the branded wrapper, which is
 *   §6.2's recorded residue; the arm then catches that wrapper on the domestic
 *   side, where it is merely ordinary.
 * - **Identity, not spelling.** A module's own `exception JsError(error:
 *   JsValue)` is legal — `JsValue` is a bare type name anyone may write — and
 *   gets none of the above: its own module's brand, a real wrapper, a `.is`
 *   guard. Every gate keys on the checked prelude declaration, so the two never
 *   meet (#679/#727's doctrine, applied to an exception).
 * - **The accessors are total and conservative.** FFI Part 11 §7's table, row
 *   by row, including the rows that only a hostile value reaches: a getter that
 *   throws, a poisoned `toString`, a `Symbol` that no interpolation survives.
 *   The counting tests are the load-bearing ones — "one guarded read" and
 *   "once per value, kept" are claims about *how many times*, which only a
 *   counter can refute.
 *
 * The harness is the hand-rolled linker rather than `runProject`, because every
 * interesting input here is a foreign module throwing something on purpose, and
 * bare specifiers are what an `extern from "thrower"` spells.
 */

/** Minimal ESM linker: compiler-owned relative imports become data-URL modules. */
function resolveModulePath(importer: string, specifier: string): string | undefined {
  if (!specifier.startsWith("./") && !specifier.startsWith("../")) return undefined;
  const directory = importer.slice(0, Math.max(0, importer.lastIndexOf("/")));
  const parts: string[] = [];
  for (const part of `${directory}/${specifier}`.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  const path = `/${parts.join("/")}`;
  return path.endsWith(".js") ? `${path.slice(0, -3)}.hex` : path;
}

function link(
  javascript: string,
  importerPath: string,
  moduleUrls: ReadonlyMap<string, string>,
): string {
  return javascript.replace(
    /^(\s*import(?:[^;\n]*?\sfrom)?\s+)(["'])([^"']+)\2;/gmu,
    (statement, prefix: string, _quote: string, specifier: string) => {
      const target = resolveModulePath(importerPath, specifier) ?? specifier;
      const url = moduleUrls.get(target) ?? moduleUrls.get(specifier);
      return url === undefined ? statement : `${prefix}${JSON.stringify(url)};`;
    },
  );
}

/**
 * A `data:` URL is a module *identity*, so two runs whose emitted text is
 * byte-identical share one instantiated module. Each run is stamped.
 */
let runTag = 0;

async function run(
  source: string,
  foreign: Readonly<Record<string, string>> = {},
): Promise<Record<string, unknown>> {
  const project = compileProject([new Source.File(Source.fileId(0), "/main.hex", "module Main\n\n" + source)]);
  expect(project.diagnostics.map(({ message }) => message)).toEqual([]);
  runTag += 1;
  const url = (text: string): string =>
    `data:text/javascript;charset=utf-8,${encodeURIComponent(text)}#door${runTag}`;
  const moduleUrls = new Map<string, string>();
  for (const [specifier, text] of Object.entries(foreign)) moduleUrls.set(specifier, url(text));
  // The program's runtime module, keyed by the `.hex` path `resolveModulePath`
  // derives from the `./hex.js` specifier its importers spell (FFI Part 7 §1.2).
  // `JsKind.hex` contests `Array`, `Number`, `String` and `Symbol` all at once,
  // so every program here reaches it.
  const runtimeGlobals = project.runtimeGlobals;
  if (runtimeGlobals !== undefined) {
    moduleUrls.set(runtimeGlobals.path.replace(/\.js$/u, ".hex"), url(runtimeGlobals.text));
  }
  for (const module of project.modules) {
    moduleUrls.set(
      module.source.path,
      url(link(module.javascript.text, module.source.path, moduleUrls)),
    );
  }
  return (await import(/* @vite-ignore */ moduleUrls.get("/main.hex")!)) as Record<
    string,
    unknown
  >;
}

/** `/main.hex`'s emitted JavaScript. */
function mainJavascript(source: string): string {
  const project = compileMain("module Main\n\n" + source);
  expect(project.diagnostics.map(({ message }) => message)).toEqual([]);
  return project.modules.find(({ source: file }) => file.path === "/main.hex")!.javascript.text;
}

/** One emitted module's `.d.ts`, by path. */
function declarationsOf(source: string, path: string): string {
  const project = compileMain("module Main\n\n" + source);
  expect(project.diagnostics.map(({ message }) => message)).toEqual([]);
  return project.modules.find(({ source: file }) => file.path === path)!.declarations?.text ?? "";
}

/** A foreign module that throws whatever the test names, on demand. */
const thrower = {
  thrower: [
    "export const marker = new TypeError('from JavaScript');",
    "export function reading() { throw marker; }",
    "export function throwString() { throw 'oops'; }",
    "export function throwNull() { throw null; }",
  ].join("\n"),
};

const externThrower = 'extern from "thrower"\n' +
  "    fun reading() ->! Int\n" +
  "    fun throwString() ->! Int\n" +
  "    fun throwNull() ->! Int\n" +
  "\n";

describe("the arm is the foreign branch, in both catch seats (§6.2, §7.4)", () => {
  test("`try`/`catch` binds the thrown object itself, not a wrapper", async () => {
    const exports = await run(
      externThrower +
        "export let caught(ignored: Int): JsValue =\n" +
        "    try\n" +
        "        JsValue.from(reading!())\n" +
        "    catch\n" +
        "        JsError(e) => e\n",
      thrower,
    );
    const marker = (await import(
      /* @vite-ignore */ `data:text/javascript;charset=utf-8,${
        encodeURIComponent(thrower.thrower)
      }#door${runTag}`
    )) as { marker: unknown };
    expect((exports["caught"] as (i: number) => unknown)(0)).toBe(marker.marker);
  });

  test("the match catch clause takes the same arm", async () => {
    const exports = await run(
      externThrower +
        "export let caught(ignored: Int): String =\n" +
        "    match reading!()\n" +
        "        0 => \"zero\"\n" +
        "        _ => \"other\"\n" +
        "    catch\n" +
        "        JsError(e) => JsError.message(e)\n",
      thrower,
    );
    expect((exports["caught"] as (i: number) => string)(0)).toBe("from JavaScript");
  });

  test("a bare `throw \"oops\"` and a `throw null` both reach the arm", async () => {
    const exports = await run(
      externThrower +
        "export let fromString(ignored: Int): String =\n" +
        "    try\n" +
        "        \"never\" ++ Int.show(throwString!())\n" +
        "    catch\n" +
        "        JsError(e) => JsError.message(e)\n" +
        "export let fromNull(ignored: Int): String =\n" +
        "    try\n" +
        "        \"never\" ++ Int.show(throwNull!())\n" +
        "    catch\n" +
        "        JsError(e) => JsKind.show(JsValue.kind(e))\n",
      thrower,
    );
    expect((exports["fromString"] as (i: number) => string)(0)).toBe("oops");
    expect((exports["fromNull"] as (i: number) => string)(0)).toBe("Null");
  });

  test("a domestic exception is not swallowed by a `JsError`-only clause", async () => {
    const exports = await run(
      "exception Boom(message: String)\n" +
        "export let run(ignored: Int): String =\n" +
        "    try\n" +
        "        throw^(Boom(\"domestic\"))\n" +
        "    catch\n" +
        "        JsError(e) => JsError.message(e)\n",
    );
    let caught: unknown;
    try {
      (exports["run"] as (i: number) => string)(0);
    } catch (error) {
      caught = error;
    }
    expect((caught as { name?: string }).name).toBe("Boom");
    expect((caught as { $hex?: string }).$hex).toBe("Main");
    expect((caught as Error).message).toBe("domestic");
  });

  test("`_` still catches everything, with no `JsError` arm in sight", async () => {
    const exports = await run(
      externThrower +
        "export let caught(ignored: Int): String =\n" +
        "    try\n" +
        "        \"never\" ++ Int.show(reading!())\n" +
        "    catch\n" +
        "        _ => \"caught\"\n",
      thrower,
    );
    expect((exports["caught"] as (i: number) => string)(0)).toBe("caught");
  });

  test("an or-pattern spanning a domestic arm and the door catches both", async () => {
    const exports = await run(
      externThrower +
        "exception Boom(message: String)\n" +
        "export let run(domestic: Bool): String =\n" +
        "    try\n" +
        "        if domestic then throw^(Boom(\"b\")) else Int.show(reading!())\n" +
        "    catch\n" +
        "        Boom(_) | JsError(_) => \"either\"\n",
      thrower,
    );
    const call = exports["run"] as (domestic: boolean) => string;
    expect(call(true)).toBe("either");
    expect(call(false)).toBe("either");
  });

  test("a second `JsError` arm is unreachable, and so is anything after `_`", () => {
    expect(projectDiagnostics("module Main\n\n" + "export let run(n: Int): String =\n" +
        "    try\n" +
        "        Int.show(n)\n" +
        "    catch\n" +
        "        JsError(_) => \"first\"\n" +
        "        JsError(_) => \"second\"\n",
    )).toEqual(["exception `JsError` is already caught above"]);
    expect(projectDiagnostics("module Main\n\n" + "exception Boom(message: String)\n" +
        "export let run(n: Int): String =\n" +
        "    try\n" +
        "        if n == 99 then throw^(Boom(\"never\")) else Int.show(n)\n" +
        "    catch\n" +
        "        _ => \"first\"\n" +
        "        JsError(_) => \"second\"\n",
    )).toEqual(["this catch arm is unreachable; the arm `_` above catches every exception"]);
  });

  test("a domestic arm after a `JsError` arm is fine — the door covers one branch", () => {
    expect(projectDiagnostics("module Main\n\n" + "exception Boom(message: String)\n" +
        "export let run(n: Int): String =\n" +
        "    try\n" +
        "        if n == 99 then throw^(Boom(\"never\")) else Int.show(n)\n" +
        "    catch\n" +
        "        JsError(_) => \"foreign\"\n" +
        "        Boom(m) => m\n",
    )).toEqual([]);
  });
});

describe("the wrapping is virtual and the unwrapping syntactic (§6.2)", () => {
  test("`throw(JsError(e))` emits `throw e;` — no construction, no helper", () => {
    const text = mainJavascript(
      "export let rethrow(e: JsValue): Int = throw^(JsError(e))\n",
    );
    expect(text).toContain("const rethrow = e => (() => { throw e; })();");
    expect(text).not.toContain("throw JsError(e)");
  });

  test("rethrow-after-inspection preserves the original object and its stack", async () => {
    const exports = await run(
      externThrower +
        "export let run(ignored: Int): Int =\n" +
        "    try\n" +
        "        reading!()\n" +
        "    catch\n" +
        "        JsError(e) => throw^(JsError(e))\n",
      thrower,
    );
    const marker = (await import(
      /* @vite-ignore */ `data:text/javascript;charset=utf-8,${
        encodeURIComponent(thrower.thrower)
      }#door${runTag}`
    )) as { marker: Error };
    let caught: unknown;
    try {
      (exports["run"] as (i: number) => number)(0);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBe(marker.marker);
    expect((caught as Error).stack).toBe(marker.marker.stack);
  });

  test("the first-class path materialises the ordinary branded wrapper", async () => {
    const exports = await run(
      "export let wrap(e: JsValue): Exn = JsError(e)\n" +
        "export let later(e: JsValue): Int =\n" +
        "    let held = JsError(e)\n" +
        "    throw^(held)\n",
    );
    const wrapped = (exports["wrap"] as (e: unknown) => Record<string, unknown>)("payload");
    expect(wrapped["$hex"]).toBe("Hex.JsError");
    expect(wrapped["name"]).toBe("JsError");
    expect(wrapped["error"]).toBe("payload");
    // Thrown later, the wrapper is what travels — the unwrapping is the form's,
    // not the value's.
    let caught: unknown;
    try {
      (exports["later"] as (e: unknown) => number)("payload");
    } catch (error) {
      caught = error;
    }
    expect((caught as { $hex?: string }).$hex).toBe("Hex.JsError");
    expect((caught as { error?: unknown }).error).toBe("payload");
  });

  test("the arm catches that wrapper domestically, binding the payload slot", async () => {
    const exports = await run(
      "export let round(e: JsValue): JsValue =\n" +
        "    try\n" +
        "        let held = JsError(e)\n" +
        "        throw^(held)\n" +
        "    catch\n" +
        "        JsError(inner) => inner\n",
    );
    const payload = { tag: "the payload" };
    expect((exports["round"] as (e: unknown) => unknown)(payload)).toBe(payload);
  });
});

describe("every gate keys on the declaration, never on the spelling (#679/#727)", () => {
  /**
   * `exception JsError(error: JsValue)` in a user module is legal Hexagon:
   * `JsValue` is a bare type name, and the prelude's declaration is occluded by
   * the module's own (Modules §5.4). Nothing about the door follows the name
   * there — this is the pin that a name-matched implementation fails.
   */
  const ownDoor = "exception JsError(error: JsValue)\n" +
    "export let rethrow(e: JsValue): Int = throw^(JsError(e))\n" +
    "export let caught(e: JsValue): JsValue =\n" +
    "    try\n" +
    "        throw^(JsError(e))\n" +
    "    catch\n" +
    "        JsError(inner) => inner\n";

  test("a module's own `JsError` is branded with that module and really wraps", async () => {
    const text = mainJavascript(ownDoor);
    expect(text).toContain('const JsError = error => __exception("JsError", "", { error });');
    expect(text).toContain('$hex: "Main"');
    expect(text).toContain("throw JsError(e)");

    const exports = await run(ownDoor);
    const payload = { tag: "user" };
    let caught: unknown;
    try {
      (exports["rethrow"] as (e: unknown) => number)(payload);
    } catch (error) {
      caught = error;
    }
    expect((caught as { $hex?: string }).$hex).toBe("Main");
    expect((caught as { error?: unknown }).error).toBe(payload);
    // And it is caught domestically by its own arm, payload slot and all.
    expect((exports["caught"] as (e: unknown) => unknown)(payload)).toBe(payload);
  });

  test("a module's own `JsError` is not the foreign branch and ships a guard", async () => {
    const text = mainJavascript(`export ${ownDoor}`);
    // No stage-1 binding: the arm in this module is an ordinary domestic arm.
    expect(text).not.toContain("__foreign");
    expect(text).toContain(
      'JsError.is = (__error) => __error != null && __error.$hex === "Main" ' +
        '&& __error.name === "JsError";',
    );

    // A foreign throwable therefore passes straight through its clause.
    const exports = await run(
      externThrower +
        "exception JsError(error: JsValue)\n" +
        "export let run(ignored: Int): Int =\n" +
        "    try\n" +
        "        reading!()\n" +
        "    catch\n" +
        "        JsError(_) => 0\n",
      thrower,
    );
    expect(() => (exports["run"] as (i: number) => number)(0)).toThrow("from JavaScript");
  });
});

describe("the accessors are total and conservative (FFI Part 11 §7)", () => {
  /**
   * The two accessors, reachable from JavaScript so the hostile inputs can be
   * handed to them directly — a `Symbol`, a poisoned `toString`, a getter that
   * throws. None of those has a Hexagon spelling, which is why the table is
   * driven from this side.
   */
  async function accessors(): Promise<{
    message: (value: unknown) => string;
    stack: (value: unknown) => { tag: string; value?: string };
  }> {
    const exports = await run(
      "export let describe(value: JsValue): String = JsError.message(value)\n" +
        "export let trace(value: JsValue): Option(String) = JsError.stack(value)\n",
    );
    return {
      message: exports["describe"] as (value: unknown) => string,
      stack: exports["trace"] as (value: unknown) => { tag: string; value?: string },
    };
  }

  test("a value that bears no properties gets the safe rendering", async () => {
    const { message, stack } = await accessors();
    expect(message("oops")).toBe("oops");
    expect(message(42)).toBe("42");
    expect(message(7n)).toBe("7");
    expect(message(true)).toBe("true");
    expect(message(Symbol("sensor"))).toBe("Symbol(sensor)");
    expect(message(undefined)).toBe("undefined");
    // eslint-disable-next-line unicorn/no-null
    expect(message(null)).toBe("null");
    for (const value of ["oops", 42, 7n, true, Symbol("s"), undefined, null]) {
      expect(stack(value).tag).toBe("None");
    }
  });

  test("an object and a function alike get one guarded `.message` read", async () => {
    const { message } = await accessors();
    expect(message(new TypeError("boom"))).toBe("boom");
    expect(message({ message: "plain" })).toBe("plain");
    const carrier = (): number => 1;
    Object.assign(carrier, { message: "a function's" });
    expect(message(carrier)).toBe("a function's");
  });

  test("absent, non-string, and throwing reads all fall back to the empty string", async () => {
    const { message } = await accessors();
    expect(message({})).toBe("");
    expect(message({ message: 42 })).toBe("");
    expect(message({ get message(): string { throw new Error("hostile"); } })).toBe("");
  });

  /**
   * **Read once per value, and kept** (§7; Effects §6.2 species (b)). A getter
   * that answers differently each time is read on the first ask only, and every
   * later ask for the same value gets that first answer. A different value gets
   * its own read. `.message` and `.stack` are kept apart, each read on its own
   * first ask.
   */
  test("each property is read once per value, on first ask, and kept", async () => {
    const { message, stack } = await accessors();
    let reads = 0;
    const value = {
      get message(): string {
        reads += 1;
        return `read ${reads}`;
      },
    };
    expect(reads).toBe(0);
    expect(message(value)).toBe("read 1");
    expect(message(value)).toBe("read 1");
    expect(reads).toBe(1);

    const other = {
      get message(): string {
        reads += 1;
        return `other ${reads}`;
      },
    };
    expect(message(other)).toBe("other 2");
    expect(message(value)).toBe("read 1");
    expect(reads).toBe(2);

    let traces = 0;
    Object.defineProperty(value, "stack", {
      get(): string {
        traces += 1;
        return `trace ${traces}`;
      },
    });
    expect(stack(value).value).toBe("trace 1");
    expect(stack(value).value).toBe("trace 1");
    expect(traces).toBe(1);
    expect(reads).toBe(2);
  });

  /** A foreign write after the first read is not seen, and a throw is kept too. */
  test("what was kept holds still: a later write, or a getter that stops throwing", async () => {
    const { message } = await accessors();
    const value: { message: string } = { message: "first" };
    expect(message(value)).toBe("first");
    value.message = "second";
    expect(message(value)).toBe("first");

    let hostile = true;
    const flaky = {
      get message(): string {
        if (hostile) throw new Error("hostile");
        return "calm";
      },
    };
    expect(message(flaky)).toBe("");
    hostile = false;
    expect(message(flaky)).toBe("");
  });

  /**
   * The thrown object is never written: no property appears on it, whether it
   * could take one or not.
   */
  test("the keeping is beside the value, never on it", async () => {
    const { message, stack } = await accessors();
    const plain = { message: "plain" };
    expect(message(plain)).toBe("plain");
    expect(stack(plain).tag).toBe("None");
    expect(Reflect.ownKeys(plain)).toEqual(["message"]);
    const frozen = Object.freeze({ message: "frozen" });
    expect(message(frozen)).toBe("frozen");
    expect(Reflect.ownKeys(frozen)).toEqual(["message"]);
  });

  /**
   * A getter that asks for its own property of the same value while its read
   * runs is answered as a swallowed read, and the value keeps that answer: the
   * getter runs once, and the inner ask, the outer ask and every later one
   * agree.
   */
  test("a getter that comes back in runs once, and every ask agrees", async () => {
    const { message } = await accessors();
    let reads = 0;
    let inner = "unset";
    const value = {
      get message(): string {
        reads += 1;
        inner = message(value);
        return `outer ${reads}`;
      },
    };
    expect(message(value)).toBe("");
    expect(inner).toBe("");
    expect(message(value)).toBe("");
    expect(reads).toBe(1);
  });

  /**
   * An array is an object to §7, though `kind` names it apart, so it gets the
   * guarded read rather than the rendering, and no element's `toString` runs.
   */
  test("a thrown array gets the guarded read, so no element's `toString` runs", async () => {
    const { message, stack } = await accessors();
    let stringified = 0;
    const poisoned = [{ toString(): string { stringified += 1; throw new Error("hostile"); } }];
    expect(message(poisoned)).toBe("");
    expect(stack(poisoned).tag).toBe("None");
    expect(message(Object.assign([1, 2], { message: "an array's" }))).toBe("an array's");
    expect(stack(Object.assign([1, 2], { stack: "an array's trace" })).value).toBe("an array's trace");
    expect(stringified).toBe(0);
  });

  test("the value's own `toString` is never invoked", async () => {
    const { message, stack } = await accessors();
    let stringified = 0;
    const poisoned = {
      message: "honest",
      toString(): string {
        stringified += 1;
        throw new Error("toString was called");
      },
    };
    expect(message(poisoned)).toBe("honest");
    expect(stack(poisoned).tag).toBe("None");
    expect(stringified).toBe(0);
  });

  test("`stack` answers `Some` only for a string read", async () => {
    const { stack } = await accessors();
    const traced = stack(new Error("with a trace"));
    expect(traced.tag).toBe("Some");
    expect(typeof traced.value).toBe("string");
    expect(stack({}).tag).toBe("None");
    expect(stack({ stack: 42 }).tag).toBe("None");
    expect(stack({ get stack(): string { throw new Error("hostile"); } }).tag).toBe("None");
  });

  /**
   * **Both accessors are `->`** (§7): the read is kept, so it is a value, and
   * the guard swallows what it throws, so a call cannot fail. A call is bare,
   * a pure face holds either, and every mark is refused with the fix that
   * removes it.
   */
  test("each is pure and cannot fail, so a call is bare", () => {
    expect(projectDiagnostics("module Main\n\n" +
        "export let m(v: JsValue): String = JsError.message~(v)\n" +
        "export let s(v: JsValue): Option(String) = JsError.stack!(v)\n" +
        "export let r(v: JsValue): Option(String) = JsError.message?(v)\n",
    )).toEqual([
      "this call is pure, so `message` wants no mark, not `~`",
      "this call is pure and cannot fail, so `stack` wants no mark, not `!`",
      "this call cannot fail, so `message` wants no `?`",
    ]);
    expect(projectDiagnostics("module Main\n\n" +
        "export let m: (JsValue) -> String = JsError.message\n" +
        "export let s: (JsValue) -> Option(String) = JsError.stack\n" +
        "export let handled(v: JsValue): String =\n" +
        "    try\n" +
        "        JsError.message(v)\n" +
        "    catch\n" +
        "        _ => \"never\"\n",
    )).toEqual(["this arm can never run: nothing in this `try` may fail — a fault passes `_`; to catch one, name it or write `fault e`"]);
  });
});

describe("`attempt` bridges back to data (§8.2)", () => {
  const attemptSource = "module Main\n\n" + externThrower +
    "exception Boom(message: String)\n" +
    "let pure(): Int = 7\n" +
    "let domestic(n: Int): Int = if n > 0 then throw^(Boom(\"declared\")) else 7\n";

  test("`Ok` on return, `Err` on a declared throw, `Err` on a foreign one", async () => {
    const exports = await run(
      externThrower +
        "exception Boom(message: String)\n" +
        "let domestic(n: Int): Int = if n > 0 then throw^(Boom(\"declared\")) else 7\n" +
        "let classify(thrown: Exn): String =\n" +
        "    try\n" +
        "        throw^(thrown)\n" +
        "    catch\n" +
        "        Boom(m) => \"domestic \" ++ m\n" +
        "        JsError(e) => \"foreign \" ++ JsError.message(e)\n" +
        "export let ok(ignored: Int): String =\n" +
        "    match attempt domestic^(0)\n" +
        "        Ok(value) => \"ok \" ++ Int.show(value)\n" +
        "        Err(thrown) => classify^(thrown)\n" +
        "export let declared(ignored: Int): String =\n" +
        "    match attempt domestic^(1)\n" +
        "        Ok(value) => \"ok \" ++ Int.show(value)\n" +
        "        Err(thrown) => classify^(thrown)\n" +
        "export let foreign(ignored: Int): String =\n" +
        "    match attempt reading!()\n" +
        "        Ok(value) => \"ok \" ++ Int.show(value)\n" +
        "        Err(thrown) => classify^(thrown)\n",
      thrower,
    );
    expect((exports["ok"] as (i: number) => string)(0)).toBe("ok 7");
    expect((exports["declared"] as (i: number) => string)(0)).toBe("domestic declared");
    expect((exports["foreign"] as (i: number) => string)(0)).toBe("foreign from JavaScript");
  });

  test("it handles its body's failure: the world passes through, and the calls keep their marks", () => {
    // Over a body that may fail and is pure, `attempt` is pure and cannot fail.
    expect(projectDiagnostics(
      attemptSource +
        "export let bare(ignored: Int): Result(Int, Exn) = attempt domestic^(1)\n",
    )).toEqual([]);
    // Over a foreign call that is impure, the world passes through; the call
    // inside keeps its `!`, and the bare spelling is refused.
    expect(projectDiagnostics(
      attemptSource +
        "export let marked(ignored: Int): Result(Int, Exn) = attempt reading!()\n",
    )).toEqual([]);
    expect(projectDiagnostics(
      attemptSource +
        "export let unmarked(ignored: Int): Result(Int, Exn) = attempt reading()\n",
    )).not.toEqual([]);
    // Over a body that cannot fail, there is nothing to catch.
    expect(projectDiagnostics(
      attemptSource +
        "export let overmarked(ignored: Int): Result(Int, Exn) = attempt pure()\n",
    )).toEqual(["nothing here may fail, so `attempt` has nothing to catch"]);
  });

  /**
   * §7.5's sentence, unabridged: `Exn` where it appears in an exported signature
   * "is `Error` in the `.d.ts`". And `attempt`'s `Err` side is where that stops
   * being a formality — the door means it really does carry `null`, `"oops"` and
   * `Symbol`s, so the brand intersection this rendered before #509 promised a
   * consumer two fields that are frequently absent. §7.5 weighed the smaller lie
   * ("every TS `catch` clause tells" it) and took it; the wider face was the
   * bigger one.
   */
  test("`Exn` at the boundary is `Error`, flat (§7.5)", () => {
    const text = declarationsOf(
      "exception Boom\nlet boom(): Int = throw^(Boom)\n" +
        "export let attempted(ignored: Int): Result(Int, Exn) = attempt boom^()\n",
      "/main.hex",
    );
    expect(text).toContain("Result<number, Error>");
    expect(text).not.toContain("readonly $hex: string");
  });
});

/**
 * What the door costs the **bare** namespace (Modules §5.5), recorded rather
 * than hidden — the ledger convention `js-value-decoding.test.ts` keeps for
 * #511's slice.
 *
 * Three new bare occupations, every one of them single-homed today: no other
 * prelude member exports any of these names, so each bare spelling resolves and
 * none of them changes the meaning of an existing program. One is ordinary —
 * the constructor `JsError` — and two are the most user-collision-
 * prone words this train mints: `message` and `stack`, which are also the two
 * `spec/exceptions.md` §2 reserves as exception *slot* names, for the same
 * reason they are common. That reservation and this occupation are different
 * namespaces and do not interact; a program that wants its own `message` or
 * `stack` function declares one and occludes the prelude's, which is the last
 * test below.
 *
 * This pins current behaviour, not a settled design. Whether a prelude module
 * may be qualified-only for *functions* — the way `spec/ffi.md` §12 made
 * `JsKind`'s constructors qualified-only — is the open question #742 holds, and
 * nothing here anticipates an answer.
 */
describe("the bare namespace the door occupies (Modules §5.5)", () => {
  test("all three new bare names are single-homed, so each spelling resolves", () => {
    expect(projectDiagnostics("module Main\n\n" + "export let m(v: JsValue): String = JsError.message(v)\n" +
        "export let s(v: JsValue): Option(String) = JsError.stack(v)\n" +
        "export let e(v: JsValue): Exn = JsError(v)\n",
    )).toEqual([]);
    // Since #742 only the exception constructor is bare, and it is bare as a
    // category (§5.5); the two function spellings name their one home each.
    expect(projectDiagnostics("module Main\n\n" + "export let m(v: JsValue): String = message(v)\n",
    )).toEqual(["no bare `message`; write `JsError.message(v)`"]);
  });

  test("the qualified spellings the specs write resolve to the same declarations", () => {
    expect(projectDiagnostics("module Main\n\n" + "export let m(v: JsValue): String = JsError.message(v)\n" +
        "export let s(v: JsValue): Option(String) = JsError.stack(v)\n",
    )).toEqual([]);
  });

  /**
   * `JsError` is a module name and an exception constructor at once, and the
   * dotted spelling is the module's (Exceptions §7.6: a payload constructor's
   * dotted form resolves as Modules §5.1's module namespace, never as a property
   * of the constructor). Pinned because the constructor is also in scope at that
   * word, so the two readings are genuinely available and only one is right.
   */
  test("`JsError.message` is the module's export, not a property of the constructor", () => {
    const text = mainJavascript("export let m(v: JsValue): String = JsError.message(v)\n");
    expect(text).toContain('import { message } from "./Hex/JsError.js";');
    expect(text).toContain("const m = v => message(v);");
    expect(text).not.toContain("JsError.message");
  });

  /** And every one of them is occludable, like any prelude name (Modules §5.4). */
  test("a module's own declaration occludes each of them", () => {
    expect(projectDiagnostics("module Main\n\n" + "let message(subject: String): String = subject\n" +
        "let stack(depth: Int): Int = depth\n" +
        "export let used(subject: String, depth: Int): String =\n" +
        "    message(subject) ++ Int.show(stack(depth))\n",
    )).toEqual([]);
  });
});

describe("emission and the guard the door does not ship (§7.4, §7.6)", () => {
  /** A program that reaches `JsError.hex`, so the module is in the emitted graph. */
  const DOOR_USER = "export let describe(value: JsValue): String = JsError.message(value)\n";

  test("stage 1 is written out exactly when a `JsError` arm is present", () => {
    const withDoor = mainJavascript(
      "exception Boom(message: String)\n" +
        "export let run(n: Int): String =\n" +
        "    try\n" +
        "        if n == 99 then throw^(Boom(\"never\")) else Int.show(n)\n" +
        "    catch\n" +
        "        Boom(m) => m\n" +
        "        JsError(e) => JsError.message(e)\n",
    );
    expect(withDoor).toContain(
      'const __foreign = __error == null || typeof __error.$hex !== "string";',
    );
    expect(withDoor).toContain(
      'if (__foreign || (__error != null && __error.$hex === "Hex.JsError" ' +
        '&& __error.name === "JsError")) {',
    );
    expect(withDoor).toContain("const e = __foreign ? __error : __error.error;");

    const withoutDoor = mainJavascript(
      "exception Boom(message: String)\n" +
        "export let run(n: Int): String =\n" +
        "    try\n" +
        "        if n == 99 then throw^(Boom(\"never\")) else Int.show(n)\n" +
        "    catch\n" +
        "        Boom(m) => m\n",
    );
    expect(withoutDoor).not.toContain("__foreign");
    expect(withoutDoor).toContain(
      'if (__error != null && __error.$hex === "Main" && __error.name === "Boom") {',
    );
  });

  test("the match catch clause gets the same stage-1 binding, inside its own `catch`", () => {
    const text = mainJavascript(
      "let step(n: Int): Int = n + 1\n" +
        "export let run(n: Int): String =\n" +
        "    match step(n)\n" +
        "        0 => \"zero\"\n" +
        "        _ => \"other\"\n" +
        "    catch\n" +
        "        JsError(e) => JsError.message(e)\n",
    );
    const tryBlock = text.slice(text.indexOf("try {"), text.indexOf("} catch ("));
    expect(tryBlock).not.toContain("__foreign");
    expect(text).toContain(
      'const __foreign = __error == null || typeof __error.$hex !== "string";',
    );
  });

  test("`JsError` ships no `is` guard, in JavaScript or in the `.d.ts`", () => {
    const project = compileFiles([["/main.hex", "module Main\n\n" + DOOR_USER]]);
    expect(project.diagnostics).toEqual([]);
    const door = project.modules.find(({ source }) => source.path === "/Hex/JsError.hex")!;
    expect(door.javascript.text).not.toContain("JsError.is =");
    const declarations = door.declarations?.text ?? "";
    expect(declarations).not.toContain("declare namespace JsError");
    // The type and the constructor still ship — §6.2's residue is a real value.
    expect(declarations).toContain(
      'export type JsError = Error & { readonly $hex: "Hex.JsError"; ' +
        'readonly name: "JsError"; readonly error: unknown };',
    );
    expect(declarations).toContain("export declare function JsError(error: unknown): JsError;");
    // And the module participates in `isHexError` like any exception-exporting one.
    expect(door.javascript.text).toContain(
      'export const isHexError = (__error) => __error != null && ' +
        'typeof __error.$hex === "string";',
    );
    expect(declarations).toContain("export declare function isHexError(");
  });

  test("the guarded read is one property access inside one `try`, kept beside the value", () => {
    const project = compileFiles([["/main.hex", "module Main\n\n" + DOOR_USER]]);
    const door = project.modules.find(({ source }) => source.path === "/Hex/JsError.hex")!;
    expect(door.javascript.text).toContain(
      [
        "const __jsErrorRead = (() => {",
        "  const __kept = new WeakMap();",
        "  const __pending = {};",
        "  return (__value, __property) => {",
        "    let __answers = __kept.get(__value);",
        "    if (__answers === undefined) {",
        "      __answers = new Map();",
        "      __kept.set(__value, __answers);",
        "    }",
        "    if (!__answers.has(__property)) {",
        "      __answers.set(__property, __pending);",
        "      let __read;",
        "      try {",
        "        __read = __value[__property];",
        "      } catch {",
        "        __read = undefined;",
        "      }",
        "      if (__answers.get(__property) === __pending) __answers.set(__property, __read);",
        "    } else if (__answers.get(__property) === __pending) {",
        "      __answers.set(__property, undefined);",
        "    }",
        "    return __answers.get(__property);",
        "  };",
        "})();",
      ].join("\n"),
    );
    expect(door.javascript.text).toContain(
      'const readMessage = __a => __jsErrorRead(__a, "message");',
    );
    expect(door.javascript.text).toContain(
      'const readStack = __a => __jsErrorRead(__a, "stack");',
    );
    expect(door.javascript.text).toContain("const render = __a => String(__a);");
  });
});
