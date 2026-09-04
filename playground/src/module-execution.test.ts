import { describe, expect, test } from "vitest";

import { linkModule, resolveModulePath } from "./module-execution";

describe("playground module execution", () => {
  test("resolves emitted JavaScript specifiers back to virtual Hexagon paths", () => {
    expect(resolveModulePath("/main.hex", "./Mगणित.js")).toBe("/Mगणित.hex");
    expect(resolveModulePath("/app/main.hex", "../shared.js")).toBe("/shared.hex");
    expect(resolveModulePath("/main.hex", "node:url")).toBeUndefined();
  });

  test("links namespace, named, and effect imports without touching strings", () => {
    const source =
      'import * as Mगणित from "./Mगणित.js";\n' +
      'import { value } from "./Value.js";\n' +
      'import "./Effect.js";\n' +
      'console.log("./Mगणित.js");\n';
    const linked = linkModule(source, "/main.hex", new Map([
      ["/Mगणित.hex", "blob:math"],
      ["/Value.hex", "blob:value"],
      ["/Effect.hex", "blob:effect"],
    ]));

    expect(linked).toBe(
      'import * as Mगणित from "blob:math";\n' +
      'import { value } from "blob:value";\n' +
      'import "blob:effect";\n' +
      'console.log("./Mगणित.js");\n',
    );
  });
});
