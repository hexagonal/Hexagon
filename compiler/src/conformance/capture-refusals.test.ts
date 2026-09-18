import { describe, expect, test } from "vitest";

import { compileFiles, compileMain, projectDiagnostics } from "../support/test-project.js";

/**
 * Conformance for **the capture walk's refused positions** — FFI Part 1 §5.4's
 * seven items and the diagnostics checklist rows §9 gives six of them (#945,
 * part 1, and its rider #952/#953/#954).
 *
 * §5.4 states one mechanism and one trigger. The trigger is **"names a captured
 * collection"**: "the least fixpoint over the declared type's constructor
 * graph", whose captured heads are `Array(a)`, `JsMap(k, v)` and `JsSet(a)`
 * (§2.2) and whose entered constructors are the aggregates — records, tuples,
 * unions, `Option`, `Nullable`, function types, and a nominal record or union
 * through its declared components, so that "a recursive record or union names
 * one iff some reachable component does". The graph is followed through
 * **every** constructor, the five Hexagon runtime containers included: only a
 * type variable and a type with no arguments end a path. `Vector(Array(Int))`
 * therefore *names* a captured collection although the capture **walk** cannot
 * enter the `Vector` — which is why item 1 refuses it at a position, and why an
 * exception payload or an exported value binding of that type is refused with
 * the container notwithstanding. Trigger and walk are two different questions
 * about one type, and this file pins both.
 *
 * The positions are §5.4's own table, less the ones that do not exist yet: an
 * extern `fun`'s parameters and result, an `extern let`'s value, an exported
 * Hexagon function's parameters and result, an exported value binding, an
 * exported constraint's member parameters and result (#953), and the release
 * seat `JsValue.from`. Part 5's receiver members (`get`/`method`/`set`/`new`)
 * are not in the language yet and are not pinned here; they inherit the same
 * seats when they arrive, `method`/`set`/`new` taking item 7's `supplied` side
 * with an extern `fun`'s parameters.
 *
 * **Item 7 is directional** (#952). It refuses an open structural record only
 * where *Hexagon* supplies the record — an extern `fun`'s parameters, any
 * function type anywhere in an extern declaration, the release seat — and every
 * other position keeps its open rows, the foreign side instantiating the tail
 * and parametricity covering what Hexagon can neither name nor extend.
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

/**
 * Each diagnostic's message paired with **the source text its primary span
 * covers**, which `projectDiagnostics` drops.
 *
 * One row needs it. Since round 4 recorded a seat at every occurrence of
 * `JsValue.from`, reading a direct application's callee through its parentheses
 * no longer changes *whether* the program is refused — the reference seat
 * inside the group reports the same sentence — so the message alone cannot tell
 * the two apart. What it still decides is **where the diagnostic points**: at
 * the argument, which the call seat owns, or at the callee name, which is the
 * reference seat's span and a worse label for "this argument's type is a
 * variable".
 */
function spans(source: string): readonly (readonly [string, string])[] {
  const text = MAIN + source;
  return compileMain(text).diagnostics.map(({ message, primary }) =>
    [message, text.slice(primary.start.offset, primary.end.offset)] as const);
}

/**
 * Item 1's message, for a captured `type` under `container`.
 *
 * The rewrites differ by the captured type, and they differ because the Rewrite
 * Rule (Declarations Preamble §1.1) wants constructs already in the language:
 * `Array.toVector` has shipped, `Vector.map` has not, and `Map.fromJsMap` /
 * `Set.fromJsSet` have not either (#796) — so the element conversion is named
 * where it exists and described where it does not, and the two rewrites that
 * are always available follow it.
 */
function beneath(captured: string, container: string): string {
  const rewrites = captured.startsWith("Array(")
    ? "convert each element with `Array.toVector` before the crossing, perform the " +
      "conversion at a controlled boundary, or bind through a foreign shim or an opaque " +
      "foreign handle"
    : "convert the elements to a persistent `Map`/`Set` before the crossing, perform the " +
      "conversion at a controlled boundary, or bind through a foreign shim or an opaque " +
      "foreign handle";
  return `captured collection \`${captured}\` beneath \`${container}\` cannot cross the ` +
    `foreign boundary; ${rewrites}`;
}

/**
 * Item 7's message, at a position where **Hexagon supplies the record**.
 *
 * Products §4's diagnostics vocabulary is **binding** — "this record may have
 * more fields", never "row" and never "row variable" — and §9's row asks for
 * the two rewrites §5.4 names.
 */
function openRow(rendered: string): string {
  return `this record may have more fields (\`${rendered}\`), so it cannot cross the foreign ` +
    "boundary at this position: Hexagon supplies the record here, and a field the " +
    "declaration does not name would cross uncopied (FFI Part 1 §5.4) — name every field " +
    "the crossing carries, or declare `JsValue` where the foreign side genuinely accepts " +
    "anything";
}

/** The same at the release seat, whose rewrite §5.4 item 7 states separately. */
function releasedOpenRow(rendered: string): string {
  return `this record may have more fields (\`${rendered}\`), so \`JsValue.from\` cannot ` +
    "release it: Hexagon supplies the value here, and a field the type does not name would " +
    "cross uncopied (FFI Part 1 §5.4) — inject at a closed type";
}

