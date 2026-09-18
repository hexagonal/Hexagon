import { describe, expect, test } from "vitest";

import { projectDiagnostics } from "../support/test-project.js";

/**
 * Conformance for **the capture walk's refused positions** — FFI Part 1 §5.4's
 * six items and the diagnostics checklist rows §9 gives five of them (#945,
 * part 1).
 *
 * §5.4 states one mechanism and one trigger. The trigger is **"names a captured
 * collection"**: "the least fixpoint over the declared type's constructor
 * graph", whose captured heads are `Array(a)`, `JsMap(k, v)` and `JsSet(a)`
 * (§2.2) and whose entered constructors are the aggregates — records, tuples,
 * unions, `Option`, `Nullable`, function types, and a nominal record or union
 * through its declared components, so that "a recursive record or union names
 * one iff some reachable component does". What the fixpoint does **not** enter
 * is as load-bearing as what it does: the five Hexagon runtime containers keep
 * their own category, which is exactly why item 1 exists as a refusal of its
 * own rather than falling out of the predicate. That shape is pinned here
 * directly — `Vector(Array(Int))` is refused by item 1's message and not by
 * item 4's, at a position where both would otherwise speak.
 *
 * The positions are §5.4's own table, less the ones that do not exist yet: an
 * extern `fun`'s parameters and result, an `extern let`'s value, an exported
 * Hexagon function's parameters and result, an exported value binding, and the
 * release seat `JsValue.from`. Part 5's receiver members (`get`/`method`/`set`/
 * `new`) are not in the language yet and are not pinned here; they inherit the
 * same seat when they arrive.
 *
 * **Nothing about emission is here.** This part ships the refusals only; the
 * copying wrappers of Part 4 §4.3, Part 6 §5.5 and Part 7 §7 occasion 4 are a
 * later part of #945, and no test here reads emitted text.
 */

/** `module Main` and a blank line, which every source the helper compiles owes. */
const MAIN = "module Main\n\n";

function diagnose(source: string): readonly string[] {
  return projectDiagnostics(MAIN + source);
}

/** Item 1's message, for a captured `type` under `container`. */
function beneath(captured: string, container: string): string {
  return `captured collection \`${captured}\` beneath \`${container}\` cannot cross the ` +
    "foreign boundary; convert the elements (`Vector.map(rows, Array.toVector)`), convert " +
    "at a controlled boundary, or bind through a foreign shim or an opaque foreign handle";
}

