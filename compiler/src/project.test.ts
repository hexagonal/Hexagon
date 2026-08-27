import { expect, test } from "vitest";

import * as Source from "./support/source.js";
import { compileProject } from "./project.js";

test("compiles relative named, aliased, namespace, and effect imports", () => {
  const project = compileProject([
    new Source.File(
      Source.fileId(0),
      "/app/geometry.hex",
      "export record Point = {x: Int}\n" +
        "export fun make(x: Int): Point = Point({x = x})\n" +
        "export fun coordinate(point: Point): Int = point.x",
    ),
    new Source.File(
      Source.fileId(1),
      "/app/telemetry.hex",
      'log("loaded")',
    ),
    new Source.File(
      Source.fileId(2),
      "/app/main.hex",
      'import { Point, make as makePoint } from "./geometry"\n' +
        'import module Geo from "./geometry"\n' +
        'import "./telemetry"\n' +
        "export let point: Point = makePoint(3)\n" +
        "export let answer: Int = point.coordinate()",
    ),
  ]);

  expect(project.diagnostics).toEqual([]);
  // `Debug.hex` is here because `telemetry.hex` names `log`: a prelude module
  // is injected beside the sources that use it, ahead of them. `String.hex`
  // rode in behind it while the call carried a dictionary — #419 had widened
  // the probe to `log<a: Show>`, so the graph needed the companion housing
  // `Show<String>` — and left again at #440: `log("loaded")` is a known-concrete
  // call, so it reaches `logString` and asks for no evidence at all. The whole
  // edge this pins is the one the emitted text now has, and dropping a module
  // from a program that never needed its dictionary is the point of the change.
  expect(project.modules.map(({ source }) => source.path)).toEqual([
    "/app/Debug.hex",
    "/app/geometry.hex",
    "/app/telemetry.hex",
    "/app/main.hex",
  ]);
  const main = project.modules.at(-1)!;
  expect(main.typed.diagnostics).toEqual([]);
  expect(main.javascript.text).toContain(
    'import { Point, make as makePoint } from "./geometry.js";',
  );
  expect(main.javascript.text).toContain(
    'import * as Geo from "./geometry.js";',
  );
  expect(main.javascript.text).toContain("const answer = Geo.coordinate(point);");
  expect(main.declarations.text).toContain("export declare const answer: number;");
});

test("re-exports extern bindings and opaque types through Hexagon modules", () => {
  const project = compileProject([
    new Source.File(
      Source.fileId(0),
      "/tiny-json.hex",
      "extern from \"tiny-json\"\n" +
        "    export type JsonValue\n" +
        "    export fun parse(text: String): JsonValue",
    ),
    new Source.File(
      Source.fileId(1),
      "/main.hex",
      'import module Json from "./tiny-json"\n' +
        "export let document: Json.JsonValue = Json.parse!(\"{}\")",
    ),
  ]);

  expect(project.diagnostics).toEqual([]);
  const bindings = project.modules[0]!;
  const main = project.modules[1]!;
  expect(bindings.typed.diagnostics).toEqual([]);
  expect(main.typed.diagnostics).toEqual([]);
  expect(bindings.javascript.text).toContain('import { parse } from "tiny-json";');
  expect(main.javascript.text).toContain('import * as Json from "./tiny-json.js";');
  expect(bindings.declarations.text).toContain("export type JsonValue =");
  expect(main.declarations.text).toContain(
    'import type * as Json from "./tiny-json.js";',
  );
  expect(main.declarations.text).toContain(
    "export declare const document: Json.JsonValue;",
  );
});

test("makes an imported module's coherent instances available to operators", () => {
  const project = compileProject([
    new Source.File(
      Source.fileId(0),
      "/box.hex",
      "opaque record Box = {value: Int}\n" +
        "export let create(value: Int): Box = Box({value})\n" +
        "honor Num<Box> =\n" +
        "    add(left, right) = create(left.value + right.value)\n" +
        "    multiply(left, right) = create(left.value * right.value)\n" +
        "    fromNat(value) = create(value)\n" +
        "honor Signed<Box> =\n" +
        "    subtract(left, right) = create(left.value - right.value)\n" +
        "    negate(value) = create(-value.value)\n" +
        "    fromInt(value) = create(value)",
    ),
    new Source.File(
      Source.fileId(1),
      "/main.hex",
      'import module Box from "./box"\n' +
        "export let answer: Box.Box = Box.create(20) + Box.create(22)",
    ),
  ]);

  expect(project.diagnostics).toEqual([]);
  const box = project.modules[0]!;
  const main = project.modules[1]!;
  expect(box.typed.diagnostics).toEqual([]);
  expect(main.typed.diagnostics).toEqual([]);
  expect(box.javascript.text).toContain("export { __Num_Box };");
  expect(main.javascript.text).toContain(
    "__Num_Box.add(Box.create(20), Box.create(22))",
  );
});

