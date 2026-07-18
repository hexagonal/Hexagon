import { describe, expect, test } from "vitest";

import { parseWorkspaceSource } from "./workspace-source";

describe("parseWorkspaceSource", () => {
  test("extracts unindented named modules and leaves offset-stable main source", () => {
    const source =
      "module Mगणित\n" +
      "export let उत्तर = \"😀\"\n" +
      "end module Mगणित\n" +
      "console.log(Mगणित.उत्तर)\n";
    const workspace = parseWorkspaceSource(source);

    expect(workspace.diagnostics).toEqual([]);
    expect(workspace.modules).toMatchObject([{
      name: "Mगणित",
      path: "/Mगणित.hex",
      text: 'export let उत्तर = "😀"\n',
      sourceOffset: source.indexOf("export"),
    }]);
    expect(workspace.mainText).toContain(
      'import * as Mगणित from "./Mगणित"\n',
    );
    const visibleMain = workspace.mainText.slice(workspace.mainPrefixLength);
    expect(visibleMain.length).toBe(source.length);
    expect(visibleMain.slice(source.indexOf("console"))).toBe(
      "console.log(Mगणित.उत्तर)\n",
    );
  });

  test("requires matching, unique, uppercase-start, non-nested blocks", () => {
    const mismatch = parseWorkspaceSource(
      "module Repo\nmodule Nested\nend module Wrong\nend module Repo\n",
    );
    expect(mismatch.diagnostics.map(({ message }) => message)).toEqual([
      "playground module blocks cannot nest; close the current module first",
      "module block opened as `Repo` but closes as `Wrong`",
      "`end module` has no matching module block",
    ]);

    const invalid = parseWorkspaceSource(
      "module repo\nend module repo\nmodule Repo\nend module Repo\nmodule Repo\nend module Repo\n",
    );
    expect(invalid.diagnostics.map(({ message }) => message)).toEqual([
      "a playground module name must be an uppercase-start identifier",
      "playground module `Repo` is declared more than once",
    ]);
  });

  test("reports a missing named close at the opening name", () => {
    const source = "module Repo\nexport let x = 1\n";
    const result = parseWorkspaceSource(source);

    expect(result.diagnostics).toEqual([{
      severity: "error",
      message: "module `Repo` is missing `end module Repo`",
      startOffset: source.indexOf("Repo"),
      endOffset: source.indexOf("Repo") + "Repo".length,
    }]);
  });
});