describe("item 1 — a captured collection beneath one of the five containers", () => {
  /**
   * The exact text, once. §9's row asks for the container and the captured type
   * and for three rewrites, and the Rewrite Rule (Declarations Preamble §1.1)
   * is what makes naming them non-optional.
   */
  test("the message names the container, the captured type, and three rewrites", () => {
    expect(diagnose('extern from "./m.js"\n    fun rows() ->! Vector(Array(Int))\n')).toEqual([
      "captured collection `Array(Int)` beneath `Vector` cannot cross the foreign boundary; " +
      "convert the elements (`Vector.map(rows, Array.toVector)`), convert at a controlled " +
      "boundary, or bind through a foreign shim or an opaque foreign handle",
    ]);
  });

  // "`Vector`, `Map`, `Set`, `Seq`, `Stream`, and exactly those." `Seq` and
  // `Stream` are refused on the stronger ground: their elements are produced
  // after the crossing frame has returned, so there is no frame the walk could
  // run in.
  test.each([
    ["Vector(Array(Int))", "Array(Int)", "Vector"],
    ["Map(String, JsSet(Int))", "JsSet(Int)", "Map"],
    ["Set(Array(Int))", "Array(Int)", "Set"],
    ["Seq(Array(Int))", "Array(Int)", "Seq"],
    ["Stream(Array(Int))", "Array(Int)", "Stream"],
  ])("%s is refused at an extern result", (written, captured, container) => {
    expect(diagnose(`extern from "./m.js"\n    fun rows() ->! ${written}\n`))
      .toEqual([beneath(captured, container)]);
  });

  test("an extern parameter is a position, and so is an `extern let`", () => {
    expect(diagnose('extern from "./m.js"\n    fun send(rows: Vector(Array(Int))) ->! Unit\n'))
      .toEqual([beneath("Array(Int)", "Vector")]);
    expect(diagnose('extern from "./m.js"\n    let table: Map(String, JsSet(Int))\n'))
      .toEqual([beneath("JsSet(Int)", "Map")]);
  });

  // "at any depth, including through any aggregate or function type inside the
  // container (records, tuples, unions, `Option`, `Nullable`, and function
  // types, whose per-crossing wrapper the walk cannot install there)".
  test.each([
    ["a structural record", "Vector({cells: Array(Int)})", ""],
    ["a nominal record", "Vector(Row)", "record Row = { cells: Array(Int) }\n\n"],
    ["a union payload", "Vector(Cell)", "union Cell = Empty | Filled(Array(Int))\n\n"],
    ["an `Option`", "Vector(Option(Array(Int)))", ""],
    ["a tuple", "Vector((Int, Array(Int)))", ""],
    ["a function type", "Vector((Array(Int)) -> Int)", ""],
  ])("the container is entered through %s", (_what, written, preamble) => {
    expect(diagnose(`${preamble}extern from "./m.js"\n    fun rows() ->! ${written}\n`))
      .toEqual([beneath("Array(Int)", "Vector")]);
  });

  // The container enumeration is exhaustive in both directions: a captured
  // `JsMap`/`JsSet` is not a container this item refuses, and one *inside* a
  // container is the captured type the message names.
  test("a `JsMap` is captured, not a container — but a `Vector` over one is refused", () => {
    expect(diagnose('extern from "./m.js"\n    fun rows() ->! JsMap(String, Array(Int))\n'))
      .toEqual([]);
    expect(diagnose(
      'extern from "./m.js"\n    fun rows() ->! Vector(JsMap(String, Array(Int)))\n',
    )).toEqual([beneath("JsMap(String, Array(Int))", "Vector")]);
  });

  test("a container inside a container is found at the inner one", () => {
    expect(diagnose('extern from "./m.js"\n    fun rows() ->! Vector(Vector(Array(Int)))\n'))
      .toEqual([beneath("Array(Int)", "Vector")]);
  });

  test("the export side is a position too — a function's seats and a value binding", () => {
    expect(diagnose("export let f(rows: Vector(Array(Int))): Int = 1\n"))
      .toEqual([beneath("Array(Int)", "Vector")]);
    // Both positions speak: the extern row that acquires the value, and the
    // export that would publish it.
    expect(diagnose(
      'extern from "./m.js"\n    let rows: Vector(Array(Int))\n\n' +
        "export let all: Vector(Array(Int)) = rows\n",
    )).toEqual([beneath("Array(Int)", "Vector"), beneath("Array(Int)", "Vector")]);
  });

  test("the legal neighbours stay legal", () => {
    // Each of these is a position the walk *can* reach: a `Vector` of vectors
    // crosses by identity with nothing to protect, and an aggregate naming a
    // captured collection is rebuilt component by component at the crossing.
    expect(diagnose('extern from "./m.js"\n    fun rows() ->! Vector(Vector(Int))\n')).toEqual([]);
    expect(diagnose('extern from "./m.js"\n    fun rows() ->! Nullable(Array(Int))\n')).toEqual([]);
    expect(diagnose('extern from "./m.js"\n    fun rows() ->! Option(Array(Int))\n')).toEqual([]);
    expect(diagnose(
      "record Row = { cells: Array(Int) }\n\n" +
        'extern from "./m.js"\n    fun rows() ->! Row\n',
    )).toEqual([]);
    // An exported *function* over a captured collection is not refused at all:
    // Part 7 §7 occasion 4's stable export wrapper walks its seats.
    expect(diagnose("export let f(xs: Array(Int)): Int = 1\n")).toEqual([]);
  });
});

