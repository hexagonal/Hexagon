import { describe, expect, test } from "vitest";

import { compileMain, projectDiagnostics, runMain, runProject } from "../support/test-project.js";

/**
 * Conformance for **the fault kind** (Exceptions §1, §2, §5.2, §5.3, §7.1): the
 * second of the three kinds of throw, and the one nothing tracks.
 *
 * - **Declarations.** `fault` is a second head word over `exception`'s grammar.
 *   A fault's name ends in `Fault`, and only a fault's does, so the kind shows
 *   wherever the name does; each misnamed declaration is refused with a rename
 *   offered (`Diagnostic.renameRepair`), and an `exception` named `…Fault` also
 *   with the other head word.
 * - **Catching.** A catch-all, `_` or a bare binder, catches every exception
 *   and every foreign throw and lets every fault through; `fault e` catches
 *   every fault. The pair catches everything. Measured at run time, because
 *   "lets through" is a claim about what reaches the caller.
 * - **Reachability by kind.** The kinds partition `Exn`, so the arms are judged
 *   in two columns that never meet.
 * - **`fault e` is a whole catch arm's pattern**, refused everywhere else.
 */

/** A source with the module header. */
function main(...lines: readonly string[]): string {
  return "module Main\n\n" + lines.join("\n") + "\n";
}

/** What a call threw, or `undefined` where it returned. */
function thrownBy(call: () => unknown): unknown {
  try {
    call();
  } catch (error) {
    return error;
  }
  return undefined;
}

describe("`fault` declarations (§2)", () => {
  test("a fault declares as an exception does, payload and all", async () => {
    const exports = await runMain(main(
      "fault InvariantFault(message: String)",
      "export fun broken(): Int = throw(InvariantFault(\"no\"))",
    ));
    const error = thrownBy(() => (exports["broken"] as () => number)()) as Error & Record<string, unknown>;
    expect(error).toBeInstanceOf(Error);
    expect(error).toMatchObject({ name: "InvariantFault", $hex: "Main", message: "no" });
  });

  test("a fault's name ends in `Fault`: refused with the rename offered", () => {
    const { diagnostics } = compileMain(main("fault Invariant(message: String)"));
    expect(diagnostics.map(({ message, renameRepair, fixes }) => ({ message, renameRepair, fixes })))
      .toEqual([{
        message: "a fault's name ends in `Fault` — rename it `InvariantFault`",
        renameRepair: { newName: "InvariantFault" },
        fixes: undefined,
      }]);
  });

  test("an `…Error` name is offered the `…Fault` one, not a doubled ending", () => {
    expect(compileMain(main("fault InvariantError")).diagnostics.map(({ renameRepair }) => renameRepair))
      .toEqual([{ newName: "InvariantFault" }]);
  });

  test("a name that is only the word keeps it in the offer", () => {
    expect(compileMain(main("fault Error")).diagnostics.map(({ renameRepair }) => renameRepair))
      .toEqual([{ newName: "ErrorFault" }]);
    expect(compileMain(main("exception Fault")).diagnostics.map(({ renameRepair }) => renameRepair))
      .toEqual([{ newName: "FaultError" }]);
  });

  test("only a fault's name ends in `Fault`: both repairs offered", () => {
    const source = main("exception TimeoutFault(millis: Int)");
    const [diagnostic, ...rest] = compileMain(source).diagnostics;
    expect(rest).toEqual([]);
    expect(diagnostic!.message).toBe(
      "only a fault's name ends in `Fault`; this is an exception — rename it, or declare it with `fault`",
    );
    expect(diagnostic!.renameRepair).toEqual({ newName: "TimeoutError" });
    expect(diagnostic!.fixes?.map(({ message, edits }) => ({
      message,
      edits: edits.map(({ span, replacement }) => ({
        written: source.slice(span.start.offset, span.end.offset),
        replacement,
      })),
    }))).toEqual([{
      message: "declare it with `fault`",
      edits: [{ written: "exception", replacement: "fault" }],
    }]);
  });

  test("a misnamed declaration still declares: its uses resolve, one report stands", () => {
    expect(projectDiagnostics(main(
      "fault Broken",
      "export fun f(): Int =",
      "    try",
      "        throw(Broken)",
      "    catch",
      "        Broken => 1",
    ))).toEqual(["a fault's name ends in `Fault` — rename it `BrokenFault`"]);
  });

  test("declared at module level only", () => {
    expect(projectDiagnostics(main(
      "export fun f(): Int =",
      "    fault LocalFault",
      "    1",
    ))).toContain("exceptions and faults are declared at module level");
  });

  test("`export fault` crosses; `opaque fault` is refused as `opaque exception` is", () => {
    expect(projectDiagnostics(main("export fault SharedFault"))).toEqual([]);
    expect(projectDiagnostics(main("opaque fault HiddenFault")))
      .toEqual(["`opaque` applies to `record` and `union` declarations"]);
  });

  test("`fault` is contextual: still a name wherever a name may stand", async () => {
    const exports = await runMain(main(
      "let fault: Int = 2",
      "fun twice(fault: Int): Int = fault * 2",
      "export let r: Int = twice(fault)",
    ));
    expect(exports["r"]).toBe(4);
  });
});

