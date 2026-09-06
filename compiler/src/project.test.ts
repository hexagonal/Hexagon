import { describe, expect, test } from "vitest";

import * as Source from "./support/source.js";
import { compileProject, unresolvedModuleMessage, type ProjectPackage } from "./project.js";
import {
  fullModuleName,
  moduleLayoutPath,
  type ProgramModule,
} from "./packages.js";

test("compiles a relative module import, alongside a bystander import", () => {
  // #762: there is one import form now — a module alias — so this no longer
  // has a named/aliased/namespace/effect quartet to cover. What is left to
  // pin: a module reached under its alias (`Geo`), and a second module
  // imported for nothing its importer names at all (`Telemetry`, standing in
  // for the retired effect import) still pulls its file into the project.
  const project = compileProject([
    new Source.File(
      Source.fileId(0),
      "/app/geometry.hex",
      "module Geometry\n\n" + "export record Point = {x: Int}\n" +
        "export fun make(x: Int): Point = Point({x = x})\n" +
        "export fun coordinate(point: Point): Int = point.x",
    ),
    new Source.File(
      Source.fileId(1),
      "/app/telemetry.hex",
      "module Telemetry\n\n" + 'Debug.log("loaded")',
    ),
    new Source.File(
      Source.fileId(2),
      "/app/main.hex",
      "module Main\n\n" + 'import Geometry as Geo\n' +
        'import Telemetry\n' +
        "export let point: Geo.Point = Geo.make(3)\n" +
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
    "/Hex/Debug.hex",
    "/app/geometry.hex",
    "/app/telemetry.hex",
    "/app/main.hex",
  ]);
  const main = project.modules.at(-1)!;
  expect(main.typed.diagnostics).toEqual([]);
  expect(main.javascript.text).toContain(
    'import * as Geo from "./Geometry.js";',
  );
  expect(main.javascript.text).toContain("const answer = Geo.coordinate(point);");
  expect(main.declarations.text).toContain("export declare const answer: number;");
});

test("re-exports extern bindings and opaque types through Hexagon modules", () => {
  const project = compileProject([
    new Source.File(
      Source.fileId(0),
      "/tiny-json.hex",
      "module TinyJson\n\n" + "extern from \"tiny-json\"\n" +
        "    export type JsonValue\n" +
        "    export fun parse(text: String): JsonValue",
    ),
    new Source.File(
      Source.fileId(1),
      "/main.hex",
      "module Main\n\n" + 'import TinyJson as Json\n' +
        "export let document: Json.JsonValue = Json.parse!(\"{}\")",
    ),
  ]);

  expect(project.diagnostics).toEqual([]);
  const bindings = project.modules[0]!;
  const main = project.modules[1]!;
  expect(bindings.typed.diagnostics).toEqual([]);
  expect(main.typed.diagnostics).toEqual([]);
  expect(bindings.javascript.text).toContain('import { parse } from "tiny-json";');
  expect(main.javascript.text).toContain('import * as Json from "./TinyJson.js";');
  expect(bindings.declarations.text).toContain("export type JsonValue =");
  expect(main.declarations.text).toContain(
    'import type * as Json from "./TinyJson.js";',
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
      "module Box\n\n" + "opaque record Box = {value: Int}\n" +
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
      "module Main\n\n" + 'import Box\n' +
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
      "module Box\n\n" + "opaque record Box = {value: Int}\n" +
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
      "module Facade\n\n" + 'import Box\n' +
        "export type Box = Box.Box\n" +
        "export let makeAnswer(): Box.Box = Box.create(20)",
    ),
    new Source.File(
      Source.fileId(2),
      "/main.hex",
      "module Main\n\n" + 'import Facade\n' +
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
      "module Box\n\n" + "opaque record Box = {value: Int}\n" +
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
      "module Left\n\n" + 'import Box\nexport let left(): Box.Box = Box.create(20)',
    ),
    new Source.File(
      Source.fileId(2),
      "/right.hex",
      "module Right\n\n" + 'import Box\nexport let right(): Box.Box = Box.create(22)',
    ),
    new Source.File(
      Source.fileId(3),
      "/main.hex",
      "module Main\n\n" + 'import Left\n' +
        'import Right\n' +
        'import Box\n' +
        "export let answer: Box = Left.left() + Right.right()",
    ),
  ]);

  expect(project.diagnostics).toEqual([]);
  expect(project.modules[3]!.typed.diagnostics).toEqual([]);
});

