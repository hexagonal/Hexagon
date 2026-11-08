import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { inputStorageKey, sourceStorageKey } from "./persistence";
import {
  anyHintShown,
  defaultPlaygroundSettings,
  hintShown,
  inputBoxShown,
  parseSettings,
  pointWithin,
  runInput,
  serializeSettings,
  settingOn,
  settingRows,
  settingsStorageKey,
  shownHints,
  withSetting,
  type PlaygroundSettings,
  type SettingsState,
} from "./settings";
import { themeStorageKey } from "./theme";

const none: PlaygroundSettings = { typeHints: false, colourHints: false, regexGroupHints: false, inputBox: false };

describe("the playground's settings", () => {
  test("each off until the dev turns it on", () => {
    expect(defaultPlaygroundSettings).toEqual(none);
    expect(parseSettings(null)).toEqual(none);
    expect(parseSettings(undefined)).toEqual(none);
  });

  test("kept under a key of their own, apart from the source, the input and the theme", () => {
    expect(new Set([settingsStorageKey, sourceStorageKey, inputStorageKey, themeStorageKey]).size).toBe(4);
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
    expect(settingRows.map(({ group, label }) => `${group}: ${label}`)).toEqual([
      "Inlay hints: Types",
      "Inlay hints: Colours",
      "Inlay hints: Regex group numbers",
      "Running: Input box",
    ]);
  });

  test("the input box's words name both reads, and say a hidden box is read as none", () => {
    expect(settingRows.find(({ key }) => key === "inputBox")?.description).toBe(
      "Show a box under the editor whose text a run reads as its standard input, with `Stdio.readText` or `Stdio.readTextLossy`. While it is hidden, a run reads no input.",
    );
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

describe("the hints the editor is given", () => {
  const hints = [
    { kind: "type", label: ": Int" },
    { kind: "colour", label: "impure" },
    { kind: "regexGroup", label: "1" },
  ] as const;

  test("none asked for while every kind is off", async () => {
    let asked = 0;
    const ask = async () => {
      asked += 1;
      return hints;
    };
    expect(await shownHints(none, ask)).toEqual([]);
    expect(asked).toBe(0);
    expect(await shownHints({ ...none, inputBox: true }, ask)).toEqual([]);
    expect(asked).toBe(0);
  });

  test("asked for once a kind is on, and only that kind's kept", async () => {
    let asked = 0;
    const ask = async () => {
      asked += 1;
      return hints;
    };
    expect(await shownHints({ ...none, colourHints: true }, ask)).toEqual([hints[1]]);
    expect(await shownHints({ ...none, typeHints: true, regexGroupHints: true }, ask)).toEqual([hints[0], hints[2]]);
    expect(asked).toBe(2);
  });
});

describe("the window's rows", () => {
  const plain: SettingsState = { settings: none, sharedInput: undefined };
  const shared: SettingsState = { settings: none, sharedInput: "3 4\n" };

  test("a hint's row is ticked by its setting", () => {
    expect(settingOn(plain, "colourHints")).toBe(false);
    expect(settingOn({ ...plain, settings: { ...none, colourHints: true } }, "colourHints")).toBe(true);
    expect(settingOn(shared, "colourHints")).toBe(false);
  });

  test("the input box's row is ticked while the box is on the page, a shared link's included", () => {
    expect(settingOn(plain, "inputBox")).toBe(false);
    expect(settingOn(shared, "inputBox")).toBe(true);
    expect(settingOn({ ...plain, settings: { ...none, inputBox: true } }, "inputBox")).toBe(true);
  });

  test("turning the box off or on ends a shared link's hold on it", () => {
    expect(withSetting(shared, "inputBox", false)).toEqual(plain);
    expect(settingOn(withSetting(shared, "inputBox", false), "inputBox")).toBe(false);
    expect(withSetting(shared, "inputBox", true)).toEqual({
      settings: { ...none, inputBox: true },
      sharedInput: undefined,
    });
  });

  test("turning a hint on or off leaves a shared link's hold as it was", () => {
    expect(withSetting(shared, "typeHints", true)).toEqual({
      settings: { ...none, typeHints: true },
      sharedInput: "3 4\n",
    });
    expect(withSetting(shared, "typeHints", false)).toEqual(shared);
  });
});

describe("a run's standard input", () => {
  test("none while the box is hidden, whatever it holds", () => {
    expect(runInput({ settings: none, sharedInput: undefined }, "kept\n")).toBe("");
  });

  test("the box's text while it is on the page", () => {
    expect(runInput({ settings: { ...none, inputBox: true }, sharedInput: undefined }, "kept\n")).toBe("kept\n");
    expect(runInput({ settings: none, sharedInput: "3 4\n" }, "3 4\n")).toBe("3 4\n");
  });
});

describe("where a press falls", () => {
  const box = { left: 10, right: 110, top: 20, bottom: 70 };

  test("within the window, its edges included", () => {
    expect(pointWithin(60, 45, box)).toBe(true);
    for (const [x, y] of [[10, 45], [110, 45], [60, 20], [60, 70]]) expect(pointWithin(x!, y!, box)).toBe(true);
  });

  test("outside it, past any edge", () => {
    for (const [x, y] of [[9, 45], [111, 45], [60, 19], [60, 71]]) expect(pointWithin(x!, y!, box)).toBe(false);
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
