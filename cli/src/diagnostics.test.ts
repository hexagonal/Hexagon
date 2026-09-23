import { expect, test } from "vitest";
import { Source, type Diagnostics } from "../../compiler/src/index.js";
import { renderDiagnostic } from "./diagnostics.js";

test("terminal diagnostics include source positions, excerpts, labels, and notes", () => {
  const source = new Source.File(Source.fileId(0), "/work/Main.hex", "module Main\nlet x = nope\n");
  const diagnostic: Diagnostics.Diagnostic = {
    severity: "error",
    message: "unknown name `nope`",
    primary: source.span(20, 24),
    labels: [{ span: source.span(16, 17), message: "binding is here" }],
    notes: ["names must be in scope"],
  };
  const rendered = renderDiagnostic(diagnostic, new Map([[0, source]]));
  expect(rendered).toContain("/work/Main.hex:2:9: error: unknown name `nope`");
  expect(rendered).toContain("2 | let x = nope");
  expect(rendered).toContain("^ binding is here");
  expect(rendered).toContain("= note: names must be in scope");
});