test("reports import cycles before project checking", () => {
  const project = compileProject([
    new Source.File(Source.fileId(0), "/a.hex", "module A\n\n" + 'import B'),
    new Source.File(Source.fileId(1), "/b.hex", "module B\n\n" + 'import A'),
  ]);

  expect(project.diagnostics.map(({ message }) => message)).toContain(
    "import cycle: A -> B -> A",
  );
});

test("rejects extern linkage to a Hexagon source module", () => {
  const project = compileProject([
    new Source.File(Source.fileId(0), "/library.hex", "module Library\n\n" + "export let answer: Int = 42"),
    new Source.File(
      Source.fileId(1),
      "/main.hex",
      "module Main\n\n" + 'extern from "./library"\n    fun answer(): Int',
    ),
  ]);

  expect(project.diagnostics.map(({ message }) => message)).toContain(
    "use `import` for Hexagon modules; `extern from` is for foreign JavaScript",
  );
});

test("links constrained Hexagon exports through private ESM plumbing", () => {
  // #762 retired the named import, which used to be this test's other half:
  // a same-named local reaching the generic edition directly (`import { plus }
  // from "./math"` emitting `import { __plus as plus, plusInt } ...`). There is
  // one import form left — the module alias — so what remains to pin is that
  // form's own plumbing: the private generic edition and the caller-driven
  // concrete specialization both survive, reached through the alias.
  const project = compileProject([
    new Source.File(
      Source.fileId(0),
      "/math.hex",
      "module Math\n\n" + "export let plus<a: Num>(x: a, y: a): a = x + y",
    ),
    new Source.File(
      Source.fileId(1),
      "/namespace.hex",
      "module Namespace\n\n" + 'import Math\nDebug.log("${Math.plus(20, 22)}")',
    ),
  ]);

  expect(project.diagnostics).toEqual([]);
  const math = project.modules.find(({ source }) => source.path === "/math.hex")!;
  const namespace = project.modules.find(({ source }) =>
    source.path === "/namespace.hex"
  )!;
  expect(math.javascript.text).toContain("export { plus as __plus };");
  expect(math.javascript.text).toContain("export { plusInt };");
  // The call is concrete at `Int`, so it reaches the edition `math.js` exports
  // for it — a namespace alias never reaches an edition as `Math.plusInt`, so
  // the private plumbing line the namespace form always emits is what carries it.
  expect(namespace.javascript.text).toContain(
    'import * as Math from "./Math.js";',
  );
  expect(namespace.javascript.text).toContain(
    'import { __plus, plusInt } from "./Math.js";',
  );
  expect(namespace.javascript.text).toMatch(/logString\(String\(plusInt\(20, 22\)\)\)/u);
  expect(math.javascript.diagnostics).toEqual([]);
  expect(namespace.javascript.diagnostics).toEqual([]);
});

// #829: a module's identity is its declared name, not its file's path, and
// the path-free import carries no `from` clause — so a caseless-script module
// now declares itself with the cultural `M` prefix (Lexer §3.1) in its own
// header, and the importer reaches it by that declared name alone. The
// source file's own path stays whatever it always was; only the emitted
// specifier is laid out from the declared name (Modules §11, Packages §6).
test("compiles Unicode module paths and cultural M namespace aliases", () => {
  const project = compileProject([
    new Source.File(
      Source.fileId(0),
      "/गणित.hex",
      "module Mगणित\n\n" + "export fun जोड़(left: Int, right: Int): Int = left + right",
    ),
    new Source.File(
      Source.fileId(1),
      "/main.hex",
      "module Main\n\n" + 'import Mगणित\n' +
        "export let उत्तर: Int = Mगणित.जोड़(20, 22)",
    ),
  ]);

  expect(project.diagnostics).toEqual([]);
  const main = project.modules.find(({ source }) => source.path === "/main.hex")!;
  expect(main.typed.diagnostics).toEqual([]);
  expect(main.javascript.text).toContain('import * as Mगणित from "./Mगणित.js";');
  expect(main.javascript.text).toContain("const उत्तर = Mगणित.जोड़(20, 22);");
});

