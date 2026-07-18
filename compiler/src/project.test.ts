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

test("reports import cycles before project checking", () => {
  const project = compileProject([
    new Source.File(Source.fileId(0), "/a.hex", 'import "./b"'),
    new Source.File(Source.fileId(1), "/b.hex", 'import "./a"'),
  ]);

  expect(project.diagnostics.map(({ message }) => message)).toContain(
    "import cycle: /a.hex -> /b.hex -> /a.hex",
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
