import { describe, expect, test } from "vitest";

import { createCompilerService, type EditorAnalysis } from "./compiler-service";

const source = "fun twice(n: Int): Int = n * 2\nconsole.log(twice(3))\n";
const caret = source.indexOf("twice") + 1;

describe("createCompilerService", () => {
  test("answers every request kind, echoing the id and version it was asked at", () => {
    const service = createCompilerService();
    const asked = { id: 9, version: 4, source } as const;

    expect(service.handle({ kind: "hover", ...asked, offset: caret })).toMatchObject({
      kind: "hover",
      id: 9,
      version: 4,
      hover: { markdown: "value `twice: Int -> Int`" },
    });
    expect(
      service.handle({ kind: "code-actions", ...asked, startOffset: 0, endOffset: 0 }),
    ).toMatchObject({ kind: "code-actions", id: 9, version: 4, actions: [] });
    expect(service.handle({ kind: "definition", ...asked, offset: caret })).toMatchObject({
      kind: "definition",
      id: 9,
      version: 4,
      ranges: [{ startOffset: 4, endOffset: 9 }],
    });
    expect(service.handle({ kind: "references", ...asked, offset: caret })).toMatchObject({
      kind: "references",
      id: 9,
      version: 4,
    });
    expect(
      service.handle({ kind: "prepare-rename", ...asked, offset: caret }),
    ).toMatchObject({ kind: "prepare-rename", id: 9, version: 4, subject: { name: "twice" } });
    expect(
      service.handle({ kind: "rename", ...asked, offset: caret, newName: "double" }),
    ).toMatchObject({ kind: "rename", id: 9, version: 4, result: { newName: "double" } });
  });

  test("compiles, and reports a compile it could not finish as a diagnostic", () => {
    const service = createCompilerService();

    expect(service.handle({ kind: "compile", version: 1, source })).toMatchObject({
      kind: "compile-success",
      version: 1,
    });
    expect(
      service.handle({ kind: "compile", version: 2, source: "let = = =\n" }),
    ).toMatchObject({ kind: "compile-failure", version: 2 });
  });

  test("turns a fault into a reply carrying the id that is waiting on it", () => {
    const throwing = new Proxy({} as EditorAnalysis, {
      get: () => () => {
        throw new Error("the compiler fell over");
      },
    });
    const service = createCompilerService(throwing);

    // A promise Monaco is holding must not be closed by an exception arriving
    // as silence. The id is the whole point of the reply: without it the
    // client has nothing to settle.
    expect(
      service.handle({ kind: "hover", id: 3, version: 1, source, offset: caret }),
    ).toEqual({
      kind: "service-failure",
      id: 3,
      version: 1,
      message: "the compiler fell over",
    });
  });

  test("reports a fault that threw something that is not an Error", () => {
    const throwing = new Proxy({} as EditorAnalysis, {
      get: () => () => {
        throw "a string";
      },
    });

    expect(
      createCompilerService(throwing).handle({
        kind: "rename",
        id: 0,
        version: 1,
        source,
        offset: caret,
        newName: "double",
      }),
    ).toMatchObject({ kind: "service-failure", message: "unknown error" });
  });
});