test("links exported aliases and enforces opaque module boundaries", () => {
  const project = compileProject([
    new Source.File(
      Source.fileId(0),
      "/vault.hex",
      "module Vault\n\n" + "export type Pair(a) = (a, a)\n" +
        "opaque record Token = {value: Int}\n" +
        "export fun issue(value: Int): Token = Token({value = value})\n" +
        "export fun reveal(token: Token): Int = token.value",
    ),
    new Source.File(
      Source.fileId(1),
      "/main.hex",
      "module Main\n\n" + 'import Vault\n' +
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
      "module Bad\n\n" + 'import Vault\n' +
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
      "module Point\n\n" + "export record Point derives (Eq) = {x: Int}\n" +
        "honor Ord<Point> =\n" +
        "    compare(left, right) =\n" +
        "        if left.x < right.x then Ordering.Less else if left.x > right.x then Ordering.Greater else Ordering.Equal",
    ),
  ]);

  expect(project.diagnostics).toEqual([]);
  const point = project.modules.find(({ source }) => source.path === "/point.hex")!;
  expect(point.typed.diagnostics).toEqual([]);
  // Only the referenced constructors are imported from the implicit prelude.
  expect(point.javascript.text).toContain(
    'import { Less, Greater, Equal } from "./Hex/Ordering.js";',
  );
  // The prelude module is emitted because a module imports from it.
  expect(project.modules.map(({ source }) => source.path)).toContain("/Hex/Ordering.hex");
});

test("a project that never touches the prelude does not emit it", () => {
  const project = compileProject([
    new Source.File(Source.fileId(0), "/plain.hex", "module Plain\n\n" + "export let answer: Int = 42"),
  ]);

  expect(project.diagnostics).toEqual([]);
  expect(project.modules.map(({ source }) => source.path)).toEqual(["/plain.hex"]);
});

test("Ord.compare must return Ordering, not a bare Int", () => {
  const project = compileProject([
    new Source.File(
      Source.fileId(0),
      "/bad.hex",
      "module Bad\n\n" + "export record Point derives (Eq) = {x: Int}\n" +
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
      "module App\n\n" + "export fun head<a>(xs: Vector(a)): Option(a) =\n" +
        "    if Vector.length(xs) == 0 then None else Some(xs[0])\n",
    ),
  ]);

  expect(project.diagnostics).toEqual([]);
  const app = project.modules.find(({ source }) => source.path === "/app.hex")!;
  expect(app.typed.diagnostics).toEqual([]);
  // `None` is a shared constant a reference reads; `Some(...)` is an
  // application and erases (#770), so the import binds only the constant.
  expect(app.javascript.text).toContain('import { None } from "./Hex/Option.js";');
  expect(app.javascript.text).toContain('{ tag: "Some", value: __vectorIndex(xs, 0) }');
  // Each prelude module is emitted only when used: Option is, Ordering's home is not.
  const paths = project.modules.map(({ source }) => source.path);
  expect(paths).toContain("/Hex/Option.hex");
  expect(paths).not.toContain("/Hex/Prelude.hex");
});

test("reports each module's own diagnostics on the project", () => {
  const project = compileProject([
    new Source.File(
      Source.fileId(0),
      "/app/main.hex",
      "module Main\n\n" + "export let broken: Int = missing(1)\n",
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
      "module Main\n\n" + "let identity(value: Int): Int = value\nexport let out: Int = identity(\"text\")\n",
    ),
  ]);

  expect(project.diagnostics.length).toBeGreaterThan(0);
});


/** A module of the program, addressed as `moduleIndexOf` addresses one. */
function programModule(
  packageName: string | undefined,
  declaredName: string,
): ProgramModule {
  const fullName = fullModuleName(packageName, declaredName);
  return { packageName, declaredName, fullName, path: moduleLayoutPath(fullName) };
}

/**
 * Modules §10's rows, read one message at a time. The specimens below reach
 * every one of them through a real package set; these pin the wording at the
 * shapes a compile is awkward to steer into — an unnamed project in a contest,
 * several near misses joined.
 */
test("a contested name quotes each package and offers each full spelling", () => {
  expect(unresolvedModuleMessage("Geometry", {
    kind: "Contested",
    providers: [
      programModule("Acme", "Geometry"),
      programModule("Hex", "Geometry"),
    ],
  })).toBe(
    "`Geometry` is provided by `Acme` and `Hex`; write `import Acme.Geometry` " +
      "or `import Hex.Geometry`",
  );
});

