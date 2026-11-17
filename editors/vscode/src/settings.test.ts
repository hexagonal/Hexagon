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
      .toMatchObject({ "editor.inlayHints.maximumLength": 0 });
  });
});

describe("formatting", () => {
  test("four settings, all off until set, and nothing formats unasked", async () => {
    const manifest = JSON.parse(await readFile(fileURLToPath(
      new URL("../package.json", import.meta.url),
    ), "utf8")) as {
      contributes: {
        configuration: { properties: Record<string, { type?: unknown; default?: unknown; minimum?: number }> };
        configurationDefaults: Record<string, Record<string, unknown>>;
      };
    };
    const { properties } = manifest.contributes.configuration;
    // Unlimited is no number at all, and a number is a whole one of at least one.
    expect(properties["hexagon.format.maximumLineLength"])
      .toMatchObject({ type: ["integer", "null"], minimum: 1, default: null });
    expect(properties["hexagon.format.collapseExtraSpaces"]).toMatchObject({ type: "boolean", default: false });
    expect(properties["hexagon.format.leaveTrailingCommasAsWritten"]).toMatchObject({ type: "boolean", default: false });
    expect(properties["hexagon.format.applyWidthLimits"]).toMatchObject({ type: "boolean", default: false });
    // Canonical Layout §2.4: no format on save, on paste or while typing.
    const defaults = manifest.contributes.configurationDefaults["[hexagon]"] ?? {};
    for (const name of ["editor.formatOnSave", "editor.formatOnPaste", "editor.formatOnType"]) {
      expect(defaults[name]).toBeUndefined();
    }
  });
});

describe("indentation", () => {
  test("a Hexagon file is indented with spaces, whatever the editor's own default", async () => {
    const manifest = JSON.parse(await readFile(fileURLToPath(
      new URL("../package.json", import.meta.url),
    ), "utf8")) as { contributes: { configurationDefaults: Record<string, Record<string, unknown>> } };
    // The language refuses a tab in indentation, and VS Code writes a repair's
    // snippet with the editor's indentation: tabs, where it is set to tabs.
    expect(manifest.contributes.configurationDefaults["[hexagon]"])
      .toEqual({ "editor.inlayHints.maximumLength": 0, "editor.insertSpaces": true });
  });
});