describe("a catch-all lets faults through (§5.3)", () => {
  const guarded = (arms: readonly string[]): string => main(
    "exception ParseError(line: Int)",
    "let v: Vector(Int) = [1, 2]",
    "export fun probe(which: Int): Int =",
    "    try",
    "        if which == 0 then v[9] else throw(ParseError(which))",
    "    catch",
    ...arms.map((arm) => `        ${arm}`),
  );

  test("`_` catches an exception and lets a fault reach the caller", async () => {
    const exports = await runMain(guarded(["_ => -1"]));
    const probe = exports["probe"] as (which: number) => number;
    expect(probe(3)).toBe(-1);
    expect(thrownBy(() => probe(0))).toMatchObject({ name: "IndexFault", $hex: "Hex.Vector" });
  });

  test("a bare binder is a catch-all too", async () => {
    const exports = await runMain(guarded(["e => -1"]));
    const probe = exports["probe"] as (which: number) => number;
    expect(probe(3)).toBe(-1);
    expect(thrownBy(() => probe(0))).toMatchObject({ name: "IndexFault" });
  });

  test("a fault's arm below `_` is reachable, and catches it", async () => {
    const exports = await runMain(guarded(["_ => -1", "IndexFault(i, n) => i * 10 + n"]));
    const probe = exports["probe"] as (which: number) => number;
    expect(probe(0)).toBe(92);
    expect(probe(3)).toBe(-1);
  });

  test("`fault e` catches every fault, binding it; beside `_` the pair catches everything", async () => {
    const exports = await runMain(guarded(["fault e => -2", "_ => -1"]));
    const probe = exports["probe"] as (which: number) => number;
    expect(probe(0)).toBe(-2);
    expect(probe(3)).toBe(-1);
  });

  test("`fault e` lets exceptions through", async () => {
    const exports = await runMain(guarded(["fault _ => -2"]));
    const probe = exports["probe"] as (which: number) => number;
    expect(probe(0)).toBe(-2);
    expect(thrownBy(() => probe(3))).toMatchObject({ name: "ParseError", line: 3 });
  });

  test("`fault e` takes a guard; a failed guard falls through", async () => {
    const exports = await runMain(guarded([
      "fault e when False => -3",
      "fault _ => -2",
    ]));
    expect((exports["probe"] as (which: number) => number)(0)).toBe(-2);
  });

  test("beside a `JsError` arm that does not take it, `_` catches every foreign throw, `…Fault`-named or none", async () => {
    const exports = await runMain(main(
      "export fun probe(k: () ->! Int): Int =",
      "    try",
      "        k!()",
      "    catch",
      "        JsError(_) when False => 1",
      "        _ => 2",
      "        fault _ => 3",
    ));
    const probe = exports["probe"] as (k: () => number) => number;
    expect(probe(() => {
      throw "oops";
    })).toBe(2);
    expect(probe(() => {
      throw null;
    })).toBe(2);
    expect(probe(() => {
      const error = new Error("named like one");
      error.name = "BoomFault";
      throw error;
    })).toBe(2);
  });

  test("a branded object with no string `name` cannot make the discriminator throw", async () => {
    const exports = await runMain(main(
      "export fun loose(k: () ->! Int): Int =",
      "    try",
      "        k!()",
      "    catch",
      "        _ => 2",
      "export fun strict(k: () ->! Int): Int =",
      "    try",
      "        k!()",
      "    catch",
      "        fault _ => 3",
    ));
    const spoof = { $hex: "Elsewhere" };
    expect((exports["loose"] as (k: () => number) => number)(() => {
      throw spoof;
    })).toBe(2);
    expect(thrownBy(() => (exports["strict"] as (k: () => number) => number)(() => {
      throw spoof;
    }))).toBe(spoof);
  });

  test("a foreign throw is no fault: `_` catches it, `fault e` does not", async () => {
    const exports = await runMain(main(
      "export fun loose(k: () ->! Int): Int =",
      "    try",
      "        k!()",
      "    catch",
      "        _ => -1",
      "export fun strict(k: () ->! Int): Int =",
      "    try",
      "        k!()",
      "    catch",
      "        fault _ => -2",
    ));
    // Named as a fault would be, and still foreign: no brand.
    const hostile = (): number => {
      const error = new Error("from JavaScript");
      error.name = "LooksLikeAFault";
      throw error;
    };
    expect((exports["loose"] as (k: () => number) => number)(hostile)).toBe(-1);
    expect(thrownBy(() => (exports["strict"] as (k: () => number) => number)(hostile)))
      .toMatchObject({ name: "LooksLikeAFault", message: "from JavaScript" });
  });

  test("the match catch clause reads the same kinds", async () => {
    const exports = await runMain(main(
      "let v: Vector(Int) = [1, 2]",
      "export fun probe(): Int =",
      "    match v[9]",
      "        n => n",
      "    catch",
      "        _ => -1",
      "export fun caught(): Int =",
      "    match v[9]",
      "        n => n",
      "    catch",
      "        fault _ => -2",
    ));
    expect(thrownBy(() => (exports["probe"] as () => number)()))
      .toMatchObject({ name: "IndexFault" });
    expect((exports["caught"] as () => number)()).toBe(-2);
  });

  test("an imported nullary throwable's reference constructs, bare, qualified and aliased (#371)", async () => {
    const exports = await runProject([
      ["/checks.hex", "module Checks\n\nexport fault NoneFault\nexport exception Gone\n"],
      ["/main.hex", main(
        "import Checks",
        "import Checks as C",
        "export let aliased: Exn = C.NoneFault",
        "export let qualified: Exn = Checks.Gone",
        "export fun probe(): Int =",
        "    try",
        "        throw(C.NoneFault)",
        "    catch",
        "        C.NoneFault => 1",
      )],
    ]);
    expect(exports["aliased"]).toBeInstanceOf(Error);
    expect(exports["aliased"]).toMatchObject({ name: "NoneFault", $hex: "Checks" });
    expect(exports["qualified"]).toMatchObject({ name: "Gone", $hex: "Checks" });
    expect((exports["probe"] as () => number)()).toBe(1);
  });

  test("a fault from another module is caught by `fault e`, by the name's ending", async () => {
    const exports = await runProject([
      ["/checks.hex", "module Checks\n\nexport fault BrokenFault(code: Int)\n" +
        "export fun check(n: Int): Int = if n < 0 then throw(BrokenFault(n)) else n\n"],
      ["/main.hex", main(
        "import Checks",
        "export fun probe(n: Int): Int =",
        "    try",
        "        Checks.check(n)",
        "    catch",
        "        _ => -1",
        "        fault _ => -2",
      )],
    ]);
    expect((exports["probe"] as (n: number) => number)(-5)).toBe(-2);
    expect((exports["probe"] as (n: number) => number)(5)).toBe(5);
  });
});