test("an unnamed project is prose in the contest, the one participant with no name", () => {
  expect(unresolvedModuleMessage("Geometry", {
    kind: "Contested",
    providers: [
      programModule(undefined, "Geometry"),
      programModule("Hex", "Geometry"),
    ],
  })).toBe(
    "`Geometry` is provided by this project and `Hex`; write `import Geometry` " +
      "or `import Hex.Geometry`",
  );
});

test("a first segment naming an unlisted package names the manifest edit", () => {
  expect(unresolvedModuleMessage("Acme.Tools", { kind: "NotADependency", packageName: "Acme" }))
    .toBe(
      "`Acme` is not a dependency of this package; add `\"Acme\"` to `dependencies` " +
        "in `hexagon.json`",
    );
});

test("a self-qualified spelling names the declared name to write instead", () => {
  expect(unresolvedModuleMessage("MyApp.Geometry", {
    kind: "SelfQualified",
    declaredName: "Geometry",
  })).toBe(
    "no module `MyApp.Geometry`; a package's own modules are imported by their " +
      "declared names: `import Geometry`",
  );
});

test("an unknown name joins several near misses with `or`", () => {
  expect(unresolvedModuleMessage("Geometry", {
    kind: "Unknown",
    nearMisses: ["Render.Geometry", "Physics.Geometry"],
  })).toBe(
    "no module `Geometry`; did you mean `Render.Geometry` or `Physics.Geometry`?",
  );
});

// ---------------------------------------------------------------------------
// Packages §9 — the acceptance specimens, end to end through `compileProject`
// ---------------------------------------------------------------------------

/** A source-file factory with identities unique within one compile. */
function sourceFiles(): (path: string, text: string) => Source.File {
  let id = 0;
  return (path, text) => new Source.File(Source.fileId(id++), path, text);
}

/** One package of the closure, as a host hands it in (Packages §4.1). */
function dependency(
  name: string,
  dependencies: readonly string[],
  installed: readonly string[],
  files: readonly Source.File[],
): ProjectPackage {
  return { record: { name, dependencies, installed: new Set(installed) }, files };
}

function messagesOf(project: { diagnostics: readonly { message: string }[] }): readonly string[] {
  return project.diagnostics.map(({ message }) => message);
}

/**
 * §9 (a): the visible set, the not-a-dependency report, and §3.3's proviso —
 * one program, so that every arm is read off the same package set.
 */
describe("§9 (a) — the visible set and what a project may name", () => {
  const file = sourceFiles();
  const acmeFiles = [
    file(
      "/work/app/node_modules/acme/geometry.hex",
      "module Geometry\n\nimport Util\nexport let scale: Int = Util.scale",
    ),
    file("/work/app/node_modules/acme/util.hex", "module Util\n\nexport let scale: Int = 2"),
    file("/work/app/node_modules/acme/zed.hex", "module Zed.Helper\n\nexport let n: Int = 1"),
  ];
  const boltFiles = [
    file("/work/app/node_modules/bolt/util.hex", "module Util\n\nexport let n: Int = 7"),
  ];
  const compile = (text: string) =>
    compileProject([file("/work/app/main.hex", text)], {
      dependencies: ["Acme"],
      // What the project's own lookup answers with: `Bolt` and `Zed` are
      // installed and unlisted, which is exactly what §3.3's two arms read.
      installed: new Set(["Acme", "Bolt", "Zed"]),
      packages: [
        dependency("Acme", ["Bolt"], ["Bolt"], acmeFiles),
        dependency("Bolt", [], [], boltFiles),
      ],
    });

  test("the one visible provider answers a bare name", () => {
    const project = compile("module Main\n\nimport Geometry\nexport let n: Int = Geometry.scale");
    expect(messagesOf(project)).toEqual([]);
  });

  test("a dependency's own module wins over its dependency's, silently", () => {
    // `Acme.Geometry` writes `import Util`, and `Acme.Util` answers it — never
    // `Bolt.Util`, which `Acme` also sees (§3.2). `scale` exists in one of them.
    const project = compile("module Main\n\nimport Geometry\nexport let n: Int = Geometry.scale");
    expect(messagesOf(project)).toEqual([]);
  });

  test("a transitive dependency is invisible to the project's imports", () => {
    const project = compile("module Main\n\nimport Bolt.Util\nexport let n: Int = Util.n");
    const report = project.diagnostics.find(({ message }) => message.startsWith("`Bolt`"))!;
    expect(report.message).toBe(
      "`Bolt` is not a dependency of this package; add `\"Bolt\"` to `dependencies` " +
        "in `hexagon.json`",
    );
    // The repair is a manifest edit, which the compiler names and a host writes.
    expect(report.manifestDependency).toEqual({ packageName: "Bolt" });
  });

  /**
   * §3.3's proviso: `Zed` is installed and in no closure, and a module of a
   * package *in* the program is declared under that segment — so applying the
   * manifest edit would refuse that module, and the unknown-module report fires
   * with no edit offered.
   */
  test("the manifest edit is withheld where a module is declared under the segment", () => {
    const project = compile("module Main\n\nimport Zed.Tools\nexport let n: Int = 1");
    expect(messagesOf(project)).toContain("no module `Zed.Tools`");
    expect(project.diagnostics.every(({ manifestDependency }) =>
      manifestDependency === undefined
    )).toBe(true);
  });
});