test("propagates coherent instances through the complete import graph", () => {
  const project = compileProject([
    new Source.File(
      Source.fileId(0),
      "/box.hex",
      "opaque record Box = {value: Int}\n" +
        "export let create(value: Int): Box = Box({value})\n" +
        "honor Num<Box> =\n" +
        "    add(left, right) = create(left.value + right.value)\n" +
        "    multiply(left, right) = create(left.value * right.value)\n" +
        "    fromNat(value) = create(value)\n" +
        "honor Signed<Box> =\n" +
        "    subtract(left, right) = create(left.value - right.value)\n" +
        "    negate(value) = create(-value.value)\n" +
        "    fromInt(value) = create(value)",
    ),
    new Source.File(
      Source.fileId(1),
      "/facade.hex",
      'import module Box from "./box"\n' +
        "export type Box = Box.Box\n" +
        "export let makeAnswer(): Box.Box = Box.create(20)",
    ),
    new Source.File(
      Source.fileId(2),
      "/main.hex",
      'import module Facade from "./facade"\n' +
        "export let answer: Facade.Box = Facade.makeAnswer() + Facade.makeAnswer()",
    ),
  ]);

  expect(project.diagnostics).toEqual([]);
  const facade = project.modules[1]!;
  const main = project.modules[2]!;
  expect(facade.javascript.text).toContain(
    "export { __Num_Box };",
  );
  expect(main.typed.diagnostics).toEqual([]);
  expect(main.javascript.text).toContain(
    "__Num_Box.add",
  );
});

test("deduplicates one coherent instance reached through a diamond import", () => {
  const project = compileProject([
    new Source.File(
      Source.fileId(0),
      "/box.hex",
      "opaque record Box = {value: Int}\n" +
        "export let create(value: Int): Box = Box({value})\n" +
        "honor Num<Box> =\n" +
        "    add(left, right) = create(left.value + right.value)\n" +
        "    multiply(left, right) = create(left.value * right.value)\n" +
        "    fromNat(value) = create(value)\n" +
        "honor Signed<Box> =\n" +
        "    subtract(left, right) = create(left.value - right.value)\n" +
        "    negate(value) = create(-value.value)\n" +
        "    fromInt(value) = create(value)",
    ),
    new Source.File(
      Source.fileId(1),
      "/left.hex",
      'import module Box from "./box"\nexport let left(): Box.Box = Box.create(20)',
    ),
    new Source.File(
      Source.fileId(2),
      "/right.hex",
      'import module Box from "./box"\nexport let right(): Box.Box = Box.create(22)',
    ),
    new Source.File(
      Source.fileId(3),
      "/main.hex",
      'import module Left from "./left"\n' +
        'import module Right from "./right"\n' +
        'import { Box } from "./box"\n' +
        "export let answer: Box = Left.left() + Right.right()",
    ),
  ]);

  expect(project.diagnostics).toEqual([]);
  expect(project.modules[3]!.typed.diagnostics).toEqual([]);
});

test("reports import cycles before project checking", () => {
  const project = compileProject([
    new Source.File(Source.fileId(0), "/a.hex", 'import "./b"'),
    new Source.File(Source.fileId(1), "/b.hex", 'import "./a"'),
  ]);

  expect(project.diagnostics.map(({ message }) => message)).toContain(
    "import cycle: /a.hex -> /b.hex -> /a.hex",
  );
});

test("rejects extern linkage to a Hexagon source module", () => {
  const project = compileProject([
    new Source.File(Source.fileId(0), "/library.hex", "export let answer: Int = 42"),
    new Source.File(
      Source.fileId(1),
      "/main.hex",
      'extern from "./library"\n    fun answer(): Int',
    ),
  ]);

  expect(project.diagnostics.map(({ message }) => message)).toContain(
    "use `import` for Hexagon modules; `extern from` is for foreign JavaScript",
  );
});

