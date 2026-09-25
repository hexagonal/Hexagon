import { describe, expect, test } from "vitest";

import { compileFiles, runProject } from "../support/test-project.js";

/**
 * Conformance for **a same-named import occluding the prelude's type and
 * constructor** — Modules §5.1 rules 2 and 3, §5.4 (#1075).
 *
 * A module import whose alias `T` names a module exporting a type `T` outranks
 * the prelude's `T`: in type position, the order is the module's own
 * declarations, then the companion fallback (the import's `T`), then the
 * prelude's types, then the compiler's boundary types; in term position, the
 * module's own terms, then the import's constructor `T`, then the prelude's
 * bare names — in an expression and in a pattern alike. So a bare `T` agrees
 * with `T.x`, which already meant the user's module, and a name the prelude
 * adds later cannot capture a program's import (§5.4's growth guarantee).
 *
 * The occlusion keys on the **type**: an import whose module exports a type of
 * the alias's spelling takes the prelude's same-spelled constructor with it,
 * whether or not its own constructor is reachable abroad; so does an import
 * whose module exports an exception of the spelling (#1078).
 *
 * The companion fallback's own properties (answers, never binds; carries no
 * members) are pinned by `companion-fallback.test.ts`.
 */

/** Every message the project reported, in order. */
function messages(files: readonly (readonly [string, string])[]): readonly string[] {
  return compileFiles(files).diagnostics.map(({ message }) => message);
}

/**
 * A user module `T` exporting `record T` with one field and a maker. The field
 * is the discriminator — no prelude type of any of these spellings has a field
 * `n` — and its own type is never `T`, which would make the record refer to
 * itself.
 */
function userModule(name: string): readonly [string, string] {
  const field = name === "Float" ? "Int" : "Float";
  const value = name === "Float" ? "1" : "1.0";
  return [
    `/${name.toLowerCase()}.hex`,
    `module ${name}\n\n` +
      `export record ${name} = { n: ${field} }\n` +
      `export fun make(): ${name} = ${name}({ n = ${value} })\n`,
  ];
}

/** `import T`, and the bare annotation read through the user's field. */
function consumer(name: string): readonly [string, string] {
  const field = name === "Float" ? "Int" : "Float";
  return [
    "/main.hex",
    "module Main\n\n" + `import ${name}\n` +
      `export let x: ${name} = ${name}.make()\n` +
      `export let y: ${field} = x.n\n`,
  ];
}

describe("type position: the import outranks every prelude type", () => {
  // The brief's table, both halves of it: the compiler-owned kinds (which
  // already let the import win) and the prelude-declared types (which drew
  // "expected `Option`, found `Option`"), with the rest of the compiler's own
  // spellings beside them.
  const declared = ["Option", "Seq", "Ordering", "Result", "Bool"];
  const owned = ["Vector", "Map", "Set", "Range", "JsMap", "JsSet"];
  const boundary = ["Array", "Nullable", "JsValue"];
  const primitive = ["Int", "Float", "String", "Unit", "BigInt", "Nat", "Dec"];

  for (const name of [...declared, ...owned, ...boundary, ...primitive]) {
    test(`\`${name}\` means the user's type`, () => {
      expect(messages([userModule(name), consumer(name)])).toEqual([]);
    });
  }

  test("the emitted route runs", async () => {
    // "Resolves" and "runs" are different claims: only the second proves the
    // annotation reached the user's record rather than an error node.
    const module = await runProject([userModule("Option"), consumer("Option")]);
    expect(module["y"]).toBe(1);
  });

  test("an applied spelling reaches the user's parameterized type", () => {
    expect(messages([
      ["/vector.hex",
        "module Vector\n\n" + "export record Vector(a) = { item: a }\n" +
          "export fun make(): Vector(Int) = Vector({ item = 1 })\n"],
      ["/main.hex",
        "module Main\n\n" + "import Vector\n" +
          "export let x: Vector(Int) = Vector.make()\n" +
          "export let y: Int = x.item\n"],
    ])).toEqual([]);
  });

  test("the arity report is the user's type's, not the prelude's", () => {
    expect(messages([
      userModule("Option"),
      ["/main.hex",
        "module Main\n\n" + "import Option\n" +
          "export fun mine(o: Option(Int)): Int = 1\n"],
    ])).toEqual(["type `Option` expects 0 arguments, but 1 were provided"]);
  });

  test("the prelude's type stays reachable through its own module", () => {
    // §5.4: the occluded name is reachable qualified. The prelude's `Option`
    // module is `Hex.Option`, realiased because `Option` is the user's.
    expect(messages([
      userModule("Option"),
      ["/main.hex",
        "module Main\n\n" + "import Option\n" + "import Hex.Option as Opt\n" +
          "export let mine: Option = Option.make()\n" +
          "export let theirs: Opt.Option(Int) = Some(1)\n"],
    ])).toEqual([]);
  });
});

