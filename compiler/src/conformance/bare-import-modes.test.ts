import { describe, expect, test } from "vitest";

import { compileFiles, runProject } from "../support/test-project.js";
import { typeScriptErrors } from "../support/typescript-check.js";

function declarationFiles(compiled: ReturnType<typeof compileFiles>): Record<string, string> {
  const files: Record<string, string> = {};
  for (const data of compiled.dataUnits) {
    files[data.path.replace(/^\//u, "").replace(/\.hex$/u, ".d.ts")] = data.declarations.text;
  }
  for (const module of compiled.modules) {
    files[module.path.replace(/^\//u, "").replace(/\.hex$/u, ".d.ts")] = module.declarations.text;
  }
  if (compiled.runtimeDeclarations !== undefined) {
    files[compiled.runtimeDeclarations.path.replace(/^\//u, "")] = compiled.runtimeDeclarations.text;
  }
  return files;
}

const TYPES = [
  "/types.hex",
  "module Types\n" +
    "export union Shape = Circle(radius: Float) | Square(side: Float)\n" +
    "export record Point = { x: Float, y: Float }\n",
] as const;

function modeErrors(source: string): readonly string[] {
  return compileFiles([TYPES, ["/main.hex", `module Main\n${source}`]])
    .diagnostics.map(({ message }) => message)
    .filter((message) => message.startsWith("cannot combine bare and full imports"));
}

describe("one import mode per resolved module", () => {
  test("multiple distinct bare selections are allowed", () => {
    expect(modeErrors("import bare Shape from Types\nimport bare Point from Types\n"))
      .toEqual([]);
  });

  test("a later full import is refused even with another alias", () => {
    expect(modeErrors("import bare Shape from Types\nimport Types as T\n"))
      .toEqual([
        "cannot combine bare and full imports of Types; replace the bare selections with a full import to use its implementation",
      ]);
  });

  test("a later bare import is refused", () => {
    expect(modeErrors("import Types\nimport bare Shape from Types\n"))
      .toHaveLength(1);
  });
});

describe("bare import scope", () => {
  test("the selected type and public constructors are available", () => {
    const messages = compileFiles([TYPES, [
      "/main.hex",
      "module Main\nimport bare Shape from Types\n" +
        "export let circle: Shape = Shape.Circle(2.0)\n",
    ]]).diagnostics.map(({ message }) => message);
    expect(messages).toEqual([]);
  });

  test("a selected record keeps its constructor and public fields", () => {
    const messages = compileFiles([TYPES, [
      "/main.hex",
      "module Main\nimport bare Point from Types\n" +
        "let point = Point({ x = 1.0, y = 2.0 })\n" +
        "export let x: Float = point.x\n",
    ]]).diagnostics.map(({ message }) => message);
    expect(messages).toEqual([]);
  });

  test("ordinary functions and other data are outside the selected view", () => {
    const files = [
      ["/types.hex", "module Types\nexport union Shape = Circle | Square\n" +
        "export fun area(): Int = 3\n" +
        "export record Point = { x: Int }\n"] as const,
      ["/main.hex", "module Main\nimport bare Shape from Types\n" +
        "let a = Shape.area()\nlet p: Shape.Point = Shape.Point({ x = 1 })\n"] as const,
    ];
    const messages = compileFiles(files).diagnostics.map(({ message }) => message);
    expect(messages).toContain("module `Shape` does not export `area`");
    expect(messages.some((message) => message.includes("Point"))).toBe(true);
  });

  test("functions and private data cannot be selected", () => {
    const files = [
      ["/types.hex", "module Types\nrecord Hidden = { x: Int }\nexport fun area(): Int = 3\n"] as const,
      ["/main.hex", "module Main\nimport bare Hidden from Types\n" +
        "import bare Area from Types\n"] as const,
    ];
    const messages = compileFiles(files).diagnostics.map(({ message }) => message);
    expect(messages).toContain(
      "`Hidden` is not an exported data type of Types; use `import Types` for full operations",
    );
    expect(messages).toContain(
      "module Types does not export data type `Area`; use `import Types` for full operations",
    );
  });

  test("foreign types and foreign enums cannot be selected", () => {
    const files = [
      ["/types.hex", "module Types\nextern from \"sdk\"\n    export type Token\n" +
        "export extern enum Direction = \"up\" as Up | \"down\" as Down\n"] as const,
      ["/main.hex", "module Main\nimport bare Token from Types\n" +
        "import bare Direction from Types\n"] as const,
    ];
    const messages = compileFiles(files).diagnostics.map(({ message }) => message);
    expect(messages).toContain(
      "`Token` is not an exported data type of Types; use `import Types` for full operations",
    );
    expect(messages).toContain(
      "`Direction` is not an exported data type of Types; use `import Types` for full operations",
    );
  });
});

test("a full module may depend on a consumer of its data", async () => {
  const files = [
    ["/a.hex", "module A\nimport B\n" +
      "export union Token = One | Two\n" +
      "export let token: Token = B.value\n"] as const,
    ["/b.hex", "module B\nimport bare Token from A\n" +
      "export let value: Token = Token.One\n"] as const,
  ];
  const compiled = compileFiles(files);
  expect(compiled.diagnostics.map(({ message }) => message)).toEqual([]);
  expect(compiled.dataUnits.map(({ path }) => path)).toContain("/.hex-data/A/Token.54-6f-6b-65-6e.hex");
  const a = await runProject(files, { entry: "A" });
  expect(a.token).toMatchObject({ tag: "One" });
});

test("a bare-only root imports the data unit directly", async () => {
  const files = [
    ["/types.hex", "module Types\nexport union Token = One | Two\n" +
      "export let unused: Int = 7\n"] as const,
    ["/main.hex", "module Main\nimport bare Token from Types\n" +
      "export let value: Token = Token.One\n"] as const,
  ];
  const compiled = compileFiles(files);
  expect(compiled.diagnostics.map(({ message }) => message)).toEqual([]);
  const mainOutput = compiled.modules.find(({ name }) => name === "Main")!.javascript.text;
  expect(mainOutput).toContain('from "./.hex-data/Types/Token.54-6f-6b-65-6e.js"');
  expect(mainOutput).not.toContain('from "./Types.js"');
  expect(compiled.dataUnits.map(({ path }) => path)).toContain("/.hex-data/Types/Token.54-6f-6b-65-6e.hex");
  const main = await runProject(files);
  expect(main.value).toMatchObject({ tag: "One" });
});

test("a globally known companion cannot synthesize the forbidden full provider", () => {
  const files = [
    ["/types.hex", "module Types\nexport union Token = One | Two\n" +
      "export fun number(token: Token): Int = match token One => 1 | Two => 2\n"] as const,
    ["/activator.hex", "module Activator\nimport Types\nexport let one = Types.Token.One\n"] as const,
    ["/main.hex", "module Main\nimport Activator\nimport bare Token from Types\n" +
      "let token: Token = Token.One\nexport let value = token.number()\n"] as const,
  ];
  const compiled = compileFiles(files);
  const messages = compiled.diagnostics.map(({ message }) => message);
  expect(messages.some((message) =>
    message.includes("number") && message.includes("full provider `Types`") &&
    message.includes("replace the bare selections")
  )).toBe(true);
  const main = compiled.modules.find(({ name }) => name === "Main");
  expect(main?.javascript.text).not.toContain('from "./Types.js"');
});

test("an unavailable companion is not reinterpreted as a function-valued field", () => {
  const files = [
    ["/types.hex", "module Types\nexport record Token = { number: () -> Int }\n" +
      "export fun number(token: Token): Int = 1\n"] as const,
    ["/activator.hex", "module Activator\nimport Types\nexport let active = 1\n"] as const,
    ["/main.hex", "module Main\nimport Activator\nimport bare Token from Types\n" +
      "let token = Token({ number = () => 2 })\nexport let value = token.number()\n"] as const,
  ];
  const messages = compileFiles(files).diagnostics.map(({ message }) => message);
  expect(messages.some((message) => message.includes("full provider `Types`"))).toBe(true);
  expect(messages.some((message) => message.includes("not a function"))).toBe(false);
});

test("a later resolved companion provider is fixed before body checking", () => {
  const files = [
    ["/a.hex", "module A\nimport B\nexport record Token = { number: () -> Int }\n" +
      "type TokenAlias = Token\n" +
      "export fun number(token: TokenAlias): Int = 1\n"] as const,
    ["/b.hex", "module B\nimport bare Token from A\n" +
      "let token = Token({ number = () => 2 })\n" +
      "export let value: Int = token.number()\n"] as const,
  ];
  const messages = compileFiles(files).diagnostics.map(({ message }) => message);
  expect(messages.some((message) =>
    message.includes("`number` requires the full provider `A`") &&
    message.includes("replace the bare selections") &&
    message.includes("`B full -> A full -> B full`")
  )).toBe(true);
  expect(messages.some((message) => message.includes("not a function"))).toBe(false);
});

test("a later resolved derived instance is fixed before body checking", () => {
  const files = [
    ["/a.hex", "module A\nimport B\nexport union Token derives Eq = One\n"] as const,
    ["/b.hex", "module B\nimport bare Token from A\n" +
      "let left: Token = Token.One\nlet right: Token = Token.One\n" +
      "export let same: Bool = left == right\n"] as const,
  ];
  const messages = compileFiles(files).diagnostics.map(({ message }) => message);
  expect(messages.some((message) =>
    message.includes("`Eq<Token>` requires the full provider `A`") &&
    message.includes("replace the bare selections") &&
    message.includes("`B full -> A full -> B full`")
  )).toBe(true);
  expect(messages.some((message) => message.includes("does not honor `Eq`"))).toBe(false);
});

test("same-module recursive data shares one data owner", () => {
  const files = [
    ["/types.hex", "module Types\n" +
      "export union Even = Zero | NextOdd(Odd)\n" +
      "export union Odd = One | NextEven(Even)\n"] as const,
    ["/main.hex", "module Main\nimport bare Even from Types\n" +
      "export let value: Even = Even.Zero\n"] as const,
  ];
  const compiled = compileFiles(files);
  expect(compiled.diagnostics.map(({ message }) => message)).toEqual([]);
  const owner = compiled.dataUnits.find(({ sourcePath }) => sourcePath === "/Types.hex")!;
  expect(owner.path).toBe("/.hex-data/Types/Even.45-76-65-6e.hex");
  expect(owner.selectedNames).toEqual(["Even", "Odd"]);
});

test("a cross-module data cycle is refused", () => {
  const files = [
    ["/a.hex", "module A\nimport bare BType from B\n" +
      "export record AType = { next: BType }\n"] as const,
    ["/b.hex", "module B\nimport bare AType from A\n" +
      "export record BType = { next: AType }\n"] as const,
    ["/main.hex", "module Main\nimport bare AType from A\n"] as const,
  ];
  const messages = compileFiles(files).diagnostics.map(({ message }) => message);
  expect(messages.some((message) => message.startsWith("data import cycle:"))).toBe(true);
  expect(messages.some((message) => message.startsWith("import cycle:"))).toBe(false);
});

test("transitive data units are emitted dependency-first and execute", async () => {
  const files = [
    ["/inner.hex", "module Inner\nexport union Token = One | Two\n"] as const,
    ["/outer.hex", "module Outer\nimport bare Token from Inner\n" +
      "export record Envelope = { token: Token }\n"] as const,
    ["/main.hex", "module Main\nimport bare Envelope from Outer\n" +
      "import bare Token from Inner\n" +
      "export let wrapped: Envelope = Envelope({ token = Token.One })\n"] as const,
  ];
  const compiled = compileFiles(files);
  expect(compiled.diagnostics.map(({ message }) => message)).toEqual([]);
  const paths = compiled.dataUnits.map(({ path }) => path);
  expect(paths.indexOf("/.hex-data/Inner/Token.54-6f-6b-65-6e.hex"))
    .toBeLessThan(paths.indexOf("/.hex-data/Outer/Envelope.45-6e-76-65-6c-6f-70-65.hex"));
  const main = await runProject(files);
  expect(main.wrapped).toMatchObject({ token: { tag: "One" } });
});

test("a foreign nominal in a selected face is metadata-only support", async () => {
  const files = [
    ["/types.hex", "module Types\nextern from \"sdk\"\n    export type Token\n" +
      "export record Envelope = { token: Token }\n"] as const,
    ["/main.hex", "module Main\nimport bare Envelope from Types\n"] as const,
  ];
  const compiled = compileFiles(files);
  expect(compiled.diagnostics.map(({ message }) => message)).toEqual([]);
  const support = compiled.dataUnits.find(({ path }) => path.endsWith("/Token.54-6f-6b-65-6e.hex"))!;
  expect(support.javascript.text).not.toContain("sdk");
  expect(support.declarations.text).toContain("Token");
  const full = compiled.modules.find(({ name }) => name === "Types")!;
  expect((support.declarations.text + full.declarations.text).match(/unique symbol/g)).toHaveLength(1);
  expect(await typeScriptErrors(declarationFiles(compiled))).toEqual([]);
});

test("an explicit bare prelude import blocks its ambient full instance provider", () => {
  const files = [[
    "/main.hex",
    "module Main\nimport bare Option from Option\n" +
      "export let same: Bool = Option.Some(1) == Option.Some(1)\n",
  ] as const];
  const compiled = compileFiles(files);
  const messages = compiled.diagnostics.map(({ message }) => message);
  expect(messages.some((message) =>
    message.includes("Eq<Option") && message.includes("full provider") &&
    message.includes("replace the bare selections")
  )).toBe(true);
  const main = compiled.modules.find(({ name }) => name === "Main");
  expect(main?.javascript.text).not.toContain("__Eq_Option");
});

test("the full producer is still validated without activating its implementation", () => {
  const files = [
    ["/types.hex", "module Types\nexport union Token derives Eq = One | Two\n" +
      "export let broken: Int = \"wrong\"\n"] as const,
    ["/main.hex", "module Main\nimport bare Token from Types\n" +
      "export let token: Token = Token.One\n"] as const,
  ];
  const compiled = compileFiles(files);
  expect(compiled.diagnostics.map(({ message }) => message)
    .some((message) => message.includes("Int") && message.includes("String"))).toBe(true);
  const main = compiled.modules.find(({ name }) => name === "Main")!;
  expect(main.javascript.text).not.toContain("Types.js");
  const data = compiled.dataUnits.find(({ sourcePath }) => sourcePath === "/Types.hex")!;
  expect(data.javascript.text).not.toContain("__Eq_Token");
  expect(data.javascript.text).not.toContain("broken");
});

test("unrelated declarations do not enlarge the selected data closure", () => {
  const files = [
    ["/types.hex", "module Types\nexport union Token = One | Two\n" +
      "record Hidden = { value: Int }\nrecord Other = { hidden: Hidden }\n"] as const,
    ["/main.hex", "module Main\nimport bare Token from Types\n"] as const,
  ];
  const compiled = compileFiles(files);
  expect(compiled.diagnostics.map(({ message }) => message)).toEqual([]);
  const units = compiled.dataUnits.filter(({ sourcePath }) => sourcePath === "/Types.hex");
  expect(units).toHaveLength(1);
  expect(units[0]?.selectedNames).toEqual(["Token"]);
  expect(units[0]?.declarations.text).not.toContain("Hidden");
  expect(units[0]?.declarations.text).not.toContain("Other");
});

test("an opaque shell stops before its hidden representation", () => {
  const files = [
    ["/types.hex", "module Types\nrecord Hidden = { value: Int }\n" +
      "opaque record Secret = { hidden: Hidden }\n"] as const,
    ["/main.hex", "module Main\nimport bare Secret from Types\n"] as const,
  ];
  const compiled = compileFiles(files);
  expect(compiled.diagnostics.map(({ message }) => message)).toEqual([]);
  const data = compiled.dataUnits.find(({ sourcePath }) => sourcePath === "/Types.hex")!;
  expect(data.selectedNames).toEqual(["Secret"]);
  expect(data.declarations.text).not.toContain("Hidden");
  expect(data.javascript.text).not.toContain("Secret");
});

test("an unreachable embedded bare edge emits no data unit", () => {
  const compiled = compileFiles([[
    "/main.hex",
    "module Main\nexport let ok: Bool = True\n",
  ]]);
  expect(compiled.diagnostics.map(({ message }) => message)).toEqual([]);
  expect(compiled.dataUnits.map(({ path }) => path)
    .some((path) => path.includes("/Option/"))).toBe(false);
});

test("case-distinct selections have collision-free internal paths", () => {
  const compiled = compileFiles([
    ["/types.hex", "module Types\nexport union Foo = A\nexport union FOO = B\n"],
    ["/main.hex", "module Main\nimport bare Foo from Types\nimport bare FOO from Types\n"],
  ]);
  expect(compiled.diagnostics.map(({ message }) => message)).toEqual([]);
  const paths = compiled.dataUnits
    .filter(({ sourcePath }) => sourcePath === "/Types.hex")
    .map(({ path }) => path);
  expect(paths).toHaveLength(2);
  expect(new Set(paths.map((path) => path.toLowerCase())).size).toBe(2);
});

test("a bare-only route does not initialize the producer implementation", async () => {
  const files = [
    ["/types.hex", "module Types\nexport union Token = One\n" +
      "let explode: Int = Int.div(1, 0)\n"] as const,
    ["/main.hex", "module Main\nimport bare Token from Types\n" +
      "export let value: Token = Token.One\n"] as const,
  ];
  const main = await runProject(files);
  expect(main.value).toMatchObject({ tag: "One" });
});

test("separate full and bare consumers share one data unit identity", async () => {
  const files = [
    ["/types.hex", "module Types\nexport union Token = One\n" +
      "export let one: Token = One\n"] as const,
    ["/full.hex", "module Full\nimport Types\nexport let one: Types.Token = Types.one\n"] as const,
    ["/data.hex", "module Data\nimport bare Token from Types\n" +
      "export let one: Token = Token.One\n"] as const,
    ["/main.hex", "module Main\nimport Full\nimport Data\nimport bare Token from Types\n" +
      "export let full: Token = Full.one\nexport let data: Token = Data.one\n"] as const,
  ];
  const main = await runProject(files);
  expect(main.full).toBe(main.data);
});

test("a data-only runtime type face emits the runtime declarations", async () => {
  const compiled = compileFiles([
    ["/types.hex", "module Types\nexport type Vectors(a) = Vector(a)\n"],
    ["/main.hex", "module Main\nimport bare Vectors from Types\n"],
  ]);
  expect(compiled.diagnostics.map(({ message }) => message)).toEqual([]);
  expect(compiled.runtimeDeclarations).toBeDefined();
  expect(await typeScriptErrors(declarationFiles(compiled))).toEqual([]);
});
