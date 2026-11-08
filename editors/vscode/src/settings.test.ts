import { describe, expect, test } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { trustedStandardLibraryProjects } from "./settings.js";

describe("standard-library development authority", () => {
  test("is declared at machine scope", async () => {
    const manifest = JSON.parse(await readFile(fileURLToPath(
      new URL("../package.json", import.meta.url),
    ), "utf8")) as {
      contributes: { configuration: { properties: Record<string, { scope?: string }> } };
    };
    expect(manifest.contributes.configuration.properties[
      "hexagon.languageServer.trustedStandardLibraryProjects"
    ]?.scope).toBe("machine");
  });

  test("reads only the explicit global value", () => {
    const configuration = {
      inspect: () => ({
        defaultValue: [],
        globalValue: ["/trusted"],
        workspaceValue: ["/workspace-cannot-grant"],
        workspaceFolderValue: ["/folder-cannot-grant"],
        workspaceLanguageValue: ["/language-cannot-grant"],
      }),
    };

    expect(trustedStandardLibraryProjects(configuration)).toEqual(["/trusted"]);
  });

  test("defaults to no authority and ignores malformed global values", () => {
    expect(trustedStandardLibraryProjects({ inspect: () => undefined })).toEqual([]);
    expect(trustedStandardLibraryProjects({ inspect: () => ({ globalValue: true }) }))
      .toEqual([]);
    expect(trustedStandardLibraryProjects({
      inspect: () => ({ globalValue: ["/trusted", 1, null] }),
    })).toEqual(["/trusted"]);
  });
});

describe("inlay hints", () => {
  test("three settings, all off until turned on, and a Hexagon line's hints never cut", async () => {
    const manifest = JSON.parse(await readFile(fileURLToPath(
      new URL("../package.json", import.meta.url),
    ), "utf8")) as {
      contributes: {
        configuration: { properties: Record<string, { type?: string; default?: unknown }> };
        configurationDefaults: Record<string, Record<string, unknown>>;
      };
    };
    const { properties } = manifest.contributes.configuration;
    for (const name of ["hexagon.inlayHints.types", "hexagon.inlayHints.colours", "hexagon.inlayHints.regexGroups"]) {
      expect(properties[name]).toMatchObject({ type: "boolean", default: false });
    }
    // VS Code cuts a line's hints at 43 characters; a cut type is not a face.
    expect(manifest.contributes.configurationDefaults["[hexagon]"])
      .toEqual({ "editor.inlayHints.maximumLength": 0 });
  });
});
