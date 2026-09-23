import { describe, expect, test } from "vitest";
import { parseArguments, UsageError } from "./arguments.js";

describe("CLI arguments", () => {
  test("parses multiple build roots and a working-directory-relative output", () => {
    expect(parseArguments(["build", "One.hex", "Two.hex", "--out-dir", "out"])).toEqual({
      kind: "build",
      roots: ["One.hex", "Two.hex"],
      outputDirectory: "out",
    });
  });

  test("uses -- to admit root names beginning with a dash", () => {
    expect(parseArguments(["check", "--", "-sample.hex"])).toEqual({
      kind: "check",
      roots: ["-sample.hex"],
    });
  });

  test.each([
    [[], "a command is required"],
    [["watch"], "unknown command or option"],
    [["check"], "requires at least one"],
    [["check", "Main.hex", "--out-dir", "out"], "only valid with build"],
    [["build", "Main.hex", "--out-dir"], "requires a directory"],
  ] as const)("refuses %j", (arguments_, message) => {
    expect(() => parseArguments(arguments_)).toThrowError(new RegExp(message));
    expect(() => parseArguments(arguments_)).toThrow(UsageError);
  });
});