/** §9 (c): two visible packages provide one declared name. */
test("§9 (c) — a contest between two packages is refused, both spellings offered", () => {
  const file = sourceFiles();
  const project = compileProject(
    [file("/work/app/main.hex", "module Main\n\nimport Color\nexport let n: Int = Color.n")],
    {
      dependencies: ["Acme", "Chroma"],
      installed: new Set(["Acme", "Chroma"]),
      packages: [
        dependency("Acme", [], [], [
          file("/work/app/node_modules/acme/color.hex", "module Color\n\nexport let n: Int = 1"),
        ]),
        dependency("Chroma", [], [], [
          file("/work/app/node_modules/chroma/color.hex", "module Color\n\nexport let n: Int = 2"),
        ]),
      ],
    },
  );
  expect(messagesOf(project)).toContain(
    "`Color` is provided by `Acme` and `Chroma`; write `import Acme.Color` or " +
      "`import Chroma.Color`",
  );
});

test("§9 (c) — the qualified spelling the contest offered resolves", () => {
  const file = sourceFiles();
  const project = compileProject(
    [file("/work/app/main.hex", "module Main\n\nimport Chroma.Color\nexport let n: Int = Color.n")],
    {
      dependencies: ["Acme", "Chroma"],
      installed: new Set(["Acme", "Chroma"]),
      packages: [
        dependency("Acme", [], [], [
          file("/work/app/node_modules/acme/color.hex", "module Color\n\nexport let n: Int = 1"),
        ]),
        dependency("Chroma", [], [], [
          file("/work/app/node_modules/chroma/color.hex", "module Color\n\nexport let n: Int = 2"),
        ]),
      ],
    },
  );
  expect(messagesOf(project)).toEqual([]);
});

/** §9 (d): a package never qualifies its own modules. */
test("§9 (d) — a named project qualifying its own module is refused", () => {
  const file = sourceFiles();
  const project = compileProject([
    file("/work/app/geometry.hex", "module Geometry\n\nexport let n: Int = 1"),
    file("/work/app/main.hex", "module Main\n\nimport MyApp.Geometry\nexport let n: Int = 1"),
  ], { packageName: "MyApp" });
  expect(messagesOf(project)).toContain(
    "no module `MyApp.Geometry`; a package's own modules are imported by their " +
      "declared names: `import Geometry`",
  );
});

/** §9 (f): coherence reads the whole graph, in two packages as in one. */
test("§9 (f) — a duplicate instance across packages is reported at the program check", () => {
  const file = sourceFiles();
  const project = compileProject([
    file(
      "/work/app/main.hex",
      "module Main\n\nimport Shape\nhonor Show<Shape.Shape> =\n    show(value) = \"main\"",
    ),
  ], {
    dependencies: ["Acme"],
    installed: new Set(["Acme"]),
    packages: [
      dependency("Acme", [], [], [
        file(
          "/work/app/node_modules/acme/shape.hex",
          "module Shape\n\nexport union Shape = Dot\nhonor Show<Shape> =\n    show(value) = \"dot\"",
        ),
      ]),
    ],
  });
  expect(messagesOf(project).some((message) => message.includes("duplicate"))).toBe(true);
});

