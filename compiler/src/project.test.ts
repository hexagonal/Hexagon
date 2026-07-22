import { expect, test } from "vitest";

import * as Source from "./support/source.js";
import { compileProject } from "./project.js";

test("compiles relative named, aliased, namespace, and effect imports", () => {
  const project = compileProject([
    new Source.File(
      Source.fileId(0),
      "/app/geometry.hex",
      "export record Point = {x: Int}\n" +
        "export fun make(x: Int): Point = Point({x: x})\n" +
        "export fun coordinate(point: Point): Int = point.x",
    ),
    new Source.File(
      Source.fileId(1),
      "/app/telemetry.hex",
      'console.log("loaded")',
    ),
    new Source.File(
      Source.fileId(2),
      "/app/main.hex",
      'import { Point, make as makePoint } from "./geometry"\n' +
        'import * as Geo from "./geometry"\n' +
        'import "./telemetry"\n' +
        "export let point: Point = makePoint(3)\n" +
        "export let answer = point.coordinate()",
    ),
  ]);

  expect(project.diagnostics).toEqual([]);
  expect(project.modules.map(({ source }) => source.path)).toEqual([
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
      'import * as Json from "./tiny-json"\n' +
        "export let document: Json.JsonValue = Json.parse(\"{}\")",
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
      "export opaque record Box = {value: Int}\n" +
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
      'import * as Box from "./box"\n' +
        "export let answer = Box.create(20) + Box.create(22)",
    ),
  ]);

  expect(project.diagnostics).toEqual([]);
  const box = project.modules[0]!;
  const main = project.modules[1]!;
  expect(box.typed.diagnostics).toEqual([]);
  expect(main.typed.diagnostics).toEqual([]);
  expect(box.javascript.text).toContain("export { __hex_instance_Num_Box };");
  expect(main.javascript.text).toContain(
    "__hex_imported_0___hex_instance_Num_Box.add(Box.create(20), Box.create(22))",
  );
});

test("propagates coherent instances through the complete import graph", () => {
  const project = compileProject([
    new Source.File(
      Source.fileId(0),
      "/box.hex",
      "export opaque record Box = {value: Int}\n" +
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
      'import * as Box from "./box"\n' +
        "export let makeAnswer(): Box.Box = Box.create(20)",
    ),
    new Source.File(
      Source.fileId(2),
      "/main.hex",
      'import * as Facade from "./facade"\n' +
        "export let answer = Facade.makeAnswer() + Facade.makeAnswer()",
    ),
  ]);

  expect(project.diagnostics).toEqual([]);
  const facade = project.modules[1]!;
  const main = project.modules[2]!;
  expect(facade.javascript.text).toContain(
    "export { __hex_imported_0___hex_instance_Num_Box };",
  );
  expect(main.typed.diagnostics).toEqual([]);
  expect(main.javascript.text).toContain(
    "__hex_imported_1___hex_imported_0___hex_instance_Num_Box.add",
  );
});

test("deduplicates one coherent instance reached through a diamond import", () => {
  const project = compileProject([
    new Source.File(
      Source.fileId(0),
      "/box.hex",
      "export opaque record Box = {value: Int}\n" +
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
      'import * as Box from "./box"\nexport let left(): Box.Box = Box.create(20)',
    ),
    new Source.File(
      Source.fileId(2),
      "/right.hex",
      'import * as Box from "./box"\nexport let right(): Box.Box = Box.create(22)',
    ),
    new Source.File(
      Source.fileId(3),
      "/main.hex",
      'import * as Left from "./left"\n' +
        'import * as Right from "./right"\n' +
        "export let answer = Left.left() + Right.right()",
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
    new Source.File(Source.fileId(0), "/library.hex", "export let answer = 42"),
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
      "export let plus(x, y) = x + y",
    ),
    new Source.File(
      Source.fileId(1),
      "/main.hex",
      'import { plus } from "./math"\nconsole.log(plus(20, 22))',
    ),
    new Source.File(
      Source.fileId(2),
      "/namespace.hex",
      'import * as Math from "./math"\nconsole.log(Math.plus(20, 22))',
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
  expect(math.javascript.text).toMatch(/export \{ plus as __hex_export\d+ \};/u);
  expect(math.javascript.text).toContain("export { plusInt };");
  expect(main.javascript.text).toMatch(
    /import \{ __hex_export\d+ as plus \} from "\.\/math\.js";/u,
  );
  expect(main.javascript.text).toContain("console.log(plus(20, 22,");
  expect(namespace.javascript.text).toContain(
    'import * as Math from "./math.js";',
  );
  expect(namespace.javascript.text).toMatch(
    /import \{ __hex_export\d+ \} from "\.\/math\.js";/u,
  );
  expect(namespace.javascript.text).toMatch(
    /console\.log\(__hex_export\d+\(20, 22,/u,
  );
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
      'import * as Mगणित from "./गणित"\n' +
        "export let उत्तर = Mगणित.जोड़(20, 22)",
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
        "export opaque record Token = {value: Int}\n" +
        "export fun issue(value: Int): Token = Token({value: value})\n" +
        "export fun reveal(token: Token): Int = token.value",
    ),
    new Source.File(
      Source.fileId(1),
      "/main.hex",
      'import * as Vault from "./vault"\n' +
        "export let pair: Vault.Pair(Int) = (1, 2)\n" +
        "let token = Vault.issue(7)\n" +
        "export let answer = Vault.reveal(token)",
    ),
  ]);

  expect(project.diagnostics).toEqual([]);
  const vault = project.modules.find(({ source }) => source.path === "/vault.hex")!;
  expect(vault.javascript.text).not.toContain("export { Token }");
  expect(vault.declarations.text).toContain("export type Pair<a> = [a, a];");
  expect(vault.declarations.text).toContain("declare const __hex_opaque_Token: unique symbol;");

  const violation = compileProject([
    project.modules[0]!.source,
    new Source.File(
      Source.fileId(2),
      "/bad.hex",
      'import * as Vault from "./vault"\n' +
        "let token = Vault.issue(7)\n" +
        "let leaked = token.value",
    ),
  ]);
  const bad = violation.modules.find(({ source }) => source.path === "/bad.hex")!;
  expect(bad.typed.diagnostics.map(({ message }) => message)).toContain(
    "cannot access field `value` of opaque record `Token`; use an operation exported by its home module",
  );
});
