import type { PlaygroundInlayHint } from "./protocol";

/**
 * The playground's settings, the ones its `Settings…` window lists: which inlay
 * hints the editor shows, and whether the run's input box is on the page.
 * Each starts off and stays off until the dev turns it on, as the extension's
 * own inlay hint settings do.
 */
export interface PlaygroundSettings {
  /** `hexagon.inlayHints.types` in the extension. */
  readonly typeHints: boolean;
  /** `hexagon.inlayHints.colours` in the extension. */
  readonly colourHints: boolean;
  /** `hexagon.inlayHints.regexGroups` in the extension. */
  readonly regexGroupHints: boolean;
  /** The input box under the editor, the run's standard input (`spec/program-io.md` §6). */
  readonly inputBox: boolean;
}

export const defaultPlaygroundSettings: PlaygroundSettings = {
  typeHints: false,
  colourHints: false,
  regexGroupHints: false,
  inputBox: false,
};

export const settingsStorageKey = "hexagon.playground.settings";

/** One row of the `Settings…` window. */
export interface SettingRow {
  readonly key: keyof PlaygroundSettings;
  /** The heading the row sits under. */
  readonly group: "Inlay hints" | "Running";
  readonly label: string;
  readonly description: string;
}

/** The window's rows, in order; the hints' words are the extension's own. */
export const settingRows: readonly SettingRow[] = [
  {
    key: "typeHints",
    group: "Inlay hints",
    label: "Types",
    description:
      "Show the types inference gives the places a type could be written: a parameter, a function's result, a `let` with no written type. Shown only: a hint is never written into the file.",
  },
  {
    key: "colourHints",
    group: "Inlay hints",
    label: "Colours",
    description:
      "Show a function's colour in words, such as \"impure; may fail\", at the end of its header's line. A header has no place to write it.",
  },
  {
    key: "regexGroupHints",
    group: "Inlay hints",
    label: "Regex group numbers",
    description:
      "Show each capturing group's number, the one `Regex.group` reads it by, at its `(` in a pattern handed to `Regex.compile` as a literal.",
  },
  {
    key: "inputBox",
    group: "Running",
    label: "Input box",
    description:
      "Show a box under the editor whose text a run reads as its standard input, with `Stdio.readText`. While it is hidden, a run reads no input.",
  },
];

/**
 * Reads stored settings. A missing or unreadable value, and any entry that is
 * not a boolean, keeps its default, so a setting added later starts off too.
 */
export function parseSettings(stored: string | null | undefined): PlaygroundSettings {
  let read: unknown;
  try {
    read = stored === null || stored === undefined ? undefined : JSON.parse(stored);
  } catch {
    read = undefined;
  }
  const flag = (key: keyof PlaygroundSettings): boolean => {
    const value = typeof read === "object" && read !== null
      ? (read as Record<string, unknown>)[key]
      : undefined;
    return typeof value === "boolean" ? value : defaultPlaygroundSettings[key];
  };
  return {
    typeHints: flag("typeHints"),
    colourHints: flag("colourHints"),
    regexGroupHints: flag("regexGroupHints"),
    inputBox: flag("inputBox"),
  };
}

export function serializeSettings(settings: PlaygroundSettings): string {
  return JSON.stringify(settings);
}

/** Whether the settings show a hint of this kind. */
export function hintShown(kind: PlaygroundInlayHint["kind"], settings: PlaygroundSettings): boolean {
  switch (kind) {
    case "type":
      return settings.typeHints;
    case "colour":
      return settings.colourHints;
    case "regexGroup":
      return settings.regexGroupHints;
  }
}

/** Whether the settings show a hint of any kind, so that hints are worth asking for. */
export function anyHintShown(settings: PlaygroundSettings): boolean {
  return settings.typeHints || settings.colourHints || settings.regexGroupHints;
}

/**
 * Whether the input box is on the page: where the settings show it, and on a
 * page opened from a shared link that carries input, so that the run reads
 * what its author's did.
 */
export function inputBoxShown(settings: PlaygroundSettings, sharedInput: string | undefined): boolean {
  return settings.inputBox || (sharedInput !== undefined && sharedInput !== "");
}
