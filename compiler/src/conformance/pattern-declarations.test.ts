import { describe, expect, test } from "vitest";

import { compileFiles, projectDiagnostics, runMain, runProject } from "../support/test-project.js";

const STDLIB = import.meta.glob("../../../stdlib/*.hex", {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>;

const RAT = Object.entries(STDLIB).find(([path]) => path.endsWith("/Rat.hex"))?.[1];
if (RAT === undefined) throw new Error("no stdlib/Rat.hex");

const main = (source: string): string => `module Main\n\n${source}`;
const ratProject = (source: string): readonly (readonly [string, string])[] => [
  ["/main.hex", main(`import Rat\n${source}`)],
  ["/Rat.hex", RAT],
];

function messages(source: string): readonly string[] {
  return projectDiagnostics(main(source));
}

/** Makes Debug's captured sink and every emitted module fresh for this test. */
const distinct = (label: string) => (_path: string, javascript: string): string =>
  `// ${label}\n${javascript}`;

const host = globalThis as unknown as {
  console: { log: (...values: unknown[]) => void };
};

async function written(body: () => Promise<void>): Promise<unknown[][]> {
  const lines: unknown[][] = [];
  const original = host.console.log;
  host.console.log = (...values: unknown[]) => lines.push(values);
  try {
    await body();
  } finally {
    host.console.log = original;
  }
  return lines;
}

describe("pattern declarations (#834)", () => {
  test("private headed and unheaded patterns have both directions", async () => {
    const exports = await runMain(main(
      "record Box = {value: Int}\n" +
        "pattern boxed(value: Int): Box\n" +
        "    view(box) = box.value\n" +
        "    build(value) = Box({value = value})\n" +
        "pattern inferred\n" +
        "    view(box: Box) = box.value\n" +
        "    build(value) = Box({value = value})\n" +
        "export let headed: Int =\n" +
        "    let (value)boxed = (41)boxed\n" +
        "    value\n" +
        "export let unheaded: Int =\n" +
        "    let (value)inferred = (42)inferred\n" +
        "    value\n",
    ));
    expect([exports["headed"], exports["unheaded"]]).toEqual([41, 42]);
  });

  test("a build may recursively use its pattern from the declaration line", async () => {
    const exports = await runMain(main(
      "pattern down(value: Int): Int\n" +
        "    view(value) = value\n" +
        "    build(value) = if value == 0 then 0 else (value - 1)down\n" +
        "export let zero: Int = (3)down\n",
    ));
    expect(exports["zero"]).toBe(0);
  });

  test("a view may recursively use its pattern's build from the declaration line", async () => {
    const exports = await runMain(main(
      "pattern normalized(value: Int): Int\n" +
        "    view(value) = (value)normalized\n" +
        "    build(value) = value\n" +
        "export let answer: Int =\n" +
        "    let (value)normalized = 1\n" +
        "    value\n",
    ));
    expect(exports["answer"]).toBe(1);
  });

  test("Rat construction, matching, and the exact Playground calculations run", async () => {
    const source =
      "let half = (1, 2)rat\n" +
      "let third = (1, 3)rat\n" +
      "let fiveSixths = half + third\n" +
      "let threeHalves = half / third\n" +
      "\n" +
      "Debug.log(\"1/2 + 1/3 = ${fiveSixths}\")\n" +
      "Debug.log(\"1/2 / 1/3 = ${threeHalves}\")\n" +
      "Debug.log(\"Does 10/12 = 5/6? ${(10, 12)rat == (5, 6)rat}\")\n" +
      "\n" +
      "export let parts: (BigInt, BigInt) =\n" +
      "    let (top, bottom)rat = (10, 12)rat\n" +
      "    (top, bottom)\n";
    const lines = await written(async () => {
      const exports = await runProject(ratProject(source), {
        transform: distinct("pattern Rat Playground"),
      });
      expect(exports["parts"]).toEqual([5n, 6n]);
    });
    expect(lines).toEqual([
      ["1/2 + 1/3 = 5/6"],
      ["1/2 / 1/3 = 3/2"],
      ["Does 10/12 = 5/6? True"],
    ]);
  });

  test("Float components use SameValueZero, including signed zero", async () => {
    const exports = await runMain(main(
      "export record Colour = {red: Float, green: Float, blue: Float}\n" +
        "pattern rgb(red: Float, green: Float, blue: Float): Colour\n" +
        "    view(colour) = (colour.red, colour.green, colour.blue)\n" +
        "    build(red, green, blue) = Colour({red = red, green = green, blue = blue})\n" +
        "export fun name(colour: Colour): String =\n" +
        "    match colour\n" +
        "        (0.0, _, _)rgb => \"zero\"\n" +
        "        _ => \"other\"\n" +
        "export let negativeZero: String = name((-0.0, 1.0, 1.0)rgb)\n",
    ));
    expect(exports["negativeZero"]).toBe("zero");
  });

  test("a match-only pattern cannot construct", () => {
    expect(messages(
      "record Colour = {red: Float}\n" +
        "pattern rgb(red: Float): Colour\n" +
        "    view(colour) = colour.red\n" +
        "let colour = (0.0)rgb\n",
    )).toEqual(["`rgb` is a match-only pattern: its declaration has no `build`"]);
  });

  test("head, arity, purity, export, and alias diagnostics keep their dedicated seats", () => {
    expect(messages(
      "extern from \"side-effect\"\n" +
        "    fun noisy(): Unit\n" +
        "record Box = {value: Int}\n" +
        "export pattern absent\n" +
        "    view(box: Box) = box.value\n" +
        "pattern zero: Box\n" +
        "    view(box) = ()\n" +
        "pattern noisy(value: Unit): Box\n" +
        "    view(box) = noisy!()\n" +
        "pattern one(value: Int): Box\n" +
        "    view(box) = box.value\n" +
        "    build(value) = Box({value = value})\n" +
        "let bad =\n" +
        "    let (left, right)one = Box({value = 1})\n" +
        "    left\n" +
        "pattern local = Main.one\n",
    )).toEqual([
      "an exported pattern writes its head: `pattern absent(c1: Int): Box`",
      "a pattern has at least one component; a test with no components is a guard",
      "a pattern's `view` is run by matching, so it is pure — the demand is the pattern head's, and this function's face is `->!`",
      "`one` has 1 component; write `(_)one`",
      "module `Main` exports no pattern `one`",
    ]);
  });

  test("an alias selects a contested imported spelling", () => {
    const colour =
      "module Colour\n\n" +
      "export record Colour = {red: Float}\n" +
      "export pattern rgb(red: Float): Colour\n" +
      "    view(colour) = colour.red\n" +
      "    build(red) = Colour({red = red})\n";
    const paint =
      "module Paint\n\n" +
      "import Colour\n" +
      "export pattern rgb(red: Float): Colour.Colour\n" +
      "    view(colour) = colour.red\n" +
      "    build(red) = Colour.Colour({red = red})\n";
    const client =
      "module Main\n\n" +
      "import Colour\n" +
      "import Paint\n" +
      "pattern colourRgb = Colour.rgb\n" +
      "export let red: Float =\n" +
      "    let (component)colourRgb = (0.25)colourRgb\n" +
      "    component\n";
    const project = compileFiles([["/colour.hex", colour], ["/paint.hex", paint], ["/main.hex", client]]);
    expect(project.diagnostics.map(({ message }) => message)).toEqual([]);
    const emitted = project.modules.find(({ source }) => source.path === "/main.hex")!.javascript.text;
    expect(emitted).toContain("Colour.__patt_rgb.build(0.25)");
    expect(emitted).toContain("Colour.__patt_rgb.view(");
  });

  test("the expected type opens an unimported nominal home's pattern", async () => {
    const box =
      "module Box\n\n" +
      "export record Box = {value: Int}\n" +
      "export pattern boxed(value: Int): Box\n" +
      "    view(box) = box.value\n" +
      "    build(value) = Box({value = value})\n";
    const mid =
      "module Mid\n\n" +
      "import Box\n" +
      "export let make(): Box.Box = Box.Box({value = 42})\n";
    const client =
      "module Main\n\n" +
      "import Mid\n" +
      "export let answer: Int =\n" +
      "    let (value)boxed = Mid.make()\n" +
      "    value\n";
    const files = [
      ["/box.hex", box],
      ["/mid.hex", mid],
      ["/main.hex", client],
    ] as const;
    const project = compileFiles(files);
    const emitted = project.modules.find(({ source }) => source.path === "/main.hex")!.javascript.text;
    expect(emitted).toContain('import * as Box from "./Box.js";');
    expect(emitted).toContain("Box.__patt_boxed.view(");
    const exports = await runProject(files, { transform: distinct("pattern expected-type door") });
    expect(exports["answer"]).toBe(42);
  });

  test("fixed pattern exports protect numeric suffix candidates across an import", async () => {
    const home =
      "module Views\n\n" +
      "export constraint Read<a> =\n    read(value: a) -> Int\n" +
      "export record Box = {value: Int}\n" +
      "honor Read<Box> =\n    read(box) = box.value\n" +
      "export pattern map(value: Int): Int\n    view(value) = value\n" +
      "export pattern map_1(value: Int): Int\n    view(value) = value\n" +
      "export fun patt_map<a: Read>(value: a): Int = read(value)\n";
    const client =
      "module Main\n\n" +
      "import Views\n" +
      "export let answer: Int = Views.patt_map(Views.Box({value = 42}))\n";
    const project = compileFiles([["/views.hex", home], ["/main.hex", client]]);
    expect(project.diagnostics.map(({ message }) => message)).toEqual([]);
    const views = project.modules.find(({ source }) => source.path === "/views.hex")!;
    const mainModule = project.modules.find(({ source }) => source.path === "/main.hex")!;
    expect(views.javascript.text).toContain("const __patt_map = { view: value => value };");
    expect(views.javascript.text).toContain("const __patt_map_1 = { view: value => value };");
    expect(views.javascript.text).toContain("export { patt_map as __patt_map_2 };");
    expect(views.declarations.text).toContain("export declare const __patt_map: {");
    expect(views.declarations.text).toContain("export declare const __patt_map_1: {");
    expect(mainModule.javascript.text).toContain(
      'import { __patt_map_2 as __patt_map } from "./Views.js";',
    );
    const exports = await runProject([["/views.hex", home], ["/main.hex", client]]);
    expect(exports["answer"]).toBe(42);
  });

  test("nested views are shared across arms and remain distinct at distinct positions", () => {
    const source = main(
      "export record Inner = {value: Int}\n" +
        "export record Outer = {inner: Inner}\n" +
        "pattern inner(value: Int): Inner\n" +
        "    view(value) = value.value\n" +
        "    build(value) = Inner({value = value})\n" +
        "pattern outer(inner: Inner): Outer\n" +
        "    view(value) = value.inner\n" +
        "    build(inner) = Outer({inner = inner})\n" +
        "export fun classify(value: Outer): String =\n" +
        "    match value\n" +
        "        ((0)inner)outer => \"zero\"\n" +
        "        ((1)inner)outer => \"one\"\n" +
        "        (_)outer => \"other\"\n" +
        "export let one: String = classify(((1)inner)outer)\n",
    );
    const project = compileFiles([["/main.hex", source]]);
    expect(project.diagnostics.map(({ message }) => message)).toEqual([]);
    const javascript = project.modules.find(({ source: file }) => file.path === "/main.hex")!.javascript.text;
    expect((javascript.match(/\.view\(/gu) ?? []).length).toBe(2);
  });
});

describe("suffix construction marks (§14)", () => {
  const impureBuild =
    "extern from \"./world.js\"\n" +
    "    fun make(value: Int): Box\n" +
    "record Box = {value: Int}\n" +
    "pattern boxed(value: Int): Box\n" +
    "    view(box) = box.value\n" +
    "    build = make\n";

  test("a constant-impure build requires `!`, and rejects bare and `?`", () => {
    expect(messages(
      impureBuild +
        "let bare = (1)boxed\n" +
        "let linked = (1)boxed?\n",
    )).toEqual([
      "this call runs effects, so `boxed` wants `!`, not no mark",
      "this call runs effects, so `boxed` wants `!`, not `?`",
    ]);
  });

  test("a conduit build is bare at a pure callback and marked at an impure callback", () => {
    expect(messages(
      "extern from \"./world.js\"\n" +
        "    fun save(text: String): Unit\n" +
        "let identity(value: a): a = value\n" +
        "let tap(step: () ->? Int): (() ->? Int) =\n" +
        "    let _ = step?()\n" +
        "    step\n" +
        "pattern boxed\n" +
        "    view = identity\n" +
        "    build = tap\n" +
        "let pure = (() => 1)boxed\n" +
        "let impure = (() =>\n" +
        "    save!(\"x\")\n" +
        "    1)boxed!\n",
    )).toEqual([]);
  });

  test("the next call's mark belongs to a returned function, never to the build", () => {
    expect(messages(
      "extern from \"./world.js\"\n" +
        "    fun save(text: String): Unit\n" +
        "record Box = {value: Int}\n" +
        "let factory(value: Int): (() ->! Int) = () =>\n" +
        "    save!(\"x\")\n" +
        "    value\n" +
        "pattern maker(value: Int): (() ->! Int)\n" +
        "    view(value) = 0\n" +
        "    build = factory\n" +
        "let answer = ((1)maker)!()\n" +
        "let wrong = (1)maker!()\n",
    )).toEqual([
      "this call runs effects, so this call wants `!`, not no mark",
      "this call is pure, so `maker` wants no mark, not `!`",
    ]);
  });
});

describe("unheaded inference and a view's effect demand", () => {
  test("an unheaded group unifies `view` and `build` at Int", () => {
    expect(messages(
      "pattern identity\n" +
        "    view(value) = value\n" +
        "    build(value: Int) = value\n" +
        "export let roundTrip: Int =\n" +
        "    let (value)identity = (42)identity\n" +
        "    value\n",
    )).toEqual([]);
  });

  test("an unheaded group defaults literals only after build fixes Float", () => {
    expect(messages(
      "pattern floated\n" +
        "    view(value: Float) = 0\n" +
        "    build(component: Float) = component\n",
    )).toEqual([]);
  });

  test("returning a linked callback does not make an inline view effectful", () => {
    expect(messages(
      "pattern callback\n" +
        "    view(step: () ->? Int): (() ->? Int) = step\n",
    )).toEqual([]);
  });

  test("an unheaded residual constraint is refused at the pattern head", () => {
    expect(messages(
      "pattern doubled\n" +
        "    view(value) = value + value\n",
    )).toEqual(["a pattern's binders carry no constraints"]);
  });

  test("a conduit-effect view reports its linked `->?` face", () => {
    expect(messages(
      "extern from \"./world.js\"\n" +
        "    conduit fun inspect(step: () ->? Int): Int\n" +
        "pattern force\n" +
        "    view(step: () ->? Int) = inspect?(step)\n",
    )).toEqual([
      "a pattern's `view` is run by matching, so it is pure — the demand is the pattern head's, and this function's face is `->?`",
    ]);
  });
});

describe("declared-view signatures in coverage (§4)", () => {
  const views =
    "export record Shape = {value: Int}\n" +
    "export pattern first(value: Int): Shape\n" +
    "    view(shape) = shape.value\n" +
    "    build(value) = Shape({value = value})\n" +
    "export pattern second(value: Int): Shape\n" +
    "    view(shape) = shape.value\n" +
    "    build(value) = Shape({value = value})\n";

  test("one complete view closes a match that also contains another view", () => {
    expect(messages(
      views +
        "export fun classify(shape: Shape): String =\n" +
        "    match shape\n" +
        "        (0)second => \"zero\"\n" +
        "        (_)first => \"other\"\n",
    )).toEqual([]);
  });

  test("a catch-all of one view shadows a later view", () => {
    expect(messages(
      views +
        "fun classify(shape: Shape): String =\n" +
        "    match shape\n" +
        "        (_)first => \"all\"\n" +
        "        (_)second => \"never\"\n",
    )).toEqual(["this match arm is unreachable; an earlier pattern matches everything"]);
  });

  test("a complete native constructor signature shadows a later declared view", () => {
    expect(messages(
      "union Shade = Light | Dark\n" +
        "pattern shade(value: Int): Shade\n" +
        "    view(value) = 0\n" +
        "    build(value) = if value == 0 then Light else Dark\n" +
        "fun classify(value: Shade): String =\n" +
        "    match value\n" +
        "        Light => \"light\"\n" +
        "        Dark => \"dark\"\n" +
        "        (_)shade => \"never\"\n",
    )).toEqual(["this case is unreachable; the patterns above already cover it"]);
  });

  test("an alias keeps its declaration identity for same-view reachability", () => {
    const client =
      "module Main\n\n" +
      "import Views\n" +
      "pattern chosen = Views.first\n" +
      "fun classify(shape: Views.Shape): String =\n" +
      "    match shape\n" +
      "        (0)first => \"zero\"\n" +
      "        (0)chosen => \"never\"\n" +
      "        (_)first => \"other\"\n";
    const project = compileFiles([
      ["/views.hex", `module Views\n\n${views}`],
      ["/main.hex", client],
    ]);
    expect(project.diagnostics.map(({ message }) => message)).toEqual([
      "this case is unreachable; the arm `(0)first` above already covers it",
    ]);
  });
});

describe("pattern declaration boundary and home regressions", () => {
  test("qualified term access explains that the export is a suffix pattern", () => {
    const project = compileFiles([
      ["/views.hex", "module Views\n\nexport pattern pair(left: Int, right: Int): (Int, Int)\n" +
        "    view(value) = value\n"],
      ["/main.hex", "module Main\n\nimport Views\nlet value = Views.pair\n"],
    ]);
    expect(project.diagnostics.map(({ message }) => message)).toEqual([
      "module `Views` exports no term `pair`; `pair` is a pattern, written `(left, right)pair`",
    ]);
  });

  test("glued contextual words receive their spacing diagnostics", () => {
    expect(messages(
      "let first = match (1, 2)\n" +
        "    (1, 2)when => 1\n" +
        "    _ => 0\n" +
        "let second = match (1 : Int)\n" +
        "    (x)as => x\n",
    )).toEqual([
      "a guard's `when` stands off the parenthesis; write `(…) when condition`",
      "an `as` pattern's `as` stands off the parenthesis; write `(…) as name`",
    ]);
  });

  test("a match-only construction labels its declaration", () => {
    const source = main(
      "pattern picked(value: Int): Int\n" +
        "    view(value) = value\n" +
        "let value = (1)picked\n",
    );
    const project = compileFiles([["/main.hex", source]]);
    const report = project.diagnostics.find(({ message }) => message.includes("match-only"));
    expect(report?.labels?.map(({ message }) => message)).toEqual([
      "`picked` is declared match-only here",
    ]);
  });

  test("an opaque record refusal names its exported pattern", () => {
    const project = compileFiles([
      ["/secret.hex", "module Secret\n\nopaque record Secret = {value: Int}\n" +
        "export pattern opened(value: Int): Secret\n    view(secret) = secret.value\n" +
        "export fun make(): Secret = Secret({value = 1})\n"],
      ["/main.hex", "module Main\n\nimport Secret\nlet {value} = Secret.make()\n"],
    ]);
    expect(project.diagnostics.map(({ message }) => message)).toEqual([
      "cannot destructure opaque record `Secret`; match it with `(value)opened`",
    ]);
  });

  test("a closed nominal pattern door names its home and nearest spelling", () => {
    const project = compileFiles([
      ["/secret.hex", "module Secret\n\nexport record Secret = {value: Int}\n" +
        "export pattern opened(value: Int): Secret\n    view(secret) = secret.value\n"],
      ["/mid.hex", "module Mid\n\nimport Secret\nexport let make(): Secret.Secret = Secret.Secret({value = 1})\n"],
      ["/main.hex", "module Main\n\nimport Mid\nlet (value)opend = Mid.make()\n"],
    ]);
    expect(project.diagnostics.map(({ message }) => message)).toEqual([
      "`Secret` has no pattern `opend`; did you mean `opened`?",
    ]);
  });

  test("view and build mismatches name the pattern faces", () => {
    expect(messages(
      "pattern headed(value: Int): Int\n" +
        "    view(value) = \"wrong\"\n" +
        "pattern inferred\n" +
        "    view(value: Int) = value\n" +
        "    build(value: String) = value\n",
    )).toEqual([
      "`view` does not match pattern `headed`'s head; expected (Int) -> Int, found (Int) -> String",
      "`build` has face (String) -> String but `view` has face (Int) -> Int — a pattern's two directions share one subject and component list",
    ]);
  });

  test("a nested component mismatch keeps the member diagnostic", () => {
    expect(messages(
      "pattern nested(values: Vector(Int)): Int\n" +
        "    view(value) = [\"wrong\"]\n",
    )).toEqual([
      "`view` does not match pattern `nested`'s head; expected (Int) -> Vector(Int), found (Int) -> Vector(String)",
    ]);
  });

  test("an exported pattern refuses a private nominal in its face", () => {
    expect(messages(
      "record Secret = {value: Int}\n" +
        "export pattern secret(value: Int): Secret\n" +
        "    view(secret) = secret.value\n" +
        "    build(value) = Secret({value = value})\n",
    )).toEqual([
      "exported pattern `secret` exposes private type `Secret`; export the type, perhaps opaquely, or keep the pattern private",
    ]);
  });

  test("the expected-type door reads only the nominal's actual home", () => {
    const project = compileFiles([
      ["/color.hex", "module Color\n\nexport record Color = {value: Int}\n"],
      ["/paint.hex", "module Paint\n\nimport Color\nexport pattern alt(value: Int): Color.Color\n    view(color) = color.value\n"],
      ["/mid.hex", "module Mid\n\nimport Color\nexport let make(): Color.Color = Color.Color({value = 1})\n"],
      ["/main.hex", "module Main\n\nimport Mid\nlet (value)alt = Mid.make()\n"],
    ]);
    expect(project.diagnostics.map(({ message }) => message)).toEqual([
      "`Color` has no pattern `alt`",
    ]);
  });

  test("a generic import/home collision offers complete fresh-alias choices", () => {
    const ticket = "module Ticket\n\nexport record Ticket = {flag: Bool}\n" +
      "export pattern flagged(flag: Bool): Ticket\n    view(ticket) = ticket.flag\n" +
      "export pattern ticketFlagged(flag: Bool): Ticket\n    view(ticket) = ticket.flag\n";
    const generic = "module Generic\n\nexport pattern flagged<a>(flag: Bool): a\n    view(value) = False\n";
    const mid = "module Mid\n\nimport Ticket\nexport let make(): Ticket.Ticket = Ticket.Ticket({flag = True})\n";
    const source = "module Main\n\nimport Generic\nimport Mid\nlet answer = match Mid.make()\n" +
      "    (True)flagged => 1\n    (False)flagged => 0\n";
    const files = [["/ticket.hex", ticket], ["/generic.hex", generic], ["/mid.hex", mid]] as const;
    const project = compileFiles([...files, ["/main.hex", source]]);
    const reports = project.diagnostics.filter(({ message }) => message.includes("exported by `Generic` and `Ticket`"));
    expect(reports).toHaveLength(2);
    expect(reports[0]!.fixes).toHaveLength(2);
    expect(reports[0]!.fixes!.map(({ message }) => message)).toContain(
      "choose `Ticket.flagged` as `ticketFlagged1`",
    );
    for (const fix of reports[0]!.fixes!) {
      let applied = source;
      for (const edit of [...fix.edits].sort((a, b) => b.span.start.offset - a.span.start.offset)) {
        applied = applied.slice(0, edit.span.start.offset) + edit.replacement + applied.slice(edit.span.end.offset);
      }
      expect(compileFiles([...files, ["/main.hex", applied]]).diagnostics).toEqual([]);
    }
  });

  test("a collision omits a candidate whose complete repair does not typecheck", () => {
    const project = compileFiles([
      ["/ints.hex", "module Ints\n\nexport pattern picked(value: Int): Int\n    view(value) = value\n"],
      ["/strings.hex", "module Strings\n\nexport pattern picked(value: Int): String\n    view(value) = 0\n"],
      ["/main.hex", "module Main\n\nimport Ints\nimport Strings\nlet (value)picked = 1\n"],
    ]);
    const report = project.diagnostics.find(({ message }) => message.includes("exported by `Ints` and `Strings`"));
    expect(report?.fixes?.map(({ message }) => message)).toEqual([
      "choose `Ints.picked` as `intsPicked`",
    ]);
  });

  test("expression construction also refuses an imported pattern against its subject home", () => {
    const project = compileFiles([
      ["/color.hex", "module Color\n\nexport record Color = {value: Int}\n" +
        "export pattern made(value: Int): Color\n    view(color) = color.value\n    build(value) = Color({value = value})\n"],
      ["/paint.hex", "module Paint\n\nimport Color\nexport pattern made(value: Int): Color.Color\n" +
        "    view(color) = color.value\n    build(value) = Color.Color({value = value + 1})\n"],
      ["/main.hex", "module Main\n\nimport Paint\nlet value = (1)made\n"],
    ]);
    const report = project.diagnostics.find(({ message }) => message.includes("exported by `Paint` and `Color`"));
    expect(report?.fixes).toHaveLength(2);
  });

  test("expression construction offers validated choices for two imported patterns", () => {
    const project = compileFiles([
      ["/a.hex", "module A\n\nexport pattern made(value: Int): Int\n    view(value) = value\n    build(value) = value\n"],
      ["/b.hex", "module B\n\nexport pattern made(value: Int): Int\n    view(value) = value\n    build(value) = value + 1\n"],
      ["/main.hex", "module Main\n\nimport A\nimport B\nlet value = (1)made\n"],
    ]);
    const report = project.diagnostics.find(({ message }) => message.includes("exported by `A` and `B`"));
    expect(report?.fixes).toHaveLength(2);
  });

  test("multi-import contests include the declared subject's home", () => {
    const ticket = "module Ticket\n\nexport record Ticket = {flag: Bool}\n" +
      "export pattern flagged(flag: Bool): Ticket\n    view(ticket) = ticket.flag\n";
    const third = (name: string, flag: string) => `module ${name}\n\nimport Ticket\n` +
      `export pattern flagged(flag: Bool): Ticket.Ticket\n    view(ticket) = ${flag}\n`;
    const project = compileFiles([
      ["/ticket.hex", ticket], ["/a.hex", third("A", "True")], ["/b.hex", third("B", "False")],
      ["/mid.hex", "module Mid\n\nimport Ticket\nexport let make(): Ticket.Ticket = Ticket.Ticket({flag = True})\n"],
      ["/main.hex", "module Main\n\nimport A\nimport B\nimport Mid\n" +
        "let (flag)flagged = Mid.make()\n"],
    ]);
    const report = project.diagnostics.find(({ message }) => message.includes("exported by `A` and `B` and `Ticket`"));
    expect(report?.fixes).toHaveLength(3);
  });

  test("a multi-import contest also includes a different determined expected home", () => {
    const c = "module C\n\nexport record C = {value: Int}\n" +
      "export pattern picked(value: Int): C\n    view(value) = value.value\n";
    const foreign = (name: string, subject: string) => `module ${name}\n\n` +
      `export pattern picked(value: Int): ${subject}\n    view(value) = 0\n`;
    const project = compileFiles([
      ["/c.hex", c], ["/a.hex", foreign("A", "Int")], ["/b.hex", foreign("B", "String")],
      ["/mid.hex", "module Mid\n\nimport C\nexport let value: C.C = C.C({value = 1})\n"],
      ["/main.hex", "module Main\n\nimport A\nimport B\nimport Mid\nlet (value)picked = Mid.value\n"],
    ]);
    const report = project.diagnostics.find(({ message }) =>
      message.includes("exported by `A` and `B` and `C`")
    );
    expect(report).toBeDefined();
    expect(report?.fixes?.map(({ message }) => message)).toEqual([
      "choose `C.picked` as `cPicked`",
    ]);
  });

  test("an imported pattern's declared subject home contests before the use type is known", () => {
    const colour = "module Colour\n\nexport record Colour = {value: Int}\n" +
      "export pattern rgb(value: Int): Colour\n    view(colour) = colour.value\n";
    const paint = "module Paint\n\nimport Colour\n" +
      "export pattern rgb(value: Int): Colour.Colour\n    view(colour) = colour.value\n";
    const project = compileFiles([
      ["/colour.hex", colour], ["/paint.hex", paint],
      ["/main.hex", "module Main\n\nimport Paint\nlet classify = (value)rgb => value\n"],
    ]);
    expect(project.diagnostics.map(({ message }) => message)).toContain(
      "pattern `rgb` is exported by `Paint` and `Colour`; declare a private pattern alias to choose one",
    );
  });

  test("nested collisions rewrite the same structural position across arms", () => {
    const ticket = "module Ticket\n\nexport record Ticket = {flag: Bool}\n" +
      "export pattern flagged(flag: Bool): Ticket\n    view(ticket) = ticket.flag\n";
    const generic = "module Generic\n\nexport pattern flagged<a>(flag: Bool): a\n    view(value) = False\n";
    const project = compileFiles([
      ["/ticket.hex", ticket], ["/generic.hex", generic],
      ["/main.hex", "module Main\n\nimport Generic\nimport Ticket\nfun inspect(value: Option(Ticket.Ticket)): Int = match value\n" +
        "    Some((True)flagged) => 1\n    Some((False)flagged) => 0\n    None => 0\n"],
    ]);
    const reports = project.diagnostics.filter(({ message }) => message.includes("exported by `Generic` and `Ticket`"));
    expect(reports).toHaveLength(2);
    expect(reports[0]!.fixes?.every(({ edits }) => edits.length === 3)).toBe(true);
  });
});