/** §9 (g): the emitted layout, and what a dependency's module addresses. */
describe("§9 (g) — emission under packages", () => {
  const file = sourceFiles();
  const project = compileProject([
    file("/work/app/main.hex", "module Main\n\nimport Acme.Geometry\nexport let n: Int = Geometry.n"),
  ], {
    dependencies: ["Acme"],
    installed: new Set(["Acme"]),
    packages: [
      dependency("Acme", [], [], [
        file(
          "/work/app/node_modules/acme/geometry.hex",
          "module Geometry\n\nexception Boom\nexport let n: Int = 1",
        ),
        file(
          "/work/app/node_modules/acme/render/geometry.hex",
          "module Render.Geometry\n\nexport fun first(xs: Vector(Int)): Option(Int) =\n" +
            "    if Vector.length(xs) == 0 then None else Some(xs[0])",
        ),
      ]),
    ],
  });

  test("the project's module imports the dependency's by a relative path within the root", () => {
    expect(messagesOf(project)).toEqual([]);
    const main = project.modules.find(({ name }) => name === "Main")!;
    expect(main.javascript.text).toContain('import * as Geometry from "./Acme/Geometry.js";');
  });

  test("a dependency's module lies under its package, never at its source directory", () => {
    const geometry = project.modules.find(({ name }) => name === "Acme.Geometry")!;
    expect(geometry.path).toBe("/Acme/Geometry.hex");
    expect(geometry.source.path).toBe("/work/app/node_modules/acme/geometry.hex");
    expect(project.modules.map(({ path }) => path)).not.toContain(
      "/work/app/node_modules/acme/geometry.hex",
    );
  });

  test("a dependency's dotted module climbs out of two directories to reach the prelude", () => {
    const render = project.modules.find(({ name }) => name === "Acme.Render.Geometry")!;
    expect(render.path).toBe("/Acme/Render/Geometry.hex");
    expect(render.javascript.text).toContain('from "../../Hex/Option.js"');
  });

  test("an exception of a dependency's module brands its full name", () => {
    const geometry = project.modules.find(({ name }) => name === "Acme.Geometry")!;
    expect(geometry.javascript.text).toContain('{ $hex: "Acme.Geometry", name: __name }');
  });
});