test("links constrained Hexagon exports through private ESM plumbing", () => {
  const project = compileProject([
    new Source.File(
      Source.fileId(0),
      "/math.hex",
      "export let plus<a: Num>(x: a, y: a): a = x + y",
    ),
    new Source.File(
      Source.fileId(1),
      "/main.hex",
      'import { plus } from "./math"\nlog("${plus(20, 22)}")',
    ),
    new Source.File(
      Source.fileId(2),
      "/namespace.hex",
      'import module Math from "./math"\nlog("${Math.plus(20, 22)}")',
    ),
  ]);

  expect(project.diagnostics).toEqual([]);
  const math = project.modules.find(({ source }) => source.path === "/math.hex")!;
  const main = project.modules.find(({ source }) => source.path === "/main.hex")!;
  const namespace = project.modules.find(({ source }) =>
    source.path === "/namespace.hex"
  )!;
  expect(main.typed.symbols.find(({ name }) => name === "plus")?.scheme.constraints)
    .toHaveLength(1);
  expect(math.javascript.text).toContain("export { plus as __plus };");
  expect(math.javascript.text).toContain("export { plusInt };");
  // The generic edition's import survives both forms, in both cases because the
  // source asked for it: an explicit import's names are emitted whether the body
  // reaches them or not. What moved at #440 is the *call*, which is concrete at
  // `Int` in both modules and so reaches the edition `math.js` exports for it —
  // by its public name in the named form, through the same name in the namespace
  // one, since a namespace alias never reaches an edition as `Math.plusInt`.
  //
  // **One line per specifier.** The edition joins the bindings the source wrote,
  // at the seat the source wrote them; in the namespace form it joins the second
  // line that form already emits for the internal constrained exports.
  expect(main.javascript.text).toContain(
    'import { __plus as plus, plusInt } from "./math.js";',
  );
  expect(main.javascript.text).toMatch(/logString\(String\(plusInt\(20, 22\)\)\)/u);
  expect(main.javascript.text).not.toContain("__Num_Int");
  expect(namespace.javascript.text).toContain(
    'import * as Math from "./math.js";',
  );
  expect(namespace.javascript.text).toContain(
    'import { __plus, plusInt } from "./math.js";',
  );
  expect(namespace.javascript.text).toMatch(/logString\(String\(plusInt\(20, 22\)\)\)/u);
  expect(math.javascript.diagnostics).toEqual([]);
  expect(main.javascript.diagnostics).toEqual([]);
  expect(namespace.javascript.diagnostics).toEqual([]);
});

test("compiles Unicode module paths and cultural M namespace aliases", () => {
  const project = compileProject([
    new Source.File(
      Source.fileId(0),
      "/गणित.hex",
      "export fun जोड़(left: Int, right: Int): Int = left + right",
    ),
    new Source.File(
      Source.fileId(1),
      "/main.hex",
      'import module Mगणित from "./गणित"\n' +
        "export let उत्तर: Int = Mगणित.जोड़(20, 22)",
    ),
  ]);

  expect(project.diagnostics).toEqual([]);
  const main = project.modules.find(({ source }) => source.path === "/main.hex")!;
  expect(main.typed.diagnostics).toEqual([]);
  expect(main.javascript.text).toContain('import * as Mगणित from "./गणित.js";');
  expect(main.javascript.text).toContain("const उत्तर = Mगणित.जोड़(20, 22);");
});

test("links exported aliases and enforces opaque module boundaries", () => {
  const project = compileProject([
    new Source.File(
      Source.fileId(0),
      "/vault.hex",
      "export type Pair(a) = (a, a)\n" +
        "opaque record Token = {value: Int}\n" +
        "export fun issue(value: Int): Token = Token({value = value})\n" +
        "export fun reveal(token: Token): Int = token.value",
    ),
    new Source.File(
      Source.fileId(1),
      "/main.hex",
      'import module Vault from "./vault"\n' +
        "export let pair: Vault.Pair(Int) = (1, 2)\n" +
        "let token = Vault.issue(7)\n" +
        "export let answer: Int = Vault.reveal(token)",
    ),
  ]);

  expect(project.diagnostics).toEqual([]);
  const vault = project.modules.find(({ source }) => source.path === "/vault.hex")!;
  expect(vault.javascript.text).not.toContain("export { Token }");
  expect(vault.declarations.text).toContain("export type Pair<a> = [a, a];");
  expect(vault.declarations.text).toContain("declare const TokenBrand: unique symbol;");

  const violation = compileProject([
    project.modules[0]!.source,
    new Source.File(
      Source.fileId(2),
      "/bad.hex",
      'import module Vault from "./vault"\n' +
        "let token = Vault.issue(7)\n" +
        "let leaked = token.value",
    ),
  ]);
  const bad = violation.modules.find(({ source }) => source.path === "/bad.hex")!;
  expect(bad.typed.diagnostics.map(({ message }) => message)).toContain(
    "cannot access field `value` of opaque record `Token`; use an operation exported by its home module",
  );
});