describe("reachability by kind (§5.3)", () => {
  const arms = (...written: readonly string[]): readonly string[] => projectDiagnostics(main(
    "exception ParseError(line: Int)",
    "exception NotFoundError",
    "export fun probe(v: Vector(Int)): Int =",
    "    try",
    "        v[0]",
    "    catch",
    ...written.map((arm) => `        ${arm}`),
  ));

  test("an exception's arm below `_` is unreachable, naming the catch-all", () => {
    expect(arms("e => 0", "ParseError(_) => 1"))
      .toEqual(["this catch arm is unreachable; the arm `e` above catches every exception"]);
  });

  test("a `JsError` arm below `_` is unreachable: `JsError` is an exception", () => {
    expect(arms("_ => 0", "JsError(_) => 1"))
      .toEqual(["this catch arm is unreachable; the arm `_` above catches every exception"]);
  });

  test("a fault's arm below `fault e` is unreachable, naming it", () => {
    expect(arms("fault e => 0", "IndexFault(_, _) => 1"))
      .toEqual(["this catch arm is unreachable; the arm `fault e` above catches every fault"]);
  });

  test("`_` and `fault e` never shadow each other, in either order", () => {
    expect(arms("_ => 0", "fault _ => 1")).toEqual([]);
    expect(arms("fault _ => 1", "_ => 0")).toEqual([]);
  });

  test("a fault's arm below `_`, and an exception's below `fault e`, are reachable", () => {
    expect(arms("_ => 0", "IndexFault(_, _) => 1", "DivideByZeroFault(_) => 2")).toEqual([]);
    expect(arms("fault _ => 0", "ParseError(_) => 1", "NotFoundError => 2")).toEqual([]);
  });

  test("a second catch-all of a kind is unreachable", () => {
    expect(arms("fault _ => 0", "fault e => 1"))
      .toEqual(["this catch arm is unreachable; the arm `fault _` above catches every fault"]);
  });

  test("a fault caught twice is named as a fault", () => {
    expect(arms("KeyFault => 0", "KeyFault => 1")).toEqual(["fault `KeyFault` is already caught above"]);
    expect(arms("NotFoundError => 0", "NotFoundError => 1"))
      .toEqual(["exception `NotFoundError` is already caught above"]);
  });

  test("an or-pattern across kinds: only the shadowed alternative is reported", () => {
    const source = main(
      "exception ParseError(line: Int)",
      "export fun probe(v: Vector(Int)): Int =",
      "    try",
      "        v[0]",
      "    catch",
      "        _ => 0",
      "        IndexFault(_, _) | ParseError(_) => 1",
    );
    const diagnostics = compileMain(source).diagnostics;
    expect(diagnostics.map(({ message }) => message))
      .toEqual(["this alternative is unreachable; the arm `_` above catches every exception"]);
    const { start, end } = diagnostics[0]!.primary;
    expect(source.slice(start.offset, end.offset)).toBe("ParseError(_)");
  });

  test("an or-pattern dead in both columns is one report, as the arm, naming both catch-alls", () => {
    expect(arms("_ => 0", "fault _ => 1", "ParseError(_) | IndexFault(_, _) => 2")).toEqual([
      "this catch arm is unreachable; the arms `_` and `fault _` above catch every exception and every fault",
    ]);
    expect(arms("fault _ => 1", "_ => 0", "IndexFault(_, _) | ParseError(_) => 2")).toEqual([
      "this catch arm is unreachable; the arms `_` and `fault _` above catch every exception and every fault",
    ]);
  });

  test("an alternative covered by a constructor above is named as an alternative", () => {
    expect(arms("ParseError(_) => 0", "ParseError(_) | IndexFault(_, _) => 1"))
      .toEqual(["exception `ParseError` is already caught above"]);
    expect(arms("ParseError(1) => 0", "ParseError(2) => 0", "ParseError(1) | ParseError(2) | KeyFault => 1"))
      .toEqual([
        "this alternative is unreachable; the arms above already cover it",
        "this alternative is unreachable; the arms above already cover it",
      ]);
  });

  test("a whole arm dead by the constructors above is reported as the arm", () => {
    expect(arms("ParseError(1) => 0", "ParseError(1) => 1"))
      .toEqual(["this catch arm is unreachable; the arms above already cover it"]);
    expect(arms("NotFoundError => 0", "ParseError(_) => 1", "ParseError(_) | NotFoundError => 2"))
      .toEqual(["this catch arm is unreachable; the arms above already cover it"]);
  });

  test("a refused `fault` pattern is judged in neither column", () => {
    expect(arms("_ | fault x => 0")).toEqual(["a `fault` pattern is a whole catch arm's pattern"]);
  });

  test("a guarded catch-all shadows nothing", () => {
    expect(arms("fault e when False => 0", "IndexFault(_, _) => 1")).toEqual([]);
  });
});