/** §9 (h): the program-wide first-segment rule, at its whole-program seat. */
describe("§9 (h) — one reading of a dotted spelling", () => {
  const boltSource = (path: string, file: (path: string, text: string) => Source.File) =>
    file(path, "module Acme.Tools\n\nexport let n: Int = 1");

  test("no package `Acme` in the program leaves the declared name lawful", () => {
    const file = sourceFiles();
    const project = compileProject([
      file("/work/app/main.hex", "module Main\n\nimport Acme.Tools\nexport let n: Int = Tools.n"),
    ], {
      dependencies: ["Bolt"],
      installed: new Set(["Bolt"]),
      packages: [
        dependency("Bolt", [], [], [
          boltSource("/work/app/node_modules/bolt/tools.hex", file),
        ]),
      ],
    });
    expect(messagesOf(project)).toEqual([]);
  });

  test("adding the package refuses the module at the whole-program check", () => {
    const file = sourceFiles();
    const project = compileProject([
      file("/work/app/main.hex", "module Main\n\nexport let n: Int = 1"),
    ], {
      dependencies: ["Bolt", "Acme"],
      installed: new Set(["Bolt", "Acme"]),
      packages: [
        dependency("Bolt", [], [], [
          boltSource("/work/app/node_modules/bolt/tools.hex", file),
        ]),
        dependency("Acme", [], [], [
          file("/work/app/node_modules/acme/tools.hex", "module Tools\n\nexport let n: Int = 1"),
        ]),
      ],
    });
    expect(messagesOf(project)).toContain(
      "module `Acme.Tools` of package `Bolt` begins with the name of the package " +
        "`Acme`, also in this program; drop the dependency that brings `Acme` or " +
        "the one that brings `Bolt`, or combine them once `Acme` is renamed or " +
        "`Bolt` renames its module",
    );
  });

  test("the project's own module against a package it reaches only through a dependency", () => {
    const file = sourceFiles();
    const project = compileProject([
      file("/work/app/parser.hex", "module Acme.Parser\n\nexport let n: Int = 1"),
    ], {
      dependencies: ["Bolt"],
      installed: new Set(["Bolt"]),
      packages: [
        dependency("Bolt", ["Acme"], ["Acme"], [
          file("/work/app/node_modules/bolt/bolt.hex", "module Bolt\n\nexport let n: Int = 1"),
        ]),
        dependency("Acme", [], [], [
          file("/work/app/node_modules/acme/tools.hex", "module Tools\n\nexport let n: Int = 1"),
        ]),
      ],
    });
    expect(messagesOf(project)).toContain(
      "module `Acme.Parser` of the project begins with the name of the package " +
        "`Acme`, also in this program (brought in by `Bolt`); rename the module, " +
        "or drop the dependency that brings `Acme`",
    );
  });

  test("a dependency's module beginning with the project's own name", () => {
    const file = sourceFiles();
    const project = compileProject([
      file("/work/app/main.hex", "module Main\n\nexport let n: Int = 1"),
    ], {
      packageName: "MyApp",
      dependencies: ["Bolt"],
      installed: new Set(["Bolt"]),
      packages: [
        dependency("Bolt", [], [], [
          file(
            "/work/app/node_modules/bolt/tools.hex",
            "module MyApp.Tools\n\nexport let n: Int = 1",
          ),
        ]),
      ],
    });
    expect(messagesOf(project)).toContain(
      "module `MyApp.Tools` of package `Bolt` begins with the name of this " +
        "project, `MyApp`; rename the project or drop its manifest `name`, drop " +
        "the dependency that brings `Bolt`, or combine them once `Bolt` renames " +
        "its module",
    );
  });

  test("the other package's manifest is carried as a related location where the host holds one", () => {
    const file = sourceFiles();
    const manifest = file("/work/app/node_modules/acme/hexagon.json", "{\"name\": \"Acme\"}");
    const project = compileProject([
      file("/work/app/main.hex", "module Main\n\nexport let n: Int = 1"),
    ], {
      dependencies: ["Bolt", "Acme"],
      installed: new Set(["Bolt", "Acme"]),
      packages: [
        {
          record: { name: "Bolt", dependencies: [], installed: new Set() },
          files: [
            file("/work/app/node_modules/bolt/tools.hex", "module Acme.Tools\n\nexport let n: Int = 1"),
          ],
        },
        {
          record: {
            name: "Acme",
            dependencies: [],
            installed: new Set(),
            manifest: {
              fileId: manifest.id,
              start: { offset: 0, line: 0, column: 0 },
              end: { offset: 1, line: 0, column: 1 },
            },
          },
          files: [
            file("/work/app/node_modules/acme/tools.hex", "module Tools\n\nexport let n: Int = 1"),
          ],
        },
      ],
    });
    const report = project.diagnostics.find(({ message }) =>
      message.startsWith("module `Acme.Tools`")
    )!;
    expect(report.labels).toEqual([
      expect.objectContaining({ message: "`Acme` is declared here" }),
    ]);
  });
});

/** §9 (i): the runtime modules are members of `Hex` like any other. */
test("§9 (i) — a runtime module binds an alias and exports nothing", () => {
  const file = sourceFiles();
  const project = compileProject([
    file(
      "/work/app/main.hex",
      "module Main\n\nimport Hex.Runtime.VectorTrie\nexport let n: Int = VectorTrie.size",
    ),
  ]);
  expect(messagesOf(project)).toContain("module `VectorTrie` does not export `size`");
});

/**
 * §3.3's contest order, and the two arms of §7's not-a-dependency row, read
 * end to end — the order and the two gates are `resolveModuleName`'s and no
 * hand-built provider list can show them.
 */