describe("type position: what the import does not take", () => {
  test("an import not spelled like the type leaves the prelude's", () => {
    expect(messages([
      ["/other.hex", "module Other\n\n" + "export record Option = { n: Float }\n"],
      ["/main.hex",
        "module Main\n\n" + "import Other\n" +
          "export let x: Option(Int) = Some(1)\n"],
    ])).toEqual([]);
  });

  test("an import whose module exports no type of its spelling adds nothing", () => {
    expect(messages([
      ["/option.hex", "module Option\n\n" + "export fun answer(): Int = 42\n"],
      ["/main.hex",
        "module Main\n\n" + "import Option\n" +
          "export let x: Option(Int) = Some(Option.answer())\n"],
    ])).toEqual([]);
  });

  test("the module's own declaration wins over the import", () => {
    expect(messages([
      userModule("Option"),
      ["/main.hex",
        "module Main\n\n" + "import Option\n" +
          "export record Option = { m: String }\n" +
          "export fun f(o: Option): String = o.m\n"],
    ])).toEqual([]);
  });

  test("an implied type of the module's own constraint keeps its refusal", () => {
    // The module's own layer, like its declarations: the import does not answer
    // ahead of it.
    expect(messages([
      ["/item.hex", "module Item\n\n" + "export record Item = { n: Float }\n"],
      ["/main.hex",
        "module Main\n\n" + "import Item\n" +
          "export constraint Bag<c> =\n" +
          "    type Item\n" +
          "    first(bag: c) -> Item\n" +
          "export let x: Item = Item.Item({ n = 1.0 })\n"],
    ])).toContain("`Item` is an implied type of `Bag` and cannot appear in type expressions");
  });

  test("constraint position is unchanged: the pre-registered name is the prelude's", () => {
    // No other module can export one of the fourteen pre-registered constraint
    // names (Constraints §5.1.1), so an import spelled like one competes in
    // type position only — here, beside the prelude's `Ord` in the binder.
    expect(messages([
      userModule("Ord"),
      ["/main.hex",
        "module Main\n\n" + "import Ord\n" +
          "export fun least<a: Ord>(x: a, y: a): a = if x < y then x else y\n" +
          "export let o: Ord = Ord.make()\n" +
          "export let n: Float = o.n\n"],
    ])).toEqual([]);
  });
});

describe("a module's own type declaration occludes the prelude's, whatever either's form", () => {
  // Found under #1075: the prelude's types share the module's name-keyed
  // tables, read one form at a time, so a `record Option` of the module's own
  // lost to the prelude's `union Option` for being read second — and the user
  // module every case above imports could not declare its own type.
  for (const name of ["Option", "Ordering", "Result", "Bool"]) {
    test(`an own \`record ${name}\` over the prelude's union`, () => {
      expect(messages([
        ["/main.hex",
          "module Main\n\n" +
            `export record ${name} = { m: Float }\n` +
            `export fun f(o: ${name}): Float = o.m\n` +
            `export let y: Float = f(${name}({ m = 1.0 }))\n`],
      ])).toEqual([]);
    });
  }

  test("the compiler's own `Bool` is untouched by an own `record Bool`", async () => {
    const module = await runProject([
      ["/main.hex",
        "module Main\n\n" + "export record Bool = { m: Float }\n" +
          "export let y: Int = if 1 < 2 then 1 else 2\n"],
    ]);
    expect(module["y"]).toBe(1);
  });
});

/** A user module `JsError`, spelled like the prelude's exception. */
function jsError(declaration: string): readonly [string, string] {
  return ["/jserror.hex", "module JsError\n\n" + declaration];
}