describe("`fault e` is a whole catch arm's pattern (§5.2)", () => {
  const refused = "a `fault` pattern is a whole catch arm's pattern";
  const catching = (arm: string): readonly string[] => projectDiagnostics(main(
    "exception Wrapped(inner: Exn)",
    "export fun probe(v: Vector(Int)): Int =",
    "    try",
    "        v[0]",
    "    catch",
    `        ${arm}`,
  ));

  test("in an or-pattern", () => {
    expect(catching("fault _ | Wrapped(_) => 0")).toEqual([refused]);
  });

  test("under `as`", () => {
    expect(catching("fault e as whole => 0")).toEqual([refused]);
  });

  test("nested in another pattern", () => {
    expect(catching("Wrapped(fault e) => 0")).toEqual([refused]);
  });

  test("in a `match` data arm", () => {
    expect(projectDiagnostics(main(
      "export fun f(n: Int): Int =",
      "    match n",
      "        fault e => 0",
    ))).toContain(refused);
  });

  test("at a `let` head", () => {
    expect(projectDiagnostics(main(
      "export fun f(e: Exn): Int =",
      "    let fault x = e",
      "    1",
    ))).toEqual([refused]);
  });

  test("`fault` before a constructor is refused with the repair that removes it; the arm still catches", async () => {
    const source = main(
      "fault MyFault(code: Int)",
      "export fun probe(): Int =",
      "    try",
      "        throw(MyFault(4))",
      "    catch",
      "        fault MyFault(c) => c",
    );
    const diagnostics = compileMain(source).diagnostics;
    expect(diagnostics.map(({ message }) => message)).toEqual([
      "a `fault` pattern is `fault` and a name or `_`, catching every fault; " +
      "to catch `MyFault` alone, write its pattern without `fault`",
    ]);
    expect(diagnostics[0]!.fixes?.map(({ message, edits }) => ({
      message,
      edits: edits.map(({ span, replacement }) => ({
        written: source.slice(span.start.offset, span.end.offset),
        replacement,
      })),
    }))).toEqual([{ message: "remove `fault`", edits: [{ written: "fault ", replacement: "" }] }]);
    const { span, replacement } = diagnostics[0]!.fixes![0]!.edits[0]!;
    const repaired = source.slice(0, span.start.offset) + replacement + source.slice(span.end.offset);
    expect(repaired).toContain("        MyFault(c) => c");
    expect((await runMain(repaired))["probe"] as () => number).toBeDefined();
    expect(((await runMain(repaired))["probe"] as () => number)()).toBe(4);
  });

  test("the redirect spells a qualified constructor whole, and reads a group too", () => {
    expect(catching("fault Vector.IndexFault(i, _) => i")).toEqual([
      "a `fault` pattern is `fault` and a name or `_`, catching every fault; " +
      "to catch `Vector.IndexFault` alone, write its pattern without `fault`",
    ]);
    for (const arm of ["fault (Wrapped(_)) => 0", "fault(Wrapped(_)) => 0"]) {
      expect(catching(arm)).toEqual([
        "a `fault` pattern is `fault` and a name or `_`, catching every fault; " +
        "to catch what this pattern names, write it without `fault`",
      ]);
    }
  });

  test("`fault` before a group is a slip only where a pattern is read: a call and a function stay", async () => {
    const called = await runMain(main(
      "fun fault(x: Int): Int = x + 1",
      "export fun f(): Int = fault(1) + fault (2)",
    ));
    expect((called["f"] as () => number)()).toBe(5);
    const local = await runMain(main(
      "export fun f(): Int =",
      "    let fault(y: Int): Int = y * 2",
      "    fault(3)",
    ));
    expect((local["f"] as () => number)()).toBe(6);
  });

  test("outside a catch arm, `fault` before a constructor takes §5.2's sentence, with the same repair", () => {
    const source = main(
      "export fun f(o: Option(Int)): Int =",
      "    match o",
      "        fault Some(x) => x",
      "        None => 0",
    );
    const diagnostics = compileMain(source).diagnostics;
    expect(diagnostics.map(({ message }) => message)).toEqual([refused]);
    expect(diagnostics[0]!.fixes?.map(({ message }) => message)).toEqual(["remove `fault`"]);
    expect(projectDiagnostics(main(
      "export fun f(o: Option(Int)): Int =",
      "    let fault Some(x) = o",
      "    x",
    ))).toEqual([refused, "this pattern can fail: `None`; use `match`"]);
  });

  test("`fault as e` and `fault when g` bind a variable named `fault`", async () => {
    expect(catching("fault as whole => 0")).toEqual([]);
    expect(catching("fault when True => 0")).toEqual([]);
  });
});

