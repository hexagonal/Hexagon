import { writeFileSync } from "node:fs";
import { test } from "vitest";
import { compileFiles } from "../support/test-project.js";
const lines: string[] = [];
const show = (label: string, files: readonly (readonly [string, string])[]): void => {
  lines.push("=== " + label + " ===");
  for (const d of compileFiles(files).diagnostics) lines.push("  | " + d.message);
};
const HELPER: readonly [string, string] = ["/helper.hex",
  "module Helper\n\nexport let zero: Nat = 0\nexport let zeroInt: Int = 0\n" +
  "export let go = (n: Int): Int => n\nexport let text: String = \"x\"\n"];
const COLOUR: readonly [string, string] = ["/colour.hex",
  "module Colour\n\nexport union Hue = Red | Green\nexport let first: Hue = Red\n"];
const COLOUREQ: readonly [string, string] = ["/coloureq.hex",
  "module ColourEq\n\nexport union Hue derives Eq = Red | Green\nexport let first: Hue = Red\n"];
test("probe", () => {
  show("Float.nan at Float", [["/main.hex", "module Main\n\nimport Float\n\n" +
    "export fun f(t: Float): String =\n    match t\n        Float.nan => \"n\"\n        _ => \"ok\"\n"]]);
  show("-Float.infinity at Float", [["/main.hex", "module Main\n\nimport Float\n\n" +
    "export fun f(t: Float): String =\n    match t\n        -Float.infinity => \"n\"\n        _ => \"ok\"\n"]]);
  show("Colour.first at Hue (no Eq)", [COLOUR, ["/main.hex", "module Main\n\nimport Colour\n\n" +
    "export fun f(h: Colour.Hue): String =\n    match h\n        Colour.first => \"n\"\n        _ => \"ok\"\n"]]);
  show("ColourEq.first at Hue (derives Eq)", [COLOUREQ, ["/main.hex", "module Main\n\nimport ColourEq\n\n" +
    "export fun f(h: ColourEq.Hue): String =\n    match h\n        ColourEq.first => \"n\"\n        _ => \"ok\"\n"]]);
  show("-Helper.zero at Nat", [HELPER, ["/main.hex", "module Main\n\nimport Helper\n\n" +
    "export fun f(n: Nat): String =\n    match n\n        -Helper.zero => \"n\"\n        _ => \"ok\"\n"]]);
  show("Helper.zero at Nat", [HELPER, ["/main.hex", "module Main\n\nimport Helper\n\n" +
    "export fun f(n: Nat): String =\n    match n\n        Helper.zero => \"n\"\n        _ => \"ok\"\n"]]);
  show("Helper.zeroInt at String", [HELPER, ["/main.hex", "module Main\n\nimport Helper\n\n" +
    "export fun f(s: String): String =\n    match s\n        Helper.zeroInt => \"n\"\n        _ => \"ok\"\n"]]);
  show("Helper.go at Int", [HELPER, ["/main.hex", "module Main\n\nimport Helper\n\n" +
    "export fun f(i: Int): String =\n    match i\n        Helper.go => \"n\"\n        _ => \"ok\"\n"]]);
  show("Helper.zeroInt in catch", [HELPER, ["/main.hex", "module Main\n\nimport Helper\n\n" +
    "export fun f(): Int =\n    match Helper.go(1)\n        x => x\n    catch\n        Helper.zeroInt => 0\n        _ => 1\n"]]);
  show("Rat.fromInt at Int", [["/main.hex", "module Main\n\nimport Rat\n\n" +
    "export fun f(i: Int): String =\n    match i\n        Rat.fromInt => \"n\"\n        _ => \"ok\"\n"]]);
  show("Rat.zilch", [["/main.hex", "module Main\n\nimport Rat\n\n" +
    "export fun f(i: Int): String =\n    match i\n        Rat.zilch => \"n\"\n        _ => \"ok\"\n"]]);
  show("unbound alias", [["/main.hex", "module Main\n\n" +
    "export fun f(i: Int): String =\n    match i\n        Nowhere.zilch => \"n\"\n        _ => \"ok\"\n"]]);
  show("let seat", [HELPER, ["/main.hex", "module Main\n\nimport Helper\n\n" +
    "export fun f(): Int =\n    let Helper.zeroInt = 1\n    2\n"]]);
  show("for seat", [HELPER, ["/main.hex", "module Main\n\nimport Helper\n\n" +
    "export fun f(v: Vector(Int)): Int =\n    for Helper.zeroInt in v\n        ignore(1)\n    1\n"]]);
  show("param seat", [HELPER, ["/main.hex", "module Main\n\nimport Helper\n\n" +
    "export fun f(Helper.zeroInt: Int): Int = 1\n"]]);
  writeFileSync("/tmp/probe894g.txt", lines.join("\n"));
});