describe("term position: the import's constructor outranks the prelude's", () => {
  const RECORD = jsError("export record JsError = { n: Int }\n");

  test("in an expression", () => {
    expect(messages([
      RECORD,
      ["/main.hex",
        "module Main\n\n" + "import JsError\n" +
          "export let x: JsError = JsError({ n = 1 })\n" +
          "export let y: Int = x.n\n"],
    ])).toEqual([]);
  });

  test("in a pattern", () => {
    expect(messages([
      RECORD,
      ["/main.hex",
        "module Main\n\n" + "import JsError\n" +
          "export fun f(e: JsError): Int =\n" +
          "    match e\n" +
          "        JsError({ n }) => n\n"],
    ])).toEqual([]);
  });

  test("the emitted route runs, bare and qualified alike", async () => {
    const module = await runProject([
      RECORD,
      ["/main.hex",
        "module Main\n\n" + "import JsError\n" +
          "fun read(e: JsError): Int =\n" +
          "    match e\n" +
          "        JsError({ n }) => n\n" +
          "export let bare: Int = read(JsError({ n = 1 }))\n" +
          "export let qualified: Int = read(JsError.JsError({ n = 2 }))\n"],
    ]);
    expect([module["bare"], module["qualified"]]).toEqual([1, 2]);
  });

  test("above the import line: the declared-later error, never the prelude's", () => {
    expect(messages([
      RECORD,
      ["/main.hex",
        "module Main\n\n" +
          "export let x: JsError = JsError({ n = 1 })\n" +
          "import JsError\n"],
    ])).toEqual([
      "`JsError` is declared later in this block; declarations are read top-down — " +
        "move the import above this use",
    ]);
  });

  test("the prelude's exception stays reachable through its own module", () => {
    expect(messages([
      RECORD,
      ["/main.hex",
        "module Main\n\n" + "import JsError\n" + "import Hex.JsError as Js\n" +
          "export fun wrap(v: JsValue): Exn = Js.JsError(v)\n"],
    ])).toEqual([]);
  });
});