describe("a `match` on an `Exn` scrutinee", () => {
  test("is refused once, at the scrutinee; its throwable arms add nothing", () => {
    expect(projectDiagnostics(main(
      "export fun f(e: Exn): Int =",
      "    match e",
      "        IndexFault(_, _) => 1",
      "        _ => 2",
    ))).toEqual(["match requires a closed type; exceptions are inspected with `try`/`catch`"]);
  });
});

describe("the runtime kind is the name's ending (§7.1, §7.6)", () => {
  test("a prelude fault's name ends in `Fault`, and no field says so", async () => {
    const exports = await runMain(main("let v: Vector(Int) = [1, 2]", "export fun at(n: Int): Int = v[n]"));
    const error = thrownBy(() => (exports["at"] as (n: number) => number)(4)) as Record<string, unknown>;
    expect(error["name"]).toBe("IndexFault");
    expect(Object.keys(error).sort()).toEqual(["$hex", "index", "name", "size"]);
  });

  test("`Prelude`'s emitted module builds `AssumptionFault` alone, with no unused helper", () => {
    const prelude = compileMain(main("export let e: Exn = AssumptionFault(Map.KeyFault)")).modules
      .find(({ name }) => name === "Hex.Prelude")!;
    expect(prelude.javascript.text).toContain("{ cause: cause }");
    expect(prelude.javascript.text).not.toContain("__exception");
  });

  test("an exported fault ships `.is`, and `isHexError` answers for it", async () => {
    const exports = await runMain(main(
      "export fault BrokenFault(code: Int)",
      "export fun broken(): Int = throw(BrokenFault(7))",
    ));
    const error = thrownBy(() => (exports["broken"] as () => number)());
    expect((exports["BrokenFault"] as { is(value: unknown): boolean }).is(error)).toBe(true);
    expect((exports["isHexError"] as (value: unknown) => boolean)(error)).toBe(true);
  });
});

