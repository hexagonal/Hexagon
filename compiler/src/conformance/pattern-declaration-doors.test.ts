import { describe, expect, test } from "vitest";

import { compileFiles } from "../support/test-project.js";
import { compileProject } from "../project.js";
import * as Source from "../support/source.js";

function diagnostics(files: readonly (readonly [string, string])[]) {
  return compileFiles(files).diagnostics;
}

function messages(files: readonly (readonly [string, string])[]) {
  return diagnostics(files).map(({ message }) => message);
}

const COLOR = [
  "/color.hex",
  "module Color\n\n" +
    "export record Color = {red: Int, green: Int, blue: Int}\n" +
    "export pattern rgb(red: Int, green: Int, blue: Int): Color\n" +
    "    view(color) = (color.red, color.green, color.blue)\n",
] as const;

describe("pattern declaration doors (§3.3)", () => {
  test("a nominal home's closed door names it and its near miss", () => {
    const report = diagnostics([
      COLOR,
      ["/mid.hex", "module Mid\n\nimport Color\nexport fun make(): Color.Color = Color.Color({red = 1, green = 2, blue = 3})\n"],
      ["/main.hex", "module Main\n\nimport Mid\nlet (red, green, blue)rbg = Mid.make()\n"],
    ]);
    expect(report.map(({ message }) => message)).toEqual([
      "`Color` has no pattern `rbg`; did you mean `rgb`?",
    ]);
  });

  test("an undetermined pattern seat offers the one visible export and annotation guidance", () => {
    const report = diagnostics([
      COLOR,
      ["/main.hex", "module Main\n\nlet extract = ((red, _, _)rgb) => red\n"],
    ]);
    expect(report.map(({ message }) => message)).toEqual([
      "no `rgb` here: its type is not determined at this pattern — `import Color`, or bind the function with its own annotated `let`",
    ]);
    expect(report[0]?.fixes?.map(({ message }) => message)).toContain("import `Color`");
  });

  test("an expression suffix offers the sole visible exported pattern's import", () => {
    const box = [
      "/box.hex",
      "module Box\n\nexport record Box = {value: Int}\n" +
        "export pattern boxed(value: Int): Box\n" +
        "    view(box) = box.value\n" +
        "    build(value) = Box({value = value})\n",
    ] as const;
    const report = diagnostics([
      box,
      ["/main.hex", "module Main\n\nlet value = (1)boxed\n"],
    ]);
    expect(report.map(({ message }) => message)).toEqual(["no `boxed` here; `import Box`"]);
    expect(report[0]?.fixes?.map(({ message }) => message)).toContain("import `Box`");
  });

  test("an unknown suffix does not offer a transitive package module", () => {
    const source = (id: number, path: string, text: string) =>
      new Source.File(Source.fileId(id), path, text);
    const project = compileProject([
      source(0, "/work/app/main.hex", "module Main\n\nimport Anchor\nlet value = (1)hidden\n"),
    ], {
      dependencies: ["Acme"],
      installed: new Set(["Acme", "Bolt"]),
      packages: [
        {
          record: { name: "Acme", dependencies: ["Bolt"], installed: new Set(["Bolt"]) },
          files: [source(1, "/work/app/node_modules/acme/anchor.hex", "module Anchor\n\nexport let value = 1\n")],
        },
        {
          record: { name: "Bolt", dependencies: [], installed: new Set() },
          files: [source(2, "/work/app/node_modules/bolt/hidden.hex", "module Hidden\n\n" +
            "export pattern hidden(value: Int): Int\n    view(value) = value\n    build(value) = value\n")],
        },
      ],
    });
    const report = project.diagnostics.find(({ message }) => message.includes("hidden"));
    expect(report?.message).toBe("no `hidden` pattern is in scope; import its module");
    expect(report?.fixes ?? []).toEqual([]);
  });

  test("an unknown suffix offers the sole exporting package by its qualified import", () => {
    const source = (id: number, path: string, text: string) =>
      new Source.File(Source.fileId(id), path, text);
    const package_ = (name: string, file: Source.File) => ({
      record: { name, dependencies: [] as string[], installed: new Set<string>() },
      files: [file],
    });
    const project = compileProject([
      source(0, "/work/app/main.hex", "module Main\n\nlet value = (1)hidden\n"),
    ], {
      dependencies: ["Acme", "Chroma"],
      installed: new Set(["Acme", "Chroma"]),
      packages: [
        {
          record: { name: "Acme", dependencies: [] as string[], installed: new Set<string>() },
          files: [
            source(1, "/work/app/node_modules/acme/anchor.hex", "module Anchor\n\nimport Hidden\nexport let value: Int = 1\n"),
            source(2, "/work/app/node_modules/acme/hidden.hex", "module Hidden\n\n" +
              "export pattern hidden(value: Int): Int\n    view(value) = value\n    build(value) = value\n"),
          ],
        },
        package_("Chroma", source(3, "/work/app/node_modules/chroma/hidden.hex", "module Hidden\n\nexport let value: Int = 1\n")),
      ],
    });
    const report = project.diagnostics.find(({ message }) => message.includes("no `hidden` here"));
    expect(report?.message).toBe("no `hidden` here; `import Acme.Hidden`");
    expect(report?.fixes?.map(({ message }) => message)).toEqual(["import `Acme.Hidden`"]);
  });

  test("opaque records enumerate their exported pattern destructures", () => {
    const vault = [
      "/vault.hex",
      "module Vault\n\nopaque record Token = {value: Int}\n" +
        "export pattern token(value: Int): Token\n    view(token) = token.value\n" +
        "export pattern tokenHex(value: Int): Token\n    view(token) = token.value\n" +
        "export fun make(): Token = Token({value = 1})\n",
    ] as const;
    expect(messages([
      vault,
      ["/main.hex", "module Main\n\nimport Vault\nfun read(): Int =\n    match Vault.make()\n        Vault.Token({value}) => 0\n"],
    ])).toEqual([
      "cannot destructure opaque record `Token`; match it with `(value)token` or `(value)tokenHex`",
    ]);
  });

  test("a selected namespace pattern cannot silently displace its subject home's spelling", () => {
    const foo = [
      "/foo.hex",
      "module Foo\n\nexport record Foo = {value: Int}\n" +
        "export pattern rat(value: Int): Foo\n    view(foo) = foo.value\n",
    ] as const;
    const rat = [
      "/rat.hex",
      "module Rat\n\nexport record Rat = {value: Int}\n" +
        "export pattern rat(value: Int): Rat\n    view(rat) = rat.value\n",
    ] as const;
    const mid = [
      "/mid.hex",
      "module Mid\n\nimport Rat\nexport fun make(): Rat.Rat = Rat.Rat({value = 1})\n",
    ] as const;
    expect(messages([
      foo,
      rat,
      mid,
      ["/main.hex", "module Main\n\nimport Foo\nimport Mid\nlet (value)rat = Mid.make()\n"],
    ])).toEqual([
      "`rat` here is `Foo.rat`, over `Foo`; this pattern matches a `Rat`, whose home exports its own `rat` — rename with `pattern ratOf = Rat.rat` (`import Rat` first, where the module has not)",
    ]);
  });

});
