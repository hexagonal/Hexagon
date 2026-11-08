import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import {
  anyHintShown,
  defaultPlaygroundSettings,
  hintShown,
  inputBoxShown,
  parseSettings,
  serializeSettings,
  settingRows,
  type PlaygroundSettings,
} from "./settings";

const none: PlaygroundSettings = { typeHints: false, colourHints: false, regexGroupHints: false, inputBox: false };

describe("the playground's settings", () => {
  test("each off until the dev turns it on", () => {
    expect(defaultPlaygroundSettings).toEqual(none);
    expect(parseSettings(null)).toEqual(none);
    expect(parseSettings(undefined)).toEqual(none);
  });

  test("a stored value that is unreadable, or not a boolean, keeps its default", () => {
    expect(parseSettings("{")).toEqual(none);
    expect(parseSettings("true")).toEqual(none);
    expect(parseSettings("null")).toEqual(none);
    expect(parseSettings(JSON.stringify({ typeHints: "yes", inputBox: 1 }))).toEqual(none);
  });

  test("each read on its own, and written back as read", () => {
    for (const key of Object.keys(none) as (keyof PlaygroundSettings)[]) {
      const on = { ...none, [key]: true };
      expect(parseSettings(JSON.stringify({ [key]: true }))).toEqual(on);
      expect(parseSettings(serializeSettings(on))).toEqual(on);
    }
  });

  test("the window lists each setting once, the hints under one heading", () => {
    expect(settingRows.map(({ key }) => key).sort()).toEqual(Object.keys(none).sort());
    expect(settingRows.filter(({ group }) => group === "Inlay hints").map(({ key }) => key))
      .toEqual(["typeHints", "colourHints", "regexGroupHints"]);
  });

  test("a hint's words are the extension's own setting's", () => {
    const manifest = JSON.parse(readFileSync(new URL("../../editors/vscode/package.json", import.meta.url), "utf8")) as {
      contributes: { configuration: { properties: Record<string, { markdownDescription?: string }> } };
    };
    const { properties } = manifest.contributes.configuration;
    const extensionName = { typeHints: "types", colourHints: "colours", regexGroupHints: "regexGroups" } as const;
    for (const row of settingRows) {
      if (row.key === "inputBox") continue;
      expect(row.description).toBe(properties[`hexagon.inlayHints.${extensionName[row.key]}`]?.markdownDescription);
    }
  });
});

describe("which hints the editor shows", () => {
  test("none by default, and none asked for", () => {
    for (const kind of ["type", "colour", "regexGroup"] as const) expect(hintShown(kind, none)).toBe(false);
    expect(anyHintShown(none)).toBe(false);
  });

  test("each kind by its own setting, and only that kind", () => {
    expect(["type", "colour", "regexGroup"].filter((kind) =>
      hintShown(kind as "type", { ...none, typeHints: true })
    )).toEqual(["type"]);
    expect(["type", "colour", "regexGroup"].filter((kind) =>
      hintShown(kind as "type", { ...none, colourHints: true })
    )).toEqual(["colour"]);
    expect(["type", "colour", "regexGroup"].filter((kind) =>
      hintShown(kind as "type", { ...none, regexGroupHints: true })
    )).toEqual(["regexGroup"]);
    expect(anyHintShown({ ...none, typeHints: true })).toBe(true);
    expect(anyHintShown({ ...none, colourHints: true })).toBe(true);
    expect(anyHintShown({ ...none, regexGroupHints: true })).toBe(true);
    expect(anyHintShown({ ...none, inputBox: true })).toBe(false);
  });
});

describe("the input box", () => {
  test("hidden by default, shown when the setting is on", () => {
    expect(inputBoxShown(none, undefined)).toBe(false);
    expect(inputBoxShown({ ...none, inputBox: true }, undefined)).toBe(true);
  });

  test("shown for a shared link that carries input, and not for one that carries none", () => {
    expect(inputBoxShown(none, "3 4\n")).toBe(true);
    expect(inputBoxShown(none, "")).toBe(false);
  });
});