describe("item 2 — a Hexagon opaque type whose representation names one", () => {
  const box = "opaque record Box = { rows: Array(Int) }\n\n";
  const message = "opaque type `Box` names the captured collection `Array(Int)` in its " +
    "representation (`rows`); an opaque value crosses the foreign boundary by identity, so " +
    "its representation cannot be copied at the crossing — keep an identity-safe " +
    "representation such as `Vector`, or expose the collection through an exported accessor";

  test("the message names the field and both rewrites", () => {
    expect(diagnose(`${box}extern from "./m.js"\n    fun take(b: Box) ->! Unit\n`))
      .toEqual([message]);
  });

  test("it is any boundary position, and it reaches inside a container", () => {
    expect(diagnose(`${box}export let f(b: Box): Int = 1\n`)).toEqual([message]);
    expect(diagnose(`${box}extern from "./m.js"\n    fun take(b: Vector(Box)) ->! Unit\n`))
      .toEqual([message]);
  });

  test("an opaque union names its constructor slot", () => {
    expect(diagnose(
      "opaque union Cell = Empty | Filled(Array(Int))\n\n" +
        'extern from "./m.js"\n    fun take(c: Cell) ->! Unit\n',
    )).toEqual([
      "opaque type `Cell` names the captured collection `Array(Int)` in its representation " +
      "(`Filled.item1`); an opaque value crosses the foreign boundary by identity, so its " +
      "representation cannot be copied at the crossing — keep an identity-safe representation " +
      "such as `Vector`, or expose the collection through an exported accessor",
    ]);
  });

  // `Seq` and `Stream` are themselves opaque prelude records, and item 1 is
  // what §5.4 says they are. The container enumeration is therefore excluded
  // from this item, and the pin is that `Seq(Array(Int))` draws item 1's words.
  test("the five containers are item 1's, not this item's", () => {
    expect(diagnose('extern from "./m.js"\n    fun rows() ->! Seq(Array(Int))\n'))
      .toEqual([beneath("Array(Int)", "Seq")]);
  });

  test("an identity-safe representation is legal, and so is a transparent record", () => {
    expect(diagnose(
      "opaque record Box = { rows: Vector(Int) }\n\n" +
        'extern from "./m.js"\n    fun take(b: Box) ->! Unit\n',
    )).toEqual([]);
    expect(diagnose(
      "record Row = { cells: Array(Int) }\n\n" +
        'extern from "./m.js"\n    fun take(r: Row) ->! Unit\n',
    )).toEqual([]);
  });
});

describe("item 3 — an `exception` payload", () => {
  const message = "exception `Bad`'s payload `rows` names the captured collection " +
    "`Array(Int)`; an exception may be thrown through foreign code, so its payload cannot " +
    "hold a foreign collection — carry a `Vector` (`Array.toVector` at the construction " +
    "site), or a persistent `Map`/`Set` (`Map.fromJsMap`/`Set.fromJsSet`, whose `Result` " +
    "the construction site handles)";

  // Exceptions §2: the refusal is **unconditional** — a property of the
  // declaration, not of any use, because an exception's travel is not
  // statically bounded — so it fires in a program with no `extern` at all, and
  // the message says what it is about rather than sending the reader to the FFI.
  test("it fires at the declaration, in a program with no `extern` in it", () => {
    expect(diagnose("exception Bad(rows: Array(Int))\n")).toEqual([message]);
  });

  test("a payload naming one inside an aggregate is the same refusal", () => {
    expect(diagnose("exception Bad(rows: Option(Array(Int)))\n")).toEqual([message]);
  });

  test("the rewrite the message names compiles", () => {
    expect(diagnose("exception Bad(rows: Vector(Int))\n")).toEqual([]);
  });
});

describe("item 4 — an exported non-function binding", () => {
  test("the message names the captured collection and both rewrites", () => {
    expect(diagnose(
      'extern from "./m.js"\n    let rows: Array(Int)\n\n' +
        "export let weekdays: Array(Int) = rows\n",
    )).toEqual([
      "exported binding `weekdays` names the captured collection `Array(Int)`; one ESM value " +
      "binding is shared by JavaScript and by every Hexagon importer, so no copy can protect " +
      "it — export a function whose result is copied at the crossing, or export a `Vector`",
    ]);
  });

  test("the type may name one from inside an aggregate", () => {
    expect(diagnose(
      "export record Row = { cells: Array(Int) }\n\n" +
        'extern from "./m.js"\n    let row: Row\n\n' +
        "export let first: Row = row\n",
    )).toEqual([
      "exported binding `first` names the captured collection `Array(Int)`; one ESM value " +
      "binding is shared by JavaScript and by every Hexagon importer, so no copy can protect " +
      "it — export a function whose result is copied at the crossing, or export a `Vector`",
    ]);
  });

  test("a function export and a private binding are both untouched", () => {
    expect(diagnose(
      'extern from "./m.js"\n    let rows: Array(Int)\n\n' +
        "export let weekdays(): Array(Int) = rows\n",
    )).toEqual([]);
    expect(diagnose(
      'extern from "./m.js"\n    let rows: Array(Int)\n\n' +
        "let weekdays: Array(Int) = rows\nexport let n(): Int = 1\n",
    )).toEqual([]);
  });
});

