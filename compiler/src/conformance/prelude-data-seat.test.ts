import { describe, expect, test } from "vitest";

import { compileFiles, runProject } from "../support/test-project.js";
import { typeScriptErrors } from "../support/typescript-check.js";

// Modules §5.5 and §11: `Option` has a data seat before `Int` and a full seat
// after `Seq`. The modules between the two — `Int`, `Nat`, `Float`, `Math`,
// `BigInt` and `Seq` — see Option's type and constructors, reach it by no load
// edge, and make any `Some` or `None` value they use themselves.

function declarationFiles(compiled: ReturnType<typeof compileFiles>): Record<string, string> {
  const files: Record<string, string> = {};
  for (const module of compiled.modules) {
    files[module.path.replace(/^\//u, "").replace(/\.hex$/u, ".d.ts")] = module.declarations.text;
  }
  if (compiled.runtimeDeclarations !== undefined) {
    files[compiled.runtimeDeclarations.path.replace(/^\//u, "")] = compiled.runtimeDeclarations.text;
  }
  return files;
}

function moduleNamed(compiled: ReturnType<typeof compileFiles>, name: string) {
  return compiled.modules.find((module) => module.name === name)!;
}

describe("Option's data seat", () => {
  test("the modules before Option's full seat import nothing from it", async () => {
    const files = [[
      "/main.hex",
      "module Main\n" +
        "export let sum: Option(Int) = Int.checkedAdd(1, 2)\n" +
        "export let natural: Option(Nat) = Nat.fromInt(3)\n" +
        "export let small: Option(Int) = BigInt.toInt(BigInt.fromInt(5))\n" +
        "export let whole: Int = Float.floor(Math.pi)\n" +
        "export let head: Option((Int, Seq(Int))) = Seq.next(Option.toSeq(Some(4)))\n",
    ] as const];
    const compiled = compileFiles(files);
    expect(compiled.diagnostics.map(({ message }) => message)).toEqual([]);
    // Every module between the seats, whatever it builds: none imports Option.
    const between = ["Hex.Int", "Hex.Nat", "Hex.Float", "Hex.Math", "Hex.BigInt", "Hex.Seq"];
    for (const name of between) {
      expect(moduleNamed(compiled, name).javascript.text).not.toContain("Option.js");
    }
    for (const name of ["Hex.Int", "Hex.Nat", "Hex.BigInt", "Hex.Seq"]) {
      expect(moduleNamed(compiled, name).declarations.text)
        .toContain('import type { Option } from "./Option.js";');
    }
    // The full module still imports `Seq`: the one runtime edge between them.
    expect(moduleNamed(compiled, "Hex.Option").javascript.text).toContain('from "./Seq.js"');
    // The early modules' `.d.ts` files name Option's type only, a type-only
    // edge TypeScript resolves whatever the load order.
    expect(await typeScriptErrors(declarationFiles(compiled))).toEqual([]);
    const main = await runProject(files);
    expect(main.sum).toEqual({ tag: "Some", value: 3 });
    expect(main.natural).toEqual({ tag: "Some", value: 3 });
    expect(main.small).toEqual({ tag: "Some", value: 5 });
    expect(main.whole).toBe(3);
    expect(main.head).toMatchObject({ tag: "Some" });
  });

  test("an early module's own None is the same value as Option's", async () => {
    // Unions §6.1: identity is never observed. `Int.checkedAdd` answers with
    // `Int.hex`'s own constant; `None` here is `Option.hex`'s.
    const files = [[
      "/main.hex",
      "module Main\n" +
        "let overflow: Option(Int) = Int.checkedAdd(9_007_199_254_740_991, 1)\n" +
        "export let same: Bool = overflow == None\n" +
        "export let shown: String = overflow.show()\n",
    ] as const];
    const main = await runProject(files);
    expect(main.same).toBe(true);
    expect(main.shown).toBe("None");
  });

  test("a program that never names Option writes no Option.js", () => {
    const compiled = compileFiles([["/main.hex", "module Main\nexport let ok: Bool = True\n"]]);
    expect(compiled.diagnostics.map(({ message }) => message)).toEqual([]);
    expect(compiled.modules.map(({ path }) => path)).not.toContain("/Hex/Option.hex");
  });
});