describe("term position: the occlusion keys on the type", () => {
  test("an opaque record is refused with the opaque-construction row", () => {
    expect(messages([
      jsError(
        "opaque record JsError = { n: Int }\n" +
          "export fun make(): JsError = JsError({ n = 1 })\n",
      ),
      ["/main.hex",
        "module Main\n\n" + "import JsError\n" +
          "export let x: JsError = JsError({ n = 1 })\n"],
    ])).toEqual(["`JsError` is opaque outside module `JsError`; use its exported functions"]);
  });

  test("an opaque union spelled like the alias draws the same row", () => {
    expect(messages([
      jsError("opaque union JsError = Wrap(Int)\nexport fun make(): JsError = Wrap(1)\n"),
      ["/main.hex",
        "module Main\n\n" + "import JsError\n" +
          "export fun f(v: JsValue): Exn = JsError(v)\n"],
    ])).toEqual(["`JsError` is opaque outside module `JsError`; use its exported functions"]);
  });

  test("a transparent union without a constructor of its spelling names its own", () => {
    expect(messages([
      jsError("export union JsError = Wrap(Int) | Other\n"),
      ["/main.hex",
        "module Main\n\n" + "import JsError\n" +
          "export let x: JsError = JsError(1)\n"],
    ])).toEqual(["no bare `JsError`; write `JsError.Wrap` or `JsError.Other`"]);
  });

  test("— and a qualified-only prelude constructor is not offered instead", () => {
    // `Shape` is also `JsConversionReason.Shape`, which this spelling was once
    // refused towards: the prelude's route for a name the import has taken.
    expect(messages([
      ["/shape.hex", "module Shape\n\n" + "export union Shape = Dot | Line(Int)\n"],
      ["/main.hex",
        "module Main\n\n" + "import Shape\n" +
          "export let x: Shape = Shape(1)\n"],
    ])).toEqual(["no bare `Shape`; write `Shape.Dot` or `Shape.Line`"]);
  });

  test("a type alias of the spelling takes the name too: no prelude route is offered", () => {
    // `Shape` is also the prelude's qualified-only `JsConversionReason.Shape`.
    // The alias has no constructors to name, so the report is the plain one —
    // never the prelude's route for a spelling the import has taken.
    expect(messages([
      ["/shape.hex", "module Shape\n\n" + "export type Shape = Int\n"],
      ["/main.hex",
        "module Main\n\n" + "import Shape\n" +
          "export let x: Int = Shape(1)\n"],
    ])).toEqual(["unknown name `Shape`"]);
  });

  test("above the import line of a transparent union: the declared-later error", () => {
    // §5.4: a reference above an occluder draws the declared-later error with
    // the import's fixit — the sentence `Shape.Line(1)` draws there too — and
    // neither the prelude's route nor the union's own constructors.
    expect(messages([
      ["/shape.hex", "module Shape\n\n" + "export union Shape = Dot | Line(Int)\n"],
      ["/main.hex",
        "module Main\n\n" +
          "export let x: Int = 1\n" +
          "fun f(): Int =\n" +
          "    let s = Shape(1)\n" +
          "    0\n" +
          "import Shape\n"],
    ])).toContain(
      "`Shape` is declared later in this block; declarations are read top-down — " +
        "move the import above this use",
    );
  });

  test("above the line, a spelling the prelude lacks is not told to move the import", () => {
    // Nothing of the prelude's is occluded, so moving the line would only trade
    // one refusal for another: the plain report stands, as for a type of the
    // module's own below the use.
    expect(messages([
      ["/foo.hex", "module Foo\n\n" + "export type Foo = Int\n"],
      ["/main.hex",
        "module Main\n\n" +
          "export fun f(): Int =\n" +
          "    let s = Foo(1)\n" +
          "    0\n" +
          "import Foo\n"],
    ])).toEqual(["unknown name `Foo`"]);
  });

  test("in a pattern the type's door answers, and the prelude's constructor is not reached", () => {
    expect(messages([
      jsError("export union JsError = Wrap(Int) | Other\n"),
      ["/main.hex",
        "module Main\n\n" + "import JsError\n" +
          "export fun f(e: JsError): Int =\n" +
          "    match e\n" +
          "        JsError(n) => n\n" +
          "        _ => 0\n"],
    ])).toEqual(["`JsError` has no constructor `JsError`"]);
  });

  test("a module exporting nothing of its spelling leaves the prelude's exception", () => {
    expect(messages([
      jsError("export fun answer(): Int = 42\n"),
      ["/main.hex",
        "module Main\n\n" + "import JsError\n" +
          "export fun f(v: JsValue): Exn = JsError(v)\n" +
          "export let n: Int = JsError.answer()\n"],
    ])).toEqual([]);
  });

  test("an exception of the spelling occludes too (#1078)", async () => {
    // The fallback reaches an exception constructor spelled like its alias, so
    // it outranks the prelude's `JsError` as it outranks a type's constructor:
    // bare, in the throw and in the catch arm, and qualified all mean the
    // user's exception. The prelude's stays reachable through its module.
    const project = (arm: string): readonly (readonly [string, string])[] => [
      jsError("export exception JsError(code: Int)\n"),
      ["/main.hex",
        "module Main\n\n" + "import JsError\n" + "import Hex.JsError as Js\n" +
          "export fun theirs(v: JsValue): Exn = Js.JsError(v)\n" +
          "export let x: Int =\n" +
          "    try\n" +
          "        throw(JsError(7))\n" +
          "    catch\n" +
          `        ${arm} => c\n` +
          "        _ => 0\n"],
    ];
    for (const arm of ["JsError(c)", "JsError.JsError(c)"]) {
      expect(messages(project(arm))).toEqual([]);
      expect((await runProject(project(arm)))["x"]).toBe(7);
    }
  });

  test("an import of the prelude's own module occludes nothing", async () => {
    // `import Hex.JsError` exports the prelude's own `JsError`: there is no
    // second meaning to keep out, so a catch arm above the line still reaches
    // the foreign door, as it did before the import was written.
    const module = await runProject([
      ["/main.hex",
        "module Main\n\n" +
          "fun guard(g: () -> Int): Int =\n" +
          "    try\n" +
          "        g()\n" +
          "    catch\n" +
          "        JsError(_) => 1\n" +
          "        _ => 0\n" +
          "export let x: Int = guard(() => throw(JsError(JsValue.from(7))))\n" +
          "import Hex.JsError\n"],
    ]);
    expect(module["x"]).toBe(1);
  });

  test("an exception spelled like no prelude name agrees bare and qualified", async () => {
    // The shape a later prelude exception of the spelling must not re-mean.
    const module = await runProject([
      ["/oops.hex", "module Oops\n\n" + "export exception Oops(code: Int)\n"],
      ["/main.hex",
        "module Main\n\n" + "import Oops\n" +
          "export let x: Int =\n" +
          "    try\n" +
          "        throw(Oops(3))\n" +
          "    catch\n" +
          "        Oops.Oops(c) => c\n" +
          "        _ => 0\n"],
    ]);
    expect(module["x"]).toBe(3);
  });

  test("the module's own constructor of the spelling wins outright", async () => {
    // A same-spelled union constructor of the module's own is a term-namespace
    // declaration, so it answers before the import's record constructor —
    // bare, in an expression and a pattern — while the qualified spelling
    // still reaches the import's.
    const module = await runProject([
      jsError("export record JsError = { n: Int }\n"),
      ["/main.hex",
        "module Main\n\n" + "import JsError\n" +
          "union Mine = JsError(Int) | Nope\n" +
          "fun read(m: Mine): Int =\n" +
          "    match m\n" +
          "        JsError(k) => k\n" +
          "        Nope => 0\n" +
          "export let y: Int = read(JsError(5))\n" +
          "export let z: Int = JsError.JsError({ n = 2 }).n\n"],
    ]);
    expect([module["y"], module["z"]]).toEqual([5, 2]);
  });
});