describe("item 5 — the release seat, `JsValue.from`", () => {
  // FFI Part 11 §2: the check runs at the innermost enclosing generalizing
  // binding, after that group is solved and after Numeric Literals §4's
  // defaulting, so a variable inference resolves within the group is no
  // obstacle and one that remains is displayed under its generalized name
  // (#649: never a numbered inference variable).
  test("the message names the surviving variable and both rewrites", () => {
    expect(diagnose("let wrap(x: a): JsValue = JsValue.from(x)\nexport let go(): Int = 1\n"))
      .toEqual([
        "`JsValue.from` cannot release a value at type `a`: the type variable `a` determines " +
        "no release operation, and the seat never falls back to identity — inject where the " +
        "concrete type is known, or pass an explicit conversion function `(a) -> JsValue` " +
        "into the generic helper",
      ]);
  });

  test("a variable anywhere inside the argument type is enough", () => {
    expect(diagnose(
      "let wrap(xs: Vector(a)): JsValue = JsValue.from(xs)\nexport let go(): Int = 1\n",
    )).toEqual([
      "`JsValue.from` cannot release a value at type `Vector(a)`: the type variable `a` " +
      "determines no release operation, and the seat never falls back to identity — inject " +
      "where the concrete type is known, or pass an explicit conversion function " +
      "`(a) -> JsValue` into the generic helper",
    ]);
  });

  test("a defaulted literal and a resolved variable are both ground", () => {
    expect(diagnose("export let wrap(): JsValue = JsValue.from(1)\n")).toEqual([]);
    expect(diagnose("let wrap(x: Int): JsValue = JsValue.from(x)\nexport let go(): Int = 1\n"))
      .toEqual([]);
  });

  test("a ground argument still obeys the other refusals", () => {
    // §2: "A ground argument type still obeys Part 1 §5.4's refusals" — legal
    // at a captured collection, refused beneath a container.
    expect(diagnose(
      "let wrap(xs: Array(Int)): JsValue = JsValue.from(xs)\nexport let go(): Int = 1\n",
    )).toEqual([]);
    expect(diagnose(
      "let wrap(xs: Vector(Array(Int))): JsValue = JsValue.from(xs)\nexport let go(): Int = 1\n",
    )).toEqual([beneath("Array(Int)", "Vector")]);
  });
});

describe("item 6 — the nested-adapter refusal is unchanged", () => {
  test("`Array(Seq(Int))` still draws §5.3's message", () => {
    expect(diagnose('extern from "./m.js"\n    fun rows() ->! Array(Seq(Int))\n')).toEqual([
      "extern type `Seq` requires adaptation inside a direct value; use an explicit eager " +
      "conversion at the boundary or a foreign shim",
    ]);
  });
});

describe("the fixpoint terminates, and answers each occurrence on its own", () => {
  test("a recursive record names one iff a reachable component does", () => {
    expect(diagnose(
      "record Tree = { kids: Vector(Tree), cells: Array(Int) }\n\n" +
        'extern from "./m.js"\n    fun rows() ->! Tree\n',
    )).toEqual([beneath("Array(Int)", "Vector")]);
    expect(diagnose(
      "record Tree = { kids: Vector(Tree), n: Int }\n\n" +
        'extern from "./m.js"\n    fun rows() ->! Tree\n',
    )).toEqual([]);
  });

  test("a recursive union terminates the same way", () => {
    expect(diagnose(
      "union List = Nil | Cons(Array(Int), List)\n\n" +
        'extern from "./m.js"\n    fun rows() ->! Vector(List)\n',
    )).toEqual([beneath("Array(Int)", "Vector")]);
  });

  // The path set is removed on the way out, so a nominal asked once and
  // answered "no" is asked again in full at its next occurrence — a whole-walk
  // visited set would silently clear the second `Vector(Row)` here.
  test("two occurrences of one nominal are each asked in full", () => {
    expect(diagnose(
      "record Row = { cells: Array(Int) }\n" +
        "record Pair = { a: Vector(Int), b: Vector(Row) }\n\n" +
        'extern from "./m.js"\n    fun rows() ->! Pair\n',
    )).toEqual([beneath("Array(Int)", "Vector")]);
  });
});
