import { describe, test } from "vitest";
import { compileFiles } from "../support/test-project.js";

function dump(files: readonly (readonly [string, string])[], path = "/main.hex"): void {
  const project = compileFiles(files);
  process.stdout.write("DIAGS: " + JSON.stringify(project.diagnostics.map((d) => d.message)) + "\n");
  const module = project.modules.find((m) => m.source.path === path);
  process.stdout.write("JS:\n" + (module ? module.javascript.text : "<none>") + "\n---\n");
}

describe("probe", () => {
  test("constructor fallback emission", () => {
    dump([
      ["/point.hex",
        "opaque record Point = {x: Float, y: Float}\n" +
        "export fun make(x: Float, y: Float): Point = Point({x = x, y = y})\n"],
      ["/main.hex",
        'import Point from "./point"\n' +
        "export let p: Point = Point.make(1.0, 2.0)\n"],
    ]);
  });

  test("term bare via let", () => {
    dump([
      ["/lib.hex", "export let await: Int = 4\n"],
      ["/main.hex", 'import Lib from "./lib"\n' +
        "let await = Lib.await\n" +
        "export let n: Int = await + 1\n"],
    ]);
  });

  test("constraint bare via alias fallback + qualified member", () => {
    dump([
      ["/lib.hex", [
        "export constraint Boxy<a> =",
        "    undefined(x: a): Int",
        "",
        "export record Box = {n: Int}",
        "honor Boxy<Box> =",
        "    undefined(x) = x.n",
        "",
      ].join("\n")],
      ["/main.hex", [
        'import Boxy from "./lib"',
        "export let twice<a: Boxy>(x: a): Int = Boxy.undefined(x) + Boxy.undefined(x)",
        "export let unit(): Unit = ()",
        "",
      ].join("\n")],
    ]);
  });

  test("constraint bare via alias fallback + qualified member eval", () => {
    dump([
      ["/lib.hex", [
        "export constraint Boxy<a> =",
        "    eval(x: a): Int",
        "",
        "export record Box = {n: Int}",
        "honor Boxy<Box> =",
        "    eval(x) = x.n",
        "",
      ].join("\n")],
      ["/main.hex", [
        'import Boxy from "./lib"',
        "export let twice<a: Boxy>(x: a): Int = Boxy.eval(x) + Boxy.eval(x)",
        "export let unit(): Unit = ()",
        "",
      ].join("\n")],
    ]);
  });

  test("lib.hex side for eval", () => {
    dump([
      ["/lib.hex", [
        "export constraint Boxy<a> =",
        "    eval(x: a): Int",
        "",
        "export record Box = {n: Int}",
        "honor Boxy<Box> =",
        "    eval(x) = x.n",
        "",
      ].join("\n")],
      ["/main.hex", [
        'import Boxy from "./lib"',
        "export let twice<a: Boxy>(x: a): Int = Boxy.eval(x) + Boxy.eval(x)",
        "export let unit(): Unit = ()",
        "",
      ].join("\n")],
    ], "/lib.hex");
  });

  test("minted local console subtracted", () => {
    dump([
      ["/lib.hex", [
        "export constraint Boxy<a> =",
        "    console(x: a): Int",
        "",
        "export record Box = {n: Int}",
        "honor Boxy<Box> =",
        "    console(x) = x.n",
        "",
      ].join("\n")],
      ["/main.hex", [
        'import Boxy from "./lib"',
        "export let use(b: Boxy.Box): Int = Boxy.console(b)",
        "export let unit(): Unit = ()",
        "",
      ].join("\n")],
    ]);
  });
});