describe("§3.3 — the order a contest is printed in, and who draws the manifest edit", () => {
  test("`dependencies` order, then `Hex`", () => {
    const file = sourceFiles();
    const project = compileProject([
      file("/work/app/main.hex", "module Main\n\nimport Option\nexport let n: Int = Option.n"),
    ], {
      dependencies: ["Acme"],
      installed: new Set(["Acme"]),
      packages: [
        dependency("Acme", [], [], [
          file("/work/app/node_modules/acme/option.hex", "module Option\n\nexport let n: Int = 1"),
        ]),
      ],
    });
    // `Hex` last, however the visible set happens to be assembled: §7's first
    // row fixes the order of the names in the sentence.
    expect(messagesOf(project)).toContain(
      "`Option` is provided by `Acme` and `Hex`; write `import Acme.Option` or " +
        "`import Hex.Option`",
    );
  });

  test("an uninstalled first segment draws the unknown-module row and no edit", () => {
    const file = sourceFiles();
    const project = compileProject([
      file("/work/app/main.hex", "module Main\n\nimport Typo.Tools\nexport let n: Int = Tools.n"),
    ], {
      dependencies: ["Acme"],
      // Nothing named `Typo` is installed, so §3.4's row is the true one: the
      // manifest edit would write a package name that does not exist.
      installed: new Set(["Acme"]),
      packages: [
        dependency("Acme", [], [], [
          file("/work/app/node_modules/acme/geometry.hex", "module Geometry\n\nexport let n: Int = 1"),
        ]),
      ],
    });
    expect(messagesOf(project)).toContain("no module `Typo.Tools`");
    expect(project.diagnostics.every(({ manifestDependency }) =>
      manifestDependency === undefined
    )).toBe(true);
  });

  /**
   * §3.3's proviso reads **dotted** declared names only: Modules §2.2 leaves an
   * undotted module untouched — "`module Json` beside a dependency `Json` is
   * the companion idiom's plainest spelling" — so adding the entry refuses
   * nothing and the edit is owed.
   */
  test("an undotted module of the segment's name does not withhold the edit", () => {
    const file = sourceFiles();
    const project = compileProject([
      file("/work/app/zed.hex", "module Zed\n\nexport let n: Int = 1"),
      file("/work/app/main.hex", "module Main\n\nimport Zed.Tools\nexport let n: Int = Tools.n"),
    ], {
      installed: new Set(["Zed"]),
    });
    const report = project.diagnostics.find(({ message }) => message.startsWith("`Zed`"))!;
    expect(report.message).toBe(
      "`Zed` is not a dependency of this package; add `\"Zed\"` to `dependencies` " +
        "in `hexagon.json`",
    );
    expect(report.manifestDependency).toEqual({ packageName: "Zed" });
  });
});

/**
 * Packages §3.3 read backwards, inside a dependency: every module name a report
 * prints, and every import line it offers, is spelled as *that package's* own
 * reader must write it — never `Acme.Lib` inside `Acme`, which the next compile
 * refuses with "a package's own modules are imported by their declared names".
 */
describe("a repair offered inside a dependency is a line that dependency can write", () => {
  const HEFT_LIB = [
    "export constraint Heft<a: Num> =",
    "    heft(value: a): a",
    "export let useHeft<a: Heft>(n: a): a = heft(n)",
    "",
  ].join("\n");

  test("an import cycle inside a dependency names its modules as that package spells them", () => {
    const file = sourceFiles();
    const project = compileProject([
      file("/work/app/main.hex", "module Main\n\nexport let n: Int = 1"),
    ], {
      dependencies: ["Acme"],
      installed: new Set(["Acme"]),
      packages: [
        dependency("Acme", [], [], [
          file("/work/app/node_modules/acme/a.hex", "module A\n\nimport B\nexport let n: Int = B.n"),
          file("/work/app/node_modules/acme/b.hex", "module B\n\nimport A\nexport let n: Int = A.n"),
        ]),
      ],
    });
    // Modules §8.1's cycle is named by its modules, and `Acme`'s author writes
    // them `A` and `B` — `Acme.A` is a spelling §3.3 refuses them.
    expect(messagesOf(project)).toContain("import cycle: A -> B -> A");
  });

  test("the constraint-route clause names the module without the package segment", () => {
    const file = sourceFiles();
    const project = compileProject([
      file("/work/app/main.hex", "module Main\n\nexport let n: Int = 1"),
    ], {
      dependencies: ["Acme"],
      installed: new Set(["Acme"]),
      packages: [
        dependency("Acme", [], [], [
          file("/work/app/node_modules/acme/lib.hex", `module Lib\n\n${HEFT_LIB}`),
          file(
            "/work/app/node_modules/acme/mid.hex",
            "module Mid\n\nimport Lib\n" +
              "export let forward<a: Lib.Heft>(n: a): a = Lib.useHeft(n)\n",
          ),
          file(
            "/work/app/node_modules/acme/caller.hex",
            "module Caller\n\nimport Mid\n" +
              "export let caller(n, stop: Bool) = if stop then n + n else Mid.forward(n)\n",
          ),
        ]),
      ],
    });
    expect(messagesOf(project)).toContain(
      "exported function `caller` must declare every constraint in its signature; " +
        "write `<a: Lib.Heft>` — `Heft` is declared in module `Lib`; " +
        "`import Lib` and spell it `Lib.Heft`",
    );
  });
});