/** Item 4's message, whichever of the two export spellings drew it. */
function sharedBinding(name: string, captured: string): string {
  return `exported binding \`${name}\` names the captured collection \`${captured}\`; one ` +
    "ESM value binding is shared by JavaScript and by every Hexagon importer, so no copy " +
    "can protect it — export a function whose result is copied at the crossing, or export " +
    "a `Vector`";
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
      "convert each element with `Array.toVector` before the crossing, perform the " +
      "conversion at a controlled boundary, or bind through a foreign shim or an opaque " +
      "foreign handle",
    ]);
  });

  // The keyed shapes' twin. Their element conversions — `Map.fromJsMap`,
  // `Set.fromJsSet` — are unshipped (#796), so the sentence names the
  // persistent target rather than an operation the reader cannot call.
  test("a captured keyed shape names the rewrites it actually has", () => {
    expect(diagnose('extern from "./m.js"\n    fun rows() ->! Map(String, JsSet(Int))\n'))
      .toEqual([
        "captured collection `JsSet(Int)` beneath `Map` cannot cross the foreign boundary; " +
        "convert the elements to a persistent `Map`/`Set` before the crossing, perform the " +
        "conversion at a controlled boundary, or bind through a foreign shim or an opaque " +
        "foreign handle",
      ]);
  });

  // §5.4's table makes each parameter and the result a position, so a signature
  // with three offending seats draws three diagnostics — and it draws them at
  // the export as at the extern, which is the same table read once.
  test("each parameter and the result is its own seat, on both halves", () => {
    const extern = 'extern from "./m.js"\n' +
      "    fun g(a: Vector(Array(Int)), b: Set(Array(Int))) ->! Vector(Array(Int))\n";
    expect(diagnose(extern)).toEqual([
      beneath("Array(Int)", "Vector"),
      beneath("Array(Int)", "Set"),
      beneath("Array(Int)", "Vector"),
    ]);
    expect(diagnose(
      "export let g(a: Vector(Array(Int)), b: Set(Array(Int))): Vector(Array(Int)) = a\n",
    )).toEqual([
      beneath("Array(Int)", "Vector"),
      beneath("Array(Int)", "Set"),
      beneath("Array(Int)", "Vector"),
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

  /**
   * **Item 1 speaks, and item 4 does not.** An exported value binding of a type
   * naming a captured collection beneath a container is a seat both refusals
   * reach — the trigger follows the container, so item 4's "names a captured
   * collection" is satisfied too — and the precedence is fixed rather than
   * incidental: item 1 names the container and the captured type inside it,
   * where item 4's rewrite ("export a `Vector`") would be advice the reader has
   * already taken.
   */
  test("at an exported value binding, item 1 outranks item 4", () => {
    expect(diagnose("export let v: Vector(Array(Int)) = []\n"))
      .toEqual([beneath("Array(Int)", "Vector")]);
    // …and with no container on the path, item 4 is what speaks.
    expect(diagnose(
      'extern from "./m.js"\n    let raw: Array(Int)\n\nexport let v: Array(Int) = raw\n',
    )).toEqual([sharedBinding("v", "Array(Int)")]);
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
    // A **phantom** parameter holds nothing, so a nominal is followed by its
    // declared components and not by its arguments: §5.4's "a recursive record
    // or union names one iff some reachable component does" is the half of the
    // trigger that the container clause does not displace.
    expect(diagnose(
      "record Phantom(a) = { n: Int }\n\n" +
        'extern from "./m.js"\n    fun rows() ->! Phantom(Array(Int))\n',
    )).toEqual([]);
  });

  /**
   * **A captured head ends no path either.** §5.4 item 1 reads "at any depth",
   * and the trigger's own sentence ends a path only at a type variable and at a
   * type with no reachable components — `Array`, `JsMap` and `JsSet` are
   * neither. So the walk records the finding *and* carries on through the head's
   * arguments, with the step's guard unchanged: a captured head guards nothing
   * on its own, the walk copying it layer by layer.
   *
   * That is what keeps `JsMap(String, Array(Int))` "a legal face … captured
   * layer by layer" while everything below is refused for the container or the
   * opaque type *inside* the captured collection.
   */
  test("a captured head is a constructor too, so the walk continues through it", () => {
    const row = (written: string): readonly string[] =>
      diagnose(`extern from "./m.js"\n    fun rows() ->! ${written}\n`);
    expect(row("Array(Vector(Array(Int)))")).toEqual([beneath("Array(Int)", "Vector")]);
    expect(row("JsMap(String, Vector(Array(Int)))")).toEqual([beneath("Array(Int)", "Vector")]);
    expect(row("JsSet(Vector(Array(Int)))")).toEqual([beneath("Array(Int)", "Vector")]);
    expect(row("Array(Set(JsSet(Int)))")).toEqual([beneath("JsSet(Int)", "Set")]);
    expect(diagnose(
      "record Row = { v: Vector(Array(Int)) }\n\n" +
        'extern from "./m.js"\n    fun rows() ->! Array(Row)\n',
    )).toEqual([beneath("Array(Int)", "Vector")]);
    // …and item 2 reaches through one just as item 1 does.
    expect(diagnose(
      "opaque record Secret = { rows: Array(Int) }\n\n" +
        'extern from "./m.js"\n    fun rows() ->! Array(Secret)\n',
    )).toEqual([
      "opaque type `Secret` names the captured collection `Array(Int)` in its representation " +
      "(`rows`); an opaque value crosses the foreign boundary by identity, so its " +
      "representation cannot be copied at the crossing — keep an identity-safe " +
      "representation such as a `Vector` whose element types name none in turn, or expose " +
      "the collection through an exported accessor",
    ]);
    // The unguarded neighbour stays legal: a captured collection inside a
    // captured collection is copied with it (Part 10 §8).
    expect(row("JsMap(String, Array(Int))")).toEqual([]);
    expect(row("Array(JsSet(Int))")).toEqual([]);
  });
});

describe("item 2 — a Hexagon opaque type whose representation names one", () => {
  const box = "opaque record Box = { rows: Array(Int) }\n\n";
  const message = "opaque type `Box` names the captured collection `Array(Int)` in its " +
    "representation (`rows`); an opaque value crosses the foreign boundary by identity, so " +
    "its representation cannot be copied at the crossing — keep an identity-safe " +
    "representation such as a `Vector` whose element types name none in turn, or expose " +
    "the collection through an exported accessor";

  test("the message names the field and both rewrites", () => {
    expect(diagnose(`${box}extern from "./m.js"\n    fun take(b: Box) ->! Unit\n`))
      .toEqual([message]);
  });

  test("it is any boundary position, and it reaches inside a container", () => {
    expect(diagnose(`${box}export let f(b: Box): Int = 1\n`)).toEqual([message]);
    expect(diagnose(`${box}extern from "./m.js"\n    fun take(b: Vector(Box)) ->! Unit\n`))
      .toEqual([message]);
  });

  // The trigger follows the container, so a representation holding
  // `Vector(Array(Int))` names one as surely as one holding `Array(Int)` does.
  // The refusal is still item 2's, because the opaque type is what stands
  // between the collection and the crossing.
  test("a representation holding one beneath a container is the same refusal", () => {
    expect(diagnose(
      "opaque record Box = { rows: Vector(Array(Int)) }\n\n" +
        'extern from "./m.js"\n    fun take(b: Box) ->! Unit\n',
    )).toEqual([
      "opaque type `Box` names the captured collection `Array(Int)` in its representation " +
      "(`rows`); an opaque value crosses the foreign boundary by identity, so its " +
      "representation cannot be copied at the crossing — keep an identity-safe " +
      "representation such as a `Vector` whose element types name none in turn, or expose " +
      "the collection through an exported accessor",
    ]);
  });

  test("an opaque union names its constructor slot", () => {
    expect(diagnose(
      "opaque union Cell = Empty | Filled(Array(Int))\n\n" +
        'extern from "./m.js"\n    fun take(c: Cell) ->! Unit\n',
    )).toEqual([
      "opaque type `Cell` names the captured collection `Array(Int)` in its representation " +
      "(`Filled.item1`); an opaque value crosses the foreign boundary by identity, so its " +
      "representation cannot be copied at the crossing — keep an identity-safe representation " +
      "such as a `Vector` whose element types name none in turn, or expose the collection " +
      "through an exported accessor",
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
  // "whose element types name none in turn" is Exceptions §2's own clause, and
  // it is load-bearing once the trigger follows the five containers: a payload
  // of `Vector(Array(Int))` draws this refusal too, and "carry a `Vector`"
  // alone would be advice its author had already taken.
  const message = "exception `Bad`'s payload `rows` names the captured collection " +
    "`Array(Int)`; an exception may be thrown through foreign code, so its payload cannot " +
    "hold a foreign collection — carry a `Vector` whose element types name none in turn " +
    "(`Array.toVector` at the construction site)";

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

  /**
   * **A container on the path does not save the payload.** The trigger follows
   * every constructor, so a payload of `Vector(Array(Int))` names a captured
   * collection exactly as a payload of `Array(Int)` does — and the argument is
   * the same in either case, because none of an exception's crossings is a
   * declared position the walk could sit on, container or no container.
   */
  test.each([
    ["Vector(Array(Int))"],
    ["Seq(Array(Int))"],
    ["Stream(Array(Int))"],
    ["Set(Array(Int))"],
  ])("a payload of %s is refused at the declaration", (written) => {
    expect(diagnose(`exception Bad(rows: ${written})\n`)).toEqual([message]);
  });

  test("a keyed shape beneath a container keeps the keyed rewrite", () => {
    expect(diagnose("exception Bad(rows: Map(String, JsSet(Int)))\n")).toEqual([
      "exception `Bad`'s payload `rows` names the captured collection `JsSet(Int)`; an " +
      "exception may be thrown through foreign code, so its payload cannot hold a foreign " +
      "collection — carry a persistent `Map`/`Set` whose element types name none in turn, " +
      "built at the construction site",
    ]);
  });

  // The rewrite is the payload's own, for item 1's reason: `Map.fromJsMap` and
  // `Set.fromJsSet` are unshipped (#796), so a keyed payload is told what to
  // carry rather than which operation to call.
  test("a keyed payload names the rewrite it actually has", () => {
    expect(diagnose("exception Bad(s: JsSet(Int))\n")).toEqual([
      "exception `Bad`'s payload `s` names the captured collection `JsSet(Int)`; an " +
      "exception may be thrown through foreign code, so its payload cannot hold a foreign " +
      "collection — carry a persistent `Map`/`Set` whose element types name none in turn, " +
      "built at the construction site",
    ]);
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

  /**
   * **Both spellings of the export, one refusal.** `export` on an extern row
   * re-exports the imported binding from this module's facade (Part 4 §7), so
   * the live ESM binding item 4 is about is the same live binding the Hexagon
   * spelling beside it would publish. The row's *acquisition* is a supported
   * position — Part 4 §4.4's snapshot — and that is a different crossing; what
   * is refused here is the publication.
   */
  test("an exported `extern let` draws it too, and says the same thing", () => {
    expect(diagnose('extern from "./m.js"\n    export let rows: Array(Int)\n'))
      .toEqual([sharedBinding("rows", "Array(Int)")]);
    expect(diagnose('extern from "./m.js"\n    export let m: JsMap(String, Int)\n'))
      .toEqual([sharedBinding("m", "JsMap(String, Int)")]);
    // The Hexagon spelling of the same export, for comparison.
    expect(diagnose(
      'extern from "./m.js"\n    let raw: Array(Int)\n\nexport let rows: Array(Int) = raw\n',
    )).toEqual([sharedBinding("rows", "Array(Int)")]);
  });

  /**
   * **Item 4 speaks before item 7, and alone.** An ESM value binding is shared
   * whatever its type, so closing the row could not make this export legal —
   * the rewrite item 7 names would be work that only revealed item 4
   * underneath it. (Items 1 and 2 still outrank item 4, for their own reason:
   * they name the container and the captured type inside it, where "export a
   * `Vector`" would be advice the reader has already taken. The two rows above
   * pin that pair.)
   */
  test("an exported value binding takes item 4 before item 7", () => {
    expect(diagnose(
      'extern from "./m.js"\n' +
        "    export let cfg: {f: ({n: Int, ...}) -> Unit, rows: Array(Int)}\n",
    )).toEqual([sharedBinding("cfg", "Array(Int)")]);
    // Unexported, the row is the only thing wrong with it and item 7 says so.
    expect(diagnose(
      'extern from "./m.js"\n' +
        "    let cfg: {f: ({n: Int, ...}) -> Unit, rows: Array(Int)}\n",
    )).toEqual([openRow("{n: Int, ...}")]);
  });

  test("an unexported extern row is untouched — the acquisition is supported", () => {
    expect(diagnose(
      'extern from "./m.js"\n    let rows: Array(Int)\nexport let n(): Int = 1\n',
    )).toEqual([]);
  });

  test("the type may name one from inside an aggregate", () => {
    expect(diagnose(
      "export record Row = { cells: Array(Int) }\n\n" +
        'extern from "./m.js"\n    let row: Row\n\n' +
        "export let first: Row = row\n",
    )).toEqual([sharedBinding("first", "Array(Int)")]);
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

describe("item 4's other half — an exported union's constructors", () => {
  /**
   * §5.4 item 4: "Exported constructors are functions and take occasion 4 like
   * any other." A constructor of an exported union is a function JavaScript
   * calls (Part 7 §6), so each payload slot is a **parameter position** and is
   * read as one — which means items 1 and 2, and not item 4: a function is
   * never refused for naming a captured collection, occasion 4's wrapper being
   * what walks it.
   */
  test("a payload naming one outright is legal — the export wrapper walks it", () => {
    expect(diagnose("export union Shape = Rows(Array(Int)) | Empty\n")).toEqual([]);
  });

  test("a payload beneath a container is refused at the payload", () => {
    expect(diagnose("export union Shape = Rows(Vector(Array(Int)))\n"))
      .toEqual([beneath("Array(Int)", "Vector")]);
  });

  test("each slot of one constructor is its own position", () => {
    expect(diagnose("export union Shape = Rows(Vector(Array(Int)), Set(JsSet(Int)))\n"))
      .toEqual([beneath("Array(Int)", "Vector"), beneath("JsSet(Int)", "Set")]);
  });

  test("a payload reaching one through a nominal is refused too", () => {
    expect(diagnose(
      "export record Row = { cells: Array(Int) }\n" +
        "export union Shape = Rows(Vector(Row))\n",
    )).toEqual([beneath("Array(Int)", "Vector")]);
  });

  test("an opaque payload takes item 2, which names the field", () => {
    expect(diagnose(
      "opaque record Box = { rows: Array(Int) }\nexport union Shape = Rows(Box)\n",
    )).toEqual([
      "opaque type `Box` names the captured collection `Array(Int)` in its representation " +
      "(`rows`); an opaque value crosses the foreign boundary by identity, so its " +
      "representation cannot be copied at the crossing — keep an identity-safe " +
      "representation such as a `Vector` whose element types name none in turn, or expose " +
      "the collection through an exported accessor",
    ]);
  });

  // An unexported union publishes no constructor, so there is no position; an
  // exported *record* takes nothing here either, its constructor's positions
  // being read wherever the record itself reaches a boundary.
  test("an unexported union is not a position", () => {
    expect(diagnose(
      "union Shape = Rows(Vector(Array(Int)))\nexport let n(): Int = 1\n",
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

  /**
   * **A type variable, and only a type variable.** §2 refuses the seat where
   * the compiler cannot determine a release operation, and two of the solver's
   * variables determine nothing to release. An *effect* variable: a function
   * type naming no captured collection is §5.4's identity, colour or no colour,
   * and the colour prints as `->?` rather than as a name. A *row tail*: an open
   * record crosses as the POJO it already is, and `#render` prints the tail as
   * `...`. A refusal keyed on either would name a variable the type it quotes
   * does not contain, which is the shape #649 abolished — and that is what the
   * second half of each row below asserts.
   *
   * The two halves are one table because the second is only meaningful beside
   * the first: every colour-only row is legal, and every refused row names a
   * variable its own rendered type shows.
   *
   * *(#952.)* The row-tail rows have moved out of this table and into item 7's
   * block: an open row reaching this seat is refused there, first and alone, so
   * the exclusion below is no longer what decides those programs. It still
   * decides the ones the walk does not reach — a row under a phantom nominal
   * parameter — and that is the row that keeps the two answers in agreement.
   */
  test.each([
    ["(Int) ->? Int", false],
    ["(Int) ->? Bool", false],
    ["a", true],
    ["Vector(a)", true],
    ["(a, Int)", true],
    ["(Int) ->? b", true],
  ])("`JsValue.from` at `%s` — refused: %s", (written, refused) => {
    const messages = diagnose(
      `let w(x: ${written}): JsValue = JsValue.from(x)\nexport let go(): Int = 1\n`,
    );
    if (!refused) {
      expect(messages).toEqual([]);
      return;
    }
    expect(messages).toHaveLength(1);
    const quoted = /at type `([^`]*)`: the type variable `([^`]*)`/u.exec(messages[0] ?? "");
    expect(quoted).not.toBeNull();
    expect(quoted?.[1]).toContain(quoted?.[2] ?? "\u0000");
  });

  /**
   * **A reference is a seat.** `JsValue.from` handed on as a value names the
   * same injection an application of it names, chosen by the type the reference
   * was instantiated at — so `let g = JsValue.from` generalizes a seat whose
   * argument type is a variable, and is refused there. That is also what closes
   * `let g = JsValue.from` followed by `g(x)`: the call site is an ordinary
   * call to `g` and no gate on `JsValue.from` could see it.
   */
  test("an unapplied reference is a seat at its instantiated type", () => {
    const refused = "`JsValue.from` cannot release a value at type `a`: the type variable " +
      "`a` determines no release operation, and the seat never falls back to identity — " +
      "inject where the concrete type is known, or pass an explicit conversion function " +
      "`(a) -> JsValue` into the generic helper";
    expect(diagnose("let g = JsValue.from\nexport let n(): Int = 1\n")).toEqual([refused]);
    expect(diagnose(
      "let g = JsValue.from\nlet w(x: a): JsValue = g(x)\nexport let n(): Int = 1\n",
    )).toEqual([refused]);
    // An annotation that grounds the reference grounds the seat.
    expect(diagnose(
      "let g: (Int) -> JsValue = JsValue.from\nexport let n(): Int = 1\n",
    )).toEqual([]);
    // And a ground reference obeys the other refusals, as a ground call does.
    expect(diagnose(
      "let g: (Vector(Array(Int))) -> JsValue = JsValue.from\nexport let n(): Int = 1\n",
    )).toEqual([beneath("Array(Int)", "Vector")]);
  });

  // A group is punctuation: `(JsValue.from)(x)` is the same direct application,
  // and the emitter erases it too. Each of these is **one** diagnostic: the
  // callee is a reference as well as a callee, and the reference seat it
  // records is struck in favour of the call's.
  test("a parenthesised callee is the same seat, and points at the argument", () => {
    const released =
      "`JsValue.from` cannot release a value at type `a`: the type variable `a` determines " +
      "no release operation, and the seat never falls back to identity — inject where the " +
      "concrete type is known, or pass an explicit conversion function `(a) -> JsValue` " +
      "into the generic helper";
    expect(diagnose("let w(x: a): JsValue = (JsValue.from)(x)\nexport let go(): Int = 1\n"))
      .toEqual([released]);
    // **The span is the pin**, the message being the same either way. Reading
    // the callee through its parentheses is what makes this the *call's* seat,
    // whose span is the argument the type belongs to; without it the group is
    // no `Name`, no call seat is recorded, the callee's own reference seat is
    // never struck, and the diagnostic labels `JsValue.from` instead.
    expect(spans("let w(x: a): JsValue = (JsValue.from)(x)\nexport let go(): Int = 1\n"))
      .toEqual([[released, "x"]]);
    // The unparenthesised spelling is already the call's seat, and lands on the
    // same label — which is the whole content of "a group is punctuation".
    expect(spans("let w(x: a): JsValue = JsValue.from(x)\nexport let go(): Int = 1\n"))
      .toEqual([[released, "x"]]);
  });

  test("a defaulted literal and a resolved variable are both ground", () => {
    expect(diagnose("export let wrap(): JsValue = JsValue.from(1)\n")).toEqual([]);
    expect(diagnose("let wrap(x: Int): JsValue = JsValue.from(x)\nexport let go(): Int = 1\n"))
      .toEqual([]);
  });

  /**
   * **And only a ground one does.** §2 licenses the rest of §5.4 at this seat
   * with one word — "a **ground** argument type still obeys Part 1 §5.4's
   * refusals" — so a type still carrying a type variable is item 5's, whatever
   * else the walk found in it. Item 7 is the one refusal §2 lets pre-empt the
   * variable (pinned above); items 1, 2, 6 and the bound are asked *after* the
   * survivors, not before them.
   *
   * Each row draws exactly one diagnostic, and it names the variable.
   */
  test.each([
    ["a container over a captured collection", "Vector(Array(a))", "a", ""],
    ["a variable beside one", "(a, Vector(Array(Int)))", "a", ""],
    [
      "an opaque representation naming one",
      "Box(a)",
      "a",
      "opaque record Box(a) = { rows: Array(a) }\n\n",
    ],
    [
      "a type the walk cannot finish",
      "R(b)",
      "b",
      "record R(a) = { x: Option(R(Map(a, a))), n: Int }\n\n",
    ],
  ])("a non-ground argument is item 5's — %s", (_what, written, variable, preamble) => {
    expect(diagnose(
      `${preamble}let f(x: ${written}): JsValue = JsValue.from(x)\nexport let go(): Int = 1\n`,
    )).toEqual([
      `\`JsValue.from\` cannot release a value at type \`${written}\`: the type variable ` +
      `\`${variable}\` determines no release operation, and the seat never falls back to ` +
      "identity — inject where the concrete type is known, or pass an explicit conversion " +
      `function \`(${variable}) -> JsValue\` into the generic helper`,
    ]);
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

describe("item 7 — an open structural record where Hexagon supplies it", () => {
  /**
   * **The program #952 found.** The refusals are computed over the *declared*
   * type, and an open row declares only some of its components: the closed
   * spelling below is refused by item 1, and before this item the open one
   * compiled clean while a Hexagon caller widened it with the very
   * `Vector(Array(Int))` item 1 exists to refuse. An extern `fun`'s parameter
   * is a position Hexagon fills, so the declaration has to be closed.
   */
  test("the pair the ruling turns on: open refused, closed refused by item 1", () => {
    expect(diagnose('extern from "./m.js"\n    fun send(r: {n: Int, ...}) ->! Unit\n'))
      .toEqual([openRow("{n: Int, ...}")]);
    expect(diagnose(
      'extern from "./m.js"\n    fun send(r: {n: Int, v: Vector(Array(Int))}) ->! Unit\n',
    )).toEqual([beneath("Array(Int)", "Vector")]);
  });

  /**
   * **The direction rule, in one pair.** An extern `fun`'s **parameter** is
   * filled by a Hexagon caller and is refused; its **result** is filled by the
   * foreign side and keeps its open row, because Hexagon can neither name nor
   * add the fields it did not declare (Products §4 has no record extension) and
   * so holds them as it holds a value at a type variable — parametricity, the
   * same argument that excuses an exported `first(xs: Array(a)): a`.
   */
  test("a parameter is refused and a result is not", () => {
    expect(diagnose('extern from "./m.js"\n    fun send(r: {n: Int, ...}) ->! Unit\n'))
      .toEqual([openRow("{n: Int, ...}")]);
    expect(diagnose('extern from "./m.js"\n    fun get() ->! {n: Int, ...}\n')).toEqual([]);
    expect(diagnose('extern from "./m.js"\n    let config: {name: String, ...}\n')).toEqual([]);
  });

  /**
   * **A function type anywhere in an extern declaration is Hexagon's side
   * again**, and it is taken whole rather than slot by slot: at a *callback*
   * Hexagon produces the result and the foreign side fills the parameters, and
   * at a foreign function *value* Hexagon chooses the arguments — one type, two
   * readings, so the conservative rule is the only one that is right in both.
   */
  test.each([
    ["a callback at a result", 'fun get() ->! ({n: Int, ...}) -> Unit'],
    ["a function's result at a result", 'fun get() ->! (Int) -> {n: Int, ...}'],
    ["a function inside a container", 'fun get() ->! Vector(({n: Int, ...}) -> Unit)'],
    ["a callback at a parameter", 'fun send(f: ({n: Int, ...}) -> Int) ->! Unit'],
  ])("%s is refused", (_what, row) => {
    expect(diagnose(`extern from "./m.js"\n    ${row}\n`)).toEqual([openRow("{n: Int, ...}")]);
  });

  // An `extern let` takes the same rule, and reaches it through a type that is
  // not itself callable — Part 4's grammar refuses a callable `let` on its own
  // (`extern callable declarations use \`fun\``), so a bare function-typed row
  // would pin two things at once.
  test.each([
    ["a `Vector` of them", "let handlers: Vector(({n: Int, ...}) -> Unit)"],
    ["a record field", "let hooks: {onEach: ({n: Int, ...}) -> Unit}"],
  ])("an `extern let` holding a function through %s is refused", (_what, row) => {
    expect(diagnose(`extern from "./m.js"\n    ${row}\n`)).toEqual([openRow("{n: Int, ...}")]);
  });

  /**
   * **The two findings are genuinely two.** One result names an open row under
   * a function type and another beside it at no function at all; only the first
   * is Hexagon's to fill, and it is the one the message quotes.
   */
  test("only the row a function type stands above is refused", () => {
    expect(diagnose(
      'extern from "./m.js"\n' +
        "    fun get() ->! {onEach: ({n: Int, ...}) -> Unit, other: {p: Int, ...}}\n",
    )).toEqual([openRow("{n: Int, ...}")]);
  });

  /**
   * **And a nominal is a different question under a function type**, which is
   * a claim about the walk's `seen` set rather than about the rule. One
   * `record Holder = { r: {n: Int, ...} }` reached at a plain field carries the
   * foreign side's open row and is legal; the same declaration reached through
   * a function type carries Hexagon's and is refused. A key that could not tell
   * the two occurrences apart cut whichever came second, so the verdict
   * depended on the order the fields were written — and the nominal went clean
   * where its structural twin was refused.
   *
   * Both orders, at both `within` seats, and the legal control beneath them.
   */
  const holder = "record Holder = { r: {n: Int, ...} }\n\n";
  test.each([
    ["a record, the plain field first", "fun make() ->! {a: Holder, f: () -> Holder}"],
    ["a record, the function field first", "fun make() ->! {f: () -> Holder, a: Holder}"],
    ["a tuple, the function first", "fun make() ->! (() -> Holder, Option(Holder))"],
    ["a tuple, the plain occurrence first", "fun make() ->! (Holder, Option(() -> Holder))"],
    ["an `extern let`", "let v: {a: Holder, f: () -> Holder}"],
  ])("a nominal under a function type is refused — %s", (_what, row) => {
    expect(diagnose(`${holder}extern from "./m.js"\n    ${row}\n`))
      .toEqual([openRow("{n: Int, ...}")]);
  });

  test("and the same nominal reached by no function type is legal", () => {
    expect(diagnose(
      `${holder}extern from "./m.js"\n    fun make() ->! {a: Holder, b: Option(Holder)}\n`,
    )).toEqual([]);
  });

  /**
   * **The same at the release seat**, where §5.4 gives the item its own
   * rewrite: the value is Hexagon's own by definition — this is the one seat
   * where the Hexagon side hands the record over — and the fix is to inject at
   * a type that names every field.
   */
  test("the release seat has its own rewrite, and the closed neighbour is legal", () => {
    expect(diagnose(
      "let pick(x: {n: Int, ...}): JsValue = JsValue.from(x)\nexport let go(): Int = 1\n",
    )).toEqual([releasedOpenRow("{n: Int, ...}")]);
    expect(diagnose(
      "let pick(x: {n: Int}): JsValue = JsValue.from(x)\nexport let go(): Int = 1\n",
    )).toEqual([]);
  });

  /**
   * **"and this item fires first: item 5 is not also reported"** (§5.4 item 7;
   * Part 11 §2's "refused first, and alone"). `{n: a, ...q}` contains a type
   * variable *and* an open row, and before #952 the variable is what the seat
   * reported — a true sentence whose rewrite ("inject where the concrete type
   * is known") does not reach the row.
   */
  test("at the release seat item 5 is not also reported", () => {
    expect(diagnose(
      "let w(x: {n: a, ...q}): JsValue = JsValue.from(x)\nexport let go(): Int = 1\n",
    )).toEqual([releasedOpenRow("{n: a, ...}")]);
  });

  /**
   * **The reach is the walk's own** — "at any depth, through a nominal record's
   * field, and inside one of item 1's five containers at it" — which is why it
   * is a case in the one walk and not a second traversal.
   */
  test.each([
    ["a nested structural record", "{outer: {n: Int, ...}}", ""],
    ["an `Option`", "Option({n: Int, ...})", ""],
    ["a tuple", "(Int, {n: Int, ...})", ""],
    ["a `Nullable`", "Nullable({n: Int, ...})", ""],
    ["a nominal record's field", "Holder", "record Holder = { inner: {n: Int, ...} }\n\n"],
    ["a `Vector`", "Vector({n: Int, ...})", ""],
    ["a `Map` value", "Map(String, {n: Int, ...})", ""],
    ["a captured `Array`", "Array({n: Int, ...})", ""],
  ])("it is reached through %s", (_what, written, preamble) => {
    expect(diagnose(`${preamble}extern from "./m.js"\n    fun send(r: ${written}) ->! Unit\n`))
      .toEqual([openRow("{n: Int, ...}")]);
  });

  /**
   * **Every position the foreign side fills keeps its open rows**, which is the
   * other half of the ruling and the half with a language-visible cost if it
   * went the other way: the row-polymorphic function stays exportable, and the
   * declaration file renders its shared tail as before.
   */
  test.each([
    [
      "an exported function's parameters and result",
      'export fun rename(r: {guest: String, ...rest}): {guest: String, ...rest} =' +
        ' {r with guest = "Renamed"}\n',
    ],
    ["an exported constructor's payload", "export union Shape = Rows({n: Int, ...})\n"],
    ["an exported value binding", "export let point: {x: Int, ...q} = { x = 1, y = 2 }\n"],
    [
      "an exported constraint's member parameter",
      "export constraint Rowy<a> =\n    rows(x: {n: Int, ...}) -> Int\n",
    ],
    [
      "an exported constraint's member result",
      "export constraint Rowy<a> =\n    rows(x: a) -> {n: Int, ...}\n",
    ],
    [
      "a module-private row-polymorphic function",
      "let widest(r: {n: Int, ...}): Int = r.n\n" +
        "export let go(): Int = widest({ n = 1, m = 2 })\n",
    ],
  ])("%s keeps its open row", (_what, source) => {
    expect(diagnose(source)).toEqual([]);
  });

  /**
   * **The mechanism that separates the two sides**, pinned as the one pair that
   * shows it: a written tail is **rigid** inside the definition Hexagon
   * compiles (Functions §4.1), so nothing Hexagon holds can enter it and an
   * exported function's own callback parameter keeps its open row; an extern
   * declaration's tail is instead solved afresh at each Hexagon call site,
   * invisibly to a wrapper compiled against the open declaration, and the same
   * function type there is refused.
   */
  test("the same callback type is exempt at an export and refused at an extern", () => {
    expect(diagnose("export fun each(f: ({n: Int, ...}) -> Unit): Unit = f({n = 1})\n"))
      .toEqual([]);
    expect(diagnose(
      'extern from "./m.js"\n    fun each(f: ({n: Int, ...}) -> Unit) ->! Unit\n',
    )).toEqual([openRow("{n: Int, ...}")]);
  });

  /**
   * **Judged on the type after solving, never on the annotation text.** At an
   * extern parameter the spelling of the tail decides nothing — anonymous or
   * named, it is a variable the walk finds and the position is refused — and
   * the closed spelling beside it is legal because the *type* is closed, not
   * because a `...` is absent from the source.
   *
   * An extern declaration has no body, so nothing can solve its tail: that is
   * §5.4's "solved afresh at each Hexagon call site", and it is why this seat
   * is always the annotation's answer while the release seat below is not.
   */
  test("the tail's spelling decides nothing at an extern parameter", () => {
    expect(diagnose('extern from "./m.js"\n    fun send(r: {n: Int, ...q}) ->! Unit\n'))
      .toEqual([openRow("{n: Int, ...}")]);
    expect(diagnose('extern from "./m.js"\n    fun send(r: {n: Int, m: Int}) ->! Unit\n'))
      .toEqual([]);
  });

  /**
   * **A tail inference has solved is no longer open**, which is why the walk
   * normalizes the row before asking and reads the mono rather than the
   * annotation. `w`'s parameter is written open and the call to `g` in its own
   * binding group closes it, so the release seat sees the closed record the
   * crossing would really be directed by — and any captured collection that
   * solved it would then be items 1 and 2's business.
   */
  test("a solved tail closes the row, and the seat is legal", () => {
    expect(diagnose(
      "let g(r: {n: Int, m: Int}): Int = r.n\n" +
        "let w(r: {n: Int, ...q}): (Int, JsValue) = (g(r), JsValue.from(r))\n" +
        "export let go(): Int = 1\n",
    )).toEqual([]);
    // …and the same declaration with nothing to close it is refused.
    expect(diagnose(
      "let w(r: {n: Int, ...q}): (Int, JsValue) = (r.n, JsValue.from(r))\n" +
        "export let go(): Int = 1\n",
    )).toEqual([releasedOpenRow("{n: Int, ...}")]);
    // And a tail solved only *partly* — `q` bound to another open row — is
    // still open, and the message quotes the fields the solution contributed.
    // Reading the annotation instead of the solved type would quote `{n: Int,
    // ...}` and hide the field the reader has to think about.
    expect(diagnose(
      "let g(r: {n: Int, m: Int, ...z}): Int = r.n\n" +
        "let w(r: {n: Int, ...q}): (Int, JsValue) = (g(r), JsValue.from(r))\n" +
        "export let go(): Int = 1\n",
    )).toEqual([releasedOpenRow("{n: Int, m: Int, ...}")]);
  });

  /**
   * **The seat reads the row through its tail**, which is what normalizing it
   * does and what no other pin here needs. A branch join binds one parameter's
   * tail to the *other* record rather than merging two annotations: `p` becomes
   * `{m: Int, ...q}`, so the type the seat holds is a record of one field with
   * a tail that is itself a record. Read raw it is `{n: Int, ...}`, which hides
   * the field the join brought in; read through the tail it is the `{n: Int, m:
   * Int, ...}` the value really carries.
   */
  test("a tail bound to another record contributes its fields to the message", () => {
    expect(diagnose(
      "let pick(b: Bool, x: {n: Int, ...p}, y: {m: Int, ...q}): JsValue =\n" +
        "    JsValue.from(if b then x else y)\n" +
        "export let go(): Int = 1\n",
    )).toEqual([releasedOpenRow("{n: Int, m: Int, ...}")]);
  });

  /**
   * **Item 7 speaks before items 1 and 2** where it speaks at all, and the
   * order is the order the refusals decide in: a declaration that does not name
   * its own components is one the walk cannot be directed by, so what the walk
   * found *inside* it is a report about the part the author did spell.
   */
  test("an open row outranks a captured collection beneath a container", () => {
    expect(diagnose(
      'extern from "./m.js"\n    fun send(r: {v: Vector(Array(Int)), ...}) ->! Unit\n',
    )).toEqual([openRow("{v: Vector(Array(Int)), ...}")]);
  });

  /**
   * **And it speaks first however the source is ordered**, which is a claim
   * about the walk and not only about the precedence above. The two rows here
   * are one tuple written both ways round: the guarded finding and the open row
   * are in *sibling* branches, so a walk that stopped at the first guarded node
   * reported item 1 for one spelling and item 7 for the other — the verdict
   * decided by which branch breadth-first order reached first. The walk now
   * settles item 7's answers before honouring a guarded one, and the budget is
   * what bounds it.
   */
  test.each([
    ["the guarded branch first", "(Vector(Array(Int)), Option({n: Int, ...}))"],
    ["the open branch first", "(Option({n: Int, ...}), Vector(Array(Int)))"],
  ])("a sibling guarded finding does not pre-empt item 7 — %s", (_order, written) => {
    expect(diagnose(`extern from "./m.js"\n    fun send(r: ${written}) ->! Unit\n`))
      .toEqual([openRow("{n: Int, ...}")]);
  });

  test("the same at an extern result under a function type", () => {
    expect(diagnose(
      'extern from "./m.js"\n' +
        "    fun get() ->! ((Vector(Array(Int)), Option({n: Int, ...}))) -> Unit\n",
    )).toEqual([openRow("{n: Int, ...}")]);
  });

  test("and at the release seat, where §2 makes it first and alone", () => {
    expect(diagnose(
      "let f(x: (Vector(Array(Int)), Option({n: Int, ...q}))): JsValue = JsValue.from(x)\n" +
        "export let go(): Int = 1\n",
    )).toEqual([releasedOpenRow("{n: Int, ...}")]);
  });

  /**
   * **And the two tail answers agree** (#952's own closing note). A row the
   * walk does not reach — under a *phantom* nominal parameter, which holds
   * nothing — is neither item 7's nor item 5's: `#rowTailVariables` keeps the
   * tail out of the release seat's survivors, so no diagnostic names a variable
   * the rendered type prints as `...`.
   */
  test("a row under a phantom parameter is refused by neither", () => {
    expect(diagnose(
      "record Phantom(a) = { n: Int }\n\n" +
        "let w(x: Phantom({n: Int, ...q})): JsValue = JsValue.from(x)\n" +
        "export let go(): Int = 1\n",
    )).toEqual([]);
  });
});

describe("#953 — an exported constraint's member parameters and result", () => {
  /**
   * FFI Part 9 §3.4, and §5.4's positions table: "An exported constraint's
   * member parameters and result are boundary positions in their own right …
   * so Part 1 §5.4's refusals 1 and 2 apply at the member annotation, whether
   * or not §5's closure publishes a handle." A public handle is a record of
   * functions crossing outbound, and a member naming a captured collection
   * beneath a container asks for the copying wrapper the walk can no more
   * install inside a `Vector` here than anywhere else.
   */
  test("item 1 at a member's result", () => {
    expect(diagnose("export constraint Rowy<a> =\n    rows(x: a) -> Vector(Array(Int))\n"))
      .toEqual([beneath("Array(Int)", "Vector")]);
  });

  test("item 2 at a member's parameter", () => {
    expect(diagnose(
      "opaque record Box = { rows: Array(Int) }\n\n" +
        "export constraint Rowy<a> =\n    rows(x: Box) -> Int\n",
    )).toEqual([
      "opaque type `Box` names the captured collection `Array(Int)` in its representation " +
      "(`rows`); an opaque value crosses the foreign boundary by identity, so its " +
      "representation cannot be copied at the crossing — keep an identity-safe " +
      "representation such as a `Vector` whose element types name none in turn, or expose " +
      "the collection through an exported accessor",
    ]);
  });

  /**
   * Each parameter and the result is a seat of its own, as on the extern and
   * export halves — §5.4's table makes each a position, not the signature.
   *
   * **Item 7 is not among the refusals**, as Part 9 §3.4 says in the same
   * sentence: the handle's foreign caller instantiates any open tail, and
   * parametricity covers it. A member's open rows are pinned with the rest of
   * the foreign side's, in item 7's block above.
   */
  test("each parameter and the result is its own seat", () => {
    expect(diagnose(
      "export constraint Rowy<a> =\n" +
        "    rows(x: Vector(Array(Int)), y: Set(JsSet(Int))) -> Seq(Array(Int))\n",
    )).toEqual([
      beneath("Array(Int)", "Vector"),
      beneath("JsSet(Int)", "Set"),
      beneath("Array(Int)", "Seq"),
    ]);
  });

  /**
   * **A member naming a captured collection outright is legal**, for an
   * exported function's reason: §3.4's stable copying wrapper walks it, wrapped
   * once when the handle is materialized. That wrapper is a later part of #945;
   * nothing here refuses the declaration it will be built for.
   */
  test("a captured collection outright, and a type variable, are both legal", () => {
    expect(diagnose("export constraint Rowy<a> =\n    rows(x: a) -> Array(Int)\n")).toEqual([]);
    expect(diagnose("export constraint Rowy<a> =\n    rows(x: a) -> a\n")).toEqual([]);
  });

  /**
   * **An unexported constraint publishes nothing**, exactly as an unexported
   * union publishes no constructor — and it is the same gate the #621 carrier
   * check reads, which is why the two share the enumeration.
   */
  test("an unexported constraint is not a position", () => {
    expect(diagnose(
      "constraint Rowy<a> =\n    rows(x: a) -> Vector(Array(Int))\n\nexport let go(): Int = 1\n",
    )).toEqual([]);
  });
});

describe("#954 — the intrinsic door, and two refusals at one seat", () => {
  /**
   * §5.4's "what is a foreign crossing" names three things that look like one
   * and are not, and the first is the intrinsic door: `extern from
   * "hex:intrinsic"` is a compiler lowering over Hexagon's own values
   * (Intrinsics §3), so nothing there copies and nothing there is refused.
   *
   * The privilege is prelude membership rather than text (Intrinsics §5.2), so
   * the block rides a prelude injection path — the route `intrinsic-door.test`
   * takes, and `Debug.hex` for its reason: it is last in the prelude order, so
   * replacing it takes nothing out from under a later member. The declaration's
   * *types* are not checked against a table (Intrinsics §4.2, "the
   * declaration's annotation is normative"), which is what lets a real key
   * carry the seat this row is about.
   */
  test("a `Vector(Array(Int))` seat behind the intrinsic door is clean", () => {
    expect(compileFiles([
      ["/main.hex", `${MAIN}export let ok: Int = 1\n`],
      ["/Debug.hex", "module Debug\n\n" +
        'extern from "hex:intrinsic"\n' +
        "    fun vectorToArray as pin(rows: Vector(Array(Int))) -> Array(Int)\n"],
    ]).diagnostics.map(({ message }) => message)).toEqual([]);
    // The same row through an ordinary foreign specifier is refused, which is
    // what makes the line above a statement about the door rather than about
    // the type.
    expect(diagnose(
      'extern from "./m.js"\n    fun pin(rows: Vector(Array(Int))) ->! Array(Int)\n',
    )).toEqual([beneath("Array(Int)", "Vector")]);
  });

  /**
   * **Two refusals at one seat, both true and distinct.** `Array(Seq(Array(
   * Int)))` nests an adapter-requiring `Seq` inside a captured collection,
   * which is §5.3's refusal (item 6), and hides an `Array(Int)` beneath that
   * `Seq`, which is item 1's — the `Seq` being one of the five containers. The
   * rewrites differ, so collapsing them would drop one.
   */
  test("`Array(Seq(Array(Int)))` draws item 6 and item 1", () => {
    expect(diagnose('extern from "./m.js"\n    fun f() ->! Array(Seq(Array(Int)))\n')).toEqual([
      "extern type `Seq` requires adaptation inside a direct value; use an explicit eager " +
      "conversion at the boundary or a foreign shim",
      beneath("Array(Int)", "Seq"),
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

  /**
   * **The walk keys on the occurrence, not on the declaration.** Both `Box`es
   * below are visited by one membership call, and they are different questions:
   * `Box(Int)` names no captured collection and `Box(Array(Int))` does. A
   * visited set keyed on `Box` alone answers the second with the first's "no"
   * and lets the position through.
   */
  test("two occurrences of one nominal under different arguments are both asked", () => {
    expect(diagnose(
      "union Box(a) = Empty | Full(a)\n" +
        "record Pair = { u: Box(Int), v: Box(Array(Int)) }\n\n" +
        'extern from "./m.js"\n    fun rows() ->! Vector(Pair)\n',
    )).toEqual([beneath("Array(Int)", "Vector")]);
    // …and the same pair with no `Array` in it stays legal, so the row above
    // is not passing on the mere presence of a second occurrence.
    expect(diagnose(
      "union Box(a) = Empty | Full(a)\n" +
        "record Pair = { u: Box(Int), v: Box(Vector(Int)) }\n\n" +
        'extern from "./m.js"\n    fun rows() ->! Vector(Pair)\n',
    )).toEqual([]);
  });

  /**
   * **And the visited entry is never unwound**, which is what keeps the walk
   * linear on a shared-subterm graph. `Li` names `L(i-1)` twice, so a path set
   * — added on the way in, removed on the way out — visits `L0` 2ⁱ times: at
   * i = 22 that is four million visits and about nine seconds, against the
   * hundred-odd milliseconds the whole compile takes without the chain. The
   * budget below is loose enough for a slow machine and nowhere near the
   * exponential it excludes.
   */
  test("a shared-subterm chain is linear, not exponential", () => {
    const declarations = ["record L0 = { q: Int }"];
    for (let level = 1; level <= 22; level += 1) {
      declarations.push(`record L${level} = { a: L${level - 1}, b: L${level - 1} }`);
    }
    const source = `${declarations.join("\n")}\n\n` +
      'extern from "./m.js"\n    fun rows() ->! Vector(L22)\n';
    const started = Date.now();
    expect(diagnose(source)).toEqual([]);
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  /**
   * **The captured collection named is the shallowest**, not the first a
   * depth-first walk stumbles into. `R`'s `x` leads down a tower of `Vector`
   * layers and its `y` holds the `Array(Int)` the author wrote; a walk that
   * descends `x` first names an `Array(Vector(Vector(…)))` the reader never
   * typed, and swapping the two fields changes the message. The pair below is
   * the pin: the field order must not matter, and the type named must be the
   * one in the source.
   */
  test.each([
    ["deep branch first", "{ x: Option(R(Vector(a))), y: Array(a) }"],
    ["shallow branch first", "{ y: Array(a), x: Option(R(Vector(a))) }"],
  ])("the message names the nearest captured collection — %s", (_order, fields) => {
    expect(diagnose(
      `record R(a) = ${fields}\n\n` +
        'extern from "./m.js"\n    fun rows() ->! Vector(R(Int))\n',
    )).toEqual([beneath("Array(Int)", "Vector")]);
  });

  /**
   * **Non-regular recursion terminates** — Hexagon accepts it — and it
   * terminates *with an answer where there is one*: `R(Int)`'s inner
   * `R(Array(Int))` has a `y` of type `Array(Int)`, so the position really does
   * name a captured collection, and it is the shallow one the message names.
   */
  test("a non-regular recursive record is still answered where the walk can answer", () => {
    expect(diagnose(
      "record R(a) = { x: Nullable(R(Array(a))), y: a }\n\n" +
        'extern from "./m.js"\n    fun rows() ->! Vector(R(Int))\n',
    )).toEqual([beneath("Array(Int)", "Vector")]);
  });

  /**
   * **And where it cannot answer, the position is refused.** §5.4's sentence is
   * "no *declared* position crosses unprotected because the compiler could not
   * protect it", so a type the walk cannot finish is refused for that, in its
   * own words, rather than waved through. The two shapes below are the two ways
   * a type outruns the bound: one grows its occurrence by a layer each time,
   * and one doubles it.
   */
  test.each([
    ["growing", "record R(a) = { x: Nullable(R(Array(a))) }"],
    ["doubling", "record R(a) = { x: Option(R(Map(a, a))), n: Int }"],
  ])("a %s non-regular type is refused as undecided, not accepted", (_shape, declaration) => {
    const started = Date.now();
    expect(diagnose(`${declaration}\n\nextern from "./m.js"\n    fun rows() ->! R(Int)\n`))
      .toEqual([
        "the type `R(Int)` at this boundary position expands past the capture check's bound, " +
        "so the compiler cannot decide whether it names a captured foreign collection, and " +
        "no declared position crosses undecided (FFI Part 1 §5.4); declare a position whose " +
        "type does not nest without bound, or bind through an opaque foreign handle",
      ]);
    // The heap, not only the clock: before the bound counted nodes rather than
    // layers, the doubling shape rendered a 2ᵏ-node key per layer and killed
    // the compiler outright.
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  /**
   * **A decision already made survives the bound.** Since the walk may no
   * longer stop at the first guarded finding (item 7 outranks it, #952), it
   * runs into the budget on a non-regular type that used to short-circuit — and
   * the answer there is the refusal it decided, not "undecided". §5.4's
   * sentence is that no declared position crosses *unprotected*, and a position
   * refused for item 1, 2 or 7 is protected; replacing that message with one
   * naming no type would be a worse report of the same verdict.
   *
   * `"unbounded"` is what a walk that decided **nothing** answers, which is the
   * half that keeps a silent acceptance impossible — the row below it, and the
   * two beside it in this block.
   */
  test("a non-regular type refused for item 7 says so, not that it gave up", () => {
    expect(diagnose(
      "record R(a) = { x: Option(R(Map(a, a))), r: {n: Int, ...} }\n\n" +
        'extern from "./m.js"\n    fun send(v: R(Int)) ->! Unit\n',
    )).toEqual([openRow("{n: Int, ...}")]);
    // …and the same declaration with nothing for the walk to decide is
    // undecided, at the same seat.
    expect(diagnose(
      "record R(a) = { x: Option(R(Map(a, a))), n: Int }\n\n" +
        'extern from "./m.js"\n    fun send(v: R(Int)) ->! Unit\n',
    )).toEqual([
      "the type `R(Int)` at this boundary position expands past the capture check's bound, " +
      "so the compiler cannot decide whether it names a captured foreign collection, and " +
      "no declared position crosses undecided (FFI Part 1 §5.4); declare a position whose " +
      "type does not nest without bound, or bind through an opaque foreign handle",
    ]);
  });

  /**
   * **And the bound decides per seat, because "decided" is a seat's word.**
   * The findings a spent walk hands over are partial: what they hold, the walk
   * decided; what they do not hold is unknown. Whether that is enough is the
   * seat's question — an `open` row refuses an extern parameter and the release
   * seat and means nothing at an exported one — so the same partial answer is
   * item 7's refusal at the two seats that read it and `#captureBoundRefusal`'s
   * at every seat that does not.
   *
   * One type, eight seats. Without this every `foreign` and `within` seat below
   * went **clean**, which is the silent acceptance §5.4's bound exists to
   * prevent, and a regression against the behaviour that shipped with #949.
   */
  const partial = "export record R(a) = { x: Option(R(Map(a, a))), r: {n: Int, ...} }\n\n";
  const bound = "the type `R(Int)` at this boundary position expands past the capture " +
    "check's bound, so the compiler cannot decide whether it names a captured foreign " +
    "collection, and no declared position crosses undecided (FFI Part 1 §5.4); declare a " +
    "position whose type does not nest without bound, or bind through an opaque foreign " +
    "handle";
  test.each([
    ["an exception payload", "exception Bad(r: R(Int))\n"],
    ["an extern result", 'extern from "./m.js"\n    fun make() ->! R(Int)\n'],
    ["an `extern let`", 'extern from "./m.js"\n    let v: R(Int)\n'],
    ["an exported function's parameter", "export fun f(v: R(Int)): Int = 1\n"],
    ["an exported constructor's payload", "export union U = A(v: R(Int))\n"],
    ["an exported constraint member", "export constraint C<b> =\n    m(x: R(Int)) -> b\n"],
  ])("a seat that cannot read the partial answer takes the bound — %s", (_what, source) => {
    expect(diagnose(partial + source)).toEqual([bound]);
  });

  test("and the two seats that can read it take item 7 instead", () => {
    expect(diagnose(`${partial}extern from "./m.js"\n    fun send(v: R(Int)) ->! Unit\n`))
      .toEqual([openRow("{n: Int, ...}")]);
    expect(diagnose(
      `${partial}let w(v: R(Int)): JsValue = JsValue.from(v)\nexport let go(): Int = 1\n`,
    )).toEqual([releasedOpenRow("{n: Int, ...}")]);
  });

  test("the bound refuses at every seat, not only at an extern row", () => {
    const declaration = "record R(a) = { x: Option(R(Map(a, a))), n: Int }\n\n";
    const bound = "the type `R(Int)` at this boundary position expands past the capture " +
      "check's bound, so the compiler cannot decide whether it names a captured foreign " +
      "collection, and no declared position crosses undecided (FFI Part 1 §5.4); declare a " +
      "position whose type does not nest without bound, or bind through an opaque foreign " +
      "handle";
    expect(diagnose(`${declaration}exception Bad(r: R(Int))\n`)).toEqual([bound]);
    expect(diagnose(
      `${declaration}let w(r: R(Int)): JsValue = JsValue.from(r)\nexport let go(): Int = 1\n`,
    )).toEqual([bound]);
  });

  /**
   * **And the bound is nowhere near an ordinary type.** Seventy nested
   * one-field records is far past anything written by hand and is still
   * decided, naming the `Array(Int)` at the bottom — which is what pins the
   * bound *from below*: shrink it and this row reads the undecided refusal
   * instead. A depth cap rather than a size one failed exactly here, accepting
   * sixty-five layers while refusing sixty-four.
   */
  test("seventy layers of an ordinary nominal are decided, not bounded out", () => {
    let written = "Array(Int)";
    for (let layer = 0; layer < 70; layer += 1) written = `Box(${written})`;
    expect(diagnose(
      "record Box(a) = { v: a }\n\n" +
        `extern from "./m.js"\n    fun rows() ->! Vector(${written})\n`,
    )).toEqual([beneath("Array(Int)", "Vector")]);
  });
});