test("the implicit prelude supplies Ordering to Ord instances", () => {
  const project = compileProject([
    new Source.File(
      Source.fileId(0),
      "/point.hex",
      "export record Point derives (Eq) = {x: Int}\n" +
        "honor Ord<Point> =\n" +
        "    compare(left, right) =\n" +
        "        if left.x < right.x then Less else if left.x > right.x then Greater else Equal",
    ),
  ]);

  expect(project.diagnostics).toEqual([]);
  const point = project.modules.find(({ source }) => source.path === "/point.hex")!;
  expect(point.typed.diagnostics).toEqual([]);
  // Only the referenced constructors are imported from the implicit prelude.
  expect(point.javascript.text).toContain(
    'import { Less, Greater, Equal } from "./Prelude.js";',
  );
  // The prelude module is emitted because a module imports from it.
  expect(project.modules.map(({ source }) => source.path)).toContain("/Prelude.hex");
});

test("a project that never touches the prelude does not emit it", () => {
  const project = compileProject([
    new Source.File(Source.fileId(0), "/plain.hex", "export let answer: Int = 42"),
  ]);

  expect(project.diagnostics).toEqual([]);
  expect(project.modules.map(({ source }) => source.path)).toEqual(["/plain.hex"]);
});

test("Ord.compare must return Ordering, not a bare Int", () => {
  const project = compileProject([
    new Source.File(
      Source.fileId(0),
      "/bad.hex",
      "export record Point derives (Eq) = {x: Int}\n" +
        "honor Ord<Point> =\n" +
        "    compare(left, right) = 0",
    ),
  ]);

  const bad = project.modules.find(({ source }) => source.path === "/bad.hex")!;
  // `0` demands a `Num` instance for the now-`Ordering` result type, which it lacks.
  expect(bad.typed.diagnostics.map(({ message }) => message)).toContain(
    // The literal-specific message, which #147 extended to unions: `Ordering`
    // stopped being reachable only as a primitive-shaped type.
    "integer literal cannot have type `Ordering`",
  );
});

test("the implicit prelude supplies Option without an import", () => {
  const project = compileProject([
    new Source.File(
      Source.fileId(0),
      "/app.hex",
      "export fun head<a>(xs: Vector(a)): Option(a) =\n" +
        "    if Vector.length(xs) == 0 then None else Some(xs[0])\n",
    ),
  ]);

  expect(project.diagnostics).toEqual([]);
  const app = project.modules.find(({ source }) => source.path === "/app.hex")!;
  expect(app.typed.diagnostics).toEqual([]);
  expect(app.javascript.text).toContain('import { None, Some } from "./Option.js";');
  // Each prelude module is emitted only when used: Option is, Ordering's home is not.
  const paths = project.modules.map(({ source }) => source.path);
  expect(paths).toContain("/Option.hex");
  expect(paths).not.toContain("/Prelude.hex");
});

test("reports each module's own diagnostics on the project", () => {
  const project = compileProject([
    new Source.File(
      Source.fileId(0),
      "/app/main.hex",
      "export let broken: Int = missing(1)\n",
    ),
  ]);

  // Without aggregation a failing module reports success and hands back broken
  // JavaScript; the project's diagnostics must carry what the module found.
  const moduleDiagnostics = project.modules.flatMap(({ typed }) => typed.diagnostics);
  expect(moduleDiagnostics.length).toBeGreaterThan(0);
  expect(project.diagnostics.map(({ message }) => message)).toEqual(
    expect.arrayContaining(moduleDiagnostics.map(({ message }) => message)),
  );
});

test("reports a type error found only by the checker", () => {
  const project = compileProject([
    new Source.File(
      Source.fileId(0),
      "/app/main.hex",
      "let identity(value: Int): Int = value\nexport let out: Int = identity(\"text\")\n",
    ),
  ]);

  expect(project.diagnostics.length).toBeGreaterThan(0);
});