describe("`JsError` inside another throwable's payload reads its own value", () => {
  test("`Wrapped(JsError(e))` binds the raw foreign throwable the payload holds", async () => {
    const exports = await runMain(main(
      "exception Wrapped(inner: Exn)",
      "export fun wrap(k: () ->! Int): Int =",
      "    try",
      "        k!()",
      "    catch",
      "        e => throw(Wrapped(e))",
      "export fun probe(k: () ->! Int): String =",
      "    try",
      "        Int.show(wrap!(k))",
      "    catch",
      "        Wrapped(JsError(e)) => JsError.message!(e)",
      "        Wrapped(_) => \"domestic\"",
    ));
    const probe = exports["probe"] as (k: () => number) => string;
    expect(probe(() => {
      throw new TypeError("raw");
    })).toBe("raw");
  });
});

describe("a throwable's constructor is a pattern only in a catch arm (§3, #1204 (R))", () => {
  const atMatch = (scrutinee: string, arm: string): readonly string[] => projectDiagnostics(main(
    "exception Boom",
    "exception Bang(code: Int)",
    `export fun f(k: ${scrutinee}): Int =`,
    "    match k",
    `        ${arm} => 1`,
    "        _ => 2",
  ));
  const matchRefusal = "`Boom` is an exception's constructor, and a `match` never takes `Exn`; " +
    "exceptions are inspected with `try`/`catch`";

  test("at the top of a `match` arm, against any type", () => {
    expect(atMatch("Ordering", "Boom")).toEqual([matchRefusal]);
    expect(atMatch("Int", "Bang(n)")).toEqual([
      "`Bang` is an exception's constructor, and a `match` never takes `Exn`; " +
      "exceptions are inspected with `try`/`catch`",
    ]);
  });

  test("at any depth, `Exn` slots included", () => {
    expect(atMatch("(Ordering, Int)", "(Boom, _)")).toEqual([matchRefusal]);
    expect(atMatch("Option(Exn)", "Some(Boom)")).toEqual([matchRefusal]);
    expect(atMatch("Ordering", "Boom | Ordering.Less")).toEqual([matchRefusal]);
  });

  test("a prelude fault's constructor names its kind; `JsError`'s is refused too", () => {
    expect(atMatch("Option(Exn)", "Some(Map.KeyFault)")).toEqual([
      "`KeyFault` is a fault's constructor, and a `match` never takes `Exn`; " +
      "exceptions are inspected with `try`/`catch`",
    ]);
    expect(atMatch("Option(Exn)", "Some(JsError(_))")).toEqual([
      "`JsError` is an exception's constructor, and a `match` never takes `Exn`; " +
      "exceptions are inspected with `try`/`catch`",
    ]);
  });

  test("at a `let`, a `for` and a lambda parameter, the clause speaks of a pattern", () => {
    const refusal = "`Boom` is an exception's constructor, and a pattern never takes `Exn` apart; " +
      "exceptions are inspected with `try`/`catch`";
    expect(projectDiagnostics(main(
      "exception Boom",
      "export fun f(k: (Exn, Int)): Int =",
      "    let (Boom, n) = k",
      "    n",
    ))).toEqual([refusal]);
    expect(projectDiagnostics(main(
      "exception Boom",
      "export fun f(ks: Vector((Exn, Int))): Int =",
      "    var total = 0",
      "    for (Boom, n) in ks",
      "        total := total + n",
      "    total",
    ))).toEqual([refusal]);
    expect(projectDiagnostics(main(
      "exception Boom",
      "let f: ((Exn, Int)) -> Int = ((Boom, n)) => n",
    ))).toEqual([refusal]);
  });

  test("inside a catch arm, at any depth, a throwable's constructor is a pattern", async () => {
    const exports = await runMain(main(
      "exception ParseError(line: Int)",
      "exception Wrapped(inner: Exn)",
      "export fun probe(which: Int): Int =",
      "    try",
      "        if which == 0 then throw(Wrapped(ParseError(7))) else throw(Wrapped(Map.KeyFault))",
      "    catch",
      "        Wrapped(ParseError(line)) => line",
      "        Wrapped(KeyFault) => -1",
    ));
    expect((exports["probe"] as (which: number) => number)(0)).toBe(7);
    expect((exports["probe"] as (which: number) => number)(1)).toBe(-1);
  });

  test("a nested throwable pattern at a slot that is not `Exn` is a type error", () => {
    expect(projectDiagnostics(main(
      "exception Coded(code: Int)",
      "exception Boom",
      "export fun probe(): Int =",
      "    try",
      "        throw(Coded(1))",
      "    catch",
      "        Coded(Boom) => 1",
    ))).toEqual(["type mismatch: expected Int, found Exn"]);
  });
});

describe("`AssumptionFault`, the prelude's fault for a broken `assume` (§8.3)", () => {
  test("declared in `Prelude`: bare and qualified, branded `Hex.Prelude`, its cause `Error.cause`", async () => {
    const exports = await runMain(main(
      "exception ParseError(line: Int, message: String)",
      "export fun bare(): Int = throw(AssumptionFault(ParseError(3, \"unexpected token\")))",
      "export fun qualified(): Int = throw(Prelude.AssumptionFault(ParseError(4, \"eof\")))",
    ));
    const bare = thrownBy(() => (exports["bare"] as () => number)()) as Error & Record<string, unknown>;
    expect(bare).toBeInstanceOf(Error);
    expect(bare).toMatchObject({ name: "AssumptionFault", $hex: "Hex.Prelude", message: "unexpected token" });
    expect(bare.cause).toMatchObject({ name: "ParseError", $hex: "Main", line: 3 });
    // An own property, as `new Error(message, { cause })` makes it: like
    // `message`, not enumerable.
    expect(Object.hasOwn(bare, "cause")).toBe(true);
    expect(Object.keys(bare).sort()).toEqual(["$hex", "name"]);
    const qualified = thrownBy(() => (exports["qualified"] as () => number)()) as Error;
    expect(qualified).toMatchObject({ name: "AssumptionFault", message: "eof" });
  });

  test("a cause that is no `Error` gives an empty message; a hostile one cannot make it throw", async () => {
    const exports = await runMain(main(
      "export fun wrap(k: () ->! Int): Int =",
      "    try",
      "        k!()",
      "    catch",
      "        e => throw(AssumptionFault(e))",
    ));
    const wrap = exports["wrap"] as (k: () => number) => number;
    const plain = thrownBy(() => wrap(() => {
      throw "oops";
    })) as Error & { cause: unknown };
    expect(plain).toMatchObject({ name: "AssumptionFault", message: "" });
    expect(plain.cause).toBe("oops");
    const hostile = new Proxy({}, {
      getPrototypeOf() {
        throw new Error("hostile");
      },
    });
    const guarded = thrownBy(() => wrap(() => {
      throw hostile;
    })) as Error & { cause: unknown };
    expect(guarded).toMatchObject({ name: "AssumptionFault", message: "" });
    expect(guarded.cause).toBe(hostile);
  });

  test("a catch arm takes it apart, its cause a nested pattern; `_` lets it through", async () => {
    const exports = await runMain(main(
      "exception ParseError(line: Int)",
      "fun broken(which: Int): Int =",
      "    if which == 0 then throw(AssumptionFault(ParseError(7))) else throw(AssumptionFault(Map.KeyFault))",
      "export fun probe(which: Int): Int =",
      "    try",
      "        broken(which)",
      "    catch",
      "        AssumptionFault(ParseError(line)) => line",
      "        AssumptionFault(_) => -1",
      "export fun loose(which: Int): Int =",
      "    try",
      "        broken(which)",
      "    catch",
      "        _ => -2",
    ));
    expect((exports["probe"] as (which: number) => number)(0)).toBe(7);
    expect((exports["probe"] as (which: number) => number)(1)).toBe(-1);
    expect(thrownBy(() => (exports["loose"] as (which: number) => number)(0)))
      .toMatchObject({ name: "AssumptionFault" });
  });

  test("`AssumptionFault(JsError(e))` binds the raw foreign cause", async () => {
    const exports = await runMain(main(
      "export fun wrap(k: () ->! Int): Int =",
      "    try",
      "        k!()",
      "    catch",
      "        e => throw(AssumptionFault(e))",
      "export fun probe(k: () ->! Int): String =",
      "    try",
      "        Int.show(wrap!(k))",
      "    catch",
      "        AssumptionFault(JsError(e)) => JsError.message!(e)",
    ));
    expect((exports["probe"] as (k: () => number) => string)(() => {
      throw new RangeError("raw");
    })).toBe("raw");
  });
});
